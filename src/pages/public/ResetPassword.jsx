import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './reset-password.css';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { resetPassword, user } = useAuth();

  const [formData, setFormData] = useState({
    password: '',
    confirm_password: ''
  });

  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [generalError, setGeneralError] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  // Check if we have the reset token from URL
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    
    if (type !== 'recovery') {
      setGeneralError('Invalid or expired password reset link. Please request a new one.');
    }
  }, []);

  // Password strength checker
  const getPasswordStrength = (password) => {
    if (!password) return { score: 0, text: '', class: '' };
    
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    const strengthMap = {
      0: { text: '', class: '' },
      1: { text: 'Weak', class: 'weak' },
      2: { text: 'Weak', class: 'weak' },
      3: { text: 'Medium', class: 'medium' },
      4: { text: 'Strong', class: 'strong' },
      5: { text: 'Very Strong', class: 'strong' }
    };
    
    return {
      score,
      text: strengthMap[score]?.text || '',
      class: strengthMap[score]?.class || '',
      percentage: (score / 5) * 100
    };
  };

  const validateField = (name, value) => {
    switch (name) {
      case 'password':
        if (!value) return 'Password is required';
        if (value.length < 8) return 'Password must be at least 8 characters';
        if (!/(?=.*[a-z])/.test(value)) return 'Must contain at least one lowercase letter';
        if (!/(?=.*[A-Z])/.test(value)) return 'Must contain at least one uppercase letter';
        if (!/(?=.*\d)/.test(value)) return 'Must contain at least one number';
        return '';

      case 'confirm_password':
        if (!value) return 'Please confirm your password';
        if (value !== formData.password) return 'Passwords do not match';
        return '';

      default:
        return '';
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear field error when typing
    setErrors(prev => ({ ...prev, [name]: '' }));
    setGeneralError('');
  };

  const handleBlur = (field) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(field, formData[field]);
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Mark all fields as touched
    setTouched({
      password: true,
      confirm_password: true
    });

    // Validate all fields
    const passwordError = validateField('password', formData.password);
    const confirmError = validateField('confirm_password', formData.confirm_password);

    setErrors({
      password: passwordError,
      confirm_password: confirmError
    });

    if (passwordError || confirmError) {
      return;
    }

    setLoading(true);
    
    const result = await resetPassword(formData.password);
    
    if (result.success) {
      setSuccess(result.message);
      setFormData({ password: '', confirm_password: '' });
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } else {
      setGeneralError(result.message);
    }
    
    setLoading(false);
  };

  const passwordStrength = getPasswordStrength(formData.password);

  return (
    <div className="reset-password-container">
      <canvas id="canvas"></canvas>
      
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Reset Password</h1>
            <p>Enter your new password</p>
          </div>
          
          {generalError && (
            <div className="alert alert-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>{generalError}</p>
              <p className="mt-2">
                <Link to="/forgot-password" className="alert-link">
                  Request new reset link
                </Link>
              </p>
            </div>
          )}
          
          {success && (
            <div className="alert alert-success">
              <i className="fas fa-check-circle"></i>
              <p>{success}</p>
              <p className="redirect-message">Redirecting to login page...</p>
            </div>
          )}
          
          {!generalError && !success && (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label htmlFor="password">New Password</label>
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
                
                {formData.password && (
                  <div className="password-strength">
                    <div className="strength-bar-container">
                      <div 
                        className={`strength-bar ${passwordStrength.class}`}
                        style={{ width: `${passwordStrength.percentage}%` }}
                      ></div>
                    </div>
                    <span className="strength-text">{passwordStrength.text}</span>
                  </div>
                )}
                
                {touched.password && errors.password && (
                  <div className="validation-message error">{errors.password}</div>
                )}
                
                <ul className="password-requirements">
                  <li className={formData.password.length >= 8 ? 'valid' : ''}>
                    <i className={`fas fa-${formData.password.length >= 8 ? 'check-circle' : 'circle'}`}></i>
                    At least 8 characters
                  </li>
                  <li className={/[a-z]/.test(formData.password) ? 'valid' : ''}>
                    <i className={`fas fa-${/[a-z]/.test(formData.password) ? 'check-circle' : 'circle'}`}></i>
                    One lowercase letter
                  </li>
                  <li className={/[A-Z]/.test(formData.password) ? 'valid' : ''}>
                    <i className={`fas fa-${/[A-Z]/.test(formData.password) ? 'check-circle' : 'circle'}`}></i>
                    One uppercase letter
                  </li>
                  <li className={/\d/.test(formData.password) ? 'valid' : ''}>
                    <i className={`fas fa-${/\d/.test(formData.password) ? 'check-circle' : 'circle'}`}></i>
                    One number
                  </li>
                </ul>
              </div>
              
              <div className="form-group">
                <label htmlFor="confirm_password">Confirm New Password</label>
                <input
                  type="password"
                  id="confirm_password"
                  name="confirm_password"
                  value={formData.confirm_password}
                  onChange={handleChange}
                  onBlur={() => handleBlur('confirm_password')}
                  className={touched.confirm_password && errors.confirm_password ? 'error' : ''}
                  disabled={loading}
                />
                {touched.confirm_password && errors.confirm_password && (
                  <div className="validation-message error">{errors.confirm_password}</div>
                )}
              </div>
              
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner-small"></span>
                    Resetting Password...
                  </>
                ) : (
                  'Reset Password'
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

export default ResetPassword;