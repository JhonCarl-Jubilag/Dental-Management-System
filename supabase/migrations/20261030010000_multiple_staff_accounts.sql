-- Multiple Staff accounts; retain one Owner and the existing UUID/RLS guards.
-- Apply in Supabase SQL Editor before the updated manage-staff-account function.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.admin IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF NOT public.staff_access_ready() THEN
    RAISE EXCEPTION 'Apply the Staff access migration before enabling multiple Staff accounts.';
  END IF;
  IF (SELECT count(*) FROM public.admin WHERE role='super_admin') <> 1 THEN
    RAISE EXCEPTION 'Exactly one existing Owner profile is required. Review the Owner mapping first.';
  END IF;
  IF EXISTS (SELECT lower(btrim(email)) FROM public.admin GROUP BY lower(btrim(email)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Clinic profiles have duplicate emails. Review them before enabling multiple Staff accounts.';
  END IF;
END;
$preflight$;

-- Install the narrower Owner constraint before removing the former role slots.
CREATE UNIQUE INDEX IF NOT EXISTS admin_one_owner_profile ON public.admin(role) WHERE role='super_admin';
CREATE UNIQUE INDEX IF NOT EXISTS admin_email_normalized_key ON public.admin(lower(btrim(email)));
DROP INDEX IF EXISTS public.admin_one_profile_per_role;

CREATE OR REPLACE FUNCTION public.staff_accounts_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT public.staff_access_ready()
    AND to_regclass('public.admin_one_profile_per_role') IS NULL
    AND EXISTS (SELECT 1 FROM pg_index
      WHERE indexrelid=to_regclass('public.admin_one_owner_profile')
        AND indisunique AND indisvalid AND indpred IS NOT NULL)
    AND EXISTS (SELECT 1 FROM pg_index
      WHERE indexrelid=to_regclass('public.admin_email_normalized_key') AND indisunique AND indisvalid)
$function$;
REVOKE ALL ON FUNCTION public.staff_accounts_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_accounts_ready() TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
SELECT public.staff_accounts_ready() AS multiple_staff_ready,
       count(*) FILTER (WHERE role='super_admin') AS owner_profiles,
       count(*) FILTER (WHERE role='admin') AS staff_profiles
  FROM public.admin;
