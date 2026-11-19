import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8080);

function normalizeBackendUrl(raw) {
  let clean = String(raw || '').trim();
  while (clean.endsWith('/')) clean = clean.slice(0, -1);
  if (clean.toLowerCase().endsWith('/api')) {
    clean = clean.slice(0, -4);
    while (clean.endsWith('/')) clean = clean.slice(0, -1);
  }
  return clean;
}

const BACKEND_API_URL = normalizeBackendUrl(process.env.BACKEND_API_URL || process.env.OTLOBHA_BACKEND_URL || '');

const ALLOWED_PROXY_ROUTES = new Map([
  ['/portal-api/verify-email/request-code', '/api/auth/customer/email-verify/request-code'],
  ['/portal-api/verify-email/confirm-code', '/api/auth/customer/email-verify/confirm-code'],
  ['/portal-api/forgot-password/request', '/api/mobile/customer/forgot-password/request'],
  ['/portal-api/forgot-password/reset', '/api/mobile/customer/forgot-password/reset'],
]);

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmailPrefill(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\s\u00A0]+/g, '')
    .toLowerCase()
    .slice(0, 254);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

function sendHtml(res, status, html) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function sendJson(res, status, payload) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function renderPortalHomeHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>بوابة حسابات عملاء اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);text-align:center;">
    <div style="width:66px;height:66px;margin:0 auto 14px;border-radius:18px;background:linear-gradient(135deg,#9E1C1E,#C8431D);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-weight:900;font-size:26px;">أ</div>
    <h1 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#0F172A;">بوابة حسابات عملاء اطلبها</h1>
    <p style="margin:0 0 22px;font-size:13.5px;line-height:1.7;color:#475569;">هذه الصفحة مخصصة فقط لعملاء تطبيق اطلبها لتوثيق البريد الإلكتروني أو استعادة كلمة المرور بأمان.</p>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <a href="/verify-email" style="display:block;padding:13px 16px;border-radius:12px;background:#A92224;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;">توثيق البريد الإلكتروني برمز التحقق</a>
      <a href="/forgot-password" style="display:block;padding:13px 16px;border-radius:12px;background:#FFF5F5;color:#A92224;border:1px solid #FECACA;text-decoration:none;font-weight:800;font-size:15px;">استعادة كلمة المرور</a>
      <a href="otlobha://home" style="display:block;padding:12px 16px;border-radius:12px;background:#0F172A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;">العودة إلى تطبيق اطلبها</a>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#94A3B8;">اطلبها – Otlobha Customer Accounts</p>
  </div>
</body>
</html>`;
}

function renderNotFoundHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>الصفحة غير متوفرة – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:420px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);text-align:center;">
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#0F172A;">الرابط المطلوب غير موجود</h1>
    <p style="margin:0 0 18px;font-size:13.5px;line-height:1.65;color:#475569;">تأكد من فتح الرابط من داخل تطبيق اطلبها أو اختر الخدمة المطلوبة أدناه.</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <a href="/verify-email" style="display:block;padding:12px;border-radius:12px;background:#A92224;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:14.5px;">توثيق البريد الإلكتروني</a>
      <a href="/forgot-password" style="display:block;padding:12px;border-radius:12px;background:#FFF5F5;color:#A92224;border:1px solid #FECACA;text-decoration:none;font-weight:800;font-size:14.5px;">استعادة كلمة المرور</a>
      <a href="otlobha://home" style="display:block;padding:12px;border-radius:12px;background:#0F172A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;">العودة إلى تطبيق اطلبها</a>
    </div>
  </div>
</body>
</html>`;
}

