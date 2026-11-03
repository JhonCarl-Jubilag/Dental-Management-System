import { fireEvent, render, screen } from '@testing-library/react';
import PatientTreatmentHistory from './PatientTreatmentHistory';
import { supabase } from '../../services/supabase';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff' }, userType: 'admin' }),
}));
jest.mock('../../services/supabase', () => ({ supabase: { from: jest.fn() } }));

test('pages through patient history and resets the range when filtering', async () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    appointment_id: index + 1, appointment_datetime: '2026-10-01T04:00:00Z',
    status: 'completed', services: { service_name: 'Cleaning' },
  }));
  const query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
    range: jest.fn((start, end) => Promise.resolve({ data: records.slice(start, end + 1), count: records.length })),
  };
  supabase.from.mockReturnValue(query);
  render(<PatientTreatmentHistory patientId={7} />);

  expect(await screen.findAllByRole('article')).toHaveLength(5);
  expect(query.eq).toHaveBeenCalledWith('patient_id', 7);
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Showing 6–10 of 12');
  fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
  await screen.findByText('Showing 11–12 of 12');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('Showing 6–10 of 12');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
  await screen.findByText('Showing 1–5 of 12');
  expect(query.eq).toHaveBeenCalledWith('status', 'completed');
  expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
});
