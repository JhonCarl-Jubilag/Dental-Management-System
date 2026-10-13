import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import './forgot-password.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSendResetEmail = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSuccess('If an account exists for this email, a password reset link has been requested. Open the newest email and click its link to choose a new password.');
    } catch (err) {
      setError(err.message || 'Could not request a reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-container">
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Forgot Password</h1>
            <p>Enter your email to receive a password reset link.</p>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {success && <div className="alert alert-success" role="status">{success}</div>}
          <form onSubmit={handleSendResetEmail}>
            <div className="form-group">
              <label htmlFor="forgot-password-email">Email Address</label>
              <input id="forgot-password-email" type="email" value={email}
                onChange={e => { setEmail(e.target.value); setSuccess(''); }}
                required disabled={loading} autoComplete="email" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Email'}
            </button>
          </form>
          <div className="form-footer">
            <Link to="/login">Back to Login</Link> | <Link to="/register">Create Account</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
