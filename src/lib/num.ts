export function normalizeArabicDigits(raw: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const extArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  let out = '';
  for (const ch of String(raw || '')) {
    const idxAr = arabicIndic.indexOf(ch);
    if (idxAr !== -1) {
      out += String(idxAr);
      continue;
    }
    const idxFa = extArabicIndic.indexOf(ch);
    if (idxFa !== -1) {
      out += String(idxFa);
      continue;
    }
    if (ch === '٫' || ch === '،' || ch === ',') {
      out += '.';
      continue;
    }
    out += ch;
  }
  return out;
}

export function sanitizeDecimalInput(raw: string): string {
  const normalized = normalizeArabicDigits(raw).replace(/[^0-9.]/g, '');
  const parts = normalized.split('.');
  if (parts.length <= 1) return normalized;
  return `${parts[0]}.${parts.slice(1).join('')}`;
}

export function parseLocalizedNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  const cleaned = normalizeArabicDigits(String(val ?? '')).trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}
