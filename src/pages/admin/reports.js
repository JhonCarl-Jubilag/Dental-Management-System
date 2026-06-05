import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  Filler,
  RadialLinearScale,
} from 'chart.js';
import { Bar, Line, Doughnut, Pie, Radar } from 'react-chartjs-2';
import './reports.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  Filler,
  RadialLinearScale
);

const Reports = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Report filters
  const [reportType, setReportType] = useState('financial');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [doctorId, setDoctorId] = useState('all');
  const [doctors, setDoctors] = useState([]);

  // Report data states (unchanged)
  const [overallStats, setOverallStats] = useState({ periodRevenue: 0, periodAppointments: 0, totalPatients: 0, totalDoctors: 0 });
  const [financialData, setFinancialData] = useState({
    summary: { totalRevenue: 0, totalDiscount: 0, totalCollected: 0, totalOutstanding: 0 },
    paymentMethods: [],
    serviceRevenue: [],
    dailyRevenue: [],
    topPatients: [],
  });
  const [appointmentData, setAppointmentData] = useState({
    summary: { totalAppointments: 0, pending: 0, approved: 0, cancelled: 0, done: 0, successRate: 0 },
    byDay: [],
    byTime: [],
    doctorLoad: [],
    cancellations: [],
  });
  const [patientData, setPatientData] = useState({
    demographics: [],
    newPatients: [],
    frequentVisitors: [],
    serviceByAge: [],
  });
  const [doctorPerformanceData, setDoctorPerformanceData] = useState({
    performance: [],
    satisfaction: [],
  });

  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';

  const reportContentRef = useRef(null);

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'admin' && !isSuperAdmin) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  // Fetch doctors for filter
  useEffect(() => {
    const fetchDoctors = async () => {
      const { data, error } = await supabase
        .from('doctors')
        .select('doctor_id, first_name, last_name')
        .eq('status', 'active')
        .order('last_name');
      if (!error) setDoctors(data || []);
    };
    fetchDoctors();
  }, []);

  const getDateParams = useCallback(() => {
    const params = { start_date: startDate, end_date: endDate };
    if (doctorId !== 'all') params.doctor_id = parseInt(doctorId);
    return params;
  }, [startDate, endDate, doctorId]);

  // Data fetching functions
  const fetchOverallStats = useCallback(async () => {
    const { start_date, end_date, doctor_id } = getDateParams();
    try {
      const { count: totalPatients } = await supabase.from('patients').select('*', { count: 'exact', head: true }).eq('status', 'active');
      const { count: totalDoctors } = await supabase.from('doctors').select('*', { count: 'exact', head: true }).eq('status', 'active');
      let revenueQuery = supabase.from('billing').select('amount_paid').gte('created_at', `${start_date} 00:00:00`).lte('created_at', `${end_date} 23:59:59`);
      if (doctor_id) revenueQuery = revenueQuery.eq('doctor_id', doctor_id);
      const { data: revenueData } = await revenueQuery;
      const periodRevenue = revenueData?.reduce((sum, item) => sum + (item.amount_paid || 0), 0) || 0;
      let apptQuery = supabase.from('appointments').select('appointment_id', { count: 'exact', head: true }).gte('appointment_datetime', `${start_date} 00:00:00`).lte('appointment_datetime', `${end_date} 23:59:59`);
      if (doctor_id) apptQuery = apptQuery.eq('doctor_id', doctor_id);
      const { count: periodAppointments } = await apptQuery;
      setOverallStats({ periodRevenue, periodAppointments: periodAppointments || 0, totalPatients: totalPatients || 0, totalDoctors: totalDoctors || 0 });
    } catch (err) {
      console.error(err);
    }
  }, [getDateParams]);

  const fetchFinancialReport = useCallback(async () => {
    const { start_date, end_date, doctor_id } = getDateParams();
    let summaryQuery = supabase.from('billing').select('total_amount, discount, amount_paid, balance').gte('created_at', `${start_date} 00:00:00`).lte('created_at', `${end_date} 23:59:59`);
    if (doctor_id) summaryQuery = summaryQuery.eq('doctor_id', doctor_id);
    const { data: billingData } = await summaryQuery;
    const summary = {
      totalRevenue: billingData?.reduce((s, b) => s + (b.total_amount || 0), 0) || 0,
      totalDiscount: billingData?.reduce((s, b) => s + (b.discount || 0), 0) || 0,
      totalCollected: billingData?.reduce((s, b) => s + (b.amount_paid || 0), 0) || 0,
      totalOutstanding: billingData?.reduce((s, b) => s + (b.balance || 0), 0) || 0,
    };
    let paymentQuery = supabase.from('billing').select('payment_method, amount_paid').not('payment_method', 'is', null).gte('created_at', `${start_date} 00:00:00`).lte('created_at', `${end_date} 23:59:59`);
    if (doctor_id) paymentQuery = paymentQuery.eq('doctor_id', doctor_id);
    const { data: paymentData } = await paymentQuery;
    const paymentMap = {};
    let totalPayments = 0;
    paymentData?.forEach(p => {
      const method = p.payment_method;
      if (!paymentMap[method]) paymentMap[method] = { total: 0, count: 0 };
      paymentMap[method].total += p.amount_paid || 0;
      paymentMap[method].count++;
      totalPayments += p.amount_paid || 0;
    });
    const paymentMethods = Object.entries(paymentMap).map(([method, data]) => ({
      payment_method: method,
      total_amount: data.total,
      transaction_count: data.count,
      percentage: totalPayments ? ((data.total / totalPayments) * 100).toFixed(1) : 0,
    }));
    let serviceQuery = supabase
      .from('appointments')
      .select('service_id, services!inner(service_name), billing!inner(amount_paid)')
      .gte('appointment_datetime', `${start_date} 00:00:00`)
      .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) serviceQuery = serviceQuery.eq('doctor_id', doctor_id);
    const { data: serviceData } = await serviceQuery;
    const serviceMap = {};
    let totalAppointments = 0;
    serviceData?.forEach(a => {
      const name = a.services.service_name;
      if (!serviceMap[name]) serviceMap[name] = { count: 0, revenue: 0 };
      serviceMap[name].count++;
      serviceMap[name].revenue += a.billing?.amount_paid || 0;
      totalAppointments++;
    });
    const serviceRevenue = Object.entries(serviceMap).map(([name, data]) => ({
      service_name: name,
      appointment_count: data.count,
      total_revenue: data.revenue,
      avg_revenue_per_appointment: data.count ? data.revenue / data.count : 0,
      service_share: totalAppointments ? ((data.count / totalAppointments) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.total_revenue - a.total_revenue);
    let dailyQuery = supabase
      .from('billing')
      .select('created_at, amount_paid')
      .gte('created_at', `${start_date} 00:00:00`)
      .lte('created_at', `${end_date} 23:59:59`);
    if (doctor_id) dailyQuery = dailyQuery.eq('doctor_id', doctor_id);
    const { data: dailyData } = await dailyQuery;
    const dailyMap = {};
    dailyData?.forEach(d => {
      const date = d.created_at.split('T')[0];
      if (!dailyMap[date]) dailyMap[date] = { revenue: 0, transactions: 0 };
      dailyMap[date].revenue += d.amount_paid || 0;
      dailyMap[date].transactions++;
    });
    const dailyRevenue = Object.entries(dailyMap).map(([date, data]) => ({ date, daily_revenue: data.revenue, transactions: data.transactions })).sort((a, b) => a.date.localeCompare(b.date));
    let topQuery = supabase
      .from('billing')
      .select('patient_id, patients!inner(first_name, last_name, contact_no), amount_paid, payment_date')
      .gte('created_at', `${start_date} 00:00:00`)
      .lte('created_at', `${end_date} 23:59:59`);
    if (doctor_id) topQuery = topQuery.eq('doctor_id', doctor_id);
    const { data: topData } = await topQuery;
    const patientMap = {};
    topData?.forEach(p => {
      const id = p.patient_id;
      if (!patientMap[id]) {
        patientMap[id] = {
          patient_name: `${p.patients.first_name} ${p.patients.last_name}`,
          contact_no: p.patients.contact_no,
          total_spent: 0,
          total_transactions: 0,
          last_payment_date: null,
        };
      }
      patientMap[id].total_spent += p.amount_paid || 0;
      patientMap[id].total_transactions++;
      if (p.payment_date && (!patientMap[id].last_payment_date || p.payment_date > patientMap[id].last_payment_date)) {
        patientMap[id].last_payment_date = p.payment_date;
      }
    });
    const topPatients = Object.values(patientMap).sort((a, b) => b.total_spent - a.total_spent).slice(0, 10);
    setFinancialData({ summary, paymentMethods, serviceRevenue, dailyRevenue, topPatients });
  }, [getDateParams]);

  const fetchAppointmentReport = useCallback(async () => {
    const { start_date, end_date, doctor_id } = getDateParams();
    let query = supabase
        .from('appointments')
        .select('status, appointment_datetime, created_at, doctor_id, doctors!inner(first_name, last_name, specialization), patients!inner(first_name, last_name), remarks')
        .gte('appointment_datetime', `${start_date} 00:00:00`)
        .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) query = query.eq('doctor_id', doctor_id);
    const { data: appointments } = await query;
    const total = appointments?.length || 0;
    const statusCount = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
    appointments?.forEach(a => { if (statusCount[a.status] !== undefined) statusCount[a.status]++; });
    const successRate = total ? (((statusCount.confirmed + statusCount.completed) / total) * 100).toFixed(1) : 0;
    const summary = {
        total_appointments: total,
        pending_count: statusCount.pending,
        approved_count: statusCount.confirmed,
        cancelled_count: statusCount.cancelled,
        done_count: statusCount.completed,
        success_rate: successRate,
    };
    const dayMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    appointments?.forEach(a => { const day = new Date(a.appointment_datetime).toLocaleDateString('en-US', { weekday: 'long' }); dayMap[day]++; });
    const byDay = Object.entries(dayMap).map(([day, count]) => ({ day_name: day, appointment_count: count, day_order: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(day) + 1 })).sort((a, b) => a.day_order - b.day_order);
    const timeMap = { 'Morning (9AM-12PM)': 0, 'Afternoon (12PM-3PM)': 0, 'Evening (3PM-6PM)': 0 };
    appointments?.forEach(a => { const hour = new Date(a.appointment_datetime).getHours(); if (hour < 12) timeMap['Morning (9AM-12PM)']++; else if (hour < 15) timeMap['Afternoon (12PM-3PM)']++; else timeMap['Evening (3PM-6PM)']++; });
    const byTime = Object.entries(timeMap).map(([slot, count]) => ({ time_slot: slot, appointment_count: count, percentage: total ? ((count / total) * 100).toFixed(1) : 0 }));
    const doctorMap = {};
    appointments?.forEach(a => {
        const docId = a.doctor_id;
        if (!doctorMap[docId]) {
        doctorMap[docId] = {
            doctor_name: `Dr. ${a.doctors.first_name} ${a.doctors.last_name}`,
            specialization: a.doctors.specialization,
            total_appointments: 0,
            completed_count: 0,
            cancelled_count: 0,
        };
        }
        doctorMap[docId].total_appointments++;
        if (a.status === 'completed') doctorMap[docId].completed_count++;
        if (a.status === 'cancelled') doctorMap[docId].cancelled_count++;
    });
    const doctorLoad = Object.values(doctorMap).map(d => ({ ...d, completion_rate: d.total_appointments ? ((d.completed_count / d.total_appointments) * 100).toFixed(1) : 0 })).sort((a, b) => b.total_appointments - a.total_appointments);
    const cancellations = appointments?.filter(a => a.status === 'cancelled').slice(0, 20).map(a => ({
        appointment_date: a.appointment_datetime.split('T')[0],
        days_between: Math.floor((new Date(a.appointment_datetime) - new Date(a.created_at)) / (1000 * 60 * 60 * 24)),
        patient_fname: a.patients.first_name,
        patient_lname: a.patients.last_name,
        doctor_fname: a.doctors.first_name,
        doctor_lname: a.doctors.last_name,
        remarks: a.remarks,
    })) || [];
    setAppointmentData({ summary, byDay, byTime, doctorLoad, cancellations });
    }, [getDateParams]);

  const fetchPatientReport = useCallback(async () => {
    const { start_date, end_date, doctor_id } = getDateParams();
    let patientQuery = supabase
      .from('appointments')
      .select('patients!inner(age)')
      .gte('appointment_datetime', `${start_date} 00:00:00`)
      .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) patientQuery = patientQuery.eq('doctor_id', doctor_id);
    const { data: patientAgeData } = await patientQuery;
    const ageGroups = { 'Under 18': 0, '18-30': 0, '31-50': 0, 'Over 50': 0, 'Not Specified': 0 };
    let totalAgeCount = 0;
    patientAgeData?.forEach(p => {
      const age = p.patients.age;
      if (age === null || age === undefined) ageGroups['Not Specified']++;
      else if (age < 18) ageGroups['Under 18']++;
      else if (age <= 30) ageGroups['18-30']++;
      else if (age <= 50) ageGroups['31-50']++;
      else ageGroups['Over 50']++;
      totalAgeCount++;
    });
    const demographics = Object.entries(ageGroups).map(([group, count]) => ({ age_group: group, patient_count: count, percentage: totalAgeCount ? ((count / totalAgeCount) * 100).toFixed(1) : 0, avg_age: null }));
    let newPatientQuery = supabase.from('patients').select('date_created').gte('date_created', `${start_date} 00:00:00`).lte('date_created', `${end_date} 23:59:59`);
    const { data: newPatientsData } = await newPatientQuery;
    const newByMonth = {};
    newPatientsData?.forEach(p => { const month = p.date_created.slice(0, 7); if (!newByMonth[month]) newByMonth[month] = { new_patients: 0, verified_patients: 0 }; newByMonth[month].new_patients++; });
    const newPatients = Object.entries(newByMonth).map(([month, data]) => ({ month, new_patients: data.new_patients, verified_patients: data.verified_patients })).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
    let visitQuery = supabase
      .from('appointments')
      .select('patient_id, patients!inner(first_name, last_name, contact_no), appointment_datetime')
      .gte('appointment_datetime', `${start_date} 00:00:00`)
      .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) visitQuery = visitQuery.eq('doctor_id', doctor_id);
    const { data: visits } = await visitQuery;
    const patientVisits = {};
    visits?.forEach(v => {
      const id = v.patient_id;
      if (!patientVisits[id]) patientVisits[id] = { patient_name: `${v.patients.first_name} ${v.patients.last_name}`, contact_no: v.patients.contact_no, visits: [] };
      patientVisits[id].visits.push(new Date(v.appointment_datetime));
    });
    const frequentVisitors = Object.values(patientVisits).map(p => {
      const sorted = p.visits.sort((a, b) => a - b);
      const firstVisit = sorted[0];
      const lastVisit = sorted[sorted.length - 1];
      let avgDays = 0;
      if (sorted.length > 1) {
        let totalDays = 0;
        for (let i = 1; i < sorted.length; i++) totalDays += (sorted[i] - sorted[i-1]) / (1000 * 60 * 60 * 24);
        avgDays = totalDays / (sorted.length - 1);
      }
      return {
        patient_name: p.patient_name,
        contact_no: p.contact_no,
        total_visits: sorted.length,
        first_visit: firstVisit.toISOString().split('T')[0],
        last_visit: lastVisit.toISOString().split('T')[0],
        avg_days_between_visits: avgDays,
      };
    }).sort((a, b) => b.total_visits - a.total_visits).slice(0, 15);
    let serviceAgeQuery = supabase
      .from('appointments')
      .select('service_id, services!inner(service_name), patients!inner(age)')
      .gte('appointment_datetime', `${start_date} 00:00:00`)
      .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) serviceAgeQuery = serviceAgeQuery.eq('doctor_id', doctor_id);
    const { data: serviceAgeData } = await serviceAgeQuery;
    const serviceAgeMap = {};
    serviceAgeData?.forEach(s => {
      const service = s.services.service_name;
      let ageGroup = 'Not Specified';
      const age = s.patients.age;
      if (age !== null && age !== undefined) {
        if (age < 18) ageGroup = 'Under 18';
        else if (age <= 30) ageGroup = '18-30';
        else if (age <= 50) ageGroup = '31-50';
        else ageGroup = 'Over 50';
      }
      const key = `${service}|${ageGroup}`;
      if (!serviceAgeMap[key]) serviceAgeMap[key] = { service_name: service, age_group: ageGroup, appointment_count: 0 };
      serviceAgeMap[key].appointment_count++;
    });
    const serviceByAge = Object.values(serviceAgeMap);
    setPatientData({ demographics, newPatients, frequentVisitors, serviceByAge });
  }, [getDateParams]);

  const fetchDoctorPerformanceReport = useCallback(async () => {
    const { start_date, end_date, doctor_id } = getDateParams();
    let apptQuery = supabase
        .from('appointments')
        .select('appointment_id, doctor_id, status, doctors!inner(first_name, last_name, specialization, email, contact_no)')
        .gte('appointment_datetime', `${start_date} 00:00:00`)
        .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) apptQuery = apptQuery.eq('doctor_id', doctor_id);
    const { data: appointments } = await apptQuery;
    let revenueQuery = supabase
        .from('appointments')
        .select('doctor_id, billing!left(amount_paid)')
        .gte('appointment_datetime', `${start_date} 00:00:00`)
        .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) revenueQuery = revenueQuery.eq('doctor_id', doctor_id);
    const { data: revenueData } = await revenueQuery;
    const doctorMap = {};
    appointments?.forEach(a => {
        const docId = a.doctor_id;
        if (!doctorMap[docId]) {
        doctorMap[docId] = {
            doctor_name: `Dr. ${a.doctors.first_name} ${a.doctors.last_name}`,
            specialization: a.doctors.specialization,
            email: a.doctors.email,
            contact_no: a.doctors.contact_no,
            total_appointments: 0,
            completed_appointments: 0,
            cancelled_appointments: 0,
            total_revenue_generated: 0,
        };
        }
        doctorMap[docId].total_appointments++;
        if (a.status === 'completed') doctorMap[docId].completed_appointments++;
        if (a.status === 'cancelled') doctorMap[docId].cancelled_appointments++;
    });
    revenueData?.forEach(item => {
        const docId = item.doctor_id;
        if (doctorMap[docId]) doctorMap[docId].total_revenue_generated += item.billing?.amount_paid || 0;
    });
    const performance = Object.values(doctorMap).map(d => ({
        ...d,
        avg_revenue_per_appointment: d.total_appointments ? d.total_revenue_generated / d.total_appointments : 0,
        completion_rate: d.total_appointments ? ((d.completed_appointments / d.total_appointments) * 100).toFixed(1) : 0,
        cancellation_rate: d.total_appointments ? ((d.cancelled_appointments / d.total_appointments) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.total_revenue_generated - a.total_revenue_generated);
    let repeatQuery = supabase
        .from('appointments')
        .select('doctor_id, patient_id, doctors!inner(first_name, last_name)')
        .gte('appointment_datetime', `${start_date} 00:00:00`)
        .lte('appointment_datetime', `${end_date} 23:59:59`);
    if (doctor_id) repeatQuery = repeatQuery.eq('doctor_id', doctor_id);
    const { data: repeatData } = await repeatQuery;
    const repeatMap = {};
    repeatData?.forEach(a => {
        const docId = a.doctor_id;
        if (!repeatMap[docId]) {
        repeatMap[docId] = {
            doctor_name: `Dr. ${a.doctors.first_name} ${a.doctors.last_name}`,
            patients: new Set(),
            appointments: 0,
            repeatPatients: new Set(),
        };
        }
        repeatMap[docId].patients.add(a.patient_id);
        repeatMap[docId].appointments++;
    });
    const patientCountMap = {};
    repeatData?.forEach(a => { const key = `${a.doctor_id}|${a.patient_id}`; patientCountMap[key] = (patientCountMap[key] || 0) + 1; });
    repeatData?.forEach(a => {
        const key = `${a.doctor_id}|${a.patient_id}`;
        if (patientCountMap[key] > 1) repeatMap[a.doctor_id].repeatPatients.add(a.patient_id);
    });
    const satisfaction = Object.values(repeatMap).map(d => ({
        doctor_name: d.doctor_name,
        unique_patients: d.patients.size,
        total_appointments: d.appointments,
        avg_appointments_per_patient: d.patients.size ? (d.appointments / d.patients.size).toFixed(2) : 0,
        repeat_patients: d.repeatPatients.size,
        repeat_rate: d.patients.size ? ((d.repeatPatients.size / d.patients.size) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.repeat_rate - a.repeat_rate);
    setDoctorPerformanceData({ performance, satisfaction });
    }, [getDateParams]);

  // Main fetch depending on report type
  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      await fetchOverallStats();
      if (reportType === 'financial') {
        await fetchFinancialReport();
      } else if (reportType === 'appointments') {
        await fetchAppointmentReport();
      } else if (reportType === 'patients') {
        await fetchPatientReport();
      } else if (reportType === 'doctors') {
        await fetchDoctorPerformanceReport();
      }
    } catch (err) {
      console.error(err);
      toast.error('Error loading report data');
    } finally {
      setLoading(false);
    }
  }, [reportType, fetchOverallStats, fetchFinancialReport, fetchAppointmentReport, fetchPatientReport, fetchDoctorPerformanceReport]);

  useEffect(() => {
    if (user && (userType === 'admin' || isSuperAdmin)) {
      fetchAllData();
    }
  }, [fetchAllData, user, userType, isSuperAdmin]);

  const formatCurrency = (amount) => `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const generatePDF = async () => {
    if (!reportContentRef.current) return;
    setGeneratingPdf(true);
    try {
      const element = reportContentRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        logging: false,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      //A4 Size 
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      if (imgHeight > pageHeight) {
        let heightLeft = imgHeight - pageHeight;
        while (heightLeft > 0) {
          position = position - pageHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }
      }
      const reportTitle = reportType === 'financial' ? 'Financial Report' : reportType === 'appointments' ? 'Appointment Report' : reportType === 'patients' ? 'Patient Report' : 'Doctor Performance Report';
      pdf.setProperties({
        title: `${reportTitle} - ${startDate} to ${endDate}`,
        subject: 'Clinic Analytics Report',
        author: 'Fifthcusp Dental Clinic',
        keywords: 'report, analytics, dental clinic',
        creator: 'Fifthcusp System',
      });
      pdf.save(`Fifthcusp_${reportTitle}_${startDate}_to_${endDate}.pdf`);
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleResetFilters = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setStartDate(d.toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setDoctorId('all');
    setReportType('financial');
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
        <p>Loading authentication...</p>
      </div>
    );
  }

  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  const chartOptions = { responsive: true, maintainAspectRatio: false };
  const barOptions = { ...chartOptions, scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } } };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <Sidebar onLogout={handleLogout} />
        <div className="main-content reports-page">
          <div className="admin-loading">
            <div className="loading-spinner"></div>
            <p>Loading report data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />

      <div className="main-content reports-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Reports & Analytics</h1>
            <p className="welcome-message">Comprehensive insights for your dental clinic</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">{adminInitial}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">Reports Administrator</div>
              </div>
            </div>
          </div>
        </div>

        <div className="report-filters">
          <div className="filter-grid">
            <div className="filter-group">
              <label>Report Type</label>
              <select className="form-control" value={reportType} onChange={e => setReportType(e.target.value)}>
                <option value="financial">Financial Reports</option>
                <option value="appointments">Appointment Reports</option>
                <option value="patients">Patient Reports</option>
                <option value="doctors">Doctor Performance</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Start Date</label>
              <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="filter-group">
              <label>End Date</label>
              <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="filter-group">
              <label>Doctor Filter</label>
              <select className="form-control" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="all">All Doctors</option>
                {doctors.map(doc => (
                  <option key={doc.doctor_id} value={doc.doctor_id}>
                    Dr. {doc.first_name} {doc.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="filter-actions">
            <button className="btn btn-primary" onClick={fetchAllData} disabled={loading}>
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
            <button className="btn btn-success" onClick={generatePDF} disabled={generatingPdf}>
              {generatingPdf ? 'Generating PDF...' : '📄 Generate PDF'}
            </button>
            <button className="btn btn-secondary" onClick={handleResetFilters}>Reset Filters</button>
          </div>
        </div>

        {/* Report Content - this div will be captured for PDF */}
        <div ref={reportContentRef} className="report-content-for-pdf">
          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="summary-card"><div className="summary-value">{formatCurrency(overallStats.periodRevenue)}</div><div className="summary-label">Period Revenue</div></div>
            <div className="summary-card"><div className="summary-value">{overallStats.periodAppointments}</div><div className="summary-label">Appointments</div></div>
            <div className="summary-card"><div className="summary-value">{overallStats.totalPatients}</div><div className="summary-label">Total Patients</div></div>
            <div className="summary-card"><div className="summary-value">{overallStats.totalDoctors}</div><div className="summary-label">Active Doctors</div></div>
          </div>

          {/* Financial Reports */}
          {reportType === 'financial' && (
            <div className="report-section">
              <div className="section-header"><h3>💰 Financial Summary</h3></div>
              <div className="section-body">
                <div className="stats-grid">
                  <div className="stat-item"><span className="stat-label">Total Revenue</span><span className="stat-value">{formatCurrency(financialData.summary.totalRevenue)}</span></div>
                  <div className="stat-item"><span className="stat-label">Total Discounts</span><span className="stat-value">{formatCurrency(financialData.summary.totalDiscount)}</span></div>
                  <div className="stat-item"><span className="stat-label">Amount Collected</span><span className="stat-value">{formatCurrency(financialData.summary.totalCollected)}</span></div>
                  <div className="stat-item"><span className="stat-label">Outstanding Balance</span><span className="stat-value">{formatCurrency(financialData.summary.totalOutstanding)}</span></div>
                </div>
                <div className="charts-grid">
                  <div className="chart-container">
                    {financialData.dailyRevenue.length > 0 && (
                      <Line
                        data={{
                          labels: financialData.dailyRevenue.map(d => d.date),
                          datasets: [{ label: 'Daily Revenue', data: financialData.dailyRevenue.map(d => d.daily_revenue), borderColor: '#354D70', backgroundColor: 'rgba(53,77,112,0.1)', fill: true, tension: 0.4 }]
                        }}
                        options={barOptions}
                      />
                    )}
                  </div>
                  <div className="chart-container">
                    {financialData.paymentMethods.length > 0 && (
                      <Doughnut
                        data={{
                          labels: financialData.paymentMethods.map(p => p.payment_method),
                          datasets: [{ data: financialData.paymentMethods.map(p => p.total_amount), backgroundColor: ['#354D70', '#4d83d4', '#667eea', '#f093fb'], borderWidth: 0 }]
                        }}
                        options={chartOptions}
                      />
                    )}
                  </div>
                </div>
                <div className="table-responsive">
                  <h4>Revenue by Service</h4>
                  <table className="data-table">
                    <thead><tr><th>Service</th><th>Appointments</th><th>Total Revenue</th><th>Avg per Visit</th><th>Market Share</th></tr></thead>
                    <tbody>
                      {financialData.serviceRevenue.map(s => (
                        <tr key={s.service_name}><td>{s.service_name}</td><td>{s.appointment_count}</td><td>{formatCurrency(s.total_revenue)}</td><td>{formatCurrency(s.avg_revenue_per_appointment)}</td><td>{s.service_share}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-responsive">
                  <h4>Top Spending Patients</h4>
                  <table className="data-table">
                    <thead><tr><th>Patient</th><th>Contact</th><th>Transactions</th><th>Total Spent</th><th>Last Payment</th></tr></thead>
                    <tbody>
                      {financialData.topPatients.map(p => (
                        <tr key={p.patient_name}><td>{p.patient_name}</td><td>{p.contact_no}</td><td>{p.total_transactions}</td><td>{formatCurrency(p.total_spent)}</td><td>{p.last_payment_date ? formatDate(p.last_payment_date) : 'N/A'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Appointment Reports */}
          {reportType === 'appointments' && (
            <div className="report-section">
              <div className="section-header"><h3>📅 Appointment Analysis</h3></div>
              <div className="section-body">
                <div className="stats-grid">
                  <div className="stat-item"><span className="stat-label">Total Appointments</span><span className="stat-value">{appointmentData.summary.total_appointments}</span></div>
                  <div className="stat-item"><span className="stat-label">Approval Rate</span><span className="stat-value">{appointmentData.summary.success_rate}%</span></div>
                  <div className="stat-item"><span className="stat-label">Completed</span><span className="stat-value">{appointmentData.summary.done_count}</span></div>
                  <div className="stat-item"><span className="stat-label">Cancelled</span><span className="stat-value">{appointmentData.summary.cancelled_count}</span></div>
                </div>
                <div className="charts-grid">
                  <div className="chart-container">
                    {appointmentData.byDay.length > 0 && (
                      <Bar data={{ labels: appointmentData.byDay.map(d => d.day_name), datasets: [{ label: 'Appointments', data: appointmentData.byDay.map(d => d.appointment_count), backgroundColor: '#354D70' }] }} options={chartOptions} />
                    )}
                  </div>
                  <div className="chart-container">
                    {appointmentData.byTime.length > 0 && (
                      <Pie data={{ labels: appointmentData.byTime.map(t => t.time_slot), datasets: [{ data: appointmentData.byTime.map(t => t.appointment_count), backgroundColor: ['#354D70', '#4d83d4', '#667eea'] }] }} options={chartOptions} />
                    )}
                  </div>
                </div>
                <div className="table-responsive">
                  <h4>Doctor Appointment Load</h4>
                  <table className="data-table">
                    <thead><tr><th>Doctor</th><th>Specialization</th><th>Total Apps</th><th>Completed</th><th>Cancelled</th><th>Completion Rate</th></tr></thead>
                    <tbody>
                      {appointmentData.doctorLoad.map(d => (
                        <tr key={d.doctor_name}><td>{d.doctor_name}</td><td>{d.specialization}</td><td>{d.total_appointments}</td><td>{d.completed_count}</td><td>{d.cancelled_count}</td><td className={`badge ${d.completion_rate > 80 ? 'badge-success' : (d.completion_rate > 60 ? 'badge-warning' : 'badge-danger')}`}>{d.completion_rate}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-responsive">
                  <h4>Recent Cancellations</h4>
                  <table className="data-table">
                    <thead><tr><th>Patient</th><th>Doctor</th><th>Appointment Date</th><th>Days Notice</th><th>Remarks</th></tr></thead>
                    <tbody>
                      {appointmentData.cancellations.map((c, idx) => (
                        <tr key={idx}><td>{c.patient_fname} {c.patient_lname}</td><td>Dr. {c.doctor_fname} {c.doctor_lname}</td><td>{formatDate(c.appointment_date)}</td><td>{c.days_between} days</td><td>{c.remarks?.slice(0, 50)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Patient Reports */}
          {reportType === 'patients' && (
            <div className="report-section">
              <div className="section-header"><h3>👥 Patient Analytics</h3></div>
              <div className="section-body">
                <div className="charts-grid">
                  <div className="chart-container">
                    {patientData.demographics.length > 0 && (
                      <Bar data={{ labels: patientData.demographics.map(d => d.age_group), datasets: [{ label: 'Patients', data: patientData.demographics.map(d => d.patient_count), backgroundColor: '#354D70' }] }} options={chartOptions} />
                    )}
                  </div>
                  <div className="chart-container">
                    {patientData.newPatients.length > 0 && (
                      <Line data={{ labels: patientData.newPatients.map(n => n.month), datasets: [{ label: 'New Patients', data: patientData.newPatients.map(n => n.new_patients), borderColor: '#354D70', fill: true }] }} options={chartOptions} />
                    )}
                  </div>
                </div>
                <div className="table-responsive">
                  <h4>Patient Demographics</h4>
                  <table className="data-table">
                    <thead><tr><th>Age Group</th><th>Count</th><th>Percentage</th></tr></thead>
                    <tbody>
                      {patientData.demographics.map(d => (
                        <tr key={d.age_group}><td>{d.age_group}</td><td>{d.patient_count}</td><td>{d.percentage}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-responsive">
                  <h4>Frequent Visitors</h4>
                  <table className="data-table">
                    <thead><tr><th>Patient</th><th>Contact</th><th>Total Visits</th><th>First Visit</th><th>Last Visit</th><th>Avg Days Between</th></tr></thead>
                    <tbody>
                      {patientData.frequentVisitors.map(p => (
                        <tr key={p.patient_name}><td>{p.patient_name}</td><td>{p.contact_no}</td><td>{p.total_visits}</td><td>{formatDate(p.first_visit)}</td><td>{formatDate(p.last_visit)}</td><td>{p.avg_days_between_visits.toFixed(1)} days</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-responsive">
                  <h4>Service Popularity by Age Group</h4>
                  <table className="data-table">
                    <thead><tr><th>Service</th><th>Age Group</th><th>Appointments</th></tr></thead>
                    <tbody>
                      {patientData.serviceByAge.map((s, idx) => (
                        <tr key={idx}><td>{s.service_name}</td><td>{s.age_group}</td><td>{s.appointment_count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Doctor Performance Reports */}
          {reportType === 'doctors' && (
            <div className="report-section">
              <div className="section-header"><h3>👨‍⚕️ Doctor Performance</h3></div>
              <div className="section-body">
                <div className="table-responsive">
                  <table className="data-table">
                    <thead><tr><th>Doctor</th><th>Specialization</th><th>Total Apps</th><th>Completed</th><th>Revenue</th><th>Avg/Appt</th><th>Completion Rate</th><th>Cancellation Rate</th></tr></thead>
                    <tbody>
                      {doctorPerformanceData.performance.map(d => (
                        <tr key={d.doctor_name}>
                          <td>{d.doctor_name}</td><td>{d.specialization}</td><td>{d.total_appointments}</td><td>{d.completed_appointments}</td>
                          <td>{formatCurrency(d.total_revenue_generated)}</td><td>{formatCurrency(d.avg_revenue_per_appointment)}</td>
                          <td><span className={`badge ${d.completion_rate > 80 ? 'badge-success' : (d.completion_rate > 60 ? 'badge-warning' : 'badge-danger')}`}>{d.completion_rate}%</span></td>
                          <td><span className={`badge ${d.cancellation_rate < 10 ? 'badge-success' : (d.cancellation_rate < 20 ? 'badge-warning' : 'badge-danger')}`}>{d.cancellation_rate}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="charts-grid">
                  <div className="chart-container">
                    {doctorPerformanceData.performance.length > 0 && (
                      <Bar data={{ labels: doctorPerformanceData.performance.map(d => d.doctor_name), datasets: [{ label: 'Revenue Generated', data: doctorPerformanceData.performance.map(d => d.total_revenue_generated), backgroundColor: '#354D70' }] }} options={barOptions} />
                    )}
                  </div>
                  <div className="chart-container">
                    {doctorPerformanceData.satisfaction.length > 0 && (
                      <Radar data={{ labels: doctorPerformanceData.satisfaction.map(d => d.doctor_name), datasets: [{ label: 'Repeat Rate %', data: doctorPerformanceData.satisfaction.map(d => d.repeat_rate), backgroundColor: 'rgba(53,77,112,0.2)', borderColor: '#354D70' }] }} options={{ responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } } }} />
                    )}
                  </div>
                </div>
                <div className="table-responsive">
                  <h4>Patient Satisfaction (Repeat Rate)</h4>
                  <table className="data-table">
                    <thead><tr><th>Doctor</th><th>Unique Patients</th><th>Total Apps</th><th>Avg Apps/Patient</th><th>Repeat Patients</th><th>Repeat Rate</th></tr></thead>
                    <tbody>
                      {doctorPerformanceData.satisfaction.map(d => (
                        <tr key={d.doctor_name}><td>{d.doctor_name}</td><td>{d.unique_patients}</td><td>{d.total_appointments}</td><td>{d.avg_appointments_per_patient}</td><td>{d.repeat_patients}</td><td className={`badge ${d.repeat_rate > 40 ? 'badge-success' : (d.repeat_rate > 20 ? 'badge-warning' : 'badge-danger')}`}>{d.repeat_rate}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="report-footer">
            <p>Report generated on {new Date().toLocaleString()} | Period: {formatDate(startDate)} to {formatDate(endDate)} | {doctorId === 'all' ? 'All Doctors' : 'Doctor Filtered'}</p>
            <p>© {new Date().getFullYear()} Fifthcusp Dental Clinic. All rights reserved.</p>
          </div>
        </div>
      </div>

      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default Reports;