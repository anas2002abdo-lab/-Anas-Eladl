/**
 * Phase 0 Payload-First Security TDD Test Suite for Otlobha Persistent Cloud Vault.
 * Verifies that all "Dirty Dozen" attack payloads targeting Identity, Integrity,
 * PII isolation, and State boundaries are rejected with PERMISSION_DENIED.
 */

export interface SecurityAttackCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: {
    uid: string;
    token: {
      email?: string;
      email_verified?: boolean;
    };
  } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: SecurityAttackCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Customer PII Read',
    operation: 'get',
    path: '/customers/cust_001',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Non-Admin Signed-In User Listing Customers',
    operation: 'list',
    path: '/customers',
    auth: { uid: 'attacker_1', token: { email: 'hacker@gmail.com', email_verified: true } },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Email Spoofing Attack (Unverified Admin Email)',
    operation: 'get',
    path: '/wallets/wal_cap_1',
    auth: { uid: 'spoof_1', token: { email: 'anas2002abdo@gmail.com', email_verified: false } },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Privilege Escalation (Self-Registering Admin)',
    operation: 'create',
    path: '/admins/attacker_1',
    auth: { uid: 'attacker_1', token: { email: 'hacker@gmail.com', email_verified: true } },
    payload: {
      uid: 'attacker_1',
      email: 'hacker@gmail.com',
      fullName: 'Hacker',
      role: 'super_admin',
      ownerUid: 'attacker_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection on Customer Create',
    operation: 'create',
    path: '/customers/cust_999',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      recordId: 'cust_999',
      ownerUid: 'admin_1',
      fullName: 'Shadow Customer',
      email: 'c@example.com',
      phone: '01000000000',
      passwordHash: '',
      status: 'active',
      defaultZoneId: 'zn_city_center',
      addressLandmark: 'Manzala',
      isEmailVerified: true,
      sourceCreatedAt: '2026-01-01T00:00:00Z',
      extra: {},
      isSuperAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning Attack',
    operation: 'create',
    path: '/products/bad..id$with!spaces',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      recordId: 'bad..id$with!spaces',
      ownerUid: 'admin_1',
      merchantId: 'mer_1',
      categoryId: 'cat_1',
      nameAr: 'منتج',
      nameEn: 'Item',
      basePrice: 10,
      salePrice: 0,
      hasSalePrice: false,
      isOffer: false,
      stockQuantity: 5,
      isAvailable: true,
      extra: {},
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Denial-of-Wallet Oversized String',
    operation: 'create',
    path: '/merchants/mer_big',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      recordId: 'mer_big',
      ownerUid: 'admin_1',
      email: 'm@example.com',
      passwordHash: '',
      businessNameAr: 'أ'.repeat(20000),
      businessNameEn: 'Big Store',
      merchantType: 'supermarket',
      zoneName: 'المنزلة',
      phone: '01000000001',
      commissionRate: 10,
      verificationStatus: 'approved',
      isOpenNow: true,
      extra: {},
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Negative Wallet Balance Poisoning',
    operation: 'update',
    path: '/wallets/wal_cap_1',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      availableBalance: -5000,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Identity Spoofing on Order Create',
    operation: 'create',
    path: '/orders/ord_100',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      recordId: 'ord_100',
      ownerUid: 'someone_else_uid',
      orderNumber: 'ORD-100',
      customerId: 'cust_1',
      customerName: 'Test',
      customerPhone: '01000000000',
      merchantId: 'mer_1',
      captainId: '',
      status: 'pending',
      totalAmount: 100,
      sourceCreatedAt: '2026-01-01T00:00:00Z',
      extra: {},
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal Field Tampering (Mutating createdAt/ownerUid)',
    operation: 'update',
    path: '/customers/cust_001',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      ownerUid: 'hijacked_uid',
      createdAt: '2000-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery on Create',
    operation: 'create',
    path: '/categories/cat_001',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      recordId: 'cat_001',
      ownerUid: 'admin_1',
      scope: 'stores',
      merchantId: '',
      nameAr: 'مشويات',
      nameEn: 'Grills',
      sortOrder: 1,
      isActive: true,
      extra: {},
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning on Product Update',
    operation: 'update',
    path: '/products/prd_001',
    auth: { uid: 'admin_1', token: { email: 'anas2002abdo@gmail.com', email_verified: true } },
    payload: {
      basePrice: 'not_a_number',
      stockQuantity: -10,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
