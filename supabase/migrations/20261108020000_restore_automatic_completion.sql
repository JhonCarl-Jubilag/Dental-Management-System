-- Undo the manual-completion workflow after 20261108010000.
-- Forward rollback: preserve all appointment/treatment/billing rows and notes.
-- Keep the unused completion_confirmed_at column so historical confirmations are not lost.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.appointments,public.billing,public.treatment_records IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER IF EXISTS guard_clinical_completion ON public.appointments;
DROP FUNCTION IF EXISTS public.complete_clinic_appointment(bigint,boolean,jsonb);
DROP FUNCTION IF EXISTS public.guard_clinical_completion();

CREATE OR REPLACE FUNCTION public.patient_treatment_options(p_patient_id bigint,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Choose a valid patient and page.'; END IF;
 WITH eligible AS (
  SELECT a.appointment_id,a.patient_id,a.appointment_datetime,a.appointment_end,a.doctor_id,a.service_id,b.billing_id,
   s.service_name,concat_ws(' ',d.first_name,d.last_name) AS doctor_name,
   b.total_amount-b.discount AS amount_charged,b.amount_paid,b.total_amount-b.discount-b.amount_paid AS balance
  FROM public.appointments a JOIN public.billing b ON b.appointment_id=a.appointment_id
   JOIN public.services s ON s.service_id=a.service_id JOIN public.doctors d ON d.doctor_id=a.doctor_id
  WHERE a.patient_id=p_patient_id AND a.status IN ('confirmed','completed') AND a.appointment_end<=now()
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
 IF a.status NOT IN ('confirmed','completed') OR a.appointment_end IS NULL OR a.appointment_end>now()
  OR p_treated_at<a.appointment_datetime THEN
  RAISE EXCEPTION 'Choose a finished confirmed/completed appointment and a valid treatment time.' USING ERRCODE='22023';
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
SELECT to_regprocedure('public.complete_clinic_appointment(bigint,boolean,jsonb)') IS NULL AS manual_completion_removed,
 NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.appointments'::regclass AND tgname='guard_clinical_completion') AS automatic_completion_unblocked,
 position('completion_confirmed_at' IN pg_get_functiondef('public.patient_treatment_options(bigint,integer)'::regprocedure))=0 AS original_treatment_eligibility_restored;
