import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function hashPasswordLocal(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_DB = '/tmp/otlobha_phase1_security_test.db';

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
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, body, setCookies, headers: res.headers };
}

async function run() {
  console.log('=== [1] Testing Production Startup Refusal Without JWT Secrets ===');
  cleanupDb();
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const prodFail = spawnSync(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '3098',
      OTLOBHA_DB_PATH: '/tmp/otlobha_prod_fail_test.db',
      JWT_ACCESS_SECRET: '',
      JWT_REFRESH_SECRET: '',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  try {
    fs.unlinkSync('/tmp/otlobha_prod_fail_test.db');
  } catch {
    // ignore
  }
  assert.notEqual(prodFail.status, 0, 'Production must refuse to start without JWT secrets');
  const combinedErr = `${prodFail.stdout}\n${prodFail.stderr}`;
  assert.match(combinedErr, /FATAL SECURITY ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET/);
  console.log('PASS: Production server refused startup when JWT secrets were missing.');

  console.log('\n=== [2] Starting Isolated Test Server with Env Bootstrap ===');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DISABLE_VITE: '1',
      PORT: String(TEST_PORT),
      OTLOBHA_DB_PATH: TEST_DB,
      JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_characters_long_abc123',
      JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters_long_xyz789',
      SUPER_ADMIN_EMAIL: 'founder@otlobha.eg',
      SUPER_ADMIN_PASSWORD: 'Otlobha#StrongPassword2026',
      SUPER_ADMIN_NAME: 'Test Founder SuperAdmin',
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
    console.log('PASS: Isolated test server started and bootstrapped Super Admin.');

    console.log('\n=== [3] Testing Unauthenticated Requests Return 401 ===');
    const protectedEndpoints = [
      ['GET', '/api/auth/me'],
      ['GET', '/api/dashboard/overview'],
      ['GET', '/api/finance/ledger'],
      ['POST', '/api/finance/wallet-adjust'],
      ['PATCH', '/api/finance/settlements/set_1'],
      ['GET', '/api/captains'],
      ['GET', '/api/merchants'],
      ['GET', '/api/merchants/mer_1'],
      ['DELETE', '/api/merchants/mer_1'],
      ['GET', '/api/admin/customers'],
      ['GET', '/api/audit-logs'],
      ['GET', '/api/roles'],
      ['PUT', '/api/financial-model'],
      ['PATCH', '/api/mobile/captain/cap_1/availability'],
    ];
    for (const [method, endpoint] of protectedEndpoints) {
      const res = await jsonFetch(endpoint, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
      assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${endpoint}, got ${res.status}`);
    }
    const pubMerchants = await jsonFetch('/api/merchants?approved_only=1');
    assert.equal(pubMerchants.status, 200);
    assert.ok(Array.isArray(pubMerchants.body) && pubMerchants.body.length > 0);
    assert.equal(pubMerchants.body[0].password_hash, undefined);
    assert.equal(pubMerchants.body[0].owner_national_id, undefined);
    console.log(`PASS: All ${protectedEndpoints.length} unauthenticated admin/financial/protected endpoints returned 401.`);

    console.log('\n=== [4] Testing Admin Login, Cookies, Bearer, and Zero Password Exposure ===');
    const badLogin = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'founder@otlobha.eg', password: 'wrong-password' }),
    });
    assert.equal(badLogin.status, 401);

    const adminLogin = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'founder@otlobha.eg', password: 'Otlobha#StrongPassword2026' }),
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.ok, true);
    assert.equal(adminLogin.body.user.role, 'super_admin');
    assert.equal(adminLogin.body.user.password_hash, undefined);
    assert.equal(adminLogin.body.tokens.expires_in, 900);
    assert.ok(adminLogin.body.tokens.access_token);
    assert.ok(adminLogin.body.tokens.refresh_token);

    const cookieHeader = adminLogin.setCookies.map((c) => c.split(';')[0]).join('; ');
    assert.match(adminLogin.setCookies.join('\n'), /otlobha_access_token=.*HttpOnly.*SameSite=Lax/);
    assert.match(adminLogin.setCookies.join('\n'), /otlobha_refresh_token=.*HttpOnly.*SameSite=Lax/);

    const meCookie = await jsonFetch('/api/auth/me', { headers: { Cookie: cookieHeader } });
    assert.equal(meCookie.status, 200);
    assert.equal(meCookie.body.user.email, 'founder@otlobha.eg');
    assert.equal(meCookie.body.user.password_hash, undefined);

    const meBearer = await jsonFetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${adminLogin.body.tokens.access_token}` },
    });
    assert.equal(meBearer.status, 200);

    const ovAdmin = await jsonFetch('/api/dashboard/overview', {
      headers: { Authorization: `Bearer ${adminLogin.body.tokens.access_token}` },
    });
    assert.equal(ovAdmin.status, 200);
    const finAdmin = await jsonFetch('/api/finance/ledger', {
      headers: { Authorization: `Bearer ${adminLogin.body.tokens.access_token}` },
    });
    assert.equal(finAdmin.status, 200);
    console.log('PASS: Super Admin login set HttpOnly cookies, Bearer JWT (15m), passed /api/auth/me & finance, and hid password_hash.');

    console.log('\n=== [5] Testing Privilege Escalation Blocked (403) for Lower Roles ===');
    // 5a. Captain cannot access admin/finance
    const cap1Login = await jsonFetch('/api/mobile/captain/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'captain1', password: '123456' }),
    });
    assert.equal(cap1Login.status, 200);
    const cap1Token = cap1Login.body.tokens.access_token;
    assert.equal((await jsonFetch('/api/dashboard/overview', { headers: { Authorization: `Bearer ${cap1Token}` } })).status, 403);
    assert.equal((await jsonFetch('/api/finance/ledger', { headers: { Authorization: `Bearer ${cap1Token}` } })).status, 403);
    assert.equal(
      (
        await jsonFetch('/api/finance/wallet-adjust', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ wallet_id: 'wal_cap_1', direction: 'credit', amount: 100, reason: 'hack attempt' }),
        })
      ).status,
      403
    );

    // 5b. Merchant cannot access finance or alter own commission/verification_status
    const mer1Login = await jsonFetch('/api/auth/merchant/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'baraka@otlobha.eg', password: '123456' }),
    });
    assert.equal(mer1Login.status, 200);
    const mer1Token = mer1Login.body.tokens.access_token;
    assert.equal((await jsonFetch('/api/finance/ledger', { headers: { Authorization: `Bearer ${mer1Token}` } })).status, 403);
    assert.equal(
      (
        await jsonFetch('/api/merchants/mer_1', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${mer1Token}` },
          body: JSON.stringify({ commission_rate: 0 }),
        })
      ).status,
      403
    );

    // 5c. Restricted Admin Role (customer_support) cannot access finance/pricing/merchant-delete
    const Database = (await import('better-sqlite3')).default;
    const testDbConn = new Database(TEST_DB);
    testDbConn
      .prepare(
        `INSERT INTO admin_users (id, email, password_hash, full_name, role_code, is_active)
         VALUES ('adm_support_1', 'support@otlobha.eg', ?, 'موظف دعم', 'customer_support', 1)`
      )
      .run(hashPasswordLocal('Support#Pass2026'));
    testDbConn.close();

    const supLogin = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'support@otlobha.eg', password: 'Support#Pass2026' }),
    });
    assert.equal(supLogin.status, 200);
    const supToken = supLogin.body.tokens.access_token;
    assert.equal((await jsonFetch('/api/dashboard/overview', { headers: { Authorization: `Bearer ${supToken}` } })).status, 200);
    assert.equal((await jsonFetch('/api/finance/ledger', { headers: { Authorization: `Bearer ${supToken}` } })).status, 403);
    assert.equal(
      (
        await jsonFetch('/api/finance/wallet-adjust', {
          method: 'POST',
          headers: { Authorization: `Bearer ${supToken}` },
          body: JSON.stringify({ wallet_id: 'wal_cap_1', direction: 'credit', amount: 50, reason: 'unauthorized' }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/finance/settlements/set_1', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${supToken}` },
          body: JSON.stringify({ status: 'paid' }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/merchants/mer_4', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${supToken}` },
        })
      ).status,
      403
    );
    console.log('PASS: Captain, Merchant, and restricted customer_support Admin all blocked with 403 on higher-privilege routes.');

    console.log('\n=== [6] Testing Ownership Enforcement (requireOwnership -> 403) ===');
    // Captain 1 owns cap_1, NOT cap_2
    assert.equal(
      (await jsonFetch('/api/mobile/captain/cap_1/settlements', { headers: { Authorization: `Bearer ${cap1Token}` } })).status,
      200
    );
    assert.equal(
      (await jsonFetch('/api/mobile/captain/cap_2/settlements', { headers: { Authorization: `Bearer ${cap1Token}` } })).status,
      403
    );
    assert.equal(
      (
        await jsonFetch('/api/mobile/captain/cap_2/location', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${cap1Token}` },
          body: JSON.stringify({ lat: 31.15, lng: 31.93 }),
        })
      ).status,
      403
    );
    // Merchant 1 owns mer_1, NOT mer_2 or ord_3 (which belongs to mer_2)
    assert.equal((await jsonFetch('/api/merchants/mer_1', { headers: { Authorization: `Bearer ${mer1Token}` } })).status, 200);
    assert.equal((await jsonFetch('/api/merchants/mer_2', { headers: { Authorization: `Bearer ${mer1Token}` } })).status, 403);
    assert.equal(
      (
        await jsonFetch('/api/orders/ord_3/merchant-action', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${mer1Token}` },
          body: JSON.stringify({ action: 'ready' }),
        })
      ).status,
      403
    );
    console.log('PASS: Cross-user ownership access blocked with 403 for both Captains and Merchants.');

    console.log('\n=== [7] Testing Refresh Rotation, Reuse Detection & Logout Revocation ===');
    const refreshed = await jsonFetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: adminLogin.body.tokens.refresh_token }),
    });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.tokens.access_token);
    assert.notEqual(refreshed.body.tokens.refresh_token, adminLogin.body.tokens.refresh_token);

    // Reusing old refresh token must fail (401) and revoke active session chain
    const reused = await jsonFetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: adminLogin.body.tokens.refresh_token }),
    });
    assert.equal(reused.status, 401);

    // Re-login and test logout revocation
    const adminLogin2 = await jsonFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'founder@otlobha.eg', password: 'Otlobha#StrongPassword2026' }),
    });
    assert.equal(adminLogin2.status, 200);
    const { access_token: at2, refresh_token: rt2 } = adminLogin2.body.tokens;

    assert.equal((await jsonFetch('/api/auth/me', { headers: { Authorization: `Bearer ${at2}` } })).status, 200);

    const logoutRes = await jsonFetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${at2}` },
      body: JSON.stringify({ refresh_token: rt2 }),
    });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.revoked, true);

    assert.equal((await jsonFetch('/api/auth/me', { headers: { Authorization: `Bearer ${at2}` } })).status, 401);
    assert.equal((await jsonFetch('/api/dashboard/overview', { headers: { Authorization: `Bearer ${at2}` } })).status, 401);
    assert.equal(
      (await jsonFetch('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: rt2 }) })).status,
      401
    );
    console.log('PASS: Refresh rotation, reuse detection, and logout session revocation all verified.');
    console.log('\nALL PHASE 1 SECURITY TESTS PASSED!');
  } catch (err) {
    console.error('\nTEST FAILURE:', err);
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
