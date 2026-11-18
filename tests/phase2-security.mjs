import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const TEST_PORT = 3102;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WS_BASE_URL = `ws://127.0.0.1:${TEST_PORT}/ws/order-chat`;
const TEST_DB = '/tmp/otlobha_phase2_security_test.db';

function hashPasswordLocal(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function cleanupDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      // ignore
    }
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Test server at ${url} did not become ready in ${timeoutMs}ms`);
}

async function jsonFetch(urlPath, opts = {}) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

async function loginCustomerOtp(email, fullName, phone) {
  const reqRes = await jsonFetch('/api/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'customer' }),
  });
  assert.equal(reqRes.status, 200, `OTP request failed for ${email}: ${JSON.stringify(reqRes.body)}`);
  assert.ok(reqRes.body?.demo_otp, 'Expected demo_otp in sandbox development mode');

  const verifyRes = await jsonFetch('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({
      email,
      code: reqRes.body.demo_otp,
      role: 'customer',
      full_name: fullName,
      phone,
    }),
  });
  assert.equal(verifyRes.status, 200, `OTP verify failed for ${email}: ${JSON.stringify(verifyRes.body)}`);
  assert.equal(verifyRes.body.ok, true);
  assert.ok(verifyRes.body.tokens?.access_token);
  return {
    user: verifyRes.body.user,
    token: verifyRes.body.tokens.access_token,
    refreshToken: verifyRes.body.tokens.refresh_token,
  };
}

function expectWsRejected(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      fn(val);
    };
    const timer = setTimeout(() => finish(reject, new Error(`Timeout waiting WS rejection for ${url}`)), 5000);
    ws.on('unexpected-response', (_req, res) => {
      finish(resolve, res.statusCode);
    });
    ws.on('open', () => {
      finish(reject, new Error(`Expected WS rejection, but connected cleanly: ${url}`));
    });
    ws.on('error', (err) => {
      if (!settled) {
        finish(resolve, err.message);
      }
    });
  });
}

function openWsClient(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    const messages = [];
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        reject(new Error(`Timeout waiting WS open for ${url}`));
      }
    }, 5000);
    ws.on('message', (raw) => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch {
        messages.push(raw.toString());
      }
    });
    ws.on('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({ ws, messages });
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected HTTP ${res.statusCode} when opening ${url}`));
    });
    ws.on('error', (err) => {
      if (!opened) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

async function waitForWsMessage(messages, predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`Timed out waiting for matching WebSocket message. Received: ${JSON.stringify(messages)}`);
}

async function waitForWsClose(ws, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket close event')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason?.toString() || '' });
    });
  });
}

