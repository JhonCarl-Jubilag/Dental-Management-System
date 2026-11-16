-- Read-only treatment details for up to five appointments on the patient portal.
-- Run this entire file in Supabase SQL Editor after the patient history update.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.list_my_appointment_treatments(p_appointment_ids bigint[])
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
   'tooth_scope',t.tooth_scope,'tooth_numbers',t.tooth_numbers,'treated_at',t.treated_at,
   'doctor_name',coalesce(nullif(btrim(concat_ws(' ',d.first_name,d.last_name)),''),'Not recorded')
 ) ORDER BY t.appointment_id),'[]'::jsonb)) INTO result
 FROM public.treatment_records t
 JOIN public.appointments a ON a.appointment_id=t.appointment_id AND a.patient_id=patient
 LEFT JOIN public.doctors d ON d.doctor_id=t.doctor_id
 WHERE t.patient_id=patient AND t.appointment_id=ANY(p_appointment_ids) AND a.status::text IN ('completed','done');
 RETURN result;
END
$fn$;
REVOKE ALL ON FUNCTION public.list_my_appointment_treatments(bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_my_appointment_treatments(bigint[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
