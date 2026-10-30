import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { CLINIC_TIME_ZONE, clinicDateTime, formatClinicDate, formatClinicTime, getClinicDate, timeToMinutes } from '../../utils/clinicScheduling';
import './DoctorAvailabilityModal.css';

const fields = 'availability_id, doctor_id, available_date, start_time, end_time, is_available';
const blankForm = () => ({ available_date: getClinicDate(), start_time: '09:00', end_time: '17:00' });

const DoctorAvailabilityModal = ({ doctor, onClose, onChanged }) => {
  const { user, userType } = useAuth();
  const allowed = Boolean(user && isClinicUser(userType));
  const [slots, setSlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const saving = useRef(false);
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  const load = useCallback(async () => {
    if (!allowed) return;
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      const [schedule, upcoming] = await Promise.all([
        supabase.from('doctor_availability').select(fields).eq('doctor_id', doctor.doctor_id)
          .gte('available_date', getClinicDate()).order('available_date').order('start_time'),
        supabase.from('appointments')
          .select('appointment_id, appointment_datetime, status, patients(first_name, last_name), services(service_name)')
          .eq('doctor_id', doctor.doctor_id).in('status', ['pending', 'confirmed'])
          .gte('appointment_datetime', new Date().toISOString()).order('appointment_datetime').limit(10),
      ]);
      if (schedule.error) throw schedule.error;
      if (upcoming.error) throw upcoming.error;
      if (version === request.current) {
        setSlots(schedule.data || []);
        setAppointments(upcoming.data || []);
      }
    } catch (err) {
      if (version === request.current) setError(err.message || 'Could not load the schedule.');
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [allowed, doctor.doctor_id]);

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!allowed) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape' && !saving.current) close.current();
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])]
        .filter(element => !element.closest('fieldset:disabled'));
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [allowed]);

  const resetForm = () => { setEditing(null); setForm(blankForm()); };

  const checkOverlap = async (candidate, available) => {
    if (!available) return;
    const { data, error: readError } = await supabase.from('doctor_availability').select(fields)
      .eq('doctor_id', doctor.doctor_id).eq('available_date', candidate.available_date).eq('is_available', true);
    if (readError) throw readError;
    if ((data || []).some(slot => slot.availability_id !== candidate.availability_id &&
      timeToMinutes(candidate.start_time) < timeToMinutes(slot.end_time) &&
      timeToMinutes(candidate.end_time) > timeToMinutes(slot.start_time))) {
      throw new Error('This period overlaps another enabled period. Adjust the times first.');
    }
  };

  const matchOriginal = (query, original) => query.eq('doctor_id', doctor.doctor_id)
    .eq('availability_id', original.availability_id).eq('available_date', original.available_date)
    .eq('start_time', original.start_time).eq('end_time', original.end_time).eq('is_available', original.is_available);

  const save = async (event) => {
    event.preventDefault();
    if (!allowed || saving.current || loading || error) return;
    saving.current = true;
    setBusy(true);
    try {
      const start = timeToMinutes(form.start_time);
      const end = timeToMinutes(form.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('End time must be after start time on the same day.');
      if (form.available_date < getClinicDate()) throw new Error('Choose today or a future date.');
      const now = Date.now();
      if (new Date(clinicDateTime(form.available_date, form.end_time)).getTime() <= now ||
          (!editing && new Date(clinicDateTime(form.available_date, form.start_time)).getTime() < now)) {
        throw new Error('Choose a future availability period.');
      }
      const candidate = { ...form, availability_id: editing?.availability_id };
      await checkOverlap(candidate, editing ? editing.is_available : true);
      const values = { ...form, doctor_id: doctor.doctor_id };
      const query = editing
        ? matchOriginal(supabase.from('doctor_availability').update(values), editing)
        : supabase.from('doctor_availability').insert({ ...values, is_available: true });
      const result = await query.select('availability_id');
      if (result.error) throw result.error;
      if (result.data?.length !== 1) throw new Error('The schedule changed or access was denied. Refresh before retrying.');
      toast.success(editing ? 'Availability updated. Existing appointments are unchanged.' : 'Availability added.');
      resetForm();
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.code === '23505' ? 'A period already starts at that time. Edit the existing period instead.' : err.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const toggle = async slot => {
    if (!allowed || saving.current || loading || error) return;
    saving.current = true;
    setBusy(true);
    try {
      if (slot.available_date < getClinicDate()) throw new Error('Refresh the schedule before changing a past date.');
      await checkOverlap(slot, !slot.is_available);
      const result = await matchOriginal(supabase.from('doctor_availability').update({ is_available: !slot.is_available }), slot)
        .select('availability_id');
      if (result.error) throw result.error;
      if (result.data?.length !== 1) throw new Error('The schedule changed or access was denied. Refresh before retrying.');
      if (editing?.availability_id === slot.availability_id) resetForm();
      toast.success(slot.is_available ? 'Period disabled. Existing appointments are unchanged.' : 'Period enabled.');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (!allowed) return null;
  const disabled = busy || loading || Boolean(error);
  return (
    <div className="doctor-availability-overlay" onClick={event => {
      if (event.target === event.currentTarget && !saving.current) onClose();
    }}>
      <div className="doctor-availability-dialog" role="dialog" aria-modal="true" aria-labelledby="doctor-availability-title" tabIndex={-1} ref={dialog}>
        <div className="doctor-availability-heading">
          <div><h2 id="doctor-availability-title">Dentist availability</h2><p>Dr. {doctor.first_name} {doctor.last_name} · Philippine time</p></div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Close availability">×</button>
        </div>
        <p className="doctor-availability-notice">Schedule changes affect new bookings. Existing appointments remain scheduled; review them below and reschedule separately when needed.</p>
        {error && <div className="doctor-availability-error" role="alert">{error} <button type="button" onClick={load} disabled={loading}>Retry</button></div>}
        <div className="doctor-availability-columns">
          <form onSubmit={save} className="doctor-availability-form">
            <h3>{editing ? 'Edit period' : 'Add period'}</h3>
            <fieldset disabled={disabled}>
              <label htmlFor="doctor-availability-date">Date</label>
              <input id="doctor-availability-date" type="date" min={getClinicDate()} value={form.available_date} required onChange={event => setForm({ ...form, available_date: event.target.value })} />
              <label htmlFor="doctor-availability-start">Start time</label>
              <input id="doctor-availability-start" type="time" step="60" value={form.start_time} required onChange={event => setForm({ ...form, start_time: event.target.value })} />
              <label htmlFor="doctor-availability-end">End time</label>
              <input id="doctor-availability-end" type="time" step="60" value={form.end_time} required onChange={event => setForm({ ...form, end_time: event.target.value })} />
              <p>Add separate periods for breaks, such as 9 AM–12 PM and 1 PM–5 PM.</p>
              <div className="doctor-availability-actions">
                <button type="submit" className="doctor-availability-primary">{busy ? 'Saving…' : editing ? 'Save period' : 'Add period'}</button>
                {editing && <button type="button" onClick={resetForm}>Cancel edit</button>}
              </div>
            </fieldset>
          </form>
          <section className="doctor-availability-periods" aria-label="Upcoming availability" aria-busy={loading}>
            <div className="doctor-availability-section-heading"><h3>Upcoming availability</h3><button type="button" onClick={load} disabled={busy || loading}>Refresh</button></div>
            {loading ? <p role="status">Loading schedule…</p> : !error && slots.length === 0 ? <p>No upcoming availability. Add a period to open bookings.</p> : !error && slots.map(slot => (
              <article key={slot.availability_id} className="doctor-availability-period">
                <strong>{formatClinicDate(slot.available_date)}</strong>
                <div>{formatClinicTime(slot.start_time)} – {formatClinicTime(slot.end_time)}</div>
                <span className={slot.is_available ? 'doctor-availability-enabled' : 'doctor-availability-disabled'}>{slot.is_available ? 'Enabled' : 'Disabled'}</span>
                <div className="doctor-availability-actions">
                  <button type="button" disabled={disabled} aria-label={`Edit ${slot.available_date} ${slot.start_time.slice(0, 5)}`} onClick={() => {
                    setEditing(slot);
                    setForm({ available_date: slot.available_date, start_time: slot.start_time.slice(0, 5), end_time: slot.end_time.slice(0, 5) });
                    document.getElementById('doctor-availability-date')?.focus();
                  }}>Edit</button>
                  <button type="button" disabled={disabled} aria-label={`${slot.is_available ? 'Disable' : 'Enable'} ${slot.available_date} ${slot.start_time.slice(0, 5)}`} onClick={() => toggle(slot)}>{slot.is_available ? 'Disable' : 'Enable'}</button>
                </div>
              </article>
            ))}
          </section>
        </div>
        <section className="doctor-availability-appointments" aria-label="Upcoming appointments">
          <h3>Next 10 upcoming appointments</h3>
          {!loading && !error && appointments.length === 0 && <p>No upcoming pending or confirmed appointments.</p>}
          {!loading && !error && appointments.map(appointment => <div key={appointment.appointment_id} className="doctor-availability-appointment">
            <strong>{appointment.patients?.first_name} {appointment.patients?.last_name}</strong>
            <span>{appointment.services?.service_name} · {appointment.status}</span>
            <time dateTime={appointment.appointment_datetime}>{new Date(appointment.appointment_datetime).toLocaleString('en-US', { timeZone: CLINIC_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })}</time>
          </div>)}
        </section>
        <div className="doctor-availability-footer"><button type="button" onClick={onClose} disabled={busy}>Done</button></div>
      </div>
    </div>
  );
};

export default DoctorAvailabilityModal;
