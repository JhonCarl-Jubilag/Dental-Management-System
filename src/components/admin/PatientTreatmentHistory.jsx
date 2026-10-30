import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser } from '../../utils/accessControl';
import { CLINIC_TIME_ZONE } from '../../utils/clinicScheduling';
import { supabase } from '../../services/supabase';
import { saveAppointmentNote } from '../../services/appointmentNotes';
import { getAppointmentDuration } from '../../utils/appointmentTiming';
import './PatientTreatmentHistory.css';

const historyFields = 'appointment_id, patient_id, doctor_id, service_id, appointment_datetime, appointment_end, scheduled_duration_minutes, status, remarks, created_at, updated_at, request_type, request_new_datetime, request_status, services(service_name, duration_minutes), doctors(first_name, last_name)';
const pageSize = 10;
const formatDateTime = value => new Date(value).toLocaleString('en-US', {
  timeZone: CLINIC_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short',
});

const PatientTreatmentHistory = ({ patientId }) => {
  const { user, userType } = useAuth();
  const allowed = Boolean(user && isClinicUser(userType));
  const [appointments, setAppointments] = useState([]);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const request = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!allowed || !patientId) return;
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      let query = supabase.from('appointments').select(historyFields, { count: 'exact' }).eq('patient_id', patientId);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error: readError, count: total } = await query
        .order('appointment_datetime', { ascending: sort === 'oldest' }).order('appointment_id', { ascending: sort === 'oldest' })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (readError) throw readError;
      if (version === request.current) {
        setAppointments(data || []);
        setCount(total || 0);
      }
    } catch (err) {
      if (version === request.current) setError(err.message || 'Could not load patient history.');
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [allowed, patientId, status, sort, page]);

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [load]);

  const addNote = async event => {
    event.preventDefault();
    if (!allowed || !editing || savingRef.current || conflict || loading || error) return;
    if (!note.trim()) { toast.error('Enter documentation before saving.'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const timestamp = formatDateTime(new Date());
      await saveAppointmentNote(supabase, editing, `[Clinic documentation ${timestamp}]:\n${note.trim()}`);
      toast.success('Documentation added. Previous notes were preserved.');
      setEditing(null);
      setNote('');
      await load();
    } catch (err) {
      if (err.code === 'APPOINTMENT_CHANGED') setConflict(true);
      toast.error(err.message || 'Could not save documentation.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const refresh = async () => {
    await load();
    if (!editing) return;
    // Refresh the editor snapshot explicitly without discarding its draft.
    try {
      const { data, error: readError } = await supabase.from('appointments').select(historyFields)
        .eq('patient_id', patientId).eq('appointment_id', editing.appointment_id).single();
      if (readError) throw readError;
      if (!data) throw new Error('Appointment is no longer available.');
      setEditing(data);
      setConflict(false);
    } catch (err) {
      setConflict(true);
      toast.error(err.message || 'Could not refresh the appointment.');
    }
  };

  if (!allowed) return null;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const controlsDisabled = loading || saving || Boolean(editing);
  return (
    <section className="clinic-patient-history" aria-labelledby="clinic-patient-history-title" aria-busy={loading}>
      <div className="clinic-patient-history-heading">
        <div><h2 id="clinic-patient-history-title">Appointment & treatment history</h2><p>All treating dentists · Philippine time. Only completed appointments indicate completed services.</p></div>
        <button type="button" disabled={loading || saving} onClick={refresh}>Refresh history</button>
      </div>
      <div className="clinic-patient-history-filters">
        <label>Status<select value={status} disabled={controlsDisabled} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="all">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </select></label>
        <label>Sort by<select value={sort} disabled={controlsDisabled} onChange={event => { setSort(event.target.value); setPage(1); }}>
          <option value="recent">Most recent</option><option value="oldest">Oldest first</option>
        </select></label>
        <span>{count} appointment(s)</span>
      </div>
      {loading && <p role="status">Loading patient history…</p>}
      {error && <p className="clinic-patient-history-error" role="alert">{error} Use Refresh history to retry.</p>}
      {!loading && !error && appointments.length === 0 && <p>No appointments match this patient and status.</p>}
      {!loading && !error && appointments.map(appointment => (
        <article className="clinic-patient-history-entry" key={appointment.appointment_id}>
          <div className="clinic-patient-history-entry-heading"><h3>{appointment.services?.service_name || 'Service unavailable'}</h3><span className={`clinic-patient-history-status clinic-patient-history-status-${appointment.status}`}>{appointment.status}</span></div>
          <dl><div><dt>Appointment</dt><dd>#{appointment.appointment_id} · {formatDateTime(appointment.appointment_datetime)}</dd></div>
            <div><dt>Treating dentist</dt><dd>{appointment.doctors ? `Dr. ${appointment.doctors.first_name} ${appointment.doctors.last_name}` : 'Dentist unavailable'}</dd></div>
            <div><dt>Service duration</dt><dd>{Number.isFinite(getAppointmentDuration(appointment)) ? `${getAppointmentDuration(appointment)} minutes` : 'Not recorded'}</dd></div>
          </dl>
          <h4>Notes and documentation</h4>
          <div className="clinic-patient-history-notes">{appointment.remarks || 'No notes recorded.'}</div>
          <button type="button" disabled={saving || Boolean(editing)} onClick={() => { setEditing(appointment); setNote(''); setConflict(false); }}>Add documentation to appointment #{appointment.appointment_id}</button>
        </article>
      ))}
      {editing && <form className="clinic-patient-history-editor" onSubmit={addNote}>
        <h3>Add documentation · appointment #{editing.appointment_id}</h3>
        <p>New documentation is appended to the existing notes. Corrections can be entered as a new note.</p>
        <p>These notes also appear in the patient's appointment information.</p>
        <details><summary>Review currently saved notes</summary><div className="clinic-patient-history-notes">{editing.remarks || 'No notes recorded.'}</div></details>
        <label htmlFor="clinic-patient-history-note">Documentation</label>
        <textarea id="clinic-patient-history-note" rows="5" maxLength={10000} required value={note} disabled={saving} onChange={event => setNote(event.target.value)} />
        {conflict && <p className="clinic-patient-history-error" role="alert">This appointment changed. Your draft is kept. Refresh history, review the latest notes, then save again.</p>}
        <div className="clinic-patient-history-actions"><button type="submit" disabled={saving || loading || conflict || Boolean(error)}>{saving ? 'Saving…' : 'Save documentation'}</button><button type="button" disabled={saving} onClick={() => { setEditing(null); setNote(''); setConflict(false); }}>Cancel note</button></div>
      </form>}
      {pages > 1 && <nav className="clinic-patient-history-pagination" aria-label="Patient history pages">
        <button type="button" disabled={controlsDisabled || page <= 1} onClick={() => setPage(page - 1)}>Previous history page</button>
        <span>Page {page} of {pages}</span><button type="button" disabled={controlsDisabled || page >= pages} onClick={() => setPage(page + 1)}>Next history page</button>
      </nav>}
    </section>
  );
};

export default PatientTreatmentHistory;
