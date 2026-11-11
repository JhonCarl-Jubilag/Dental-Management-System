-- Patient treatment records. Apply in SQL Editor after backing up the database.
-- Existing appointment notes, payments and clinical history are not backfilled.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.appointments,public.billing IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF to_regprocedure('public.current_patient_id()') IS NULL OR to_regprocedure('public.staff_access_ready()') IS NULL THEN
    RAISE EXCEPTION 'Install the clinic access and patient isolation updates first.';
  END IF;
  IF NOT public.staff_access_ready() OR NOT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='appointment_end') THEN
    RAISE EXCEPTION 'Install the clinic access and appointment timing updates first.';
  END IF;
  IF EXISTS(SELECT appointment_id FROM public.billing WHERE appointment_id IS NOT NULL GROUP BY appointment_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'More than one bill exists for an appointment. Review duplicate bills before applying; no records were changed.';
  END IF;
END
$preflight$;

-- The Billing UI already expects one bill per appointment; enforce this under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS billing_one_bill_per_appointment ON public.billing(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.valid_treatment_teeth(p_scope text,p_teeth smallint[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(p_scope IN ('specific','whole_mouth','not_applicable') AND p_teeth IS NOT NULL
  AND array_position(p_teeth,NULL) IS NULL
  AND CASE WHEN p_scope='specific' THEN cardinality(p_teeth) BETWEEN 1 AND 52
    AND NOT EXISTS(SELECT 1 FROM unnest(p_teeth) t WHERE NOT
      ((t/10 BETWEEN 1 AND 4 AND t%10 BETWEEN 1 AND 8) OR (t/10 BETWEEN 5 AND 8 AND t%10 BETWEEN 1 AND 5)))
    AND cardinality(p_teeth)=(SELECT count(DISTINCT t) FROM unnest(p_teeth) t)
   ELSE cardinality(p_teeth)=0 END,false)
$fn$;

CREATE OR REPLACE FUNCTION public.valid_treatment_bill(p_total numeric,p_discount numeric,p_paid numeric,p_balance numeric)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(p_total BETWEEN 0 AND 999999999999.99 AND p_discount BETWEEN 0 AND p_total
  AND p_paid BETWEEN 0 AND p_total-p_discount AND p_balance=p_total-p_discount-p_paid
  AND p_total=round(p_total,2) AND p_discount=round(p_discount,2)
  AND p_paid=round(p_paid,2) AND p_balance=round(p_balance,2),false)
$fn$;

CREATE TABLE IF NOT EXISTS public.treatment_records (
 treatment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 patient_id bigint NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
 appointment_id bigint NOT NULL UNIQUE REFERENCES public.appointments(appointment_id) ON DELETE RESTRICT,
 doctor_id bigint NOT NULL REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
 service_id bigint NOT NULL REFERENCES public.services(service_id) ON DELETE RESTRICT,
 billing_id bigint NOT NULL UNIQUE REFERENCES public.billing(billing_id) ON DELETE RESTRICT,
 procedure_name text NOT NULL CHECK(length(btrim(procedure_name)) BETWEEN 1 AND 250),
 tooth_scope text NOT NULL,
 tooth_numbers smallint[] NOT NULL DEFAULT '{}',
 treated_at timestamptz NOT NULL CHECK(isfinite(treated_at)),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=10000),
 client_request_id uuid NOT NULL UNIQUE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(revisions)='array'),
 CONSTRAINT treatment_records_teeth_check CHECK(public.valid_treatment_teeth(tooth_scope,tooth_numbers))
);
CREATE INDEX IF NOT EXISTS treatment_records_patient_date ON public.treatment_records(patient_id,treated_at DESC,treatment_id DESC);
ALTER TABLE public.treatment_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.treatment_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.treatment_records TO authenticated;
REVOKE ALL ON SEQUENCE public.treatment_records_treatment_id_seq FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS "Clinic treatment reading" ON public.treatment_records;
CREATE POLICY "Clinic treatment reading" ON public.treatment_records FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- A saved clinical record cannot be silently reassigned through Billing or scheduling.
CREATE OR REPLACE FUNCTION public.guard_treatment_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF TG_TABLE_NAME='billing' THEN
  IF EXISTS(SELECT 1 FROM public.treatment_records t WHERE t.billing_id=OLD.billing_id) AND
    (NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NOT public.valid_treatment_bill(NEW.total_amount,NEW.discount,NEW.amount_paid,NEW.balance)) THEN
   RAISE EXCEPTION 'This bill is linked to a treatment record. Keep its patient/appointment and valid payment totals.' USING ERRCODE='23514';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.treatment_records t WHERE t.appointment_id=OLD.appointment_id) AND
    (NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id OR NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime
     OR NEW.appointment_end IS DISTINCT FROM OLD.appointment_end OR NEW.scheduled_duration_minutes IS DISTINCT FROM OLD.scheduled_duration_minutes
     OR NEW.status NOT IN ('confirmed','completed')) THEN
   RAISE EXCEPTION 'This appointment has a treatment record. Its patient, dentist, service and schedule cannot be reassigned or cancelled.' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.guard_treatment_references() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS treatment_billing_link_guard ON public.billing;
CREATE TRIGGER treatment_billing_link_guard BEFORE UPDATE ON public.billing FOR EACH ROW EXECUTE FUNCTION public.guard_treatment_references();
DROP TRIGGER IF EXISTS treatment_appointment_link_guard ON public.appointments;
CREATE TRIGGER treatment_appointment_link_guard BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.guard_treatment_references();

CREATE OR REPLACE FUNCTION public.list_patient_treatments(p_patient_id bigint,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Choose a valid patient and page.'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM public.treatment_records WHERE patient_id=p_patient_id),'page',p_page,'page_size',10,'rows',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.treated_at DESC,r.treatment_id DESC),'[]'::jsonb)) INTO result
 FROM (SELECT t.treatment_id,t.patient_id,t.appointment_id,t.billing_id,t.doctor_id,t.service_id,t.procedure_name,t.tooth_scope,t.tooth_numbers,t.treated_at,t.notes,t.version,t.created_at,t.updated_at,
  concat_ws(' ',d.first_name,d.last_name) AS doctor_name,
  b.total_amount-b.discount AS amount_charged,b.amount_paid,(b.total_amount-b.discount)-b.amount_paid AS balance,b.archived AS bill_archived
  FROM public.treatment_records t JOIN public.billing b ON b.billing_id=t.billing_id JOIN public.doctors d ON d.doctor_id=t.doctor_id
  WHERE t.patient_id=p_patient_id ORDER BY t.treated_at DESC,t.treatment_id DESC LIMIT 10 OFFSET (p_page-1)*10) r;
 RETURN result;
END
$fn$;

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

REVOKE ALL ON FUNCTION public.valid_treatment_teeth(text,smallint[]),public.valid_treatment_bill(numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_patient_treatments(bigint,integer),public.patient_treatment_options(bigint,integer),public.save_patient_treatment(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_patient_treatments(bigint,integer),public.patient_treatment_options(bigint,integer),public.save_patient_treatment(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean) TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
SELECT to_regclass('public.treatment_records') IS NOT NULL AS treatment_records_ready,
 (SELECT count(*) FROM public.treatment_records) AS treatment_records;
