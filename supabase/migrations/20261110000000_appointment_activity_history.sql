-- First phase of the Owner's Activity History. Records future clinic appointment changes.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.clinic_activity_log (
  activity_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_auth_user_id uuid,
  actor_name text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('super_admin', 'admin', 'system')),
  resource_type text NOT NULL,
  record_id bigint NOT NULL,
  action text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS clinic_activity_resource_time_idx
  ON public.clinic_activity_log (resource_type, occurred_at DESC, activity_id DESC);
CREATE INDEX IF NOT EXISTS clinic_activity_resource_record_idx
  ON public.clinic_activity_log (resource_type, record_id, occurred_at DESC, activity_id DESC);

ALTER TABLE public.clinic_activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_activity_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.clinic_activity_log_activity_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinic_activity_log TO authenticated;
DROP POLICY IF EXISTS "Owner reads clinic activity" ON public.clinic_activity_log;
CREATE POLICY "Owner reads clinic activity" ON public.clinic_activity_log FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

CREATE OR REPLACE FUNCTION public.record_appointment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  actor_id uuid := auth.uid();
  actor_kind text;
  display_name text;
  event_action text;
  appointment_key bigint;
  details jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    appointment_key := NEW.appointment_id;
    event_action := 'appointment_created';
  ELSIF TG_OP = 'DELETE' THEN
    appointment_key := OLD.appointment_id;
    event_action := 'appointment_deleted';
  ELSE
    appointment_key := NEW.appointment_id;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      details := jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status);
    END IF;
    IF OLD.appointment_datetime IS DISTINCT FROM NEW.appointment_datetime THEN
      details := details || jsonb_build_object('from_time', OLD.appointment_datetime, 'to_time', NEW.appointment_datetime);
    END IF;

    -- Only the timed server action sets this transaction-local marker. Never
    -- infer the actor from notes, which can contain arbitrary user input.
    IF current_setting('clinic.automatic_appointment_id', true) = appointment_key::text THEN
      IF OLD.status = 'confirmed' AND NEW.status = 'completed' AND OLD.appointment_end <= statement_timestamp() THEN
        event_action := 'appointment_auto_completed';
      ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' AND OLD.appointment_datetime < statement_timestamp() THEN
        event_action := 'appointment_expired';
      END IF;
      IF event_action IS NOT NULL THEN
        actor_kind := 'system';
        display_name := 'System';
      END IF;
    END IF;

    IF event_action IS NULL THEN
      event_action := CASE
        WHEN OLD.request_status = 'pending' AND NEW.request_status IS DISTINCT FROM OLD.request_status AND OLD.request_type = 'reschedule'
          THEN CASE WHEN NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime THEN 'reschedule_approved' ELSE 'reschedule_declined' END
        WHEN OLD.request_status = 'pending' AND NEW.request_status IS DISTINCT FROM OLD.request_status AND OLD.request_type = 'cancellation'
          THEN CASE WHEN NEW.status = 'cancelled' THEN 'cancellation_approved' ELSE 'cancellation_declined' END
        WHEN OLD.status = 'pending' AND NEW.status = 'confirmed' THEN 'appointment_approved'
        WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled' THEN 'appointment_cancelled'
        WHEN OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN 'appointment_completed'
        WHEN OLD.appointment_datetime IS DISTINCT FROM NEW.appointment_datetime THEN 'appointment_rescheduled'
        WHEN OLD.status IS DISTINCT FROM NEW.status OR OLD.doctor_id IS DISTINCT FROM NEW.doctor_id
          OR OLD.service_id IS DISTINCT FROM NEW.service_id OR OLD.patient_id IS DISTINCT FROM NEW.patient_id
          OR OLD.request_status IS DISTINCT FROM NEW.request_status OR OLD.request_type IS DISTINCT FROM NEW.request_type
          OR OLD.request_new_datetime IS DISTINCT FROM NEW.request_new_datetime THEN 'appointment_updated'
        WHEN OLD.remarks IS DISTINCT FROM NEW.remarks THEN 'appointment_notes_updated'
        ELSE NULL
      END;
    END IF;
  END IF;

  IF event_action IS NULL THEN RETURN NULL; END IF;
  IF actor_kind IS NULL THEN
    actor_kind := public.current_clinic_role();
    IF actor_kind IS NULL OR actor_kind NOT IN ('admin', 'super_admin') THEN RETURN NULL; END IF;
    SELECT nullif(btrim(concat_ws(' ', first_name, last_name)), '') INTO display_name
      FROM public.admin WHERE auth_user_id = actor_id;
  ELSE
    actor_id := NULL;
  END IF;

  INSERT INTO public.clinic_activity_log (actor_auth_user_id, actor_name, actor_role, resource_type, record_id, action, changes)
  VALUES (actor_id, coalesce(display_name, CASE WHEN actor_kind = 'super_admin' THEN 'Owner' ELSE 'Staff' END),
    actor_kind, 'appointment', appointment_key, event_action, details);
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.record_appointment_activity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS record_appointment_activity ON public.appointments;
CREATE TRIGGER record_appointment_activity AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.record_appointment_activity();

-- Invoker rights preserve the same appointment RLS policies as the clinic UI.
CREATE OR REPLACE FUNCTION public.apply_automatic_appointment_status(
  p_appointment_id bigint, p_expected_status text, p_expected_time timestamptz
)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  previous_marker text := current_setting('clinic.automatic_appointment_id', true);
  changed boolean;
  current_time_at timestamptz := statement_timestamp();
  note text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Clinic access required.' USING ERRCODE = '42501';
  END IF;
  IF p_appointment_id IS NULL OR p_expected_time IS NULL OR p_expected_status IS NULL
    OR p_expected_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Invalid appointment snapshot.' USING ERRCODE = '22023';
  END IF;

  note := CASE WHEN p_expected_status = 'confirmed'
    THEN ']: Appointment automatically marked as completed (service duration elapsed).'
    ELSE ']: Appointment auto-cancelled because the scheduled time has passed.' END;
  note := CASE WHEN p_expected_status = 'confirmed' THEN '[System Auto-complete ' ELSE '[System Auto-cancel ' END
    || to_char(current_time_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') || ' PHT' || note;

  PERFORM set_config('clinic.automatic_appointment_id', p_appointment_id::text, true);
  UPDATE public.appointments
    SET status = CASE WHEN p_expected_status = 'confirmed' THEN 'completed'::public.appointment_status ELSE 'cancelled'::public.appointment_status END,
        remarks = concat_ws(E'\n\n', nullif(remarks, ''), note),
        updated_at = current_time_at
    WHERE appointment_id = p_appointment_id AND status::text = p_expected_status AND appointment_datetime = p_expected_time
      AND ((status = 'confirmed' AND appointment_end <= current_time_at)
        OR (status = 'pending' AND appointment_datetime < current_time_at));
  changed := FOUND;
  PERFORM set_config('clinic.automatic_appointment_id', coalesce(previous_marker, ''), true);
  RETURN changed;
END
$fn$;

REVOKE ALL ON FUNCTION public.apply_automatic_appointment_status(bigint, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_automatic_appointment_status(bigint, text, timestamptz) TO authenticated;
COMMIT;
