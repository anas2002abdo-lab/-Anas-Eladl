import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { isCloudSqlConfigured, pgDb } from '../db/index.ts';
import * as schema from '../db/schema.ts';

export class CloudSqlUnavailableError extends Error {
  readonly statusCode = 503;
  constructor(message = 'الخدمة في وضع الصيانة المؤقتة لحماية البيانات، يرجى المحاولة بعد لحظات.') {
    super(message);
    this.name = 'CloudSqlUnavailableError';
  }
}

interface TableRegistryEntry {
  name: string;
  table: PgTable;
  pkName: string;
  pkColumn: PgColumn;
}

// Complete parent-first ordered registry of all 44 operational Otlobha tables.
// UPSERT runs forward (parents -> children); DELETE runs in reverse (children -> parents).
const SYNCED_TABLES: TableRegistryEntry[] = [
  { name: 'service_configs', table: schema.serviceConfigs, pkName: 'service_key', pkColumn: schema.serviceConfigs.service_key },
  { name: 'service_zones', table: schema.serviceZones, pkName: 'id', pkColumn: schema.serviceZones.id },
  { name: 'pricing_rules', table: schema.pricingRules, pkName: 'id', pkColumn: schema.pricingRules.id },
  { name: 'dispatch_config', table: schema.dispatchConfig, pkName: 'id', pkColumn: schema.dispatchConfig.id },
  { name: 'roles', table: schema.roles, pkName: 'code', pkColumn: schema.roles.code },
  { name: 'admin_users', table: schema.adminUsers, pkName: 'id', pkColumn: schema.adminUsers.id },
  { name: 'financial_model_settings', table: schema.financialModelSettings, pkName: 'id', pkColumn: schema.financialModelSettings.id },
  { name: 'invoice_design_settings', table: schema.invoiceDesignSettings, pkName: 'id', pkColumn: schema.invoiceDesignSettings.id },
  { name: 'payment_settings', table: schema.paymentSettings, pkName: 'id', pkColumn: schema.paymentSettings.id },
  { name: 'coupons', table: schema.coupons, pkName: 'id', pkColumn: schema.coupons.id },
  { name: 'customers', table: schema.customers, pkName: 'id', pkColumn: schema.customers.id },
  { name: 'captains', table: schema.captains, pkName: 'id', pkColumn: schema.captains.id },
  { name: 'captain_documents', table: schema.captainDocuments, pkName: 'id', pkColumn: schema.captainDocuments.id },
  { name: 'captain_ratings', table: schema.captainRatings, pkName: 'id', pkColumn: schema.captainRatings.id },
  { name: 'merchants', table: schema.merchants, pkName: 'id', pkColumn: schema.merchants.id },
  { name: 'categories', table: schema.categories, pkName: 'id', pkColumn: schema.categories.id },
  { name: 'master_products', table: schema.masterProducts, pkName: 'id', pkColumn: schema.masterProducts.id },
  { name: 'product_attributes', table: schema.productAttributes, pkName: 'id', pkColumn: schema.productAttributes.id },
  { name: 'product_images', table: schema.productImages, pkName: 'id', pkColumn: schema.productImages.id },
  { name: 'products', table: schema.products, pkName: 'id', pkColumn: schema.products.id },
  { name: 'product_matching_requests', table: schema.productMatchingRequests, pkName: 'id', pkColumn: schema.productMatchingRequests.id },
  { name: 'product_deals', table: schema.productDeals, pkName: 'id', pkColumn: schema.productDeals.id },
  { name: 'catalog_merge_audit', table: schema.catalogMergeAudit, pkName: 'id', pkColumn: schema.catalogMergeAudit.id },
  { name: 'storefront_banners', table: schema.storefrontBanners, pkName: 'id', pkColumn: schema.storefrontBanners.id },
  { name: 'orders', table: schema.orders, pkName: 'id', pkColumn: schema.orders.id },
  { name: 'order_stores', table: schema.orderStores, pkName: 'id', pkColumn: schema.orderStores.id },
  { name: 'order_chat_messages', table: schema.orderChatMessages, pkName: 'id', pkColumn: schema.orderChatMessages.id },
  { name: 'trips', table: schema.trips, pkName: 'id', pkColumn: schema.trips.id },
  { name: 'trip_chat_messages', table: schema.tripChatMessages, pkName: 'id', pkColumn: schema.tripChatMessages.id },
  { name: 'deliveries', table: schema.deliveries, pkName: 'id', pkColumn: schema.deliveries.id },
  { name: 'market_listings', table: schema.marketListings, pkName: 'id', pkColumn: schema.marketListings.id },
  { name: 'wallets', table: schema.wallets, pkName: 'id', pkColumn: schema.wallets.id },
  { name: 'ledger_entries', table: schema.ledgerEntries, pkName: 'id', pkColumn: schema.ledgerEntries.id },
  { name: 'settlements', table: schema.settlements, pkName: 'id', pkColumn: schema.settlements.id },
  { name: 'pos_invoices', table: schema.posInvoices, pkName: 'id', pkColumn: schema.posInvoices.id },
  { name: 'complaints', table: schema.complaints, pkName: 'id', pkColumn: schema.complaints.id },
  { name: 'support_tickets', table: schema.supportTickets, pkName: 'id', pkColumn: schema.supportTickets.id },
  { name: 'support_messages', table: schema.supportMessages, pkName: 'id', pkColumn: schema.supportMessages.id },
  { name: 'notifications', table: schema.notifications, pkName: 'id', pkColumn: schema.notifications.id },
  { name: 'audit_logs', table: schema.auditLogs, pkName: 'id', pkColumn: schema.auditLogs.id },
  { name: 'email_otp_codes', table: schema.emailOtpCodes, pkName: 'id', pkColumn: schema.emailOtpCodes.id },
  { name: 'email_action_tokens', table: schema.emailActionTokens, pkName: 'id', pkColumn: schema.emailActionTokens.id },
  { name: 'user_sessions', table: schema.userSessions, pkName: 'id', pkColumn: schema.userSessions.id },
  { name: 'push_device_tokens', table: schema.pushDeviceTokens, pkName: 'id', pkColumn: schema.pushDeviceTokens.id },
];

