import { createClient } from 'npm:@supabase/supabase-js@2.105.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
class RequestError extends Error {
  constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; }
}
const fields = 'patient_id, first_name, last_name, email, address, contact_no, birthday, age, status, email_verified, date_created';
const emailPattern = email => email.replace(/[\\%_]/g, '\\$&');
const requiredText = (value, label, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new RequestError(`${label} is required and must be at most ${max} characters.`, 400, 'profile_details_required');
  }
  return value.trim();
};
const registrationProfile = (data, email) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RequestError('Please complete your patient registration details.', 409, 'profile_details_required');
  }
  const firstName = requiredText(data.first_name, 'First name', 200);
  const lastName = requiredText(data.last_name, 'Last name', 200);
  const address = requiredText(data.address, 'Address', 2000);
  const contact = requiredText(data.contact_no, 'Contact number', 50);
  if (address.length < 5 || !/^\d{11}$/.test(contact)) {
    throw new RequestError('Enter a valid address and an 11-digit contact number.', 400, 'profile_details_required');
  }
  const birthday = data.birthday;
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    throw new RequestError('Enter a valid birthday.', 400, 'profile_details_required');
  }
  const date = new Date(`${birthday}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) {
    throw new RequestError('Enter a valid birthday.', 400, 'profile_details_required');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const today = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const [year, month, day] = birthday.split('-').map(Number);
  const pending = Number(today.month) < month || (Number(today.month) === month && Number(today.day) < day);
  const age = Number(today.year) - year - (pending ? 1 : 0);
  if (age < 5) throw new RequestError('You must be at least 5 years old.', 400, 'profile_details_required');
  return { first_name: firstName, last_name: lastName, email, address, contact_no: contact, birthday, age, email_verified: true, status: 'active' };
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await client.auth.getUser(authorization.slice(7));
    if (userError || !user?.email || !user.email_confirmed_at) {
      throw new RequestError('Verify your email and log in before completing registration.', 401);
    }
    const email = user.email.trim().toLowerCase();
    const { data: clinicAccount, error: clinicError } = await client.from('admin')
      .select('admin_id').eq('auth_user_id', user.id).maybeSingle();
    if (clinicError) throw new RequestError('Could not verify the account profile.', 500);
    if (clinicAccount) throw new RequestError('Clinic accounts cannot create a patient profile here.', 403);
    // Eligibility is checked against protected profiles. Metadata supplies form
    // values only; editable user_type/role claims never authorize staff access.
    for (const table of ['doctors', 'admin']) {
      const { data, error } = await client.from(table).select('email').ilike('email', emailPattern(email)).limit(1);
      if (error) throw new RequestError('Could not verify the account profile.', 500);
      if (data?.length) throw new RequestError('Staff accounts cannot create a patient profile here.', 403);
    }
    const readPatient = async () => {
      const patientFields = `${fields}, auth_user_id`;
      let { data, error } = await client.from('patients').select(patientFields).eq('auth_user_id', user.id).maybeSingle();
      if (error) throw new RequestError('Could not read the patient profile.', 500);
      if (!data) {
        const result = await client.from('patients').select(patientFields).ilike('email', emailPattern(email)).maybeSingle();
        if (result.error) throw new RequestError('Could not read the patient profile.', 500);
        data = result.data;
      }
      if (data && data.status !== 'active') throw new RequestError('This patient account is inactive. Contact the clinic.', 403);
      if (data?.auth_user_id && data.auth_user_id !== user.id) {
        throw new RequestError('This patient profile is linked to another login. Contact the clinic.', 409);
      }
      if (data && !data.auth_user_id) {
        const linked = await client.from('patients').update({ auth_user_id: user.id, email_verified: true })
          .eq('patient_id', data.patient_id).eq('email', data.email).eq('status', 'active')
          .is('auth_user_id', null).select(patientFields).maybeSingle();
        if (linked.error) throw new RequestError('Could not link your patient account. Please log in again.', 409);
        if (!linked.data) {
          const latest = await client.from('patients').select(patientFields).eq('auth_user_id', user.id).maybeSingle();
          if (latest.error || !latest.data || latest.data.status !== 'active') {
            throw new RequestError('The patient profile changed while linking. Please log in again.', 409);
          }
          data = latest.data;
        } else data = linked.data;
      }
      return data;
    };
    let patient = await readPatient();
    if (!patient) {
      let body;
      try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');
      const profile = { ...registrationProfile(body.profile ?? user.user_metadata?.registration_profile, email), auth_user_id: user.id };
      // Ignore duplicates rather than replacing a profile created by another
      // verification tab or retry. The existing unique email constraint applies.
      const { error } = await client.from('patients').upsert(profile, { onConflict: 'email', ignoreDuplicates: true });
      if (error) throw new RequestError('Could not save your patient profile. Please try again.', 500);
      patient = await readPatient();
      if (!patient?.patient_id) throw new RequestError('Patient registration is not complete. Please try again.', 500);
    }
    return response(200, { success: true, patient });
  } catch (error) {
    return response(error instanceof RequestError ? error.status : 500, {
      error: error instanceof RequestError ? error.message : 'Could not complete patient registration. Please try again.',
      ...(error.code ? { code: error.code } : {}),
    });
  }
});
