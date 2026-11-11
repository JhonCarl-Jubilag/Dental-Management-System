import { formatClinicDateTime, getClinicDate } from '../utils/clinicScheduling';
import { CLINIC_NAME, CLINIC_PDF_STYLE, clinicPdfText, createClinicPdf, setClinicPdfBody, wrapClinicPdfText, drawClinicPdfHeader, drawClinicPdfFooters } from './clinicPdfLayout';
export { loadClinicPdfAssets as loadTreatmentPrintAssets } from './clinicPdfLayout';

const text = clinicPdfText;
const money = cents => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = value => {
  const n = Number(value), result = Math.round(n * 100);
  if (value == null || !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(result)) throw new Error('A treatment has an invalid billing amount. Review Billing before printing.');
  return result;
};
const patientAge = (patient, printedAt) => {
  const today = getClinicDate(printedAt), birthday = patient.birthday;
  if (/^\d{4}-\d{2}-\d{2}$/.test(birthday || '') && birthday <= today) {
    return Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0);
  }
  return patient.age != null && Number.isInteger(Number(patient.age)) && Number(patient.age) >= 0 ? Number(patient.age) : 'Not recorded';
};

// Native PDF text gives A4 dimensions, exact page numbers and repeatable table
// headers independently of browser CSS or the on-screen ten-row pagination.
export const createPatientTreatmentPDF = ({ patient, rows, assets, printedAt = new Date() }) => {
  if (!patient?.patient_id || !Array.isArray(rows) || !assets?.font?.length || !assets?.logo?.length) throw new Error('Could not prepare this patient’s printout. Refresh the patient record.');
  const name = text([patient.first_name, patient.last_name].filter(Boolean).join(' ')) || 'Patient';
  const pdf = createClinicPdf(assets);
  const { margin: M, width: W, bottom, line, padding } = CLINIC_PDF_STYLE;
  const widths = [29, 18, 64, 30, 29, 29, 72];
  const headings = ['Treatment Date', 'Tooth No.', 'Procedure / Dentist', 'Amount Charged', 'Amount Paid', 'Balance', 'Notes / Remarks'];
  let y = 0;
  const setBody = size => setClinicPdfBody(pdf, size);
  const wrap = (value, width) => wrapClinicPdfText(pdf, value, width);
  const footerName = () => {
    setBody(7.5);
    let displayName = name;
    while (pdf.getTextWidth(`${displayName} | Patient ID: ${patient.patient_id}`) > 147 && displayName.length > 1) displayName = displayName.slice(0, -2);
    return `${displayName}${displayName !== name ? '…' : ''} | Patient ID: ${patient.patient_id}`;
  };
  const pageHeader = first => {
    y = drawClinicPdfHeader(pdf, assets, { title: 'PATIENT TREATMENT RECORD', generatedAt: printedAt, dateLabel: 'Printed', first, continuedDetails: name + ' | Patient ID: ' + patient.patient_id });
    if (first) {
      setBody(12); const lines = wrap(name, W); pdf.text(lines, M, y); y += (lines.length - 1) * 5.5 + 7;
      setBody(9);
      const details = ['Patient ID: ' + patient.patient_id, 'Birthday: ' + (patient.birthday || 'Not recorded'), 'Age: ' + patientAge(patient, printedAt), 'Contact: ' + (patient.contact_no || 'Not recorded')].join('    |    ');
      const detailsLines = wrap(details, W); pdf.text(detailsLines, M, y); y += detailsLines.length * 4.8 + 7;
    }
  };
  const tableHeader = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(8, 38, 90);
    pdf.setFillColor(227, 242, 252); pdf.rect(M, y, W, 13, 'F');
    let x = M;
    headings.forEach((heading, index) => { pdf.text(pdf.splitTextToSize(heading, widths[index] - padding * 2), x + padding, y + 5); x += widths[index]; });
    y += 13; setBody(8.5);
  };
  const nextPage = withHeader => { pdf.addPage(); pageHeader(false); if (withHeader) tableHeader(); };
  pageHeader(true); tableHeader();
  const totals = [0, 0, 0], ids = new Set(), bills = new Set();
  rows.forEach(row => {
    if (String(row.patient_id) !== String(patient.patient_id) || ids.has(String(row.treatment_id)) || bills.has(String(row.billing_id))) throw new Error('Could not verify patient and billing links for printing.');
    ids.add(String(row.treatment_id)); bills.add(String(row.billing_id));
    const amounts = [row.amount_charged, row.amount_paid, row.balance].map(cents);
    if (amounts[0] - amounts[1] !== amounts[2]) throw new Error('Billing totals are inconsistent. Refresh Billing before printing.');
    amounts.forEach((amount, i) => { totals[i] += amount; if (!Number.isSafeInteger(totals[i])) throw new Error('The print totals exceed the supported amount.'); });
    setBody(8.5);
    const values = [formatClinicDateTime(row.treated_at), row.tooth_scope === 'specific' ? row.tooth_numbers.join(', ') : row.tooth_scope === 'whole_mouth' ? 'Whole mouth' : 'Not tooth-specific', `${row.procedure_name}\nDr. ${row.doctor_name || 'Not recorded'}\nAppointment #${row.appointment_id}`, ...amounts.map(money), row.notes || '—'];
    const cells = values.map((value, i) => wrap(value, widths[i] - padding * 2)), length = Math.max(...cells.map(cell => cell.length));
    let offset = 0;
    while (offset < length) {
      const fullHeight = (length - offset) * line + padding * 2;
      // Move ordinary rows intact; exceptionally long remarks continue across pages.
      if (y + (fullHeight <= 125 ? fullHeight : 30) > bottom) nextPage(true);
      const capacity = Math.floor((bottom - y - padding * 2) / line);
      if (capacity < 1) { nextPage(true); continue; }
      const take = Math.min(capacity, length - offset), height = take * line + padding * 2;
      pdf.setDrawColor(203, 220, 233); pdf.setLineWidth(.18); let x = M;
      for (const [index, cell] of cells.entries()) {
        pdf.rect(x, y, widths[index], height);
        const content = cell.slice(offset, offset + take);
        if (offset > 0 && index === 2 && !content.length) content.push(`#${row.appointment_id} (continued)`);
        if (content.length) pdf.text(content, index >= 3 && index <= 5 ? x + widths[index] - padding : x + padding, y + padding + 3, { align: index >= 3 && index <= 5 ? 'right' : 'left', lineHeightFactor: 1.4 });
        x += widths[index];
      }
      y += height; offset += take;
      if (offset < length) nextPage(true);
    }
  });
  if (!rows.length) { setBody(10); pdf.text('No treatment records have been entered for this patient.', M + padding, y + 9); y += 17; }
  if (y + 34 > bottom) nextPage(false);
  y += 7;
  const start = M + W - 168, boxWidth = 56;
  ['Total Charged', 'Total Paid', 'Outstanding Balance'].forEach((label, index) => {
    pdf.setFillColor(240, 246, 251); pdf.rect(start + index * boxWidth, y, boxWidth, 20, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(8, 38, 90); pdf.text(label, start + index * boxWidth + 3, y + 6);
    setBody(11); pdf.text(money(totals[index]), start + (index + 1) * boxWidth - 3, y + 14, { align: 'right' });
  });
  y += 27; setBody(8); pdf.text('Payment amounts reflect the linked bills at the time of printing. Charges are after discounts.', M, y);
  drawClinicPdfFooters(pdf, { leftLabel: footerName(), confidentialLabel: 'Confidential patient record' });
  pdf.setProperties({ title: `Patient ${patient.patient_id} - Treatment Record`, author: CLINIC_NAME, subject: 'Confidential patient treatment record' });
  return pdf;
};

export const displayTreatmentPrint = (pdf, printWindow) => {
  pdf.autoPrint();
  const url = URL.createObjectURL(pdf.output('blob'));
  try { printWindow.location.replace(url); } catch (error) { URL.revokeObjectURL(url); throw error; }
  const monitor = window.setInterval(() => { if (printWindow.closed) { URL.revokeObjectURL(url); window.clearInterval(monitor); } }, 5000);
};
