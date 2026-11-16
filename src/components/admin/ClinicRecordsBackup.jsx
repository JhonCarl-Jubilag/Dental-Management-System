import React, { useEffect, useRef, useState } from 'react';
import { BACKUP_MODULES, downloadClinicRecords, readClinicBackup, previewClinicRecovery, recoverClinicRecords } from '../../services/clinicRecordsBackup';
import { formatClinicDateTime } from '../../utils/clinicScheduling';

export default function ClinicRecordsBackup() {
  const [busy, setBusy] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rawFile = useRef('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; rawFile.current = ''; }; }, []);

  const resetPreview = () => { setPreview(null); setApproved(false); rawFile.current = ''; };
  const run = async (action, work) => {
    if (busy) return;
    setBusy(action); setError(''); setMessage('');
    try { await work(); } catch (failure) {
      if (alive.current) setError(failure.message || 'Could not complete the request. Please try again.');
    } finally { if (alive.current) setBusy(''); }
  };
  const download = () => run('download', async () => {
    const count = await downloadClinicRecords();
    if (alive.current) setMessage(`Download started for ${count.toLocaleString()} clinic records. Keep the file in a private, secure location.`);
  });
  const check = () => run('check', async () => {
    resetPreview();
    const raw = await readClinicBackup(file);
    const result = await previewClinicRecovery(raw);
    if (!alive.current) return;
    if (!result.counts || !result.confirmation) throw new Error('The recovery preview was incomplete. Check the file again.');
    rawFile.current = raw;
    setPreview(result);
  });
  const recover = () => run('recover', async () => {
    if (!approved || !preview || !rawFile.current || missing === 0) return;
    const confirmation = preview.confirmation;
    // A failed or interrupted request must be checked again, never blindly replayed.
    setPreview(null); setApproved(false);
    const raw = rawFile.current; rawFile.current = '';
    const result = await recoverClinicRecords(raw, confirmation);
    if (alive.current) setMessage(`${result.recovered.toLocaleString()} missing records recovered. Existing records were left unchanged. Review Activity History for the recovery summary.`);
  });
  const rows = Object.entries(preview?.counts || {});
  const missing = rows.reduce((sum, [, count]) => sum + count.recoverable, 0);
  const different = rows.reduce((sum, [, count]) => sum + count.different + count.blocked, 0);

  return (
    <section className="clinic-records-backup" aria-labelledby="records-backup-heading" aria-busy={Boolean(busy)}>
      <div className="table-container records-backup-panel">
        <h2 id="records-backup-heading">Backup &amp; Recovery</h2>
        <p>Download a copy of clinic records, or check a saved copy for missing records.</p>
        <div className="records-backup-actions">
          <div>
            <h3>Download records</h3>
            <p>Includes patients, appointments, treatments, billing, services, dentists, inventory and Staff attendance.</p>
            <button type="button" className="btn btn-primary" onClick={download} disabled={Boolean(busy)}>
              <i className="fas fa-download" aria-hidden="true" /> {busy === 'download' ? 'Preparing download…' : 'Download Records Backup'}
            </button>
          </div>
          <div>
            <h3>Recover missing records</h3>
            <p>Choose an unchanged backup from this system. Check it before confirming recovery.</p>
            <label htmlFor="clinic-records-file">Backup file (.json, up to 10 MB)</label>
            <input id="clinic-records-file" type="file" accept=".json,application/json" disabled={Boolean(busy)} onChange={event => {
              setFile(event.target.files?.[0] || null); resetPreview(); setMessage(''); setError('');
            }} />
            <button type="button" className="btn btn-secondary" onClick={check} disabled={!file || Boolean(busy)}>
              {busy === 'check' ? 'Checking file…' : 'Check Backup File'}
            </button>
          </div>
        </div>
        <p className="records-backup-note">Clinic records only. Login accounts, passwords, activity history, uploaded files and system settings are not included. The downloaded file contains private patient and payment information; store it securely.</p>
      </div>
      {error && <p className="records-backup-error" role="alert">{error}</p>}
      {message && <p className="records-backup-success" role="status">{message}</p>}
      {preview && <div className="table-container records-backup-panel">
        <h3>Recovery preview</h3>
        <p>Backup created: {formatClinicDateTime(preview.backup_date)} · Philippine time</p>
        <div className="table-responsive" role="region" aria-label="Recovery preview table" tabIndex={0}>
          <table className="data-table">
            <thead><tr><th scope="col">Records</th><th scope="col">Can recover</th><th scope="col">Already present</th><th scope="col">Different</th><th scope="col">Needs review</th></tr></thead>
            <tbody>{rows.map(([module, count]) => <tr key={module}>
              <th scope="row">{BACKUP_MODULES[module] || module}</th><td>{count.recoverable}</td><td>{count.existing}</td><td>{count.different}</td><td>{count.blocked}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {preview.issues?.length > 0 && <details className="records-backup-issues"><summary>Records left unchanged or needing review ({different})</summary>
          <p>Showing up to 50 records. These records will not be overwritten.</p>
          <ul>{preview.issues.map((issue, index) => <li key={index}>{BACKUP_MODULES[issue.module] || issue.module} #{issue.id}: {issue.reason}</li>)}</ul>
        </details>}
        {missing > 0 ? <>
          <label className="records-backup-confirm"><input type="checkbox" checked={approved} disabled={Boolean(busy)} onChange={event => setApproved(event.target.checked)} />
            <span>I have reviewed the preview. Recover only the {missing.toLocaleString()} eligible missing records and keep existing records unchanged.</span>
          </label>
          <button type="button" className="btn btn-primary" disabled={!approved || Boolean(busy)} onClick={recover}>Confirm Recovery</button>
          <p className="records-backup-note">This preview expires after 15 minutes. If clinic records change, check the file again.</p>
        </> : <p role="status">No eligible missing records to recover.{different > 0 ? ' Review the records listed above.' : ' All backed-up records are already present.'}</p>}
      </div>}
      {busy === 'recover' && <p role="status">Recovering missing records. Please keep this page open…</p>}
    </section>
  );
}
