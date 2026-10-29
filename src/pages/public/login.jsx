import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { roleDestinations } from '../../utils/accessControl';
import './login.css';
import DentalLogo from '../../assets/DentalLogo.png';
import bg1 from '../../assets/bg1.jpg';
import bg2 from '../../assets/bg2.jpg';
import bg3 from '../../assets/bg3.jpg';
import bg4 from '../../assets/bg4.jpg';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, user, userType, registrationIncomplete, loading: authLoading, accountError } = useAuth();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({ email: '', password: '', general: '' });
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [showPassword, setShowPassword] = useState(false);
  const resetNotificationShown = useRef(false);
  const verificationNotificationShown = useRef(false);
  const loginRequestInProgress = useRef(false);
  const isBusy = loading || authLoading;
  const roleError = user && userType && !Object.hasOwn(roleDestinations, userType)
    ? 'Your account does not have a supported role. Please contact the clinic.' : '';

  useEffect(() => {
    if (!location.state?.emailVerified || verificationNotificationShown.current) return;
    const timer = setTimeout(() => {
      verificationNotificationShown.current = true;
      toast.success('Email confirmed successfully! Your account is ready. Please log in.', {
        toastId: 'email-verification-success', position: 'bottom-right', autoClose: 3000,
      });
      navigate('/login', { replace: true, state: null });
    }, 0);
    return () => clearTimeout(timer);
  }, [location.state, navigate]);

  useEffect(() => {
    if (!location.state?.passwordResetSuccessful || resetNotificationShown.current) return;
    // Wait for the toast container to finish mounting, including StrictMode.
    const notificationTimer = setTimeout(() => {
      resetNotificationShown.current = true;
      toast.success('Password updated successfully. Please log in with your new password.', {
        toastId: 'password-reset-success',
        position: 'bottom-right',
        autoClose: 3000,
      });
      // Consume the message so returning to Login does not show it again.
      navigate('/login', { replace: true, state: null });
    }, 0);
    return () => clearTimeout(notificationTimer);
  }, [location.state, navigate]);

  useEffect(() => {
    // Wait for authentication and profile lookup before choosing a destination.
    if (authLoading || loading || !user) return;
    if (registrationIncomplete) {
      navigate('/register', { replace: true });
      return;
    }
    if (accountError || !Object.hasOwn(roleDestinations, userType)) return;
    navigate(roleDestinations[userType], { replace: true });
  }, [user, userType, authLoading, loading, registrationIncomplete, accountError, navigate]);

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) return 'Email is required';
    if (!emailRegex.test(email.trim())) return 'Please enter a valid email address';
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
    if (loginRequestInProgress.current || isBusy) return;
    setTouched({ email: true, password: true });
    const emailError = validateEmail(formData.email);
    const passwordError = validatePassword(formData.password);
    setErrors({ email: emailError, password: passwordError, general: '' });
    if (emailError || passwordError) return;

    loginRequestInProgress.current = true;
    setLoading(true);
    try {
      const result = await signIn(formData.email.trim(), formData.password);
      if (result.needsProfileCompletion) {
        navigate('/register', { replace: true });
      } else if (!result.success) {
        toast.error(result.message || 'Invalid email or password');
      }
      // Successful login updates the authenticated role in AuthContext;
      // the effect above selects its destination after this request finishes.
    } catch {
      toast.error('Could not log in. Please try again.');
    } finally {
      loginRequestInProgress.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
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
            <p className="subtitle">Sign in to your FifthCusp account</p>
          </div>

          {(accountError || roleError) && <div className="alert alert-error" role="alert">{accountError || roleError}</div>}
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
                disabled={isBusy}
                placeholder="Enter your email address"
                autoComplete="username"
              />
              {touched.email && errors.email && (
                <div className="validation-message error">{errors.email}</div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={handleChange}
                  onBlur={() => handleBlur('password')}
                  className={touched.password && errors.password ? 'error' : ''}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={isBusy}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  )}
                </button>
              </div>
              {touched.password && errors.password && (
                <div className="validation-message error">{errors.password}</div>
              )}
            </div>

            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={isBusy}
            >
              {loading ? 'Logging in...' : authLoading ? 'Checking account...' : 'Login'}
            </button>
          </form>

          <div className="form-footer">
            <p><Link to="/forgot-password">Forgot your password?</Link></p>
            <p className="footer-text">
              New patient? <Link to="/register">Create an account</Link>
            </p>
            <p><Link to="/">Back to Clinic Homepage</Link></p>
          </div>
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
};

export default Login;
