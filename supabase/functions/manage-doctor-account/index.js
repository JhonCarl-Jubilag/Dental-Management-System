import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { changeAccountEmail } from '../_shared/changeAccountEmail.js';
import { requireClinicAccount } from '../_shared/clinicAccess.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
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
const emailPattern = (email) => email.replace(/[\\%_]/g, '\\$&');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  let createdUserId = null;
  let createdDoctorId = null;
  const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const { data: { user }, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !user?.email || !user.email_confirmed_at) throw new RequestError('Please log in again.', 401);

    // Authorization comes from the verified Auth identity and protected admin
    // records, never from editable user_metadata or a role supplied by the form.
    const { isOwner: isSuperAdmin } = await requireClinicAccount(client, user, RequestError);

    let body;
    try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');

    if (body.action === 'change_email') {
      if (!isSuperAdmin) throw new RequestError('Only the super admin can change login emails.', 403);
      return response(200, await changeAccountEmail(client, {
        table: 'doctors', idField: 'doctor_id', id: body.doctor_id,
        newEmail: body.new_email, expectedEmail: body.expected_email,
      }, RequestError));
    }

    if (body.action === 'send_reset_email') {
      const doctorId = Number(body.doctor_id);
      if (!Number.isSafeInteger(doctorId) || doctorId <= 0) throw new RequestError('Select a valid doctor.');
      const { data: doctor, error } = await client.from('doctors')
        .select('email, status').eq('doctor_id', doctorId).single();
      if (error || !doctor) throw new RequestError('Doctor was not found.', 404);
      if (doctor.status !== 'active') throw new RequestError('Activate this doctor before sending a reset email.');
      // Supabase deliberately does not report missing users from the public
      // recovery API. Check here so admins do not receive a false success.
      let accountFound = false;
      for (let page = 1; ; page++) {
        const { data, error: listError } = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (listError) throw new RequestError('Could not verify the doctor login account.', 500);
        if (data.users.some(account => account.email?.toLowerCase() === doctor.email.toLowerCase())) {
          accountFound = true;
          break;
        }
        if (data.users.length < 100) break;
      }
      if (!accountFound) throw new RequestError('This doctor profile has no login account. A login account must be provisioned first.', 409);

      // Browser requests use the current frontend origin. APP_ORIGIN is only
      // a fallback for callers without an Origin header. Supabase Auth checks
      // the redirect against the project's configured Redirect URLs.
      const origin = req.headers.get('Origin') || Deno.env.get('APP_ORIGIN');
      if (!origin) throw new RequestError('Configure APP_ORIGIN before requesting a password reset.', 500);
      let appUrl;
      try { appUrl = new URL(origin); } catch { throw new RequestError('Invalid application origin.'); }
      const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
      if ((appUrl.protocol !== 'https:' && !(appUrl.protocol === 'http:' && isLocalhost)) ||
        appUrl.username || appUrl.password || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
        throw new RequestError('Invalid application origin.');
      }
      const appOrigin = appUrl.origin;
      const redirectTo = `${appOrigin}/reset-password`;
      const { error: resetError } = await client.auth.resetPasswordForEmail(doctor.email, { redirectTo });
      if (resetError) throw new RequestError(resetError.message, 400);
      return response(200, { success: true, message: 'Password reset email requested successfully. Ask the doctor to check their inbox.' });
    }

    if (body.action !== 'create') throw new RequestError('Unsupported account action.');
    const firstName = requiredText(body.first_name, 'First name');
    const lastName = requiredText(body.last_name, 'Last name');
    const email = requiredText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email address.');
    if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 4096) {
      throw new RequestError('Password must contain at least 6 characters.');
    }
    if (!Array.isArray(body.service_ids) || body.service_ids.length > 100 ||
      body.service_ids.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      throw new RequestError('Select valid services.');
    }
    const serviceIds = [...new Set(body.service_ids)];
    // Reject cross-role email collisions: the existing login checks patients
    // before doctors and must never turn an existing account into a doctor.
    for (const table of ['patients', 'doctors', 'admin']) {
      const { data, error } = await client.from(table).select('email').ilike('email', emailPattern(email)).limit(1);
      if (error) throw new RequestError('Could not check for existing accounts.', 500);
      if (data?.length) throw new RequestError('This email is already assigned to a profile. Use a different email.', 409);
    }
    if (serviceIds.length) {
      const { data, error } = await client.from('services').select('service_id').in('service_id', serviceIds).eq('status', 'active');
      if (error || data?.length !== serviceIds.length) throw new RequestError('One or more selected services are unavailable.');
    }
    const specialization = body.specialization ? requiredText(body.specialization, 'Specialization') : null;
    const contact = body.contact_no ? requiredText(body.contact_no, 'Contact number', 50) : null;
    const { data: auth, error: authError } = await client.auth.admin.createUser({
      email, password: body.password, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (authError || !auth.user) throw new RequestError(authError?.message || 'Could not create the login account.');
    createdUserId = auth.user.id;
    const { data: doctor, error: doctorError } = await client.from('doctors').insert({
      first_name: firstName, last_name: lastName, email,
      password: null, specialization, contact_no: contact, status: 'active',
    }).select('doctor_id').single();
    if (doctorError || !doctor) throw new RequestError('Could not create the doctor profile.', 500);
    createdDoctorId = doctor.doctor_id;
    if (serviceIds.length) {
      const { error } = await client.from('doctor_services').insert(serviceIds.map(service_id => ({
        doctor_id: doctor.doctor_id, service_id, status: 'active',
      })));
      if (error) throw new RequestError('Could not assign doctor services.', 500);
    }
    return response(200, { success: true, doctor_id: doctor.doctor_id });
  } catch (error) {
    // Only undo records created by THIS request. Existing accounts are never
    // deleted or overwritten when email validation or Auth creation fails.
    let cleanupFailed = false;
    if (createdDoctorId !== null) {
      const { error } = await client.from('doctors').delete().eq('doctor_id', createdDoctorId);
      cleanupFailed = !!error;
    }
    if (createdUserId && !cleanupFailed) {
      const { error } = await client.auth.admin.deleteUser(createdUserId);
      cleanupFailed = cleanupFailed || !!error;
    }
    if (cleanupFailed) {
      if (createdDoctorId !== null) {
        await client.from('doctors').update({ status: 'inactive' }).eq('doctor_id', createdDoctorId);
      }
      if (createdUserId) {
        await client.auth.admin.updateUserById(createdUserId, { ban_duration: '876000h' });
      }
      console.error('Doctor account rollback needs administrator attention.');
      return response(500, { error: 'Account creation failed and cleanup could not finish. Check the doctor profile and Auth account before retrying.' });
    }
    return response(error instanceof RequestError ? error.status : 500, {
      error: error instanceof RequestError ? error.message : 'Could not manage the doctor account. Please try again.',
    });
  }
});
