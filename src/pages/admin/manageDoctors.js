import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageDoctors.css';

const ManageDoctors = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [specializations, setSpecializations] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [totalDoctors, setTotalDoctors] = useState(0);
  const [activeDoctors, setActiveDoctors] = useState(0);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  
  const [addForm, setAddForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
    specialization: '',
    contact_no: '',
    service_ids: []
  });
  const [editForm, setEditForm] = useState({
    doctor_id: '',
    first_name: '',
    last_name: '',
    email: '',
    specialization: '',
    contact_no: '',
    status: 'active',
    service_ids: []
  });
  const [resetForm, setResetForm] = useState({
    doctor_id: '',
    new_password: '',
    confirm_password: ''
  });
  const [availabilityForm, setAvailabilityForm] = useState({
    doctor_id: '',
    available_date: '',
    start_time: '09:00',
    end_time: '17:00'
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [doctorServicesMap, setDoctorServicesMap] = useState({});
  const [doctorStats, setDoctorStats] = useState({});
  const [availabilityCounts, setAvailabilityCounts] = useState({});
  
  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';
  
  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        navigate('/login');
      } else if (userType !== 'admin' && !isSuperAdmin) {
        navigate('/');
      }
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);
  
  const fetchData = useCallback(async () => {
    if (!user || (userType !== 'admin' && !isSuperAdmin)) return;
    setLoading(true);
    setError('');
    
    try {
      const { data: services, error: servicesError } = await supabase
        .from('services')
        .select('service_id, service_name, price')
        .eq('status', 'active')
        .order('service_name');
      if (servicesError) throw servicesError;
      setAllServices(services || []);
      
      let query = supabase
        .from('doctors')
        .select(`
          doctor_id,
          first_name,
          last_name,
          email,
          specialization,
          contact_no,
          status,
          date_created,
          doctor_services!inner (
            service_id,
            services!inner (
              service_id,
              service_name
            )
          ),
          appointments!left (
            appointment_id,
            status,
            appointment_datetime
          )
        `)
        .eq('doctor_services.status', 'active');
      
      if (search) {
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,specialization.ilike.%${search}%`);
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }
      if (specializationFilter) {
        query = query.ilike('specialization', `%${specializationFilter}%`);
      }
      
      const { data: doctorsData, error: doctorsError } = await query;
      if (doctorsError) throw doctorsError;
      
      const doctorsList = [];
      const servicesMap = {};
      const statsMap = {};
      
      for (const doc of doctorsData || []) {
        const servicesOffered = doc.doctor_services?.map(ds => ({
          service_id: ds.services.service_id,
          service_name: ds.services.service_name
        })) || [];
        servicesMap[doc.doctor_id] = servicesOffered;
        
        const appointments = doc.appointments || [];
        const totalApps = appointments.length;
        const upcoming = appointments.filter(a => 
          a.status === 'pending' && new Date(a.appointment_datetime) > new Date()
        ).length;
        statsMap[doc.doctor_id] = { totalApps, upcoming };
        
        doctorsList.push({
          ...doc,
          services_offered: servicesOffered.map(s => s.service_name).join(', ')
        });
      }
      
      setDoctors(doctorsList);
      setDoctorServicesMap(servicesMap);
      setDoctorStats(statsMap);
      
      setTotalDoctors(doctorsList.length);
      setActiveDoctors(doctorsList.filter(d => d.status === 'active').length);
      
      const uniqueSpecs = [...new Set(doctorsList.map(d => d.specialization).filter(Boolean))];
      setSpecializations(uniqueSpecs);
      
      const { data: availData, error: availError } = await supabase
        .from('doctor_availability')
        .select('doctor_id, availability_id')
        .gte('available_date', new Date().toISOString().split('T')[0]);
      if (!availError && availData) {
        const counts = {};
        availData.forEach(item => {
          counts[item.doctor_id] = (counts[item.doctor_id] || 0) + 1;
        });
        setAvailabilityCounts(counts);
      }
      
    } catch (err) {
      console.error('Error fetching doctors:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, userType, isSuperAdmin, search, statusFilter, specializationFilter]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  const handleAddDoctor = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    if (addForm.password !== addForm.confirm_password) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }
    if (addForm.password.length < 6) {
      setError('Password must be at least 6 characters');
      setIsSubmitting(false);
      return;
    }
    
    try {
      const { data: doctorData, error: doctorError } = await supabase
        .from('doctors')
        .insert([{
          first_name: addForm.first_name,
          last_name: addForm.last_name,
          email: addForm.email,
          password: 'managed_by_supabase_auth', 
          specialization: addForm.specialization || null,
          contact_no: addForm.contact_no || null,
          status: 'active'
        }])
        .select()
        .single();
      if (doctorError) throw doctorError;
      
      if (addForm.service_ids.length > 0) {
        const servicesToInsert = addForm.service_ids.map(service_id => ({
          doctor_id: doctorData.doctor_id,
          service_id,
          status: 'active'
        }));
        const { error: servicesError } = await supabase
          .from('doctor_services')
          .insert(servicesToInsert);
        if (servicesError) throw servicesError;
      }
      
      setSuccess('Doctor added successfully!');
      setShowAddModal(false);
      setAddForm({
        first_name: '', last_name: '', email: '', password: '', confirm_password: '',
        specialization: '', contact_no: '', service_ids: []
      });
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error adding doctor:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleEditDoctor = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    try {
      const { error: updateError } = await supabase
        .from('doctors')
        .update({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          email: editForm.email,
          specialization: editForm.specialization || null,
          contact_no: editForm.contact_no || null,
          status: editForm.status
        })
        .eq('doctor_id', editForm.doctor_id);
      if (updateError) throw updateError;
      
      const { error: deleteError } = await supabase
        .from('doctor_services')
        .delete()
        .eq('doctor_id', editForm.doctor_id);
      if (deleteError) throw deleteError;
      
      if (editForm.service_ids.length > 0) {
        const servicesToInsert = editForm.service_ids.map(service_id => ({
          doctor_id: editForm.doctor_id,
          service_id,
          status: 'active'
        }));
        const { error: insertError } = await supabase
          .from('doctor_services')
          .insert(servicesToInsert);
        if (insertError) throw insertError;
      }
      
      setSuccess('Doctor updated successfully!');
      setShowEditModal(false);
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error updating doctor:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    if (resetForm.new_password !== resetForm.confirm_password) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }
    if (resetForm.new_password.length < 6) {
      setError('Password must be at least 6 characters');
      setIsSubmitting(false);
      return;
    }
    
    try {
      setSuccess('Password reset request sent. The doctor will receive an email to set a new password.');
      setShowResetPasswordModal(false);
      setResetForm({ doctor_id: '', new_password: '', confirm_password: '' });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error resetting password:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleToggleStatus = async (doctorId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'active' ? 'activate' : 'deactivate'} this doctor?`)) return;
    
    try {
      const { error } = await supabase
        .from('doctors')
        .update({ status: newStatus })
        .eq('doctor_id', doctorId);
      if (error) throw error;
      setSuccess(`Doctor ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully!`);
      fetchData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error toggling status:', err);
      setError(err.message);
    }
  };
  
  const handleAddAvailability = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    try {
      const { error } = await supabase
        .from('doctor_availability')
        .insert([{
          doctor_id: availabilityForm.doctor_id,
          available_date: availabilityForm.available_date,
          start_time: availabilityForm.start_time,
          end_time: availabilityForm.end_time,
          is_available: true
        }]);
      if (error) throw error;
      
      setSuccess('Availability slot added successfully!');
      setShowAvailabilityModal(false);
      setAvailabilityForm({ doctor_id: '', available_date: '', start_time: '09:00', end_time: '17:00' });
      fetchData(); 
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error adding availability:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const openAddModal = () => {
    setAddForm({
      first_name: '', last_name: '', email: '', password: '', confirm_password: '',
      specialization: '', contact_no: '', service_ids: []
    });
    setError('');
    setShowAddModal(true);
  };
  
  const openEditModal = (doctor) => {
    setEditForm({
      doctor_id: doctor.doctor_id,
      first_name: doctor.first_name,
      last_name: doctor.last_name,
      email: doctor.email,
      specialization: doctor.specialization || '',
      contact_no: doctor.contact_no || '',
      status: doctor.status,
      service_ids: doctorServicesMap[doctor.doctor_id]?.map(s => s.service_id) || []
    });
    setError('');
    setShowEditModal(true);
  };
  
  const openResetPasswordModal = (doctorId) => {
    setResetForm({ doctor_id: doctorId, new_password: '', confirm_password: '' });
    setError('');
    setShowResetPasswordModal(true);
  };
  
  const openAvailabilityModal = (doctorId) => {
    const today = new Date().toISOString().split('T')[0];
    setAvailabilityForm({
      doctor_id: doctorId,
      available_date: today,
      start_time: '09:00',
      end_time: '17:00'
    });
    setError('');
    setShowAvailabilityModal(true);
  };
  
  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };
  
  if (authLoading || loading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading doctors...</p>
      </div>
    );
  }
  
  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;
  
  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();
  
  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />
      
      <div className="main-content">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Doctors</h1>
            <p className="welcome-message">Add, edit, and manage dental doctors and their services</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">{adminInitial}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">System Administrator</div>
              </div>
            </div>
          </div>
        </div>
        
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
        
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{totalDoctors}</div>
            <div className="stat-label">Total Doctors</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{activeDoctors}</div>
            <div className="stat-label">Active Doctors</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{specializations.length}</div>
            <div className="stat-label">Specializations</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{allServices.length}</div>
            <div className="stat-label">Services Offered</div>
          </div>
        </div>
        
        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group">
              <label>Search Doctors</label>
              <input type="text" className="form-control" placeholder="Search by name, email, specialization..."
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Specialization</label>
              <select className="form-control" value={specializationFilter} onChange={(e) => setSpecializationFilter(e.target.value)}>
                <option value="">All Specializations</option>
                {specializations.map(spec => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </div>
            <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setSearch(''); setStatusFilter(''); setSpecializationFilter(''); }}>
                Reset Filters
              </button>
              <button className="btn btn-primary" onClick={openAddModal}>+ Add New Doctor</button>
            </div>
          </div>
        </div>
        
        <div className="table-container">
          <div className="table-header">
            <h3>Doctor List</h3>
            <span>Showing {doctors.length} doctor(s) { (search || statusFilter || specializationFilter) ? '(filtered)' : '' }</span>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Specialization & Services</th>
                  <th>Contact Info</th>
                  <th>Statistics</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {doctors.length === 0 ? (
                  <tr><td colSpan="6" className="empty-state"><div>👨‍⚕️</div><p>No doctors found</p></td></tr>
                ) : (
                  doctors.map(doctor => {
                    const servicesOffered = doctorServicesMap[doctor.doctor_id] || [];
                    const stats = doctorStats[doctor.doctor_id] || { totalApps: 0, upcoming: 0 };
                    const availabilityCount = availabilityCounts[doctor.doctor_id] || 0;
                    return (
                      <tr key={doctor.doctor_id}>
                        <td>
                          <div className="doctor-info">
                            <div className="doctor-avatar">
                              {doctor.first_name.charAt(0)}{doctor.last_name.charAt(0)}
                            </div>
                            <div>
                              <strong>Dr. {doctor.first_name} {doctor.last_name}</strong><br />
                              <small>ID: {doctor.doctor_id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {doctor.specialization && <span className="specialization-badge">{doctor.specialization}</span>}
                          <div className="services-list">
                            {servicesOffered.map(s => (
                              <span key={s.service_id} className="service-badge">{s.service_name}</span>
                            ))}
                            {servicesOffered.length === 0 && <span className="text-muted">No services assigned</span>}
                          </div>
                        </td>
                        <td>
                          <div>📧 {doctor.email}</div>
                          <div>📱 {doctor.contact_no || 'N/A'}</div>
                        </td>
                        <td>
                          <div className="stats-cells">
                            <div><span className="stat-number">{stats.totalApps}</span><br /><small>Total Apps</small></div>
                            <div><span className="stat-number upcoming">{stats.upcoming}</span><br /><small>Upcoming</small></div>
                            <div><span className="stat-number slots">{availabilityCount}</span><br /><small>Slots</small></div>
                          </div>
                        </td>
                        <td><span className={`status-badge status-${doctor.status}`}>{doctor.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                        <td>
                          <div className="action-buttons">
                            <button className="btn btn-warning btn-sm" onClick={() => openEditModal(doctor)}>Edit</button>
                            <button className="btn btn-info btn-sm" onClick={() => openAvailabilityModal(doctor.doctor_id)}>Availability</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => openResetPasswordModal(doctor.doctor_id)}>Reset Pass</button>
                            <button className={`btn btn-sm ${doctor.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                              onClick={() => handleToggleStatus(doctor.doctor_id, doctor.status)}>
                              {doctor.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Add New Doctor</h3><button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button></div>
            <form onSubmit={handleAddDoctor}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>First Name *</label><input type="text" className="form-control" value={addForm.first_name} onChange={e => setAddForm({...addForm, first_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Last Name *</label><input type="text" className="form-control" value={addForm.last_name} onChange={e => setAddForm({...addForm, last_name: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Email *</label><input type="email" className="form-control" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} required /></div>
                <div className="form-row">
                  <div className="form-group"><label>Password *</label><input type="password" className="form-control" value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} required /></div>
                  <div className="form-group"><label>Confirm Password *</label><input type="password" className="form-control" value={addForm.confirm_password} onChange={e => setAddForm({...addForm, confirm_password: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Specialization</label><input type="text" className="form-control" value={addForm.specialization} onChange={e => setAddForm({...addForm, specialization: e.target.value})} placeholder="e.g., General Dentistry, Orthodontics" /></div>
                <div className="form-group"><label>Contact Number</label><input type="tel" className="form-control" value={addForm.contact_no} onChange={e => setAddForm({...addForm, contact_no: e.target.value})} /></div>
                <div className="form-group"><label>Assign Services</label><div className="services-checkboxes">{allServices.map(service => (<div key={service.service_id} className="checkbox-group"><input type="checkbox" id={`add_service_${service.service_id}`} checked={addForm.service_ids.includes(service.service_id)} onChange={e => { const checked = e.target.checked; setAddForm(prev => ({ ...prev, service_ids: checked ? [...prev.service_ids, service.service_id] : prev.service_ids.filter(id => id !== service.service_id) })); }} /><label htmlFor={`add_service_${service.service_id}`}>{service.service_name} <small>(₱{service.price.toFixed(2)})</small></label></div>))}</div></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Doctor'}</button></div>
            </form>
          </div>
        </div>
      )}
      
      {showEditModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Edit Doctor</h3><button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button></div>
            <form onSubmit={handleEditDoctor}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>First Name *</label><input type="text" className="form-control" value={editForm.first_name} onChange={e => setEditForm({...editForm, first_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Last Name *</label><input type="text" className="form-control" value={editForm.last_name} onChange={e => setEditForm({...editForm, last_name: e.target.value})} required /></div>
                </div>
                <div className="form-group"><label>Email *</label><input type="email" className="form-control" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} required /></div>
                <div className="form-group"><label>Specialization</label><input type="text" className="form-control" value={editForm.specialization} onChange={e => setEditForm({...editForm, specialization: e.target.value})} /></div>
                <div className="form-group"><label>Contact Number</label><input type="tel" className="form-control" value={editForm.contact_no} onChange={e => setEditForm({...editForm, contact_no: e.target.value})} /></div>
                <div className="form-group"><label>Status</label><select className="form-control" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                <div className="form-group"><label>Assign Services</label><div className="services-checkboxes">{allServices.map(service => (<div key={service.service_id} className="checkbox-group"><input type="checkbox" id={`edit_service_${service.service_id}`} checked={editForm.service_ids.includes(service.service_id)} onChange={e => { const checked = e.target.checked; setEditForm(prev => ({ ...prev, service_ids: checked ? [...prev.service_ids, service.service_id] : prev.service_ids.filter(id => id !== service.service_id) })); }} /><label htmlFor={`edit_service_${service.service_id}`}>{service.service_name} <small>(₱{service.price.toFixed(2)})</small></label></div>))}</div></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Update Doctor'}</button></div>
            </form>
          </div>
        </div>
      )}
      
      {showResetPasswordModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowResetPasswordModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Reset Doctor Password</h3><button className="modal-close" onClick={() => setShowResetPasswordModal(false)}>&times;</button></div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <div className="form-group"><label>New Password *</label><input type="password" className="form-control" value={resetForm.new_password} onChange={e => setResetForm({...resetForm, new_password: e.target.value})} required /><small>Minimum 6 characters</small></div>
                <div className="form-group"><label>Confirm Password *</label><input type="password" className="form-control" value={resetForm.confirm_password} onChange={e => setResetForm({...resetForm, confirm_password: e.target.value})} required /></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowResetPasswordModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Resetting...' : 'Reset Password'}</button></div>
            </form>
          </div>
        </div>
      )}
      
      {showAvailabilityModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAvailabilityModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Add Availability Slot</h3><button className="modal-close" onClick={() => setShowAvailabilityModal(false)}>&times;</button></div>
            <form onSubmit={handleAddAvailability}>
              <div className="modal-body">
                <div className="form-group"><label>Available Date *</label><input type="date" className="form-control" value={availabilityForm.available_date} onChange={e => setAvailabilityForm({...availabilityForm, available_date: e.target.value})} min={new Date().toISOString().split('T')[0]} required /></div>
                <div className="form-row"><div className="form-group"><label>Start Time *</label><input type="time" className="form-control" value={availabilityForm.start_time} onChange={e => setAvailabilityForm({...availabilityForm, start_time: e.target.value})} required /></div><div className="form-group"><label>End Time *</label><input type="time" className="form-control" value={availabilityForm.end_time} onChange={e => setAvailabilityForm({...availabilityForm, end_time: e.target.value})} required /></div></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowAvailabilityModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Slot'}</button></div>
            </form>
          </div>
        </div>
      )}
      
      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
    </div>
  );
};

export default ManageDoctors;