import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const isMounted = useRef(true);
  const fetchingRef = useRef(false);

  // Helper function to calculate age
  const calculateAge = (birthday) => {
    const today = new Date();
    const birthDate = new Date(birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  // Auth state listener
  useEffect(() => {
    isMounted.current = true;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted.current) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (isMounted.current) {
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
      return;
    }

    const fetchUserDetails = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      try {
        // Check patients table
        const { data: patientData } = await supabase
          .from('patients')
          .select('*')
          .eq('email', user.email)
          .maybeSingle();

        if (patientData) {
          if (isMounted.current) {
            setUserType('patient');
            setUserDetails(patientData);
          }
          return;
        }

        // Check doctors table
        const { data: doctorData } = await supabase
          .from('doctors')
          .select('*')
          .eq('email', user.email)
          .maybeSingle();

        if (doctorData) {
          if (isMounted.current) {
            setUserType('doctor');
            setUserDetails(doctorData);
          }
          return;
        }

        // Check admin table
        const { data: adminData } = await supabase
          .from('admin')
          .select('*')
          .eq('email', user.email)
          .maybeSingle();

        if (adminData) {
          if (isMounted.current) {
            setUserType('admin');
            setUserDetails(adminData);
          }
          return;
        }

        // Fallback to metadata
        if (isMounted.current) {
          setUserType('patient');
          setUserDetails({
            first_name: user.user_metadata?.first_name || 'User',
            last_name: user.user_metadata?.last_name || '',
            email: user.email,
            from_fallback: true
          });
        }
      } catch (error) {
        console.error('Error fetching user details:', error);
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchUserDetails();
  }, [user]);

  // Sign Up
  const signUp = async (email, password, userData) => {
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/verify-email`,
          data: {
            first_name: userData.first_name,
            last_name: userData.last_name,
            user_type: 'patient'
          }
        }
      });

      if (authError) throw authError;

      if (authData.user) {
        try {
          const { error: dbError } = await supabase
            .from('patients')
            .insert([{
              first_name: userData.first_name,
              last_name: userData.last_name,
              email: email,
              address: userData.address,
              contact_no: userData.contact_no,
              birthday: userData.birthday,
              age: calculateAge(userData.birthday),
              email_verified: false,
              status: 'active',
              date_created: new Date().toISOString()
            }]);

          if (dbError) console.error('DB insert error:', dbError);
        } catch (dbError) {
          console.error('DB insert exception:', dbError);
        }
      }

      return { success: true, message: 'Registration successful! Please verify your email.', user: authData.user };
    } catch (error) {
      console.error('Sign up error:', error);
      return { success: false, message: error.message };
    }
  };

  // Sign In
  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        return { success: false, message: 'Please verify your email before logging in.', needsVerification: true };
      }
      try {
        await supabase.from('patients').update({ email_verified: true }).eq('email', email);
      } catch (updateErr) {
        console.warn('Update email_verified error:', updateErr);
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message };
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
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      return { success: true, message: 'Password reset email sent.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  // Reset Password
  const resetPassword = async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return { success: true, message: 'Password reset successfully.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  };

  const value = {
    user,
    userType,
    userDetails,
    loading,
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