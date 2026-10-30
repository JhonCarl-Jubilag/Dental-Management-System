import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isOwner } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageStaff.css';

const emptyForm = { first_name: '', last_name: '', email: '', password: '', confirm_password: '' };
const manageStaffAccount = async body => {
  const { data, error } = await supabase.functions.invoke('manage-staff-account', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* Keep transport error. */ }
    throw new Error(message || 'Staff account setup is unavailable.');
  }
  if (!data?.success) throw new Error(data?.error || 'The Staff request did not finish.');
  return data.staff;
};

const ManageStaff = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user && isOwner(userType));
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
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
      const profile = await manageStaffAccount({ action: 'get' });
      if (version === request.current) setStaff(profile);
    } catch (err) {
      if (version === request.current) setError(err.message);
    } finally { if (version === request.current) setLoading(false); }
  }, [allowed]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);

  const createStaff = async event => {
    event.preventDefault();
    if (!allowed || loading || error || saving.current) return;
    if (form.password !== form.confirm_password) { toast.error('Passwords do not match.'); return; }
    saving.current = true; setBusy(true);
    try {
      const profile = await manageStaffAccount({ action: 'create', first_name: form.first_name,
        last_name: form.last_name, email: form.email, password: form.password });
      setStaff(profile); setForm(emptyForm);
      toast.success('Staff account created. Use the shared login page to sign in.');
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };
  const changeStatus = async () => {
    if (!allowed || !staff?.linked || loading || error || saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const status = staff.status === 'active' ? 'inactive' : 'active';
      const profile = await manageStaffAccount({ action: 'set_status', admin_id: staff.admin_id, expected_status: staff.status, status });
      setStaff(profile);
      toast.success(status === 'active' ? 'Staff clinic access enabled.' : 'Staff clinic access disabled.');
    } catch (err) { toast.error(err.message); }
    finally { saving.current = false; setBusy(false); }
  };

  if (authLoading || !allowed) return null;
  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={async () => { await signOut(); navigate('/login'); }} />
      <main className="main-content staff-account-page">
        <div className="staff-account-heading"><div><h1>Staff account</h1><p>Manage the clinic's single Staff login. Only the Owner can use this page.</p></div>
          <button type="button" onClick={load} disabled={loading || busy}>Refresh</button></div>
        <p className="staff-account-info">Staff handles daily appointments, patient documentation, billing, inventory, dentist schedules, services and routine reports. Staff cannot manage clinic login access or change patient login emails. Dentist contact details are clinic records.</p>
        {loading && <p role="status">Loading Staff account…</p>}
        {error && <div className="staff-account-error" role="alert">{error}<p>Refresh after the Staff migration and backend function have been deployed.</p></div>}
        {!loading && !error && staff && <section className="staff-account-card" aria-label="Current Staff account">
          <h2>{staff.first_name} {staff.last_name}</h2><p>{staff.email}</p>
          <p>Clinic access: <strong>{staff.status === 'active' ? 'Enabled' : 'Disabled'}</strong></p>
          {!staff.linked && <p className="staff-account-error" role="alert">The Staff profile has no linked login. Repair the account link before changing access.</p>}
          <p>Disabling clinic access also blocks existing Staff sessions from clinic data. The Staff profile and clinic records are kept.</p>
          <button type="button" onClick={changeStatus} disabled={busy || !staff.linked}>{busy ? 'Saving…' : staff.status === 'active' ? 'Disable Staff access' : 'Enable Staff access'}</button>
          <p>The Staff member uses the shared login page and can use Forgot Password to reset their password.</p>
        </section>}
        {!loading && !error && !staff && <form className="staff-account-card" onSubmit={createStaff}>
          <h2>Create Staff account</h2><p>Use a separate Staff email. An existing patient or dentist login cannot be converted here.</p>
          <fieldset disabled={busy}>
            <label htmlFor="staff-first-name">First name</label><input id="staff-first-name" required maxLength={200} autoComplete="given-name" value={form.first_name} onChange={event => setForm({ ...form, first_name: event.target.value })} />
            <label htmlFor="staff-last-name">Last name</label><input id="staff-last-name" required maxLength={200} autoComplete="family-name" value={form.last_name} onChange={event => setForm({ ...form, last_name: event.target.value })} />
            <label htmlFor="staff-email">Email</label><input id="staff-email" type="email" required maxLength={254} autoComplete="off" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
            <label htmlFor="staff-password">Password</label><input id="staff-password" type="password" required minLength={12} maxLength={4096} autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
            <label htmlFor="staff-confirm-password">Confirm password</label><input id="staff-confirm-password" type="password" required minLength={12} maxLength={4096} autoComplete="new-password" value={form.confirm_password} onChange={event => setForm({ ...form, confirm_password: event.target.value })} />
            <p>Use at least 12 characters. Creating the account does not send an email; give the credentials to your Staff member yourself.</p>
            <button type="submit">{busy ? 'Creating…' : 'Create Staff account'}</button>
          </fieldset>
        </form>}
      </main>
      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default ManageStaff;
