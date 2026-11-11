import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isOwner } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageStaff.css';

const staffPasswordLimits = { minLength: 12, maxLength: 4096 };
const emptyPasswords = { password: '', confirm_password: '' };
const emptyForm = { first_name: '', last_name: '', email: '', ...emptyPasswords };
const StaffPasswordFields = ({ prefix, label, values, setValues }) => (
  <>
    <div className="staff-form-field">
      <label htmlFor={`${prefix}-password`}>{label}</label>
      <input id={`${prefix}-password`} type="password" required {...staffPasswordLimits}
        autoComplete="new-password" aria-describedby={`${prefix}-password-hint`}
        value={values.password} onChange={event => setValues({ ...values, password: event.target.value })} />
      <small id={`${prefix}-password-hint`}>At least {staffPasswordLimits.minLength} characters.</small>
    </div>
    <div className="staff-form-field">
      <label htmlFor={`${prefix}-confirm-password`}>Confirm password</label>
      <input id={`${prefix}-confirm-password`} type="password" required {...staffPasswordLimits}
        autoComplete="new-password" value={values.confirm_password}
        onChange={event => setValues({ ...values, confirm_password: event.target.value })} />
    </div>
  </>
);
const staffSnapshot = profile => Object.fromEntries(['first_name', 'last_name', 'email', 'status'].map(key => [key, profile[key]]));
const manageStaffAccount = async body => {
  const { data, error } = await supabase.functions.invoke('manage-staff-account', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* Keep transport error. */ }
    throw new Error(message || 'Staff account setup is unavailable.');
  }
  if (!data?.success) throw new Error(data?.error || 'The Staff request did not finish.');
  return data;
};

