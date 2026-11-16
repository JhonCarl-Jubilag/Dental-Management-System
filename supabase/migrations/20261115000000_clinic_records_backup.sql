-- Owner-only clinic records export and insert-only recovery. Not a full Supabase backup.
-- Apply in SQL Editor, after the appointment email and activity updates.
-- No existing records are modified when installing this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS clinic_backup_private;
REVOKE ALL ON SCHEMA clinic_backup_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS clinic_backup_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_id uuid NOT NULL DEFAULT gen_random_uuid(),
  secret_id uuid NOT NULL
);
ALTER TABLE clinic_backup_private.settings ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS clinic_backup_private.recovery_runs (
  recovery_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  confirmation_id uuid NOT NULL UNIQUE,
  backup_id uuid NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE clinic_backup_private.recovery_runs ENABLE ROW LEVEL SECURITY;
DO $setup$
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NULL
    OR to_regprocedure('public.valid_treatment_bill(numeric,numeric,numeric,numeric)') IS NULL
    OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Install the clinic access, treatment records and Vault updates first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clinic_backup_private.settings) THEN
    INSERT INTO clinic_backup_private.settings(secret_id)
      VALUES (vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
        'clinic_records_backup_signing_key','Signs clinic record exports; do not delete or rotate while backups are needed.'));
  END IF;
END
$setup$;

-- Explicit allowlist: new columns are never silently exported. Update this registry
-- and format version deliberately when the supported schema changes.
CREATE OR REPLACE FUNCTION clinic_backup_private.registry()
RETURNS TABLE(sort_order integer, table_name text, pk text, columns text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
  SELECT * FROM (VALUES
    (1,'services','service_id',ARRAY['service_id','service_name','description','price','status','duration_minutes']::text[]),
    (2,'doctors','doctor_id',ARRAY['doctor_id','first_name','last_name','email','specialization','contact_no','date_created','status','availability']::text[]),
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

CREATE OR REPLACE FUNCTION clinic_backup_private.require_owner()
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(),false) THEN
    RAISE EXCEPTION 'Only the active Owner can back up or recover clinic records.' USING ERRCODE='42501';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION clinic_backup_private.sign(p_value jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
  SELECT encode(extensions.hmac(convert_to(p_value::text,'UTF8'),convert_to(v.decrypted_secret,'UTF8'),'sha256'),'hex')
  FROM clinic_backup_private.settings s JOIN vault.decrypted_secrets v ON v.id=s.secret_id
$fn$;

CREATE OR REPLACE FUNCTION clinic_backup_private.assert_schema()
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM clinic_backup_private.registry() r JOIN pg_attribute a ON a.attrelid=('public.'||r.table_name)::regclass
    WHERE a.attnum>0 AND NOT a.attisdropped AND NOT a.attname=ANY(r.columns)
    AND NOT (r.table_name='doctors' AND a.attname='password')
    AND NOT (r.table_name='patients' AND a.attname IN ('verification_token','reset_token','reset_token_expiry'))
    AND NOT (r.table_name='staff_time_records' AND a.attname='work_date' AND a.attgenerated='s')) THEN
    RAISE EXCEPTION 'The clinic schema has changed. Update the backup format before downloading or recovering records.';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION clinic_backup_private.schema_hash()
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
  SELECT encode(extensions.digest(jsonb_agg(jsonb_build_object(
    'table',r.table_name,'allowed',r.columns,
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
      a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=('public.'||r.table_name)::regclass AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname)
      FROM pg_constraint c WHERE c.conrelid=('public.'||r.table_name)::regclass),
    'indexes',(SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes
      WHERE schemaname='public' AND tablename=r.table_name)
  ) ORDER BY r.sort_order)::text,'sha256'),'hex') FROM clinic_backup_private.registry() r
$fn$;

