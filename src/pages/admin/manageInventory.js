import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageInventory.css';

const ManageInventory = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ totalItems: 0, lowStockItems: 0, totalValue: 0 });
  const perPage = 5;

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    item_name: '',
    category: 'Disposable',
    stock_quantity: 0,
    reorder_level: 10,
    unit_type: '',
    unit_cost: '',
    selling_price: '',
    location: '',
    status: 'active'
  });

  const searchTimeout = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  const isSuperAdmin = user?.email === 'jhoncarl.jubilag@cvsu.edu.ph';

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'admin' && !isSuperAdmin) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  const fetchStats = useCallback(async () => {
    try {
      // 1. Total active items
      const { count: total, error: totalError } = await supabase
        .from('inventory')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      if (totalError) throw totalError;

      // 2. Get all active items to compute low stock and total value
      const { data: items, error: itemsError } = await supabase
        .from('inventory')
        .select('stock_quantity, reorder_level, unit_cost')
        .eq('status', 'active');
      
      if (itemsError) throw itemsError;

      // Count low stock items (stock_quantity <= reorder_level)
      let lowStockCount = 0;
      let totalValue = 0;
      
      items?.forEach(item => {
        const stock = item.stock_quantity || 0;
        const reorder = item.reorder_level || 0;
        if (stock <= reorder) {
          lowStockCount++;
        }
        const cost = item.unit_cost || 0;
        totalValue += stock * cost;
      });

      setStats({
        totalItems: total || 0,
        lowStockItems: lowStockCount,
        totalValue: totalValue
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError('Failed to load statistics');
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let query = supabase
        .from('inventory')
        .select('*', { count: 'exact' });

      if (debouncedSearch) {
        query = query.ilike('item_name', `%${debouncedSearch}%`);
      }
      if (categoryFilter) {
        query = query.eq('category', categoryFilter);
      }
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      query = query.order('item_name', { ascending: true });

      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      setInventory(data || []);
      setTotalCount(count || 0);
      setTotalPages(Math.ceil((count || 0) / perPage));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, categoryFilter, statusFilter, page]);

  useEffect(() => {
    fetchStats();
    fetchInventory();
  }, [fetchStats, fetchInventory]);

  const resetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setCategoryFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const { error } = await supabase
        .from('inventory')
        .insert([{
          item_name: formData.item_name,
          category: formData.category,
          stock_quantity: parseInt(formData.stock_quantity) || 0,
          reorder_level: parseInt(formData.reorder_level) || 0,
          unit_type: formData.unit_type,
          unit_cost: parseFloat(formData.unit_cost) || 0,
          selling_price: parseFloat(formData.selling_price) || 0,
          location: formData.location || null,
          status: formData.status
        }]);
      if (error) throw error;
      setSuccess('Item added successfully!');
      setShowAddModal(false);
      resetForm();
      fetchInventory();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditItem = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const { error } = await supabase
        .from('inventory')
        .update({
          item_name: formData.item_name,
          category: formData.category,
          stock_quantity: parseInt(formData.stock_quantity),
          reorder_level: parseInt(formData.reorder_level),
          unit_type: formData.unit_type,
          unit_cost: parseFloat(formData.unit_cost) || 0,
          selling_price: parseFloat(formData.selling_price) || 0,
          location: formData.location || null,
          status: formData.status
        })
        .eq('item_id', selectedItem.item_id);
      if (error) throw error;
      setSuccess('Item updated successfully!');
      setShowEditModal(false);
      resetForm();
      fetchInventory();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddModal = () => {
    resetForm();
    setError('');
    setShowAddModal(true);
  };

  const openEditModal = (item) => {
    setSelectedItem(item);
    setFormData({
      item_name: item.item_name,
      category: item.category,
      stock_quantity: item.stock_quantity,
      reorder_level: item.reorder_level,
      unit_type: item.unit_type,
      unit_cost: item.unit_cost || '',
      selling_price: item.selling_price || '',
      location: item.location || '',
      status: item.status
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      item_name: '',
      category: 'Disposable',
      stock_quantity: 0,
      reorder_level: 10,
      unit_type: '',
      unit_cost: '',
      selling_price: '',
      location: '',
      status: 'active'
    });
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={async () => { setIsLoggingOut(true); await signOut(); navigate('/login'); }} />
      <div className="main-content manage-inventory-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Inventory Management</h1>
            <p className="welcome-message">Track dental supplies, tools, and equipment</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={openAddModal}>
              <i className="fas fa-plus"></i> Add Item
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

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.totalItems}</div>
            <div className="stat-label">Total Items</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-number">{stats.lowStockItems}</div>
            <div className="stat-label">Low Stock Alert</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">₱{stats.totalValue.toLocaleString()}</div>
            <div className="stat-label">Total Inventory Value</div>
          </div>
        </div>

        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group">
              <label>Search Item</label>
              <input type="text" className="form-control" placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="filter-group">
              <label>Category</label>
              <select className="form-control" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All</option>
                <option value="Disposable">Disposable</option>
                <option value="Chemical">Chemical</option>
                <option value="Tool">Tool</option>
                <option value="Equipment">Equipment</option>
                <option value="Medicine">Medicine</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>
            <div className="filter-group">
              <button className="btn btn-primary" onClick={fetchInventory}>Apply</button>
              <button className="btn btn-secondary" onClick={resetFilters}>Reset</button>
            </div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>Inventory List</h3>
            <span>Showing {inventory.length} of {totalCount} item(s)</span>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '20%' }}>Item Name</th>
                  <th style={{ width: '10%' }}>Category</th>
                  <th style={{ width: '8%' }}>Stock</th>
                  <th style={{ width: '8%' }}>Reorder Level</th>
                  <th style={{ width: '8%' }}>Unit</th>
                  <th style={{ width: '10%' }}>Unit Cost</th>
                  <th style={{ width: '10%' }}>Location</th>
                  <th style={{ width: '8%' }}>Status</th>
                  <th style={{ width: '18%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" className="loading-placeholder"><div className="spinner-small"></div></td></tr>
                ) : inventory.length === 0 ? (
                  <tr><td colSpan="9" className="empty-state">No inventory items found</td></tr>
                ) : (
                  inventory.map(item => {
                    const isLowStock = item.stock_quantity <= item.reorder_level && item.status === 'active';
                    return (
                      <tr key={item.item_id} className={isLowStock ? 'low-stock-row' : ''}>
                        <td><strong>{item.item_name}</strong></td>
                        <td><span className="category-badge">{item.category}</span></td>
                        <td className={isLowStock ? 'low-stock-value' : ''}>{item.stock_quantity}</td>
                        <td>{item.reorder_level}</td>
                        <td>{item.unit_type}</td>
                        <td>₱{parseFloat(item.unit_cost || 0).toFixed(2)}</td>
                        <td>{item.location || '—'}</td>
                        <td><span className={`status-badge status-${item.status}`}>{item.status}</span></td>
                        <td>
                          <div className="action-buttonss">
                            <button className="btn btn-info btn-sm" onClick={() => openEditModal(item)}><i className="fas fa-edit"></i> Edit</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-link" disabled={page === 1} onClick={() => setPage(p => p-1)}>Previous</button>
              <span className="page-info">Page {page} of {totalPages}</span>
              <button className="page-link" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Next</button>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Add New Inventory Item</h3><button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button></div>
            <form onSubmit={handleAddItem}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>Item Name *</label><input type="text" className="form-control" value={formData.item_name} onChange={e => setFormData({...formData, item_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Category *</label><select className="form-control" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="Disposable">Disposable</option><option value="Chemical">Chemical</option><option value="Tool">Tool</option><option value="Equipment">Equipment</option><option value="Medicine">Medicine</option>
                  </select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Stock Quantity</label><input type="number" className="form-control" value={formData.stock_quantity} onChange={e => setFormData({...formData, stock_quantity: e.target.value})} min="0" /></div>
                  <div className="form-group"><label>Reorder Level</label><input type="number" className="form-control" value={formData.reorder_level} onChange={e => setFormData({...formData, reorder_level: e.target.value})} min="0" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Unit Type *</label><input type="text" className="form-control" value={formData.unit_type} onChange={e => setFormData({...formData, unit_type: e.target.value})} placeholder="e.g., piece, box, bottle" required /></div>
                  <div className="form-group"><label>Unit Cost (₱)</label><input type="number" step="0.01" className="form-control" value={formData.unit_cost} onChange={e => setFormData({...formData, unit_cost: e.target.value})} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Selling Price (₱)</label><input type="number" step="0.01" className="form-control" value={formData.selling_price} onChange={e => setFormData({...formData, selling_price: e.target.value})} /></div>
                  <div className="form-group"><label>Location</label><input type="text" className="form-control" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} placeholder="Storage location" /></div>
                </div>
                <div className="form-group"><label>Status</label><select className="form-control" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option><option value="discontinued">Discontinued</option></select></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add Item'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal – includes stock quantity field */}
      {showEditModal && selectedItem && (
        <div className="modal active" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Edit Item</h3><button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button></div>
            <form onSubmit={handleEditItem}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label>Item Name *</label><input type="text" className="form-control" value={formData.item_name} onChange={e => setFormData({...formData, item_name: e.target.value})} required /></div>
                  <div className="form-group"><label>Category *</label><select className="form-control" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="Disposable">Disposable</option><option value="Chemical">Chemical</option><option value="Tool">Tool</option><option value="Equipment">Equipment</option><option value="Medicine">Medicine</option>
                  </select></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Stock Quantity</label><input type="number" className="form-control" value={formData.stock_quantity} onChange={e => setFormData({...formData, stock_quantity: e.target.value})} min="0" /></div>
                  <div className="form-group"><label>Reorder Level</label><input type="number" className="form-control" value={formData.reorder_level} onChange={e => setFormData({...formData, reorder_level: e.target.value})} min="0" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Unit Type *</label><input type="text" className="form-control" value={formData.unit_type} onChange={e => setFormData({...formData, unit_type: e.target.value})} required /></div>
                  <div className="form-group"><label>Unit Cost (₱)</label><input type="number" step="0.01" className="form-control" value={formData.unit_cost} onChange={e => setFormData({...formData, unit_cost: e.target.value})} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>Selling Price (₱)</label><input type="number" step="0.01" className="form-control" value={formData.selling_price} onChange={e => setFormData({...formData, selling_price: e.target.value})} /></div>
                  <div className="form-group"><label>Location</label><input type="text" className="form-control" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} /></div>
                </div>
                <div className="form-group"><label>Status</label><select className="form-control" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option><option value="discontinued">Discontinued</option></select></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Changes'}</button></div>
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

export default ManageInventory;