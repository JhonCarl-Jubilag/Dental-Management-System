-- Phase 1: stable Owner/Staff/Patient identity. Take a fresh backup first.
-- Apply this additive migration BEFORE deploying the updated Edge Functions and frontend.
-- Existing doctor logins remain temporarily available until their workflows are transferred.
-- This is not the final patient/appointment RLS hardening or doctor-login retirement.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.admin, public.patients IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.admin ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.admin ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS auth_user_id uuid;

DO $mapping$
BEGIN
  IF EXISTS (
    SELECT profile_kind, lower(btrim(email)) FROM (
      SELECT 'clinic' AS profile_kind,email FROM public.admin
      UNION ALL SELECT 'patient',email FROM public.patients
      UNION ALL SELECT 'provider',email FROM public.doctors
    ) profiles GROUP BY profile_kind,lower(btrim(email)) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Case-insensitive duplicate profile emails; review accounts before migrating.'; END IF;
  -- Do not guess when a profile email matches more than one Auth account.
  IF EXISTS (
    SELECT p.email FROM (SELECT email FROM public.admin UNION ALL SELECT email FROM public.patients) p
    JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(p.email))
    GROUP BY p.email HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Ambiguous account emails; review mappings before migrating.'; END IF;
  IF EXISTS (SELECT 1 FROM public.admin a JOIN public.patients p
    ON lower(btrim(a.email)) = lower(btrim(p.email))) THEN
    RAISE EXCEPTION 'An email belongs to both clinic and patient profiles; resolve it first.';
  END IF;

  UPDATE public.admin a SET auth_user_id = u.id FROM auth.users u
    WHERE a.auth_user_id IS NULL AND lower(btrim(a.email)) = lower(btrim(u.email));
  UPDATE public.patients p SET auth_user_id = u.id FROM auth.users u
    WHERE p.auth_user_id IS NULL AND lower(btrim(p.email)) = lower(btrim(u.email));
  IF EXISTS (SELECT 1 FROM public.admin WHERE auth_user_id IS NULL) THEN
    RAISE EXCEPTION 'A clinic profile has no Auth account; review it before migrating.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin a JOIN public.patients p USING (auth_user_id)) THEN
    RAISE EXCEPTION 'An Auth account is linked to multiple primary roles.';
  END IF;

  -- One-time bootstrap from the already reviewed owner profile. Runtime access
  -- uses this protected role and UUID; it does not depend on an email constant.
  IF NOT EXISTS (SELECT 1 FROM public.admin WHERE role = 'super_admin') THEN
    IF (SELECT count(*) FROM public.admin a JOIN auth.users u ON u.id = a.auth_user_id
      WHERE lower(btrim(a.email)) = 'jhoncarl.jubilag@cvsu.edu.ph'
      AND a.status = 'active' AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())) <> 1 THEN
      RAISE EXCEPTION 'The reviewed, verified owner could not be uniquely identified.';
    END IF;
    UPDATE public.admin SET role = 'super_admin'
      WHERE lower(btrim(email)) = 'jhoncarl.jubilag@cvsu.edu.ph';
  END IF;
  IF (SELECT count(*) FROM public.admin a JOIN auth.users u ON u.id = a.auth_user_id
    WHERE a.role = 'super_admin' AND a.status = 'active' AND u.email_confirmed_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now())) <> 1 THEN
    RAISE EXCEPTION 'Exactly one active, verified Owner is required.';
  END IF;
  IF (SELECT count(*) FROM public.admin WHERE role = 'admin') > 1 THEN
    RAISE EXCEPTION 'Only one Staff profile is supported; review existing clinic profiles.';
  END IF;
END
$mapping$;

