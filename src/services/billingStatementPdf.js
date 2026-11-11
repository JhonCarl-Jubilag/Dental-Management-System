import { CLINIC_ADDRESS, CLINIC_EMAIL, CLINIC_NAME, CLINIC_PHONE } from './clinicDetails';
import { CLINIC_PDF_STYLE, createClinicPdf, setClinicPdfBody, wrapClinicPdfText } from './clinicPdfLayout';
import { formatStatementMoney, STATEMENT_FOOTNOTE, STATEMENT_PAYMENT_NOTE } from './billingStatement';
import { formatClinicDateTime } from '../utils/clinicScheduling';

export const createBillingStatementPDF = (statement, assets) => {
  if (!statement || ![statement.gross, statement.discount, statement.net, statement.paid, statement.balance].every(value => Number.isSafeInteger(value) && value >= 0)
    || statement.gross - statement.discount !== statement.net || statement.net - statement.paid !== statement.balance) throw new Error('Could not verify the billing statement totals. Refresh Billing.');
  const pdf = createClinicPdf(assets, { orientation: 'portrait' }), style = CLINIC_PDF_STYLE;
  const M = 14, W = 182, end = M + W, bottom = 270, step = 4.6;
  const body = size => setClinicPdfBody(pdf, size), wrap = (value, width) => wrapClinicPdfText(pdf, value, width);
  let y;
  const nextPage = () => {
    pdf.addPage(); body(11); pdf.setTextColor(...style.navy); pdf.text('BILLING STATEMENT - CONTINUED', M, 18);
    body(8.5); pdf.text(statement.number, end, 18, { align: 'right' });
    pdf.text(`Patient ID: ${statement.patientId}    |    Appointment #${statement.appointmentId}`, M, 25);
    pdf.setDrawColor(...style.blue); pdf.setLineWidth(.5); pdf.line(M, 32, end, 32); y = 41;
  };
  const paragraph = (value, size = 9, gap = 3) => {
    body(size); const lines = wrap(value, W);
    for (const line of lines) { if (y + step > bottom) nextPage(); body(size); pdf.text(line, M, y); y += step; }
    y += gap;
  };
  const heading = value => {
    if (y + 22 > bottom) nextPage();
    body(10); pdf.setTextColor(...style.navy); pdf.text(value, M, y); y += 8;
  };
  const detail = (label, value) => {
    body(9); const lines = wrap(value, W - 37);
    for (let index = 0; index < lines.length; index++) {
      if (y + step > bottom) nextPage(); body(9);
      if (index === 0) { pdf.setTextColor(...style.navy); pdf.text(label, M, y); }
      body(9); pdf.text(lines[index], M + 37, y); y += step;
    }
    y += 2;
  };
  const logo = pdf.getImageProperties(assets.logo); pdf.addImage(assets.logo, 'PNG', M, 14, 45, 45 * logo.height / logo.width);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...style.navy); pdf.text('BILLING STATEMENT', end, 21, { align: 'right' });
  body(9); pdf.text(statement.number, end, 28, { align: 'right' }); pdf.text(`Bill issued: ${statement.issuedDate}`, end, 34, { align: 'right' });
  body(8); pdf.text(`Generated: ${formatClinicDateTime(statement.generatedAt)}`, end, 40, { align: 'right' });
  body(8.5); const address = wrap(CLINIC_ADDRESS, 105); pdf.text(address, M, 36, { lineHeightFactor: 1.4 });
  y = Math.max(45, 36 + address.length * 4.2 + 3);
  body(8.5); pdf.text(`${CLINIC_PHONE}  |  ${CLINIC_EMAIL}`, M, y); y += 8;
  pdf.setDrawColor(...style.blue); pdf.setLineWidth(.5); pdf.line(M, y, end, y); y += 10;
  paragraph(`Status: ${statement.status.label}${statement.archived ? '  |  Archived bill' : ''}`, 10, 4);
  heading('Patient & appointment');
  detail('Patient', statement.patientName); detail('Patient ID', String(statement.patientId));
  detail('Appointment', `#${statement.appointmentId}  |  ${statement.appointmentDate} (Philippines)`);
  detail('Dentist', statement.dentistName); y += 4;
  const tableHeader = () => {
    pdf.setFillColor(...style.tint); pdf.rect(M, y, W, 11, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...style.navy); pdf.text('Description', M + 3, y + 7); pdf.text('Amount', end - 3, y + 7, { align: 'right' }); y += 11;
  };
  if (y + 35 > bottom) nextPage(); tableHeader();
  const values = [[statement.procedure, formatStatementMoney(statement.gross)], ['Discount', `-${formatStatementMoney(statement.discount)}`], ['Net amount charged', formatStatementMoney(statement.net)], ['Total paid to date', formatStatementMoney(statement.paid)], ['Remaining balance', formatStatementMoney(statement.balance)]];
  for (const [index, row] of values.entries()) {
    body(9); const lines = wrap(row[0], W - 54); let offset = 0;
    while (offset < lines.length) {
      const remaining = (lines.length - offset) * step + 6;
      if (y + (remaining <= 100 ? remaining : 25) > bottom) { nextPage(); tableHeader(); }
      const capacity = Math.floor((bottom - y - 6) / step);
      if (capacity < 1) { nextPage(); tableHeader(); continue; }
      const take = Math.min(capacity, lines.length - offset), height = Math.max(11, take * step + 6);
      if (index >= 2) { pdf.setFillColor(...(index === 4 ? style.tint : style.mist)); pdf.rect(M, y, W, height, 'F'); }
      pdf.setDrawColor(...style.border); pdf.setLineWidth(.18); pdf.rect(M, y, W, height); pdf.line(end - 48, y, end - 48, y + height);
      body(9); pdf.text(lines.slice(offset, offset + take), M + 3, y + 6, { lineHeightFactor: 1.45 });
      if (offset === 0) { body(index === 4 ? 10 : 9); pdf.text(row[1], end - 3, y + 6, { align: 'right' }); }
      y += height; offset += take;
    }
  }
  y += 11;
  if (statement.latestPayment) {
    heading('Latest recorded payment details'); paragraph(STATEMENT_PAYMENT_NOTE, 8.5, 4);
    detail('Method', statement.latestPayment.method); detail('Payment date', statement.latestPayment.date);
    if (statement.latestPayment.reference != null) detail('Reference', statement.latestPayment.reference);
  } else paragraph('No payment has been recorded against this bill.', 9, 4);
  y += 3; paragraph(STATEMENT_FOOTNOTE, 8.5, 5); paragraph(`Thank you for choosing ${CLINIC_NAME}!`, 9);
  const count = pdf.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    pdf.setPage(page); pdf.setDrawColor(...style.border); pdf.line(M, 279, end, 279); body(7.5);
    pdf.text(`${statement.number} | Patient ID: ${statement.patientId}`, M, 285); pdf.text(`Page ${page} of ${count}`, end, 285, { align: 'right' });
    pdf.text('Confidential billing statement', M, 290);
  }
  pdf.setProperties({ title: `${statement.number} - Billing Statement`, author: CLINIC_NAME, subject: 'Patient billing summary' });
  return pdf;
};
export const downloadBillingStatementPDF = (pdf, statement) => pdf.save(`Diolata_${statement.number}_${statement.generatedAt.slice(0, 10)}.pdf`);
export const printBillingStatementPDF = (pdf, target) => {
  pdf.autoPrint(); const url = URL.createObjectURL(pdf.output('blob'));
  try { target.location.replace(url); } catch (error) { URL.revokeObjectURL(url); throw error; }
  const monitor = window.setInterval(() => { if (target.closed) { URL.revokeObjectURL(url); window.clearInterval(monitor); } }, 5000);
};
