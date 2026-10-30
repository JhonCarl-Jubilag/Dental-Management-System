import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, doctorProfileFields } from '../../services/supabase';
import { loadDoctorBookingSlots } from '../../services/doctorScheduling';
import { appointmentWriteError, clinicDateTime, formatClinicDate, getClinicDate } from '../../utils/clinicScheduling';
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
  const submitting = useRef(false);
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
    let cancelled = false;
    if (!selectedServiceId) { setLoadingDoctors(false); return; }

    const loadDoctorsForService = async () => {
      setLoadingDoctors(true);
      setSelectedDoctorId('');
      setSelectedDate('');
      setSelectedTime('');
      setDoctors([]);
      setAvailableDates([]);
      setAvailableTimeSlots([]);
      const service = services.find(s => s.service_id === Number(selectedServiceId));
      setServiceDuration(service?.duration_minutes || 60);

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
          .select(doctorProfileFields)
          .in('doctor_id', doctorIds)
          .eq('status', 'active');
        if (docsError) throw docsError;
        if (!cancelled) setDoctors(doctorsData || []);
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load doctors');
      } finally {
        if (!cancelled) setLoadingDoctors(false);
      }
    };

    loadDoctorsForService();
    return () => { cancelled = true; };
  }, [selectedServiceId, services]);

  const handleDoctorChange = doctorId => {
    setSelectedDoctorId(doctorId);
    setSelectedDate('');
    setSelectedTime('');
    setAvailableDates([]);
    setAvailableTimeSlots([]);
  };

  useEffect(() => {
    let cancelled = false;
    if (!selectedDoctorId) { setLoadingDates(false); return; }
    const loadDates = async () => {
      setLoadingDates(true);
      try {
        const { data, error } = await supabase.from('doctor_availability')
          .select('available_date').eq('doctor_id', selectedDoctorId)
          .eq('is_available', true).gte('available_date', getClinicDate()).order('available_date');
        if (error) throw error;
        if (!cancelled) setAvailableDates([...new Set((data || []).map(item => item.available_date))].map(available_date => ({ available_date })));
      } catch (err) {
        if (!cancelled) toast.error('Failed to load available dates');
      } finally {
        if (!cancelled) setLoadingDates(false);
      }
    };
    loadDates();
    return () => { cancelled = true; };
  }, [selectedDoctorId]);

  const handleDateChange = date => {
    setSelectedDate(date);
    setSelectedTime('');
    setAvailableTimeSlots([]);
  };

  useEffect(() => {
    let cancelled = false;
    if (!selectedDate || !selectedDoctorId || !selectedServiceId) { setLoadingTimes(false); return; }
    const loadTimes = async () => {
      setLoadingTimes(true);
      try {
        const slots = await loadDoctorBookingSlots({
          doctorId: selectedDoctorId, serviceId: selectedServiceId, date: selectedDate,
          interval: 30, leadMinutes: serviceDuration,
        });
        if (!cancelled) {
          setAvailableTimeSlots(slots);
          if (!slots.length) toast.info('No available time slots for this date');
        }
      } catch (err) {
        if (!cancelled) { setAvailableTimeSlots([]); toast.error(err.message || 'Failed to load time slots'); }
      } finally {
        if (!cancelled) setLoadingTimes(false);
      }
    };
    loadTimes();
    return () => { cancelled = true; };
  }, [selectedDate, selectedDoctorId, selectedServiceId, serviceDuration]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedServiceId || !selectedDoctorId || !selectedDate || !selectedTime) {
      toast.error('Please fill all required fields');
      return;
    }

    if (submitting.current || loadingDoctors || loadingDates || loadingTimes) return;
    submitting.current = true;
    setIsSubmitting(true);
    setShowNotice(false);

    try {
      const appointmentDateTime = clinicDateTime(selectedDate, selectedTime);
      const slots = await loadDoctorBookingSlots({
        doctorId: selectedDoctorId, serviceId: selectedServiceId, date: selectedDate,
        interval: 30, leadMinutes: serviceDuration,
      });
      if (!slots.some(slot => slot.time === selectedTime)) {
        setSelectedTime('');
        setAvailableTimeSlots(slots);
        throw new Error('Time slot no longer available. Please choose another time.');
      }

      // The database derives ownership/status and checks the appointment limit.
      const { data: appointmentId, error: insertErr } = await supabase.rpc('book_patient_appointment', {
        p_doctor_id: Number(selectedDoctorId), p_service_id: Number(selectedServiceId),
        p_datetime: appointmentDateTime, p_notes: notes || null,
      });

      if (insertErr) throw insertErr.code === 'PGRST202'
        ? new Error('The patient privacy update has not been installed. Contact the clinic.') : appointmentWriteError(insertErr);
      if (!Number.isSafeInteger(Number(appointmentId)) || Number(appointmentId) <= 0) {
        throw new Error('Could not verify the booking. Refresh your appointments before trying again.');
      }

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
      submitting.current = false;
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
              <h2 className="section-title"><i className="fas fa-calendar-alt"></i> Select Date & Time (Philippine time)</h2>
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
                        {formatClinicDate(dateObj.available_date)}
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
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any specific requirements, concerns, or symptoms you'd like to mention..."
              />
            </div>
          </div>

          <div className="action-buttons">
            <button type="submit" className="btn btn-primary" disabled={isSubmitting || loadingDoctors || loadingDates || loadingTimes}>
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
