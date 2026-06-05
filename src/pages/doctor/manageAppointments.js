import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import DoctorSidebar from '../../components/doctor/Sidebar';
import './manageAppointments.css';

const ManageAppointments = () => {
  const { user, userType, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState([]);
  const [stats, setStats] = useState({ pending: 0, confirmed: 0, cancelled: 0, completed: 0 });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [allServices, setAllServices] = useState([]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');

  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showRescheduleRequestModal, setShowRescheduleRequestModal] = useState(false);
  const [showCancelRequestModal, setShowCancelRequestModal] = useState(false);
  const [showPatientDetailsModal, setShowPatientDetailsModal] = useState(false);
  const [currentAppointment, setCurrentAppointment] = useState(null);
  const [remarksForm, setRemarksForm] = useState({
    appointment_id: '',
    remarks: '',
    follow_up_date: '',
    next_service: '',
    additional_notes: ''
  });
  const [rescheduleForm, setRescheduleForm] = useState({
    appointment_id: '',
    new_datetime: ''
  });
  const [rejectReason, setRejectReason] = useState('');

  // Redirect if not doctor
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'doctor') navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStatus, selectedDate]);

  // Fetch services for dropdown
  useEffect(() => {
    const fetchServices = async () => {
      const { data } = await supabase
        .from('services')
        .select('service_id, service_name')
        .eq('status', 'active')
        .order('service_name');
      if (data) setAllServices(data);
    };
    fetchServices();
  }, []);

  // Auto‑cancel expired pending appointments
  const autoCancelExpired = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('appointments')
      .update({
        status: 'cancelled',
        remarks: `[System Auto-cancel ${new Date().toLocaleString()}]: Appointment auto-cancelled because scheduled time passed.`
      })
      .eq('doctor_id', userDetails.doctor_id)
      .eq('status', 'pending')
      .lt('appointment_datetime', now)
      .select();
    if (!error && data?.length) {
      setSuccess(`${data.length} expired pending appointment(s) auto-cancelled.`);
      setTimeout(() => setSuccess(''), 5000);
    }
  }, [userDetails]);

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('status')
        .eq('doctor_id', userDetails.doctor_id);
      if (error) throw error;
      const statsCount = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
      data.forEach(app => {
        if (app.status === 'pending') statsCount.pending++;
        else if (app.status === 'confirmed') statsCount.confirmed++;
        else if (app.status === 'cancelled') statsCount.cancelled++;
        else if (app.status === 'completed') statsCount.completed++;
      });
      setStats(statsCount);
    } catch (err) {
      console.error(err);
    }
  }, [userDetails]);

  // Fetch appointments with filters
  const fetchAppointments = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('appointments')
        .select(`
          *,
          patients!inner (patient_id, first_name, last_name, email, contact_no, birthday),
          services!inner (service_name, price, description)
        `)
        .eq('doctor_id', userDetails.doctor_id)
        .order('appointment_datetime', { ascending: false });

      if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
      if (selectedDate) {
        const start = `${selectedDate} 00:00:00`;
        const end = `${selectedDate} 23:59:59`;
        query = query.gte('appointment_datetime', start).lte('appointment_datetime', end);
      }

      const { data, error } = await query;
      if (error) throw error;
      setAppointments(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [userDetails, selectedStatus, selectedDate]);

  // Initial load
  useEffect(() => {
    if (userDetails?.doctor_id) {
      const init = async () => {
        await autoCancelExpired();
        await fetchStats();
        await fetchAppointments();
      };
      init();
    }
  }, [userDetails, autoCancelExpired, fetchStats, fetchAppointments]);

  // Update appointment status helper
  const updateStatus = async (appointmentId, newStatus, remarksOverride = null) => {
    const updateData = {
      status: newStatus,
      updated_at: new Date().toISOString(),
      remarks: remarksOverride !== null ? remarksOverride : `[Doctor Action ${new Date().toLocaleString()}]: Status changed to ${newStatus.toUpperCase()}`
    };
    const { error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('appointment_id', appointmentId);
    if (error) throw error;
  };

  // Handlers
  const handleApprove = async (appointment) => {
    if (!window.confirm('Confirm this appointment?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'confirmed');
      setSuccess('Appointment confirmed!');
      await autoCancelExpired();
      await fetchStats();
      await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  const handleCancel = async (appointment) => {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'cancelled');
      setSuccess('Appointment cancelled.');
      await fetchStats();
      await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  const handleMarkCompleted = async (appointment) => {
    const apptTime = new Date(appointment.appointment_datetime);
    if (apptTime > new Date()) {
      setError('Cannot mark as completed – appointment time has not yet passed.');
      return;
    }
    if (!window.confirm('Mark this appointment as completed?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'completed', `[Doctor Action ${new Date().toLocaleString()}]: Marked as COMPLETED`);
      setSuccess('Appointment marked as completed!');
      await autoCancelExpired();
      await fetchStats();
      await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  // Toggle accordion
  const toggleExpand = (appointmentId) => {
    if (expandedCard === appointmentId) {
      setExpandedCard(null);
    } else {
      setExpandedCard(appointmentId);
    }
  };

  // Open patient details modal
  const openPatientDetailsModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowPatientDetailsModal(true);
  };

  // Remarks modal
  const openRemarksModal = (appointment) => {
    setCurrentAppointment(appointment);
    setRemarksForm({
      appointment_id: appointment.appointment_id,
      remarks: '',
      follow_up_date: '',
      next_service: '',
      additional_notes: ''
    });
    setShowRemarksModal(true);
  };

  const saveRemarks = async (e) => {
    e.preventDefault();
    try {
      let newRemarks = `[Doctor Remarks ${new Date().toLocaleString()}]:\n\nSERVICE NOTES:\n${remarksForm.remarks}\n\n`;
      if (remarksForm.follow_up_date) newRemarks += `FOLLOW-UP DATE: ${new Date(remarksForm.follow_up_date).toLocaleDateString()}\n`;
      if (remarksForm.next_service) newRemarks += `RECOMMENDED NEXT SERVICE: ${remarksForm.next_service}\n`;
      if (remarksForm.additional_notes) newRemarks += `ADDITIONAL NOTES:\n${remarksForm.additional_notes}\n`;
      const { error } = await supabase
        .from('appointments')
        .update({ remarks: newRemarks, updated_at: new Date().toISOString() })
        .eq('appointment_id', remarksForm.appointment_id);
      if (error) throw error;
      setSuccess('Remarks added!');
      setShowRemarksModal(false);
      await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  // Reschedule for pending appointments
  const openRescheduleModal = (appointment) => {
    setCurrentAppointment(appointment);
    setRescheduleForm({ appointment_id: appointment.appointment_id, new_datetime: '' });
    setShowRescheduleModal(true);
  };

  const approveReschedule = async (e) => {
    e.preventDefault();
    if (!rescheduleForm.new_datetime) {
      setError('Please select a new date and time.');
      return;
    }
    const newTime = new Date(rescheduleForm.new_datetime);
    if (newTime - new Date() < 3600000) {
      setError('New time must be at least 1 hour from now.');
      return;
    }
    try {
      const doctorId = userDetails.doctor_id;
      const newDate = rescheduleForm.new_datetime.slice(0, 10);
      const duration = 60;
      const { data: availability, error: availError } = await supabase
        .from('doctor_availability')
        .select('*')
        .eq('doctor_id', doctorId)
        .eq('available_date', newDate)
        .eq('is_available', true)
        .maybeSingle();
      if (availError || !availability) throw new Error('Doctor not available on selected date.');

      const { data: overlapping } = await supabase
        .from('appointments')
        .select('appointment_datetime')
        .eq('doctor_id', doctorId)
        .in('status', ['pending', 'confirmed'])
        .neq('appointment_id', currentAppointment.appointment_id)
        .gte('appointment_datetime', `${newDate} 00:00:00`)
        .lt('appointment_datetime', `${newDate} 23:59:59`);

      const requestStart = newTime;
      const requestEnd = new Date(requestStart.getTime() + duration * 60000);
      let overlap = false;
      for (const apt of overlapping || []) {
        const aptStart = new Date(apt.appointment_datetime);
        const aptEnd = new Date(aptStart.getTime() + duration * 60000);
        if (requestStart < aptEnd && requestEnd > aptStart) { overlap = true; break; }
      }
      if (overlap) throw new Error('Time slot overlaps with another appointment.');

      const newRemarks = `[Doctor Action ${new Date().toLocaleString()}]: Rescheduled to ${newTime.toLocaleString()}`;
      await supabase
        .from('appointments')
        .update({ appointment_datetime: rescheduleForm.new_datetime, remarks: newRemarks, updated_at: new Date().toISOString() })
        .eq('appointment_id', currentAppointment.appointment_id);
      setSuccess('Appointment rescheduled!');
      setShowRescheduleModal(false);
      await autoCancelExpired();
      await fetchStats(); await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  // Reschedule request from patient
  const openRescheduleRequestModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowRescheduleRequestModal(true);
    setRejectReason('');
  };

  const handleRescheduleRequest = async (action, rejectReasonText = '') => {
    if (!window.confirm(`Are you sure you want to ${action} this reschedule request?`)) return;
    try {
      if (action === 'approve') {
        let requestedTime = currentAppointment.request_new_datetime ? new Date(currentAppointment.request_new_datetime) : null;
        if (!requestedTime || isNaN(requestedTime.getTime())) throw new Error('Could not determine requested time.');
        if (requestedTime <= new Date()) throw new Error('Requested time must be in the future.');
        const doctorId = userDetails.doctor_id;
        const newDate = requestedTime.toISOString().slice(0, 10);
        const duration = 60;
        const { data: availability } = await supabase
          .from('doctor_availability')
          .select('*')
          .eq('doctor_id', doctorId)
          .eq('available_date', newDate)
          .eq('is_available', true)
          .maybeSingle();
        if (!availability) throw new Error('Doctor not available on requested date.');
        const { data: overlapping } = await supabase
          .from('appointments')
          .select('appointment_datetime')
          .eq('doctor_id', doctorId)
          .in('status', ['pending', 'confirmed'])
          .neq('appointment_id', currentAppointment.appointment_id)
          .gte('appointment_datetime', `${newDate} 00:00:00`)
          .lt('appointment_datetime', `${newDate} 23:59:59`);
        const requestStart = requestedTime;
        const requestEnd = new Date(requestStart.getTime() + duration * 60000);
        let overlap = false;
        for (const apt of overlapping || []) {
          const aptStart = new Date(apt.appointment_datetime);
          const aptEnd = new Date(aptStart.getTime() + duration * 60000);
          if (requestStart < aptEnd && requestEnd > aptStart) { overlap = true; break; }
        }
        if (overlap) throw new Error('Requested time overlaps with another appointment.');
        const newRemarks = `[Doctor Action ${new Date().toLocaleString()}]: Patient reschedule request APPROVED\nChanged to ${requestedTime.toLocaleString()}`;
        await supabase
          .from('appointments')
          .update({
            appointment_datetime: requestedTime.toISOString(),
            remarks: newRemarks,
            request_type: null,
            request_new_datetime: null,
            request_status: null,
            updated_at: new Date().toISOString()
          })
          .eq('appointment_id', currentAppointment.appointment_id);
        setSuccess('Reschedule request approved!');
      } else {
        const rejectMsg = rejectReasonText ? ` - ${rejectReasonText}` : '';
        const newRemarks = `[Doctor Action ${new Date().toLocaleString()}]: Patient reschedule request REJECTED${rejectMsg}`;
        await supabase
          .from('appointments')
          .update({
            remarks: newRemarks,
            request_type: null,
            request_new_datetime: null,
            request_status: null,
            updated_at: new Date().toISOString()
          })
          .eq('appointment_id', currentAppointment.appointment_id);
        setSuccess('Reschedule request rejected.');
      }
      setShowRescheduleRequestModal(false);
      await autoCancelExpired();
      await fetchStats(); await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  // Cancellation request from patient
  const openCancelRequestModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowCancelRequestModal(true);
    setRejectReason('');
  };

  const handleCancelRequest = async (action, rejectReasonText = '') => {
    if (!window.confirm(`Are you sure you want to ${action} this cancellation request?`)) return;
    try {
      if (action === 'approve') {
        const newRemarks = `[Doctor Action ${new Date().toLocaleString()}]: Patient cancellation request APPROVED`;
        await supabase
          .from('appointments')
          .update({
            status: 'cancelled',
            remarks: newRemarks,
            request_type: null,
            request_new_datetime: null,
            request_status: null,
            updated_at: new Date().toISOString()
          })
          .eq('appointment_id', currentAppointment.appointment_id);
        setSuccess('Cancellation request approved! Appointment cancelled.');
      } else {
        const rejectMsg = rejectReasonText ? ` - ${rejectReasonText}` : '';
        const newRemarks = `[Doctor Action ${new Date().toLocaleString()}]: Patient cancellation request REJECTED${rejectMsg}`;
        await supabase
          .from('appointments')
          .update({
            remarks: newRemarks,
            request_type: null,
            request_new_datetime: null,
            request_status: null,
            updated_at: new Date().toISOString()
          })
          .eq('appointment_id', currentAppointment.appointment_id);
        setSuccess('Cancellation request rejected.');
      }
      setShowCancelRequestModal(false);
      await autoCancelExpired();
      await fetchStats(); await fetchAppointments();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  const getStatusClass = (status) => {
    switch(status) {
      case 'pending': return 'status-pending';
      case 'confirmed': return 'status-confirmed';
      case 'cancelled': return 'status-cancelled';
      case 'completed': return 'status-completed';
      default: return '';
    }
  };

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentAppointments = appointments.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(appointments.length / itemsPerPage);

  const paginate = (pageNumber) => setCurrentPage(pageNumber);
  const goToPreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };
  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pageNumbers = [];
    const maxPagesToShow = 5;
    
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      const startPage = Math.max(1, currentPage - 2);
      const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
      
      if (startPage > 1) {
        pageNumbers.push(1);
        if (startPage > 2) pageNumbers.push('...');
      }
      
      for (let i = startPage; i <= endPage; i++) {
        pageNumbers.push(i);
      }
      
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageNumbers.push('...');
        pageNumbers.push(totalPages);
      }
    }
    
    return pageNumbers;
  };

  // Loading UI – consistent with other pages
  if (authLoading) {
    return (
      <div className="doctor-loading">
        <div className="loading-spinner"></div>
        <p>Loading authentication...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="doctor-loading">
        <div className="loading-spinner"></div>
        <p>Loading appointments...</p>
      </div>
    );
  }

  const doctorName = userDetails?.first_name ? `Dr. ${userDetails.first_name} ${userDetails.last_name}` : 'Doctor';

  return (
    <div className="doctor-dashboard">
      <DoctorSidebar onLogout={handleLogout} />
      <div className="main-content doctor-appointments-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>My Appointments</h1>
            <p className="welcome-message">View and manage your patient appointments</p>
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
        {success && <div className="alert alert-success">{success}</div>}

        <div className="doctor-stats-grid">
          <div className="stat-card"><div className="stat-number">{stats.pending}</div><div className="stat-label">Pending</div></div>
          <div className="stat-card"><div className="stat-number">{stats.confirmed}</div><div className="stat-label">Confirmed</div></div>
          <div className="stat-card"><div className="stat-number">{stats.cancelled}</div><div className="stat-label">Cancelled</div></div>
          <div className="stat-card"><div className="stat-number">{stats.completed}</div><div className="stat-label">Completed</div></div>
        </div>

        <div className="doctor-filters">
          <div className="filter-group">
            <label>Status</label>
            <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className="form-control">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Date</label>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="form-control" />
          </div>
          <div className="filter-group">
            <button className="btn btn-primary" onClick={fetchAppointments}>Apply Filters</button>
            <button className="btn btn-secondary" onClick={() => { setSelectedStatus('all'); setSelectedDate(''); }}>Clear Filters</button>
          </div>
        </div>

        <div className="doctor-appointments-list">
          {currentAppointments.length === 0 ? (
            <div className="empty-state"><i className="fas fa-calendar-times"></i><p>No appointments found</p></div>
          ) : (
            <>
              {currentAppointments.map(app => {
                const patient = app.patients;
                const service = app.services;
                const appointmentTime = new Date(app.appointment_datetime);
                const canMarkCompleted = app.status === 'confirmed' && appointmentTime < new Date();
                const remarks = app.remarks || '';
                const remarksLower = remarks.toLowerCase();
                const hasRescheduleRequest = app.status === 'confirmed' && remarksLower.includes('reschedule requested');
                const hasCancellationRequest = app.status === 'confirmed' && remarksLower.includes('cancellation requested');
                const isExpanded = expandedCard === app.appointment_id;
                let requestedTime = '';
                if (hasRescheduleRequest) {
                  const match = remarks.match(/to\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[APM]{2})/i);
                  if (match) requestedTime = match[1];
                }

                return (
                  <div key={app.appointment_id} className="doctor-appointment-card">
                    <div className="doctor-appointment-header-compact" onClick={() => toggleExpand(app.appointment_id)}>
                      <div className="doctor-compact-info">
                        <div className="doctor-compact-patient">
                          <i className="fas fa-user-circle"></i>
                          <span>{patient?.first_name} {patient?.last_name}</span>
                        </div>
                        <div className="doctor-compact-service">
                          <i className="fas fa-tooth"></i>
                          <span>{service?.service_name}</span>
                        </div>
                        <div className="doctor-compact-datetime">
                          <i className="fas fa-calendar-alt"></i>
                          <span>{appointmentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {appointmentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div className="doctor-compact-status">
                        <div className={`status-badge ${getStatusClass(app.status)}`}>{app.status.toUpperCase()}</div>
                        <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} doctor-expand-icon`}></i>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="doctor-appointment-expanded-content">
                        <div className="doctor-expanded-service-info">
                          <div className="service-detail">
                            <span className="service-label">Service:</span>
                            <span className="service-value">{service?.service_name}</span>
                          </div>
                          <div className="price-detail">
                            <span className="service-label">Price:</span>
                            <span className="price-value">₱ {Number(service?.price).toFixed(2)}</span>
                          </div>
                        </div>

                        {service?.description && (
                          <div className="doctor-expanded-service-description">
                            <div className="description-label">
                              <i className="fas fa-info-circle"></i> Description:
                            </div>
                            <div className="description-text">{service.description}</div>
                          </div>
                        )}

                        <div className="doctor-expanded-remarks-preview">
                          <div className="remarks-label">
                            <i className="fas fa-notes-medical"></i> Remarks:
                          </div>
                          <div className="remarks-preview-text">
                            {remarks || 'No remarks yet.'}
                          </div>
                        </div>

                        {(hasRescheduleRequest || hasCancellationRequest) && (
                          <div className="doctor-notice-box">
                            {hasRescheduleRequest && (
                              <div className="notice-item reschedule">
                                <i className="fas fa-calendar-alt"></i>
                                <div className="notice-content">
                                  <strong>Reschedule Requested by Patient</strong>
                                  {requestedTime && <span>Requested new time: {requestedTime}</span>}
                                </div>
                                <button className="btn btn-sm btn-warning" onClick={(e) => { e.stopPropagation(); openRescheduleRequestModal(app); }}>
                                  <i className="fas fa-calendar-check"></i> Review
                                </button>
                              </div>
                            )}
                            {hasCancellationRequest && (
                              <div className="notice-item cancellation">
                                <i className="fas fa-exclamation-triangle"></i>
                                <div className="notice-content">
                                  <strong>Cancellation Requested by Patient</strong>
                                  <span>Patient has requested to cancel this appointment.</span>
                                </div>
                                <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); openCancelRequestModal(app); }}>
                                  <i className="fas fa-calendar-times"></i> Review
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="doctor-appointment-actions">
                          <button className="btn btn-info btn-sm" onClick={() => openPatientDetailsModal(app)}>
                            <i className="fas fa-user-injured"></i> View Patient Details
                          </button>
                          
                          {app.status === 'pending' && (
                            <>
                              <button className="btn btn-success btn-sm" onClick={() => handleApprove(app)}>Confirm</button>
                              <button className="btn btn-warning btn-sm" onClick={() => openRescheduleModal(app)}>Reschedule</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleCancel(app)}>Cancel</button>
                              <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>Add Remarks</button>
                            </>
                          )}
                          {app.status === 'confirmed' && (
                            <>
                              {canMarkCompleted && <button className="btn btn-success btn-sm" onClick={() => handleMarkCompleted(app)}>Mark Completed</button>}
                              <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>Add Remarks</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleCancel(app)}>Cancel</button>
                            </>
                          )}
                          {app.status === 'cancelled' && (
                            <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>View Remarks</button>
                          )}
                          {app.status === 'completed' && (
                            <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>View Remarks</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="doctor-pagination-container">
                  <div className="pagination-info">
                    Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, appointments.length)} of {appointments.length} appointments
                  </div>
                  <div className="pagination-controls">
                    <button 
                      onClick={goToPreviousPage} 
                      disabled={currentPage === 1}
                      className="pagination-btn"
                    >
                      <i className="fas fa-chevron-left"></i> Previous
                    </button>
                    
                    <div className="pagination-numbers">
                      {getPageNumbers().map((page, index) => (
                        page === '...' ? (
                          <span key={index} className="pagination-dots">...</span>
                        ) : (
                          <button
                            key={index}
                            onClick={() => paginate(page)}
                            className={`pagination-number ${currentPage === page ? 'active' : ''}`}
                          >
                            {page}
                          </button>
                        )
                      ))}
                    </div>
                    
                    <button 
                      onClick={goToNextPage} 
                      disabled={currentPage === totalPages}
                      className="pagination-btn"
                    >
                      Next <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Patient Details Modal */}
      {showPatientDetailsModal && currentAppointment && (
        <div className="doctor-modal active" onClick={e => e.target === e.currentTarget && setShowPatientDetailsModal(false)}>
          <div className="doctor-modal-content">
            <div className="modal-header">
              <h3><i className="fas fa-user-injured"></i> Patient Details</h3>
              <button className="modal-close" onClick={() => setShowPatientDetailsModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="doctor-patient-details-modal">
                <div className="detail-row">
                  <div className="detail-label">Full Name:</div>
                  <div className="detail-value">{currentAppointment.patients?.first_name} {currentAppointment.patients?.last_name}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Email:</div>
                  <div className="detail-value">{currentAppointment.patients?.email}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Contact Number:</div>
                  <div className="detail-value">{currentAppointment.patients?.contact_no || 'N/A'}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Patient ID:</div>
                  <div className="detail-value">{currentAppointment.patients?.patient_id}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Service:</div>
                  <div className="detail-value">{currentAppointment.services?.service_name}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Appointment Date:</div>
                  <div className="detail-value">{new Date(currentAppointment.appointment_datetime).toLocaleString()}</div>
                </div>
                <div className="detail-row">
                  <div className="detail-label">Status:</div>
                  <div className="detail-value">
                    <span className={`status-badge ${getStatusClass(currentAppointment.status)}`}>
                      {currentAppointment.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                {currentAppointment.remarks && (
                  <div className="detail-row">
                    <div className="detail-label">Remarks:</div>
                    <div className="detail-value remarks-text">{currentAppointment.remarks}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPatientDetailsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Remarks Modal */}
      {showRemarksModal && (
        <div className="doctor-modal active" onClick={e => e.target === e.currentTarget && setShowRemarksModal(false)}>
          <div className="doctor-modal-content">
            <div className="modal-header">
              <h3>Add/Update Remarks</h3>
              <button className="modal-close" onClick={() => setShowRemarksModal(false)}>&times;</button>
            </div>
            <form onSubmit={saveRemarks}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Service Remarks *</label>
                  <textarea className="form-control" rows="6" value={remarksForm.remarks} onChange={e => setRemarksForm({...remarksForm, remarks: e.target.value})} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Follow-up Date</label>
                    <input type="date" className="form-control" value={remarksForm.follow_up_date} onChange={e => setRemarksForm({...remarksForm, follow_up_date: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Next Service</label>
                    <select className="form-control" value={remarksForm.next_service} onChange={e => setRemarksForm({...remarksForm, next_service: e.target.value})}>
                      <option value="">Select</option>
                      {allServices.map(s => <option key={s.service_id} value={s.service_name}>{s.service_name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Additional Notes</label>
                  <textarea className="form-control" rows="4" value={remarksForm.additional_notes} onChange={e => setRemarksForm({...remarksForm, additional_notes: e.target.value})} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRemarksModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Remarks</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Modal (pending) */}
      {showRescheduleModal && (
        <div className="doctor-modal active" onClick={e => e.target === e.currentTarget && setShowRescheduleModal(false)}>
          <div className="doctor-modal-content">
            <div className="modal-header">
              <h3>Reschedule Appointment</h3>
              <button className="modal-close" onClick={() => setShowRescheduleModal(false)}>&times;</button>
            </div>
            <form onSubmit={approveReschedule}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Current Time</label>
                  <input type="text" className="form-control" value={currentAppointment ? new Date(currentAppointment.appointment_datetime).toLocaleString() : ''} disabled />
                </div>
                <div className="form-group">
                  <label>New Date & Time</label>
                  <input type="datetime-local" className="form-control" value={rescheduleForm.new_datetime} onChange={e => setRescheduleForm({...rescheduleForm, new_datetime: e.target.value})} required min={new Date(Date.now() + 3600000).toISOString().slice(0,16)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRescheduleModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Approve Reschedule</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Request Modal (from patient) */}
      {showRescheduleRequestModal && currentAppointment && (
        <div className="doctor-modal active" onClick={e => e.target === e.currentTarget && setShowRescheduleRequestModal(false)}>
          <div className="doctor-modal-content">
            <div className="modal-header">
              <h3>Review Reschedule Request</h3>
              <button className="modal-close" onClick={() => setShowRescheduleRequestModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div><strong>Current Time:</strong> {new Date(currentAppointment.appointment_datetime).toLocaleString()}</div>
              <div><strong>Patient Reason:</strong> {currentAppointment.remarks?.match(/Reason:\s*(.+)/i)?.[1] || 'N/A'}</div>
              <div><strong>Requested Time:</strong> {currentAppointment.request_new_datetime ? new Date(currentAppointment.request_new_datetime).toLocaleString() : 'Not specified'}</div>
              <div className="reject-reason-box">
                <label>Rejection Reason (optional)</label>
                <textarea className="form-control" rows="3" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional reason if rejecting..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => handleRescheduleRequest('reject', rejectReason)}>Reject</button>
              <button className="btn btn-success" onClick={() => handleRescheduleRequest('approve')}>Approve</button>
              <button className="btn btn-secondary" onClick={() => setShowRescheduleRequestModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Request Modal */}
      {showCancelRequestModal && currentAppointment && (
        <div className="doctor-modal active" onClick={e => e.target === e.currentTarget && setShowCancelRequestModal(false)}>
          <div className="doctor-modal-content">
            <div className="modal-header">
              <h3>Review Cancellation Request</h3>
              <button className="modal-close" onClick={() => setShowCancelRequestModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div><strong>Appointment Time:</strong> {new Date(currentAppointment.appointment_datetime).toLocaleString()}</div>
              <div><strong>Patient Reason:</strong> {currentAppointment.remarks?.match(/Reason:\s*(.+)/i)?.[1] || 'N/A'}</div>
              <div className="reject-reason-box">
                <label>Rejection Reason (optional)</label>
                <textarea className="form-control" rows="3" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional reason if rejecting..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => handleCancelRequest('reject', rejectReason)}>Reject</button>
              <button className="btn btn-success" onClick={() => handleCancelRequest('approve')}>Approve</button>
              <button className="btn btn-secondary" onClick={() => setShowCancelRequestModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
    </div>
  );
};

export default ManageAppointments;