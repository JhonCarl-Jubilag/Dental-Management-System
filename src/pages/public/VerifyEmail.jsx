import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import './verify.css';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('Verifying your email...');
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);
        
        const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
        const type = hashParams.get('type') || queryParams.get('type');
        
        console.log('Verification params:', { type, hasAccessToken: !!accessToken });

        if (type === 'signup' || type === 'email_verification' || type === 'verify') {
          if (accessToken) {
            // Try to set the session with the access token
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || ''
            });

            if (sessionError) throw sessionError;

            // Get the current user to confirm verification
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) throw userError;

            if (user && user.email_confirmed_at) {
              // Update email_verified in patients table
              const { error: updateError } = await supabase
                .from('patients')
                .update({ email_verified: true })
                .eq('email', user.email);

              if (updateError) {
                console.error('Error updating patient record:', updateError);
              }

              setStatus('success');
              setMessage('Email verified successfully! Your account is now active.');
              
              await supabase.auth.signOut();
            } else {
              throw new Error('Email not confirmed yet');
            }
          } else {
            const { data: { user } } = await supabase.auth.getUser();
            
            if (user?.email_confirmed_at) {
              setStatus('success');
              setMessage('Email already verified! Your account is active.');
              
              // Update patient record
              await supabase
                .from('patients')
                .update({ email_verified: true })
                .eq('email', user.email);
            } else {
              throw new Error('No access token found');
            }
          }
        } else {
          // Try to get session directly
          const { data: { user } } = await supabase.auth.getUser();
          
          if (user?.email_confirmed_at) {
            setStatus('success');
            setMessage('Email verified successfully! Your account is now active.');
          } else {
            throw new Error('Invalid verification link');
          }
        }
      } catch (error) {
        console.error('Verification error:', error);
        setStatus('error');
        setMessage('Invalid or expired verification link. Please request a new verification email.');
      }
    };

    verifyEmail();
  }, []);

  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, countdown]);

  const handleRedirect = () => {
    navigate('/login');
  };

  return (
    <div className="verify-container">
      <div className="verify-background"></div>
      
      <div className="verify-content">
        <div className="verify-card">
          <div className="verify-header">
            <div className={`verify-icon ${status}`}>
              {status === 'verifying' && <i className="fas fa-spinner fa-spin"></i>}
              {status === 'success' && <i className="fas fa-check-circle"></i>}
              {status === 'error' && <i className="fas fa-exclamation-circle"></i>}
            </div>
            <h2>Email Verification</h2>
          </div>
          
          <div className={`verify-status verify-${status}`}>
            <p className="verify-message">{message}</p>
            
            {status === 'verifying' && (
              <div className="verifying-progress">
                <div className="progress-bar"></div>
                <p className="verifying-sub">Please wait while we verify your email...</p>
              </div>
            )}
            
            {status === 'success' && (
              <div className="success-content">
                <div className="success-details">
                  <p><i className="fas fa-check"></i> Your account is now active</p>
                  <p><i className="fas fa-check"></i> You can now login to your account</p>
                </div>
                
                <div className="success-actions">
                  <button onClick={handleRedirect} className="verify-btn verify-btn-primary">
                    <i className="fas fa-sign-in-alt"></i> Go to Login Now
                  </button>
                  <p className="redirect-message">
                    Redirecting in <span className="countdown">{countdown}</span> seconds...
                  </p>
                </div>
              </div>
            )}
            
            {status === 'error' && (
              <div className="error-actions">
                <p className="error-help">
                  <i className="fas fa-exclamation-triangle"></i> 
                  The verification link may have expired or is invalid.
                </p>
                <Link to="/login" className="verify-btn verify-btn-primary">
                  <i className="fas fa-sign-in-alt"></i> Go to Login
                </Link>
                <Link to="/resend-verification" className="verify-btn verify-btn-secondary">
                  <i className="fas fa-envelope"></i> Resend Verification Email
                </Link>
              </div>
            )}
          </div>
          
          {status === 'success' && (
            <div className="verify-footer">
              <p className="footer-note">
                <i className="fas fa-info-circle"></i> 
                You will be automatically redirected to the login page.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;