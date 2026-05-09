import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Sidebar = ({ onLogout }) => {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <div className="logo-icon">🦷</div>
          <div className="logo-text">
            <h2>Fifthcusp</h2>
            <p>Admin Portal</p>
          </div>
        </div>
      </div>
      <ul className="sidebar-nav">
        <li><Link to="/admin/dashboard" className={`sidebar-link ${isActive('/admin/dashboard') ? 'active' : ''}`}><i className="fas fa-tachometer-alt nav-icon"></i><span>Dashboard</span></Link></li>
        <li><Link to="/admin/services" className={`sidebar-link ${isActive('/admin/services') ? 'active' : ''}`}><i className="fas fa-tooth nav-icon"></i><span>Manage Services</span></Link></li>
        <li><Link to="/admin/doctors" className={`sidebar-link ${isActive('/admin/doctors') ? 'active' : ''}`}><i className="fas fa-user-md nav-icon"></i><span>Manage Doctors</span></Link></li>
        <li><button className="sidebar-link" onClick={() => alert('Manage Appointments (Coming Soon)')}><i className="fas fa-calendar-check nav-icon"></i><span>Manage Appointments</span></button></li>
        <li><Link to="/admin/patients" className={`sidebar-link ${isActive('/admin/patients') ? 'active' : ''}`}><i className="fas fa-users nav-icon"></i><span>Manage Patients</span></Link></li>
        <li><button className="sidebar-link" onClick={() => alert('Billing (Coming Soon)')}><i className="fas fa-receipt nav-icon"></i><span>Billing</span></button></li>
        <li><button className="sidebar-link" onClick={() => alert('Reports (Coming Soon)')}><i className="fas fa-chart-line nav-icon"></i><span>Reports</span></button></li>
        <li><button onClick={onLogout} className="sidebar-link logout-btn"><i className="fas fa-sign-out-alt nav-icon"></i><span>Logout</span></button></li>
      </ul>
    </div>
  );
};

export default Sidebar;