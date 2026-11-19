/**
 * Local verification script for Otlobha Customer Registration OTP & SMTP configuration.
 *
 * Usage:
 *   npx tsx scripts/test-customer-otp-local.ts
 *   npx tsx scripts/test-customer-otp-local.ts --send-to your-email@gmail.com
 */
import 'dotenv/config';

const BASE_URL = (process.env.LOCAL_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

async function postJson(endpoint: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, contentType: ct, json, raw: text.slice(0, 200) };
}

async function main() {
  console.log(`==> Testing local Otlobha backend at ${BASE_URL}`);

  // 1. Health & SMTP mode check
  const healthRes = await fetch(`${BASE_URL}/api/health`, { headers: { Accept: 'application/json' } });
  const health = (await healthRes.json()) as Record<string, unknown>;
  console.log('1) GET /api/health ->', healthRes.status, JSON.stringify(health));
  if (healthRes.status !== 200 || health.ok !== true) {
    throw new Error('Local server health check failed');
  }

  // 2. Primary registration OTP endpoint exists and returns structured JSON (not 404 HTML)
  const r1 = await postJson('/api/mobile/customer/register/request-otp', {
    full_name: 'اختبار محلي',
    email: 'invalid-email',
    password: 'password123',
  });
  console.log('2) POST /api/mobile/customer/register/request-otp (bad email) ->', r1.status, r1.contentType, JSON.stringify(r1.json));
  if (r1.status !== 400 || !r1.contentType.includes('application/json')) {
    throw new Error(`Expected 400 JSON from /api/mobile/customer/register/request-otp, got ${r1.status} ${r1.contentType}`);
  }

  // 3. Alias registration OTP endpoint exists and returns structured JSON
  const r2 = await postJson('/api/auth/customer/register/request-otp', {
    full_name: 'اختبار محلي',
    email: 'invalid-email',
    password: 'password123',
  });
  console.log('3) POST /api/auth/customer/register/request-otp (bad email) ->', r2.status, r2.contentType, JSON.stringify(r2.json));
  if (r2.status !== 400 || !r2.contentType.includes('application/json')) {
    throw new Error(`Expected 400 JSON from alias endpoint, got ${r2.status}`);
  }

  // 4. Unified fallback /api/auth/otp/request exists and returns structured JSON
  const r3 = await postJson('/api/auth/otp/request', { email: 'invalid-email', role: 'customer' });
  console.log('4) POST /api/auth/otp/request (bad email) ->', r3.status, r3.contentType, JSON.stringify(r3.json));
  if (r3.status !== 400 || !r3.contentType.includes('application/json')) {
    throw new Error(`Expected 400 JSON from /api/auth/otp/request, got ${r3.status}`);
  }

  // 5. Register without 6-digit OTP code must be rejected with 400 JSON
  const r4 = await postJson('/api/mobile/customer/register', {
    full_name: 'اختبار محلي',
    email: 'verify_test_only@example.com',
    password: 'password123',
  });
  console.log('5) POST /api/mobile/customer/register (missing code) ->', r4.status, JSON.stringify(r4.json));
  if (r4.status !== 400) {
    throw new Error(`Expected 400 when OTP code is missing, got ${r4.status}`);
  }

  // 6. Optional live SMTP send test when --send-to <email> is explicitly passed
  const sendIdx = process.argv.indexOf('--send-to');
  if (sendIdx !== -1 && process.argv[sendIdx + 1]) {
    const targetEmail = process.argv[sendIdx + 1].trim();
    console.log(`6) Sending REAL local test OTP to ${targetEmail} via SMTP...`);
    const sendRes = await postJson('/api/mobile/customer/register/request-otp', {
      full_name: 'اختبار بريد اطلبها',
      email: targetEmail,
      password: 'TempPassword123',
    });
    console.log('   Result ->', sendRes.status, JSON.stringify(sendRes.json));
    if (sendRes.status !== 200 || sendRes.json?.ok !== true) {
      throw new Error(`Live SMTP send failed: ${sendRes.status} ${JSON.stringify(sendRes.json)}`);
    }
  }

  console.log('ALL LOCAL OTP CHECKS PASSED.');
}

main().catch((err) => {
  console.error('LOCAL OTP TEST FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
