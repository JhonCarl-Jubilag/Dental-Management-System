import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase, doctorProfileFields } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import DoctorAvailabilityModal from '../../components/admin/DoctorAvailabilityModal';
import { getClinicDate } from '../../utils/clinicScheduling';
import './manageDoctors.css';

const manageDoctorAccount = async (body) => {
  const { data, error } = await supabase.functions.invoke('manage-doctor-account', { body });
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

const ManageDoctors = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [specializations, setSpecializations] = useState([]);

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
  const [providerSetup, setProviderSetup] = useState(null);
  const [setupError, setSetupError] = useState('');
  const providerSaving = useRef(false);
  const providerSetupRequest = useRef(0);
  const [availabilityDoctor, setAvailabilityDoctor] = useState(null);

  const [addForm, setAddForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
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

  const isSuperAdmin = isOwner(userType);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        navigate('/login');
      } else if (!isClinicUser(userType)) {
        navigate('/');
      }
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  const fetchData = useCallback(async () => {
    if (!user || (!isClinicUser(userType))) return;
    setLoading(true);
    setLoadError(null);

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
        .select(doctorProfileFields, { count: 'exact' });

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
        setHasLoaded(true);
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
      const today = getClinicDate();
      const { data: availData, error: availError } = await supabase
        .from('doctor_availability')
        .select('doctor_id, availability_id')
        .in('doctor_id', doctorIds)
        .eq('is_available', true)
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

      setHasLoaded(true);

    } catch (err) {
      setLoadError(err);
      console.error('Error fetching doctors:', err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, userType, debouncedSearch, statusFilter, specializationFilter, page]);

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

  const loadProviderSetup = useCallback(async () => {
    if (!user || !isClinicUser(userType)) return;
    const version = ++providerSetupRequest.current;
    setProviderSetup(null);
    setSetupError('');
    try {
      const state = await manageDoctorAccount({ action: 'status' });
      if (version === providerSetupRequest.current) setProviderSetup(state);
    } catch (err) {
      if (version === providerSetupRequest.current) { setProviderSetup(null); setSetupError(err.message); }
    }
  }, [user, userType]);

  useEffect(() => { loadProviderSetup(); return () => { providerSetupRequest.current += 1; }; }, [loadProviderSetup]);

  const saveProvider = async (event, editing = false) => {
    event.preventDefault();
    if (providerSaving.current || !providerSetup?.ready) return;
    providerSaving.current = true; setIsSubmitting(true);
    const form = editing ? editForm : addForm;
    try {
      await manageDoctorAccount({ action: editing ? 'update' : 'create',
        ...(editing ? { doctor_id: form.doctor_id, expected: form.expected } : {}),
        profile: { first_name: form.first_name, last_name: form.last_name, email: form.email,
          specialization: form.specialization || null, contact_no: form.contact_no || null, status: editing ? form.status : 'active' },
        service_ids: form.service_ids,
      });
      toast.success(editing ? 'Dentist profile and services updated.' : 'Dentist profile created. No login account was created.');
      if (editing) setShowEditModal(false); else setShowAddModal(false);
      await fetchData();
    } catch (err) { toast.error(err.message); }
    finally { providerSaving.current = false; setIsSubmitting(false); }
  };

  const retireDentistLogins = async () => {
    if (!isSuperAdmin || providerSaving.current || !providerSetup?.fingerprint) return;
    const count = providerSetup.candidates.filter(candidate => !candidate.disabled).length;
    if (!window.confirm(`Retire ${count} reviewed dentist login(s)? Dentist profiles, schedules and clinical records will be kept. Owner, Staff and Patient identities are excluded.`)) return;
    providerSaving.current = true; setIsSubmitting(true);
    try {
      setProviderSetup(await manageDoctorAccount({ action: 'retire_logins', fingerprint: providerSetup.fingerprint }));
      toast.success('Reviewed dentist logins retired. Provider profiles are preserved.');
    } catch (err) { toast.error(err.message); await loadProviderSetup(); }
    finally { providerSaving.current = false; setIsSubmitting(false); }
  };

  const openAddModal = () => {
    setAddForm({
      first_name: '', last_name: '', email: '',
      specialization: '', contact_no: '', service_ids: []
    });
    setShowAddModal(true);
  };

  const openEditModal = (doctor) => {
    setEditForm({
      doctor_id: doctor.doctor_id,
      first_name: doctor.first_name,
      last_name: doctor.last_name,
      email: doctor.email,
      expected: { profile: { first_name: doctor.first_name, last_name: doctor.last_name, email: doctor.email,
        specialization: doctor.specialization, contact_no: doctor.contact_no, status: doctor.status },
        service_ids: (doctorServicesMap[doctor.doctor_id] || []).map(service => service.service_id).sort((a,b) => a-b) },
      specialization: doctor.specialization || '',
      contact_no: doctor.contact_no || '',
      status: doctor.status,
      service_ids: doctorServicesMap[doctor.doctor_id]?.map(s => s.service_id) || []
    });
    setShowEditModal(true);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (!user || (!isClinicUser(userType))) return null;

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
            <button className="btn btn-primary" disabled={loading || !hasLoaded || !providerSetup?.ready || isSubmitting} onClick={openAddModal}>
              <i className="fas fa-plus"></i> Add New Doctor
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
        <div className="provider-cutover-notice">
          <p>Dentists are managed as clinic profiles. New profiles do not receive login accounts.</p>
          {setupError && <p role="alert">{setupError}</p>}
          {!providerSetup?.ready && !setupError && <p>Provider editing is waiting for the Owner to finish retiring legacy dentist logins. Scheduling remains available.</p>}
          <button type="button" className="btn btn-secondary" disabled={isSubmitting} onClick={loadProviderSetup}>Refresh provider setup</button>
          {isSuperAdmin && providerSetup?.candidates?.some(candidate => !candidate.disabled) && <details>
            <summary>Review legacy dentist sign-ins</summary>
            <ul>{providerSetup.candidates.map(candidate => <li key={candidate.auth_user_id}>Dr. {candidate.first_name} {candidate.last_name} — {candidate.email} ({candidate.disabled ? 'Already disabled' : 'Will be retired'})</li>)}</ul>
            <button type="button" className="btn btn-warning" disabled={isSubmitting} onClick={retireDentistLogins}>Retire reviewed dentist logins</button>
          </details>}
        </div>
        <AdminDataRegion loading={loading} hasLoaded={hasLoaded} error={loadError} label="Doctors" onRetry={fetchData}>


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
                {doctors.length === 0 ? (
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
                                disabled={!providerSetup?.ready || isSubmitting} onClick={() => openEditModal(doctor)}
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
                            <button className="btn btn-primary btn-sm" disabled={!providerSetup?.ready || isSubmitting} onClick={() => openEditModal(doctor)}>
                              Edit
                            </button>
                            <button className="btn btn-info btn-sm" onClick={() => setAvailabilityDoctor(doctor)}>
                              Availability
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
        </AdminDataRegion>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header">
              <h3>Add New Doctor</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <form onSubmit={event => saveProvider(event)}>
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
                  <label>Contact Email *</label>
                  <input type="email" className="form-control" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} required />
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
            <form onSubmit={event => saveProvider(event, true)}>
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
                  <label>Contact Email *</label>
                  <input type="email" className="form-control" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} disabled={isSubmitting} maxLength={254} required />
                  <small>This changes dentist contact information only. No login account is changed.</small>
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

      {availabilityDoctor && (
        <DoctorAvailabilityModal
          key={availabilityDoctor.doctor_id}
          doctor={availabilityDoctor}
          onClose={() => setAvailabilityDoctor(null)}
          onChanged={fetchData}
        />
      )}

      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManageDoctors;
