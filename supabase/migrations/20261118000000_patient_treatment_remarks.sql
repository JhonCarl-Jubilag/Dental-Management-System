-- Separate patient-facing remarks from private clinical notes. No notes are copied.
-- Additive: older deployed clients keep their original read/save functions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.treatment_records ADD COLUMN IF NOT EXISTS patient_remarks text NOT NULL DEFAULT '' CHECK(length(patient_remarks)<=3000);
COMMENT ON COLUMN public.treatment_records.patient_remarks IS 'Patient-visible explanation or aftercare; internal clinical notes remain in notes.';
CREATE OR REPLACE FUNCTION public.save_patient_treatment_with_remarks(
 p_patient_id bigint,p_appointment_id bigint,p_treatment_id bigint,p_expected_version integer,p_request_id uuid,
 p_procedure_name text,p_tooth_scope text,p_tooth_numbers smallint[],p_treated_at timestamptz,p_notes text,p_confirm_performed boolean,p_patient_remarks text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a public.appointments%ROWTYPE; b public.billing%ROWTYPE; original public.treatment_records%ROWTYPE; saved bigint; teeth smallint[];
BEGIN
 IF public.is_admin() IS DISTINCT FROM true THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_appointment_id IS NULL OR p_procedure_name IS NULL OR length(btrim(p_procedure_name)) NOT BETWEEN 1 AND 250
  OR p_patient_remarks IS NULL OR length(p_patient_remarks)>3000 OR p_notes IS NULL OR length(p_notes)>10000 OR NOT public.valid_treatment_teeth(p_tooth_scope,p_tooth_numbers)
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
   treated_at=p_treated_at,notes=btrim(p_notes),patient_remarks=btrim(p_patient_remarks),version=version+1,updated_at=clock_timestamp(),
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
   AND original.treated_at=p_treated_at AND original.notes=btrim(p_notes) AND original.patient_remarks=btrim(p_patient_remarks) THEN RETURN original.treatment_id; END IF;
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
 INSERT INTO public.treatment_records(patient_id,appointment_id,doctor_id,service_id,billing_id,procedure_name,tooth_scope,tooth_numbers,treated_at,notes,patient_remarks,client_request_id)
 VALUES(a.patient_id,a.appointment_id,a.doctor_id,a.service_id,b.billing_id,btrim(p_procedure_name),p_tooth_scope,teeth,p_treated_at,btrim(p_notes),btrim(p_patient_remarks),p_request_id)
 RETURNING treatment_id INTO saved;
 RETURN saved;
END
$fn$;
CREATE OR REPLACE FUNCTION public.list_patient_treatments(p_patient_id bigint,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Clinic access required.' USING ERRCODE='42501'; END IF;
 IF p_patient_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Choose a valid patient and page.'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM public.treatment_records WHERE patient_id=p_patient_id),'page',p_page,'page_size',10,'rows',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.treated_at DESC,r.treatment_id DESC),'[]'::jsonb)) INTO result
 FROM (SELECT t.treatment_id,t.patient_id,t.appointment_id,t.billing_id,t.doctor_id,t.service_id,t.procedure_name,t.tooth_scope,t.tooth_numbers,t.treated_at,t.notes,t.patient_remarks,t.version,t.created_at,t.updated_at,
  concat_ws(' ',d.first_name,d.last_name) AS doctor_name,
  b.total_amount-b.discount AS amount_charged,b.amount_paid,(b.total_amount-b.discount)-b.amount_paid AS balance,b.archived AS bill_archived
  FROM public.treatment_records t JOIN public.billing b ON b.billing_id=t.billing_id JOIN public.doctors d ON d.doctor_id=t.doctor_id
  WHERE t.patient_id=p_patient_id ORDER BY t.treated_at DESC,t.treatment_id DESC LIMIT 10 OFFSET (p_page-1)*10) r;
 RETURN result;
END
$fn$;
CREATE OR REPLACE FUNCTION public.list_my_treatment_history_with_remarks(
 p_page integer DEFAULT 1,p_from date DEFAULT NULL,p_to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='15s' AS $fn$
DECLARE patient bigint; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
     AND (u.banned_until IS NULL OR u.banned_until<=now())
     AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true'
     AND u.raw_app_meta_data->>'fifthcusp_legacy_doctor_id' IS NULL
 ) THEN RAISE EXCEPTION 'Please log in with an active patient account.' USING ERRCODE='42501'; END IF;
 patient:=public.current_patient_id();
 IF patient IS NULL THEN RAISE EXCEPTION 'Please log in with an active patient account.' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR (p_from IS NOT NULL AND NOT isfinite(p_from))
   OR (p_to IS NOT NULL AND NOT isfinite(p_to)) OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN
   RAISE EXCEPTION 'Choose a valid page and date range.' USING ERRCODE='22023';
 END IF;
 WITH filtered AS (
   SELECT t.treatment_id,t.procedure_name,t.tooth_scope,t.tooth_numbers,t.treated_at,t.doctor_id,t.patient_remarks
   FROM public.treatment_records t WHERE t.patient_id=patient
     AND (p_from IS NULL OR t.treated_at>=(p_from::timestamp AT TIME ZONE 'Asia/Manila'))
     AND (p_to IS NULL OR t.treated_at<((p_to+1)::timestamp AT TIME ZONE 'Asia/Manila'))
 ), paged AS (
   SELECT f.treatment_id,f.procedure_name,f.tooth_scope,f.tooth_numbers,f.treated_at,f.patient_remarks,
     coalesce(nullif(btrim(concat_ws(' ',d.first_name,d.last_name)),''),'Not recorded') AS doctor_name
   FROM filtered f LEFT JOIN public.doctors d ON d.doctor_id=f.doctor_id
   ORDER BY f.treated_at DESC,f.treatment_id DESC LIMIT 10 OFFSET (p_page-1)*10
 )
 SELECT jsonb_build_object('patient_id',patient,'page',p_page,'page_size',10,'total',(SELECT count(*) FROM filtered),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.treated_at DESC,p.treatment_id DESC) FROM paged p),'[]'::jsonb)) INTO result;
 RETURN result;
