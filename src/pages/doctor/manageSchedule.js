import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import DoctorSidebar from '../../components/doctor/Sidebar';
import './manageSchedule.css';

const ManageSchedule = () => {
  const { user, userType, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [availabilitySlots, setAvailabilitySlots] = useState([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [newSlot, setNewSlot] = useState({
    available_date: '',
    start_time: '09:00',
    end_time: '17:00'
  });

  const [minStartTime, setMinStartTime] = useState('');

  const getCurrentTimeRoundedUp = () => {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    if (minutes > 0) {
      hours += 1;
      minutes = 0;
    } else {
      minutes = 0;
    }
    if (hours < 8) hours = 8;
    if (hours > 18) hours = 18;
    return `${hours.toString().padStart(2, '0')}:00`;
  };

  // Fixed: added newSlot.start_time to dependency array
  useEffect(() => {
    if (!newSlot.available_date) return;
    const today = new Date().toISOString().split('T')[0];
    if (newSlot.available_date === today) {
      const roundedCurrent = getCurrentTimeRoundedUp();
      setMinStartTime(roundedCurrent);
      if (newSlot.start_time < roundedCurrent) {
        setNewSlot(prev => ({ ...prev, start_time: roundedCurrent }));
      }
    } else {
      setMinStartTime('08:00');
    }
  }, [newSlot.available_date, newSlot.start_time]);

  useEffect(() => {
    if (newSlot.start_time) {
      const start = new Date(`1970-01-01T${newSlot.start_time}`);
      const minEnd = new Date(start.getTime() + 60 * 60 * 1000);
      const minEndStr = minEnd.toTimeString().slice(0, 5);
      setNewSlot(prev => {
        let newEnd = prev.end_time;
        if (newEnd < minEndStr) newEnd = minEndStr;
        if (newEnd > '19:00') newEnd = '19:00';
        if (newEnd !== prev.end_time) return { ...prev, end_time: newEnd };
        return prev;
      });
    }
  }, [newSlot.start_time]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'doctor') navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  const fetchData = useCallback(async () => {
    if (!userDetails?.doctor_id) return;
    setLoading(true);
    try {
      const doctorId = userDetails.doctor_id;
      const today = new Date().toISOString().split('T')[0];

      const { data: slots, error: slotsError } = await supabase
        .from('doctor_availability')
        .select('*')
        .eq('doctor_id', doctorId)
        .gte('available_date', today)
        .order('available_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (slotsError) throw slotsError;
      setAvailabilitySlots(slots || []);

      const now = new Date().toISOString();
      const { data: appointments, error: appError } = await supabase
        .from('appointments')
        .select(`
          appointment_id,
          appointment_datetime,
          status,
          patients (first_name, last_name),
          services (service_name)
        `)
        .eq('doctor_id', doctorId)
        .in('status', ['pending', 'confirmed'])
        .gte('appointment_datetime', now)
        .order('appointment_datetime', { ascending: true })
        .limit(10);

      if (appError) throw appError;
      setUpcomingAppointments(appointments || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [userDetails]);

  useEffect(() => {
    if (userDetails?.doctor_id) {
      fetchData();
    }
  }, [fetchData, userDetails]);

  const handleAddSlot = async (e) => {
    e.preventDefault();
    if (!newSlot.available_date || !newSlot.start_time || !newSlot.end_time) {
      toast.error('Please fill in all fields.');
      return;
    }

    const start = new Date(`1970-01-01T${newSlot.start_time}`);
    const end = new Date(`1970-01-01T${newSlot.end_time}`);
    if (end <= start) {
      toast.error('End time must be after start time.');
      return;
    }
    if ((end - start) < 3600000) {
      toast.error('Availability must be at least 1 hour.');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (newSlot.available_date === today) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const [startHour, startMinute] = newSlot.start_time.split(':').map(Number);
      if (startHour < currentHour || (startHour === currentHour && startMinute < currentMinute)) {
        toast.error('Start time cannot be in the past for today.');
        return;
      }
    }

    setLoading(true);
    try {
      const { error: insertError } = await supabase
        .from('doctor_availability')
        .insert({
          doctor_id: userDetails.doctor_id,
          available_date: newSlot.available_date,
          start_time: newSlot.start_time,
          end_time: newSlot.end_time,
          is_available: true
        });

      if (insertError) throw insertError;
      toast.success('Availability slot added!');
      setNewSlot(prev => ({ ...prev, available_date: '' }));
      await fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAvailability = async (slotId, currentStatus) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('doctor_availability')
        .update({ is_available: !currentStatus })
        .eq('availability_id', slotId)
        .eq('doctor_id', userDetails.doctor_id);

      if (error) throw error;
      toast.success('Status updated!');
      await fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteSlot = async (slotId) => {
    if (!window.confirm('Are you sure you want to delete this availability slot?')) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('doctor_availability')
        .delete()
        .eq('availability_id', slotId)
        .eq('doctor_id', userDetails.doctor_id);

      if (error) throw error;
      toast.success('Slot deleted!');
      await fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const groupedSlots = availabilitySlots.reduce((groups, slot) => {
    const date = slot.available_date;
    if (!groups[date]) groups[date] = [];
    groups[date].push(slot);
    return groups;
  }, {});

  const sortedDates = Object.keys(groupedSlots).sort();

  const today = new Date().toISOString().split('T')[0];
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 3);
  const maxDateStr = maxDate.toISOString().split('T')[0];

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading authentication...</p>
      </div>
    );
  }

  if (loading && availabilitySlots.length === 0 && upcomingAppointments.length === 0) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading schedule...</p>
      </div>
    );
  }

  const doctorName = userDetails?.first_name ? `Dr. ${userDetails.first_name} ${userDetails.last_name}` : 'Doctor';

  return (
    <div className="admin-dashboard">
      <DoctorSidebar onLogout={handleLogout} />
      <div className="main-content manage-schedule-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Schedule</h1>
            <p className="welcome-message">Set your availability for appointments</p>
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

        <div className="schedule-grid">
          <div className="card">
            <div className="card-header">
              <h3>Add Availability Slot</h3>
            </div>
            <div className="card-body">
              <form onSubmit={handleAddSlot}>
                <div className="form-group">
                  <label htmlFor="available_date">Date</label>
                  <input
                    type="date"
                    id="available_date"
                    className="form-control"
                    value={newSlot.available_date}
                    onChange={(e) => setNewSlot({ ...newSlot, available_date: e.target.value })}
                    min={today}
                    max={maxDateStr}
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="start_time">Start Time</label>
                    <input
                      type="time"
                      id="start_time"
                      className="form-control"
                      value={newSlot.start_time}
                      onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                      min={minStartTime || '08:00'}
                      max="18:00"
                      required
                    />
                    {newSlot.available_date === today && (
                      <small className="form-hint">Current time: {getCurrentTimeRoundedUp()} (minimum)</small>
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="end_time">End Time</label>
                    <input
                      type="time"
                      id="end_time"
                      className="form-control"
                      value={newSlot.end_time}
                      onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                      min="09:00"
                      max="19:00"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Add Slot
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Upcoming Appointments</h3>
            </div>
            <div className="card-body">
              <div className="appointments-list">
                {upcomingAppointments.length === 0 ? (
                  <div className="empty-state">
                    <i className="fas fa-calendar-check"></i>
                    <p>No upcoming appointments</p>
                  </div>
                ) : (
                  upcomingAppointments.map((app) => (
                    <div key={app.appointment_id} className="appointment-item">
                      <div className="appointment-header">
                        <span className="appointment-patient">
                          {app.patients?.first_name} {app.patients?.last_name}
                        </span>
                        <span className="appointment-time">
                          {new Date(app.appointment_datetime).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="appointment-service">
                        {app.services?.service_name}
                        <span className={`status-badge ${app.status === 'confirmed' ? 'status-active' : 'status-pending'}`}>
                          {app.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Your Availability</h3>
          </div>
          <div className="card-body">
            <div className="availability-list">
              {sortedDates.length === 0 ? (
                <div className="empty-state">
                  <i className="fas fa-calendar-week"></i>
                  <p>No availability slots set</p>
                  <p className="helper-text">Add your first slot using the form above.</p>
                </div>
              ) : (
                sortedDates.map((date) => (
                  <div key={date} className="date-group">
                    <h4 className="date-heading">{formatDate(date)}</h4>
                    {groupedSlots[date].map((slot) => (
                      <div key={slot.availability_id} className="availability-item">
                        <div className="availability-info">
                          <span className="time-range">
                            {new Date(`1970-01-01T${slot.start_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –
                            {new Date(`1970-01-01T${slot.end_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`status-badge ${slot.is_available ? 'status-active' : 'status-inactive'}`}>
                            {slot.is_available ? 'Available' : 'Unavailable'}
                          </span>
                        </div>
                        <div className="availability-actions">
                          <button
                            className={`btn btn-sm ${slot.is_available ? 'btn-warning' : 'btn-success'}`}
                            onClick={() => toggleAvailability(slot.availability_id, slot.is_available)}
                            disabled={loading}
                          >
                            {slot.is_available ? 'Mark Unavailable' : 'Mark Available'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => deleteSlot(slot.availability_id)}
                            disabled={loading}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><i className="fas fa-spinner fa-spin"></i><p>Logging out...</p></div></div>}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManageSchedule;