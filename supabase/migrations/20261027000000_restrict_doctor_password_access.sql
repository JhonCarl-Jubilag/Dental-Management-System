-- Deploy the explicit-field frontend before applying this migration.
-- First containment stage: protect the legacy doctors.password column.
-- Apply ONLY after a validated database backup and coordinated safe-field frontend deployment.
-- This changes privileges, not row data or the existing RLS policies.
-- It does not resolve the separate broad patient/service/booking policies.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE field_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctors' AND column_name = 'password'
  ) THEN RAISE EXCEPTION 'Expected legacy doctor password column was not found; review the current schema.'; END IF;

  FOREACH field_name IN ARRAY ARRAY['doctor_id','first_name','last_name','email','specialization','contact_no','date_created','status','availability']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'doctors' AND column_name = field_name
    ) THEN RAISE EXCEPTION 'Expected safe provider column missing: %', field_name; END IF;
  END LOOP;
END
$preflight$;

-- Column revokes alone cannot override an existing table-wide grant.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.doctors FROM PUBLIC, anon, authenticated;
REVOKE SELECT (password), INSERT (password), UPDATE (password)
  ON TABLE public.doctors FROM PUBLIC, anon, authenticated;

GRANT SELECT (doctor_id, first_name, last_name, email, specialization, contact_no, date_created, status, availability)
  ON TABLE public.doctors TO anon, authenticated;
GRANT INSERT (doctor_id, first_name, last_name, email, specialization, contact_no, date_created, status, availability)
  ON TABLE public.doctors TO anon, authenticated;
GRANT UPDATE (doctor_id, first_name, last_name, email, specialization, contact_no, date_created, status, availability)
  ON TABLE public.doctors TO anon, authenticated;

-- Existing RLS still decides which rows/operations each caller may access.
-- Backend service_role privileges are not changed by this script.
DO $verify$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated']
  LOOP
    IF has_column_privilege(role_name, 'public.doctors', 'password', 'SELECT')
       OR has_column_privilege(role_name, 'public.doctors', 'password', 'INSERT')
       OR has_column_privilege(role_name, 'public.doctors', 'password', 'UPDATE')
    THEN RAISE EXCEPTION 'Legacy password access remains through a direct/inherited grant for %; changes rolled back.', role_name; END IF;
    IF NOT has_column_privilege(role_name, 'public.doctors', 'doctor_id', 'SELECT')
       OR NOT has_column_privilege(role_name, 'public.doctors', 'first_name', 'SELECT')
    THEN RAISE EXCEPTION 'Required provider read access is missing for %; changes rolled back.', role_name; END IF;
  END LOOP;
END
$verify$;

COMMIT;

-- Verification output contains privilege metadata only, never password values.
SELECT role_name,
  has_column_privilege(role_name, 'public.doctors', 'password', 'SELECT') AS can_read_password,
  has_column_privilege(role_name, 'public.doctors', 'password', 'INSERT') AS can_insert_password,
  has_column_privilege(role_name, 'public.doctors', 'password', 'UPDATE') AS can_update_password,
  has_column_privilege(role_name, 'public.doctors', 'doctor_id', 'SELECT') AS can_read_provider_id
FROM (VALUES ('anon'), ('authenticated')) AS browser_roles(role_name);

