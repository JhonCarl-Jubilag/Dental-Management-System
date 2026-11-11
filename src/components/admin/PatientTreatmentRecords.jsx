import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../contexts/AuthContext';
import { isClinicUser } from '../../utils/accessControl';
import { formatClinicDateTime, toClinicDateTimeInput } from '../../utils/clinicScheduling';
import { supabase } from '../../services/supabase';
import { readPatientTreatments, readTreatmentOptions, savePatientTreatment, readAllPatientTreatments } from '../../services/treatmentRecords';
import PatientTreatmentHistory from './PatientTreatmentHistory';
import './PatientTreatmentRecords.css';

const money = value => Number(value).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });
const emptyForm = () => ({ procedureName: '', scope: 'specific', teeth: '', treatedAt: '', notes: '', confirmed: false });

const RecordDialog = ({ title, onClose, busy, children }) => {
  const dialog = useRef(null), titleId = useId();
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      element.close(); document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={dialog} className="clinic-records-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="clinic-records-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
    <div className="clinic-records-dialog-body">{children}</div>
  </dialog>;
};

const TreatmentEditor = ({ patientId, patientName, record, onClose, onSaved }) => {
  const [editor, setEditor] = useState(() => ({ record, appointment: record || null, requestId: record ? null : crypto.randomUUID() }));
  const [form, setForm] = useState(() => record ? {
    procedureName: record.procedure_name, scope: record.tooth_scope, teeth: record.tooth_numbers.join(', '),
    treatedAt: toClinicDateTimeInput(record.treated_at), notes: record.notes, confirmed: false,
  } : emptyForm());
  const [dirty, setDirty] = useState(false);
  const [choices, setChoices] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!record), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false);
  const savingRef = useRef(false), request = useRef(0);
  useEffect(() => {
    if (record) return;
    const version = ++request.current;
    setLoading(true); setError('');
    readTreatmentOptions(supabase, patientId, page).then(result => {
      if (request.current === version) { setChoices(result.rows); setTotal(result.total); }
    }).catch(err => { if (request.current === version) setError(err.message); })
      .finally(() => { if (request.current === version) setLoading(false); });
    return () => { request.current += 1; };
  }, [patientId, page, record]);
  useEffect(() => () => { request.current += 1; }, []);
  const change = (key, value) => { setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  const close = () => {
    if (savingRef.current) return;
    if (dirty && !window.confirm('Discard the unsaved treatment changes?')) return;
    onClose();
  };
  const choose = value => {
    const appointment = choices.find(row => String(row.appointment_id) === value) || null;
    if (dirty && !window.confirm('Discard this draft and choose another appointment?')) return;
    setEditor(current => ({ ...current, appointment, requestId: crypto.randomUUID() }));
    setForm(appointment ? { ...emptyForm(), procedureName: appointment.service_name, treatedAt: toClinicDateTimeInput(appointment.appointment_end) } : emptyForm());
    setDirty(false); setConflict(false);
  };
  const save = async event => {
    event.preventDefault();
    if (savingRef.current || !editor.appointment || loading || error || conflict || (record && !dirty)) return;
    if (!record && !form.confirmed) { toast.error('Confirm that the procedure was performed.'); return; }
    savingRef.current = true; setSaving(true);
    const version = request.current;
    try {
      await savePatientTreatment(supabase, patientId, editor, form);
      if (request.current !== version) return;
      toast.success(record ? 'Treatment record updated.' : 'Treatment record saved.');
      onSaved();
    } catch (err) {
      if (request.current !== version) return;
      if (err.code === '40001' || err.code === '23505') setConflict(true);
      toast.error(err.message);
    } finally {
      savingRef.current = false;
      if (request.current === version) setSaving(false);
    }
  };
  const appointment = editor.appointment;
  return <RecordDialog title={record ? 'Edit treatment record' : 'Add treatment record'} onClose={close} busy={saving}>
    <form className="clinic-treatment-form" onSubmit={save}>
      {!record && <section className="clinic-treatment-choice">
        <label htmlFor="treatment-appointment">Finished appointment</label>
        {loading && <p role="status">Loading finished, billed appointments…</p>}
        {error && <p role="alert" className="clinic-treatment-error">{error}</p>}
        <select id="treatment-appointment" autoFocus disabled={loading || saving || Boolean(error)} value={appointment?.appointment_id || ''} onChange={event => choose(event.target.value)}>
          <option value="">Select an appointment</option>
          {choices.map(row => <option key={row.appointment_id} value={row.appointment_id}>#{row.appointment_id} · {formatClinicDateTime(row.appointment_datetime)} · {row.service_name}</option>)}
        </select>
        {!loading && !error && !total && <p>No finished, billed appointments are ready for a treatment entry. Review the appointment and its bill first.</p>}
        {total > 10 && <div className="clinic-treatment-pagination"><button type="button" disabled={loading || saving || Boolean(appointment) || page <= 1} onClick={() => setPage(current => current - 1)}>Previous appointments</button><span>Page {page} of {Math.ceil(total / 10)}</span><button type="button" disabled={loading || saving || Boolean(appointment) || page >= Math.ceil(total / 10)} onClick={() => setPage(current => current + 1)}>Next appointments</button></div>}
        <p className="clinic-treatment-hint">One procedure group per appointment; several teeth can share one entry. <a href="/admin/billing" target="_blank" rel="noreferrer">Open Billing in another tab</a>.</p>
      </section>}
      {appointment && <>
        <div className="clinic-treatment-context"><strong>{patientName || 'Selected patient'}</strong><span>Appointment #{appointment.appointment_id}</span><span>Dr. {appointment.doctor_name}</span><span>Bill #{appointment.billing_id}</span></div>
        {record && <p className="clinic-treatment-hint">Edit the procedure, tooth numbers, treatment date or notes. This record stays linked to the patient and appointment shown above. Previous clinical details are kept when you save changes.</p>}
        <fieldset disabled={saving || conflict}>
          <div className="clinic-treatment-form-grid">
            <div className="clinic-treatment-wide"><label htmlFor="treatment-procedure">Procedure</label><input id="treatment-procedure" autoFocus={Boolean(record)} required maxLength={250} value={form.procedureName} onChange={event => change('procedureName', event.target.value)} /></div>
            <div><label htmlFor="treatment-scope">Treatment scope</label><select id="treatment-scope" value={form.scope} onChange={event => change('scope', event.target.value)}><option value="specific">Specific teeth (FDI)</option><option value="whole_mouth">Whole mouth</option><option value="not_applicable">Not tooth-specific</option></select></div>
            <div><label htmlFor="treatment-teeth">Tooth No.</label><input id="treatment-teeth" disabled={form.scope !== 'specific'} required={form.scope === 'specific'} maxLength={200} placeholder="For example: 16, 17" value={form.teeth} onChange={event => change('teeth', event.target.value)} aria-describedby="treatment-teeth-hint" /><small id="treatment-teeth-hint">FDI numbering: permanent quadrants 1–4; primary quadrants 5–8.</small></div>
            <div className="clinic-treatment-wide"><label htmlFor="treatment-date">Treatment date and time (Philippines)</label><input id="treatment-date" type="datetime-local" required value={form.treatedAt} max={toClinicDateTimeInput(new Date())} onChange={event => change('treatedAt', event.target.value)} /></div>
            <div className="clinic-treatment-wide"><label htmlFor="treatment-notes">Notes / Remarks</label><textarea id="treatment-notes" rows={5} maxLength={10000} value={form.notes} onChange={event => change('notes', event.target.value)} /></div>
          </div>
          <dl className="clinic-treatment-money"><div><dt>Amount charged</dt><dd>{money(appointment.amount_charged)}</dd></div><div><dt>Amount paid</dt><dd>{money(appointment.amount_paid)}</dd></div><div><dt>Balance</dt><dd>{money(appointment.balance)}</dd></div></dl>
          <p className="clinic-treatment-hint">Amounts come from Billing after discounts. To change charges or payments, <a href="/admin/billing" target="_blank" rel="noreferrer">open Billing in another tab</a>, then refresh the treatment table.</p>
          {!record && <label className="clinic-treatment-confirm"><input type="checkbox" required checked={form.confirmed} onChange={event => change('confirmed', event.target.checked)} />I confirm this procedure was performed. Appointment status alone does not confirm treatment.</label>}
        </fieldset>
      </>}
      {conflict && <p className="clinic-treatment-error" role="alert">This record or appointment has changed. Your draft is kept. Copy it if needed, close this form and refresh the records before retrying.</p>}
      <div className="clinic-treatment-form-actions"><button type="button" disabled={saving} onClick={close}>Cancel</button><button className="clinic-treatment-primary" type="submit" disabled={saving || loading || Boolean(error) || !appointment || conflict || (Boolean(record) && !dirty)}>{saving ? 'Saving…' : record ? 'Save changes' : 'Save treatment record'}</button></div>
    </form>
  </RecordDialog>;
};

const PatientTreatmentRecords = ({ patientId, patientName, patient }) => {
  const { user, userType } = useAuth();
  const allowed = Boolean(user && isClinicUser(userType));
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editor, setEditor] = useState(null), [history, setHistory] = useState(false);
  const [historyDirty, setHistoryDirty] = useState(false), [historyBusy, setHistoryBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printRequest = useRef(0), printTab = useRef(null), printingRef = useRef(false), printContext = useRef('');
  const request = useRef(0);
  const accountId = user?.id;
  const printIdentity = `${accountId}:${patientId}:${userType}:${allowed}`;
  printContext.current = printIdentity;
  useEffect(() => {
    setPrinting(false);
    return () => {
      printRequest.current += 1;
      printTab.current?.close(); printTab.current = null; printingRef.current = false;
    };
  }, [patientId, accountId, allowed]);
  const printRecords = async () => {
    if (!allowed || loading || error || printingRef.current || !patient || String(patient.patient_id) !== String(patientId)) return;
    // Open during the click so the browser does not treat the async printout as a popup.
    const target = window.open('', '_blank');
    if (!target) { toast.error('Allow pop-ups for this site to open the treatment printout.'); return; }
    target.opener = null;
    target.document.title = 'Preparing treatment record';
    target.document.body.textContent = 'Preparing all treatment records for printing…';
    const version = ++printRequest.current, identity = printIdentity, profile = { ...patient };
    const isCurrent = () => version === printRequest.current && identity === printContext.current && !target.closed;
    printTab.current = target; printingRef.current = true; setPrinting(true);
    try {
      const { createPatientTreatmentPDF, loadTreatmentPrintAssets, displayTreatmentPrint } = await import('../../services/patientTreatmentPrint');
      if (!isCurrent()) return;
      const assets = await loadTreatmentPrintAssets();
      const allRows = await readAllPatientTreatments(supabase, patientId, isCurrent);
      if (!isCurrent()) return;
      const pdf = createPatientTreatmentPDF({ patient: profile, rows: allRows, assets });
      if (!isCurrent()) return;
      displayTreatmentPrint(pdf, target); printTab.current = null;
    } catch (err) {
      if (isCurrent()) toast.error(err.message || 'Could not prepare the treatment printout. Please retry.');
      if (!target.closed) target.close();
    } finally {
      if (printTab.current === target) { printTab.current = null; if (!target.closed) target.close(); }
      if (version === printRequest.current) { printingRef.current = false; setPrinting(false); }
    }
  };
  const load = useCallback(async () => {
    if (!allowed || !patientId) return;
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await readPatientTreatments(supabase, patientId, page);
      if (version === request.current) { setRows(result.rows); setTotal(result.total); }
    } catch (err) { if (version === request.current) setError(err.message); }
    finally { if (version === request.current) setLoading(false); }
  }, [allowed, patientId, page]);
  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [load, accountId]);
  useEffect(() => { setEditor(null); setHistory(false); setRows([]); setTotal(0); setPage(1); }, [patientId, accountId, allowed]);
  if (!allowed) return null;
  const closeHistory = () => {
    if (historyBusy || (historyDirty && !window.confirm('Discard the unsaved appointment note?'))) return;
    setHistory(false); setHistoryDirty(false);
  };
  return <section className="clinic-treatment-records" aria-labelledby="clinic-treatment-records-title" aria-busy={loading}>
    <div className="clinic-treatment-heading"><div><h2 id="clinic-treatment-records-title">Treatment Records</h2><p>Use Edit treatment on a row to update its clinical details. Charges and payments are managed in Billing.</p></div><div className="clinic-treatment-actions">
      <button type="button" onClick={() => setHistory(true)}>View Appointment History</button>
      <button type="button" disabled={loading || Boolean(editor) || printing} onClick={load}>Refresh records</button>
      <button type="button" disabled={loading || Boolean(error) || Boolean(editor) || printing || String(patient?.patient_id) !== String(patientId)} onClick={printRecords}>{printing ? 'Preparing printout…' : 'Print Treatment Records'}</button>
      <button type="button" className="clinic-treatment-primary" disabled={loading || Boolean(error) || printing} onClick={() => setEditor({ record: null })}>Add Treatment Record</button>
    </div></div>
    {loading && <p role="status">Loading treatment records…</p>}
    {printing && <p role="status">Preparing all saved treatments for an A4 landscape printout…</p>}
    {error && <p className="clinic-treatment-error" role="alert">{error} Use Refresh records to retry.</p>}
    {!error && <div className="clinic-treatment-table-scroll" tabIndex={0} aria-label="Patient treatment records table"><table className="clinic-treatment-table"><thead><tr><th>Tooth No.</th><th>Procedure</th><th>Amount Charged</th><th>Amount Paid</th><th>Balance</th><th>Notes / Remarks</th></tr></thead><tbody>
      {!loading && !rows.length && <tr><td colSpan={6} className="clinic-treatment-empty">No treatment records have been entered for this patient.</td></tr>}
      {rows.map(row => <tr key={row.treatment_id}>
        <td>{row.tooth_scope === 'specific' ? row.tooth_numbers.join(', ') : row.tooth_scope === 'whole_mouth' ? 'Whole mouth' : 'Not tooth-specific'}</td>
        <td><strong>{row.procedure_name}</strong><small>{formatClinicDateTime(row.treated_at)}<br />Dr. {row.doctor_name} · Appointment #{row.appointment_id}<br />Bill #{row.billing_id}{row.bill_archived ? ' (archived)' : ''}</small><button type="button" onClick={() => setEditor({ record: row })} disabled={loading || printing}>Edit treatment</button></td>
        <td>{money(row.amount_charged)}</td><td>{money(row.amount_paid)}</td><td>{money(row.balance)}</td><td className="clinic-treatment-notes">{row.notes || '—'}</td>
      </tr>)}
    </tbody></table></div>}
    <p className="clinic-treatment-hint">Charges are after discounts. Each row uses its linked bill’s current payments; no payment is counted twice here.</p>
    {total > 10 && <nav className="clinic-treatment-pagination" aria-label="Treatment record pages"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(current => current - 1)}>Previous treatments</button><span>Page {page} of {Math.ceil(total / 10)} · {total} records</span><button type="button" disabled={loading || page >= Math.ceil(total / 10)} onClick={() => setPage(current => current + 1)}>Next treatments</button></nav>}
    {editor && <TreatmentEditor key={`${patientId}:${editor.record?.treatment_id || 'new'}`} patientId={patientId} patientName={patientName} record={editor.record} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); if (page === 1) load(); else setPage(1); }} />}
    {history && <RecordDialog title="Appointment History" onClose={closeHistory} busy={historyBusy}><PatientTreatmentHistory patientId={patientId} onDirtyChange={setHistoryDirty} onBusyChange={setHistoryBusy} /></RecordDialog>}
  </section>;
};

export default PatientTreatmentRecords;
