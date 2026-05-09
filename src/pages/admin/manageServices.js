import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageServices.css';

const ManageServices = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [formData, setFormData] = useState({
    service_name: '',
    description: '',
    price: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';
      if (!user) {
        navigate('/login');
      } else if (userType !== 'admin' && !isSuperAdmin) {
        navigate('/');
      }
    }
  }, [user, userType, authLoading, navigate]);

  useEffect(() => {
    if (user && (userType === 'admin' || user?.email === 'jhoncarl.jubilag@cvsu.edu.ph')) {
      fetchServices();
    }
  }, [user, userType]);

  const fetchServices = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('service_name');

      if (error) throw error;
      setServices(data || []);
      
      const active = data?.filter(s => s.status === 'active').length || 0;
      const inactive = data?.filter(s => s.status === 'inactive').length || 0;
      setStats({ total: data?.length || 0, active, inactive });
      
    } catch (err) {
      console.error('Error fetching services:', err);
      setError('Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    try {
      const { data: existing } = await supabase
        .from('services')
        .select('service_id')
        .eq('service_name', formData.service_name.trim())
        .maybeSingle();
      
      if (existing) {
        setError('A service with this name already exists.');
        setIsSubmitting(false);
        return;
      }
      
      const { error } = await supabase
        .from('services')
        .insert([{
          service_name: formData.service_name.trim(),
          description: formData.description.trim() || null,
          price: parseFloat(formData.price),
          status: 'active'
        }]);
      
      if (error) throw error;
      
      setSuccess('Service added successfully!');
      setShowAddModal(false);
      setFormData({ service_name: '', description: '', price: '' });
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error adding service:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditService = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    
    try {
      const { data: existing } = await supabase
        .from('services')
        .select('service_id')
        .eq('service_name', formData.service_name.trim())
        .neq('service_id', selectedService.service_id)
        .maybeSingle();
      
      if (existing) {
        setError('A service with this name already exists.');
        setIsSubmitting(false);
        return;
      }
      
      const { error } = await supabase
        .from('services')
        .update({
          service_name: formData.service_name.trim(),
          description: formData.description.trim() || null,
          price: parseFloat(formData.price),
          status: formData.status
        })
        .eq('service_id', selectedService.service_id);
      
      if (error) throw error;
      
      setSuccess('Service updated successfully!');
      setShowEditModal(false);
      setSelectedService(null);
      setFormData({ service_name: '', description: '', price: '' });
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error updating service:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (service) => {
    const newStatus = service.status === 'active' ? 'inactive' : 'active';
    const confirmMsg = service.status === 'active' 
      ? 'Are you sure you want to deactivate this service?'
      : 'Are you sure you want to activate this service?';
    
    if (!window.confirm(confirmMsg)) return;
    
    try {
      const { error } = await supabase
        .from('services')
        .update({ status: newStatus })
        .eq('service_id', service.service_id);
      
      if (error) throw error;
      
      setSuccess(`Service ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully!`);
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error toggling status:', err);
      setError(err.message);
    }
  };

  const handleDeleteService = async (service) => {
    if (!window.confirm('Are you sure you want to delete this service? This action cannot be undone.')) return;
    
    try {
      const { count, error: countError } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('service_id', service.service_id);
      
      if (countError) throw countError;
      
      if (count > 0) {
        const { error } = await supabase
          .from('services')
          .update({ status: 'inactive' })
          .eq('service_id', service.service_id);
        
        if (error) throw error;
        setSuccess('Service deactivated (has existing appointments).');
      } else {
        const { error } = await supabase
          .from('services')
          .delete()
          .eq('service_id', service.service_id);
        
        if (error) throw error;
        setSuccess('Service deleted successfully!');
      }
      
      fetchServices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error deleting service:', err);
      setError(err.message);
    }
  };

  const openAddModal = () => {
    setFormData({ service_name: '', description: '', price: '' });
    setError('');
    setShowAddModal(true);
  };

  const openEditModal = (service) => {
    setSelectedService(service);
    setFormData({
      service_name: service.service_name,
      description: service.description || '',
      price: service.price,
      status: service.status
    });
    setError('');
    setShowEditModal(true);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading || loading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';
  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />

      <div className="main-content">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Services</h1>
            <p className="welcome-message">Add, edit, or remove dental services offered by the clinic</p>
          </div>
          <div className="header-actions">
            <div className="user-info">
              <div className="user-avatar">{adminInitial}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">System Administrator</div>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="services-grid">
          <div className="card">
            <div className="card-header">
              <h3>All Services</h3>
              <button className="btn btn-primary" onClick={openAddModal}>
                <i className="fas fa-plus"></i> Add New Service
              </button>
            </div>
            <div className="card-body">
              <div className="services-list">
                {services.length === 0 ? (
                  <div className="empty-state">
                    <i className="fas fa-tooth"></i>
                    <p>No services found</p>
                    <p style={{ marginTop: '10px', fontSize: '0.9rem' }}>Add your first service using the button above.</p>
                  </div>
                ) : (
                  services.map(service => (
                    <div key={service.service_id} className={`service-item ${service.status === 'inactive' ? 'inactive' : ''}`}>
                      <div className="service-header">
                        <div className="service-header-content">
                          <div className="service-icon">🦷</div>
                          <div className="service-info">
                            <div className="service-title">{service.service_name}</div>
                            <div className="service-price">{Number(service.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
                          </div>
                        </div>
                        <span className={`status-badge status-${service.status}`}>
                          {service.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="service-body">
                        <div className="service-description">
                          {service.description || 'No description provided.'}
                        </div>
                      </div>
                      <div className="service-footer">
                        <div className="service-meta">
                          <strong>ID:</strong> {service.service_id} | 
                          <strong> Status:</strong> {service.status === 'active' ? 'Active' : 'Inactive'}
                        </div>
                        <div className="service-actions">
                          <button className="btn btn-warning btn-sm" onClick={() => openEditModal(service)}>
                            <i className="fas fa-edit"></i> Edit
                          </button>
                          <button 
                            className={`btn btn-sm ${service.status === 'active' ? 'btn-secondary' : 'btn-success'}`}
                            onClick={() => handleToggleStatus(service)}
                          >
                            <i className={`fas fa-${service.status === 'active' ? 'ban' : 'check'}`}></i>
                            {service.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeleteService(service)}>
                            <i className="fas fa-trash"></i> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Service Statistics</h3>
            </div>
            <div className="card-body">
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-number">{stats.total}</div>
                  <div className="stat-label">Total Services</div>
                </div>
                <div className="stat-card stat-active">
                  <div className="stat-number">{stats.active}</div>
                  <div className="stat-label">Active Services</div>
                </div>
                <div className="stat-card stat-inactive">
                  <div className="stat-number">{stats.inactive}</div>
                  <div className="stat-label">Inactive Services</div>
                </div>
              </div>
              
              <div className="quick-actions">
                <h4>Quick Actions</h4>
                <button className="btn btn-primary" onClick={openAddModal} style={{ width: '100%' }}>
                  <i className="fas fa-plus"></i> Add New Service
                </button>
                <button className="btn btn-secondary" onClick={fetchServices} style={{ width: '100%' }}>
                  <i className="fas fa-sync-alt"></i> Refresh List
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Add New Service</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleAddService}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Service Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.service_name}
                    onChange={(e) => setFormData({ ...formData, service_name: e.target.value })}
                    placeholder="e.g., Dental Checkup, Teeth Cleaning"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    className="form-control"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the service, procedure details, duration, etc."
                    rows="4"
                  />
                </div>
                <div className="form-group">
                  <label>Price (₱) *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="e.g., 500.00"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? <i className="fas fa-spinner fa-spin"></i> : 'Add Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && selectedService && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Edit Service</h3>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleEditService}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Service Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.service_name}
                    onChange={(e) => setFormData({ ...formData, service_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    className="form-control"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows="4"
                  />
                </div>
                <div className="form-group">
                  <label>Price (₱) *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Status *</label>
                  <select
                    className="form-control"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? <i className="fas fa-spinner fa-spin"></i> : 'Update Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-content">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Logging out...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageServices;