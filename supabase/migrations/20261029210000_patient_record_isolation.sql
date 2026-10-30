-- Patient isolation. Back up and deploy the matching frontend before applying.
-- Does not reserve slots atomically across concurrent patients/clinic bookings.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.provider_cutover_state()') IS NULL
    OR NOT (public.provider_cutover_state()->>'ready')::boolean THEN
    RAISE EXCEPTION 'Finish the provider-only migration and reviewed dentist-login retirement first.';
  END IF;
  IF NOT public.staff_access_ready() THEN RAISE EXCEPTION 'Staff access prerequisites are missing.'; END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.current_patient_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT p.patient_id FROM public.patients p
  WHERE p.auth_user_id=auth.uid() AND p.status='active'
    AND public.clinic_access_enabled()
    AND NOT EXISTS(SELECT 1 FROM public.admin a WHERE a.auth_user_id=p.auth_user_id)
$function$;
REVOKE ALL ON FUNCTION public.current_patient_id() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_patient_id() TO authenticated;

-- Permissive policies combine with OR. Replace every old permissive branch on
-- these private tables; adding one narrower policy would not close the leaks.
DO $private_policies$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients','appointments','billing','inventory','service_requirements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t AND permissive='PERMISSIVE' LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon',t);
  END LOOP;
END
$private_policies$;

CREATE POLICY "Clinic patient reading" ON public.patients FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Clinic patient editing" ON public.patients FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Patient own profile reading" ON public.patients FOR SELECT TO authenticated USING (patient_id=(SELECT public.current_patient_id()));
CREATE POLICY "Patient own profile editing" ON public.patients FOR UPDATE TO authenticated
  USING (patient_id=(SELECT public.current_patient_id())) WITH CHECK (patient_id=(SELECT public.current_patient_id()));

CREATE POLICY "Clinic operations" ON public.appointments FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Patient own appointment reading" ON public.appointments FOR SELECT TO authenticated USING (patient_id=(SELECT public.current_patient_id()));
CREATE POLICY "Clinic operations" ON public.billing FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Patient own bill reading" ON public.billing FOR SELECT TO authenticated
  USING (patient_id=(SELECT public.current_patient_id()) AND (appointment_id IS NULL OR EXISTS(
    SELECT 1 FROM public.appointments a WHERE a.appointment_id=billing.appointment_id AND a.patient_id=(SELECT public.current_patient_id())
  )));
CREATE POLICY "Clinic operations" ON public.inventory FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Clinic operations" ON public.service_requirements FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Browser registration now uses Auth registration metadata. Only the verified
-- recovery endpoint / clinic backend may insert or link patient profiles.
REVOKE ALL ON public.patients FROM authenticated;
DO $private_columns$
DECLARE t text; columns_sql text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients','appointments','billing','inventory','service_requirements'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO columns_sql FROM pg_attribute
      WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%1$s),INSERT (%1$s),UPDATE (%1$s),REFERENCES (%1$s) ON public.%2$I FROM PUBLIC,anon',columns_sql,t);
    IF t='patients' THEN
      EXECUTE format('REVOKE SELECT (%1$s),INSERT (%1$s),UPDATE (%1$s),REFERENCES (%1$s) ON public.patients FROM authenticated',columns_sql);
    END IF;
  END LOOP;
END
$private_columns$;
GRANT SELECT (patient_id,first_name,last_name,email,address,contact_no,birthday,date_created,status,age,email_verified,auth_user_id) ON public.patients TO authenticated;
GRANT UPDATE (first_name,last_name,address,contact_no,birthday,age,status) ON public.patients TO authenticated;
-- RLS grants the writes to clinic accounts only; patients use the checked RPCs.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.appointments,public.service_requirements TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.billing,public.inventory TO authenticated;
REVOKE DELETE ON public.billing,public.inventory FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS appointments_patient_time_idx ON public.appointments(patient_id,appointment_datetime DESC);
CREATE INDEX IF NOT EXISTS appointments_doctor_time_idx ON public.appointments(doctor_id,appointment_datetime);
CREATE INDEX IF NOT EXISTS billing_patient_idx ON public.billing(patient_id);

-- Availability is calculated inside the database. No appointment identifiers,
-- patient information, clinical notes or busy-record rows leave this function.
CREATE OR REPLACE FUNCTION public.get_booking_time_slots(
  p_doctor_id bigint,p_service_id bigint,p_date date,p_interval integer DEFAULT 30,
  p_lead_minutes integer DEFAULT 0,p_exclude_appointment_id bigint DEFAULT NULL,p_time text DEFAULT NULL)
