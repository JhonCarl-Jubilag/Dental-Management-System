import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import ClinicMap from '../../components/common/ClinicMap';
import './landing.css';
import heroPhoto from '../../assets/bg2.jpg';
import DentalLogo from '../../assets/DentalLogo.png';

import { 
  ArrowUpRight, ChevronDown, Clock3, Info, MapPin, Menu, Search, X,
  ClipboardCheck,   
  Sparkles,         
  Activity,        
  Scan,       
  Layers,         
  Baby,           
  ShieldAlert,      
  BriefcaseMedical  
} from 'lucide-react';

const initialServiceCount = 6;

const Landing = () => {
  const { user, userType, userDetails, signOut } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serviceQuery, setServiceQuery] = useState('');
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Chatbot state
  const [chatMessages, setChatMessages] = useState([
    {
      text: "Hello! I'm your 24/7 AI dental assistant. I can provide instant information about clinic hours, common dental procedures, post-treatment care, and answer frequently asked questions. Support is available even outside clinic hours. How can I help you today?",
      sender: 'bot'
    }
  ]);
  const [chatInput, setChatInput] = useState('');

  const getServiceIcon = (serviceName) => {
    const name = serviceName.toLowerCase();

    // Diagnostics & Prevention
    if (name.includes('checkup')) return <ClipboardCheck size={42} className="text-blue-600" />;
    if (name.includes('xray') || name.includes('x-ray')) return <Scan size={42} className="text-blue-600" />;
    
    // Cleaning & Esthetics
    if (name.includes('cleaning') || name.includes('fluoride') || name.includes('prophylaxis') || name.includes('scaling')) return <Sparkles size={42} className="text-blue-600" />;
    if (name.includes('whitening')) return <Sparkles size={42} className="text-blue-500" />;
    
    // Restorative & Prosthodontics (Crowns, Bridges, Implants, Fillings)
    if (
      name.includes('crown') || 
      name.includes('bridge') || 
      name.includes('implant') || 
      name.includes('filling') ||
      name.includes('restoration') ||
      name.includes('inlay') || name.includes('onlay') ||
      name.includes('prosthodontics') || name.includes('attachments') || name.includes('veneers') ||
      name.includes('orthodontics') ||
      name.includes('dentures') ||
      name.includes('braces')
    ) {
      return <Layers size={42} className="text-blue-600" />;
    }
    
    // Specialized & Surgical Care
    if (name.includes('pediatric') || name.includes('pedodontics') || name.includes('child')) return <Baby size={42} className="text-blue-600" />;
    if (name.includes('emergency')) return <ShieldAlert size={42} className="text-red-500" />;
    if (
      name.includes('surgery') || 
      name.includes('extraction') || 
      name.includes('grafting') || name.includes('flap') ||
      name.includes('root') || 
      name.includes('rct')
    ) {
      return <Activity size={42} className="text-blue-600" />;
    }
    
    return <BriefcaseMedical size={42} className="text-blue-600" />;
  };

  useEffect(() => {
    fetchServices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchServices = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('status', 'active')
        .order('service_name');

      if (error) throw error;
      
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching services:', error);
      setError('Unable to load the current services. Please reload or contact the clinic.');
      toast.error('Unable to load the current services. Please reload to retry.');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const searchTerm = serviceQuery.trim().toLowerCase();
  const matchingServices = services.filter(service => service.service_name.toLowerCase().includes(searchTerm));
  const displayedServices = searchTerm || servicesExpanded ? matchingServices : matchingServices.slice(0, initialServiceCount);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const toggleUserDropdown = () => {
    setUserDropdownOpen(!userDropdownOpen);
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    setChatMessages(prev => [...prev, { text: chatInput, sender: 'user' }]);
    
    setTimeout(() => {
      const response = generateBotResponse(chatInput);
      setChatMessages(prev => [...prev, { text: response, sender: 'bot' }]);
      
      setTimeout(() => {
        const messagesContainer = document.getElementById('chatbot-messages');
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 100);
    }, 1000);

    setChatInput('');
  };

  const generateBotResponse = (userMessage) => {
    const lowerMessage = userMessage.toLowerCase();
    
    if (lowerMessage.includes('hour') || lowerMessage.includes('open') || lowerMessage.includes('time') || 
        lowerMessage.includes('when are you open') || lowerMessage.includes('clinic hour') || 
        lowerMessage.includes('operating hour')) {
      return "Our clinic is open Monday to Friday from 9:00 AM to 5:00 PM, and Saturdays from 10:00 AM to 5:00 PM. We're closed on Sundays and holidays. You can book appointments during these hours.";
    }
    
    if (lowerMessage.includes('procedure') || lowerMessage.includes('service') || lowerMessage.includes('treatment') ||
        lowerMessage.includes('what do you offer') || lowerMessage.includes('dental procedure') ||
        lowerMessage.includes('offer')) {
      if (services.length === 0) return 'Please contact the clinic for its current services while the service list is unavailable.';
      const serviceList = services.slice(0, 5).map(s => s.service_name).join(', ');
      return `We offer a comprehensive range of dental procedures including ${serviceList}, and more. You can view all our detailed services above.`;
    }
    
    if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('how much') ||
        lowerMessage.includes('payment')) {
      for (const service of services) {
        if (lowerMessage.includes(service.service_name.toLowerCase())) {
          return `${service.service_name} costs ₱${Number(service.price).toFixed(2)}. This covers the procedure and professional fee.`;
        }
      }
      return "Our service prices are listed above with each service. We accept various payment methods including cash, credit cards, and insurance.";
    }
    
    if (lowerMessage.includes('appointment') || lowerMessage.includes('book') || lowerMessage.includes('schedule')) {
      if (user && userType === 'patient') {
        return "You can book an appointment by clicking any service card above, or go to the Book Appointment page from the navigation menu.";
      } else {
        return "To book an appointment, please register for an account first. Once registered, you'll be able to book appointments directly.";
      }
    }
    
    if (lowerMessage.includes('emergency') || lowerMessage.includes('pain') || lowerMessage.includes('hurt') || lowerMessage.includes('bleeding')) {
      return "For dental emergencies (severe pain, trauma, swelling, or uncontrolled bleeding): Call our emergency line at (02) 1234-5678 immediately.";
    }
    
    if (lowerMessage.includes('where') || lowerMessage.includes('location') || lowerMessage.includes('address')) {
      return "We're located at Tanzang Luma 2, Imus City, Cavite, in front of Lumina Mall. Phone: (02) 1234-5678.";
    }
    
    return "Thank you for your message! I can help with clinic hours information, details about common dental procedures, price inquiries, and appointment booking assistance. What specific information would you like?";
  };

  useEffect(() => {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }, [chatMessages]);

  const handleLogout = async (e) => {
    e.preventDefault();
    setIsLoggingOut(true);
    setUserDropdownOpen(false);
    await signOut();
    window.location.href = '/';
  };

  return (
    <div className="landing-page">
      {/*Navigation Bar*/}
      <nav className="modern-nav">
        <div className="nav-container">
          <Link to="/" className="logo">
            <img src={DentalLogo} alt="Diolata Dental Clinic Logo" className="logo-image" />
          </Link>

          <button className="mobile-menu-btn" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} aria-controls="landing-menu" onClick={toggleMobileMenu}>
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>

          <div id="landing-menu" className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}>
            <ul className="nav-links">
              <li><a href="#services" onClick={() => setMobileMenuOpen(false)}>Services</a></li>
              <li><a href="#about" onClick={() => setMobileMenuOpen(false)}>About Us</a></li>
              <li><a href="#chatbot" onClick={() => setMobileMenuOpen(false)}>Chatbot</a></li>
            </ul>

            {user && userType === 'patient' ? (
              <div className="user-menu">
                <button className="user-dropdown-btn" aria-expanded={userDropdownOpen} onClick={toggleUserDropdown}>
                  <i className="fas fa-user-circle"></i>
                  {userDetails?.first_name || 'User'}
                  <i className={`fas fa-chevron-${userDropdownOpen ? 'up' : 'down'}`}></i>
                </button>
                <div className={`user-dropdown ${userDropdownOpen ? 'active' : ''}`}>
                  <Link to="/book-appointment" onClick={() => setUserDropdownOpen(false)}>
                    <i className="fas fa-book"></i> Book Appointment
                  </Link>
                  <Link to="/my-appointments" onClick={() => setUserDropdownOpen(false)}>
                    <i className="fas fa-calendar-check"></i> My Appointments
                  </Link>
                  <Link to="/profile" onClick={() => setUserDropdownOpen(false)}>
                    <i className="fas fa-user"></i> My Profile
                  </Link>
                  <a href="/" onClick={handleLogout} className={isLoggingOut ? 'logging-out' : ''}>
                    {isLoggingOut ? (
                      <><i className="fas fa-spinner fa-spin"></i> Logging out...</>
                    ) : (
                      <><i className="fas fa-sign-out-alt"></i> Logout</>
                    )}
                  </a>
                </div>
              </div>
            ) : (
              <div className="auth-buttons">
                <Link to="/login" className="btn-login">Login</Link>
                <Link to="/register" className="btn-register">Register</Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      {isLoggingOut && (
        <div className="logout-loading-overlay">
          <div className="logout-loading-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <header className="landing-header">
        <div className="welcome-layout container-wide">
          <div className="hero-content">
            <span className="section-kicker">Diolata Dental Clinic</span>
            <h1>Your Smile is <em>Our Priority</em></h1>
            <p>Providing thoughtful care for healthier, happier smiles.</p>
            <div className="cta-buttons">
              {user && userType === 'patient' ? (
                <Link to="/book-appointment" className="btn-landing btn-success">Book New Appointment</Link>
              ) : (
                <>
                  <Link to="/register" className="btn-landing btn-primary">Book Your Appointment <ArrowUpRight size={17} aria-hidden="true" /></Link>
                  <a href="#services" className="btn-landing btn-secondary">View Our Services</a>
                </>
              )}
            </div>
          </div>
          <figure className="welcome-photo">
            <img src={heroPhoto} alt="A dentist speaking with a patient in a treatment room" />
            <figcaption><MapPin size={16} aria-hidden="true" /> Imus City, Cavite</figcaption>
          </figure>
        </div>
      </header>
      <main>

      {/* Services Section */}
      <section id="services" className="section section-light services-section">
        <div className="container-wide">
          <header className="catalog-intro">
            <div className="section-title">
              <span className="section-kicker">01 / Treatments</span>
              <h2>Our Dental Services</h2>
              <p>Comprehensive dental care solutions tailored to your needs</p>
            </div>
            <p className="catalog-booking-note">
              <Info size={16} aria-hidden="true" />
              {user && userType === 'patient'
                ? "You're logged in! Book appointments directly"
                : <> <Link to="/register">Register</Link> or <Link to="/login">login</Link> to book appointments</>}
            </p>
          </header>

          {loading ? (
            <div className="loading-container" role="status">
              <div className="loading-spinner"></div>
              <p>Loading our dental services...</p>
            </div>
          ) : error ? (
            <div className="error-message" role="alert">{error}</div>
          ) : services.length === 0 ? (
            <div className="no-services">
              <h3>No services available at the moment</h3>
              <p>Please check back later or contact us for more information.</p>
            </div>
          ) : (
            <>
              <div className="catalog-tools">
                <h3 aria-live="polite">{searchTerm ? 'Search results' : 'All services'} <span>{matchingServices.length}</span></h3>
                <label className="catalog-search">
                  <Search size={18} aria-hidden="true" />
                  <input type="search" aria-label="Search services by name" placeholder="Search services by name" value={serviceQuery} onChange={event => setServiceQuery(event.target.value)} />
                </label>
              </div>
              {displayedServices.length === 0 && (
                <p className="catalog-empty">No matching services. <button type="button" onClick={() => setServiceQuery('')}>Show all services</button></p>
              )}
              <div className="catalog-grid" id="service-catalog">
                {displayedServices.map(service => (
                  <Link className="treatment-card" key={service.service_id} to={`/service/${service.service_id}`}>
                    <div className="treatment-top">
                      <span className="treatment-symbol" aria-hidden="true">{getServiceIcon(service.service_name)}</span>
                      <span className="treatment-duration"><Clock3 size={15} aria-hidden="true" /> {service.duration_minutes} mins</span>
                    </div>
                    <span className="treatment-specialist">Specialist</span>
                    <h4>{service.service_name}</h4>
                    <p>{service.description || 'Professional dental service'}</p>
                    <div className="treatment-bottom">
                      <strong>₱{Number(service.price).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                      <span>View Details <ArrowUpRight size={17} aria-hidden="true" /></span>
                    </div>
                  </Link>
                ))}
              </div>
              {!searchTerm && services.length > initialServiceCount && (
                <div className="catalog-toggle-row">
                  <button
                    type="button"
                    className="catalog-toggle"
                    aria-expanded={servicesExpanded}
                    aria-controls="service-catalog"
                    onClick={event => {
                      const button = event.currentTarget;
                      setServicesExpanded(!servicesExpanded);
                      if (servicesExpanded) {
                        requestAnimationFrame(() => button.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
                      }
                    }}
                  >
                    {servicesExpanded ? 'Show Less' : 'View All Services'}
                    <ChevronDown size={17} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* About Clinic Section with Map */}
      <section id="about" className="section">
        <div className="container-wide">
          <div className="section-title">
            <span className="section-kicker">02 / About us</span>
            <h2>Visit Our Clinic</h2>
            <p>Conveniently located in the heart of Imus City, Cavite</p>
          </div>
          
          <div className="clinic-info">
            <div className="info-text">
              <h3>Why Choose Our Dental Clinic?</h3>
              <p>We are dedicated to delivering the highest quality dental care using state-of-the-art technology and techniques.</p>
              
              <ul className="info-features">
                <li>Experienced and caring dental professionals</li>
                <li>State-of-the-art equipment and technology</li>
                <li>Comfortable and modern facility</li>
                <li>Flexible appointment scheduling</li>
                <li>Emergency dental services available</li>
                <li>Accepting most insurance plans</li>
              </ul>
              
              <div className="cta-buttons">
                {user && userType === 'patient' ? (
                  <>
                    <Link to="/book-appointment" className="btn-landing btn-primary">Book Appointment Now</Link>
                    <Link to="/my-appointments" className="btn-landing btn-secondary">View My Appointments</Link>
                  </>
                ) : (
                  <Link to="/register" className="btn-landing btn-primary">Book Appointment</Link>
                )}
              </div>
            </div>
            
            <div className="info-image">
              <ClinicMap />
            </div>
          </div>
        </div>
      </section>

      {/* Chatbot Section */}
      <section id="chatbot" className="section chatbot-section">
        <div className="container-wide">
          <div className="section-title">
            <span className="section-kicker">03 / Patient support</span>
            <h2>24/7 AI Dental Assistant</h2>
            <p>Get instant answers about clinic hours, procedures, and post-care</p>
          </div>
          
          <div className="chatbot-container">
            <div className="chatbot-header">
              <h3><i className="fas fa-robot"></i> Dental Chatbot Assistant</h3>
              <p>Available anytime - even outside clinic hours</p>
            </div>
            
            <div className="chatbot-messages" id="chatbot-messages" role="log" aria-label="Dental assistant conversation">
              {chatMessages.map((message, index) => (
                <div key={index} className={`message ${message.sender}`}>
                  <div className="message-content">{message.text}</div>
                </div>
              ))}
            </div>
            
            <form className="chatbot-input" onSubmit={handleChatSubmit}>
              <input
                type="text"
                aria-label="Message the dental assistant"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about clinic hours, procedures, or aftercare..."
                maxLength="500"
              />
              <button type="submit" disabled={!chatInput.trim()}>
                <i className="fas fa-paper-plane"></i> Send
              </button>
            </form>
          </div>
        </div>
      </section>

      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container-wide">
          <div className="footer-content">
            <div className="footer-section">
              <h3>Diolata Dental Clinic</h3>
              <p>Providing quality dental care for a healthier, happier smile.</p>
            </div>
            
            <div className="footer-section">
              <h3>Quick Links</h3>
              <ul className="footer-links">
                <li><a href="#services">Services</a></li>
                <li><a href="#about">About Us</a></li>
                <li><a href="#chatbot">Chatbot</a></li>
                {user && userType === 'patient' ? (
                  <>
                    <li><Link to="/dashboard">Dashboard</Link></li>
                    <li><Link to="/my-appointments">My Appointments</Link></li>
                    <li><Link to="/profile">My Profile</Link></li>
                  </>
                ) : (
                  <>
                    <li><Link to="/login">Login</Link></li>
                    <li><Link to="/register">Register</Link></li>
                  </>
                )}
              </ul>
            </div>
            
            <div className="footer-section">
              <h3>Contact Info</h3>
              <ul className="footer-links">
                <li><i className="fas fa-map-marker-alt"></i> Tanzang Luma 2, Imus City, Cavite</li>
                <li><i className="fas fa-phone"></i> (02) 1234-5678</li>
                <li><i className="fas fa-envelope"></i> info@fifthcuspclinic.com</li>
                <li><i className="fas fa-clock"></i> Mon-Fri: 8AM-6PM, Sat: 9AM-2PM</li>
              </ul>
            </div>
          </div>
          
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} Diolata Dental Clinic. All rights reserved.</p>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;
