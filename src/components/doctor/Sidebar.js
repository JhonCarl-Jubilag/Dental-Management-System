import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import DentalLogo from '../../assets/DentalLogo.png';

const DoctorSidebar = ({ onLogout }) => {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;

  return (
   <div className="sidebar">
  <div className="sidebar-header">
    <Link to="/admin/dashboard" className="logo">
      <img 
        src={DentalLogo} 
        alt="Fifthcusp Dental Clinic Logo" 
        className="logo-image"
      />
      <div className="logo-text">
        <h2>Fifthcusp</h2>
        <p>Doctor Portal</p>
      </div>
    </Link>
  </div>
      <ul className="sidebar-nav">
        <li>
          <Link to="/doctor/dashboard" className={`sidebar-link ${isActive('/doctor/dashboard') ? 'active' : ''}`}>
            <i className="fas fa-tachometer-alt nav-icon"></i>
            <span>Dashboard</span>
          </Link>
        </li>
        <li>
          <Link to="/doctor/manageSchedule" className={`sidebar-link ${isActive('/doctor/manageSchedule') ? 'active' : ''}`}>
            <i className="fas fa-calendar-alt nav-icon"></i>
            <span>Manage Schedule</span>
          </Link>
        </li>
        <li>
          <Link to="/doctor/manageAppointments" className={`sidebar-link ${isActive('/doctor/manageAppointments') ? 'active' : ''}`}>
            <i className="fas fa-calendar-check nav-icon"></i>
            <span>My Appointments</span>
          </Link>
        </li>
        <li>
          <Link to="/doctor/patients" className={`sidebar-link ${isActive('/doctor/patients') ? 'active' : ''}`}>
            <i className="fas fa-users nav-icon"></i>
            <span>Manage Patients</span>
          </Link>
        </li>
        <li>
          <Link to="/doctor/profile" className={`sidebar-link ${isActive('/doctor/profile') ? 'active' : ''}`}>
            <i className="fas fa-user nav-icon"></i>
            <span>Profile</span>
          </Link>
        </li>
        <li>
          <button onClick={onLogout} className="sidebar-link logout-btn">
            <i className="fas fa-sign-out-alt nav-icon"></i>
            <span>Logout</span>
          </button>
        </li>
      </ul>
    </div>
  );
};

export default DoctorSidebar;