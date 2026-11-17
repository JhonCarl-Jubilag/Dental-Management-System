import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isOwner } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import { StaffAttendanceRecords } from './dailyTimeRecords';
import { formatClinicDateTime } from '../../utils/clinicScheduling';
import './manageStaff.css';

const staffPasswordLimits = { minLength: 12, maxLength: 4096 };
const emptyPasswords = { password: '', confirm_password: '' };
const emptyForm = { first_name: '', last_name: '', email: '', ...emptyPasswords };
const StaffPasswordFields = ({ prefix, label, values, setValues }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  useEffect(() => {
    if (!values.password) setShowPassword(false);
    if (!values.confirm_password) setShowConfirmation(false);
  }, [values.password, values.confirm_password]);
  return <>
    <div className="staff-form-field">
      <label htmlFor={prefix + '-password'}>{label}</label>
      <div className="staff-password-input">
        <input id={prefix + '-password'} type={showPassword ? 'text' : 'password'} required {...staffPasswordLimits}
          autoComplete="new-password" aria-describedby={prefix + '-password-hint'}
          value={values.password} onChange={event => setValues({ ...values, password: event.target.value })} />
        <button type="button" className="staff-password-toggle" aria-label={(showPassword ? 'Hide ' : 'Show ') + label.toLowerCase()}
          aria-pressed={showPassword} aria-controls={prefix + '-password'} onClick={() => setShowPassword(current => !current)}>
          <i className={'fas fa-' + (showPassword ? 'eye-slash' : 'eye')} aria-hidden="true" />
        </button>
      </div>
      <small id={prefix + '-password-hint'}>At least {staffPasswordLimits.minLength} characters.</small>
    </div>
    <div className="staff-form-field">
      <label htmlFor={prefix + '-confirm-password'}>Confirm password</label>
      <div className="staff-password-input">
        <input id={prefix + '-confirm-password'} type={showConfirmation ? 'text' : 'password'} required {...staffPasswordLimits}
          autoComplete="new-password" value={values.confirm_password}
          onChange={event => setValues({ ...values, confirm_password: event.target.value })} />
        <button type="button" className="staff-password-toggle" aria-label={showConfirmation ? 'Hide confirm password' : 'Show confirm password'}
          aria-pressed={showConfirmation} aria-controls={prefix + '-confirm-password'} onClick={() => setShowConfirmation(current => !current)}>
          <i className={'fas fa-' + (showConfirmation ? 'eye-slash' : 'eye')} aria-hidden="true" />
        </button>
      </div>
    </div>
  </>;
};
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

