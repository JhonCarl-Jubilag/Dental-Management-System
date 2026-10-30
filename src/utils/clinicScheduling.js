// Availability is clinic wall-clock time; appointments are absolute timestamps.
export const CLINIC_TIME_ZONE = 'Asia/Manila';

export const appointmentWriteError = error => {
  const message = error?.code === '23P01'
    ? 'This appointment overlaps another booking for the dentist. Refresh the schedule and choose another time.'
    : error?.code === '40P01'
      ? 'Another appointment update is in progress. Refresh before trying again.'
      : error?.message || 'Could not save the appointment. Refresh before trying again.';
  const failure = new Error(message);
  failure.code = error?.code;
  return failure;
};

export const getClinicDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const timeToMinutes = time => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d+)?)?$/.exec(time || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) + (Number(match[3] || 0) + Number(match[4] || 0)) / 60 : NaN;
};

export const clinicDateTime = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(timeToMinutes(time))) {
    throw new Error('Choose a valid clinic date and time.');
  }
  const value = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+08:00`);
  if (!Number.isFinite(value.getTime()) || getClinicDate(value) !== date) {
    throw new Error('Choose a valid clinic date.');
  }
  return value.toISOString();
};

export const clinicDayBounds = date => {
  const start = clinicDateTime(date, '00:00');
  return { start, end: new Date(new Date(start).getTime() + 86400000).toISOString() };
};

export const toClinicDateTimeInput = value => {
  const date = new Date(value);
  return `${getClinicDate(date)}T${date.toLocaleTimeString('en-GB', {
    timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })}`;
};

export const formatClinicDateTime = value => new Date(value).toLocaleString('en-US', {
  timeZone: CLINIC_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short',
});

export const formatClinicDate = date => new Date(clinicDateTime(date, '12:00')).toLocaleDateString('en-US', {
  timeZone: CLINIC_TIME_ZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

export const formatClinicTime = time => new Date(clinicDateTime('2000-01-01', time)).toLocaleTimeString('en-US', {
  timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: true,
});

export const buildAvailableSlots = ({ date, availability = [], appointments = [], duration, interval = 30, leadMinutes = 0, now = new Date() }) => {
  const minutes = Number(duration);
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isInteger(interval) || interval <= 0 || !Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new Error('The service has an invalid duration.');
  }
  const earliest = new Date(now).getTime() + leadMinutes * 60000;
  const busy = appointments.filter(appointment => ['pending', 'confirmed'].includes(appointment.status)).map(appointment => {
    const start = new Date(appointment.appointment_datetime).getTime();
    const length = Number(appointment.services?.duration_minutes);
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
      throw new Error('An existing appointment has missing timing information. Please contact the clinic.');
    }
    return { start, end: start + length * 60000 };
  });
  const times = new Set();
  availability.filter(period => period.is_available !== false).forEach(period => {
    const start = timeToMinutes(period.start_time);
    const end = timeToMinutes(period.end_time);
    // A service must fit inside one period; breaks are never joined together.
    for (let minute = Math.ceil(start); minute + minutes <= end; minute += interval) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const slotStart = new Date(clinicDateTime(date, time)).getTime();
      const slotEnd = slotStart + minutes * 60000;
      if (slotStart >= earliest && !busy.some(item => slotStart < item.end && slotEnd > item.start)) times.add(time);
    }
  });
  return [...times].sort().map(time => ({ time, display: formatClinicTime(time) }));
};
