import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import ClinicMap from '../../components/common/ClinicMap';
import './landing.css';
import DentalLogo from '../../assets/DentalLogo.png';

import { 
  ClipboardCheck,   
  Sparkles,         
  Activity,        
  Scan,       
  Layers,         
  Baby,           
  ShieldAlert,      
  BriefcaseMedical  
} from 'lucide-react';

const Landing = () => {
  const { user, userType, userDetails, signOut } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAllServices, setShowAllServices] = useState(false);
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
    if (name.includes('cleaning') || name.includes('fluoride')) return <Sparkles size={42} className="text-blue-600" />;
    if (name.includes('whitening')) return <Sparkles size={42} className="text-blue-500" />;
    
    // Restorative & Prosthodontics (Crowns, Bridges, Implants, Fillings)
    if (
      name.includes('crown') || 
      name.includes('bridge') || 
      name.includes('implant') || 
      name.includes('filling') ||
      name.includes('dentures') ||
      name.includes('braces')
    ) {
      return <Layers size={42} className="text-blue-600" />;
    }
    
    // Specialized & Surgical Care
    if (name.includes('pediatric') || name.includes('child')) return <Baby size={42} className="text-blue-600" />;
    if (name.includes('emergency')) return <ShieldAlert size={42} className="text-red-500" />;
    if (
      name.includes('surgery') || 
      name.includes('extraction') || 
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
      
      if (data && data.length > 0) {
        setServices(data);
      } else {
        setServices(getFallbackServices());
      }
    } catch (error) {
      console.error('Error fetching services:', error);
      setError('Unable to load services. Showing sample services instead.');
      setServices(getFallbackServices());
    } finally {
      setLoading(false);
    }
  };

  const getFallbackServices = () => {
    return [
      { 
        service_id: 1, 
        service_name: 'Dental Checkup', 
        description: 'Comprehensive oral examination including visual inspection, periodontal screening, and oral cancer screening. Recommended every 6 months.', 
        price: 500.00 
      },
      { 
        service_id: 2, 
        service_name: 'Teeth Cleaning', 
        description: 'Professional cleaning to remove plaque, tartar, and stains. Includes polishing and fluoride treatment for stronger enamel.', 
        price: 800.00 
      },
      { 
        service_id: 3, 
        service_name: 'Tooth Filling', 
        description: 'Restore teeth damaged by decay using tooth-colored composite resin material that matches your natural tooth color.', 
        price: 1200.00 
      },
      { 
        service_id: 4, 
        service_name: 'Root Canal Treatment', 
        description: 'Remove infected pulp, clean and seal the tooth to save it from extraction. Includes temporary crown.', 
        price: 5000.00 
      },
      { 
        service_id: 5, 
        service_name: 'Tooth Extraction', 
        description: 'Simple or surgical removal of damaged or problematic teeth. Local anesthesia included for comfort.', 
        price: 1500.00 
      },
      { 
        service_id: 6, 
        service_name: 'Teeth Whitening', 
        description: 'Professional bleaching treatment to lighten teeth and remove stains. Custom take-home trays or in-office treatment available.', 
        price: 3500.00 
      },
      { 
        service_id: 7, 
        service_name: 'Dental Crown', 
        description: 'Custom-made cap placed over damaged tooth to restore shape, size, and strength. Available in porcelain or metal.', 
        price: 8000.00 
      },
      { 
        service_id: 8, 
        service_name: 'Dental Bridge', 
        description: 'Replace missing teeth by anchoring artificial teeth to adjacent natural teeth. Restores smile and chewing function.', 
        price: 15000.00 
      },
      { 
        service_id: 9, 
        service_name: 'Dental Implant', 
        description: 'Permanent solution for missing teeth. Titanium post surgically placed in jawbone with natural-looking crown.', 
        price: 45000.00 
      }
    ];
  };

  const displayedServices = showAllServices ? services : services.slice(0, 6);

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
            <img src={DentalLogo} alt="Fifthcusp Dental Clinic Logo" className="logo-image" />
            <div className="logo-text-wrapper">
              <span className="logo-main-text">Fifthcusp</span>
              <span className="logo-sub-text">Dental Clinic</span>
            </div>
          </Link>

          <button className="mobile-menu-btn" onClick={toggleMobileMenu}>
            <i className={`fas fa-${mobileMenuOpen ? 'times' : 'bars'}`}></i>
          </button>

          <div className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}>
            <ul className="nav-links">
              <li><a href="#services" onClick={() => setMobileMenuOpen(false)}>Services</a></li>
              <li><a href="#about" onClick={() => setMobileMenuOpen(false)}>About Us</a></li>
              <li><a href="#chatbot" onClick={() => setMobileMenuOpen(false)}>Chatbot</a></li>
            </ul>

            {user && userType === 'patient' ? (
              <div className="user-menu">
                <button className="user-dropdown-btn" onClick={toggleUserDropdown}>
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
        <div className="hero hero-with-bg">
          <div className="hero-overlay"></div>
          <div className="hero-content">
            <h1>Your Smile is Our Priority</h1>
            <p>Experience world-class dental care with our team of expert professionals</p>
            <div className="cta-buttons">
              {user && userType === 'patient' ? (
                <Link to="/book-appointment" className="btn-landing btn-success">Book New Appointment</Link>
              ) : (
                <>
                  <Link to="/register" className="btn-landing btn-primary">Book Your Appointment</Link>
                  <a href="#services" className="btn-landing btn-secondary">View Our Services</a>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Services Section */}
      <section id="services" className="section section-light services-section">
        <div className="container-wide">
          <div className="section-title">
            <h2>Our Dental Services</h2>
            <p>Comprehensive dental care solutions tailored to your needs</p>
            
            {error && (
              <div className="error-message">
                <i className="fas fa-exclamation-circle"></i> {error}
              </div>
            )}
            
            <div className={`service-category-tag ${user && userType === 'patient' ? '' : 'info'}`}>
              <i className={`fas fa-${user && userType === 'patient' ? 'check-circle' : 'exclamation-circle'}`}></i>
              {user && userType === 'patient' 
                ? "You're logged in! Book appointments directly"
                : "Register or login to book appointments"}
            </div>
          </div>

          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Loading our dental services...</p>
            </div>
          ) : (
            <>
              <div className="services-grid">
                {displayedServices.map((service, index) => (
                  <div 
                    className="service-card" 
                    key={service.service_id}
                    onClick={() => {
                      if (user && userType === 'patient') {
                        window.location.href = `/service/${service.service_id}`;
                      } else {
                        alert('Please login or register to view service details and book appointments.');
                      }
                    }}
                  >
                    <div 
                      className="service-icon" 
                      style={{
                        backgroundColor: '#eff6ff', 
                        width: '120px', 
                        height: '70px', 
                        borderRadius: '1rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        margin: '0 auto 1.5rem auto'
                      }}
                    >
                      {getServiceIcon(service.service_name)}
                    </div>

                    <h3>{service.service_name}</h3>
                    <p className="service-description">
                      {service.description?.substring(0, 120) || 'Professional dental service'}
                      {service.description?.length > 120 ? '...' : ''}
                    </p>
                    
                    <div className="service-price">
                      ₱{Number(service.price).toLocaleString('en-PH', { 
                        minimumFractionDigits: 2, 
                        maximumFractionDigits: 2 
                      })}
                    </div>
                    
                    <div className="service-features">
                      <span className="feature-badge">
                        <i className="fas fa-clock"></i> 30-60 mins
                      </span>
                      <span className="feature-badge">
                        <i className="fas fa-user-md"></i> Specialist
                      </span>
                    </div>
                    
                    <div className="service-action">
                      {user && userType === 'patient' ? (
                        <>Book Now <i className="fas fa-calendar-check"></i></>
                      ) : (
                        <>View Details <i className="fas fa-arrow-right"></i></>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {services.length > 6 && (
                <div className="see-more-container">
                  <button 
                    className="btn-see-more"
                    onClick={() => setShowAllServices(!showAllServices)}
                  >
                    {showAllServices ? 'Show Less' : `See All ${services.length} Services`}
                    <i className={`fas fa-chevron-${showAllServices ? 'up' : 'down'}`}></i>
                  </button>
                </div>
              )}

              {services.length === 0 && !loading && (
                <div className="no-services">
                  <i className="fas fa-tooth"></i>
                  <h3>No services available at the moment</h3>
                  <p>Please check back later or contact us for more information.</p>
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
            <h2>24/7 AI Dental Assistant</h2>
            <p>Get instant answers about clinic hours, procedures, and post-care</p>
          </div>
          
          <div className="chatbot-container">
            <div className="chatbot-header">
              <h3><i className="fas fa-robot"></i> Dental Chatbot Assistant</h3>
              <p>Available anytime - even outside clinic hours</p>
            </div>
            
            <div className="chatbot-messages" id="chatbot-messages">
              {chatMessages.map((message, index) => (
                <div key={index} className={`message ${message.sender}`}>
                  <div className="message-content">{message.text}</div>
                </div>
              ))}
            </div>
            
            <form className="chatbot-input" onSubmit={handleChatSubmit}>
              <input
                type="text"
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

      {/* Footer */}
      <footer className="footer">
        <div className="container-wide">
          <div className="footer-content">
            <div className="footer-section">
              <h3>Fifthcusp Dental Clinic</h3>
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
                    <li><Link to="/login">Patient Login</Link></li>
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
            <p>&copy; {new Date().getFullYear()} Fifthcusp Dental Clinic. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;