const ManageStaff = ({ embedded = false, profileId = '' }) => {
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
  const [editSection, setEditSection] = useState('details');
  const [editNames, setEditNames] = useState({ first_name: '', last_name: '' });
  const [editEmail, setEditEmail] = useState('');
  const [editPasswords, setEditPasswords] = useState(emptyPasswords);
  const [nameSnapshot, setNameSnapshot] = useState(null);
  const createDialog = useRef(null);
  const addStaffButton = useRef(null);
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
      if (profileId) {
        const id = Number(profileId);
        if (!/^[1-9]\d*$/.test(String(profileId)) || !Number.isSafeInteger(id)) throw new Error('Choose a valid Staff account.');
        const { data, error: profileError } = await supabase.from('admin')
          .select('admin_id, first_name, last_name, email, status, date_created, auth_user_id')
          .eq('role', 'admin').eq('admin_id', id).maybeSingle();
        if (profileError) throw new Error('Could not load this Staff account. Please refresh.');
        if (!data || data.admin_id !== id) throw new Error('Staff account not found.');
        const { auth_user_id, ...profile } = data;
        if (version === request.current) {
          setStaffAccounts([{ ...profile, linked: Boolean(auth_user_id) }]); setTotal(1); setHasLoaded(true);
        }
        return;
      }
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
  }, [allowed, page, profileId]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);

  useEffect(() => {
    if (mode !== 'create' || !createDialog.current) return;
    const dialog = createDialog.current;
    const previousFocus = addStaffButton.current || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mode]);

  const closeForm = () => {
    setMode(null); setSelectedStaff(null); setForm(emptyForm); setEditSection('details');
    setEditNames({ first_name: '', last_name: '' }); setEditEmail(''); setNameSnapshot(null);
    setEditPasswords(emptyPasswords);
  };
  const openEdit = (staff, section = 'details') => {
    setEditSection(section); setEditPasswords(emptyPasswords);
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

  useEffect(() => {
    const closeMenus = event => {
      if (event.target.closest?.('.staff-actions-menu')) return;
      document.querySelectorAll('.staff-account-page .staff-actions-menu[open]').forEach(menu => { menu.open = false; });
    };
    document.addEventListener('pointerdown', closeMenus);
    return () => document.removeEventListener('pointerdown', closeMenus);
  }, []);

  if (authLoading || !allowed) return null;
  const Content = embedded ? 'section' : 'main';
  const Heading = embedded ? 'h2' : 'h1';
  return (
    <div className={embedded ? undefined : 'admin-dashboard'}>
      {!embedded && <Sidebar onLogout={async () => { await signOut(); navigate('/login'); }} />}
      <Content className={embedded ? 'staff-account-page' : 'main-content staff-account-page'}>
        <div className="staff-account-heading">
          <Heading>{profileId ? 'Staff details' : <>Staff accounts {hasLoaded && <span className="staff-account-count">{total}</span>}</>}</Heading>
          <div className="staff-heading-actions">
            {profileId && <Link to="/admin/settings?section=staff" className="staff-refresh-button">Back to Staff Accounts</Link>}
            <Link to="/admin/attendance" className="staff-refresh-button">View All Daily Time Records</Link>
            <button type="button" className="staff-refresh-button" onClick={() => load()} disabled={loading || busy || Boolean(mode)}>
              <i className={`fas fa-sync-alt${loading ? ' fa-spin' : ''}`} aria-hidden="true"></i> Refresh
            </button>
            {!profileId && <button ref={addStaffButton} type="button" className="staff-submit-button" disabled={loading || busy || Boolean(error) || Boolean(mode)} onClick={() => { setForm(emptyForm); setMode('create'); }}>
              <i className="fas fa-plus" aria-hidden="true"></i> Add Staff
            </button>}
          </div>
        </div>
        {loading && !hasLoaded && <div className="staff-account-state" role="status">Loading Staff accounts…</div>}
        {error && <div className="staff-account-error" role="alert">{error}</div>}
        {mode === 'create' && <dialog ref={createDialog} className="staff-create-dialog" aria-labelledby="staff-create-title"
          onCancel={event => { event.preventDefault(); if (!saving.current) closeForm(); }}>
          <form className="staff-account-form" onSubmit={createStaff}>
          <div className="staff-form-heading staff-editor-heading"><h2 id="staff-create-title">Add Staff account</h2>
            <button type="button" className="staff-refresh-button staff-dialog-close" aria-label="Close Add Staff account" disabled={busy} onClick={closeForm}>×</button>
          </div>
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
          </form>
        </dialog>}
        {mode === 'edit' && selectedStaff && <section className="staff-account-card staff-account-editor" aria-label="Edit Staff account">
          <div className="staff-form-heading staff-editor-heading">
            <h2>{editSection === 'email' ? 'Change login email' : editSection === 'password' ? 'Change password' : 'Edit Staff details'}</h2>
            <button type="button" className="staff-refresh-button" disabled={busy} onClick={closeForm}>Done</button>
          </div>
          {editSection === 'details' && <form onSubmit={saveNames} aria-label="Staff name">
            <fieldset disabled={busy}>
              <div className="staff-form-grid">
                <div className="staff-form-field"><label htmlFor="staff-edit-first-name">First name</label>
                  <input id="staff-edit-first-name" autoFocus required maxLength={200} autoComplete="given-name" value={editNames.first_name} onChange={event => setEditNames({ ...editNames, first_name: event.target.value })} /></div>
                <div className="staff-form-field"><label htmlFor="staff-edit-last-name">Last name</label>
                  <input id="staff-edit-last-name" required maxLength={200} autoComplete="family-name" value={editNames.last_name} onChange={event => setEditNames({ ...editNames, last_name: event.target.value })} /></div>
              </div>
              <div className="staff-name-actions"><button type="submit" className="staff-submit-button">{busy ? 'Saving…' : 'Save details'}</button></div>
            </fieldset>
          </form>}
          {editSection === 'email' && <form onSubmit={saveEmail} className="staff-email-editor" aria-label="Staff login email">
            <fieldset disabled={busy}>
              <div className="staff-form-field"><label htmlFor="staff-edit-email">Login email</label>
                <input id="staff-edit-email" type="email" required maxLength={254} autoComplete="off" aria-describedby="staff-email-hint" value={editEmail} onChange={event => setEditEmail(event.target.value)} />
                <small id="staff-email-hint">Changing this address also changes the Staff login email.</small></div>
              <button type="submit" className="staff-submit-button" disabled={editEmail.trim().toLowerCase() === selectedStaff.email.toLowerCase()}>Update email</button>
            </fieldset>
          </form>}
          {editSection === 'password' && <form onSubmit={savePassword} className="staff-password-editor" aria-labelledby="staff-password-heading">
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
          </form>}
        </section>}
        {hasLoaded && <div className={'staff-account-grid' + (profileId ? ' staff-profile-grid' : '')}>
          {staffAccounts.map(staff => <section key={staff.admin_id} className="staff-account-card" aria-label={`Staff account: ${staff.first_name} ${staff.last_name}`}>
            <div className="staff-profile-heading">
              <div className="staff-profile-identity">
                <span className="staff-profile-avatar" aria-hidden="true">{staff.first_name?.charAt(0)}{staff.last_name?.charAt(0)}</span>
                <div><span className="staff-profile-label">Clinic staff</span><h2>{profileId ? <>{staff.first_name} {staff.last_name}</> : (
                  <Link className="staff-profile-link" to={'/admin/settings/staff/' + staff.admin_id}
                    aria-label={'View details and time records for ' + staff.first_name + ' ' + staff.last_name}
                    aria-disabled={busy || loading || Boolean(error) || Boolean(mode)}
                    onClick={event => { if (busy || loading || error || mode) event.preventDefault(); }}>
                    {staff.first_name} {staff.last_name}
                  </Link>
                )}</h2></div>
              </div>
              <div className="staff-profile-controls">
                <span className={'staff-status-badge ' + (staff.status === 'active' ? 'staff-status-active' : 'staff-status-inactive')}><span aria-hidden="true"></span>{staff.status === 'active' ? 'Active' : 'Inactive'}</span>
                <details className="staff-actions-menu" name="staff-account-actions"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector('summary').focus();
                    }
                  }}>
                  <summary aria-label={'Actions for ' + staff.first_name + ' ' + staff.last_name}><span aria-hidden="true">⋮</span></summary>
                  <div className="staff-actions-list" role="group" aria-label={'Account actions for ' + staff.first_name + ' ' + staff.last_name}>
                    <button type="button" onClick={event => { event.currentTarget.closest('details').open = false; openEdit(staff, 'details'); }}
                      disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked}>Edit details</button>
                    <button type="button" onClick={event => { event.currentTarget.closest('details').open = false; openEdit(staff, 'email'); }}
                      disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked}>Change login email</button>
                    <button type="button" onClick={event => { event.currentTarget.closest('details').open = false; openEdit(staff, 'password'); }}
                      disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked}>Change password</button>
                    <button type="button" className={staff.status === 'active' ? 'staff-menu-disable' : ''}
                      onClick={event => { event.currentTarget.closest('details').open = false; changeStatus(staff); }}
                      disabled={busy || loading || Boolean(error) || Boolean(mode) || !staff.linked}>
                      {staff.status === 'active' ? 'Disable access' : 'Enable access'}
                    </button>
                  </div>
                </details>

              </div>
            </div>
            <dl className="staff-account-details">
              <div><dt>Email address</dt><dd>{staff.email}</dd></div>
              <div><dt>Account role</dt><dd>Admin / Staff</dd></div>
              {profileId && <><div><dt>Staff ID</dt><dd>#{staff.admin_id}</dd></div><div><dt>Account created</dt><dd>{Number.isFinite(Date.parse(staff.date_created)) ? formatClinicDateTime(staff.date_created) : 'Not recorded'}</dd></div></>}
            </dl>
            {!staff.linked && <p className="staff-account-error staff-account-link-error" role="alert">This Staff account has no linked login. Review the account before editing.</p>}

          </section>)}
        </div>}
        {profileId && hasLoaded && staffAccounts[0] && <StaffAttendanceRecords staffId={staffAccounts[0].admin_id} />}
        {hasLoaded && !error && staffAccounts.length === 0 && !mode && <div className="staff-account-state">No Staff accounts yet. Select Add Staff to create one.</div>}
        {total > 10 && <nav className="staff-pagination" aria-label="Staff account pages">
          <button type="button" className="staff-refresh-button" disabled={page === 1 || loading || busy || Boolean(mode)} onClick={() => setPage(current => current - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(total / 10)}</span>
          <button type="button" className="staff-refresh-button" disabled={page >= Math.ceil(total / 10) || loading || busy || Boolean(mode)} onClick={() => setPage(current => current + 1)}>Next</button>
        </nav>}
      </Content>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default ManageStaff;
