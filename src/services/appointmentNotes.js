import { appointmentWriteError } from '../utils/clinicScheduling';

// Earlier requests remain in remarks. Display the reason from the latest
// matching request entry rather than the first "Reason:" anywhere in history.
export const getAppointmentRequestReason = (remarks, type) => {
  const heading = type === 'reschedule' ? '[Reschedule Request - ' : '[Cancellation Request - ';
  const entries = (remarks || '').split(/\r?\n/);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].startsWith(heading)) return entries[index].match(/Reason:\s*(.*)/i)?.[1] || 'N/A';
  }
  return 'N/A';
};

// Patients submit an action and reason; the database retains the clinical notes
// and derives ownership, allowed changes, eligibility and new request status.
export const savePatientAppointmentAction = async (client, appointment, action, reason, target = null) => {
  const fields = ['patient_id', 'doctor_id', 'service_id', 'status', 'appointment_datetime', 'remarks', 'request_type', 'request_new_datetime', 'request_status'];
  if (!appointment?.appointment_id || fields.some(field => !Object.prototype.hasOwnProperty.call(appointment, field))) {
    throw new Error('Reload your appointment before making changes.');
  }
  const { data, error } = await client.rpc('manage_patient_appointment', {
    p_appointment_id: appointment.appointment_id, p_action: action, p_reason: reason,
    p_target: target, p_expected: Object.fromEntries(fields.map(field => [field, appointment[field]])),
  });
  if (error) throw error.code === 'PGRST202'
    ? new Error('The patient privacy update has not been installed. Contact the clinic.') : appointmentWriteError(error);
  if (String(data) !== String(appointment.appointment_id)) throw new Error('Could not verify the change. Refresh your appointments before retrying.');
};

// Keep appointment notes in the existing remarks column. The original values
// guard against silently overwriting documentation or a concurrent request.
export const saveAppointmentNote = async (client, appointment, note, changes = {}, now = new Date()) => {
  if (!appointment?.appointment_id || !note?.trim()) throw new Error('Enter appointment documentation before saving.');
  if (!Object.prototype.hasOwnProperty.call(appointment, 'remarks')) throw new Error('Reload the existing appointment notes before saving.');
  const allowedChanges = ['status', 'appointment_datetime', 'request_type', 'request_new_datetime', 'request_status'];
  if (Object.keys(changes).some(key => !allowedChanges.includes(key))) throw new Error('Unsupported appointment change.');
  let query = client.from('appointments').update({
    ...changes,
    remarks: [appointment.remarks, note.trim()].filter(Boolean).join('\n\n'),
    updated_at: now.toISOString(),
  }).eq('appointment_id', appointment.appointment_id);
  const originalFields = ['patient_id', 'doctor_id', 'service_id', 'status', 'appointment_datetime', 'remarks', 'request_type', 'request_new_datetime', 'request_status'];
  for (const field of originalFields) {
    if (!Object.prototype.hasOwnProperty.call(appointment, field)) continue;
    query = appointment[field] == null ? query.is(field, null) : query.eq(field, appointment[field]);
  }
  const { data, error } = await query.select('appointment_id, remarks, updated_at');
  if (error) throw appointmentWriteError(error);
  if (data?.length !== 1) {
    const conflict = new Error('The appointment changed or access was denied. Refresh its history before retrying; your new note has not been saved.');
    conflict.code = 'APPOINTMENT_CHANGED';
    throw conflict;
  }
  return data[0];
};
