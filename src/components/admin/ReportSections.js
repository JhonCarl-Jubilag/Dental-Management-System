import React, { useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { REPORT_TYPES, formatReportCurrency, formatReportDate } from '../../services/clinicReports';
import { CLINIC_TIME_ZONE } from '../../utils/clinicScheduling';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);
const generatedLabel = report => new Date(report.generatedAt).toLocaleString('en-PH', { timeZone: CLINIC_TIME_ZONE });
const scopeLabel = report => report.filters.reportType === 'inventory' ? 'Current active inventory snapshot'
  : `${formatReportDate(report.filters.startDate)} – ${formatReportDate(report.filters.endDate)} · ${report.doctorLabel} · ${report.serviceLabel}`;

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
      <span>Page {page} of {pages} · {table.rows.length} rows · PDF includes all rows</span>
      <button type="button" onClick={() => setPage(current => current + 1)} disabled={page === pages}>Next</button>
    </nav>}
  </section>;
};

const ReportSections = ({ report }) => <>
  <div className="reports-document-heading">
    <span className="reports-eyebrow">Diolata Dental Clinic</span>
    <h2>{REPORT_TYPES[report.filters.reportType]}</h2>
    <p>{scopeLabel(report)}</p><p>Generated {generatedLabel(report)} · Asia/Manila</p>
  </div>
  <div className="reports-summary">{report.summary.map(card => <div className="reports-summary-card" key={card.label}>
    <span>{card.label}</span><strong>{card.money ? formatReportCurrency(card.value) : card.value}</strong>
  </div>)}</div>
  <aside className="reports-definitions" aria-label="How to read this report">{report.notes.map(note => <p key={note}>{note}</p>)}</aside>
  {report.charts.length > 0 && <div className="reports-charts">{report.charts.map(chart => <section className="reports-chart-card" key={chart.title}>
    <h3>{chart.title}</h3>
    {chart.labels.length ? <div className="reports-chart" style={{ height: Math.max(250, chart.labels.length * 30) }}>
      <Bar role="img" aria-label={chart.title} data={{ labels: chart.labels, datasets: [{ label: chart.money ? 'Amount (PHP)' : 'Count', data: chart.values, backgroundColor: '#0069a8', borderRadius: 4 }] }} options={{
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => chart.money ? formatReportCurrency(context.parsed.x) : String(context.parsed.x) } } },
        scales: { x: { beginAtZero: true, ticks: chart.money ? { callback: value => `PHP ${Number(value).toLocaleString('en-PH')}` } : { precision: 0 } }, y: { ticks: { autoSkip: false, font: { size: 11 }, callback: function (value) {
          const label = this.getLabelForValue(value);
          return label.length > 18 ? `${label.slice(0, 16)}…` : label;
        } } } },
      }} />
    </div> : <p className="reports-empty">No matching records.</p>}
  </section>)}</div>}
  {report.tables.map(table => <ReportTable key={`${report.generatedAt}:${table.title}`} table={table} />)}
</>;

// Export source data with selectable text and full tables, independently of UI pagination.
export const downloadReportPDF = async (report, chartImages = [], options = {}) => {
  const { downloadClinicReportPDF } = await import('../../services/clinicReportPdf');
  return downloadClinicReportPDF(report, chartImages, options);
};

export default ReportSections;
