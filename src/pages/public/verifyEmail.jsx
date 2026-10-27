import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, emailConfirmationCallback } from '../../services/supabase';
import DentalLogo from '../../assets/DentalLogo.png';
import './verify.css';

const VerifyEmail = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('Verifying your email...');
  const [countdown, setCountdown] = useState(5);

  const verificationRequest = useRef(null);

  useEffect(() => {
    let active = true;
    // Share one request across StrictMode's effect replay: signing out twice
    // could otherwise turn a successful verification into a missing-session error.
    if (!verificationRequest.current) {
      verificationRequest.current = (async () => {
        if (emailConfirmationCallback.error) {
          throw new Error('This confirmation link is invalid or expired. Please request a new confirmation email.');
        }
        if (!emailConfirmationCallback.received) {
          throw new Error('Open the confirmation link from your registration email to verify your account.');
        }
        // Auth initializes the callback session itself, including consuming tokens.
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) throw new Error('This confirmation link is invalid or expired. Please request a new confirmation email.');
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user?.email_confirmed_at) throw new Error('Your email has not been confirmed. Please use the confirmation link in your email.');
        // Patient verification is synchronized by signIn. No profile write is
        // required here, so a database failure cannot hide confirmed Auth status.
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) throw new Error('Email confirmed, but automatic sign-out failed. Refresh this page and try again before logging in.');
      })();
    }
    verificationRequest.current.then(() => {
      if (!active) return;
      setStatus('success');
      setMessage('Email confirmed successfully! Your account is ready. Please log in.');
    }).catch(error => {
      if (!active) return;
      setStatus('error');
      setMessage(error.message || 'Could not verify your email. Please try again.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (status !== 'success') return;
    if (countdown === 0) {
      navigate('/login', { replace: true, state: { emailVerified: true } });
      return;
    }
    const timer = setTimeout(() => setCountdown(current => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, navigate]);

  const handleRedirect = () => {
    navigate('/login', { replace: true, state: { emailVerified: true } });
  };

  return (
    <div className="verify-container">
      <div className="verify-background" aria-hidden="true"></div>
      <div className="verify-content">
        <div className="verify-card">
          <Link to="/" className="verify-brand" aria-label="Fifthcusp Dental Clinic homepage">
            <img src={DentalLogo} alt="" />
            <span><strong>Fifthcusp</strong><small>Dental Clinic</small></span>
          </Link>
          <div className="verify-header">
            <div className={`verify-icon ${status}`} aria-hidden="true">
              {status === 'verifying' && <i className="fas fa-spinner fa-spin"></i>}
              {status === 'success' && <i className="fas fa-check-circle"></i>}
              {status === 'error' && <i className="fas fa-exclamation-circle"></i>}
            </div>
            <p className="verify-eyebrow">Email verification</p>
            <h1>{status === 'success' ? "You're all set!" : status === 'error' ? 'Unable to verify email' : 'Confirming your email'}</h1>
          </div>
          <div className={`verify-status verify-${status}`} role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
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
                  <p><i className="fas fa-check" aria-hidden="true"></i> Email address confirmed</p>
                  <p><i className="fas fa-check" aria-hidden="true"></i> Ready to log in to your account</p>
                </div>
                <div className="success-actions">
                  <button onClick={handleRedirect} className="verify-btn verify-btn-primary">
                    Continue to Login <i className="fas fa-arrow-right" aria-hidden="true"></i>
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

              </div>
            )}
          </div>
          <div className="verify-footer">
            <Link to="/" className="verify-home-link"><i className="fas fa-arrow-left" aria-hidden="true"></i> Back to clinic homepage</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
