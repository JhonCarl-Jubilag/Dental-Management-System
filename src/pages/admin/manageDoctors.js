import React, { useState, useEffect, useCallback, useRef } from 'react';
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

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const perPage = 10;

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

  // Debounce search
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

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  const fetchData = useCallback(async () => {
    if (!user || (userType !== 'admin' && !isSuperAdmin)) return;
    setLoading(true);
    setError('');

    try {
      // 1. Fetch all active services
      const { data: services, error: servicesError } = await supabase
        .from('services')
        .select('service_id, service_name, price')
        .eq('status', 'active')
        .order('service_name');
      if (servicesError) throw servicesError;
      setAllServices(services || []);

      // 2. Build doctors query
      let doctorsQuery = supabase
        .from('doctors')
        .select('*', { count: 'exact' });

      if (debouncedSearch) {
        doctorsQuery = doctorsQuery.or(
          `first_name.ilike.%${debouncedSearch}%,last_name.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%,specialization.ilike.%${debouncedSearch}%`
        );
      }
      if (statusFilter) {
        doctorsQuery = doctorsQuery.eq('status', statusFilter);
      }
      if (specializationFilter) {
        doctorsQuery = doctorsQuery.ilike('specialization', `%${specializationFilter}%`);
      }

      doctorsQuery = doctorsQuery.order('first_name', { ascending: true });

      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      doctorsQuery = doctorsQuery.range(from, to);

      const { data: doctorsData, error: doctorsError, count } = await doctorsQuery;
      if (doctorsError) throw doctorsError;

      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / perPage));

      if (!doctorsData || doctorsData.length === 0) {
        setDoctors([]);
        setDoctorServicesMap({});
        setDoctorStats({});
        setTotalDoctors(0);
        setActiveDoctors(0);
        setSpecializations([]);
        setAvailabilityCounts({});
        setLoading(false);
        return;
      }

      const doctorIds = doctorsData.map(d => d.doctor_id);

      // 3. Fetch doctor_services
      const { data: doctorServicesData, error: dsError } = await supabase
        .from('doctor_services')
        .select(`
          doctor_id,
          service_id,
          services!inner (service_id, service_name)
        `)
        .in('doctor_id', doctorIds)
        .eq('status', 'active');
      if (dsError) throw dsError;

      const servicesMap = {};
      doctorServicesData?.forEach(ds => {
        if (!servicesMap[ds.doctor_id]) servicesMap[ds.doctor_id] = [];
        servicesMap[ds.doctor_id].push({
          service_id: ds.services.service_id,
          service_name: ds.services.service_name
        });
      });

      // 4. Appointment stats
      const { data: statsData, error: statsError } = await supabase
        .from('appointments')
        .select('doctor_id, status, appointment_datetime')
        .in('doctor_id', doctorIds);
      if (statsError) throw statsError;

      const statsMap = {};
      statsData?.forEach(app => {
        if (!statsMap[app.doctor_id]) statsMap[app.doctor_id] = { totalApps: 0, upcoming: 0 };
        statsMap[app.doctor_id].totalApps++;
        if (app.status === 'pending' && new Date(app.appointment_datetime) > new Date()) {
          statsMap[app.doctor_id].upcoming++;
        }
      });

      // 5. Availability counts
      const today = new Date().toISOString().split('T')[0];
      const { data: availData, error: availError } = await supabase
        .from('doctor_availability')
        .select('doctor_id, availability_id')
        .in('doctor_id', doctorIds)
        .gte('available_date', today);
      if (!availError && availData) {
        const counts = {};
        availData.forEach(item => {
          counts[item.doctor_id] = (counts[item.doctor_id] || 0) + 1;
        });
        setAvailabilityCounts(counts);
      }

      const doctorsList = doctorsData.map(doc => ({
        ...doc,
        services_offered: (servicesMap[doc.doctor_id] || []).map(s => s.service_name).join(', ')
      }));

      setDoctors(doctorsList);
      setDoctorServicesMap(servicesMap);
      setDoctorStats(statsMap);
      setTotalDoctors(count || 0);
      setActiveDoctors(doctorsList.filter(d => d.status === 'active').length);

      const uniqueSpecs = [...new Set(doctorsList.map(d => d.specialization).filter(Boolean))];
      setSpecializations(uniqueSpecs);

    } catch (err) {
      console.error('Error fetching doctors:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, userType, isSuperAdmin, debouncedSearch, statusFilter, specializationFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setSpecializationFilter('');
    setPage(1);
  };

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

  const handleAddAvailability = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    if (availabilityForm.start_time >= availabilityForm.end_time) {
      setError('End time must be after start time');
      setIsSubmitting(false);
      return;
    }

    try {
      const { data: existing, error: checkError } = await supabase
        .from('doctor_availability')
        .select('availability_id')
        .eq('doctor_id', availabilityForm.doctor_id)
        .eq('available_date', availabilityForm.available_date)
        .eq('start_time', availabilityForm.start_time)
        .maybeSingle();

      if (checkError) throw checkError;
      if (existing) {
        setError('Availability slot already exists for this doctor on the selected date and time.');
        setIsSubmitting(false);
        return;
      }

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
      </div>
    );
  }

  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

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
            <button className="btn btn-primary" onClick={openAddModal}>
              <i className="fas fa-plus"></i> Add New Doctor
            </button>
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

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{totalDoctors}</div>
            <div className="stat-label">Total Doctors</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{activeDoctors}</div>
            <div className="stat-label">Active Doctors</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{specializations.length}</div>
            <div className="stat-label">Specializations</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{allServices.length}</div>
            <div className="stat-label">Services Offered</div>
          </div>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group">
              <label>Search Doctors</label>
              <input
                type="text"
                className="form-control"
                placeholder="Name, email, specialization..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
            <div className="filter-group">
              <button className="btn btn-primary" onClick={fetchData}>Apply</button>
              <button className="btn btn-secondary" onClick={resetFilters}>Reset</button>
            </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="table-container">
          <div className="table-header">
            <h3>Doctor List</h3>
            <span>Showing {doctors.length} of {totalCount} doctor(s)</span>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '25%' }}>Doctor</th>
                  <th style={{ width: '25%' }}>Specialization</th>
                  <th style={{ width: '20%' }}>Statistics</th>
                  <th style={{ width: '10%' }}>Status</th>
                  <th style={{ width: '20%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" className="loading-placeholder">
                      <div className="spinner-small"></div> Loading doctors...
                    </td>
                  </tr>
                ) : doctors.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="empty-state">
                      <div>👨‍⚕️</div>
                      <p>No doctors found</p>
                    </td>
                  </tr>
                ) : (
                  doctors.map(doctor => {
                    const stats = doctorStats[doctor.doctor_id] || { totalApps: 0, upcoming: 0 };
                    const availabilityCount = availabilityCounts[doctor.doctor_id] || 0;
                    return (
                      <tr key={doctor.doctor_id}>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div className="doctor-info">
                            <div className="doctor-avatar">
                              {doctor.first_name.charAt(0)}{doctor.last_name.charAt(0)}
                            </div>
                            <div>
                              <button 
                                className="doctor-name-button"
                                onClick={() => openEditModal(doctor)}
                              >
                                Dr. {doctor.first_name} {doctor.last_name}
                              </button>
                              <div className="doctor-id">ID: {doctor.doctor_id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          {doctor.specialization ? (
                            <span className="specialization-badge">{doctor.specialization}</span>
                          ) : (
                            <span className="text-muted">Not specified</span>
                          )}
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div className="stats-cells">
                            <div className="stat-item">
                              <span className="stat-number">{stats.totalApps}</span>
                              <span className="stat-label-small">Total Apps</span>
                            </div>
                            <div className="stat-item">
                              <span className="stat-number upcoming">{stats.upcoming}</span>
                              <span className="stat-label-small">Upcoming</span>
                            </div>
                            <div className="stat-item">
                              <span className="stat-number slots">{availabilityCount}</span>
                              <span className="stat-label-small">Slots</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <span className={`status-badge status-${doctor.status}`}>
                            {doctor.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div className="action-buttonsss">
                            <button className="btn btn-primary btn-sm" onClick={() => openEditModal(doctor)}>
                              Edit
                            </button>
                            <button className="btn btn-info btn-sm" onClick={() => openAvailabilityModal(doctor.doctor_id)}>
                              Availability
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => openResetPasswordModal(doctor.doctor_id)}>
                              Reset Pass
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
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-link" disabled={page === 1} onClick={() => setPage(p => p-1)}>Previous</button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button className="page-link" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Next</button>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>Add New Doctor</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddDoctor}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input type="text" className="form-control" value={addForm.first_name} onChange={e => setAddForm({...addForm, first_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input type="text" className="form-control" value={addForm.last_name} onChange={e => setAddForm({...addForm, last_name: e.target.value})} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input type="email" className="form-control" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Password *</label>
                    <input type="password" className="form-control" value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Confirm Password *</label>
                    <input type="password" className="form-control" value={addForm.confirm_password} onChange={e => setAddForm({...addForm, confirm_password: e.target.value})} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Specialization</label>
                  <input type="text" className="form-control" value={addForm.specialization} onChange={e => setAddForm({...addForm, specialization: e.target.value})} placeholder="e.g., General Dentistry, Orthodontics" />
                </div>
                <div className="form-group">
                  <label>Contact Number</label>
                  <input type="tel" className="form-control" value={addForm.contact_no} onChange={e => setAddForm({...addForm, contact_no: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Assign Services</label>
                  <div className="services-checkboxes">
                    {allServices.map(service => (
                      <div key={service.service_id} className="checkbox-group">
                        <input 
                          type="checkbox" 
                          id={`add_service_${service.service_id}`} 
                          checked={addForm.service_ids.includes(service.service_id)} 
                          onChange={e => { 
                            const checked = e.target.checked; 
                            setAddForm(prev => ({ 
                              ...prev, 
                              service_ids: checked ? [...prev.service_ids, service.service_id] : prev.service_ids.filter(id => id !== service.service_id) 
                            })); 
                          }} 
                        />
                        <label htmlFor={`add_service_${service.service_id}`}>{service.service_name} <small>(₱{service.price.toFixed(2)})</small></label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Doctor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>Edit Doctor</h3>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleEditDoctor}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input type="text" className="form-control" value={editForm.first_name} onChange={e => setEditForm({...editForm, first_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input type="text" className="form-control" value={editForm.last_name} onChange={e => setEditForm({...editForm, last_name: e.target.value})} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input type="email" className="form-control" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Specialization</label>
                  <input type="text" className="form-control" value={editForm.specialization} onChange={e => setEditForm({...editForm, specialization: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Contact Number</label>
                  <input type="tel" className="form-control" value={editForm.contact_no} onChange={e => setEditForm({...editForm, contact_no: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select className="form-control" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Assign Services</label>
                  <div className="services-checkboxes">
                    {allServices.map(service => (
                      <div key={service.service_id} className="checkbox-group">
                        <input 
                          type="checkbox" 
                          id={`edit_service_${service.service_id}`} 
                          checked={editForm.service_ids.includes(service.service_id)} 
                          onChange={e => { 
                            const checked = e.target.checked; 
                            setEditForm(prev => ({ 
                              ...prev, 
                              service_ids: checked ? [...prev.service_ids, service.service_id] : prev.service_ids.filter(id => id !== service.service_id) 
                            })); 
                          }} 
                        />
                        <label htmlFor={`edit_service_${service.service_id}`}>{service.service_name} <small>(₱{service.price.toFixed(2)})</small></label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Update Doctor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowResetPasswordModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Reset Doctor Password</h3>
              <button className="modal-close" onClick={() => setShowResetPasswordModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <div className="form-group">
                  <label>New Password *</label>
                  <input type="password" className="form-control" value={resetForm.new_password} onChange={e => setResetForm({...resetForm, new_password: e.target.value})} required />
                  <small>Minimum 6 characters</small>
                </div>
                <div className="form-group">
                  <label>Confirm Password *</label>
                  <input type="password" className="form-control" value={resetForm.confirm_password} onChange={e => setResetForm({...resetForm, confirm_password: e.target.value})} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetPasswordModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Resetting...' : 'Reset Password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Availability Modal */}
      {showAvailabilityModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAvailabilityModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Add Availability Slot</h3>
              <button className="modal-close" onClick={() => setShowAvailabilityModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddAvailability}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Available Date *</label>
                  <input type="date" className="form-control" value={availabilityForm.available_date} onChange={e => setAvailabilityForm({...availabilityForm, available_date: e.target.value})} min={new Date().toISOString().split('T')[0]} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Start Time *</label>
                    <input type="time" className="form-control" value={availabilityForm.start_time} onChange={e => setAvailabilityForm({...availabilityForm, start_time: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>End Time *</label>
                    <input type="time" className="form-control" value={availabilityForm.end_time} onChange={e => setAvailabilityForm({...availabilityForm, end_time: e.target.value})} required />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAvailabilityModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Slot'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
    </div>
  );
};

export default ManageDoctors;