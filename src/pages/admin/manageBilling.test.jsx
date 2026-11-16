import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'react-toastify';
import ManageBilling from './manageBilling';
import BillingStatement from '../../components/admin/BillingStatement';
import { supabase } from '../../services/supabase';
import { BILLING_STATEMENT_FIELDS, buildBillingStatement } from '../../services/billingStatement';
import { createBillingStatementPDF } from '../../services/billingStatementPdf';
import { createClinicPdf } from '../../services/clinicPdfLayout';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner', email: 'owner@example.invalid' }, userType: 'super_admin', loading: false }),
}));
jest.mock('../../services/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../components/admin/Sidebar', () => () => null);
jest.mock('../../services/appointmentCompletion', () => ({
  completeFinishedAppointments: async () => 0,
  completePaidAppointment: async () => {},
}));
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warn: jest.fn() },
  ToastContainer: () => null,
}));
jest.mock('../../services/clinicPdfLayout', () => ({
  CLINIC_PDF_STYLE: { navy: [11, 40, 71], blue: [8, 119, 172], tint: [240, 246, 250], mist: [246, 248, 250], border: [220, 225, 230] },
  createClinicPdf: jest.fn(),
  setClinicPdfBody: jest.fn(),
  wrapClinicPdfText: (_pdf, value) => [String(value)],
}));

const service = { service_id: 4, service_name: 'Light-Cured Restoration', price: 1200, description: 'Tooth restoration.' };
const patient = { patient_id: 1, first_name: 'Sample', last_name: 'Patient' };
const doctor = { doctor_id: 7, first_name: 'Sample', last_name: 'Dentist' };
const appointment = {
  appointment_id: 9, patient_id: 1, doctor_id: 7, appointment_datetime: '2026-11-12T02:00:00Z',
  status: 'completed', patients: patient, doctors: doctor, services: service,
};
const makeBill = overrides => ({
  billing_id: 12, appointment_id: 9, patient_id: 1, doctor_id: 7,
  total_amount: 4000, discount: 0, discount_id_no: null, amount_paid: 1000, balance: 3000,
  payment_method: 'cash', reference_number: null, payment_date: '2026-11-12',
  created_at: '2026-11-12T03:00:00Z', remarks: '', archived: false,
  patients: patient, doctors: doctor, appointments: appointment, ...overrides,
});
let bills;
let appointments;
let inserted;
let updated;

beforeEach(() => {
  jest.clearAllMocks();
  bills = [];
  appointments = [{ ...appointment, services: { ...service } }];
  inserted = [];
  updated = [];
  supabase.from.mockImplementation(table => {
    const filters = [];
    let operation = 'read', payload, single = false, executed;
    const query = {
      select: () => query,
      eq: (field, value) => { filters.push(row => row[field] === value || String(row[field]) === String(value)); return query; },
      is: (field, value) => { filters.push(row => (row[field] ?? null) === value); return query; },
      in: (field, values) => { filters.push(row => values.includes(row[field])); return query; },
      not: (field, _operator, value) => {
        const values = value.replace(/[()]/g, '').split(',');
        filters.push(row => !values.includes(String(row[field])));
        return query;
      },
      order: () => query, or: () => query, gte: () => query, lte: () => query,
      single: () => { single = true; return query; },
      maybeSingle: () => { single = true; return query; },
      insert: values => { operation = 'insert'; payload = values; return query; },
      update: values => { operation = 'update'; payload = values; return query; },
      then: (resolve, reject) => {
        if (!executed) executed = Promise.resolve().then(() => {
          let rows = (table === 'billing' ? bills : table === 'appointments' ? appointments : []).filter(row => filters.every(filter => filter(row)));
          if (operation === 'insert') {
            inserted.push(payload);
            const saved = { ...makeBill(payload), billing_id: 13 };
            bills.push(saved);
            rows = [saved];
          }
          if (operation === 'update') {
            updated.push({ payload, matched: rows.length });
            rows.forEach(row => Object.assign(row, payload));
          }
          return { data: single ? rows[0] || null : rows, error: null };
        });
        return executed.then(resolve, reject);
      },
    };
    return query;
  });
});

