// Invalid dates or durations must never make an appointment eligible early.
export const hasAppointmentEnded = (appointment, now = new Date()) => {
  const start = appointment?.appointment_datetime;
  const duration = Number(appointment?.services?.duration_minutes);
  if (!start || !Number.isFinite(duration) || duration <= 0) return false;
  const end = new Date(start).getTime() + duration * 60000;
  return Number.isFinite(end) && end <= new Date(now).getTime();
};
