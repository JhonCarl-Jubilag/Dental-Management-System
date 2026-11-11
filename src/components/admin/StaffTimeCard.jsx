import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isOwner } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { formatClinicDateTime } from '../../utils/clinicScheduling';
import { loadMyAttendance, timeIn, timeOut, attendanceDuration } from '../../services/staffAttendance';
import './StaffAttendance.css';

const StaffTimeCard = ({ onChanged }) => {
  const { user, userType } = useAuth();
  const allowed = Boolean(user && userType === 'admin');
  const identity = `${user?.id}:${userType}`;
  const current = useRef(identity); current.current = identity;
  const sequence = useRef(0), writing = useRef(false), intent = useRef(null);
  const [snapshot, setSnapshot] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [, setTick] = useState(0);
  const apply = useCallback(data => setSnapshot({ ...data, receivedAt: performance.now() }), []);
  const load = useCallback(async () => {
    if (!allowed || writing.current) return;
    const version = ++sequence.current;
    setLoading(true); setError(''); setMessage('');
    try { const data = await loadMyAttendance(supabase); if (version === sequence.current && current.current === identity) apply(data); }
    catch (err) { if (version === sequence.current && current.current === identity) setError(err.message); }
    finally { if (version === sequence.current && current.current === identity) setLoading(false); }
  }, [allowed, identity, apply]);
  useEffect(() => {
    setSnapshot(null); setBusy(false); writing.current = false; intent.current = null; load();
    return () => { sequence.current += 1; };
  }, [load]);
  useEffect(() => {
    if (!snapshot?.open_record) return undefined;
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot]);
  const clock = async () => {
    if (!allowed || current.current !== identity || writing.current || loading || error || !snapshot) return;
    const open = snapshot.open_record, kind = open ? 'out' : 'in';
    if (open && !window.confirm('Time Out now and end your current working session?')) return;
    if (!intent.current || intent.current.kind !== kind || String(intent.current.recordId) !== String(open?.record_id)) intent.current = { kind, recordId: open?.record_id, requestId: crypto.randomUUID() };
    writing.current = true; setBusy(true); setError(''); setMessage('');
    const version = ++sequence.current;
    try {
      const data = open ? await timeOut(supabase, open, intent.current.requestId) : await timeIn(supabase, intent.current.requestId);
      if (version !== sequence.current || current.current !== identity) return;
      apply(data); intent.current = null;
      setMessage(data.replayed ? 'Attendance refreshed. This request was already recorded.' : open ? 'Time Out recorded.' : 'Time In recorded.');
      onChanged?.();
    } catch (err) {
      if (version !== sequence.current || current.current !== identity) return;
      try { const data = await loadMyAttendance(supabase); if (version === sequence.current && current.current === identity) apply(data); } catch { /* Preserve the original action error. */ }
      if (version === sequence.current && current.current === identity) setError(`${err.message} Use Refresh attendance to review the saved state before retrying.`);
    } finally { if (version === sequence.current && current.current === identity) { writing.current = false; setBusy(false); } }
  };
  if (!user || (!allowed && !isOwner(userType))) return null;
  if (isOwner(userType)) return <section className="staff-time-card"><div><h2>Staff attendance</h2><p>Review Daily Time Records and correct missed entries.</p></div><Link to="/admin/attendance">View Daily Time Records →</Link></section>;
  const open = snapshot?.open_record;
  const elapsed = open ? Math.max(0, (Date.parse(snapshot.server_now) - Date.parse(open.time_in) + performance.now() - snapshot.receivedAt) / 1000) : 0;
  return <section className="staff-time-card" aria-label="My attendance" aria-busy={loading || busy}>
    <div className="staff-time-card__content"><h2>My attendance</h2>
      {loading && <p role="status">Loading attendance…</p>}
      {!loading && snapshot && <><p><span className={`staff-dtr-badge ${open ? 'staff-dtr-working' : ''}`}>{open ? 'Working' : snapshot.latest_record?.work_date === snapshot.today ? 'Timed out' : 'Not timed in'}</span></p>
        {open ? <><p>Time In: {formatClinicDateTime(open.time_in)} (Philippines)</p><strong className="staff-time-card__timer" aria-label="Current session duration">{attendanceDuration(elapsed, true)}</strong>{open.work_date !== snapshot.today && <p className="staff-dtr-hint">This session started on {open.work_date} and is still open. If you missed Time Out, ask the Owner to correct it.</p>}</>
          : snapshot.latest_record?.time_out && <p>Last Time Out: {formatClinicDateTime(snapshot.latest_record.time_out)}</p>}
        <p className="staff-dtr-hint">Recorded today: {attendanceDuration(snapshot.today_recorded_seconds)} · closed sessions only · no break deductions</p></>}
      {error && <p className="staff-dtr-error" role="alert">{error}</p>}{message && <p className="staff-dtr-success" role="status">{message}</p>}
    </div>
    <div className="staff-time-card__actions"><button type="button" className="staff-dtr-primary" disabled={loading || busy || Boolean(error) || !snapshot} onClick={clock}>{busy ? 'Recording…' : open ? 'Time Out' : 'Time In'}</button>
      <button type="button" disabled={loading || busy} onClick={load}>Refresh attendance</button><Link to="/admin/attendance">View my Daily Time Records</Link></div>
  </section>;
};
export default StaffTimeCard;