function renderVerifyEmailHtml(prefillEmail, autoSend) {
  const safeEmail = escapeHtml(prefillEmail);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>توثيق البريد الإلكتروني – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);">
    <div style="text-align:center;margin-bottom:18px;">
      <div style="width:62px;height:62px;margin:0 auto 12px;border-radius:18px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A92224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#0F172A;">توثيق البريد الإلكتروني</h1>
      <p style="margin:0;font-size:13.5px;line-height:1.65;color:#475569;">أرسل رمز التوثيق إلى بريدك الإلكتروني ثم أدخل الرمز المكون من 6 أرقام لتأمين حسابك في اطلبها.</p>
    </div>

    <div id="msgBox" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.6;"></div>

    <div id="formWrap">
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">البريد الإلكتروني</label>
        <input id="emailInput" type="email" dir="ltr" value="${safeEmail}" placeholder="name@gmail.com" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>

      <button id="sendCodeBtn" type="button" style="width:100%;padding:12px;border:1px solid #A92224;border-radius:12px;background:#FFF5F5;color:#A92224;font-weight:700;font-size:14.5px;cursor:pointer;margin-bottom:16px;">إرسال رمز التوثيق على البريد</button>

      <form id="verifyForm" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">رمز التوثيق (6 أرقام)</label>
          <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" placeholder="000000" style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #CBD5E1;border-radius:12px;font-size:22px;font-weight:800;letter-spacing:8px;text-align:center;background:#F8FAFC;" />
        </div>
        <button id="confirmBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">تأكيد وتوثيق البريد</button>
      </form>
    </div>

    <div id="doneBox" style="display:none;text-align:center;padding-top:6px;">
      <div style="width:66px;height:66px;margin:0 auto 14px;border-radius:18px;background:#F0FDFA;display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <h2 style="margin:0 0 8px;font-size:19px;font-weight:800;color:#0F766E;">تم توثيق بريدك بنجاح!</h2>
      <p style="margin:0 0 18px;font-size:13.5px;color:#475569;line-height:1.65;">جاري إغلاق هذه الصفحة وإعادتك مباشرة إلى تطبيق اطلبها...</p>
      <a id="returnAppLink" href="otlobha://verified" style="display:inline-block;width:100%;box-sizing:border-box;padding:13px 20px;border-radius:12px;background:#0D9488;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;">العودة إلى تطبيق اطلبها</a>
    </div>

    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#94A3B8;">اطلبها – Otlobha Customer Accounts</p>
  </div>
  <script>
    const emailInput = document.getElementById('emailInput');
    const codeInput = document.getElementById('codeInput');
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    const verifyForm = document.getElementById('verifyForm');
    const confirmBtn = document.getElementById('confirmBtn');
    const formWrap = document.getElementById('formWrap');
    const doneBox = document.getElementById('doneBox');
    const returnAppLink = document.getElementById('returnAppLink');
    const msgBox = document.getElementById('msgBox');
    let cooldown = 0;
    let timerId = null;

    function normalizeDigits(v) {
      const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
      return String(v || '').replace(/[٠-٩۰-۹]/g, ch => map[ch] || ch).replace(/[^0-9]/g, '').slice(0, 6);
    }

    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeDigits(codeInput.value);
    });

    function showMsg(text, ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = ok ? '#F0FDFA' : '#FEF2F2';
      msgBox.style.color = ok ? '#0F766E' : '#B91C1C';
      msgBox.style.border = ok ? '1px solid #99F6E4' : '1px solid #FECACA';
      msgBox.textContent = text;
    }

    function startCooldown(sec) {
      cooldown = sec;
      if (timerId) clearInterval(timerId);
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
      timerId = setInterval(() => {
        cooldown--;
        if (cooldown <= 0) {
          clearInterval(timerId);
          sendCodeBtn.disabled = false;
          sendCodeBtn.textContent = 'إعادة إرسال رمز التوثيق';
        } else {
          sendCodeBtn.textContent = 'إعادة إرسال الرمز بعد ' + cooldown + ' ث';
        }
      }, 1000);
    }

    function finishAndReturn(redirectUrl) {
      const target = redirectUrl || ('otlobha://verified?email=' + encodeURIComponent(emailInput.value.trim()));
      returnAppLink.href = target;
      formWrap.style.display = 'none';
      doneBox.style.display = 'block';
      setTimeout(() => { window.location.href = target; }, 500);
      setTimeout(() => { try { window.close(); } catch (_) {} }, 1300);
    }

    async function sendCode() {
      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال بريد إلكتروني صحيح أولًا', false);
        return;
      }
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'جاري إرسال الرمز...';
      try {
        const res = await fetch('/portal-api/verify-email/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر إرسال الرمز حاليًا', false);
          if (data.retry_after_sec && Number(data.retry_after_sec) > 0) {
            startCooldown(Math.min(Number(data.retry_after_sec), 120));
          } else {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'إرسال رمز التوثيق على البريد';
          }
          return;
        }
        if (data.already_verified) {
          showMsg(data.message || 'بريدك موثّق بالفعل!', true);
          finishAndReturn(data.redirect_url);
          return;
        }
        showMsg(data.message || 'تم إرسال رمز التوثيق إلى بريدك الإلكتروني', true);
        startCooldown(60);
        codeInput.focus();
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = 'إرسال رمز التوثيق على البريد';
      }
    }

    sendCodeBtn.addEventListener('click', sendCode);

    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const code = normalizeDigits(codeInput.value);
      codeInput.value = code;
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال البريد الإلكتروني بشكل صحيح', false);
        return;
      }
      if (code.length !== 6) {
        showMsg('يرجى إدخال رمز التوثيق المكون من 6 أرقام', false);
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'جاري التحقق...';
      try {
        const res = await fetch('/portal-api/verify-email/confirm-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر التحقق من الرمز', false);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'تأكيد وتوثيق البريد';
          return;
        }
        showMsg(data.message || 'تم توثيق بريدك الإلكتروني بنجاح!', true);
        finishAndReturn(data.redirect_url);
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'تأكيد وتوثيق البريد';
      }
    });

    if (${autoSend ? 'true' : 'false'} && emailInput.value.trim().includes('@')) {
      sendCode();
    }
  </script>
