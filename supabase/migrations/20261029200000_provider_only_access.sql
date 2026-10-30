-- Final primary roles: Owner, Staff, Patient. Review and back up before applying.
-- Deploy the matching provider-only frontend/Edge Function as a coordinated release.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.staff_access_ready()') IS NULL OR NOT public.staff_access_ready() THEN
    RAISE EXCEPTION 'Install and verify Staff operations access before retiring dentist access.';
  END IF;
  IF EXISTS (SELECT lower(btrim(email)) FROM public.doctors GROUP BY lower(btrim(email)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Resolve case-insensitive duplicate dentist contact emails first.';
  END IF;
  IF EXISTS (SELECT d.doctor_id FROM public.doctors d JOIN auth.users u ON lower(btrim(u.email))=lower(btrim(d.email)) GROUP BY d.doctor_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Ambiguous legacy dentist identities. Review mappings before retiring access.';
  END IF;
END
$preflight$;

-- Freeze the reviewed legacy mapping once. Future registrations/contact-email
-- edits must not turn unrelated Auth users into retirement candidates.
-- This records a server-only migration marker; it does not ban any login.
DO $legacy_mapping$
BEGIN
  IF to_regprocedure('public.provider_cutover_state()') IS NULL THEN
    UPDATE auth.users u SET raw_app_meta_data=coalesce(u.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('fifthcusp_legacy_doctor_id',d.doctor_id)
    FROM public.doctors d WHERE lower(btrim(d.email))=lower(btrim(u.email))
      AND NOT EXISTS(SELECT 1 FROM public.admin a WHERE a.auth_user_id=u.id OR lower(btrim(a.email))=lower(btrim(u.email)))
      AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.auth_user_id=u.id OR lower(btrim(p.email))=lower(btrim(u.email)))
      AND jsonb_typeof(u.raw_user_meta_data->'registration_profile') IS DISTINCT FROM 'object';
  END IF;
END
$legacy_mapping$;

-- Only a verified, active primary profile can use authenticated data access.
-- This also blocks an old dentist JWT before its Auth account is banned.
CREATE OR REPLACE FUNCTION public.clinic_access_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true'
      AND NOT (coalesce(u.raw_app_meta_data,'{}'::jsonb) ? 'fifthcusp_legacy_doctor_id')
      AND (public.is_admin() OR (
        NOT EXISTS(SELECT 1 FROM public.admin a WHERE a.auth_user_id=u.id)
        AND EXISTS(SELECT 1 FROM public.patients p WHERE p.auth_user_id=u.id AND p.status='active')
      ))
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_account_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE identity_row record; clinic_row public.admin; patient_row public.patients;
BEGIN
  SELECT id,email,email_confirmed_at,banned_until,raw_app_meta_data INTO identity_row FROM auth.users WHERE id=auth.uid();
  IF NOT FOUND OR identity_row.email_confirmed_at IS NULL OR
    (identity_row.banned_until IS NOT NULL AND identity_row.banned_until>now()) THEN
    RAISE EXCEPTION 'Verify your email and use an active clinic or patient account.' USING ERRCODE='42501';
  END IF;
  IF coalesce(identity_row.raw_app_meta_data->>'clinic_provider_login_retired','false')='true'
    OR coalesce(identity_row.raw_app_meta_data,'{}'::jsonb) ? 'fifthcusp_legacy_doctor_id' THEN
    RAISE EXCEPTION 'Dentist logins have been retired. Clinic staff manage dentist records.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO clinic_row FROM public.admin WHERE auth_user_id=identity_row.id;
  SELECT * INTO patient_row FROM public.patients WHERE auth_user_id=identity_row.id;
  IF clinic_row.admin_id IS NOT NULL AND patient_row.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting primary account profiles. Contact the Owner.' USING ERRCODE='42501';
  END IF;
  IF clinic_row.admin_id IS NOT NULL THEN
    IF clinic_row.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'This clinic account is inactive. Contact the Owner.' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('role',clinic_row.role,'profile',to_jsonb(clinic_row));
  END IF;
  IF patient_row.patient_id IS NOT NULL THEN
    IF patient_row.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'This patient account is inactive. Contact the clinic.' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('role','patient','profile',jsonb_build_object(
      'patient_id',patient_row.patient_id,'first_name',patient_row.first_name,'last_name',patient_row.last_name,
      'email',patient_row.email,'address',patient_row.address,'contact_no',patient_row.contact_no,'birthday',patient_row.birthday,
      'age',patient_row.age,'status',patient_row.status,'email_verified',true,'date_created',patient_row.date_created));
  END IF;
  IF EXISTS(SELECT 1 FROM public.doctors WHERE lower(btrim(email))=lower(btrim(identity_row.email))) THEN
    RAISE EXCEPTION 'Dentist logins have been retired. Clinic staff manage dentist records.' USING ERRCODE='42501';
  END IF;
  -- Verified patient registration is completed by the existing trusted backend.
  RETURN NULL;
END
$function$;

-- Retire the legacy dentist policy branches. Clinic and patient policies remain.
DROP POLICY IF EXISTS "Appointment visibility" ON public.appointments;
DROP POLICY IF EXISTS "Doctor can update own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Doctor can view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Doctors can read own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admin/Doctor manage availability" ON public.doctor_availability;
DROP POLICY IF EXISTS "Doctor can manage own availability" ON public.doctor_availability;
DROP POLICY IF EXISTS "Doctor full access to own availability" ON public.doctor_availability;
DROP POLICY IF EXISTS "Doctors can manage own availability" ON public.doctor_availability;
DROP POLICY IF EXISTS "Doctors can view own services" ON public.doctor_services;
DROP POLICY IF EXISTS "Doctors can view own record" ON public.doctors;

-- Provider/profile and assignment writes go through one atomic backend RPC.
REVOKE INSERT,UPDATE,DELETE ON public.doctors,public.doctor_services FROM PUBLIC,anon,authenticated;
DO $provider_columns$
DECLARE t text; columns_sql text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doctors','doctor_services'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO columns_sql FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE INSERT (%1$s),UPDATE (%1$s) ON public.%2$I FROM PUBLIC,anon,authenticated',columns_sql,t);
  END LOOP;
END
$provider_columns$;

CREATE OR REPLACE FUNCTION public.provider_cutover_state()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  WITH candidates AS (
    SELECT d.doctor_id,d.first_name,d.last_name,u.id AS auth_user_id,u.email,
      (coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')='true') AS disabled
    FROM public.doctors d JOIN auth.users u ON to_jsonb(d.doctor_id)=u.raw_app_meta_data->'fifthcusp_legacy_doctor_id'
    WHERE NOT EXISTS(SELECT 1 FROM public.admin a WHERE a.auth_user_id=u.id OR lower(btrim(a.email))=lower(btrim(u.email)))
      AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.auth_user_id=u.id OR lower(btrim(p.email))=lower(btrim(u.email)))
  )
  SELECT jsonb_build_object('ready',NOT EXISTS(SELECT 1 FROM candidates WHERE NOT disabled),
    'candidates',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.auth_user_id) FROM candidates c),'[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.provider_cutover_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provider_cutover_state() TO service_role;

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
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile) k WHERE k NOT IN ('first_name','last_name','email','specialization','contact_no','status')) THEN
    RAISE EXCEPTION 'Unsupported provider fields.' USING ERRCODE='22023';
  END IF;
  IF coalesce(jsonb_typeof(p_profile->'first_name'),'null')<>'string' OR
    coalesce(jsonb_typeof(p_profile->'last_name'),'null')<>'string' OR coalesce(jsonb_typeof(p_profile->'email'),'null')<>'string' OR
    coalesce(jsonb_typeof(p_profile->'specialization'),'null') NOT IN ('string','null') OR
    coalesce(jsonb_typeof(p_profile->'contact_no'),'null') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Provider names and contact details must be text.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_profile->>'first_name',''))) NOT BETWEEN 1 AND 200 OR
    length(btrim(coalesce(p_profile->>'last_name',''))) NOT BETWEEN 1 AND 200 OR
    length(coalesce(p_profile->>'specialization',''))>200 OR length(coalesce(p_profile->>'contact_no',''))>50 OR
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
    SELECT first_name,last_name,email,specialization,contact_no,status INTO existing FROM public.doctors WHERE doctor_id=p_doctor_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dentist not found.' USING ERRCODE='P0002'; END IF;
    previous_email:=existing.email;
    SELECT coalesce(array_agg(service_id ORDER BY service_id),'{}'::bigint[]) INTO previous_ids FROM public.doctor_services WHERE doctor_id=p_doctor_id AND status='active';
    IF p_expected IS NULL OR p_expected->'profile' IS DISTINCT FROM jsonb_build_object(
      'first_name',existing.first_name,'last_name',existing.last_name,'email',existing.email,
      'specialization',existing.specialization,'contact_no',existing.contact_no,'status',existing.status)
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
    INSERT INTO public.doctors(first_name,last_name,email,specialization,contact_no,status)
      VALUES(btrim(p_profile->>'first_name'),btrim(p_profile->>'last_name'),email_value,
        nullif(btrim(p_profile->>'specialization'),''),nullif(btrim(p_profile->>'contact_no'),''),coalesce(p_profile->>'status','active')::public.user_status)
      RETURNING doctor_id INTO provider_id;
  ELSE
    provider_id:=p_doctor_id;
    UPDATE public.doctors SET first_name=btrim(p_profile->>'first_name'),last_name=btrim(p_profile->>'last_name'),email=email_value,
      specialization=nullif(btrim(p_profile->>'specialization'),''),contact_no=nullif(btrim(p_profile->>'contact_no'),''),status=coalesce(p_profile->>'status','active')::public.user_status
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
COMMIT;
NOTIFY pgrst,'reload schema';

-- Counts only: actual retirement is reviewed and performed through the Owner UI.
SELECT count(*) AS providers_preserved FROM public.doctors;
