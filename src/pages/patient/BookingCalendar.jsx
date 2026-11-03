import React, { useEffect, useState } from 'react';
import { loadDoctorBookingMonth } from '../../services/doctorScheduling';
import { formatClinicDate, formatClinicTime, getClinicDate } from '../../utils/clinicScheduling';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shiftMonth = (month, offset) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
};

export default function BookingCalendar({ doctorId, serviceId, leadMinutes, date, time, setDate, setTime, revision, locked }) {
  const today = getClinicDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const key = [doctorId, serviceId, leadMinutes, month, date, revision, retry].join(':');
  const current = snapshot?.key === key ? snapshot : null;

  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function refresh() {
      const request = ++sequence;
      try {
        const data = await loadDoctorBookingMonth({ doctorId, serviceId, month, leadMinutes });
        if (!active || request !== sequence) return;
        const days = Object.fromEntries(data.filter(row => row.times?.length).map(row => [row.booking_date, row.times]));
        setSnapshot({ key, days });
        if (date && !days[date]) setDate('');
        setTime(previous => days[date]?.includes(previous) ? previous : '');
      } catch (error) {
        if (!active || request !== sequence) return;
        console.error('Booking availability error:', error);
        setSnapshot({ key, error: true });
        setTime('');
      }
    }
    refresh();
    const refreshVisible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
    };
  }, [key, month, date, doctorId, serviceId, leadMinutes, setDate, setTime]);

  function navigate(offset) {
    setMonth(shiftMonth(month, offset));
    setDate('');
    setTime('');
  }
  const first = new Date(month + '-01T00:00:00Z');
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const days = current?.days || {};
  const slots = days[date] || [];

  return <fieldset className="booking-picker" disabled={locked}>
    <legend className="form-label required">Preferred date</legend>
    <div className="booking-month">
      <div className="booking-month-bar">
        <strong aria-live="polite">{label}</strong>
        <button type="button" aria-label="Previous month" disabled={month <= today.slice(0, 7)} onClick={() => navigate(-1)}>‹</button>
        <button type="button" aria-label="Next month" onClick={() => navigate(1)}>›</button>
      </div>
      <div className="booking-days" role="group" aria-label={label}>
        {weekdays.map(day => <small key={day} aria-hidden="true">{day}</small>)}
        {Array.from({ length: lastDay }, (_, i) => {
          const value = month + '-' + String(i + 1).padStart(2, '0');
          return <button type="button" key={value} disabled={!days[value] || value < today}
            style={i === 0 ? { gridColumnStart: first.getUTCDay() + 1 } : undefined}
            aria-pressed={date === value} aria-label={formatClinicDate(value)}
            onClick={() => { if (date !== value) { setTime(''); setDate(value); } }}>
            {i + 1}
          </button>;
        })}
      </div>
      <div className="booking-legend"><span>Available</span><span>Unavailable</span><span>Selected</span></div>
    </div>
    <p role="status">{!current ? 'Checking availability…' : current.error ? 'Availability could not be loaded.' :
      date ? 'Available times for ' + formatClinicDate(date) :
      Object.keys(days).length ? 'Choose an available date to see appointment times.' : 'No available appointments this month. Try another month.'}</p>
    {current?.error && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry availability</button>}
    {slots.length > 0 && <div className="time-slots-grid" role="group" aria-label="Available appointment times">
      {slots.map(slot => <button type="button" key={slot} aria-pressed={time === slot}
        className={'time-slot' + (time === slot ? ' selected' : '')} onClick={() => setTime(slot)}>
        {formatClinicTime(slot)}
      </button>)}
    </div>}
  </fieldset>;
}
