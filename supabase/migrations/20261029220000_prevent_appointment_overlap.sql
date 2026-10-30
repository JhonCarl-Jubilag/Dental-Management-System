-- Review the aggregate preflight report and take a fresh backup before applying.
-- Apply after patient isolation. Existing conflicts abort; no bookings are deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.services,public.doctors,public.doctor_services,public.doctor_availability,public.appointments IN SHARE ROW EXCLUSIVE MODE;

DO $prerequisites$
BEGIN
  IF to_regprocedure('public.book_patient_appointment(bigint,bigint,timestamp with time zone,text)') IS NULL
    OR to_regprocedure('public.current_patient_id()') IS NULL THEN
    RAISE EXCEPTION 'Apply and verify the patient-isolation migration first.';
  END IF;
END
$prerequisites$;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS scheduled_duration_minutes integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS appointment_end timestamptz;
DROP TRIGGER IF EXISTS guard_appointment_reservation ON public.appointments;

-- Capture the timing the application currently uses. Historical durations cannot
-- be reconstructed if their catalogue value was changed before this migration.
UPDATE public.appointments a SET
  scheduled_duration_minutes=coalesce(a.scheduled_duration_minutes,s.duration_minutes),
  appointment_end=coalesce(a.appointment_end,a.appointment_datetime+make_interval(mins=>coalesce(a.scheduled_duration_minutes,s.duration_minutes)))
FROM public.services s WHERE s.service_id=a.service_id
  AND coalesce(a.scheduled_duration_minutes,s.duration_minutes) BETWEEN 1 AND 1440
  AND isfinite(a.appointment_datetime)
  AND (a.scheduled_duration_minutes IS NULL OR a.appointment_end IS NULL);

DO $preflight$
DECLARE invalid_count bigint; overlap_count bigint;
BEGIN
  SELECT count(*) INTO invalid_count FROM public.appointments
  WHERE status IN ('pending','confirmed') AND (
    doctor_id IS NULL OR patient_id IS NULL OR service_id IS NULL OR NOT isfinite(appointment_datetime)
    OR scheduled_duration_minutes IS NULL OR scheduled_duration_minutes NOT BETWEEN 1 AND 1440
    OR appointment_end IS NULL OR NOT isfinite(appointment_end)
    OR appointment_end<>appointment_datetime+make_interval(mins=>scheduled_duration_minutes));
  SELECT count(*) INTO overlap_count FROM public.appointments a JOIN public.appointments b
    ON a.appointment_id<b.appointment_id AND a.doctor_id=b.doctor_id
    AND a.appointment_datetime<b.appointment_end AND b.appointment_datetime<a.appointment_end
    WHERE a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed');
  IF invalid_count>0 OR overlap_count>0 THEN
    RAISE EXCEPTION 'Appointment safeguard not applied: % invalid active timing rows, % overlapping active pairs. Review existing appointments; no automatic cancellation or deletion was performed.',invalid_count,overlap_count;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_appointment_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE reserve boolean; catalogue_duration integer;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.scheduled_duration_minutes IS DISTINCT FROM OLD.scheduled_duration_minutes
    OR NEW.appointment_end IS DISTINCT FROM OLD.appointment_end) THEN
    RAISE EXCEPTION 'Booked duration and end time are managed automatically.' USING ERRCODE='22023';
  END IF;
  reserve:=NEW.status IN ('pending','confirmed') AND (TG_OP='INSERT'
    OR OLD.status IS NULL OR OLD.status NOT IN ('pending','confirmed')
    OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.service_id IS DISTINCT FROM OLD.service_id
    OR NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime);

  IF TG_OP='INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    -- Lock the catalogue row until commit. Later edits affect new bookings only.
    SELECT duration_minutes INTO catalogue_duration
      FROM public.services WHERE service_id=NEW.service_id FOR SHARE;
    NEW.scheduled_duration_minutes:=CASE WHEN catalogue_duration BETWEEN 1 AND 1440 THEN catalogue_duration ELSE NULL END;
  END IF;
  IF NEW.scheduled_duration_minutes BETWEEN 1 AND 1440 AND isfinite(NEW.appointment_datetime) THEN
    NEW.appointment_end:=NEW.appointment_datetime+make_interval(mins=>NEW.scheduled_duration_minutes);
  ELSE NEW.appointment_end:=NULL;
  END IF;

  IF NEW.status IN ('pending','confirmed') AND (NEW.patient_id IS NULL OR NEW.doctor_id IS NULL OR NEW.service_id IS NULL
    OR NEW.appointment_end IS NULL OR NOT isfinite(NEW.appointment_datetime)) THEN
    RAISE EXCEPTION 'An active appointment needs a patient, dentist, service and valid treatment duration.' USING ERRCODE='22023';
  END IF;
  IF reserve THEN
    IF NEW.appointment_datetime<now() THEN RAISE EXCEPTION 'Choose a future appointment time.' USING ERRCODE='22023'; END IF;
    IF TG_OP='INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('pending','confirmed') OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
      PERFORM 1 FROM public.services WHERE service_id=NEW.service_id AND status='active' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'The service is no longer available for booking.' USING ERRCODE='22023'; END IF;
    END IF;
    PERFORM 1 FROM public.doctors WHERE doctor_id=NEW.doctor_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The dentist is no longer available for booking.' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.doctor_services WHERE doctor_id=NEW.doctor_id AND service_id=NEW.service_id AND status='active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The dentist no longer offers this service.' USING ERRCODE='22023'; END IF;
    -- Row locks order booking versus disabling/editing the chosen period.
    -- Later schedule edits keep already committed appointments unchanged.
    PERFORM 1 FROM public.doctor_availability da WHERE da.doctor_id=NEW.doctor_id AND da.is_available=true
      AND da.available_date=(NEW.appointment_datetime AT TIME ZONE 'Asia/Manila')::date
      AND ((da.available_date+da.start_time) AT TIME ZONE 'Asia/Manila')<=NEW.appointment_datetime
      AND ((da.available_date+da.end_time) AT TIME ZONE 'Asia/Manila')>=NEW.appointment_end FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The full treatment no longer fits an available period. Refresh the schedule.' USING ERRCODE='22023'; END IF;
  END IF;
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
    AND (NEW.appointment_end IS NULL OR NEW.appointment_end>now()) THEN
    RAISE EXCEPTION 'The full booked treatment duration must elapse before completion.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_appointment_reservation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_appointment_reservation BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.guard_appointment_reservation();

