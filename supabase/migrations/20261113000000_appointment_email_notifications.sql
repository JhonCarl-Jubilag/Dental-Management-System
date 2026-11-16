-- Automatic appointment emails. Install the matching Edge Function first.
-- Delivery starts disabled. Configure the two URLs and enable only after review.
-- Existing appointment, patient, billing, treatment and Auth records are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE SCHEMA IF NOT EXISTS clinic_email_private;
REVOKE ALL ON SCHEMA clinic_email_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS clinic_email_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  app_url text NOT NULL DEFAULT '',
  worker_url text NOT NULL DEFAULT '',
  worker_secret_id uuid NOT NULL,
  paused_until timestamptz
);
ALTER TABLE clinic_email_private.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinic_email_private.settings FROM PUBLIC, anon, authenticated, service_role;

DO $setup$
DECLARE secret_id uuid;
BEGIN
  IF to_regclass('public.appointments') IS NULL OR to_regprocedure('public.current_patient_id()') IS NULL THEN
    RAISE EXCEPTION 'Install the patient isolation and appointment scheduling updates first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clinic_email_private.settings) THEN
    SELECT id INTO secret_id FROM vault.secrets WHERE name = 'clinic_appointment_email_worker' LIMIT 1;
    IF secret_id IS NULL THEN
      SELECT vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        'clinic_appointment_email_worker', 'Private scheduler authentication for appointment emails') INTO secret_id;
    END IF;
    INSERT INTO clinic_email_private.settings(worker_secret_id) VALUES (secret_id);
  END IF;
END $setup$;

CREATE TABLE IF NOT EXISTS public.appointment_email_queue (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id bigint NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN
    ('booking_received','appointment_confirmed','appointment_rescheduled','appointment_cancelled','change_requested','change_declined','reminder_24h')),
  snapshot jsonb NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','accepted','skipped','failed','needs_review')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  accepted_at timestamptz,
  provider_message_id text,
  failure_code text
);
-- No cascading foreign key: deleting an appointment retains notification history.
CREATE INDEX IF NOT EXISTS appointment_email_due_idx ON public.appointment_email_queue(due_at, created_at)
  WHERE status IN ('pending','retry','processing');
CREATE INDEX IF NOT EXISTS appointment_email_appointment_idx ON public.appointment_email_queue(appointment_id, created_at DESC);
ALTER TABLE public.appointment_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_email_queue FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.appointment_email_snapshot(a public.appointments)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $fn$
  SELECT jsonb_build_object('patient_id', a.patient_id, 'doctor_id', a.doctor_id, 'service_id', a.service_id,
    'time', extract(epoch FROM a.appointment_datetime), 'status', a.status::text,
    'request_type', a.request_type, 'request_status', a.request_status, 'request_time', extract(epoch FROM a.request_new_datetime));
