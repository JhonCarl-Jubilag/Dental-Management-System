import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './dashboard.css';

const AdminDashboard = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  
  const [dashboardData, setDashboardData] = useState({
    totalPatients: 0,
    totalDoctors: 0,
    totalAppointments: 0,
    todayAppointments: 0,
    pendingAppointments: 0,
    totalRevenue: 0,
    todayRevenue: 0,
    avgRevenuePerAppointment: 0,
    newPatientsMonth: 0,
    conversionRate: 0,
    totalOutstanding: 0,
    unpaidInvoices: 0,
    patientGrowthRate: 0,
    revenueGrowthRate: 0
  });

  const [recentAppointments, setRecentAppointments] = useState([]);
  const isMounted = useRef(true);

  const SUPER_ADMIN_EMAIL = 'jhoncarl.jubilag@cvsu.edu.ph';
  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;

  const totalPages = Math.ceil(recentAppointments.length / itemsPerPage);
  const paginatedAppointments = recentAppointments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  // Reset to page 1 when new data arrives
  useEffect(() => {
    setCurrentPage(1);
  }, [recentAppointments]);

  useEffect(() => {
    if (!authLoading && !authChecked) {
      if (!user) {
        navigate('/login', { replace: true });
      } else if (userType !== 'admin' && !isSuperAdmin) {
        navigate('/', { replace: true });
      } else {
        setAuthChecked(true);
      }
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin, authChecked]);

  const fetchDashboardData = useCallback(async () => {
    if (!isMounted.current) return;
    setLoading(true);
    try {
      const [
        { count: totalPatients },
        { count: totalDoctors },
        { count: totalAppointments },
        { count: todayAppointments },
        { count: pendingAppointments },
        revenueResult,
        todayRevenueResult,
        avgRevenueResult,
        { count: newPatientsMonth },
        outstandingResult,
        recentAppointmentsResult,
        growthRateResult,
        revenueGrowthResult
      ] = await Promise.all([
        supabase.from('patients').select('*', { count: 'exact', head: true }),
        supabase.from('doctors').select('*', { count: 'exact', head: true }),
        supabase.from('appointments').select('*', { count: 'exact', head: true }),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('appointment_datetime', new Date().toISOString().split('T')[0]),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('billing').select('amount_paid'),
        supabase.from('billing').select('amount_paid').gte('payment_date', new Date().toISOString().split('T')[0]),
        supabase.from('billing').select('amount_paid').gt('amount_paid', 0),
        supabase.from('patients').select('*', { count: 'exact', head: true }).gte('date_created', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        supabase.from('billing').select('balance').gt('balance', 0),
        supabase.from('appointments').select('*, patients(first_name, last_name), doctors(first_name, last_name), services(service_name)').order('created_at', { ascending: false }).limit(10),
        supabase.from('patients').select('date_created').gte('date_created', new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString()),
        supabase.from('billing').select('amount_paid, payment_date').gte('payment_date', new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString())
      ]);

      if (!isMounted.current) return;

      const totalRevenue = revenueResult.data?.reduce((sum, item) => sum + (item.amount_paid || 0), 0) || 0;
      const todayRevenueVal = todayRevenueResult.data?.reduce((sum, item) => sum + (item.amount_paid || 0), 0) || 0;
      const avgRevenue = avgRevenueResult.data?.length ? totalRevenue / avgRevenueResult.data.length : 0;
      const totalOutstanding = outstandingResult.data?.reduce((sum, item) => sum + (item.balance || 0), 0) || 0;
      const unpaidInvoices = outstandingResult.data?.filter(item => item.balance > 0).length || 0;

      const nonPending = totalAppointments - pendingAppointments;
      const conversionRate = totalAppointments ? ((nonPending / totalAppointments) * 100).toFixed(1) : 0;

      setDashboardData({
        totalPatients: totalPatients || 0,
        totalDoctors: totalDoctors || 0,
        totalAppointments: totalAppointments || 0,
        todayAppointments: todayAppointments || 0,
        pendingAppointments: pendingAppointments || 0,
        totalRevenue: totalRevenue,
        todayRevenue: todayRevenueVal,
        avgRevenuePerAppointment: avgRevenue,
        newPatientsMonth: newPatientsMonth || 0,
        conversionRate: conversionRate,
        totalOutstanding: totalOutstanding,
        unpaidInvoices: unpaidInvoices,
        patientGrowthRate: calculateGrowthRate(growthRateResult.data),
        revenueGrowthRate: calculateRevenueGrowth(revenueGrowthResult.data)
      });

      if (recentAppointmentsResult.data) {
        const appointments = recentAppointmentsResult.data.map(apt => ({
          patient: `${apt.patients?.first_name || ''} ${apt.patients?.last_name || ''}`,
          doctor: `Dr. ${apt.doctors?.first_name || ''} ${apt.doctors?.last_name || ''}`,
          service: apt.services?.service_name || '',
          datetime: apt.appointment_datetime,
          status: apt.status
        }));
        setRecentAppointments(appointments);
      }

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const calculateGrowthRate = (data) => {
    if (!data || data.length < 2) return 0;
    const currentMonth = data.filter(d => new Date(d.date_created).getMonth() === new Date().getMonth()).length;
    const lastMonth = data.filter(d => new Date(d.date_created).getMonth() === new Date().getMonth() - 1).length;
    return lastMonth ? ((currentMonth - lastMonth) / lastMonth * 100).toFixed(1) : currentMonth ? 100 : 0;
  };

  const calculateRevenueGrowth = (data) => {
    if (!data || data.length < 2) return 0;
    const currentMonth = data.filter(d => new Date(d.payment_date).getMonth() === new Date().getMonth()).reduce((sum, d) => sum + (d.amount_paid || 0), 0);
    const lastMonth = data.filter(d => new Date(d.payment_date).getMonth() === new Date().getMonth() - 1).reduce((sum, d) => sum + (d.amount_paid || 0), 0);
    return lastMonth ? ((currentMonth - lastMonth) / lastMonth * 100).toFixed(1) : currentMonth ? 100 : 0;
  };

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (authChecked && user && (userType === 'admin' || isSuperAdmin)) {
      fetchDashboardData();
    }
  }, [authChecked, user, userType, isSuperAdmin, fetchDashboardData]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading || !authChecked) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading analytics...</p>
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
            <h1>Dashboard</h1>
            <p className="welcome-message">Welcome back, {adminName}! Here's your clinic overview</p>
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

        {/* KPI Cards */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-value">{dashboardData.conversionRate}%</div>
            <div className="kpi-label">Conversion Rate</div>
            <div className="kpi-trend trend-up">Booking to Completion</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₱{dashboardData.avgRevenuePerAppointment.toLocaleString()}</div>
            <div className="kpi-label">Avg. Revenue/Visit</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{dashboardData.todayAppointments}</div>
            <div className="kpi-label">Today's Appointments</div>
            <div className="kpi-trend">{dashboardData.pendingAppointments} pending</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₱{dashboardData.totalOutstanding.toLocaleString()}</div>
            <div className="kpi-label">Outstanding Balance</div>
            <div className="kpi-trend trend-down">{dashboardData.unpaidInvoices} invoices</div>
          </div>
        </div>

        {/* Analytics Cards */}
        <div className="analytics-grid">
          <div className="analytics-card patients">
            <div className="analytics-header">
              <div>
                <div className="analytics-title">Total Patients</div>
                <div className="analytics-value">{dashboardData.totalPatients.toLocaleString()}</div>
                <div className={`analytics-trend ${dashboardData.patientGrowthRate >= 0 ? 'trend-up' : 'trend-down'}`}>
                  {dashboardData.patientGrowthRate >= 0 ? '↗' : '↘'} {Math.abs(dashboardData.patientGrowthRate)}% growth
                </div>
              </div>
              <div className="analytics-icon">👥</div>
            </div>
            <div className="analytics-detail">{dashboardData.newPatientsMonth} new patients this month</div>
          </div>

          <div className="analytics-card revenue">
            <div className="analytics-header">
              <div>
                <div className="analytics-title">Total Revenue</div>
                <div className="analytics-value">₱{dashboardData.totalRevenue.toLocaleString()}</div>
                <div className={`analytics-trend ${dashboardData.revenueGrowthRate >= 0 ? 'trend-up' : 'trend-down'}`}>
                  {dashboardData.revenueGrowthRate >= 0 ? '↗' : '↘'} {Math.abs(dashboardData.revenueGrowthRate)}% growth
                </div>
              </div>
              <div className="analytics-icon">💰</div>
            </div>
            <div className="analytics-detail">₱{dashboardData.todayRevenue.toLocaleString()} revenue today</div>
          </div>

          <div className="analytics-card appointments">
            <div className="analytics-header">
              <div>
                <div className="analytics-title">Total Appointments</div>
                <div className="analytics-value">{dashboardData.totalAppointments.toLocaleString()}</div>
                <div className="analytics-trend trend-up">↗ {dashboardData.conversionRate}% completed</div>
              </div>
              <div className="analytics-icon">📅</div>
            </div>
            <div className="analytics-detail">{dashboardData.todayAppointments} scheduled today</div>
          </div>

          <div className="analytics-card doctors">
            <div className="analytics-header">
              <div>
                <div className="analytics-title">Active Doctors</div>
                <div className="analytics-value">{dashboardData.totalDoctors}</div>
                <div className="analytics-trend trend-up">↗ All available</div>
              </div>
              <div className="analytics-icon">👨‍⚕️</div>
            </div>
            <div className="analytics-detail">Ready to serve patients</div>
          </div>
        </div>

        <div className="recent-section">
          <div className="section-header">
            <h3>📋 Recent Appointments</h3>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Service</th>
                  <th>Date/Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAppointments.length > 0 ? (
                  paginatedAppointments.map((apt, idx) => (
                    <tr key={idx}>
                      <td>{apt.patient}</td>
                      <td>{apt.doctor}</td>
                      <td>{apt.service}</td>
                      <td>{new Date(apt.datetime).toLocaleString()}</td>
                      <td>
                        <span className={`status-badge status-${apt.status}`}>
                          {apt.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>
                      No appointments found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {recentAppointments.length > itemsPerPage && (
            <div className="pagination-controls">
              <button 
                onClick={goToPrevPage} 
                disabled={currentPage === 1}
                className="pagination-btn"
              >
                ← Previous
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button 
                onClick={goToNextPage} 
                disabled={currentPage === totalPages}
                className="pagination-btn"
              >
                Next →
              </button>
            </div>
          )}
        </div>
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

export default AdminDashboard;