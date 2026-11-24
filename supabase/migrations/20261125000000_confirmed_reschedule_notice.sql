-- Enforce the same 24-hour cutoff for clinic rescheduling and request approvals.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_confirmed_reschedule_notice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.status = 'confirmed'
    AND NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime
    AND (OLD.appointment_datetime IS NULL OR NOT isfinite(OLD.appointment_datetime)
      OR OLD.appointment_datetime < statement_timestamp() + interval '24 hours') THEN
    RAISE EXCEPTION 'Confirmed appointments cannot be rescheduled with less than 24 hours remaining.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS appointments_confirmed_reschedule_notice ON public.appointments;
CREATE TRIGGER appointments_confirmed_reschedule_notice
BEFORE UPDATE OF appointment_datetime ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.guard_confirmed_reschedule_notice();

COMMIT;
