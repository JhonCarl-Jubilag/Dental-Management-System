import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './forgot-password.css';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const { forgotPassword, user } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const validateEmail = () => {
    if (!email) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Please enter a valid email address';
    return '';
  };

  const handleBlur = () => {
    setTouched(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    setTouched(true);
    const emailError = validateEmail();
    
    if (emailError) {
      setError(emailError);
      return;
    }

    setLoading(true);
    setError('');
    
    const result = await forgotPassword(email);
    
    if (result.success) {
      setSuccess(result.message);
      setEmail('');
      setTouched(false);
    } else {
      setError(result.message);
    }
    
    setLoading(false);
  };

  return (
    <div className="forgot-password-container">
      <canvas id="canvas"></canvas>
      
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Forgot Password</h1>
            <p>Enter your email to reset your password</p>
          </div>
          
          {error && (
            <div className="alert alert-error">{error}</div>
          )}
          
          {success && (
            <div className="alert alert-success">
              <i className="fas fa-envelope"></i>
              <p>{success}</p>
              <p className="mt-2">
                <Link to="/login" className="alert-link">Return to Login</Link>
              </p>
            </div>
          )}
          
          {!success && (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  onBlur={handleBlur}
                  className={touched && validateEmail() ? 'error' : ''}
                  placeholder="Enter your registered email"
                  disabled={loading}
                />
                {touched && validateEmail() && (
                  <div className="validation-message error">{validateEmail()}</div>
                )}
                <div className="form-hint">
                  We'll send a password reset link to this email address
                </div>
              </div>
              
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner-small"></span>
                    Sending...
                  </>
                ) : (
                  'Send Reset Instructions'
                )}
              </button>
            </form>
          )}
          
          <div className="form-footer">
            <p>
              <Link to="/login">Back to Login</Link> | 
              <Link to="/register"> Create New Account</Link>
            </p>
            <p><Link to="/">Return to Homepage</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;