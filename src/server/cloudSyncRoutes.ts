import type { Express, NextFunction, Request, Response } from 'express';
import { db, isProductsFtsReady } from './db.ts';
import { requireStrictAdminAuth } from './auth.ts';

const CORE_TABLES = [
  'customers',
  'captains',
  'captain_documents',
  'merchants',
  'categories',
  'products',
  'orders',
  'order_stores',
  'trips',
  'deliveries',
  'wallets',
  'ledger_entries',
  'settlements',
] as const;

const PLATFORM_CONFIG_TABLES = [
  'service_configs',
  'service_zones',
  'pricing_rules',
  'dispatch_config',
  'coupons',
  'payment_settings',
  'financial_model_settings',
  'invoice_design_settings',
] as const;

type CoreTableName = (typeof CORE_TABLES)[number];
type PlatformConfigTableName = (typeof PLATFORM_CONFIG_TABLES)[number];

const ALLOWED_RESTORE_TABLES = new Set<string>([...CORE_TABLES, ...PLATFORM_CONFIG_TABLES]);

let mutationVersion = 0;
let lastMutationAt: string | null = null;
const serverBootAt = new Date().toISOString();
let restoredFromCloudAt: string | null = null;
let lastCloudSyncAt: string | null = null;
let lastSyncedMutationVersion = -1;

const tableColumnsCache = new Map<string, string[]>();

function getTableColumns(tableName: string): string[] {
  if (!ALLOWED_RESTORE_TABLES.has(tableName)) return [];
  const cached = tableColumnsCache.get(tableName);
  if (cached) return cached;
  const info = db.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>;
  const cols = info.map((c) => c.name);
  tableColumnsCache.set(tableName, cols);
  return cols;
}

function getRowCount(tableName: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number } | undefined;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

function getAllCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of CORE_TABLES) {
    counts[t] = getRowCount(t);
  }
  let configCount = 0;
  for (const t of PLATFORM_CONFIG_TABLES) {
    configCount += getRowCount(t);
  }
  counts.platform_configs = configCount;
  return counts;
}

function rebuildProductsFtsIndex(): void {
  if (!isProductsFtsReady()) return;
  try {
    db.exec(`
      DELETE FROM products_fts;
      INSERT INTO products_fts(rowid, name_ar, name_en, description, addons_text, merchant_name)
      SELECT p.rowid,
             COALESCE(p.name_ar, ''),
             COALESCE(p.name_en, ''),
             COALESCE(p.description, ''),
             COALESCE(p.addons_text, ''),
             COALESCE(m.business_name_ar, '')
      FROM products p
      LEFT JOIN merchants m ON m.id = p.merchant_id;
    `);
  } catch (err) {
    console.warn('[CloudSync] FTS5 rebuild warning:', err instanceof Error ? err.message : err);
  }
}

