import React, { useState } from 'react';
import { getReportTables } from '../../services/clinicReports';

const ReportTable = ({ table }) => {
  const [page, setPage] = useState(1);
  const pageSize = 20, pages = Math.max(1, Math.ceil(table.rows.length / pageSize));
  return <section className="reports-table-section" aria-label={table.title}>
    <h3>{table.title}</h3>
    <div className="reports-table-scroll" tabIndex={0} aria-label={`${table.title} table`}>
      <table className="reports-table"><thead><tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{table.rows.length ? table.rows.slice((page - 1) * pageSize, page * pageSize).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)
          : <tr><td colSpan={table.columns.length} className="reports-empty">No matching records.</td></tr>}</tbody>
      </table>
    </div>
    {pages > 1 && <nav className="reports-pagination" aria-label={`${table.title} pages`}>
      <button type="button" onClick={() => setPage(current => current - 1)} disabled={page === 1}>Previous</button>
      <span>Page {page} of {pages} · {table.rows.length} rows</span>
      <button type="button" onClick={() => setPage(current => current + 1)} disabled={page === pages}>Next</button>
    </nav>}
  </section>;
};

const ReportSections = ({ report }) => <>
  {getReportTables(report).map(table => (
    <ReportTable key={`${report.generatedAt}:${table.title}`} table={table} />
  ))}
</>;

export const downloadReportPDF = async (report, chartImages = [], options = {}) => {
  const { downloadClinicReportPDF } = await import('../../services/clinicReportPdf');
  return downloadClinicReportPDF(report, chartImages, options);
};

export default ReportSections;
