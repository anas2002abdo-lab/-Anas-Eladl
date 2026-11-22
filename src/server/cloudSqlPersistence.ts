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

// Complete ordered registry of all 44 operational Otlobha tables
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
const UPSERT_CHUNK_SIZE = 150;
const DELETE_CHUNK_SIZE = 400;

let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let syncQueue: Promise<void> = Promise.resolve();

// In-memory snapshot of last committed state per table: tableName -> (pk -> canonical JSON signature)
const lastSyncedState = new Map<string, Map<string, string>>();
const sqliteColsCache = new Map<string, string[]>();

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
}

async function fetchAllPgTables(): Promise<Map<string, Array<Record<string, unknown>>>> {
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

async function seedCloudSqlFromSqlite(sqliteDb: Database.Database): Promise<void> {
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

    await tx
      .insert(schema.cloudSqlMeta)
      .values({
        key: INITIALIZED_META_KEY,
        value: new Date().toISOString(),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.cloudSqlMeta.key,
        set: {
          value: new Date().toISOString(),
          updated_at: new Date(),
        },
      });
  });
}

/**
 * Lazy single-flight hydration from Cloud SQL PostgreSQL.
 * Runs on the first incoming API request after server startup — never at module load time.
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
        const metaRows = await pgDb
          .select()
          .from(schema.cloudSqlMeta)
          .where(eq(schema.cloudSqlMeta.key, INITIALIZED_META_KEY))
          .limit(1);

        let pgHasExistingData = metaRows.length > 0;
        let preloadedTables: Map<string, Array<Record<string, unknown>>> | null = null;

        if (!pgHasExistingData) {
          // Double-check core tables in case rows exist prior to meta marker
          const [svcCheck, merCheck, custCheck, ordCheck, prdCheck, admCheck] = await Promise.all([
            pgDb.select().from(schema.serviceConfigs).limit(1),
            pgDb.select().from(schema.merchants).limit(1),
            pgDb.select().from(schema.customers).limit(1),
            pgDb.select().from(schema.orders).limit(1),
            pgDb.select().from(schema.products).limit(1),
            pgDb.select().from(schema.adminUsers).limit(1),
          ]);
          pgHasExistingData =
            svcCheck.length > 0 ||
            merCheck.length > 0 ||
            custCheck.length > 0 ||
            ordCheck.length > 0 ||
            prdCheck.length > 0 ||
            admCheck.length > 0;
        }

        if (pgHasExistingData) {
          preloadedTables = await fetchAllPgTables();
          hydrateSqliteFromPgData(sqliteDb, preloadedTables, rebuildFtsFn);

          if (metaRows.length === 0) {
            await pgDb
              .insert(schema.cloudSqlMeta)
              .values({
                key: INITIALIZED_META_KEY,
                value: new Date().toISOString(),
                updated_at: new Date(),
              })
              .onConflictDoNothing();
          }

          const countsSummary = `merchants=${preloadedTables.get('merchants')?.length ?? 0}, products=${preloadedTables.get('products')?.length ?? 0}, customers=${preloadedTables.get('customers')?.length ?? 0}, orders=${preloadedTables.get('orders')?.length ?? 0}`;
          console.log(`[CloudSQL] Hydrated primary runtime from PostgreSQL (${countsSummary})`);
        } else {
          await seedCloudSqlFromSqlite(sqliteDb);
          console.log('[CloudSQL] Initialized fresh PostgreSQL database with Otlobha base seed data');
        }

        captureSnapshotFromSqlite(sqliteDb);
        hydrated = true;
      } catch (err) {
        hydrationPromise = null;
        console.error('[CloudSQL] Hydration error:', err instanceof Error ? err.message : 'Unknown error');
        throw new CloudSqlUnavailableError();
      }
    })();
  }

  return hydrationPromise;
}

/**
 * Awaited delta write-through sync to Cloud SQL PostgreSQL via Drizzle ORM.
 * Computes exact per-table upserts & hard deletes against the last committed snapshot,
 * applies them inside a single PostgreSQL transaction, and updates the snapshot only after commit.
 * Fail-safe: refuses to write if Cloud SQL is configured but not yet hydrated.
 */
export async function syncChangesToCloudSql(
  sqliteDb: Database.Database,
  reason = 'mutation'
): Promise<{ tablesUpdated: number; upserted: number; deleted: number }> {
  if (!isCloudSqlConfigured()) {
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
      result = { tablesUpdated: 0, upserted: 0, deleted: 0 };
      return;
    }

    let totalUpserted = 0;
    let totalDeleted = 0;

    try {
      await pgDb.transaction(async (tx) => {
        for (const delta of tableDeltas) {
          if (delta.deletes.length > 0) {
            for (let i = 0; i < delta.deletes.length; i += DELETE_CHUNK_SIZE) {
              const chunk = delta.deletes.slice(i, i + DELETE_CHUNK_SIZE);
              await tx.delete(delta.entry.table).where(inArray(delta.entry.pkColumn, chunk));
            }
            totalDeleted += delta.deletes.length;
          }

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
      });

      // Commit local snapshot only after PostgreSQL transaction succeeds
      for (const delta of tableDeltas) {
        lastSyncedState.set(delta.entry.name, delta.nextSnapshot);
      }

      result = {
        tablesUpdated: tableDeltas.length,
        upserted: totalUpserted,
        deleted: totalDeleted,
      };
    } catch (err) {
      console.error(
        `[CloudSQL] Write-through sync failed (${reason}):`,
        err instanceof Error ? err.message : 'Unknown error'
      );
      throw new CloudSqlUnavailableError('تعذر حفظ التغييرات في قاعدة البيانات الرئيسية مؤقتًا، يرجى المحاولة مرة أخرى.');
    }
  });

  // Keep syncQueue alive even if a single sync fails so subsequent requests aren't permanently poisoned
  syncQueue = task.catch(() => {});
  await task;
  return result;
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
