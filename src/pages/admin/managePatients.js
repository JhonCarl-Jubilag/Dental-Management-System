import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Pencil, KeyRound, UserRound, Contact, ShieldCheck, CircleOff, CircleCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import PatientTreatmentHistory from '../../components/admin/PatientTreatmentHistory';
import './managePatients.css';

const patientFields = 'patient_id, first_name, last_name, email, contact_no, address, birthday, age, date_created, status, email_verified';

const managePatientAccount = async (body) => {
  const { data, error } = await supabase.functions.invoke('manage-patient-account', { body });
  if (error) {
    let message = error.message;
    if (error.context?.json) {
      try {
        const details = await error.context.json();
        message = details.error || message;
      } catch { /* Keep the original error if no JSON response was returned. */ }
    }
    throw new Error(message);
  }
  if (!data?.success) throw new Error(data?.error || 'The account request did not complete.');
  return data;
};

const ManagePatients = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const [viewMode, setViewMode] = useState(id ? 'detail' : 'list');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    setViewMode(id ? 'detail' : 'list');
  }, [id]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (!isClinicUser(userType)) navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading authentication...</p>
      </div>
    );
  }

  const isSuperAdmin = isOwner(userType);
  if (!user || (!isClinicUser(userType))) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />
      <div className="main-content">
        {viewMode === 'list' ? (
          <PatientList
            onViewDetail={(patientId) => navigate(`/admin/patients/${patientId}`)}
            user={user}
            userType={userType}
            isSuperAdmin={isSuperAdmin}
            adminName={adminName}
            adminInitial={adminInitial}
          />
        ) : (
          <PatientDetail
            key={id}
            patientId={id}
            onBack={() => navigate('/admin/patients')}
            user={user}
            isSuperAdmin={isSuperAdmin}
            adminName={adminName}
            adminInitial={adminInitial}
          />
        )}
      </div>
      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

