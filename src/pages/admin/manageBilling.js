import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, isOwner, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { completeFinishedAppointments, completePaidAppointment } from '../../services/appointmentCompletion';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import BillingStatement from '../../components/admin/BillingStatement';
import { getBillingStatus, formatStatementDate } from '../../services/billingStatement';
import { getClinicDate } from '../../utils/clinicScheduling';
import './manageBilling.css';

const normalizePaymentMethod = value => String(value ?? '').trim().toLowerCase() || 'cash';

const billingSnapshotFields = ['appointment_id', 'total_amount', 'discount', 'discount_id_no',
  'amount_paid', 'balance', 'payment_method', 'reference_number', 'payment_date', 'remarks', 'archived'];

// Each filter is checked by the database in the same statement as the update.
// An edit or payment based on an older row must not replace newer billing data.
const matchBillingSnapshot = (query, record) => billingSnapshotFields.reduce((filtered, field) =>
  record[field] == null ? filtered.is(field, null) : filtered.eq(field, record[field]), query);

const toCents = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
  const cents = Math.round((Number(value) + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && Math.abs(Number(value) * 100 - cents) < 0.00001 ? cents : null;
};

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
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [billingRecords, setBillingRecords] = useState([]);
  const [unbilledAppointments, setUnbilledAppointments] = useState([]);
  const [stats, setStats] = useState({ totalRevenue: 0, totalPending: 0, totalPaid: 0, totalUnbilled: 0 });

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const billingReadId = useRef(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const billingWriteInProgress = useRef(false);
  const editSnapshot = useRef(null);
  const paymentSnapshot = useRef(null);

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
    payment_date: getClinicDate(),
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
  const isSuperAdmin = isOwner(userType);
  const createStandardCents = toCents(unbilledAppointments.find(item =>
    Number(item.appointment_id) === Number(createForm.appointment_id))?.services?.price);
  const editStandardCents = toCents(billingRecords.find(item =>
    item.billing_id === editForm.billing_id)?.appointments?.services?.price);

  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (!isClinicUser(userType)) navigate('/');
    }
  }, [user, userType, authLoading, navigate, isSuperAdmin]);

  const formatCurrency = (amount) => `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  const autoUpdateExpiredConfirmed = useCallback(async () => {
    const completedCount = await completeFinishedAppointments(supabase);
    if (completedCount) {
      console.log(`${completedCount} finished confirmed appointment(s) marked as completed.`);
    }
  }, []);

  const fetchData = useCallback(async () => {
    const readId = ++billingReadId.current;
    setLoading(true);
    setLoadError(null);
    try {
      await autoUpdateExpiredConfirmed();

      const buildBillingQuery = () => {
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
          .order('created_at', { ascending: false })
          .order('billing_id', { ascending: false });
        if (paymentFilter) query = query.eq('payment_method', paymentFilter);
        if (dateFrom) query = query.gte('payment_date', dateFrom);
        if (dateTo) query = query.lte('payment_date', dateTo);

        return query;
      };

      // Read only rows allowed by RLS. Paging avoids searching just the API's
      // first response. Search text is never inserted into query syntax.
      const billingData = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await buildBillingQuery().range(offset, offset + pageSize - 1);
        if (readId !== billingReadId.current) return;
        if (error) throw error;
        billingData.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      const term = appliedSearch.trim().toLocaleLowerCase();
      let filtered = billingData.filter(record => !term || [
        `${record.patients?.first_name || ''} ${record.patients?.last_name || ''}`,
        record.appointments?.services?.service_name, record.discount_id_no, record.remarks,
      ].some(value => String(value ?? '').toLocaleLowerCase().includes(term)));
      if (statusFilter === 'pending') {
        filtered = filtered.filter(b => b.balance > 0 && Number(b.amount_paid) === 0);
      } else if (statusFilter === 'paid') {
        filtered = filtered.filter(b => b.balance <= 0 && b.amount_paid > 0);
      } else if (statusFilter === 'partial') {
        filtered = filtered.filter(b => b.balance > 0 && b.amount_paid > 0);
      }

      // Count every received payment, including payments on outstanding bills.
      // Accumulate cents so numeric strings and decimal amounts sum consistently.
      let revenueCents = 0, pendingCents = 0, paidCents = 0;
      filtered.forEach(b => {
        revenueCents += toCents(b.total_amount) ?? 0;
        pendingCents += toCents(b.balance) ?? 0;
        paidCents += toCents(b.amount_paid) ?? 0;
      });
      const totalRevenue = revenueCents / 100;
      const totalPending = pendingCents / 100;
      const totalPaid = paidCents / 100;

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
      if (readId !== billingReadId.current) return;
      if (unbilledError) throw unbilledError;
      setBillingRecords(filtered);
      setUnbilledAppointments(unbilled || []);

      setStats({
        totalRevenue,
        totalPending,
        totalPaid,
        totalUnbilled: unbilled?.length || 0
      });
      setHasLoaded(true);
    } catch (err) {
      if (readId !== billingReadId.current) return;
      setLoadError(err);
      console.error(err);
      toast.error(err.message);
    } finally {
      if (readId === billingReadId.current) setLoading(false);
    }
  }, [appliedSearch, statusFilter, paymentFilter, dateFrom, dateTo, showArchived, autoUpdateExpiredConfirmed]);

  useEffect(() => {
    fetchData();
    return () => { billingReadId.current += 1; };
  }, [fetchData]);

  const applySearch = () => {
    const nextSearch = search.trim();
    if (nextSearch === appliedSearch) fetchData();
    else setAppliedSearch(nextSearch);
  };

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
      payment_date: getClinicDate(),
      remarks: ''
    });
  };

  useEffect(() => {
    const { total_amount, discount_type, discount_id_no } = createForm;
    let discountAmount = 0;
    if (discount_type === 'senior' || discount_type === 'pwd') {
      const totalCents = toCents(total_amount);
      discountAmount = totalCents == null ? 0 : Math.round(totalCents * 0.2) / 100;
    } else if (discount_type === 'manual') {
      discountAmount = discount_id_no === '' ? 0 : Number(discount_id_no);
    }
    setCreateForm(prev => ({ ...prev, discount: discountAmount }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createForm.total_amount, createForm.discount_type, createForm.discount_id_no]);

  useEffect(() => {
    const { total_amount, discount_type, discount_id_no } = editForm;
    let discountAmount = 0;
    if (discount_type === 'senior' || discount_type === 'pwd') {
      const totalCents = toCents(total_amount);
      discountAmount = totalCents == null ? 0 : Math.round(totalCents * 0.2) / 100;
    } else if (discount_type === 'manual') {
      discountAmount = discount_id_no === '' ? 0 : Number(discount_id_no);
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
    if (billingWriteInProgress.current || isSubmitting) return;
    setIsSubmitting(true);

    const { total_amount: rawTotal, discount: rawDiscount, amount_paid: rawPaid, payment_method, reference_number, payment_date, remarks, appointment_id, patient_id, doctor_id, discount_type, discount_id_no } = createForm;
    const totalCents = toCents(rawTotal), discountCents = toCents(rawDiscount), paidCents = toCents(rawPaid);
    if (totalCents == null || discountCents == null || paidCents == null || discountCents > totalCents || paidCents > totalCents - discountCents) {
      toast.error('Enter valid amounts. Discount and payment cannot exceed the bill total.');
      setIsSubmitting(false);
      return;
    }
    const total_amount = totalCents / 100, discount = discountCents / 100, amount_paid = paidCents / 100;
    const afterDiscount = (totalCents - discountCents) / 100;

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
    if (totalCents - discountCents < 300000 && paidCents !== totalCents - discountCents) {
      toast.error(`Bills below ₱3,000 after discount require full payment (${formatCurrency(afterDiscount)}).`);
      setIsSubmitting(false);
      return;
    }
    const balance = (totalCents - discountCents - paidCents) / 100;

    billingWriteInProgress.current = true;
    try {
      const { data: existing, error: existingError } = await supabase
        .from('billing')
        .select('billing_id')
        .eq('appointment_id', appointment_id)
        .maybeSingle();
      if (existingError) throw existingError;
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
        const paymentDateFormatted = formatStatementDate(payment_date);
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

      setShowCreateModal(false);
      resetCreateForm();
      await notifySavedBill({ appointment_id }, balance <= 0 && amount_paid > 0, 'Billing record created successfully!');
      fetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      billingWriteInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  const notifySavedBill = async (bill, fullyPaid, successMessage) => {
    if (fullyPaid) {
      try {
        await completePaidAppointment(supabase, bill.appointment_id);
      } catch {
        toast.warn(successMessage + ' Appointment status could not be refreshed. Do not record the payment again; reload to retry the status update.');
        return;
      }
    }
    toast.success(successMessage);
  };

  const handleEditBilling = async (e) => {
    e.preventDefault();
    if (billingWriteInProgress.current || isSubmitting) return;
    const { billing_id, total_amount, discount, amount_paid, payment_method, reference_number,
      payment_date, remarks, discount_type, discount_id_no } = editForm;
    const totalCents = toCents(total_amount), discountCents = toCents(discount), paidCents = toCents(amount_paid);
    if (totalCents == null || discountCents == null || paidCents == null || discountCents > totalCents || paidCents > totalCents - discountCents) {
      toast.error('Enter valid amounts. Discount and payment cannot exceed the bill total.');
      return;
    }
    if (payment_method !== 'cash' && !reference_number.trim()) {
      toast.error('Reference number is required for this payment method.');
      return;
    }
    const idError = validateDiscountId(discount_type, discount_id_no);
    if (idError) { toast.error(idError); return; }
    if (!editSnapshot.current || editSnapshot.current.billing_id !== billing_id) {
      toast.error('Close and reopen this bill before saving changes.');
      return;
    }
    const amountsChanged = toCents(editSnapshot.current.total_amount) !== totalCents
      || toCents(editSnapshot.current.discount) !== discountCents
      || toCents(editSnapshot.current.amount_paid) !== paidCents;
    if (amountsChanged && totalCents - discountCents < 300000 && paidCents !== totalCents - discountCents) {
      toast.error('Bills below ₱3,000 after discount require full payment. Review the amount paid.');
      return;
    }
    const balance = (totalCents - discountCents - paidCents) / 100;
    let newRemarks = remarks || '';
    if (discount_type === 'senior') newRemarks = '[Discount Applied]: Senior Citizen (20%) - ₱' + (discountCents / 100).toFixed(2) + ' | ID: ' + discount_id_no + '\n' + newRemarks;
    else if (discount_type === 'pwd') newRemarks = '[Discount Applied]: PWD (20%) - ₱' + (discountCents / 100).toFixed(2) + ' | ID: ' + discount_id_no + '\n' + newRemarks;
    else if (discount_type === 'manual') newRemarks = '[Discount Applied]: Manual Discount - ₱' + (discountCents / 100).toFixed(2) + '\n' + newRemarks;

    billingWriteInProgress.current = true;
    setIsSubmitting(true);
    let writeStarted = false;
    try {
      writeStarted = true;
      const { data: savedBill, error } = await matchBillingSnapshot(supabase.from('billing')
        .update({ total_amount: totalCents / 100, discount: discountCents / 100,
          discount_id_no: discount_type !== 'none' ? discount_id_no : null,
          amount_paid: paidCents / 100, balance, payment_method,
          reference_number: payment_method !== 'cash' ? reference_number.trim() : null,
          payment_date, remarks: newRemarks })
        .eq('billing_id', billing_id), editSnapshot.current)
        .select('billing_id, appointment_id').maybeSingle();
      if (error) {
        if (!error.code || error.code === '57014') throw new Error('Save result could not be confirmed. Check the billing record before trying again.');
        writeStarted = false;
        throw error;
      }
      writeStarted = false;
      if (!savedBill) throw new Error('This bill changed or is no longer available. Close and reopen it to review the latest details. Your edits were not saved.');
      editSnapshot.current = null;
      setShowEditModal(false);
      await notifySavedBill(savedBill, balance === 0 && paidCents > 0, 'Billing record updated successfully!');
      fetchData();
    } catch (err) {
      toast.error(err.message || 'Could not update the billing record.');
      if (writeStarted) { setShowEditModal(false); editSnapshot.current = null; }
      fetchData();
    } finally {
      billingWriteInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (billingWriteInProgress.current || isSubmitting) return;
    const { billing_id, amount, payment_method, reference_number, remarks } = paymentForm;
    const amountCents = toCents(amount);
    if (amountCents == null || amountCents <= 0) {
      toast.error('Payment amount must be greater than 0 and a valid monetary amount.');
      return;
    }
    if (payment_method !== 'cash' && !reference_number.trim()) {
      toast.error('Reference number is required for this payment method.');
      return;
    }
    if (!paymentSnapshot.current || paymentSnapshot.current.billing_id !== billing_id) {
      toast.error('Close and reopen this payment form before saving.');
      return;
    }
    billingWriteInProgress.current = true;
    setIsSubmitting(true);
    let writeStarted = false;
    try {
      const { data: bill, error: readError } = await supabase.from('billing')
        .select('*').eq('billing_id', billing_id).single();
      if (readError) throw readError;
      if (!bill || bill.archived) throw new Error('This bill is unavailable or archived. Reload the billing list.');
      const unchanged = billingSnapshotFields.every(field =>
        (bill[field] ?? null) === (paymentSnapshot.current[field] ?? null));
      if (!unchanged) throw new Error('This bill changed since you opened it. Close and reopen the payment form to review the latest balance. No payment was recorded.');
      const balanceCents = toCents(bill.balance), paidCents = toCents(bill.amount_paid);
      const totalCents = toCents(bill.total_amount), discountCents = toCents(bill.discount);
      if ([balanceCents, paidCents, totalCents, discountCents].some(value => value == null)
        || discountCents > totalCents || balanceCents + paidCents !== totalCents - discountCents) {
        throw new Error('The bill has invalid amounts. Review it before recording a payment.');
      }
      if (amountCents > balanceCents) throw new Error('Payment cannot exceed the latest balance (' + formatCurrency(balanceCents / 100) + ').');
      if (totalCents - discountCents < 300000 && amountCents !== balanceCents) {
        throw new Error('Bills below ₱3,000 after discount require full payment. Pay the latest balance (' + formatCurrency(balanceCents / 100) + ').');
      }
      const newPaidCents = paidCents + amountCents;
      if (!Number.isSafeInteger(newPaidCents)) throw new Error('Payment exceeds the supported amount.');
      const newBalance = (balanceCents - amountCents) / 100;
      const refNote = payment_method !== 'cash' ? ' Ref: ' + reference_number.trim() : '';
      const paymentRecord = '\n\n[Payment ' + new Date().toLocaleString() + ']: ₱' + (amountCents / 100).toFixed(2) + ' via ' + payment_method + refNote + (remarks ? ' - ' + remarks : '');
      writeStarted = true;
      const { data: savedBill, error: updateError } = await matchBillingSnapshot(supabase.from('billing')
        .update({ amount_paid: newPaidCents / 100, balance: newBalance, payment_method,
          reference_number: payment_method !== 'cash' ? reference_number.trim() : null,
          payment_date: getClinicDate(),
          remarks: (bill.remarks || '') + paymentRecord })
        .eq('billing_id', billing_id), bill)
        .select('billing_id, appointment_id').maybeSingle();
      if (updateError) {
        if (!updateError.code || updateError.code === '57014') throw new Error('Payment result could not be confirmed. Check the billing record before trying again.');
        writeStarted = false;
        throw updateError;
      }
      writeStarted = false;
      if (!savedBill) throw new Error('This bill changed while the payment was being saved. Close and reopen the form to review it. No payment was recorded.');
      paymentSnapshot.current = null;
      setShowPaymentModal(false);
      await notifySavedBill(savedBill, newBalance === 0, 'Payment recorded successfully!');
      fetchData();
    } catch (err) {
      toast.error(writeStarted ? 'Payment result could not be confirmed. Check the billing record before trying again.' : err.message || 'Could not record the payment.');
      if (writeStarted) { setShowPaymentModal(false); paymentSnapshot.current = null; }
      fetchData();
    } finally {
      billingWriteInProgress.current = false;
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

  const getStatusClass = record => getBillingStatus(record).className;
  const getStatusText = record => getBillingStatus(record).label;
  const getAppointmentStatusClass = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'confirmed': return 'status-confirmed';
      case 'cancelled': return 'status-cancelled';
      case 'completed': return 'status-completed';
      default: return '';
    }
  };

  if (authLoading) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (!user || (!isClinicUser(userType))) return null;

  const adminName = isSuperAdmin ? 'Super Admin' : (user?.email?.split('@')[0] || 'Admin');
  const adminInitial = adminName.charAt(0).toUpperCase();

  return (
    <div className="admin-dashboard admin-billing">
      <Sidebar onLogout={handleLogout} />

      <div className="main-content manage-billing-page">
        <div className="dashboard-header">
          <div className="header-title">
            <h1>Billing Management</h1>
            <p className="welcome-message">Manage payments, discounts, and billing statements</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" disabled={loading || !hasLoaded || isSubmitting} onClick={() => setShowCreateModal(true)}>
              <i className="fas fa-plus"></i> Create Bill
            </button>
            <button 
              className={`btn ${showArchived ? 'btn-warning' : 'btn-info'}`} 
              disabled={loading}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? 'Hide Archives' : 'Show Archives'}
            </button>
            <div className="user-info">
              <div className="user-avatar">{adminInitial}</div>
              <div className="user-details">
                <div className="user-name">{adminName}</div>
                <div className="user-role">{roleLabel(userType)}</div>
              </div>
            </div>
          </div>
        </div>
        <AdminDataRegion loading={loading} hasLoaded={hasLoaded} error={loadError} label="Billing records" onRetry={fetchData}>


        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">₱{stats.totalRevenue.toLocaleString()}</div><div className="stat-label">Total Billing</div></div>
          <div className="stat-card"><div className="stat-number">₱{stats.totalPending.toLocaleString()}</div><div className="stat-label">Pending Payments</div></div>
          <div className="stat-card"><div className="stat-number">₱{stats.totalPaid.toLocaleString()}</div><div className="stat-label">Paid Amount</div></div>
          <div className="stat-card"><div className="stat-number">{stats.totalUnbilled}</div><div className="stat-label">Unbilled</div></div>
        </div>

        {stats.totalUnbilled > 0 && !showArchived && (
          <div className="unbilled-alert">
            <div><i className="fas fa-exclamation-triangle"></i> You have {stats.totalUnbilled} confirmed/completed appointment(s) without billing.</div>
            <button className="btn btn-warning" disabled={isSubmitting} onClick={() => setShowCreateModal(true)}>Create Bills Now</button>
          </div>
        )}

        <div className="filters">
          <div className="filter-grid">
            <div className="filter-group"><label htmlFor="billing-search">Search</label><input id="billing-search" type="text" className="form-control" placeholder="Patient, service, ID..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }} /></div>
            <div className="filter-group"><label>Payment Status</label><select className="form-control" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="partial">Partial</option></select></div>
            <div className="filter-group"><label>Payment Method</label><select className="form-control" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}><option value="">All</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="maya">Maya</option><option value="other">Other e-Bank</option></select></div>
            <div className="filter-group"><label>Date From</label><input type="date" className="form-control" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
            <div className="filter-group"><label>Date To</label><input type="date" className="form-control" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
            <div className="filter-group filter-actions">
              <button className="btn btn-primary" onClick={applySearch}>Apply</button>
              <button className="btn btn-secondary" onClick={() => { setSearch(''); setAppliedSearch(''); setStatusFilter(''); setPaymentFilter(''); setDateFrom(''); setDateTo(''); }}>Reset</button>
            </div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>Billing Records {showArchived && <span style={{ color: '#b52e42' }}>(Archived)</span>}</h3>
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
                            <button className="btn btn-primary btn-sm" onClick={() => { setSelectedRecord(record); setShowStatementModal(true); }}>Statement</button>
                            
                            {record.archived ? (
                              <button className="btn btn-success btn-sm" onClick={() => handleRestore(record.billing_id)}>
                                Restore
                              </button>
                            ) : (
                              <>
                                {record.balance > 0 && (
                                  <button className="btn btn-success btn-sm" disabled={isSubmitting} onClick={() => {
                                    paymentSnapshot.current = { ...record };
                                    setPaymentForm({
                                      billing_id: record.billing_id,
                                      amount: 0,
                                      payment_method: 'cash',
                                      reference_number: '',
                                      remarks: '',
                                      current_balance: record.balance
                                    });
                                    setShowPaymentModal(true);
                                  }}>Pay</button>
                                )}
                                <button className="btn btn-warning btn-sm" disabled={isSubmitting} onClick={() => {
                                  editSnapshot.current = { ...record };
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
                                    discount_id_no: discType === 'manual' ? String(record.discount) : record.discount_id_no || '',
                                    amount_paid: record.amount_paid,
                                    payment_method: normalizePaymentMethod(record.payment_method),
                                    reference_number: record.reference_number || '',
                                    payment_date: record.payment_date || getClinicDate(),
                                    remarks: record.remarks || ''
                                  });
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
        </AdminDataRegion>
      </div>

      {/* CREATE BILLING MODAL */}
      {showCreateModal && (
        <div className="modal-billing-create active" onClick={e => e.target === e.currentTarget && !isSubmitting && setShowCreateModal(false)}>
          <div className="modal-billing-create-content modal-billing-create-lg">
            <div className="modal-billing-create-header">
              <h3>Create New Billing</h3>
              <button className="modal-billing-create-close" disabled={isSubmitting} onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateBilling}>
              <div className="modal-billing-create-body">
                <div className="form-group"><label htmlFor="billing-create-appointment">Select Appointment *</label><select id="billing-create-appointment" disabled={isSubmitting} className="form-control" value={createForm.appointment_id} onChange={async (e) => {
                  const aptId = e.target.value;
                  const appointment = unbilledAppointments.find(a => a.appointment_id === parseInt(aptId));
                  if (appointment) {
                    const service = appointment.services;
                    const standardCents = toCents(service.price);
                    setCreateForm(previous => ({ ...previous, appointment_id: aptId, patient_id: appointment.patients.patient_id,
                      doctor_id: appointment.doctors.doctor_id, service_id: service.service_id, service_name: service.service_name,
                      total_amount: standardCents == null ? '' : standardCents / 100,
                      discount_type: 'none', discount: 0, discount_id_no: '',
                      amount_paid: standardCents != null && standardCents < 300000 ? standardCents / 100 : 0 }));
                  } else resetCreateForm();
                }} required><option value="">-- Select Appointment --</option>{unbilledAppointments.map(apt => (<option key={apt.appointment_id} value={apt.appointment_id}>{new Date(apt.appointment_datetime).toLocaleString()} - {apt.patients.first_name} {apt.patients.last_name} - {apt.services.service_name}</option>))}</select></div>
                <div className="form-group"><label>Service</label><input type="text" className="form-control" value={createForm.service_name} readOnly disabled /></div>
                <div className="form-group"><label htmlFor="billing-create-standard">Current standard price — internal reference</label><input id="billing-create-standard" type="text" className="form-control" value={createStandardCents == null ? 'Not available' : formatCurrency(createStandardCents / 100)} readOnly /></div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="billing-create-charge">Agreed treatment charge (₱)</label>
                    <input id="billing-create-charge" type="number" className="form-control" value={createForm.total_amount}
                      onChange={event => setCreateForm(previous => ({ ...previous, total_amount: event.target.value }))}
                      disabled={isSubmitting || !createForm.appointment_id} min="0" step="0.01" required aria-describedby="billing-create-charge-help" />
                    <small id="billing-create-charge-help">Enter the treatment charge before any separate discount. Confirm the amount paid separately.</small>
                  </div>
                  <div className="form-group"><label htmlFor="billing-create-discount-type">Discount Type</label><select id="billing-create-discount-type" disabled={isSubmitting} className="form-control" value={createForm.discount_type} onChange={e => setCreateForm({ ...createForm, discount_type: e.target.value })}><option value="none">No Discount</option><option value="senior">Senior Citizen (20%)</option><option value="pwd">PWD (20%)</option><option value="manual">Manual Discount</option></select></div>
                </div>
                {createForm.discount_type !== 'none' && (<div className="form-group"><label htmlFor="billing-create-discount-value">{createForm.discount_type === 'manual' ? 'Discount Amount (₱)' : 'ID Number *'}</label><input id="billing-create-discount-value" min="0" step="0.01" disabled={isSubmitting} type={createForm.discount_type === 'manual' ? 'number' : 'text'} className="form-control" value={createForm.discount_id_no} onChange={e => setCreateForm({ ...createForm, discount_id_no: e.target.value })} placeholder={createForm.discount_type === 'manual' ? 'Enter amount' : 'Enter ID number'} required /></div>)}
                <div className="discount-summary"><strong>Amount after discount:</strong> ₱{(createForm.total_amount - createForm.discount).toFixed(2)} {createForm.discount > 0 && <span>(Discount: ₱{createForm.discount.toFixed(2)})</span>}</div>
                <div className="form-row">
                  <div className="form-group"><label htmlFor="billing-create-paid">Amount Paid (₱)</label><input id="billing-create-paid" disabled={isSubmitting} type="number" className="form-control" value={createForm.amount_paid} onChange={e => setCreateForm({ ...createForm, amount_paid: parseFloat(e.target.value) || 0 })} step="0.01" min="0" /></div>
                  <div className="form-group"><label htmlFor="billing-create-method">Payment Method</label><select id="billing-create-method" disabled={isSubmitting} className="form-control" value={createForm.payment_method} onChange={e => setCreateForm({ ...createForm, payment_method: e.target.value, reference_number: e.target.value === 'cash' ? '' : createForm.reference_number })}>
                    <option value="cash">Cash</option>
                    <option value="gcash">GCash</option>
                    <option value="maya">Maya</option>
                    <option value="other">Other e-Bank</option>
                  </select></div>
                </div>
                {createForm.payment_method !== 'cash' && (
                  <div className="form-group"><label htmlFor="billing-create-reference">Reference Number *</label><input id="billing-create-reference" disabled={isSubmitting} type="text" className="form-control" value={createForm.reference_number} onChange={e => setCreateForm({ ...createForm, reference_number: e.target.value })} placeholder="e.g., GCash transaction ID, bank reference" required /></div>
                )}
                <div className="form-group"><label>Payment Date</label><input disabled={isSubmitting} type="date" className="form-control" value={createForm.payment_date} onChange={e => setCreateForm({ ...createForm, payment_date: e.target.value })} /></div>
                <div className="form-group"><label>Remarks</label><textarea disabled={isSubmitting} className="form-control" rows="3" value={createForm.remarks} onChange={e => setCreateForm({ ...createForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-billing-create-footer">
                <button type="button" className="btn btn-secondary" disabled={isSubmitting} onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Create Bill'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT BILLING MODAL */}
      {showEditModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && !isSubmitting && setShowEditModal(false)}>
          <div className="modal-content modal-lg">
            <div className="modal-header"><h3>Edit Billing Record</h3><button className="modal-close" disabled={isSubmitting} onClick={() => setShowEditModal(false)}>&times;</button></div>
            <form onSubmit={handleEditBilling}>
              <div className="modal-body">
                <div className="form-group"><label htmlFor="billing-edit-standard">Current standard price — internal reference</label><input id="billing-edit-standard" type="text" className="form-control" value={editStandardCents == null ? 'Not available' : formatCurrency(editStandardCents / 100)} readOnly /></div>
                <div className="form-row"><div className="form-group"><label htmlFor="billing-edit-charge">Agreed treatment charge (₱)</label><input id="billing-edit-charge" disabled={isSubmitting} type="number" className="form-control" value={editForm.total_amount} onChange={event => setEditForm(previous => ({ ...previous, total_amount: event.target.value }))} min="0" step="0.01" required /></div><div className="form-group"><label htmlFor="billing-edit-discount-type">Discount Type</label><select id="billing-edit-discount-type" disabled={isSubmitting} className="form-control" value={editForm.discount_type} onChange={e => setEditForm({ ...editForm, discount_type: e.target.value })}><option value="none">No Discount</option><option value="senior">Senior Citizen (20%)</option><option value="pwd">PWD (20%)</option><option value="manual">Manual Discount</option></select></div></div>
                {editForm.discount_type !== 'none' && (<div className="form-group"><label htmlFor="billing-edit-discount-value">{editForm.discount_type === 'manual' ? 'Discount Amount (₱)' : 'ID Number *'}</label><input id="billing-edit-discount-value" min="0" step="0.01" disabled={isSubmitting} type={editForm.discount_type === 'manual' ? 'number' : 'text'} className="form-control" value={editForm.discount_id_no} onChange={e => setEditForm({ ...editForm, discount_id_no: e.target.value })} placeholder={editForm.discount_type === 'manual' ? 'Enter amount' : 'Enter ID number'} required /></div>)}
                <div className="discount-summary"><strong>Amount after discount:</strong> ₱{(editForm.total_amount - editForm.discount).toFixed(2)} {editForm.discount > 0 && <span>(Discount: ₱{editForm.discount.toFixed(2)})</span>}</div>
                <div className="form-row"><div className="form-group"><label htmlFor="billing-edit-paid">Amount Paid (₱)</label><input id="billing-edit-paid" disabled={isSubmitting} type="number" className="form-control" value={editForm.amount_paid} onChange={e => setEditForm({ ...editForm, amount_paid: parseFloat(e.target.value) || 0 })} step="0.01" min="0" /></div><div className="form-group"><label htmlFor="billing-edit-method">Payment Method</label><select id="billing-edit-method" disabled={isSubmitting} className="form-control" value={editForm.payment_method} onChange={e => setEditForm({ ...editForm, payment_method: e.target.value, reference_number: e.target.value === 'cash' ? '' : editForm.reference_number })}>
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="other">Other e-Bank</option>
                </select></div></div>
                {editForm.payment_method !== 'cash' && (
                  <div className="form-group"><label htmlFor="billing-edit-reference">Reference Number *</label><input id="billing-edit-reference" disabled={isSubmitting} type="text" className="form-control" value={editForm.reference_number} onChange={e => setEditForm({ ...editForm, reference_number: e.target.value })} placeholder="Transaction reference number" required /></div>
                )}
                <div className="form-group"><label>Payment Date</label><input disabled={isSubmitting} type="date" className="form-control" value={editForm.payment_date} onChange={e => setEditForm({ ...editForm, payment_date: e.target.value })} /></div>
                <div className="form-group"><label>Remarks</label><textarea disabled={isSubmitting} className="form-control" rows="3" value={editForm.remarks} onChange={e => setEditForm({ ...editForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={isSubmitting} onClick={() => setShowEditModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Update Bill'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && !isSubmitting && setShowPaymentModal(false)}>
          <div className="modal-content">
            <div className="modal-header"><h3>Record Payment</h3><button className="modal-close" disabled={isSubmitting} onClick={() => setShowPaymentModal(false)}>&times;</button></div>
            <form onSubmit={handleRecordPayment}>
              <div className="modal-body">
                <div className="form-group"><label>Current Balance</label><div className="balance-display">{formatCurrency(paymentForm.current_balance)}</div></div>
                <div className="form-group"><label htmlFor="billing-payment-amount">Payment Amount (₱)</label><input id="billing-payment-amount" disabled={isSubmitting} type="number" className="form-control" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })} step="0.01" min="0" required /></div>
                <div className="form-group"><label htmlFor="billing-payment-method">Payment Method</label><select id="billing-payment-method" disabled={isSubmitting} className="form-control" value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value, reference_number: e.target.value === 'cash' ? '' : paymentForm.reference_number })}>
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="other">Other e-Bank</option>
                </select></div>
                {paymentForm.payment_method !== 'cash' && (
                  <div className="form-group"><label htmlFor="billing-payment-reference">Reference Number *</label><input id="billing-payment-reference" disabled={isSubmitting} type="text" className="form-control" value={paymentForm.reference_number} onChange={e => setPaymentForm({ ...paymentForm, reference_number: e.target.value })} placeholder="Transaction reference number" required /></div>
                )}
                <div className="form-group"><label>Remarks</label><textarea disabled={isSubmitting} className="form-control" rows="2" value={paymentForm.remarks} onChange={e => setPaymentForm({ ...paymentForm, remarks: e.target.value })}></textarea></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={isSubmitting} onClick={() => setShowPaymentModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Processing...' : 'Record Payment'}</button></div>
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
                    <tr><td className="label-cell">Reference Number</td><td className="value-cell">{normalizePaymentMethod(selectedRecord.payment_method) === 'cash' ? 'Not required for cash' : selectedRecord.reference_number || 'N/A'}</td><td className="label-cell">Payment Date</td><td className="value-cell">{selectedRecord.payment_date ? new Date(selectedRecord.payment_date).toLocaleDateString() : 'N/A'}</td></tr>
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

      {showStatementModal && selectedRecord && (
        <BillingStatement key={selectedRecord.billing_id} billingId={selectedRecord.billing_id} onClose={() => setShowStatementModal(false)} />
      )}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default ManageBilling;
