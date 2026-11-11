import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser } from '../../utils/accessControl';
import { formatClinicDateTime } from '../../utils/clinicScheduling';
import { supabase } from '../../services/supabase';
import { CLINIC_ADDRESS, CLINIC_EMAIL, CLINIC_NAME, CLINIC_PHONE } from '../../services/clinicDetails';
import { billingStatementFingerprint, buildBillingStatement, formatStatementMoney, readBillingStatement, STATEMENT_FOOTNOTE, STATEMENT_PAYMENT_NOTE } from '../../services/billingStatement';
import DentalLogo from '../../assets/DentalLogo.png';
import './BillingStatement.css';

const BillingStatement = ({ billingId, onClose }) => {
  const { user, userType, loading: authLoading } = useAuth();
  const allowed = Boolean(user && !authLoading && isClinicUser(userType)), accountId = user?.id;
  const [statement, setStatement] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const request = useRef(0), saving = useRef(false), printTab = useRef(null), dialog = useRef(null), identity = useRef('');
  const statementIdentity = [accountId, userType, billingId, allowed].join(':');
  identity.current = statementIdentity;
  const load = useCallback(async () => {
    if (!allowed || saving.current) return;
    const version = ++request.current, context = statementIdentity, isCurrent = () => version === request.current && context === identity.current;
    setLoading(true); setError(''); setNotice(''); setStatement(null);
    try { const row = await readBillingStatement(supabase, billingId, isCurrent); if (isCurrent()) setStatement(buildBillingStatement(row)); }
    catch (err) { if (isCurrent()) setError(err.message || 'Could not load this statement. Please retry.'); }
    finally { if (isCurrent()) setLoading(false); }
  }, [allowed, billingId, statementIdentity]);
  useEffect(() => {
    load();
    return () => { request.current += 1; saving.current = false; printTab.current?.close(); printTab.current = null; };
  }, [load]);
  useEffect(() => {
    const previous = document.activeElement; dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const exportStatement = async mode => {
    if (!allowed || !statement || loading || error || saving.current) return;
    let target = null;
    if (mode === 'print') {
      target = window.open('', '_blank');
      if (!target) { toast.error('Allow pop-ups for this site to print the billing statement.'); return; }
      target.opener = null; target.document.title = 'Preparing billing statement'; target.document.body.textContent = 'Preparing the A4 billing statement…';
    }
    const version = ++request.current, context = identity.current;
    const isCurrent = () => version === request.current && context === identity.current && (!target || !target.closed);
    saving.current = true; printTab.current = target; setBusy(mode); setError(''); setNotice('');
    try {
      const pdfModule = await import('../../services/billingStatementPdf');
      const { loadClinicPdfAssets } = await import('../../services/clinicPdfLayout');
      if (!isCurrent()) return;
      const assets = await loadClinicPdfAssets();
      const row = await readBillingStatement(supabase, billingId, isCurrent);
      if (!isCurrent()) return;
      const latest = buildBillingStatement(row);
      if (billingStatementFingerprint(latest) !== billingStatementFingerprint(statement)) {
        setStatement(latest); setNotice('This bill changed. Review the updated statement, then select Print or Download PDF again.'); return;
      }
      const pdf = pdfModule.createBillingStatementPDF(latest, assets);
      if (!isCurrent()) return;
      setStatement(latest);
      if (target) { pdfModule.printBillingStatementPDF(pdf, target); printTab.current = null; }
      else pdfModule.downloadBillingStatementPDF(pdf, latest);
    } catch (err) { if (isCurrent()) { setError(err.message || 'Could not prepare the statement. Please retry.'); toast.error(err.message || 'Could not prepare the statement. Please retry.'); } }
    finally {
      if (printTab.current === target && target) { printTab.current = null; if (!target.closed) target.close(); }
      if (version === request.current) { saving.current = false; setBusy(''); }
    }
  };
  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const focusable = [...dialog.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  if (!allowed) return null;
  return <div className="clinic-billing-statement-modal" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="clinic-billing-statement-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-statement-heading" ref={dialog} tabIndex={-1} onKeyDown={keys}>
      <header className="clinic-billing-statement-toolbar"><div><h2 id="billing-statement-heading">Billing Statement</h2><p>A4 portrait · Patient copy</p></div><button type="button" aria-label="Close billing statement" onClick={onClose}>×</button></header>
      <div className="clinic-billing-statement-scroll" tabIndex={0} aria-label="Billing statement preview">
        {loading && <p role="status">Loading the latest bill…</p>}
        {error && <div className="clinic-billing-statement-error" role="alert"><p>{error}</p><button type="button" disabled={Boolean(busy)} onClick={load}>Refresh statement</button></div>}
        {notice && <p className="clinic-billing-statement-notice" role="status">{notice}</p>}
        {statement && <article className="clinic-billing-statement-paper">
          <header className="clinic-billing-statement-brand"><img src={DentalLogo} alt={CLINIC_NAME} /><div><h3>Billing Statement</h3><strong>{statement.number}</strong><p>Bill issued: {statement.issuedDate}</p><p>Generated: {formatClinicDateTime(statement.generatedAt)} (Philippines)</p></div></header>
          <address>{CLINIC_ADDRESS}<br />{CLINIC_PHONE}<br />{CLINIC_EMAIL}</address>
          <p className="clinic-billing-statement-status"><strong>{statement.status.label}</strong>{statement.archived && <span>Archived bill</span>}</p>
          <h4>Patient &amp; appointment</h4><dl>
            <div><dt>Patient</dt><dd>{statement.patientName}</dd></div><div><dt>Patient ID</dt><dd>{statement.patientId}</dd></div>
            <div><dt>Appointment</dt><dd>#{statement.appointmentId} · {statement.appointmentDate} (Philippines)</dd></div><div><dt>Dentist</dt><dd>{statement.dentistName}</dd></div>
          </dl>
          <table><thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead><tbody>
            <tr><td>{statement.procedure}</td><td>{formatStatementMoney(statement.gross)}</td></tr>
            <tr><td>Discount</td><td>-{formatStatementMoney(statement.discount)}</td></tr>
            <tr className="clinic-billing-statement-total"><td>Net amount charged</td><td>{formatStatementMoney(statement.net)}</td></tr>
            <tr className="clinic-billing-statement-total"><td>Total paid to date</td><td>{formatStatementMoney(statement.paid)}</td></tr>
            <tr className="clinic-billing-statement-balance"><td>Remaining balance</td><td>{formatStatementMoney(statement.balance)}</td></tr>
          </tbody></table>
          {statement.latestPayment ? <section><h4>Latest recorded payment details</h4><p className="clinic-billing-statement-note">{STATEMENT_PAYMENT_NOTE}</p><dl>
            <div><dt>Method</dt><dd>{statement.latestPayment.method}</dd></div><div><dt>Payment date</dt><dd>{statement.latestPayment.date}</dd></div>
            {statement.latestPayment.reference != null && <div><dt>Reference</dt><dd>{statement.latestPayment.reference}</dd></div>}
          </dl></section> : <p>No payment has been recorded against this bill.</p>}
          <footer><p>{STATEMENT_FOOTNOTE}</p><p>Thank you for choosing {CLINIC_NAME}!</p></footer>
        </article>}
      </div>
      <footer className="clinic-billing-statement-actions"><button type="button" onClick={onClose}>Close</button><button type="button" disabled={!statement || loading || Boolean(error) || Boolean(busy)} onClick={() => exportStatement('download')}>{busy === 'download' ? 'Preparing PDF…' : 'Download PDF'}</button><button type="button" className="clinic-billing-statement-primary" disabled={!statement || loading || Boolean(error) || Boolean(busy)} onClick={() => exportStatement('print')}>{busy === 'print' ? 'Preparing printout…' : 'Print Statement'}</button></footer>
    </section>
  </div>;
};
export default BillingStatement;