function upsertRowsIntoTable(tableName: string, rows: Array<Record<string, unknown>>): number {
  if (!ALLOWED_RESTORE_TABLES.has(tableName) || !Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  const validCols = getTableColumns(tableName);
  if (validCols.length === 0) return 0;

  let inserted = 0;
  for (const rawRow of rows) {
    if (!rawRow || typeof rawRow !== 'object') continue;
    const colsToUse = validCols.filter((col) => Object.prototype.hasOwnProperty.call(rawRow, col) && rawRow[col] !== undefined);
    if (colsToUse.length === 0) continue;

    const placeholders = colsToUse.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${tableName} (${colsToUse.join(', ')}) VALUES (${placeholders})`;
    const values = colsToUse.map((col) => {
      const v = rawRow[col];
      if (v === null || v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    db.prepare(sql).run(...values);
    inserted += 1;
  }
  return inserted;
}

export function registerCloudSyncRoutes(app: Express): void {
  // Track every mutating API request so the Cloud Vault knows immediately when to sync
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.path.startsWith('/admin/cloud-sync')) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          mutationVersion += 1;
          lastMutationAt = new Date().toISOString();
        }
      });
    }
    next();
  });

  app.get('/api/admin/cloud-sync/status', requireStrictAdminAuth, (_req, res) => {
    const counts = getAllCounts();
    const totalCoreRecords =
      counts.customers +
      counts.captains +
      counts.merchants +
      counts.categories +
      counts.products +
      counts.orders +
      counts.trips +
      counts.deliveries +
      counts.wallets;

    const isFreshEmpty =
      restoredFromCloudAt === null &&
      counts.customers === 0 &&
      counts.orders === 0 &&
      counts.products === 0 &&
      counts.captains === 0 &&
      counts.merchants === 0;

    const fingerprint = `v${mutationVersion}:c${counts.customers}:o${counts.orders}:t${counts.trips}:d${counts.deliveries}:cap${counts.captains}:m${counts.merchants}:cat${counts.categories}:p${counts.products}:w${counts.wallets}:l${counts.ledger_entries}:s${counts.settlements}`;

    res.json({
      counts,
      total_core_records: totalCoreRecords,
      mutation_version: mutationVersion,
      last_mutation_at: lastMutationAt,
      server_boot_at: serverBootAt,
      restored_from_cloud_at: restoredFromCloudAt,
      last_cloud_sync_at: lastCloudSyncAt,
      has_unsynced_changes: mutationVersion !== lastSyncedMutationVersion,
      db_fingerprint: fingerprint,
      is_fresh_empty: isFreshEmpty,
    });
  });

  app.get('/api/admin/cloud-sync/export', requireStrictAdminAuth, (req, res) => {
    const collection = String(req.query.collection || 'all_core').trim();

    if (collection === 'products') {
      const page = Math.max(1, Number(req.query.page || 1) || 1);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 300) || 300));
      const offset = (page - 1) * limit;
      const total = getRowCount('products');
      const items = db
        .prepare('SELECT * FROM products ORDER BY rowid ASC LIMIT ? OFFSET ?')
        .all(limit, offset) as Array<Record<string, unknown>>;
      return res.json({
        collection: 'products',
        page,
        limit,
        total,
        has_more: offset + items.length < total,
        items,
      });
    }

    if (collection === 'platform_configs') {
      const configs: Array<{ config_group: PlatformConfigTableName; record_id: string; data: Record<string, unknown> }> = [];
      for (const table of PLATFORM_CONFIG_TABLES) {
        try {
          const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
          for (const row of rows) {
            const pk = String(row.id || row.service_key || `${table}_row`).trim();
            configs.push({
              config_group: table,
              record_id: `${table}__${pk}`,
              data: row,
            });
          }
        } catch {
          // skip if optional table missing
        }
      }
      return res.json({ collection: 'platform_configs', items: configs });
    }

    if (collection !== 'all_core' && CORE_TABLES.includes(collection as CoreTableName)) {
      const page = Math.max(1, Number(req.query.page || 1) || 1);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500) || 500));
      const offset = (page - 1) * limit;
      const total = getRowCount(collection);
      const items = db
        .prepare(`SELECT * FROM ${collection} ORDER BY rowid ASC LIMIT ? OFFSET ?`)
        .all(limit, offset) as Array<Record<string, unknown>>;
      return res.json({
        collection,
        page,
        limit,
        total,
        has_more: offset + items.length < total,
        items,
      });
    }

    // Default: export all core tables (except paginated products) + platform configs
    const bundle: Record<string, unknown> = {};
    for (const table of CORE_TABLES) {
      if (table === 'products') continue;
      bundle[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all();
    }
    const platformConfigs: Array<{ config_group: PlatformConfigTableName; record_id: string; data: Record<string, unknown> }> = [];
    for (const table of PLATFORM_CONFIG_TABLES) {
      try {
        const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
        for (const row of rows) {
          const pk = String(row.id || row.service_key || `${table}_row`).trim();
          platformConfigs.push({
            config_group: table,
            record_id: `${table}__${pk}`,
            data: row,
          });
        }
      } catch {
        // skip
      }
    }
    bundle.platform_configs = platformConfigs;
    bundle.products_total = getRowCount('products');
    bundle.mutation_version = mutationVersion;

    res.json(bundle);
  });

  app.post('/api/admin/cloud-sync/restore', requireStrictAdminAuth, (req, res) => {
    const body = (req.body || {}) as {
      collections?: Record<string, Array<Record<string, unknown>>>;
      platform_configs?: Array<{ config_group?: string; data?: Record<string, unknown> }>;
      finalize?: boolean;
    };

    const restoredCounts: Record<string, number> = {};
    const collections = body.collections && typeof body.collections === 'object' ? body.collections : {};
    const platformConfigs = Array.isArray(body.platform_configs) ? body.platform_configs : [];

    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        // Restore platform configs first (zones, services, etc.)
        if (platformConfigs.length > 0) {
          let cfgCount = 0;
          for (const item of platformConfigs) {
            const grp = String(item?.config_group || '').trim();
            if (grp && ALLOWED_RESTORE_TABLES.has(grp) && item?.data && typeof item.data === 'object') {
              cfgCount += upsertRowsIntoTable(grp, [item.data]);
            }
          }
          restoredCounts.platform_configs = cfgCount;
        }

        // Restore core tables in dependency-friendly order
        const orderedTables: CoreTableName[] = [
          'customers',
          'captains',
          'captain_documents',
          'merchants',
          'categories',
          'products',
          'orders',
          'order_stores',
          'trips',
          'deliveries',
          'wallets',
          'ledger_entries',
          'settlements',
        ];
        for (const table of orderedTables) {
          const rows = collections[table];
          if (Array.isArray(rows) && rows.length > 0) {
            restoredCounts[table] = upsertRowsIntoTable(table, rows);
          }
        }
      });
      tx();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    if (body.finalize) {
      rebuildProductsFtsIndex();
      restoredFromCloudAt = new Date().toISOString();
      lastCloudSyncAt = restoredFromCloudAt;
      lastSyncedMutationVersion = mutationVersion;
    }

    res.json({
      ok: true,
      restored_counts: restoredCounts,
      counts: getAllCounts(),
      restored_from_cloud_at: restoredFromCloudAt,
    });
  });

  app.post('/api/admin/cloud-sync/mark-synced', requireStrictAdminAuth, (req, res) => {
    const ver = Number((req.body as { mutation_version?: number } | undefined)?.mutation_version ?? mutationVersion);
    lastCloudSyncAt = new Date().toISOString();
    lastSyncedMutationVersion = Number.isFinite(ver) ? ver : mutationVersion;
    res.json({
      ok: true,
      last_cloud_sync_at: lastCloudSyncAt,
      synced_mutation_version: lastSyncedMutationVersion,
    });
  });
}