$fn$;
REVOKE ALL ON FUNCTION public.appointment_email_snapshot(public.appointments) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_appointment_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE state jsonb; kind text; enabled_now boolean; at_time timestamptz := statement_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.appointment_email_queue SET status = 'skipped', failure_code = 'appointment_deleted'
      WHERE appointment_id = OLD.appointment_id AND status IN ('pending','retry');
    RETURN NULL;
  END IF;
  state := public.appointment_email_snapshot(NEW);
  IF TG_OP = 'UPDATE' THEN
    IF state = public.appointment_email_snapshot(OLD) THEN RETURN NULL; END IF;
    UPDATE public.appointment_email_queue SET status = 'skipped', failure_code = 'appointment_changed'
      WHERE appointment_id = NEW.appointment_id AND status IN ('pending','retry') AND snapshot IS DISTINCT FROM state;
  END IF;
  SELECT enabled INTO enabled_now FROM clinic_email_private.settings WHERE singleton;
  IF NOT coalesce(enabled_now, false) OR NEW.appointment_datetime <= at_time THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    kind := CASE NEW.status::text WHEN 'pending' THEN 'booking_received' WHEN 'confirmed' THEN 'appointment_confirmed' END;
  ELSE
    kind := CASE
      WHEN NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN 'appointment_cancelled'
      WHEN NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM NEW.status THEN 'appointment_confirmed'
      WHEN NEW.status IN ('pending','confirmed') AND (NEW.appointment_datetime IS DISTINCT FROM OLD.appointment_datetime
        OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.service_id IS DISTINCT FROM OLD.service_id
        OR NEW.patient_id IS DISTINCT FROM OLD.patient_id) THEN 'appointment_rescheduled'
      WHEN NEW.status = 'confirmed' AND NEW.request_status = 'pending' AND
        (OLD.request_status IS DISTINCT FROM NEW.request_status OR OLD.request_type IS DISTINCT FROM NEW.request_type
          OR OLD.request_new_datetime IS DISTINCT FROM NEW.request_new_datetime) THEN 'change_requested'
      WHEN NEW.status = 'confirmed' AND OLD.request_status = 'pending' AND NEW.request_status IS DISTINCT FROM OLD.request_status THEN 'change_declined'
    END;
  END IF;
  IF kind IS NOT NULL THEN
    INSERT INTO public.appointment_email_queue(appointment_id, event_kind, snapshot, dedupe_key, expires_at)
      VALUES (NEW.appointment_id, kind, state, gen_random_uuid()::text, least(NEW.appointment_datetime, at_time + interval '24 hours'));
  END IF;
  -- Confirmations made with less than 24 hours' notice get the confirmation,
  -- without a second, immediate "24-hour" reminder.
  IF NEW.status = 'confirmed' AND NEW.request_status IS DISTINCT FROM 'pending'
      AND NEW.appointment_datetime > at_time + interval '24 hours' THEN
    INSERT INTO public.appointment_email_queue(appointment_id, event_kind, snapshot, dedupe_key, due_at, expires_at)
      VALUES (NEW.appointment_id, 'reminder_24h', state, md5('reminder:' || NEW.appointment_id::text || ':' || state::text),
        NEW.appointment_datetime - interval '24 hours', NEW.appointment_datetime - interval '22 hours')
      ON CONFLICT (dedupe_key) DO UPDATE SET status = 'pending', failure_code = NULL,
        attempts = 0, first_attempt_at = NULL, due_at = EXCLUDED.due_at, expires_at = EXCLUDED.expires_at
        WHERE appointment_email_queue.status = 'skipped' AND appointment_email_queue.failure_code = 'appointment_changed';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.queue_appointment_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS queue_appointment_email ON public.appointments;
CREATE TRIGGER queue_appointment_email AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.queue_appointment_email();

