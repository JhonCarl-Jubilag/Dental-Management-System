import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { CLINIC_TIME_ZONE, formatClinicDate, formatClinicDateTime, getClinicDate } from '../../utils/clinicScheduling';
import { supabase } from '../../services/supabase';
import { DASHBOARD_PAGE_SIZE, loadTodaySchedule, loadPendingRequests, loadSupplyAlerts, loadUnbilledAlert } from '../../services/dashboardDaily';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import StaffTimeCard from '../../components/admin/StaffTimeCard';
import './dashboard.css';

// Account/day/page changes invalidate older responses; tab focus keeps the view.
const useDashboardSection = (key, read) => {
  const [snapshot, setSnapshot] = useState({ key: null, data: null, loading: false, error: null });
  const request = useRef(0), context = useRef(key), reader = useRef(read);
  context.current = key; reader.current = read;
  const refresh = useCallback(async () => {
    const identity = context.current;
    if (!identity) return;
    const version = ++request.current, isCurrent = () => version === request.current && context.current === identity;
    setSnapshot(previous => ({ key: identity, data: previous.key === identity ? previous.data : null, loading: true, error: null }));
    try { const data = await reader.current(isCurrent); if (isCurrent()) setSnapshot({ key: identity, data, loading: false, error: null }); }
    catch (error) { if (isCurrent()) setSnapshot(previous => ({ ...previous, key: identity, loading: false, error })); }
  }, []);
  useEffect(() => { refresh(); return () => { request.current += 1; }; }, [key, refresh]);
  return { ...(snapshot.key === key ? snapshot : { data: null, loading: Boolean(key), error: null }), refresh };
};
const relation = value => Array.isArray(value) ? value[0] : value;
const personName = value => { const person = relation(value); return [person?.first_name, person?.last_name].filter(Boolean).join(' ') || 'Not recorded'; };
const timeLabel = value => new Date(value).toLocaleTimeString('en-US', { timeZone: CLINIC_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const statusLabel = value => ({ pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }[value] || 'Not recorded');

const AdminDashboard = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate(), allowed = Boolean(user && !authLoading && isClinicUser(userType));
  const [today, setToday] = useState(getClinicDate), [pagination, setPagination] = useState({ key: '', page: 1 }), [expanded, setExpanded] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false), [logoutError, setLogoutError] = useState('');
  const context = allowed ? [user.id, userType, today].join(':') : null;
  const page = pagination.key === context ? pagination.page : 1, scheduleKey = context ? `${context}:${page}` : null;
  const schedule = useDashboardSection(scheduleKey, isCurrent => loadTodaySchedule(supabase, today, page, isCurrent));
  const pending = useDashboardSection(context, isCurrent => loadPendingRequests(supabase, new Date(), isCurrent));
  const supplies = useDashboardSection(context, isCurrent => loadSupplyAlerts(supabase, isCurrent));
  const unbilled = useDashboardSection(context, isCurrent => loadUnbilledAlert(supabase, new Date(), isCurrent));
  useEffect(() => {
    if (!authLoading && !allowed) navigate(user ? '/' : '/login', { replace: true });
  }, [authLoading, allowed, user, navigate]);
  useEffect(() => {
    // A new clinic day refreshes the schedule; there is no focus reload.
    const timer = window.setInterval(() => setToday(previous => { const date = getClinicDate(); return previous === date ? previous : date; }), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (schedule.data && page > schedule.data.pages) setPagination({ key: context, page: schedule.data.pages });
  }, [schedule.data, page, context]);
  const refreshAll = () => {
    setExpanded(null); const date = getClinicDate();
    if (date !== today) { setToday(date); return; }
    schedule.refresh(); pending.refresh(); supplies.refresh(); unbilled.refresh();
  };
  const handleLogout = async () => {
    setIsLoggingOut(true); setLogoutError('');
    try { const result = await signOut(); if (result?.success === false) throw new Error(); navigate('/login'); }
    catch { setLogoutError('Could not log out. Please retry.'); setIsLoggingOut(false); }
  };
  if (!allowed) return null;
  const name = isOwner(userType) ? 'Owner' : user.email?.split('@')[0] || 'Staff';
  const refreshing = [schedule, pending, supplies, unbilled].some(section => section.loading);
  const allClear = supplies.data?.count === 0 && unbilled.data?.count === 0 && !supplies.error && !unbilled.error && !supplies.loading && !unbilled.loading;
  return <div className="admin-dashboard">
    <Sidebar onLogout={handleLogout} />
    <main className="main-content clinic-daily-dashboard">
      <header className="daily-heading"><div><span className="daily-eyebrow">{roleLabel(userType)}</span><h1>Welcome back, {name}</h1><p>Here’s what needs your attention at the clinic today.</p><time dateTime={today}>{formatClinicDate(today)} · Philippines</time></div><button type="button" onClick={refreshAll} disabled={refreshing || isLoggingOut}><i className="fas fa-sync-alt" aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh dashboard'}</button></header>
      {logoutError && <p className="daily-error" role="alert">{logoutError}</p>}
      <StaffTimeCard />
      <div className="daily-workspace">
        <section className="daily-panel daily-schedule" aria-labelledby="daily-schedule-heading">
          <header className="daily-panel-heading"><div><span className="daily-eyebrow">Your daily schedule</span><h2 id="daily-schedule-heading">Today’s appointments</h2></div><Link to="/admin/appointments">Manage appointments →</Link></header>
          <AdminDataRegion loading={schedule.loading} hasLoaded={Boolean(schedule.data)} error={schedule.error} label="Today’s appointments" onRetry={schedule.refresh}>
            {schedule.data && <>
              {schedule.data.rows.length ? <div className="daily-table-scroll" tabIndex={0} aria-label="Today’s appointment schedule"><table><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Dentist / Service</th><th scope="col">Status</th><th scope="col"><span className="daily-accessible">Appointment details</span></th></tr></thead><tbody>
                {schedule.data.rows.map(appointment => { const open = expanded?.key === scheduleKey && expanded.id === appointment.appointment_id; return <React.Fragment key={appointment.appointment_id}>
                  <tr><td className="daily-time">{timeLabel(appointment.appointment_datetime)}</td><td>{personName(appointment.patients)}</td><td><strong>{relation(appointment.services)?.service_name || 'Service not recorded'}</strong><small>{relation(appointment.doctors) ? `Dr. ${personName(appointment.doctors)}` : 'Dentist not recorded'}</small></td><td><span className={`daily-status daily-status-${['pending', 'confirmed', 'completed', 'cancelled'].includes(appointment.status) ? appointment.status : 'unknown'}`}>{statusLabel(appointment.status)}</span></td><td><button type="button" className="daily-view" aria-label={`${open ? 'Hide' : 'View'} appointment #${appointment.appointment_id}`} aria-expanded={open} aria-controls={`daily-appointment-${appointment.appointment_id}`} onClick={() => setExpanded(open ? null : { key: scheduleKey, id: appointment.appointment_id })}>{open ? 'Hide' : 'View'}</button></td></tr>
                  {open && <tr className="daily-detail"><td colSpan={5}><div id={`daily-appointment-${appointment.appointment_id}`}><strong>Appointment #{appointment.appointment_id}</strong><p>{formatClinicDateTime(appointment.appointment_datetime)}{appointment.appointment_end && Number.isFinite(Date.parse(appointment.appointment_end)) ? ` – ${timeLabel(appointment.appointment_end)}` : ''} · Philippines</p><div>{appointment.patient_id && <Link to={`/admin/patients/${appointment.patient_id}`}>View patient record</Link>}<Link to="/admin/appointments">Open appointment management</Link></div></div></td></tr>}
                </React.Fragment>; })}
              </tbody></table></div> : <div className="daily-empty"><i className="far fa-calendar-check" aria-hidden="true" /><h3>No appointments scheduled today</h3><p>You can review upcoming requests or create a booking.</p><Link to="/admin/manual-booking">Book an appointment →</Link></div>}
              {schedule.data.count > DASHBOARD_PAGE_SIZE && <nav className="daily-pagination" aria-label="Today’s schedule pages"><button type="button" disabled={page <= 1} onClick={() => setPagination({ key: context, page: page - 1 })}>Previous</button><span>Page {page} of {schedule.data.pages}</span><button type="button" disabled={page >= schedule.data.pages} onClick={() => setPagination({ key: context, page: page + 1 })}>Next</button></nav>}
              <p className="daily-updated">Last refreshed {timeLabel(schedule.data.refreshedAt)} · Scheduling status is shown here; completed status does not verify treatment documentation.</p>
            </>}
          </AdminDataRegion>
        </section>
        <aside className="daily-side">
          <section className="daily-panel" aria-labelledby="daily-requests-heading"><header className="daily-panel-heading"><div><span className="daily-eyebrow">Next to review</span><h2 id="daily-requests-heading">Pending requests</h2></div></header>
            <AdminDataRegion loading={pending.loading} hasLoaded={Boolean(pending.data)} error={pending.error} label="Pending requests" onRetry={pending.refresh}>
              {pending.data && <>{pending.data.count ? <><p className="daily-context">{pending.data.count} upcoming {pending.data.count === 1 ? 'request awaits' : 'requests await'} confirmation.</p><ul className="daily-request-list">{pending.data.rows.map(appointment => <li key={appointment.appointment_id}><strong>{personName(appointment.patients)}</strong><span>{relation(appointment.services)?.service_name || 'Service not recorded'}</span><time>{formatClinicDateTime(appointment.appointment_datetime)}</time></li>)}</ul><Link className="daily-section-link" to="/admin/appointments">Review requests →</Link></> : <p className="daily-quiet">No upcoming requests awaiting confirmation.</p>}</>}
            </AdminDataRegion>
          </section>
          <section className="daily-panel" aria-labelledby="daily-alerts-heading"><header className="daily-panel-heading"><div><span className="daily-eyebrow">Clinic reminders</span><h2 id="daily-alerts-heading">Needs attention</h2></div></header>
            <AdminDataRegion loading={supplies.loading} hasLoaded={Boolean(supplies.data)} error={supplies.error} label="Supply alerts" onRetry={supplies.refresh}>
              {supplies.data?.count > 0 && <div className="daily-alert"><h3>Supplies to review</h3><p>{supplies.data.count} {supplies.data.count === 1 ? 'item is' : 'items are'} at or below the reorder level.</p><ul>{supplies.data.rows.map(item => <li key={item.id}><span>{item.name}</span><strong className={item.outOfStock ? 'daily-stock-empty' : ''}>{item.outOfStock ? 'Out of stock' : 'Low stock'}</strong></li>)}</ul><Link to="/admin/inventory">Review inventory →</Link></div>}
            </AdminDataRegion>
            <AdminDataRegion loading={unbilled.loading} hasLoaded={Boolean(unbilled.data)} error={unbilled.error} label="Billing reminders" onRetry={unbilled.refresh}>
              {unbilled.data?.count > 0 && <div className="daily-alert"><h3>Appointments awaiting billing</h3><p>{unbilled.data.count} past {unbilled.data.count === 1 ? 'appointment has' : 'appointments have'} no linked bill.</p><Link to="/admin/billing">Open billing →</Link></div>}
            </AdminDataRegion>
            {allClear && <p className="daily-quiet">No supply or billing alerts right now.</p>}
          </section>
        </aside>
      </div>
      <section className="daily-quick-actions" aria-label="Quick actions"><div><h2>Quick actions</h2><p>Go straight to a common task.</p></div><nav aria-label="Common clinic tasks"><Link to="/admin/manual-booking"><i className="fas fa-calendar-plus" aria-hidden="true" /> Book Appointment</Link><Link to="/admin/patients"><i className="fas fa-search" aria-hidden="true" /> Find Patient</Link><Link to="/admin/billing"><i className="fas fa-receipt" aria-hidden="true" /> Open Billing</Link></nav></section>
    </main>
    {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><p>Logging out…</p></div></div>}
  </div>;
};
export default AdminDashboard;
