import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageServices.css';

const ManageServices = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
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

  // Filters & pagination
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('service_name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const perPage = 5;
  const searchTimeout = useRef(null);

  const SUPER_ADMIN_EMAIL = 'jhoncarl.jubilag@cvsu.edu.ph';
  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'admin' && !isSuperAdmin) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  // Fetch services
  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('services').select('*', { count: 'exact' });

      if (debouncedSearch) {
        query = query.ilike('service_name', `%${debouncedSearch}%`);
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      setServices(data || []);
      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / perPage));

      // Update stats
      const { data: allData, error: statsError } = await supabase
        .from('services')
        .select('status');
      if (!statsError && allData) {
        const active = allData.filter(s => s.status === 'active').length;
        const inactive = allData.filter(s => s.status === 'inactive').length;
        setStats({ total: allData.length, active, inactive });
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, sortBy, sortOrder, page]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  // Initial fetch and when dependencies change
  useEffect(() => {
    if (user && (userType === 'admin' || isSuperAdmin)) {
      fetchServices();
    }
  }, [fetchServices, user, userType, isSuperAdmin]);

  const handleAddService = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { data: existing } = await supabase
        .from('services')
        .select('service_id')
        .eq('service_name', formData.service_name.trim())
        .maybeSingle();

      if (existing) {
        toast.error('A service with this name already exists.');
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.from('services').insert([{
        service_name: formData.service_name.trim(),
        description: formData.description.trim() || null,
        price: parseFloat(formData.price),
        status: 'active'
      }]);

      if (error) throw error;

      toast.success('Service added successfully!');
      setShowAddModal(false);
      setFormData({ service_name: '', description: '', price: '' });
      fetchServices();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditService = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { data: existing } = await supabase
        .from('services')
        .select('service_id')
        .eq('service_name', formData.service_name.trim())
        .neq('service_id', selectedService.service_id)
        .maybeSingle();

      if (existing) {
        toast.error('A service with this name already exists.');
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

      toast.success('Service updated successfully!');
      setShowEditModal(false);
      setSelectedService(null);
      setFormData({ service_name: '', description: '', price: '' });
      fetchServices();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteService = async (service) => {
    if (!window.confirm('Are you sure you want to permanently delete this service? This action cannot be undone.')) return;

    // Check if service has any appointments
    const { count, error: countError } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('service_id', service.service_id);

    if (countError) {
      toast.error(countError.message);
      return;
    }

    if (count > 0) {
      toast.error('Cannot delete a service that has existing appointments. Deactivate it instead.');
      return;
    }

    try {
      const { error } = await supabase
        .from('services')
        .delete()
        .eq('service_id', service.service_id);
      if (error) throw error;
      toast.success('Service deleted successfully!');
      fetchServices();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openAddModal = () => {
    setFormData({ service_name: '', description: '', price: '' });
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
    setShowEditModal(true);
  };

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setSortBy('service_name');
    setSortOrder('asc');
    setPage(1);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut();
    navigate('/login');
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Loading authentication...</p>
      </div>
    );
  }

  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />

      <div className="main-content manage-services-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Manage Services</h1>
            <p className="welcome-message">Add, edit, or remove dental services offered by the clinic</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={openAddModal}>
              <i className="fas fa-plus"></i> Add New Service
            </button>
            <div className="user-info">
              <div className="user-avatar">{adminInitial}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">System Administrator</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">{stats.total}</div><div className="stat-label">Total Services</div></div>
          <div className="stat-card stat-active"><div className="stat-number">{stats.active}</div><div className="stat-label">Active Services</div></div>
          <div className="stat-card stat-inactive"><div className="stat-number">{stats.inactive}</div><div className="stat-label">Inactive Services</div></div>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group">
              <label>Search</label>
              <input
                type="text"
                className="form-control"
                placeholder="Search by service name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Sort By</label>
              <select className="form-control" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="service_name">Service Name</option>
                <option value="price">Price</option>
                <option value="created_at">Date Created</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Order</label>
              <select className="form-control" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            <div className="filter-group">
              <button className="btn btn-primary" onClick={fetchServices}>Apply</button>
              <button className="btn btn-secondary" onClick={resetFilters}>Reset</button>
            </div>
          </div>
        </div>

        {/* Services Table */}
        <div className="table-container">
          <div className="table-header">
            <h3>Service List</h3>
            <span>Showing {services.length} of {totalCount} service(s)</span>
          </div>
          <div className="table-responsive">
            <table className="data-table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '20%', padding: '12px 15px', textAlign: 'left' }}>Service Name</th>
                  <th style={{ width: '45%', padding: '12px 15px', textAlign: 'left' }}>Description</th>
                  <th style={{ width: '10%', padding: '12px 15px', textAlign: 'left' }}>Price</th>
                  <th style={{ width: '10%', padding: '12px 15px', textAlign: 'center' }}>Status</th>
                  <th style={{ width: '15%', padding: '12px 15px', textAlign: 'left' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>
                      <div className="spinner-small"></div> Loading services...
                    </td>
                  </tr>
                ) : services.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '60px', color: '#7f8c8d' }}>
                      No services found
                    </td>
                  </tr>
                ) : (
                  services.map(service => (
                    <tr key={service.service_id}>
                      <td style={{ width: '20%', padding: '12px 15px', verticalAlign: 'middle' }}>
                        <strong>{service.service_name}</strong>
                      </td>
                      <td style={{ width: '45%', padding: '12px 15px', verticalAlign: 'middle', wordBreak: 'break-word' }}>
                        {service.description || '—'}
                      </td>
                      <td style={{ width: '10%', padding: '12px 15px', verticalAlign: 'middle' }}>
                        ₱{Number(service.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ width: '10%', padding: '12px 15px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <span className={`status-badge status-${service.status}`}>
                          {service.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ width: '15%', padding: '12px 15px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button 
                            className="btn btn-warning btn-sm" 
                            onClick={() => openEditModal(service)}
                            style={{ padding: '6px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                          >
                            <i className="fas fa-edit"></i> Edit
                          </button>
                          {service.status === 'inactive' && (
                            <button 
                              className="btn btn-danger btn-sm" 
                              onClick={() => handleDeleteService(service)}
                              style={{ padding: '6px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                            >
                              <i className="fas fa-trash"></i> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-link" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button className="page-link" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
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
                  <input type="text" className="form-control" value={formData.service_name} onChange={e => setFormData({ ...formData, service_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea className="form-control" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows="4" />
                </div>
                <div className="form-group">
                  <label>Price (₱) *</label>
                  <input type="number" className="form-control" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} min="0" step="0.01" required />
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

      {/* Edit Modal */}
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
                  <input type="text" className="form-control" value={formData.service_name} onChange={e => setFormData({ ...formData, service_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea className="form-control" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows="4" />
                </div>
                <div className="form-group">
                  <label>Price (₱) *</label>
                  <input type="number" className="form-control" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} min="0" step="0.01" required />
                </div>
                <div className="form-group">
                  <label>Status *</label>
                  <select className="form-control" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
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

      {/* Toast Container */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
};

export default ManageServices;