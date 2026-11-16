const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
const token = 'a'.repeat(64);
const first = { notification_id: '11111111-1111-4111-8111-111111111111', lease_token: '22222222-2222-4222-8222-222222222222' };
const second = { notification_id: '33333333-3333-4333-8333-333333333333', lease_token: '44444444-4444-4444-8444-444444444444' };
function harness(options = {}) {
  let handler;
  const requests = [], rpcs = [], logs = [];
  const env = { SUPABASE_URL: 'https://project.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    BREVO_API_KEY: 'brevo-secret', BREVO_SENDER_EMAIL: 'sender@example.invalid', ...options.env };
  const client = { rpc: async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'claim_appointment_emails') return options.claimError ? { error: options.claimError } : { data: options.jobs || [first] };
    if (name === 'finish_appointment_email') return { data: options.finishFalse ? false : true };
    if (options.stale) return { data: null };
    if (options.prepareError) return { error: { message: 'prepare failed' } };
    return { data: { notification_id: args.p_notification_id, event_kind: 'appointment_confirmed',
      recipient: 'patient@example.invalid', appointment_id: 12, appointment_datetime: '2026-11-15T04:00:00Z',
      appointment_status: 'confirmed', doctor_name: 'Test Dentist', app_url: 'https://clinic.example.invalid', ...options.details } };
  } };
  vm.runInNewContext(source, {
    createClient: () => client, Request, Response, URL, Intl, Date, AbortSignal,
    console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value; } },
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      if (options.networkError) throw new Error('timeout');
      if (options.invalidJson) return new Response('invalid', { status: 201 });
      return new Response(JSON.stringify(options.providerBody || { messageId: '<message>' }), { status: options.providerStatus || 201 });
    },
  });
  const invoke = async ({ method = 'POST', key = token, body = '{}' } = {}) => {
    const res = await handler(new Request('https://worker.example.invalid', {
      method, headers: key ? { 'x-clinic-email-job': key } : {},
      ...(method === 'POST' ? { body } : {}),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { invoke, requests, rpcs, logs };
}
const finished = app => app.rpcs.filter(call => call.name === 'finish_appointment_email').map(call => call.args);

test('only POST with a private job token can reach the queue', async () => {
  for (const input of [{ method: 'GET' }, { key: null }, { key: 'user-jwt' }]) {
    const app = harness();
    assert.ok((await app.invoke(input)).status >= 400);
    assert.equal(app.rpcs.length + app.requests.length, 0);
  }
});
test('a random correctly-shaped token is still verified by the database', async () => {
  const app = harness({ claimError: { code: '42501' } });
  assert.equal((await app.invoke()).status, 403);
  assert.equal(app.requests.length, 0);
});
test('missing sender credentials prevent claims and sends', async () => {
  const app = harness({ env: { BREVO_API_KEY: '' } });
  assert.equal((await app.invoke()).status, 503);
  assert.equal(app.rpcs.length, 0);
});
test('empty or disabled queue produces no email', async () => {
  const app = harness({ jobs: [] });
  assert.equal((await app.invoke()).body.accepted, 0);
  assert.equal(app.requests.length, 0);
});
test('stale, cancelled, deleted or unverified-recipient jobs are skipped by preflight', async () => {
  const app = harness({ stale: true });
  assert.equal((await app.invoke()).body.skipped, 1);
  assert.equal(app.requests.length, 0);
});
test('recipient, sender and content come from the server, ignoring request body', async () => {
  const app = harness();
  assert.equal((await app.invoke({ body: '{"to":"attacker@example.invalid","subject":"tampered"}' })).body.accepted, 1);
  assert.deepEqual(app.requests[0].body.to, [{ email: 'patient@example.invalid' }]);
  assert.equal(app.requests[0].body.sender.email, 'sender@example.invalid');
  assert.equal(app.requests[0].body.replyTo.email, 'diolatadental.clinic@yahoo.com.ph');
  assert.equal(app.requests[0].body.headers.idempotencyKey, first.notification_id.replaceAll('-', ''));
  assert.equal(app.requests[0].body.headers.idempotencyKey.length, 32);
  assert.match(app.requests[0].body.textContent, /12:00/);
  assert.match(app.requests[0].body.textContent, /Philippine time/);
  assert.match(app.requests[0].body.textContent, /https:\/\/clinic.example.invalid\/my-appointments/);
  assert.equal(finished(app)[0].p_outcome, 'accepted');
});
test('all event templates describe the correct booking state', async () => {
  for (const event_kind of ['booking_received','appointment_confirmed','appointment_rescheduled','appointment_cancelled','change_requested','change_declined','reminder_24h']) {
    const app = harness({ details: { event_kind, appointment_status: 'pending', request_type: 'cancellation' } });
    await app.invoke();
    assert.equal(app.requests.length, 1, event_kind);
    const text = app.requests[0].body.textContent;
    if (['booking_received','appointment_rescheduled'].includes(event_kind)) assert.match(text, /PENDING/);
    if (event_kind === 'appointment_cancelled') assert.match(text, /CANCELLED/);
    if (event_kind === 'change_requested') assert.match(text, /request to cancel/);
    if (event_kind === 'reminder_24h') assert.match(text, /approximately 24 hours/);
    assert.doesNotMatch(text, /amount paid|balance|tooth number|medical history/i);
  }
});
test('invalid job identity, event, email, time or app URL cannot send', async () => {
  for (const options of [
    { jobs: [{ ...first, lease_token: 'bad' }] }, { details: { notification_id: second.notification_id } },
    { details: { recipient: 'bad' } }, { details: { event_kind: 'unsupported' } },
    { details: { appointment_datetime: 'bad' } }, { details: { app_url: 'http://localhost:3000' } },
    { details: { app_url: 'https://clinic.example.invalid/?token=secret' } },
  ]) {
    const app = harness(options);
    await app.invoke();
    assert.equal(app.requests.length, 0);
  }
});
test('concurrent-worker duplicate acceptance is recorded without sending another message', async () => {
  const app = harness({ providerStatus: 400, providerBody: { code: 'duplicate_parameter' } });
  assert.equal((await app.invoke()).body.accepted, 1);
  assert.equal(finished(app)[0].p_code, 'provider_duplicate');
});
test('quota errors pause the batch and defer its remaining jobs', async () => {
  const app = harness({ jobs: [first, second], providerStatus: 429 });
  const result = await app.invoke();
  assert.equal(result.body.retry, 2);
  assert.equal(app.requests.length, 1);
  assert.equal(finished(app)[0].p_code, 'provider_quota');
  assert.equal(finished(app)[1].p_code, 'provider_paused');
});
test('credential errors fail the current job and pause remaining sends', async () => {
  for (const providerStatus of [401, 403]) {
    const app = harness({ jobs: [first, second], providerStatus });
    await app.invoke();
    assert.equal(app.requests.length, 1);
    assert.equal(finished(app)[0].p_outcome, 'failed');
    assert.equal(finished(app)[1].p_outcome, 'retry');
  }
});
test('network or malformed acceptance stays uncertain instead of claiming delivery', async () => {
  for (const options of [{ networkError: true }, { invalidJson: true }, { providerStatus: 500 }]) {
    const app = harness(options);
    assert.equal((await app.invoke()).body.accepted, 0);
    assert.equal(finished(app)[0].p_outcome, 'retry');
    assert.equal(app.requests.length, 1);
  }
});
test('a lost database acknowledgement never triggers an immediate resend', async () => {
  const app = harness({ finishFalse: true });
  const result = await app.invoke();
  assert.equal(result.body.result_not_saved, 1);
  assert.equal(app.requests.length, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(app.logs).includes('patient@example.invalid'), false);
});
test('preparation failure is deferred without contacting the provider', async () => {
  const app = harness({ prepareError: true });
  await app.invoke();
  assert.equal(app.requests.length, 0);
  assert.equal(finished(app)[0].p_code, 'prepare_failed');
});

