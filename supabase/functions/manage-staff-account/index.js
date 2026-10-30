import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { requireClinicAccount } from '../_shared/clinicAccess.js';

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
    if (!caller.isOwner) throw new RequestError('Only the Owner can manage the Staff account.', 403);
    const { data: ready, error: readinessError } = await client.rpc('staff_access_ready');
    if (readinessError || ready !== true) throw new RequestError('Apply the Staff operations migration before managing the Staff account.', 409);
    let body;
    try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');
    if (!['get', 'create', 'set_status'].includes(body.action)) throw new RequestError('Unsupported Staff action.');
    const allowedKeys = body.action === 'create' ? ['action', 'first_name', 'last_name', 'email', 'password'] :
      body.action === 'set_status' ? ['action', 'admin_id', 'expected_status', 'status'] : ['action'];
    if (Object.keys(body).some(key => !allowedKeys.includes(key))) throw new RequestError('Unsupported Staff account fields.');

    const { data: staff, error: staffError } = await client.from('admin').select(profileFields).eq('role', 'admin').maybeSingle();
    if (staffError) throw new RequestError('Could not load the Staff account.', 500);
    const publicProfile = profile => profile ? {
      admin_id: profile.admin_id, first_name: profile.first_name, last_name: profile.last_name,
      email: profile.email, status: profile.status, date_created: profile.date_created,
      linked: Boolean(profile.auth_user_id),
    } : null;
    if (body.action === 'get') return response(200, { success: true, staff: publicProfile(staff) });
    if (body.action === 'set_status') {
      if (!staff || Number(body.admin_id) !== Number(staff.admin_id)) throw new RequestError('Staff account not found.', 404);
      if (!staff.auth_user_id) throw new RequestError('The Staff login link needs repair. Contact the system administrator.', 409);
      if (!['active', 'inactive'].includes(body.status) || !['active', 'inactive'].includes(body.expected_status)) throw new RequestError('Choose a valid Staff status.');
      if (body.status === body.expected_status) throw new RequestError('Choose a different Staff status.');
      const { data: linked, error: linkedError } = await client.auth.admin.getUserById(staff.auth_user_id);
      if (linkedError || !linked?.user || !linked.user.email_confirmed_at || linked.user.id === identity.user.id) {
        throw new RequestError('Could not verify the separate Staff login account.', 409);
      }
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

    if (staff) throw new RequestError('A Staff profile already exists. Reactivate it instead of creating another account.', 409);
    const firstName = text(body.first_name, 'first name');
    const lastName = text(body.last_name, 'last name');
    const email = text(body.email, 'email address', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email address.');
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 4096) {
      throw new RequestError('Staff passwords must contain at least 12 characters.');
    }
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
    if (insertError || !profile) throw new RequestError('Could not create the Staff profile. Another Staff account may have been created; refresh before retrying.', 409);
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
