import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import './MyAppointments.css';
import DentalLogo from '../../assets/DentalLogo.png';

const MyAppointments = () => {
  const { user, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [appointments, setAppointments] = useState([]);
  const [filteredAppointments, setFilteredAppointments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showRescheduleRequestModal, setShowRescheduleRequestModal] = useState(false);
  const [showCancelRequestModal, setShowCancelRequestModal] = useState(false);

  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [newDateTime, setNewDateTime] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [updateReason, setUpdateReason] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestNewDateTime, setRequestNewDateTime] = useState('');

  const [availableDates, setAvailableDates] = useState([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [serviceDuration, setServiceDuration] = useState(60);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userDetails?.status !== 'active') navigate('/');
    }
  }, [user, userDetails, authLoading, navigate]);

  const fetchAppointments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          doctors!inner (
            doctor_id,
            first_name,
            last_name,
            specialization
          ),
          services!inner (
            service_id,
            service_name,
            price,
            duration_minutes
          ),
          billing (
            total_amount,
            amount_paid,
            balance
          )
        `)
        .eq('patient_id', userDetails?.patient_id)
        .order('appointment_datetime', { ascending: false });

      if (error) throw error;
      
      const formattedData = data?.map(app => ({
        ...app,
        doctor_name: `Dr. ${app.doctors.first_name} ${app.doctors.last_name}`,
        specialization: app.doctors.specialization,
        service_name: app.services.service_name,
        service_price: app.services.price,
        duration_minutes: app.services.duration_minutes || 60,
        ...(app.billing && app.billing[0] ? {
          total_amount: app.billing[0].total_amount,
          amount_paid: app.billing[0].amount_paid,
          balance: app.billing[0].balance
        } : {})
      })) || [];
      
      setAppointments(formattedData);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      toast.error('Error loading appointments');
    }
  }, [userDetails?.patient_id]);

  useEffect(() => {
    if (userDetails) fetchAppointments();
  }, [userDetails, fetchAppointments]);

  useEffect(() => {
    let filtered = [...appointments];
    if (statusFilter !== 'all') {
      filtered = filtered.filter(app => app.status?.toLowerCase() === statusFilter.toLowerCase());
    }
    setFilteredAppointments(filtered);
    setCurrentPage(1);
  }, [appointments, statusFilter]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredAppointments.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredAppointments.length / itemsPerPage);
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  const getAppointmentStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return 'status-pending';
      case 'confirmed': return 'status-approved';
      case 'cancelled': return 'status-cancelled';
      case 'done': return 'status-done';
      default: return '';
    }
  };

  const canEditAppointment = (appointment) => {
    if (appointment.status !== 'pending') return false;
    const createdTime = new Date(appointment.created_at).getTime();
    const currentTime = new Date().getTime();
    const hoursSinceCreation = (currentTime - createdTime) / 3600000;
    return hoursSinceCreation <= 1;
  };

  const canCancelAppointment = (appointment) => {
    if (appointment.status !== 'pending') return false;
    const createdTime = new Date(appointment.created_at).getTime();
    const currentTime = new Date().getTime();
    const hoursSinceCreation = (currentTime - createdTime) / 3600000;
    return hoursSinceCreation <= 1;
  };

  const canRequestReschedule = (appointment) => {
    if (appointment.status !== 'confirmed') return false;
    if (appointment.request_status === 'pending') return false;
    const appointmentTime = new Date(appointment.appointment_datetime).getTime();
    const currentTime = new Date().getTime();
    const hoursBeforeAppointment = (appointmentTime - currentTime) / 3600000;
    return hoursBeforeAppointment >= 24;
  };

  const canRequestCancel = (appointment) => {
    if (appointment.status?.toLowerCase() !== 'confirmed') return false;
    if (appointment.request_status === 'pending') return false;
    const hoursBeforeAppointment = (new Date(appointment.appointment_datetime) - new Date()) / 3600000;
    return hoursBeforeAppointment >= 24;
  };

  const formatDateTime = (dateString) => new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatDate = (dateString) => new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const fetchAvailableDates = async (doctorId) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('doctor_availability')
        .select('available_date')
        .eq('doctor_id', doctorId)
        .eq('is_available', true)
        .gte('available_date', today)
        .order('available_date');
      if (error) throw error;
      const uniqueDates = [...new Set(data.map(d => d.available_date))];
      setAvailableDates(uniqueDates);
    } catch (error) {
      console.error('Error fetching dates:', error);
    }
  };

  const fetchAvailableTimeSlots = async (doctorId, date, duration) => {
    setLoadingTimeSlots(true);
    try {
      const { data: availability, error: availError } = await supabase
        .from('doctor_availability')
        .select('start_time, end_time')
        .eq('doctor_id', doctorId)
        .eq('available_date', date)
        .eq('is_available', true)
        .maybeSingle();
      if (availError || !availability) {
        setAvailableTimeSlots([]);
        return;
      }

      const { data: allAppointments, error: apptError } = await supabase
        .from('appointments')
        .select(`
          appointment_datetime,
          status,
          services!inner (duration_minutes)
        `)
        .eq('doctor_id', doctorId)
        .gte('appointment_datetime', `${date} 00:00:00`)
        .lt('appointment_datetime', `${date} 23:59:59`);
      if (apptError) throw apptError;

      const activeStatuses = ['pending', 'confirmed'];
      const existingApps = allAppointments.filter(apt =>
        activeStatuses.includes(apt.status?.toLowerCase())
      );

      const startTime = availability.start_time;
      const endTime = availability.end_time;
      const slotInterval = 30;
      const startDateTime = new Date(`${date}T${startTime}`);
      const endDateTime = new Date(`${date}T${endTime}`);
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        throw new Error('Invalid start/end time format');
      }

      const slots = [];
      let current = new Date(startDateTime);
      const now = new Date();
      const minStartTime = new Date(now.getTime() + duration * 60000);
      const isToday = date === now.toISOString().split('T')[0];

      while (current.getTime() + duration * 60000 <= endDateTime.getTime()) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + duration * 60000);
        let overlapping = false;
        for (const apt of existingApps) {
          const aptStart = new Date(apt.appointment_datetime);
          const aptDuration = apt.services?.duration_minutes || 60;
          const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);
          if (slotStart < aptEnd && slotEnd > aptStart) {
            overlapping = true;
            break;
          }
        }
        let valid = true;
        if (isToday && slotStart < minStartTime) valid = false;
        if (!overlapping && valid) {
          const timeStr = slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          slots.push({
            time: slotStart.toISOString().slice(11, 16),
            display: timeStr
          });
        }
        current = new Date(current.getTime() + slotInterval * 60000);
      }
      setAvailableTimeSlots(slots);
    } catch (error) {
      console.error('Error fetching time slots:', error);
      setAvailableTimeSlots([]);
    } finally {
      setLoadingTimeSlots(false);
    }
  };

  const generateCalendar = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvailable = availableDates.includes(dateStr);
      const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
      const isSelected = selectedDate === dateStr;
      days.push({ day, dateStr, isAvailable, isToday, isSelected });
    }
    return days;
  };

  const changeMonth = (delta) => {
    let newMonth = currentMonth + delta;
    let newYear = currentYear;
    if (newMonth < 0) { newMonth = 11; newYear--; }
    else if (newMonth > 11) { newMonth = 0; newYear++; }
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
  };

  const openViewModal = (appointment) => {
    setSelectedAppointment(appointment);
    setShowViewModal(true);
  };

  const openEditModal = async (appointment) => {
    setSelectedAppointment(appointment);
    setSelectedDate('');
    setSelectedTime('');
    setUpdateReason('');
    setNewDateTime('');
    setServiceDuration(appointment.duration_minutes || 60);
    await fetchAvailableDates(appointment.doctor_id);
    setShowEditModal(true);
  };

  const handleDateSelect = async (dateStr) => {
    setSelectedDate(dateStr);
    setSelectedTime('');
    setNewDateTime('');
    await fetchAvailableTimeSlots(selectedAppointment.doctor_id, dateStr, serviceDuration);
  };

  const handleTimeSelect = (timeObj) => {
    setSelectedTime(timeObj.time);
    setNewDateTime(`${selectedDate}T${timeObj.time}`);
  };

  const handleReschedule = async () => {
    if (!newDateTime || !updateReason) {
      toast.error('Please select a new date/time and provide a reason');
      return;
    }
    try {
      const { data: allOnDate, error: fetchErr } = await supabase
        .from('appointments')
        .select(`
          appointment_datetime,
          status,
          services!inner (duration_minutes)
        `)
        .eq('doctor_id', selectedAppointment.doctor_id)
        .gte('appointment_datetime', `${selectedDate} 00:00:00`)
        .lt('appointment_datetime', `${selectedDate} 23:59:59`);
      if (fetchErr) throw fetchErr;

      const slotStart = new Date(newDateTime);
      const slotEnd = new Date(slotStart.getTime() + serviceDuration * 60000);
      const activeStatuses = ['pending', 'confirmed'];
      const overlapping = allOnDate.filter(apt => {
        if (!activeStatuses.includes(apt.status?.toLowerCase())) return false;
        const aptStart = new Date(apt.appointment_datetime);
        const aptDuration = apt.services?.duration_minutes || 60;
        const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);
        return (slotStart < aptEnd && slotEnd > aptStart);
      });
      if (overlapping.length > 0) throw new Error('Time slot no longer available');

      const { error } = await supabase
        .from('appointments')
        .update({
          appointment_datetime: newDateTime,
          remarks: `${selectedAppointment.remarks || ''}\n[Rescheduled by Patient - ${new Date().toLocaleString()}]: Changed from ${formatDateTime(selectedAppointment.appointment_datetime)} to ${formatDateTime(newDateTime)} - Reason: ${updateReason}`
        })
        .eq('appointment_id', selectedAppointment.appointment_id)
        .eq('patient_id', userDetails.patient_id);
      if (error) throw error;

      toast.success('Appointment rescheduled successfully!');
      setShowEditModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error rescheduling:', error);
      toast.error(error.message);
    }
  };

  const openCancelModal = (appointment) => {
    setSelectedAppointment(appointment);
    setCancellationReason('');
    setShowCancelModal(true);
  };

  const handleCancelAppointment = async () => {
    if (!cancellationReason) {
      toast.error('Please provide a reason for cancellation');
      return;
    }
    try {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          remarks: `${selectedAppointment.remarks || ''}\n[Cancelled by Patient - ${new Date().toLocaleString()}]: ${cancellationReason}`
        })
        .eq('appointment_id', selectedAppointment.appointment_id)
        .eq('patient_id', userDetails.patient_id);
      if (error) throw error;
      toast.success('Appointment cancelled successfully!');
      setShowCancelModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error cancelling:', error);
      toast.error(error.message);
    }
  };

  const openRescheduleRequestModal = async (appointment) => {
    setSelectedAppointment(appointment);
    setRequestReason('');
    setRequestNewDateTime('');
    setSelectedDate('');
    setSelectedTime('');
    setServiceDuration(appointment.duration_minutes || 60);
    await fetchAvailableDates(appointment.doctor_id);
    setShowRescheduleRequestModal(true);
  };

  const openCancelRequestModal = (appointment) => {
    setSelectedAppointment(appointment);
    setRequestReason('');
    setShowCancelRequestModal(true);
  };

  const submitRescheduleRequest = async () => {
    if (!requestNewDateTime || !requestReason) {
      toast.error('Please select a new date/time and provide a reason');
      return;
    }
    try {
      const { data: allOnDate, error: fetchErr } = await supabase
        .from('appointments')
        .select(`
          appointment_datetime,
          status,
          services!inner (duration_minutes)
        `)
        .eq('doctor_id', selectedAppointment.doctor_id)
        .gte('appointment_datetime', `${selectedDate} 00:00:00`)
        .lt('appointment_datetime', `${selectedDate} 23:59:59`);
      if (fetchErr) throw fetchErr;

      const slotStart = new Date(requestNewDateTime);
      const slotEnd = new Date(slotStart.getTime() + serviceDuration * 60000);
      const activeStatuses = ['pending', 'confirmed'];
      const overlapping = allOnDate.filter(apt => {
        if (!activeStatuses.includes(apt.status?.toLowerCase())) return false;
        const aptStart = new Date(apt.appointment_datetime);
        const aptDuration = apt.services?.duration_minutes || 60;
        const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);
        return (slotStart < aptEnd && slotEnd > aptStart);
      });
      if (overlapping.length > 0) throw new Error('Requested time slot is not available');

      const { error } = await supabase
        .from('appointments')
        .update({
          request_type: 'reschedule',
          request_new_datetime: requestNewDateTime,
          request_status: 'pending',
          remarks: `${selectedAppointment.remarks || ''}\n[Reschedule Request - ${new Date().toLocaleString()}]: Requested new time: ${formatDateTime(requestNewDateTime)}. Reason: ${requestReason}`
        })
        .eq('appointment_id', selectedAppointment.appointment_id)
        .eq('patient_id', userDetails.patient_id);
      if (error) throw error;
      toast.success('Reschedule request submitted. The doctor will review it.');
      setShowRescheduleRequestModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error submitting request:', error);
      toast.error(error.message);
    }
  };

  const submitCancelRequest = async () => {
    if (!requestReason) {
      toast.error('Please provide a reason for cancellation');
      return;
    }
    try {
      const { error } = await supabase
        .from('appointments')
        .update({
          request_type: 'cancellation',
          request_status: 'pending',
          remarks: `${selectedAppointment.remarks || ''}\n[Cancellation Request - ${new Date().toLocaleString()}]: Reason: ${requestReason}`
        })
        .eq('appointment_id', selectedAppointment.appointment_id)
        .eq('patient_id', userDetails.patient_id);
      if (error) throw error;
      toast.success('Cancellation request submitted. The doctor will review it.');
      setShowCancelRequestModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error submitting request:', error);
      toast.error(error.message);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) return <div className="admin-loading"><div className="loading-spinner"></div><p>Loading...</p></div>;

  const patientName = userDetails?.first_name || 'User';

  return (
    <div className="my-appointments-page">
      <nav className="modern-nav">
        <div className="nav-container">
          <Link to="/my-appointments" className="logo">
            <img src={DentalLogo} alt="Fifthcusp Dental Clinic Logo" className="logo-image" />
            <div className="logo-text-wrapper">
              <span className="logo-main-text">Fifthcusp</span>
              <span className="logo-sub-text">Dental Clinic</span>
            </div>
          </Link>
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <i className={`fas fa-${mobileMenuOpen ? 'times' : 'bars'}`}></i>
          </button>
          <div className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}>
            <ul className="nav-links">
              <li><a href="/#services" onClick={() => setMobileMenuOpen(false)}>Services</a></li>
              <li><a href="/#about" onClick={() => setMobileMenuOpen(false)}>About Us</a></li>
              <li><a href="/#chatbot" onClick={() => setMobileMenuOpen(false)}>Chatbot</a></li>
            </ul>
            <div className="user-menu">
              <button className="user-dropdown-btn" onClick={() => setUserDropdownOpen(!userDropdownOpen)}>
                <i className="fas fa-user-circle"></i> {patientName}
                <i className={`fas fa-chevron-${userDropdownOpen ? 'up' : 'down'}`}></i>
              </button>
              <div className={`user-dropdown ${userDropdownOpen ? 'active' : ''}`}>
                <Link to="/book-appointment" onClick={() => setUserDropdownOpen(false)}><i className="fas fa-book"></i> Book Appointment</Link>
                <Link to="/my-appointments" onClick={() => setUserDropdownOpen(false)}><i className="fas fa-calendar-check"></i> My Appointments</Link>
                <Link to="/profile" onClick={() => setUserDropdownOpen(false)}><i className="fas fa-user"></i> My Profile</Link>
                <button onClick={handleLogout} className="dropdown-logout-btn"><i className="fas fa-sign-out-alt"></i> Logout</button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="my-appointments-container">
        <div className="page-header">
          <h1>My Appointments</h1>
          <p>View and manage your scheduled dental visits</p>
        </div>

        <div className="controls-bar">
          <div className="filter-group">
            <i className="fas fa-filter"></i>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
              <option value="all">All appointments</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div className="pagination-info">
            Showing {indexOfFirstItem + 1}–{Math.min(indexOfLastItem, filteredAppointments.length)} of {filteredAppointments.length}
          </div>
        </div>

        <div className="appointments-list">
          {currentItems.length === 0 ? (
            <div className="no-appointments">
              <i className="fas fa-calendar-times"></i>
              <h3>No Appointments Found</h3>
              <p>You haven't booked any appointments yet. Schedule your dental visit now!</p>
              <Link to="/book-appointment" className="btn-book">Book Appointment</Link>
            </div>
          ) : (
            currentItems.map(appointment => (
              <div key={appointment.appointment_id} className="appointment-card">
                <div className="card-left">
                  <div className="service-header">
                    <h3 className="service-name">{appointment.service_name}</h3>
                    <span className={`status-badge ${getAppointmentStatusClass(appointment.status)}`}>
                      {appointment.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="appointment-info">
                    <div className="info-row">
                      <i className="fas fa-user-md"></i>
                      <span>{appointment.doctor_name}</span>
                    </div>
                    <div className="info-row">
                      <i className="fas fa-calendar-alt"></i>
                      <span>{formatDateTime(appointment.appointment_datetime)}</span>
                    </div>
                    <div className="info-row">
                      <i className="fas fa-clock"></i>
                      <span>Booked on {formatDateTime(appointment.created_at)}</span>
                    </div>
                  </div>
                  {appointment.request_status === 'pending' && (
                    <div className="request-pending">
                      <i className="fas fa-hourglass-half"></i> {appointment.request_type === 'reschedule' ? 'Reschedule request pending approval' : 'Cancellation request pending approval'}
                    </div>
                  )}
                </div>
                <div className="card-right">
                  <button className="btn-view" onClick={() => openViewModal(appointment)}>
                    <i className="fas fa-eye"></i> View Details
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1} className="page-prev">
              <i className="fas fa-chevron-left"></i> Previous
            </button>
            <span className="page-current">Page {currentPage} of {totalPages}</span>
            <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages} className="page-next">
              Next <i className="fas fa-chevron-right"></i>
            </button>
          </div>
        )}

        <div className="policy-notice">
          <i className="fas fa-info-circle"></i>
          <div>
            <strong>Important reminders</strong>
            <ul>
              <li>Pending appointments can be edited or cancelled within 1 hour.</li>
              <li>Confirmed appointments require a request at least 24 hours in advance.</li>
              <li>Requests need doctor/admin approval.</li>
              <li>New appointment time must be at least 1 hour from now (duration‑based buffer applied).</li>
              <li>For emergency changes, please contact the clinic directly.</li>
            </ul>
          </div>
        </div>
      </div>

      {showEditModal && selectedAppointment && (
        <div className="appointment-modal-overlay active" onClick={() => setShowEditModal(false)}>
          <div className="appointment-modal-container" onClick={e => e.stopPropagation()}>
            <div className="appointment-modal-header">
              <h3>Edit/Reschedule Appointment</h3>
              <button className="appointment-modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <div className="appointment-modal-body">
              <div className="appointment-form-group">
                <label>Current Appointment</label>
                <p><strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong></p>
              </div>
              <div className="appointment-availability-section">
                <h4><i className="fas fa-calendar-check"></i> Select New Date & Time</h4>
                <div className="appointment-calendar-nav">
                  <button type="button" className="appointment-nav-btn" onClick={() => changeMonth(-1)}>
                    <i className="fas fa-chevron-left"></i> Prev
                  </button>
                  <div className="appointment-current-month">
                    {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </div>
                  <button type="button" className="appointment-nav-btn" onClick={() => changeMonth(1)}>
                    Next <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
                <div className="appointment-calendar-grid">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="appointment-calendar-header">{day}</div>
                  ))}
                  {generateCalendar().map((day, idx) => day ? (
                    <div 
                      key={idx} 
                      className={`appointment-calendar-day ${day.isAvailable ? 'available' : 'unavailable'} ${day.isToday ? 'today' : ''} ${day.isSelected ? 'selected' : ''}`}
                      onClick={() => day.isAvailable && handleDateSelect(day.dateStr)}
                    >
                      <div className="appointment-day-number">{day.day}</div>
                      <div className="appointment-day-status">{day.isAvailable ? 'Available' : 'Unavailable'}</div>
                    </div>
                  ) : (
                    <div key={idx} className="appointment-calendar-day unavailable"></div>
                  ))}
                </div>
                {selectedDate && (
                  <div className="appointment-timeslots-section">
                    <h4>Available Time Slots for {formatDate(selectedDate)}</h4>
                    {loadingTimeSlots ? (
                      <div className="appointment-loading-text">Loading time slots...</div>
                    ) : availableTimeSlots.length === 0 ? (
                      <div className="appointment-no-slots">No available time slots for this date.</div>
                    ) : (
                      <div className="appointment-timeslots-grid">
                        {availableTimeSlots.map(slot => (
                          <div 
                            key={slot.time} 
                            className={`appointment-timeslot ${selectedTime === slot.time ? 'selected' : ''}`}
                            onClick={() => handleTimeSelect(slot)}
                          >
                            {slot.display}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="appointment-form-group">
                <label>Reason for Rescheduling</label>
                <textarea 
                  value={updateReason} 
                  onChange={e => setUpdateReason(e.target.value)} 
                  placeholder="Please provide a reason" 
                  rows="3" 
                  required 
                />
              </div>
              <div className="appointment-form-actions">
                <button className="appointment-btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button className="appointment-btn-primary" onClick={handleReschedule} disabled={!newDateTime || !updateReason}>
                  Reschedule Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && selectedAppointment && (
        <div className="appointment-modal-overlay active" onClick={() => setShowCancelModal(false)}>
          <div className="appointment-modal-container" onClick={e => e.stopPropagation()}>
            <div className="appointment-modal-header">
              <h3>Cancel Appointment</h3>
              <button className="appointment-modal-close" onClick={() => setShowCancelModal(false)}>&times;</button>
            </div>
            <div className="appointment-modal-body">
              <p>Are you sure you want to cancel your appointment on <strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong>?</p>
              <p className="appointment-warning-text">
                <i className="fas fa-exclamation-triangle"></i> This action cannot be undone.
              </p>
              <div className="appointment-form-group">
                <label>Reason for Cancellation</label>
                <textarea 
                  value={cancellationReason} 
                  onChange={e => setCancellationReason(e.target.value)} 
                  placeholder="Please provide a reason" 
                  rows="3" 
                  required 
                />
              </div>
              <div className="appointment-form-actions">
                <button className="appointment-btn-secondary" onClick={() => setShowCancelModal(false)}>No, Keep Appointment</button>
                <button className="appointment-btn-danger" onClick={handleCancelAppointment} disabled={!cancellationReason}>
                  Yes, Cancel Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRescheduleRequestModal && selectedAppointment && (
        <div className="appointment-modal-overlay active" onClick={() => setShowRescheduleRequestModal(false)}>
          <div className="appointment-modal-container" onClick={e => e.stopPropagation()}>
            <div className="appointment-modal-header">
              <h3>Request Reschedule</h3>
              <button className="appointment-modal-close" onClick={() => setShowRescheduleRequestModal(false)}>&times;</button>
            </div>
            <div className="appointment-modal-body">
              <p>Current appointment: <strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong></p>
              <div className="appointment-availability-section">
                <h4><i className="fas fa-calendar-check"></i> Select New Date & Time</h4>
                <div className="appointment-calendar-nav">
                  <button type="button" className="appointment-nav-btn" onClick={() => changeMonth(-1)}>
                    <i className="fas fa-chevron-left"></i> Prev
                  </button>
                  <div className="appointment-current-month">
                    {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </div>
                  <button type="button" className="appointment-nav-btn" onClick={() => changeMonth(1)}>
                    Next <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
                <div className="appointment-calendar-grid">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="appointment-calendar-header">{day}</div>
                  ))}
                  {generateCalendar().map((day, idx) => day ? (
                    <div 
                      key={idx} 
                      className={`appointment-calendar-day ${day.isAvailable ? 'available' : 'unavailable'} ${day.isToday ? 'today' : ''} ${day.isSelected ? 'selected' : ''}`}
                      onClick={() => day.isAvailable && (() => { 
                        setSelectedDate(day.dateStr); 
                        setSelectedTime(''); 
                        fetchAvailableTimeSlots(selectedAppointment.doctor_id, day.dateStr, serviceDuration); 
                      })()}
                    >
                      <div className="appointment-day-number">{day.day}</div>
                      <div className="appointment-day-status">{day.isAvailable ? 'Available' : 'Unavailable'}</div>
                    </div>
                  ) : (
                    <div key={idx} className="appointment-calendar-day unavailable"></div>
                  ))}
                </div>
                {selectedDate && (
                  <div className="appointment-timeslots-section">
                    <h4>Available Time Slots for {formatDate(selectedDate)}</h4>
                    {loadingTimeSlots ? (
                      <div className="appointment-loading-text">Loading time slots...</div>
                    ) : availableTimeSlots.length === 0 ? (
                      <div className="appointment-no-slots">No available time slots for this date.</div>
                    ) : (
                      <div className="appointment-timeslots-grid">
                        {availableTimeSlots.map(slot => (
                          <div 
                            key={slot.time} 
                            className={`appointment-timeslot ${selectedTime === slot.time ? 'selected' : ''}`}
                            onClick={() => { 
                              setSelectedTime(slot.time); 
                              setRequestNewDateTime(`${selectedDate}T${slot.time}`);
                            }}
                          >
                            {slot.display}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="appointment-form-group">
                <label>Reason for Reschedule</label>
                <textarea 
                  value={requestReason} 
                  onChange={e => setRequestReason(e.target.value)} 
                  placeholder="Please provide a reason" 
                  rows="3" 
                  required 
                />
              </div>
              <div className="appointment-form-actions">
                <button className="appointment-btn-secondary" onClick={() => setShowRescheduleRequestModal(false)}>Cancel</button>
                <button className="appointment-btn-primary" onClick={submitRescheduleRequest} disabled={!requestNewDateTime || !requestReason}>
                  Submit Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelRequestModal && selectedAppointment && (
        <div className="appointment-modal-overlay active" onClick={() => setShowCancelRequestModal(false)}>
          <div className="appointment-modal-container" onClick={e => e.stopPropagation()}>
            <div className="appointment-modal-header">
              <h3>Request Cancellation</h3>
              <button className="appointment-modal-close" onClick={() => setShowCancelRequestModal(false)}>&times;</button>
            </div>
            <div className="appointment-modal-body">
              <p>You are requesting to cancel your confirmed appointment on <strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong>.</p>
              <p className="appointment-info-text">
                <i className="fas fa-info-circle"></i> This request requires approval from the doctor and admin.
              </p>
              <div className="appointment-form-group">
                <label>Reason for Cancellation</label>
                <textarea 
                  value={requestReason} 
                  onChange={e => setRequestReason(e.target.value)} 
                  placeholder="Please provide a reason" 
                  rows="3" 
                  required 
                />
              </div>
              <div className="appointment-form-actions">
                <button className="appointment-btn-secondary" onClick={() => setShowCancelRequestModal(false)}>Cancel</button>
                <button className="appointment-btn-primary" onClick={submitCancelRequest} disabled={!requestReason}>
                  Submit Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showViewModal && selectedAppointment && (
        <div className="appointment-modal-overlay active" onClick={() => setShowViewModal(false)}>
          <div className="appointment-modal-container" onClick={e => e.stopPropagation()}>
            <div className="appointment-modal-header">
              <h3>Appointment Details</h3>
              <button className="appointment-modal-close" onClick={() => setShowViewModal(false)}>&times;</button>
            </div>
            <div className="appointment-modal-body">
              <div className="appointment-details-grid">
                <div className="appointment-detail-row"><strong>Service:</strong> {selectedAppointment.service_name}</div>
                <div className="appointment-detail-row"><strong>Doctor:</strong> {selectedAppointment.doctor_name}</div>
                <div className="appointment-detail-row"><strong>Specialization:</strong> {selectedAppointment.specialization || 'General Dentist'}</div>
                <div className="appointment-detail-row"><strong>Date & Time:</strong> {formatDateTime(selectedAppointment.appointment_datetime)}</div>
                <div className="appointment-detail-row"><strong>Status:</strong> <span className={`appointment-status-badge ${getAppointmentStatusClass(selectedAppointment.status)}`}>{selectedAppointment.status?.toUpperCase()}</span></div>
                <div className="appointment-detail-row"><strong>Price:</strong> ₱{Number(selectedAppointment.service_price).toFixed(2)}</div>
                {selectedAppointment.remarks && <div className="appointment-detail-row full-width"><strong>Remarks:</strong> {selectedAppointment.remarks}</div>}
                {selectedAppointment.request_status === 'pending' && (
                  <div className="appointment-detail-row full-width"><strong>Request Status:</strong> Pending approval for {selectedAppointment.request_type === 'reschedule' ? 'reschedule' : 'cancellation'}</div>
                )}
              </div>
              <div className="appointment-modal-actions">
                {selectedAppointment.status === 'pending' && canEditAppointment(selectedAppointment) && (
                  <button className="appointment-btn-edit" onClick={() => { setShowViewModal(false); openEditModal(selectedAppointment); }}>
                    <i className="fas fa-edit"></i> Edit/Reschedule
                  </button>
                )}
                {selectedAppointment.status === 'pending' && canCancelAppointment(selectedAppointment) && (
                  <button className="appointment-btn-cancel" onClick={() => { setShowViewModal(false); openCancelModal(selectedAppointment); }}>
                    <i className="fas fa-times-circle"></i> Cancel Appointment
                  </button>
                )}
                {selectedAppointment.status === 'confirmed' && canRequestReschedule(selectedAppointment) && (
                  <button className="appointment-btn-edit" onClick={() => { setShowViewModal(false); openRescheduleRequestModal(selectedAppointment); }}>
                    <i className="fas fa-calendar-alt"></i> Request Reschedule
                  </button>
                )}
                {selectedAppointment.status === 'confirmed' && canRequestCancel(selectedAppointment) && (
                  <button className="appointment-btn-request-cancel" onClick={() => { setShowViewModal(false); openCancelRequestModal(selectedAppointment); }}>
                    <i className="fas fa-calendar-times"></i> Request Cancellation
                  </button>
                )}
                {selectedAppointment.status === 'confirmed' && selectedAppointment.request_status === 'pending' && (
                  <button className="appointment-btn-disabled" disabled>
                    <i className="fas fa-hourglass-half"></i> Request Pending
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}

      <ToastContainer position="bottom-right" autoClose={3000} />
    </div>
  );
};

export default MyAppointments;