RETURNS TABLE(time_slot text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE patient bigint; clinic boolean; duration integer; excluded public.appointments;
BEGIN
  clinic:=public.is_admin() AND public.clinic_access_enabled();
  patient:=public.current_patient_id();
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
  SELECT duration_minutes INTO duration FROM public.services WHERE service_id=p_service_id
    AND (status='active' OR clinic OR excluded.appointment_id IS NOT NULL);
  IF duration IS NULL OR duration NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'The service duration is unavailable. Contact the clinic.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE doctor_id=p_doctor_id AND status='active') THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.doctor_services WHERE doctor_id=p_doctor_id AND service_id=p_service_id AND status='active') THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.appointments a LEFT JOIN public.services s USING(service_id)
    WHERE a.doctor_id=p_doctor_id AND a.status IN ('pending','confirmed')
      AND a.appointment_datetime<((p_date+1)::timestamp AT TIME ZONE 'Asia/Manila')
      AND (p_exclude_appointment_id IS NULL OR a.appointment_id<>p_exclude_appointment_id)
      AND (s.duration_minutes IS NULL OR s.duration_minutes<=0)) THEN
    RAISE EXCEPTION 'An existing appointment has missing timing information. Contact the clinic.' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    WITH starts AS (
      SELECT DISTINCT p_date::timestamp+(minute_number::text||' minutes')::interval AS wall_time
      FROM public.doctor_availability da CROSS JOIN LATERAL generate_series(
        ceil(extract(epoch FROM da.start_time)/60)::integer,
        floor(extract(epoch FROM da.end_time)/60-duration)::integer,p_interval) minute_number
      WHERE da.doctor_id=p_doctor_id AND da.available_date=p_date AND da.is_available=true
    )
    SELECT to_char(wall_time,'HH24:MI') FROM starts
    WHERE (p_time IS NULL OR to_char(wall_time,'HH24:MI')=p_time)
      AND (wall_time AT TIME ZONE 'Asia/Manila')>=now()+make_interval(mins=>p_lead_minutes)
      AND NOT EXISTS(SELECT 1 FROM public.appointments a JOIN public.services s USING(service_id)
        WHERE a.doctor_id=p_doctor_id AND a.status IN ('pending','confirmed')
          AND (p_exclude_appointment_id IS NULL OR a.appointment_id<>p_exclude_appointment_id)
          AND a.appointment_datetime<(wall_time AT TIME ZONE 'Asia/Manila')+make_interval(mins=>duration)
          AND a.appointment_datetime+make_interval(mins=>s.duration_minutes)>(wall_time AT TIME ZONE 'Asia/Manila'))
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
  -- Serialize this patient's limit check; cross-patient slot reservation remains
  -- a separate booking-concurrency phase (clinic writes do not take this lock).
  PERFORM pg_advisory_xact_lock(hashtext('fifthcusp.patient-limit'),hashtext(patient::text));
  IF (SELECT count(*) FROM public.appointments WHERE patient_id=patient AND status IN ('pending','confirmed'))>=3 THEN
    RAISE EXCEPTION 'Only 3 active appointments allowed. Cancel or finish one first.' USING ERRCODE='22023';
  END IF;
  SELECT duration_minutes INTO duration FROM public.services WHERE service_id=p_service_id AND status='active';
  clinic_date:=(p_datetime AT TIME ZONE 'Asia/Manila')::date;
  IF NOT EXISTS(SELECT 1 FROM public.get_booking_time_slots(p_doctor_id,p_service_id,clinic_date,30,duration,NULL,to_char(p_datetime AT TIME ZONE 'Asia/Manila','HH24:MI')) slots
    WHERE slots.time_slot=to_char(p_datetime AT TIME ZONE 'Asia/Manila','HH24:MI')) THEN
    RAISE EXCEPTION 'Time slot is no longer available. Choose another time.' USING ERRCODE='22023';
  END IF;
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
    IF original.status<>'confirmed' OR original.request_status='pending'
      OR original.appointment_datetime<now()+interval '24 hours' THEN
      RAISE EXCEPTION 'This appointment is no longer eligible for a new request.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_action IN ('reschedule','request_reschedule') THEN
    IF p_target IS NULL OR NOT isfinite(p_target) OR date_trunc('minute',p_target)<>p_target THEN
      RAISE EXCEPTION 'Choose a valid appointment time.' USING ERRCODE='22023';
    END IF;
    SELECT duration_minutes INTO duration FROM public.services WHERE service_id=original.service_id;
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

DO $legacy_slots$
BEGIN
  IF to_regprocedure('public.get_available_time_slots(integer,date,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_available_time_slots(integer,date,integer) FROM PUBLIC,anon,authenticated;
  END IF;
END
$legacy_slots$;

-- Aggregate preflight information only. Inconsistent bills are hidden from
-- patients for review, never automatically rewritten or deleted.
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT count(*) AS bills_with_mismatched_patient FROM public.billing b JOIN public.appointments a USING(appointment_id)
WHERE b.patient_id IS DISTINCT FROM a.patient_id;
