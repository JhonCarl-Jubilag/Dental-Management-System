import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { changeAccountEmail } from '../_shared/changeAccountEmail.js';
import { requireClinicAccount } from '../_shared/clinicAccess.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requiredText = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new RequestError(`${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
};
const optionalText = (value, label, max) => {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  return requiredText(value, label, max);
};
const emailPattern = (email) => email.replace(/[\\%_]/g, '\\$&');
const birthDetails = (value) => {
  if (value == null || value === '') return { birthday: null, age: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError('Enter a valid birthday.');
  }
  const birthDate = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== value) {
    throw new RequestError('Enter a valid birthday.');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const today = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  if (value > `${today.year}-${today.month}-${today.day}`) {
    throw new RequestError('Birthday cannot be in the future.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const birthdayPending = Number(today.month) < month ||
    (Number(today.month) === month && Number(today.day) < day);
  return { birthday: value, age: Number(today.year) - year - (birthdayPending ? 1 : 0) };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  let createdUserId = null;
  const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const { data: { user }, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !user?.email || !user.email_confirmed_at) throw new RequestError('Please log in again.', 401);
    // Use the verified identity and protected admin records for authorization.
    const { isOwner: isSuperAdmin } = await requireClinicAccount(client, user, RequestError);

    let body;
    try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');

    if (body.action === 'change_email') {
      if (!isSuperAdmin) throw new RequestError('Only the super admin can change login emails.', 403);
      return response(200, await changeAccountEmail(client, {
        table: 'patients', idField: 'patient_id', id: body.patient_id,
        newEmail: body.new_email, expectedEmail: body.expected_email,
      }, RequestError));
    }

    if (body.action === 'send_reset_email') {
      const patientId = Number(body.patient_id);
      if (!Number.isSafeInteger(patientId) || patientId <= 0) throw new RequestError('Select a valid patient.');
      const { data: patient, error } = await client.from('patients')
        .select('email, status').eq('patient_id', patientId).single();
      if (error || !patient) throw new RequestError('Patient was not found.', 404);
      if (patient.status !== 'active') throw new RequestError('Activate this patient before sending a reset email.');
      // Recovery requests intentionally hide missing accounts from public callers.
      // Check the account here so the administrator gets an accurate result.
      let accountFound = false;
      for (let page = 1; ; page++) {
        const { data, error: listError } = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (listError) throw new RequestError('Could not verify the patient login account.', 500);
        if (data.users.some(account => account.email?.toLowerCase() === patient.email.toLowerCase())) {
          accountFound = true;
          break;
        }
        if (data.users.length < 100) break;
      }
      if (!accountFound) throw new RequestError('This patient profile has no login account. A login account must be provisioned first.', 409);

      // Supabase Auth must allow this origin's /reset-password URL.
      const origin = req.headers.get('Origin') || Deno.env.get('APP_ORIGIN');
      if (!origin) throw new RequestError('Configure APP_ORIGIN before requesting a password reset.', 500);
      let appUrl;
      try { appUrl = new URL(origin); } catch { throw new RequestError('Invalid application origin.'); }
      const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
      if ((appUrl.protocol !== 'https:' && !(appUrl.protocol === 'http:' && isLocalhost)) ||
        appUrl.username || appUrl.password || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
        throw new RequestError('Invalid application origin.');
      }
      const { error: resetError } = await client.auth.resetPasswordForEmail(patient.email, {
        redirectTo: `${appUrl.origin}/reset-password`,
      });
      if (resetError) throw new RequestError(resetError.message);
      return response(200, { success: true, message: 'Password reset email requested successfully. Ask the patient to check their inbox.' });
    }

    if (body.action !== 'create') throw new RequestError('Unsupported account action.');
    const firstName = requiredText(body.first_name, 'First name');
    const lastName = requiredText(body.last_name, 'Last name');
    const email = requiredText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email address.');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 4096) {
      throw new RequestError('Password must contain at least 8 characters and at most 4096 characters.');
    }
    const contact = optionalText(body.contact_no, 'Contact number', 50);
    const address = optionalText(body.address, 'Address', 2000);
    const { birthday, age } = birthDetails(body.birthday);
    // Reject duplicate clinic/provider/patient profiles during the transition.
    for (const table of ['patients', 'doctors', 'admin']) {
      const { data, error } = await client.from(table).select('email').ilike('email', emailPattern(email)).limit(1);
      if (error) throw new RequestError('Could not check for existing accounts.', 500);
      if (data?.length) throw new RequestError('This email is already assigned to a profile. Use a different email.', 409);
    }
    const { data: auth, error: authError } = await client.auth.admin.createUser({
      email, password: body.password, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (authError || !auth.user) throw new RequestError(authError?.message || 'Could not create the login account.');
    createdUserId = auth.user.id;
    const { data: patient, error: profileError } = await client.from('patients').insert({
      first_name: firstName, last_name: lastName, email, auth_user_id: createdUserId,
      contact_no: contact, address, birthday, age, email_verified: true, status: 'active',
    }).select('patient_id').single();
    if (profileError || !patient) throw new RequestError('Could not create the patient profile.', 500);
    return response(200, { success: true, patient_id: patient.patient_id });
  } catch (error) {
    // Roll back only the Auth account created by this request.
    if (createdUserId) {
      let cleanupFailed = false;
      try {
        const { error: cleanupError } = await client.auth.admin.deleteUser(createdUserId);
        cleanupFailed = !!cleanupError;
      } catch { cleanupFailed = true; }
      if (cleanupFailed) {
        try { await client.auth.admin.updateUserById(createdUserId, { ban_duration: '876000h' }); } catch { /* Report cleanup failure below. */ }
        console.error('Patient account rollback needs administrator attention.');
        return response(500, { error: 'Account creation failed and cleanup could not finish. Check the Auth account before retrying.' });
      }
    }
    return response(error instanceof RequestError ? error.status : 500, {
      error: error instanceof RequestError ? error.message : 'Could not manage the patient account. Please try again.',
    });
  }
});
