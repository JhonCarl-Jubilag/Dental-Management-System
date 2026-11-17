-- Run after 20261118000000_patient_treatment_remarks.sql.
-- Fills only the four previously requested sample treatments, not other patients.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $remarks$
DECLARE p public.patients; t public.treatment_records; item record; owner_id uuid; matched integer:=0;
BEGIN
 SELECT * INTO STRICT p FROM public.patients WHERE lower(btrim(email))='ziniar027@gmail.com' FOR UPDATE;
 IF p.status IS DISTINCT FROM 'active' OR p.auth_user_id IS NULL THEN RAISE EXCEPTION 'An active linked patient is required.'; END IF;
 SELECT auth_user_id INTO STRICT owner_id FROM public.admin WHERE role='super_admin' AND status='active';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 FOR item IN SELECT * FROM (VALUES
 ('c3f4e4af-2bdd-4d65-a286-134762f9ad37'::uuid,'Oral Prophylaxis','Whole-mouth professional cleaning recorded. Contact the clinic for personalised oral hygiene and follow-up guidance.'),
 ('bc718042-5d42-4b12-803e-27357f3f9f71'::uuid,'Light-Cured Restoration','Restoration recorded for tooth 16. Refer to the aftercare instructions provided by your dentist and contact the clinic for follow-up questions.'),
 ('cbbf13dd-f7e4-478a-8bac-623a4f7790ea'::uuid,'Deep Scaling','Whole-mouth deep cleaning recorded. Contact the clinic to discuss your individual gum-care and follow-up plan.'),
 ('0a798c87-e245-4dc0-b2dd-f7477095bc95'::uuid,'Inlay','Inlay treatment recorded for tooth 26. Contact the clinic for personalised care instructions and follow-up guidance.')
 ) x(request_id,procedure,remarks) LOOP
  SELECT * INTO STRICT t FROM public.treatment_records WHERE patient_id=p.patient_id AND client_request_id=item.request_id FOR UPDATE;
  IF t.procedure_name IS DISTINCT FROM item.procedure THEN RAISE EXCEPTION 'The treatment changed. Review the record before filling remarks.'; END IF;
  IF btrim(t.patient_remarks)<>'' AND t.patient_remarks<>item.remarks THEN RAISE EXCEPTION 'Remarks already exist. Review them in the treatment editor; no remarks were overwritten.'; END IF;
  IF t.patient_remarks<>item.remarks THEN
   PERFORM public.save_patient_treatment_with_remarks(p.patient_id,t.appointment_id,t.treatment_id,t.version,NULL,
    t.procedure_name,t.tooth_scope,t.tooth_numbers,t.treated_at,t.notes,true,item.remarks);
  END IF;
  matched:=matched+1;
 END LOOP;
 IF matched<>4 THEN RAISE EXCEPTION 'Expected four matching treatments.'; END IF;
END
$remarks$;
SELECT t.procedure_name,t.patient_remarks FROM public.treatment_records t JOIN public.patients p USING(patient_id)
 WHERE lower(btrim(p.email))='ziniar027@gmail.com' ORDER BY t.treated_at DESC;
COMMIT;
