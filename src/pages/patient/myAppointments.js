import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import './MyAppointments.css';

const MyAppointments = () => {
  const { userDetails } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [newDateTime, setNewDateTime] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [updateReason, setUpdateReason] = useState('');
  
  // Calendar states
  const [availableDates, setAvailableDates] = useState([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  // Wrap fetchAppointments in useCallback
  const fetchAppointments = useCallback(async () => {
    setLoading(true);
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
            price
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
        ...(app.billing && app.billing[0] ? {
          total_amount: app.billing[0].total_amount,
          amount_paid: app.billing[0].amount_paid,
          balance: app.billing[0].balance
        } : {})
      })) || [];
      
      setAppointments(formattedData);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      setMessage({ type: 'error', text: 'Error loading appointments' });
    } finally {
      setLoading(false);
    }
  }, [userDetails?.patient_id]); // Add dependency

  useEffect(() => {
    if (userDetails) {
      fetchAppointments();
    }
  }, [userDetails, fetchAppointments]); // Add fetchAppointments to dependency

  const getAppointmentStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
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
    if (appointment.status !== 'approved') return false;
    const appointmentTime = new Date(appointment.appointment_datetime).getTime();
    const currentTime = new Date().getTime();
    const hoursBeforeAppointment = (appointmentTime - currentTime) / 3600000;
    return hoursBeforeAppointment >= 24;
  };

  const canRequestCancel = (appointment) => {
    if (appointment.status !== 'approved') return false;
    const appointmentTime = new Date(appointment.appointment_datetime).getTime();
    const currentTime = new Date().getTime();
    const hoursBeforeAppointment = (appointmentTime - currentTime) / 3600000;
    return hoursBeforeAppointment >= 24;
  };

  const fetchAvailableDates = async (doctorId) => {
    try {
      const { data, error } = await supabase
        .from('doctor_availability')
        .select('available_date')
        .eq('doctor_id', doctorId)
        .eq('is_available', true);

      if (error) throw error;
      setAvailableDates(data?.map(d => d.available_date) || []);
    } catch (error) {
      console.error('Error fetching dates:', error);
    }
  };

  const fetchAvailableTimeSlots = async (doctorId, date) => {
    try {
      const { data, error } = await supabase
        .rpc('get_available_time_slots', {
          p_doctor_id: doctorId,
          p_date: date,
          p_duration: 60
        });

      if (error) throw error;
      setAvailableTimeSlots(data || []);
    } catch (error) {
      console.error('Error fetching time slots:', error);
      setAvailableTimeSlots([]);
    }
  };

  const openEditModal = async (appointment) => {
    setSelectedAppointment(appointment);
    setSelectedDate('');
    setSelectedTime('');
    setUpdateReason('');
    setNewDateTime('');
    await fetchAvailableDates(appointment.doctor_id);
    setShowEditModal(true);
  };

  const openCancelModal = (appointment) => {
    setSelectedAppointment(appointment);
    setCancellationReason('');
    setShowCancelModal(true);
  };

  const openViewModal = (appointment) => {
    setSelectedAppointment(appointment);
    setShowViewModal(true);
  };

  const handleReschedule = async () => {
    if (!newDateTime || !updateReason) {
      setMessage({ type: 'error', text: 'Please select a new date/time and provide a reason' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('appointments')
        .update({
          appointment_datetime: newDateTime,
          remarks: `${selectedAppointment.remarks || ''}\n[Rescheduled by Patient - ${new Date().toLocaleString()}]: Changed from ${new Date(selectedAppointment.appointment_datetime).toLocaleString()} to ${new Date(newDateTime).toLocaleString()} - Reason: ${updateReason}`
        })
        .eq('appointment_id', selectedAppointment.appointment_id)
        .eq('patient_id', userDetails.patient_id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Appointment rescheduled successfully!' });
      setShowEditModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error rescheduling:', error);
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAppointment = async () => {
    if (!cancellationReason) {
      setMessage({ type: 'error', text: 'Please provide a reason for cancellation' });
      return;
    }

    setLoading(true);
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

      setMessage({ type: 'success', text: 'Appointment cancelled successfully!' });
      setShowCancelModal(false);
      fetchAppointments();
    } catch (error) {
      console.error('Error cancelling:', error);
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const generateCalendar = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();
    const days = [];

    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvailable = availableDates.includes(dateStr);
      const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
      const isSelected = selectedDate === dateStr;
      
      days.push({ day, dateStr, isAvailable, isToday, isSelected });
    }

    return days;
  };

  const handleDateSelect = async (dateStr) => {
    setSelectedDate(dateStr);
    setSelectedTime('');
    await fetchAvailableTimeSlots(selectedAppointment?.doctor_id, dateStr);
  };

  const handleTimeSelect = (time) => {
    setSelectedTime(time);
    const dateTime = `${selectedDate}T${time}`;
    setNewDateTime(dateTime);
  };

  const changeMonth = (delta) => {
    let newMonth = currentMonth + delta;
    let newYear = currentYear;
    
    if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    }
    
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
  };

  if (loading && appointments.length === 0) {
    return <div className="loading-container">Loading appointments...</div>;
  }

  return (
    <div className="my-appointments-container">
      <div className="page-header">
        <h1>My Appointments</h1>
        <p>View and manage your scheduled dental appointments</p>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type}`}>
          <i className={`fas fa-${message.type === 'success' ? 'check-circle' : 'exclamation-circle'}`}></i>
          {message.text}
        </div>
      )}

      <div className="appointments-section">
        <div className="section-header">
          <h2>Appointment History</h2>
          <div className="appointment-count">{appointments.length} Appointment(s)</div>
        </div>

        <div className="appointments-container">
          {appointments.length === 0 ? (
            <div className="no-appointments">
              <i className="fas fa-calendar-times"></i>
              <h3>No Appointments Found</h3>
              <p>You haven't booked any appointments yet. Schedule your dental visit now!</p>
              <a href="/book-appointment" className="btn-book">
                <i className="fas fa-plus-circle"></i> Book Appointment
              </a>
            </div>
          ) : (
            appointments.map(appointment => (
              <div key={appointment.appointment_id} className={`appointment-card ${appointment.status?.toLowerCase() || ''}`}>
                <div className="appointment-header">
                  <div className="appointment-title">
                    <h3>{appointment.service_name}</h3>
                    <p>with {appointment.doctor_name} • {appointment.specialization}</p>
                  </div>
                  <div className={`appointment-status ${getAppointmentStatusClass(appointment.status)}`}>
                    {appointment.status?.toUpperCase() || 'UNKNOWN'}
                  </div>
                </div>

                <div className="appointment-details">
                  <div className="detail-item">
                    <div className="detail-icon"><i className="fas fa-calendar-alt"></i></div>
                    <div className="detail-content">
                      <h4>Appointment Date & Time</h4>
                      <p>{formatDateTime(appointment.appointment_datetime)}</p>
                      <small>Booked on: {formatDateTime(appointment.created_at)}</small>
                    </div>
                  </div>

                  <div className="detail-item">
                    <div className="detail-icon"><i className="fas fa-user-md"></i></div>
                    <div className="detail-content">
                      <h4>Doctor</h4>
                      <p>{appointment.doctor_name}</p>
                    </div>
                  </div>

                  <div className="detail-item">
                    <div className="detail-icon"><i className="fas fa-stethoscope"></i></div>
                    <div className="detail-content">
                      <h4>Service</h4>
                      <p>{appointment.service_name}</p>
                    </div>
                  </div>

                  <div className="detail-item">
                    <div className="detail-icon"><i className="fas fa-money-bill-wave"></i></div>
                    <div className="detail-content">
                      <h4>Payment</h4>
                      <div className="payment-status">
                        <span className="price-tag">
                          <i className="fas fa-peso-sign"></i>
                          ₱{Number(appointment.service_price).toFixed(2)}
                        </span>
                        {appointment.balance !== undefined && (
                          <span className={`payment-badge ${appointment.balance === 0 ? 'payment-paid' : 'payment-pending'}`}>
                            {appointment.balance === 0 ? 'Paid' : 'Unpaid'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="appointment-actions">
                  <button className="btn-action btn-view" onClick={() => openViewModal(appointment)}>
                    <i className="fas fa-eye"></i> View Details
                  </button>
                  
                  {appointment.status === 'pending' && canEditAppointment(appointment) && (
                    <button className="btn-action btn-edit" onClick={() => openEditModal(appointment)}>
                      <i className="fas fa-edit"></i> Edit/Reschedule
                    </button>
                  )}
                  
                  {appointment.status === 'pending' && canCancelAppointment(appointment) && (
                    <button className="btn-action btn-cancel" onClick={() => openCancelModal(appointment)}>
                      <i className="fas fa-times-circle"></i> Cancel Appointment
                    </button>
                  )}
                  
                  {appointment.status === 'pending' && !canEditAppointment(appointment) && (
                    <button className="btn-action btn-disabled" disabled title="Can only edit within 1 hour after booking">
                      <i className="fas fa-edit"></i> Edit/Reschedule
                    </button>
                  )}
                  
                  {appointment.status === 'approved' && canRequestReschedule(appointment) && (
                    <button className="btn-action btn-edit" onClick={() => alert('Reschedule request feature coming soon')}>
                      <i className="fas fa-calendar-alt"></i> Request Reschedule
                    </button>
                  )}
                  
                  {appointment.status === 'approved' && canRequestCancel(appointment) && (
                    <button className="btn-action btn-request-cancel" onClick={() => alert('Cancellation request feature coming soon')}>
                      <i className="fas fa-calendar-times"></i> Request Cancellation
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="policy-notice">
        <h4><i className="fas fa-info-circle"></i> Important Notice</h4>
        <p>
          • <strong>Pending appointments</strong> can be edited or cancelled only within <strong>1 hour after booking</strong>.<br />
          • <strong>Approved appointments</strong> require reschedule/cancellation request at least <strong>24 hours before</strong> scheduled time.<br />
          • Reschedule and cancellation requests for approved appointments need doctor/admin approval.<br />
          • New appointment time must be at least 1 hour from now.<br />
          • For emergency changes, please contact the clinic directly.
        </p>
      </div>

      {/* Edit Modal */}
      {showEditModal && selectedAppointment && (
        <div className="modal active" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit/Reschedule Appointment</h3>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Current Appointment</label>
                <p><strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong></p>
              </div>

              <div className="availability-calendar">
                <h4><i className="fas fa-calendar-check"></i> Select New Date & Time</h4>
                
                <div className="calendar-navigation">
                  <button type="button" className="nav-btn" onClick={() => changeMonth(-1)}>
                    <i className="fas fa-chevron-left"></i> Prev
                  </button>
                  <div className="current-month">
                    {new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}
                  </div>
                  <button type="button" className="nav-btn" onClick={() => changeMonth(1)}>
                    Next <i className="fas fa-chevron-right"></i>
                  </button>
                </div>

                <div className="calendar-grid">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="calendar-header">{day}</div>
                  ))}
                  {generateCalendar().map((day, idx) => (
                    day ? (
                      <div
                        key={idx}
                        className={`calendar-day ${day.isAvailable ? 'available' : 'unavailable'} ${day.isToday ? 'today' : ''} ${day.isSelected ? 'selected' : ''}`}
                        onClick={() => day.isAvailable && handleDateSelect(day.dateStr)}
                      >
                        <div className="day-number">{day.day}</div>
                        <div className="day-status">{day.isAvailable ? 'Available' : 'Unavailable'}</div>
                      </div>
                    ) : (
                      <div key={idx} className="calendar-day unavailable"></div>
                    )
                  ))}
                </div>

                {selectedDate && availableTimeSlots.length > 0 && (
                  <div className="time-slots-container">
                    <h4>Available Time Slots for {formatDate(selectedDate)}</h4>
                    <div className="time-slots-grid">
                      {availableTimeSlots.map(slot => (
                        <div
                          key={slot}
                          className={`time-slot ${selectedTime === slot ? 'selected' : ''}`}
                          onClick={() => handleTimeSelect(slot)}
                        >
                          {slot}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDate && availableTimeSlots.length === 0 && (
                  <div className="availability-info">
                    <i className="fas fa-info-circle"></i> No available time slots for this date.
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Reason for Rescheduling</label>
                <textarea
                  value={updateReason}
                  onChange={e => setUpdateReason(e.target.value)}
                  placeholder="Please provide a reason for changing your appointment"
                  rows="3"
                  required
                />
              </div>

              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleReschedule} disabled={!newDateTime || !updateReason}>
                  Reschedule Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && selectedAppointment && (
        <div className="modal active" onClick={() => setShowCancelModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Cancel Appointment</h3>
              <button className="modal-close" onClick={() => setShowCancelModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to cancel your appointment on <strong>{formatDateTime(selectedAppointment.appointment_datetime)}</strong>?</p>
              <p className="warning-text"><i className="fas fa-exclamation-triangle"></i> This will immediately cancel your pending appointment. This action cannot be undone.</p>
              
              <div className="form-group">
                <label>Reason for Cancellation</label>
                <textarea
                  value={cancellationReason}
                  onChange={e => setCancellationReason(e.target.value)}
                  placeholder="Please provide a reason for cancellation"
                  rows="3"
                  required
                />
              </div>

              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => setShowCancelModal(false)}>No, Keep Appointment</button>
                <button className="btn btn-danger" onClick={handleCancelAppointment} disabled={!cancellationReason}>
                  Yes, Cancel Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && selectedAppointment && (
        <div className="modal active" onClick={() => setShowViewModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Appointment Details</h3>
              <button className="modal-close" onClick={() => setShowViewModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="details-grid">
                <div className="detail-row">
                  <strong>Service:</strong> {selectedAppointment.service_name}
                </div>
                <div className="detail-row">
                  <strong>Doctor:</strong> {selectedAppointment.doctor_name}
                </div>
                <div className="detail-row">
                  <strong>Specialization:</strong> {selectedAppointment.specialization}
                </div>
                <div className="detail-row">
                  <strong>Date & Time:</strong> {formatDateTime(selectedAppointment.appointment_datetime)}
                </div>
                <div className="detail-row">
                  <strong>Status:</strong> <span className={`status-badge ${getAppointmentStatusClass(selectedAppointment.status)}`}>{selectedAppointment.status?.toUpperCase() || 'UNKNOWN'}</span>
                </div>
                <div className="detail-row">
                  <strong>Price:</strong> ₱{Number(selectedAppointment.service_price).toFixed(2)}
                </div>
                {selectedAppointment.remarks && (
                  <div className="detail-row">
                    <strong>Remarks:</strong> {selectedAppointment.remarks}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyAppointments;