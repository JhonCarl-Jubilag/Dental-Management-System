-- Manual clinical completion. Back up first; deploy matching frontend before applying.
-- Requires 20261108000000_patient_treatment_records.sql. Existing statuses/records are preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.appointments,public.billing,public.treatment_records IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
 IF to_regprocedure('public.save_patient_treatment(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamp with time zone,text,boolean)') IS NULL
  OR to_regprocedure('public.guard_appointment_reservation()') IS NULL THEN
  RAISE EXCEPTION 'Install the appointment timing and Treatment Records updates first.';
 END IF;
END
$preflight$;

-- NULL distinguishes older, possibly automatic completions. No fabricated clinical confirmation.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS completion_confirmed_at timestamptz;

-- Intentionally SECURITY INVOKER: a browser UPDATE runs as authenticated, whereas
-- the explicitly authorized SECURITY DEFINER completion RPC runs as its trusted owner.
CREATE OR REPLACE FUNCTION public.guard_clinical_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE completion_write boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  completion_write:=NEW.status='completed' OR NEW.completion_confirmed_at IS NOT NULL;
 ELSE
  completion_write:=NEW.completion_confirmed_at IS DISTINCT FROM OLD.completion_confirmed_at
   OR (NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status);
  IF OLD.completion_confirmed_at IS NOT NULL AND (
   NEW.completion_confirmed_at IS DISTINCT FROM OLD.completion_confirmed_at
   OR NEW.status IS DISTINCT FROM OLD.status OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
   OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.service_id IS DISTINCT FROM OLD.service_id
   OR NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime
   OR NEW.appointment_end IS DISTINCT FROM OLD.appointment_end
   OR NEW.scheduled_duration_minutes IS DISTINCT FROM OLD.scheduled_duration_minutes) THEN
   RAISE EXCEPTION 'A clinically completed appointment cannot be reassigned, rescheduled or reopened.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF completion_write THEN
  IF current_user IN ('anon','authenticated','authenticator') THEN
   RAISE EXCEPTION 'Use Mark Completed and confirm the procedure was performed.' USING ERRCODE='42501';
  END IF;
  IF NEW.status IS DISTINCT FROM 'completed' OR NEW.completion_confirmed_at IS NULL
   OR NOT isfinite(NEW.completion_confirmed_at) OR NEW.completion_confirmed_at>clock_timestamp()
   OR NEW.appointment_end IS NULL OR NOT isfinite(NEW.appointment_end) OR NEW.appointment_end>now()
   OR NEW.scheduled_duration_minutes IS NULL OR NEW.scheduled_duration_minutes NOT BETWEEN 1 AND 1440
   OR NEW.appointment_datetime IS NULL OR NOT isfinite(NEW.appointment_datetime)
   OR NEW.appointment_end<>NEW.appointment_datetime+make_interval(mins=>NEW.scheduled_duration_minutes) THEN
   RAISE EXCEPTION 'Completion needs Staff confirmation and the full booked duration must have elapsed.' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.guard_clinical_completion() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_clinical_completion ON public.appointments;
CREATE TRIGGER guard_clinical_completion BEFORE INSERT OR UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_completion();

