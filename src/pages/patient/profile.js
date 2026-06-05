import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import './Profile.css';

const Profile = () => {
  const navigate = useNavigate();
  const { userDetails, updateProfile, changePassword, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('personal');
  const [loading, setLoading] = useState(false);
  
  // Navigation state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  // Password visibility states
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    address: '',
    contact_no: '',
    birthday: ''
  });
  
  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (userDetails) {
      setFormData({
        first_name: userDetails.first_name || '',
        last_name: userDetails.last_name || '',
        email: userDetails.email || '',
        address: userDetails.address || '',
        contact_no: userDetails.contact_no || '',
        birthday: userDetails.birthday || ''
      });
    }
  }, [userDetails]);

  const getMaxDate = () => {
    const today = new Date();
    const maxDate = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    return maxDate.toISOString().split('T')[0];
  };

  const getInitials = () => {
    const firstInitial = formData.first_name?.charAt(0) || 'U';
    const lastInitial = formData.last_name?.charAt(0) || 'S';
    return `${firstInitial.toUpperCase()}${lastInitial.toUpperCase()}`;
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    
    if (name === 'contact_no') {
      const numbersOnly = value.replace(/[^0-9]/g, '');
      if (numbersOnly.length <= 11) {
        setFormData(prev => ({ ...prev, [name]: numbersOnly }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
    
    setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
    setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validateProfileForm = () => {
    const newErrors = {};
    
    if (!formData.first_name) newErrors.first_name = 'First name is required';
    if (!formData.last_name) newErrors.last_name = 'Last name is required';
    if (!formData.address) newErrors.address = 'Address is required';
    if (!formData.contact_no) newErrors.contact_no = 'Contact number is required';
    if (!formData.birthday) newErrors.birthday = 'Birthday is required';
    
    const phoneRegex = /^[0-9]{11}$/;
    if (formData.contact_no && !phoneRegex.test(formData.contact_no)) {
      newErrors.contact_no = 'Contact number must be exactly 11 digits';
    }
    
    if (formData.birthday) {
      const selectedDate = new Date(formData.birthday);
      const minDate = new Date(getMaxDate());
      if (selectedDate > minDate) {
        newErrors.birthday = 'You must be at least 5 years old';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validatePasswordForm = () => {
    const newErrors = {};
    
    if (!passwordData.current_password) newErrors.current_password = 'Current password is required';
    if (!passwordData.new_password) newErrors.new_password = 'New password is required';
    if (!passwordData.confirm_password) newErrors.confirm_password = 'Please confirm your new password';
    
    if (passwordData.new_password && passwordData.new_password.length < 6) {
      newErrors.new_password = 'Password must be at least 6 characters';
    }
    
    if (passwordData.new_password !== passwordData.confirm_password) {
      newErrors.confirm_password = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    if (!validateProfileForm()) return;
    
    setLoading(true);
    
    const { email, ...profileWithoutEmail } = formData;
    const result = await updateProfile(profileWithoutEmail);
    
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    
    setLoading(false);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!validatePasswordForm()) return;
    
    setLoading(true);
    
    const result = await changePassword(passwordData.current_password, passwordData.new_password);
    
    if (result.success) {
      toast.success(result.message);
      setPasswordData({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });
    } else {
      toast.error(result.message);
    }
    
    setLoading(false);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    const result = await signOut();
    if (result.success) {
      navigate('/login');
    }
    setIsLoggingOut(false);
  };

  const adminName = userDetails?.first_name || 'User';

  return (
    <div className="profile-page-wrapper">
      {/* Modern Navigation Bar */}
      <nav className="modern-nav">
        <div className="nav-container">
          <Link to="/" className="logo">
            <div className="logo-placeholder"></div>
            <div className="logo-text-wrapper">
              <span className="logo-main-text">Fifthcusp</span>
              <span className="logo-sub-text">Dental Clinic</span>
            </div>
          </Link>

          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <i className={`fas fa-${mobileMenuOpen ? 'times' : 'bars'}`}></i>
          </button>

          <div className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}>
            <ul className="nav-links">
              <li><a href="/#services" onClick={() => setMobileMenuOpen(false)}>Services</a></li>
              <li><a href="/#about" onClick={() => setMobileMenuOpen(false)}>About Us</a></li>
              <li><a href="/#chatbot" onClick={() => setMobileMenuOpen(false)}>Chatbot</a></li>
            </ul>

            <div className="user-menu">
              <button className="user-dropdown-btn" onClick={() => setUserDropdownOpen(!userDropdownOpen)}>
                <i className="fas fa-user-circle"></i>
                {adminName}
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
                <button onClick={handleLogout} className="dropdown-logout-btn">
                  <i className="fas fa-sign-out-alt"></i> Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Profile Content */}
      <div className="profile-container">
        <div className="profile-header">
          <h1>My Profile</h1>
          <p>Manage your personal information and account settings</p>
        </div>

        <div className="profile-content">
          {/* Sidebar */}
          <div className="profile-sidebar">
            <div className="avatar-circle">
              {userDetails?.profile_picture ? (
                <img 
                  src={userDetails.profile_picture} 
                  alt="Profile" 
                  className="avatar-image"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.textContent = getInitials();
                  }}
                />
              ) : (
                getInitials()
              )}
            </div>
            
            <div className="profile-name-container">
              <h3 className="profile-fullname">{formData.first_name} {formData.last_name}</h3>
            </div>
            
            <div className="contact-details">
              <div className="contact-row">
                <i className="fas fa-envelope"></i>
                <span>{formData.email || 'No email provided'}</span>
              </div>
              <div className="contact-row">
                <i className="fas fa-phone-alt"></i>
                <span>{formData.contact_no || 'No contact number'}</span>
              </div>
              <div className="contact-row">
                <i className="fas fa-map-marker-alt"></i>
                <span>{formData.address || 'No address provided'}</span>
              </div>
              <div className="contact-row">
                <i className="fas fa-birthday-cake"></i>
                <span>{formData.birthday ? new Date(formData.birthday).toLocaleDateString() : 'No birthday provided'}</span>
              </div>
            </div>
            
            <div className="member-since">
              <i className="fas fa-calendar-plus"></i> 
              Member since {userDetails?.date_created ? new Date(userDetails.date_created).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Recently'}
            </div>
          </div>

          {/* Main content - forms */}
          <div className="profile-main">
            <div className="tabs">
              <button className={`tab-btn ${activeTab === 'personal' ? 'active' : ''}`} onClick={() => setActiveTab('personal')}>
                <i className="fas fa-user"></i> Personal Info
              </button>
              <button className={`tab-btn ${activeTab === 'password' ? 'active' : ''}`} onClick={() => setActiveTab('password')}>
                <i className="fas fa-lock"></i> Change Password
              </button>
            </div>

            {activeTab === 'personal' && (
              <div className="form-section">
                <h2 className="section-title"><i className="fas fa-user-edit"></i> Personal Information</h2>
                
                <form onSubmit={handleProfileSubmit} className="auth-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label><i className="fas fa-user"></i> First Name</label>
                      <input type="text" name="first_name" value={formData.first_name} onChange={handleProfileChange} className={errors.first_name ? 'error' : ''} disabled={loading} />
                      {errors.first_name && <div className="validation-message error">{errors.first_name}</div>}
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-user"></i> Last Name</label>
                      <input type="text" name="last_name" value={formData.last_name} onChange={handleProfileChange} className={errors.last_name ? 'error' : ''} disabled={loading} />
                      {errors.last_name && <div className="validation-message error">{errors.last_name}</div>}
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label><i className="fas fa-envelope"></i> Email Address</label>
                    <input 
                      type="email" 
                      name="email" 
                      value={formData.email} 
                      disabled 
                      className="email-disabled"
                    />
                    <div className="validation-message info">
                      <i className="fas fa-info-circle"></i> Email address cannot be changed. Please contact the clinic administrator for email updates.
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label><i className="fas fa-map-marker-alt"></i> Address</label>
                    <textarea name="address" value={formData.address} onChange={handleProfileChange} rows="3" className={errors.address ? 'error' : ''} disabled={loading} />
                    {errors.address && <div className="validation-message error">{errors.address}</div>}
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label><i className="fas fa-phone"></i> Contact Number</label>
                      <input type="tel" name="contact_no" value={formData.contact_no} onChange={handleProfileChange} placeholder="09123456789" className={errors.contact_no ? 'error' : ''} disabled={loading} />
                      {errors.contact_no && <div className="validation-message error">{errors.contact_no}</div>}
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-birthday-cake"></i> Birthday</label>
                      <input type="date" name="birthday" value={formData.birthday} onChange={handleProfileChange} max={getMaxDate()} className={errors.birthday ? 'error' : ''} disabled={loading} />
                      {errors.birthday && <div className="validation-message error">{errors.birthday}</div>}
                    </div>
                  </div>
                  
                  <div className="action-buttons">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      <i className="fas fa-save"></i> {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {activeTab === 'password' && (
              <div className="form-section">
                <h2 className="section-title"><i className="fas fa-key"></i> Change Password</h2>
                
                <form onSubmit={handlePasswordSubmit} className="auth-form">
                  <div className="info-card">
                    <h4><i className="fas fa-info-circle"></i> Password Requirements</h4>
                    <p>Your new password must be at least 6 characters long.</p>
                  </div>
                  
                  <div className="form-group">
                    <label><i className="fas fa-lock"></i> Current Password</label>
                    <div className="password-input-wrapper">
                      <input 
                        type={showCurrentPassword ? "text" : "password"} 
                        name="current_password" 
                        value={passwordData.current_password} 
                        onChange={handlePasswordChange} 
                        className={errors.current_password ? 'error' : ''} 
                        disabled={loading} 
                        placeholder="Enter current password"
                      />
                      <button 
                        type="button" 
                        className="password-toggle-btn"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      >
                        <i className={`fas fa-${showCurrentPassword ? 'eye-slash' : 'eye'}`}></i>
                      </button>
                    </div>
                    {errors.current_password && <div className="validation-message error">{errors.current_password}</div>}
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label><i className="fas fa-lock"></i> New Password</label>
                      <div className="password-input-wrapper">
                        <input 
                          type={showNewPassword ? "text" : "password"} 
                          name="new_password" 
                          value={passwordData.new_password} 
                          onChange={handlePasswordChange} 
                          className={errors.new_password ? 'error' : ''} 
                          disabled={loading} 
                          placeholder="Enter new password"
                        />
                        <button 
                          type="button" 
                          className="password-toggle-btn"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                          <i className={`fas fa-${showNewPassword ? 'eye-slash' : 'eye'}`}></i>
                        </button>
                      </div>
                      {errors.new_password && <div className="validation-message error">{errors.new_password}</div>}
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-lock"></i> Confirm New Password</label>
                      <div className="password-input-wrapper">
                        <input 
                          type={showConfirmPassword ? "text" : "password"} 
                          name="confirm_password" 
                          value={passwordData.confirm_password} 
                          onChange={handlePasswordChange} 
                          className={errors.confirm_password ? 'error' : ''} 
                          disabled={loading} 
                          placeholder="Confirm new password"
                        />
                        <button 
                          type="button" 
                          className="password-toggle-btn"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          <i className={`fas fa-${showConfirmPassword ? 'eye-slash' : 'eye'}`}></i>
                        </button>
                      </div>
                      {errors.confirm_password && <div className="validation-message error">{errors.confirm_password}</div>}
                    </div>
                  </div>
                  
                  <div className="action-buttons">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      <i className="fas fa-key"></i> {loading ? 'Changing...' : 'Change Password'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logout Overlay */}
      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <ToastContainer
        position="bottom-right"
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

export default Profile;