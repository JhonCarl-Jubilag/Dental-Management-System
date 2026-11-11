import { hasAppointmentEnded } from '../utils/appointmentTiming';
import { appointmentWriteError } from '../utils/clinicScheduling';
import { saveAppointmentNote } from './appointmentNotes';

const completionFields = 'appointment_id, patient_id, doctor_id, appointment_datetime, appointment_end, scheduled_duration_minutes, service_id, status, remarks, services(duration_minutes)';

const applyAutomaticStatus = async (client, appointment, now) => {
  const { data, error } = await client.rpc('apply_automatic_appointment_status', {
    p_appointment_id: appointment.appointment_id,
    p_expected_status: appointment.status,
    p_expected_time: appointment.appointment_datetime,
  });
  if (!error) return data === true ? 1 : 0;
  if (error.code !== 'PGRST202') throw appointmentWriteError(error);

  // Preserve automatic updates during rollout to a database without the new RPC.
  const completing = appointment.status === 'confirmed';
  const note = completing
    ? `[System Auto-complete ${now.toLocaleString()}]: Appointment automatically marked as completed (service duration elapsed).`
    : `[System Auto-cancel ${now.toLocaleString()}]: Appointment auto-cancelled because the scheduled time has passed.`;
  try {
    await saveAppointmentNote(client, appointment, note, { status: completing ? 'completed' : 'cancelled' }, now);
    return 1;
  } catch (err) {
    if (err.code === 'APPOINTMENT_CHANGED') return 0;
    throw err;
  }
};

export const cancelExpiredPendingAppointments = async (client, doctorId = null, now = new Date()) => {
  const candidates = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('appointments').select(completionFields)
      .eq('status', 'pending').lt('appointment_datetime', now.toISOString());
    if (doctorId != null) query = query.eq('doctor_id', doctorId);
    const { data, error } = await query.order('appointment_id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    candidates.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  let count = 0;
  for (const appointment of candidates) {
    count += await applyAutomaticStatus(client, appointment, now);
  }
  return count;
};

export const completeFinishedAppointments = async (client, now = new Date()) => {
  const candidates = [];
  const pageSize = 500;
  // Collect all pages before updating: changing statuses during pagination
  // would otherwise shift the remaining rows and skip some appointments.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('appointments')
      .select(completionFields)
      .eq('status', 'confirmed')
      .lte('appointment_datetime', now.toISOString())
      .order('appointment_id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    candidates.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  let completedCount = 0;
  for (const appointment of candidates) {
    if (hasAppointmentEnded(appointment, now)) {
      completedCount += await applyAutomaticStatus(client, appointment, now);
    }
  }
  return completedCount;
};

export const completePaidAppointment = async (client, appointmentId, now = new Date()) => {
  const { data, error } = await client.from('appointments')
    .select(completionFields)
    .eq('appointment_id', appointmentId)
    .single();
  if (error) throw error;
  if (data?.status !== 'confirmed' || !hasAppointmentEnded(data, now)) return false;
  return (await applyAutomaticStatus(client, data, now)) > 0;
};