const openCreateBill = async (standard = 1200) => {
  render(<ManageBilling />);
  await screen.findByRole('button', { name: 'Create Bill', exact: true });
  await waitFor(() => expect(screen.queryByText('Loading billing records…')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Create Bill', exact: true }));
  await screen.findByRole('heading', { name: 'Create New Billing' });
  fireEvent.change(screen.getByLabelText('Select Appointment *'), { target: { value: '9' } });
  await waitFor(() => expect(screen.getByLabelText('Agreed treatment charge (₱)')).toHaveValue(standard));
};
const submitForm = input => fireEvent.submit(input.closest('form'));
const changeCharge = value => fireEvent.change(screen.getByLabelText('Agreed treatment charge (₱)'), { target: { value } });

test('creates a bill using the agreed charge and discount while retaining the standard reference', async () => {
  await openCreateBill();
  expect(screen.getByLabelText(/Current standard price/)).toHaveValue('₱1,200.00');
  expect(screen.getByLabelText(/Current standard price/)).toHaveAttribute('readonly');
  changeCharge('4000');
  expect(screen.getByLabelText('Amount Paid (₱)')).toHaveValue(1200);
  fireEvent.change(screen.getByLabelText('Amount Paid (₱)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Discount Type'), { target: { value: 'manual' } });
  fireEvent.change(screen.getByLabelText('Discount Amount (₱)'), { target: { value: '100' } });
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(inserted).toHaveLength(1));
  expect(inserted[0]).toMatchObject({ total_amount: 4000, discount: 100, amount_paid: 1000, balance: 2900 });
  expect(service.price).toBe(1200);
  expect(supabase.from.mock.calls.some(([table]) => table === 'services')).toBe(false);
});

test.each(['', '-1', '1200.001'])('rejects the invalid agreed charge %s before saving', async value => {
  await openCreateBill();
  changeCharge(value);
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('valid amounts')));
  expect(inserted).toHaveLength(0);
});

test('uses the agreed net charge for the existing full-payment threshold', async () => {
  appointments[0].services.price = 5000;
  await openCreateBill(5000);
  changeCharge('2500');
  fireEvent.change(screen.getByLabelText('Amount Paid (₱)'), { target: { value: '1000' } });
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('full payment')));
  expect(inserted).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Amount Paid (₱)'), { target: { value: '2500' } });
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(inserted).toHaveLength(1));
  expect(inserted[0]).toMatchObject({ total_amount: 2500, amount_paid: 2500, balance: 0 });
});

test('blocks a discount that exceeds the agreed charge instead of silently ignoring it', async () => {
  await openCreateBill();
  fireEvent.change(screen.getByLabelText('Discount Type'), { target: { value: 'manual' } });
  fireEvent.change(screen.getByLabelText('Discount Amount (₱)'), { target: { value: '1300' } });
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot exceed')));
  expect(inserted).toHaveLength(0);
});

test('edits a charge while retaining the saved manual discount and recorded payment', async () => {
  bills = [makeBill({ discount: 200, balance: 2800 })];
  render(<ManageBilling />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Discount Amount (₱)')).toHaveValue(200));
  changeCharge('4500');
  expect(screen.getByLabelText('Amount Paid (₱)')).toHaveValue(1000);
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(updated).toHaveLength(1));
  expect(updated[0]).toMatchObject({ matched: 1, payload: { total_amount: 4500, discount: 200, amount_paid: 1000, balance: 3300 } });
});

test('blocks a charge below the payment already recorded', async () => {
  bills = [makeBill({ total_amount: 4000, amount_paid: 3500, balance: 500 })];
  render(<ManageBilling />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  changeCharge('3000');
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('cannot exceed')));
  expect(updated).toHaveLength(0);
});

