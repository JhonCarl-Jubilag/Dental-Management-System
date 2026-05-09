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
import ManageServices from './pages/admin/manageServices';
import ManageDoctors from './pages/admin/manageDoctors';
import ManagePatients from './pages/admin/managePatients';

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

  // Redirect if not logged in
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Redirect if wrong user type
  if (allowedUserType && userType !== allowedUserType) {
    if (user.email === 'jhoncarl.jubilag@cvsu.edu.ph' && allowedUserType === 'admin') {
      return children;
    }
    return <Navigate to="/" replace />;
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
      <Route path="/admin/services" element={
        <ProtectedRoute allowedUserType="admin">
          <ManageServices />
        </ProtectedRoute>
      } />
      <Route path="/admin/doctors" element={
        <ProtectedRoute allowedUserType="admin">
          <ManageDoctors />
        </ProtectedRoute>
      } />
      <Route path="/admin/patients" element={
        <ProtectedRoute allowedUserType="admin">
          <ManagePatients />
        </ProtectedRoute>
      } />
      <Route path="/admin/patients/:id" element={
        <ProtectedRoute allowedUserType="admin">
          <ManagePatients />
        </ProtectedRoute>
      } />

      {/* Fallback Route */}
      <Route path="*" element={<Navigate to="/" replace />} />
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