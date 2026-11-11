import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { formatClinicDateTime, toClinicDateTimeInput } from '../../utils/clinicScheduling';
import { loadAttendanceMonth, saveAttendanceCorrection, loadAttendanceAudit, attendanceDuration } from '../../services/staffAttendance';
import Sidebar from '../../components/admin/Sidebar';
import StaffTimeCard from '../../components/admin/StaffTimeCard';
import '../../components/admin/StaffAttendance.css';

const stamp = value => value ? formatClinicDateTime(value) : 'Open';
const AttendanceEditor = ({ record, staff, initialStaffId, onClose, onSaved }) => {
  const [staffId, setStaffId] = useState(record?.staff_admin_id || initialStaffId || '');
  const [form, setForm] = useState({ timeIn: record ? toClinicDateTimeInput(record.time_in) : '', timeOut: record?.time_out ? toClinicDateTimeInput(record.time_out) : '', reason: '' });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState(null), [historyPage, setHistoryPage] = useState(1), [historyError, setHistoryError] = useState('');
  const dialog = useRef(null), saving = useRef(false), alive = useRef(true), requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    const element = dialog.current, focus = document.activeElement, overflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => { alive.current = false; element.close(); document.body.style.overflow = overflow; if (focus?.isConnected) focus.focus(); };
  }, []);
  useEffect(() => {
    if (!record || !historyOpen) return undefined;
    let active = true; setHistoryError(''); setHistory(null);
    loadAttendanceAudit(supabase, record.record_id, historyPage).then(data => { if (active) setHistory(data); }).catch(err => { if (active) setHistoryError(err.message); });
    return () => { active = false; };
  }, [record, historyOpen, historyPage]);
  const close = () => { if (!saving.current && (!dirty || window.confirm('Discard the unsaved attendance changes?'))) onClose(); };
  const change = (key, value) => { setDirty(true); setForm(previous => ({ ...previous, [key]: value })); };
  const save = async event => {
    event.preventDefault();
    if (saving.current || conflict || !dirty) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await saveAttendanceCorrection(supabase, { record, staffId, form, requestId: requestId.current });
      if (alive.current) onSaved();
    } catch (err) {
      if (alive.current) { setError(err.message); if (err.code === '40001' || err.code === '23505') setConflict(true); }
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} className="staff-dtr-dialog" aria-labelledby="staff-dtr-editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id="staff-dtr-editor-title">{record ? 'Correct attendance' : 'Add attendance entry'}</h2><button type="button" disabled={busy} onClick={close} aria-label="Close attendance editor">×</button></header>
    <form onSubmit={save}><fieldset disabled={busy || conflict}>
      {record ? <p><strong>{record.staff_name}</strong> · Record #{record.record_id}</p> : <><label htmlFor="dtr-staff">Staff account</label><select id="dtr-staff" required value={staffId} onChange={e => { setStaffId(e.target.value); setDirty(true); }} autoFocus><option value="">Select Staff</option>{staff.filter(person => person.linked).map(person => <option key={person.admin_id} value={person.admin_id}>{person.name}{person.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></>}
      <p className="staff-dtr-hint">Philippine time. Leave Time Out blank only if the session is still open. Times cannot overlap another session.</p>
      <div className="staff-dtr-form-grid"><div><label htmlFor="dtr-time-in">Time In</label><input id="dtr-time-in" type="datetime-local" required value={form.timeIn} onChange={e => change('timeIn', e.target.value)} autoFocus={Boolean(record)} /></div>
        <div><label htmlFor="dtr-time-out">Time Out</label><input id="dtr-time-out" type="datetime-local" value={form.timeOut} onChange={e => change('timeOut', e.target.value)} /></div></div>
      <label htmlFor="dtr-reason">Reason for this entry or correction</label><textarea id="dtr-reason" rows={3} required minLength={3} maxLength={1000} value={form.reason} onChange={e => change('reason', e.target.value)} />
    </fieldset>
      {error && <p className="staff-dtr-error" role="alert">{error}</p>}{conflict && <p className="staff-dtr-hint">Your draft is kept. Close this form and refresh before making another correction.</p>}
      <div className="staff-dtr-form-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="staff-dtr-primary" disabled={busy || conflict || !dirty}>{busy ? 'Saving…' : 'Save attendance'}</button></div>
    </form>
    {record && <details className="staff-dtr-audit" onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>Correction history ({record.change_count || 0})</summary>
      {historyError && <p className="staff-dtr-error" role="alert">{historyError}</p>}
      {!history && !historyError && <p role="status">Loading correction history…</p>}
      {history && <>{!history.rows.length && <p>No Owner corrections. Original clock times are unchanged.</p>}{history.rows.map(item => <article key={item.correction_id}><strong>{item.action === 'create' ? 'Owner added entry' : 'Owner correction'} · {stamp(item.corrected_at)}</strong>
        {item.action === 'correct' && <p>Before: {stamp(item.old_time_in)} → {stamp(item.old_time_out)}</p>}<p>After: {stamp(item.new_time_in)} → {stamp(item.new_time_out)}</p><p>{item.reason}</p></article>)}
        {history.total > 20 && <nav aria-label="Correction history pages"><button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage(value => value - 1)}>Previous changes</button><span>Page {historyPage} of {Math.ceil(history.total / 20)}</span><button type="button" disabled={historyPage >= Math.ceil(history.total / 20)} onClick={() => setHistoryPage(value => value + 1)}>Next changes</button></nav>}</>}
    </details>}
  </dialog>;
};