CREATE OR REPLACE FUNCTION public.check_appointment_email_worker(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  SELECT length(p_token) = 64 AND EXISTS (
    SELECT 1 FROM clinic_email_private.settings s JOIN vault.decrypted_secrets v ON v.id = s.worker_secret_id
      WHERE s.singleton AND v.decrypted_secret = p_token);
$fn$;
REVOKE ALL ON FUNCTION public.check_appointment_email_worker(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_appointment_email_worker(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_appointment_emails(p_token text, p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE claimed jsonb;
BEGIN
  IF NOT coalesce(public.check_appointment_email_worker(p_token), false) THEN
    RAISE EXCEPTION 'Invalid email worker authentication.' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Invalid batch size.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clinic_email_private.settings WHERE singleton AND enabled AND
    (paused_until IS NULL OR paused_until <= now())) THEN RETURN '[]'::jsonb; END IF;
  UPDATE public.appointment_email_queue SET status = 'skipped', failure_code = 'notification_expired'
    WHERE status IN ('pending','retry') AND expires_at <= now();
  -- An expired lease may have sent a message before losing the database reply.
  -- Retry with the SAME provider key only within Brevo's 30-minute window.
  UPDATE public.appointment_email_queue SET status = 'needs_review', failure_code = 'acceptance_unconfirmed',
    lease_token = NULL, lease_until = NULL
    WHERE (status = 'processing' AND lease_until < now() OR status = 'retry')
      AND first_attempt_at < now() - interval '25 minutes';
  WITH chosen AS (
    SELECT notification_id FROM public.appointment_email_queue
      WHERE (status IN ('pending','retry') OR status = 'processing' AND lease_until < now())
        AND due_at <= now() AND expires_at > now() AND attempts < 5
      ORDER BY due_at, created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), moved AS (
    UPDATE public.appointment_email_queue q SET status = 'processing', lease_token = gen_random_uuid(),
      lease_until = now() + interval '2 minutes', attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, now())
      FROM chosen c WHERE q.notification_id = c.notification_id
      RETURNING q.notification_id, q.lease_token
  ) SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO claimed FROM moved m;
  UPDATE public.appointment_email_queue SET status = 'needs_review', failure_code = 'retry_limit'
    WHERE status = 'retry' AND attempts >= 5;
  RETURN claimed;
END $fn$;
REVOKE ALL ON FUNCTION public.claim_appointment_emails(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_appointment_emails(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_appointment_email(p_token text, p_notification_id uuid, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE q public.appointment_email_queue%ROWTYPE; a public.appointments%ROWTYPE;
  recipient text; dentist text; site_url text; reason text;
BEGIN
  IF NOT coalesce(public.check_appointment_email_worker(p_token), false) THEN
    RAISE EXCEPTION 'Invalid email worker authentication.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.appointment_email_queue WHERE notification_id = p_notification_id
    AND status = 'processing' AND lease_token = p_lease_token AND lease_until > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM clinic_email_private.settings WHERE singleton AND enabled) THEN
    UPDATE public.appointment_email_queue SET status = 'retry', due_at = now() + interval '1 minute',
      lease_token = NULL, lease_until = NULL WHERE notification_id = q.notification_id;
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM public.appointments WHERE appointment_id = q.appointment_id;
  IF NOT FOUND THEN reason := 'appointment_deleted';
  ELSIF public.appointment_email_snapshot(a) IS DISTINCT FROM q.snapshot THEN reason := 'appointment_changed';
  ELSIF q.expires_at <= now() OR a.appointment_datetime <= now() THEN reason := 'notification_expired';
  ELSIF q.event_kind = 'reminder_24h' AND (a.status <> 'confirmed' OR a.request_status = 'pending') THEN reason := 'reminder_no_longer_valid';
  END IF;
  IF reason IS NULL THEN
    SELECT lower(btrim(u.email)) INTO recipient FROM public.patients p JOIN auth.users u ON u.id = p.auth_user_id
      WHERE p.patient_id = a.patient_id AND p.status = 'active' AND u.email_confirmed_at IS NOT NULL
        AND lower(btrim(u.email)) = lower(btrim(p.email)) AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND coalesce(u.raw_app_meta_data->>'clinic_provider_login_retired', 'false') <> 'true'
        AND NOT EXISTS (SELECT 1 FROM public.admin c WHERE c.auth_user_id = u.id);
    IF recipient IS NULL THEN reason := 'patient_email_not_verified'; END IF;
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE public.appointment_email_queue SET status = 'skipped', failure_code = reason, lease_token = NULL, lease_until = NULL
      WHERE notification_id = q.notification_id;
    RETURN NULL;
  END IF;
  SELECT app_url INTO site_url FROM clinic_email_private.settings WHERE singleton;
  SELECT btrim(concat_ws(' ', first_name, last_name)) INTO dentist FROM public.doctors WHERE doctor_id = a.doctor_id;
  RETURN jsonb_build_object('notification_id', q.notification_id, 'event_kind', q.event_kind, 'recipient', recipient,
    'appointment_id', a.appointment_id, 'appointment_datetime', a.appointment_datetime, 'appointment_status', a.status::text,
    'request_type', CASE WHEN q.event_kind = 'change_declined' THEN q.snapshot->>'request_type' ELSE a.request_type END,
    'doctor_name', coalesce(nullif(dentist, ''), 'Your clinic dentist'), 'app_url', site_url);
END $fn$;
REVOKE ALL ON FUNCTION public.prepare_appointment_email(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_appointment_email(text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_appointment_email(p_token text, p_notification_id uuid, p_lease_token uuid,
  p_outcome text, p_code text DEFAULT NULL, p_message_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE q public.appointment_email_queue%ROWTYPE;
BEGIN
  IF NOT coalesce(public.check_appointment_email_worker(p_token), false) THEN
    RAISE EXCEPTION 'Invalid email worker authentication.' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','retry','failed','needs_review') OR length(coalesce(p_code, '')) > 80
    OR length(coalesce(p_message_id, '')) > 500 THEN RAISE EXCEPTION 'Invalid email result.'; END IF;
  SELECT * INTO q FROM public.appointment_email_queue WHERE notification_id = p_notification_id
    AND status = 'processing' AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.appointment_email_queue SET status = CASE WHEN p_outcome = 'retry' AND attempts >= 5 THEN 'needs_review' ELSE p_outcome END,
    due_at = CASE WHEN p_outcome = 'retry' THEN now() + interval '2 minutes' * greatest(1, attempts) ELSE due_at END,
    accepted_at = CASE WHEN p_outcome = 'accepted' THEN now() ELSE NULL END,
    provider_message_id = p_message_id, failure_code = p_code, lease_token = NULL, lease_until = NULL
    WHERE notification_id = q.notification_id;
  IF p_code IN ('provider_auth','provider_access','provider_quota') THEN
    UPDATE clinic_email_private.settings SET paused_until = now() + interval '1 hour' WHERE singleton;
  END IF;
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.finish_appointment_email(text,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_appointment_email(text,uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_appointment_emails()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE settings_row clinic_email_private.settings%ROWTYPE; token text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(184562391, 721) THEN RETURN; END IF;
  SELECT * INTO settings_row FROM clinic_email_private.settings WHERE singleton;
  IF NOT FOUND OR settings_row.enabled IS NOT TRUE OR settings_row.paused_until > now() THEN RETURN; END IF;
  IF settings_row.worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/process-appointment-emails$'
    OR settings_row.app_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' THEN
    RAISE WARNING 'Appointment email URLs need configuration. Nothing was sent.'; RETURN;
  END IF;
  -- Schedule reminders for existing FUTURE appointments, without backfilling
  -- old booking/confirmation emails or sending immediate late reminders.
  INSERT INTO public.appointment_email_queue(appointment_id, event_kind, snapshot, dedupe_key, due_at, expires_at)
    SELECT a.appointment_id, 'reminder_24h', public.appointment_email_snapshot(a),
      md5('reminder:' || a.appointment_id::text || ':' || public.appointment_email_snapshot(a)::text),
      a.appointment_datetime - interval '24 hours', a.appointment_datetime - interval '22 hours'
    FROM public.appointments a WHERE a.status = 'confirmed' AND a.request_status IS DISTINCT FROM 'pending'
      AND a.appointment_datetime > now() + interval '24 hours' AND a.appointment_datetime <= now() + interval '7 days'
    ON CONFLICT (dedupe_key) DO UPDATE SET status = 'pending', failure_code = NULL,
        attempts = 0, first_attempt_at = NULL, due_at = EXCLUDED.due_at, expires_at = EXCLUDED.expires_at
        WHERE appointment_email_queue.status = 'skipped' AND appointment_email_queue.failure_code = 'appointment_changed';
  IF NOT EXISTS (SELECT 1 FROM public.appointment_email_queue WHERE
    (status IN ('pending','retry') OR status = 'processing' AND lease_until < now()) AND due_at <= now()) THEN RETURN; END IF;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE id = settings_row.worker_secret_id;
  IF token IS NULL THEN RAISE WARNING 'Appointment email worker authentication is missing.'; RETURN; END IF;
  PERFORM net.http_post(url := settings_row.worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-clinic-email-job', token),
    body := '{}'::jsonb, timeout_milliseconds := 45000);
END $fn$;
REVOKE ALL ON FUNCTION public.dispatch_appointment_emails() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('clinic-appointment-emails', '* * * * *', 'SELECT public.dispatch_appointment_emails();');
COMMIT;
NOTIFY pgrst, 'reload schema';
-- Activation is a separate, reviewable step. Populate app_url and worker_url,
-- then set enabled=true in clinic_email_private.settings using SQL Editor.

