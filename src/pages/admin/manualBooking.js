import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import { loadDoctorBookingSlots } from '../../services/doctorScheduling';
import { appointmentWriteError, clinicDateTime, formatClinicDate, formatClinicTime, getClinicDate } from '../../utils/clinicScheduling';
import './manualBooking.css';

const ManualBooking = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const busy = loading || loadingDoctors || loadingDates || loadingTimes;
  const submitting = useRef(false);
  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState([]);

  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [showPatientOptions, setShowPatientOptions] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedServiceDuration, setSelectedServiceDuration] = useState(60);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [notes, setNotes] = useState('');

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (!isClinicUser(userType)) navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  // Fetch patients
  useEffect(() => {
    const fetchPatients = async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('patient_id, first_name, last_name, email, contact_no')
        .eq('status', 'active')
        .order('last_name');
      if (!error) setPatients(data || []);
    };
    fetchPatients();
  }, []);

  // Fetch services
  useEffect(() => {
    const fetchServices = async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('status', 'active')
        .order('service_name');
      if (!error) setServices(data || []);
    };
    fetchServices();
  }, []);

  const filteredPatients = patients.filter(p =>
    `${p.first_name} ${p.last_name} ${p.email} ${p.contact_no || ''}`
      .toLowerCase()
      .includes(patientSearch.toLowerCase())
  );

  const handleSelectPatient = (patient) => {
    setSelectedPatient(patient);
    setPatientSearch(`${patient.first_name} ${patient.last_name}`);
    setShowPatientOptions(false);
  };

  // Load doctors for selected service
  useEffect(() => {
    let cancelled = false;
    const fetchDoctorsForService = async () => {
      if (!selectedServiceId) {
        setDoctors([]);
        setLoadingDoctors(false);
        return;
      }
      setLoadingDoctors(true);
      try {
        const { data, error } = await supabase
          .from('doctor_services')
          .select(`
            doctor_id,
            doctors!inner (doctor_id, first_name, last_name, specialization, email, contact_no, status)
          `)
          .eq('service_id', selectedServiceId)
          .eq('status', 'active')
          .eq('doctors.status', 'active');

        if (error) throw error;
        const doctorsList = data.map(item => item.doctors);
        if (!cancelled) setDoctors(doctorsList);
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      } finally {
        if (!cancelled) setLoadingDoctors(false);
      }
    };
    fetchDoctorsForService();
    return () => { cancelled = true; };
  }, [selectedServiceId]);

  // Fetch available dates for selected doctor
  useEffect(() => {
    let cancelled = false;
    const fetchAvailableDates = async () => {
      if (!selectedDoctorId) { setLoadingDates(false); return; }
      setLoadingDates(true);
      try {
        const today = getClinicDate();
        const { data, error } = await supabase
          .from('doctor_availability')
          .select('available_date')
          .eq('doctor_id', selectedDoctorId)
          .eq('is_available', true)
          .gte('available_date', today)
          .order('available_date');

        if (error) throw error;
        if (!cancelled) setAvailableDates([...new Set((data || []).map(d => d.available_date))]);
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      } finally {
        if (!cancelled) setLoadingDates(false);
      }
    };
    fetchAvailableDates();
    return () => { cancelled = true; };
  }, [selectedDoctorId]);

  useEffect(() => {
    let cancelled = false;
    setAvailableTimeSlots([]);
    setSelectedTime('');
    if (!selectedDoctorId || !selectedDate || !selectedServiceId) { setLoadingTimes(false); return; }
    const fetchTimeSlots = async () => {
      setLoadingTimes(true);
      try {
        const slots = await loadDoctorBookingSlots({
          doctorId: selectedDoctorId, serviceId: selectedServiceId, date: selectedDate,
          interval: selectedServiceDuration,
        });
        if (!cancelled) setAvailableTimeSlots(slots.map(slot => slot.time));
      } catch (err) {
        if (!cancelled) { toast.error(err.message); setAvailableTimeSlots([]); }
      } finally {
        if (!cancelled) setLoadingTimes(false);
      }
    };
    fetchTimeSlots();
    return () => { cancelled = true; };
  }, [selectedDoctorId, selectedDate, selectedServiceId, selectedServiceDuration]);

  const handleServiceChange = (e) => {
    const serviceId = e.target.value;
    setSelectedServiceId(serviceId);
    const service = services.find(s => s.service_id === parseInt(serviceId));
    setSelectedServiceDuration(service?.duration_minutes || 60);
    setSelectedDoctorId('');
    setSelectedDate('');
    setSelectedTime('');
    setDoctors([]);
    setAvailableDates([]);
    setAvailableTimeSlots([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient || !selectedServiceId || !selectedDoctorId || !selectedDate || !selectedTime) {
      toast.error('Please fill all required fields.');
      return;
    }

    if (submitting.current || busy) return;
    submitting.current = true;
    setLoading(true);

    try {
      const appointmentDatetime = clinicDateTime(selectedDate, selectedTime);
      const slots = await loadDoctorBookingSlots({
        doctorId: selectedDoctorId, serviceId: selectedServiceId, date: selectedDate,
        interval: selectedServiceDuration,
      });
      if (!slots.some(slot => slot.time === selectedTime)) {
        setSelectedTime('');
        setAvailableTimeSlots(slots.map(slot => slot.time));
        throw new Error('Time slot no longer available. Please choose another time.');
      }
      // Insert appointment as 'confirmed' (walk‑in)
      const { data: newAppointment, error: insertError } = await supabase
        .from('appointments')
        .insert({
          patient_id: selectedPatient.patient_id,
          doctor_id: parseInt(selectedDoctorId),
          service_id: parseInt(selectedServiceId),
          appointment_datetime: appointmentDatetime,
          remarks: notes ? `${notes}\n[Manual Booking by Admin ${new Date().toLocaleString()}]` : `[Manual Booking by Admin ${new Date().toLocaleString()}]`,
          status: 'confirmed',
          created_at: new Date().toISOString()
        })
        .select();

      if (insertError) throw appointmentWriteError(insertError);

      const appointmentId = newAppointment[0].appointment_id;
      const service = services.find(s => s.service_id === parseInt(selectedServiceId));
      const totalAmount = service.price;

      const { error: billError } = await supabase
        .from('billing')
        .insert({
          appointment_id: appointmentId,
          patient_id: selectedPatient.patient_id,
          doctor_id: parseInt(selectedDoctorId),
          total_amount: totalAmount,
          amount_paid: 0,
          balance: totalAmount,
          remarks: 'Appointment created by admin (walk‑in)'
        });

      if (billError) console.error('Billing creation error:', billError);

      toast.success(`Appointment booked successfully for ${selectedPatient.first_name} ${selectedPatient.last_name}!`);
      // Reset form
      setSelectedPatient(null);
      setPatientSearch('');
      setSelectedServiceId('');
      setSelectedDoctorId('');
      setSelectedDate('');
      setSelectedTime('');
      setNotes('');
      setDoctors([]);
      setAvailableDates([]);
      setAvailableTimeSlots([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) return <div className="admin-loading"><div className="loading-spinner"></div><p>Loading...</p></div>;

  const isSuperAdmin = isOwner(userType);
  if (!user || (!isClinicUser(userType))) return null;
  const adminName = isSuperAdmin ? 'Super Admin' : user?.email?.split('@')[0] || 'Admin';

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />
      <div className="main-content manual-booking-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manual Appointment Booking</h1>
            <p className="welcome-message">Schedule walk‑in appointments (status automatically confirmed)</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">{adminName.charAt(0).toUpperCase()}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">{roleLabel(userType)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="booking-form-container">
          <form onSubmit={handleSubmit} className="booking-form">
            {/* Patient Section */}
            <div className="form-section">
              <h2><i className="fas fa-user-injured"></i> Patient</h2>
              <div className="form-group">
                <label className="required">Search / Select Patient</label>
                <div className="patient-search-wrapper">
                  <input
                    type="text"
                    placeholder="Type name, email, or phone..."
                    value={patientSearch}
                    onChange={(e) => {
                      setPatientSearch(e.target.value);
                      setShowPatientOptions(true);
                      if (!e.target.value) setSelectedPatient(null);
                    }}
                    onFocus={() => setShowPatientOptions(true)}
                    className="form-control"
                  />
                  {showPatientOptions && filteredPatients.length > 0 && (
                    <div className="patient-options">
                      {filteredPatients.map(p => (
                        <div key={p.patient_id} className="patient-option" onClick={() => handleSelectPatient(p)}>
                          <div className="patient-avatar">
                            {`${p.first_name[0]}${p.last_name[0]}`.toUpperCase()}
                          </div>
                          <div className="patient-info">
                            <div className="patient-name">{p.first_name} {p.last_name}</div>
                            <div className="patient-contact">{p.email} {p.contact_no ? `| ${p.contact_no}` : ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedPatient && (
                  <div className="selected-patient">
                    <i className="fas fa-check-circle"></i> Selected: {selectedPatient.first_name} {selectedPatient.last_name}
                  </div>
                )}
              </div>
            </div>

            {/* Service Section */}
            <div className="form-section">
              <h2><i className="fas fa-tooth"></i> Service</h2>
              <div className="form-group">
                <label className="required">Dental Service</label>
                <select className="form-control" value={selectedServiceId} onChange={handleServiceChange} required>
                  <option value="">Choose a service...</option>
                  {services.map(s => (
                    <option key={s.service_id} value={s.service_id}>
                      {s.service_name} – ₱{Number(s.price).toFixed(2)} (duration: {s.duration_minutes} min)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Doctor Section */}
            <div className="form-section">
              <h2><i className="fas fa-user-md"></i> Specialist</h2>
              <div className="form-group">
                <label className="required">Doctor</label>
                {selectedServiceId ? (
                  <select
                    className="form-control"
                    value={selectedDoctorId}
                    onChange={e => {
                      setSelectedDoctorId(e.target.value);
                      setSelectedDate(''); setSelectedTime('');
                      setAvailableDates([]); setAvailableTimeSlots([]);
                    }}
                    required
                  >
                    <option value="">Select a doctor...</option>
                    {doctors.map(d => (
                      <option key={d.doctor_id} value={d.doctor_id}>
                        Dr. {d.first_name} {d.last_name} – {d.specialization}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="info-message">Select a service first to see available doctors.</div>
                )}
              </div>
            </div>

            {/* Date Section */}
            <div className="form-section">
              <h2><i className="fas fa-calendar-alt"></i> Date & Time (Philippine time)</h2>
              <div className="form-group">
                <label className="required">Date</label>
                <select
                  className="form-control"
                  value={selectedDate}
                  onChange={e => {
                    setSelectedDate(e.target.value); setSelectedTime(''); setAvailableTimeSlots([]);
                  }}
                  disabled={!selectedDoctorId}
                  required
                >
                  <option value="">Select a date...</option>
                  {availableDates.map(date => (
                    <option key={date} value={date}>
                      {formatClinicDate(date)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Time Slots */}
              {selectedDate && (
                <div className="form-group">
                  <label className="required">Available Time Slots</label>
                  {loadingTimes ? (
                    <div className="loading-slots">Loading available slots...</div>
                  ) : availableTimeSlots.length > 0 ? (
                    <div className="time-slots-grid">
                      {availableTimeSlots.map(time => (
                        <button
                          key={time}
                          type="button"
                          className={`time-slot-btn ${selectedTime === time ? 'selected' : ''}`}
                          onClick={() => setSelectedTime(time)}
                        >
                          {formatClinicTime(time)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="info-message">No available time slots for this date.</div>
                  )}
                  {selectedTime && (
                    <div className="selected-time-info">
                      <i className="fas fa-clock"></i> Selected time: {formatClinicTime(selectedTime)}
                    </div>
                  )}
                </div>
              )}

              {selectedServiceDuration && selectedDate && (
                <div className="duration-info">
                  <i className="fas fa-clock"></i> This service takes {selectedServiceDuration} minutes.
                </div>
              )}
            </div>

            {/* Notes Section */}
            <div className="form-section">
              <h2><i className="fas fa-notes-medical"></i> Notes</h2>
              <div className="form-group">
                <label>Additional Information (optional)</label>
                <textarea
                  className="form-control"
                  rows="4"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special instructions, allergies, or remarks..."
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/appointments')}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {loading ? 'Booking...' : 'Book Appointment (Confirmed)'}
              </button>
            </div>
          </form>
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

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManualBooking;