async function run() {
  cleanupDb();
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DISABLE_VITE: '1',
      PORT: String(TEST_PORT),
      OTLOBHA_DB_PATH: TEST_DB,
      JWT_ACCESS_SECRET: 'phase2_test_access_secret_32_characters_minimum_xyz',
      JWT_REFRESH_SECRET: 'phase2_test_refresh_secret_32_characters_minimum_abc',
      SUPER_ADMIN_EMAIL: 'founder@otlobha.eg',
      SUPER_ADMIN_PASSWORD: 'Otlobha#StrongPassword2026',
      SUPER_ADMIN_NAME: 'Test Founder SuperAdmin',
      SMTP_USER: '',
      SMTP_PASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProc.stdout.on('data', (d) => {
    serverLogs += d.toString();
  });
  serverProc.stderr.on('data', (d) => {
    serverLogs += d.toString();
  });

  try {
    await waitForServer(BASE_URL);
    console.log('=== [1] Public Bootstrap Hygiene & Private Route 401 Enforcement ===');
    const bootstrapPublic = await jsonFetch('/api/mobile/customer/bootstrap');
    assert.equal(bootstrapPublic.status, 200);
    assert.ok(Array.isArray(bootstrapPublic.body.services) && bootstrapPublic.body.services.length > 0);
    assert.ok(Array.isArray(bootstrapPublic.body.merchants) && bootstrapPublic.body.merchants.length > 0);
    assert.equal(bootstrapPublic.body.merchants[0].password_hash, undefined);
    assert.equal(bootstrapPublic.body.merchants[0].owner_national_id, undefined);
    assert.deepEqual(bootstrapPublic.body.orders, []);
    assert.deepEqual(bootstrapPublic.body.trips, []);
    assert.deepEqual(bootstrapPublic.body.parcels, []);
    assert.deepEqual(bootstrapPublic.body.notifications, []);
    assert.deepEqual(bootstrapPublic.body.ratings, []);
    assert.deepEqual(bootstrapPublic.body.pending_ratings, []);
    assert.equal(bootstrapPublic.body.wallet?.available_balance, 0);

    const privatePaths = [
      ['GET', '/api/orders'],
      ['GET', '/api/trips'],
      ['GET', '/api/mobile/parcels'],
      ['GET', '/api/support/tickets'],
      ['GET', '/api/ratings'],
      ['GET', '/api/mobile/ratings/pending'],
      ['GET', '/api/pos/invoices'],
      ['GET', '/api/mobile/captains/nearby'],
      ['POST', '/api/orders'],
      ['POST', '/api/mobile/rides'],
      ['POST', '/api/mobile/parcels'],
    ];
    for (const [method, urlPath] of privatePaths) {
      const res = await jsonFetch(urlPath, { method, body: method === 'GET' ? undefined : '{}' });
      assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${urlPath}, got ${res.status}`);
    }
    console.log('PASS: Public bootstrap excludes all PII/orders/trips/parcels/wallets and private endpoints return 401.');

    console.log('\n=== [2] Customer OTP Auth, Server-Derived Identity & Cross-Customer Isolation ===');
    const custA = await loginCustomerOtp('ahmed.awad@otlobha.eg', 'أحمد عوض', '01022334455');
    const custB = await loginCustomerOtp('mona.ibrahim@otlobha.eg', 'منى إبراهيم', '01055112233');
    assert.notEqual(custA.user.id, custB.user.id);

    // Server-side catalog order recalculation (ignore forged unit_price / subtotal / discount_amount)
    const forgedOrderRes = await jsonFetch('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        customer_id: custB.user.id, // Attempt to spoof customer_id -> must be ignored!
        merchant_id: 'mer_1',
        zone_id: 'zn_city_center',
        address_landmark: 'شارع بورسعيد - اختبار',
        order_channel: 'catalog',
        items: [{ product_id: 'prd_1', quantity: 2, unit_price: 1 }], // prd_1 sale_price=165 => 330
        subtotal: 1,
        discount_amount: 500,
        coupon_code: 'MANZALA20', // valid min 120 => 20 discount
      }),
    });
    assert.equal(forgedOrderRes.status, 201, `Expected 201 creating order, got ${JSON.stringify(forgedOrderRes.body)}`);
    const ordAId = forgedOrderRes.body.id;

    // Fetch via Customer A -> verify customer_id === custA.user.id, subtotal === 330, discount_amount === 20
    const custAOrders = await jsonFetch('/api/orders', {
      headers: { Authorization: `Bearer ${custA.token}` },
    });
    assert.equal(custAOrders.status, 200);
    const createdOrdA = custAOrders.body.find((o) => o.id === ordAId);
    assert.ok(createdOrdA, 'Customer A should see their created order');
    assert.equal(createdOrdA.customer_id, custA.user.id, 'Server must ignore spoofed customer_id and bind to auth.id');
    assert.equal(createdOrdA.subtotal, 330, 'Server must compute subtotal from DB product prices, ignoring forged unit_price/subtotal');
    assert.equal(createdOrdA.discount_amount, 20, 'Server must compute discount from valid DB coupon');
    assert.equal(createdOrdA.total_amount, Number((330 + createdOrdA.delivery_fee - 20).toFixed(2)));

    // Unapproved merchant mer_4 rejected (403)
    const unapprovedOrderRes = await jsonFetch('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        merchant_id: 'mer_4',
        zone_id: 'zn_city_center',
        order_channel: 'free_text',
        free_order_text: 'عيش فينو',
      }),
    });
    assert.equal(unapprovedOrderRes.status, 403);

    // Cross-merchant product (prd_3 belongs to mer_2) inside mer_1 order rejected (400)
    const crossProdRes = await jsonFetch('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        merchant_id: 'mer_1',
        zone_id: 'zn_city_center',
        order_channel: 'catalog',
        items: [{ product_id: 'prd_3', quantity: 1 }],
      }),
    });
    assert.equal(crossProdRes.status, 400);

    // Cross-customer order tracking/chat blocked (403)
    assert.equal(
      (await jsonFetch(`/api/orders/${ordAId}/tracking`, { headers: { Authorization: `Bearer ${custB.token}` } })).status,
      403
    );
    assert.equal(
      (await jsonFetch(`/api/orders/${ordAId}/chat`, { headers: { Authorization: `Bearer ${custB.token}` } })).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/orders/${ordAId}/chat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${custB.token}` },
          body: JSON.stringify({ message_text: 'اختراق شات عميل آخر' }),
        })
      ).status,
      403
    );
    // Customer B cannot see ordAId in list
    const custBOrders = await jsonFetch('/api/orders', { headers: { Authorization: `Bearer ${custB.token}` } });
    assert.equal(custBOrders.body.some((o) => o.id === ordAId), false);
    console.log('PASS: Server recalculated catalog prices & coupon atomically and blocked cross-customer order access.');

    console.log('\n=== [3] Merchant & Catalog Isolation Enforcement ===');
    const mer1Login = await jsonFetch('/api/auth/merchant/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'baraka@otlobha.eg', password: '123456' }),
    });
    assert.equal(mer1Login.status, 200);
    const mer1Token = mer1Login.body.tokens.access_token;

    const mer2Login = await jsonFetch('/api/auth/merchant/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'manzala.fish@otlobha.eg', password: '123456' }),
    });
    assert.equal(mer2Login.status, 200);
    const mer2Token = mer2Login.body.tokens.access_token;

    // Merchant 1 cannot create category or product for Merchant 2, nor import Excel for Merchant 2, nor view mer_2 orders
    assert.equal(
      (
        await jsonFetch('/api/categories', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mer1Token}` },
          body: JSON.stringify({ merchant_id: 'mer_2', scope: 'merchant', name_ar: 'قسم مخترق' }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/products', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mer1Token}` },
          body: JSON.stringify({ merchant_id: 'mer_2', category_id: 'cat_seafood', name_ar: 'منتج مخترق', base_price: 10 }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/products/import-excel', {
          method: 'POST',
          headers: { Authorization: `Bearer ${mer1Token}` },
          body: JSON.stringify({ merchant_id: 'mer_2', rows: [{ name_ar: 'سمك', price: 100 }] }),
        })
      ).status,
      403
    );
    assert.equal(
      (await jsonFetch('/api/products/prd_3', { method: 'DELETE', headers: { Authorization: `Bearer ${mer1Token}` } })).status,
      403
    );

    // Merchant 1 CAN create, update, delete its own category & product
    const mer1CatRes = await jsonFetch('/api/categories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mer1Token}` },
      body: JSON.stringify({ scope: 'merchant', name_ar: 'قسم تجريبي آمن' }),
    });
    assert.equal(mer1CatRes.status, 201);
    const mer1CatId = mer1CatRes.body.id;

    const mer1ProdRes = await jsonFetch('/api/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mer1Token}` },
      body: JSON.stringify({ category_id: mer1CatId, name_ar: 'عصير طبيعي', base_price: 45 }),
    });
    assert.equal(mer1ProdRes.status, 201);
    const mer1ProdId = mer1ProdRes.body.id;

    // Merchant 2 cannot edit or delete mer1's category or product
    assert.equal(
      (
        await jsonFetch(`/api/categories/${mer1CatId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${mer2Token}` },
          body: JSON.stringify({ name_ar: 'سرقة قسم' }),
        })
      ).status,
      403
    );
    assert.equal(
      (await jsonFetch(`/api/categories/${mer1CatId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${mer2Token}` } })).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/products/${mer1ProdId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${mer2Token}` },
          body: JSON.stringify({ base_price: 1 }),
        })
      ).status,
      403
    );

    // Merchant 1 marks ordAId as preparing -> ready
    const mer1Action = await jsonFetch(`/api/orders/${ordAId}/merchant-action`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${mer1Token}` },
      body: JSON.stringify({ action: 'ready' }),
    });
    assert.equal(mer1Action.status, 200);
    // Clean up test product & category as owner
    assert.equal(
      (await jsonFetch(`/api/products/${mer1ProdId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${mer1Token}` } })).status,
      200
    );
    assert.equal(
      (await jsonFetch(`/api/categories/${mer1CatId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${mer1Token}` } })).status,
      200
    );
    console.log('PASS: Merchant isolation enforced on categories, products, Excel imports, and orders.');

    console.log('\n=== [4] Trip RBAC (Fare/Captain Admin-Only), State Machine & Soft Archival ===');
    const adminLogin = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'founder@otlobha.eg', password: 'Otlobha#StrongPassword2026' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.body.tokens.access_token;

    const cap1Login = await jsonFetch('/api/mobile/captain/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'captain1', password: '123456' }),
    });
    assert.equal(cap1Login.status, 200);
    const cap1Token = cap1Login.body.tokens.access_token;

    const cap2Login = await jsonFetch('/api/mobile/captain/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'captain2', password: '123456' }),
    });
    assert.equal(cap2Login.status, 200);
    const cap2Token = cap2Login.body.tokens.access_token;

    const cap3Login = await jsonFetch('/api/mobile/captain/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'captain3', password: '123456' }),
    });
    assert.equal(cap3Login.status, 200);
    const cap3Token = cap3Login.body.tokens.access_token;

    // Customer A creates trip
    const tripRes = await jsonFetch('/api/mobile/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        vehicle_type: 'moto',
        pickup_address: 'شارع حسن طوبار',
        dropoff_address: 'موقف المنزلة',
        customer_proposed_fare: 30,
      }),
    });
    assert.equal(tripRes.status, 201);
    const tripId = tripRes.body.id;

    // Customer A & Captain 1 must get 403 on PATCH /api/trips/:id/fare and PATCH /api/trips/:id/captain
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/fare`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${custA.token}` },
          body: JSON.stringify({ final_fare: 5 }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/fare`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ final_fare: 120 }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/captain`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${custA.token}` },
          body: JSON.stringify({ preferred_captain_id: 'cap_1' }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/captain`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ preferred_captain_id: 'cap_1' }),
        })
      ).status,
      403
    );

    // Super Admin CAN update captain and fare
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/captain`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ preferred_captain_id: 'cap_1' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await jsonFetch(`/api/trips/${tripId}/fare`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ final_fare: 45 }),
        })
      ).status,
      200
    );

    // Customer B cannot access, chat, cancel or finish Customer A's trip
    assert.equal((await jsonFetch(`/api/rides/${tripId}/chat`, { headers: { Authorization: `Bearer ${custB.token}` } })).status, 403);
    assert.equal(
      (await jsonFetch(`/api/trips/${tripId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${custB.token}` }, body: '{}' })).status,
      403
    );
    assert.equal(
      (await jsonFetch(`/api/trips/${tripId}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${custB.token}` }, body: '{}' })).status,
      403
    );

    // Unapproved captain cap_3 cannot accept trips (403)
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_3/trip-status', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap3Token}` },
          body: JSON.stringify({ trip_id: tripId, status: 'captain_accepted' }),
        })
      ).status,
      403
    );

    // Captain 1 accepts trip, finishes it, double finish -> 409, cancel after complete -> 409, soft archive keeps DB rows
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/trip-status', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ trip_id: tripId, status: 'captain_accepted' }),
        })
      ).status,
      200
    );
    assert.equal(
      (await jsonFetch(`/api/trips/${tripId}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${cap1Token}` }, body: '{}' })).status,
      200
    );
    assert.equal(
      (await jsonFetch(`/api/trips/${tripId}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${cap1Token}` }, body: '{}' })).status,
      409
    );
    assert.equal(
      (await jsonFetch(`/api/trips/${tripId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${custA.token}` }, body: '{}' })).status,
      409
    );

    // Check SQLite soft archive (trip + chat rows preserved!)
    const Database = (await import('better-sqlite3')).default;
    const dbCheck = new Database(TEST_DB, { readonly: true });
    const archivedTrip = dbCheck.prepare('SELECT status, final_fare FROM trips WHERE id = ?').get(tripId);
    const archivedChatCount = dbCheck.prepare('SELECT COUNT(*) as c FROM trip_chat_messages WHERE trip_id = ?').get(tripId);
    dbCheck.close();
    assert.equal(archivedTrip?.status, 'completed');
    assert.equal(archivedTrip?.final_fare, 45);
    assert.ok(archivedChatCount?.c > 0, 'Trip chat audit history must be preserved on soft archive');
    console.log('PASS: Trip RBAC, state-machine 409 conflict checks, and soft archival verified.');

    console.log('\n=== [5] Parcel OTP Completion, Rating Enforcement, POS & Support Isolation ===');
    const parcelRes = await jsonFetch('/api/mobile/parcels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        pickup_address: 'وسط المنزلة',
        dropoff_address: 'البصراط',
        receiver_phone: '01099887766',
        item_category: 'مستندات',
        prohibited_confirmed: true,
        preferred_captain_id: 'cap_1',
      }),
    });
    assert.equal(parcelRes.status, 201);
    const parcelId = parcelRes.body.id;
    const parcelOtp = parcelRes.body.delivery_otp;

    // Captain 2 cannot complete Captain 1's parcel (403)
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_2/complete-parcel', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap2Token}` },
          body: JSON.stringify({ delivery_id: parcelId, otp: parcelOtp }),
        })
      ).status,
      403
    );
    // Wrong OTP -> 400
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/complete-parcel', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ delivery_id: parcelId, otp: '0000' }),
        })
      ).status,
      400
    );
    // Valid OTP -> 200, second attempt -> 409
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/complete-parcel', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ delivery_id: parcelId, otp: parcelOtp }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/complete-parcel', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ delivery_id: parcelId, otp: parcelOtp }),
        })
      ).status,
      409
    );

    // Ratings: cannot rate uncompleted order (ordAId is ready, not delivered) -> 400
    assert.equal(
      (
        await jsonFetch('/api/ratings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${custA.token}` },
          body: JSON.stringify({ ref_type: 'order', ref_id: ordAId, rating: 5 }),
        })
      ).status,
      400
    );
    // Customer B cannot rate Customer A's completed parcel -> 403
    assert.equal(
      (
        await jsonFetch('/api/ratings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${custB.token}` },
          body: JSON.stringify({ ref_type: 'parcel', ref_id: parcelId, rating: 1 }),
        })
      ).status,
      403
    );
    // Customer A rates completed trip -> 201, duplicate -> 409
    assert.equal(
      (
        await jsonFetch('/api/ratings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${custA.token}` },
          body: JSON.stringify({ ref_type: 'trip', ref_id: tripId, rating: 5, comment: 'ممتاز' }),
        })
      ).status,
      201
    );
    assert.equal(
      (
        await jsonFetch('/api/ratings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${custA.token}` },
          body: JSON.stringify({ ref_type: 'trip', ref_id: tripId, rating: 4 }),
        })
      ).status,
      409
    );

    // POS Invoices isolation
    assert.equal(
      (await jsonFetch('/api/pos/invoices?captain_id=cap_2', { headers: { Authorization: `Bearer ${cap1Token}` } })).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/pos/invoices', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({
            captain_id: 'cap_2',
            items: [{ name_ar: 'طلب', qty: 1, unit_price: 50 }],
          }),
        })
      ).status,
      403
    );
    const posRes = await jsonFetch('/api/pos/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cap1Token}` },
      body: JSON.stringify({
        items: [{ name_ar: 'أرز مصري', qty: 1, unit_price: 165 }],
        delivery_fee: 15,
      }),
    });
    assert.equal(posRes.status, 201);

    // Support Tickets isolation
    const supCreateRes = await jsonFetch('/api/support/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({ subject: 'تذكرة خاصة بالعميل أ', message_text: 'تفاصيل خاصة' }),
    });
    assert.equal(supCreateRes.status, 201);
    const ticketId = supCreateRes.body.ticket.id;
    assert.equal(
      (await jsonFetch(`/api/support/tickets/${ticketId}/messages`, { headers: { Authorization: `Bearer ${custB.token}` } })).status,
      403
    );
    assert.equal(
      (
        await jsonFetch(`/api/support/tickets/${ticketId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${custB.token}` },
          body: JSON.stringify({ message_text: 'رد غير مصرح' }),
        })
      ).status,
      403
    );
    console.log('PASS: Parcel OTP, rating integrity, POS invoice ownership, and support ticket privacy all verified.');

    console.log('\n=== [6] WebSocket /ws/order-chat Auth, Room Authorization, Live GPS & Logout 4401 ===');
    // Seed market_moderator admin for testing restricted admin on admin:all
    const dbAdm = new Database(TEST_DB);
    dbAdm
      .prepare(
        `INSERT INTO admin_users (id, email, password_hash, full_name, role_code, is_active)
         VALUES ('adm_mod_1', 'moderator@otlobha.eg', ?, 'مشرف سوق', 'market_moderator', 1)`
      )
      .run(hashPasswordLocal('Mod#Pass2026'));
    dbAdm.close();
    const modLogin = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'moderator@otlobha.eg', password: 'Mod#Pass2026' }),
    });
    assert.equal(modLogin.status, 200);
    const modToken = modLogin.body.tokens.access_token;

    // 6a. Unauthenticated -> 401
    assert.equal(await expectWsRejected(`${WS_BASE_URL}?channel=customer`), 401);
    // 6b. ?token= -> 400
    assert.equal(await expectWsRejected(`${WS_BASE_URL}?channel=customer&token=${custA.token}`), 400);
    // 6c. Disallowed Origin -> 403
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?channel=customer`, {
        headers: { Authorization: `Bearer ${custA.token}`, Origin: 'https://evil-attacker.example' },
      }),
      403
    );
    // 6d. Cross-user room subscriptions -> 403
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?orderId=${ordAId}`, {
        headers: { Authorization: `Bearer ${custB.token}` },
      }),
      403
    );
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?tripId=${tripId}`, {
        headers: { Authorization: `Bearer ${custB.token}` },
      }),
      403
    );
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?channel=customer&customerId=${custA.user.id}`, {
        headers: { Authorization: `Bearer ${custB.token}` },
      }),
      403
    );
    // 6e. Customer or unapproved captain on channel=rides -> 403
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?channel=rides`, {
        headers: { Authorization: `Bearer ${custA.token}` },
      }),
      403
    );
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?channel=rides`, {
        headers: { Authorization: `Bearer ${cap3Token}` },
      }),
      403
    );
    // 6f. Restricted admin (market_moderator) on admin:all -> 403
    assert.equal(
      await expectWsRejected(`${WS_BASE_URL}?channel=admin:all`, {
        headers: { Authorization: `Bearer ${modToken}` },
      }),
      403
    );

    // 6g. Valid WS connections (customer, approved captain on rides, super admin on admin:all)
    const custWsConn = await openWsClient(`${WS_BASE_URL}?channel=customer`, {
      headers: { Authorization: `Bearer ${custA.token}` },
    });
    const capWsConn = await openWsClient(`${WS_BASE_URL}?channel=rides`, {
      headers: { Authorization: `Bearer ${cap1Token}` },
    });
    const adminWsConn = await openWsClient(`${WS_BASE_URL}?channel=admin:all`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Customer A creates an active trip -> all 3 receive trip:created, and customer receives captain:location on GPS update
    const liveTripRes = await jsonFetch('/api/mobile/rides', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({
        vehicle_type: 'moto',
        pickup_address: 'ميدان المحطة',
        dropoff_address: 'شارع بورسعيد',
        customer_proposed_fare: 25,
      }),
    });
    assert.equal(liveTripRes.status, 201);
    const liveTripId = liveTripRes.body.id;

    await waitForWsMessage(custWsConn.messages, (m) => m.type === 'trip:created' && m.trip?.id === liveTripId);
    await waitForWsMessage(capWsConn.messages, (m) => m.type === 'trip:created' && m.trip?.id === liveTripId);
    await waitForWsMessage(adminWsConn.messages, (m) => m.type === 'trip:created' && m.trip?.id === liveTripId);

    // Captain 1 accepts live trip and sends GPS update -> Customer A on ?channel=customer must receive captain:location
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/trip-status', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ trip_id: liveTripId, status: 'captain_accepted' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_1/location', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ lat: 31.1611, lng: 31.9399 }),
        })
      ).status,
      200
    );
    await waitForWsMessage(
      custWsConn.messages,
      (m) => m.type === 'captain:location' && m.captain_id === 'cap_1' && m.lat === 31.1611
    );

    // 6h. Client-sent WS frame must be ignored (neither echoes to admin nor mutates DB)
    const adminMsgCountBefore = adminWsConn.messages.length;
    custWsConn.ws.send(JSON.stringify({ type: 'order:status', order_id: ordAId, status: 'delivered' }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(adminWsConn.messages.length, adminMsgCountBefore, 'Server must ignore client-sent WS frames');

    // 6i. Session logout closes active WebSocket immediately with code 4401
    const closePromise = waitForWsClose(custWsConn.ws);
    const custLogoutRes = await jsonFetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({ refresh_token: custA.refreshToken }),
    });
    assert.equal(custLogoutRes.status, 200);
    const closeInfo = await closePromise;
    assert.equal(closeInfo.code, 4401, `Expected WS close code 4401 on logout, got ${closeInfo.code}`);

    capWsConn.ws.close();
    adminWsConn.ws.close();
    console.log('PASS: WebSocket auth, room authorization, live GPS fanout, frame ignore, and 4401 logout termination all passed.');
    console.log('\nALL PHASE 2 SECURITY TESTS PASSED!');
  } catch (err) {
    console.error('\nPHASE 2 TEST FAILURE:', err);
    console.error('Server logs:\n', serverLogs);
    process.exitCode = 1;
  } finally {
    try {
      if (serverProc.pid) process.kill(-serverProc.pid, 'SIGKILL');
    } catch {
      // ignore
    }
    cleanupDb();
  }
}

run();
