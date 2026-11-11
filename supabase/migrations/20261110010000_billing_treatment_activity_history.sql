-- Extend the Owner's Activity History after the appointment activity migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $check$
BEGIN
  IF to_regclass('public.clinic_activity_log') IS NULL THEN
    RAISE EXCEPTION 'Apply the appointment activity history migration before this update.';
  END IF;
END
$check$;

CREATE INDEX IF NOT EXISTS clinic_activity_time_idx
  ON public.clinic_activity_log (occurred_at DESC, activity_id DESC);

CREATE OR REPLACE FUNCTION public.record_billing_treatment_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  actor_kind text := public.current_clinic_role();
  actor_id uuid := auth.uid();
  display_name text;
  record_key bigint;
  event_resource text;
  event_action text;
  changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF actor_kind IS NULL OR actor_kind NOT IN ('admin', 'super_admin') THEN
    RETURN NULL;
  END IF;

  IF TG_RELID = 'public.billing'::regclass THEN
    event_resource := 'billing';
    record_key := NEW.billing_id;
    IF TG_OP = 'INSERT' THEN
      event_action := 'billing_created';
      IF NEW.amount_paid > 0 THEN changed_fields := ARRAY['initial_payment']; END IF;
    ELSE
      changed_fields := array_remove(ARRAY[
        CASE WHEN NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN 'charges' END,
        CASE WHEN NEW.discount IS DISTINCT FROM OLD.discount THEN 'discount' END,
        CASE WHEN NEW.discount_id_no IS DISTINCT FROM OLD.discount_id_no THEN 'discount_reference' END,
        CASE WHEN NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN 'amount_paid' END,
        CASE WHEN NEW.balance IS DISTINCT FROM OLD.balance THEN 'balance' END,
        CASE WHEN NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN 'payment_method' END,
        CASE WHEN NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN 'payment_reference' END,
        CASE WHEN NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN 'payment_date' END,
        CASE WHEN NEW.remarks IS DISTINCT FROM OLD.remarks THEN 'billing_remarks' END,
        CASE WHEN coalesce(NEW.archived, false) <> coalesce(OLD.archived, false) THEN 'archive_status' END,
        CASE WHEN ROW(NEW.appointment_id, NEW.patient_id, NEW.doctor_id)
          IS DISTINCT FROM ROW(OLD.appointment_id, OLD.patient_id, OLD.doctor_id) THEN 'record_link' END
      ], NULL);
      event_action := CASE
        WHEN coalesce(NEW.archived, false) AND NOT coalesce(OLD.archived, false) THEN 'billing_archived'
        WHEN NOT coalesce(NEW.archived, false) AND coalesce(OLD.archived, false) THEN 'billing_restored'
        WHEN NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
          AND NOT (changed_fields && ARRAY['charges', 'discount', 'record_link'])
          THEN CASE WHEN coalesce(NEW.amount_paid, 0) > coalesce(OLD.amount_paid, 0)
            THEN 'billing_payment_increased' ELSE 'billing_payment_adjusted' END
        ELSE 'billing_updated'
      END;
    END IF;
  ELSIF TG_RELID = 'public.treatment_records'::regclass THEN
    event_resource := 'treatment';
    record_key := NEW.treatment_id;
    IF TG_OP = 'INSERT' THEN
      event_action := 'treatment_created';
    ELSE
      event_action := 'treatment_updated';
      changed_fields := array_remove(ARRAY[
        CASE WHEN NEW.procedure_name IS DISTINCT FROM OLD.procedure_name THEN 'procedure' END,
        CASE WHEN ROW(NEW.tooth_scope, NEW.tooth_numbers)
          IS DISTINCT FROM ROW(OLD.tooth_scope, OLD.tooth_numbers) THEN 'tooth_selection' END,
        CASE WHEN NEW.treated_at IS DISTINCT FROM OLD.treated_at THEN 'treatment_time' END,
        CASE WHEN NEW.notes IS DISTINCT FROM OLD.notes THEN 'treatment_notes' END,
        CASE WHEN ROW(NEW.patient_id, NEW.appointment_id, NEW.doctor_id, NEW.service_id, NEW.billing_id)
          IS DISTINCT FROM ROW(OLD.patient_id, OLD.appointment_id, OLD.doctor_id, OLD.service_id, OLD.billing_id) THEN 'record_link' END
      ], NULL);
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  -- Store names of changed fields only. Clinical text, payment values and
  -- payment/discount references remain in their original records.
  IF TG_OP = 'UPDATE' AND cardinality(changed_fields) = 0 THEN RETURN NULL; END IF;
  SELECT nullif(btrim(concat_ws(' ', first_name, last_name)), '') INTO display_name
    FROM public.admin WHERE auth_user_id = actor_id;

  INSERT INTO public.clinic_activity_log (actor_auth_user_id, actor_name, actor_role, resource_type, record_id, action, changes)
  VALUES (
    actor_id, coalesce(display_name, CASE WHEN actor_kind = 'super_admin' THEN 'Owner' ELSE 'Staff' END),
    actor_kind, event_resource, record_key, event_action,
    jsonb_strip_nulls(jsonb_build_object('appointment_id', NEW.appointment_id, 'fields', changed_fields))
  );
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.record_billing_treatment_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_billing_activity ON public.billing;
CREATE TRIGGER record_billing_activity AFTER INSERT OR UPDATE ON public.billing
  FOR EACH ROW EXECUTE FUNCTION public.record_billing_treatment_activity();

DROP TRIGGER IF EXISTS record_treatment_activity ON public.treatment_records;
CREATE TRIGGER record_treatment_activity AFTER INSERT OR UPDATE ON public.treatment_records
  FOR EACH ROW EXECUTE FUNCTION public.record_billing_treatment_activity();

COMMIT;
