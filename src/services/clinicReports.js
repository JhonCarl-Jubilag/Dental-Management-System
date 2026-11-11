import { clinicDayBounds, getClinicDate, CLINIC_TIME_ZONE } from '../utils/clinicScheduling';

export const REPORT_TYPES = {
  financial: 'Financial and billing', appointments: 'Appointment operations',
  patients: 'Patient activity', services: 'Dental services', doctors: 'Dentist workload', inventory: 'Inventory summary',
};
export const reportRelation = value => Array.isArray(value) ? value[0] : value;
const name = (profile, fallback) => profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || fallback : fallback;
const patientName = row => name(reportRelation(row.patients), `Patient #${row.patient_id ?? 'unknown'}`);
const doctorName = row => name(reportRelation(row.doctors), `Dentist #${row.doctor_id ?? 'unknown'}`);
const serviceName = row => reportRelation(row.services)?.service_name || `Service #${row.service_id ?? 'unknown'}`;
const rate = (part, total) => total ? (100 * part / total).toFixed(1) : '0.0';
const numeric = (value, label) => {
  const number = value == null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label} in the report data. Review the source record.`);
  return number;
};
const cents = value => {
  const result = Math.round(numeric(value, 'billing amount') * 100);
  if (!Number.isSafeInteger(result)) throw new Error('A billing amount is too large to report accurately.');
  return result;
};
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0) / 100;
export const formatReportCurrency = value => Number(value).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });
export const formatReportDate = value => {
  if (!value) return 'Not recorded';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-PH', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' }) : 'Not recorded';
};
export const defaultReportFilters = (now = new Date()) => {
  const endDate = getClinicDate(now);
  return { reportType: 'financial', startDate: `${endDate.slice(0, 7)}-01`, endDate, doctorId: 'all', serviceId: 'all' };
};
export const validateReportFilters = filters => {
  if (!Object.hasOwn(REPORT_TYPES, filters.reportType)) throw new Error('Choose a valid report type.');
  if (filters.reportType === 'inventory') return null;
  let start, end;
  try { start = clinicDayBounds(filters.startDate).start; end = clinicDayBounds(filters.endDate).end; }
  catch { throw new Error('Choose valid start and end dates.'); }
  if (filters.startDate > filters.endDate) throw new Error('Start date must be on or before end date.');
  for (const key of ['doctorId', 'serviceId']) {
    if (filters[key] !== 'all' && !/^[1-9]\d*$/.test(String(filters[key]))) throw new Error('Choose a valid dentist and service.');
  }
  return { start, end };
};

// Fetch every page rather than silently reporting only Supabase's first page.
// Stable IDs and exact counts also detect changes during a multi-page read.
export const readReportRows = async (makeQuery, idField, label, isCurrent = () => true) => {
  const rows = [], ids = new Set();
  let expected;
  while (true) {
    if (!isCurrent()) throw new Error('Report request superseded.');
    const { data, error, count } = await makeQuery().order(idField).range(rows.length, rows.length + 499);
    if (error) throw new Error(`Could not load ${label}. Please retry.`);
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new Error(`Could not verify ${label}. Please retry.`);
    if (expected === undefined) expected = count;
    if (count !== expected) throw new Error('Records changed while the report was loading. Please generate it again.');
    for (const row of data) {
      if (row[idField] == null || ids.has(String(row[idField]))) throw new Error(`Could not verify all ${label}. Please retry.`);
      ids.add(String(row[idField])); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error(`Incomplete ${label}. Please retry.`);
  }
};

export const loadReportOptions = async (client, isCurrent) => {
  const [doctors, services] = await Promise.all([
    readReportRows(() => client.from('doctors').select('doctor_id, first_name, last_name, status', { count: 'exact' }), 'doctor_id', 'dentist filters', isCurrent),
    readReportRows(() => client.from('services').select('service_id, service_name, status', { count: 'exact' }), 'service_id', 'service filters', isCurrent),
  ]);
  return { doctors, services };
};

const completedRows = (appointments, now) => appointments.filter(row => row.status === 'completed'
  && new Date(row.appointment_end || row.appointment_datetime).getTime() <= now.getTime());
const ageGroup = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return 'Not specified';
  return value < 18 ? 'Under 18' : value <= 30 ? '18–30' : value <= 50 ? '31–50' : 'Over 50';
};
const groupBills = (bills, field, getName) => {
  const groups = new Map();
  bills.forEach(row => {
    const key = row[field] ?? 'unknown';
    if (!groups.has(key)) groups.set(key, { id: key, name: getName(row), bills: [] });
    groups.get(key).bills.push(row);
  });
  return [...groups.values()].map(group => ({ id: group.id, name: group.name, count: group.bills.length,
    paid: sum(group.bills, 'amount_paid'), balance: sum(group.bills, 'balance') })).sort((a, b) => b.paid - a.paid);
};

export const buildClinicReport = ({ filters, appointments = [], bills = [], registrations = [], history = [], services = [], items = [], now = new Date() }) => {
  const completed = completedRows(appointments, now);
  const unique = new Set(completed.map(row => row.patient_id).filter(id => id != null));
  const result = { filters: { ...filters }, generatedAt: now.toISOString(), appointments, completed, bills,
    summary: [], notes: [], charts: [], tables: [] };
  const card = (label, value, money = false) => ({ label, value, money });
  const chart = (title, rows, field, money = false) => ({ title, labels: rows.map(row => row.name), values: rows.map(row => row[field]), money });
  if (filters.reportType === 'financial') {
    const gross = sum(bills, 'total_amount'), discounts = sum(bills, 'discount');
    const net = Math.round((gross - discounts) * 100) / 100, paid = sum(bills, 'amount_paid'), balance = sum(bills, 'balance');
    result.summary = [card('Gross billed', gross, true), card('Discounts', discounts, true), card('Net billed', net, true), card('Paid to date', paid, true), card('Outstanding now', balance, true)];
    result.notes.push('Bills created in the selected period, including archived bills. Paid and outstanding amounts are current totals for those bills, not cash received during the period.');
    result.notes.push('Individual instalment dates and payment methods are not stored as separate transactions. Exact daily collections and historical payment-method totals are unavailable.');
    if (bills.some(row => cents(row.total_amount) - cents(row.discount) !== cents(row.amount_paid) + cents(row.balance))) result.notes.push('Some bills do not reconcile: net billed differs from paid plus balance. Review these source bills before using the totals.');
    const daily = new Map();
    bills.forEach(row => { const day = getClinicDate(new Date(row.created_at)); daily.set(day, (daily.get(day) || 0) + cents(row.total_amount) - cents(row.discount)); });
    result.charts = [chart('Net billed by bill creation date', [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value: value / 100 })), 'value', true)];
    const patientTotals = groupBills(bills, 'patient_id', patientName);
    result.tables.push({ title: 'Patient billing summary — top 10 by paid to date', columns: ['Patient', 'Bills', 'Paid to date', 'Outstanding now'], rows: patientTotals.slice(0, 10).map(row => [row.name, row.count, formatReportCurrency(row.paid), formatReportCurrency(row.balance)]) });
    const financialServices = new Map();
    bills.forEach(row => {
      const appointment = reportRelation(row.appointments), service = reportRelation(appointment?.services);
      const key = appointment?.service_id ?? 'unknown';
      if (!financialServices.has(key)) financialServices.set(key, { name: service?.service_name || 'Unlinked service', rows: [] });
      financialServices.get(key).rows.push(row);
    });
    result.tables.push({ title: 'Billing by service — bills created in period', columns: ['Service', 'Bills', 'Net billed', 'Paid to date'], rows: [...financialServices.values()].map(group => [group.name, group.rows.length, formatReportCurrency(Math.round((sum(group.rows, 'total_amount') - sum(group.rows, 'discount')) * 100) / 100), formatReportCurrency(sum(group.rows, 'amount_paid'))]) });
    result.tables.push({ title: 'Outstanding bills from this period', columns: ['Bill', 'Patient', 'Created', 'Net billed', 'Paid to date', 'Balance', 'Latest recorded method', 'Latest payment date'], rows: bills.filter(row => Number(row.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance)).map(row => [`#${row.billing_id}`, patientName(row), formatReportDate(row.created_at), formatReportCurrency((cents(row.total_amount) - cents(row.discount)) / 100), formatReportCurrency(row.amount_paid || 0), formatReportCurrency(row.balance), row.payment_method || 'Not recorded', formatReportDate(row.payment_date)]) });
  } else if (filters.reportType === 'appointments') {
    const statuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    const counts = statuses.map(status => ({ name: status === 'completed' ? 'Recorded completed' : status.charAt(0).toUpperCase() + status.slice(1), value: appointments.filter(row => row.status === status).length }));
    result.summary = [card('Total bookings', appointments.length), ...counts.map(row => card(row.name, row.value)), card('Cancelled share', `${rate(counts[3].value, appointments.length)}%`)];
    result.notes.push('Completed is the stored scheduling status and may be set automatically after the appointment ends. It does not verify attendance or clinical treatment completion.');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(name => ({ name, value: 0 }));
    const hours = Array.from({ length: 24 }, (_, hour) => ({ name: `${String(hour).padStart(2, '0')}:00`, value: 0 }));
    appointments.forEach(row => {
      const date = new Date(row.appointment_datetime);
      const day = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: CLINIC_TIME_ZONE });
      days.find(item => item.name === day).value++;
      const hour = Number(date.toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: CLINIC_TIME_ZONE }));
      hours[hour].value++;
    });
    result.charts = [chart('Bookings by weekday (Manila)', days, 'value'), chart('Bookings by start hour (Manila)', hours.filter(row => row.value), 'value')];
    result.tables.push({ title: 'Cancelled appointments in the selected period', columns: ['Patient', 'Dentist', 'Appointment date', 'Booked on', 'Remarks'], rows: appointments.filter(row => row.status === 'cancelled').sort((a, b) => b.appointment_datetime.localeCompare(a.appointment_datetime)).map(row => [patientName(row), doctorName(row), formatReportDate(row.appointment_datetime), formatReportDate(row.created_at), row.remarks || 'Not recorded']) });
    result.notes.push('Cancellation notice time is not reported because a structured cancellation timestamp is unavailable. Remarks can include automatic expiry and cancellation details.');
  } else if (filters.reportType === 'patients') {
    const firstCompleted = new Map();
    completedRows(history, now).forEach(row => {
      if (!firstCompleted.has(row.patient_id) || new Date(row.appointment_datetime) < new Date(firstCompleted.get(row.patient_id))) firstCompleted.set(row.patient_id, row.appointment_datetime);
    });
    const bounds = validateReportFilters(filters);
    const firstInPeriod = [...unique].filter(id => new Date(firstCompleted.get(id)).getTime() >= new Date(bounds.start).getTime()).length;
    result.summary = [card('Unique patients — recorded completed', unique.size), card('First recorded completed in period', firstInPeriod), card('Previously recorded patients', unique.size - firstInPeriod), card('New registrations — clinic-wide', registrations.length)];
    result.notes.push('Patient activity uses past appointments with the stored completed status. This may be automatic; it is not verified attendance. Each patient is counted once in demographics.');
    result.notes.push('First recorded completed means the earliest retained completed appointment across all dentists/services. Deleted or missing historical records cannot be reconstructed. Registration counts are clinic-wide and are not filtered by dentist or service.');
    const byPatient = new Map();
    completed.forEach(row => { if (!byPatient.has(row.patient_id)) byPatient.set(row.patient_id, []); byPatient.get(row.patient_id).push(row); });
    const ages = new Map(['Under 18', '18–30', '31–50', 'Over 50', 'Not specified'].map(group => [group, 0]));
    byPatient.forEach(rows => { const group = ageGroup(reportRelation(rows[0].patients)?.age); ages.set(group, ages.get(group) + 1); });
    const ageRows = [...ages].map(([name, value]) => ({ name, value }));
    const months = new Map();
    registrations.forEach(row => { const month = getClinicDate(new Date(row.date_created)).slice(0, 7); months.set(month, (months.get(month) || 0) + 1); });
    result.charts = [chart('Unique patients by current recorded age', ageRows, 'value'), chart('New registrations — clinic-wide', [...months].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value })), 'value')];
    result.tables.push({ title: 'Unique-patient demographics', columns: ['Age group', 'Patients', 'Share'], rows: ageRows.map(row => [row.name, row.value, `${rate(row.value, unique.size)}%`]) });
    result.tables.push({ title: 'Frequent recorded completed appointments — top 15', columns: ['Patient', 'Appointments', 'First in period', 'Last in period', 'Average days between'], rows: [...byPatient.values()].sort((a, b) => b.length - a.length).slice(0, 15).map(rows => {
      const sorted = rows.map(row => row.appointment_datetime).sort((a, b) => new Date(a) - new Date(b));
      return [patientName(rows[0]), rows.length, formatReportDate(sorted[0]), formatReportDate(sorted[sorted.length - 1]), sorted.length > 1 ? ((new Date(sorted[sorted.length - 1]) - new Date(sorted[0])) / 86400000 / (sorted.length - 1)).toFixed(1) : '—'];
    }) });
    const serviceAges = new Map();
    completed.forEach(row => {
      const group = ageGroup(reportRelation(row.patients)?.age), key = `${row.service_id}|${group}`;
      if (!serviceAges.has(key)) serviceAges.set(key, { name: serviceName(row), group, count: 0 });
      serviceAges.get(key).count++;
    });
    result.tables.push({ title: 'Recorded completed appointments by service and age', columns: ['Service', 'Age group', 'Appointments'], rows: [...serviceAges.values()].map(row => [row.name, row.group, row.count]) });
  } else if (filters.reportType === 'services' || filters.reportType === 'doctors') {
    const isService = filters.reportType === 'services', field = isService ? 'service_id' : 'doctor_id';
    const groups = new Map();
    if (isService) services.filter(row => row.status === 'active' && (filters.serviceId === 'all' || String(row.service_id) === String(filters.serviceId))).forEach(row => groups.set(row.service_id, { name: row.service_name, status: row.status, appointments: [], bills: [] }));
    appointments.forEach(row => {
      if (!groups.has(row[field])) groups.set(row[field], { name: isService ? serviceName(row) : doctorName(row), status: reportRelation(row.services)?.status, appointments: [], bills: [] });
      groups.get(row[field]).appointments.push(row);
    });
    bills.forEach(bill => {
      const appointment = reportRelation(bill.appointments), key = isService ? appointment?.service_id : bill.doctor_id;
      if (!groups.has(key)) groups.set(key, { name: isService ? serviceName(appointment || {}) : doctorName(bill), appointments: [], bills: [] });
      groups.get(key).bills.push(bill);
    });
    const rows = [...groups.values()].map(group => {
      const done = completedRows(group.appointments, now), patients = new Map();
      done.forEach(row => patients.set(row.patient_id, (patients.get(row.patient_id) || 0) + 1));
      const scheduled = group.appointments.filter(row => row.status !== 'cancelled');
      const unknownDuration = scheduled.filter(row => !Number.isFinite(Number(row.scheduled_duration_minutes)) || Number(row.scheduled_duration_minutes) <= 0).length;
      return { ...group, count: group.appointments.length, done: done.length,
        cancelled: group.appointments.filter(row => row.status === 'cancelled').length,
        paid: sum(group.bills, 'amount_paid'), net: Math.round((sum(group.bills, 'total_amount') - sum(group.bills, 'discount')) * 100) / 100,
        unique: patients.size, repeat: [...patients.values()].filter(count => count > 1).length,
        hours: scheduled.reduce((total, row) => total + (Number(row.scheduled_duration_minutes) > 0 ? Number(row.scheduled_duration_minutes) : 0), 0) / 60, unknownDuration };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    result.summary = [card('Total bookings', appointments.length), card('Past recorded completed', completed.length), card(isService ? 'Services shown' : 'Dentists shown', rows.length), card('Paid to date — bills created in period', sum(bills, 'amount_paid'), true)];
    result.notes.push('Bookings use appointment dates. Billing columns use bills created in the selected period, including archived bills, with amounts paid to date. These are different cohorts and do not measure cash received during the period.');
    result.notes.push('Recorded completed can be assigned automatically after the scheduled end; it does not verify attendance or clinical outcomes.');
    result.charts = [chart(isService ? 'Bookings by service' : 'Bookings by dentist', rows, 'count'), chart('Paid to date — bills created in period', rows, 'paid', true)];
    if (isService) result.tables.push({ title: 'Services — active catalogue and historical activity', columns: ['Service', 'Bookings', 'Recorded completed', 'Cancelled', 'Booking share', 'Net billed', 'Paid to date'], rows: rows.map(row => [row.name, row.count, row.done, row.cancelled, `${rate(row.count, appointments.length)}%`, formatReportCurrency(row.net), formatReportCurrency(row.paid)]) });
    else {
      result.tables.push({ title: 'Dentist workload', columns: ['Dentist', 'Bookings', 'Recorded completed', 'Cancelled', 'Known scheduled hours', 'Missing durations', 'Unique patients¹', 'Net billed', 'Paid to date'], rows: rows.map(row => [row.name, row.count, row.done, row.cancelled, row.hours.toFixed(1), row.unknownDuration, row.unique, formatReportCurrency(row.net), formatReportCurrency(row.paid)]) });
      result.tables.push({ title: 'Repeat-patient activity¹', columns: ['Dentist', 'Unique patients', 'Repeat patients', 'Repeat share'], rows: rows.map(row => [row.name, row.unique, row.repeat, `${rate(row.repeat, row.unique)}%`]) });
      result.notes.push('¹ Patient counts and repeat activity use past recorded completed appointments in this period. Repeat activity is not a patient-satisfaction score. Known scheduled hours exclude cancellations and use saved appointment durations, not current service durations. Missing durations are shown separately.');
    }
  } else if (filters.reportType === 'inventory') {
    const rows = items.map(row => {
      const stock = numeric(row.stock_quantity, 'stock quantity'), reorder = numeric(row.reorder_level, 'reorder level');
      const cost = row.unit_cost == null || row.unit_cost === '' ? null : numeric(row.unit_cost, 'unit cost');
      return { ...row, stock, reorder, value: cost == null ? null : Math.round(stock * cents(cost)) / 100,
        state: stock === 0 ? 'Out of stock' : stock <= reorder ? 'Low stock' : 'Sufficient' };
    }).sort((a, b) => a.stock - a.reorder - (b.stock - b.reorder));
    result.summary = [card('Active inventory items', rows.length), card('Low stock (excluding zero)', rows.filter(row => row.state === 'Low stock').length), card('Out of stock', rows.filter(row => row.stock === 0).length), card('Known stock value', rows.reduce((total, row) => total + Math.round((row.value || 0) * 100), 0) / 100, true)];
    result.notes.push('Current active stock snapshot at generation time. Date, dentist and service filters do not apply. Values are quantity × recorded unit cost; missing costs are excluded. This is not historical stock consumption or profit.');
    if (rows.some(row => row.value == null)) result.notes.push(`${rows.filter(row => row.value == null).length} item(s) have no recorded unit cost and are excluded from known stock value.`);
    result.tables.push({ title: 'Inventory and reorder review', columns: ['Item', 'Category', 'Quantity', 'Unit', 'Reorder level', 'Status', 'Unit cost', 'Known value'], rows: rows.map(row => [row.item_name, row.category || 'Unspecified', row.stock, row.unit_type || '—', row.reorder, row.state, row.unit_cost == null || row.unit_cost === '' ? 'Not recorded' : formatReportCurrency(row.unit_cost), row.value == null ? 'Not recorded' : formatReportCurrency(row.value)]) });
  }
  return result;
};

export const loadClinicReport = async (client, filters, { isCurrent = () => true, now = new Date() } = {}) => {
  const bounds = validateReportFilters(filters);
  const read = (makeQuery, id, label) => readReportRows(makeQuery, id, label, isCurrent);
  if (filters.reportType === 'inventory') {
    const items = await read(() => client.from('inventory').select('item_id, item_name, category, stock_quantity, reorder_level, unit_type, unit_cost', { count: 'exact' }).eq('status', 'active'), 'item_id', 'inventory');
    return buildClinicReport({ filters, items, now });
  }
  const filter = query => {
    if (filters.doctorId !== 'all') query = query.eq('doctor_id', Number(filters.doctorId));
    return query;
  };
  const appointmentQuery = () => {
    let query = filter(client.from('appointments').select('appointment_id, patient_id, doctor_id, service_id, status, appointment_datetime, appointment_end, scheduled_duration_minutes, created_at, remarks, patients(first_name, last_name, age), doctors(first_name, last_name), services(service_name, status)', { count: 'exact' })
      .gte('appointment_datetime', bounds.start).lt('appointment_datetime', bounds.end));
    if (filters.serviceId !== 'all') query = query.eq('service_id', Number(filters.serviceId));
    return query;
  };
  const tasks = {};
  if (filters.reportType !== 'financial') tasks.appointments = read(appointmentQuery, 'appointment_id', 'appointments');
  if (['financial', 'services', 'doctors'].includes(filters.reportType)) tasks.bills = read(() => filter(client.from('billing').select('billing_id, appointment_id, patient_id, doctor_id, total_amount, discount, amount_paid, balance, payment_method, payment_date, created_at, archived, patients(first_name, last_name), doctors(first_name, last_name), appointments(service_id, services(service_name, status))', { count: 'exact' }).gte('created_at', bounds.start).lt('created_at', bounds.end)), 'billing_id', 'billing records');
  if (filters.reportType === 'services') tasks.services = read(() => client.from('services').select('service_id, service_name, status', { count: 'exact' }), 'service_id', 'service catalogue');
  if (filters.reportType === 'patients') {
    tasks.registrations = read(() => client.from('patients').select('patient_id, date_created', { count: 'exact' }).gte('date_created', bounds.start).lt('date_created', bounds.end), 'patient_id', 'patient registrations');
    tasks.history = read(() => client.from('appointments').select('appointment_id, patient_id, status, appointment_datetime, appointment_end', { count: 'exact' }).eq('status', 'completed').lt('appointment_datetime', bounds.end), 'appointment_id', 'completed appointment history');
  }
  const entries = await Promise.all(Object.entries(tasks).map(async ([key, promise]) => [key, await promise]));
  const data = Object.fromEntries(entries);
  if (data.bills && filters.serviceId !== 'all') data.bills = data.bills.filter(bill => String(reportRelation(bill.appointments)?.service_id) === String(filters.serviceId));
  return buildClinicReport({ filters, ...data, now });
};