DO $constraints$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_active_timing_check') THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_active_timing_check CHECK (
      CASE WHEN status IN ('pending','confirmed') THEN coalesce(
        doctor_id IS NOT NULL AND patient_id IS NOT NULL AND service_id IS NOT NULL
        AND scheduled_duration_minutes BETWEEN 1 AND 1440 AND isfinite(appointment_datetime)
        AND isfinite(appointment_end) AND appointment_end>appointment_datetime,false) ELSE true END);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_no_doctor_overlap') THEN
    -- Native range indexes need no btree_gist extension. The closed numeric
    -- point matches exactly one dentist; [start,end) permits back-to-back care.
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_no_doctor_overlap EXCLUDE USING gist
      (numrange(doctor_id::numeric,doctor_id::numeric,'[]') WITH &&,
       tstzrange(appointment_datetime,appointment_end,'[)') WITH &&)
      WHERE (status IN ('pending','confirmed'));
  END IF;
END
$constraints$;

-- Read models use the reserved duration for existing appointments and the
-- catalogue duration for new bookings. The response remains times-only.
CREATE OR REPLACE FUNCTION public.get_booking_time_slots(
  p_doctor_id bigint,p_service_id bigint,p_date date,p_interval integer DEFAULT 30,
  p_lead_minutes integer DEFAULT 0,p_exclude_appointment_id bigint DEFAULT NULL,p_time text DEFAULT NULL)
