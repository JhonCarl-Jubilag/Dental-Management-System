import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser, roleLabel } from '../../utils/accessControl';
import { supabase } from '../../services/supabase';
import { REPORT_TYPES, defaultReportFilters, loadClinicReport } from '../../services/clinicReports';
import Sidebar from '../../components/admin/Sidebar';
import AdminDataRegion from '../../components/admin/AdminDataRegion';
import ReportSections, { downloadReportPDF } from '../../components/admin/ReportSections';
import './reports.css';

const Reports = () => {
  const { user, userType, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const allowed = Boolean(user && isClinicUser(userType));
  const accountId = user?.id;
  const [reportType, setReportType] = useState('financial');
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const requests = useRef(0);
  const pdfSaving = useRef(false);
  const identity = [accountId, userType, allowed].join(':');
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    if (!authLoading && !allowed) navigate(user ? '/' : '/login', { replace: true });
  }, [authLoading, allowed, user, navigate]);

  useEffect(() => {
    const version = ++requests.current;
    setReport(null);
    setLoadError(null);
    if (!allowed || authLoading) { setLoading(false); return; }
    setLoading(true);
    const isCurrent = () => requests.current === version;
    loadClinicReport(supabase, { ...defaultReportFilters(), reportType }, { isCurrent })
      .then(result => { if (isCurrent()) setReport(result); })
      .catch(error => { if (isCurrent()) setLoadError(error); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { requests.current += 1; };
  }, [accountId, userType, allowed, authLoading, reportType, refresh]);

  const generatePDF = async () => {
    if (!allowed || !report || report.filters.reportType !== reportType || loading || loadError || pdfSaving.current) return;
    const version = requests.current;
    const isCurrent = () => version === requests.current && identity === currentIdentity.current;
    pdfSaving.current = true;
    setGeneratingPdf(true);
    try {
      await downloadReportPDF(report, [], { isCurrent });
    } catch (error) {
      if (isCurrent()) toast.error(error.message || 'Could not generate the PDF. Please retry.');
    } finally {
      pdfSaving.current = false;
      setGeneratingPdf(false);
    }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    const result = await signOut();
    if (result?.success) navigate('/login');
    else { setIsLoggingOut(false); toast.error('Could not log out. Please retry.'); }
  };

  if (authLoading || !allowed) return null;
  return <div className="admin-dashboard">
    <Sidebar onLogout={logout} />
    <main className="main-content reports-page">
      <header className="reports-heading"><h1>Reports</h1><span>{roleLabel(userType)}</span></header>
      <div className="reports-filters">
        <div className="reports-type">
          <label htmlFor="report-type">Report type</label>
          <select id="report-type" value={reportType} disabled={generatingPdf}
            onChange={event => setReportType(event.target.value)}>
            {Object.entries(REPORT_TYPES).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </div>
        <div className="reports-primary-actions">
          <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading || generatingPdf}>Refresh</button>
          <button type="button" className="reports-export" onClick={generatePDF}
            disabled={!report || report.filters.reportType !== reportType || loading || Boolean(loadError) || generatingPdf}>
            {generatingPdf ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
      <AdminDataRegion loading={loading} hasLoaded={Boolean(report)} error={loadError} label="Report data" onRetry={() => setRefresh(value => value + 1)}>
        {report && report.filters.reportType === reportType && <ReportSections report={report} />}
      </AdminDataRegion>
    </main>
    {isLoggingOut && <div className="logout-overlay"><div className="logout-content"><p>Logging out…</p></div></div>}
    <ToastContainer position="bottom-right" autoClose={3000} />
  </div>;
};

export default Reports;
