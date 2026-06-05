import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import DoctorSidebar from '../../components/doctor/Sidebar';
import './profile.css';

const DoctorProfile = () => {
  const { user, userType, userDetails, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [doctorData, setDoctorData] = useState(null);
  const [activeTab, setActiveTab] = useState('personal');
  const [loading, setLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    specialization: '',
    contact_no: '',
  });
  
  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'doctor') navigate('/');
    }
  }, [user, userType, authLoading, navigate]);

  useEffect(() => {
    const fetchDoctor = async () => {
      if (!user || userType !== 'doctor' || !userDetails?.doctor_id) return;
      try {
        const { data, error } = await supabase
          .from('doctors')
          .select('*')
          .eq('doctor_id', userDetails.doctor_id)
          .single();
        if (error) throw error;
        setDoctorData(data);
        setFormData({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          email: data.email || '',
          specialization: data.specialization || '',
          contact_no: data.contact_no || '',
        });
      } catch (err) {
        console.error(err);
        toast.error('Failed to load profile');
      }
    };
    fetchDoctor();
  }, [user, userType, userDetails]);

  const getInitials = () => {
    const firstInitial = formData.first_name?.charAt(0) || 'D';
    const lastInitial = formData.last_name?.charAt(0) || 'R';
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

  const validateContactNumber = (number) => {
    const clean = number.replace(/\s/g, '');
    if (clean === '') return true;
    return /^[0-9]{11}$/.test(clean);
  };

  const validateProfileForm = () => {
    const newErrors = {};
    
    if (!formData.first_name) newErrors.first_name = 'First name is required';
    if (!formData.last_name) newErrors.last_name = 'Last name is required';
    
    if (formData.contact_no && !validateContactNumber(formData.contact_no)) {
      newErrors.contact_no = 'Contact number must be exactly 11 digits';
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
    
    try {
      const { error: updateError } = await supabase
        .from('doctors')
        .update({
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          specialization: formData.specialization?.trim() || null,
          contact_no: formData.contact_no ? formData.contact_no.replace(/\s/g, '') : null,
        })
        .eq('doctor_id', doctorData.doctor_id);
      
      if (updateError) throw updateError;
      
      toast.success('Profile updated successfully!');
      
      const { data: fresh } = await supabase
        .from('doctors')
        .select('*')
        .eq('doctor_id', doctorData.doctor_id)
        .single();
      if (fresh) setDoctorData(fresh);
      
    } catch (err) {
      toast.error(err.message);
    }
    
    setLoading(false);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!validatePasswordForm()) return;
    
    setLoading(true);
    
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: passwordData.current_password,
      });
      if (signInError) throw new Error('Current password is incorrect.');

      const { error: passwordError } = await supabase.auth.updateUser({
        password: passwordData.new_password,
      });
      if (passwordError) throw passwordError;
      
      toast.success('Password changed successfully!');
      setPasswordData({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });
      
    } catch (err) {
      toast.error(err.message);
    }
    
    setLoading(false);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading || !doctorData) {
    return (
      <div className="admin-dashboard">
        <DoctorSidebar onLogout={handleLogout} />
        <div className="main-content">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user || userType !== 'doctor') return null;

  const doctorName = `Dr. ${formData.first_name} ${formData.last_name}`;
  const memberSince = doctorData.date_created
    ? new Date(doctorData.date_created).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Recently';

  return (
    <div className="admin-dashboard">
      <DoctorSidebar onLogout={handleLogout} />
      <div className="main-content">
        <div className="profile-container">
          <div className="profile-headers">
            <h1>My Profile</h1>
            <p>Manage your personal information and account settings</p>
          </div>

          <div className="profile-content">
            {/* Left Sidebar Card */}
            <div className="profile-sidebar">
              <div className="avatar-circle">
                {getInitials()}
              </div>
              
              <div className="profile-name-container">
                <h3 className="profile-fullname">{doctorName}</h3>
                {formData.specialization && (
                  <p className="doctor-specialty-badge">{formData.specialization}</p>
                )}
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
                  <i className="fas fa-user-md"></i>
                  <span>Status: <span className={`doctor-status ${doctorData.status === 'active' ? 'status-active' : 'status-inactive'}`}>
                    {doctorData.status === 'active' ? 'Active' : 'Inactive'}
                  </span></span>
                </div>
              </div>
              
              <div className="member-since">
                <i className="fas fa-calendar-plus"></i> 
                Member since {memberSince}
              </div>
            </div>

            {/* Right Main Content */}
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

                    <div className="form-row">
                      <div className="form-group">
                        <label><i className="fas fa-stethoscope"></i> Specialization</label>
                        <input type="text" name="specialization" value={formData.specialization} onChange={handleProfileChange} placeholder="e.g., Orthodontics, Pediatrics" disabled={loading} />
                      </div>
                      <div className="form-group">
                        <label><i className="fas fa-phone"></i> Contact Number</label>
                        <input type="tel" name="contact_no" value={formData.contact_no} onChange={handleProfileChange} placeholder="09123456789" className={errors.contact_no ? 'error' : ''} disabled={loading} />
                        {errors.contact_no && <div className="validation-message error">{errors.contact_no}</div>}
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
      </div>

      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default DoctorProfile;