CREATE OR REPLACE FUNCTION public.create_clinic_records_backup()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='30s' AS $fn$
DECLARE r record; rows jsonb; all_rows jsonb:='{}'; payload jsonb; signed_file text; fields text; total bigint:=0;
BEGIN
  PERFORM clinic_backup_private.require_owner();
  PERFORM clinic_backup_private.assert_schema();
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    SELECT string_agg(format('%I',c),',') INTO fields FROM unnest(r.columns) c;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %I),''[]''::jsonb) FROM (SELECT %s FROM public.%I) t',r.pk,fields,r.table_name) INTO rows;
    total:=total+jsonb_array_length(rows);
    IF total>50000 THEN RAISE EXCEPTION 'This export exceeds the basic backup limit. Ask for a full database backup.'; END IF;
    all_rows:=all_rows||jsonb_build_object(r.table_name,rows);
  END LOOP;
  payload:=jsonb_build_object('format','diolata-clinic-records','version',1,
    'database_id',(SELECT database_id FROM clinic_backup_private.settings),
    'backup_id',gen_random_uuid(),'created_at',statement_timestamp(),
    'schema_hash',clinic_backup_private.schema_hash(),'data',all_rows);
  signed_file:=jsonb_build_object('payload',payload,'signature',clinic_backup_private.sign(payload))::text;
  IF octet_length(signed_file)>10485760 THEN RAISE EXCEPTION 'This export exceeds 10 MB. Ask for a full database backup.'; END IF;
  RETURN jsonb_build_object('backup_file',signed_file,'created_at',payload->>'created_at','total',total);
END
$fn$;

CREATE OR REPLACE FUNCTION clinic_backup_private.check_file(p_file text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $fn$
DECLARE envelope jsonb; payload jsonb; expected text; r record; row_data jsonb; total integer:=0; keys text[];
BEGIN
  PERFORM clinic_backup_private.assert_schema();
  IF p_file IS NULL OR octet_length(p_file)>10485760 OR octet_length(p_file)<100 THEN
    RAISE EXCEPTION 'Choose a clinic records backup file of up to 10 MB.';
  END IF;
  BEGIN envelope:=p_file::jsonb; EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'The selected file is not a valid JSON backup.';
  END;
  payload:=envelope->'payload'; expected:=clinic_backup_private.sign(payload);
  IF expected IS NULL OR envelope->>'signature' IS NULL OR
    extensions.digest(envelope->>'signature','sha256')<>extensions.digest(expected,'sha256') THEN
    RAISE EXCEPTION 'The backup signature is invalid. Use an unchanged file downloaded from this system.';
  END IF;
  IF payload->>'format'<>'diolata-clinic-records' OR payload->>'version'<>'1'
    OR payload->>'database_id' IS DISTINCT FROM (SELECT database_id::text FROM clinic_backup_private.settings)
    OR payload->>'schema_hash' IS DISTINCT FROM clinic_backup_private.schema_hash() THEN
    RAISE EXCEPTION 'This backup belongs to another database or an incompatible system version. Ask the Owner to review it.';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(payload->'data') k;
  IF keys IS DISTINCT FROM (SELECT array_agg(table_name ORDER BY table_name) FROM clinic_backup_private.registry()) THEN
    RAISE EXCEPTION 'The backup contains unsupported or missing modules.';
  END IF;
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    IF jsonb_typeof(payload->'data'->r.table_name) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'The backup contains an invalid module.';
    END IF;
    total:=total+jsonb_array_length(payload->'data'->r.table_name);
    IF total>50000 THEN RAISE EXCEPTION 'The backup exceeds the basic recovery limit.'; END IF;
    FOR row_data IN SELECT value FROM jsonb_array_elements(payload->'data'->r.table_name) LOOP
      IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'The backup contains an invalid record.'; END IF;
      SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(row_data) k;
      IF keys IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(r.columns) c)
        OR coalesce(row_data->>r.pk,'')!~'^[1-9][0-9]{0,18}$' THEN
        RAISE EXCEPTION 'The backup contains invalid record fields.';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'data'->r.table_name) v GROUP BY v->>r.pk HAVING count(*)>1) THEN
      RAISE EXCEPTION 'The backup contains duplicate record IDs.';
    END IF;
  END LOOP;
  RETURN payload;
END
$fn$;

