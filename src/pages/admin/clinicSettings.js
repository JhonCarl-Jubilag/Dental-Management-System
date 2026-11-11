import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { clinicDayBounds, formatClinicDateTime } from '../../utils/clinicScheduling';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import './clinicSettings.css';

const PAGE_SIZE = 20;
const EMPTY_FILTERS = { actor: '', module: '', date: '', record: '' };
const ACTION_LABELS = {
  appointment_created: 'Created appointment',
  appointment_approved: 'Approved appointment',
  appointment_cancelled: 'Cancelled appointment',
  appointment_completed: 'Marked appointment complete',
  appointment_rescheduled: 'Rescheduled appointment',
  appointment_notes_updated: 'Updated appointment notes',
  appointment_updated: 'Updated appointment',
  appointment_deleted: 'Deleted appointment',
  reschedule_approved: 'Approved reschedule request',
  reschedule_declined: 'Declined reschedule request',
  cancellation_approved: 'Approved cancellation request',
  cancellation_declined: 'Declined cancellation request',
  appointment_auto_completed: 'Automatically completed appointment',
  appointment_expired: 'Automatically cancelled expired appointment',
  billing_created: 'Created bill',
  billing_updated: 'Updated bill',
  billing_payment_increased: 'Increased amount paid',
  billing_payment_adjusted: 'Adjusted amount paid',
  billing_archived: 'Archived bill',
  billing_restored: 'Restored bill',
  treatment_created: 'Created treatment record',
  treatment_updated: 'Updated treatment record',
};
const MODULES = {
  appointment: { name: 'Appointments', record: 'Appointment' },
  billing: { name: 'Billing', record: 'Bill' },
  treatment: { name: 'Treatment Records', record: 'Treatment record' },
};
const ACTOR_LABELS = { super_admin: 'Owner', admin: 'Staff', system: 'System' };
const FIELD_LABELS = {
  initial_payment: 'Initial payment recorded',
  charges: 'Charges',
  discount: 'Discount',
  discount_reference: 'Discount reference',
  amount_paid: 'Amount paid',
  balance: 'Balance',
  payment_method: 'Payment method',
  payment_reference: 'Payment reference',
  payment_date: 'Payment date',
  billing_remarks: 'Billing remarks',
  archive_status: 'Archive status',
  record_link: 'Linked record',
  procedure: 'Procedure',
  tooth_selection: 'Tooth selection',
  treatment_time: 'Treatment time',
  treatment_notes: 'Treatment notes',
};

