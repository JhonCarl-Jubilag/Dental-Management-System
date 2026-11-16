import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import { loadDoctorBookingSlots } from '../../services/doctorScheduling';
import { appointmentWriteError, clinicDateTime, formatClinicTime } from '../../utils/clinicScheduling';
import BookingCalendar from '../patient/BookingCalendar';
import '../patient/bookAppointment.css';
import './manualBooking.css';

const ManualBooking = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [revision, setRevision] = useState(0);
  const busy = loading || loadingDoctors;
  const submitting = useRef(false);
  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState([]);
  const [doctors, setDoctors] = useState([]);

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
            doctors!inner (doctor_id, first_name, last_name, email, contact_no, status)
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

  const handleServiceChange = (e) => {
    const serviceId = e.target.value;
    setSelectedServiceId(serviceId);
    const service = services.find(s => s.service_id === parseInt(serviceId));
    setSelectedServiceDuration(service?.duration_minutes || 60);
    setSelectedDoctorId('');
    setSelectedDate('');
    setSelectedTime('');
    setDoctors([]);

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
        setRevision(value => value + 1);
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
              <h2><i className="fas fa-user-injured"></i> Select Patient</h2>
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
              <h2><i className="fas fa-tooth"></i> Select Service</h2>
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

            {selectedServiceId && <div className="form-section">
              <h2><i className="fas fa-user-md" /> Select Specialist</h2>
              <div className="form-group">
                <label className="required">Available Doctors</label>
                {loadingDoctors ? <p role="status">Loading doctors...</p> : !doctors.length ? <div className="info-message">No doctors available for this service.</div> :
                  <div className="manual-doctor-options" role="group" aria-label="Available Doctors">
                    {doctors.map(d => <button type="button" key={d.doctor_id} disabled={loading}
                      className={'manual-doctor-option' + (String(selectedDoctorId) === String(d.doctor_id) ? ' selected' : '')}
                      aria-pressed={String(selectedDoctorId) === String(d.doctor_id)}
                      onClick={() => { if (String(selectedDoctorId) !== String(d.doctor_id)) { setSelectedDoctorId(String(d.doctor_id)); setSelectedDate(''); setSelectedTime(''); } }}>
                      <span className="manual-doctor-avatar" aria-hidden="true">{d.first_name?.[0]}{d.last_name?.[0]}</span>
                      <span className="manual-doctor-info"><strong>Dr. {d.first_name} {d.last_name}</strong>
                        <span className="manual-doctor-contacts"><span><i className="fas fa-envelope" aria-hidden="true" /> {d.email}</span><span><i className="fas fa-phone" aria-hidden="true" /> {d.contact_no || 'N/A'}</span></span>
                      </span>
                    </button>)}
                  </div>}
              </div>
            </div>}

            {selectedDoctorId && <div className="form-section">
              <h2><i className="fas fa-calendar-alt" /> Select Date & Time</h2>
              <BookingCalendar key={selectedServiceId + ':' + selectedDoctorId} doctorId={selectedDoctorId} serviceId={selectedServiceId}
                interval={selectedServiceDuration} leadMinutes={0} date={selectedDate} time={selectedTime}
                setDate={setSelectedDate} setTime={setSelectedTime} revision={revision} locked={loading} />
              <div className="duration-info"><i className="fas fa-clock" /> This service takes {selectedServiceDuration} minutes.{selectedTime && ' Selected time: ' + formatClinicTime(selectedTime)}</div>
            </div>}

            {/* Notes Section */}
            <div className="form-section">
              <h2><i className="fas fa-notes-medical"></i> Additional Information</h2>
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
              <button type="submit" className="btn btn-primary" disabled={busy || !selectedPatient || !selectedServiceId || !selectedDoctorId || !selectedDate || !selectedTime}>
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
