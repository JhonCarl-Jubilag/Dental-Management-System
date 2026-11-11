import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, roleLabel } from '../../utils/accessControl';
import { getClinicDate } from '../../utils/clinicScheduling';
import { supabase } from '../../services/supabase';
import { REPORT_TYPES, defaultReportFilters, loadClinicReport, loadReportOptions } from '../../services/clinicReports';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import ReportSections, { downloadReportPDF } from '../../components/admin/ReportSections';
import './reports.css';

const filtersMatch = (left, right) => left && right && left.reportType === right.reportType
  && (left.reportType === 'inventory' || ['startDate', 'endDate', 'doctorId', 'serviceId'].every(key => left[key] === right[key]));

const Reports = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user && isClinicUser(userType));
  const accountId = user?.id;
  const [filters, setFilters] = useState(defaultReportFilters);
  const [options, setOptions] = useState({ doctors: [], services: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const requests = useRef(0);
  const reportElement = useRef(null);
  const pdfSaving = useRef(false), pdfOperation = useRef(0);
  const pdfIdentity = useRef('');
  pdfIdentity.current = [accountId, userType, allowed].join(':');

  useEffect(() => {
    if (!authLoading && !allowed) navigate(user ? '/' : '/login', { replace: true });
  }, [authLoading, allowed, user, navigate]);

  useEffect(() => {
    const version = ++requests.current;
    pdfOperation.current += 1; pdfSaving.current = false; setGeneratingPdf(false);
    setReport(null); setOptions({ doctors: [], services: [] }); setLoadError(null);
    if (!allowed || authLoading) { setLoading(false); return; }
    const initial = defaultReportFilters();
    setFilters(initial); setLoading(true);
    const isCurrent = () => requests.current === version;
    Promise.all([loadReportOptions(supabase, isCurrent), loadClinicReport(supabase, initial, { isCurrent })]).then(([nextOptions, nextReport]) => {
      if (!isCurrent()) return;
      setOptions(nextOptions); setReport({ ...nextReport, doctorLabel: 'All dentists', serviceLabel: 'All services' });
    }).catch(error => { if (isCurrent()) setLoadError(error); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { requests.current += 1; pdfOperation.current += 1; pdfSaving.current = false; };
  }, [accountId, userType, allowed, authLoading]);

  const generateReport = async event => {
    event?.preventDefault();
    if (!allowed || loading || generatingPdf) return;
    const version = ++requests.current, snapshot = { ...filters };
    const isCurrent = () => requests.current === version;
    setLoading(true); setLoadError(null);
    try {
      const [nextOptions, nextReport] = await Promise.all([
        loadReportOptions(supabase, isCurrent), loadClinicReport(supabase, snapshot, { isCurrent }),
      ]);
      if (!isCurrent()) return;
      const doctor = nextOptions.doctors.find(row => String(row.doctor_id) === String(snapshot.doctorId));
      const service = nextOptions.services.find(row => String(row.service_id) === String(snapshot.serviceId));
      if (snapshot.reportType !== 'inventory' && ((snapshot.doctorId !== 'all' && !doctor) || (snapshot.serviceId !== 'all' && !service))) throw new Error('A selected filter is no longer available. Reset the filters and retry.');
      setOptions(nextOptions); setReport({ ...nextReport,
        doctorLabel: doctor ? `Dr. ${doctor.first_name} ${doctor.last_name}` : 'All dentists',
        serviceLabel: service?.service_name || 'All services' });
    } catch (error) { if (isCurrent()) { setLoadError(error); toast.error(error.message); } }
    finally { if (isCurrent()) setLoading(false); }
  };

  const generatePDF = async () => {
    if (!allowed || !report || loading || loadError || generatingPdf || pdfSaving.current || !filtersMatch(filters, report.filters)) return;
    const version = requests.current, identity = pdfIdentity.current, operation = ++pdfOperation.current;
    const isCurrent = () => operation === pdfOperation.current && version === requests.current && identity === pdfIdentity.current;
    pdfSaving.current = true; setGeneratingPdf(true);
    try {
      const charts = [...reportElement.current.querySelectorAll('canvas')].map(canvas => ({
        data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
      }));
      await downloadReportPDF(report, charts, { isCurrent });
    }
    catch (error) { if (isCurrent()) toast.error(error.message || 'Could not generate the PDF. Please retry.'); }
    finally { if (operation === pdfOperation.current) { pdfSaving.current = false; setGeneratingPdf(false); } }
  };
  const setField = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const preset = value => {
    const today = getClinicDate();
    setFilters(current => ({ ...current, startDate: value === 'today' ? today : `${today.slice(0, 7)}-01`, endDate: today }));
  };
  const logout = async () => {
    setIsLoggingOut(true);
    const result = await signOut();
    if (result?.success) navigate('/login');
    else { setIsLoggingOut(false); toast.error('Could not log out. Please retry.'); }
  };
  if (authLoading || !allowed) return null;
  const isInventory = filters.reportType === 'inventory';
  const pendingFilters = Boolean(report && !filtersMatch(filters, report.filters));
  return <div className="admin-dashboard">
    <Sidebar onLogout={logout} />
    <main className="main-content reports-page">
      <header className="reports-heading"><div><h1>Reports &amp; Analytics</h1><p>Review clinic activity, billing and supplies.</p></div><span>{roleLabel(userType)}</span></header>
      <form className="reports-filters" onSubmit={generateReport} aria-label="Report filters">
        <fieldset disabled={loading || generatingPdf}>
          <div className="reports-filter-grid">
            <div><label htmlFor="report-type">Report type</label><select id="report-type" value={filters.reportType} onChange={event => setField('reportType', event.target.value)}>{Object.entries(REPORT_TYPES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></div>
            <div><label htmlFor="report-start">Start date</label><input id="report-start" type="date" required={!isInventory} disabled={isInventory} value={filters.startDate} onChange={event => setField('startDate', event.target.value)} /></div>
            <div><label htmlFor="report-end">End date</label><input id="report-end" type="date" required={!isInventory} disabled={isInventory} value={filters.endDate} onChange={event => setField('endDate', event.target.value)} /></div>
            <div><label htmlFor="report-dentist">Dentist</label><select id="report-dentist" disabled={isInventory} value={filters.doctorId} onChange={event => setField('doctorId', event.target.value)}><option value="all">All dentists</option>{options.doctors.map(doctor => <option key={doctor.doctor_id} value={doctor.doctor_id}>Dr. {doctor.first_name} {doctor.last_name}{doctor.status === 'active' ? '' : ' (inactive)'}</option>)}</select></div>
            <div><label htmlFor="report-service">Service</label><select id="report-service" disabled={isInventory} value={filters.serviceId} onChange={event => setField('serviceId', event.target.value)}><option value="all">All services</option>{options.services.map(service => <option key={service.service_id} value={service.service_id}>{service.service_name}{service.status === 'active' ? '' : ' (inactive)'}</option>)}</select></div>
          </div>
          <div className="reports-filter-actions"><div className="reports-presets"><button type="button" disabled={isInventory} onClick={() => preset('today')}>Today</button><button type="button" disabled={isInventory} onClick={() => preset('month')}>This month</button><button type="button" onClick={() => setFilters(defaultReportFilters())}>Reset filters</button></div>
            <div className="reports-primary-actions"><button type="submit" className="reports-generate">{loading ? 'Loading…' : 'Generate report'}</button><button type="button" className="reports-export" onClick={generatePDF} disabled={!report || Boolean(loadError) || pendingFilters}>{generatingPdf ? 'Generating…' : 'Download PDF'}</button></div>
          </div>
        </fieldset>
        {isInventory && <p className="reports-filter-hint">Inventory is a current snapshot; date, dentist and service filters do not apply.</p>}
        {pendingFilters && <p className="reports-filter-hint" role="status">Filters changed. Select Generate report to update the results below.</p>}
      </form>
      {loadError && <p className="reports-query-error" role="alert">{loadError.message}</p>}
      <AdminDataRegion loading={loading} hasLoaded={Boolean(report)} error={loadError} label="Report data" onRetry={generateReport}>
        {report && <div className="reports-document" ref={reportElement}><ReportSections report={report} /></div>}
      </AdminDataRegion>
    </main>
    {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><p>Logging out…</p></div></div>}
    <ToastContainer position="bottom-right" autoClose={3000} />
  </div>;
};

export default Reports;
