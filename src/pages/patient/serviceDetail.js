import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import './serviceDetail.css';

const ServiceDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, userType } = useAuth();

  const [service, setService] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
        navigate('/');
        return;
    }

    const fetchServiceDetails = async () => {
        try {
        setLoading(true);
        setError(null);

        const { data: serviceData, error: serviceError } = await supabase
            .from('services')
            .select('*')
            .eq('service_id', id)
            .eq('status', 'active')
            .single();

        if (serviceError || !serviceData) {
            throw new Error('Service not found');
        }
        setService(serviceData);

        const { data: doctorServicesData, error: dsError } = await supabase
            .from('doctor_services')
            .select(`
            doctor_id,
            doctors!inner (
                doctor_id,
                first_name,
                last_name,
                specialization
            )
            `)
            .eq('service_id', id)
            .eq('status', 'active');

        if (!dsError && doctorServicesData) {
            setDoctors(doctorServicesData.map(item => item.doctors));
        } else {
            setDoctors([]);
        }
        } catch (err) {
        console.error(err);
        setError(err.message);
        } finally {
        setLoading(false);
        }
    };

    fetchServiceDetails();
    }, [id, navigate]); 

  const formatDuration = (minutes) => {
    if (!minutes) return 'Not specified';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    let result = '';
    if (hours > 0) result += `${hours} hour${hours > 1 ? 's' : ''}`;
    if (mins > 0) result += `${hours > 0 ? ' ' : ''}${mins} minute${mins > 1 ? 's' : ''}`;
    return result;
  };

  const handleBookNow = () => {
    if (!user) {
      navigate('/login', { state: { from: `/service/${id}` } });
    } else if (userType === 'patient') {
      navigate(`/book-appointment?service_id=${id}`);
    } else {
      alert('Only registered patients can book appointments.');
    }
  };

  if (loading) {
    return (
      <div className="service-details-container">
        <div className="loading-spinner"></div>
        <p>Loading service details...</p>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="service-details-container">
        <div className="error-card">
          <i className="fas fa-exclamation-triangle"></i>
          <h3>{error || 'Service not found'}</h3>
          <Link to="/" className="btn-back">Back to Home</Link>
        </div>
      </div>
    );
  }

  const durationText = formatDuration(service.duration_minutes);
  const doctorCount = doctors.length;

  return (
    <div className="service-details-container">
      <div className="service-details-wrapper">
        {/* Header Section */}
        <div className="service-header">
          <h1 className="service-title">{service.service_name}</h1>
          <div className="service-badges">
            <span className="badge duration">
              <i className="far fa-clock"></i> {durationText}
            </span>
            <span className="badge doctors">
              <i className="fas fa-user-md"></i> {doctorCount} specialist{doctorCount !== 1 ? 's' : ''}
            </span>
            <span className="badge price">
              ₱{Number(service.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="service-description">{service.description}</p>
        </div>

        <div className="service-content">
          {/* Main column */}
          <div className="main-column">
            <div className="info-card">
              <h2><i className="fas fa-list-check"></i> What's included</h2>
              <div className="included-grid">
                <div className="included-item">
                  <i className="fas fa-stethoscope"></i>
                  <span>Expert consultation</span>
                </div>
                <div className="included-item">
                  <i className="fas fa-hourglass-half"></i>
                  <span>{durationText} procedure</span>
                </div>
                <div className="included-item">
                  <i className="fas fa-shield-alt"></i>
                  <span>Quality assurance</span>
                </div>
                <div className="included-item">
                  <i className="fas fa-calendar-check"></i>
                  <span>Follow‑up support</span>
                </div>
              </div>
            </div>

            <div className="info-card">
              <h2><i className="fas fa-chalkboard-user"></i> Procedure steps</h2>
              <ul className="steps-list">
                <li><span className="step-num">1</span> Initial assessment & diagnosis</li>
                <li><span className="step-num">2</span> Treatment planning</li>
                <li><span className="step-num">3</span> Professional procedure</li>
                <li><span className="step-num">4</span> Aftercare instructions</li>
              </ul>
            </div>

            {doctors.length > 0 && (
              <div className="info-card">
                <h2><i className="fas fa-users"></i> Available doctors</h2>
                <div className="doctors-grid">
                  {doctors.map(doc => (
                    <div key={doc.doctor_id} className="doctor-card-mini">
                      <i className="fas fa-user-circle"></i>
                      <div>
                        <strong>Dr. {doc.first_name} {doc.last_name}</strong>
                        {doc.specialization && <span>{doc.specialization}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="sidebar-column">
            <div className="booking-card">
              <div className="booking-price">₱{Number(service.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              <div className="booking-details">
                <div className="detail-row">
                  <span>Duration</span>
                  <strong>{durationText}</strong>
                </div>
                <div className="detail-row">
                  <span>Available doctors</span>
                  <strong>{doctorCount}</strong>
                </div>
              </div>
              <button className="btn-book" onClick={handleBookNow}>
                <i className="fas fa-calendar-plus"></i> {user && userType === 'patient' ? 'Book appointment' : 'Login to book'}
              </button>
              <Link to="/" className="btn-back-small">
                <i className="fas fa-arrow-left"></i> Back to services
              </Link>
            </div>

            <div className="help-card">
              <i className="fas fa-headset"></i>
              <h3>Need help?</h3>
              <p>Questions about this service?</p>
              <a href="/#chatbot" className="chat-link">
                <i className="fas fa-robot"></i> Chat with assistant
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceDetails;