import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './App.css';

// Public Pages
import Landing from './pages/public/landing';
import Login from './pages/public/login';
import Register from './pages/public/register';
import Logout from './pages/public/logout';
import ForgotPassword from './pages/public/forgotPassword';
import ResetPassword from './pages/public/resetPassword';
import VerifyEmail from './pages/public/verifyEmail';
import ServiceDetail from './pages/patient/serviceDetail';
import VerifyResetToken from './pages/public/VerifyResetToken';

// Patient Pages
import Profile from './pages/patient/profile';
import MyAppointments from './pages/patient/myAppointments';
import BookAppointment from './pages/patient/bookAppointment';


// Admin Pages
import AdminDashboard from './pages/admin/dashboard';
import ManageServices from './pages/admin/manageServices';
import ManageDoctors from './pages/admin/manageDoctors';
import ManagePatients from './pages/admin/managePatients';
import ManageAppointmentsAdmin from './pages/admin/manageAppointments'; 
import ManualBooking from './pages/admin/manualBooking';
import Billing from './pages/admin/manageBilling';
import Reports from './pages/admin/reports';
import ManageInventory from './pages/admin/manageInventory';

// Doctor Pages
import DoctorDashboard from './pages/doctor/doctorDashboard';
import ManagePatientsDoctor from './pages/doctor/managePatients';
import DoctorProfile from './pages/doctor/profile';
import DoctorManageAppointments from './pages/doctor/manageAppointments';
import ManageSchedule from './pages/doctor/manageSchedule';

const ProtectedRoute = ({ children, allowedUserType }) => {
  const { user, userType, loading } = useAuth();

  if (loading || (user && !userType)) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading your account...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

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
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/logout" element={<Logout />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/service/:id" element={<ServiceDetail/>} />
      <Route path="/verify-reset" element={<VerifyResetToken />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Patient */}
      <Route path="/dashboard" element={
        <ProtectedRoute allowedUserType="patient">
          <div className="coming-soon">Patient Dashboard (Coming Soon)</div>
        </ProtectedRoute>
      } />
      <Route path="/book-appointment" element={
        <ProtectedRoute allowedUserType="patient">
          <BookAppointment />
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
      
      {/* Admin */}
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
      <Route path="/admin/appointments" element={
        <ProtectedRoute allowedUserType="admin">
          <ManageAppointmentsAdmin />
        </ProtectedRoute>
      } />

      <Route path="/admin/manual-booking" element={
        <ProtectedRoute allowedUserType="admin">
          <ManualBooking />
        </ProtectedRoute>
      } />

      <Route path="/admin/billing" element={
        <ProtectedRoute allowedUserType="admin">
          <Billing />
        </ProtectedRoute>
      } />

      <Route path="/admin/reports" element={
        <ProtectedRoute allowedUserType="admin">
          <Reports />
        </ProtectedRoute>
      } />

      <Route path="/admin/inventory" element={
        <ProtectedRoute allowedUserType="admin">
          <ManageInventory />
        </ProtectedRoute>
      } />

      {/* Doctor */}
      <Route path="/doctor/dashboard" element={
        <ProtectedRoute allowedUserType="doctor">
          <DoctorDashboard />
        </ProtectedRoute>
      } />
      <Route path="/doctor/patients" element={
        <ProtectedRoute allowedUserType="doctor">
          <ManagePatientsDoctor />
        </ProtectedRoute>
      } />
      <Route path="/doctor/profile" element={
        <ProtectedRoute allowedUserType="doctor">
          <DoctorProfile />
        </ProtectedRoute>
      } />
      <Route path="/doctor/manageAppointments" element={
        <ProtectedRoute allowedUserType="doctor">
          <DoctorManageAppointments />
        </ProtectedRoute>
      } />
      <Route path="/doctor/manageSchedule" element={
        <ProtectedRoute allowedUserType="doctor">
          <ManageSchedule />
        </ProtectedRoute>
      } />

      {/* Fallback */}
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