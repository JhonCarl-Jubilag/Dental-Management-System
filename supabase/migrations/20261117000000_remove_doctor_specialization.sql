-- Deploy the matching frontend, then run this entire file in SQL Editor.
-- Permanently removes dentist specialization values. No dentist/service links are removed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.save_provider_profile(p_actor uuid,p_doctor_id bigint,p_profile jsonb,p_service_ids bigint[],p_expected jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE existing record; provider_id bigint; ids bigint[]; previous_ids bigint[]; previous_email text; email_value text; state jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin a JOIN auth.users u ON u.id=a.auth_user_id
    WHERE a.auth_user_id=p_actor AND a.status='active' AND a.role IN ('super_admin','admin') AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now()) AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.auth_user_id=p_actor)) THEN
    RAISE EXCEPTION 'Active clinic access is required.' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fifthcusp.provider-management'));
  state:=public.provider_cutover_state();
  IF NOT (state->>'ready')::boolean THEN RAISE EXCEPTION 'The Owner must retire legacy dentist logins before editing provider records.' USING ERRCODE='42501'; END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile)<>'object' OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile) k WHERE k NOT IN ('first_name','last_name','email','contact_no','status')) THEN
    RAISE EXCEPTION 'Unsupported provider fields.' USING ERRCODE='22023';
  END IF;
  IF coalesce(jsonb_typeof(p_profile->'first_name'),'null')<>'string' OR
    coalesce(jsonb_typeof(p_profile->'last_name'),'null')<>'string' OR coalesce(jsonb_typeof(p_profile->'email'),'null')<>'string' OR
    coalesce(jsonb_typeof(p_profile->'contact_no'),'null') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Provider names and contact details must be text.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_profile->>'first_name',''))) NOT BETWEEN 1 AND 200 OR
    length(btrim(coalesce(p_profile->>'last_name',''))) NOT BETWEEN 1 AND 200 OR
    length(coalesce(p_profile->>'contact_no',''))>50 OR
    coalesce(p_profile->>'status','') NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'Invalid provider details.' USING ERRCODE='22023';
  END IF;
  email_value:=lower(btrim(p_profile->>'email'));
  IF email_value IS NULL OR length(email_value)>254 OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid dentist contact email.' USING ERRCODE='22023';
  END IF;
  IF p_service_ids IS NULL OR cardinality(p_service_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_service_ids) x WHERE x IS NULL OR x<=0) THEN
    RAISE EXCEPTION 'Select valid dental services.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}'::bigint[]) INTO ids FROM unnest(p_service_ids) x;
  IF p_doctor_id IS NOT NULL THEN
    SELECT first_name,last_name,email,contact_no,status INTO existing FROM public.doctors WHERE doctor_id=p_doctor_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dentist not found.' USING ERRCODE='P0002'; END IF;
    previous_email:=existing.email;
    SELECT coalesce(array_agg(service_id ORDER BY service_id),'{}'::bigint[]) INTO previous_ids FROM public.doctor_services WHERE doctor_id=p_doctor_id AND status='active';
    IF p_expected IS NULL OR p_expected->'profile' IS DISTINCT FROM jsonb_build_object(
      'first_name',existing.first_name,'last_name',existing.last_name,'email',existing.email,
      'contact_no',existing.contact_no,'status',existing.status)
      OR p_expected->'service_ids' IS DISTINCT FROM to_jsonb(previous_ids) THEN
      RAISE EXCEPTION 'Dentist details changed elsewhere. Refresh before editing again.' USING ERRCODE='40001';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.doctors WHERE lower(btrim(email))=email_value AND (p_doctor_id IS NULL OR doctor_id<>p_doctor_id)) OR
    EXISTS(SELECT 1 FROM public.admin WHERE lower(btrim(email))=email_value) OR
    EXISTS(SELECT 1 FROM public.patients WHERE lower(btrim(email))=email_value) THEN
    RAISE EXCEPTION 'This contact email is already assigned to another profile.' USING ERRCODE='23505';
  END IF;
  IF (p_doctor_id IS NULL OR lower(btrim(previous_email))<>email_value) AND EXISTS(SELECT 1 FROM auth.users u
    WHERE lower(btrim(u.email))=email_value AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true') THEN
    RAISE EXCEPTION 'This contact email already belongs to an Auth identity. Use another email or ask the Owner to review it.' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ids) selected WHERE NOT EXISTS(SELECT 1 FROM public.services s WHERE s.service_id=selected AND
    (s.status='active' OR (p_doctor_id IS NOT NULL AND selected=ANY(previous_ids))))) THEN
    RAISE EXCEPTION 'One or more selected services are unavailable.' USING ERRCODE='22023';
  END IF;
  IF p_doctor_id IS NULL THEN
    INSERT INTO public.doctors(first_name,last_name,email,contact_no,status)
      VALUES(btrim(p_profile->>'first_name'),btrim(p_profile->>'last_name'),email_value,
        nullif(btrim(p_profile->>'contact_no'),''),coalesce(p_profile->>'status','active')::public.user_status)
      RETURNING doctor_id INTO provider_id;
  ELSE
    provider_id:=p_doctor_id;
    UPDATE public.doctors SET first_name=btrim(p_profile->>'first_name'),last_name=btrim(p_profile->>'last_name'),email=email_value,
      contact_no=nullif(btrim(p_profile->>'contact_no'),''),status=coalesce(p_profile->>'status','active')::public.user_status
      WHERE doctor_id=provider_id;
  END IF;
  UPDATE public.doctor_services SET status='inactive' WHERE doctor_id=provider_id AND NOT(service_id=ANY(ids));
  UPDATE public.doctor_services SET status='active' WHERE doctor_id=provider_id AND service_id=ANY(ids);
  INSERT INTO public.doctor_services(doctor_id,service_id,status)
    SELECT provider_id,x,'active' FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM public.doctor_services ds WHERE ds.doctor_id=provider_id AND ds.service_id=x);
  RETURN provider_id;
END
$function$;
REVOKE ALL ON FUNCTION public.save_provider_profile(uuid,bigint,jsonb,bigint[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_provider_profile(uuid,bigint,jsonb,bigint[],jsonb) TO service_role;

-- Backup tools are optional; refresh their allowlist only when installed.
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
    (10,'treatment_records','treatment_id',ARRAY['treatment_id','patient_id','appointment_id','doctor_id','service_id','billing_id','procedure_name','tooth_scope','tooth_numbers','treated_at','notes','client_request_id','version','created_at','updated_at','revisions']::text[]),
    (11,'staff_time_records','record_id',ARRAY['record_id','staff_admin_id','staff_auth_user_id','time_in','time_out','entry_source','clock_in_request_id','clock_out_request_id','created_by','version','created_at','updated_at']::text[]),
    (12,'staff_time_corrections','correction_id',ARRAY['correction_id','record_id','action','old_time_in','old_time_out','new_time_in','new_time_out','reason','corrected_by','corrected_at','version_after','request_id']::text[])
  ) r(sort_order,table_name,pk,columns)
$fn$;

$registry$;
 END IF;
END
$update_backup$;
-- RESTRICT deliberately stops the transaction if an unreviewed view depends on it.
ALTER TABLE public.doctors DROP COLUMN IF EXISTS specialization RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
