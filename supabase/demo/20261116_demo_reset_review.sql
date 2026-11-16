-- ONE-TIME REVIEWED DEMO RESET. Not a normal application migration.
-- Requires eight pre-created Supabase Auth demo accounts and a verified full backup.
-- Preserves clinic setup, activity history, attendance, inventory and all ID sequences.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.patients,public.appointments,public.billing,public.treatment_records,
 public.doctors,public.services,public.doctor_services,public.doctor_availability,
 public.appointment_email_queue,clinic_email_private.settings,auth.users IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE demo_reset_config(expected_fingerprint text,expected_patients bigint[],run_id uuid) ON COMMIT DROP;
INSERT INTO demo_reset_config VALUES('d444d6dde9a5153286f11c8a814b8a62',ARRAY[3,5,7,22,23,27,28]::bigint[],'43d61615-239a-43f4-bc3b-abdcd315391a');
CREATE TEMP TABLE demo_people(n integer,first_name text,last_name text,email text,birthday date,completed_count integer,auth_id uuid,patient_id bigint) ON COMMIT DROP;
INSERT INTO demo_people(n,first_name,last_name,email,birthday,completed_count) VALUES
 (1,'Andrea','Mendoza','andrea.mendoza@demo.example.com','2001-04-12',2),
 (2,'Miguel','Santos','miguel.santos@demo.example.com','1997-08-23',3),
 (3,'Sofia','Reyes','sofia.reyes@demo.example.com','2000-02-16',4),
 (4,'Gabriel','Cruz','gabriel.cruz@demo.example.com','1995-11-09',3),
 (5,'Isabella','Garcia','isabella.garcia@demo.example.com','1999-06-04',2),
 (6,'Daniel','Flores','daniel.flores@demo.example.com','1993-12-19',2),
 (7,'Chloe','Ramos','chloe.ramos@demo.example.com','2002-09-07',5),
 (8,'Nathan','Villanueva','nathan.villanueva@demo.example.com','1998-03-28',3);
CREATE TEMP TABLE demo_old_auth ON COMMIT DROP AS SELECT auth_user_id FROM public.patients;
CREATE TEMP TABLE demo_preserved_auth ON COMMIT DROP AS SELECT id,to_jsonb(u) AS saved FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM demo_old_auth p WHERE p.auth_user_id=u.id);
CREATE TEMP TABLE demo_receipt(label text,patient_id bigint,appointment_id bigint,billing_id bigint,treatment_id bigint,status text) ON COMMIT DROP;
CREATE TEMP TABLE demo_preserved_tables(table_name text,table_hash text) ON COMMIT DROP;
DO $snapshot$
DECLARE t text; h text;
BEGIN
 FOREACH t IN ARRAY ARRAY['admin','doctors','services','doctor_services','inventory','service_requirements','staff_time_records','staff_time_corrections'] LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
  INSERT INTO demo_preserved_tables VALUES(t,h);
 END LOOP;