const PatientList = ({ onViewDetail, user, userType, isSuperAdmin, adminName, adminInitial }) => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date_created');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
    contact_no: '',
    address: '',
    birthday: ''
  });
  const perPage = 5;

  const searchTimeout = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  const fetchStats = useCallback(async () => {
    try {
      const { count: total } = await supabase.from('patients').select('patient_id', { count: 'exact', head: true });
      const { count: active } = await supabase.from('patients').select('patient_id', { count: 'exact', head: true }).eq('status', 'active');
      const { count: inactive } = await supabase.from('patients').select('patient_id', { count: 'exact', head: true }).eq('status', 'inactive');
      setStats({ total: total || 0, active: active || 0, inactive: inactive || 0 });
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let query = supabase.from('patients').select(patientFields, { count: 'exact' });
      if (debouncedSearch) {
        query = query.or(`first_name.ilike.%${debouncedSearch}%,last_name.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,contact_no.ilike.%${debouncedSearch}%`);
      }
      if (statusFilter) query = query.eq('status', statusFilter);
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      query = query.range(from, to);
      const { data, error, count } = await query;
      if (error) throw error;
      setPatients(data || []);
      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / perPage));
      setHasLoaded(true);
    } catch (err) {
      setLoadError(err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, sortBy, sortOrder, page]);

  useEffect(() => {
    fetchStats();
    fetchPatients();
  }, [fetchStats, fetchPatients]);

  const handleAddPatient = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    if (addForm.password !== addForm.confirm_password) {
      toast.error('Passwords do not match');
      setIsSubmitting(false);
      return;
    }
    if (addForm.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      setIsSubmitting(false);
      return;
    }
    try {
      await managePatientAccount({
        action: 'create',
        first_name: addForm.first_name,
        last_name: addForm.last_name,
        email: addForm.email,
        password: addForm.password,
        address: addForm.address,
        contact_no: addForm.contact_no,
        birthday: addForm.birthday,
      });
      toast.success('Patient and login account created successfully!');
      setShowAddModal(false);
      setAddForm({
        first_name: '', last_name: '', email: '', password: '', confirm_password: '',
        contact_no: '', address: '', birthday: ''
      });
      fetchPatients();
      fetchStats();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setSortBy('date_created');
    setSortOrder('desc');
    setPage(1);
  };

  return (
    <div className="patient-list-container">
      <div className="dashboard-header">
        <div className="header-title">
          <h1>Manage Patients</h1>
          <p className="welcome-message">View, add, and manage patient records</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <i className="fas fa-plus"></i> Add New Patient
          </button>
          <div className="user-info">
            <div className="user-avatar">{adminInitial}</div>
            <div className="user-details">
              <div className="user-name">{adminName}</div>
              <div className="user-role">{roleLabel(userType)}</div>
            </div>
          </div>
        </div>
      </div>
        <AdminDataRegion loading={loading} hasLoaded={hasLoaded} error={loadError} label="Patients" onRetry={fetchPatients}>


      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">Total Patients</div></div>
        <div className="stat-card"><div className="stat-value">{stats.active}</div><div className="stat-label">Active Patients</div></div>
        <div className="stat-card"><div className="stat-value">{stats.inactive}</div><div className="stat-label">Inactive Patients</div></div>
      </div>

      <div className="filters">
        <div className="filter-grid">
          <div className="filter-group">
            <label>Search</label>
            <input
              type="text"
              className="form-control"
              placeholder="Name, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Status</label>
            <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Sort By</label>
            <select className="form-control" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date_created">Date Created</option>
              <option value="first_name">First Name</option>
              <option value="last_name">Last Name</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Order</label>
            <select className="form-control" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          <div className="filter-group">
            <button className="btn btn-primary" onClick={fetchPatients}>Apply</button>
            <button className="btn btn-secondary" onClick={resetFilters}>Reset</button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3>Patient List</h3>
          <span>Showing {patients.length} of {totalCount} patient(s)</span>
        </div>
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '25%' }}>Patient</th>
                <th style={{ width: '30%' }}>Contact Info</th>
                <th style={{ width: '20%' }}>Birthday/Age</th>
                <th style={{ width: '10%' }}>Status</th>
                <th style={{ width: '15%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {patients.length === 0 ? (
                <tr><td colSpan="5" className="empty-state">No patients found</td></tr>
              ) : (
                patients.map(patient => (
                  <tr key={patient.patient_id}>
                    <td style={{ verticalAlign: 'middle' }}>
                      <div className="patient-info">
                        <div className="patient-avatar">{patient.first_name.charAt(0)}{patient.last_name.charAt(0)}</div>
                        <div>
                          <button className="patient-name-button" onClick={() => onViewDetail(patient.patient_id)}>
                            {patient.first_name} {patient.last_name}
                          </button>
                        </div>
                      </div>
                     </td>
                    <td style={{ verticalAlign: 'middle' }}>📧 {patient.email}<br />📱 {patient.contact_no || 'N/A'}</td>
                    <td style={{ verticalAlign: 'middle' }}>{patient.birthday ? new Date(patient.birthday).toLocaleDateString() : 'N/A'}<br />{patient.age ? `${patient.age} years old` : ''}</td>
                    <td style={{ verticalAlign: 'middle' }}><span className={`status-badge status-${patient.status}`}>{patient.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td style={{ verticalAlign: 'middle' }}><button className="btn btn-primary btn-sm" onClick={() => onViewDetail(patient.patient_id)}>View Profile</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="page-link" disabled={page === 1} onClick={() => setPage(p => p-1)}>Previous</button>
            <span className="page-info">Page {page} of {totalPages}</span>
            <button className="page-link" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Next</button>
          </div>
        )}
      </div>


        </AdminDataRegion>
      {/* Add Patient Modal */}
      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Add New Patient</h3><button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button></div>
            <form onSubmit={handleAddPatient}>
              <div className="modal-body">
                <div className="form-row"><div className="form-group"><label>First Name *</label><input type="text" className="form-control" value={addForm.first_name} onChange={e => setAddForm({...addForm, first_name: e.target.value})} required /></div><div className="form-group"><label>Last Name *</label><input type="text" className="form-control" value={addForm.last_name} onChange={e => setAddForm({...addForm, last_name: e.target.value})} required /></div></div>
                <div className="form-group"><label>Email *</label><input type="email" className="form-control" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} required /></div>
                <div className="form-row"><div className="form-group"><label>Password *</label><input type="password" className="form-control" value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} required /><small>Min. 8 characters</small></div><div className="form-group"><label>Confirm Password *</label><input type="password" className="form-control" value={addForm.confirm_password} onChange={e => setAddForm({...addForm, confirm_password: e.target.value})} required /></div></div>
                <div className="form-group"><label>Contact Number</label><input type="tel" className="form-control" value={addForm.contact_no} onChange={e => setAddForm({...addForm, contact_no: e.target.value})} /></div>
                <div className="form-group"><label>Address</label><textarea className="form-control" rows="3" value={addForm.address} onChange={e => setAddForm({...addForm, address: e.target.value})} /></div>
                <div className="form-group"><label>Birthday</label><input type="date" className="form-control" value={addForm.birthday} onChange={e => setAddForm({...addForm, birthday: e.target.value})} /></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Patient'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const PatientDetail = ({ patientId, onBack, user, isSuperAdmin, adminName, adminInitial }) => {
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', contact_no: '', address: '', birthday: '' });
  const [showResetModal, setShowResetModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [failedPhoto, setFailedPhoto] = useState('');
  const editButton = useRef(null);

  const calculateAge = (birthday) => {
    if (!birthday) return null;
    const today = new Date();
    const birthDate = new Date(birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const fetchPatient = useCallback(async () => {
    try {
      const readProfile = fields => supabase.from('patients').select(fields).eq('patient_id', patientId).single();
      let result = await readProfile(`${patientFields}, profile_picture`);
      if (result.error?.code === '42703') result = await readProfile(patientFields);
      const { data, error } = result;
      if (error) throw error;
      setPatient(data);

    } catch (err) {
      toast.error('Failed to load patient details');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) {
      fetchPatient();
    }
  }, [patientId, fetchPatient]);

  const handleEditPatient = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    let emailChanged = false;
    try {
      const email = editForm.email.trim().toLowerCase();
      if (email !== patient.email.trim().toLowerCase()) {
        if (!isSuperAdmin) throw new Error('Only the super admin can change login emails.');
        const result = await managePatientAccount({
          action: 'change_email', patient_id: patient.patient_id,
          new_email: email, expected_email: patient.email,
        });
        emailChanged = true;
        setPatient(current => ({ ...current, email: result.email }));
        setEditForm(form => ({ ...form, email: result.email }));
      }
      const age = calculateAge(editForm.birthday);
      const { error: updateErr } = await supabase
        .from('patients')
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          contact_no: editForm.contact_no || null,
          address: editForm.address || null,
          birthday: editForm.birthday || null,
          age: age
        })
        .eq('patient_id', patientId);
      if (updateErr) throw updateErr;
      toast.success(emailChanged ? 'Patient updated successfully! Use the new email with the existing password.' : 'Patient updated successfully');
      setEditMode(false);
      fetchPatient();
    } catch (err) {
      toast.error(emailChanged ? `Login email updated, but the other changes could not be saved: ${err.message}` : err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!patient) return;
    const newStatus = patient.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'active' ? 'activate' : 'deactivate'} this patient?`)) return;
    try {
      const { error } = await supabase
        .from('patients')
        .update({ status: newStatus })
        .eq('patient_id', patientId);
      if (error) throw error;
      toast.success(`Patient ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`);
      fetchPatient();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (isSubmitting || !patient) return;
    setIsSubmitting(true);
    try {
      const result = await managePatientAccount({ action: 'send_reset_email', patient_id: patient.patient_id });
      toast.success(result.message);
      setShowResetModal(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="patient-detail-container">
        <div className="dashboard-header">
          <div className="header-left">
            <button className="back-button" onClick={onBack}>
              <i className="fas fa-arrow-left"></i> Back to Patients
            </button>
            <h1>Patient Profile</h1>
          </div>
        </div>
        <AdminDataRegion loading hasLoaded={false} label="Patient profile" />
      </div>
    );
  }

  if (!patient) return <div className="alert alert-error">Patient not found. <button className="btn btn-secondary" onClick={onBack}>Go Back</button></div>;

  return (
    <div className="patient-detail-container">
      <button type="button" className="record-back" onClick={onBack}><ArrowLeft size={16} /> Back to Patients</button>
      <header className="record-summary">
        <div className="record-avatar" aria-hidden="true">
          {patient.profile_picture && failedPhoto !== patient.profile_picture
            ? <img src={patient.profile_picture} alt="" onError={() => setFailedPhoto(patient.profile_picture)} />
            : <span>{patient.first_name?.charAt(0)}{patient.last_name?.charAt(0)}</span>}
        </div>
        <div className="record-identity">
          <p>Patient profile</p>
          <h1>{patient.first_name} {patient.last_name}</h1>
          <div className="record-meta"><span>Patient ID {patient.patient_id}</span>
            <span className={patient.status === 'active' ? 'record-active' : 'record-inactive'}>{patient.status === 'active' ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <button type="button" className="record-button record-primary" ref={editButton} disabled={editMode} onClick={() => {
          setEditForm({
            first_name: patient.first_name || '', last_name: patient.last_name || '',
            email: patient.email || '', contact_no: patient.contact_no || '',
            birthday: patient.birthday || '', address: patient.address || '',
          });
          setEditMode(true);
        }}><Pencil size={16} /> Edit profile</button>
      </header>
      <nav className="record-links" aria-label="Patient profile sections">
        <a href="#record-details">Profile details</a><a href="#record-account">Account</a><a href="#record-history">Treatment history</a>
      </nav>
      <div id="record-details" className="record-layout">
        {editMode ? (
          <form className="record-card record-edit" onSubmit={handleEditPatient}>
            <h2><Pencil /> Edit profile</h2>
            <fieldset disabled={isSubmitting}>
              {[
                ['first_name', 'First name', 'text'], ['last_name', 'Last name', 'text'],
                ['birthday', 'Birthday', 'date'], ['contact_no', 'Contact number', 'tel'],
                ['email', 'Email', 'email'], ['address', 'Address', 'textarea'],
              ].map(([field, label, type]) => (
                <label key={field} className={['email', 'address'].includes(field) ? 'record-wide' : undefined}>
                  {label}
                  {type === 'textarea'
                    ? <textarea rows="2" value={editForm[field]} onChange={e => setEditForm({ ...editForm, [field]: e.target.value })} />
                    : <input type={type} value={editForm[field]} autoFocus={field === 'first_name'}
                        onChange={e => setEditForm({ ...editForm, [field]: e.target.value })}
                        required={['first_name', 'last_name', 'email'].includes(field)}
                        readOnly={field === 'email' && !isSuperAdmin} maxLength={field === 'email' ? 254 : undefined} />}
                  {field === 'email' && <small>{isSuperAdmin ? 'Changing this email changes the login address. The password stays the same.' : 'Only the super admin can change the login email.'}</small>}
                </label>
              ))}
            </fieldset>
            <div className="record-actions">
              <button type="submit" className="record-button record-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="record-button" disabled={isSubmitting} onClick={() => { setEditMode(false); requestAnimationFrame(() => editButton.current?.focus()); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <section className="record-card">
              <h2><UserRound /> Personal details</h2>
              <dl><div><dt>First name</dt><dd>{patient.first_name}</dd></div>
                <div><dt>Last name</dt><dd>{patient.last_name}</dd></div>
                <div><dt>Birthday</dt><dd>{patient.birthday ? new Date(patient.birthday + 'T00:00:00').toLocaleDateString() : 'N/A'}</dd></div>
                <div><dt>Age</dt><dd>{patient.age != null ? `${patient.age} years old` : 'N/A'}</dd></div></dl>
            </section>
            <section className="record-card">
              <h2><Contact /> Contact information</h2>
              <dl><div><dt>Email</dt><dd>{patient.email}</dd></div>
                <div><dt>Contact number</dt><dd>{patient.contact_no || 'N/A'}</dd></div>
                <div><dt>Address</dt><dd>{patient.address || 'N/A'}</dd></div></dl>
            </section>
          </>
        )}
        <section id="record-account" className="record-card">
          <h2><ShieldCheck /> Account details</h2>
          <dl><div><dt>Account created</dt><dd>{new Date(patient.date_created).toLocaleString()}</dd></div>
            <div><dt>Email verified</dt><dd>{patient.email_verified ? 'Yes' : 'No'}</dd></div></dl>
          <div className="record-actions">
            <button type="button" className="record-button" onClick={() => setShowResetModal(true)}><KeyRound size={15} /> Reset password</button>
            <button type="button" className={`record-button ${patient.status === 'active' ? 'record-danger' : ''}`} onClick={handleToggleStatus}>
              {patient.status === 'active' ? <CircleOff size={15} /> : <CircleCheck size={15} />} {patient.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </section>
      </div>
      <div id="record-history"><PatientTreatmentHistory key={patient.patient_id} patientId={patient.patient_id} /></div>

      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowResetModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Reset Password for {patient.first_name} {patient.last_name}</h3><button className="modal-close" onClick={() => setShowResetModal(false)}>&times;</button></div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <p>A password reset link will be requested for <strong>{patient.email}</strong>.</p>
                <p>The patient will choose their new password using the link in that email.</p>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Sending...' : 'Send Reset Email'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagePatients;
