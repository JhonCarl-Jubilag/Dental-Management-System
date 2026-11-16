import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MyAppointments from './myAppointments';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { readMyAppointmentTreatments } from '../../services/treatmentRecords';

jest.mock('react-router-dom', () => ({ Link: ({ to, ...props }) => <a href={to} {...props} />, useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../services/doctorScheduling', () => ({ loadDoctorBookingSlots: jest.fn(), validateAppointmentReschedule: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() }, ToastContainer: () => null }));
const record = { appointment_id: 1, treatment_id: 10, procedure_name: 'Saved restoration', tooth_scope: 'specific', tooth_numbers: [15,16], treated_at: '2026-11-01T03:00:00Z', doctor_name: 'Sample Dentist' };
const auth = id => ({ user: { id: 'auth-' + id }, userType: 'patient', userDetails: { patient_id: id, first_name: 'Alex', status: 'active' }, loading: false });
const appointment = (id, status = 'completed') => ({ appointment_id: id, patient_id: 1, status, appointment_datetime: '2026-11-01T02:00:00Z', created_at: '2026-10-01T02:00:00Z', doctors: { first_name: 'Sample', last_name: 'Dentist' }, services: { service_name: 'Service ' + id, duration_minutes: 60 }, billing: [] });
let appointments;
const response = data => ({ abortSignal: () => Promise.resolve({ data, error: null }) });
beforeEach(() => {
  jest.clearAllMocks(); appointments = [appointment(1), appointment(2), appointment(3, 'pending')];
  useAuth.mockReturnValue(auth(1));
  supabase.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: appointments, error: null }) }) }) }));
  supabase.rpc.mockImplementation(() => response({ patient_id: 1, rows: [record] }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
test('completed appointments open their own saved record; missing and pending records have no button', async () => {
  render(<MyAppointments />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Treatment Record' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Saved restoration')).toBeInTheDocument();
  expect(within(dialog).getByText('15, 16')).toBeInTheDocument();
  expect(within(dialog).queryByText(/notes|balance|revision/i)).not.toBeInTheDocument();
  expect(screen.getAllByText('Treatment record not yet available.')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'View Details' })).toHaveLength(3);
  expect(supabase.rpc).toHaveBeenCalledWith('list_my_appointment_treatments', { p_appointment_ids: [1,2] });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
  expect(screen.getAllByRole('button', { name: 'View Details' })).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close treatment record' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('failed lookups show an error and retry instead of claiming no record exists', async () => {
  supabase.rpc.mockImplementationOnce(() => ({ abortSignal: () => Promise.resolve({ error: { code: 'PGRST202' } }) }));
  render(<MyAppointments />);
  expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
  expect(screen.queryByText('Treatment record not yet available.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry treatment records' }));
  expect(await screen.findByRole('button', { name: 'View Treatment Record' })).toBeInTheDocument();
});
test('only the current page is looked up; pending-only pages make no treatment request', async () => {
  appointments = Array.from({length:6}, (_, i) => appointment(i+1));
  supabase.rpc.mockImplementation((name, args) => response({ patient_id: 1, rows: args.p_appointment_ids.includes(1) ? [record] : [] }));
  render(<MyAppointments />);
  await screen.findByRole('button', { name: 'View Treatment Record' });
  expect(supabase.rpc).toHaveBeenLastCalledWith('list_my_appointment_treatments', { p_appointment_ids: [1,2,3,4,5] });
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenLastCalledWith('list_my_appointment_treatments', { p_appointment_ids: [6] }));
  expect(await screen.findByText('Treatment record not yet available.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pending' } });
  await screen.findByText('No Appointments Found');
  expect(supabase.rpc).toHaveBeenCalledTimes(2);
});
test('switching patients clears a dialog and ignores a previous patient late lookup', async () => {
  let resolve;
  supabase.rpc.mockImplementationOnce(() => ({ abortSignal: () => new Promise(done => { resolve = done; }) }));
  const view = render(<MyAppointments />);
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
  useAuth.mockReturnValue(auth(2)); appointments = [];
  view.rerender(<MyAppointments />);
  await act(async () => resolve({ data: { patient_id: 1, rows: [record] } }));
  expect(screen.queryByText('Saved restoration')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View Treatment Record' })).not.toBeInTheDocument();
});
test.each([
  { patient_id: 2, rows: [record] },
  { patient_id: 1, rows: [{ ...record, appointment_id: 99 }] },
  { patient_id: 1, rows: [{ ...record, notes: 'PRIVATE' }] },
  { patient_id: 1, rows: [record, record] },
])('rejects mismatched or private response data %#', async data => {
  supabase.rpc.mockReturnValue(response(data));
  await expect(readMyAppointmentTreatments(supabase, 1, [1,2])).rejects.toThrow('Could not verify');
});
