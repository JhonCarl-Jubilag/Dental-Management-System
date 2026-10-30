import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { completeFinishedAppointments, cancelExpiredPendingAppointments } from '../../services/appointmentCompletion';
import { hasAppointmentEnded } from '../../utils/appointmentTiming';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import { saveAppointmentNote, getAppointmentRequestReason } from '../../services/appointmentNotes';
import { validateAppointmentReschedule } from '../../services/doctorScheduling';
import { CLINIC_TIME_ZONE, clinicDateTime, clinicDayBounds, formatClinicDateTime, toClinicDateTimeInput } from '../../utils/clinicScheduling';
import './manageAppointments.css';

const ManageAppointments = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [stats, setStats] = useState({ pending: 0, confirmed: 0, cancelled: 0, completed: 0 });
  const [doctors, setDoctors] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [expandedCard, setExpandedCard] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [selectedDoctor, setSelectedDoctor] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [savingRemarks, setSavingRemarks] = useState(false);
  const remarksSaving = useRef(false);
  const rescheduleSaving = useRef(false);
  const [savingReschedule, setSavingReschedule] = useState(false);
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
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (!isClinicUser(userType)) navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  useEffect(() => {
    const fetchDoctors = async () => {
      const { data, error } = await supabase
        .from('doctors')
        .select('doctor_id, first_name, last_name')
        .eq('status', 'active')
        .order('last_name');
      if (!error) setDoctors(data || []);
    };
    const fetchServices = async () => {
      const { data, error } = await supabase
        .from('services')
        .select('service_id, service_name')
        .eq('status', 'active')
        .order('service_name');
      if (!error) setAllServices(data || []);
    };
    fetchDoctors();
    fetchServices();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDoctor, selectedStatus, selectedDate]);

  const autoUpdateExpired = useCallback(async () => {
    const now = new Date().toISOString();
    let cancelledCount = 0;
    let completedCount = 0;

    try {
      cancelledCount = await cancelExpiredPendingAppointments(supabase, null, new Date(now));
    } catch (err) {
      console.error(err);
      toast.error('Could not update expired appointments. Please reload to retry.');
    }

    try {
      completedCount = await completeFinishedAppointments(supabase, new Date(now));
    } catch (err) {
      console.error(err);
      toast.error('Could not update finished appointments. Please reload to retry.');
    }

    if (cancelledCount > 0 || completedCount > 0) {
      let msg = '';
      if (cancelledCount > 0) msg += `${cancelledCount} expired pending appointment(s) cancelled. `;
      if (completedCount > 0) msg += `${completedCount} expired confirmed appointment(s) marked as completed.`;
      toast.info(msg);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('appointments').select('status');
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
  }, []);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let query = supabase
        .from('appointments')
        .select(`
          *,
          patients!inner (patient_id, first_name, last_name, email, contact_no),
          doctors!inner (doctor_id, first_name, last_name, specialization),
          services!inner (service_name, price, duration_minutes)
        `)
        .order('appointment_datetime', { ascending: false });

      if (selectedDoctor !== 'all') query = query.eq('doctor_id', selectedDoctor);
      if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
      if (selectedDate) {
        const { start, end } = clinicDayBounds(selectedDate);
        query = query.gte('appointment_datetime', start).lt('appointment_datetime', end);
      }

      const { data, error } = await query;
      if (error) throw error;
      setAppointments(data || []);
      setHasLoaded(true);
    } catch (err) {
      setLoadError(err);
      console.error(err);
      toast.error(err.message || 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [selectedDoctor, selectedStatus, selectedDate]);

  useEffect(() => {
    const init = async () => {
      await autoUpdateExpired();
      await fetchStats();
      await fetchAppointments();
    };
    init();
  }, [autoUpdateExpired, fetchStats, fetchAppointments]);

  const updateStatus = async (appointmentId, status, remarksOverride = null) => {
    const appointment = appointments.find(item => item.appointment_id === appointmentId);
    if (!appointment) throw new Error('Reload the appointment before changing its status.');
    await saveAppointmentNote(supabase, appointment,
      remarksOverride !== null ? remarksOverride : `[Admin Action ${new Date().toLocaleString()}]: Status changed to ${status.toUpperCase()}`,
      { status: status });
  };

  const handleApprove = async (appointment) => {
    if (!window.confirm('Approve this appointment?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'confirmed');
      toast.success('Appointment approved!');
      await autoUpdateExpired();
      await fetchStats();
      await fetchAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const handleCancel = async (appointment) => {
    if (!window.confirm('Cancel this appointment?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'cancelled');
      toast.success('Appointment cancelled.');
      await fetchStats();
      await fetchAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const handleMarkCompleted = async (appointment) => {
    if (!hasAppointmentEnded(appointment)) {
      toast.error('Cannot mark as completed – the full service duration has not elapsed or is unavailable.');
      return;
    }
    if (!window.confirm('Mark this appointment as completed?')) return;
    try {
      await updateStatus(appointment.appointment_id, 'completed', `[Admin Action ${new Date().toLocaleString()}]: Marked as COMPLETED`);
      toast.success('Appointment marked as completed!');
      await autoUpdateExpired();
      await fetchStats();
      await fetchAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (appointment) => {
    if (!isOwner(userType)) { toast.error('Only the Owner can permanently delete appointments.'); return; }
    if (appointment.status !== 'cancelled') {
      toast.error('Only cancelled appointments can be deleted.');
      return;
    }
    if (!window.confirm('Permanently delete this cancelled appointment?')) return;
    try {
      const { error } = await supabase.from('appointments').delete().eq('appointment_id', appointment.appointment_id);
      if (error) throw error;
      toast.success('Appointment deleted.');
      await fetchStats();
      await fetchAppointments();
    } catch (err) { toast.error(err.message); }
  };

  const toggleExpand = (appointmentId) => {
    setExpandedCard(expandedCard === appointmentId ? null : appointmentId);
  };

  const openPatientDetailsModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowPatientDetailsModal(true);
  };

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
    if (remarksSaving.current || !currentAppointment) return;
    if (!remarksForm.remarks.trim()) { toast.error('Enter service remarks before saving.'); return; }
    remarksSaving.current = true;
    setSavingRemarks(true);
    try {
      let newRemarks = `[Admin Remarks ${new Date().toLocaleString()}]:\n\nSERVICE NOTES:\n${remarksForm.remarks}\n\n`;
      if (remarksForm.follow_up_date) newRemarks += `FOLLOW-UP DATE: ${new Date(remarksForm.follow_up_date).toLocaleDateString()}\n`;
      if (remarksForm.next_service) newRemarks += `RECOMMENDED NEXT SERVICE: ${remarksForm.next_service}\n`;
      if (remarksForm.additional_notes) newRemarks += `ADDITIONAL NOTES:\n${remarksForm.additional_notes}\n`;
      await saveAppointmentNote(supabase, currentAppointment, newRemarks);
      toast.success('Remarks added!');
      setShowRemarksModal(false);
      await fetchAppointments();
    } catch (err) { toast.error(err.message); }
    finally { remarksSaving.current = false; setSavingRemarks(false); }
  };

  const openRescheduleModal = (appointment) => {
    setCurrentAppointment(appointment);
    setRescheduleForm({ appointment_id: appointment.appointment_id, new_datetime: '' });
    setShowRescheduleModal(true);
  };

  const approveReschedule = async (e) => {
    e.preventDefault();
    if (!rescheduleForm.new_datetime) {
      toast.error('Please select a new date and time.');
      return;
    }
    if (rescheduleSaving.current) return;
    rescheduleSaving.current = true;
    setSavingReschedule(true);
    try {
      if (currentAppointment?.status !== 'pending') throw new Error('Reload this pending appointment before rescheduling.');
      const [date, time] = rescheduleForm.new_datetime.split('T');
      const newTime = await validateAppointmentReschedule({
        appointment: currentAppointment, targetDateTime: clinicDateTime(date, time), leadMinutes: 60,
      });
      const newRemarks = `[Admin Action ${new Date().toLocaleString()}]: Rescheduled to ${formatClinicDateTime(newTime)}`;
      await saveAppointmentNote(supabase, currentAppointment, newRemarks, { appointment_datetime: newTime });
      toast.success('Appointment rescheduled!');
      setShowRescheduleModal(false);
      await autoUpdateExpired();
      await fetchStats(); await fetchAppointments();
    } catch (err) { toast.error(err.message); }
    finally { rescheduleSaving.current = false; setSavingReschedule(false); }
  };

  const openRescheduleRequestModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowRescheduleRequestModal(true);
    setRejectReason('');
  };

  const handleRescheduleRequest = async (action, rejectReasonText = '') => {
    if (rescheduleSaving.current) return;
    if (!window.confirm(`Are you sure you want to ${action} this reschedule request?`)) return;
    rescheduleSaving.current = true;
    setSavingReschedule(true);
    try {
      if (action === 'approve') {
        if (currentAppointment?.status !== 'confirmed' || currentAppointment.request_status !== 'pending' || currentAppointment.request_type !== 'reschedule') {
          throw new Error('This reschedule request is no longer pending. Refresh the appointment.');
        }
        const requestedTime = await validateAppointmentReschedule({
          appointment: currentAppointment, targetDateTime: currentAppointment.request_new_datetime, leadMinutes: 0,
        });
        const newRemarks = `[Admin Action ${new Date().toLocaleString()}]: Patient reschedule request APPROVED\nChanged to ${formatClinicDateTime(requestedTime)}`;
        await saveAppointmentNote(supabase, currentAppointment, newRemarks, { appointment_datetime: requestedTime,
            request_type: null,
            request_new_datetime: null,
            request_status: null });
        toast.success('Reschedule request approved!');
      } else {
        const rejectMsg = rejectReasonText ? ` - ${rejectReasonText}` : '';
        const newRemarks = `[Admin Action ${new Date().toLocaleString()}]: Patient reschedule request REJECTED${rejectMsg}`;
        await saveAppointmentNote(supabase, currentAppointment, newRemarks, { request_type: null,
            request_new_datetime: null,
            request_status: null });
        toast.success('Reschedule request rejected.');
      }
      setShowRescheduleRequestModal(false);
      await autoUpdateExpired();
      await fetchStats(); await fetchAppointments();
    } catch (err) { toast.error(err.message); }
    finally { rescheduleSaving.current = false; setSavingReschedule(false); }
  };

  const openCancelRequestModal = (appointment) => {
    setCurrentAppointment(appointment);
    setShowCancelRequestModal(true);
    setRejectReason('');
  };

  const handleCancelRequest = async (action, rejectReasonText = '') => {
    if (!window.confirm(`Are you sure you want to ${action} this cancellation request?`)) return;
    try {
      if (action === 'approve') {
        const newRemarks = `[Admin Action ${new Date().toLocaleString()}]: Patient cancellation request APPROVED`;
        await saveAppointmentNote(supabase, currentAppointment, newRemarks, { status: 'cancelled',
            request_type: null,
            request_new_datetime: null,
            request_status: null });
        toast.success('Cancellation request approved! Appointment cancelled.');
      } else {
        const rejectMsg = rejectReasonText ? ` - ${rejectReasonText}` : '';
        const newRemarks = `[Admin Action ${new Date().toLocaleString()}]: Patient cancellation request REJECTED${rejectMsg}`;
        await saveAppointmentNote(supabase, currentAppointment, newRemarks, { request_type: null,
            request_new_datetime: null,
            request_status: null });
        toast.success('Cancellation request rejected.');
      }
      setShowCancelRequestModal(false);
      await autoUpdateExpired();
      await fetchStats(); await fetchAppointments();
    } catch (err) { toast.error(err.message); }
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

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentAppointments = appointments.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(appointments.length / itemsPerPage);
  const paginate = (pageNumber) => setCurrentPage(pageNumber);
  const goToPreviousPage = () => currentPage > 1 && setCurrentPage(currentPage - 1);
  const goToNextPage = () => currentPage < totalPages && setCurrentPage(currentPage + 1);

  const getPageNumbers = () => {
    const pageNumbers = [];
    const maxPagesToShow = 5;
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
      const startPage = Math.max(1, currentPage - 2);
      const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
      if (startPage > 1) {
        pageNumbers.push(1);
        if (startPage > 2) pageNumbers.push('...');
      }
      for (let i = startPage; i <= endPage; i++) pageNumbers.push(i);
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageNumbers.push('...');
        pageNumbers.push(totalPages);
      }
    }
    return pageNumbers;
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading authentication...</p>
      </div>
    );
  }


  const isSuperAdmin = isOwner(userType);
  if (!user || (!isClinicUser(userType))) return null;
  const adminName = isSuperAdmin ? 'Super Admin' : user?.email?.split('@')[0] || 'Admin';
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />
      <div className="main-content manage-appointments-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Appointments</h1>
            <p className="welcome-message">View and manage all patient appointments</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/admin/manual-booking')} style={{ marginRight: '15px' }}>
              <i className="fas fa-plus-circle"></i> Manual Booking
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
        <AdminDataRegion loading={loading} hasLoaded={hasLoaded} error={loadError} label="Appointments" onRetry={fetchAppointments}>


        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">{stats.pending}</div><div className="stat-label">Pending</div></div>
          <div className="stat-card"><div className="stat-number">{stats.confirmed}</div><div className="stat-label">Confirmed</div></div>
          <div className="stat-card"><div className="stat-number">{stats.cancelled}</div><div className="stat-label">Cancelled</div></div>
          <div className="stat-card"><div className="stat-number">{stats.completed}</div><div className="stat-label">Completed</div></div>
        </div>

        <div className="filters">
          <div className="filter-group">
            <label>Doctor</label>
            <select value={selectedDoctor} onChange={e => setSelectedDoctor(e.target.value)} className="form-control">
              <option value="all">All Doctors</option>
              {doctors.map(doc => <option key={doc.doctor_id} value={doc.doctor_id}>Dr. {doc.first_name} {doc.last_name}</option>)}
            </select>
          </div>
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
            <button className="btn btn-secondary" onClick={() => { setSelectedDoctor('all'); setSelectedStatus('all'); setSelectedDate(''); }}>Clear Filters</button>
          </div>
        </div>

        <div className="appointments-list">
          {currentAppointments.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-calendar-times"></i>
              <p>No appointments found</p>
            </div>
          ) : (
            <>
              {currentAppointments.map(app => {
                const patient = app.patients;
                const doctor = app.doctors;
                const service = app.services;
                const appointmentTime = new Date(app.appointment_datetime);
                const canMarkCompleted = app.status === 'confirmed' && hasAppointmentEnded(app);
                const showRescheduleRequest = app.status === 'confirmed' && app.request_status === 'pending' && app.request_type === 'reschedule';
                const showCancelRequest = app.status === 'confirmed' && app.request_status === 'pending' && app.request_type === 'cancellation';
                const statusClass = getStatusClass(app.status);
                const isExpanded = expandedCard === app.appointment_id;

                return (
                  <div key={app.appointment_id} className="admin-appointment-card">
                    <div className="admin-appointment-header-compact" onClick={() => toggleExpand(app.appointment_id)}>
                      <div className="admin-compact-info">
                        <div className="admin-compact-patient">
                          <i className="fas fa-user-circle"></i>
                          <span>{patient?.first_name} {patient?.last_name}</span>
                        </div>
                        <div className="admin-compact-doctor">
                          <i className="fas fa-user-md"></i>
                          <span>Dr. {doctor?.first_name} {doctor?.last_name}</span>
                        </div>
                        <div className="admin-compact-datetime">
                          <i className="fas fa-calendar-alt"></i>
                          <span>{appointmentTime.toLocaleDateString('en-US', { timeZone: CLINIC_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric' })} at {appointmentTime.toLocaleTimeString('en-US', { timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div className="admin-compact-status">
                        <div className={`status-badge ${statusClass}`}>{app.status.toUpperCase()}</div>
                        <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} admin-expand-icon`}></i>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="admin-appointment-expanded-content">
                        <div className="admin-expanded-service-info">
                          <div className="service-detail">
                            <span className="service-label">Service:</span>
                            <span className="service-value">{service?.service_name}</span>
                          </div>
                          <div className="price-detail">
                            <span className="service-label">Price:</span>
                            <span className="price-value">₱ {Number(service?.price).toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="admin-expanded-remarks-preview">
                          <div className="remarks-label">
                            <i className="fas fa-notes-medical"></i> Remarks:
                          </div>
                          <div className="remarks-preview-text">
                            {app.remarks || 'No remarks yet.'}
                          </div>
                        </div>

                        <div className="admin-appointment-actions">
                          <button className="btn btn-info btn-sm" onClick={() => openPatientDetailsModal(app)}>
                            <i className="fas fa-user"></i> View Patient Details
                          </button>
                          
                          {app.status === 'pending' && (
                            <>
                              <button className="btn btn-success btn-sm" onClick={() => handleApprove(app)}>Approve</button>
                              <button className="btn btn-warning btn-sm" onClick={() => openRescheduleModal(app)}>Reschedule</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleCancel(app)}>Cancel</button>
                              <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>Add Remarks</button>
                            </>
                          )}
                          {app.status === 'confirmed' && (
                            <>
                              {canMarkCompleted && <button className="btn btn-success btn-sm" onClick={() => handleMarkCompleted(app)}>Mark Completed</button>}
                              {showRescheduleRequest && <button className="btn btn-warning btn-sm" onClick={() => openRescheduleRequestModal(app)}>Review Reschedule Request</button>}
                              {showCancelRequest && <button className="btn btn-danger btn-sm" onClick={() => openCancelRequestModal(app)}>Review Cancellation Request</button>}
                              <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>Add Remarks</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleCancel(app)}>Cancel</button>
                            </>
                          )}
                          {app.status === 'cancelled' && (
                            <>
                              {isSuperAdmin && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(app)}>Delete Permanently</button>}
                              <button className="btn btn-info btn-sm" onClick={() => openRemarksModal(app)}>View Remarks</button>
                            </>
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
              {totalPages > 1 && (
                <div className="pagination-container">
                  <div className="pagination-info">
                    Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, appointments.length)} of {appointments.length} appointments
                  </div>
                  <div className="pagination-controls">
                    <button onClick={goToPreviousPage} disabled={currentPage === 1} className="pagination-btn">
                      <i className="fas fa-chevron-left"></i> Previous
                    </button>
                    <div className="pagination-numbers">
                      {getPageNumbers().map((page, index) => (
                        page === '...' ? (
                          <span key={index} className="pagination-dots">...</span>
                        ) : (
                          <button key={index} onClick={() => paginate(page)} className={`pagination-number ${currentPage === page ? 'active' : ''}`}>
                            {page}
                          </button>
                        )
                      ))}
                    </div>
                    <button onClick={goToNextPage} disabled={currentPage === totalPages} className="pagination-btn">
                      Next <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </AdminDataRegion>
      </div>

      {/* Modals (unchanged except no alerts inside) */}
      {showPatientDetailsModal && currentAppointment && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowPatientDetailsModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3><i className="fas fa-user-circle"></i> Patient Details</h3><button className="modal-close" onClick={() => setShowPatientDetailsModal(false)}>&times;</button></div>
            <div className="modal-body">
              <div className="patient-details-modal">
                <div className="detail-row"><div className="detail-label">Full Name:</div><div className="detail-value">{currentAppointment.patients?.first_name} {currentAppointment.patients?.last_name}</div></div>
                <div className="detail-row"><div className="detail-label">Email:</div><div className="detail-value">{currentAppointment.patients?.email}</div></div>
                <div className="detail-row"><div className="detail-label">Contact Number:</div><div className="detail-value">{currentAppointment.patients?.contact_no || 'N/A'}</div></div>
                <div className="detail-row"><div className="detail-label">Patient ID:</div><div className="detail-value">{currentAppointment.patients?.patient_id}</div></div>
                <div className="detail-row"><div className="detail-label">Service:</div><div className="detail-value">{currentAppointment.services?.service_name}</div></div>
                <div className="detail-row"><div className="detail-label">Doctor:</div><div className="detail-value">Dr. {currentAppointment.doctors?.first_name} {currentAppointment.doctors?.last_name}</div></div>
                <div className="detail-row"><div className="detail-label">Appointment Date:</div><div className="detail-value">{formatClinicDateTime(currentAppointment.appointment_datetime)}</div></div>
                <div className="detail-row"><div className="detail-label">Status:</div><div className="detail-value"><span className={`status-badge ${getStatusClass(currentAppointment.status)}`}>{currentAppointment.status.toUpperCase()}</span></div></div>
                {currentAppointment.remarks && <div className="detail-row"><div className="detail-label">Remarks:</div><div className="detail-value remarks-text">{currentAppointment.remarks}</div></div>}
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowPatientDetailsModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      {showRemarksModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && !savingRemarks && setShowRemarksModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Appointment documentation</h3><button className="modal-close" disabled={savingRemarks} onClick={() => setShowRemarksModal(false)}>&times;</button></div>
            <form onSubmit={saveRemarks}>
              <div className="modal-body">
                <p>New documentation is added below existing notes and appears in the patient's appointment information.</p>
                <div className="appointment-documentation-previous-notes">{currentAppointment?.remarks || 'No previous notes.'}</div>
                <fieldset disabled={savingRemarks} className="appointment-documentation-fields">
                <div className="form-group"><label>Service Remarks *</label><textarea className="form-control" rows="6" value={remarksForm.remarks} onChange={e => setRemarksForm({...remarksForm, remarks: e.target.value})} required /></div>
                <div className="form-row"><div className="form-group"><label>Follow-up Date</label><input type="date" className="form-control" value={remarksForm.follow_up_date} onChange={e => setRemarksForm({...remarksForm, follow_up_date: e.target.value})} /></div><div className="form-group"><label>Next Service</label><select className="form-control" value={remarksForm.next_service} onChange={e => setRemarksForm({...remarksForm, next_service: e.target.value})}><option value="">Select</option>{allServices.map(s => <option key={s.service_id} value={s.service_name}>{s.service_name}</option>)}</select></div></div>
                <div className="form-group"><label>Additional Notes</label><textarea className="form-control" rows="4" value={remarksForm.additional_notes} onChange={e => setRemarksForm({...remarksForm, additional_notes: e.target.value})} /></div>
                </fieldset>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={savingRemarks} onClick={() => setShowRemarksModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={savingRemarks}>{savingRemarks ? 'Saving…' : 'Add documentation'}</button></div>
            </form>
          </div>
        </div>
      )}

      {showRescheduleModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && !savingReschedule && setShowRescheduleModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Reschedule Appointment</h3><button disabled={savingReschedule} className="modal-close" onClick={() => setShowRescheduleModal(false)}>&times;</button></div>
            <form onSubmit={approveReschedule}>
              <div className="modal-body">
                <div className="form-group"><label>Current Time</label><input type="text" className="form-control" value={currentAppointment ? formatClinicDateTime(currentAppointment.appointment_datetime) : ''} disabled /></div>
                <div className="form-group"><label>New Date & Time (Philippine time)</label><input disabled={savingReschedule} type="datetime-local" className="form-control" value={rescheduleForm.new_datetime} onChange={e => setRescheduleForm({...rescheduleForm, new_datetime: e.target.value})} required min={toClinicDateTimeInput(new Date(Date.now() + 3600000))} /></div>
              </div>
              <div className="modal-footer"><button disabled={savingReschedule} type="button" className="btn btn-secondary" onClick={() => setShowRescheduleModal(false)}>Cancel</button><button disabled={savingReschedule} type="submit" className="btn btn-primary">Approve Reschedule</button></div>
            </form>
          </div>
        </div>
      )}

      {showRescheduleRequestModal && currentAppointment && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && !savingReschedule && setShowRescheduleRequestModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Review Reschedule Request</h3><button disabled={savingReschedule} className="modal-close" onClick={() => setShowRescheduleRequestModal(false)}>&times;</button></div>
            <div className="modal-body">
              <div><strong>Current Time:</strong> {formatClinicDateTime(currentAppointment.appointment_datetime)}</div>
              <div><strong>Patient Reason:</strong> {getAppointmentRequestReason(currentAppointment.remarks, 'reschedule')}</div>
              <div><strong>Requested Time:</strong> {currentAppointment.request_new_datetime ? formatClinicDateTime(currentAppointment.request_new_datetime) : 'Not specified'}</div>
              <div className="reject-reason-box"><label>Rejection Reason (optional)</label><textarea disabled={savingReschedule} className="form-control" rows="3" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional reason if rejecting..." /></div>
            </div>
            <div className="modal-footer">
              <button disabled={savingReschedule} className="btn btn-danger" onClick={() => handleRescheduleRequest('reject', rejectReason)}>Reject</button>
              <button disabled={savingReschedule} className="btn btn-success" onClick={() => handleRescheduleRequest('approve')}>Approve</button>
              <button disabled={savingReschedule} className="btn btn-secondary" onClick={() => setShowRescheduleRequestModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showCancelRequestModal && currentAppointment && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowCancelRequestModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Review Cancellation Request</h3><button className="modal-close" onClick={() => setShowCancelRequestModal(false)}>&times;</button></div>
            <div className="modal-body">
              <div><strong>Appointment Time:</strong> {formatClinicDateTime(currentAppointment.appointment_datetime)}</div>
              <div><strong>Patient Reason:</strong> {getAppointmentRequestReason(currentAppointment.remarks, 'cancellation')}</div>
              <div className="reject-reason-box"><label>Rejection Reason (optional)</label><textarea className="form-control" rows="3" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional reason if rejecting..." /></div>
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
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManageAppointments;
