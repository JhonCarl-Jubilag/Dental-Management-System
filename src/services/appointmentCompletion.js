import { hasAppointmentEnded } from '../utils/appointmentTiming';
import { saveAppointmentNote } from './appointmentNotes';

const completionFields = 'appointment_id, patient_id, doctor_id, appointment_datetime, appointment_end, scheduled_duration_minutes, service_id, status, remarks, services(duration_minutes)';

// Keep the original status/time in the filter so a cancelled or rescheduled
// appointment is not completed using a stale result from the earlier read.
const completeAppointment = async (client, appointment, now) => {
  const note = `[System Auto-complete ${now.toLocaleString()}]: Appointment automatically marked as completed (service duration elapsed).`;
  try {
    await saveAppointmentNote(client, appointment, note, { status: 'completed' }, now);
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
    try {
      await saveAppointmentNote(client, appointment,
        `[System Auto-cancel ${now.toLocaleString()}]: Appointment auto-cancelled because the scheduled time has passed.`,
        { status: 'cancelled' }, now);
      count += 1;
    } catch (err) {
      if (err.code !== 'APPOINTMENT_CHANGED') throw err;
    }
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
      completedCount += await completeAppointment(client, appointment, now);
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
  return (await completeAppointment(client, data, now)) > 0;
};
