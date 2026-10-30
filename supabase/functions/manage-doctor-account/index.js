import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { requireClinicAccount } from '../_shared/clinicAccess.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fingerprint = async candidates => {
  const value = JSON.stringify(candidates.map(row => [row.doctor_id, row.auth_user_id, row.email.toLowerCase(), row.disabled]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
// Existing endpoint name is retained. Provider saves never create Auth accounts.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response(405, { error: 'Method not allowed.' });
  const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Please log in again.', 401);
    const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !identity?.user) throw new RequestError('Please log in again.', 401);
    const caller = await requireClinicAccount(client, identity.user, RequestError);
    let body;
    try { body = await req.json(); } catch { throw new RequestError('Invalid request body.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('Invalid request body.');
    if (['change_email', 'send_reset_email'].includes(body.action)) throw new RequestError('Dentists no longer use login accounts. Refresh the application.', 410);
    if (!['status', 'retire_logins', 'create', 'update'].includes(body.action)) throw new RequestError('Unsupported provider action.');
    if (body.action === 'retire_logins' && !caller.isOwner) throw new RequestError('Only the Owner can retire legacy dentist logins.', 403);
    const allowedKeys = body.action === 'status' ? ['action'] : body.action === 'retire_logins' ? ['action', 'fingerprint'] : ['action', 'doctor_id', 'profile', 'service_ids', 'expected'];
    if (Object.keys(body).some(key => !allowedKeys.includes(key))) throw new RequestError('Unsupported provider fields. Refresh the application; dentist passwords are no longer used.');
    const readState = async () => {
      const { data, error } = await client.rpc('provider_cutover_state');
      if (error || !data || !Array.isArray(data.candidates)) throw new RequestError('Install the provider-only migration before using dentist management.', 409);
      return data;
    };
    const state = await readState();
    const summarize = async value => ({ success: true, ready: value.ready === true, ...(caller.isOwner ? { candidates: value.candidates, fingerprint: await fingerprint(value.candidates) } : {}) });
    if (body.action === 'status') return response(200, await summarize(state));
    if (body.action === 'retire_logins') {
      if (typeof body.fingerprint !== 'string' || body.fingerprint !== await fingerprint(state.candidates)) throw new RequestError('The account review changed. Refresh and review the dentist sign-ins again.', 409);
      let retired = 0;
      for (const candidate of state.candidates.filter(row => !row.disabled)) {
        const fresh = await readState();
        const current = fresh.candidates.find(row => row.auth_user_id === candidate.auth_user_id && row.doctor_id === candidate.doctor_id && row.email === candidate.email);
        if (!current || current.auth_user_id === identity.user.id) throw new RequestError('A dentist account mapping changed. Review it before retrying.', 409);
        if (current.disabled) continue;
        const { data, error } = await client.auth.admin.getUserById(current.auth_user_id);
        if (error || !data?.user || data.user.email?.toLowerCase() !== current.email.toLowerCase() || data.user.app_metadata?.fifthcusp_legacy_doctor_id !== current.doctor_id) throw new RequestError('Could not verify a mapped dentist login. Review the accounts before retrying.', 409);
        const { error: banError } = await client.auth.admin.updateUserById(current.auth_user_id, { ban_duration: '876000h', app_metadata: { ...data.user.app_metadata, clinic_provider_login_retired: true } });
        if (banError) throw new RequestError('Some dentist sign-ins could not be retired. Refresh the review; existing completed retirements are kept.', 500);
        retired += 1;
      }
      return response(200, { ...await summarize(await readState()), retired_count: retired });
    }
    if (!state.ready) throw new RequestError('The Owner must retire the reviewed legacy dentist logins first.', 409);
    if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile)) throw new RequestError('Enter valid provider details.');
    if (!Array.isArray(body.service_ids) || body.service_ids.length > 100 || body.service_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new RequestError('Select valid dental services.');
    if (body.action === 'update' && (!Number.isSafeInteger(body.doctor_id) || body.doctor_id <= 0 || !body.expected)) throw new RequestError('Reload the dentist before editing.');
    if (body.action === 'create' && body.doctor_id != null) throw new RequestError('A new provider cannot choose an existing dentist ID.');
    const { data, error } = await client.rpc('save_provider_profile', { p_actor: identity.user.id, p_doctor_id: body.action === 'update' ? body.doctor_id : null, p_profile: body.profile, p_service_ids: body.service_ids, p_expected: body.action === 'update' ? body.expected : null });
    if (error) throw new RequestError(['40001', '23505', '22023', '42501', 'P0002'].includes(error.code) ? error.message : 'The save outcome could not be verified. Refresh the dentist list before retrying.', error.code === '40001' ? 409 : 400);
    if (!Number.isSafeInteger(Number(data)) || Number(data) <= 0) throw new RequestError('Provider save could not be verified. Refresh before retrying.', 500);
    return response(200, { success: true, doctor_id: data });
  } catch (error) {
    return response(error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : 'Could not manage the provider. Please refresh before retrying.' });
  }
});