END
$fn$;
CREATE OR REPLACE FUNCTION public.list_my_appointment_treatments_with_remarks(p_appointment_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='15s' AS $fn$
DECLARE patient bigint; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
     AND (u.banned_until IS NULL OR u.banned_until<=now())
     AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true'
     AND u.raw_app_meta_data->>'fifthcusp_legacy_doctor_id' IS NULL
 ) THEN RAISE EXCEPTION 'Please log in with an active patient account.' USING ERRCODE='42501'; END IF;
 patient:=public.current_patient_id();
 IF patient IS NULL THEN RAISE EXCEPTION 'Please log in with an active patient account.' USING ERRCODE='42501'; END IF;

 IF p_appointment_ids IS NULL OR cardinality(p_appointment_ids) NOT BETWEEN 1 AND 5
   OR array_ndims(p_appointment_ids)<>1 OR EXISTS(SELECT 1 FROM unnest(p_appointment_ids) id WHERE id IS NULL OR id<=0) THEN
   RAISE EXCEPTION 'Choose up to five appointments.' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object('patient_id',patient,'rows',coalesce(jsonb_agg(jsonb_build_object(
   'appointment_id',t.appointment_id,'treatment_id',t.treatment_id,'procedure_name',t.procedure_name,
   'patient_remarks',t.patient_remarks,'tooth_scope',t.tooth_scope,'tooth_numbers',t.tooth_numbers,'treated_at',t.treated_at,
   'doctor_name',coalesce(nullif(btrim(concat_ws(' ',d.first_name,d.last_name)),''),'Not recorded')
 ) ORDER BY t.appointment_id),'[]'::jsonb)) INTO result
 FROM public.treatment_records t
 JOIN public.appointments a ON a.appointment_id=t.appointment_id AND a.patient_id=patient
 LEFT JOIN public.doctors d ON d.doctor_id=t.doctor_id
 WHERE t.patient_id=patient AND t.appointment_id=ANY(p_appointment_ids) AND a.status::text IN ('completed','done');
 RETURN result;
