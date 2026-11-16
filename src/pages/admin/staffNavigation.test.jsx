import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { loadAttendanceMonth } from '../../services/staffAttendance';
import ClinicSettings from './clinicSettings';
import DailyTimeRecords from './dailyTimeRecords';

jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.TextDecoder = require('util').TextDecoder;
  return jest.requireActual('../../../node_modules/react-router/dist/development/index.js');
}, { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/supabase', () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../../services/staffAttendance', () => ({
  loadAttendanceMonth: jest.fn(), loadAttendanceAudit: jest.fn(),
  saveAttendanceCorrection: jest.fn(), attendanceDuration: () => '8h 00m',
}));
jest.mock('../../components/admin/StaffTimeCard', () => () => <a href="/admin/attendance">My Daily Time Records</a>);
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() }, ToastContainer: () => null,
}));

const profiles = [
  { admin_id: 4, first_name: 'Alex', last_name: 'Staff', email: 'alex@example.invalid', status: 'active', linked: true, date_created: '2026-10-30T01:00:00Z' },
  { admin_id: 8, first_name: 'Bea', last_name: 'Staff', email: 'bea@example.invalid', status: 'inactive', linked: true, date_created: '2026-11-01T01:00:00Z' },
];
let saved;
const CurrentPage = () => {
  const location = useLocation();
  return <output aria-label="Current page">{location.pathname + location.search}</output>;
};
const showSettings = (url = '/admin/settings?section=staff') => render(
  <MemoryRouter initialEntries={[url]}>
    <CurrentPage />
    <Routes>
      <Route path="/admin/settings" element={<ClinicSettings />} />
      <Route path="/admin/settings/staff/:staffId" element={<ClinicSettings />} />
      <Route path="/admin/staff" element={<Navigate to="/admin/settings?section=staff" replace />} />
      <Route path="/admin/attendance" element={<DailyTimeRecords />} />
    </Routes>
  </MemoryRouter>
);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.defineProperty(global, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});

beforeEach(() => {
  jest.clearAllMocks();
  saved = profiles.map(profile => ({ ...profile }));
  useAuth.mockReturnValue({ user: { id: 'owner' }, userType: 'super_admin', loading: false, signOut: jest.fn() });
  supabase.functions.invoke.mockImplementation(async (_name, { body }) => {
    if (body.action === 'list') return { data: { success: true, staff: saved, total: saved.length, page_size: 10 }, error: null };
    const profile = saved.find(item => item.admin_id === body.admin_id);
    if (body.action === 'set_status') profile.status = body.status;
    if (body.action === 'update_names') Object.assign(profile, { first_name: body.first_name, last_name: body.last_name });
    if (body.action === 'change_email') profile.email = body.new_email;
    return { data: { success: true, staff: { ...profile } }, error: null };
  });
  supabase.from.mockImplementation(table => {
    const filters = {};
    const query = {
      select: () => query, order: () => query, range: () => query, abortSignal: () => query,
      eq: (key, value) => { filters[key] = value; return query; },
      maybeSingle: async () => {
        const profile = saved.find(item => item.admin_id === filters.admin_id);
        return { data: profile ? { ...profile, auth_user_id: 'staff-auth-' + profile.admin_id } : null, error: null };
      },
      then: (resolve, reject) => Promise.resolve({ data: table === 'clinic_activity_log' ? [] : saved, count: 0, error: null }).then(resolve, reject),
    };
    return query;
  });
  loadAttendanceMonth.mockImplementation(async (_client, query) => {
    const staff = saved.filter(profile => !query.staffId || String(profile.admin_id) === String(query.staffId));
    return {
      month: (query.month || '2026-11') + '-01', total: staff.length, staff: saved.map(profile => ({ ...profile, name: profile.first_name + ' ' + profile.last_name })),
      summary: { recorded_seconds: 28800 * staff.length, closed_sessions: staff.length, open_sessions: 0, days_recorded: staff.length },
      rows: staff.map(profile => ({
        record_id: profile.admin_id, staff_admin_id: profile.admin_id, staff_name: profile.first_name + ' ' + profile.last_name,
        work_date: '2026-11-12', time_in: '2026-11-12T01:00:00Z', time_out: '2026-11-12T09:00:00Z',
        recorded_seconds: 28800, entry_source: 'staff', last_reason: '',
      })),
    };
  });
});

const openAlexMenu = async () => {
  const summary = await screen.findByLabelText('Actions for Alex Staff');
  fireEvent.click(summary);
  return within(screen.getByRole('group', { name: 'Account actions for Alex Staff' }));
};

test('Settings shows Staff accounts with one sidebar and replaces the old staff route', async () => {
  showSettings('/admin/staff');
  await screen.findByRole('link', { name: 'View details and time records for Alex Staff' });
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/admin/settings?section=staff');
  expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1);
  expect(screen.queryByRole('link', { name: 'Daily Time Records', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Staff accounts', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View All Daily Time Records' })).toHaveAttribute('href', '/admin/attendance');
  expect(supabase.from).not.toHaveBeenCalledWith('clinic_activity_log');
});

test('the kebab opens account actions without navigating and edits the selected staff member', async () => {
  showSettings();
  const menu = await openAlexMenu();
  expect(menu.getByRole('button', { name: 'Change login email' })).toBeInTheDocument();
  expect(menu.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
  fireEvent.click(menu.getByRole('button', { name: 'Edit details' }));
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/admin/settings?section=staff');
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alexis' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Staff name' }));
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-staff-account', {
    body: expect.objectContaining({ action: 'update_names', admin_id: 4, first_name: 'Alexis' }),
  }));
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
});

test('disable and enable access use the correct staff identity and expected status', async () => {
  showSettings();
  fireEvent.click((await openAlexMenu()).getByRole('button', { name: 'Disable access' }));
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-staff-account', {
    body: { action: 'set_status', admin_id: 4, expected_status: 'active', status: 'inactive' },
  }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Staff account: Alex Staff' })).toHaveTextContent('Inactive'));
  fireEvent.click((await openAlexMenu()).getByRole('button', { name: 'Enable access' }));
  await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-staff-account', {
    body: { action: 'set_status', admin_id: 4, expected_status: 'inactive', status: 'active' },
  }));
});

test('clicking an account opens its details and keeps attendance filters scoped to it', async () => {
  showSettings();
  fireEvent.click(await screen.findByRole('link', { name: 'View details and time records for Alex Staff' }));
  await screen.findByRole('heading', { name: 'Daily Time Records', level: 3 });
  expect(screen.getByLabelText('Current page')).toHaveTextContent('/admin/settings/staff/4');
  expect(screen.getByText('alex@example.invalid')).toBeInTheDocument();
  expect(screen.queryByText('bea@example.invalid')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Staff', { exact: true })).not.toBeInTheDocument();
  expect(loadAttendanceMonth).toHaveBeenLastCalledWith(supabase, expect.objectContaining({ staffId: '4' }), true);
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(loadAttendanceMonth).toHaveBeenLastCalledWith(supabase, expect.objectContaining({ staffId: '4', month: '2026-10' }), true));
  fireEvent.click(screen.getByRole('button', { name: 'Add missed entry' }));
  expect(screen.getByLabelText('Staff account')).toHaveValue('4');
  expect(screen.queryByRole('option', { name: /Bea Staff/ })).not.toBeInTheDocument();
});

test('profile deep links load the requested account and invalid accounts do not load attendance', async () => {
  const view = showSettings('/admin/settings/staff/999');
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Staff account not found');
  expect(loadAttendanceMonth).not.toHaveBeenCalled();
  view.unmount();
  showSettings('/admin/settings/staff/8');
  await screen.findByRole('heading', { name: 'Daily Time Records', level: 3 });
  expect(screen.getByText('bea@example.invalid')).toBeInTheDocument();
  expect(loadAttendanceMonth).toHaveBeenLastCalledWith(supabase, expect.objectContaining({ staffId: '8' }), true);
});

test('overall attendance and Activity History remain reachable from Settings', async () => {
  showSettings();
  fireEvent.click(screen.getByRole('link', { name: 'View All Daily Time Records' }));
  await screen.findByLabelText('Staff', { exact: true });
  expect(loadAttendanceMonth).toHaveBeenLastCalledWith(supabase, expect.objectContaining({ staffId: '' }), true);
  fireEvent.click(screen.getByRole('link', { name: 'Back to Staff Accounts' }));
  fireEvent.click(screen.getByRole('link', { name: 'Activity History', exact: true }));
  await screen.findByRole('form', { name: 'Activity filters' });
  expect(supabase.from).toHaveBeenCalledWith('clinic_activity_log');
});

test('Staff cannot read Owner Settings and can still access their own attendance page', async () => {
  useAuth.mockReturnValue({ user: { id: 'staff' }, userType: 'admin', loading: false, signOut: jest.fn() });
  const view = showSettings('/admin/settings/staff/4');
  expect(supabase.from).not.toHaveBeenCalled();
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
  view.unmount();
  showSettings('/admin/attendance');
  await screen.findByRole('heading', { name: 'Daily Time Records', level: 1 });
  expect(loadAttendanceMonth).toHaveBeenLastCalledWith(supabase, expect.objectContaining({ staffId: '' }), false);
  expect(screen.getByRole('link', { name: 'My Daily Time Records' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add missed entry' })).not.toBeInTheDocument();
});


test('the temporary email test tab is removed and its old URL shows activity history', async () => {
  showSettings('/admin/settings?section=email');
  await screen.findByRole('heading', { name: 'Activity History' });
  expect(screen.queryByRole('link', { name: 'Email Notifications' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument();
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
});