-- Simulate inserts using temporary copies with the live CHECK/UNIQUE/EXCLUDE
-- rules. Foreign keys are checked separately against these merged copies.
-- No application triggers run, no sequences advance, and no live data is written.
CREATE OR REPLACE FUNCTION clinic_backup_private.plan(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $fn$
DECLARE r record; fk record; source jsonb; current_row jsonb; row_data jsonb; typed_row jsonb;
  fields text; select_fields text; state jsonb:='{}'; pending jsonb:='{}'; counts jsonb:='{}'; issues jsonb:='[]';
  parent_table text; parent_pk text; fk_name text; missing boolean; reason text; new_ids jsonb;
  existing_count integer; conflict_count integer; blocked_count integer; recoverable_count integer; key_id bigint;
  linked record; linked_bill record; linked_appt record; state_hash text; parent_before jsonb; parent_now jsonb; identity_fields text[];
BEGIN
  EXECUTE 'DROP TABLE IF EXISTS pg_temp.clinic_backup_original';
  CREATE TEMP TABLE clinic_backup_original(module text,id text,row_data jsonb,PRIMARY KEY(module,id)) ON COMMIT DROP;
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    INSERT INTO pg_temp.clinic_backup_original(module,id,row_data)
      SELECT r.table_name,value->>r.pk,value FROM jsonb_array_elements(p_payload->'data'->r.table_name);
  END LOOP;
  -- Drop before use: a caller cannot supply a pre-created temporary table with triggers.
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I','clinic_backup_'||r.table_name);
    EXECUTE format('CREATE TEMP TABLE %I (LIKE public.%I INCLUDING CONSTRAINTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP',
      'clinic_backup_'||r.table_name,r.table_name);
    SELECT string_agg(format('%I',c),',') INTO fields FROM unnest(r.columns) c;
    EXECUTE format('INSERT INTO pg_temp.%I (%s) SELECT %s FROM public.%I','clinic_backup_'||r.table_name,fields,fields,r.table_name);
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %I),''[]''::jsonb) FROM (SELECT %s FROM pg_temp.%I) t',
      r.pk,fields,'clinic_backup_'||r.table_name) INTO source;
    state:=state||jsonb_build_object(r.table_name,source);
  END LOOP;
  -- Identity links are not backed up or restored, but a changed link invalidates a preview.
  state:=state||jsonb_build_object('account_links',coalesce((SELECT jsonb_agg(jsonb_build_array(
    a.admin_id,a.auth_user_id,a.role,a.status) ORDER BY a.admin_id) FROM public.admin a),'[]'::jsonb),
    'auth_links',coalesce((SELECT jsonb_agg(jsonb_build_array(u.id,u.email,u.email_confirmed_at,u.banned_until,u.raw_app_meta_data) ORDER BY u.id)
      FROM auth.users u WHERE u.id IN (SELECT auth_user_id FROM public.patients WHERE auth_user_id IS NOT NULL)
        OR u.id IN (SELECT (p->>'auth_user_id')::uuid FROM jsonb_array_elements(p_payload->'data'->'patients') p
          WHERE p->>'auth_user_id' IS NOT NULL)),'[]'::jsonb));
  state_hash:=encode(extensions.digest(state::text,'sha256'),'hex');
  state:=NULL;
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    existing_count:=0; conflict_count:=0; blocked_count:=0; recoverable_count:=0; new_ids:='[]';
    SELECT string_agg(format('%I',c),','),string_agg(format('q.%I',c),',') INTO fields,select_fields FROM unnest(r.columns) c;
    FOR row_data IN SELECT value FROM jsonb_array_elements(p_payload->'data'->r.table_name) ORDER BY (value->>r.pk)::bigint LOOP
      key_id:=(row_data->>r.pk)::bigint;
      EXECUTE format('SELECT to_jsonb(t) FROM (SELECT %s FROM pg_temp.%I WHERE %I=$1) t',fields,'clinic_backup_'||r.table_name,r.pk)
        INTO current_row USING key_id;
      IF current_row IS NOT NULL THEN
        IF current_row=row_data THEN existing_count:=existing_count+1;
        ELSE
          conflict_count:=conflict_count+1;
          IF jsonb_array_length(issues)<50 THEN issues:=issues||jsonb_build_array(jsonb_build_object('module',r.table_name,'id',key_id::text,'reason','Existing record differs; left unchanged.')); END IF;
        END IF;
        CONTINUE;
      END IF;
      reason:=NULL;
      BEGIN
        -- Casting uses the real types before checking relationships.
        EXECUTE format('SELECT to_jsonb(q) FROM jsonb_populate_record(NULL::public.%I,$1) q',r.table_name) INTO typed_row USING row_data;
        FOR fk IN SELECT c.confrelid,c.conkey,c.confkey FROM pg_constraint c
          WHERE c.conrelid=('public.'||r.table_name)::regclass AND c.contype='f' LOOP
          IF cardinality(fk.conkey)<>1 THEN RAISE EXCEPTION 'Unsupported composite dependency.'; END IF;
          SELECT attname INTO fk_name FROM pg_attribute WHERE attrelid=('public.'||r.table_name)::regclass AND attnum=fk.conkey[1];
          IF typed_row->>fk_name IS NULL THEN CONTINUE; END IF;
          SELECT attname INTO parent_pk FROM pg_attribute WHERE attrelid=fk.confrelid AND attnum=fk.confkey[1];
          SELECT relname INTO parent_table FROM pg_class WHERE oid=fk.confrelid;
          IF EXISTS (SELECT 1 FROM clinic_backup_private.registry() rr WHERE rr.table_name=parent_table) THEN
            EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM pg_temp.%I WHERE %I::text=$1)','clinic_backup_'||parent_table,parent_pk)
              INTO missing USING typed_row->>fk_name;
          ELSE
            EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %s WHERE %I::text=$1)',fk.confrelid::regclass,parent_pk)
              INTO missing USING typed_row->>fk_name;
          END IF;
          IF missing THEN reason:='A linked record or login account is missing.'; EXIT; END IF;
          -- A reused ID must not attach old records to another patient/dentist,
          -- procedure or appointment. Price, notes and status edits can remain.
          identity_fields:=CASE parent_table
            WHEN 'patients' THEN ARRAY['first_name','last_name','email','auth_user_id']
            WHEN 'doctors' THEN ARRAY['first_name','last_name','email']
            WHEN 'services' THEN ARRAY['service_name']
            WHEN 'inventory' THEN ARRAY['item_name']
            WHEN 'appointments' THEN ARRAY['patient_id','doctor_id','service_id','appointment_datetime','appointment_end']
            ELSE NULL END;
          IF identity_fields IS NOT NULL THEN
            SELECT o.row_data INTO parent_before FROM pg_temp.clinic_backup_original o WHERE o.module=parent_table AND o.id=typed_row->>fk_name;
            EXECUTE format('SELECT to_jsonb(q) FROM pg_temp.%I q WHERE %I::text=$1','clinic_backup_'||parent_table,parent_pk)
              INTO parent_now USING typed_row->>fk_name;
            IF parent_before IS NULL OR EXISTS(SELECT 1 FROM unnest(identity_fields) k WHERE parent_now->k IS DISTINCT FROM parent_before->k) THEN
              reason:='A linked record has changed identity or schedule. Owner review is required.'; EXIT;
            END IF;
          END IF;
        END LOOP;
        IF reason IS NULL AND r.table_name='patients' THEN
          IF EXISTS(SELECT 1 FROM pg_temp.clinic_backup_patients WHERE lower(btrim(email))=lower(btrim(typed_row->>'email')))
            OR EXISTS(SELECT 1 FROM public.admin WHERE lower(btrim(email))=lower(btrim(typed_row->>'email')))
            OR EXISTS(SELECT 1 FROM pg_temp.clinic_backup_doctors WHERE lower(btrim(email))=lower(btrim(typed_row->>'email'))) THEN
            reason:='The patient email is already used by another profile.';
          ELSIF typed_row->>'auth_user_id' IS NOT NULL THEN
            SELECT * INTO linked FROM auth.users WHERE id=(typed_row->>'auth_user_id')::uuid;
            IF linked.email_confirmed_at IS NULL OR lower(btrim(linked.email)) IS DISTINCT FROM lower(btrim(typed_row->>'email'))
              OR linked.banned_until>now() OR coalesce((linked.raw_app_meta_data->>'clinic_provider_login_retired')::boolean,false)
              OR linked.raw_app_meta_data->>'fifthcusp_legacy_doctor_id' IS NOT NULL
              OR EXISTS(SELECT 1 FROM public.admin WHERE auth_user_id=linked.id) THEN
              reason:='The patient login link requires Owner review.';
            END IF;
          ELSIF EXISTS (SELECT 1 FROM auth.users WHERE lower(btrim(email))=lower(btrim(typed_row->>'email')))
            OR EXISTS (SELECT 1 FROM public.admin WHERE lower(btrim(email))=lower(btrim(typed_row->>'email'))) THEN
            reason:='The patient email has an existing account link to review.';
          END IF;
        END IF;
        IF reason IS NULL AND r.table_name='billing' THEN
          IF NOT public.valid_treatment_bill((typed_row->>'total_amount')::numeric,(typed_row->>'discount')::numeric,
            (typed_row->>'amount_paid')::numeric,(typed_row->>'balance')::numeric) THEN reason:='Payment totals require review.';
          ELSIF typed_row->>'appointment_id' IS NOT NULL THEN
            SELECT * INTO linked_appt FROM pg_temp.clinic_backup_appointments WHERE appointment_id=(typed_row->>'appointment_id')::bigint;
            IF (typed_row->>'patient_id')::bigint IS DISTINCT FROM linked_appt.patient_id
              OR (typed_row->>'doctor_id')::bigint IS DISTINCT FROM linked_appt.doctor_id THEN reason:='Bill and appointment links do not match.'; END IF;
          END IF;
        END IF;
        IF reason IS NULL AND r.table_name='treatment_records' THEN
          SELECT * INTO linked_appt FROM pg_temp.clinic_backup_appointments WHERE appointment_id=(typed_row->>'appointment_id')::bigint;
          SELECT * INTO linked_bill FROM pg_temp.clinic_backup_billing WHERE billing_id=(typed_row->>'billing_id')::bigint;
          IF (typed_row->>'patient_id')::bigint IS DISTINCT FROM linked_appt.patient_id
            OR (typed_row->>'doctor_id')::bigint IS DISTINCT FROM linked_appt.doctor_id
            OR (typed_row->>'service_id')::bigint IS DISTINCT FROM linked_appt.service_id
            OR linked_bill.appointment_id IS DISTINCT FROM linked_appt.appointment_id
            OR linked_bill.patient_id IS DISTINCT FROM linked_appt.patient_id OR linked_bill.doctor_id IS DISTINCT FROM linked_appt.doctor_id
            OR linked_appt.status IS NULL OR linked_appt.status NOT IN ('confirmed','completed')
            OR linked_appt.appointment_end IS NULL OR linked_appt.appointment_end>now()
            OR NOT public.valid_treatment_bill(linked_bill.total_amount,linked_bill.discount,linked_bill.amount_paid,linked_bill.balance) THEN
            reason:='Treatment, appointment and bill links require review.';
          END IF;
        END IF;
        IF reason IS NULL AND r.table_name='staff_time_records' AND NOT EXISTS (
          SELECT 1 FROM public.admin a WHERE a.admin_id=(typed_row->>'staff_admin_id')::bigint
            AND a.role='admin' AND a.auth_user_id=(typed_row->>'staff_auth_user_id')::uuid) THEN
          reason:='The original Staff account link is unavailable.';
        END IF;
        IF reason IS NULL THEN
          EXECUTE format('INSERT INTO pg_temp.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) q',
            'clinic_backup_'||r.table_name,fields,select_fields,r.table_name) USING row_data;
        END IF;
      EXCEPTION
        WHEN unique_violation OR exclusion_violation THEN reason:='Another record uses the same unique details or time slot.';
        WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN reason:='Record values do not meet current validation rules.';
      END;
      IF reason IS NULL THEN
        recoverable_count:=recoverable_count+1; new_ids:=new_ids||jsonb_build_array(key_id::text);
      ELSE
        blocked_count:=blocked_count+1;
        IF jsonb_array_length(issues)<50 THEN issues:=issues||jsonb_build_array(jsonb_build_object('module',r.table_name,'id',key_id::text,'reason',reason)); END IF;
      END IF;
    END LOOP;
    pending:=pending||jsonb_build_object(r.table_name,new_ids);
    counts:=counts||jsonb_build_object(r.table_name,jsonb_build_object('recoverable',recoverable_count,'existing',existing_count,'different',conflict_count,'blocked',blocked_count));
  END LOOP;
  RETURN jsonb_build_object('counts',counts,'issues',issues,'pending',pending,'state_hash',state_hash);
