import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { requireClinicAccount } from '../_shared/clinicAccess.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const validEmail = value => typeof value === 'string' && value.length <= 254
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// This endpoint is intentionally limited to an Owner connection test.
// Appointment notifications are not enabled by deploying it.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const projectUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!projectUrl || !serviceKey) throw new RequestError('The email function is missing its Supabase configuration.', 503);
    const client = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !identity?.user) throw new RequestError('Please log in again.', 401);
    const caller = await requireClinicAccount(client, identity.user, RequestError);
    if (!caller.isOwner) throw new RequestError('Only the Owner can test clinic emails.', 403);

    let body;
    try {
      const raw = await req.text();
      if (raw.length > 1024) throw new Error('Body too large');
      body = JSON.parse(raw);
    } catch { throw new RequestError('Invalid email test request.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !['status', 'send_test'].includes(body.action)) {
      throw new RequestError('Only email setup checks and test messages are supported.');
    }
    const apiKey = Deno.env.get('BREVO_API_KEY')?.trim();
    const sender = Deno.env.get('BREVO_SENDER_EMAIL')?.trim().toLowerCase();
    const recipient = identity.user.email?.trim().toLowerCase();
    if (!validEmail(recipient)) throw new RequestError('Your verified Owner account needs a valid email address.', 409);
    const missing = [];
    if (!apiKey) missing.push('BREVO_API_KEY');
    if (!validEmail(sender)) missing.push('BREVO_SENDER_EMAIL');
    if (body.action === 'status') return response(200, {
      success: true, configured: missing.length === 0, missing,
      sender: validEmail(sender) ? sender : null, recipient, patient_notifications_enabled: false,
    });
    if (missing.length) throw new RequestError('Add or correct these Edge Function secrets: ' + missing.join(', ') + '.', 409);

    // The server chooses the sender, recipient and content. Callers cannot use
    // this function as an email relay or include clinical data.
    // Repeated calls within the same half-hour use Brevo's duplicate protection.
    const windowId = Math.floor(Date.now() / (30 * 60 * 1000));
    const bytes = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(projectUrl + ':' + identity.user.id + ':' + windowId));
    const idempotencyKey = Array.from(new Uint8Array(bytes).slice(0, 16),
      byte => byte.toString(16).padStart(2, '0')).join('');
    let result;
    try {
      result = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          sender: { name: 'Diolata Dental Clinic', email: sender },
          to: [{ email: recipient }],
          replyTo: { name: 'Diolata Dental Clinic', email: sender },
          subject: 'Diolata Dental Clinic - email connection test',
          textContent: 'This is a test message from the Diolata Dental Clinic management system.\n\n'
            + 'Your system submitted this message through Brevo. No patient records or appointments were changed.\n\n'
            + 'Automatic booking emails and appointment reminders are not enabled yet.',
          headers: { idempotencyKey },
          tags: ['clinic-connection-test'],
        }),
      });
    } catch {
      throw new RequestError('Could not confirm Brevo\'s response. Check your inbox and Brevo transactional logs before retrying; the message may have been accepted.', 504);
    }
    let data;
    try { data = await result.json(); } catch { data = null; }
    if (!result.ok) {
      if (data?.code === 'duplicate_parameter') return response(200, {
        success: true, status: 'already_submitted', recipient,
        message: 'Brevo reports that this test was already submitted. Check your inbox and Brevo transactional logs.',
      });
      // The Owner needs the rejection reason to finish provider setup. Redact
      // credentials and addresses before showing the provider's short message.
      const providerDetail = typeof data?.message === 'string'
        ? data.message.split(apiKey).join('[redacted]').split(serviceKey).join('[redacted]')
          .replace(/[^\s<>@]+@[^\s<>@]+/g, '[email]').replace(/[\r\n]+/g, ' ').slice(0, 300)
        : '';
      const detail = providerDetail ? ' Brevo: ' + providerDetail : '';
      if (result.status === 401) throw new RequestError('Brevo rejected the API key. Check BREVO_API_KEY in Supabase Secrets.', 502);
      if (result.status === 403) throw new RequestError('Brevo denied sending. Check Transactional email permissions, account activation, and any Brevo security alerts.', 502);
      if (result.status === 429) throw new RequestError('Brevo is limiting requests. Wait before trying again and check your sending allowance.', 429);
      if (data?.code === 'not_enough_credits') throw new RequestError('Brevo has no remaining sending credits. Check your daily allowance before retrying.', 429);
      if (result.status === 400) throw new RequestError('Brevo rejected the test.' + detail + ' Check sender verification and transactional sending activation.', 502);
      throw new RequestError('Brevo could not accept the test. Review Brevo transactional logs before retrying.', 502);
    }
    if (typeof data?.messageId !== 'string' || !data.messageId) {
      throw new RequestError('Brevo responded without a message reference. Check its transactional logs before retrying.', 502);
    }
    return response(200, {
      success: true, status: 'accepted', recipient, message_id: data.messageId,
      message: 'Brevo accepted the test email. Check your inbox and spam folder; acceptance does not guarantee delivery.',
    });
  } catch (error) {
    return response(error instanceof RequestError ? error.status : 500, {
      error: error instanceof RequestError ? error.message : 'Could not complete the email test.',
    });
  }
});
