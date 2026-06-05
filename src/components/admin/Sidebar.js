import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import DentalLogo from '../../assets/DentalLogo.png';


const Sidebar = ({ onLogout }) => {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;

  return (
<div className="sidebar">
  <div className="sidebar-header">
    <div className="logo">
          <img 
            src={DentalLogo} 
            alt="Fifthcusp Dental Clinic Logo" 
            className="logo-image"
          />
          <div className="logo-text">
            <h2>Fifthcusp</h2>
            <p>Admin Portal</p>
          </div>
      </div>
  </div>
      
      <ul className="sidebar-nav">
        <li>
          <Link to="/admin/dashboard" className={`sidebar-link ${isActive('/admin/dashboard') ? 'active' : ''}`}>
            <i className="fas fa-tachometer-alt nav-icon"></i>
            <span>Dashboard</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/services" className={`sidebar-link ${isActive('/admin/services') ? 'active' : ''}`}>
            <i className="fas fa-tooth nav-icon"></i>
            <span>Manage Services</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/doctors" className={`sidebar-link ${isActive('/admin/doctors') ? 'active' : ''}`}>
            <i className="fas fa-user-md nav-icon"></i>
            <span>Manage Doctors</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/appointments" className={`sidebar-link ${isActive('/admin/appointments') ? 'active' : ''}`}>
            <i className="fas fa-calendar-check nav-icon"></i>
            <span>Manage Appointments</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/patients" className={`sidebar-link ${isActive('/admin/patients') ? 'active' : ''}`}>
            <i className="fas fa-users nav-icon"></i>
            <span>Manage Patients</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/billing" className={`sidebar-link ${isActive('/admin/billing') ? 'active' : ''}`}>
            <i className="fas fa-receipt nav-icon"></i>
            <span>Billing</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/reports" className={`sidebar-link ${isActive('/admin/reports') ? 'active' : ''}`}>
            <i className="fas fa-chart-bar nav-icon"></i>
            <span>Reports</span>
          </Link>
        </li>
        
        <li>
          <Link to="/admin/inventory" className={`sidebar-link ${isActive('/admin/inventory') ? 'active' : ''}`}>
            <i className="fas fa-boxes nav-icon"></i>
            <span>Inventory</span>
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

export default Sidebar;