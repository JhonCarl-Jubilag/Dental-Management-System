import { hasAppointmentEnded } from '../utils/appointmentTiming';

const completionFields = 'appointment_id, appointment_datetime, service_id, status, remarks, services(duration_minutes)';

// Keep the original status/time in the filter so a cancelled or rescheduled
// appointment is not completed using a stale result from the earlier read.
const completeAppointment = async (client, appointment, now) => {
  const note = `[System Auto-complete ${now.toLocaleString()}]: Appointment automatically marked as completed (service duration elapsed).`;
  const { data, error } = await client.from('appointments')
    .update({
      status: 'completed',
      updated_at: now.toISOString(),
      remarks: [appointment.remarks, note].filter(Boolean).join('\n'),
    })
    .eq('appointment_id', appointment.appointment_id)
    .eq('status', 'confirmed')
    .eq('appointment_datetime', appointment.appointment_datetime)
    .eq('service_id', appointment.service_id)
    .select('appointment_id');
  if (error) throw error;
  return data?.length || 0;
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
