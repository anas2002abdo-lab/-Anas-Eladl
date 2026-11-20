import { db, uid } from './db.ts';

function normalizeCatSegment(input: string): string {
  return String(input || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDisplaySegment(input: string): string {
  return String(input || '')
    .replace(/\u00A0/g, ' ')
    .replace(/^[;؛\s]+|[;؛\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses an Excel hierarchy category path from root to leaf:
 * e.g. "سوبر ماركت  >  مخبوزات  >  كرواسون وكيك;" -> ["سوبر ماركت", "مخبوزات", "كرواسون وكيك"]
 * Supports >, », ›, /, \ as level separators and handles NBSP & trailing/multiple semicolons.
 */
export function parseCategoryHierarchyPath(raw: string): string[] {
  const cleaned = String(raw || '')
    .replace(/\u00A0/g, ' ')
    .trim();
  if (!cleaned) return [];

  // Take first non-empty semicolon-delimited path if multiple paths were pasted in one cell
  const pathParts = cleaned
    .split(/[;؛]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const primaryPath = pathParts[0] || '';
  if (!primaryPath) return [];

  return primaryPath
    .split(/\s*(?:>|»|›|\/|\\|<-|->)\s*/)
    .map(cleanDisplaySegment)
    .filter(Boolean);
}

/**
 * Formats segments into the canonical Excel hierarchy path requested:
 * "سوبر ماركت > مخبوزات > كرواسون وكيك;"
 */
export function formatCategoryExcelPath(segments: string[]): string {
  const clean = segments.map(cleanDisplaySegment).filter(Boolean);
  if (clean.length === 0) return '';
  return `${clean.join(' > ')};`;
}

export interface CategoryTreeMeta {
  id: string;
  parent_id: string | null;
  level: number;
  segments: string[];
  full_path_ar: string;
  excel_path: string;
  children_count: number;
}

export function computeCategoryHierarchyMap(): Map<string, CategoryTreeMeta> {
  const rows = db
    .prepare('SELECT id, parent_id, name_ar FROM categories')
    .all() as Array<{ id: string; parent_id: string | null; name_ar: string }>;

  const byId = new Map<string, { id: string; parent_id: string | null; name_ar: string }>();
  const childCount = new Map<string, number>();

  for (const r of rows) {
    byId.set(r.id, r);
    if (r.parent_id) {
      childCount.set(r.parent_id, (childCount.get(r.parent_id) || 0) + 1);
    }
  }

  const metaMap = new Map<string, CategoryTreeMeta>();

  for (const r of rows) {
    const segments: string[] = [];
    const visited = new Set<string>();
    let cur: { id: string; parent_id: string | null; name_ar: string } | undefined = r;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      segments.unshift(cleanDisplaySegment(cur.name_ar));
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    const excelPath = formatCategoryExcelPath(segments);
    metaMap.set(r.id, {
      id: r.id,
      parent_id: r.parent_id || null,
      level: Math.max(0, segments.length - 1),
      segments,
      full_path_ar: excelPath,
      excel_path: excelPath,
      children_count: childCount.get(r.id) || 0,
    });
  }

  return metaMap;
}

export function recomputeAllCategoryPaths(): void {
  const metaMap = computeCategoryHierarchyMap();
  const updateStmt = db.prepare('UPDATE categories SET level = ?, full_path_ar = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const meta of metaMap.values()) {
      updateStmt.run(meta.level, meta.full_path_ar, meta.id);
    }
  });
  tx();
}

export function isCategoryDescendant(candidateParentId: string, categoryId: string): boolean {
  if (!candidateParentId || !categoryId) return false;
  if (candidateParentId === categoryId) return true;
  const rows = db.prepare('SELECT id, parent_id FROM categories').all() as Array<{ id: string; parent_id: string | null }>;
  const parentById = new Map<string, string | null>();
  for (const r of rows) parentById.set(r.id, r.parent_id || null);

  const visited = new Set<string>();
  let cur: string | null = candidateParentId;
  while (cur && !visited.has(cur)) {
    if (cur === categoryId) return true;
    visited.add(cur);
    cur = parentById.get(cur) || null;
  }
  return false;
}

export function getCategoryAndDescendantIds(rootCategoryId: string): string[] {
  const cleanId = String(rootCategoryId || '').trim();
  if (!cleanId) return [];

  const rows = db.prepare('SELECT id, parent_id FROM categories').all() as Array<{ id: string; parent_id: string | null }>;
  const childrenMap = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent_id) {
      const arr = childrenMap.get(r.parent_id);
      if (arr) arr.push(r.id);
      else childrenMap.set(r.parent_id, [r.id]);
    }
  }

  const result: string[] = [];
  const queue: string[] = [cleanId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    const kids = childrenMap.get(id);
    if (kids) {
      for (const k of kids) queue.push(k);
    }
  }
  return result;
}

/**
 * Enriches category rows with parent_id, level, full_path_ar, excel_path, children_count,
 * and orders them in clean DFS tree order (each parent immediately followed by its children).
 */
export function enrichAndOrderCategories<T extends Record<string, any>>(rows: T[]): Array<T & {
  parent_id: string | null;
  level: number;
  full_path_ar: string;
  excel_path: string;
  children_count: number;
}> {
  const metaMap = computeCategoryHierarchyMap();
  const rowById = new Map<string, T>();
  const childrenByParent = new Map<string | null, T[]>();

  for (const r of rows) {
    rowById.set(String(r.id), r);
  }

  for (const r of rows) {
    const pid = r.parent_id && rowById.has(String(r.parent_id)) ? String(r.parent_id) : null;
    const arr = childrenByParent.get(pid);
    if (arr) arr.push(r);
    else childrenByParent.set(pid, [r]);
  }

  const ordered: Array<T & {
    parent_id: string | null;
    level: number;
    full_path_ar: string;
    excel_path: string;
    children_count: number;
  }> = [];
  const visited = new Set<string>();

  const dfs = (parentId: string | null) => {
    const list = childrenByParent.get(parentId) || [];
    for (const r of list) {
      const id = String(r.id);
      if (visited.has(id)) continue;
      visited.add(id);
      const meta = metaMap.get(id);
      ordered.push({
        ...r,
        parent_id: r.parent_id ? String(r.parent_id) : null,
        level: meta?.level ?? 0,
        full_path_ar: meta?.full_path_ar || `${r.name_ar};`,
        excel_path: meta?.excel_path || `${r.name_ar};`,
        children_count: meta?.children_count ?? 0,
      });
      dfs(id);
    }
  };

  dfs(null);

  // Append any disconnected rows just in case
  for (const r of rows) {
    const id = String(r.id);
    if (visited.has(id)) continue;
    const meta = metaMap.get(id);
    ordered.push({
      ...r,
      parent_id: r.parent_id ? String(r.parent_id) : null,
      level: meta?.level ?? 0,
      full_path_ar: meta?.full_path_ar || `${r.name_ar};`,
      excel_path: meta?.excel_path || `${r.name_ar};`,
      children_count: meta?.children_count ?? 0,
    });
  }

  return ordered;
}

export interface CategoryPathResolverContext {
  scope: 'merchant' | 'pharmacy' | 'market';
  merchantId: string | null;
  byParentAndNormName: Map<string, { id: string; name_ar: string; is_offers_section: number }>;
  byId: Map<string, { id: string; parent_id: string | null; name_ar: string; is_offers_section: number }>;
  bySingleNormName: Map<string, { id: string; name_ar: string; is_offers_section: number }>;
  insertStmt: { run: (...params: unknown[]) => unknown };
}

export function createCategoryPathResolver(opts: {
  scope?: 'merchant' | 'pharmacy' | 'market';
  merchantId?: string | null;
}): CategoryPathResolverContext {
  const scope = opts.scope || 'merchant';
  const merchantId = opts.merchantId || null;

  const existingRows = (merchantId
    ? db
        .prepare(
          "SELECT id, parent_id, merchant_id, name_ar, name_en, is_offers_section FROM categories WHERE scope != 'market' AND (merchant_id = ? OR merchant_id IS NULL) ORDER BY CASE WHEN merchant_id = ? THEN 0 ELSE 1 END, level ASC, sort_order ASC"
        )
        .all(merchantId, merchantId)
    : db
        .prepare(
          "SELECT id, parent_id, merchant_id, name_ar, name_en, is_offers_section FROM categories WHERE merchant_id IS NULL ORDER BY level ASC, sort_order ASC"
        )
        .all()) as Array<{
    id: string;
    parent_id: string | null;
    merchant_id: string | null;
    name_ar: string;
    name_en: string;
    is_offers_section: number;
  }>;

  const byParentAndNormName = new Map<string, { id: string; name_ar: string; is_offers_section: number }>();
  const byId = new Map<string, { id: string; parent_id: string | null; name_ar: string; is_offers_section: number }>();
  const bySingleNormName = new Map<string, { id: string; name_ar: string; is_offers_section: number }>();

  for (const c of existingRows) {
    const pidKey = c.parent_id || '__ROOT__';
    const normAr = normalizeCatSegment(c.name_ar);
    const normEn = normalizeCatSegment(c.name_en);
    const entry = {
      id: c.id,
      name_ar: c.name_ar,
      is_offers_section: c.is_offers_section ? 1 : 0,
    };
    byId.set(c.id, { ...entry, parent_id: c.parent_id || null });
    if (normAr) {
      const pk = `${pidKey}::${normAr}`;
      if (!byParentAndNormName.has(pk)) byParentAndNormName.set(pk, entry);
      if (!bySingleNormName.has(normAr)) bySingleNormName.set(normAr, entry);
    }
    if (normEn) {
      const pkEn = `${pidKey}::${normEn}`;
      if (!byParentAndNormName.has(pkEn)) byParentAndNormName.set(pkEn, entry);
      if (!bySingleNormName.has(normEn)) bySingleNormName.set(normEn, entry);
    }
  }

  const insertStmt = db.prepare(`
    INSERT INTO categories (
      id, scope, merchant_id, parent_id, level, full_path_ar, name_ar, name_en,
      image_url, sort_order, is_offers_section, is_active, group_key, group_name_ar
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 1, 'groceries', 'المقاضي')
  `);

  return {
    scope,
    merchantId,
    byParentAndNormName,
    byId,
    bySingleNormName,
    insertStmt,
  };
}

/**
 * Resolves a category path string like "سوبر ماركت > مخبوزات > كرواسون وكيك;"
 * from Root -> Sub -> Leaf, creating any missing categories in the hierarchy automatically.
 * Also supports direct category IDs (e.g. "cat_coffee_tea") or single-level category names.
 */
export function resolveOrCreateCategoryPath(
  ctx: CategoryPathResolverContext,
  rawCategoryInput: string,
  fallbackCategoryId: string | null = null
): {
  category_id: string | null;
  is_offers_section: number;
  created_count: number;
  segments: string[];
  excel_path: string;
} {
  const raw = String(rawCategoryInput || '').trim();
  if (!raw) {
    return {
      category_id: fallbackCategoryId,
      is_offers_section: 0,
      created_count: 0,
      segments: [],
      excel_path: '',
    };
  }

  // Direct ID match
  const directById = ctx.byId.get(raw);
  if (directById) {
    return {
      category_id: directById.id,
      is_offers_section: directById.is_offers_section,
      created_count: 0,
      segments: [directById.name_ar],
      excel_path: `${directById.name_ar};`,
    };
  }

  const segments = parseCategoryHierarchyPath(raw);
  if (segments.length === 0) {
    return {
      category_id: fallbackCategoryId,
      is_offers_section: 0,
      created_count: 0,
      segments: [],
      excel_path: '',
    };
  }

  // If single segment (no hierarchy separator), try matching an existing category at any level first
  if (segments.length === 1) {
    const normSingle = normalizeCatSegment(segments[0]);
    const existingSingle = ctx.bySingleNormName.get(normSingle);
    if (existingSingle) {
      return {
        category_id: existingSingle.id,
        is_offers_section: existingSingle.is_offers_section,
        created_count: 0,
        segments,
        excel_path: formatCategoryExcelPath(segments),
      };
    }
  }

  // Walk the hierarchy from Root (level 0) -> Sub (level 1) -> ... -> Leaf (level N)
  let currentParentId: string | null = null;
  let lastCategoryId: string | null = fallbackCategoryId;
  let lastIsOffers = 0;
  let createdCount = 0;
  const resolvedNames: string[] = [];

  for (let level = 0; level < segments.length; level++) {
    const segName = segments[level];
    const normSeg = normalizeCatSegment(segName);
    const parentKey = currentParentId || '__ROOT__';
    const lookupKey = `${parentKey}::${normSeg}`;

    let found = ctx.byParentAndNormName.get(lookupKey);
    if (!found) {
      const newId = uid('cat');
      const isOffers = ['العروض', 'عروض', 'عروض المتجر', 'offers'].includes(segName.toLowerCase()) ? 1 : 0;
      const pathSoFar = formatCategoryExcelPath([...resolvedNames, segName]);
      ctx.insertStmt.run(
        newId,
        ctx.scope,
        ctx.merchantId,
        currentParentId,
        level,
        pathSoFar,
        segName,
        segName,
        20 + level * 10,
        isOffers
      );
      found = { id: newId, name_ar: segName, is_offers_section: isOffers };
      ctx.byParentAndNormName.set(lookupKey, found);
      ctx.byId.set(newId, { ...found, parent_id: currentParentId });
      if (!ctx.bySingleNormName.has(normSeg)) {
        ctx.bySingleNormName.set(normSeg, found);
      }
      createdCount += 1;
    }

    resolvedNames.push(found.name_ar);
    currentParentId = found.id;
    lastCategoryId = found.id;
    lastIsOffers = found.is_offers_section;
  }

  return {
    category_id: lastCategoryId,
    is_offers_section: lastIsOffers,
    created_count: createdCount,
    segments: resolvedNames,
    excel_path: formatCategoryExcelPath(resolvedNames),
  };
}
