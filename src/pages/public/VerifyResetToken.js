import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import './verify-reset.css';

const VerifyResetToken = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const rawToken = searchParams.get('token');
    if (!rawToken) {
      setError('No reset token provided. Please request a new password reset link.');
    } else {
      setToken(rawToken);
    }
  }, [searchParams]);

  const handleVerify = async () => {
    if (!token) return;
    setLoading(true);
    setError('');

    try {
      // Verify the OTP using the token hash
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'recovery'
      });

      if (error) throw error;

      // Verification successful – redirect to reset password page
      setVerified(true);
      // Allow user to proceed manually or auto-redirect
      setTimeout(() => {
        navigate('/reset-password');
      }, 1500);
    } catch (err) {
      console.error('Verification error:', err);
      setError(err.message || 'Invalid or expired reset link. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="verify-reset-container">
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Password Reset Verification</h1>
            <p>Please confirm that you requested a password reset</p>
          </div>

          {error && (
            <div className="alert alert-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>{error}</p>
              <Link to="/forgot-password" className="alert-link">Request new reset link</Link>
            </div>
          )}

          {verified && (
            <div className="alert alert-success">
              <i className="fas fa-check-circle"></i>
              <p>Token verified! Redirecting to reset password page...</p>
            </div>
          )}

          {!error && !verified && token && (
            <div className="verify-action">
              <p>Click the button below to confirm your identity and reset your password.</p>
              <button 
                onClick={handleVerify} 
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner-small"></span> Verifying...
                  </>
                ) : (
                  'Confirm Password Reset'
                )}
              </button>
              <div className="form-footer">
                <Link to="/forgot-password">Request a new link</Link> | 
                <Link to="/login">Back to Login</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyResetToken;