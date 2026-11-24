import { REPORT_TYPES, formatReportDate, getReportTables } from './clinicReports';
import { CLINIC_NAME, CLINIC_PDF_STYLE, clinicPdfText, createClinicPdf, setClinicPdfBody, wrapClinicPdfText, drawClinicPdfHeader, drawClinicPdfFooters, loadClinicPdfAssets } from './clinicPdfLayout';

export const createClinicReportPDF = (report, chartImages = [], assets) => {
  if (!report || !Object.hasOwn(REPORT_TYPES, report.filters?.reportType) || !Array.isArray(report.summary) || !Array.isArray(report.notes) || !Array.isArray(report.charts) || !Array.isArray(report.tables)) throw new Error('Generate a valid report before downloading its PDF.');
  const pdf = createClinicPdf(assets), style = CLINIC_PDF_STYLE;
  const { margin: M, width: W, bottom, line, padding } = style;
  const title = REPORT_TYPES[report.filters.reportType], inventory = report.filters.reportType === 'inventory';
  const period = inventory ? 'Current active inventory snapshot' : report.filters.allTime ? 'All records' : `${formatReportDate(report.filters.startDate)} – ${formatReportDate(report.filters.endDate)}`;
  const body = size => setClinicPdfBody(pdf, size), wrap = (value, width) => wrapClinicPdfText(pdf, value, width);
  let y = drawClinicPdfHeader(pdf, assets, { title: title.toUpperCase(), generatedAt: report.generatedAt });
  const nextPage = () => { pdf.addPage(); y = drawClinicPdfHeader(pdf, assets, { title: title.toUpperCase(), generatedAt: report.generatedAt, first: false, continuedDetails: period }); };
  const drawTable = table => {
    const columns = table.columns;
    if (!columns.length) return;
    const textColumn = label => /summary|patient$|dentist$|service$|item$|category|remarks|age group/i.test(label);
    const dateColumn = label => /^(appointment date|latest payment date|date|created|booked on|first in period|last in period)$/i.test(label);
    const weights = columns.map(label => textColumn(label) ? (/remarks/i.test(label) ? 3.2 : 2.5) : dateColumn(label) ? 1.7 : /method|status|unit$/i.test(label) ? 1.5 : 1.3);
    const totalWeight = weights.reduce((a, b) => a + b, 0), widths = weights.map(weight => W * weight / totalWeight);
    const right = columns.map(label => !textColumn(label) && !dateColumn(label) && !/method|status|unit$/i.test(label));
    const header = continued => {
      body(11); pdf.setTextColor(...style.navy); const titleLines = wrap(`${table.title}${continued ? ' (continued)' : ''}`, W);
      pdf.text(titleLines, M, y); y += titleLines.length * 5 + 3;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5);
      const headings = columns.map((label, index) => pdf.splitTextToSize(clinicPdfText(label).replaceAll('¹', ' (1)'), widths[index] - padding * 2));
      const height = Math.max(13, Math.max(...headings.map(cell => cell.length)) * line + 5);
      pdf.setFillColor(...style.tint); pdf.rect(M, y, W, height, 'F'); let x = M;
      for (const [index, cell] of headings.entries()) { pdf.text(cell, x + padding, y + 5, { lineHeightFactor: 1.4 }); x += widths[index]; }
      y += height; body(8.5);
    };
    if (y + 38 > bottom) nextPage(); header(false);
    if (!table.rows.length) { body(9); pdf.text('No matching records.', M + padding, y + 8); y += 18; }
    for (const [rowIndex, row] of table.rows.entries()) {
      body(8.5); const cells = columns.map((column, index) => wrap(row[index], widths[index] - padding * 2)), length = Math.max(1, ...cells.map(cell => cell.length));
      let offset = 0;
      while (offset < length) {
        const remaining = (length - offset) * line + padding * 2;
        if (y + (remaining <= 112 ? remaining : 30) > bottom) { nextPage(); header(true); }
        const capacity = Math.floor((bottom - y - padding * 2) / line);
        if (capacity < 1) { nextPage(); header(true); continue; }
        const take = Math.min(capacity, length - offset), height = take * line + padding * 2;
        pdf.setDrawColor(...style.border); pdf.setLineWidth(.18); let x = M;
        for (const [index, cell] of cells.entries()) {
          pdf.rect(x, y, widths[index], height); const lines = cell.slice(offset, offset + take);
          if (offset > 0 && index === 0 && !lines.length) lines.push(`#${rowIndex + 1} cont.`);
          if (lines.length) pdf.text(lines, right[index] ? x + widths[index] - padding : x + padding, y + padding + 3, { align: right[index] ? 'right' : 'left', lineHeightFactor: 1.4 });
          x += widths[index];
        }
        y += height; offset += take;
        if (offset < length) { nextPage(); header(true); }
      }
    }
    y += 10;
  };
  getReportTables(report).forEach(drawTable);
  drawClinicPdfFooters(pdf, { leftLabel: `${title} | ${inventory ? 'Current snapshot' : period}` });
  pdf.setProperties({ title: `Diolata - ${title}`, author: CLINIC_NAME, subject: 'Confidential clinic operations report' });
  return pdf;
};

export const downloadClinicReportPDF = async (report, chartImages = [], { isCurrent = () => true } = {}) => {
  if (!isCurrent()) return null;
  const assets = await loadClinicPdfAssets();
  if (!isCurrent()) return null;
  const pdf = createClinicReportPDF(report, chartImages, assets);
  if (!isCurrent()) return null;
  const period = report.filters.reportType === 'inventory' ? report.generatedAt.slice(0, 10) : report.filters.allTime ? 'all_records' : `${report.filters.startDate}_to_${report.filters.endDate}`;
  pdf.save(`Diolata_${report.filters.reportType}_${period}.pdf`);
  return pdf;
};
