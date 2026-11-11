import jsPDF from 'jspdf';
import fontURL from '../assets/fonts/DejaVuSans.ttf';
import logoURL from '../assets/DentalLogo.png';
import { formatClinicDateTime } from '../utils/clinicScheduling';

import { CLINIC_NAME } from './clinicDetails';
export { CLINIC_NAME } from './clinicDetails';
export const CLINIC_PDF_STYLE = { margin: 13, width: 271, bottom: 190, line: 4.2, padding: 2.4, ink: [24, 47, 73], navy: [8, 38, 90], blue: [0, 105, 168], border: [203, 220, 233], tint: [227, 242, 252], mist: [240, 246, 251] };
export const clinicPdfText = value => String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
const asBase64 = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
let assetsPromise;
export const loadClinicPdfAssets = () => {
  if (!assetsPromise) assetsPromise = Promise.all([fontURL, logoURL].map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load the print layout. Please try again.');
    return new Uint8Array(await response.arrayBuffer());
  })).then(([font, logo]) => ({ font, logo })).catch(error => { assetsPromise = null; throw error; });
  return assetsPromise;
};
export const createClinicPdf = (assets, { orientation = 'landscape' } = {}) => {
  if (!assets?.font?.length || !assets?.logo?.length) throw new Error('Could not prepare the clinic PDF layout. Please retry.');
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', putOnlyUsedFonts: true, compress: true });
  pdf.addFileToVFS('DejaVuSans.ttf', asBase64(assets.font)); pdf.addFont('DejaVuSans.ttf', 'ClinicPrint', 'normal');
  return pdf;
};
export const setClinicPdfBody = (pdf, size) => { pdf.setFont('ClinicPrint', 'normal'); pdf.setFontSize(size); pdf.setTextColor(...CLINIC_PDF_STYLE.ink); };
export const wrapClinicPdfText = (pdf, value, width) => {
  const valueText = clinicPdfText(value), font = pdf.getFont().metadata;
  if ([...valueText].some(char => !/\s/.test(char) && (!font.characterToGlyph(char.codePointAt(0)) || char.codePointAt(0) > 65535))) throw new Error('A name or remark contains a character unsupported by the print font. No incomplete printout was generated.');
  return pdf.splitTextToSize(valueText, width);
};
// Both treatment records and reports use this exact branded A4 document shell.
export const drawClinicPdfHeader = (pdf, assets, { title, generatedAt, dateLabel = 'Generated', first = true, continuedDetails = '' }) => {
  const { margin: M, width: W } = CLINIC_PDF_STYLE;
  pdf.setDrawColor(...CLINIC_PDF_STYLE.blue); pdf.setLineWidth(.5);
  if (first) {
    const logo = pdf.getImageProperties(assets.logo), logoWidth = 45;
    pdf.addImage(assets.logo, 'PNG', M, 13, logoWidth, logoWidth * logo.height / logo.width);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...CLINIC_PDF_STYLE.navy); pdf.text(title, M + W, 20, { align: 'right' });
    setClinicPdfBody(pdf, 9); pdf.text(CLINIC_NAME, M + W, 27, { align: 'right' });
    pdf.text(`${dateLabel}: ${formatClinicDateTime(generatedAt)} (Philippines)`, M + W, 33, { align: 'right' });
    pdf.line(M, 39, M + W, 39);
    return 47;
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...CLINIC_PDF_STYLE.navy); pdf.text(`${title} - CONTINUED`, M, 18);
  setClinicPdfBody(pdf, 8.5); const lines = wrapClinicPdfText(pdf, continuedDetails, W); pdf.text(lines, M, 24);
  return 24 + lines.length * 4.5 + 5;
};
export const drawClinicPdfFooters = (pdf, { leftLabel, confidentialLabel = 'Confidential clinic report' }) => {
  const { margin: M, width: W } = CLINIC_PDF_STYLE, count = pdf.getNumberOfPages();
  setClinicPdfBody(pdf, 7.5); let label = clinicPdfText(leftLabel);
  while (pdf.getTextWidth(label) > 147 && label.length > 1) label = label.slice(0, -2);
  for (let page = 1; page <= count; page++) {
    pdf.setPage(page); pdf.setDrawColor(...CLINIC_PDF_STYLE.border); pdf.line(M, 197, M + W, 197); setClinicPdfBody(pdf, 7.5);
    pdf.text(label, M, 203); pdf.text(confidentialLabel, 207, 203, { align: 'right' }); pdf.text(`Page ${page} of ${count}`, M + W, 203, { align: 'right' });
  }
};
