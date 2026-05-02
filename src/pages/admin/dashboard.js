import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import './dashboard.css';

const AdminDashboard = () => {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Mock data for dashboard
  const dashboardData = useMemo(() => ({
    totalPatients: 156,
    totalDoctors: 4,
    totalAppointments: 342,
    todayAppointments: 12,
    pendingAppointments: 8,
    totalRevenue: 245800,
    todayRevenue: 12500,
    avgRevenuePerAppointment: 718.71,
    newPatientsMonth: 23,
    conversionRate: 68.5,
    totalOutstanding: 15250,
    unpaidInvoices: 6,
    patientGrowthRate: 15.2,
    revenueGrowthRate: 12.5
  }), []);

  // Mock chart data
  const revenueTrend = useMemo(() => ({
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    revenues: [18500, 21200, 24800, 23500, 29800, 32500],
    transactions: [26, 30, 35, 32, 42, 46]
  }), []);

  const servicePerformance = useMemo(() => [
    { name: 'Dental Checkup', revenue: 28500, bookings: 57, share: 22.5 },
    { name: 'Teeth Cleaning', revenue: 22400, bookings: 28, share: 17.6 },
    { name: 'Root Canal', revenue: 35000, bookings: 7, share: 27.6 },
    { name: 'Tooth Filling', revenue: 18000, bookings: 15, share: 14.2 },
    { name: 'Tooth Extraction', revenue: 10500, bookings: 7, share: 8.3 },
    { name: 'Teeth Whitening', revenue: 10500, bookings: 3, share: 8.3 },
    { name: 'Dental Crown', revenue: 16000, bookings: 2, share: 12.6 },
    { name: 'Dental Bridge', revenue: 12000, bookings: 1, share: 9.5 }
  ], []);

  const doctorPerformance = useMemo(() => [
    { name: 'John Smith', specialization: 'General Dentistry', revenue: 89200, appointments: 128, completion: 94.5, workload: 42.3 },
    { name: 'Maria Garcia', specialization: 'Periodontics', revenue: 78400, appointments: 96, completion: 91.2, workload: 31.7 },
    { name: 'Robert Williams', specialization: 'Orthodontics', revenue: 68200, appointments: 85, completion: 89.8, workload: 28.1 },
    { name: 'Sarah Johnson', specialization: 'Pediatric Dentistry', revenue: 45100, appointments: 67, completion: 95.2, workload: 22.1 }
  ], []);

  const topPatients = useMemo(() => [
    { name: 'Jhon Carl Jubilag', appointments: 5, spent: 32500, lastPayment: '2026-01-15' },
    { name: 'Maria Santos', appointments: 4, spent: 21500, lastPayment: '2026-01-10' },
    { name: 'Juan Dela Cruz', appointments: 3, spent: 18500, lastPayment: '2026-01-08' },
    { name: 'Ana Reyes', appointments: 3, spent: 16200, lastPayment: '2026-01-05' },
    { name: 'Roberto Gonzales', appointments: 2, spent: 15000, lastPayment: '2026-01-12' }
  ], []);

  const recentAppointments = useMemo(() => [
    { patient: 'Juan Dela Cruz', doctor: 'Dr. John Smith', service: 'Dental Checkup', datetime: '2026-01-20 09:00', status: 'approved' },
    { patient: 'Maria Santos', doctor: 'Dr. Maria Garcia', service: 'Root Canal', datetime: '2026-01-20 10:30', status: 'pending' },
    { patient: 'Jhon Carl Jubilag', doctor: 'Dr. Robert Williams', service: 'Teeth Cleaning', datetime: '2026-01-19 14:00', status: 'done' },
    { patient: 'Ana Reyes', doctor: 'Dr. John Smith', service: 'Tooth Filling', datetime: '2026-01-19 11:00', status: 'approved' },
    { patient: 'Roberto Gonzales', doctor: 'Dr. Maria Garcia', service: 'Dental Crown', datetime: '2026-01-18 15:30', status: 'done' },
    { patient: 'Carmen Torres', doctor: 'Dr. Sarah Johnson', service: 'Child Dental Care', datetime: '2026-01-18 09:30', status: 'approved' }
  ], []);

  const patientDemographics = useMemo(() => [
    { group: 'Under 18', count: 32, percentage: 20.5 },
    { group: '18-30', count: 45, percentage: 28.8 },
    { group: '31-50', count: 52, percentage: 33.3 },
    { group: '50+', count: 27, percentage: 17.3 }
  ], []);

  const paymentDistribution = useMemo(() => [
    { method: 'cash', amount: 156800, transactions: 168, percentage: 63.8 },
    { method: 'gcash', amount: 52300, transactions: 89, percentage: 21.3 },
    { method: 'card', amount: 28900, transactions: 42, percentage: 11.8 },
    { method: 'insurance', amount: 7800, transactions: 12, percentage: 3.2 }
  ], []);

  const appointmentStats = useMemo(() => [
    { status: 'pending', count: 8 },
    { status: 'approved', count: 45 },
    { status: 'cancelled', count: 12 },
    { status: 'done', count: 277 }
  ], []);

  // Chart refs
  const revenueChartRef = useRef(null);
  const serviceChartRef = useRef(null);
  const appointmentChartRef = useRef(null);
  const demographicsChartRef = useRef(null);
  const paymentChartRef = useRef(null);
  const chartInstances = useRef({});

  // Initialize charts
  const initCharts = useCallback(async () => {
    try {
      const Chart = (await import('chart.js')).default;
      
      // Destroy existing charts
      Object.values(chartInstances.current).forEach(chart => {
        if (chart) chart.destroy();
      });
      
      // Revenue Chart
      if (revenueChartRef.current) {
        chartInstances.current.revenue = new Chart(revenueChartRef.current, {
          type: 'line',
          data: {
            labels: revenueTrend.months,
            datasets: [
              {
                label: 'Revenue (₱)',
                data: revenueTrend.revenues,
                borderColor: '#354D70',
                backgroundColor: 'rgba(53, 77, 112, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                yAxisID: 'y'
              },
              {
                label: 'Transactions',
                data: revenueTrend.transactions,
                borderColor: '#4d83d4',
                backgroundColor: 'rgba(77, 131, 212, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              tooltip: {
                callbacks: {
                  label: (context) => {
                    if (context.dataset.label === 'Revenue (₱)') {
                      return '₱' + context.parsed.y.toLocaleString('en-PH', { minimumFractionDigits: 2 });
                    }
                    return context.parsed.y + ' transactions';
                  }
                }
              }
            },
            scales: {
              y: { 
                title: { display: true, text: 'Revenue (₱)' }, 
                ticks: { callback: (v) => '₱' + v.toLocaleString() } 
              },
              y1: { 
                position: 'right', 
                title: { display: true, text: 'Transactions' }, 
                grid: { drawOnChartArea: false } 
              }
            }
          }
        });
      }

      // Service Performance Chart
      if (serviceChartRef.current) {
        chartInstances.current.service = new Chart(serviceChartRef.current, {
          type: 'bar',
          data: {
            labels: servicePerformance.map(s => s.name),
            datasets: [{
              label: 'Revenue (₱)',
              data: servicePerformance.map(s => s.revenue),
              backgroundColor: [
                'rgba(53, 77, 112, 0.8)', 'rgba(77, 131, 212, 0.8)', 'rgba(102, 126, 234, 0.8)',
                'rgba(240, 147, 251, 0.8)', 'rgba(79, 172, 254, 0.8)', 'rgba(67, 233, 123, 0.8)',
                'rgba(255, 209, 102, 0.8)', 'rgba(255, 99, 132, 0.8)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { ticks: { callback: (v) => '₱' + v.toLocaleString() } } }
          }
        });
      }

      // Appointment Distribution Chart (Doughnut)
      if (appointmentChartRef.current) {
        chartInstances.current.appointment = new Chart(appointmentChartRef.current, {
          type: 'doughnut',
          data: {
            labels: appointmentStats.map(s => s.status.toUpperCase()),
            datasets: [{
              data: appointmentStats.map(s => s.count),
              backgroundColor: ['#ffc107', '#28a745', '#dc3545', '#17a2b8'],
              borderWidth: 2,
              borderColor: '#fff'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } },
              tooltip: { 
                callbacks: { 
                  label: (ctx) => `${ctx.label}: ${ctx.parsed} (${((ctx.parsed / dashboardData.totalAppointments) * 100).toFixed(1)}%)` 
                } 
              }
            },
            cutout: '70%'
          }
        });
      }

      // Demographics Chart
      if (demographicsChartRef.current) {
        chartInstances.current.demographics = new Chart(demographicsChartRef.current, {
          type: 'pie',
          data: {
            labels: patientDemographics.map(d => d.group),
            datasets: [{
              data: patientDemographics.map(d => d.count),
              backgroundColor: [
                'rgba(102, 126, 234, 0.8)', 'rgba(240, 147, 251, 0.8)', 
                'rgba(79, 172, 254, 0.8)', 'rgba(67, 233, 123, 0.8)'
              ],
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { padding: 20, usePointStyle: true } }
            }
          }
        });
      }

      // Payment Distribution Chart
      if (paymentChartRef.current) {
        chartInstances.current.payment = new Chart(paymentChartRef.current, {
          type: 'polarArea',
          data: {
            labels: paymentDistribution.map(p => p.method.toUpperCase()),
            datasets: [{
              data: paymentDistribution.map(p => p.amount),
              backgroundColor: [
                'rgba(53, 77, 112, 0.8)', 'rgba(77, 131, 212, 0.8)', 
                'rgba(102, 126, 234, 0.8)', 'rgba(240, 147, 251, 0.8)'
              ],
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { padding: 20, usePointStyle: true } }
            }
          }
        });
      }
    } catch (error) {
      console.error('Error loading Chart.js:', error);
    }
  }, [revenueTrend, servicePerformance, appointmentStats, patientDemographics, paymentDistribution, dashboardData.totalAppointments]);

  useEffect(() => {
    initCharts();
    
    // Cleanup on unmount
    const currentCharts = chartInstances.current;
    return () => {
      Object.values(currentCharts).forEach(chart => {
        if (chart) chart.destroy();
      });
    };
  }, [initCharts]);

  const handleLogout = () => {
    setIsLoggingOut(true);
    setTimeout(() => {
      window.location.href = '/';
    }, 1000);
  };

  return (
    <div className="admin-dashboard">
      {/* Sidebar - Fixed width, no collapse */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">🦷</div>
            <div className="logo-text">
              <h2>Fifthcusp</h2>
              <p>Admin Portal</p>
            </div>
          </div>
        </div>

        <ul className="sidebar-nav">
          <li>
            <Link to="/admin/dashboard" className={activeNav === 'dashboard' ? 'active' : ''} onClick={() => setActiveNav('dashboard')}>
              <i className="fas fa-tachometer-alt nav-icon"></i>
              <span>Dashboard</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/services" onClick={() => setActiveNav('services')}>
              <i className="fas fa-tooth nav-icon"></i>
              <span>Manage Services</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/doctors" onClick={() => setActiveNav('doctors')}>
              <i className="fas fa-user-md nav-icon"></i>
              <span>Manage Doctors</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/appointments" onClick={() => setActiveNav('appointments')}>
              <i className="fas fa-calendar-check nav-icon"></i>
              <span>Manage Appointments</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/patients" onClick={() => setActiveNav('patients')}>
              <i className="fas fa-users nav-icon"></i>
              <span>Manage Patients</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/billing" onClick={() => setActiveNav('billing')}>
              <i className="fas fa-receipt nav-icon"></i>
              <span>Billing</span>
            </Link>
          </li>
          <li>
            <Link to="/admin/reports" onClick={() => setActiveNav('reports')}>
              <i className="fas fa-chart-line nav-icon"></i>
              <span>Reports</span>
            </Link>
          </li>
          <li>
            <a href="/" onClick={(e) => { e.preventDefault(); handleLogout(); }} style={{ cursor: 'pointer' }}>
              <i className="fas fa-sign-out-alt nav-icon"></i>
              <span>Logout</span>
            </a>
          </li>
        </ul>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Dashboard</h1>
            <p className="welcome-message">Welcome back, Admin! Here's your clinic overview</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">A</div>
              <div className="user-details">
                <div className="user-name">Admin User</div>
                <div className="user-role">Analytics Admin</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <div className="filter-group">
            <label>Period:</label>
            <select className="filter-select">
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month" selected>This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Doctor:</label>
            <select className="filter-select">
              <option value="all">All Doctors</option>
              {doctorPerformance.map(doc => (
                <option key={doc.name} value={doc.name}>Dr. {doc.name}</option>
              ))}
            </select>
          </div>
          <button className="btn-apply" onClick={() => alert('Filters applied! (Demo)')}>Apply Filters</button>
        </div>

        {/* KPI Cards */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-value">{dashboardData.conversionRate}%</div>
            <div className="kpi-label">Conversion Rate</div>
            <div className="kpi-trend trend-up">Booking to Approval</div>
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

        {/* Analytics Overview Cards */}
        <div className="analytics-grid">
          <div className="analytics-card patients">
            <div className="analytics-header">
              <div>
                <div className="analytics-title">Total Patients</div>
                <div className="analytics-value">{dashboardData.totalPatients.toLocaleString()}</div>
                <div className={`analytics-trend ${dashboardData.patientGrowthRate >= 0 ? 'trend-up' : 'trend-down'}`}>
                  {dashboardData.patientGrowthRate >= 0 ? '↗' : '↘'} {Math.abs(dashboardData.patientGrowthRate)}% growth this month
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
                  {dashboardData.revenueGrowthRate >= 0 ? '↗' : '↘'} {Math.abs(dashboardData.revenueGrowthRate)}% from last month
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
                <div className="analytics-trend trend-up">↗ {dashboardData.conversionRate}% approval rate</div>
              </div>
              <div className="analytics-icon">📅</div>
            </div>
            <div className="analytics-detail">{dashboardData.todayAppointments} appointments scheduled today</div>
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
            <div className="analytics-detail">Average: 94 appointments/doctor</div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-header">
              <h3>📈 Revenue Trend (Last 6 Months)</h3>
            </div>
            <div className="chart-body">
              <canvas ref={revenueChartRef}></canvas>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>🦷 Top Performing Services</h3>
            </div>
            <div className="chart-body">
              <canvas ref={serviceChartRef}></canvas>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>📊 Appointment Distribution</h3>
            </div>
            <div className="chart-body">
              <canvas ref={appointmentChartRef}></canvas>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>👥 Patient Demographics</h3>
            </div>
            <div className="chart-body">
              <canvas ref={demographicsChartRef}></canvas>
            </div>
          </div>
        </div>

        {/* Performance Grid */}
        <div className="performance-grid">
          {/* Doctor Performance */}
          <div className="performance-card">
            <div className="performance-header">
              <h3>👨‍⚕️ Doctor Performance</h3>
            </div>
            <div className="performance-body">
              {doctorPerformance.map((doctor, idx) => (
                <div className="doctor-row" key={idx}>
                  <div className="doctor-avatar">{doctor.name.charAt(0)}</div>
                  <div className="doctor-info">
                    <div className="doctor-name">Dr. {doctor.name}</div>
                    <div className="doctor-specialty">{doctor.specialization}</div>
                    <div className="doctor-meta">Completion: {doctor.completion}% • Workload: {doctor.workload}%</div>
                  </div>
                  <div className="doctor-stats">
                    <div className="doctor-revenue">₱{doctor.revenue.toLocaleString()}</div>
                    <div className="doctor-appointments">{doctor.appointments} appts</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Service Performance */}
          <div className="performance-card">
            <div className="performance-header">
              <h3>🦷 Service Performance</h3>
            </div>
            <div className="performance-body">
              {servicePerformance.map((service, idx) => {
                const maxRevenue = Math.max(...servicePerformance.map(s => s.revenue));
                const percentage = (service.revenue / maxRevenue) * 100;
                return (
                  <div className="service-bar" key={idx}>
                    <div className="service-info">
                      <span className="service-name">{service.name}</span>
                      <span className="service-stats">₱{service.revenue.toLocaleString()} ({service.share}%)</span>
                    </div>
                    <div className="service-progress">
                      <div className="service-fill" style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Spending Patients */}
          <div className="performance-card">
            <div className="performance-header">
              <h3>💎 Top Spending Patients</h3>
            </div>
            <div className="performance-body">
              {topPatients.map((patient, idx) => (
                <div className="doctor-row" key={idx}>
                  <div className="doctor-avatar">{patient.name.charAt(0)}</div>
                  <div className="doctor-info">
                    <div className="doctor-name">{patient.name}</div>
                    <div className="doctor-specialty">{patient.appointments} appointments</div>
                  </div>
                  <div className="doctor-stats">
                    <div className="doctor-revenue">₱{patient.spent.toLocaleString()}</div>
                    <div className="doctor-appointments">Last: {new Date(patient.lastPayment).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Distribution */}
          <div className="performance-card">
            <div className="performance-header">
              <h3>💳 Payment Methods</h3>
            </div>
            <div className="performance-body">
              <canvas ref={paymentChartRef} style={{ height: '300px', width: '100%' }}></canvas>
            </div>
          </div>
        </div>

        {/* Recent Appointments Table */}
        <div className="recent-section">
          <div className="section-header">
            <h3>📋 Recent Appointments</h3>
            <Link to="/admin/appointments" className="view-all-link">View All →</Link>
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
                {recentAppointments.map((apt, idx) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Logout Overlay */}
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