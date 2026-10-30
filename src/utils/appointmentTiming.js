export const getAppointmentDuration = appointment => {
  const duration = Number(appointment?.scheduled_duration_minutes ?? appointment?.services?.duration_minutes);
  return Number.isFinite(duration) && duration > 0 ? duration : NaN;
};

// Invalid dates or durations must never make an appointment eligible early.
export const hasAppointmentEnded = (appointment, now = new Date()) => {
  const start = appointment?.appointment_datetime;
  const duration = getAppointmentDuration(appointment);
  if (!start || !Number.isFinite(duration) || duration <= 0) return false;
  const calculatedEnd = new Date(start).getTime() + duration * 60000;
  const end = appointment.appointment_end == null ? calculatedEnd : new Date(appointment.appointment_end).getTime();
  if (end !== calculatedEnd) return false;
  return Number.isFinite(end) && end <= new Date(now).getTime();
};
