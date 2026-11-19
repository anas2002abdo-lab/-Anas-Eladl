/**
 * Shared email sanitization and validation used identically across
 * the Backend (`server.ts`) and Web Client (`CustomerAuthPortal.tsx`).
 * Mirrors `OtlobhaCustomerApi.normalizeEmail` in Flutter.
 */

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

// Strips invisible RTL/LTR directional marks, zero-width spaces/joiners, word joiners, and BOM
const INVISIBLE_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

// Strict RFC-compatible email shape (ASCII lowercase after normalization, no consecutive dots)
const EMAIL_FORMAT_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function sanitizeEmailInput(raw: string): string {
  return String(raw || '')
    .replace(/[٠-٩۰-۹]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d)
    .replace(/[\uFF20＠]/g, '@')
    .replace(/[\uFF0E\u3002\uFF61．。｡]/g, '.')
    .replace(INVISIBLE_UNICODE_RE, '')
    .replace(/[\s\u00A0]+/g, '')
    .toLowerCase();
}

export function normalizeEmail(raw: string): string | null {
  const clean = sanitizeEmailInput(raw);
  if (!clean || clean.length > 254) return null;

  const atIdx = clean.indexOf('@');
  if (atIdx <= 0 || atIdx !== clean.lastIndexOf('@')) return null;

  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);

  if (local.length > 64 || domain.length < 3 || domain.length > 253) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (domain.includes('..')) return null;

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (tld.length < 2 || !/^[a-z0-9-]+$/.test(tld)) return null;

  if (!EMAIL_FORMAT_RE.test(clean)) return null;
  return clean;
}
