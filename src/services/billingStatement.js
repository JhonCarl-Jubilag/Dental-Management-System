import { CLINIC_TIME_ZONE, formatClinicDateTime, getClinicDate } from '../utils/clinicScheduling';

export const STATEMENT_PAYMENT_NOTE = 'Total paid to date combines all payments recorded against this bill. The details below are the latest payment details saved for the bill; they do not describe every payment.';
export const STATEMENT_FOOTNOTE = 'This statement shows the saved billing balance when generated. Please keep it for your records.';
const text = value => String(value ?? '').normalize('NFC').trim();
const one = relation => Array.isArray(relation) ? (relation.length === 1 ? relation[0] : null) : relation;
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const cents = value => {
  if (value == null || value === '' || !['number', 'string'].includes(typeof value)) throw new Error('The bill contains an invalid amount. Review Billing before generating a statement.');
  const number = Number(value), rounded = Math.round((number + Number.EPSILON) * 100);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(rounded) || Math.abs(number * 100 - rounded) > .00001) throw new Error('The bill contains an invalid amount. Review Billing before generating a statement.');
  return rounded;
};
export const formatStatementMoney = value => `₱${(value / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatStatementDate = value => {
  if (!value) return 'Not recorded';
  const input = String(value), date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T12:00:00+08:00` : input);
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  if (/^\d{4}-\d{2}-\d{2}$/.test(input) && getClinicDate(date) !== input) return 'Not recorded';
  return date.toLocaleDateString('en-US', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' });
};
export const getBillingStatus = record => {
  try {
    const gross = cents(record.total_amount), discount = cents(record.discount), paid = cents(record.amount_paid), balance = cents(record.balance);
    if (discount > gross || !Number.isSafeInteger(paid + balance) || gross - discount !== paid + balance) throw new Error('Unreconciled');
    if (balance === 0) return { label: gross === discount ? 'No balance due' : 'Paid', className: 'status-paid' };
    return paid === 0 ? { label: 'Unpaid', className: 'status-pending' } : { label: 'Partially Paid', className: 'status-partial' };
  } catch { return { label: 'Review required', className: 'status-pending' }; }
};

// Explicitly select public statement fields. Internal remarks and discount IDs
// never enter the statement model, preview, PDF or its metadata.
export const BILLING_STATEMENT_FIELDS = 'billing_id, appointment_id, patient_id, doctor_id, total_amount, discount, amount_paid, balance, payment_method, reference_number, payment_date, created_at, archived, patients(patient_id, first_name, last_name), doctors(doctor_id, first_name, last_name), appointments(appointment_id, patient_id, doctor_id, appointment_datetime, services(service_name))';
export const readBillingStatement = async (client, billingId, isCurrent = () => true) => {
  if (!validId(billingId)) throw new Error('Select a valid billing record.');
  const current = () => { if (!isCurrent()) throw new Error('Statement loading was cancelled.'); };
  current();
  const { data, error } = await client.from('billing').select(BILLING_STATEMENT_FIELDS).eq('billing_id', billingId).maybeSingle();
  current();
  if (error) throw new Error('Could not load the latest bill. Please retry.');
  if (!data || String(data.billing_id) !== String(billingId)) throw new Error('This bill is no longer available. Refresh Billing.');
  return data;
};
export const buildBillingStatement = (record, generatedAt = new Date()) => {
  if (!record || !validId(record.billing_id) || !validId(record.patient_id) || !validId(record.appointment_id)) throw new Error('Could not verify this bill. Refresh Billing.');
  const patient = one(record.patients), appointment = one(record.appointments), doctor = one(record.doctors);
  if (!patient || !appointment || String(patient.patient_id) !== String(record.patient_id) || String(appointment.appointment_id) !== String(record.appointment_id) || String(appointment.patient_id) !== String(record.patient_id)
    || (doctor && String(doctor.doctor_id) !== String(record.doctor_id)) || String(appointment.doctor_id ?? '') !== String(record.doctor_id ?? '')) throw new Error('Could not verify the patient and appointment linked to this bill. Refresh Billing.');
  const gross = cents(record.total_amount), discount = cents(record.discount), paid = cents(record.amount_paid), balance = cents(record.balance);
  if (discount > gross || !Number.isSafeInteger(paid + balance) || gross - discount !== paid + balance) throw new Error('The bill totals do not reconcile. Review Billing before generating a statement.');
  const time = new Date(generatedAt);
  if (!Number.isFinite(time.getTime())) throw new Error('Could not determine the statement date.');
  const appointmentTime = new Date(appointment.appointment_datetime), service = one(appointment.services);
  const methods = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', other: 'Other e-Bank', bank_transfer: 'Bank transfer', card: 'Card' };
  const method = text(record.payment_method);
  return {
    number: `BILL-${String(record.billing_id).padStart(6, '0')}`, billingId: Number(record.billing_id), appointmentId: Number(record.appointment_id), patientId: Number(record.patient_id),
    patientName: [text(patient.first_name), text(patient.last_name)].filter(Boolean).join(' ') || 'Name not recorded',
    dentistName: doctor ? `Dr. ${[text(doctor.first_name), text(doctor.last_name)].filter(Boolean).join(' ') || 'Name not recorded'}` : 'Not recorded',
    procedure: text(service?.service_name) || 'Service not recorded',
    appointmentDate: appointment.appointment_datetime && Number.isFinite(appointmentTime.getTime()) ? formatClinicDateTime(appointmentTime) : 'Not recorded',
    issuedDate: formatStatementDate(record.created_at), generatedAt: time.toISOString(), archived: Boolean(record.archived),
    gross, discount, net: gross - discount, paid, balance, status: getBillingStatus(record),
    latestPayment: paid > 0 ? { method: methods[method] || method || 'Not recorded', date: formatStatementDate(record.payment_date), reference: method.toLowerCase() === 'cash' ? null : text(record.reference_number) || 'Not recorded' } : null,
  };
};
export const billingStatementFingerprint = statement => JSON.stringify({ ...statement, generatedAt: undefined });
