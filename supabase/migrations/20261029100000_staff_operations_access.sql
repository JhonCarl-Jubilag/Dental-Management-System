-- Staff operations stage. Review and take a fresh backup before applying.
-- Apply before deploying manage-staff-account or creating a Staff account.
-- Broader patient booking/profile policy hardening remains a separate stage.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.admin IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF to_regprocedure('public.current_clinic_role()') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='admin' AND indexname='admin_one_profile_per_role') THEN
    RAISE EXCEPTION 'Install the reviewed UUID role-foundation migration first.';
  END IF;
  IF (SELECT count(*) FROM public.admin a JOIN auth.users u ON u.id=a.auth_user_id
      WHERE a.role='super_admin' AND a.status='active' AND u.email_confirmed_at IS NOT NULL
        AND (u.banned_until IS NULL OR u.banned_until<=now())) <> 1 THEN
    RAISE EXCEPTION 'Exactly one active verified Owner is required.';
  END IF;
  IF (SELECT count(*) FROM public.admin WHERE role='admin') > 1 THEN
    RAISE EXCEPTION 'Review duplicate Staff profiles before continuing.';
  END IF;
END
$preflight$;

-- Old JWTs must not retain clinic access after the Staff profile is disabled.
-- Non-clinic users continue through their existing patient/public policies.
CREATE OR REPLACE FUNCTION public.clinic_access_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.admin WHERE auth_user_id=auth.uid()) OR public.is_admin()
$function$;
REVOKE ALL ON FUNCTION public.clinic_access_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_access_enabled() TO authenticated;