END
$fn$;
CREATE OR REPLACE FUNCTION public.record_billing_treatment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  actor_kind text := public.current_clinic_role();
  actor_id uuid := auth.uid();
  display_name text;
  record_key bigint;
  event_resource text;
  event_action text;
  changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF actor_kind IS NULL OR actor_kind NOT IN ('admin', 'super_admin') THEN
    RETURN NULL;
  END IF;

  IF TG_RELID = 'public.billing'::regclass THEN
    event_resource := 'billing';
    record_key := NEW.billing_id;
    IF TG_OP = 'INSERT' THEN
      event_action := 'billing_created';
      IF NEW.amount_paid > 0 THEN changed_fields := ARRAY['initial_payment']; END IF;
    ELSE
      changed_fields := array_remove(ARRAY[
        CASE WHEN NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN 'charges' END,
        CASE WHEN NEW.discount IS DISTINCT FROM OLD.discount THEN 'discount' END,
        CASE WHEN NEW.discount_id_no IS DISTINCT FROM OLD.discount_id_no THEN 'discount_reference' END,
        CASE WHEN NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN 'amount_paid' END,
        CASE WHEN NEW.balance IS DISTINCT FROM OLD.balance THEN 'balance' END,
        CASE WHEN NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN 'payment_method' END,
        CASE WHEN NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN 'payment_reference' END,
        CASE WHEN NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN 'payment_date' END,
        CASE WHEN NEW.remarks IS DISTINCT FROM OLD.remarks THEN 'billing_remarks' END,
        CASE WHEN coalesce(NEW.archived, false) <> coalesce(OLD.archived, false) THEN 'archive_status' END,
        CASE WHEN ROW(NEW.appointment_id, NEW.patient_id, NEW.doctor_id)
          IS DISTINCT FROM ROW(OLD.appointment_id, OLD.patient_id, OLD.doctor_id) THEN 'record_link' END
      ], NULL);
      event_action := CASE
        WHEN coalesce(NEW.archived, false) AND NOT coalesce(OLD.archived, false) THEN 'billing_archived'
        WHEN NOT coalesce(NEW.archived, false) AND coalesce(OLD.archived, false) THEN 'billing_restored'
        WHEN NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
          AND NOT (changed_fields && ARRAY['charges', 'discount', 'record_link'])
          THEN CASE WHEN coalesce(NEW.amount_paid, 0) > coalesce(OLD.amount_paid, 0)
            THEN 'billing_payment_increased' ELSE 'billing_payment_adjusted' END
        ELSE 'billing_updated'
      END;
    END IF;
  ELSIF TG_RELID = 'public.treatment_records'::regclass THEN
    event_resource := 'treatment';
    record_key := NEW.treatment_id;
    IF TG_OP = 'INSERT' THEN
      event_action := 'treatment_created';
    ELSE
      event_action := 'treatment_updated';
      changed_fields := array_remove(ARRAY[
        CASE WHEN NEW.procedure_name IS DISTINCT FROM OLD.procedure_name THEN 'procedure' END,
        CASE WHEN ROW(NEW.tooth_scope, NEW.tooth_numbers)
          IS DISTINCT FROM ROW(OLD.tooth_scope, OLD.tooth_numbers) THEN 'tooth_selection' END,
        CASE WHEN NEW.treated_at IS DISTINCT FROM OLD.treated_at THEN 'treatment_time' END,
        CASE WHEN NEW.notes IS DISTINCT FROM OLD.notes THEN 'treatment_notes' END,
        CASE WHEN NEW.patient_remarks IS DISTINCT FROM OLD.patient_remarks THEN 'patient_remarks' END,
        CASE WHEN ROW(NEW.patient_id, NEW.appointment_id, NEW.doctor_id, NEW.service_id, NEW.billing_id)
          IS DISTINCT FROM ROW(OLD.patient_id, OLD.appointment_id, OLD.doctor_id, OLD.service_id, OLD.billing_id) THEN 'record_link' END
      ], NULL);
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  -- Store names of changed fields only. Clinical text, payment values and
  -- payment/discount references remain in their original records.
  IF TG_OP = 'UPDATE' AND cardinality(changed_fields) = 0 THEN RETURN NULL; END IF;
  SELECT nullif(btrim(concat_ws(' ', first_name, last_name)), '') INTO display_name
    FROM public.admin WHERE auth_user_id = actor_id;

  INSERT INTO public.clinic_activity_log (actor_auth_user_id, actor_name, actor_role, resource_type, record_id, action, changes)
  VALUES (
    actor_id, coalesce(display_name, CASE WHEN actor_kind = 'super_admin' THEN 'Owner' ELSE 'Staff' END),
    actor_kind, event_resource, record_key, event_action,
    jsonb_strip_nulls(jsonb_build_object('appointment_id', NEW.appointment_id, 'fields', changed_fields))
  );
  RETURN NULL;
