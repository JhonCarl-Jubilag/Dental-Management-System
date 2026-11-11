-- Staff Daily Time Records. Back up and deploy the matching frontend before applying.
-- Additive: existing clinic/patient/provider/billing records and policies are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF to_regprocedure('public.current_clinic_role()') IS NULL OR to_regprocedure('public.is_super_admin()') IS NULL
  OR to_regprocedure('public.staff_accounts_ready()') IS NULL OR NOT public.staff_accounts_ready() THEN
  RAISE EXCEPTION 'Install the clinic roles and multiple Staff accounts updates first.';
 END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.staff_time_records (
 record_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 staff_admin_id bigint NOT NULL REFERENCES public.admin(admin_id) ON DELETE RESTRICT,
 staff_auth_user_id uuid NOT NULL,
 time_in timestamptz NOT NULL CHECK(isfinite(time_in)),
 time_out timestamptz CHECK(time_out IS NULL OR (isfinite(time_out) AND time_out>=time_in)),
 work_date date GENERATED ALWAYS AS ((time_in AT TIME ZONE 'Asia/Manila')::date) STORED,
 entry_source text NOT NULL CHECK(entry_source IN ('clock','owner')),
 clock_in_request_id uuid NOT NULL UNIQUE,
 clock_out_request_id uuid UNIQUE,
 created_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT staff_time_records_no_overlap EXCLUDE USING gist (
  numrange(staff_admin_id::numeric,staff_admin_id::numeric,'[]') WITH &&,
  tstzrange(time_in,time_out,'[)') WITH &&)
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_time_records_one_open ON public.staff_time_records(staff_admin_id) WHERE time_out IS NULL;
CREATE INDEX IF NOT EXISTS staff_time_records_staff_time ON public.staff_time_records(staff_admin_id,time_in DESC);
CREATE INDEX IF NOT EXISTS staff_time_records_month ON public.staff_time_records(work_date DESC,staff_admin_id);

CREATE TABLE IF NOT EXISTS public.staff_time_corrections (
 correction_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 record_id bigint NOT NULL REFERENCES public.staff_time_records(record_id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('create','correct')),
 old_time_in timestamptz, old_time_out timestamptz,
 new_time_in timestamptz NOT NULL, new_time_out timestamptz,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 corrected_by uuid NOT NULL,
 corrected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version_after integer NOT NULL,
 request_id uuid NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS staff_time_corrections_record ON public.staff_time_corrections(record_id,correction_id DESC);

CREATE OR REPLACE FUNCTION public.current_attendance_staff_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT admin_id FROM public.admin WHERE auth_user_id=auth.uid() AND role='admin' AND status='active'
  AND public.current_clinic_role()='admin'
$fn$;
REVOKE ALL ON FUNCTION public.current_attendance_staff_id() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_attendance_staff_id() TO authenticated;

ALTER TABLE public.staff_time_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_time_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_time_records,public.staff_time_corrections FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.staff_time_records_record_id_seq,public.staff_time_corrections_correction_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_time_records,public.staff_time_corrections TO authenticated;
DROP POLICY IF EXISTS "Attendance reading" ON public.staff_time_records;
CREATE POLICY "Attendance reading" ON public.staff_time_records FOR SELECT TO authenticated USING (
 (SELECT public.is_super_admin()) OR (staff_admin_id=(SELECT public.current_attendance_staff_id()) AND staff_auth_user_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS "Attendance audit reading" ON public.staff_time_corrections;
CREATE POLICY "Attendance audit reading" ON public.staff_time_corrections FOR SELECT TO authenticated USING ((SELECT public.is_super_admin()));

-- Internal DTO helper. Requests/UUID ownership are never accepted from browser rows.
CREATE OR REPLACE FUNCTION public.staff_dtr_row(r public.staff_time_records)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT (to_jsonb(r)-ARRAY['clock_in_request_id','clock_out_request_id','staff_auth_user_id','created_by'])||jsonb_build_object(
  'staff_name',(SELECT coalesce(nullif(btrim(concat_ws(' ',a.first_name,a.last_name)),''),'Staff #'||a.admin_id) FROM public.admin a WHERE a.admin_id=r.staff_admin_id),
  'recorded_seconds',CASE WHEN r.time_out IS NULL THEN NULL ELSE floor(extract(epoch FROM r.time_out-r.time_in))::bigint END,
  'change_count',(SELECT count(*) FROM public.staff_time_corrections c WHERE c.record_id=r.record_id),
  'last_reason',(SELECT c.reason FROM public.staff_time_corrections c WHERE c.record_id=r.record_id ORDER BY c.correction_id DESC LIMIT 1))
$fn$;
REVOKE ALL ON FUNCTION public.staff_dtr_row(public.staff_time_records) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_staff_attendance()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE staff bigint; current_time_at timestamptz:=clock_timestamp(); result jsonb;
BEGIN
 staff:=public.current_attendance_staff_id();
 IF staff IS NULL THEN RAISE EXCEPTION 'Active Staff access is required to record attendance.' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('staff_admin_id',staff,'server_now',current_time_at,'today',(current_time_at AT TIME ZONE 'Asia/Manila')::date,
  'open_record',(SELECT public.staff_dtr_row(r) FROM public.staff_time_records r WHERE r.staff_admin_id=staff AND r.staff_auth_user_id=auth.uid() AND r.time_out IS NULL),
  'latest_record',(SELECT public.staff_dtr_row(r) FROM public.staff_time_records r WHERE r.staff_admin_id=staff AND r.staff_auth_user_id=auth.uid() ORDER BY r.time_in DESC,r.record_id DESC LIMIT 1),
  'today_recorded_seconds',coalesce((SELECT sum(floor(extract(epoch FROM r.time_out-r.time_in)))::bigint FROM public.staff_time_records r
   WHERE r.staff_admin_id=staff AND r.staff_auth_user_id=auth.uid() AND r.work_date=(current_time_at AT TIME ZONE 'Asia/Manila')::date AND r.time_out IS NOT NULL),0)) INTO result;
 RETURN result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.staff_time_in(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE staff bigint; existing public.staff_time_records%ROWTYPE;
BEGIN
 staff:=public.current_attendance_staff_id();
 IF staff IS NULL THEN RAISE EXCEPTION 'Active Staff access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A time-in request ID is required.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.admin WHERE admin_id=staff AND auth_user_id=auth.uid() AND status='active' AND role='admin' FOR UPDATE;
 IF NOT FOUND OR public.current_attendance_staff_id() IS DISTINCT FROM staff THEN RAISE EXCEPTION 'Staff access changed. Sign in again.' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.staff_time_records WHERE clock_in_request_id=p_request_id;
 IF FOUND THEN
  IF existing.staff_admin_id<>staff OR existing.staff_auth_user_id<>auth.uid() OR existing.entry_source<>'clock' THEN RAISE EXCEPTION 'This request ID is unavailable.' USING ERRCODE='23505'; END IF;
  RETURN public.get_my_staff_attendance()||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.staff_time_records WHERE staff_admin_id=staff AND time_out IS NULL) THEN
  RAISE EXCEPTION 'You already have an open attendance session. Refresh and use Time Out.' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.staff_time_records(staff_admin_id,staff_auth_user_id,time_in,entry_source,clock_in_request_id,created_by)
 VALUES(staff,auth.uid(),clock_timestamp(),'clock',p_request_id,auth.uid());
 RETURN public.get_my_staff_attendance()||jsonb_build_object('replayed',false);
END
$fn$;

CREATE OR REPLACE FUNCTION public.staff_time_out(p_record_id bigint,p_expected_version integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE staff bigint; r public.staff_time_records%ROWTYPE;
BEGIN
 staff:=public.current_attendance_staff_id();
 IF staff IS NULL THEN RAISE EXCEPTION 'Active Staff access is required.' USING ERRCODE='42501'; END IF;
 IF p_record_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Reload the current attendance session.' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.admin WHERE admin_id=staff AND auth_user_id=auth.uid() AND status='active' AND role='admin' FOR UPDATE;
 IF NOT FOUND OR public.current_attendance_staff_id() IS DISTINCT FROM staff THEN RAISE EXCEPTION 'Staff access changed. Sign in again.' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.staff_time_records WHERE record_id=p_record_id AND staff_admin_id=staff AND staff_auth_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Your attendance session is unavailable.' USING ERRCODE='42501'; END IF;
 IF r.time_out IS NOT NULL AND r.clock_out_request_id=p_request_id THEN RETURN public.get_my_staff_attendance()||jsonb_build_object('replayed',true); END IF;
 IF r.time_out IS NOT NULL OR r.version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'Attendance changed or was already timed out. Refresh and review it before retrying.' USING ERRCODE='40001';
 END IF;
 UPDATE public.staff_time_records SET time_out=clock_timestamp(),clock_out_request_id=p_request_id,version=version+1,updated_at=clock_timestamp() WHERE record_id=r.record_id;
 RETURN public.get_my_staff_attendance()||jsonb_build_object('replayed',false);
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_staff_daily_time_records(p_month date DEFAULT NULL,p_staff_id bigint DEFAULT NULL,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE staff bigint; owner boolean:=public.is_super_admin(); result jsonb; month_start date;
BEGIN
 staff:=public.current_attendance_staff_id();
 IF NOT owner AND staff IS NULL THEN RAISE EXCEPTION 'Clinic attendance access is required.' USING ERRCODE='42501'; END IF;
 IF NOT owner AND p_staff_id IS NOT NULL AND p_staff_id<>staff THEN RAISE EXCEPTION 'Staff can view only their own attendance.' USING ERRCODE='42501'; END IF;
 IF NOT owner THEN p_staff_id:=staff; END IF;
 month_start:=coalesce(p_month,date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Manila')::date);
 IF month_start<>date_trunc('month',month_start::timestamp)::date OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN
  RAISE EXCEPTION 'Choose a valid attendance month and page.' USING ERRCODE='22023';
 END IF;
 WITH filtered AS (SELECT r.* FROM public.staff_time_records r WHERE r.work_date>=month_start AND r.work_date<(month_start+interval '1 month')::date
  AND (p_staff_id IS NULL OR r.staff_admin_id=p_staff_id) AND (owner OR r.staff_auth_user_id=auth.uid())),
 paged AS (SELECT * FROM filtered ORDER BY time_in DESC,record_id DESC LIMIT 20 OFFSET (p_page-1)*20)
 SELECT jsonb_build_object('month',month_start,'page',p_page,'page_size',20,'server_now',clock_timestamp(),
  'staff_admin_id',staff,'is_owner',owner,'selected_staff_id',p_staff_id,
  'total',(SELECT count(*) FROM filtered),'summary',(SELECT jsonb_build_object(
   'recorded_seconds',coalesce(sum(CASE WHEN time_out IS NOT NULL THEN floor(extract(epoch FROM time_out-time_in)) ELSE 0 END)::bigint,0),
   'closed_sessions',count(*) FILTER(WHERE time_out IS NOT NULL),'open_sessions',count(*) FILTER(WHERE time_out IS NULL),
   'days_recorded',count(DISTINCT (staff_admin_id,work_date))) FROM filtered),
  'rows',coalesce((SELECT jsonb_agg(public.staff_dtr_row(r::public.staff_time_records) ORDER BY r.time_in DESC,r.record_id DESC) FROM paged r),'[]'::jsonb),
  'staff',CASE WHEN owner THEN coalesce((SELECT jsonb_agg(jsonb_build_object('admin_id',a.admin_id,'name',coalesce(nullif(btrim(concat_ws(' ',a.first_name,a.last_name)),''),'Staff #'||a.admin_id),'status',a.status,'linked',a.auth_user_id IS NOT NULL) ORDER BY a.first_name,a.last_name,a.admin_id) FROM public.admin a WHERE a.role='admin'),'[]'::jsonb) ELSE '[]'::jsonb END) INTO result;
 RETURN result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.save_staff_time_record(p_record_id bigint,p_staff_id bigint,p_expected_version integer,p_time_in timestamptz,p_time_out timestamptz,p_reason text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r public.staff_time_records%ROWTYPE; a public.admin%ROWTYPE; audit public.staff_time_corrections%ROWTYPE; saved bigint; new_version integer;
BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only the Owner can add or correct attendance.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_staff_id IS NULL OR p_time_in IS NULL OR NOT isfinite(p_time_in) OR p_time_in>clock_timestamp()
  OR (p_time_out IS NOT NULL AND (NOT isfinite(p_time_out) OR p_time_out<p_time_in OR p_time_out>clock_timestamp()))
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
  RAISE EXCEPTION 'Enter valid past/present Philippine times and a correction reason of 3 to 1000 characters.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO a FROM public.admin WHERE admin_id=p_staff_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff profile is unavailable.' USING ERRCODE='42501'; END IF;
 SELECT * INTO audit FROM public.staff_time_corrections WHERE request_id=p_request_id;
 IF FOUND THEN
  IF audit.record_id IS DISTINCT FROM coalesce(p_record_id,audit.record_id) OR audit.corrected_by<>auth.uid()
   OR audit.new_time_in IS DISTINCT FROM p_time_in OR audit.new_time_out IS DISTINCT FROM p_time_out OR audit.reason<>btrim(p_reason)
   OR NOT EXISTS(SELECT 1 FROM public.staff_time_records WHERE record_id=audit.record_id AND staff_admin_id=p_staff_id)
   OR (p_record_id IS NULL AND audit.action<>'create') OR (p_record_id IS NOT NULL AND audit.action<>'correct') THEN
   RAISE EXCEPTION 'This attendance request was already used. Refresh and review the records.' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('record_id',audit.record_id,'version',audit.version_after);
 END IF;
 IF p_record_id IS NULL THEN
  IF p_expected_version IS NOT NULL OR a.role<>'admin' OR a.auth_user_id IS NULL THEN RAISE EXCEPTION 'Choose a linked Staff account for the manual entry.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.staff_time_records(staff_admin_id,staff_auth_user_id,time_in,time_out,entry_source,clock_in_request_id,created_by)
  VALUES(a.admin_id,a.auth_user_id,p_time_in,p_time_out,'owner',p_request_id,auth.uid()) RETURNING record_id,version INTO saved,new_version;
  INSERT INTO public.staff_time_corrections(record_id,action,new_time_in,new_time_out,reason,corrected_by,version_after,request_id)
  VALUES(saved,'create',p_time_in,p_time_out,btrim(p_reason),auth.uid(),new_version,p_request_id);
 ELSE
  SELECT * INTO r FROM public.staff_time_records WHERE record_id=p_record_id AND staff_admin_id=p_staff_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance record is unavailable.' USING ERRCODE='42501'; END IF;
  IF r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Attendance changed. Close this form, refresh and review the latest entry.' USING ERRCODE='40001'; END IF;
  IF r.time_in IS NOT DISTINCT FROM p_time_in AND r.time_out IS NOT DISTINCT FROM p_time_out THEN RAISE EXCEPTION 'Change a time before saving a correction.' USING ERRCODE='22023'; END IF;
  UPDATE public.staff_time_records SET time_in=p_time_in,time_out=p_time_out,version=version+1,updated_at=clock_timestamp() WHERE record_id=r.record_id RETURNING record_id,version INTO saved,new_version;
  INSERT INTO public.staff_time_corrections(record_id,action,old_time_in,old_time_out,new_time_in,new_time_out,reason,corrected_by,version_after,request_id)
  VALUES(saved,'correct',r.time_in,r.time_out,p_time_in,p_time_out,btrim(p_reason),auth.uid(),new_version,p_request_id);
 END IF;
 RETURN jsonb_build_object('record_id',saved,'version',new_version);
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_staff_time_corrections(p_record_id bigint,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only the Owner can review correction history.' USING ERRCODE='42501'; END IF;
 IF p_record_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Choose a valid record and page.' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('record_id',p_record_id,'page',p_page,'page_size',20,'total',(SELECT count(*) FROM public.staff_time_corrections WHERE record_id=p_record_id),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(c)-ARRAY['request_id','corrected_by'] ORDER BY c.correction_id DESC) FROM (SELECT * FROM public.staff_time_corrections WHERE record_id=p_record_id ORDER BY correction_id DESC LIMIT 20 OFFSET (p_page-1)*20) c),'[]'::jsonb)) INTO result;
 RETURN result;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_my_staff_attendance(),public.staff_time_in(uuid),public.staff_time_out(bigint,integer,uuid),public.get_staff_daily_time_records(date,bigint,integer),public.save_staff_time_record(bigint,bigint,integer,timestamptz,timestamptz,text,uuid),public.get_staff_time_corrections(bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_attendance(),public.staff_time_in(uuid),public.staff_time_out(bigint,integer,uuid),public.get_staff_daily_time_records(date,bigint,integer),public.save_staff_time_record(bigint,bigint,integer,timestamptz,timestamptz,text,uuid),public.get_staff_time_corrections(bigint,integer) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT to_regprocedure('public.staff_time_in(uuid)') IS NOT NULL AS staff_attendance_ready;
