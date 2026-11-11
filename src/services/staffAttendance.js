import { clinicDateTime, toClinicDateTimeInput, getClinicDate } from '../utils/clinicScheduling';

const id = value => /^[1-9]\d*$/.test(String(value ?? ''));
const count = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const monthValue = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const call = async (client, name, params) => {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    const message = ['PGRST202', '42P01', '42883'].includes(error.code) ? 'The Staff Daily Time Records database update is not installed yet. Contact the Owner.'
      : error.code === '23P01' ? 'These times overlap another attendance session. Review the existing records.'
        : error.code === '23505' ? 'An attendance session or request was already recorded. Refresh before trying again.'
          : error.message || 'Attendance could not be confirmed. Refresh before retrying.';
    const failure = new Error(message); failure.code = error.code; throw failure;
  }
  return data;
};
const verifyRow = row => {
  if (!row || !id(row.record_id) || !id(row.staff_admin_id) || !timestamp(row.time_in) || !count(row.version) || row.version < 1
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.work_date || '') || !['clock', 'owner'].includes(row.entry_source)
    || (row.time_out !== null && (!timestamp(row.time_out) || Date.parse(row.time_out) < Date.parse(row.time_in) || !count(row.recorded_seconds)
      || Math.abs(Math.floor((Date.parse(row.time_out) - Date.parse(row.time_in)) / 1000) - row.recorded_seconds) > 1))
    || (row.time_out === null && row.recorded_seconds !== null)
    || (timestamp(row.time_in) && getClinicDate(new Date(row.time_in)) !== row.work_date)) throw new Error('Could not verify an attendance entry. Please refresh.');
  return row;
};
const verifySnapshot = data => {
  if (!data || !id(data.staff_admin_id) || !timestamp(data.server_now) || !/^\d{4}-\d{2}-\d{2}$/.test(data.today || '') || !count(data.today_recorded_seconds)) throw new Error('Could not verify your attendance. Please refresh.');
  for (const key of ['open_record', 'latest_record']) {
    if (data[key] !== null) { verifyRow(data[key]); if (String(data[key].staff_admin_id) !== String(data.staff_admin_id)) throw new Error('The attendance entry belongs to another Staff account.'); }
  }
  if (data.open_record && data.open_record.time_out !== null) throw new Error('The attendance session changed. Please refresh.');
  return data;
};
export const loadMyAttendance = async client => verifySnapshot(await call(client, 'get_my_staff_attendance', {}));
export const timeIn = async (client, requestId) => verifySnapshot(await call(client, 'staff_time_in', { p_request_id: requestId }));
export const timeOut = async (client, record, requestId) => verifySnapshot(await call(client, 'staff_time_out', { p_record_id: record.record_id, p_expected_version: record.version, p_request_id: requestId }));

export const loadAttendanceMonth = async (client, { month = '', staffId = '', page = 1 }, owner) => {
  if ((month && !monthValue(month)) || (staffId && !id(staffId)) || !Number.isInteger(page) || page < 1) throw new Error('Choose a valid attendance month, Staff account and page.');
  const data = await call(client, 'get_staff_daily_time_records', { p_month: month ? `${month}-01` : null, p_staff_id: staffId || null, p_page: page });
  if (!data || !/^\d{4}-\d{2}-01$/.test(data.month || '') || (month && data.month.slice(0, 7) !== month) || data.page !== page || data.page_size !== 20
    || data.is_owner !== owner || !timestamp(data.server_now) || !count(data.total) || !Array.isArray(data.rows) || data.rows.length !== Math.min(20, Math.max(0, data.total - (page - 1) * 20))
    || !data.summary || !['recorded_seconds', 'closed_sessions', 'open_sessions', 'days_recorded'].every(key => count(data.summary[key]))
    || data.summary.closed_sessions + data.summary.open_sessions !== data.total || !Array.isArray(data.staff)
    || data.staff.some(person => !id(person.admin_id) || typeof person.name !== 'string' || typeof person.linked !== 'boolean')) throw new Error('Could not verify the attendance list. Please refresh.');
  const ids = new Set();
  data.rows.forEach(row => {
    verifyRow(row);
    if (!row.work_date.startsWith(data.month.slice(0, 7)) || ids.has(String(row.record_id)) || (!owner && String(row.staff_admin_id) !== String(data.staff_admin_id)) || (staffId && String(row.staff_admin_id) !== String(staffId))) throw new Error('Could not verify attendance ownership or month. Please refresh.');
    ids.add(String(row.record_id));
  });
  return data;
};
const inputTimestamp = (value, original) => value ? (original && value === toClinicDateTimeInput(original) ? original : clinicDateTime(...value.split('T'))) : null;
export const saveAttendanceCorrection = async (client, { record, staffId, form, requestId }) => {
  if (!id(record?.staff_admin_id || staffId) || !form.timeIn || form.reason.trim().length < 3 || form.reason.trim().length > 1000) throw new Error('Choose a Staff account, time in, and a reason of 3 to 1000 characters.');
  const start = inputTimestamp(form.timeIn, record?.time_in), end = inputTimestamp(form.timeOut, record?.time_out);
  if (end && Date.parse(end) < Date.parse(start)) throw new Error('Time Out cannot be earlier than Time In.');
  const data = await call(client, 'save_staff_time_record', { p_record_id: record?.record_id || null, p_staff_id: record?.staff_admin_id || staffId,
    p_expected_version: record?.version || null, p_time_in: start, p_time_out: end, p_reason: form.reason.trim(), p_request_id: requestId });
  if (!id(data?.record_id) || (record && String(data.record_id) !== String(record.record_id)) || !Number.isSafeInteger(data.version) || data.version < 1) throw new Error('Could not verify the attendance save. Refresh and check the record before retrying.');
  return data;
};
export const loadAttendanceAudit = async (client, recordId, page = 1) => {
  const data = await call(client, 'get_staff_time_corrections', { p_record_id: recordId, p_page: page });
  if (String(data?.record_id) !== String(recordId) || data.page !== page || data.page_size !== 20 || !count(data.total) || !Array.isArray(data.rows) || data.rows.length !== Math.min(20, Math.max(0, data.total - (page - 1) * 20))
    || data.rows.some(row => String(row.record_id) !== String(recordId))) throw new Error('Could not verify correction history. Please retry.');
  return data;
};
export const attendanceDuration = (seconds, showSeconds = false) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0)), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m${showSeconds ? ` ${String(value % 60).padStart(2, '0')}s` : ''}`;
};