DO $clinic_state$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin','patients','doctors','appointments','billing','inventory','services','doctor_services','doctor_availability','service_requirements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS "Clinic access state" ON public.%I',t);
    EXECUTE format('CREATE POLICY "Clinic access state" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.clinic_access_enabled())) WITH CHECK ((SELECT public.clinic_access_enabled()))',t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC,anon,authenticated',t);
  END LOOP;
END
$clinic_state$;

-- Replace the reviewed owner-email expression without deleting the patient or
-- temporary dentist branches in combined legacy policies. Unknown expressions
-- abort rather than guessing how a changed production policy should behave.
DO $owner_policies$
DECLARE p record; q text; c text; statement text;
BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' AND
    (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%jhoncarl.jubilag@cvsu.edu.ph%' LOOP
    q := replace(p.qual, '(auth.jwt() ->> ''email''::text) = ''jhoncarl.jubilag@cvsu.edu.ph''::text', 'public.is_super_admin()');
    c := replace(p.with_check, '(auth.jwt() ->> ''email''::text) = ''jhoncarl.jubilag@cvsu.edu.ph''::text', 'public.is_super_admin()');
    IF (coalesce(q,'')||coalesce(c,'')) LIKE '%jhoncarl.jubilag@cvsu.edu.ph%' THEN
      RAISE EXCEPTION 'Unrecognized owner-email policy %. Review the current schema.',p.policyname;
    END IF;
    statement := format('ALTER POLICY %I ON public.%I',p.policyname,p.tablename);
    IF q IS NOT NULL THEN statement:=statement||format(' USING (%s)',q); END IF;
    IF c IS NOT NULL THEN statement:=statement||format(' WITH CHECK (%s)',c); END IF;
    EXECUTE statement;
  END LOOP;
END
$owner_policies$;

-- Service writes currently include policies permitting every authenticated
-- account. Remove those write paths; public service reading is retained.
DO $service_writes$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='services'
      AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND policyname<>'Clinic access state' LOOP
    EXECUTE format('DROP POLICY %I ON public.services',p.policyname);
  END LOOP;
END
$service_writes$;
DROP POLICY IF EXISTS "Admins can manage all appointments" ON public.appointments;

DO $operations$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doctors','appointments','billing','inventory','services','doctor_services','doctor_availability','service_requirements'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Clinic operations" ON public.%I',t);
    EXECUTE format('CREATE POLICY "Clinic operations" ON public.%I FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))',t);
  END LOOP;
END
$operations$;
DROP POLICY IF EXISTS "Clinic patient reading" ON public.patients;
CREATE POLICY "Clinic patient reading" ON public.patients FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Clinic patient editing" ON public.patients;
CREATE POLICY "Clinic patient editing" ON public.patients FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Login email/verification/identity changes remain backend-only, even when a
-- Staff client sends direct requests instead of using the intended UI.
REVOKE UPDATE ON public.patients,public.doctors FROM PUBLIC,anon,authenticated;
DO $column_permissions$
DECLARE t text; columns_sql text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin','patients','doctors','appointments','billing','inventory','services','doctor_services','doctor_availability','service_requirements'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO columns_sql FROM pg_attribute
      WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE REFERENCES (%s) ON public.%I FROM PUBLIC,anon,authenticated',columns_sql,t);
    IF t IN ('patients','doctors') THEN
      EXECUTE format('REVOKE UPDATE (%s) ON public.%I FROM PUBLIC,anon,authenticated',columns_sql,t);
    END IF;
  END LOOP;
END
$column_permissions$;
GRANT UPDATE (first_name,last_name,address,contact_no,birthday,age,status) ON public.patients TO authenticated;
GRANT UPDATE (first_name,last_name,specialization,contact_no,status,availability) ON public.doctors TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.billing,public.inventory TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.services,public.doctor_services,public.doctor_availability,public.service_requirements,public.appointments TO authenticated;
-- Billing/inventory have archive/status controls, not browser hard deletion.
REVOKE DELETE ON public.billing,public.inventory FROM PUBLIC,anon,authenticated;

-- Patient self-editing keeps demographic fields but cannot self-reactivate.
CREATE OR REPLACE FUNCTION public.guard_patient_profile_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public
AS $function$
BEGIN
  IF current_user='authenticated' AND NOT public.is_admin() AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only clinic staff can change patient status.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_patient_profile_status() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_patient_profile_status ON public.patients;
CREATE TRIGGER guard_patient_profile_status BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.guard_patient_profile_status();

-- Irreversible appointment deletion is reserved for the Owner; existing
-- cancelled-appointment deletion remains available to the Owner only.
DROP POLICY IF EXISTS "Owner appointment deletion" ON public.appointments;
CREATE POLICY "Owner appointment deletion" ON public.appointments AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.is_super_admin()) AND status='cancelled');
DROP POLICY IF EXISTS "Owner provider deletion" ON public.doctors;
CREATE POLICY "Owner provider deletion" ON public.doctors AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.is_super_admin()));

CREATE OR REPLACE FUNCTION public.staff_access_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT count(*)=10 FROM pg_policies WHERE schemaname='public' AND policyname='Clinic access state'
    AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles @> ARRAY['authenticated']::name[]
    AND tablename IN ('admin','patients','doctors','appointments','billing','inventory','services','doctor_services','doctor_availability','service_requirements')
$function$;
REVOKE ALL ON FUNCTION public.staff_access_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_access_ready() TO service_role;

DO $verify$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_column_privilege(r,'public.doctors','password','SELECT') OR has_column_privilege(r,'public.doctors','password','UPDATE') OR
       has_column_privilege(r,'public.patients','auth_user_id','UPDATE') OR has_column_privilege(r,'public.patients','email','UPDATE') OR
       has_column_privilege(r,'public.doctors','email','UPDATE') OR has_any_column_privilege(r,'public.admin','UPDATE') THEN
      RAISE EXCEPTION 'Sensitive identity access remains for %. Changes rolled back.',r;
    END IF;
  END LOOP;
END
$verify$;
COMMIT;

-- Metadata only; no credentials or clinic records are returned.
SELECT tablename,policyname,permissive,cmd FROM pg_policies
WHERE schemaname='public' AND policyname IN ('Clinic access state','Clinic operations','Clinic patient editing','Owner appointment deletion')
ORDER BY tablename,policyname;