END
$fn$;

CREATE OR REPLACE FUNCTION public.preview_clinic_records_recovery(p_file text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET statement_timeout='30s' AS $fn$
DECLARE payload jsonb; plan jsonb; confirmation jsonb;
BEGIN
  PERFORM clinic_backup_private.require_owner();
  payload:=clinic_backup_private.check_file(p_file);
  plan:=clinic_backup_private.plan(payload);
  confirmation:=jsonb_build_object('id',gen_random_uuid(),'owner',auth.uid(),'expires',clock_timestamp()+interval '15 minutes',
    'file_hash',encode(extensions.digest(p_file,'sha256'),'hex'),'plan_hash',encode(extensions.digest(plan::text,'sha256'),'hex'));
  RETURN (plan-'pending'-'state_hash')||jsonb_build_object('backup_date',payload->>'created_at',
    'confirmation',jsonb_build_object('payload',confirmation,'signature',clinic_backup_private.sign(confirmation)));
END
$fn$;

-- Marker is signed and bound to this transaction and Owner, not an arbitrary
-- browser-provided setting. Only the recovery RPC can generate it.
CREATE OR REPLACE FUNCTION clinic_backup_private.recovery_authorized()
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
  SELECT coalesce(public.is_super_admin() AND current_setting('clinic.records_recovery',true)=
    clinic_backup_private.sign(jsonb_build_object('tx',txid_current()::text,'owner',auth.uid())),false)
$fn$;

DO $wrap$
DECLARE name text; definition text; injected text; marker text:='-- clinic_records_recovery_v1';
BEGIN
  FOREACH name IN ARRAY ARRAY['guard_appointment_reservation','queue_appointment_email','record_appointment_activity','record_billing_treatment_activity'] LOOP
    IF to_regprocedure('public.'||name||'()') IS NULL THEN RAISE EXCEPTION 'Install required trigger function: %',name; END IF;
    definition:=pg_get_functiondef(('public.'||name||'()')::regprocedure);
    IF position(marker IN definition)>0 THEN CONTINUE; END IF;
    injected:=E'BEGIN\n  '||marker||E'\n  IF '||CASE WHEN name='guard_appointment_reservation' THEN 'TG_OP=''INSERT'' AND ' ELSE '' END
      ||'clinic_backup_private.recovery_authorized() THEN RETURN '||CASE WHEN name='guard_appointment_reservation' THEN 'NEW' ELSE 'NULL' END||E'; END IF;\n';
    IF definition!~E'\nBEGIN\r?\n' THEN RAISE EXCEPTION 'Review trigger structure before adding recovery: %',name; END IF;
    EXECUTE regexp_replace(definition,E'\nBEGIN\r?\n',E'\n'||injected);
  END LOOP;
END
$wrap$;

CREATE OR REPLACE FUNCTION public.recover_clinic_records(p_file text,p_confirmation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' SET lock_timeout='5s' SET statement_timeout='30s' AS $fn$
DECLARE payload jsonb; plan jsonb; token jsonb; r record; fields text; select_fields text; restored integer:=0;
  table_count integer; ids bigint[]; seq text; max_id bigint; seq_value bigint; operation_id bigint; display_name text;
BEGIN
  PERFORM clinic_backup_private.require_owner();
  token:=p_confirmation->'payload';
  IF clinic_backup_private.sign(token) IS NULL OR p_confirmation->>'signature' IS NULL
    OR extensions.digest(p_confirmation->>'signature','sha256')<>extensions.digest(clinic_backup_private.sign(token),'sha256')
    OR token->>'owner' IS DISTINCT FROM auth.uid()::text OR (token->>'expires')::timestamptz<clock_timestamp()
    OR token->>'file_hash' IS DISTINCT FROM encode(extensions.digest(p_file,'sha256'),'hex') THEN
    RAISE EXCEPTION 'The recovery preview is invalid or expired. Check the file again.';
  END IF;
  payload:=clinic_backup_private.check_file(p_file);
  -- Short exclusive write window. Readers can continue; writers wait or fail safely.
  LOCK TABLE public.services,public.doctors,public.patients,public.inventory,public.doctor_services,
    public.doctor_availability,public.service_requirements,public.appointments,public.billing,
    public.treatment_records,public.staff_time_records,public.staff_time_corrections,public.admin,auth.users IN SHARE ROW EXCLUSIVE MODE;
  PERFORM clinic_backup_private.require_owner();
  plan:=clinic_backup_private.plan(payload);
  IF token->>'plan_hash' IS DISTINCT FROM encode(extensions.digest(plan::text,'sha256'),'hex') THEN
    RAISE EXCEPTION 'Clinic records changed after the preview. Check the file again before recovery.';
  END IF;
  PERFORM set_config('clinic.records_recovery',clinic_backup_private.sign(jsonb_build_object('tx',txid_current()::text,'owner',auth.uid())),true);
  FOR r IN SELECT * FROM clinic_backup_private.registry() ORDER BY sort_order LOOP
    SELECT array_agg(value::bigint) INTO ids FROM jsonb_array_elements_text(plan->'pending'->r.table_name);
    IF coalesce(cardinality(ids),0)=0 THEN CONTINUE; END IF;
    SELECT string_agg(format('%I',c),','),string_agg(format('q.%I',c),',') INTO fields,select_fields FROM unnest(r.columns) c;
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM pg_temp.%I q WHERE %I=ANY($1) ORDER BY %I',
      r.table_name,fields,select_fields,'clinic_backup_'||r.table_name,r.pk,r.pk) USING ids;
    GET DIAGNOSTICS table_count=ROW_COUNT;
    restored:=restored+table_count;
    -- Advance only; a nontransactional sequence gap after rollback is harmless.
    seq:=pg_get_serial_sequence('public.'||r.table_name,r.pk);
    IF seq IS NOT NULL THEN
      EXECUTE format('SELECT max(%I) FROM public.%I',r.pk,r.table_name) INTO max_id;
      EXECUTE format('SELECT last_value FROM %s',seq::regclass) INTO seq_value;
      PERFORM setval(seq::regclass,greatest(max_id,seq_value),true);
    END IF;
  END LOOP;
  PERFORM set_config('clinic.records_recovery','',true);
  IF restored=0 THEN RAISE EXCEPTION 'There are no missing records available to recover.'; END IF;
  INSERT INTO clinic_backup_private.recovery_runs(confirmation_id,backup_id)
    VALUES((token->>'id')::uuid,(payload->>'backup_id')::uuid) RETURNING recovery_id INTO operation_id;
  SELECT nullif(btrim(concat_ws(' ',first_name,last_name)),'') INTO display_name FROM public.admin WHERE auth_user_id=auth.uid();
  INSERT INTO public.clinic_activity_log(actor_auth_user_id,actor_name,actor_role,resource_type,record_id,action,changes)
    VALUES(auth.uid(),coalesce(display_name,'Owner'),'super_admin','recovery',operation_id,'records_recovered',
      jsonb_build_object('recovered_count',restored,'backup_date',payload->>'created_at','counts',plan->'counts'));
  RETURN jsonb_build_object('recovered',restored,'counts',plan->'counts');
END
$fn$;

REVOKE ALL ON ALL TABLES IN SCHEMA clinic_backup_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA clinic_backup_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA clinic_backup_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_clinic_records_backup(),public.preview_clinic_records_recovery(text),public.recover_clinic_records(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_clinic_records_backup(),public.preview_clinic_records_recovery(text),public.recover_clinic_records(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
