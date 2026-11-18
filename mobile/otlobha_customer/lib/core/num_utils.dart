String normalizeArabicDigits(String raw) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabic = '۰۱۲۳۴۵۶۷۸۹';
  final buf = StringBuffer();
  for (final rune in raw.runes) {
    final ch = String.fromCharCode(rune);
    final idxA = arabicIndic.indexOf(ch);
    if (idxA != -1) {
      buf.write(idxA.toString());
      continue;
    }
    final idxE = easternArabic.indexOf(ch);
    if (idxE != -1) {
      buf.write(idxE.toString());
      continue;
    }
    if (ch == '٫' || ch == '،' || ch == ',') {
      buf.write('.');
      continue;
    }
    buf.write(ch);
  }
  return buf.toString();
}

double? parseLocalizedNumber(dynamic raw) {
  if (raw == null) return null;
  if (raw is num) {
    return raw.isFinite ? raw.toDouble() : null;
  }
  final normalized = normalizeArabicDigits(raw.toString()).trim();
  if (normalized.isEmpty) return null;
  final cleaned = normalized.replaceAll(RegExp(r'[^0-9.-]'), '');
  if (cleaned.isEmpty || cleaned == '-' || cleaned == '.') return null;
  final parsed = double.tryParse(cleaned);
  if (parsed == null || !parsed.isFinite) return null;
  return parsed;
}