CREATE OR REPLACE FUNCTION public.complete_clinic_appointment(p_appointment_id bigint,p_confirm_performed boolean,p_expected jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.appointments%ROWTYPE; snapshot jsonb; confirmed_at timestamptz;
 fields text[]:=ARRAY['patient_id','doctor_id','service_id','status','appointment_datetime','remarks','request_type','request_new_datetime','request_status'];
BEGIN
 IF NOT public.is_admin() OR NOT public.clinic_access_enabled() THEN
  RAISE EXCEPTION 'Active Owner or Staff access is required.' USING ERRCODE='42501';
 END IF;
 IF p_confirm_performed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Confirm that the dental procedure was actually performed.' USING ERRCODE='22023';
 END IF;
 IF p_appointment_id IS NULL OR p_expected IS NULL OR jsonb_typeof(p_expected)<>'object' OR NOT p_expected ?& fields THEN
  RAISE EXCEPTION 'Reload the appointment before confirming completion.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO a FROM public.appointments WHERE appointment_id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Appointment is unavailable.' USING ERRCODE='42501'; END IF;
 SELECT jsonb_object_agg(f,to_jsonb(a)->f) INTO snapshot FROM unnest(fields) f;
 -- Compare timestamps as instants: PostgREST/JavaScript may serialize UTC differently.
 IF (snapshot-ARRAY['appointment_datetime','request_new_datetime']) IS DISTINCT FROM (p_expected-ARRAY['appointment_datetime','request_new_datetime'])
  OR a.appointment_datetime IS DISTINCT FROM (p_expected->>'appointment_datetime')::timestamptz
  OR a.request_new_datetime IS DISTINCT FROM (p_expected->>'request_new_datetime')::timestamptz THEN
  RAISE EXCEPTION 'The appointment changed. Refresh and review it before confirming completion.' USING ERRCODE='40001';
 END IF;
 IF a.status IS DISTINCT FROM 'confirmed' AND a.status IS DISTINCT FROM 'completed' THEN
  RAISE EXCEPTION 'Only a confirmed appointment or an older completed appointment can be verified.' USING ERRCODE='22023';
 END IF;
 IF a.completion_confirmed_at IS NOT NULL THEN RETURN a.appointment_id; END IF;
 IF a.appointment_end IS NULL OR NOT isfinite(a.appointment_end) OR a.appointment_end>now()
  OR a.scheduled_duration_minutes IS NULL OR a.scheduled_duration_minutes NOT BETWEEN 1 AND 1440
  OR a.appointment_datetime IS NULL OR NOT isfinite(a.appointment_datetime)
  OR a.appointment_end<>a.appointment_datetime+make_interval(mins=>a.scheduled_duration_minutes) THEN
  RAISE EXCEPTION 'The full booked treatment duration must elapse before completion.' USING ERRCODE='22023';
 END IF;
 confirmed_at:=clock_timestamp();
 UPDATE public.appointments SET status='completed',completion_confirmed_at=confirmed_at,updated_at=confirmed_at,
  remarks=concat_ws(E'\n\n',nullif(a.remarks,''),'[Clinic completion '||to_char(confirmed_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')||' Philippines]: Staff confirmed the dental procedure was performed.')
 WHERE appointment_id=a.appointment_id;
 RETURN a.appointment_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.complete_clinic_appointment(bigint,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_clinic_appointment(bigint,boolean,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.patient_treatment_options(p_patient_id bigint,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Choose a valid patient and page.'; END IF;
 WITH eligible AS (
  SELECT a.appointment_id,a.patient_id,a.appointment_datetime,a.appointment_end,a.status,a.completion_confirmed_at,a.doctor_id,a.service_id,b.billing_id,
   s.service_name,concat_ws(' ',d.first_name,d.last_name) AS doctor_name,
   b.total_amount-b.discount AS amount_charged,b.amount_paid,b.total_amount-b.discount-b.amount_paid AS balance
  FROM public.appointments a JOIN public.billing b ON b.appointment_id=a.appointment_id
   JOIN public.services s ON s.service_id=a.service_id JOIN public.doctors d ON d.doctor_id=a.doctor_id
  WHERE a.patient_id=p_patient_id AND a.status='completed' AND a.completion_confirmed_at IS NOT NULL AND a.appointment_end<=now()
   AND b.patient_id=a.patient_id AND b.doctor_id=a.doctor_id
   AND public.valid_treatment_bill(b.total_amount,b.discount,b.amount_paid,b.balance)
   AND NOT EXISTS(SELECT 1 FROM public.treatment_records t WHERE t.appointment_id=a.appointment_id)
 ), paged AS (SELECT * FROM eligible ORDER BY appointment_datetime DESC,appointment_id DESC LIMIT 10 OFFSET (p_page-1)*10)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM eligible),'page',p_page,'page_size',10,'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.appointment_datetime DESC,p.appointment_id DESC) FROM paged p),'[]'::jsonb)) INTO result;
 RETURN result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.save_patient_treatment(
 p_patient_id bigint,p_appointment_id bigint,p_treatment_id bigint,p_expected_version integer,p_request_id uuid,
 p_procedure_name text,p_tooth_scope text,p_tooth_numbers smallint[],p_treated_at timestamptz,p_notes text,p_confirm_performed boolean)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.appointments%ROWTYPE; b public.billing%ROWTYPE; original public.treatment_records%ROWTYPE; saved bigint; teeth smallint[];
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_appointment_id IS NULL OR p_procedure_name IS NULL OR length(btrim(p_procedure_name)) NOT BETWEEN 1 AND 250
  OR p_notes IS NULL OR length(p_notes)>10000 OR NOT public.valid_treatment_teeth(p_tooth_scope,p_tooth_numbers)
  OR p_treated_at IS NULL OR NOT isfinite(p_treated_at) OR p_treated_at>now() THEN
  RAISE EXCEPTION 'Enter a valid procedure, tooth selection, treatment time and notes.' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg(t ORDER BY t),'{}'::smallint[]) INTO teeth FROM unnest(p_tooth_numbers) t;
 IF p_treatment_id IS NOT NULL THEN
  SELECT * INTO original FROM public.treatment_records WHERE treatment_id=p_treatment_id AND patient_id=p_patient_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Treatment record is unavailable.' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS DISTINCT FROM original.version OR p_appointment_id<>original.appointment_id THEN
   RAISE EXCEPTION 'Treatment record changed. Close this form, refresh and review the latest record before retrying.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE appointment_id=original.appointment_id;
  IF p_treated_at<a.appointment_datetime THEN RAISE EXCEPTION 'Treatment time cannot precede the appointment.' USING ERRCODE='22023'; END IF;
  UPDATE public.treatment_records SET procedure_name=btrim(p_procedure_name),tooth_scope=p_tooth_scope,tooth_numbers=teeth,
   treated_at=p_treated_at,notes=btrim(p_notes),version=version+1,updated_at=clock_timestamp(),
   revisions=revisions||jsonb_build_array(to_jsonb(original)-'revisions')
   WHERE treatment_id=original.treatment_id RETURNING treatment_id INTO saved;
  RETURN saved;
 END IF;
 IF p_request_id IS NULL OR p_expected_version IS NOT NULL OR p_confirm_performed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Confirm the treatment was performed before saving.' USING ERRCODE='22023';
 END IF;
 -- Match the lock order used by appointment/billing writes; recheck after waiting.
 SELECT * INTO a FROM public.appointments WHERE appointment_id=p_appointment_id AND patient_id=p_patient_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This appointment does not belong to the selected patient.' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM public.treatment_records WHERE client_request_id=p_request_id OR appointment_id=p_appointment_id;
 IF FOUND THEN
  IF original.client_request_id=p_request_id AND original.patient_id=p_patient_id AND original.appointment_id=p_appointment_id
   AND original.procedure_name=btrim(p_procedure_name) AND original.tooth_scope=p_tooth_scope AND original.tooth_numbers=teeth
   AND original.treated_at=p_treated_at AND original.notes=btrim(p_notes) THEN RETURN original.treatment_id; END IF;
  RAISE EXCEPTION 'A treatment record already exists for this appointment or request. Refresh the patient records.' USING ERRCODE='23505';
 END IF;
 IF a.status IS DISTINCT FROM 'completed' OR a.completion_confirmed_at IS NULL OR a.appointment_end IS NULL OR a.appointment_end>now()
  OR p_treated_at<a.appointment_datetime THEN
  RAISE EXCEPTION 'Staff must confirm appointment completion in Manage Appointments before adding a treatment record.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO b FROM public.billing WHERE appointment_id=a.appointment_id FOR UPDATE;
 IF NOT FOUND OR b.patient_id IS DISTINCT FROM a.patient_id OR b.doctor_id IS DISTINCT FROM a.doctor_id
  OR NOT public.valid_treatment_bill(b.total_amount,b.discount,b.amount_paid,b.balance) THEN
  RAISE EXCEPTION 'Create or correct this appointment bill in Billing before adding its treatment record.' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.treatment_records(patient_id,appointment_id,doctor_id,service_id,billing_id,procedure_name,tooth_scope,tooth_numbers,treated_at,notes,client_request_id)
 VALUES(a.patient_id,a.appointment_id,a.doctor_id,a.service_id,b.billing_id,btrim(p_procedure_name),p_tooth_scope,teeth,p_treated_at,btrim(p_notes),p_request_id)
 RETURNING treatment_id INTO saved;
 RETURN saved;
END
$fn$;


REVOKE ALL ON FUNCTION public.patient_treatment_options(bigint,integer),public.save_patient_treatment(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_treatment_options(bigint,integer),public.save_patient_treatment(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT to_regprocedure('public.complete_clinic_appointment(bigint,boolean,jsonb)') IS NOT NULL AS manual_completion_ready;
