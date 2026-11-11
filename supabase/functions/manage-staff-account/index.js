import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { requireClinicAccount } from '../_shared/clinicAccess.js';
import { changeAccountEmail } from '../_shared/changeAccountEmail.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new RequestError(`Enter a valid ${label}.`);
  return value.trim();
};
const profileFields = 'admin_id, first_name, last_name, email, status, date_created, auth_user_id';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let createdUserId = null;
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !identity?.user) throw new RequestError('Please log in again.', 401);
    const caller = await requireClinicAccount(client, identity.user, RequestError);
    if (!caller.isOwner) throw new RequestError('Only the Owner can manage Staff accounts.', 403);
    const { data: ready, error: readinessError } = await client.rpc('staff_accounts_ready');
    if (readinessError || ready !== true) throw new RequestError('Install the multiple-Staff account update before managing Staff accounts.', 409);
    let body;
    try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');
    const fieldsByAction = {
      get: ['action'], list: ['action', 'page'],
      create: ['action', 'first_name', 'last_name', 'email', 'password'],
      set_status: ['action', 'admin_id', 'expected_status', 'status'],
      update_names: ['action', 'admin_id', 'first_name', 'last_name', 'expected'],
      change_email: ['action', 'admin_id', 'new_email', 'expected_email'],
      change_password: ['action', 'admin_id', 'password', 'expected_email'],
    };
    if (!Object.hasOwn(fieldsByAction, body.action)) throw new RequestError('Unsupported Staff action.');
    const allowedKeys = fieldsByAction[body.action];
    if (Object.keys(body).some(key => !allowedKeys.includes(key))) throw new RequestError('Unsupported Staff account fields.');
    if ((body.action === 'create' || body.action === 'change_password')
      && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 4096)) {
      throw new RequestError('Staff passwords must contain between 12 and 4096 characters.');
    }

    const publicProfile = profile => profile ? {
      admin_id: profile.admin_id, first_name: profile.first_name, last_name: profile.last_name,
      email: profile.email, status: profile.status, date_created: profile.date_created,
      linked: Boolean(profile.auth_user_id),
    } : null;

    if (body.action === 'get' || body.action === 'list') {
      const page = body.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new RequestError('Choose a valid Staff page.');
      const pageSize = 10;
      const { data, error, count } = await client.from('admin').select(profileFields, { count: 'exact' })
        .eq('role', 'admin').order('admin_id', { ascending: body.action === 'get' }).range((page - 1) * pageSize, page * pageSize - 1);
      if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new RequestError('Could not load Staff accounts.', 500);
      // Preserve the original response for an older, already-open frontend.
      if (body.action === 'get') return response(200, { success: true, staff: publicProfile(data[0]), total: count });
      return response(200, { success: true, staff: data.map(publicProfile), total: count, page, page_size: pageSize });
    }

    if (body.action !== 'create') {
      if (!Number.isSafeInteger(body.admin_id) || body.admin_id <= 0) throw new RequestError('Select a valid Staff account.');
      const { data: staff, error: staffError } = await client.from('admin').select(profileFields)
        .eq('role', 'admin').eq('admin_id', body.admin_id).maybeSingle();
      if (staffError) throw new RequestError('Could not load the Staff account.', 500);
      if (!staff) throw new RequestError('Staff account not found.', 404);
      if (!staff.auth_user_id) throw new RequestError('The Staff login link needs repair. Contact the system administrator.', 409);
      const { data: linked, error: linkedError } = await client.auth.admin.getUserById(staff.auth_user_id);
      if (linkedError || !linked?.user || !linked.user.email_confirmed_at || linked.user.id === identity.user.id
        || linked.user.email?.trim().toLowerCase() !== staff.email.trim().toLowerCase()
        || linked.user.app_metadata?.clinic_provider_login_retired === true
        || linked.user.app_metadata?.fifthcusp_legacy_doctor_id != null) {
        throw new RequestError('Could not verify the separate Staff login account.', 409);
      }
      const { data: patientConflict, error: conflictError } = await client.from('patients').select('patient_id')
        .eq('auth_user_id', staff.auth_user_id).maybeSingle();
      if (conflictError || patientConflict) throw new RequestError('The Staff login has a conflicting patient link. Review it before editing.', 409);

      if (body.action === 'change_password') {
        if (body.expected_email !== staff.email) {
          throw new RequestError('The Staff login email changed. Refresh before retrying.', 409);
        }
        const { error: updateError } = await client.auth.admin.updateUserById(staff.auth_user_id, {
          password: body.password,
        });
        if (updateError?.code === 'weak_password') {
          throw new RequestError('Choose a stronger password that meets the clinic password requirements.');
        }
        if (updateError) throw new RequestError('Could not change the Staff password.', 502);
        return response(200, { success: true });
      }

      if (body.action === 'change_email') {
        const result = await changeAccountEmail(client, { table: 'admin', idField: 'admin_id', id: staff.admin_id,
          newEmail: body.new_email, expectedEmail: body.expected_email }, RequestError);
        const { data: updated, error } = await client.from('admin').select(profileFields)
          .eq('role', 'admin').eq('admin_id', staff.admin_id).eq('auth_user_id', staff.auth_user_id).maybeSingle();
        if (error || !updated) throw new RequestError('The email was saved, but Staff details could not be reloaded. Refresh before trying again.', 500);
        return response(200, { ...result, staff: publicProfile(updated) });
      }

      if (body.action === 'update_names') {
        const firstName = text(body.first_name, 'first name');
        const lastName = text(body.last_name, 'last name');
        const expected = body.expected;
        const keys = ['first_name', 'last_name', 'email', 'status'];
        if (!expected || typeof expected !== 'object' || Array.isArray(expected)
          || Object.keys(expected).length !== keys.length || keys.some(key => typeof expected[key] !== 'string')
          || Object.keys(expected).some(key => !keys.includes(key))) throw new RequestError('Reload Staff details before editing.');
        if (keys.some(key => staff[key] !== expected[key])) throw new RequestError('Staff details changed elsewhere. Refresh before retrying.', 409);
        const { data, error } = await client.from('admin').update({ first_name: firstName, last_name: lastName })
          .eq('admin_id', staff.admin_id).eq('role', 'admin').eq('auth_user_id', staff.auth_user_id)
          .eq('first_name', expected.first_name).eq('last_name', expected.last_name)
          .eq('email', expected.email).eq('status', expected.status).select(profileFields);
        if (error) throw new RequestError('Could not save Staff details.', 500);
        if (data?.length !== 1) throw new RequestError('Staff details changed elsewhere. Refresh before retrying.', 409);
        return response(200, { success: true, staff: publicProfile(data[0]) });
      }

      if (!['active', 'inactive'].includes(body.status) || !['active', 'inactive'].includes(body.expected_status)) throw new RequestError('Choose a valid Staff status.');
      if (body.status === body.expected_status) throw new RequestError('Choose a different Staff status.');
      if (body.status === 'active' && linked.user.banned_until && Date.parse(linked.user.banned_until) > Date.now()) {
        throw new RequestError('This Auth account is banned. Review it in Supabase before reactivating Staff.', 409);
      }
      const { data, error } = await client.from('admin').update({ status: body.status })
        .eq('admin_id', staff.admin_id).eq('role', 'admin').eq('auth_user_id', staff.auth_user_id)
        .eq('status', body.expected_status).select(profileFields);
      if (error) throw new RequestError('Could not change Staff access.', 500);
      if (data?.length !== 1) throw new RequestError('Staff access changed elsewhere. Refresh before retrying.', 409);
      return response(200, { success: true, staff: publicProfile(data[0]) });
    }

    const firstName = text(body.first_name, 'first name');
    const lastName = text(body.last_name, 'last name');
    const email = text(body.email, 'email address', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email address.');
    const emailPattern = email.replace(/[\\%_]/g, '\\$&');
    for (const table of ['admin', 'patients', 'doctors']) {
      const { data, error } = await client.from(table).select('email').ilike('email', emailPattern).limit(1);
      if (error) throw new RequestError('Could not check existing profiles.', 500);
      if (data?.length) throw new RequestError('This email already belongs to a clinic, patient, or dentist profile.', 409);
    }
    const { data: account, error: createError } = await client.auth.admin.createUser({
      email, password: body.password, email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (createError || !account?.user?.id) throw new RequestError(createError?.message || 'Could not create the Staff login.');
    createdUserId = account.user.id;
    const { data: profile, error: insertError } = await client.from('admin').insert({
      first_name: firstName, last_name: lastName, email, auth_user_id: createdUserId, role: 'admin', status: 'active',
    }).select(profileFields).single();
    if (insertError || !profile) throw new RequestError('Could not save the Staff profile. Refresh before retrying.', 409);
    createdUserId = null;
    return response(200, { success: true, staff: publicProfile(profile) });
  } catch (error) {
    if (createdUserId) {
      // A lost insert response does not prove that the profile was not saved.
      // Recheck before deleting the newly created login identity.
      let persisted;
      try {
        persisted = await client.from('admin').select(profileFields).eq('role', 'admin').eq('auth_user_id', createdUserId).maybeSingle();
      } catch { persisted = { error: true }; }
      if (!persisted.error && persisted.data) {
        const profile = persisted.data;
        return response(200, { success: true, staff: { admin_id: profile.admin_id, first_name: profile.first_name,
          last_name: profile.last_name, email: profile.email, status: profile.status, date_created: profile.date_created, linked: true } });
      }
      if (persisted.error) {
        try { await client.auth.admin.updateUserById(createdUserId, { ban_duration: '876000h' }); } catch { /* Review is required either way. */ }
        return response(500, { error: 'Could not verify whether Staff creation finished. The Owner must review Auth and the Staff profile before retrying.' });
      }
      let cleaned = false;
      try { const result = await client.auth.admin.deleteUser(createdUserId); cleaned = !result.error; } catch { /* Report incomplete cleanup below. */ }
      if (!cleaned) {
        try { await client.auth.admin.updateUserById(createdUserId, { ban_duration: '876000h' }); } catch { /* No credentials or identity data are logged. */ }
        console.error('Staff account rollback needs Owner attention.');
        return response(500, { error: 'Staff creation failed and cleanup could not finish. Ask the Owner to review Auth accounts before retrying.' });
      }
    }
    return response(error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : 'Could not manage the Staff account.' });
  }
});
