import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './register.css';

const Register = () => {
  const navigate = useNavigate();
  const { signUp, user } = useAuth();

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    confirm_password: '',
    address: '',
    contact_no: '',
    birthday: ''
  });

  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [generalError, setGeneralError] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  // Calculate max date for birthday (5 years ago)
  const getMaxDate = () => {
    const today = new Date();
    const maxDate = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    return maxDate.toISOString().split('T')[0];
  };

  // Validation functions
  const validateField = (name, value) => {
    switch (name) {
      case 'first_name':
      case 'last_name':
        if (!value) return 'This field is required';
        if (value.length < 2) return 'Must be at least 2 characters';
        if (!/^[a-zA-Z\s]+$/.test(value)) return 'Only letters and spaces allowed';
        return '';

      case 'email':
        if (!value) return 'Email is required';
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) return 'Please enter a valid email address';
        return '';

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

      case 'contact_no':
        if (!value) return 'Contact number is required';
        const phoneRegex = /^[0-9]{11}$/;
        if (!phoneRegex.test(value)) return 'Must be exactly 11 digits';
        return '';

      case 'birthday':
        if (!value) return 'Birthday is required';
        const selectedDate = new Date(value);
        const minDate = new Date(getMaxDate());
        if (selectedDate > minDate) return 'You must be at least 5 years old';
        return '';

      case 'address':
        if (!value) return 'Address is required';
        if (value.length < 5) return 'Please enter a valid address';
        return '';

      default:
        return '';
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // Special handling for contact_no (numbers only)
    if (name === 'contact_no') {
      const numbersOnly = value.replace(/[^0-9]/g, '');
      if (numbersOnly.length <= 11) {
        setFormData(prev => ({ ...prev, [name]: numbersOnly }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }

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
    const allFields = Object.keys(formData);
    const touchedFields = {};
    allFields.forEach(field => { touchedFields[field] = true; });
    setTouched(touchedFields);

    // Validate all fields
    const newErrors = {};
    allFields.forEach(field => {
      const error = validateField(field, formData[field]);
      if (error) newErrors[field] = error;
    });

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setLoading(true);
      
      const result = await signUp(formData.email, formData.password, {
        first_name: formData.first_name,
        last_name: formData.last_name,
        address: formData.address,
        contact_no: formData.contact_no,
        birthday: formData.birthday
      });

      if (result.success) {
        setSuccessMessage(result.message);
        setFormData({
          first_name: '',
          last_name: '',
          email: '',
          password: '',
          confirm_password: '',
          address: '',
          contact_no: '',
          birthday: ''
        });
        setTouched({});
      } else {
        setGeneralError(result.message);
      }
      
      setLoading(false);
    }
  };

  // Password strength indicator
  const getPasswordStrength = () => {
    const password = formData.password;
    if (!password) return { strength: 0, text: '' };
    
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    
    const strengthMap = {
      0: { class: '', text: '' },
      1: { class: 'weak', text: 'Weak' },
      2: { class: 'weak', text: 'Weak' },
      3: { class: 'medium', text: 'Medium' },
      4: { class: 'strong', text: 'Strong' },
      5: { class: 'strong', text: 'Very Strong' }
    };
    
    return {
      strength: strength,
      class: strengthMap[strength]?.class || '',
      text: strengthMap[strength]?.text || ''
    };
  };

  return (
    <div className="register-container">
      <canvas id="canvas"></canvas>
      
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Patient Registration</h1>
            <p>Create your account to book appointments</p>
          </div>
          
          {generalError && (
            <div className="alert alert-error">{generalError}</div>
          )}
          
          {successMessage && (
            <div className="alert alert-success">
              {successMessage}
              <p className="mt-2">
                <Link to="/login" className="alert-link">Go to Login</Link> or 
                <button 
                  onClick={() => window.location.href = '/'} 
                  className="alert-link btn-link"
                >
                  Return to Homepage
                </button>
              </p>
            </div>
          )}
          
          {!successMessage && (
            <form onSubmit={handleSubmit} className="auth-form" id="registrationForm">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="first_name">First Name</label>
                  <input
                    type="text"
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    onBlur={() => handleBlur('first_name')}
                    className={touched.first_name && errors.first_name ? 'error' : ''}
                    disabled={loading}
                  />
                  {touched.first_name && errors.first_name && (
                    <div className="validation-message error">{errors.first_name}</div>
                  )}
                </div>
                
                <div className="form-group">
                  <label htmlFor="last_name">Last Name</label>
                  <input
                    type="text"
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    onBlur={() => handleBlur('last_name')}
                    className={touched.last_name && errors.last_name ? 'error' : ''}
                    disabled={loading}
                  />
                  {touched.last_name && errors.last_name && (
                    <div className="validation-message error">{errors.last_name}</div>
                  )}
                </div>
              </div>
              
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
                />
                {touched.email && errors.email && (
                  <div className="validation-message error">{errors.email}</div>
                )}
              </div>
              
              <div className="form-row">
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
                  {formData.password && (
                    <div className="password-strength">
                      <div className={`strength-bar ${getPasswordStrength().class}`} 
                           style={{ width: `${(getPasswordStrength().strength / 5) * 100}%` }}>
                      </div>
                      <span className="strength-text">{getPasswordStrength().text}</span>
                    </div>
                  )}
                  {touched.password && errors.password && (
                    <div className="validation-message error">{errors.password}</div>
                  )}
                </div>
                
                <div className="form-group">
                  <label htmlFor="confirm_password">Confirm Password</label>
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
              </div>
              
              <div className="form-group">
                <label htmlFor="address">Address</label>
                <textarea
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  onBlur={() => handleBlur('address')}
                  className={touched.address && errors.address ? 'error' : ''}
                  rows="3"
                  disabled={loading}
                />
                {touched.address && errors.address && (
                  <div className="validation-message error">{errors.address}</div>
                )}
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="contact_no">Contact Number</label>
                  <input
                    type="tel"
                    id="contact_no"
                    name="contact_no"
                    value={formData.contact_no}
                    onChange={handleChange}
                    onBlur={() => handleBlur('contact_no')}
                    placeholder="09123456789"
                    className={touched.contact_no && errors.contact_no ? 'error' : ''}
                    disabled={loading}
                  />
                  {touched.contact_no && errors.contact_no && (
                    <div className="validation-message error">{errors.contact_no}</div>
                  )}
                </div>
                
                <div className="form-group">
                  <label htmlFor="birthday">Birthday</label>
                  <input
                    type="date"
                    id="birthday"
                    name="birthday"
                    value={formData.birthday}
                    onChange={handleChange}
                    onBlur={() => handleBlur('birthday')}
                    max={getMaxDate()}
                    className={touched.birthday && errors.birthday ? 'error' : ''}
                    disabled={loading}
                  />
                  {touched.birthday && errors.birthday && (
                    <div className="validation-message error">{errors.birthday}</div>
                  )}
                </div>
              </div>
              
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Registering...' : 'Register'}
              </button>
            </form>
          )}
          
          <div className="form-footer">
            <p>Already have an account? <Link to="/login">Login here</Link></p>
            <p><Link to="/">Back to Clinic Homepage</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;