const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let server;
let origin;
let output = '';

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function request(pathname, options = {}) {
  return fetch(`${origin}${pathname}`, options);
}

before(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      STAFF_PASSWORD: 'test-staff-password',
      ADMIN_PASSWORD: 'test-admin-password',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`CRM server exited early: ${output}`);
    try {
      const response = await request('/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`CRM server did not start: ${output}`);
});

after(() => {
  if (server && server.exitCode === null) server.kill();
});

test('health and public pages respond without a database', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const app = await request('/');
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-type'), /text\/html/);

  const booking = await request('/booking.html');
  assert.equal(booking.status, 200);
  const bookingHtml = await booking.text();
  assert.match(bookingHtml, /Запис/);
  assert.match(bookingHtml, /name="wash_site"/);
});

test('API blocks unauthenticated access and wrong passwords', async () => {
  const protectedResponse = await request('/api/orders');
  assert.equal(protectedResponse.status, 401);

  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' })
  });
  assert.equal(login.status, 401);
});

test('staff login creates an HttpOnly session; logout revokes it', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-staff-password' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Max-Age=43200/i);
  const sessionCookie = cookie.split(';', 1)[0];

  const session = await request('/api/session', { headers: { cookie: sessionCookie } });
  assert.equal((await session.json()).role, 'staff');

  // No DB is configured in this test process: 503 confirms the session passed auth.
  const orders = await request('/api/orders', { headers: { cookie: sessionCookie } });
  assert.equal(orders.status, 503);

  const logout = await request('/api/logout', { method: 'POST', headers: { cookie: sessionCookie } });
  assert.equal(logout.status, 200);
  const revoked = await request('/api/orders', { headers: { cookie: sessionCookie } });
  assert.equal(revoked.status, 401);
});

test('admin password grants admin role and public booking fails closed without Supabase', async () => {
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-admin-password' })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).role, 'admin');

  const booking = await request('/api/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test', phone: '+77000000000', plate: 'TEST 001' })
  });
  assert.equal(booking.status, 503);
});

test('website booking validates inputs and delegates atomic booking to the database', async () => {
  let slotTaken = false;
  let rpcPayload;
  let rpcCalls = 0;
  const oldArrival = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  let activeOrder = { id: 'expired-arrival', status: 'arrived', updated_at: oldArrival, arrived_at: oldArrival, wash_started_at: null, drying_started_at: null, stage_history: [{ status: 'arrived', at: oldArrival }], cancelled: false, voided: false, customers: { name: 'Test', phone: '+77000000000', telegram_chat_id: null }, cars: null };
  const mockDb = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, body) => {
      res.setHeader('content-type', 'application/json');
      res.writeHead(status).end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/rest/v1/wash_orders') {
      const status = url.searchParams.get('status');
      if (status === 'eq.arrived') return send(200, activeOrder.status === 'arrived' ? [{ id: activeOrder.id, status: activeOrder.status, updated_at: activeOrder.updated_at, stage_history: activeOrder.stage_history }] : []);
      if (status === 'eq.washing') return send(200, activeOrder.status === 'washing' && Date.now() - new Date(activeOrder.wash_started_at).getTime() >= 40 * 60 * 1000 ? [{ id: activeOrder.id, status: activeOrder.status, updated_at: activeOrder.updated_at, stage_history: activeOrder.stage_history }] : []);
      if (status === 'neq.closed') return send(200, [activeOrder]);
      return send(200, []);
    }
    if (req.method === 'PATCH' && url.pathname === '/rest/v1/wash_orders') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { activeOrder = { ...activeOrder, ...JSON.parse(body) }; send(200, [activeOrder]); });
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/rest/v1/rpc/book_public_order') return send(404, {});
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      rpcCalls++;
      rpcPayload = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      if (slotTaken) {
        res.writeHead(400).end(JSON.stringify({ code: 'P0001', message: 'BOOKING_SLOT_TAKEN' }));
      } else {
        res.writeHead(200).end(JSON.stringify({ order: { id: 'test-order', scheduled_for: rpcPayload.p_scheduled_for }, link_code: null }));
      }
    });
  });
  await new Promise(resolve => mockDb.listen(0, '127.0.0.1', resolve));
  const mockPort = mockDb.address().port;
  const appPort = await freePort();
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(appPort), NODE_ENV: 'test', STAFF_PASSWORD: 'test-staff-password', ADMIN_PASSWORD: 'test-admin-password', SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_ROLE_KEY: 'test-role-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childOutput = '';
  child.stdout.on('data', chunk => { childOutput += chunk; });
  child.stderr.on('data', chunk => { childOutput += chunk; });
  try {
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`CRM server exited early: ${childOutput}`);
      try { if ((await fetch(`${appOrigin}/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `CRM server did not start: ${childOutput}`);

    const tomorrow = new Date(Date.now() + 86400000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(tomorrow).map(p => [p.type, p.value]));
    const scheduled_for = new Date(`${parts.year}-${parts.month}-${parts.day}T10:00:00+05:00`).toISOString();
    const post = (wash_site = 'premium') => fetch(`${appOrigin}/api/bookings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Client', phone: '+7 700 000 00 00', plate: 'TEST 001', service: 'Комплексная мойка', wash_site, scheduled_for })
    });

    const created = await post();
    assert.equal(created.status, 201);
    assert.equal(rpcPayload.p_wash_site, 'premium');
    assert.equal(rpcPayload.p_scheduled_for, scheduled_for);

    slotTaken = true;
    const conflict = await post();
    assert.equal(conflict.status, 409);

    const callsBeforeInvalid = rpcCalls;
    const invalid = await post('other');
    assert.equal(invalid.status, 400);
    assert.equal(rpcCalls, callsBeforeInvalid);

    const login = await fetch(`${appOrigin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-staff-password' }) });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const queue = await fetch(`${appOrigin}/api/orders`, { headers: { cookie } });
    assert.equal(queue.status, 200);
    const orders = await queue.json();
    assert.equal(orders[0].status, 'washing');
    assert.equal(activeOrder.status, 'washing');
  } finally {
    child.kill();
    await new Promise(resolve => mockDb.close(resolve));
  }
});

test('database migration closes customer/order tables and protects all booking entry points', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', 'database.sql'), 'utf8');
  assert.match(sql, /alter table customers enable row level security/i);
  assert.match(sql, /alter table wash_orders enable row level security/i);
  assert.match(sql, /create or replace function public\.book_public_order/i);
  assert.match(sql, /create or replace function public\.prevent_overlapping_wash_bookings/i);
  assert.match(sql, /create trigger wash_orders_booking_overlap_guard/i);
  assert.match(sql, /grant execute on function public\.book_public_order[\s\S]*to service_role/i);
});

test('login throttles repeated wrong passwords', async () => {
  const port = await freePort();
  const appOrigin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', STAFF_PASSWORD: 'test-staff-password', ADMIN_PASSWORD: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${appOrigin}/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${appOrigin}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
      assert.equal(response.status, 401);
    }
    const locked = await fetch(`${appOrigin}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-staff-password' })
  });
    assert.equal(locked.status, 429);
  } finally {
    child.kill();
  }
});
