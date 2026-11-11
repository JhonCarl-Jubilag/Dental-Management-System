import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import './landing.css';
import hmoPhoto from '../../assets/landing-slideshow/HMO Accreditation.png';
import clinicPhoto1 from '../../assets/landing-slideshow/bg1.jpeg';
import clinicPhoto2 from '../../assets/landing-slideshow/bg2.jpeg';
import clinicPhoto3 from '../../assets/landing-slideshow/bg3.jpeg';
import clinicPhoto4 from '../../assets/landing-slideshow/bg4.jpeg';
import clinicPhoto5 from '../../assets/landing-slideshow/bg5.jpeg';
import DentalLogo from '../../assets/DentalLogo.png';
import { CLINIC_NAME, CLINIC_ADDRESS, CLINIC_PHONE, CLINIC_LANDLINE, CLINIC_EMAIL, CLINIC_HOURS, CLINIC_DIRECTIONS_URL } from '../../services/clinicDetails';

import { 
  ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, Clock3, Info, MapPin, Menu, Search, X,
  ClipboardCheck,   
  Sparkles,         
  Activity,        
  Scan,       
  Layers,         
  Baby,           
  ShieldAlert,      
  BriefcaseMedical  
} from 'lucide-react';

const CHAT_TOPICS = [
  { id: 'booking', label: 'Book appointment', question: 'How do I book an appointment?' },
  { id: 'pricing', label: 'Treatment pricing', question: 'How much does treatment cost?' },
  { id: 'services', label: 'Our services', question: 'What services do you offer?' },
  { id: 'location', label: 'Clinic location', question: 'Where is the clinic?' },
  { id: 'changes', label: 'Appointment changes', question: 'Can I cancel or reschedule my appointment?' },
  { id: 'contact', label: 'Contact clinic', question: 'How can I contact the clinic?' },
  { id: 'status', label: 'Appointment status', question: 'How do I check my appointment status?' },
  { id: 'hours', label: 'Clinic hours', question: 'What are your clinic hours?' },
  { id: 'videos', label: 'Procedure videos', question: 'Do you have 3D procedure videos?' },
  { id: 'payment', label: 'Payments and HMO', question: 'What payment methods and HMO plans do you accept?' },
  { id: 'aftercare', label: 'Treatment preparation', question: 'How do I prepare for treatment or get aftercare instructions?' },
];
const QUICK_CHAT_TOPICS = ['booking', 'pricing', 'services', 'location', 'changes', 'contact'];
const CLINIC_CONTACT_LINKS = [
  { label: 'Call clinic', href: 'tel:' + CLINIC_PHONE.replace(/\s/g, '') },
  { label: 'Email clinic', href: 'mailto:' + CLINIC_EMAIL },
];
const normalizeChatText = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function getChatReply(question, { services = [], user = null, userType = null } = {}, selectedTopic) {
  const message = ' ' + normalizeChatText(question) + ' ';
  const matches = phrases => phrases.some(phrase => message.includes(' ' + phrase + ' '));
  const serviceAliases = {
    'light cured restoration': ['tooth filling', 'filling', 'pasta'],
    'oral prophylaxis': ['cleaning', 'teeth cleaning', 'linis ng ngipin'],
    'root canal therapy': ['root canal'],
    orthodontics: ['braces'],
    'emax veneers': ['veneers'],
  };
  const service = services.find(item => {
    const name = normalizeChatText(item.service_name);
    return name && matches([name, ...(serviceAliases[name] || [])]);
  });
  let topic = selectedTopic;
  if (!topic) {
    if (matches(['emergency', 'pain', 'painful', 'bleeding', 'swelling', 'masakit', 'namamaga', 'dumudugo'])) topic = 'urgent';
    else if (matches(['cancel', 'cancellation', 'reschedule', 'rescheduling', 'resched', 'change appointment', 'change my appointment', 'change the appointment', 'change time', 'change date', 'move appointment', 'move my appointment', 'kansel', 'baguhin', 'ilipat'])) topic = 'changes';
    else if (matches(['hmo', 'insurance', 'payment', 'payments', 'cash', 'credit card', 'gcash', 'bayad', 'pambayad'])) topic = 'payment';
    else if (matches(['price', 'prices', 'pricing', 'cost', 'costs', 'how much', 'magkano', 'presyo', 'fee', 'fees'])) topic = 'pricing';
    else if (matches(['appointment status', 'check my appointment', 'view my appointment', 'open my appointment', 'confirmed', 'approved', 'pending', 'status'])) topic = 'status';
    else if (matches(['where is', 'where are', 'located', 'location', 'address', 'directions', 'map', 'saan', 'lokasyon'])) topic = 'location';
    else if (matches(['hours', 'are you open', 'clinic open', 'open today', 'when do you open', 'opening', 'closing', 'clinic schedule', 'clinic hour', 'operating hour', 'anong oras', 'bukas', 'sarado'])) topic = 'hours';
    else if (matches(['video', 'videos', '3d', 'animation', 'animations'])) topic = 'videos';
    else if (matches(['aftercare', 'after care', 'prepare', 'preparation', 'before treatment', 'after treatment', 'gamot'])) topic = 'aftercare';
    else if (matches(['contact', 'phone', 'email', 'telephone', 'number', 'tawag'])) topic = 'contact';
    else if (matches(['appointment', 'book', 'booking', 'schedule', 'reserve', 'magpa appointment'])) topic = 'booking';
    else if (service || matches(['services', 'service', 'procedure', 'procedures', 'treatment', 'treatments', 'offer', 'checkup'])) topic = 'services';
  }
  const reply = (text, links = [], suggestions = QUICK_CHAT_TOPICS) => ({ text, links, suggestions });
  const appointmentLinks = user && userType === 'patient'
    ? [{ label: 'My Appointments', href: '/my-appointments' }]
    : [{ label: 'Log in', href: '/login' }, { label: 'Register', href: '/register' }];

  switch (topic) {
    case 'booking':
      if (user && userType === 'patient') {
        return reply('Choose a service, dentist, available date and time on the Book Appointment page, then submit your request. Check My Appointments for the clinic’s confirmation.',
          [{ label: 'Book appointment', href: '/book-appointment' }], ['pricing', 'status']);
      }
      if (user && ['admin', 'super_admin'].includes(userType)) {
        return reply('You can manage clinic bookings from Manage Appointments. Online patient booking is available through a patient account.',
          [{ label: 'Manage Appointments', href: '/admin/appointments' }], ['services', 'contact']);
      }
      return reply('Log in with your patient account, or register and confirm your email first. Then choose a service, dentist, available date and time to request an appointment.',
        appointmentLinks, ['pricing', 'services']);
    case 'pricing':
      return reply('The final price for your treatment will be confirmed after your oral examination.', CLINIC_CONTACT_LINKS, ['services', 'booking']);
    case 'changes':
      return reply('Pending appointments can be edited or cancelled within one hour after booking, before the appointment starts. Confirmed appointments require a reschedule or cancellation request at least 24 hours in advance, subject to clinic approval. Open My Appointments to see the actions currently available. For other changes, contact the clinic.',
        [...appointmentLinks, CLINIC_CONTACT_LINKS[0]], ['status', 'contact']);
    case 'status':
      return reply('Open My Appointments after logging in to view your own appointment status. A submitted request is pending until the clinic confirms it.',
        appointmentLinks, ['changes', 'booking']);
    case 'location':
      return reply(CLINIC_NAME + ' is located at ' + CLINIC_ADDRESS + '.',
        [{ label: 'Get directions', href: CLINIC_DIRECTIONS_URL }, CLINIC_CONTACT_LINKS[0]], ['hours', 'contact']);
    case 'hours':
      return reply(CLINIC_HOURS + ' Contact the clinic to confirm holiday hours. Booking dates and times depend on dentist availability.',
        CLINIC_CONTACT_LINKS, ['location', 'booking']);
    case 'contact':
      return reply('You can reach ' + CLINIC_NAME + ' at ' + CLINIC_PHONE + ' or ' + CLINIC_LANDLINE + ', or email ' + CLINIC_EMAIL + '.',
        CLINIC_CONTACT_LINKS, ['location', 'hours']);
    case 'payment':
      return reply('Please contact the clinic to confirm accepted payment methods and whether your HMO or insurance plan covers the treatment. The final treatment price will be confirmed after your oral examination.',
        CLINIC_CONTACT_LINKS, ['pricing', 'booking']);
    case 'aftercare':
      return reply('Preparation and aftercare depend on your procedure and examination findings. Contact the clinic for the instructions provided by your treating dentist.',
        CLINIC_CONTACT_LINKS, ['services', 'contact']);
    case 'urgent':
      return reply('For urgent dental concerns, seek prompt dental care. Call ' + CLINIC_PHONE + ' to check the clinic’s availability.',
        [CLINIC_CONTACT_LINKS[0]], ['contact', 'hours']);
    case 'videos':
      return reply('Open a service’s details and choose View 3D procedure when a video is available.',
        [{ label: 'Browse services', href: '#services' }], ['services', 'booking']);
    case 'services':
      if (service) return reply(service.service_name + '. ' + (service.description || 'Contact the clinic for more information about this treatment.'),
        [{ label: 'View service details', href: '/service/' + service.service_id }], ['pricing', 'videos', 'booking']);
      if (!services.length) return reply('The current service list is unavailable. Please contact the clinic for the treatments it offers.',
        CLINIC_CONTACT_LINKS, ['contact', 'location']);
      return reply('Some of our current services include ' + services.slice(0, 5).map(item => item.service_name).join(', ') + '. Choose a service to read its details.',
        [...services.slice(0, 5).map(item => ({ label: item.service_name, href: '/service/' + item.service_id })),
          { label: 'Browse all services', href: '#services' }], ['pricing', 'videos', 'booking']);
    default:
      return reply('Please choose a topic below or ask about booking, services, clinic hours, location, or contacting the clinic.',
        CLINIC_CONTACT_LINKS);
  }
}

