import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';  // <-- Remove extra }
import { useAuth } from '../../contexts/AuthContext';
import './login.css';
import DentalLogo from '../../assets/DentalLogo.png';
import bg1 from '../../assets/bg1.jpg';
import bg2 from '../../assets/bg2.jpg';
import bg3 from '../../assets/bg3.jpg';
import bg4 from '../../assets/bg4.jpg';

const Login = () => {
  const navigate = useNavigate();
  const { signIn, user, userType, signOut, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('patient');
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({ email: '', password: '', general: '' });
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [redirecting, setRedirecting] = useState(false);
  
  const [toast, setToast] = useState({ show: false, message: '', type: 'error' });

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        setToast({ show: false, message: '', type: 'error' });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  useEffect(() => {
    console.log('Login - Auth state changed:', { 
      user: user?.email, 
      userType, 
      activeTab, 
      authLoading,
      redirecting 
    });
    
    if (redirecting) return;
    
    if (user && userType && !authLoading) {
      setRedirecting(true);
      
      if (activeTab === 'staff') {
        if (userType === 'admin') {
          console.log('Redirecting admin to /admin/dashboard');
          setTimeout(() => {
            navigate('/admin/dashboard', { replace: true });
          }, 100);
        } else if (userType === 'doctor') {
          console.log('Redirecting doctor to /doctor/dashboard');
          setTimeout(() => {
            navigate('/doctor/dashboard', { replace: true });
          }, 100);
        } else {
          signOut();
          showToast('Patient accounts cannot access staff area. Please use the Patient Login tab.', 'error');
          setLoading(false);
          setRedirecting(false);
        }
      } 
      else if (activeTab === 'patient') {
        if (userType === 'patient') {
          console.log('Redirecting patient to home page');
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 100);
        } else {
          signOut();
          showToast('Staff accounts cannot access patient area. Please use the Staff Login tab.', 'error');
          setLoading(false);
          setRedirecting(false);
        }
      }
    }
  }, [user, userType, activeTab, navigate, signOut, authLoading, redirecting]);

  const showToast = (message, type = 'error') => {
    setToast({ show: true, message, type });
  };

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) return 'Email is required';
    if (!emailRegex.test(email)) return 'Please enter a valid email address';
    return '';
  };

  const validatePassword = (password) => {
    if (!password) return 'Password is required';
    return '';
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setErrors(prev => ({ ...prev, [name]: '', general: '' }));
  };

  const handleBlur = (field) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    if (field === 'email') {
      const emailError = validateEmail(formData.email);
      setErrors(prev => ({ ...prev, email: emailError }));
    } else if (field === 'password') {
      const passwordError = validatePassword(formData.password);
      setErrors(prev => ({ ...prev, password: passwordError }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });

    const emailError = validateEmail(formData.email);
    const passwordError = validatePassword(formData.password);
    setErrors({ email: emailError, password: passwordError, general: '' });

    if (emailError || passwordError) return;

    setLoading(true);
    const result = await signIn(formData.email, formData.password);

    if (!result.success) {
      setErrors({ ...errors, general: result.message || 'Invalid email or password' });
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {toast.show && (
        <div className={`toast-notification ${toast.type} ${toast.show ? 'show' : ''}`}>
          <div className="toast-icon">
            {toast.type === 'error' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
            )}
          </div>
          <div className="toast-message">{toast.message}</div>
          <button className="toast-close" onClick={() => setToast({ show: false, message: '', type: 'error' })}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      <div className="background-slideshow">
        <div className="slide" style={{ backgroundImage: `url(${bg1})` }}></div>
        <div className="slide" style={{ backgroundImage: `url(${bg2})` }}></div>
        <div className="slide" style={{ backgroundImage: `url(${bg3})` }}></div>
        <div className="slide" style={{ backgroundImage: `url(${bg4})` }}></div>
        <div className="color-overlay"></div>
      </div>

      <div className="login-wrapper">
        <div className="form-wrapper">
          <div className="form-header">
            <div className="logo-container">
              <div className="system-logo-placeholder">
                <img src={DentalLogo} alt="Fifthcusp Logo" />
              </div>
              <div className="logo-text-wrapp">
                <span className="logo-system-name">Fifthcusp</span>
                <span className="logo-sub-name">Dental Clinic</span>
              </div>
            </div>
            <p className="subtitle">Access your dental clinic account</p>
          </div>

          <div className="login-tabs">
            <button 
              className={`tab-btn ${activeTab === 'patient' ? 'active' : ''}`}
              onClick={() => setActiveTab('patient')}
              type="button"
            >
              <i className="fas fa-user"></i> Patient Login
            </button>
            <button 
              className={`tab-btn ${activeTab === 'staff' ? 'active' : ''}`}
              onClick={() => setActiveTab('staff')}
              type="button"
            >
              <i className="fas fa-user-md"></i> Staff Login
            </button>
          </div>

          {activeTab === 'staff' && (
            <div className="alert alert-info">
              <i className="fas fa-info-circle"></i>
              For doctors and administrators only. Use your clinic email and password.
            </div>
          )}

          {errors.general && (
            <div className="alert alert-error">
              <i className="fas fa-exclamation-circle"></i>
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                onBlur={() => handleBlur('email')}
                className={touched.email && errors.email ? 'error' : ''}
                disabled={loading}
                placeholder={activeTab === 'patient' ? "patient@example.com" : "staff@clinic.com"}
              />
              {touched.email && errors.email && (
                <div className="validation-message error">{errors.email}</div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                onBlur={() => handleBlur('password')}
                className={touched.password && errors.password ? 'error' : ''}
                disabled={loading}
              />
              {touched.password && errors.password && (
                <div className="validation-message error">{errors.password}</div>
              )}
            </div>

            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="form-footer">
            <p><Link to="/forgot-password">Forgot your password?</Link></p>
            <p className="footer-text">
              Don't have an account? <Link to="/register">Register here</Link>
            </p>
            <p><Link to="/">Back to Clinic Homepage</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;