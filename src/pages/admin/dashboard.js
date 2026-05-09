import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  const [revenueTrend, setRevenueTrend] = useState({ months: [], revenues: [], transactions: [] });
  const [servicePerformance, setServicePerformance] = useState([]);
  const [doctorPerformance, setDoctorPerformance] = useState([]);
  const [topPatients, setTopPatients] = useState([]);
  const [recentAppointments, setRecentAppointments] = useState([]);
  const [patientDemographics, setPatientDemographics] = useState([]);
  const [paymentDistribution, setPaymentDistribution] = useState([]);
  const [appointmentStats, setAppointmentStats] = useState([]);

  const revenueChartRef = useRef(null);
  const serviceChartRef = useRef(null);
  const appointmentChartRef = useRef(null);
  const demographicsChartRef = useRef(null);
  const paymentChartRef = useRef(null);
  const chartInstances = useRef({});
  const chartsInitialized = useRef(false);
  const isMounted = useRef(true);

  const SUPER_ADMIN_EMAIL = 'jhoncarl.jubilag@cvsu.edu.ph';
  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;

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
        revenueTrendResult,
        servicePerformanceResult,
        doctorPerformanceResult,
        topPatientsResult,
        recentAppointmentsResult,
        patientDemographicsResult,
        paymentDistributionResult,
        appointmentStatsResult,
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
        supabase.from('billing').select('amount_paid, payment_date').gte('payment_date', new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString()),
        supabase.from('services').select('*, appointments!left(service_id, appointment_id, billing!left(amount_paid))').eq('status', 'active'),
        supabase.from('doctors').select('*, appointments!left(doctor_id, appointment_id, status, billing!left(amount_paid))').eq('status', 'active'),
        supabase.from('patients').select('patient_id, first_name, last_name, appointments!left(patient_id, appointment_id, billing!left(amount_paid))').eq('status', 'active'),
        supabase.from('appointments').select('*, patients(first_name, last_name), doctors(first_name, last_name), services(service_name)').order('created_at', { ascending: false }).limit(10),
        supabase.from('patients').select('age'),
        supabase.from('billing').select('payment_method, amount_paid').not('payment_method', 'is', null),
        supabase.from('appointments').select('status'),
        supabase.from('patients').select('date_created').gte('date_created', new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString()),
        supabase.from('billing').select('amount_paid, payment_date').gte('payment_date', new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString())
      ]);

      if (!isMounted.current) return;

      const totalRevenue = revenueResult.data?.reduce((sum, item) => sum + (item.amount_paid || 0), 0) || 0;
      const todayRevenueVal = todayRevenueResult.data?.reduce((sum, item) => sum + (item.amount_paid || 0), 0) || 0;
      const avgRevenue = avgRevenueResult.data?.length ? totalRevenue / avgRevenueResult.data.length : 0;
      const totalOutstanding = outstandingResult.data?.reduce((sum, item) => sum + (item.balance || 0), 0) || 0;
      const unpaidInvoices = outstandingResult.data?.filter(item => item.balance > 0).length || 0;

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
        conversionRate: pendingAppointments ? ((totalAppointments - pendingAppointments) / totalAppointments * 100).toFixed(1) : 0,
        totalOutstanding: totalOutstanding,
        unpaidInvoices: unpaidInvoices,
        patientGrowthRate: calculateGrowthRate(growthRateResult.data),
        revenueGrowthRate: calculateRevenueGrowth(revenueGrowthResult.data)
      });

      if (revenueTrendResult.data) {
        const monthlyData = {};
        revenueTrendResult.data.forEach(item => {
          const month = new Date(item.payment_date).toLocaleString('default', { month: 'short', year: 'numeric' });
          if (!monthlyData[month]) {
            monthlyData[month] = { revenue: 0, transactions: 0 };
          }
          monthlyData[month].revenue += item.amount_paid || 0;
          monthlyData[month].transactions++;
        });
        const months = Object.keys(monthlyData).slice(-6);
        setRevenueTrend({
          months: months,
          revenues: months.map(m => monthlyData[m].revenue),
          transactions: months.map(m => monthlyData[m].transactions)
        });
      }

      if (servicePerformanceResult.data) {
        const services = servicePerformanceResult.data.map(service => {
          const bookings = service.appointments?.length || 0;
          const revenue = service.appointments?.reduce((sum, apt) => sum + (apt.billing?.[0]?.amount_paid || 0), 0) || 0;
          return {
            name: service.service_name,
            revenue: revenue,
            bookings: bookings,
            share: totalAppointments ? ((bookings / totalAppointments) * 100).toFixed(1) : 0
          };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
        setServicePerformance(services);
      }

      if (doctorPerformanceResult.data) {
        const doctors = doctorPerformanceResult.data.map(doctor => {
          const appointments = doctor.appointments || [];
          const completed = appointments.filter(a => a.status === 'done').length;
          const revenue = appointments.reduce((sum, apt) => sum + (apt.billing?.[0]?.amount_paid || 0), 0);
          return {
            name: `${doctor.first_name} ${doctor.last_name}`,
            specialization: doctor.specialization,
            revenue: revenue,
            appointments: appointments.length,
            completion: appointments.length ? (completed / appointments.length * 100).toFixed(1) : 0,
            workload: totalAppointments ? ((appointments.length / totalAppointments) * 100).toFixed(1) : 0
          };
        }).sort((a, b) => b.revenue - a.revenue);
        setDoctorPerformance(doctors);
      }

      if (topPatientsResult.data) {
        const patients = topPatientsResult.data.map(patient => {
          const appointments = patient.appointments || [];
          const spent = appointments.reduce((sum, apt) => sum + (apt.billing?.[0]?.amount_paid || 0), 0);
          const lastPayment = appointments
            .filter(a => a.billing?.[0]?.payment_date)
            .sort((a, b) => new Date(b.billing?.[0]?.payment_date) - new Date(a.billing?.[0]?.payment_date))[0]?.billing?.[0]?.payment_date;
          return {
            name: `${patient.first_name} ${patient.last_name}`,
            appointments: appointments.length,
            spent: spent,
            lastPayment: lastPayment
          };
        }).filter(p => p.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 8);
        setTopPatients(patients);
      }

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

      if (patientDemographicsResult.data) {
        const ageGroups = { 'Under 18': 0, '18-30': 0, '31-50': 0, '50+': 0 };
        patientDemographicsResult.data.forEach(p => {
          if (p.age < 18) ageGroups['Under 18']++;
          else if (p.age <= 30) ageGroups['18-30']++;
          else if (p.age <= 50) ageGroups['31-50']++;
          else if (p.age > 50) ageGroups['50+']++;
        });
        const total = Object.values(ageGroups).reduce((a, b) => a + b, 0);
        const demographics = Object.entries(ageGroups).map(([group, count]) => ({
          group,
          count,
          percentage: total ? ((count / total) * 100).toFixed(1) : 0
        }));
        setPatientDemographics(demographics);
      }

      if (paymentDistributionResult.data) {
        const payments = {};
        paymentDistributionResult.data.forEach(p => {
          if (!payments[p.payment_method]) {
            payments[p.payment_method] = { amount: 0, transactions: 0 };
          }
          payments[p.payment_method].amount += p.amount_paid || 0;
          payments[p.payment_method].transactions++;
        });
        const totalAmount = Object.values(payments).reduce((sum, p) => sum + p.amount, 0);
        const distribution = Object.entries(payments).map(([method, data]) => ({
          method,
          amount: data.amount,
          transactions: data.transactions,
          percentage: totalAmount ? ((data.amount / totalAmount) * 100).toFixed(1) : 0
        })).sort((a, b) => b.amount - a.amount);
        setPaymentDistribution(distribution);
      }

      if (appointmentStatsResult.data) {
        const stats = {};
        appointmentStatsResult.data.forEach(a => {
          stats[a.status] = (stats[a.status] || 0) + 1;
        });
        const statsArray = Object.entries(stats).map(([status, count]) => ({ status, count }));
        setAppointmentStats(statsArray);
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

  const initCharts = useCallback(async () => {
    if (loading || chartsInitialized.current) return;
    
    try {
      const Chart = (await import('chart.js')).default;
      chartsInitialized.current = true;
      
      Object.values(chartInstances.current).forEach(chart => {
        if (chart) chart.destroy();
      });

      if (revenueChartRef.current && revenueTrend.months.length) {
        chartInstances.current.revenue = new Chart(revenueChartRef.current, {
          type: 'line',
          data: {
            labels: revenueTrend.months,
            datasets: [
              { label: 'Revenue (₱)', data: revenueTrend.revenues, borderColor: '#354D70', backgroundColor: 'rgba(53, 77, 112, 0.1)', borderWidth: 3, fill: true, tension: 0.4, yAxisID: 'y' },
              { label: 'Transactions', data: revenueTrend.transactions, borderColor: '#4d83d4', backgroundColor: 'rgba(77, 131, 212, 0.1)', borderWidth: 2, fill: false, tension: 0.4, yAxisID: 'y1' }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() } }, y1: { position: 'right', grid: { drawOnChartArea: false } } }
          }
        });
      }

      if (serviceChartRef.current && servicePerformance.length) {
        chartInstances.current.service = new Chart(serviceChartRef.current, {
          type: 'bar',
          data: { labels: servicePerformance.map(s => s.name), datasets: [{ label: 'Revenue (₱)', data: servicePerformance.map(s => s.revenue), backgroundColor: 'rgba(53, 77, 112, 0.8)', borderWidth: 1 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() } } } }
        });
      }

      if (appointmentChartRef.current && appointmentStats.length) {
        chartInstances.current.appointment = new Chart(appointmentChartRef.current, {
          type: 'doughnut',
          data: { labels: appointmentStats.map(s => s.status.toUpperCase()), datasets: [{ data: appointmentStats.map(s => s.count), backgroundColor: ['#ffc107', '#28a745', '#dc3545', '#17a2b8'], borderWidth: 2, borderColor: '#fff' }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '70%' }
        });
      }

      if (demographicsChartRef.current && patientDemographics.length) {
        chartInstances.current.demographics = new Chart(demographicsChartRef.current, {
          type: 'pie',
          data: { labels: patientDemographics.map(d => d.group), datasets: [{ data: patientDemographics.map(d => d.count), backgroundColor: ['rgba(102, 126, 234, 0.8)', 'rgba(240, 147, 251, 0.8)', 'rgba(79, 172, 254, 0.8)', 'rgba(67, 233, 123, 0.8)'], borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
      }

      if (paymentChartRef.current && paymentDistribution.length) {
        chartInstances.current.payment = new Chart(paymentChartRef.current, {
          type: 'polarArea',
          data: { labels: paymentDistribution.map(p => p.method.toUpperCase()), datasets: [{ data: paymentDistribution.map(p => p.amount), backgroundColor: ['rgba(53, 77, 112, 0.8)', 'rgba(77, 131, 212, 0.8)', 'rgba(102, 126, 234, 0.8)', 'rgba(240, 147, 251, 0.8)'], borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
      }
    } catch (error) {
      console.error('Error loading Chart.js:', error);
    }
  }, [loading, revenueTrend, servicePerformance, appointmentStats, patientDemographics, paymentDistribution]);

  useEffect(() => {
    if (authChecked && user && (userType === 'admin' || isSuperAdmin)) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user, userType, isSuperAdmin]);

  useEffect(() => {
    if (!loading && !chartsInitialized.current && revenueTrend.months.length) {
      initCharts();
    }
  }, [loading, initCharts, revenueTrend.months.length]);

  useEffect(() => {
    const currentCharts = chartInstances.current;
    return () => {
      Object.values(currentCharts).forEach(chart => {
        if (chart && typeof chart.destroy === 'function') {
          chart.destroy();
        }
      });
      chartsInitialized.current = false;
    };
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

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

  if (!user || (userType !== 'admin' && !isSuperAdmin)) {
    return null;
  }

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

        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-value">{dashboardData.conversionRate}%</div><div className="kpi-label">Conversion Rate</div><div className="kpi-trend trend-up">Booking to Approval</div></div>
          <div className="kpi-card"><div className="kpi-value">₱{dashboardData.avgRevenuePerAppointment.toLocaleString()}</div><div className="kpi-label">Avg. Revenue/Visit</div></div>
          <div className="kpi-card"><div className="kpi-value">{dashboardData.todayAppointments}</div><div className="kpi-label">Today's Appointments</div><div className="kpi-trend">{dashboardData.pendingAppointments} pending</div></div>
          <div className="kpi-card"><div className="kpi-value">₱{dashboardData.totalOutstanding.toLocaleString()}</div><div className="kpi-label">Outstanding Balance</div><div className="kpi-trend trend-down">{dashboardData.unpaidInvoices} invoices</div></div>
        </div>

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
            <div className="analytics-detail">Average: {doctorPerformance.length ? (doctorPerformance.reduce((sum, d) => sum + d.appointments, 0) / doctorPerformance.length).toFixed(1) : 0} appointments/doctor</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-card"><div className="chart-header"><h3>📈 Revenue Trend (Last 6 Months)</h3></div><div className="chart-body"><canvas ref={revenueChartRef}></canvas></div></div>
          <div className="chart-card"><div className="chart-header"><h3>🦷 Top Performing Services</h3></div><div className="chart-body"><canvas ref={serviceChartRef}></canvas></div></div>
          <div className="chart-card"><div className="chart-header"><h3>📊 Appointment Distribution</h3></div><div className="chart-body"><canvas ref={appointmentChartRef}></canvas></div></div>
          <div className="chart-card"><div className="chart-header"><h3>👥 Patient Demographics</h3></div><div className="chart-body"><canvas ref={demographicsChartRef}></canvas></div></div>
        </div>

        <div className="performance-grid">
          <div className="performance-card"><div className="performance-header"><h3>👨‍⚕️ Doctor Performance</h3></div><div className="performance-body">{doctorPerformance.map((doctor, idx) => (<div className="doctor-row" key={idx}><div className="doctor-avatar">{doctor.name.charAt(0)}</div><div className="doctor-info"><div className="doctor-name">Dr. {doctor.name}</div><div className="doctor-specialty">{doctor.specialization}</div><div className="doctor-meta">Completion: {doctor.completion}% • Workload: {doctor.workload}%</div></div><div className="doctor-stats"><div className="doctor-revenue">₱{doctor.revenue.toLocaleString()}</div><div className="doctor-appointments">{doctor.appointments} appts</div></div></div>))}</div></div>
          <div className="performance-card"><div className="performance-header"><h3>🦷 Service Performance</h3></div><div className="performance-body">{servicePerformance.map((service, idx) => { const maxRevenue = Math.max(...servicePerformance.map(s => s.revenue)); const percentage = (service.revenue / maxRevenue) * 100; return (<div className="service-bar" key={idx}><div className="service-info"><span className="service-name">{service.name}</span><span className="service-stats">₱{service.revenue.toLocaleString()} ({service.share}%)</span></div><div className="service-progress"><div className="service-fill" style={{ width: `${percentage}%` }}></div></div></div>); })}</div></div>
          <div className="performance-card"><div className="performance-header"><h3>💎 Top Spending Patients</h3></div><div className="performance-body">{topPatients.map((patient, idx) => (<div className="doctor-row" key={idx}><div className="doctor-avatar">{patient.name.charAt(0)}</div><div className="doctor-info"><div className="doctor-name">{patient.name}</div><div className="doctor-specialty">{patient.appointments} appointments</div></div><div className="doctor-stats"><div className="doctor-revenue">₱{patient.spent.toLocaleString()}</div><div className="doctor-appointments">Last: {patient.lastPayment ? new Date(patient.lastPayment).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}</div></div></div>))}</div></div>
          <div className="performance-card"><div className="performance-header"><h3>💳 Payment Methods</h3></div><div className="performance-body"><canvas ref={paymentChartRef} style={{ height: '300px', width: '100%' }}></canvas></div></div>
        </div>

        <div className="recent-section">
          <div className="section-header">
            <h3>📋 Recent Appointments</h3>
            <button className="view-all-link" onClick={() => alert('View All Appointments (Coming Soon)')}>View All →</button>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr><th>Patient</th><th>Doctor</th><th>Service</th><th>Date/Time</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentAppointments.map((apt, idx) => (
                  <tr key={idx}>
                    <td>{apt.patient}</td>
                    <td>{apt.doctor}</td>
                    <td>{apt.service}</td>
                    <td>{new Date(apt.datetime).toLocaleString()}</td>
                    <td><span className={`status-badge status-${apt.status}`}>{apt.status.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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