const initialServiceCount = 6;

const heroSlides = [
  { src: hmoPhoto, alt: 'List of HMO accredited providers' },
  { src: clinicPhoto1, alt: 'Clinic lounge and waiting area' },
  { src: clinicPhoto2, alt: 'Clinic entrance' },
  { src: clinicPhoto3, alt: 'Dental treatment room' },
  { src: clinicPhoto4, alt: 'Clinic waiting area seating' },
  { src: clinicPhoto5, alt: 'Dental chair and treatment equipment' },
];

export function HeroSlideshow() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideStatus, setSlideStatus] = useState({});
  const [isPaused, setIsPaused] = useState(false);
  const previousSlide = (activeSlide - 1 + heroSlides.length) % heroSlides.length;
  const nextSlide = (activeSlide + 1) % heroSlides.length;
  const activeSettled = Boolean(slideStatus[activeSlide]);
  const nextLoaded = slideStatus[nextSlide] === 'loaded';

  // Restart the delay after navigation so each selected image gets a full turn.
  useEffect(() => {
    if (isPaused || !activeSettled || !nextLoaded) return;
    const timer = window.setTimeout(() => setActiveSlide(nextSlide), 6000);
    return () => window.clearTimeout(timer);
  }, [activeSlide, activeSettled, nextSlide, nextLoaded, isPaused]);

  return (
    <figure className="welcome-photo" aria-label="Clinic photos and HMO accreditation" aria-roledescription="carousel">
      <div className="welcome-slides">
        <div className={`welcome-hmo-backdrop ${activeSlide === 0 ? 'is-active' : ''}`} style={{ backgroundImage: `url(${hmoPhoto})` }} aria-hidden="true" />
        {heroSlides.map((slide, index) => {
          const isNeighbor = index === previousSlide || index === nextSlide;
          const shouldRequest = index === activeSlide || slideStatus[index] || (isNeighbor && activeSettled);
          if (!shouldRequest) return null;
          return (
            <img
              key={slide.src}
              src={slide.src}
              alt={slide.alt}
              className={`${index === 0 ? 'welcome-hmo-image' : ''} ${index === activeSlide ? 'is-active' : ''}`}
              aria-hidden={index !== activeSlide}
              fetchPriority={index === 0 ? 'high' : 'low'}
              onLoad={() => setSlideStatus(status => ({ ...status, [index]: 'loaded' }))}
              onError={() => setSlideStatus(status => ({ ...status, [index]: 'failed' }))}
            />
          );
        })}
      </div>
      <button type="button" className="welcome-slide-control welcome-slide-previous" aria-label="Previous image" disabled={slideStatus[previousSlide] !== 'loaded'} onClick={() => setActiveSlide(previousSlide)}>
        <ChevronLeft size={22} aria-hidden="true" />
      </button>
      <button type="button" className="welcome-slide-control welcome-slide-next" aria-label="Next image" disabled={!nextLoaded} onClick={() => setActiveSlide(nextSlide)}>
        <ChevronRight size={22} aria-hidden="true" />
      </button>
      <button type="button" className="welcome-slide-control welcome-slide-playback" aria-label={isPaused ? 'Resume slideshow' : 'Pause slideshow'} onClick={() => setIsPaused(paused => !paused)}>
        {isPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      </button>
      <span className="welcome-slide-announcement" aria-live={isPaused ? 'polite' : 'off'} aria-atomic="true">
        {activeSlide + 1} of {heroSlides.length}: {heroSlides[activeSlide].alt}
      </span>
      <figcaption><MapPin size={16} aria-hidden="true" /> Imus City, Cavite</figcaption>
    </figure>
  );
}