ALTER TABLE public.admin ALTER COLUMN role SET NOT NULL;
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.admin'::regclass AND conname = 'admin_clinic_role_check') THEN
    ALTER TABLE public.admin ADD CONSTRAINT admin_clinic_role_check CHECK (role IN ('super_admin','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.admin'::regclass AND conname = 'admin_auth_user_id_fkey') THEN
    ALTER TABLE public.admin ADD CONSTRAINT admin_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.patients'::regclass AND conname = 'patients_auth_user_id_fkey') THEN
    ALTER TABLE public.patients ADD CONSTRAINT patients_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS admin_auth_user_id_key ON public.admin(auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS patients_auth_user_id_key ON public.patients(auth_user_id);
-- Includes inactive profiles: replace/relink the single staff profile rather
-- than creating parallel staff identities. Owner and Staff are distinct slots.
CREATE UNIQUE INDEX IF NOT EXISTS admin_one_profile_per_role ON public.admin(role);

CREATE OR REPLACE FUNCTION public.current_clinic_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
  SELECT a.role FROM public.admin a JOIN auth.users u ON u.id = a.auth_user_id
  WHERE a.auth_user_id = auth.uid() AND a.status = 'active'
    AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.auth_user_id=a.auth_user_id)
$function$;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$ SELECT coalesce(public.current_clinic_role() IN ('super_admin','admin'), false) $function$;
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$ SELECT coalesce(public.current_clinic_role() = 'super_admin', false) $function$;

-- Client accounts can read only their own clinic profile (Owner can review
-- both). All clinic identity/role mutations must use an authorized backend.
ALTER TABLE public.admin ENABLE ROW LEVEL SECURITY;
DO $admin_policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin' LOOP
    EXECUTE format('DROP POLICY %I ON public.admin', p.policyname);
  END LOOP;
END
$admin_policies$;
CREATE POLICY "Clinic profile access" ON public.admin FOR SELECT TO authenticated
  USING (auth_user_id = (SELECT auth.uid()) OR (SELECT public.is_super_admin()));

REVOKE ALL ON TABLE public.admin FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON TABLE public.patients FROM PUBLIC, anon, authenticated;
DO $identity_privileges$
DECLARE columns_sql text; profile_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns_sql
    FROM pg_attribute WHERE attrelid = 'public.admin'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.admin FROM PUBLIC, anon, authenticated', columns_sql);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum),
    string_agg(quote_ident(attname), ', ' ORDER BY attnum) FILTER (WHERE attname <> 'auth_user_id')
    INTO columns_sql, profile_columns
    FROM pg_attribute WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%1$s), UPDATE (%1$s) ON public.patients FROM PUBLIC, anon, authenticated', columns_sql);
  -- Keep existing registration/profile flows during this additive phase, but
  -- never allow a browser to choose or replace a patient's Auth UUID.
  EXECUTE format('GRANT INSERT (%1$s), UPDATE (%1$s) ON public.patients TO anon, authenticated', profile_columns);
END
$identity_privileges$;
GRANT SELECT ON public.admin TO authenticated;

CREATE OR REPLACE FUNCTION public.get_account_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE identity_row record; clinic_row public.admin; patient_row public.patients; doctor_row public.doctors;
BEGIN
  SELECT id,email,email_confirmed_at,banned_until INTO identity_row FROM auth.users WHERE id=auth.uid();
  IF NOT FOUND OR identity_row.email_confirmed_at IS NULL OR
    (identity_row.banned_until IS NOT NULL AND identity_row.banned_until > now()) THEN
    RAISE EXCEPTION 'Verify your email and log in before accessing your account.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO clinic_row FROM public.admin WHERE auth_user_id=identity_row.id;
  SELECT * INTO patient_row FROM public.patients WHERE auth_user_id=identity_row.id;
  IF clinic_row.admin_id IS NOT NULL AND patient_row.patient_id IS NOT NULL THEN
    RAISE EXCEPTION 'Your account has conflicting role assignments. Contact the clinic.' USING ERRCODE='42501';
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
  -- Temporary compatibility only; not a new primary role or a provider login
  -- requirement. Remove this branch when provider workflows are transferred.
  SELECT * INTO doctor_row FROM public.doctors WHERE lower(btrim(email))=lower(btrim(identity_row.email));
  IF doctor_row.doctor_id IS NOT NULL THEN
    IF doctor_row.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'This dentist account is inactive. Contact the clinic.' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('role','doctor','profile',jsonb_build_object(
      'doctor_id',doctor_row.doctor_id,'first_name',doctor_row.first_name,'last_name',doctor_row.last_name,
      'email',doctor_row.email,'specialization',doctor_row.specialization,'contact_no',doctor_row.contact_no,
      'date_created',doctor_row.date_created,'status',doctor_row.status,'availability',doctor_row.availability));
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.current_clinic_role(), public.is_admin(), public.is_super_admin(), public.get_account_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_clinic_role(), public.is_admin(), public.is_super_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_profile() TO authenticated;

DO $verify$
DECLARE caller text;
BEGIN
  FOREACH caller IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(caller,'public.admin','DELETE,TRUNCATE,TRIGGER') OR
      has_any_column_privilege(caller,'public.admin','INSERT,UPDATE,REFERENCES') OR
      has_column_privilege(caller,'public.patients','auth_user_id','INSERT') OR
      has_column_privilege(caller,'public.patients','auth_user_id','UPDATE') THEN
      RAISE EXCEPTION 'Browser clients retain protected identity-write privileges; changes rolled back.';
    END IF;
  END LOOP;
END
$verify$;
COMMIT;

-- Aggregate metadata only; no Auth identifiers or patient details are returned.
SELECT role, count(*) AS clinic_profiles, count(auth_user_id) AS linked_profiles FROM public.admin GROUP BY role;