RETURNS TABLE(time_slot text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE patient bigint; clinic boolean; duration integer; excluded public.appointments;
BEGIN
  clinic:=public.is_admin() AND public.clinic_access_enabled(); patient:=public.current_patient_id();
  IF NOT clinic AND patient IS NULL THEN RAISE EXCEPTION 'Active clinic or patient access is required.' USING ERRCODE='42501'; END IF;
  IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Asia/Manila')::date
    OR p_interval IS NULL OR p_interval NOT BETWEEN 1 AND 1440
    OR p_lead_minutes IS NULL OR p_lead_minutes NOT BETWEEN 0 AND 1440
    OR (p_time IS NOT NULL AND p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
    RAISE EXCEPTION 'Choose valid scheduling parameters.' USING ERRCODE='22023';
  END IF;
  IF p_exclude_appointment_id IS NOT NULL THEN
    SELECT * INTO excluded FROM public.appointments WHERE appointment_id=p_exclude_appointment_id
      AND doctor_id=p_doctor_id AND service_id=p_service_id AND (clinic OR patient_id=patient);
    IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable for this schedule.' USING ERRCODE='42501'; END IF;
  END IF;
  IF excluded.appointment_id IS NOT NULL THEN duration:=excluded.scheduled_duration_minutes;
  ELSE SELECT duration_minutes INTO duration FROM public.services WHERE service_id=p_service_id AND (status='active' OR clinic);
  END IF;
  IF duration IS NULL OR duration NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'The service duration is unavailable. Contact the clinic.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE doctor_id=p_doctor_id AND status='active') THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.doctor_services WHERE doctor_id=p_doctor_id AND service_id=p_service_id AND status='active') THEN RETURN; END IF;
  RETURN QUERY WITH starts AS (
    SELECT DISTINCT p_date::timestamp+(minute_number::text||' minutes')::interval AS wall_time
    FROM public.doctor_availability da CROSS JOIN LATERAL generate_series(
      ceil(extract(epoch FROM da.start_time)/60)::integer,
      floor(extract(epoch FROM da.end_time)/60-duration)::integer,p_interval) minute_number
    WHERE da.doctor_id=p_doctor_id AND da.available_date=p_date AND da.is_available=true
  )
  SELECT to_char(wall_time,'HH24:MI') FROM starts
  WHERE (p_time IS NULL OR to_char(wall_time,'HH24:MI')=p_time)
    AND (wall_time AT TIME ZONE 'Asia/Manila')>=now()+make_interval(mins=>CASE WHEN NOT clinic AND excluded.appointment_id IS NOT NULL THEN greatest(p_lead_minutes,duration) ELSE p_lead_minutes END)
    AND NOT EXISTS(SELECT 1 FROM public.appointments a
      WHERE a.doctor_id=p_doctor_id AND a.status IN ('pending','confirmed')
        AND (p_exclude_appointment_id IS NULL OR a.appointment_id<>p_exclude_appointment_id)
        AND a.appointment_datetime<(wall_time AT TIME ZONE 'Asia/Manila')+make_interval(mins=>duration)
        AND a.appointment_end>(wall_time AT TIME ZONE 'Asia/Manila'))
  ORDER BY 1;
END
$function$;
REVOKE ALL ON FUNCTION public.get_booking_time_slots(bigint,bigint,date,integer,integer,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_time_slots(bigint,bigint,date,integer,integer,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.book_patient_appointment(p_doctor_id bigint,p_service_id bigint,p_datetime timestamptz,p_notes text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE patient bigint; duration integer; result bigint; clinic_date date;
BEGIN
  patient:=public.current_patient_id();
  IF patient IS NULL THEN RAISE EXCEPTION 'Log in as an active patient to book an appointment.' USING ERRCODE='42501'; END IF;
  IF length(coalesce(p_notes,''))>4000 THEN RAISE EXCEPTION 'Booking notes must be at most 4000 characters.' USING ERRCODE='22023'; END IF;
  IF p_datetime IS NULL OR NOT isfinite(p_datetime) OR date_trunc('minute',p_datetime)<>p_datetime THEN
    RAISE EXCEPTION 'Choose a valid appointment time.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fifthcusp.patient-limit'),hashtext(patient::text));
  IF (SELECT count(*) FROM public.appointments WHERE patient_id=patient AND status IN ('pending','confirmed'))>=3 THEN
    RAISE EXCEPTION 'Only 3 active appointments allowed. Cancel or finish one first.' USING ERRCODE='22023';
  END IF;
  SELECT duration_minutes INTO duration FROM public.services WHERE service_id=p_service_id AND status='active' FOR SHARE;
  clinic_date:=(p_datetime AT TIME ZONE 'Asia/Manila')::date;
  IF NOT EXISTS(SELECT 1 FROM public.get_booking_time_slots(p_doctor_id,p_service_id,clinic_date,30,duration,NULL,to_char(p_datetime AT TIME ZONE 'Asia/Manila','HH24:MI')) slots
    WHERE slots.time_slot=to_char(p_datetime AT TIME ZONE 'Asia/Manila','HH24:MI')) THEN
    RAISE EXCEPTION 'Time slot is no longer available. Choose another time.' USING ERRCODE='22023';
  END IF;
  -- The exclusion constraint arbitrates concurrent writes, including clinic writes.
  INSERT INTO public.appointments(patient_id,doctor_id,service_id,appointment_datetime,status,remarks)
    VALUES(patient,p_doctor_id,p_service_id,p_datetime,'pending',CASE WHEN nullif(btrim(p_notes),'') IS NOT NULL
      THEN '[Booking note by Patient]: '||btrim(p_notes) ELSE NULL END) RETURNING appointment_id INTO result;
  RETURN result;
END
$function$;
REVOKE ALL ON FUNCTION public.book_patient_appointment(bigint,bigint,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.book_patient_appointment(bigint,bigint,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_patient_appointment(p_appointment_id bigint,p_action text,p_reason text,p_target timestamptz DEFAULT NULL,p_expected jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE patient bigint; original public.appointments; duration integer; note text; label text; reason text;
BEGIN
  patient:=public.current_patient_id();
  IF patient IS NULL THEN RAISE EXCEPTION 'Active patient access is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO original FROM public.appointments WHERE appointment_id=p_appointment_id AND patient_id=patient FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable or access was denied.' USING ERRCODE='42501'; END IF;
  IF p_expected IS NULL OR NOT (p_expected ?& ARRAY['appointment_datetime','request_new_datetime'])
    OR (p_expected-'appointment_datetime'-'request_new_datetime') IS DISTINCT FROM jsonb_build_object(
      'patient_id',original.patient_id,'doctor_id',original.doctor_id,'service_id',original.service_id,'status',original.status,
      'remarks',original.remarks,'request_type',original.request_type,'request_status',original.request_status)
    OR (p_expected->>'appointment_datetime')::timestamptz IS DISTINCT FROM original.appointment_datetime
    OR (p_expected->>'request_new_datetime')::timestamptz IS DISTINCT FROM original.request_new_datetime THEN
    RAISE EXCEPTION 'The appointment changed. Refresh before retrying; your changes have not been saved.' USING ERRCODE='40001';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('reschedule','cancel','request_reschedule','request_cancel')
    OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN
    RAISE EXCEPTION 'Choose a valid action and provide a reason of at most 2000 characters.' USING ERRCODE='22023';
  END IF;
  reason:=regexp_replace(btrim(p_reason),E'[\r\n]+',' ','g');
  IF p_action IN ('reschedule','cancel') THEN
    IF original.status<>'pending' OR original.created_at IS NULL OR original.created_at>now()
      OR now()>original.created_at+interval '1 hour' OR original.appointment_datetime<=now() THEN
      RAISE EXCEPTION 'This pending appointment is no longer eligible for direct changes.' USING ERRCODE='22023';
    END IF;
  ELSE
    IF original.status<>'confirmed' OR original.request_status='pending' OR original.appointment_datetime<now()+interval '24 hours' THEN
      RAISE EXCEPTION 'This appointment is no longer eligible for a new request.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_action IN ('reschedule','request_reschedule') THEN
    IF p_target IS NULL OR NOT isfinite(p_target) OR date_trunc('minute',p_target)<>p_target THEN
      RAISE EXCEPTION 'Choose a valid appointment time.' USING ERRCODE='22023';
    END IF;
    duration:=original.scheduled_duration_minutes;
    IF NOT EXISTS(SELECT 1 FROM public.get_booking_time_slots(original.doctor_id,original.service_id,
      (p_target AT TIME ZONE 'Asia/Manila')::date,1,duration,original.appointment_id,to_char(p_target AT TIME ZONE 'Asia/Manila','HH24:MI')) slots
      WHERE slots.time_slot=to_char(p_target AT TIME ZONE 'Asia/Manila','HH24:MI')) THEN
      RAISE EXCEPTION 'The requested time is no longer available or the service does not fit.' USING ERRCODE='22023';
    END IF;
  ELSIF p_target IS NOT NULL THEN RAISE EXCEPTION 'This action does not accept a new time.' USING ERRCODE='22023';
  END IF;
  label:=to_char(now() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI');
  note:=CASE p_action
    WHEN 'reschedule' THEN '[Rescheduled by Patient - '||label||']: Changed from '||to_char(original.appointment_datetime AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')||' to '||to_char(p_target AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')||' - Reason: '||reason
    WHEN 'cancel' THEN '[Cancelled by Patient - '||label||']: '||reason
    WHEN 'request_reschedule' THEN '[Reschedule Request - '||label||']: Requested new time: '||to_char(p_target AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')||'. Reason: '||reason
    ELSE '[Cancellation Request - '||label||']: Reason: '||reason END;
  UPDATE public.appointments SET
    appointment_datetime=CASE WHEN p_action='reschedule' THEN p_target ELSE appointment_datetime END,
    status=CASE WHEN p_action='cancel' THEN 'cancelled'::public.appointment_status ELSE status END,
    request_type=CASE WHEN p_action='request_reschedule' THEN 'reschedule' WHEN p_action='request_cancel' THEN 'cancellation' ELSE request_type END,
    request_status=CASE WHEN p_action IN ('request_reschedule','request_cancel') THEN 'pending' ELSE request_status END,
    request_new_datetime=CASE WHEN p_action='request_reschedule' THEN p_target WHEN p_action='request_cancel' THEN NULL ELSE request_new_datetime END,
    remarks=concat_ws(E'\n\n',nullif(remarks,''),note),updated_at=now()
  WHERE appointment_id=original.appointment_id;
  RETURN original.appointment_id;
END
$function$;
REVOKE ALL ON FUNCTION public.manage_patient_appointment(bigint,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_patient_appointment(bigint,text,text,timestamptz,jsonb) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT conname,contype FROM pg_constraint WHERE conrelid='public.appointments'::regclass
  AND conname IN ('appointments_active_timing_check','appointments_no_doctor_overlap');
