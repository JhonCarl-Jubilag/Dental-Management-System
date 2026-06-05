import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import './bookAppointment.css';
import DentalLogo from '../../assets/DentalLogo.png';

const BookAppointment = () => {
  const [searchParams] = useSearchParams();
  const preselectedServiceId = searchParams.get('service_id');

  const { user, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [services, setServices] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotice, setShowNotice] = useState(false);
  const [availableDates, setAvailableDates] = useState([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState([]);
  const [serviceDuration, setServiceDuration] = useState(60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingTimes, setLoadingTimes] = useState(false);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userDetails?.status !== 'active') navigate('/');
    }
  }, [user, userDetails, authLoading, navigate]);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const { data, error } = await supabase
          .from('services')
          .select('*')
          .eq('status', 'active')
          .order('service_name');
        if (error) throw error;
        setServices(data || []);

        if (preselectedServiceId && data) {
          const exists = data.some(s => s.service_id === parseInt(preselectedServiceId));
          if (exists) {
            setSelectedServiceId(preselectedServiceId);
          }
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to load services');
      }
    };

    fetchServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedServiceId) return;

    const loadDoctorsForService = async () => {
      setLoadingDoctors(true);
      setSelectedDoctorId('');
      setSelectedDate('');
      setSelectedTime('');
      setDoctors([]);
      setAvailableDates([]);
      setAvailableTimeSlots([]);

      try {
        const { data: docServices, error: dsError } = await supabase
          .from('doctor_services')
          .select('doctor_id')
          .eq('service_id', selectedServiceId)
          .eq('status', 'active');
        if (dsError) throw dsError;

        if (!docServices || docServices.length === 0) return;

        const doctorIds = docServices.map(ds => ds.doctor_id);
        const { data: doctorsData, error: docsError } = await supabase
          .from('doctors')
          .select('*')
          .in('doctor_id', doctorIds)
          .eq('status', 'active');
        if (docsError) throw docsError;

        setDoctors(doctorsData || []);

        const service = services.find(s => s.service_id === Number(selectedServiceId));
        setServiceDuration(service?.duration_minutes || 60);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load doctors');
      } finally {
        setLoadingDoctors(false);
      }
    };

    loadDoctorsForService();
  }, [selectedServiceId, services]);

  const handleDoctorChange = async (doctorId) => {
    setSelectedDoctorId(doctorId);
    setSelectedDate('');
    setSelectedTime('');
    setAvailableDates([]);
    setAvailableTimeSlots([]);

    if (!doctorId) return;

    setLoadingDates(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('doctor_availability')
        .select('available_date, start_time, end_time')
        .eq('doctor_id', doctorId)
        .eq('is_available', true)
        .gte('available_date', today)
        .order('available_date');
      if (error) throw error;

      const unique = [];
      const seen = new Set();
      for (const item of data) {
        if (!seen.has(item.available_date)) {
          seen.add(item.available_date);
          unique.push(item);
        }
      }
      setAvailableDates(unique);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load available dates');
    } finally {
      setLoadingDates(false);
    }
  };

  const handleDateChange = async (date) => {
    setSelectedDate(date);
    setSelectedTime('');
    setAvailableTimeSlots([]);

    if (!date || !selectedDoctorId || !selectedServiceId) return;

    setLoadingTimes(true);
    try {
      const { data: availability, error: availError } = await supabase
        .from('doctor_availability')
        .select('start_time, end_time')
        .eq('doctor_id', selectedDoctorId)
        .eq('available_date', date)
        .eq('is_available', true)
        .maybeSingle();

      if (availError || !availability) {
        toast.error('Doctor not available on this date');
        setLoadingTimes(false);
        return;
      }

      const { data: allAppointments, error: apptError } = await supabase
        .from('appointments')
        .select(`
          appointment_datetime,
          status,
          services!inner (duration_minutes)
        `)
        .eq('doctor_id', selectedDoctorId)
        .gte('appointment_datetime', `${date} 00:00:00`)
        .lt('appointment_datetime', `${date} 23:59:59`);
      if (apptError) throw apptError;

      const activeStatuses = ['pending', 'approved'];
      const existingApps = allAppointments.filter(apt =>
        activeStatuses.includes(apt.status?.toLowerCase())
      );

      const startTime = availability.start_time;
      const endTime = availability.end_time;
      const duration = serviceDuration;
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
        if (isToday && slotStart < minStartTime) {
          valid = false;
        }

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
      if (slots.length === 0) toast.info('No available time slots for this date');
    } catch (err) {
      console.error('Error generating slots:', err);
      toast.error('Failed to load time slots');
    } finally {
      setLoadingTimes(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedServiceId || !selectedDoctorId || !selectedDate || !selectedTime) {
      toast.error('Please fill all required fields');
      return;
    }

    setIsSubmitting(true);
    setShowNotice(false);

    try {
      const appointmentDateTime = `${selectedDate} ${selectedTime}:00`;
      const patientId = userDetails?.patient_id;

      // 1. Check doctor availability
      const { data: availCheck, error: availErr } = await supabase
        .from('doctor_availability')
        .select('availability_id')
        .eq('doctor_id', selectedDoctorId)
        .eq('available_date', selectedDate)
        .eq('is_available', true)
        .maybeSingle();

      if (availErr || !availCheck) {
        throw new Error('Doctor not available on this date');
      }

      // 2. Check overlapping appointments on same doctor
      const { data: allOnDate, error: fetchErr } = await supabase
        .from('appointments')
        .select(`
          appointment_datetime,
          status,
          services!inner (duration_minutes)
        `)
        .eq('doctor_id', selectedDoctorId)
        .gte('appointment_datetime', `${selectedDate} 00:00:00`)
        .lt('appointment_datetime', `${selectedDate} 23:59:59`);
      if (fetchErr) throw fetchErr;

      const slotStart = new Date(appointmentDateTime);
      const slotEnd = new Date(slotStart.getTime() + serviceDuration * 60000);
      const activeStatuses = ['pending', 'approved'];
      const overlapping = allOnDate.filter(apt => {
        if (!activeStatuses.includes(apt.status?.toLowerCase())) return false;
        const aptStart = new Date(apt.appointment_datetime);
        const aptDuration = apt.services?.duration_minutes || 60;
        const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);
        return (slotStart < aptEnd && slotEnd > aptStart);
      });

      if (overlapping.length > 0) throw new Error('Time slot no longer available');

      // 3. Check global active appointment limit (max 3 total pending/confirmed)
      const { count: activeCount, error: countError } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('patient_id', patientId)
        .in('status', ['pending', 'confirmed']);

      if (countError) throw countError;
      if (activeCount >= 3) {
        throw new Error('Only 3 active appointments allowed. Cancel or finish one first.');
      }

      // 4. Insert appointment
      const { error: insertErr } = await supabase
        .from('appointments')
        .insert([{
          patient_id: patientId,
          doctor_id: selectedDoctorId,
          service_id: selectedServiceId,
          appointment_datetime: appointmentDateTime,
          remarks: notes || null,
          status: 'pending'
        }]);

      if (insertErr) throw insertErr;

      toast.success('Appointment booked successfully! We will confirm your appointment shortly.');
      setShowNotice(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Reset form
      setSelectedServiceId('');
      setSelectedDoctorId('');
      setSelectedDate('');
      setSelectedTime('');
      setNotes('');
      setDoctors([]);
      setAvailableDates([]);
      setAvailableTimeSlots([]);
    } catch (err) {
      console.error('Booking error:', err);
      toast.error(err.message || 'Failed to book appointment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) return <div className="admin-loading"><div className="loading-spinner"></div><p>Loading...</p></div>;
  if (!user || userDetails?.status !== 'active') return null;

  const userName = userDetails?.first_name || 'User';

  return (
    <div className="booking-page">
      <nav className="modern-nav">
        <div className="nav-container">
          <Link to="/book-appointment" className="logo">
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
                <i className="fas fa-user-circle"></i> {userName}
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

      <div className="booking-container">
        <div className="booking-header">
          <h1>Book Your Appointment</h1>
          <p>Schedule your dental visit with our specialized doctors</p>
        </div>

        {/* Important Notice */}
        {showNotice && (
          <div className="important-notice">
            <div className="notice-header">
              <i className="fas fa-info-circle"></i>
              <h3>Important Notice</h3>
              <button className="notice-close" onClick={() => setShowNotice(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <ul className="notice-list">
              <li><i className="fas fa-clock"></i> Pending appointments can be edited or cancelled only within 1 hour after booking.</li>
              <li><i className="fas fa-calendar-check"></i> Confirmed appointments require reschedule/cancellation request at least 24 hours before scheduled time.</li>
              <li><i className="fas fa-exchange-alt"></i> Reschedule and cancellation requests for confirmed appointments need doctor/admin approval.</li>
              <li><i className="fas fa-hourglass-half"></i> New appointment time must be at least 1 hour from now (duration‑based buffer applied).</li>
              <li><i className="fas fa-phone-alt"></i> For emergency changes, please contact the clinic directly.</li>
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="booking-form">
          <div className="form-section">
            <h2 className="section-title"><i className="fas fa-tooth"></i> Select Service</h2>
            <div className="form-group">
              <label className="form-label required">Dental Service</label>
              <select
                className="form-control"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                required
              >
                <option value="">Choose a service...</option>
                {services.map(service => (
                  <option key={service.service_id} value={service.service_id}>
                    {service.service_name} - ₱{Number(service.price).toFixed(2)}
                    {service.duration_minutes && ` (${Math.floor(service.duration_minutes / 60)}h ${service.duration_minutes % 60}m)`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedServiceId && (
            <div className="form-section">
              <h2 className="section-title"><i className="fas fa-user-md"></i> Select Specialist</h2>
              <div className="form-group">
                <label className="form-label required">Available Doctors</label>
                {loadingDoctors ? (
                  <div className="loading-text">Loading doctors...</div>
                ) : doctors.length === 0 ? (
                  <div className="alert alert-info">No doctors available for this service.</div>
                ) : (
                  <div className="doctor-options">
                    {doctors.map(doctor => (
                      <div
                        key={doctor.doctor_id}
                        className={`doctor-option ${selectedDoctorId === doctor.doctor_id ? 'selected' : ''}`}
                        onClick={() => handleDoctorChange(doctor.doctor_id)}
                      >
                        <div className="doctor-avatar">{doctor.first_name?.[0]}{doctor.last_name?.[0]}</div>
                        <div className="doctor-info">
                          <div className="doctor-name">Dr. {doctor.first_name} {doctor.last_name}</div>
                          <div className="doctor-specialization">{doctor.specialization || 'General Dentist'}</div>
                          <div className="doctor-details">
                            <span><i className="fas fa-envelope"></i> {doctor.email}</span>
                            <span><i className="fas fa-phone"></i> {doctor.contact_no || 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedDoctorId && (
            <div className="form-section">
              <h2 className="section-title"><i className="fas fa-calendar-alt"></i> Select Date & Time</h2>
              <div className="form-group">
                <label className="form-label required">Preferred Date</label>
                {loadingDates ? (
                  <div className="loading-text">Loading dates...</div>
                ) : (
                  <select
                    className="form-control"
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    required
                  >
                    <option value="">Choose a date...</option>
                    {availableDates.map(dateObj => (
                      <option key={dateObj.available_date} value={dateObj.available_date}>
                        {new Date(dateObj.available_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {selectedDate && (
                <div className="form-group">
                  <label className="form-label required">Preferred Time</label>
                  {loadingTimes ? (
                    <div className="loading-text">Loading time slots...</div>
                  ) : availableTimeSlots.length === 0 ? (
                    <div className="alert alert-info">No available time slots for this date. Please select another date.</div>
                  ) : (
                    <div className="time-slots-grid">
                      {availableTimeSlots.map(slot => (
                        <div
                          key={slot.time}
                          className={`time-slot ${selectedTime === slot.time ? 'selected' : ''}`}
                          onClick={() => setSelectedTime(slot.time)}
                        >
                          {slot.display}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-section">
            <h2 className="section-title"><i className="fas fa-notes-medical"></i> Additional Information</h2>
            <div className="form-group">
              <label className="form-label">Notes (Optional)</label>
              <textarea
                className="form-control"
                rows="4"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any specific requirements, concerns, or symptoms you'd like to mention..."
              />
            </div>
          </div>

          <div className="action-buttons">
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <><i className="fas fa-spinner fa-spin"></i> Processing...</> : <><i className="fas fa-calendar-check"></i> Book Appointment</>}
            </button>
            <Link to="/" className="btn btn-secondary"><i className="fas fa-times"></i> Cancel</Link>
          </div>
        </form>
      </div>

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

export default BookAppointment;