const AttendancePage = ({ auth }) => {
  const owner = isOwner(auth.userType), navigate = useNavigate();
  const [query, setQuery] = useState({ month: '', staffId: '', page: 1 }), [month, setMonth] = useState(''), [staffId, setStaffId] = useState('');
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState(''), [editor, setEditor] = useState(null);
  const sequence = useRef(0), resolvedMonth = useRef('');
  const load = useCallback(async () => {
    const version = ++sequence.current; setLoading(true); setError('');
    try {
      const result = await loadAttendanceMonth(supabase, { ...query, month: query.month || resolvedMonth.current, staffId: owner ? query.staffId : '' }, owner);
      if (version !== sequence.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / 20));
      if (query.page > lastPage) { setQuery(value => ({ ...value, page: lastPage })); return; }
      if (!resolvedMonth.current) { resolvedMonth.current = result.month.slice(0, 7); setMonth(result.month.slice(0, 7)); }
      setData(result);
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) setLoading(false); }
  }, [query, owner]);
  useEffect(() => { load(); return () => { sequence.current += 1; }; }, [load]);
  const logout = async () => { try { const result = await auth.signOut(); if (result?.success === false) throw new Error(result.message || 'Could not sign out.'); navigate('/login'); } catch (err) { setError(err.message); } };
  const applyFilters = event => { event.preventDefault(); setMessage(''); setQuery({ month, staffId: owner ? staffId : '', page: 1 }); };
  const page = query.page, pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return <div className="admin-dashboard"><Sidebar onLogout={logout} /><main className="main-content staff-dtr-page">
    <div className="staff-dtr-page-heading"><div><h1>Daily Time Records</h1><p>{owner ? 'Review Staff attendance and correct missed entries.' : 'Your attendance and recorded working hours.'}</p></div>
      {owner && <button type="button" className="staff-dtr-primary" disabled={loading || Boolean(error) || !data?.staff.some(person => person.linked)} onClick={() => setEditor({ record: null })}>Add missed entry</button>}</div>
    {!owner && <StaffTimeCard onChanged={load} />}
    <form className="staff-dtr-filters" onSubmit={applyFilters}><fieldset disabled={loading || Boolean(editor)}>
      <div><label htmlFor="attendance-month">Month</label><input id="attendance-month" type="month" required value={month} onChange={event => setMonth(event.target.value)} /></div>
      {owner && <div><label htmlFor="attendance-staff">Staff</label><select id="attendance-staff" value={staffId} onChange={event => setStaffId(event.target.value)}><option value="">All Staff</option>{data?.staff.map(person => <option key={person.admin_id} value={person.admin_id}>{person.name}{person.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></div>}
      <button type="submit" className="staff-dtr-primary">Apply filters</button><button type="button" onClick={load}>Refresh records</button>
    </fieldset></form>
    {loading && <p role="status">{data ? 'Updating attendance…' : 'Loading Daily Time Records…'}</p>}
    {error && <p className="staff-dtr-error" role="alert">{error} Use Refresh records to retry.</p>}{message && <p className="staff-dtr-success" role="status">{message}</p>}
    {data && !error && <><section className="staff-dtr-summary" aria-label="Attendance totals"><div><span>Recorded hours</span><strong>{attendanceDuration(data.summary.recorded_seconds)}</strong></div><div><span>Closed sessions</span><strong>{data.summary.closed_sessions}</strong></div><div><span>Open sessions</span><strong>{data.summary.open_sessions}</strong></div><div><span>{owner && !query.staffId ? 'Staff-days recorded' : 'Days recorded'}</span><strong>{data.summary.days_recorded}</strong></div></section>
      <p className="staff-dtr-hint">Philippine time. Work date follows Time In, including overnight sessions. Totals include all closed sessions in the selected month, before break deductions; open sessions are excluded.</p>
      <div className="staff-dtr-table-scroll" tabIndex={0} aria-label="Daily Time Records table"><table><thead><tr>{owner && <th scope="col">Staff</th>}<th scope="col">Work Date</th><th scope="col">Time In</th><th scope="col">Time Out</th><th scope="col">Recorded Hours</th><th scope="col">Status / Remarks</th>{owner && <th scope="col">Actions</th>}</tr></thead><tbody>
        {!data.rows.length && <tr><td colSpan={owner ? 8 : 6}>No attendance entries for this selection.</td></tr>}
        {data.rows.map(row => <tr key={row.record_id}>{owner && <td>{row.staff_name}</td>}<td><span className="staff-dtr-date">{row.work_date}</span></td><td>{stamp(row.time_in)}</td><td>{row.time_out ? stamp(row.time_out) : 'Not timed out'}</td><td>{row.time_out ? attendanceDuration(row.recorded_seconds) : 'In progress'}</td><td><span className={`staff-dtr-badge ${row.time_out ? '' : 'staff-dtr-working'}`}>{row.time_out ? 'Completed' : 'Working'}</span>{row.entry_source === 'owner' && <small>Owner entry</small>}{row.last_reason && <small>{row.last_reason}</small>}</td>{owner && <td><button type="button" disabled={loading} onClick={() => setEditor({ record: row })}>Review / Correct</button></td>}</tr>)}
      </tbody></table></div>
      {pages > 1 && <nav className="staff-dtr-pagination" aria-label="Attendance pages"><button type="button" disabled={loading || Boolean(editor) || page <= 1} onClick={() => setQuery(value => ({ ...value, page: value.page - 1 }))}>Previous</button><span>Page {page} of {pages} · {data.total} sessions</span><button type="button" disabled={loading || Boolean(editor) || page >= pages} onClick={() => setQuery(value => ({ ...value, page: value.page + 1 }))}>Next</button></nav>}
    </>}
    {owner && editor && <AttendanceEditor key={editor.record?.record_id || 'new'} record={editor.record} staff={data.staff} initialStaffId={query.staffId} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMessage('Attendance saved. The list shows the selected month.'); load(); }} />}
  </main></div>;
};
const DailyTimeRecords = () => {
  const auth = useAuth();
  if (auth.loading || !auth.user || !isClinicUser(auth.userType)) return null;
  return <AttendancePage key={`${auth.user.id}:${auth.userType}`} auth={auth} />;
};
export default DailyTimeRecords;