const ManageStaff = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user && isOwner(userType));
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [mode, setMode] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [editNames, setEditNames] = useState({ first_name: '', last_name: '' });
  const [editEmail, setEditEmail] = useState('');
  const [editPasswords, setEditPasswords] = useState(emptyPasswords);
  const [nameSnapshot, setNameSnapshot] = useState(null);
  const saving = useRef(false);
  const request = useRef(0);

  useEffect(() => {
    if (!authLoading && !allowed) navigate(user ? '/admin/dashboard' : '/login', { replace: true });
  }, [allowed, authLoading, navigate, user]);
  const load = useCallback(async () => {
    if (!allowed) return;
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await manageStaffAccount({ action: 'list', page });
      if (!Array.isArray(result.staff) || !Number.isSafeInteger(result.total) || result.page_size !== 10) {
        throw new Error('Staff accounts could not be loaded. Please refresh.');
      }
      if (version === request.current) {
        setStaffAccounts(result.staff); setTotal(result.total); setHasLoaded(true);
      }
    } catch (err) {
      if (version === request.current) setError(err.message);
    } finally { if (version === request.current) setLoading(false); }
  }, [allowed, page]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);

  const closeForm = () => {
    setMode(null); setSelectedStaff(null); setForm(emptyForm);
    setEditNames({ first_name: '', last_name: '' }); setEditEmail(''); setNameSnapshot(null);
    setEditPasswords(emptyPasswords);
  };
  const openEdit = staff => {
    setSelectedStaff(staff); setEditNames({ first_name: staff.first_name, last_name: staff.last_name });
    setEditEmail(staff.email); setNameSnapshot(staffSnapshot(staff)); setMode('edit');
  };
  const replaceStaff = (profile, expectedId) => {
    if (!profile || !Number.isSafeInteger(profile.admin_id) || profile.admin_id !== expectedId) throw new Error('Could not verify the saved Staff account. Refresh before retrying.');
    setStaffAccounts(current => current.map(staff => staff.admin_id === profile.admin_id ? profile : staff));
    return profile;
  };

  const createStaff = async event => {
    event.preventDefault();
    if (!allowed || loading || error || saving.current || mode !== 'create') return;
    if (form.password !== form.confirm_password) { toast.error('Passwords do not match.'); return; }
    saving.current = true; setBusy(true);
    try {
      const result = await manageStaffAccount({ action: 'create', first_name: form.first_name,
        last_name: form.last_name, email: form.email, password: form.password });
      if (!result.staff?.linked || !Number.isSafeInteger(result.staff.admin_id)) throw new Error('Could not verify Staff creation. Refresh before retrying.');
      closeForm();
      toast.success('Staff account created successfully.');
      if (page === 1) await load(); else setPage(1);
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };
  const changeStatus = async staff => {
    if (!allowed || !staff?.linked || loading || error || saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const status = staff.status === 'active' ? 'inactive' : 'active';
      const result = await manageStaffAccount({ action: 'set_status', admin_id: staff.admin_id, expected_status: staff.status, status });
      replaceStaff(result.staff, staff.admin_id);
      toast.success(status === 'active' ? 'Staff clinic access enabled.' : 'Staff clinic access disabled.');
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };

  const saveNames = async event => {
    event.preventDefault();
    if (!allowed || !selectedStaff?.linked || saving.current || mode !== 'edit') return;
    saving.current = true; setBusy(true);
    try {
      const result = await manageStaffAccount({ action: 'update_names', admin_id: selectedStaff.admin_id, ...editNames, expected: nameSnapshot });
      const profile = replaceStaff(result.staff, selectedStaff.admin_id); setSelectedStaff(profile);
      setNameSnapshot(staffSnapshot(profile));
      setEditNames({ first_name: profile.first_name, last_name: profile.last_name });
      toast.success('Staff details updated successfully.');
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };
  const saveEmail = async event => {
    event.preventDefault();
    if (!allowed || !selectedStaff?.linked || saving.current || mode !== 'edit') return;
    saving.current = true; setBusy(true);
    try {
      const result = await manageStaffAccount({ action: 'change_email', admin_id: selectedStaff.admin_id,
        new_email: editEmail, expected_email: selectedStaff.email });
      const profile = replaceStaff(result.staff, selectedStaff.admin_id); setSelectedStaff(profile); setEditEmail(profile.email);
      // Refresh only the email part of the name form's original snapshot.
      // A concurrent name/status edit must still make that draft fail safely.
      setNameSnapshot(previous => ({ ...previous, email: profile.email }));
      toast.success('Login email updated. Use the new email with the existing password.');
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };

  const savePassword = async event => {
    event.preventDefault();
    if (!allowed || !selectedStaff?.linked || saving.current || mode !== 'edit') return;
    if (editPasswords.password !== editPasswords.confirm_password) {
      toast.error('Passwords do not match.');
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await manageStaffAccount({
        action: 'change_password',
        admin_id: selectedStaff.admin_id,
        expected_email: selectedStaff.email,
        password: editPasswords.password,
      });
      setEditPasswords(emptyPasswords);
      toast.success('Staff login password updated.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (authLoading || !allowed) return null;
  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={async () => { await signOut(); navigate('/login'); }} />
      <main className="main-content staff-account-page">
        <div className="staff-account-heading">
          <h1>Staff accounts {hasLoaded && <span className="staff-account-count">{total}</span>}</h1>
          <div className="staff-heading-actions">
            <button type="button" className="staff-refresh-button" onClick={() => load()} disabled={loading || busy || Boolean(mode)}>
              <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} aria-hidden="true"></i> Refresh
            </button>
            <button type="button" className="staff-submit-button" disabled={loading || busy || Boolean(error) || Boolean(mode)} onClick={() => { setForm(emptyForm); setMode('create'); }}>
              <i className="fas fa-plus" aria-hidden="true"></i> Add Staff
            </button>
          </div>
        </div>
        {loading && !hasLoaded && <div className="staff-account-state" role="status">Loading Staff accounts…</div>}
        {error && <div className="staff-account-error" role="alert">{error}</div>}
        {mode === 'create' && <form className="staff-account-card staff-account-form staff-account-editor" onSubmit={createStaff}>
          <div className="staff-form-heading"><h2>Add Staff account</h2></div>
          <fieldset disabled={busy}>
            <div className="staff-form-grid">
              <div className="staff-form-field">
                <label htmlFor="staff-first-name">First name</label><input id="staff-first-name" autoFocus required maxLength={200} autoComplete="given-name" value={form.first_name} onChange={event => setForm({ ...form, first_name: event.target.value })} />
              </div>
              <div className="staff-form-field">
                <label htmlFor="staff-last-name">Last name</label><input id="staff-last-name" required maxLength={200} autoComplete="family-name" value={form.last_name} onChange={event => setForm({ ...form, last_name: event.target.value })} />
              </div>
              <div className="staff-form-field staff-form-field-wide">
                <label htmlFor="staff-email">Email</label><input id="staff-email" type="email" required maxLength={254} autoComplete="off" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
              </div>
              <StaffPasswordFields prefix="staff" label="Password" values={form} setValues={setForm} />
            </div>
            <div className="staff-form-actions">
              <small>No invitation email is sent.</small>
              <div className="staff-heading-actions">
                <button type="button" className="staff-refresh-button" onClick={closeForm}>Cancel</button>
                <button type="submit" className="staff-submit-button">{busy ? 'Creating…' : 'Create Staff account'}</button>
              </div>
            </div>
          </fieldset>
        </form>}
        {mode === 'edit' && selectedStaff && <section className="staff-account-card staff-account-editor" aria-label="Edit Staff account">
          <div className="staff-form-heading staff-editor-heading">
            <h2>Edit Staff account</h2>
            <button type="button" className="staff-refresh-button" disabled={busy} onClick={closeForm}>Done</button>
          </div>
          <form onSubmit={saveNames} aria-label="Staff name">
            <fieldset disabled={busy}>
              <div className="staff-form-grid">
                <div className="staff-form-field"><label htmlFor="staff-edit-first-name">First name</label>
                  <input id="staff-edit-first-name" autoFocus required maxLength={200} autoComplete="given-name" value={editNames.first_name} onChange={event => setEditNames({ ...editNames, first_name: event.target.value })} /></div>
                <div className="staff-form-field"><label htmlFor="staff-edit-last-name">Last name</label>
                  <input id="staff-edit-last-name" required maxLength={200} autoComplete="family-name" value={editNames.last_name} onChange={event => setEditNames({ ...editNames, last_name: event.target.value })} /></div>
              </div>
              <div className="staff-name-actions"><button type="submit" className="staff-submit-button">{busy ? 'Saving…' : 'Save details'}</button></div>
            </fieldset>
          </form>
          <form onSubmit={saveEmail} className="staff-email-editor" aria-label="Staff login email">
            <fieldset disabled={busy}>
              <div className="staff-form-field"><label htmlFor="staff-edit-email">Login email</label>
                <input id="staff-edit-email" type="email" required maxLength={254} autoComplete="off" aria-describedby="staff-email-hint" value={editEmail} onChange={event => setEditEmail(event.target.value)} />
                <small id="staff-email-hint">Changing this address also changes the Staff login email.</small></div>
              <button type="submit" className="staff-submit-button" disabled={editEmail.trim().toLowerCase() === selectedStaff.email.toLowerCase()}>Update email</button>
            </fieldset>
          </form>
          <form onSubmit={savePassword} className="staff-password-editor" aria-labelledby="staff-password-heading">
            <fieldset disabled={busy}>
              <div className="staff-form-grid">
                <div className="staff-form-field staff-form-field-wide">
                  <h3 id="staff-password-heading">Change password</h3>
                  <small>Login account: {selectedStaff.email}</small>
                </div>
                <StaffPasswordFields prefix="staff-edit" label="New password"
                  values={editPasswords} setValues={setEditPasswords} />
              </div>
              <div className="staff-name-actions">
                <button type="submit" className="staff-submit-button">Change password</button>
              </div>
            </fieldset>
          </form>
        </section>}
        {hasLoaded && <div className="staff-account-grid">
          {staffAccounts.map(staff => <section key={staff.admin_id} className="staff-account-card" aria-label={`Staff account: ${staff.first_name} ${staff.last_name}`}>
            <div className="staff-profile-heading">
              <div className="staff-profile-identity">
                <span className="staff-profile-avatar" aria-hidden="true">{staff.first_name?.charAt(0)}{staff.last_name?.charAt(0)}</span>
                <div><span className="staff-profile-label">Clinic staff</span><h2>{staff.first_name} {staff.last_name}</h2></div>
              </div>
              <span className={`staff-status-badge ${staff.status === 'active' ? 'staff-status-active' : 'staff-status-inactive'}`}><span aria-hidden="true"></span>{staff.status === 'active' ? 'Active' : 'Inactive'}</span>
            </div>
            <dl className="staff-account-details">
              <div><dt>Email address</dt><dd>{staff.email}</dd></div>
              <div><dt>Account role</dt><dd>Admin / Staff</dd></div>
            </dl>
            {!staff.linked && <p className="staff-account-error staff-account-link-error" role="alert">This Staff account has no linked login. Review the account before editing.</p>}
            <div className="staff-access-settings">
              <button type="button" className="staff-edit-button" onClick={() => openEdit(staff)} disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked} aria-label={`Edit details for ${staff.first_name} ${staff.last_name}`}>Edit details</button>
              <button type="button" className={`staff-access-button ${staff.status === 'active' ? 'staff-access-disable' : 'staff-access-enable'}`} onClick={() => changeStatus(staff)} disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked} aria-label={`${staff.status === 'active' ? 'Disable' : 'Enable'} access for ${staff.first_name} ${staff.last_name}`}>
                {staff.status === 'active' ? 'Disable access' : 'Enable access'}
              </button>
            </div>
          </section>)}
        </div>}
        {hasLoaded && !error && staffAccounts.length === 0 && !mode && <div className="staff-account-state">No Staff accounts yet. Select Add Staff to create one.</div>}
        {total > 10 && <nav className="staff-pagination" aria-label="Staff account pages">
          <button type="button" className="staff-refresh-button" disabled={page === 1 || loading || busy || Boolean(mode)} onClick={() => setPage(current => current - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(total / 10)}</span>
          <button type="button" className="staff-refresh-button" disabled={page >= Math.ceil(total / 10) || loading || busy || Boolean(mode)} onClick={() => setPage(current => current + 1)}>Next</button>
        </nav>}
      </main>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default ManageStaff;