const INITIALIZED_META_KEY = 'initialized_v1';
const DATA_VERSION_META_KEY = 'data_version';
const UPSERT_CHUNK_SIZE = 150;
const DELETE_CHUNK_SIZE = 400;
const READ_FRESHNESS_INTERVAL_MS = 4000;

let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let syncQueue: Promise<void> = Promise.resolve();
let localDataVersion: string | null = null;
let lastVersionCheckAt = 0;
let lastSyncedTotalChanges = -1;
let lastSyncAt: string | null = null;
let lastSyncError: string | null = null;

// In-memory snapshot of last committed state per table: tableName -> (pk -> canonical JSON signature)
const lastSyncedState = new Map<string, Map<string, string>>();
const sqliteColsCache = new Map<string, string[]>();

const TRANSIENT_PG_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (Cloud SQL waking from scale-to-zero)
  '57014', // query_canceled
  '53300', // too_many_connections
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isTransientPgError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code && TRANSIENT_PG_CODES.has(String(e.code))) return true;
  const msg = String(e.message || '').toLowerCase();
  if (
    msg.includes('connection terminated') ||
    msg.includes('terminating connection') ||
    msg.includes('the database system is starting up') ||
    msg.includes('the database system is shutting down') ||
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connection timeout') ||
    msg.includes('too many clients') ||
    msg.includes('remaining connection slots') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('epipe') ||
    msg.includes('etimedout') ||
    msg.includes('client has encountered a connection error') ||
    msg.includes('connection ended unexpectedly') ||
    msg.includes('cannot connect now')
  ) {
    return true;
  }
  if (e.cause && e.cause !== err) {
    return isTransientPgError(e.cause);
  }
  return false;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPgRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  const backoffs = [350, 800, 1600, 2600];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientPgError(err);
      if (!transient || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = backoffs[Math.min(attempt - 1, backoffs.length - 1)];
      console.warn(
        `[CloudSQL] Transient error during ${label} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms:`,
        err instanceof Error ? err.message : String(err)
      );
      await sleepMs(delayMs);
    }
  }
  throw lastErr;
}

