import { fireEvent, render, screen } from '@testing-library/react';
import ManagePatients from './managePatients';
import { supabase } from '../../services/supabase';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useParams: () => ({ id: '7' }) }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@example.com' }, userType: 'admin' }) }));
jest.mock('../../services/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../components/admin/Sidebar', () => () => null);
jest.mock('../../components/admin/PatientTreatmentRecords', () => () => null);

test('opens a patient without photo support and discards a cancelled staff edit', async () => {
  const patient = { patient_id: 7, first_name: 'Mira', last_name: 'Lee', email: 'patient@example.com', status: 'active', date_created: '2025-04-15' };
  const query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValueOnce({ error: { code: '42703' } }).mockResolvedValue({ data: patient }),
  };
  supabase.from.mockReturnValue(query);
  render(<ManagePatients />);
  await screen.findByRole('heading', { name: 'Mira Lee' });
  expect(screen.getByText('ML')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
  expect(screen.getByRole('textbox', { name: /Email/ })).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
  expect(screen.getByLabelText('First name')).toHaveValue('Mira');
});