function DeferredClinicMap() {
  const slot = useRef(null);
  const [MapComponent, setMapComponent] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let observer;

    const loadMap = () => {
      observer?.disconnect();
      import('../../components/common/ClinicMap')
        .then(module => { if (mounted) setMapComponent(() => module.default); })
        .catch(() => { if (mounted) setFailed(true); });
    };

    if (typeof IntersectionObserver === 'function' && slot.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMap();
      }, { rootMargin: '300px 0px' });
      observer.observe(slot.current);
    } else {
      loadMap();
    }

    return () => {
      mounted = false;
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={slot} className="info-image clinic-map-slot">
      {MapComponent ? <MapComponent /> : (
        <div className="clinic-map-placeholder">
          <p role="status">{failed ? 'Clinic map is temporarily unavailable.' : 'Loading clinic map…'}</p>
          <a href={CLINIC_DIRECTIONS_URL}
            target="_blank" rel="noopener noreferrer">Get directions</a>
        </div>
      )}
    </div>
  );
}

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
      text: "Hello! I’m the clinic’s automated FAQ assistant. Choose a question below or ask about services, booking, hours, or the clinic location.",
      sender: 'bot'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [expandedChatTopics, setExpandedChatTopics] = useState(false);
  const latestChatMessage = chatMessages[chatMessages.length - 1];
  const chatTopics = expandedChatTopics ? CHAT_TOPICS :
    (latestChatMessage.suggestions || QUICK_CHAT_TOPICS).map(id => CHAT_TOPICS.find(topic => topic.id === id));

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
        .select('service_id, service_name, description, duration_minutes')
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

  const sendChatMessage = (question, topic) => {
    const text = question.trim();
    if (!text) return;
    const answer = getChatReply(text, { services, user, userType }, topic);
    setChatMessages(previous => [...previous, { text, sender: 'user' }, { ...answer, sender: 'bot' }]);
    setExpandedChatTopics(false);
  };

  const handleChatSubmit = event => {
    event.preventDefault();
    sendChatMessage(chatInput);
    setChatInput('');
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
          <HeroSlideshow />
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
                : <> <Link to="/register">Register</Link> or <Link to="/login">loginyou</Link> to book appointments</>}
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
            
            <DeferredClinicMap />
          </div>
        </div>
      </section>

      {/* Chatbot Section */}
      <section id="chatbot" className="section chatbot-section">
        <div className="container-wide">
          <div className="section-title">
            <span className="section-kicker">03 / Patient support</span>
            <h2>24/7 ChatBot Dental Assistant</h2>
            <p>Find answers about booking, services, clinic hours, and location</p>
          </div>
          
          <div className="chatbot-container">
            <div className="chatbot-header">
              <h3><i className="fas fa-robot"></i> Dental FAQ Assistant</h3>
              <p>Choose a question or type your own</p>
            </div>
            
            <div className="chatbot-messages" id="chatbot-messages" role="log" aria-label="Dental assistant conversation">
              {chatMessages.map((message, index) => (
                <div key={index} className={`message ${message.sender}`}>
                  <div className="message-content">
                    <p>{message.text}</p>
                    {message.links?.length > 0 && (
                      <div className="chatbot-answer-links">
                        {message.links.map(link => link.href.startsWith('/') ? (
                          <Link key={link.href} to={link.href}>{link.label}</Link>
                        ) : (
                          <a key={link.href} href={link.href}
                            target={link.href.startsWith('https://') ? '_blank' : undefined}
                            rel={link.href.startsWith('https://') ? 'noopener noreferrer' : undefined}>{link.label}</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="chatbot-topics" aria-label="Suggested questions">
              {chatTopics.map(topic => (
                <button key={topic.id} type="button" onClick={() => sendChatMessage(topic.question, topic.id)}>{topic.label}</button>
              ))}
              {!expandedChatTopics && (
                <button type="button" className="chatbot-more-topics" onClick={() => setExpandedChatTopics(true)}>All questions</button>
              )}
            </div>
            <form className="chatbot-input" onSubmit={handleChatSubmit}>
              <input
                type="text"
                aria-label="Message the dental assistant"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about booking, services, or the clinic..."
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
                <li><i className="fas fa-map-marker-alt"></i> <a href={CLINIC_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">{CLINIC_ADDRESS}</a></li>
                <li><i className="fas fa-phone"></i> <a href={"tel:" + CLINIC_LANDLINE}>{CLINIC_LANDLINE}</a> / <a href={"tel:" + CLINIC_PHONE.replace(/\s/g, '')}>{CLINIC_PHONE}</a></li>
                <li><i className="fas fa-envelope"></i> <a href={"mailto:" + CLINIC_EMAIL}>{CLINIC_EMAIL}</a></li>
                <li><i className="fas fa-clock"></i> {CLINIC_HOURS}</li>
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
