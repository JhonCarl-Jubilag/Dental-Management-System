import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './managePatients.css';

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
      const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';
      if (!user) {
        navigate('/login');
      } else if (userType !== 'admin' && !isSuperAdmin) {
        navigate('/');
      }
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
        <p>Loading...</p>
      </div>
    );
  }

  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';
  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />
      <div className="main-content">
        {viewMode === 'list' ? (
          <PatientList onViewDetail={(patientId) => navigate(`/admin/patients/${patientId}`)} />
        ) : (
          <PatientDetail patientId={id} onBack={() => navigate('/admin/patients')} />
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
    </div>
  );
};

const PatientList = ({ onViewDetail }) => {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, upcoming: 0 });
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
  const perPage = 10;

  const calculateAge = (birthday) => {
    if (!birthday) return null;
    const today = new Date();
    const birthDate = new Date(birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  };

  const fetchStats = useCallback(async () => {
    try {
      const { count: total } = await supabase.from('patients').select('*', { count: 'exact', head: true });
      const { count: active } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('status', 'active');
      const { count: inactive } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('status', 'inactive');
      const { data: upcomingData } = await supabase
        .from('appointments')
        .select('patient_id')
        .gte('appointment_datetime', new Date().toISOString())
        .in('status', ['pending', 'approved']);
      const uniquePatients = new Set(upcomingData?.map(a => a.patient_id));
      setStats({ total: total || 0, active: active || 0, inactive: inactive || 0, upcoming: uniquePatients.size });
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let query = supabase.from('patients').select('*', { count: 'exact' });
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,contact_no.ilike.%${search}%`);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sortBy, sortOrder, page]);

  useEffect(() => {
    fetchStats();
    fetchPatients();
  }, [fetchStats, fetchPatients]);

  const handleAddPatient = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    if (addForm.password !== addForm.confirm_password) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }
    if (addForm.password.length < 8) {
      setError('Password must be at least 8 characters');
      setIsSubmitting(false);
      return;
    }
    try {
      const { data: existing } = await supabase.from('patients').select('patient_id').eq('email', addForm.email).maybeSingle();
      if (existing) {
        setError('A patient with this email already exists');
        setIsSubmitting(false);
        return;
      }
      const { error: authError } = await supabase.auth.admin.createUser({
        email: addForm.email,
        password: addForm.password,
        email_confirm: true,
        user_metadata: { first_name: addForm.first_name, last_name: addForm.last_name, role: 'patient' }
      });
      if (authError) throw authError;
      const age = calculateAge(addForm.birthday);
      const { error: insertError } = await supabase.from('patients').insert([{
        first_name: addForm.first_name,
        last_name: addForm.last_name,
        email: addForm.email,
        password: 'managed_by_supabase',
        address: addForm.address || null,
        contact_no: addForm.contact_no || null,
        birthday: addForm.birthday || null,
        age: age,
        email_verified: true,
        status: 'active'
      }]);
      if (insertError) throw insertError;
      setSuccess('Patient added successfully!');
      setShowAddModal(false);
      setAddForm({
        first_name: '', last_name: '', email: '', password: '', confirm_password: '',
        contact_no: '', address: '', birthday: ''
      });
      fetchPatients();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetFilters = () => {
    setSearch('');
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
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">Total Patients</div></div>
        <div className="stat-card"><div className="stat-value">{stats.active}</div><div className="stat-label">Active Patients</div></div>
        <div className="stat-card"><div className="stat-value">{stats.inactive}</div><div className="stat-label">Inactive Patients</div></div>
        <div className="stat-card"><div className="stat-value">{stats.upcoming}</div><div className="stat-label">Upcoming Appointments</div></div>
      </div>

      <div className="filters">
        <div className="filter-grid">
          <div className="filter-group">
            <label>Search</label>
            <input type="text" className="form-control" placeholder="Name, email, phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <th>Patient</th>
                <th>Contact Info</th>
                <th>Birthday/Age</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="loading-placeholder">Loading...</td></tr>
              ) : patients.length === 0 ? (
                <tr><td colSpan="5" className="empty-state">No patients found</td></tr>
              ) : (
                patients.map(patient => (
                  <tr key={patient.patient_id}>
                    <td>
                      <div className="patient-info">
                        <div className="patient-avatar">{patient.first_name.charAt(0)}{patient.last_name.charAt(0)}</div>
                        <div>
                          <button className="patient-name-button" onClick={() => onViewDetail(patient.patient_id)}>
                            {patient.first_name} {patient.last_name}
                          </button>
                          <br />
                          <small>ID: {patient.patient_id}</small>
                        </div>
                      </div>
                    </td>
                    <td>📧 {patient.email}<br />📱 {patient.contact_no || 'N/A'}</td>
                    <td>{patient.birthday ? new Date(patient.birthday).toLocaleDateString() : 'N/A'}<br />{patient.age ? `${patient.age} years old` : ''}</td>
                    <td><span className={`status-badge status-${patient.status}`}>{patient.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td><button className="btn btn-primary btn-sm" onClick={() => onViewDetail(patient.patient_id)}>View Profile</button></td>
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

      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>Add New Patient</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddPatient}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>First Name *</label><input type="text" className="form-control" value={addForm.first_name} onChange={e => setAddForm({...addForm, first_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Last Name *</label><input type="text" className="form-control" value={addForm.last_name} onChange={e => setAddForm({...addForm, last_name: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Email *</label><input type="email" className="form-control" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} required /></div>
                <div className="form-row">
                  <div className="form-group"><label>Password *</label><input type="password" className="form-control" value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} required /><small>Min. 8 characters</small></div>
                  <div className="form-group"><label>Confirm Password *</label><input type="password" className="form-control" value={addForm.confirm_password} onChange={e => setAddForm({...addForm, confirm_password: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Contact Number</label><input type="tel" className="form-control" value={addForm.contact_no} onChange={e => setAddForm({...addForm, contact_no: e.target.value})} /></div>
                <div className="form-group"><label>Address</label><textarea className="form-control" rows="3" value={addForm.address} onChange={e => setAddForm({...addForm, address: e.target.value})}></textarea></div>
                <div className="form-group"><label>Birthday</label><input type="date" className="form-control" value={addForm.birthday} onChange={e => setAddForm({...addForm, birthday: e.target.value})} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Patient'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const PatientDetail = ({ patientId, onBack }) => {
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  const [billingHistory, setBillingHistory] = useState([]);
  const [appointmentStats, setAppointmentStats] = useState({ total: 0, pending: 0, approved: 0, cancelled: 0, done: 0 });
  const [billingStats, setBillingStats] = useState({ total_amount: 0, total_paid: 0, total_balance: 0, total_discount: 0 });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', contact_no: '', address: '', birthday: '' });
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetForm, setResetForm] = useState({ new_password: '', confirm_password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);

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
      const { data, error } = await supabase.from('patients').select('*').eq('patient_id', patientId).single();
      if (error) throw error;
      setPatient(data);
      setEditForm({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        contact_no: data.contact_no || '',
        address: data.address || '',
        birthday: data.birthday || ''
      });
    } catch (err) {
      setError('Failed to load patient details');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const fetchAppointments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          appointment_id,
          appointment_datetime,
          status,
          remarks,
          created_at,
          updated_at,
          services (service_name, price),
          doctors (first_name, last_name, specialization)
        `)
        .eq('patient_id', patientId)
        .order('appointment_datetime', { ascending: false });
      if (error) throw error;
      setAppointments(data || []);
      const stats = { total: data.length, pending: 0, approved: 0, cancelled: 0, done: 0 };
      data.forEach(apt => { if (stats[apt.status] !== undefined) stats[apt.status]++; });
      setAppointmentStats(stats);
    } catch (err) {
      console.error(err);
    }
  }, [patientId]);

  const fetchBilling = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('billing')
        .select(`
          *,
          appointments (appointment_datetime, services (service_name), doctors (first_name, last_name))
        `)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBillingHistory(data || []);
      const stats = { total_amount: 0, total_paid: 0, total_balance: 0, total_discount: 0 };
      data.forEach(bill => {
        stats.total_amount += parseFloat(bill.total_amount || 0);
        stats.total_paid += parseFloat(bill.amount_paid || 0);
        stats.total_balance += parseFloat(bill.balance || 0);
        stats.total_discount += parseFloat(bill.discount || 0);
      });
      setBillingStats(stats);
    } catch (err) {
      console.error(err);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) {
      fetchPatient();
      fetchAppointments();
      fetchBilling();
    }
  }, [patientId, fetchPatient, fetchAppointments, fetchBilling]);

  const handleEditPatient = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const { data: existing, error: checkErr } = await supabase
        .from('patients')
        .select('patient_id')
        .eq('email', editForm.email)
        .neq('patient_id', patientId)
        .maybeSingle();
      if (checkErr && checkErr.code !== 'PGRST116') throw checkErr;
      if (existing) {
        setError('Email already exists for another patient');
        setIsSubmitting(false);
        return;
      }
      const age = calculateAge(editForm.birthday);
      const { error: updateErr } = await supabase
        .from('patients')
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          email: editForm.email,
          contact_no: editForm.contact_no || null,
          address: editForm.address || null,
          birthday: editForm.birthday || null,
          age: age
        })
        .eq('patient_id', patientId);
      if (updateErr) throw updateErr;
      setSuccess('Patient updated successfully');
      setEditMode(false);
      fetchPatient();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
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
      setSuccess(`Patient ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`);
      fetchPatient();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetForm.new_password !== resetForm.confirm_password) {
      setError('Passwords do not match');
      return;
    }
    if (resetForm.new_password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(patient.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      setSuccess(`Password reset email sent to ${patient.email}`);
      setShowResetModal(false);
      setResetForm({ new_password: '', confirm_password: '' });
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAppointmentModal = (apt) => {
    setSelectedAppointment(apt);
    setShowAppointmentModal(true);
  };

  if (loading) return <div className="admin-loading"><div className="loading-spinner"></div><p>Loading patient data...</p></div>;
  if (!patient) return <div className="alert alert-error">Patient not found. <button className="btn btn-secondary" onClick={onBack}>Go Back</button></div>;

  return (
    <div className="patient-detail-container">
      <div className="detail-header">
        <button className="back-button" onClick={onBack}><i className="fas fa-arrow-left"></i> Back to Patients</button>
        <h1>Patient Profile</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="patient-profile">
        <div className="profile-header">
          <div className="profile-info">
            <div className="profile-avatar">{patient.first_name.charAt(0)}{patient.last_name.charAt(0)}</div>
            <div className="profile-details">
              <h2>{patient.first_name} {patient.last_name}</h2>
              <div className="profile-id">Patient ID: {patient.patient_id}</div>
              <span className={`profile-status status-${patient.status}`}>{patient.status === 'active' ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
          <div className="profile-actions">
            {!editMode && <button className="btn btn-warning" onClick={() => setEditMode(true)}><i className="fas fa-edit"></i> Edit Profile</button>}
            <button className="btn btn-secondary" onClick={() => setShowResetModal(true)}><i className="fas fa-key"></i> Reset Password</button>
            <button className={`btn ${patient.status === 'active' ? 'btn-danger' : 'btn-success'}`} onClick={handleToggleStatus}>
              <i className={`fas fa-${patient.status === 'active' ? 'ban' : 'check'}`}></i> {patient.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>

        <div className="profile-sections">
          <div className="personal-info-section">
            <h3 className="section-title">Personal Information</h3>
            {editMode ? (
              <form onSubmit={handleEditPatient}>
                <div className="form-row">
                  <div className="form-group"><label>First Name</label><input type="text" className="form-control" value={editForm.first_name} onChange={e => setEditForm({...editForm, first_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Last Name</label><input type="text" className="form-control" value={editForm.last_name} onChange={e => setEditForm({...editForm, last_name: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Email</label><input type="email" className="form-control" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} required /></div>
                <div className="form-group"><label>Contact Number</label><input type="tel" className="form-control" value={editForm.contact_no} onChange={e => setEditForm({...editForm, contact_no: e.target.value})} /></div>
                <div className="form-group"><label>Address</label><textarea className="form-control" rows="2" value={editForm.address} onChange={e => setEditForm({...editForm, address: e.target.value})}></textarea></div>
                <div className="form-group"><label>Birthday</label><input type="date" className="form-control" value={editForm.birthday} onChange={e => setEditForm({...editForm, birthday: e.target.value})} /></div>
                <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditMode(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Changes'}</button></div>
              </form>
            ) : (
              <div className="info-grid">
                <div><label>First Name:</label><div>{patient.first_name}</div></div>
                <div><label>Last Name:</label><div>{patient.last_name}</div></div>
                <div><label>Email:</label><div>{patient.email}</div></div>
                <div><label>Contact:</label><div>{patient.contact_no || 'N/A'}</div></div>
                <div><label>Address:</label><div>{patient.address || 'N/A'}</div></div>
                <div><label>Birthday:</label><div>{patient.birthday ? new Date(patient.birthday).toLocaleDateString() : 'N/A'}</div></div>
                <div><label>Age:</label><div>{patient.age ? `${patient.age} years old` : 'N/A'}</div></div>
                <div><label>Account Created:</label><div>{new Date(patient.date_created).toLocaleString()}</div></div>
                <div><label>Email Verified:</label><div>{patient.email_verified ? 'Yes' : 'No'}</div></div>
              </div>
            )}
          </div>

          <div className="appointments-section">
            <h3 className="section-title">Appointment History <span>(Total: {appointmentStats.total})</span></h3>
            <div className="appointment-stats">
              <div className="stat-badge pending">Pending: {appointmentStats.pending}</div>
              <div className="stat-badge approved">Approved: {appointmentStats.approved}</div>
              <div className="stat-badge cancelled">Cancelled: {appointmentStats.cancelled}</div>
              <div className="stat-badge done">Done: {appointmentStats.done}</div>
            </div>
            {appointments.length === 0 ? (
              <div className="empty-state">No appointments found</div>
            ) : (
              <div className="appointments-table-wrapper">
                <table className="appointments-table">
                  <thead><tr><th>Date & Time</th><th>Service</th><th>Doctor</th><th>Status</th><th>Amount</th><th>Actions</th></tr></thead>
                  <tbody>
                    {appointments.map(apt => (
                      <tr key={apt.appointment_id}>
                        <td>{new Date(apt.appointment_datetime).toLocaleString()}</td>
                        <td>{apt.services?.service_name}</td>
                        <td>Dr. {apt.doctors?.first_name} {apt.doctors?.last_name}</td>
                        <td><span className={`status-badge status-${apt.status}`}>{apt.status.toUpperCase()}</span></td>
                        <td>₱{parseFloat(apt.services?.price || 0).toFixed(2)}</td>
                        <td><button className="btn-view" onClick={() => openAppointmentModal(apt)}>View Details</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="billing-section">
            <h3 className="section-title">Billing Summary</h3>
            <div className="billing-stats">
              <div className="stat-card"><div className="stat-value">₱{billingStats.total_amount.toFixed(2)}</div><div className="stat-label">Total Amount</div></div>
              <div className="stat-card"><div className="stat-value">₱{billingStats.total_paid.toFixed(2)}</div><div className="stat-label">Total Paid</div></div>
              <div className="stat-card"><div className="stat-value">₱{billingStats.total_discount.toFixed(2)}</div><div className="stat-label">Total Discount</div></div>
              <div className="stat-card"><div className="stat-value">₱{billingStats.total_balance.toFixed(2)}</div><div className="stat-label">Total Balance</div></div>
            </div>
            {billingHistory.length > 0 && (
              <>
                <h4>Recent Payments</h4>
                <div className="billing-table-wrapper">
                  <table className="appointments-table">
                    <thead><tr><th>Date</th><th>Service</th><th>Amount Paid</th><th>Balance</th></tr></thead>
                    <tbody>
                      {billingHistory.slice(0, 5).map(bill => (
                        <tr key={bill.billing_id}>
                          <td>{bill.payment_date ? new Date(bill.payment_date).toLocaleDateString() : 'N/A'}</td>
                          <td>{bill.appointments?.services?.service_name}</td>
                          <td>₱{parseFloat(bill.amount_paid || 0).toFixed(2)}</td>
                          <td>{parseFloat(bill.balance || 0) === 0 ? <span className="paid">Paid</span> : `₱${parseFloat(bill.balance).toFixed(2)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showResetModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowResetModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Reset Password for {patient.first_name} {patient.last_name}</h3><button className="modal-close" onClick={() => setShowResetModal(false)}>&times;</button></div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <div className="form-group"><label>New Password *</label><input type="password" className="form-control" value={resetForm.new_password} onChange={e => setResetForm({...resetForm, new_password: e.target.value})} required /><small>Minimum 8 characters</small></div>
                <div className="form-group"><label>Confirm Password *</label><input type="password" className="form-control" value={resetForm.confirm_password} onChange={e => setResetForm({...resetForm, confirm_password: e.target.value})} required /></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Sending...' : 'Send Reset Email'}</button></div>
            </form>
          </div>
        </div>
      )}

      {showAppointmentModal && selectedAppointment && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAppointmentModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Appointment Details</h3><button className="modal-close" onClick={() => setShowAppointmentModal(false)}>&times;</button></div>
            <div className="modal-body">
              <div className="appointment-details-grid">
                <div className="detail-card"><div className="detail-label">Appointment ID</div><div className="detail-value">#{selectedAppointment.appointment_id}</div></div>
                <div className="detail-card"><div className="detail-label">Service</div><div className="detail-value">{selectedAppointment.services?.service_name}</div></div>
                <div className="detail-card"><div className="detail-label">Date & Time</div><div className="detail-value">{new Date(selectedAppointment.appointment_datetime).toLocaleString()}</div></div>
                <div className="detail-card"><div className="detail-label">Doctor</div><div className="detail-value">Dr. {selectedAppointment.doctors?.first_name} {selectedAppointment.doctors?.last_name}</div></div>
                <div className="detail-card"><div className="detail-label">Specialization</div><div className="detail-value">{selectedAppointment.doctors?.specialization || 'N/A'}</div></div>
                <div className="detail-card"><div className="detail-label">Status</div><div className="detail-value"><span className={`status-badge status-${selectedAppointment.status}`}>{selectedAppointment.status.toUpperCase()}</span></div></div>
                <div className="detail-card"><div className="detail-label">Service Fee</div><div className="detail-value">₱{parseFloat(selectedAppointment.services?.price || 0).toFixed(2)}</div></div>
                <div className="detail-card"><div className="detail-label">Created At</div><div className="detail-value">{new Date(selectedAppointment.created_at).toLocaleString()}</div></div>
                <div className="detail-card"><div className="detail-label">Last Updated</div><div className="detail-value">{new Date(selectedAppointment.updated_at).toLocaleString()}</div></div>
              </div>
              <div className="remarks-container"><h4 className="remarks-title">Doctor's Remarks</h4><div className="remarks-content">{selectedAppointment.remarks || 'No remarks.'}</div></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowAppointmentModal(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagePatients;