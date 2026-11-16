import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClinicRecordsBackup from './ClinicRecordsBackup';
import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const raw = '{"payload":{"format":"diolata-clinic-records","version":1,"data":{"billing":[{"total_amount":1200.50,"billing_id":9007199254740993}]}},"signature":"sample-signature"}';
const confirmation = { payload: { id: 'sample' }, signature: 'signed-preview' };
const preview = {
  backup_date: '2026-11-15T01:00:00Z', confirmation,
  counts: { patients: { recoverable: 1, existing: 2, different: 1, blocked: 0 } },
  issues: [{ module: 'patients', id: '4', reason: 'Existing record differs; left unchanged.' }],
};
const choose = (name = 'backup.json') => {
  const file = new File([raw], name, { type: 'application/json' });
  file.text = jest.fn().mockResolvedValue(raw);
  fireEvent.change(screen.getByLabelText('Backup file (.json, up to 10 MB)'), { target: { files: [file] } });
  return file;
};
beforeEach(() => {
  jest.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: preview, error: null });
  URL.createObjectURL = jest.fn().mockReturnValue('blob:test-backup');
  URL.revokeObjectURL = jest.fn();
});

test('does not read private records on mount and checks the unchanged raw file before recovery', async () => {
  render(<ClinicRecordsBackup />);
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Check Backup File' })).toBeDisabled();
  choose();
  expect(supabase.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByRole('heading', { name: 'Recovery preview' });
  expect(supabase.rpc).toHaveBeenCalledWith('preview_clinic_records_recovery', { p_file: raw });
  const confirm = screen.getByRole('button', { name: 'Confirm Recovery' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  supabase.rpc.mockResolvedValueOnce({ data: { recovered: 1 }, error: null });
  fireEvent.click(confirm);
  await screen.findByText(/1 missing records recovered/);
  expect(supabase.rpc).toHaveBeenLastCalledWith('recover_clinic_records', { p_file: raw, p_confirmation: confirmation });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('choosing another file discards the old preview and its confirmation', async () => {
  render(<ClinicRecordsBackup />); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox'));
  choose('another.json');
  expect(screen.queryByRole('button', { name: 'Confirm Recovery' })).not.toBeInTheDocument();
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});

test('failed recovery requires a fresh preview instead of replaying an old confirmation', async () => {
  render(<ClinicRecordsBackup />); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByRole('checkbox'); fireEvent.click(screen.getByRole('checkbox'));
  supabase.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'Clinic records changed after the preview. Check the file again before recovery.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Recovery' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the file again');
  expect(screen.queryByRole('button', { name: 'Confirm Recovery' })).not.toBeInTheDocument();
});

test('a file without recoverable records offers no confirmation button', async () => {
  supabase.rpc.mockResolvedValue({ data: { ...preview, counts: { patients: { recoverable: 0, existing: 2, different: 0, blocked: 0 } }, issues: [] } });
  render(<ClinicRecordsBackup />); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByText(/All backed-up records are already present/);
  expect(screen.queryByRole('button', { name: 'Confirm Recovery' })).not.toBeInTheDocument();
});

test('SQL and oversized files are rejected before any database request', async () => {
  render(<ClinicRecordsBackup />); choose('backup.sql');
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByRole('alert'); expect(supabase.rpc).not.toHaveBeenCalled();
  const large = new File(['x'], 'large.json'); Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText('Backup file (.json, up to 10 MB)'), { target: { files: [large] } });
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await screen.findByRole('alert'); expect(supabase.rpc).not.toHaveBeenCalled();
});

test('missing database installation and backend access rejection are visible', async () => {
  supabase.rpc.mockResolvedValueOnce({ error: { code: 'PGRST202' } });
  render(<ClinicRecordsBackup />);
  fireEvent.click(screen.getByRole('button', { name: 'Download Records Backup' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('has not been installed');
  supabase.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'Only the active Owner can back up or recover clinic records.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download Records Backup' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only the active Owner');
});

test('downloads the server file without numeric re-serialization', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: { backup_file: raw, total: 1, created_at: '2026-11-15T01:00:00Z' } });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ClinicRecordsBackup />); fireEvent.click(screen.getByRole('button', { name: 'Download Records Backup' }));
  await screen.findByRole('status');
  const blob = URL.createObjectURL.mock.calls[0][0];
  const read = new FileReader();
  const saved = new Promise(resolve => { read.onload = () => resolve(read.result); });
  read.readAsText(blob);
  expect(await saved).toBe(raw);
  expect(click.mock.instances[0].download).toBe('diolata-clinic-records-2026-11-15T01-00-00-000Z.json');
  click.mockRestore();
});

test('leaving the page while a check runs does not offer a stale recovery', async () => {
  let resolve; supabase.rpc.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<ClinicRecordsBackup />); choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalled());
  view.unmount(); resolve({ data: preview });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm Recovery' })).not.toBeInTheDocument());
});
