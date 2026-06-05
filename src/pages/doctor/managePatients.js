import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import DoctorSidebar from '../../components/doctor/Sidebar';
import './managePatients.css';

const ManagePatients = () => {
  const { user, userType, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewPatientId = searchParams.get('view');

  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [patientDetails, setPatientDetails] = useState(null);
  const [patientAppointments, setPatientAppointments] = useState([]);
  const [patientStats, setPatientStats] = useState({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'doctor' && !isSuperAdmin) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  const fetchPatients = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    setLoading(true);
    try {
      let query = supabase
        .from('appointments')
        .select(`
          patient_id,
          patients!inner (patient_id, first_name, last_name, email, contact_no, birthday, age, address)
        `)
        .eq('doctor_id', userDetails.doctor_id);

      if (search) {
        query = query.or(`patients.first_name.ilike.%${search}%,patients.last_name.ilike.%${search}%,patients.email.ilike.%${search}%,patients.contact_no.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const patientMap = new Map();
      data.forEach(item => {
        const p = item.patients;
        if (!patientMap.has(p.patient_id)) {
          patientMap.set(p.patient_id, {
            ...p,
            appointment_count: 0,
            last_visit: null
          });
        }
        patientMap.get(p.patient_id).appointment_count++;
      });

      const patientIds = Array.from(patientMap.keys());
      if (patientIds.length) {
        const { data: lastVisits } = await supabase
          .from('appointments')
          .select('patient_id, appointment_datetime')
          .eq('doctor_id', userDetails.doctor_id)
          .in('patient_id', patientIds)
          .order('appointment_datetime', { ascending: false });
        if (lastVisits) {
          const lastMap = new Map();
          lastVisits.forEach(v => {
            if (!lastMap.has(v.patient_id)) lastMap.set(v.patient_id, v.appointment_datetime);
          });
          for (let [id, patient] of patientMap.entries()) {
            patient.last_visit = lastMap.get(id) || null;
          }
        }
      }

      let patientsList = Array.from(patientMap.values());
      switch (sortBy) {
        case 'name':
          patientsList.sort((a, b) => a.last_name.localeCompare(b.last_name));
          break;
        case 'appointments':
          patientsList.sort((a, b) => b.appointment_count - a.appointment_count);
          break;
        default:
          patientsList.sort((a, b) => (b.last_visit || '').localeCompare(a.last_visit || ''));
      }
      setPatients(patientsList);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [userDetails, search, sortBy]);

  const fetchPatientHistory = useCallback(async () => {
    if (!viewPatientId || !userDetails?.doctor_id) return;
    setLoading(true);
    try {
      const { data: patient, error: patError } = await supabase
        .from('patients')
        .select('*')
        .eq('patient_id', viewPatientId)
        .single();
      if (patError) throw patError;
      setPatientDetails(patient);

      let query = supabase
        .from('appointments')
        .select(`
          *,
          services!inner (service_name, price)
        `)
        .eq('doctor_id', userDetails.doctor_id)
        .eq('patient_id', viewPatientId);

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (sortBy === 'oldest') query = query.order('appointment_datetime', { ascending: true });
      else if (sortBy === 'service') query = query.order('services.service_name', { ascending: true });
      else query = query.order('appointment_datetime', { ascending: false });

      const { data: appointments } = await query;
      setPatientAppointments(appointments || []);
      const statsCount = { pending: 0, approved: 0, cancelled: 0, completed: 0 };
      appointments?.forEach(a => {
        if (a.status === 'pending') statsCount.pending++;
        else if (a.status === 'approved') statsCount.approved++;
        else if (a.status === 'cancelled') statsCount.cancelled++;
        else if (a.status === 'completed') statsCount.completed++;
      });
      setPatientStats(statsCount);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [viewPatientId, userDetails, filterStatus, sortBy]);

  useEffect(() => {
    if (viewPatientId) fetchPatientHistory();
    else fetchPatients();
  }, [viewPatientId, fetchPatients, fetchPatientHistory]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading || loading) return <div className="admin-loading"><div className="loading-spinner"></div><p>Loading...</p></div>;
  if (!user || (userType !== 'doctor' && !isSuperAdmin)) return null;

  const doctorName = userDetails?.first_name ? `Dr. ${userDetails.first_name} ${userDetails.last_name}` : 'Doctor';

  return (
    <div className="admin-dashboard">
      <DoctorSidebar onLogout={handleLogout} />
      <div className="main-content manage-patients-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Patients</h1>
            <p className="welcome-message">View and manage your patients</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">{doctorName.charAt(0).toUpperCase()}</div>
              <div className="user-details">
                <div className="user-name">{doctorName}</div>
                <div className="user-role">Dentist</div>
              </div>
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="breadcrumb">
          {viewPatientId && patientDetails ? (
            <>
              <Link to="/doctor/patients">All Patients</Link>
              <span className="separator">/</span>
              <span>{patientDetails.first_name} {patientDetails.last_name}</span>
              <Link to="/doctor/patients" className="btn-back">← Back to Patients</Link>
            </>
          ) : (
            <span>All Patients</span>
          )}
        </div>

        {!viewPatientId ? (
          // Patients list view
          <>
            <div className="filters-row">
              <div className="filter-group search">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search by name, email, phone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <select className="form-control" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="recent">Most Recent Visit</option>
                  <option value="name">Name (A-Z)</option>
                  <option value="appointments">Number of Appointments</option>
                </select>
              </div>
              <button className="btn btn-outline" onClick={() => { setSearch(''); setSortBy('recent'); }}>Reset</button>
            </div>

            {patients.length === 0 ? (
              <div className="empty-state"><i className="fas fa-users"></i><p>No patients found.</p></div>
            ) : (
              <div className="patients-grid">
                {patients.map(patient => {
                  const initials = (patient.first_name?.charAt(0) || '') + (patient.last_name?.charAt(0) || '');
                  return (
                    <div key={patient.patient_id} className="patient-card">
                      <div className="patient-card-header">
                        <div className="patient-avatar">{initials.toUpperCase()}</div>
                        <div>
                          <div className="patient-name">{patient.first_name} {patient.last_name}</div>
                          <div className="patient-email">{patient.email}</div>
                        </div>
                      </div>
                      <div className="patient-info">
                        <div><i className="fas fa-phone"></i> {patient.contact_no || 'N/A'}</div>
                        <div><i className="fas fa-birthday-cake"></i> Age: {patient.age || 'N/A'}</div>
                        <div><i className="fas fa-calendar-check"></i> Last Visit: {patient.last_visit ? new Date(patient.last_visit).toLocaleDateString() : 'Never'}</div>
                      </div>
                      <div className="patient-stats">
                        <div className="stat">
                          <span className="stat-number">{patient.appointment_count}</span>
                          <span className="stat-label">Appointments</span>
                        </div>
                      </div>
                      <Link to={`/doctor/patients?view=${patient.patient_id}`} className="btn-view">View History</Link>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          patientDetails && (
            <>
              {/* Patient profile summary */}
              <div className="patient-profile">
                <div className="profile-avatar">
                  {(patientDetails.first_name?.charAt(0) || '') + (patientDetails.last_name?.charAt(0) || '')}
                </div>
                <div className="profile-info">
                  <h2>{patientDetails.first_name} {patientDetails.last_name}</h2>
                  <div className="contact-info">
                    <span><i className="fas fa-envelope"></i> {patientDetails.email}</span>
                    <span><i className="fas fa-phone"></i> {patientDetails.contact_no || '—'}</span>
                    <span><i className="fas fa-birthday-cake"></i> Age: {patientDetails.age || 'N/A'}</span>
                  </div>
                </div>
                <div className="profile-stats">
                  <div className="stat-item">
                    <div className="stat-number">{patientStats.pending || 0}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{patientStats.approved || 0}</div>
                    <div className="stat-label">Approved</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{patientStats.completed || 0}</div>
                    <div className="stat-label">Completed</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{patientStats.cancelled || 0}</div>
                    <div className="stat-label">Cancelled</div>
                  </div>
                </div>
              </div>

              {/* Compact filters for history */}
              <div className="history-filters">
                <div className="filter-group">
                  <label>Status</label>
                  <select className="form-control" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Sort By</label>
                  <select className="form-control" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                    <option value="recent">Most Recent</option>
                    <option value="oldest">Oldest First</option>
                    <option value="service">Service Name</option>
                  </select>
                </div>
              </div>

              <div className="appointments-list">
                <h3 className="section-title">Appointment History</h3>
                {patientAppointments.length === 0 ? (
                  <div className="empty-state">No appointments found.</div>
                ) : (
                  patientAppointments.map(app => (
                    <div key={app.appointment_id} className="appointment-card-compact">
                      <div className="appointment-main">
                        <div className="service-info">
                          <strong>{app.services.service_name}</strong>
                          <span className="price">₱{Number(app.services.price).toFixed(2)}</span>
                        </div>
                        <div className="datetime-info">
                          <div className="date">{new Date(app.appointment_datetime).toLocaleDateString()}</div>
                          <div className="time">{new Date(app.appointment_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div className={`status-badge status-${app.status}`}>{app.status.toUpperCase()}</div>
                      </div>
                      <div className="appointment-footer">
                        <div className="booked-on"><i className="fas fa-calendar-plus"></i> Booked: {new Date(app.created_at).toLocaleString()}</div>
                        {app.remarks && <div className="remarks"><i className="fas fa-comment"></i> {app.remarks}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )
        )}
      </div>
      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManagePatients;