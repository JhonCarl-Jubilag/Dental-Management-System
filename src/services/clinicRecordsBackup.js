import { supabase } from './supabase';

export const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
export const BACKUP_MODULES = {
  services: 'Services', doctors: 'Dentists', patients: 'Patients', inventory: 'Inventory',
  doctor_services: 'Dentist services', doctor_availability: 'Dentist schedules',
  service_requirements: 'Service supplies', appointments: 'Appointments', billing: 'Billing',
  treatment_records: 'Treatment records', staff_time_records: 'Staff attendance',
  staff_time_corrections: 'Attendance corrections',
};

async function request(name, parameters = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) {
      throw new Error('Backup & Recovery has not been installed in the database yet. Ask the Owner to apply the clinic records backup update.');
    }
    if (['P0001', '42501'].includes(error.code)) throw new Error(error.message);
    if (['55P03', '57014'].includes(error.code)) {
      throw new Error('The clinic is busy or the request took too long. Please try again shortly.');
    }
    throw new Error('Could not complete the backup request. Check your connection and try again.');
  }
  if (!data || typeof data !== 'object') throw new Error('The server returned an incomplete backup response.');
  return data;
}

export async function downloadClinicRecords() {
  const result = await request('create_clinic_records_backup');
  if (typeof result.backup_file !== 'string' || !result.backup_file.length) {
    throw new Error('The backup file could not be generated. Please try again.');
  }
  // Keep the server's original text. Re-serializing changes numeric precision
  // and may invalidate the signature used by the recovery checks.
  const blob = new Blob([result.backup_file], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const stamp = new Date(result.created_at).toISOString().replace(/[:.]/g, '-');
  link.download = `diolata-clinic-records-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result.total;
}

export async function readClinicBackup(file) {
  if (!file || !/\.json$/i.test(file.name) || file.size < 100 || file.size > BACKUP_MAX_BYTES) {
    throw new Error('Choose a clinic records .json backup file of up to 10 MB.');
  }
  const raw = await file.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('This file is not a valid JSON backup.'); }
  if (parsed?.payload?.format !== 'diolata-clinic-records' || typeof parsed.signature !== 'string') {
    throw new Error('Choose an unchanged backup downloaded from this system.');
  }
  return raw;
}

export const previewClinicRecovery = raw => request('preview_clinic_records_recovery', { p_file: raw });
export const recoverClinicRecords = (raw, confirmation) => request('recover_clinic_records', {
  p_file: raw, p_confirmation: confirmation,
});
