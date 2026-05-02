import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './App.css';

// Public Pages
import Landing from './pages/public/landing';
import Login from './pages/public/login';
import Register from './pages/public/register';
import Logout from './pages/public/logout';

// Patient Pages
import Profile from './pages/patient/profile';
import MyAppointments from './pages/patient/myAppointments';

// Admin Pages
import AdminDashboard from './pages/admin/dashboard';

// Protected Route Component
const ProtectedRoute = ({ children, allowedUserType }) => {
  const { user, userType, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (allowedUserType && userType !== allowedUserType) {
    return <Navigate to="/" />;
  }

  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/logout" element={<Logout />} />
      
      {/* Protected Routes - Patient */}
      <Route path="/dashboard" element={
        <ProtectedRoute allowedUserType="patient">
          <div className="coming-soon">Patient Dashboard (Coming Soon)</div>
        </ProtectedRoute>
      } />
      <Route path="/book-appointment" element={
        <ProtectedRoute allowedUserType="patient">
          <div className="coming-soon">Book Appointment (Coming Soon)</div>
        </ProtectedRoute>
      } />
      <Route path="/my-appointments" element={
        <ProtectedRoute allowedUserType="patient">
          <MyAppointments />
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute allowedUserType="patient">
          <Profile />
        </ProtectedRoute>
      } />
      <Route path="/service/:id" element={
        <ProtectedRoute allowedUserType="patient">
          <div className="coming-soon">Service Details (Coming Soon)</div>
        </ProtectedRoute>
      } />
      
      {/* Protected Routes - Admin */}
      <Route path="/admin/dashboard" element={
        <ProtectedRoute allowedUserType="admin">
          <AdminDashboard />
        </ProtectedRoute>
      } />
      
      {/* Fallback Route */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="App">
          <AppRoutes />
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;