import { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './forgot-password.css';

// Supabase removes the recovery fragment after establishing the session.
const recoveryHashOnLoad = new URLSearchParams(window.location.hash.slice(1));

function ResetPassword() {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const recoveryLink = hash.get('type') === 'recovery' || recoveryHashOnLoad.get('type') === 'recovery';
    const linkError = hash.get('error_description') || recoveryHashOnLoad.get('error_description') ||
      new URLSearchParams(window.location.search).get('error_description');
    const acceptRecovery = session => {
      if (!mounted || !session?.user) return;
      setEmail(session.user.email || '');
      setRecoveryReady(true);
      setMessage('');
      setChecking(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && !linkError) acceptRecovery(session);
      if (event === 'SIGNED_OUT' && mounted) setRecoveryReady(false);
    });
    const checkRecovery = async () => {
      if (linkError) {
        setMessage('This reset link is invalid or expired. Please request a new reset email.');
        setChecking(false);
        return;
      }
      // A normal login session must not automatically open the reset form.
      if (!recoveryLink && !location.state?.passwordRecovery) {
        setMessage('Open the link in your password reset email to choose a new password.');
        setChecking(false);
        return;
      }
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error || !session) {
          setMessage('This reset link is invalid or expired. Please request a new reset email.');
          setChecking(false);
        } else {
          acceptRecovery(session);
        }
      } catch {
        if (mounted) {
          setMessage('Could not verify the reset link. Please request a new reset email.');
          setChecking(false);
        }
      }
    };
    checkRecovery();
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [location.state]);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (loading || !recoveryReady || passwordUpdated) return;
    if (newPassword.length < 6 || newPassword !== confirmPassword) {
      setMessage('Passwords must match and contain at least 6 characters.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordUpdated(true);
      setNewPassword('');
      setConfirmPassword('');
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setMessage('Password updated. Please sign out before logging in with your new password.');
        return;
      }
      navigate('/login', { replace: true, state: { passwordResetSuccessful: true } });
    } catch (error) {
      setMessage(error.message || 'Could not update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-container">
      <div className="container">
        <div className="form-wrapper">
          <div className="form-header">
            <h1>Reset Password</h1>
            <p>{recoveryReady ? `Choose a new password for ${email}.` : 'Use the recovery link sent to your email.'}</p>
          </div>
          {checking && <p role="status">Verifying your reset link...</p>}
          {message && <div className={passwordUpdated ? 'alert alert-success' : 'alert alert-error'} role="alert">{message}</div>}
          {recoveryReady && !passwordUpdated && (
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label htmlFor="reset-new-password">New Password</label>
                <input id="reset-new-password" type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} minLength={6} required
                  disabled={loading} autoComplete="new-password" />
              </div>
              <div className="form-group">
                <label htmlFor="reset-confirm-password">Confirm New Password</label>
                <input id="reset-confirm-password" type="password" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} minLength={6} required
                  disabled={loading} autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Updating...' : 'Reset Password'}
              </button>
            </form>
          )}
          <div className="form-footer">
            <Link to="/forgot-password">Request a New Reset Email</Link> | <Link to="/login">Back to Login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
