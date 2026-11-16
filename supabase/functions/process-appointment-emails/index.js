import { createClient } from 'npm:@supabase/supabase-js@2.105.1';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clock = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_appointment_time');
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(date) + ' (Philippine time)';
};
function emailContent(job) {
  const copy = {
    booking_received: ['Appointment request received', 'We received your booking request. Your appointment is PENDING and still needs clinic confirmation.'],
    appointment_confirmed: ['Appointment confirmed', 'Your appointment has been CONFIRMED by the clinic.'],
    appointment_rescheduled: ['Appointment schedule updated', 'Your appointment schedule has been updated.'
      + (job.appointment_status === 'pending' ? ' It is still PENDING and needs clinic confirmation.' : ' Your appointment is CONFIRMED.')],
    appointment_cancelled: ['Appointment cancelled', 'Your appointment has been CANCELLED. You no longer need to attend this appointment.'],
    change_requested: ['Appointment change request received', 'We received your request to '
      + (job.request_type === 'cancellation' ? 'cancel' : 'reschedule')
      + ' your appointment. Your original schedule remains in place until the clinic approves the request.'],
    change_declined: ['Appointment change request declined', 'The clinic declined your appointment change request. Your existing confirmed schedule remains in place. Please contact the clinic if you need assistance.'],
    reminder_24h: ['Appointment reminder for tomorrow', 'This is a reminder about your CONFIRMED appointment, scheduled approximately 24 hours from now.'],
  };
  const selected = copy[job.event_kind];
  if (!selected) throw new Error('invalid_event_kind');
  const site = new URL(job.app_url);
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('invalid_app_url');
  }
  if (!Number.isSafeInteger(Number(job.appointment_id)) || Number(job.appointment_id) <= 0) throw new Error('invalid_appointment_id');
  const dentist = typeof job.doctor_name === 'string' ? job.doctor_name.replace(/[\r\n]+/g, ' ').slice(0, 200) : 'Your clinic dentist';
  return {
    subject: 'Diolata Dental Clinic - ' + selected[0],
    textContent: 'Diolata Dental Clinic\n\n' + selected[1]
      + '\n\nAppointment reference: #' + job.appointment_id
      + '\nSchedule: ' + clock(job.appointment_datetime)
      + '\nDentist: ' + dentist
      + '\n\nClinic: 150 Sara St., Sarah Subd. Bayan Luma 3 Imus City, Cavite'
      + '\nPhone: 0930 482 0352'
      + '\n\nView your appointment or request a change (login required): ' + site.origin + '/my-appointments'
      + '\n\nTreatment details and the final fee will be discussed after your oral examination.'
      + '\n\nThis is an automatic appointment update. For assistance, contact the clinic.',
  };
}

// Scheduled-only endpoint. Platform JWT verification is disabled because Cron
// uses a private Vault-generated token, not a signed-in patient's JWT.
// Every queue RPC independently verifies that token and is service-role-only.
Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const token = req.headers.get('x-clinic-email-job');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return json(401, { error: 'Email worker authentication required.' });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('BREVO_API_KEY')?.trim();
  const sender = Deno.env.get('BREVO_SENDER_EMAIL')?.trim().toLowerCase();
  if (!url || !serviceKey || !apiKey || !validEmail(sender)) return json(503, { error: 'Email sender configuration is incomplete.' });
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobs, error: claimError } = await client.rpc('claim_appointment_emails', { p_token: token, p_limit: 5 });
  if (claimError) return json(claimError.code === '42501' ? 403 : 503, { error: 'Could not authorize or claim email jobs.' });
  if (!Array.isArray(jobs) || jobs.length > 5) return json(503, { error: 'Invalid email queue result.' });
  const totals = { accepted: 0, skipped: 0, retry: 0, failed: 0, needs_review: 0, result_not_saved: 0 };
  let paused = false;
  const finish = async (job, outcome, code = null, messageId = null) => {
    const { data, error } = await client.rpc('finish_appointment_email', {
      p_token: token, p_notification_id: job.notification_id, p_lease_token: job.lease_token,
      p_outcome: outcome, p_code: code, p_message_id: messageId,
    });
    if (error || data !== true) {
      totals.result_not_saved += 1;
      // Do not resend inside this request. An expired lease recovers with the
      // same idempotency key; older uncertain jobs require manual review.
      console.error('Appointment email result not saved.', job.notification_id, code || outcome);
    } else totals[outcome] += 1;
  };
  for (const job of jobs) {
    if (!validUuid(job?.notification_id) || !validUuid(job?.lease_token)) return json(503, { error: 'Invalid email job identity.' });
    if (paused) { await finish(job, 'retry', 'provider_paused'); continue; }
    const { data: details, error: readError } = await client.rpc('prepare_appointment_email', {
      p_token: token, p_notification_id: job.notification_id, p_lease_token: job.lease_token,
    });
    if (readError) { await finish(job, 'retry', 'prepare_failed'); continue; }
    if (!details) { totals.skipped += 1; continue; }
    let content;
    try {
      if (details.notification_id !== job.notification_id || !validEmail(details.recipient)) throw new Error('invalid_recipient');
      content = emailContent(details);
    } catch { await finish(job, 'failed', 'invalid_email_payload'); continue; }
    let result;
    try {
      result = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          sender: { name: 'Diolata Dental Clinic', email: sender }, to: [{ email: details.recipient }],
          replyTo: { name: 'Diolata Dental Clinic', email: 'diolatadental.clinic@yahoo.com.ph' },
          ...content, headers: { idempotencyKey: job.notification_id.replaceAll('-', '') },
          tags: ['clinic-appointment', details.event_kind],
        }),
      });
    } catch {
      // A timeout can arrive after acceptance. Automatic retries are bounded
      // by the provider's idempotency window in claim_appointment_emails.
      await finish(job, 'retry', 'network_uncertain'); continue;
    }
    let body;
    try { body = await result.json(); } catch { body = null; }
    if (result.ok && typeof body?.messageId === 'string' && body.messageId.length > 0) {
      await finish(job, 'accepted', null, body.messageId);
    } else if (!result.ok && body?.code === 'duplicate_parameter') {
      await finish(job, 'accepted', 'provider_duplicate');
    } else if (result.status === 401 || result.status === 403) {
      paused = true;
      await finish(job, 'failed', result.status === 401 ? 'provider_auth' : 'provider_access');
    } else if (result.status === 429 || body?.code === 'not_enough_credits') {
      paused = true; await finish(job, 'retry', 'provider_quota');
    } else if (result.status >= 500 || result.ok || !body) {
      await finish(job, 'retry', 'provider_uncertain');
    } else {
      await finish(job, 'failed', 'provider_rejected');
    }
  }
  console.info('Appointment email batch completed.', JSON.stringify(totals));
  return json(200, { success: true, ...totals });
});