</body>
</html>`;
}

function renderForgotPasswordHtml(prefillEmail) {
  const safeEmail = escapeHtml(prefillEmail);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>استعادة كلمة المرور – اطلبها</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8FAFC;font-family:Tahoma,Arial,sans-serif;padding:20px;color:#0F172A;">
  <div style="width:100%;max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:22px;padding:28px 22px;box-shadow:0 14px 36px rgba(15,23,42,0.08);">
    <div style="text-align:center;margin-bottom:18px;">
      <div style="width:62px;height:62px;margin:0 auto 12px;border-radius:18px;background:#FEF2F2;border:1px solid #FECACA;display:flex;align-items:center;justify-content:center;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A92224" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#0F172A;">استعادة كلمة المرور</h1>
      <p id="subDesc" style="margin:0;font-size:13.5px;line-height:1.65;color:#475569;">أدخل بريدك الإلكتروني المسجّل لإرسال رمز الاستعادة المكون من 6 أرقام.</p>
    </div>

    <div id="msgBox" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.6;"></div>

    <form id="step1Form" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">البريد الإلكتروني</label>
        <input id="emailInput" type="email" dir="ltr" required value="${safeEmail}" placeholder="name@gmail.com" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <button id="sendResetBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">إرسال رمز الاستعادة</button>
    </form>

    <form id="step2Form" style="display:none;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">رمز التحقق (6 أرقام)</label>
        <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" required placeholder="000000" style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #CBD5E1;border-radius:12px;font-size:22px;font-weight:800;letter-spacing:8px;text-align:center;background:#F8FAFC;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">كلمة المرور الجديدة (6 أحرف على الأقل)</label>
        <input id="pw1" type="password" dir="ltr" minlength="6" required placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px;color:#334155;">تأكيد كلمة المرور الجديدة</label>
        <input id="pw2" type="password" dir="ltr" minlength="6" required placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #CBD5E1;border-radius:12px;font-size:15px;background:#F8FAFC;" />
      </div>
      <button id="resetSubmitBtn" type="submit" style="padding:13px;border:none;border-radius:12px;background:#A92224;color:#FFFFFF;font-weight:800;font-size:15px;cursor:pointer;">حفظ كلمة المرور الجديدة</button>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px;">
        <button id="resendBtn" type="button" style="background:none;border:none;color:#A92224;font-weight:700;font-size:13px;cursor:pointer;padding:6px;">إعادة إرسال الرمز</button>
        <button id="changeEmailBtn" type="button" style="background:none;border:none;color:#475569;font-weight:700;font-size:13px;cursor:pointer;padding:6px;">تغيير البريد</button>
      </div>
    </form>

    <div id="doneBox" style="display:none;text-align:center;padding-top:6px;">
      <div style="width:66px;height:66px;margin:0 auto 14px;border-radius:18px;background:#F0FDFA;display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <h2 style="margin:0 0 8px;font-size:19px;font-weight:800;color:#0F766E;">تم تغيير كلمة المرور بنجاح!</h2>
      <p style="margin:0 0 18px;font-size:13.5px;color:#475569;line-height:1.65;">جاري إغلاق هذه الصفحة وإعادتك مباشرة إلى تطبيق اطلبها لتسجيل الدخول...</p>
      <a id="returnAppLink" href="otlobha://password-reset-done" style="display:inline-block;width:100%;box-sizing:border-box;padding:13px 20px;border-radius:12px;background:#0D9488;color:#FFFFFF;text-decoration:none;font-weight:800;font-size:15px;">العودة إلى تطبيق اطلبها</a>
    </div>

    <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#94A3B8;">اطلبها – Otlobha Customer Accounts</p>
  </div>
  <script>
    const step1Form = document.getElementById('step1Form');
    const step2Form = document.getElementById('step2Form');
    const doneBox = document.getElementById('doneBox');
    const subDesc = document.getElementById('subDesc');
    const emailInput = document.getElementById('emailInput');
    const sendResetBtn = document.getElementById('sendResetBtn');
    const codeInput = document.getElementById('codeInput');
    const pw1 = document.getElementById('pw1');
    const pw2 = document.getElementById('pw2');
    const resetSubmitBtn = document.getElementById('resetSubmitBtn');
    const resendBtn = document.getElementById('resendBtn');
    const changeEmailBtn = document.getElementById('changeEmailBtn');
    const returnAppLink = document.getElementById('returnAppLink');
    const msgBox = document.getElementById('msgBox');
    let cooldown = 0;
    let timerId = null;

    function normalizeDigits(v) {
      const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
      return String(v || '').replace(/[٠-٩۰-۹]/g, ch => map[ch] || ch).replace(/[^0-9]/g, '').slice(0, 6);
    }

    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeDigits(codeInput.value);
    });

    function showMsg(text, ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = ok ? '#F0FDFA' : '#FEF2F2';
      msgBox.style.color = ok ? '#0F766E' : '#B91C1C';
      msgBox.style.border = ok ? '1px solid #99F6E4' : '1px solid #FECACA';
      msgBox.textContent = text;
    }

    function startCooldown(sec) {
      cooldown = sec;
      if (timerId) clearInterval(timerId);
      resendBtn.disabled = true;
      resendBtn.textContent = 'إعادة الإرسال بعد ' + cooldown + ' ث';
      timerId = setInterval(() => {
        cooldown--;
        if (cooldown <= 0) {
          clearInterval(timerId);
          resendBtn.disabled = false;
          resendBtn.textContent = 'إعادة إرسال الرمز';
        } else {
          resendBtn.textContent = 'إعادة الإرسال بعد ' + cooldown + ' ث';
        }
      }, 1000);
    }

    async function requestResetCode(isResend) {
      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        showMsg('يرجى إدخال بريد إلكتروني صحيح', false);
        return;
      }
      if (isResend) {
        resendBtn.disabled = true;
        resendBtn.textContent = 'جاري الإرسال...';
      } else {
        sendResetBtn.disabled = true;
        sendResetBtn.textContent = 'جاري إرسال الرمز...';
      }
      try {
        const res = await fetch('/portal-api/forgot-password/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر إرسال رمز الاستعادة حاليًا', false);
          if (isResend) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'إعادة إرسال الرمز';
          } else {
            sendResetBtn.disabled = false;
            sendResetBtn.textContent = 'إرسال رمز الاستعادة';
          }
          return;
        }
        showMsg(data.message || 'تم إرسال رمز الاستعادة المكون من 6 أرقام إلى بريدك الإلكتروني', true);
        subDesc.textContent = 'أدخل الرمز المرسل إلى ' + email + ' ثم اختر كلمة مرور جديدة.';
        step1Form.style.display = 'none';
        step2Form.style.display = 'flex';
        startCooldown(60);
        codeInput.focus();
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        if (isResend) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'إعادة إرسال الرمز';
        } else {
          sendResetBtn.disabled = false;
          sendResetBtn.textContent = 'إرسال رمز الاستعادة';
        }
      }
    }

    step1Form.addEventListener('submit', (e) => {
      e.preventDefault();
      requestResetCode(false);
    });

    resendBtn.addEventListener('click', () => {
      if (cooldown <= 0) requestResetCode(true);
    });

    changeEmailBtn.addEventListener('click', () => {
      step2Form.style.display = 'none';
      step1Form.style.display = 'flex';
      sendResetBtn.disabled = false;
      sendResetBtn.textContent = 'إرسال رمز الاستعادة';
      subDesc.textContent = 'أدخل بريدك الإلكتروني المسجّل لإرسال رمز الاستعادة المكون من 6 أرقام.';
      msgBox.style.display = 'none';
    });

    step2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const code = normalizeDigits(codeInput.value);
      codeInput.value = code;
      if (code.length !== 6) {
        showMsg('يرجى إدخال رمز التحقق المكون من 6 أرقام', false);
        return;
      }
      if (pw1.value.length < 6) {
        showMsg('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف', false);
        return;
      }
      if (pw1.value !== pw2.value) {
        showMsg('كلمتا المرور غير متطابقتين', false);
        return;
      }
      resetSubmitBtn.disabled = true;
      resetSubmitBtn.textContent = 'جاري حفظ كلمة المرور...';
      try {
        const res = await fetch('/portal-api/forgot-password/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code, new_password: pw1.value })
        });
        const data = await res.json();
        if (!res.ok) {
          showMsg(data.error || 'تعذر تغيير كلمة المرور، راجع الرمز وحاول مرة أخرى', false);
          resetSubmitBtn.disabled = false;
          resetSubmitBtn.textContent = 'حفظ كلمة المرور الجديدة';
          return;
        }
        const target = 'otlobha://password-reset-done?email=' + encodeURIComponent(email);
        returnAppLink.href = target;
        showMsg('تم تحديث كلمة المرور بنجاح!', true);
        step2Form.style.display = 'none';
        doneBox.style.display = 'block';
        setTimeout(() => { window.location.href = target; }, 600);
        setTimeout(() => { try { window.close(); } catch (_) {} }, 1400);
      } catch (_) {
        showMsg('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى.', false);
        resetSubmitBtn.disabled = false;
        resetSubmitBtn.textContent = 'حفظ كلمة المرور الجديدة';
      }
    });
  </script>
</body>
</html>`;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';

  if (method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'otlobha-customer-portal',
      backend_configured: Boolean(BACKEND_API_URL),
    });
  }

  if (method === 'GET' && pathname === '/') {
    return sendHtml(res, 200, renderPortalHomeHtml());
  }

  if (
    method === 'GET' &&
    (pathname === '/verify-email' ||
      pathname === '/customer/verify-email' ||
      pathname === '/portal/customer/verify-email' ||
      pathname === '/auth/verify-email')
  ) {
    const email = normalizeEmailPrefill(parsed.searchParams.get('email') || '');
    const autoSend = parsed.searchParams.get('auto') === '1';
    return sendHtml(res, 200, renderVerifyEmailHtml(email, autoSend));
  }

  if (
    method === 'GET' &&
    (pathname === '/forgot-password' ||
      pathname === '/customer/forgot-password' ||
      pathname === '/portal/customer/forgot-password' ||
      pathname === '/auth/forgot-password')
  ) {
    const email = normalizeEmailPrefill(parsed.searchParams.get('email') || '');
    return sendHtml(res, 200, renderForgotPasswordHtml(email));
  }

  if (method === 'POST' && ALLOWED_PROXY_ROUTES.has(pathname)) {
    if (!BACKEND_API_URL) {
      return sendJson(res, 503, { error: 'بوابة الحسابات غير مرتبطة بالخادم بعد، يرجى المحاولة لاحقًا' });
    }
    let bodyObj;
    try {
      bodyObj = await readJsonBody(req);
    } catch (err) {
      const tooLarge = err && err.message === 'PAYLOAD_TOO_LARGE';
      return sendJson(res, tooLarge ? 413 : 400, { error: 'صيغة الطلب غير صالحة' });
    }

    const targetPath = ALLOWED_PROXY_ROUTES.get(pathname);
    const forwardedFor = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').trim();
    try {
      const upstream = await fetch(`${BACKEND_API_URL}${targetPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
        },
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(25000),
      });
      const text = await upstream.text();
      setSecurityHeaders(res);
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try {
        JSON.parse(text);
        return res.end(text);
      } catch {
        return res.end(
          JSON.stringify({
            error:
              upstream.status === 404
                ? 'خدمة التحقق غير مفعّلة بعد على الخادم الرئيسي'
                : 'حدث خطأ مؤقت في الخادم، يرجى المحاولة لاحقًا',
          })
        );
      }
    } catch {
      return sendJson(res, 502, { error: 'تعذر الاتصال بخدمة الحسابات حاليًا، يرجى المحاولة بعد قليل' });
    }
  }

  return sendHtml(res, 404, renderNotFoundHtml());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Otlobha Dedicated Customer Accounts Portal running on http://0.0.0.0:${PORT}`);
});
