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
        // Get token from URL hash (Supabase sends token in hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');

        console.log('Verification params:', { type, hasAccessToken: !!accessToken });

        if (type === 'signup' || type === 'email_verification') {
          if (accessToken) {
            // Set the session using the token (this logs the user in temporarily)
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || ''
            });
            if (sessionError) throw sessionError;

            // Get the user to confirm email
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
              } else {
                console.log('Patient email_verified updated to true');
              }

              // Sign out immediately to prevent auto-login
              await supabase.auth.signOut();

              setStatus('success');
              setMessage('Email verified successfully! Your account is now active.');

              // Redirect to login after 2 seconds
              setTimeout(() => {
                navigate('/login', { 
                  replace: true, 
                  state: { message: 'Email verified successfully! You can now log in.' } 
                });
              }, 2000);
            } else {
              throw new Error('Email not confirmed yet');
            }
          } else {
            throw new Error('No access token found');
          }
        } else {
          throw new Error('Invalid verification type');
        }
      } catch (error) {
        console.error('Verification error:', error);
        setStatus('error');
        setMessage(error.message || 'Invalid or expired verification link. Please request a new verification email.');
      }
    };

    verifyEmail();
  }, [navigate]);

  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, countdown]);

  const handleRedirect = () => {
    navigate('/login', { replace: true, state: { message: 'Please log in to continue.' } });
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
                  <p className="redirect-message">Redirecting in <span className="countdown">{countdown}</span> seconds...</p>
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