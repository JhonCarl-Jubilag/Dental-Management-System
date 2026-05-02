import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const Logout = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleLogout = async () => {
      await signOut();
      navigate('/', { replace: true });
    };
    
    handleLogout();
  }, [signOut, navigate]);

  return null;
};

export default Logout;