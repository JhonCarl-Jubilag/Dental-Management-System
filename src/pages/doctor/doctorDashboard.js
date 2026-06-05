import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import DoctorSidebar from '../../components/doctor/Sidebar';
import './doctorDashboard.css';

const DoctorDashboard = () => {
  const { user, userType, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ 
    pending: 0, 
    confirmed: 0, 
    cancelled: 0, 
    done: 0, 
    total: 0, 
    today: 0, 
    upcoming: 0, 
    patients: 0 
  });
  const [recentAppointments, setRecentAppointments] = useState([]);
  const [error, setError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'doctor') navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  const fetchDashboardData = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    setLoading(true);
    setError('');
    try {
      const doctorId = userDetails.doctor_id;

      // Get appointment statistics grouped by status
      const { data: statusData, error: statusError } = await supabase
        .from('appointments')
        .select('status')
        .eq('doctor_id', doctorId);
      if (statusError) throw statusError;

      // Count each status
      let pending = 0, confirmed = 0, cancelled = 0, done = 0;
      statusData.forEach(app => {
        switch (app.status) {
          case 'pending': pending++; break;
          case 'confirmed': confirmed++; break;
          case 'cancelled': cancelled++; break;
          case 'done': done++; break;
          default: break;
        }
      });
      const total = pending + confirmed + cancelled + done;

      // Today's appointments
      const today = new Date().toISOString().split('T')[0];
      const { count: todayCount, error: todayError } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctorId)
        .gte('appointment_datetime', `${today} 00:00:00`)
        .lt('appointment_datetime', `${today} 23:59:59`);
      if (todayError) throw todayError;

      // Upcoming appointments (next 7 days, pending or confirmed)
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split('T')[0];
      const { count: upcomingCount, error: upcomingError } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', doctorId)
        .in('status', ['pending', 'confirmed'])
        .gte('appointment_datetime', `${today} 00:00:00`)
        .lte('appointment_datetime', `${nextWeekStr} 23:59:59`);
      if (upcomingError) throw upcomingError;

      // Total distinct patients
      const { data: patientData, error: patientError } = await supabase
        .from('appointments')
        .select('patient_id')
        .eq('doctor_id', doctorId);
      if (patientError) throw patientError;
      const uniquePatients = new Set(patientData.map(p => p.patient_id));
      const patientCount = uniquePatients.size;

      // Recent appointments (last 5)
      const { data: recent, error: recentError } = await supabase
        .from('appointments')
        .select(`
          appointment_id,
          appointment_datetime,
          status,
          patients!inner (first_name, last_name),
          services!inner (service_name, price)
        `)
        .eq('doctor_id', doctorId)
        .order('appointment_datetime', { ascending: false })
        .limit(5);
      if (recentError) throw recentError;

      const formattedRecent = recent.map(app => ({
        ...app,
        patient_name: `${app.patients.first_name} ${app.patients.last_name}`,
        service_name: app.services.service_name,
        price: app.services.price
      }));

      setStats({
        pending,
        confirmed,
        cancelled,
        done,
        total,
        today: todayCount || 0,
        upcoming: upcomingCount || 0,
        patients: patientCount
      });
      setRecentAppointments(formattedRecent);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userDetails]);

  useEffect(() => {
    if (userDetails?.doctor_id) {
      fetchDashboardData();
    }
  }, [fetchDashboardData, userDetails]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading || loading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!user || userType !== 'doctor') return null;

  const doctorName = userDetails?.first_name ? `Dr. ${userDetails.first_name} ${userDetails.last_name}` : 'Doctor';

  // Helper to get status badge class
  const getStatusClass = (status) => {
    switch(status) {
      case 'pending': return 'status-pending';
      case 'confirmed': return 'status-confirmed';
      case 'cancelled': return 'status-cancelled';
      case 'done': return 'status-done';
      default: return '';
    }
  };

  const getStatusLabel = (status) => {
    switch(status) {
      case 'pending': return 'Pending';
      case 'confirmed': return 'Confirmed';
      case 'cancelled': return 'Cancelled';
      case 'done': return 'Completed';
      default: return status;
    }
  };

  return (
    <div className="admin-dashboard">
      <DoctorSidebar onLogout={handleLogout} />
      <div className="main-content doctor-dashboard-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Doctor Dashboard</h1>
            <p className="welcome-message">Welcome back, {doctorName}!</p>
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

        {error && <div className="alert alert-error">{error}</div>}

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Appointments</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.patients}</div>
            <div className="stat-label">Total Patients</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.today}</div>
            <div className="stat-label">Today's Appointments</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.upcoming}</div>
            <div className="stat-label">Upcoming (7 Days)</div>
          </div>
        </div>

        {/* Appointment Status Overview */}
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Appointment Status Overview</h2>
          </div>
          <div className="status-grid">
            <div className="status-card pending">
              <div className="status-icon">⏳</div>
              <div className="status-number">{stats.pending}</div>
              <div className="status-label">Pending</div>
            </div>
            <div className="status-card confirmed">
              <div className="status-icon">✅</div>
              <div className="status-number">{stats.confirmed}</div>
              <div className="status-label">Confirmed</div>
            </div>
            <div className="status-card completed">
              <div className="status-icon">✓</div>
              <div className="status-number">{stats.done}</div>
              <div className="status-label">Completed</div>
            </div>
            <div className="status-card cancelled">
              <div className="status-icon">❌</div>
              <div className="status-number">{stats.cancelled}</div>
              <div className="status-label">Cancelled</div>
            </div>
          </div>
        </div>

        {/* Recent Appointments */}
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Recent Appointments</h2>
            <Link to="/doctor/manageAppointments" className="btn btn-primary btn-sm">View All</Link>
          </div>
          {recentAppointments.length === 0 ? (
            <div className="empty-state">No recent appointments found.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Date & Time</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAppointments.map(app => (
                    <tr key={app.appointment_id}>
                      <td>{app.patient_name}</td>
                      <td>{app.service_name}</td>
                      <td>{new Date(app.appointment_datetime).toLocaleString()}</td>
                      <td>
                        <span className={`status-badge ${getStatusClass(app.status)}`}>
                          {getStatusLabel(app.status)}
                        </span>
                      </td>
                      <td>₱{Number(app.price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
    </div>
  );
};

export default DoctorDashboard;