function getSqliteTotalChanges(sqliteDb: Database.Database): number {
  try {
    const row = sqliteDb.prepare('SELECT total_changes() AS c').get() as { c?: number } | undefined;
    return Number(row?.c ?? 0);
  } catch {
    return -1;
  }
}

function getSqliteColumns(sqliteDb: Database.Database, tableName: string): string[] {
  const cached = sqliteColsCache.get(tableName);
  if (cached) return cached;
  const info = sqliteDb.prepare(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>;
  const cols = info.map((c) => c.name);
  sqliteColsCache.set(tableName, cols);
  return cols;
}

function coerceValueForPg(rawVal: unknown, col: PgColumn): unknown {
  const colType = col.columnType;
  const isNotNull = Boolean(col.notNull);
  const defVal = col.default;

  if (colType === 'PgInteger') {
    if (rawVal === null || rawVal === undefined || rawVal === '') {
      return isNotNull ? (typeof defVal === 'number' ? defVal : 0) : null;
    }
    if (typeof rawVal === 'boolean') return rawVal ? 1 : 0;
    const n = Math.trunc(Number(rawVal));
    return Number.isFinite(n) ? n : isNotNull ? 0 : null;
  }

  if (colType === 'PgDoublePrecision') {
    if (rawVal === null || rawVal === undefined || rawVal === '') {
      return isNotNull ? (typeof defVal === 'number' ? defVal : 0) : null;
    }
    const n = Number(rawVal);
    return Number.isFinite(n) ? n : isNotNull ? 0 : null;
  }

  // PgText or fallback
  if (rawVal === null || rawVal === undefined) {
    return isNotNull ? (typeof defVal === 'string' ? defVal : '') : null;
  }
  return typeof rawVal === 'string' ? rawVal : String(rawVal);
}

function normalizeRowForPg(entry: TableRegistryEntry, rawRow: Record<string, unknown>): Record<string, unknown> {
  const pgCols = getTableColumns(entry.table);
  const normalized: Record<string, unknown> = {};
  for (const [propKey, colDef] of Object.entries(pgCols)) {
    normalized[propKey] = coerceValueForPg(rawRow[propKey], colDef as PgColumn);
  }
  return normalized;
}

function rowSignature(entry: TableRegistryEntry, normalizedPgRow: Record<string, unknown>): string {
  const pgCols = Object.keys(getTableColumns(entry.table));
  const orderedValues = pgCols.map((k) => normalizedPgRow[k] ?? null);
  return JSON.stringify(orderedValues);
}

function buildConflictUpdateSet(entry: TableRegistryEntry): Record<string, ReturnType<typeof sql.raw>> {
  const pgCols = getTableColumns(entry.table);
  const updateSet: Record<string, ReturnType<typeof sql.raw>> = {};
  for (const [propKey, colDef] of Object.entries(pgCols)) {
    if (propKey === entry.pkName) continue;
    const sqlColName = (colDef as PgColumn).name;
    updateSet[propKey] = sql.raw(`excluded."${sqlColName}"`);
  }
  return updateSet;
}

function captureSnapshotFromSqlite(sqliteDb: Database.Database): void {
  lastSyncedState.clear();
  for (const entry of SYNCED_TABLES) {
    const map = new Map<string, string>();
    const rows = sqliteDb.prepare(`SELECT * FROM "${entry.name}"`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const pkRaw = row[entry.pkName];
      if (pkRaw === null || pkRaw === undefined) continue;
      const pk = String(pkRaw);
      const pgRow = normalizeRowForPg(entry, row);
      map.set(pk, rowSignature(entry, pgRow));
    }
    lastSyncedState.set(entry.name, map);
  }
  lastSyncedTotalChanges = getSqliteTotalChanges(sqliteDb);
}

async function fetchAllPgTables(): Promise<Map<string, Array<Record<string, unknown>>>> {
  return withPgRetry('fetchAllPgTables', async () => {
    const result = new Map<string, Array<Record<string, unknown>>>();
    const BATCH_CONCURRENCY = 6;
    for (let i = 0; i < SYNCED_TABLES.length; i += BATCH_CONCURRENCY) {
      const slice = SYNCED_TABLES.slice(i, i + BATCH_CONCURRENCY);
      const fetched = await Promise.all(
        slice.map(async (entry) => {
          const rows = (await pgDb.select().from(entry.table)) as Array<Record<string, unknown>>;
          return { name: entry.name, rows };
        })
      );
      for (const item of fetched) {
        result.set(item.name, item.rows);
      }
    }
    return result;
  });
}

function hydrateSqliteFromPgData(
  sqliteDb: Database.Database,
  pgData: Map<string, Array<Record<string, unknown>>>,
  rebuildFtsFn?: () => void
): void {
  sqliteDb.pragma('foreign_keys = OFF');
  try {
    const tx = sqliteDb.transaction(() => {
      for (const entry of SYNCED_TABLES) {
        const sqliteCols = getSqliteColumns(sqliteDb, entry.name);
        if (sqliteCols.length === 0) continue;

        sqliteDb.prepare(`DELETE FROM "${entry.name}"`).run();
        const rows = pgData.get(entry.name) || [];
        if (rows.length === 0) continue;

        const pgColKeys = new Set(Object.keys(getTableColumns(entry.table)));
        const activeCols = sqliteCols.filter((c) => pgColKeys.has(c));
        if (activeCols.length === 0) continue;

        const placeholders = activeCols.map(() => '?').join(', ');
        const colList = activeCols.map((c) => `"${c}"`).join(', ');
        const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO "${entry.name}" (${colList}) VALUES (${placeholders})`);

        for (const row of rows) {
          const vals = activeCols.map((col) => {
            const v = row[col];
            if (v === null || v === undefined) return null;
            if (typeof v === 'boolean') return v ? 1 : 0;
            return v;
          });
          stmt.run(...vals);
        }
      }
    });
    tx();
  } finally {
    sqliteDb.pragma('foreign_keys = ON');
  }

  if (rebuildFtsFn) {
    rebuildFtsFn();
  }
}

function makeNextDataVersion(): string {
  return `${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
}

async function seedCloudSqlFromSqlite(sqliteDb: Database.Database): Promise<string> {
  const initialVersion = makeNextDataVersion();
  await withPgRetry('seedCloudSqlFromSqlite', async () => {
    await pgDb.transaction(async (tx) => {
      for (const entry of SYNCED_TABLES) {
        const rows = sqliteDb.prepare(`SELECT * FROM "${entry.name}"`).all() as Array<Record<string, unknown>>;
        if (rows.length === 0) continue;

        const normalizedRows = rows
          .filter((r) => r[entry.pkName] !== null && r[entry.pkName] !== undefined)
          .map((r) => normalizeRowForPg(entry, r));

        const conflictSet = buildConflictUpdateSet(entry);
        for (let i = 0; i < normalizedRows.length; i += UPSERT_CHUNK_SIZE) {
          const chunk = normalizedRows.slice(i, i + UPSERT_CHUNK_SIZE);
          await tx
            .insert(entry.table)
            .values(chunk as never)
            .onConflictDoUpdate({
              target: entry.pkColumn,
              set: conflictSet as never,
            });
        }
      }

      const nowIso = new Date().toISOString();
      await tx
        .insert(schema.cloudSqlMeta)
        .values([
          { key: INITIALIZED_META_KEY, value: nowIso, updated_at: new Date() },
          { key: DATA_VERSION_META_KEY, value: initialVersion, updated_at: new Date() },
        ])
        .onConflictDoUpdate({
          target: schema.cloudSqlMeta.key,
          set: {
            value: sql.raw('excluded."value"'),
            updated_at: sql.raw('excluded."updated_at"'),
          },
        });
    });
  });
  return initialVersion;
}

async function fetchRemoteDataVersion(): Promise<string | null> {
  return withPgRetry('fetchRemoteDataVersion', async () => {
    const rows = await pgDb
      .select({ value: schema.cloudSqlMeta.value })
      .from(schema.cloudSqlMeta)
      .where(eq(schema.cloudSqlMeta.key, DATA_VERSION_META_KEY))
      .limit(1);
    return rows[0]?.value ?? null;
  });
}

async function reloadSqliteFromCloudSqlUnlocked(
  sqliteDb: Database.Database,
  rebuildFtsFn?: () => void,
  knownRemoteVersion?: string | null
): Promise<void> {
  const pgData = await fetchAllPgTables();
  hydrateSqliteFromPgData(sqliteDb, pgData, rebuildFtsFn);
  captureSnapshotFromSqlite(sqliteDb);
  localDataVersion = knownRemoteVersion !== undefined ? knownRemoteVersion : await fetchRemoteDataVersion();
  lastVersionCheckAt = Date.now();
  const countsSummary = `merchants=${pgData.get('merchants')?.length ?? 0}, products=${pgData.get('products')?.length ?? 0}, banners=${pgData.get('storefront_banners')?.length ?? 0}, categories=${pgData.get('categories')?.length ?? 0}, orders=${pgData.get('orders')?.length ?? 0}`;
  console.log(`[CloudSQL] Re-hydrated runtime cache from PostgreSQL (${countsSummary})`);
}

/**
 * Lazy single-flight hydration from Cloud SQL PostgreSQL.
 * Retries transient scale-to-zero wake-up errors automatically.
 * Fail-safe: if Cloud SQL is configured and unreachable, throws CloudSqlUnavailableError (503)
 * and refuses to serve an empty database or overwrite Cloud SQL.
 */
export async function ensureHydratedFromCloudSql(
  sqliteDb: Database.Database,
  rebuildFtsFn?: () => void
): Promise<void> {
  if (hydrated) return;

  if (!isCloudSqlConfigured()) {
    captureSnapshotFromSqlite(sqliteDb);
    hydrated = true;
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const metaRows = await withPgRetry('readCloudSqlMeta', async () =>
          pgDb
            .select()
            .from(schema.cloudSqlMeta)
            .where(inArray(schema.cloudSqlMeta.key, [INITIALIZED_META_KEY, DATA_VERSION_META_KEY]))
        );

        const initMeta = metaRows.find((r) => r.key === INITIALIZED_META_KEY);
        const verMeta = metaRows.find((r) => r.key === DATA_VERSION_META_KEY);

        let pgHasExistingData = Boolean(initMeta);

        if (!pgHasExistingData) {
          // Double-check core tables in case rows exist prior to meta marker
          pgHasExistingData = await withPgRetry('probeCoreTables', async () => {
            const [svcCheck, merCheck, custCheck, ordCheck, prdCheck, admCheck, catCheck, bnrCheck] =
              await Promise.all([
                pgDb.select().from(schema.serviceConfigs).limit(1),
                pgDb.select().from(schema.merchants).limit(1),
                pgDb.select().from(schema.customers).limit(1),
                pgDb.select().from(schema.orders).limit(1),
                pgDb.select().from(schema.products).limit(1),
                pgDb.select().from(schema.adminUsers).limit(1),
                pgDb.select().from(schema.categories).limit(1),
                pgDb.select().from(schema.storefrontBanners).limit(1),
              ]);
            return (
              svcCheck.length > 0 ||
              merCheck.length > 0 ||
              custCheck.length > 0 ||
              ordCheck.length > 0 ||
              prdCheck.length > 0 ||
              admCheck.length > 0 ||
              catCheck.length > 0 ||
              bnrCheck.length > 0
            );
          });
        }

        if (pgHasExistingData) {
          const preloadedTables = await fetchAllPgTables();
          hydrateSqliteFromPgData(sqliteDb, preloadedTables, rebuildFtsFn);

          let resolvedVersion = verMeta?.value ?? null;
          if (!initMeta || !resolvedVersion) {
            resolvedVersion = resolvedVersion || makeNextDataVersion();
            await withPgRetry('ensureCloudSqlMeta', async () => {
              await pgDb
                .insert(schema.cloudSqlMeta)
                .values([
                  { key: INITIALIZED_META_KEY, value: new Date().toISOString(), updated_at: new Date() },
                  { key: DATA_VERSION_META_KEY, value: resolvedVersion!, updated_at: new Date() },
                ])
                .onConflictDoNothing();
            });
          }

          localDataVersion = resolvedVersion;
          lastVersionCheckAt = Date.now();
          const countsSummary = `merchants=${preloadedTables.get('merchants')?.length ?? 0}, products=${preloadedTables.get('products')?.length ?? 0}, banners=${preloadedTables.get('storefront_banners')?.length ?? 0}, categories=${preloadedTables.get('categories')?.length ?? 0}, customers=${preloadedTables.get('customers')?.length ?? 0}, orders=${preloadedTables.get('orders')?.length ?? 0}`;
          console.log(`[CloudSQL] Hydrated primary runtime from PostgreSQL (${countsSummary})`);
        } else {
          localDataVersion = await seedCloudSqlFromSqlite(sqliteDb);
          lastVersionCheckAt = Date.now();
          console.log('[CloudSQL] Initialized fresh PostgreSQL database with Otlobha base seed data');
        }

        captureSnapshotFromSqlite(sqliteDb);
        hydrated = true;
        lastSyncError = null;
      } catch (err) {
        hydrationPromise = null;
        lastSyncError = err instanceof Error ? err.message : 'Unknown hydration error';
        console.error('[CloudSQL] Hydration error:', lastSyncError);
        throw new CloudSqlUnavailableError();
      }
    })();
  }

  return hydrationPromise;
}

/**
 * Ensures this server instance's SQLite read/write cache matches the latest Cloud SQL revision.
 * - Prevents stale state across multiple Cloud Run instances or Dev/Shared Preview containers.
 * - On read requests, checks `cloud_sql_meta.data_version` at most once every 4 seconds (1–2ms PK query).
 * - On mutating requests (`forceCheck: true`), always checks before executing the mutation so writes
 *   never operate on a stale local cache.
 */
export async function ensureFreshFromCloudSql(
  sqliteDb: Database.Database,
  rebuildFtsFn?: () => void,
  options?: { forceCheck?: boolean }
): Promise<void> {
  await ensureHydratedFromCloudSql(sqliteDb, rebuildFtsFn);
  if (!isCloudSqlConfigured()) return;

  const forceCheck = Boolean(options?.forceCheck);
  const now = Date.now();
  if (!forceCheck && now - lastVersionCheckAt < READ_FRESHNESS_INTERVAL_MS) {
    return;
  }

  // Serialize freshness check on syncQueue so it never races with an in-flight write-through commit
  const task = syncQueue.then(async () => {
    const insideNow = Date.now();
    if (!forceCheck && insideNow - lastVersionCheckAt < READ_FRESHNESS_INTERVAL_MS) {
      return;
    }
    try {
      const remoteVersion = await fetchRemoteDataVersion();
      lastVersionCheckAt = Date.now();
      if (remoteVersion && remoteVersion !== localDataVersion) {
        await reloadSqliteFromCloudSqlUnlocked(sqliteDb, rebuildFtsFn, remoteVersion);
      } else if (remoteVersion && !localDataVersion) {
        localDataVersion = remoteVersion;
      }
    } catch (err) {
      lastSyncError = err instanceof Error ? err.message : 'Unknown freshness check error';
      console.error('[CloudSQL] Freshness check error:', lastSyncError);
      // On mutating requests, fail safe with 503 rather than writing against potentially stale data
      if (forceCheck) {
        throw new CloudSqlUnavailableError();
      }
    }
  });

  syncQueue = task.catch(() => {});
  await task;
}

/**
 * Awaited delta write-through sync to Cloud SQL PostgreSQL via Drizzle ORM.
 * - Computes exact per-table upserts & hard deletes against the last committed snapshot.
 * - Deletes in REVERSE table order (children -> parents) and upserts in FORWARD order (parents -> children).
 * - Atomically advances `cloud_sql_meta.data_version` inside the same PostgreSQL transaction.
 * - Retries transient Cloud SQL scale-to-zero / connection-reset errors automatically.
 * - Fail-safe rollback: if PostgreSQL still cannot commit after retries, re-hydrates local SQLite from
 *   Cloud SQL so local cache NEVER silently diverges from persistent storage.
 */
export async function syncChangesToCloudSql(
  sqliteDb: Database.Database,
  reason = 'mutation',
  rebuildFtsFn?: () => void
): Promise<{ tablesUpdated: number; upserted: number; deleted: number }> {
  if (!isCloudSqlConfigured()) {
    lastSyncedTotalChanges = getSqliteTotalChanges(sqliteDb);
    return { tablesUpdated: 0, upserted: 0, deleted: 0 };
  }
  if (!hydrated) {
    throw new CloudSqlUnavailableError('تعذر حفظ البيانات قبل اكتمال التحميل من قاعدة البيانات الرئيسية.');
  }

  let result = { tablesUpdated: 0, upserted: 0, deleted: 0 };

  const task = syncQueue.then(async () => {
    const tableDeltas: Array<{
      entry: TableRegistryEntry;
      upserts: Array<Record<string, unknown>>;
      deletes: string[];
      nextSnapshot: Map<string, string>;
    }> = [];

    for (const entry of SYNCED_TABLES) {
      const prevMap = lastSyncedState.get(entry.name) ?? new Map<string, string>();
      const nextMap = new Map<string, string>();
      const upserts: Array<Record<string, unknown>> = [];
      const deletes: string[] = [];

      const rows = sqliteDb.prepare(`SELECT * FROM "${entry.name}"`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const pkRaw = row[entry.pkName];
        if (pkRaw === null || pkRaw === undefined) continue;
        const pk = String(pkRaw);
        const pgRow = normalizeRowForPg(entry, row);
        const sig = rowSignature(entry, pgRow);
        nextMap.set(pk, sig);
        if (prevMap.get(pk) !== sig) {
          upserts.push(pgRow);
        }
      }

      for (const prevPk of prevMap.keys()) {
        if (!nextMap.has(prevPk)) {
          deletes.push(prevPk);
        }
      }

      if (upserts.length > 0 || deletes.length > 0) {
        tableDeltas.push({ entry, upserts, deletes, nextSnapshot: nextMap });
      }
    }

    if (tableDeltas.length === 0) {
      lastSyncedTotalChanges = getSqliteTotalChanges(sqliteDb);
      result = { tablesUpdated: 0, upserted: 0, deleted: 0 };
      return;
    }

    const nextVersion = makeNextDataVersion();
    let totalUpserted = 0;
    let totalDeleted = 0;

    try {
      await withPgRetry(`sync:${reason}`, async () => {
        totalUpserted = 0;
        totalDeleted = 0;
        await pgDb.transaction(async (tx) => {
          // 1. Apply all DELETEs in REVERSE order (child tables before parent tables)
          for (let idx = tableDeltas.length - 1; idx >= 0; idx--) {
            const delta = tableDeltas[idx];
            if (delta.deletes.length > 0) {
              for (let i = 0; i < delta.deletes.length; i += DELETE_CHUNK_SIZE) {
                const chunk = delta.deletes.slice(i, i + DELETE_CHUNK_SIZE);
                await tx.delete(delta.entry.table).where(inArray(delta.entry.pkColumn, chunk));
              }
              totalDeleted += delta.deletes.length;
            }
          }

          // 2. Apply all UPSERTs in FORWARD order (parent tables before child tables)
          for (const delta of tableDeltas) {
            if (delta.upserts.length > 0) {
              const conflictSet = buildConflictUpdateSet(delta.entry);
              for (let i = 0; i < delta.upserts.length; i += UPSERT_CHUNK_SIZE) {
                const chunk = delta.upserts.slice(i, i + UPSERT_CHUNK_SIZE);
                await tx
                  .insert(delta.entry.table)
                  .values(chunk as never)
                  .onConflictDoUpdate({
                    target: delta.entry.pkColumn,
                    set: conflictSet as never,
                  });
              }
              totalUpserted += delta.upserts.length;
            }
          }

          // 3. Advance cross-instance revision marker atomically inside the same PG transaction
          await tx
            .insert(schema.cloudSqlMeta)
            .values({
              key: DATA_VERSION_META_KEY,
              value: nextVersion,
              updated_at: new Date(),
            })
            .onConflictDoUpdate({
              target: schema.cloudSqlMeta.key,
              set: {
                value: nextVersion,
                updated_at: new Date(),
              },
            });
        });
      });

      // Commit local snapshot only after PostgreSQL transaction succeeds
      for (const delta of tableDeltas) {
        lastSyncedState.set(delta.entry.name, delta.nextSnapshot);
      }
      localDataVersion = nextVersion;
      lastVersionCheckAt = Date.now();
      lastSyncedTotalChanges = getSqliteTotalChanges(sqliteDb);
      lastSyncAt = new Date().toISOString();
      lastSyncError = null;

      result = {
        tablesUpdated: tableDeltas.length,
        upserted: totalUpserted,
        deleted: totalDeleted,
      };
    } catch (err) {
      lastSyncError = err instanceof Error ? err.message : 'Unknown write-through error';
      console.error(`[CloudSQL] Write-through sync failed (${reason}):`, lastSyncError);

      // Prevent silent divergence where SQLite shows unsaved rows that vanish after container idle/restart:
      // Roll back local SQLite to the authoritative PostgreSQL state.
      try {
        await reloadSqliteFromCloudSqlUnlocked(sqliteDb, rebuildFtsFn);
      } catch (rollbackErr) {
        console.error(
          '[CloudSQL] Could not reload SQLite after sync failure:',
          rollbackErr instanceof Error ? rollbackErr.message : rollbackErr
        );
      }

      throw new CloudSqlUnavailableError('تعذر حفظ التغييرات في قاعدة البيانات الرئيسية مؤقتًا، يرجى المحاولة مرة أخرى.');
    }
  });

  // Keep syncQueue alive even if a single sync fails so subsequent requests aren't permanently poisoned
  syncQueue = task.catch(() => {});
  await task;
  return result;
}

/**
 * Zero-cost safety net for routes that mutate SQLite outside `res.json`/`res.send` (e.g., GET verify links,
 * 204 responses, or background tasks). Reads SQLite `total_changes()` in-memory (~0.01ms) and only talks
 * to Cloud SQL when an unsynced SQLite write actually occurred.
 */
export async function syncIfSqliteMutated(
  sqliteDb: Database.Database,
  reason = 'deferred_check',
  rebuildFtsFn?: () => void
): Promise<void> {
  if (!isCloudSqlConfigured() || !hydrated) return;
  const currentChanges = getSqliteTotalChanges(sqliteDb);
  if (currentChanges < 0 || currentChanges === lastSyncedTotalChanges) return;
  try {
    await syncChangesToCloudSql(sqliteDb, reason, rebuildFtsFn);
  } catch (err) {
    console.error(`[CloudSQL] Deferred mutation sync failed (${reason}):`, err instanceof Error ? err.message : err);
  }
}

export async function flushCloudSqlBeforeShutdown(sqliteDb: Database.Database): Promise<void> {
  if (!isCloudSqlConfigured() || !hydrated) return;
  try {
    const res = await syncChangesToCloudSql(sqliteDb, 'shutdown');
    if (res.upserted > 0 || res.deleted > 0) {
      console.log(
        `[CloudSQL] Flushed pending changes on shutdown (tables=${res.tablesUpdated}, upserts=${res.upserted}, deletes=${res.deleted})`
      );
    }
  } catch (err) {
    console.error('[CloudSQL] Shutdown flush warning:', err instanceof Error ? err.message : 'Unknown error');
  }
}

export function isCloudSqlHydrated(): boolean {
  return hydrated;
}

export function getCloudSqlPersistenceStatus(): {
  configured: boolean;
  hydrated: boolean;
  data_version: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
} {
  return {
    configured: isCloudSqlConfigured(),
    hydrated,
    data_version: localDataVersion,
    last_sync_at: lastSyncAt,
    last_sync_error: lastSyncError,
  };
}
