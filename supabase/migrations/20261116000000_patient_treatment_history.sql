-- Patient-facing, read-only history. No treatment rows or existing clinic policies change.
-- Run the whole file in Supabase SQL Editor.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $check$
BEGIN
 IF to_regclass('public.treatment_records') IS NULL OR to_regprocedure('public.current_patient_id()') IS NULL THEN
   RAISE EXCEPTION 'Install Treatment Records and patient account isolation first.';
 END IF;
END
$check$;

-- Never accept a patient ID from the browser. Resolve it from the verified login.
-- The explicit field list excludes clinical notes, revision history, Auth IDs,
-- billing information, and all appointment scheduling remarks.
CREATE OR REPLACE FUNCTION public.list_my_treatment_history(
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
   SELECT t.treatment_id,t.procedure_name,t.tooth_scope,t.tooth_numbers,t.treated_at,t.doctor_id
   FROM public.treatment_records t WHERE t.patient_id=patient
     AND (p_from IS NULL OR t.treated_at>=(p_from::timestamp AT TIME ZONE 'Asia/Manila'))
     AND (p_to IS NULL OR t.treated_at<((p_to+1)::timestamp AT TIME ZONE 'Asia/Manila'))
 ), paged AS (
   SELECT f.treatment_id,f.procedure_name,f.tooth_scope,f.tooth_numbers,f.treated_at,
     coalesce(nullif(btrim(concat_ws(' ',d.first_name,d.last_name)),''),'Not recorded') AS doctor_name
   FROM filtered f LEFT JOIN public.doctors d ON d.doctor_id=f.doctor_id
   ORDER BY f.treated_at DESC,f.treatment_id DESC LIMIT 10 OFFSET (p_page-1)*10
 )
 SELECT jsonb_build_object('patient_id',patient,'page',p_page,'page_size',10,'total',(SELECT count(*) FROM filtered),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.treated_at DESC,p.treatment_id DESC) FROM paged p),'[]'::jsonb)) INTO result;
 RETURN result;
END
$fn$;
REVOKE ALL ON FUNCTION public.list_my_treatment_history(integer,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_my_treatment_history(integer,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