END
$fn$;
DO $update_backup$
BEGIN
 IF to_regprocedure('clinic_backup_private.registry()') IS NOT NULL THEN
  EXECUTE $registry$CREATE OR REPLACE FUNCTION clinic_backup_private.registry()
RETURNS TABLE(sort_order integer, table_name text, pk text, columns text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
  SELECT * FROM (VALUES
    (1,'services','service_id',ARRAY['service_id','service_name','description','price','status','duration_minutes']::text[]),
    (2,'doctors','doctor_id',ARRAY['doctor_id','first_name','last_name','email','contact_no','date_created','status','availability']::text[]),
    (3,'patients','patient_id',ARRAY['patient_id','first_name','last_name','email','address','contact_no','birthday','date_created','status','age','email_verified','auth_user_id']::text[]),
    (4,'inventory','item_id',ARRAY['item_id','item_name','category','stock_quantity','reorder_level','unit_type','last_updated','unit_cost','selling_price','location','status']::text[]),
    (5,'doctor_services','doctor_service_id',ARRAY['doctor_service_id','doctor_id','service_id','status']::text[]),
    (6,'doctor_availability','availability_id',ARRAY['availability_id','doctor_id','available_date','start_time','end_time','is_available']::text[]),
    (7,'service_requirements','requirement_id',ARRAY['requirement_id','service_id','item_id','quantity_required']::text[]),
    (8,'appointments','appointment_id',ARRAY['appointment_id','patient_id','doctor_id','service_id','appointment_datetime','status','remarks','created_at','updated_at','request_type','request_new_datetime','request_status','scheduled_duration_minutes','appointment_end','completion_confirmed_at']::text[]),
    (9,'billing','billing_id',ARRAY['billing_id','appointment_id','patient_id','doctor_id','total_amount','discount','amount_paid','balance','payment_date','payment_method','remarks','created_at','discount_id_no','archived','reference_number']::text[]),
    (10,'treatment_records','treatment_id',ARRAY['treatment_id','patient_id','appointment_id','doctor_id','service_id','billing_id','procedure_name','tooth_scope','tooth_numbers','treated_at','notes','patient_remarks','client_request_id','version','created_at','updated_at','revisions']::text[]),
    (11,'staff_time_records','record_id',ARRAY['record_id','staff_admin_id','staff_auth_user_id','time_in','time_out','entry_source','clock_in_request_id','clock_out_request_id','created_by','version','created_at','updated_at']::text[]),
    (12,'staff_time_corrections','correction_id',ARRAY['correction_id','record_id','action','old_time_in','old_time_out','new_time_in','new_time_out','reason','corrected_by','corrected_at','version_after','request_id']::text[])
  ) r(sort_order,table_name,pk,columns)
$fn$;

$registry$;
 END IF;
END
$update_backup$;
REVOKE ALL ON FUNCTION public.save_patient_treatment_with_remarks(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean,text),public.list_my_treatment_history_with_remarks(integer,date,date),public.list_my_appointment_treatments_with_remarks(bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_patient_treatment_with_remarks(bigint,bigint,bigint,integer,uuid,text,text,smallint[],timestamptz,text,boolean,text),public.list_my_treatment_history_with_remarks(integer,date,date),public.list_my_appointment_treatments_with_remarks(bigint[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
