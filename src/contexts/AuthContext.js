import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

const emailPattern = email => email.replace(/[\\%_]/g, '\\$&');
const identityKey = account => account ? `${account.id}:${account.email}` : null;
const recoverPatientRegistration = async (profile) => {
  const { data, error } = await supabase.functions.invoke('recover-patient-registration', {
    body: profile ? { profile } : {},
  });
  if (error) {
    let details;
    try { details = await error.context?.json(); } catch { /* Keep the transport error below. */ }
    const failure = new Error(details?.error || error.message || 'Could not complete registration. Please try again.');
    failure.code = details?.code;
    throw failure;
  }
  if (!data?.success || !data.patient?.patient_id) throw new Error(data?.error || 'Your patient registration is not complete.');
  return { type: 'patient', details: data.patient };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [registrationIncomplete, setRegistrationIncomplete] = useState(false);
  const [accountError, setAccountError] = useState('');
  const isMounted = useRef(true);
  const signingUpRef = useRef(false);
  const profileRequests = useRef(new Map());
  const currentIdentity = useRef(null);

  const loadAccountProfile = useCallback(account => {
    const key = identityKey(account);
    if (profileRequests.current.has(key)) return profileRequests.current.get(key);
    const request = (async () => {
      const records = await Promise.all(['patients', 'doctors', 'admin'].map(async table => {
        const { data, error } = await supabase.from(table).select('*')
          .ilike('email', emailPattern(account.email)).maybeSingle();
        if (error) throw new Error('Could not load your account profile. Please try logging in again.');
        return data ? { type: table === 'patients' ? 'patient' : table === 'doctors' ? 'doctor' : 'admin', details: data } : null;
      }));
      const matches = records.filter(Boolean);
      if (matches.length > 1) throw new Error('Your email is assigned to multiple profiles. Please contact the clinic.');
      if (matches.length) return matches[0];
      if (account.email.toLowerCase() === 'jhoncarl.jubilag@cvsu.edu.ph') {
        return { type: 'admin', details: { email: account.email, first_name: 'Super', last_name: 'Admin' } };
      }
      if (currentIdentity.current !== key) throw new Error('Your login session changed. Please try again.');
      return recoverPatientRegistration();
    })().finally(() => profileRequests.current.delete(key));
    profileRequests.current.set(key, request);
    return request;
  }, []);

  // Helper function to calculate age
  const calculateAge = (birthday) => {
    if (!birthday) return null;
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const [year, month, day] = birthday.split('-').map(Number);
    const pending = Number(today.month) < month || (Number(today.month) === month && Number(today.day) < day);
    return Number(today.year) - year - (pending ? 1 : 0);
  };

  // Auth state listener
  useEffect(() => {
    isMounted.current = true;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted.current) {
        currentIdentity.current = identityKey(session?.user);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    }).catch(() => {
      if (isMounted.current) setLoading(false);
    });

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (isMounted.current) {
          if (signingUpRef.current) return;
          currentIdentity.current = identityKey(session?.user);
          setUser(session?.user ?? null);
        }
      }
    );

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch user details when user changes
  useEffect(() => {
    if (!user) {
      setUserDetails(null);
      setUserType(null);
      setProfileLoading(false);
      setRegistrationIncomplete(false);
      return;
    }
    let cancelled = false;
    setUserType(null);
    setUserDetails(null);
    setProfileLoading(true);
    setRegistrationIncomplete(false);
    if (!user.email_confirmed_at) {
      setProfileLoading(false);
      return;
    }
    loadAccountProfile(user).then(profile => {
      if (isMounted.current && !cancelled) {
        setUserType(profile.type);
        setUserDetails(profile.details);
        setAccountError('');
      }
    }).catch(error => {
      if (!isMounted.current || cancelled) return;
      setAccountError(error.message);
      if (error.code === 'profile_details_required') {
        setRegistrationIncomplete(true);
      }
    }).finally(() => {
      if (isMounted.current && !cancelled) setProfileLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, loadAccountProfile]);

  // Sign Up
  const signUp = async (email, password, userData) => {
  if (currentIdentity.current) return { success: false, message: 'Please sign out before creating another account.' };
  if (signingUpRef.current) return { success: false, message: 'Registration is already in progress.' };
  signingUpRef.current = true;
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const profile = {
      first_name: userData.first_name.trim(), last_name: userData.last_name.trim(),
      address: userData.address.trim(), contact_no: userData.contact_no.trim(), birthday: userData.birthday,
    };
    const birthday = new Date(`${profile.birthday}T00:00:00Z`);
    if (!profile.first_name || !profile.last_name || profile.first_name.length > 200 || profile.last_name.length > 200 ||
      profile.address.length < 5 || profile.address.length > 2000 || !/^\d{11}$/.test(profile.contact_no) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday) || !Number.isFinite(birthday.getTime()) ||
      birthday.toISOString().slice(0, 10) !== profile.birthday || calculateAge(profile.birthday) < 5) {
      throw new Error('Enter valid patient registration details before creating an account.');
    }
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/verify-email`,
        data: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          registration_profile: profile,
        }
      }
    });

    if (authError) throw authError;

    if (authData.session) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }

    if (!authData.user?.id || authData.user.email?.toLowerCase() !== normalizedEmail ||
      !Array.isArray(authData.user.identities) || authData.user.identities.length === 0) {
      return { success: false, message: 'Registration could not be completed. If you already have an account, verify your email and log in, or use Forgot Password.' };
    }
    try {
      const { error: dbError } = await supabase
        .from('patients')
        .insert([{
          ...profile,
          email: normalizedEmail,
          age: calculateAge(profile.birthday),
          email_verified: false,
          status: 'active',
          date_created: new Date().toISOString()
        }]);
      if (dbError) throw dbError;
    } catch {
      return { success: false, message: 'Your login account was created, but your patient profile could not be saved. Verify your email, then log in to finish registration. Your existing account will be kept.' };
    }

    return {
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      user: authData.user
    };
  } catch (error) {
    console.error('Sign up error:', error);
    return { success: false, message: error.message };
  } finally {
    signingUpRef.current = false;
  }
};

  // Sign In
  const signIn = async (email, password) => {
    let account;
    setAccountError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      account = data.user;
      if (!data.user.email_confirmed_at) {
        await supabase.auth.signOut({ scope: 'local' });
        return { success: false, message: 'Please verify your email before logging in.', needsVerification: true };
      }
      const profile = await loadAccountProfile(data.user);
      if (currentIdentity.current !== identityKey(data.user)) throw new Error('Your login session changed. Please try again.');
      setUserType(profile.type);
      setUserDetails(profile.details);
      setRegistrationIncomplete(false);
      try {
        if (profile.type === 'patient') {
          await supabase.from('patients').update({ email_verified: true }).eq('patient_id', profile.details.patient_id);
        }
      } catch (updateErr) {
        console.warn('Update email_verified error:', updateErr);
      }
      return { success: true, data };
    } catch (error) {
      if (error.code === 'profile_details_required' && currentIdentity.current === identityKey(account)) {
        setRegistrationIncomplete(true);
        setAccountError(error.message);
        return { success: false, needsProfileCompletion: true, message: error.message };
      }
      if (account && currentIdentity.current === identityKey(account)) {
        await supabase.auth.signOut({ scope: 'local' });
        currentIdentity.current = null;
        setUser(null);
        setUserType(null);
        setUserDetails(null);
      }
      return { success: false, message: error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message };
    }
  };

  const completeRegistration = async profile => {
    try {
      const identity = identityKey(user);
      const result = await recoverPatientRegistration(profile);
      if (currentIdentity.current !== identity) throw new Error('Your session changed. Please log in again.');
      setUserType(result.type);
      setUserDetails(result.details);
      setRegistrationIncomplete(false);
      setAccountError('');
      return { success: true, message: 'Patient registration completed successfully! You can now book appointments.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  // Sign Out
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setUserDetails(null);
      setUserType(null);
      return { success: true };
    } catch (error) {
      console.error('Sign out error:', error);
      return { success: false, error: error.message };
    }
  };

  // Update Profile
  const updateProfile = async (userData) => {
    try {
      if (!user) throw new Error('No user logged in');

      const { error } = await supabase
        .from('patients')
        .update({
          first_name: userData.first_name,
          last_name: userData.last_name,
          email: userData.email,
          address: userData.address,
          contact_no: userData.contact_no,
          birthday: userData.birthday,
          age: calculateAge(userData.birthday)
        })
        .eq('email', user.email);

      if (error) throw error;

      setUserDetails(prev => ({ ...prev, ...userData }));
      
      return { success: true, message: 'Profile updated successfully!' };
    } catch (error) {
      console.error('Update profile error:', error);
      return { success: false, message: error.message };
    }
  };

  // Change Password
  const changePassword = async (currentPassword, newPassword) => {
    try {
      if (!user) throw new Error('No user logged in');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });

      if (signInError) throw new Error('Current password is incorrect');

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) throw updateError;

      return { success: true, message: 'Password changed successfully!' };
    } catch (error) {
      console.error('Change password error:', error);
      return { success: false, message: error.message };
    }
  };

  // Resend Verification Email
  const resendVerification = async (email) => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: { emailRedirectTo: `${window.location.origin}/verify-email` }
      });
      if (error) throw error;
      return { success: true, message: 'Verification email resent.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  // Forgot Password
  const forgotPassword = async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      return { success: true, message: 'Password reset instructions sent to your email.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  // Reset Password
  const resetPassword = async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return { success: true, message: 'Password reset successfully. You can now log in.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  const value = {
    user,
    userType,
    userDetails,
    loading: loading || profileLoading,
    registrationIncomplete,
    accountError,
    completeRegistration,
    signUp,
    signIn,
    signOut,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    resendVerification
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading...
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
