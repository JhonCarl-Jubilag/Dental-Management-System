import { clinicDateTime, toClinicDateTimeInput } from '../utils/clinicScheduling';

const idIsValid = value => /^[1-9]\d*$/.test(String(value ?? ''));
const migrationError = error => ['PGRST202', '42P01', '42883'].includes(error?.code);
const callTreatmentRPC = async (client, name, params) => {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    const failure = new Error(migrationError(error) ? 'The Treatment Records database update is not installed yet. Contact the Owner.'
      : error.message || 'Could not complete the treatment request. Refresh the records before retrying.');
    failure.code = error.code;
    throw failure;
  }
  return data;
};

const checkedPage = (data, patientId, page) => {
  if (!data || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || data.total < 0
    || data.page !== page || data.page_size !== 10 || data.rows.length > 10
    || data.rows.some(row => String(row.patient_id) !== String(patientId) || !idIsValid(row.appointment_id))) {
    throw new Error('Could not verify this patient’s treatment records. Please refresh.');
  }
  for (const row of data.rows) {
    const values = [row.amount_charged, row.amount_paid, row.balance].map(value => value == null ? NaN : Number(value));
    const [charged, paid, balance] = values.map(value => Math.round(value * 100));
    if (values.some(value => !Number.isFinite(value) || value < 0) || charged - paid !== balance) {
      throw new Error('The linked bill has inconsistent amounts. Review it in Billing.');
    }
  }
  return data;
};
export const readPatientTreatments = async (client, patientId, page = 1) => checkedPage(
  await callTreatmentRPC(client, 'list_patient_treatments', { p_patient_id: patientId, p_page: page }), patientId, page);
export const readTreatmentOptions = async (client, patientId, page = 1) => checkedPage(
  await callTreatmentRPC(client, 'patient_treatment_options', { p_patient_id: patientId, p_page: page }), patientId, page);

// Printing includes every page. Re-read the complete set to detect concurrent
// entries, edits or payment changes rather than exporting an incomplete/mixed list.
export const readAllPatientTreatments = async (client, patientId, isCurrent = () => true) => {
  const current = () => { if (!isCurrent()) throw new Error('Treatment printing was cancelled.'); };
  const read = async () => {
    const rows = [], ids = new Set(), bills = new Set(), appointments = new Set();
    let total;
    for (let page = 1; ; page += 1) {
      current();
      const data = await readPatientTreatments(client, patientId, page);
      current();
      if (total === undefined) total = data.total;
      if (data.total !== total || data.rows.length !== Math.min(10, Math.max(0, total - (page - 1) * 10))) {
        throw new Error('Treatment records changed while loading. Refresh and print again.');
      }
      for (const row of data.rows) {
        if (!idIsValid(row.treatment_id) || !idIsValid(row.billing_id) || ids.has(String(row.treatment_id))
          || bills.has(String(row.billing_id)) || appointments.has(String(row.appointment_id))
          || !Number.isFinite(Date.parse(row.treated_at)) || typeof row.procedure_name !== 'string'
          || typeof row.notes !== 'string' || !Array.isArray(row.tooth_numbers)) {
          throw new Error('Could not verify the complete treatment record. Refresh before printing.');
        }
        ids.add(String(row.treatment_id)); bills.add(String(row.billing_id)); appointments.add(String(row.appointment_id)); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
  };
  const first = await read(), second = await read();
  current();
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Treatment records or payments changed while loading. Refresh and print again.');
  return second.sort((a, b) => Date.parse(a.treated_at) - Date.parse(b.treated_at)
    || String(a.treatment_id).localeCompare(String(b.treatment_id), 'en', { numeric: true }));
};

export const parseTreatmentTeeth = (scope, text) => {
  if (!['specific', 'whole_mouth', 'not_applicable'].includes(scope)) throw new Error('Choose a treatment scope.');
  if (scope !== 'specific') return [];
  if (!/^[\d,\s]+$/.test(text || '')) throw new Error('Enter FDI tooth numbers separated by commas, for example 16, 17.');
  const teeth = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!teeth.length || teeth.some(tooth => !Number.isInteger(tooth)
    || !((Math.floor(tooth / 10) >= 1 && Math.floor(tooth / 10) <= 4 && tooth % 10 >= 1 && tooth % 10 <= 8)
      || (Math.floor(tooth / 10) >= 5 && Math.floor(tooth / 10) <= 8 && tooth % 10 >= 1 && tooth % 10 <= 5)))) {
    throw new Error('Use valid FDI tooth numbers: permanent quadrants 1–4 (teeth 1–8), or primary quadrants 5–8 (teeth 1–5).');
  }
  if (new Set(teeth).size !== teeth.length) throw new Error('Each tooth number should appear only once.');
  return teeth.sort((a, b) => a - b);
};

export const savePatientTreatment = async (client, patientId, editor, form) => {
  if (!idIsValid(patientId) || !idIsValid(editor.appointment.appointment_id)) throw new Error('Choose an appointment for this patient.');
  if (!form.procedureName.trim() || form.procedureName.trim().length > 250) throw new Error('Enter a procedure description of at most 250 characters.');
  const teeth = parseTreatmentTeeth(form.scope, form.teeth);
  const [date, time] = form.treatedAt.split('T');
  // The minute-based input must not truncate an unchanged saved timestamp.
  const treatedAt = editor.record && form.treatedAt === toClinicDateTimeInput(editor.record.treated_at)
    ? editor.record.treated_at : clinicDateTime(date, time);
  const data = await callTreatmentRPC(client, 'save_patient_treatment', {
    p_patient_id: patientId, p_appointment_id: editor.appointment.appointment_id,
    p_treatment_id: editor.record?.treatment_id ?? null, p_expected_version: editor.record?.version ?? null,
    p_request_id: editor.requestId ?? null, p_procedure_name: form.procedureName.trim(), p_tooth_scope: form.scope,
    p_tooth_numbers: teeth, p_treated_at: treatedAt, p_notes: form.notes.trim(), p_confirm_performed: form.confirmed,
  });
  if (!idIsValid(data) || (editor.record && String(data) !== String(editor.record.treatment_id))) {
    throw new Error('Save result could not be verified. Refresh this patient’s records before retrying.');
  }
  return data;
};