function ActivityDetails({ changes }) {
  const { from_status, to_status, from_time, to_time, appointment_id, fields } = changes || {};
  const timeChanged = Boolean(from_time || to_time);
  const fieldLabels = Array.isArray(fields) ? fields.map(field => FIELD_LABELS[field]).filter(Boolean) : [];
  return (
    <>
      {to_status && <div>{from_status || '—'} → {to_status}</div>}
      {timeChanged && <div>{from_time ? formatClinicDateTime(from_time) : '—'} → {to_time ? formatClinicDateTime(to_time) : '—'}</div>}
      {appointment_id != null && <div>Appointment #{appointment_id}</div>}
      {fieldLabels.length > 0 && <div>{fieldLabels.join(', ')}</div>}
      {!to_status && !timeChanged && appointment_id == null && fieldLabels.length === 0 && '—'}
    </>
  );
}

const ClinicSettings = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [query, setQuery] = useState({ filters: EMPTY_FILTERS, page: 1 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { filters, page } = query;
        let request = supabase.from('clinic_activity_log')
          .select('activity_id, occurred_at, actor_name, actor_role, resource_type, action, record_id, changes', { count: 'exact' });
        if (filters.module) request = request.eq('resource_type', filters.module);
        if (filters.actor) {
          const literal = filters.actor.replace(/[\\%_*]/g, '\\$&');
          request = request.ilike('actor_name', `%${literal}%`);
        }
        if (filters.record) request = request.eq('record_id', filters.record);
        if (filters.date) {
          const { start, end } = clinicDayBounds(filters.date);
          request = request.gte('occurred_at', start).lt('occurred_at', end);
        }
        const offset = (page - 1) * PAGE_SIZE;
        const { data, error: readError, count } = await request
          .order('occurred_at', { ascending: false })
          .order('activity_id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (readError) throw readError;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Could not verify activity history.');
        }
        setResult({ rows: data, count, page });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [query]);

  const apply = event => {
    event.preventDefault();
    setQuery({ filters: { ...draft, actor: draft.actor.trim() }, page: 1 });
  };
  const clear = () => {
    setDraft(EMPTY_FILTERS);
    setQuery({ filters: EMPTY_FILTERS, page: 1 });
  };
  const refresh = () => setQuery(current => ({ ...current }));
  const pageCount = Math.max(1, Math.ceil((result?.count || 0) / PAGE_SIZE));
  const setPage = page => setQuery(current => ({ ...current, page }));
  const logout = async () => {
    const outcome = await signOut();
    if (outcome?.success === false) {
      setError(new Error(outcome.message || 'Could not sign out.'));
      return;
    }
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={logout} />
      <main className="main-content clinic-settings">
        <header className="dashboard-header">
          <div className="header-title">
            <h1>Settings</h1>
            <p className="welcome-message">Review changes to appointments, billing, and treatment records.</p>
          </div>
        </header>

        <form className="filters" aria-label="Activity filters" onSubmit={apply}>
          <div className="filter-grid">
            <div className="filter-group">
              <label htmlFor="activity-actor">Performed by</label>
              <input id="activity-actor" className="form-control" type="search" maxLength={200}
                placeholder="Name or System" value={draft.actor} onChange={event => setDraft({ ...draft, actor: event.target.value })} />
            </div>
            <div className="filter-group">
              <label htmlFor="activity-module">Module</label>
              <select id="activity-module" className="form-control" value={draft.module}
                onChange={event => setDraft({ ...draft, module: event.target.value })}>
                <option value="">All modules</option>
                {Object.entries(MODULES).map(([value, module]) => <option key={value} value={value}>{module.name}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="activity-date">Date</label>
              <input id="activity-date" className="form-control" type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} />
            </div>
            <div className="filter-group">
              <label htmlFor="activity-record">Record ID</label>
              <input id="activity-record" className="form-control" inputMode="numeric" pattern="[0-9]+" maxLength={18}
                placeholder="Record number" value={draft.record} onChange={event => setDraft({ ...draft, record: event.target.value })} />
            </div>
            <div className="filter-group filter-actions">
              <button type="submit" className="btn btn-primary">Apply</button>
              <button type="button" className="btn btn-secondary" onClick={clear}>Reset</button>
            </div>
          </div>
        </form>

        <section className="table-container" aria-labelledby="activity-heading">
          <div className="table-header">
            <div>
              <h2 id="activity-heading">Activity History</h2>
              <p className="welcome-message">Clinic record changes · Philippine time</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={refresh} disabled={loading}>
              <i className="fas fa-sync-alt" aria-hidden="true"></i> Refresh
            </button>
          </div>
          {['42P01', 'PGRST205'].includes(error?.code) ? (
            <p className="activity-unavailable" role="status">Activity History has not been set up yet.</p>
          ) : (
            <AdminDataRegion label="Activity history" loading={loading} hasLoaded={Boolean(result)} error={error} onRetry={refresh}>
              <div className="table-responsive" role="region" aria-label="Clinic activity table" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date and time</th><th scope="col">Performed by</th><th scope="col">Action</th>
                      <th scope="col">Record</th><th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.rows.map(row => (
                      <tr key={row.activity_id}>
                        <td><time dateTime={row.occurred_at}>{formatClinicDateTime(row.occurred_at)}</time></td>
                        <td>
                          <strong>{row.actor_name}</strong>
                          {row.actor_role !== 'system' && <small className="activity-role">{ACTOR_LABELS[row.actor_role]}</small>}
                        </td>
                        <td>{ACTION_LABELS[row.action] || 'Record changed'}</td>
                        <td>{MODULES[row.resource_type]?.record || 'Record'} #{row.record_id}</td>
                        <td><ActivityDetails changes={row.changes} /></td>
                      </tr>
                    ))}
                    {result?.rows.length === 0 && <tr><td colSpan={5}>No activity matches your filters.</td></tr>}
                  </tbody>
                </table>
              </div>
              {pageCount > 1 && (
                <nav className="pagination-controls" aria-label="Activity pages">
                  <button type="button" className="btn btn-secondary" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>Previous</button>
                  <span>Page {result.page} of {pageCount}</span>
                  <button type="button" className="btn btn-secondary" disabled={result.page >= pageCount} onClick={() => setPage(result.page + 1)}>Next</button>
                </nav>
              )}
            </AdminDataRegion>
          )}
        </section>
      </main>
    </div>
  );
};

export default ClinicSettings;
