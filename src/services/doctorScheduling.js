import { supabase } from './supabase';
import { formatClinicTime, toClinicDateTimeInput } from '../utils/clinicScheduling';

// Shared by patient and walk-in booking, including their final pre-save check.
export const loadDoctorBookingSlots = async ({ doctorId, serviceId, date, interval = 30, leadMinutes = 0, excludeAppointmentId = null, targetTime = null }) => {
  // Return available times only. Reading other patients' appointment rows would
  // either leak records or miss collisions once patient RLS is enforced.
  const { data, error } = await supabase.rpc('get_booking_time_slots', {
    p_doctor_id: Number(doctorId), p_service_id: Number(serviceId), p_date: date,
    p_interval: interval, p_lead_minutes: leadMinutes,
    p_exclude_appointment_id: excludeAppointmentId, p_time: targetTime,
  });
  if (error) throw new Error(error.code === 'PGRST202'
    ? 'The patient privacy update has not been installed. Contact the clinic.' : error.message);
  return (data || []).map(({ time_slot: time }) => ({ time, display: formatClinicTime(time) }));
};

// A reschedule checks the entire service inside one enabled period. Excluding
// this appointment permits moves that overlap its own original time.
export const validateAppointmentReschedule = async ({ appointment, targetDateTime, leadMinutes = 60 }) => {
  if (!appointment?.appointment_id || !appointment.doctor_id || !appointment.service_id) {
    throw new Error('Reload the appointment before rescheduling.');
  }
  if (typeof targetDateTime !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(targetDateTime)) {
    throw new Error('Choose a valid clinic date and time.');
  }
  const target = new Date(targetDateTime);
  if (!Number.isFinite(target.getTime()) || target.getUTCSeconds() || target.getUTCMilliseconds()) {
    throw new Error('Choose a valid appointment time in whole minutes.');
  }
  let duration = Number(appointment.scheduled_duration_minutes);
  if (!Object.prototype.hasOwnProperty.call(appointment, 'scheduled_duration_minutes')) {
    // Compatibility for older cached appointment objects during deployment.
    const { data: service, error } = await supabase.from('services').select('duration_minutes')
      .eq('service_id', appointment.service_id).single();
    if (error) throw error;
    duration = Number(service?.duration_minutes);
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The service duration is unavailable. Contact the clinic.');
  // null retains the patient's existing service-duration booking buffer.
  const lead = leadMinutes == null ? duration : leadMinutes;
  if (!Number.isFinite(lead) || lead < 0) throw new Error('The reschedule buffer is invalid.');
  if (target.getTime() <= Date.now() || target.getTime() < Date.now() + lead * 60000) {
    throw new Error(`Choose a time at least ${lead} minutes from now.`);
  }
  const [date, time] = toClinicDateTimeInput(target).split('T');
  const slots = await loadDoctorBookingSlots({
    doctorId: appointment.doctor_id, serviceId: appointment.service_id, date, interval: 1,
    leadMinutes: lead, excludeAppointmentId: appointment.appointment_id, targetTime: time,
  });
  if (!slots.some(slot => slot.time === time)) {
    throw new Error('Time slot is no longer available or the full service does not fit. Refresh the schedule and choose another time.');
  }
  return target.toISOString();
};
