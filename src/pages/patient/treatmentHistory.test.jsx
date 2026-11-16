import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreatmentHistory from './treatmentHistory';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';

jest.mock('react-router-dom', () => ({ Link: ({ to, ...props }) => <a href={to} {...props} />, useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const row = { treatment_id: 1, procedure_name: 'Light-Cured Restoration', tooth_scope: 'specific', tooth_numbers: [11,12], treated_at: '2026-11-01T02:00:00Z', doctor_name: 'Sample Dentist' };
const page = (rows = [row], extra = {}) => ({ patient_id: 1, page: 1, page_size: 10, total: rows.length, rows, ...extra });
const auth = (id = 'patient-one', patientId = 1) => ({ user: { id }, userType: 'patient', userDetails: { patient_id: patientId, first_name: 'Alex', status: 'active' }, loading: false, signOut: jest.fn() });
function response(value) { const promise = Promise.resolve(value); promise.abortSignal = () => promise; return promise; }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});
beforeEach(() => {
  jest.clearAllMocks(); useAuth.mockReturnValue(auth());
  supabase.rpc.mockImplementation(() => response({ data: page(), error: null }));
});

test('reads only the signed-in patient history without sending a patient ID', async () => {
  render(<TreatmentHistory />);
  await screen.findByText('Light-Cured Restoration');
  expect(supabase.rpc).toHaveBeenCalledWith('list_my_treatment_history', { p_page: 1, p_from: null, p_to: null });
  expect(screen.getByText('11, 12')).toBeInTheDocument();
  expect(screen.getByText('Dr. Sample Dentist')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit|delete|add treatment/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /View Light-Cured/ }));
  const dialog = screen.getByRole('dialog', { name: 'Treatment Details' });
  expect(within(dialog).getByText('11, 12')).toBeInTheDocument();
  expect(within(dialog).queryByText(/notes|balance|standard price|revision/i)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close treatment details' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('rejects a response linked to another patient before rendering it', async () => {
  supabase.rpc.mockImplementation(() => response({ data: page([{ ...row, procedure_name: 'Other patient procedure' }], { patient_id: 2 }) }));
  render(<TreatmentHistory />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not verify');
  expect(screen.queryByText('Other patient procedure')).not.toBeInTheDocument();
});
test('rejects unexpected private fields in the response', async () => {
  supabase.rpc.mockImplementation(() => response({ data: page([{ ...row, notes: 'Internal only', revisions: [] }]) }));
  render(<TreatmentHistory />); await screen.findByRole('alert');
  expect(screen.queryByText('Internal only')).not.toBeInTheDocument();
});
test('applies dates only on submit and validates reversed ranges', async () => {
  render(<TreatmentHistory />); await screen.findByText(row.procedure_name);
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  expect(screen.getByRole('alert')).toHaveTextContent('end date'); expect(supabase.rpc).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith('list_my_treatment_history', { p_page: 1, p_from: '2026-11-02', p_to: '2026-11-30' }));
  await screen.findByText(row.procedure_name);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith('list_my_treatment_history', { p_page: 1, p_from: null, p_to: null }));
});
test('paginates and handles whole-mouth and non-tooth-specific procedures', async () => {
  supabase.rpc.mockImplementation((_name, args) => response({ data: args.p_page === 1
    ? page(Array.from({ length: 10 }, (_, i) => ({ ...row, treatment_id: i + 1 })), { total: 11 })
    : page([{ ...row, treatment_id: 11, tooth_scope: 'whole_mouth', tooth_numbers: [] }], { page: 2, total: 11 }) }));
  render(<TreatmentHistory />); await screen.findByText('Page 1 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Whole mouth'); expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
test('shows an honest empty state rather than treating appointments as treatments', async () => {
  supabase.rpc.mockImplementation(() => response({ data: page([]) }));
  render(<TreatmentHistory />);
  await screen.findByText('No treatment records yet');
  expect(screen.getByText(/after the clinic saves a treatment record/)).toBeInTheDocument();
});
test('shows migration and connection errors with a working retry', async () => {
  supabase.rpc.mockImplementationOnce(() => response({ error: { code: 'PGRST202' } }));
  render(<TreatmentHistory />); expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(row.procedure_name); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('switching accounts discards old history and ignores late responses', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }); pending.abortSignal = () => pending;
  supabase.rpc.mockImplementationOnce(() => pending).mockImplementation(() => response({ data: page([{ ...row, procedure_name: 'Second patient treatment' }], { patient_id: 2 }) }));
  const view = render(<TreatmentHistory />);
  useAuth.mockReturnValue(auth('patient-two', 2)); view.rerender(<TreatmentHistory />);
  await screen.findByText('Second patient treatment');
  await act(async () => resolve({ data: page([{ ...row, procedure_name: 'First patient private record' }]) }));
  expect(screen.queryByText('First patient private record')).not.toBeInTheDocument();
});
test.each(['admin','super_admin',null])('does not load history for non-patient role %s', type => {
  useAuth.mockReturnValue({ ...auth(), userType: type }); render(<TreatmentHistory />);
  expect(supabase.rpc).not.toHaveBeenCalled(); expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
test('does not load history for an inactive or signed-out patient', () => {
  useAuth.mockReturnValue({ ...auth(), user: null }); const view = render(<TreatmentHistory />);
  useAuth.mockReturnValue({ ...auth(), userDetails: { patient_id: 1, status: 'inactive' } }); view.rerender(<TreatmentHistory />);
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('mobile menu exposes the same patient links without changing the query', async () => {
  render(<TreatmentHistory />); await screen.findByText(row.procedure_name);
  fireEvent.click(screen.getByRole('button', { name: 'Patient menu' }));
  expect(screen.getByRole('button', { name: 'Patient menu' })).toHaveAttribute('aria-expanded','true');
  fireEvent.click(document.querySelector('.user-dropdown-btn'));
  expect(screen.getByRole('link', { name: 'My Appointments' })).toHaveAttribute('href','/my-appointments');
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
