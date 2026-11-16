const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const access = fs.readFileSync(path.join(__dirname, '../_shared/clinicAccess.js'), 'utf8').replace('export ', '');

function harness(options = {}) {
  let handler;
  const calls = [];
  const identity = { id: 'owner-auth', email: 'owner@example.invalid', email_confirmed_at: '2026-11-01', ...options.identity };
  const env = { SUPABASE_URL: 'https://project.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    BREVO_API_KEY: 'brevo-secret', BREVO_SENDER_EMAIL: 'sender@example.invalid', ...options.env };
  const client = {
    auth: { getUser: async () => options.authError ? { error: true } : { data: { user: identity } } },
    from: table => ({
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => table === 'admin'
        ? { data: { admin_id: 1, auth_user_id: 'owner-auth', role: 'super_admin', status: 'active', ...options.profile }, error: options.profileError }
        : { data: options.patientConflict ? { patient_id: 5 } : null },
    }),
  };
  vm.runInNewContext(access + '\n' + source, {
    createClient: () => client, Request, Response, TextEncoder, Uint8Array, AbortSignal, crypto: webcrypto,
    Deno: { env: { get: name => env[name] }, serve: value => { handler = value; } },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (options.timeout) throw new Error('network failure');
      if (options.rawResponse) return options.rawResponse();
      return new Response(JSON.stringify(options.providerBody || { messageId: '<test-message>' }), { status: options.providerStatus || 201 });
    },
  });
  const invoke = async (body = { action: 'send_test' }, { method = 'POST', token = 'user-jwt' } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await handler(new Request('https://function.example.invalid', {
      method, headers, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }));
    return { status: res.status, body: method === 'OPTIONS' ? await res.text() : await res.json() };
  };
  return { invoke, calls };
}

test('preflight and unsupported methods never send email', async () => {
  const app = harness();
  assert.equal((await app.invoke(null, { method: 'OPTIONS', token: null })).status, 200);
  assert.equal((await app.invoke(null, { method: 'GET' })).status, 405);
  assert.equal(app.calls.length, 0);
});
test('missing or invalid login cannot send', async () => {
  const app = harness();
  assert.equal((await app.invoke(undefined, { token: null })).status, 401);
  const invalid = harness({ authError: true });
  assert.equal((await invalid.invoke()).status, 401);
  assert.equal(app.calls.length + invalid.calls.length, 0);
});
test('Staff, inactive, retired, banned and conflicting identities cannot send', async () => {
  for (const options of [
    { profile: { role: 'admin' } }, { profile: { status: 'inactive' } },
    { identity: { email_confirmed_at: null } }, { identity: { app_metadata: { clinic_provider_login_retired: true } } },
    { identity: { banned_until: '2999-01-01' } }, { patientConflict: true }, { profileError: true },
  ]) {
    const app = harness(options);
    assert.ok((await app.invoke()).status >= 400);
    assert.equal(app.calls.length, 0);
  }
});
test('setup check returns only configuration metadata and never calls Brevo', async () => {
  const app = harness();
  const result = await app.invoke({ action: 'status' });
  assert.equal(result.status, 200);
  assert.equal(result.body.configured, true);
  assert.equal(result.body.recipient, 'owner@example.invalid');
  assert.equal(result.body.patient_notifications_enabled, false);
  assert.equal(JSON.stringify(result).includes('brevo-secret'), false);
  assert.equal(app.calls.length, 0);
});
test('missing or invalid secrets prevent sending with useful setup guidance', async () => {
  for (const env of [{ BREVO_API_KEY: '' }, { BREVO_SENDER_EMAIL: '' }, { BREVO_SENDER_EMAIL: 'not-email' }]) {
    const app = harness({ env });
    assert.equal((await app.invoke()).status, 409);
    assert.equal((await app.invoke({ action: 'status' })).body.configured, false);
    assert.equal(app.calls.length, 0);
  }
});
test('malformed bodies and caller-selected recipients or content are rejected', async () => {
  const app = harness();
  for (const body of ['broken-json', 'x'.repeat(1025), null, [], { action: 'send_test', to: 'patient@example.invalid' },
    { action: 'send_test', htmlContent: 'anything' }, { action: 'send_appointment' }]) {
    assert.equal((await app.invoke(body)).status, 400);
  }
  assert.equal(app.calls.length, 0);
});
test('valid Owner test targets the verified login email with fixed non-clinical content', async () => {
  const app = harness({ identity: { email: 'Owner@Example.invalid' } });
  const result = await app.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'accepted');
  assert.equal(result.body.message_id, '<test-message>');
  assert.deepEqual(app.calls[0].body.to, [{ email: 'owner@example.invalid' }]);
  assert.equal(app.calls[0].body.sender.email, 'sender@example.invalid');
  assert.equal(app.calls[0].init.headers['api-key'], 'brevo-secret');
  assert.equal(app.calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.ok(app.calls[0].body.textContent.includes('not enabled yet'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('repeated requests keep the same provider duplicate-protection key', async () => {
  const app = harness();
  await app.invoke();
  await app.invoke();
  assert.equal(app.calls[0].body.headers.idempotencyKey, app.calls[1].body.headers.idempotencyKey);
  assert.match(app.calls[0].body.headers.idempotencyKey, /^[a-f0-9]{32}$/);
  const other = harness({ identity: { id: 'other-owner' } });
  await other.invoke();
  assert.notEqual(app.calls[0].body.headers.idempotencyKey, other.calls[0].body.headers.idempotencyKey);
});
test('duplicate provider response is reported as already submitted', async () => {
  const app = harness({ providerStatus: 400, providerBody: { code: 'duplicate_parameter' } });
  const result = await app.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'already_submitted');
});
test('provider failures are controlled, actionable and do not expose raw secrets', async () => {
  for (const providerStatus of [400, 401, 403, 429, 500]) {
    const app = harness({ providerStatus, providerBody: { message: 'private brevo-secret details' } });
    const result = await app.invoke();
    assert.ok(result.status >= 400);
    assert.equal(JSON.stringify(result).includes('brevo-secret'), false);
    assert.equal(app.calls.length, 1);
  }
});
test('network uncertainty and invalid provider success do not claim delivery or retry', async () => {
  for (const options of [{ timeout: true }, { providerBody: {} },
    { rawResponse: () => new Response('invalid json', { status: 201 }) }]) {
    const app = harness(options);
    const result = await app.invoke();
    assert.ok(result.status >= 400);
    assert.equal(app.calls.length, 1);
    assert.match(result.body.error, /logs/i);
  }
});
