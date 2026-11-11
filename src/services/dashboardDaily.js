import { clinicDayBounds } from '../utils/clinicScheduling';

export const DASHBOARD_PAGE_SIZE = 5;
const APPOINTMENT_FIELDS = 'appointment_id, patient_id, status, appointment_datetime, appointment_end, patients(first_name, last_name), doctors(first_name, last_name), services(service_name)';
const current = isCurrent => { if (!isCurrent()) throw new Error('Dashboard loading was cancelled.'); };
const verify = (result, label, isCurrent) => {
  current(isCurrent);
  if (result.error || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error(`Could not load ${label}. Please retry.`);
  return result;
};
const rows = (result, label) => { if (!Array.isArray(result.data)) throw new Error(`Could not verify ${label}. Please retry.`); return result.data; };

export const loadTodaySchedule = async (client, date, page = 1, isCurrent = () => true) => {
  current(isCurrent);
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Choose a valid schedule page.');
  const bounds = clinicDayBounds(date), start = (page - 1) * DASHBOARD_PAGE_SIZE;
  const result = verify(await client.from('appointments').select(APPOINTMENT_FIELDS, { count: 'exact' })
    .gte('appointment_datetime', bounds.start).lt('appointment_datetime', bounds.end)
    .order('appointment_datetime', { ascending: true }).order('appointment_id', { ascending: true })
    .range(start, start + DASHBOARD_PAGE_SIZE - 1), 'today’s appointments', isCurrent);
  const appointments = rows(result, 'today’s appointments'), ids = new Set();
  const expected = Math.max(0, Math.min(DASHBOARD_PAGE_SIZE, result.count - start));
  if (appointments.length !== expected) throw new Error('The schedule changed while loading. Refresh the schedule.');
  for (const appointment of appointments) {
    const time = new Date(appointment.appointment_datetime).getTime();
    if (!appointment.appointment_id || ids.has(String(appointment.appointment_id)) || !Number.isFinite(time) || time < new Date(bounds.start).getTime() || time >= new Date(bounds.end).getTime()) throw new Error('Could not verify today’s schedule. Please refresh.');
    ids.add(String(appointment.appointment_id));
  }
  return { rows: appointments, count: result.count, page, pages: Math.max(1, Math.ceil(result.count / DASHBOARD_PAGE_SIZE)), refreshedAt: new Date().toISOString() };
};
export const loadPendingRequests = async (client, now = new Date(), isCurrent = () => true) => {
  current(isCurrent); const from = now.toISOString();
  const result = verify(await client.from('appointments').select(APPOINTMENT_FIELDS, { count: 'exact' })
    .eq('status', 'pending').gte('appointment_datetime', from)
    .order('appointment_datetime', { ascending: true }).order('appointment_id', { ascending: true }).limit(3), 'pending requests', isCurrent);
  const pending = rows(result, 'pending requests');
  if (pending.length !== Math.min(result.count, 3) || new Set(pending.map(row => String(row.appointment_id))).size !== pending.length
    || pending.some(row => !row.appointment_id || row.status !== 'pending' || !Number.isFinite(Date.parse(row.appointment_datetime)) || Date.parse(row.appointment_datetime) < now.getTime())) throw new Error('Could not verify pending requests. Please refresh.');
  return { rows: pending, count: result.count };
};
export const loadSupplyAlerts = async (client, isCurrent = () => true) => {
  const ids = new Set(), alerts = []; let offset = 0, total = null;
  // Follow actual page lengths if the server caps pages below 250 rows.
  while (true) {
    current(isCurrent);
    const result = verify(await client.from('inventory').select('item_id, item_name, stock_quantity, reorder_level', { count: 'exact' })
      .eq('status', 'active').order('item_id', { ascending: true }).range(offset, offset + 249), 'supply alerts', isCurrent);
    if (total == null) total = result.count;
    if (total !== result.count) throw new Error('Inventory changed while loading. Refresh supply alerts.');
    const items = rows(result, 'supply alerts');
    if ((items.length === 0 && offset < total) || offset + items.length > total) throw new Error('Could not verify supply levels. Refresh supply alerts.');
    for (const item of items) {
      const stock = item.stock_quantity == null ? NaN : Number(item.stock_quantity), threshold = item.reorder_level == null ? NaN : Number(item.reorder_level);
      if (!item.item_id || ids.has(String(item.item_id)) || !Number.isFinite(stock) || stock < 0 || !Number.isFinite(threshold) || threshold < 0) throw new Error('Some supply levels could not be verified. Review Inventory, then refresh.');
      ids.add(String(item.item_id));
      if (stock <= threshold) alerts.push({ id: item.item_id, name: item.item_name || 'Unnamed supply', outOfStock: stock === 0 });
    }
    offset += items.length;
    if (offset === total) break;
  }
  alerts.sort((a, b) => Number(b.outOfStock) - Number(a.outOfStock) || String(a.name).localeCompare(String(b.name)));
  return { count: alerts.length, rows: alerts.slice(0, 3) };
};
export const loadUnbilledAlert = async (client, now = new Date(), isCurrent = () => true) => {
  current(isCurrent);
  // The empty embedded relation includes archived bills as existing bills.
  const result = verify(await client.from('appointments').select('appointment_id, billing()', { count: 'exact', head: true })
    .in('status', ['confirmed', 'completed']).lte('appointment_end', now.toISOString()).is('billing', null), 'appointments awaiting billing', isCurrent);
  return { count: result.count };
};
