import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import Sidebar from '../../components/admin/Sidebar';
import './manageBilling.css';

const validateSeniorID = (id_no) => {
  const cleaned = id_no.replace(/\D/g, '');
  if (cleaned.length !== 12) {
    return { valid: false, message: 'Senior Citizen ID must be exactly 12 digits.' };
  }
  const year = parseInt(cleaned.substring(0, 4));
  if (year < 1900 || year > 1966) {
    return { valid: false, message: 'Invalid birth year in Senior Citizen ID. Must be between 1900-1966.' };
  }
  return { valid: true };
};

const validatePWDID = (id_no) => {
  const trimmed = id_no.trim();
  if (trimmed.length < 10 || trimmed.length > 20) {
    return { valid: false, message: 'PWD ID must be 10-20 characters.' };
  }
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount < 6) {
    return { valid: false, message: 'PWD ID must contain at least 6 digits.' };
  }
  return { valid: true };
};

const ManageBilling = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [billingRecords, setBillingRecords] = useState([]);
  const [unbilledAppointments, setUnbilledAppointments] = useState([]);
  const [stats, setStats] = useState({ totalRevenue: 0, totalPending: 0, totalPaid: 0, totalUnbilled: 0 });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowsPartial, setAllowsPartial] = useState(false);

  const [createForm, setCreateForm] = useState({
    appointment_id: '',
    patient_id: '',
    doctor_id: '',
    service_id: '',
    service_name: '',
    total_amount: 0,
    discount_type: 'none',
    discount: 0,
    discount_id_no: '',
    amount_paid: 0,
    payment_method: 'cash',
    reference_number: '',
    payment_date: new Date().toISOString().split('T')[0],
    remarks: ''
  });
  const [editForm, setEditForm] = useState({
    billing_id: '',
    total_amount: 0,
    discount_type: 'none',
    discount: 0,
    discount_id_no: '',
    amount_paid: 0,
    payment_method: 'cash',
    reference_number: '',
    payment_date: '',
    remarks: ''
  });
  const [paymentForm, setPaymentForm] = useState({
    billing_id: '',
    amount: 0,
    payment_method: 'cash',
    reference_number: '',
    remarks: '',
    current_balance: 0
  });

  const SUPER_ADMIN_EMAIL = 'jhoncarl.jubilag@cvsu.edu.ph';
  const isSuperAdmin = user?.email === SUPER_ADMIN_EMAIL;

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (userType !== 'admin' && !isSuperAdmin) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  const formatCurrency = (amount) => `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  const autoUpdateExpiredConfirmed = useCallback(async () => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('status', 'confirmed')
      .lt('appointment_datetime', now)
      .select();
    if (!error && data?.length) {
      console.log(`${data.length} expired confirmed appointment(s) marked as completed.`);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      await autoUpdateExpiredConfirmed();

      let query = supabase
        .from('billing')
        .select(`
          *,
          patients!inner (first_name, last_name, email, contact_no, address),
          doctors (first_name, last_name),
          appointments!inner (
            appointment_datetime,
            status,
            services (service_id, service_name, price, description)
          )
        `)
        .eq('archived', showArchived)
        .order('created_at', { ascending: false });

      if (search) {
        query = query.or(`patients.first_name.ilike.%${search}%,patients.last_name.ilike.%${search}%,appointments.services.service_name.ilike.%${search}%,discount_id_no.ilike.%${search}%,remarks.ilike.%${search}%`);
      }
      if (paymentFilter) query = query.eq('payment_method', paymentFilter);
      if (dateFrom) query = query.gte('payment_date', dateFrom);
      if (dateTo) query = query.lte('payment_date', dateTo);

      const { data: billingData, error: billingError } = await query;
      if (billingError) throw billingError;

      let filtered = billingData || [];
      if (statusFilter === 'pending') {
        filtered = filtered.filter(b => b.balance > 0 && b.amount_paid === 0);
      } else if (statusFilter === 'paid') {
        filtered = filtered.filter(b => b.balance <= 0 && b.amount_paid > 0);
      } else if (statusFilter === 'partial') {
        filtered = filtered.filter(b => b.balance > 0 && b.amount_paid > 0);
      }
      setBillingRecords(filtered);

      let totalRevenue = 0, totalPending = 0, totalPaid = 0;
      filtered.forEach(b => {
        totalRevenue += Number(b.total_amount);
        if (b.balance > 0) totalPending += b.balance;
        else totalPaid += b.amount_paid;
      });

      const { data: allBilledIdsData } = await supabase
        .from('billing')
        .select('appointment_id');
      const billedIds = allBilledIdsData?.map(b => b.appointment_id) || [];
      const billedIdsStr = billedIds.length ? billedIds.join(',') : '0';

      const { data: unbilled, error: unbilledError } = await supabase
        .from('appointments')
        .select(`
          appointment_id,
          appointment_datetime,
          status,
          patients (patient_id, first_name, last_name),
          doctors (doctor_id, first_name, last_name),
          services (service_id, service_name, price)
        `)
        .in('status', ['confirmed', 'completed'])
        .not('appointment_id', 'in', `(${billedIdsStr})`);
      if (unbilledError) throw unbilledError;
      setUnbilledAppointments(unbilled || []);

      setStats({
        totalRevenue,
        totalPending,
        totalPaid,
        totalUnbilled: unbilled?.length || 0
      });
    } catch (err) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, paymentFilter, dateFrom, dateTo, showArchived, autoUpdateExpiredConfirmed]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetCreateForm = () => {
    setCreateForm({
      appointment_id: '',
      patient_id: '',
      doctor_id: '',
      service_id: '',
      service_name: '',
      total_amount: 0,
      discount_type: 'none',
      discount: 0,
      discount_id_no: '',
      amount_paid: 0,
      payment_method: 'cash',
      reference_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      remarks: ''
    });
    setAllowsPartial(false);
  };

  useEffect(() => {
    const { total_amount, discount_type, discount_id_no } = createForm;
    let discountAmount = 0;
    if (discount_type === 'senior' || discount_type === 'pwd') {
      discountAmount = total_amount * 0.2;
    } else if (discount_type === 'manual') {
      const manual = parseFloat(discount_id_no) || 0;
      discountAmount = (manual > 0 && manual <= total_amount) ? manual : 0;
    }
    setCreateForm(prev => ({ ...prev, discount: discountAmount }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createForm.total_amount, createForm.discount_type, createForm.discount_id_no]);

  useEffect(() => {
    const { total_amount, discount_type, discount_id_no } = editForm;
    let discountAmount = 0;
    if (discount_type === 'senior' || discount_type === 'pwd') {
      discountAmount = total_amount * 0.2;
    } else if (discount_type === 'manual') {
      const manual = parseFloat(discount_id_no) || 0;
      discountAmount = (manual > 0 && manual <= total_amount) ? manual : 0;
    }
    setEditForm(prev => ({ ...prev, discount: discountAmount }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm.total_amount, editForm.discount_type, editForm.discount_id_no]);

  const validateDiscountId = (type, idNumber) => {
    if (type === 'senior') {
      if (!idNumber.trim()) return 'Senior Citizen ID number is required.';
      const validation = validateSeniorID(idNumber);
      if (!validation.valid) return validation.message;
    } else if (type === 'pwd') {
      if (!idNumber.trim()) return 'PWD ID number is required.';
      const validation = validatePWDID(idNumber);
      if (!validation.valid) return validation.message;
    }
    return null;
  };

  const handleCreateBilling = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { total_amount, discount, amount_paid, payment_method, reference_number, payment_date, remarks, appointment_id, patient_id, doctor_id, discount_type, discount_id_no } = createForm;
    const afterDiscount = total_amount - discount;

    if (payment_method !== 'cash' && !reference_number.trim()) {
      toast.error('Reference number is required for this payment method.');
      setIsSubmitting(false);
      return;
    }

    const idError = validateDiscountId(discount_type, discount_id_no);
    if (idError) {
      toast.error(idError);
      setIsSubmitting(false);
      return;
    }
    if (amount_paid > afterDiscount) {
      toast.error(`Amount paid cannot exceed amount after discount (${formatCurrency(afterDiscount)}).`);
      setIsSubmitting(false);
      return;
    }
    if (!allowsPartial && amount_paid !== afterDiscount) {
      toast.error(`This service requires full payment (${formatCurrency(afterDiscount)}).`);
      setIsSubmitting(false);
      return;
    }
    const balance = afterDiscount - amount_paid;

    try {
      const { data: existing } = await supabase
        .from('billing')
        .select('billing_id')
        .eq('appointment_id', appointment_id)
        .maybeSingle();
      if (existing) {
        toast.error('A billing record already exists for this appointment.');
        setIsSubmitting(false);
        return;
      }

      let finalRemarks = remarks || '';
      if (discount_type === 'senior') finalRemarks = `[Discount Applied]: Senior Citizen (20%) - ₱${discount.toFixed(2)} | ID: ${discount_id_no}\n${finalRemarks}`;
      else if (discount_type === 'pwd') finalRemarks = `[Discount Applied]: PWD (20%) - ₱${discount.toFixed(2)} | ID: ${discount_id_no}\n${finalRemarks}`;
      else if (discount_type === 'manual') finalRemarks = `[Discount Applied]: Manual Discount - ₱${discount.toFixed(2)}\n${finalRemarks}`;
      if (amount_paid > 0) {
        const paymentDateFormatted = new Date(payment_date).toLocaleString();
        const refNote = payment_method !== 'cash' ? ` Ref: ${reference_number}` : '';
        finalRemarks += `\n\n[Initial Payment ${paymentDateFormatted}]: ₱${amount_paid.toFixed(2)} via ${payment_method}${refNote}`;
      }

      const { error: insertError } = await supabase
        .from('billing')
        .insert({
          appointment_id,
          patient_id,
          doctor_id,
          total_amount,
          discount,
          discount_id_no: discount_type !== 'none' ? discount_id_no : null,
          amount_paid,
          balance,
          payment_method,
          reference_number: payment_method !== 'cash' ? reference_number : null,
          payment_date,
          remarks: finalRemarks,
          archived: false
        });
      if (insertError) throw insertError;

      if (balance <= 0 && amount_paid > 0) {
        const { data: appt } = await supabase
          .from('appointments')
          .select('appointment_datetime')
          .eq('appointment_id', appointment_id)
          .single();
        const apptTime = new Date(appt.appointment_datetime);
        const now = new Date();
        const newStatus = apptTime <= now ? 'completed' : 'confirmed';
        await supabase.from('appointments').update({ status: newStatus }).eq('appointment_id', appointment_id);
        const statusNote = newStatus === 'completed'
          ? `\n\n[Status Update]: Appointment marked as COMPLETED (Full payment received & appointment time has passed)`
          : `\n\n[Status Note]: Full payment received but appointment is scheduled for future - Status remains CONFIRMED`;
        await supabase
          .from('billing')
          .update({ remarks: finalRemarks + statusNote })
          .eq('appointment_id', appointment_id);
      }

      toast.success('Billing record created successfully!');
      setTimeout(() => {
        setShowCreateModal(false);
        resetCreateForm();
        fetchData();
      }, 2000);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditBilling = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { billing_id, total_amount, discount, amount_paid, payment_method, reference_number, payment_date, remarks, discount_type, discount_id_no } = editForm;
    const afterDiscount = total_amount - discount;

    if (payment_method !== 'cash' && !reference_number.trim()) {
      toast.error('Reference number is required for this payment method.');
      setIsSubmitting(false);
      return;
    }

    const idError = validateDiscountId(discount_type, discount_id_no);
    if (idError) {
      toast.error(idError);
      setIsSubmitting(false);
      return;
    }
    if (amount_paid > afterDiscount) {
      toast.error(`Amount paid cannot exceed amount after discount (${formatCurrency(afterDiscount)}).`);
      setIsSubmitting(false);
      return;
    }
    const balance = afterDiscount - amount_paid;

    let newRemarks = remarks;
    if (discount_type === 'senior') newRemarks = `[Discount Applied]: Senior Citizen (20%) - ₱${discount.toFixed(2)} | ID: ${discount_id_no}\n${remarks}`;
    else if (discount_type === 'pwd') newRemarks = `[Discount Applied]: PWD (20%) - ₱${discount.toFixed(2)} | ID: ${discount_id_no}\n${remarks}`;
    else if (discount_type === 'manual') newRemarks = `[Discount Applied]: Manual Discount - ₱${discount.toFixed(2)}\n${remarks}`;

    try {
      const { error: updateError } = await supabase
        .from('billing')
        .update({
          total_amount,
          discount,
          discount_id_no: discount_type !== 'none' ? discount_id_no : null,
          amount_paid,
          balance,
          payment_method,
          reference_number: payment_method !== 'cash' ? reference_number : null,
          payment_date,
          remarks: newRemarks
        })
        .eq('billing_id', billing_id);
      if (updateError) throw updateError;

      if (balance <= 0 && amount_paid > 0) {
        const { data: bill } = await supabase.from('billing').select('appointment_id').eq('billing_id', billing_id).single();
        const { data: appt } = await supabase.from('appointments').select('appointment_datetime').eq('appointment_id', bill.appointment_id).single();
        const apptTime = new Date(appt.appointment_datetime);
        const now = new Date();
        const newStatus = apptTime <= now ? 'completed' : 'confirmed';
        await supabase.from('appointments').update({ status: newStatus }).eq('appointment_id', bill.appointment_id);
      }
      toast.success('Billing record updated successfully!');
      setShowEditModal(false);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { billing_id, amount, payment_method, reference_number, remarks, current_balance } = paymentForm;
    if (amount <= 0) {
      toast.error('Payment amount must be greater than 0.');
      setIsSubmitting(false);
      return;
    }
    if (amount > current_balance) {
      toast.error(`Payment amount cannot exceed remaining balance (${formatCurrency(current_balance)}).`);
      setIsSubmitting(false);
      return;
    }
    if (payment_method !== 'cash' && !reference_number.trim()) {
      toast.error('Reference number is required for this payment method.');
      setIsSubmitting(false);
      return;
    }
    if (!allowsPartial && amount !== current_balance) {
      toast.error(`This service requires full payment. Please pay exact balance (${formatCurrency(current_balance)}).`);
      setIsSubmitting(false);
      return;
    }

    try {
      const { data: bill } = await supabase.from('billing').select('amount_paid, balance, remarks, appointment_id, payment_method').eq('billing_id', billing_id).single();
      const newAmountPaid = bill.amount_paid + amount;
      const newBalance = bill.balance - amount;
      const refNote = payment_method !== 'cash' ? ` Ref: ${reference_number}` : '';
      const paymentRecord = `\n\n[Payment ${new Date().toLocaleString()}]: ₱${amount.toFixed(2)} via ${payment_method}${refNote}${remarks ? ` - ${remarks}` : ''}`;
      const newRemarks = bill.remarks + paymentRecord;
      const { error: updateError } = await supabase
        .from('billing')
        .update({
          amount_paid: newAmountPaid,
          balance: newBalance,
          payment_method,
          reference_number: payment_method !== 'cash' ? reference_number : null,
          payment_date: new Date().toISOString().split('T')[0],
          remarks: newRemarks
        })
        .eq('billing_id', billing_id);
      if (updateError) throw updateError;

      if (newBalance <= 0) {
        const { data: appt } = await supabase.from('appointments').select('appointment_datetime').eq('appointment_id', bill.appointment_id).single();
        const apptTime = new Date(appt.appointment_datetime);
        const now = new Date();
        const newStatus = apptTime <= now ? 'completed' : 'confirmed';
        await supabase.from('appointments').update({ status: newStatus }).eq('appointment_id', bill.appointment_id);
      }
      toast.success('Payment recorded successfully!');
      setShowPaymentModal(false);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (billingId) => {
    if (!window.confirm('Archive this billing record? It will be hidden from the main list but can be restored later if needed.')) return;
    try {
      const { error } = await supabase
        .from('billing')
        .update({ archived: true })
        .eq('billing_id', billingId);
      if (error) throw error;
      toast.success('Billing record archived successfully!');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRestore = async (billingId) => {
    if (!window.confirm('Restore this archived billing record? It will appear again in the main billing list.')) return;
    try {
      const { error } = await supabase
        .from('billing')
        .update({ archived: false })
        .eq('billing_id', billingId);
      if (error) throw error;
      toast.success('Billing record restored successfully!');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const getStatusClass = (record) => {
    if (record.amount_paid === 0) return 'status-pending';
    if (record.balance > 0) return 'status-partial';
    return 'status-paid';
  };
  const getStatusText = (record) => {
    if (record.amount_paid === 0) return 'Pending';
    if (record.balance > 0) return 'Partial';
    return 'Paid';
  };
  const getAppointmentStatusClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'confirmed': return 'status-confirmed';
      case 'cancelled': return 'status-cancelled';
      case 'completed': return 'status-completed';
      default: return '';
    }
  };

  if (authLoading || loading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (!user || (userType !== 'admin' && !isSuperAdmin)) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard">
      <Sidebar onLogout={handleLogout} />

      <div className="main-content manage-billing-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Billing Management</h1>
            <p className="welcome-message">Manage payments, discounts, and invoices</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <i className="fas fa-plus"></i> Create Bill
            </button>
            <button 
              className={`btn ${showArchived ? 'btn-warning' : 'btn-info'}`} 
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? 'Hide Archives' : 'Show Archives'}
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

        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">₱{stats.totalRevenue.toLocaleString()}</div><div className="stat-label">Total Billing</div></div>
          <div className="stat-card"><div className="stat-number">₱{stats.totalPending.toLocaleString()}</div><div className="stat-label">Pending Payments</div></div>
          <div className="stat-card"><div className="stat-number">₱{stats.totalPaid.toLocaleString()}</div><div className="stat-label">Paid Amount</div></div>
          <div className="stat-card"><div className="stat-number">{stats.totalUnbilled}</div><div className="stat-label">Unbilled</div></div>
        </div>

        {stats.totalUnbilled > 0 && !showArchived && (
          <div className="unbilled-alert">
            <div><i className="fas fa-exclamation-triangle"></i> You have {stats.totalUnbilled} confirmed/completed appointment(s) without billing.</div>
            <button className="btn btn-warning" onClick={() => setShowCreateModal(true)}>Create Bills Now</button>
          </div>
        )}

        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group"><label>Search</label><input type="text" className="form-control" placeholder="Patient, service, ID..." value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div className="filter-group"><label>Payment Status</label><select className="form-control" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="partial">Partial</option></select></div>
            <div className="filter-group"><label>Payment Method</label><select className="form-control" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}><option value="">All</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="maya">Maya</option><option value="other">Other e-Bank</option></select></div>
            <div className="filter-group"><label>Date From</label><input type="date" className="form-control" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
            <div className="filter-group"><label>Date To</label><input type="date" className="form-control" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
            <div className="filter-group filter-actions">
              <button className="btn btn-primary" onClick={fetchData}>Apply</button>
              <button className="btn btn-secondary" onClick={() => { setSearch(''); setStatusFilter(''); setPaymentFilter(''); setDateFrom(''); setDateTo(''); }}>Reset</button>
            </div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>Billing Records {showArchived && <span style={{ color: '#e74c3c' }}>(Archived)</span>}</h3>
            <span>Showing {billingRecords.length} record(s)</span>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Patient</th>
                  <th>Service</th>
                  <th>Appointment Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {billingRecords.length === 0 ? (
                  <tr><td colSpan="6" className="empty-state">No billing records found</td></tr>
                ) : (
                  billingRecords.map(record => {
                    const service = record.appointments.services;
                    return (
                      <tr key={record.billing_id} className={record.archived ? 'archived-row' : ''}>
                        <td>
                          <strong>#{String(record.billing_id).padStart(6, '0')}</strong><br />
                          <small>{new Date(record.created_at).toLocaleDateString()}</small>
                          {record.archived && <div className="archived-badge">Archived</div>}
                        </td>
                        <td>{record.patients.first_name} {record.patients.last_name}</td>
                        <td>{service.service_name}</td>
                        <td>{new Date(record.appointments.appointment_datetime).toLocaleString()}</td>
                        <td><span className={`status-badge ${getStatusClass(record)}`}>{getStatusText(record)}</span></td>
                        <td>
                          <div className="action-button">
                            <button className="btn btn-info btn-sm" onClick={() => { setSelectedRecord(record); setShowViewModal(true); }}>View</button>
                            <button className="btn btn-primary btn-sm" onClick={() => { setSelectedRecord(record); setShowInvoiceModal(true); }}>Invoice</button>
                            
                            {record.archived ? (
                              <button className="btn btn-success btn-sm" onClick={() => handleRestore(record.billing_id)}>
                                Restore
                              </button>
                            ) : (
                              <>
                                {record.balance > 0 && (
                                  <button className="btn btn-success btn-sm" onClick={() => {
                                    setPaymentForm({
                                      billing_id: record.billing_id,
                                      amount: 0,
                                      payment_method: 'cash',
                                      reference_number: '',
                                      remarks: '',
                                      current_balance: record.balance
                                    });
                                    setAllowsPartial(service.price >= 3000);
                                    setShowPaymentModal(true);
                                  }}>Pay</button>
                                )}
                                <button className="btn btn-warning btn-sm" onClick={() => {
                                  let discType = 'none';
                                  const remarks = (record.remarks || '').toLowerCase();
                                  if (record.discount_id_no) {
                                    if (remarks.includes('senior')) discType = 'senior';
                                    else if (remarks.includes('pwd')) discType = 'pwd';
                                    else discType = 'manual';
                                  } else if (record.discount > 0) discType = 'manual';
                                  setEditForm({
                                    billing_id: record.billing_id,
                                    total_amount: record.total_amount,
                                    discount_type: discType,
                                    discount: record.discount,
                                    discount_id_no: record.discount_id_no || '',
                                    amount_paid: record.amount_paid,
                                    payment_method: record.payment_method,
                                    reference_number: record.reference_number || '',
                                    payment_date: record.payment_date || new Date().toISOString().split('T')[0],
                                    remarks: record.remarks || ''
                                  });
                                  setAllowsPartial(service.price >= 3000);
                                  setShowEditModal(true);
                                }}>Edit</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => handleArchive(record.billing_id)}>Archive</button>
                              </>
                            )}
                          </div>
                         </td>
                       </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* CREATE BILLING MODAL */}
      {showCreateModal && (
        <div className="modal-billing-create active" onClick={e => e.target === e.currentTarget && setShowCreateModal(false)}>
          <div className="modal-billing-create-content modal-billing-create-lg">
            <div className="modal-billing-create-header">
              <h3>Create New Billing</h3>
              <button className="modal-billing-create-close" onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateBilling}>
              <div className="modal-billing-create-body">
                <div className="form-group"><label>Select Appointment *</label><select className="form-control" value={createForm.appointment_id} onChange={async (e) => {
                  const aptId = e.target.value;
                  const appointment = unbilledAppointments.find(a => a.appointment_id === parseInt(aptId));
                  if (appointment) {
                    const service = appointment.services;
                    setAllowsPartial(service.price >= 3000);
                    setCreateForm({ ...createForm, appointment_id: aptId, patient_id: appointment.patients.patient_id, doctor_id: appointment.doctors.doctor_id, service_id: service.service_id, service_name: service.service_name, total_amount: service.price, amount_paid: service.price >= 3000 ? 0 : service.price });
                  } else setCreateForm({ ...createForm, appointment_id: aptId, total_amount: 0 });
                }} required><option value="">-- Select Appointment --</option>{unbilledAppointments.map(apt => (<option key={apt.appointment_id} value={apt.appointment_id}>{new Date(apt.appointment_datetime).toLocaleString()} - {apt.patients.first_name} {apt.patients.last_name} - {apt.services.service_name} (₱{apt.services.price.toFixed(2)})</option>))}</select></div>
                <div className="form-group"><label>Service</label><input type="text" className="form-control" value={createForm.service_name} readOnly disabled /></div>
                <div className="form-row">
                  <div className="form-group"><label>Total Amount (₱)</label><input type="number" className="form-control" value={createForm.total_amount} readOnly disabled /></div>
                  <div className="form-group"><label>Discount Type</label><select className="form-control" value={createForm.discount_type} onChange={e => setCreateForm({ ...createForm, discount_type: e.target.value })}><option value="none">No Discount</option><option value="senior">Senior Citizen (20%)</option><option value="pwd">PWD (20%)</option><option value="manual">Manual Discount</option></select></div>
                </div>
                {createForm.discount_type !== 'none' && (<div className="form-group"><label>{createForm.discount_type === 'manual' ? 'Discount Amount (₱)' : 'ID Number *'}</label><input type={createForm.discount_type === 'manual' ? 'number' : 'text'} className="form-control" value={createForm.discount_id_no} onChange={e => setCreateForm({ ...createForm, discount_id_no: e.target.value })} placeholder={createForm.discount_type === 'manual' ? 'Enter amount' : 'Enter ID number'} required /></div>)}
                <div className="discount-summary"><strong>Amount after discount:</strong> ₱{(createForm.total_amount - createForm.discount).toFixed(2)} {createForm.discount > 0 && <span>(Discount: ₱{createForm.discount.toFixed(2)})</span>}</div>
                <div className="form-row">
                  <div className="form-group"><label>Amount Paid (₱)</label><input type="number" className="form-control" value={createForm.amount_paid} onChange={e => setCreateForm({ ...createForm, amount_paid: parseFloat(e.target.value) || 0 })} step="0.01" min="0" /></div>
                  <div className="form-group"><label>Payment Method</label><select className="form-control" value={createForm.payment_method} onChange={e => setCreateForm({ ...createForm, payment_method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="gcash">GCash</option>
                    <option value="maya">Maya</option>
                    <option value="other">Other e-Bank</option>
                  </select></div>
                </div>
                {createForm.payment_method !== 'cash' && (
                  <div className="form-group"><label>Reference Number *</label><input type="text" className="form-control" value={createForm.reference_number} onChange={e => setCreateForm({ ...createForm, reference_number: e.target.value })} placeholder="e.g., GCash transaction ID, bank reference" required /></div>
                )}
                <div className="form-group"><label>Payment Date</label><input type="date" className="form-control" value={createForm.payment_date} onChange={e => setCreateForm({ ...createForm, payment_date: e.target.value })} /></div>
                <div className="form-group"><label>Remarks</label><textarea className="form-control" rows="3" value={createForm.remarks} onChange={e => setCreateForm({ ...createForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-billing-create-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create Bill'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT BILLING MODAL */}
      {showEditModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Edit Billing Record</h3><button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button></div>
            <form onSubmit={handleEditBilling}>
              <div className="modal-body">
                <div className="form-row"><div className="form-group"><label>Total Amount (₱)</label><input type="number" className="form-control" value={editForm.total_amount} onChange={e => setEditForm({ ...editForm, total_amount: parseFloat(e.target.value) || 0 })} required /></div><div className="form-group"><label>Discount Type</label><select className="form-control" value={editForm.discount_type} onChange={e => setEditForm({ ...editForm, discount_type: e.target.value })}><option value="none">No Discount</option><option value="senior">Senior Citizen (20%)</option><option value="pwd">PWD (20%)</option><option value="manual">Manual Discount</option></select></div></div>
                {editForm.discount_type !== 'none' && (<div className="form-group"><label>{editForm.discount_type === 'manual' ? 'Discount Amount (₱)' : 'ID Number *'}</label><input type={editForm.discount_type === 'manual' ? 'number' : 'text'} className="form-control" value={editForm.discount_id_no} onChange={e => setEditForm({ ...editForm, discount_id_no: e.target.value })} placeholder={editForm.discount_type === 'manual' ? 'Enter amount' : 'Enter ID number'} required /></div>)}
                <div className="discount-summary"><strong>Amount after discount:</strong> ₱{(editForm.total_amount - editForm.discount).toFixed(2)} {editForm.discount > 0 && <span>(Discount: ₱{editForm.discount.toFixed(2)})</span>}</div>
                <div className="form-row"><div className="form-group"><label>Amount Paid (₱)</label><input type="number" className="form-control" value={editForm.amount_paid} onChange={e => setEditForm({ ...editForm, amount_paid: parseFloat(e.target.value) || 0 })} step="0.01" min="0" /></div><div className="form-group"><label>Payment Method</label><select className="form-control" value={editForm.payment_method} onChange={e => setEditForm({ ...editForm, payment_method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="other">Other e-Bank</option>
                </select></div></div>
                {editForm.payment_method !== 'cash' && (
                  <div className="form-group"><label>Reference Number *</label><input type="text" className="form-control" value={editForm.reference_number} onChange={e => setEditForm({ ...editForm, reference_number: e.target.value })} placeholder="Transaction reference number" required /></div>
                )}
                <div className="form-group"><label>Payment Date</label><input type="date" className="form-control" value={editForm.payment_date} onChange={e => setEditForm({ ...editForm, payment_date: e.target.value })} /></div>
                <div className="form-group"><label>Remarks</label><textarea className="form-control" rows="3" value={editForm.remarks} onChange={e => setEditForm({ ...editForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Update Bill'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowPaymentModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Record Payment</h3><button className="modal-close" onClick={() => setShowPaymentModal(false)}>&times;</button></div>
            <form onSubmit={handleRecordPayment}>
              <div className="modal-body">
                <div className="form-group"><label>Current Balance</label><div className="balance-display">{formatCurrency(paymentForm.current_balance)}</div></div>
                <div className="form-group"><label>Payment Amount (₱)</label><input type="number" className="form-control" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })} step="0.01" min="0" required /></div>
                <div className="form-group"><label>Payment Method</label><select className="form-control" value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="other">Other e-Bank</option>
                </select></div>
                {paymentForm.payment_method !== 'cash' && (
                  <div className="form-group"><label>Reference Number *</label><input type="text" className="form-control" value={paymentForm.reference_number} onChange={e => setPaymentForm({ ...paymentForm, reference_number: e.target.value })} placeholder="Transaction reference number" required /></div>
                )}
                <div className="form-group"><label>Remarks</label><textarea className="form-control" rows="2" value={paymentForm.remarks} onChange={e => setPaymentForm({ ...paymentForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Processing...' : 'Record Payment'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {showViewModal && selectedRecord && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowViewModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Billing Details</h3><button className="modal-close" onClick={() => setShowViewModal(false)}>×</button></div>
            <div className="view-details-container modern-view">
              <div className="detail-section">
                <h4 className="section-title">Bill Information</h4>
                <table className="details-table">
                  <tbody>
                    <tr><td className="label-cell">Bill #</td><td className="value-cell">#{String(selectedRecord.billing_id).padStart(6, '0')}</td><td className="label-cell">Created</td><td className="value-cell">{new Date(selectedRecord.created_at).toLocaleString()}</td></tr>
                    <tr><td className="label-cell">Total Amount</td><td className="value-cell">₱{selectedRecord.total_amount.toFixed(2)}</td><td className="label-cell">Discount</td><td className="value-cell">₱{selectedRecord.discount.toFixed(2)}</td></tr>
                    <tr><td className="label-cell">Discount ID</td><td className="value-cell">{selectedRecord.discount_id_no || 'N/A'}</td><td className="label-cell">Amount Paid</td><td className="value-cell">₱{selectedRecord.amount_paid.toFixed(2)}</td></tr>
                    <tr><td className="label-cell">Balance</td><td className={`value-cell ${selectedRecord.balance > 0 ? 'balance-due' : 'balance-paid'}`}>₱{selectedRecord.balance.toFixed(2)}</td><td className="label-cell">Payment Method</td><td className="value-cell">{selectedRecord.payment_method}</td></tr>
                    <tr><td className="label-cell">Reference Number</td><td className="value-cell">{selectedRecord.reference_number || 'N/A'}</td><td className="label-cell">Payment Date</td><td className="value-cell">{selectedRecord.payment_date ? new Date(selectedRecord.payment_date).toLocaleDateString() : 'N/A'}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="detail-section">
                <h4 className="section-title">Appointment Details</h4>
                <table className="details-table">
                  <tbody>
                    <tr><td className="label-cell">Patient</td><td className="value-cell">{selectedRecord.patients.first_name} {selectedRecord.patients.last_name}</td><td className="label-cell">Email</td><td className="value-cell">{selectedRecord.patients.email}</td></tr>
                    <tr><td className="label-cell">Contact</td><td className="value-cell">{selectedRecord.patients.contact_no || 'N/A'}</td><td className="label-cell">Service</td><td className="value-cell">{selectedRecord.appointments.services.service_name}</td></tr>
                    <tr><td className="label-cell">Doctor</td><td className="value-cell">Dr. {selectedRecord.doctors.first_name} {selectedRecord.doctors.last_name}</td><td className="label-cell">Appointment Date</td><td className="value-cell">{new Date(selectedRecord.appointments.appointment_datetime).toLocaleString()}</td></tr>
                    <tr><td className="label-cell">Appointment Status</td><td className="value-cell" colSpan="3"><span className={`status-badge ${getAppointmentStatusClass(selectedRecord.appointments.status)}`}>{selectedRecord.appointments.status.toUpperCase()}</span></td></tr>
                  </tbody>
                </table>
              </div>
              {selectedRecord.remarks && (
                <div className="detail-section">
                  <h4 className="section-title">Remarks / Payment History</h4>
                  <div className="remarks-box">{selectedRecord.remarks}</div>
                </div>
              )}
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowViewModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* INVOICE MODAL */}
      {showInvoiceModal && selectedRecord && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setShowInvoiceModal(false)}>
          <div className="modal-content invoice-modal-content">
            <div className="modal-header"><h3>Invoice</h3><button className="modal-close" onClick={() => setShowInvoiceModal(false)}>&times;</button></div>
            <div className="invoice-scroll-container" id="invoiceContent">
              <div className="invoice-wrapper">
                <div className="invoice-header">
                  <div className="clinic-info"><div className="clinic-name">Fifthcusp Dental Clinic</div><div className="clinic-address">123 Dental St., Imus, Cavite</div><div className="clinic-contact">info@fifthcusp.com | (02) 1234-5678</div></div>
                  <div className="invoice-title"><div className="invoice-badge">TAX INVOICE</div><div className="invoice-number">INV-{String(selectedRecord.billing_id).padStart(6, '0')}</div><div className="invoice-date">Date: {new Date(selectedRecord.payment_date || selectedRecord.created_at).toLocaleDateString()}</div><span className={`status-badge-invoice ${selectedRecord.balance === 0 ? (selectedRecord.amount_paid > 0 ? 'status-paid' : 'status-pending') : 'status-partial'}`}>{selectedRecord.balance === 0 ? (selectedRecord.amount_paid > 0 ? 'PAID' : 'PENDING') : 'PARTIAL'}</span></div>
                </div>
                <div className="info-grid">
                  <div className="info-box"><div className="info-box-title">Bill To</div><div className="info-box-name">{selectedRecord.patients.first_name} {selectedRecord.patients.last_name}</div><div className="info-box-text">{selectedRecord.patients.email}</div><div className="info-box-text">{selectedRecord.patients.contact_no || 'N/A'}</div><div className="info-box-text">{selectedRecord.patients.address || 'N/A'}</div></div>
                  <div className="info-box"><div className="info-box-title">Appointment Details</div><div className="info-box-row"><span className="info-label">Service:</span><span className="info-value">{selectedRecord.appointments.services.service_name}</span></div><div className="info-box-row"><span className="info-label">Doctor:</span><span className="info-value">Dr. {selectedRecord.doctors.first_name} {selectedRecord.doctors.last_name}</span></div><div className="info-box-row"><span className="info-label">Date:</span><span className="info-value">{new Date(selectedRecord.appointments.appointment_datetime).toLocaleString()}</span></div></div>
                </div>
                <div className="amount-table-wrapper">
                  <table className="amount-table">
                    <thead><tr className="amount-table-header"><th>Description</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      <tr className="amount-row"><td>{selectedRecord.appointments.services.service_name}</td><td className="text-right">₱{selectedRecord.total_amount.toFixed(2)}</td></tr>
                      {selectedRecord.discount > 0 && (<tr className="amount-row discount"><td>Discount {selectedRecord.discount_id_no && <span className="discount-tag">{selectedRecord.remarks?.toLowerCase().includes('senior') ? 'Senior' : selectedRecord.remarks?.toLowerCase().includes('pwd') ? 'PWD' : 'Applied'}</span>}</td><td className="text-right discount-amount">-₱{selectedRecord.discount.toFixed(2)}</td></tr>)}
                      <tr className="amount-row total"><td>Total After Discount</td><td className="text-right">₱{(selectedRecord.total_amount - selectedRecord.discount).toFixed(2)}</td></tr>
                      <tr className="amount-row paid"><td>Amount Paid</td><td className="text-right">₱{selectedRecord.amount_paid.toFixed(2)}</td></tr>
                      <tr className="amount-row balance"><td>Remaining Balance</td><td className="text-right"><span className={selectedRecord.balance > 0 ? 'balance-has' : 'balance-zero'}>₱{selectedRecord.balance.toFixed(2)}</span></td></tr>
                    </tbody>
                  </table>
                </div>
                {selectedRecord.payment_method && selectedRecord.amount_paid > 0 && (
                  <div className="info-section"><div className="section-header">Payment Information</div><div className="info-row-group"><div className="info-row-item"><span className="item-label">Method:</span><span className="item-value">{selectedRecord.payment_method.toUpperCase()}</span></div>{selectedRecord.reference_number && (<div className="info-row-item"><span className="item-label">Reference #:</span><span className="item-value">{selectedRecord.reference_number}</span></div>)}<div className="info-row-item"><span className="item-label">Date:</span><span className="item-value">{selectedRecord.payment_date ? new Date(selectedRecord.payment_date).toLocaleDateString() : 'N/A'}</span></div></div></div>
                )}
                {selectedRecord.remarks && (<div className="info-section"><div className="section-header">Remarks</div><div className="remarks-text">{selectedRecord.remarks}</div></div>)}
                <div className="invoice-footer"><div className="footer-thanks">Thank you for choosing Fifthcusp Dental Clinic!</div><div className="footer-note">Please keep this invoice for your records.</div></div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-primary" onClick={() => window.print()}>Print Invoice</button><button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManageBilling;