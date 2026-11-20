import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  firebaseAuth,
  firestoreDb,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase.ts';

const BOOTSTRAP_ADMIN_EMAIL = 'anas2002abdo@gmail.com';
const MAX_BATCH_OPS = 380;

export interface CloudCounts {
  customers: number;
  orders: number;
  trips: number;
  deliveries: number;
  captains: number;
  merchants: number;
  categories: number;
  products: number;
  wallets: number;
  ledger_entries: number;
  settlements: number;
  platform_configs?: number;
}

export interface ServerSyncStatus {
  counts: CloudCounts;
  total_core_records: number;
  mutation_version: number;
  last_mutation_at: string | null;
  server_boot_at: string;
  restored_from_cloud_at: string | null;
  last_cloud_sync_at: string | null;
  has_unsynced_changes: boolean;
  db_fingerprint: string;
  is_fresh_empty: boolean;
}

export interface CloudVaultMeta {
  version: number;
  customersCount: number;
  ordersCount: number;
  tripsCount: number;
  deliveriesCount: number;
  captainsCount: number;
  merchantsCount: number;
  categoriesCount: number;
  productsCount: number;
  walletsCount: number;
  ledgerEntriesCount: number;
  settlementsCount: number;
  lastSourceFingerprint: string;
  updatedAt?: Date | null;
}

export interface CloudSyncProgress {
  phase: 'idle' | 'checking' | 'pushing' | 'restoring' | 'done' | 'error';
  message: string;
  processed: number;
  total: number;
}

function sanitizeId(raw: unknown, fallbackPrefix = 'rec'): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_0`;
}

function clampStr(raw: unknown, maxLen: number, fallback = ''): string {
  const s = raw === null || raw === undefined ? fallback : String(raw);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampNonNegNum(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clampNonNegInt(raw: unknown, fallback = 0): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clampInt(raw: unknown, fallback = 0): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? n : fallback;
}

function toBool(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

function buildSafeExtra(row: Record<string, unknown>, maxKeys = 58): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(row)) {
    if (count >= maxKeys) break;
    if (v === undefined) continue;
    if (typeof v === 'string' && v.length > 420000) {
      // Keep well below Firestore 1MB per-document cap
      out[k] = v.slice(0, 420000);
    } else if (typeof v === 'number' && !Number.isFinite(v)) {
      out[k] = 0;
    } else if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      out[k] = String(v).slice(0, 20000);
    }
    count += 1;
  }
  return out;
}

function buildCollectionQuery(colName: string, user: User) {
  const isBootstrap =
    user.emailVerified && String(user.email || '').toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  if (isBootstrap) {
    return collection(firestoreDb, colName);
  }
  return query(collection(firestoreDb, colName), where('ownerUid', '==', user.uid));
}

async function fetchExistingDocIds(colName: string, user: User): Promise<Set<string>> {
  try {
    const snap = await getDocs(buildCollectionQuery(colName, user));
    const ids = new Set<string>();
    snap.forEach((d) => ids.add(d.id));
    return ids;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colName);
  }
}

async function batchUpsertCollection(
  colName: string,
  user: User,
  docs: Array<{ id: string; createData: Record<string, unknown>; updateData: Record<string, unknown> }>,
  existingIds?: Set<string>,
  onChunk?: (written: number) => void
): Promise<number> {
  if (docs.length === 0) return 0;
  const knownExisting = existingIds ?? (await fetchExistingDocIds(colName, user));
  let written = 0;

  for (let i = 0; i < docs.length; i += MAX_BATCH_OPS) {
    const chunk = docs.slice(i, i + MAX_BATCH_OPS);
    const batch = writeBatch(firestoreDb);
    for (const item of chunk) {
      const ref = doc(firestoreDb, colName, item.id);
      if (knownExisting.has(item.id)) {
        batch.update(ref, {
          ...item.updateData,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          ...item.createData,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        knownExisting.add(item.id);
      }
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, colName);
    }
    written += chunk.length;
    onChunk?.(written);
  }
  return written;
}

// Strict blueprint-synchronized mappers (SQLite row -> Firestore document)

function mapCustomer(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'cust');
  const statusRaw = String(row.status || 'active');
  const status = ['active', 'suspended', 'blocked', 'deleted'].includes(statusRaw) ? statusRaw : 'active';
  const mutable = {
    fullName: clampStr(row.full_name || 'عميل اطلبها', 160, 'عميل اطلبها') || 'عميل اطلبها',
    email: clampStr(row.email, 180),
    phone: clampStr(row.phone, 40),
    passwordHash: clampStr(row.password_hash, 260),
    status,
    defaultZoneId: clampStr(row.default_zone_id, 128),
    addressLandmark: clampStr(row.address_landmark, 400),
    isEmailVerified: toBool(row.is_email_verified),
    sourceCreatedAt: clampStr(row.created_at, 64),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapCaptain(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'cap');
  const rating = Math.min(5, clampNonNegNum(row.rating_avg, 5));
  const mutable = {
    userId: clampStr(row.user_id || id, 128, id) || id,
    username: clampStr(row.username, 120),
    passwordHash: clampStr(row.password_hash, 260),
    fullName: clampStr(row.full_name || 'كابتن اطلبها', 160, 'كابتن اطلبها') || 'كابتن اطلبها',
    phone: clampStr(row.phone || '0000', 40, '0000') || '0000',
    nationalId: clampStr(row.national_id, 64),
    zoneName: clampStr(row.zone_name, 120),
    vehicleType: clampStr(row.vehicle_type, 64),
    verificationStatus: clampStr(row.verification_status, 40),
    availabilityStatus: clampStr(row.availability_status, 40),
    cashOnHand: clampNonNegNum(row.cash_on_hand, 0),
    cashLimit: clampNonNegNum(row.cash_limit, 1000),
    ratingAvg: rating,
    completedCount: clampNonNegInt(row.completed_count, 0),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapCaptainDoc(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'cdoc');
  const captainId = sanitizeId(row.captain_id, 'cap');
  const mutable = {
    captainId,
    docType: clampStr(row.doc_type || 'id', 80, 'id') || 'id',
    labelAr: clampStr(row.label_ar, 160),
    reviewStatus: clampStr(row.review_status, 40),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapMerchant(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'mer');
  const comm = Math.min(100, clampNonNegNum(row.commission_rate, 10));
  const mutable = {
    email: clampStr(row.email, 180),
    passwordHash: clampStr(row.password_hash, 260),
    businessNameAr: clampStr(row.business_name_ar || 'متجر اطلبها', 180, 'متجر اطلبها') || 'متجر اطلبها',
    businessNameEn: clampStr(row.business_name_en, 180),
    merchantType: clampStr(row.merchant_type || 'supermarket', 64, 'supermarket') || 'supermarket',
    zoneName: clampStr(row.zone_name, 120),
    phone: clampStr(row.phone, 40),
    commissionRate: comm,
    verificationStatus: clampStr(row.verification_status, 40),
    isOpenNow: toBool(row.is_open_now),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapCategory(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'cat');
  const mutable = {
    scope: clampStr(row.scope || 'stores', 64, 'stores') || 'stores',
    merchantId: clampStr(row.merchant_id, 128),
    nameAr: clampStr(row.name_ar || 'قسم', 180, 'قسم') || 'قسم',
    nameEn: clampStr(row.name_en, 180),
    sortOrder: clampInt(row.sort_order, 0),
    isActive: toBool(row.is_active),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapProduct(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'prd');
  const hasSalePrice = row.sale_price !== null && row.sale_price !== undefined && row.sale_price !== '';
  const mutable = {
    merchantId: clampStr(row.merchant_id || 'mer_0', 128, 'mer_0') || 'mer_0',
    categoryId: clampStr(row.category_id || 'cat_0', 128, 'cat_0') || 'cat_0',
    nameAr: clampStr(row.name_ar || 'منتج', 240, 'منتج') || 'منتج',
    nameEn: clampStr(row.name_en, 240),
    basePrice: clampNonNegNum(row.base_price, 0),
    salePrice: hasSalePrice ? clampNonNegNum(row.sale_price, 0) : 0,
    hasSalePrice,
    isOffer: toBool(row.is_offer),
    stockQuantity: clampNonNegInt(row.stock_quantity, 0),
    isAvailable: toBool(row.is_available),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapOrder(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'ord');
  const mutable = {
    orderNumber: clampStr(row.order_number || id, 64, id) || id,
    customerId: clampStr(row.customer_id, 128),
    customerName: clampStr(row.customer_name, 160),
    customerPhone: clampStr(row.customer_phone, 40),
    merchantId: clampStr(row.merchant_id, 128),
    captainId: clampStr(row.captain_id, 128),
    status: clampStr(row.status || 'pending', 48, 'pending') || 'pending',
    totalAmount: clampNonNegNum(row.total_amount, 0),
    sourceCreatedAt: clampStr(row.created_at, 64),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapOrderStore(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'ost');
  const mutable = {
    orderId: clampStr(row.order_id || 'ord_0', 128, 'ord_0') || 'ord_0',
    merchantId: clampStr(row.merchant_id || 'mer_0', 128, 'mer_0') || 'mer_0',
    prepStatus: clampStr(row.prep_status, 48),
    subtotal: clampNonNegNum(row.subtotal, 0),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapTrip(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'trp');
  const mutable = {
    tripNumber: clampStr(row.trip_number || id, 64, id) || id,
    customerName: clampStr(row.customer_name, 160),
    customerPhone: clampStr(row.customer_phone, 40),
    captainId: clampStr(row.captain_id, 128),
    status: clampStr(row.status || 'searching', 48, 'searching') || 'searching',
    estimatedFare: clampNonNegNum(row.estimated_fare, 0),
    sourceCreatedAt: clampStr(row.created_at, 64),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapDelivery(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'dlv');
  const mutable = {
    deliveryNumber: clampStr(row.delivery_number || id, 64, id) || id,
    senderName: clampStr(row.sender_name, 160),
    senderPhone: clampStr(row.sender_phone, 40),
    captainId: clampStr(row.captain_id, 128),
    status: clampStr(row.status || 'pending', 48, 'pending') || 'pending',
    deliveryFee: clampNonNegNum(row.delivery_fee, 0),
    sourceCreatedAt: clampStr(row.created_at, 64),
    extra: buildSafeExtra(row),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapWallet(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'wal');
  const rawType = String(row.owner_type || 'captain');
  const ownerType = ['captain', 'merchant', 'customer', 'platform'].includes(rawType) ? rawType : 'captain';
  const mutable = {
    userId: clampStr(row.user_id || id, 128, id) || id,
    ownerName: clampStr(row.owner_name || 'محفظة', 160, 'محفظة') || 'محفظة',
    ownerType,
    availableBalance: clampNonNegNum(row.available_balance, 0),
    pendingBalance: clampNonNegNum(row.pending_balance, 0),
    isFrozen: toBool(row.is_frozen),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapLedgerEntry(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'ldg');
  const mutable = {
    transactionGroupId: clampStr(row.transaction_group_id || id, 128, id) || id,
    accountCode: clampStr(row.account_code || 'ACC', 128, 'ACC') || 'ACC',
    accountType: clampStr(row.account_type || 'asset', 64, 'asset') || 'asset',
    debit: clampNonNegNum(row.debit, 0),
    credit: clampNonNegNum(row.credit, 0),
    referenceType: clampStr(row.reference_type || 'order', 64, 'order') || 'order',
    referenceId: clampStr(row.reference_id || id, 128, id) || id,
    descriptionAr: clampStr(row.description_ar, 400),
    idempotencyKey: clampStr(row.idempotency_key || id, 180, id) || id,
    sourceCreatedAt: clampStr(row.created_at, 64),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapSettlement(row: Record<string, unknown>) {
  const id = sanitizeId(row.id, 'stl');
  const mutable = {
    beneficiaryName: clampStr(row.beneficiary_name || 'مستفيد', 160, 'مستفيد') || 'مستفيد',
    beneficiaryType: clampStr(row.beneficiary_type || 'captain', 48, 'captain') || 'captain',
    grossEarnings: clampNonNegNum(row.gross_earnings, 0),
    deductedCommissions: clampNonNegNum(row.deducted_commissions, 0),
    netPayout: clampNonNegNum(row.net_payout, 0),
    payoutMethod: clampStr(row.payout_method, 64),
    status: clampStr(row.status || 'requested', 48, 'requested') || 'requested',
    sourceCreatedAt: clampStr(row.created_at, 64),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

function mapPlatformConfig(item: { config_group: string; record_id: string; data: Record<string, unknown> }) {
  const id = sanitizeId(item.record_id, 'cfg');
  const mutable = {
    configGroup: item.config_group,
    data: buildSafeExtra(item.data),
  };
  return { id, createData: { recordId: id, ...mutable }, updateData: mutable };
}

// Helper for admin API requests (uses existing HttpOnly cookie session + auto-refresh on 401)
async function adminApiFetch<T>(url: string, options?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  if (res.status === 401 && !retried) {
    const ref = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (ref?.ok) {
      return adminApiFetch<T>(url, options, true);
    }
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function subscribeFirebaseAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth, cb);
}

export async function signInFirebaseCloudVault(): Promise<User> {
  const cred = await signInWithPopup(firebaseAuth, googleProvider);
  return cred.user;
}

export async function signOutFirebaseCloudVault(): Promise<void> {
  await signOut(firebaseAuth);
}

export async function fetchServerSyncStatus(): Promise<ServerSyncStatus> {
  return adminApiFetch<ServerSyncStatus>('/api/admin/cloud-sync/status');
}

export async function fetchCloudVaultMeta(user: User): Promise<CloudVaultMeta | null> {
  const ref = doc(firestoreDb, 'vault_meta', 'main');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      version: Number(d.version || 0),
      customersCount: Number(d.customersCount || 0),
      ordersCount: Number(d.ordersCount || 0),
      tripsCount: Number(d.tripsCount || 0),
      deliveriesCount: Number(d.deliveriesCount || 0),
      captainsCount: Number(d.captainsCount || 0),
      merchantsCount: Number(d.merchantsCount || 0),
      categoriesCount: Number(d.categoriesCount || 0),
      productsCount: Number(d.productsCount || 0),
      walletsCount: Number(d.walletsCount || 0),
      ledgerEntriesCount: Number(d.ledgerEntriesCount || 0),
      settlementsCount: Number(d.settlementsCount || 0),
      lastSourceFingerprint: String(d.lastSourceFingerprint || ''),
      updatedAt: d.updatedAt && typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate() : null,
    };
  } catch (error) {
    // Ensure admin user has permission or throw structured FirestoreErrorInfo
    if (user.uid) {
      handleFirestoreError(error, OperationType.GET, 'vault_meta/main');
    }
    throw error;
  }
}

export async function pushAllToCloudVault(
  user: User,
  onProgress?: (p: CloudSyncProgress) => void
): Promise<{ syncedRecords: number; meta: CloudVaultMeta }> {
  onProgress?.({ phase: 'pushing', message: 'جاري قراءة البيانات من السيرفر...', processed: 0, total: 1 });

  const status = await fetchServerSyncStatus();
  const bundle = await adminApiFetch<Record<string, unknown>>('/api/admin/cloud-sync/export?collection=all_core');

  const collectionsToSync: Array<{
    name: string;
    label: string;
    docs: Array<{ id: string; createData: Record<string, unknown>; updateData: Record<string, unknown> }>;
  }> = [
    { name: 'customers', label: 'العملاء', docs: ((bundle.customers as Array<Record<string, unknown>>) || []).map(mapCustomer) },
    { name: 'captains', label: 'الطيارين', docs: ((bundle.captains as Array<Record<string, unknown>>) || []).map(mapCaptain) },
    { name: 'captain_documents', label: 'مستندات الطيارين', docs: ((bundle.captain_documents as Array<Record<string, unknown>>) || []).map(mapCaptainDoc) },
    { name: 'merchants', label: 'التجار', docs: ((bundle.merchants as Array<Record<string, unknown>>) || []).map(mapMerchant) },
    { name: 'categories', label: 'الأقسام', docs: ((bundle.categories as Array<Record<string, unknown>>) || []).map(mapCategory) },
    { name: 'orders', label: 'الطلبات', docs: ((bundle.orders as Array<Record<string, unknown>>) || []).map(mapOrder) },
    { name: 'order_stores', label: 'تفاصيل المتاجر بالطلبات', docs: ((bundle.order_stores as Array<Record<string, unknown>>) || []).map(mapOrderStore) },
    { name: 'trips', label: 'المشاوير', docs: ((bundle.trips as Array<Record<string, unknown>>) || []).map(mapTrip) },
    { name: 'deliveries', label: 'الطرود', docs: ((bundle.deliveries as Array<Record<string, unknown>>) || []).map(mapDelivery) },
    { name: 'wallets', label: 'المحافظ والأرصدة', docs: ((bundle.wallets as Array<Record<string, unknown>>) || []).map(mapWallet) },
    { name: 'ledger_entries', label: 'القيود المالية', docs: ((bundle.ledger_entries as Array<Record<string, unknown>>) || []).map(mapLedgerEntry) },
    { name: 'settlements', label: 'التسويات', docs: ((bundle.settlements as Array<Record<string, unknown>>) || []).map(mapSettlement) },
    {
      name: 'platform_configs',
      label: 'إعدادات المنصة والمناطق',
      docs: ((bundle.platform_configs as Array<{ config_group: string; record_id: string; data: Record<string, unknown> }>) || []).map(mapPlatformConfig),
    },
  ];

  const productsTotal = Number(bundle.products_total || 0);
  const coreTotal = collectionsToSync.reduce((acc, c) => acc + c.docs.length, 0);
  const grandTotal = Math.max(1, coreTotal + productsTotal);
  let synced = 0;

  for (const col of collectionsToSync) {
    if (col.docs.length === 0) continue;
    onProgress?.({
      phase: 'pushing',
      message: `جاري حفظ ${col.label} (${col.docs.length}) في السحابة...`,
      processed: synced,
      total: grandTotal,
    });
    const baseSynced = synced;
    await batchUpsertCollection(col.name, user, col.docs, undefined, (w) => {
      onProgress?.({
        phase: 'pushing',
        message: `جاري حفظ ${col.label} (${w}/${col.docs.length})...`,
        processed: baseSynced + w,
        total: grandTotal,
      });
    });
    synced += col.docs.length;
  }

  // Paginated products sync so even 10,000+ products sync smoothly without blocking UI
  if (productsTotal > 0) {
    const existingProductIds = await fetchExistingDocIds('products', user);
    let page = 1;
    let hasMore = true;
    let syncedProducts = 0;
    while (hasMore) {
      const pageRes = await adminApiFetch<{
        items: Array<Record<string, unknown>>;
        has_more: boolean;
        total: number;
      }>(`/api/admin/cloud-sync/export?collection=products&page=${page}&limit=350`);
      const mapped = (pageRes.items || []).map(mapProduct);
      if (mapped.length > 0) {
        const baseSynced = synced;
        await batchUpsertCollection('products', user, mapped, existingProductIds, (w) => {
          onProgress?.({
            phase: 'pushing',
            message: `جاري حفظ المنتجات (${syncedProducts + w}/${productsTotal})...`,
            processed: baseSynced + w,
            total: grandTotal,
          });
        });
        syncedProducts += mapped.length;
        synced += mapped.length;
      }
      hasMore = Boolean(pageRes.has_more) && mapped.length > 0;
      page += 1;
    }
  }

  // Update master vault_meta/main document
  const metaRef = doc(firestoreDb, 'vault_meta', 'main');
  let metaExists = false;
  let prevVersion = 0;
  try {
    const existingSnap = await getDoc(metaRef);
    if (existingSnap.exists()) {
      metaExists = true;
      prevVersion = Number(existingSnap.data().version || 0);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'vault_meta/main');
  }

  const nextVersion = prevVersion + 1;
  const mutableMeta = {
    version: nextVersion,
    customersCount: clampNonNegInt(status.counts.customers),
    ordersCount: clampNonNegInt(status.counts.orders),
    tripsCount: clampNonNegInt(status.counts.trips),
    deliveriesCount: clampNonNegInt(status.counts.deliveries),
    captainsCount: clampNonNegInt(status.counts.captains),
    merchantsCount: clampNonNegInt(status.counts.merchants),
    categoriesCount: clampNonNegInt(status.counts.categories),
    productsCount: clampNonNegInt(status.counts.products),
    walletsCount: clampNonNegInt(status.counts.wallets),
    ledgerEntriesCount: clampNonNegInt(status.counts.ledger_entries),
    settlementsCount: clampNonNegInt(status.counts.settlements),
    lastSourceFingerprint: clampStr(status.db_fingerprint, 128),
  };

  const metaBatch = writeBatch(firestoreDb);
  if (metaExists) {
    metaBatch.update(metaRef, { ...mutableMeta, updatedAt: serverTimestamp() });
  } else {
    metaBatch.set(metaRef, {
      ownerUid: user.uid,
      ...mutableMeta,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await metaBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'vault_meta/main');
  }

  await adminApiFetch('/api/admin/cloud-sync/mark-synced', {
    method: 'POST',
    body: JSON.stringify({ mutation_version: status.mutation_version }),
  });

  onProgress?.({
    phase: 'done',
    message: `تم حفظ ${synced.toLocaleString('ar-EG')} سجل بنجاح في قاعدة البيانات السحابية الدائمة`,
    processed: grandTotal,
    total: grandTotal,
  });

  return {
    syncedRecords: synced,
    meta: { ...mutableMeta, updatedAt: new Date() },
  };
}

function reconstructRowFromDoc(colName: string, data: Record<string, unknown>): Record<string, unknown> {
  if (data.extra && typeof data.extra === 'object' && Object.keys(data.extra as Record<string, unknown>).length > 0) {
    return { ...(data.extra as Record<string, unknown>) };
  }
  if (colName === 'wallets') {
    return {
      id: data.recordId,
      user_id: data.userId,
      owner_name: data.ownerName,
      owner_type: data.ownerType,
      available_balance: data.availableBalance,
      pending_balance: data.pendingBalance,
      is_frozen: data.isFrozen ? 1 : 0,
    };
  }
  if (colName === 'ledger_entries') {
    return {
      id: data.recordId,
      transaction_group_id: data.transactionGroupId,
      account_code: data.accountCode,
      account_type: data.accountType,
      debit: data.debit,
      credit: data.credit,
      reference_type: data.referenceType,
      reference_id: data.referenceId,
      description_ar: data.descriptionAr,
      idempotency_key: data.idempotencyKey,
      created_at: data.sourceCreatedAt,
    };
  }
  if (colName === 'settlements') {
    return {
      id: data.recordId,
      beneficiary_name: data.beneficiaryName,
      beneficiary_type: data.beneficiaryType,
      gross_earnings: data.grossEarnings,
      deducted_commissions: data.deductedCommissions,
      net_payout: data.netPayout,
      payout_method: data.payoutMethod,
      status: data.status,
      created_at: data.sourceCreatedAt,
    };
  }
  return data;
}

export async function restoreAllFromCloudVault(
  user: User,
  onProgress?: (p: CloudSyncProgress) => void
): Promise<{ totalRestored: number; counts: CloudCounts }> {
  const coreCollections = [
    { name: 'customers', label: 'العملاء' },
    { name: 'captains', label: 'الطيارين' },
    { name: 'captain_documents', label: 'مستندات الطيارين' },
    { name: 'merchants', label: 'التجار' },
    { name: 'categories', label: 'الأقسام' },
    { name: 'orders', label: 'الطلبات' },
    { name: 'order_stores', label: 'تفاصيل الطلبات' },
    { name: 'trips', label: 'المشاوير' },
    { name: 'deliveries', label: 'الطرود' },
    { name: 'wallets', label: 'المحافظ والأرصدة' },
    { name: 'ledger_entries', label: 'القيود المالية' },
    { name: 'settlements', label: 'التسويات' },
  ];

  const totalSteps = coreCollections.length + 2;
  let step = 0;
  let totalRestored = 0;

  // 1. Restore platform configs first
  onProgress?.({ phase: 'restoring', message: 'جاري استعادة إعدادات المنصة والمناطق...', processed: step, total: totalSteps });
  let cfgSnap;
  try {
    cfgSnap = await getDocs(buildCollectionQuery('platform_configs', user));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'platform_configs');
  }
  const platformConfigs: Array<{ config_group: string; data: Record<string, unknown> }> = [];
  cfgSnap.forEach((d) => {
    const raw = d.data();
    if (raw.configGroup && raw.data && typeof raw.data === 'object') {
      platformConfigs.push({
        config_group: String(raw.configGroup),
        data: raw.data as Record<string, unknown>,
      });
    }
  });
  if (platformConfigs.length > 0) {
    await adminApiFetch('/api/admin/cloud-sync/restore', {
      method: 'POST',
      body: JSON.stringify({ platform_configs: platformConfigs, finalize: false }),
    });
    totalRestored += platformConfigs.length;
  }
  step += 1;

  // 2. Restore core collections
  const restoredBundle: Record<string, Array<Record<string, unknown>>> = {};
  for (const col of coreCollections) {
    onProgress?.({ phase: 'restoring', message: `جاري استعادة ${col.label} من السحابة...`, processed: step, total: totalSteps });
    let snap;
    try {
      snap = await getDocs(buildCollectionQuery(col.name, user));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, col.name);
    }
    const rows: Array<Record<string, unknown>> = [];
    snap.forEach((d) => {
      rows.push(reconstructRowFromDoc(col.name, d.data() as Record<string, unknown>));
    });
    if (rows.length > 0) {
      restoredBundle[col.name] = rows;
      totalRestored += rows.length;
    }
    step += 1;
  }

  if (Object.keys(restoredBundle).length > 0) {
    await adminApiFetch('/api/admin/cloud-sync/restore', {
      method: 'POST',
      body: JSON.stringify({ collections: restoredBundle, finalize: false }),
    });
  }

  // 3. Restore products in safe chunks
  onProgress?.({ phase: 'restoring', message: 'جاري استعادة المنتجات وبناء فهرس البحث السريع...', processed: step, total: totalSteps });
  let prodSnap;
  try {
    prodSnap = await getDocs(buildCollectionQuery('products', user));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'products');
  }
  const productRows: Array<Record<string, unknown>> = [];
  prodSnap.forEach((d) => {
    productRows.push(reconstructRowFromDoc('products', d.data() as Record<string, unknown>));
  });

  const CHUNK_SIZE = 500;
  let finalResp: { counts: CloudCounts } | null = null;
  if (productRows.length === 0) {
    finalResp = await adminApiFetch<{ counts: CloudCounts }>('/api/admin/cloud-sync/restore', {
      method: 'POST',
      body: JSON.stringify({ collections: {}, finalize: true }),
    });
  } else {
    for (let i = 0; i < productRows.length; i += CHUNK_SIZE) {
      const slice = productRows.slice(i, i + CHUNK_SIZE);
      const isLast = i + CHUNK_SIZE >= productRows.length;
      finalResp = await adminApiFetch<{ counts: CloudCounts }>('/api/admin/cloud-sync/restore', {
        method: 'POST',
        body: JSON.stringify({ collections: { products: slice }, finalize: isLast }),
      });
      totalRestored += slice.length;
    }
  }

  const finalStatus = finalResp?.counts ? { counts: finalResp.counts } : await fetchServerSyncStatus();
  onProgress?.({
    phase: 'done',
    message: `تمت استعادة ${totalRestored.toLocaleString('ar-EG')} سجل من السحابة بنجاح`,
    processed: totalSteps,
    total: totalSteps,
  });

  return { totalRestored, counts: finalStatus.counts };
}