END
$snapshot$;
CREATE TEMP TABLE demo_preserved_availability AS SELECT availability_id,to_jsonb(d) AS saved FROM public.doctor_availability d;
CREATE TEMP TABLE demo_preserved_history AS SELECT activity_id FROM public.clinic_activity_log;
DO $preflight$
DECLARE actual text; owner_id uuid;
BEGIN
 SELECT md5(jsonb_build_object('patients',(SELECT jsonb_agg(to_jsonb(p) ORDER BY patient_id) FROM patients p),
  'appointments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY appointment_id) FROM appointments a),
  'billing',(SELECT jsonb_agg(to_jsonb(b) ORDER BY billing_id) FROM billing b),
  'treatments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY treatment_id) FROM treatment_records t))::text) INTO actual;
 IF actual IS DISTINCT FROM (SELECT expected_fingerprint FROM demo_reset_config) OR
  (SELECT array_agg(patient_id ORDER BY patient_id) FROM patients) IS DISTINCT FROM (SELECT expected_patients FROM demo_reset_config) THEN
  RAISE EXCEPTION 'Records changed since review. Stop and create a fresh backup and preflight.';
 END IF;
 IF EXISTS(SELECT 1 FROM appointment_email_queue WHERE status='processing' AND lease_until>now()) THEN
  RAISE EXCEPTION 'An email is in flight. Pause the worker and wait before retrying.';
 END IF;
 IF EXISTS(SELECT 1 FROM patients p WHERE p.auth_user_id IS NULL OR
  EXISTS(SELECT 1 FROM admin a WHERE a.auth_user_id=p.auth_user_id) OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p.auth_user_id)) THEN
  RAISE EXCEPTION 'Existing patient accounts need review; reset aborted.';
 END IF;
 UPDATE demo_people d SET auth_id=u.id FROM auth.users u WHERE lower(u.email)=d.email AND u.email_confirmed_at IS NOT NULL
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired','false')<>'true'
  AND u.raw_app_meta_data->>'clinic_demo_run'=(SELECT run_id::text FROM demo_reset_config);
 IF EXISTS(SELECT 1 FROM demo_people WHERE auth_id IS NULL) OR EXISTS(SELECT 1 FROM admin a JOIN demo_people d ON a.auth_user_id=d.auth_id) THEN
  RAISE EXCEPTION 'Create and verify the eight separate demo Auth accounts first.';
 END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o JOIN demo_old_auth a ON a.auth_user_id::text IN (to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner'))
  OR EXISTS(SELECT 1 FROM storage.buckets b JOIN demo_old_auth a ON a.auth_user_id::text IN (to_jsonb(b)->>'owner_id',to_jsonb(b)->>'owner')) THEN
  RAISE EXCEPTION 'An old patient owns uploaded files; review ownership before resetting accounts.';
 END IF;
 SELECT auth_user_id INTO STRICT owner_id FROM admin WHERE role='super_admin' AND status='active';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
END
$preflight$;
-- These remain disabled for fictional recipients until intentionally reconfigured.
UPDATE clinic_email_private.settings SET enabled=false WHERE singleton;
UPDATE public.appointment_email_queue SET status='skipped',failure_code='demo_reset',lease_token=NULL,lease_until=NULL
 WHERE status IN ('pending','retry','processing');
DELETE FROM public.treatment_records;
DELETE FROM public.billing;
DELETE FROM public.appointments;
DELETE FROM public.patients WHERE patient_id=ANY((SELECT expected_patients FROM demo_reset_config)::bigint[]);
-- Remove only the reviewed patient Auth identities. New demo, clinic and unrelated accounts stay intact.
DELETE FROM auth.users u USING demo_old_auth old WHERE u.id=old.auth_user_id
 AND NOT EXISTS(SELECT 1 FROM public.admin a WHERE a.auth_user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM public.patients p WHERE p.auth_user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM demo_people d WHERE d.auth_id=u.id);
DO $seed$
DECLARE person record; svc record; provider bigint; pid bigint; app bigint; bill bigint; treatment bigint;
 idx integer:=0; j integer; step integer; day date; base date:=(now() AT TIME ZONE 'Asia/Manila')::date;
 at_time timestamptz; start_time time; duration integer; charged numeric; paid numeric; scope text; teeth smallint[];
 status_value public.appointment_status; person_n integer; wanted_service text; chosen_date date;
 service_names text[]:=ARRAY['Oral Prophylaxis','Light-Cured Restoration','Deep Scaling','Inlay','Root Canal Therapy','Onlay','System Tooth Whitening','Fixed Bridges','Emax Veneers','Removable Dentures','Orthodontics','TMJ Splint Treatment'];
BEGIN
 FOR person IN SELECT * FROM demo_people ORDER BY n LOOP
  INSERT INTO patients(first_name,last_name,email,address,contact_no,birthday,age,status,email_verified,auth_user_id,date_created)
   VALUES(person.first_name,person.last_name,person.email,'Fictional demo patient - Imus City, Cavite',NULL,person.birthday,
    extract(year FROM age(base,person.birthday))::integer,'active',true,person.auth_id,(base-100)::timestamp AT TIME ZONE 'Asia/Manila') RETURNING patient_id INTO pid;
  UPDATE demo_people SET patient_id=pid WHERE n=person.n;
  FOR j IN 1..person.completed_count LOOP
   idx:=idx+1; wanted_service:=service_names[1+((idx-1)%cardinality(service_names))];
   SELECT s.* INTO STRICT svc FROM services s WHERE s.service_name=wanted_service AND s.status='active';
   SELECT d.doctor_id INTO provider FROM doctors d JOIN doctor_services ds USING(doctor_id)
    WHERE ds.service_id=svc.service_id AND ds.status='active' AND d.status='active' ORDER BY d.doctor_id LIMIT 1;
   IF provider IS NULL THEN RAISE EXCEPTION 'Missing dentist assignment for %',wanted_service; END IF;
   day:=base-(idx*3+4); IF extract(isodow FROM day)=7 THEN day:=day-1; END IF;
   at_time:=(day+time '10:00') AT TIME ZONE 'Asia/Manila';
   INSERT INTO appointments(patient_id,doctor_id,service_id,appointment_datetime,status,remarks,created_at,updated_at)
    VALUES(pid,provider,svc.service_id,at_time,'completed','Fictional demo visit; treatment documented.',at_time-interval '7 days',at_time+make_interval(mins=>svc.duration_minutes)) RETURNING appointment_id INTO app;
   charged:=round(svc.price*(CASE idx%3 WHEN 0 THEN 1.1 WHEN 1 THEN 1 ELSE .9 END),2);
   paid:=CASE idx%3 WHEN 0 THEN 0 WHEN 1 THEN charged ELSE round(charged/2,2) END;
   INSERT INTO billing(appointment_id,patient_id,doctor_id,total_amount,discount,amount_paid,balance,payment_date,payment_method,remarks,created_at)
    VALUES(app,pid,provider,charged,0,paid,charged-paid,CASE WHEN paid>0 THEN day END,CASE WHEN paid>0 THEN 'cash'::public.payment_method END,'Fictional demo billing record.',at_time)
    RETURNING billing_id INTO bill;
   scope:=CASE WHEN wanted_service IN ('Oral Prophylaxis','Deep Scaling','System Tooth Whitening','Removable Dentures','Orthodontics','TMJ Splint Treatment') THEN 'whole_mouth' ELSE 'specific' END;
   teeth:=CASE WHEN scope='specific' THEN ARRAY[CASE WHEN idx%2=0 THEN 16 ELSE 26 END]::smallint[] ELSE '{}'::smallint[] END;
   INSERT INTO treatment_records(patient_id,appointment_id,doctor_id,service_id,billing_id,procedure_name,tooth_scope,tooth_numbers,treated_at,notes,client_request_id,created_at,updated_at)
    VALUES(pid,app,provider,svc.service_id,bill,wanted_service,scope,teeth,at_time+make_interval(mins=>svc.duration_minutes),
     'Fictional demonstration record. Procedure completed; aftercare instructions discussed.',gen_random_uuid(),at_time+make_interval(mins=>svc.duration_minutes),at_time+make_interval(mins=>svc.duration_minutes))
    RETURNING treatment_id INTO treatment;
   INSERT INTO demo_receipt VALUES('H'||lpad(idx::text,2,'0'),pid,app,bill,treatment,'completed');
  END LOOP;
 END LOOP;
 -- Future schedules remain usable for a live booking demonstration.
 FOR day IN SELECT d::date FROM generate_series(base+1,base+21,interval '1 day') d WHERE extract(isodow FROM d)<>7 LOOP
  INSERT INTO doctor_availability(doctor_id,available_date,start_time,end_time,is_available)
   SELECT d.doctor_id,day,'09:00','18:00',true FROM doctors d WHERE d.status='active'
    AND NOT EXISTS(SELECT 1 FROM doctor_availability da WHERE da.doctor_id=d.doctor_id AND da.available_date=day);
 END LOOP;
 FOR step IN 1..8 LOOP
  person_n:=CASE step WHEN 1 THEN 1 WHEN 2 THEN 6 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 7 WHEN 6 THEN 5 WHEN 7 THEN 6 ELSE 1 END;
  wanted_service:=CASE step WHEN 1 THEN 'Oral Prophylaxis' WHEN 2 THEN 'Light-Cured Restoration' WHEN 3 THEN 'Oral Prophylaxis' WHEN 4 THEN 'Light-Cured Restoration' WHEN 5 THEN 'Deep Scaling' WHEN 6 THEN 'Orthodontics' WHEN 7 THEN 'Oral Prophylaxis' ELSE 'Light-Cured Restoration' END;
  SELECT s.* INTO STRICT svc FROM services s WHERE s.service_name=wanted_service AND s.status='active';
  SELECT d.doctor_id INTO provider FROM doctors d JOIN doctor_services ds USING(doctor_id) WHERE ds.service_id=svc.service_id AND ds.status='active' AND d.status='active' ORDER BY d.doctor_id LIMIT 1;
  SELECT patient_id INTO STRICT pid FROM demo_people WHERE n=person_n;
  IF step<=6 THEN
   SELECT da.available_date,da.start_time INTO chosen_date,start_time FROM doctor_availability da
    WHERE da.doctor_id=provider AND da.is_available AND da.available_date>=base+step+1 AND da.available_date<=base+21
     AND extract(isodow FROM da.available_date)<>7 AND da.end_time-da.start_time>=make_interval(mins=>svc.duration_minutes)
     AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.doctor_id=provider AND a.appointment_datetime::date=da.available_date AND a.status IN ('pending','confirmed'))
    ORDER BY da.available_date,da.start_time LIMIT 1;
   IF chosen_date IS NULL THEN RAISE EXCEPTION 'No usable future schedule for %',wanted_service; END IF;
   at_time:=(chosen_date+start_time) AT TIME ZONE 'Asia/Manila';
  ELSE at_time:=((base-(step-5))+time '09:00') AT TIME ZONE 'Asia/Manila'; END IF;
  status_value:=CASE WHEN step<=2 THEN 'pending'::public.appointment_status WHEN step<=6 THEN 'confirmed'::public.appointment_status ELSE 'cancelled'::public.appointment_status END;
  INSERT INTO appointments(patient_id,doctor_id,service_id,appointment_datetime,status,remarks,created_at,updated_at)
   VALUES(pid,provider,svc.service_id,at_time,status_value,
    CASE WHEN step=7 THEN 'Fictional demo: patient cancelled due to a schedule conflict.' WHEN step=8 THEN 'Fictional demo: clinic cancelled; patient to choose another schedule.' ELSE 'Fictional demo appointment.' END,
    CASE WHEN step<=6 THEN now() ELSE at_time-interval '3 days' END,now()) RETURNING appointment_id INTO app;
  bill:=NULL;
  IF step BETWEEN 3 AND 6 THEN
   charged:=CASE step WHEN 3 THEN 1000 WHEN 4 THEN 1500 WHEN 5 THEN 3000 ELSE 2000 END;
   paid:=CASE step WHEN 4 THEN 500 WHEN 5 THEN charged ELSE 0 END;
   INSERT INTO billing(appointment_id,patient_id,doctor_id,total_amount,discount,amount_paid,balance,payment_date,payment_method,remarks)
    VALUES(app,pid,provider,charged,0,paid,charged-paid,CASE WHEN paid>0 THEN base END,CASE WHEN paid>0 THEN 'cash'::public.payment_method END,'Fictional demo billing record.') RETURNING billing_id INTO bill;
  END IF;
  IF step=6 THEN
   SELECT da.available_date,da.start_time INTO chosen_date,start_time FROM doctor_availability da WHERE da.doctor_id=provider AND da.is_available
    AND da.available_date>chosen_date AND da.end_time-da.start_time>=make_interval(mins=>svc.duration_minutes)
    ORDER BY da.available_date,da.start_time LIMIT 1;
   IF chosen_date IS NULL THEN RAISE EXCEPTION 'No reschedule date available.'; END IF;
   UPDATE appointments SET request_type='reschedule',request_status='pending',request_new_datetime=(chosen_date+start_time) AT TIME ZONE 'Asia/Manila' WHERE appointment_id=app;
  END IF;
  INSERT INTO demo_receipt VALUES('A'||lpad(step::text,2,'0'),pid,app,bill,NULL,status_value::text);
 END LOOP;
END
$seed$;
DO $verify$
DECLARE saved record; actual text;
BEGIN
 IF (SELECT count(*) FROM patients)<>8 OR (SELECT count(*) FROM appointments)<>32 OR (SELECT count(*) FROM billing)<>28 OR (SELECT count(*) FROM treatment_records)<>24 THEN RAISE EXCEPTION 'Demo counts failed; reset rolled back.'; END IF;
 IF EXISTS(SELECT 1 FROM demo_people d WHERE (SELECT count(*) FROM treatment_records t WHERE t.patient_id=d.patient_id)<>d.completed_count) THEN RAISE EXCEPTION 'Patient histories failed.'; END IF;
 IF EXISTS(SELECT 1 FROM treatment_records t JOIN appointments a USING(appointment_id) JOIN billing b USING(billing_id) WHERE t.patient_id<>a.patient_id OR t.patient_id<>b.patient_id OR a.appointment_id<>b.appointment_id OR t.doctor_id<>a.doctor_id OR t.doctor_id<>b.doctor_id OR NOT public.valid_treatment_bill(b.total_amount,b.discount,b.amount_paid,b.balance)) THEN RAISE EXCEPTION 'Demo relationships failed.'; END IF;
 IF EXISTS(SELECT 1 FROM appointment_email_queue WHERE status IN ('pending','retry','processing')) OR EXISTS(SELECT 1 FROM clinic_email_private.settings WHERE enabled) THEN RAISE EXCEPTION 'Demo notification isolation failed.'; END IF;
 IF EXISTS(SELECT 1 FROM appointments a JOIN appointments b ON a.appointment_id<b.appointment_id AND a.doctor_id=b.doctor_id
  WHERE a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed') AND a.appointment_datetime<b.appointment_end AND b.appointment_datetime<a.appointment_end) THEN RAISE EXCEPTION 'Overlapping demo appointments.'; END IF;
 FOR saved IN SELECT * FROM demo_preserved_tables LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',saved.table_name) INTO actual;
  IF actual IS DISTINCT FROM saved.table_hash THEN RAISE EXCEPTION 'Preserved table changed: %',saved.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM demo_preserved_availability p LEFT JOIN doctor_availability d USING(availability_id) WHERE d.availability_id IS NULL OR to_jsonb(d) IS DISTINCT FROM p.saved) THEN RAISE EXCEPTION 'Existing dentist schedules changed.'; END IF;
 IF EXISTS(SELECT 1 FROM demo_preserved_history h WHERE NOT EXISTS(SELECT 1 FROM clinic_activity_log l WHERE l.activity_id=h.activity_id)) THEN RAISE EXCEPTION 'Existing activity history changed.'; END IF;
 IF EXISTS(SELECT 1 FROM demo_preserved_auth p LEFT JOIN auth.users u USING(id) WHERE u.id IS NULL OR to_jsonb(u) IS DISTINCT FROM p.saved)
  OR EXISTS(SELECT 1 FROM auth.users u JOIN demo_old_auth old ON old.auth_user_id=u.id) THEN RAISE EXCEPTION 'Auth account isolation failed.'; END IF;
END
$verify$;
SELECT jsonb_build_object('run_id',(SELECT run_id FROM demo_reset_config),'patients',(SELECT jsonb_agg(jsonb_build_object('name',first_name||' '||last_name,'patient_id',patient_id,'email',email,'treatments',completed_count) ORDER BY n) FROM demo_people),'counts',jsonb_build_object('patients',8,'appointments',32,'bills',28,'treatments',24),'old_patient_auth_ids',(SELECT jsonb_agg(auth_user_id) FROM demo_old_auth),'notification_emails_enabled',false) AS demo_setup_result;
-- COMMIT is inserted only into the separately reviewed execution copy.
ROLLBACK;