test('rejects a stale edit when another payment was saved after the form opened', async () => {
  bills = [makeBill()];
  render(<ManageBilling />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit', exact: true }));
  changeCharge('5000');
  bills[0] = { ...bills[0], amount_paid: 2000, balance: 2000 };
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('changed')));
  expect(updated[0].matched).toBe(0);
  expect(bills[0]).toMatchObject({ total_amount: 4000, amount_paid: 2000, balance: 2000 });
});

test('records a partial payment from the saved bill amount even when the standard price is lower', async () => {
  bills = [makeBill()];
  render(<ManageBilling />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pay', exact: true }));
  fireEvent.change(screen.getByLabelText('Payment Amount (₱)'), { target: { value: '500' } });
  submitForm(screen.getByLabelText('Payment Amount (₱)'));
  await waitFor(() => expect(updated).toHaveLength(1));
  expect(updated[0]).toMatchObject({ matched: 1, payload: { amount_paid: 1500, balance: 2500 } });
});

test('patient statement and PDF use saved amounts and patient-facing labels', async () => {
  const record = makeBill({ discount: 200, balance: 2800, remarks: 'Private agreement details', appointments: { ...appointment, services: { ...service, price: 9000 } } });
  bills = [record];
  const statement = buildBillingStatement(record, new Date('2026-11-12T04:00:00Z'));
  expect(statement).toMatchObject({ gross: 400000, discount: 20000, net: 380000, paid: 100000, balance: 280000 });
  expect(BILLING_STATEMENT_FIELDS).not.toMatch(/price|remarks/);

  render(<BillingStatement billingId={12} onClose={jest.fn()} />);
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
  expect(within(table).getByText('Total amount due')).toBeInTheDocument();
  expect(within(table).getByText('Amount paid')).toBeInTheDocument();
  expect(within(table).getByText('Balance')).toBeInTheDocument();
  expect(within(table).getByText('₱4,000.00')).toBeInTheDocument();
  expect(screen.queryByText(/standard price|agreed treatment charge|Private agreement|₱9,000.00/i)).not.toBeInTheDocument();

  const pdf = {
    text: jest.fn(), getImageProperties: () => ({ width: 100, height: 20 }), getNumberOfPages: () => 1,
    addPage: jest.fn(), addImage: jest.fn(), setTextColor: jest.fn(), setFont: jest.fn(), setFontSize: jest.fn(),
    setDrawColor: jest.fn(), setLineWidth: jest.fn(), line: jest.fn(), setFillColor: jest.fn(),
    rect: jest.fn(), setPage: jest.fn(), setProperties: jest.fn(),
  };
  createClinicPdf.mockReturnValue(pdf);
  createBillingStatementPDF(statement, { logo: 'sample-logo' });
  const output = pdf.text.mock.calls.map(([value]) => value).flat(Infinity).join('\n');
  expect(output).toContain('Amount');
  expect(output).toContain('Total amount due');
  expect(output).toContain('Amount paid');
  expect(output).toContain('Balance');
  expect(output).toContain('₱4,000.00');
  expect(output).not.toMatch(/standard price|agreed treatment charge|Private agreement|9,000.00/i);
});

test('rounds a percentage discount to cents after the charge changes', async () => {
  await openCreateBill();
  changeCharge('3000.07');
  fireEvent.change(screen.getByLabelText('Discount Type'), { target: { value: 'senior' } });
  fireEvent.change(screen.getByLabelText('ID Number *'), { target: { value: '196600000000' } });
  fireEvent.change(screen.getByLabelText('Amount Paid (₱)'), { target: { value: '2400.06' } });
  submitForm(screen.getByLabelText('Agreed treatment charge (₱)'));
  await waitFor(() => expect(inserted).toHaveLength(1));
  expect(inserted[0]).toMatchObject({ total_amount: 3000.07, discount: 600.01, amount_paid: 2400.06, balance: 0 });
});
