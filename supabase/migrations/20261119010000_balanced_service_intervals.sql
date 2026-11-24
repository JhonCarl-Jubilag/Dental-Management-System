-- Balanced intervals: whole-hour services => 60 minutes; 90-minute services => 30.
-- Myofunctional Therapy becomes a 60-minute service for new appointments.
-- This replaces the previous interval implementation and can be installed
-- whether or not 20261119000000_service_booking_intervals.sql was applied.
-- No appointment times, reserved durations, bills or treatment records are edited.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $service_duration$
DECLARE changed integer;
BEGIN
  UPDATE public.services SET duration_minutes=60
  WHERE lower(btrim(service_name))='myofunctional therapy'
    AND duration_minutes IN (45,60);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'Expected exactly one Myofunctional Therapy service with a 45- or 60-minute duration. Review its catalogue entry before retrying.';
  END IF;
END
$service_duration$;

CREATE OR REPLACE FUNCTION public.get_booking_time_slots(
  p_doctor_id bigint,p_service_id bigint,p_date date,p_interval integer DEFAULT 30,
  p_lead_minutes integer DEFAULT 0,p_exclude_appointment_id bigint DEFAULT NULL,p_time text DEFAULT NULL)
RETURNS TABLE(time_slot text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE patient bigint; clinic boolean; duration integer; slot_interval integer; excluded public.appointments;
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
  -- Keep the interval parameter for older callers, but derive the rule here
  -- so patient, clinic, month queries and final save validation all agree.
  slot_interval:=CASE WHEN mod(duration,60)=0 THEN 60 ELSE 30 END;
  RETURN QUERY WITH starts AS (
    SELECT DISTINCT p_date::timestamp+(minute_number::text||' minutes')::interval AS wall_time
    FROM public.doctor_availability da CROSS JOIN LATERAL generate_series(
      ceil(extract(epoch FROM da.start_time)/60)::integer,
      floor(extract(epoch FROM da.end_time)/60-duration)::integer,slot_interval) minute_number
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
      AND ((da.available_date+da.end_time) AT TIME ZONE 'Asia/Manila')>=NEW.appointment_end
      -- Match the slot generator's rounded-up period start, including direct
      -- clinic inserts. Existing rows are checked only when reserving a new time.
      AND mod(extract(epoch FROM (
        NEW.appointment_datetime - ((da.available_date::timestamp + make_interval(mins=>ceil(extract(epoch FROM da.start_time)/60)::integer)) AT TIME ZONE 'Asia/Manila')
      )), (60 * CASE WHEN mod(NEW.scheduled_duration_minutes,60)=0 THEN 60 ELSE 30 END)::numeric)=0
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an available starting time that fits the full treatment. Refresh the schedule.' USING ERRCODE='22023'; END IF;
  END IF;
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
    AND (NEW.appointment_end IS NULL OR NEW.appointment_end>now()) THEN
    RAISE EXCEPTION 'The full booked treatment duration must elapse before completion.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_appointment_reservation() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
