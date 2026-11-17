import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { readMyTreatmentHistory } from '../../services/treatmentRecords';
import { formatClinicDateTime } from '../../utils/clinicScheduling';
import DentalLogo from '../../assets/DentalLogo.png';
import './treatmentHistory.css';

const teethLabel = row => row.tooth_scope === 'specific' ? row.tooth_numbers.join(', ')
  : row.tooth_scope === 'whole_mouth' ? 'Whole mouth' : 'Not tooth-specific';

function HistoryContent({ patientId, patientName, signOut }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [query, setQuery] = useState({ from: '', to: '', page: 1, refresh: 0 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [selected, setSelected] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null); setSelected(null);
    readMyTreatmentHistory(supabase, patientId, query, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message || 'Could not load treatment history. Please try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [patientId, query]);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected]);

  const refresh = () => setQuery(current => ({ ...current, refresh: current.refresh + 1 }));
  const apply = event => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError('The end date must be on or after the start date.'); return; }
    setFilterError(''); setQuery(current => ({ ...draft, page: 1, refresh: current.refresh + 1 }));
  };
  const reset = () => { setDraft({ from: '', to: '' }); setFilterError(''); setQuery(current => ({ from: '', to: '', page: 1, refresh: current.refresh + 1 })); };
  const logout = async () => {
    setLoggingOut(true);
    try {
      const outcome = await signOut();
      if (outcome?.success !== true) throw new Error('Could not sign out. Please try again.');
      navigate('/login', { replace: true });
    } catch (failure) { setError(failure.message); setLoggingOut(false); }
  };
  const pageCount = Math.max(1, Math.ceil((result?.total || 0) / 10));
  return (
    <div className="patient-treatment-history">
      <nav className="modern-nav" aria-label="Patient navigation">
        <div className="nav-container">
          <Link to="/profile" className="logo">
            <img src={DentalLogo} alt="Diolata Dental Clinic Logo" className="logo-image" />
          </Link>

          <button type="button" aria-label="Patient menu" aria-expanded={menu} className="mobile-menu-btn" onClick={() => setMenu(!menu)}>
            <i className={`fas fa-${menu ? 'times' : 'bars'}`}></i>
          </button>

          <div className={`nav-menu ${menu ? 'active' : ''}`}>
            <ul className="nav-links">
              <li><a href="/#services" onClick={() => setMenu(false)}>Services</a></li>
              <li><a href="/#about" onClick={() => setMenu(false)}>About Us</a></li>
              <li><a href="/#chatbot" onClick={() => setMenu(false)}>Chatbot</a></li>
            </ul>

            <div className="user-menu">
              <button type="button" aria-expanded={userMenu} aria-controls="pth-user-dropdown" className="user-dropdown-btn" onClick={() => setUserMenu(!userMenu)}>
                <i className="fas fa-user-circle"></i>
                {patientName}
                <i className={`fas fa-chevron-${userMenu ? 'up' : 'down'}`}></i>
              </button>
              <div id="pth-user-dropdown" hidden={!userMenu} className={`user-dropdown ${userMenu ? 'active' : ''}`}>
                <Link to="/book-appointment" onClick={() => setUserMenu(false)}>
                  <i className="fas fa-book"></i> Book Appointment
                </Link>
                <Link to="/my-appointments" onClick={() => setUserMenu(false)}>
                  <i className="fas fa-calendar-check"></i> My Appointments
                </Link>
                <Link to="/treatment-history" onClick={() => setUserMenu(false)}><i className="fas fa-notes-medical" aria-hidden="true"></i> Treatment History</Link>
                <Link to="/profile" onClick={() => setUserMenu(false)}>
                  <i className="fas fa-user"></i> My Profile
                </Link>
                <button type="button" disabled={loggingOut} onClick={logout} className="dropdown-logout-btn">
                  <i className="fas fa-sign-out-alt"></i> Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="pth-content">
        <div className="pth-heading"><div><p className="pth-eyebrow">Your dental care</p><h1>My Treatment History</h1><p>{patientName}, view the treatments recorded by your clinic.</p></div>

        </div>
        <form className="pth-filters" onSubmit={apply} aria-label="Treatment history filters">
          <div><label htmlFor="pth-from">From</label><input id="pth-from" type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></div>
          <div><label htmlFor="pth-to">To</label><input id="pth-to" type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></div>
          <div className="pth-filter-actions"><button type="submit" className="pth-button pth-primary" disabled={loading}>Apply Filters</button><button type="button" className="pth-button" disabled={loading} onClick={reset}>Clear</button></div>
          <button type="button" className="pth-button pth-refresh" disabled={loading} onClick={refresh}><i className="fas fa-sync-alt" aria-hidden="true" /> Refresh</button>
          {filterError && <p className="pth-error pth-filter-error" role="alert">{filterError}</p>}
        </form>
        {error && <div className="pth-error" role="alert"><p>{error}</p><button type="button" className="pth-button" onClick={refresh}>Try again</button></div>}
        <section className="pth-records" aria-labelledby="pth-records-title" aria-busy={loading}>
          <div className="pth-records-heading"><h2 id="pth-records-title">Recorded treatments</h2></div>
          {loading ? <p className="pth-state" role="status">Loading treatment history…</p> : result && <>
            {result.rows.length > 0 ? <table className="pth-table"><caption className="pth-sr-only">Your recorded dental treatments, newest first</caption>
              <thead><tr><th scope="col">Treatment date</th><th scope="col">Procedure</th><th scope="col">Tooth / Teeth</th><th scope="col">Dentist</th><th scope="col">Remarks / Aftercare</th><th scope="col"><span className="pth-sr-only">Details</span></th></tr></thead>
              <tbody>{result.rows.map(row => <tr key={row.treatment_id}>
                <td data-label="Date"><time dateTime={row.treated_at}>{formatClinicDateTime(row.treated_at)}</time></td>
                <td data-label="Procedure"><strong>{row.procedure_name}</strong></td><td data-label="Teeth">{teethLabel(row)}</td>
                <td data-label="Dentist">{row.doctor_name === 'Not recorded' ? row.doctor_name : `Dr. ${row.doctor_name}`}</td>
                <td data-label="Remarks" className="pth-remarks">{row.patient_remarks.trim() || 'No remarks recorded.'}</td><td className="pth-details-cell"><button type="button" className="pth-button" aria-label={`View ${row.procedure_name} on ${formatClinicDateTime(row.treated_at)}`} onClick={() => setSelected(row)}>View Details</button></td>
              </tr>)}</tbody>
            </table> : <div className="pth-state"><i className="fas fa-tooth" aria-hidden="true" /><h3>{query.from || query.to ? 'No treatments in this date range' : 'No treatment records yet'}</h3><p>{query.from || query.to ? 'Choose another date range or clear the filters.' : 'Your treatments will appear here after the clinic saves a treatment record. Contact the clinic if a treatment is missing.'}</p></div>}
            {result.total > 0 && <nav className="pth-pagination" aria-label="Treatment history pages"><button type="button" className="pth-button" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</button><span>Page {query.page} of {pageCount}</span><button type="button" className="pth-button" disabled={query.page >= pageCount} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</button></nav>}
            {!result.rows.length && query.page > 1 && <button type="button" className="pth-button" onClick={() => setQuery({ ...query, page: 1 })}>Back to first page</button>}
          </>}
        </section>
        <p className="pth-footnote">Questions about a recorded treatment? Please contact the clinic.</p>
      </main>
      {selected && <dialog ref={dialog} className="pth-dialog" aria-labelledby="pth-detail-title" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="pth-dialog-heading"><h2 id="pth-detail-title">Treatment Details</h2><button type="button" className="pth-button" aria-label="Close treatment details" onClick={() => dialog.current.close()} autoFocus>Close</button></div>
        <dl><div><dt>Procedure</dt><dd>{selected.procedure_name}</dd></div><div><dt>Treatment date</dt><dd>{formatClinicDateTime(selected.treated_at)}</dd></div><div><dt>Tooth / Teeth</dt><dd>{teethLabel(selected)}</dd></div><div><dt>Treating dentist</dt><dd>{selected.doctor_name === 'Not recorded' ? selected.doctor_name : `Dr. ${selected.doctor_name}`}</dd></div><div><dt>Remarks / Aftercare</dt><dd className="pth-remarks">{selected.patient_remarks.trim() || 'No remarks recorded.'}</dd></div></dl>
        <p>For corrections or further information, please contact the clinic.</p>
      </dialog>}
    </div>
  );
}

export default function TreatmentHistory() {
  const { user, userType, userDetails, loading, signOut } = useAuth();
  if (loading || !user || userType !== 'patient' || userDetails?.status !== 'active' || !userDetails.patient_id) return null;
  // A different account gets fresh state and cannot see a previous patient's page or dialog.
  return <HistoryContent key={`${user.id}:${userDetails.patient_id}`} patientId={userDetails.patient_id} patientName={userDetails.first_name || 'Patient'} signOut={signOut} />;
}
