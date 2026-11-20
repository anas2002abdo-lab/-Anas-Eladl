# Otlobha Persistent Cloud Vault — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Zero Public / Non-Admin Access (PII & Financial Isolation)**: All collections (`customers`, `captains`, `captain_documents`, `merchants`, `categories`, `products`, `orders`, `order_stores`, `trips`, `deliveries`, `wallets`, `ledger_entries`, `settlements`, `platform_configs`, `vault_meta`, `admins`) contain sensitive PII, credentials hashes, or financial balances. Only verified administrators (`request.auth.token.email_verified == true` and either the bootstrapped owner email `anas2002abdo@gmail.com` or an existing `/admins/{uid}` document) may read or write.
2. **Strict Path ID Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) enforces `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). `list` queries never call `get()` or `exists()` and strictly check `resource.data.ownerUid == request.auth.uid || isBootstrapAdmin()`.
3. **Immutable Ownership & Timestamps**: `ownerUid` must equal `request.auth.uid` on `create` and must remain unchanged (`incoming().ownerUid == existing().ownerUid`) on `update`. `createdAt` must equal `request.time` on `create` and remain immutable on `update`; `updatedAt` must equal `request.time` on both `create` and `update`.
4. **No Shadow Fields & Bounded Sizes**: Every `create` validates both `keys().hasAll(...)` and `keys().hasOnly(...)`; every `update` validates `isValid[Entity](incoming())` AND `incoming().diff(existing()).affectedKeys().hasOnly(...)`. Every `string` enforces `.size() <= MAX`; every `map` enforces `.size() <= MAX`; balances and prices enforce `>= 0`.
5. **Relational Integrity on Create**: `captain_documents` verifies referenced `captainId` exists in `/captains/{captainId}` or is an admin bulk restore; `order_stores` enforces valid `orderId` and `merchantId` format.
6. **Terminal State Protection**: Completed/cancelled orders, trips, deliveries, and paid settlements lock state transitions unless performed by an authorized admin sync override (`isAdmin()`).

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Customer PII Read**: `GET /customers/cust_001` with `auth = null`.
2. **Non-Admin Signed-In User Listing Customers**: `LIST /customers` with `auth = { uid: 'attacker_1', token: { email: 'hacker@gmail.com', email_verified: true } }`.
3. **Email Spoofing Attack (Unverified Admin Email)**: `GET /wallets/wal_cap_1` with `auth = { uid: 'spoof_1', token: { email: 'anas2002abdo@gmail.com', email_verified: false } }`.
4. **Privilege Escalation (Self-Registering Admin)**: `CREATE /admins/attacker_1` with `role: 'super_admin'` as a non-admin user.
5. **Shadow Field Injection on Customer Create**: `CREATE /customers/cust_999` as admin with an extra ghost key `isSuperAdmin: true`.
6. **ID Poisoning Attack**: `CREATE /products/bad..id$with!spaces` violating `^[a-zA-Z0-9_\-]+$`.
7. **Denial-of-Wallet Oversized String**: `CREATE /merchants/mer_big` with `businessNameAr` of length 20,000 characters.
8. **Negative Wallet Balance Poisoning**: `UPDATE /wallets/wal_cap_1` setting `availableBalance: -5000`.
9. **Identity Spoofing on Create**: `CREATE /orders/ord_100` setting `ownerUid: 'someone_else_uid'` instead of `request.auth.uid`.
10. **Immortal Field Tampering**: `UPDATE /customers/cust_001` attempting to mutate `createdAt` or `ownerUid`.
11. **Client Timestamp Forgery**: `CREATE /categories/cat_001` supplying a hardcoded past `createdAt` timestamp instead of `request.time`.
12. **Value Poisoning on Update**: `UPDATE /products/prd_001` passing `basePrice: "not_a_number"` or `stockQuantity: -10`.
