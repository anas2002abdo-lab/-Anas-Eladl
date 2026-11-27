import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Car,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  Languages,
  Layers,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Smartphone,
  Star,
  Store,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from './lib/api.ts';
import { AdminLoginPortal } from './components/AdminLoginPortal.tsx';
import { MerchantAuthPortal } from './components/MerchantAuthPortal.tsx';
import { MerchantMasterLinkPanel } from './components/MerchantMasterLinkPanel.tsx';
import { MerchantStoreOrdersView } from './components/MerchantStoreOrdersView.tsx';
import { OverviewSection } from './components/OverviewSection.tsx';
import { ServicesZonesSection } from './components/ServicesZonesSection.tsx';
import { PricingDispatchSection } from './components/PricingDispatchSection.tsx';
import { CaptainsKycSection } from './components/CaptainsKycSection.tsx';
import { MerchantsOrdersSection } from './components/MerchantsOrdersSection.tsx';
import { CustomersSection } from './components/CustomersSection.tsx';
import { SupportCenterSection } from './components/SupportCenterSection.tsx';
import { CatalogSection } from './components/CatalogSection.tsx';
import { MasterCatalogAdminSection } from './components/MasterCatalogAdminSection.tsx';
import { InvoiceDesignSection } from './components/InvoiceDesignSection.tsx';
import { MarketFinanceSection } from './components/MarketFinanceSection.tsx';
import { GovernanceAuditSection } from './components/GovernanceAuditSection.tsx';
import { NotificationsSection } from './components/NotificationsSection.tsx';
import { CustomerMobilePreview } from './components/CustomerMobilePreview.tsx';
import { CaptainMobilePreview } from './components/CaptainMobilePreview.tsx';
import { RidesManagementSection } from './components/RidesManagementSection.tsx';
import { CloudDatabaseSection } from './components/CloudDatabaseSection.tsx';
import { PublicStoreWebPage } from './components/PublicStoreWebPage.tsx';
import { StoreReviewsAdminSection } from './components/StoreReviewsAdminSection.tsx';
import { PWAInstallButton, OfflineIndicator } from './components/PWAInstallButton.tsx';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  fetchCloudVaultMeta,
  fetchServerSyncStatus,
  pushAllToCloudVault,
  restoreAllFromCloudVault,
  signInFirebaseCloudVault,
  signOutFirebaseCloudVault,
  subscribeFirebaseAuth,
  type CloudSyncProgress,
  type CloudVaultMeta,
  type ServerSyncStatus,
} from './lib/cloudVaultSync.ts';
import type {
  AdminUserRecord,
  CaptainRecord,
  CategoryRecord,
  Language,
  MerchantRecord,
  OrderRecord,
  ServiceConfig,
  ServiceZone,
} from './shared/types.ts';

type PortalMode = 'admin' | 'merchant' | 'customer' | 'captain';

const MERCHANT_SESSION_KEY = 'otlobha_merchant_email_session';

export default function App() {
  const initialStoreMatch =
    typeof window !== 'undefined' ? window.location.pathname.match(/^\/store\/([^/?#]+)/) : null;
  const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const [publicStoreSlug, setPublicStoreSlug] = useState<string | null>(() => {
    if (initialStoreMatch?.[1]) return decodeURIComponent(initialStoreMatch[1]);
    const qStore = initialParams?.get('store');
    return qStore ? qStore.trim() : null;
  });
  const urlPortal = initialParams?.get('portal') as PortalMode | null;
  const initialPortal: PortalMode =
    urlPortal && ['admin', 'merchant', 'customer', 'captain'].includes(urlPortal) ? urlPortal : 'admin';
  const [standalone, setStandalone] = useState<boolean>(initialParams?.get('standalone') === '1');
  const [lang, setLang] = useState<Language>('ar');
  const [portalMode, setPortalMode] = useState<PortalMode>(initialPortal);
  const portalModeRef = useRef<PortalMode>(initialPortal);
  const [activeTab, setActiveTab] = useState<string>(initialPortal === 'merchant' ? 'orders' : 'overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [merchantSession, setMerchantSession] = useState<MerchantRecord | null>(() => {
    try {
      const raw = localStorage.getItem(MERCHANT_SESSION_KEY);
      return raw ? (JSON.parse(raw) as MerchantRecord) : null;
    } catch {
      return null;
    }
  });

  const [adminUser, setAdminUser] = useState<AdminUserRecord | null>(null);
  const adminUserRef = useRef<AdminUserRecord | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const authCheckingRef = useRef<boolean>(true);
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [captains, setCaptains] = useState<CaptainRecord[]>([]);
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);

  // Permanent Firebase Cloud Vault state
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [serverSyncStatus, setServerSyncStatus] = useState<ServerSyncStatus | null>(null);
  const [cloudVaultMeta, setCloudVaultMeta] = useState<CloudVaultMeta | null>(null);
  const [autoCloudSync, setAutoCloudSync] = useState<boolean>(false);
  const [cloudProgress, setCloudProgress] = useState<CloudSyncProgress>({
    phase: 'idle',
    message: '',
    processed: 0,
    total: 0,
  });
  const cloudSyncBusyRef = useRef(false);

  const isAr = lang === 'ar';

  useEffect(() => {
    adminUserRef.current = adminUser;
  }, [adminUser]);

  useEffect(() => {
    portalModeRef.current = portalMode;
  }, [portalMode]);

  useEffect(() => {
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang, isAr]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isMerchantApp = portalMode === 'merchant';
    document.title = isMerchantApp ? 'اطلبها للتجار – Otlobha Merchant' : 'اطلبها – Otlobha';
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifestLink) {
      const targetHref = isMerchantApp ? '/manifest-merchant.webmanifest' : '/manifest.webmanifest';
      if (manifestLink.getAttribute('href') !== targetHref) {
        manifestLink.setAttribute('href', targetHref);
      }
    }
  }, [portalMode]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const refreshCore = async (forceAdmin?: boolean, explicitMerchant?: MerchantRecord | null) => {
    const isAdmin = forceAdmin !== undefined ? forceAdmin : Boolean(adminUserRef.current);
    const activeMerchant = explicitMerchant !== undefined ? explicitMerchant : merchantSession;
    const merchantOrderOpts =
      portalMode === 'merchant' && activeMerchant?.id
        ? { merchantId: activeMerchant.id, scope: 'merchant' as const }
        : undefined;
    try {
      if (isAdmin && portalMode !== 'merchant') {
        const [ovRes, srvRes, znRes, capRes, merRes, ordRes, catsRes] = await Promise.allSettled([
          api.getOverview(),
          api.getServices(),
          api.getZones(),
          api.getCaptains(),
          api.getMerchants(false),
          api.getOrders(),
          api.getCategories(),
        ]);
        if (ovRes.status === 'fulfilled') setOverview(ovRes.value);
        if (srvRes.status === 'fulfilled') setServices(srvRes.value);
        if (znRes.status === 'fulfilled') setZones(znRes.value);
        if (capRes.status === 'fulfilled') setCaptains(capRes.value);
        if (merRes.status === 'fulfilled') {
          const mer = merRes.value;
          setMerchants(mer);
          setMerchantSession((prev) => {
            if (!prev) return null;
            const fresh = mer.find((m: MerchantRecord) => m.id === prev.id);
            if (!fresh) {
              try {
                localStorage.removeItem(MERCHANT_SESSION_KEY);
              } catch {
                // ignore
              }
              return null;
            }
            try {
              localStorage.setItem(MERCHANT_SESSION_KEY, JSON.stringify(fresh));
            } catch {
              // ignore
            }
            return fresh;
          });
        }
        if (ordRes.status === 'fulfilled') setOrders(ordRes.value);
        if (catsRes.status === 'fulfilled') setCategories(catsRes.value);
        return;
      }

      const [srvRes, znRes, merRes, ordRes, catsRes] = await Promise.allSettled([
        api.getServices(),
        api.getZones(),
        api.getMerchants(true),
        api.getOrders(merchantOrderOpts),
        api.getCategories(),
      ]);
      setOverview(null);
      setCaptains([]);
      if (srvRes.status === 'fulfilled') setServices(srvRes.value);
      if (znRes.status === 'fulfilled') setZones(znRes.value);
      if (merRes.status === 'fulfilled') setMerchants(merRes.value);
      if (ordRes.status === 'fulfilled') setOrders(ordRes.value);
      if (catsRes.status === 'fulfilled') setCategories(catsRes.value);
    } catch {
      // Transient network errors are swallowed cleanly to avoid unhandled rejections
    }
  };

  useEffect(() => {
    if (authChecking) return;
    if (portalMode === 'admin' && !adminUserRef.current) return;
    refreshCore().catch(() => {});
  }, [portalMode, merchantSession?.id, authChecking]);

  // Subscribe to Firebase Auth state for the permanent Cloud Vault
  useEffect(() => {
    const unsub = subscribeFirebaseAuth((u) => {
      setFirebaseUser(u);
      setFirebaseAuthReady(true);
    });
    return () => unsub();
  }, []);

  const refreshCloudSyncStatus = async (explicitUser?: FirebaseUser | null) => {
    if (!adminUserRef.current) return null;
    try {
      const srv = await fetchServerSyncStatus();
      setServerSyncStatus(srv);
      const activeFbUser = explicitUser !== undefined ? explicitUser : firebaseUser;
      if (activeFbUser) {
        const meta = await fetchCloudVaultMeta(activeFbUser);
        setCloudVaultMeta(meta);
        return { srv, meta };
      }
      setCloudVaultMeta(null);
      return { srv, meta: null };
    } catch (err) {
      console.warn('[CloudVault] Status check error:', err);
      return null;
    }
  };

  const handleCloudPushNow = async (silent = false) => {
    if (!firebaseUser || !adminUserRef.current || cloudSyncBusyRef.current) return;
    cloudSyncBusyRef.current = true;
    try {
      const result = await pushAllToCloudVault(firebaseUser, setCloudProgress);
      setCloudVaultMeta(result.meta);
      const srv = await fetchServerSyncStatus().catch(() => null);
      if (srv) setServerSyncStatus(srv);
      if (!silent) {
        notify(`تم حفظ ${result.syncedRecords.toLocaleString('ar-EG')} سجل في قاعدة البيانات السحابية الدائمة`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر الحفظ في قاعدة البيانات السحابية';
      setCloudProgress({ phase: 'error', message: msg, processed: 0, total: 0 });
      if (!silent) notify(msg);
    } finally {
      cloudSyncBusyRef.current = false;
    }
  };

  const handleCloudRestoreNow = async (silent = false) => {
    if (!firebaseUser || !adminUserRef.current || cloudSyncBusyRef.current) return;
    cloudSyncBusyRef.current = true;
    try {
      const res = await restoreAllFromCloudVault(firebaseUser, setCloudProgress);
      await refreshCore(true);
      await refreshCloudSyncStatus(firebaseUser);
      if (!silent) {
        notify(`تمت استعادة ${res.totalRestored.toLocaleString('ar-EG')} سجل من السحابة بنجاح`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذرت الاستعادة من قاعدة البيانات السحابية';
      setCloudProgress({ phase: 'error', message: msg, processed: 0, total: 0 });
      if (!silent) notify(msg);
    } finally {
      cloudSyncBusyRef.current = false;
    }
  };

  const handleToggleAutoCloudSync = (enabled: boolean) => {
    setAutoCloudSync(enabled);
    try {
      localStorage.setItem('otlobha_auto_cloud_sync', enabled ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const handleSignInCloudGoogle = async () => {
    try {
      const u = await signInFirebaseCloudVault();
      setFirebaseUser(u);
      notify(`تم ربط الخزنة السحابية الدائمة بحساب ${u.email || ''}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'تعذر تسجيل الدخول عبر Google');
    }
  };

  const handleSignOutCloudGoogle = async () => {
    await signOutFirebaseCloudVault();
    setFirebaseUser(null);
    setCloudVaultMeta(null);
    setCloudProgress({ phase: 'idle', message: '', processed: 0, total: 0 });
    notify('تم فصل ربط الخزنة السحابية');
  };

  // Manual Cloud Backup status fetch (only when admin opens the Cloud Backup tab; no automatic background push/restore)
  useEffect(() => {
    if (!adminUser || !firebaseAuthReady || activeTab !== 'cloud_db') return;
    void refreshCloudSyncStatus(firebaseUser);
  }, [adminUser, firebaseUser, firebaseAuthReady, activeTab]);

  useEffect(() => {
    if (portalMode === 'admin' && adminUserRef.current && (activeTab === 'captains' || activeTab === 'overview' || activeTab === 'orders')) {
      refreshCore(true).catch(() => {});
    }
  }, [activeTab, portalMode]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api.getMe().catch(() => null);
        if (!active) return;
        if (me?.authenticated && me.user?.actorType === 'admin') {
          adminUserRef.current = me.user as AdminUserRecord;
          setAdminUser(me.user as AdminUserRecord);
          await refreshCore(true);
        } else if (me?.authenticated && me.user?.actorType === 'merchant') {
          setAdminUser(null);
          const merch = me.user as MerchantRecord;
          setMerchantSession(merch);
          try {
            localStorage.setItem(MERCHANT_SESSION_KEY, JSON.stringify(merch));
          } catch {
            // ignore
          }
          await refreshCore(false, merch);
        } else {
          setAdminUser(null);
          setMerchantSession(null);
          try {
            localStorage.removeItem(MERCHANT_SESSION_KEY);
          } catch {
            // ignore
          }
          await refreshCore(false, null);
        }
      } catch {
        setAdminUser(null);
        setMerchantSession(null);
        try {
          localStorage.removeItem(MERCHANT_SESSION_KEY);
        } catch {
          // ignore
        }
      } finally {
        if (active) {
          authCheckingRef.current = false;
          setAuthChecking(false);
        }
      }
    })();

    const onFocus = () => {
      if (authCheckingRef.current) return;
      if (portalModeRef.current === 'admin' && !adminUserRef.current) return;
      refreshCore().catch(() => {});
    };
    window.addEventListener('focus', onFocus);

    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleAdminLogout = async () => {
    await api.logoutSession().catch(() => {});
    adminUserRef.current = null;
    setAdminUser(null);
    setOverview(null);
    setCaptains([]);
    await refreshCore(false, null).catch(() => {});
    notify(isAr ? 'تم تسجيل الخروج من لوحة الإدارة' : 'Signed out from Admin Portal');
  };

  const handleQuickToggleService = async (key: string, nextEnabled: boolean) => {
    await api.updateService(key, { is_enabled: nextEnabled, reason: 'تبديل سريع من لوحة المؤشرات' });
    await refreshCore();
    notify(isAr ? 'تم تحديث حالة الخدمة في قاعدة البيانات' : 'Service status updated');
  };

  const switchPortal = (mode: PortalMode) => {
    setPortalMode(mode);
    if (mode === 'admin') setActiveTab('overview');
    else if (mode === 'merchant') setActiveTab('orders');
    else setActiveTab(mode);
  };

  const navGroups =
    portalMode === 'admin' && adminUser
      ? [
          {
            groupLabel: isAr ? 'الرئيسية والتقارير' : 'Overview',
            items: [
              { id: 'overview', label: isAr ? 'لوحة المؤشرات' : 'Overview', icon: BarChart3 },
            ],
          },
          {
            groupLabel: isAr ? 'الكتالوج والمتجر' : 'Catalog & Storefront',
            items: [
              { id: 'master_catalog', label: isAr ? 'الكتالوج المركزي والمقارنة' : 'Master Catalog', icon: Layers },
              { id: 'catalog', label: isAr ? 'منتجات المتاجر والأقسام' : 'Store Products & Categories', icon: Package },
              { id: 'invoice_design', label: isAr ? 'تصميم فاتورة العميل' : 'Invoice Design', icon: Receipt },
            ],
          },
          {
            groupLabel: isAr ? 'التشغيل والعملاء' : 'Operations & Users',
            items: [
              { id: 'orders', label: isAr ? 'التجار والصيدليات والطلبات' : 'Merchants & Orders', icon: Store },
              { id: 'store_reviews', label: isAr ? 'تقييمات المتاجر والرقابة' : 'Store Reviews & Moderation', icon: Star },
              { id: 'rides_management', label: isAr ? 'إدارة المشاوير' : 'Rides Management', icon: Car },
              { id: 'customers', label: isAr ? 'العملاء والمستخدمون' : 'Customers & Users', icon: Users },
              { id: 'captains', label: isAr ? 'الكباتن وتوثيق المركبات' : 'Captains & KYC', icon: Truck },
              { id: 'market', label: isAr ? 'إدارة السوق (C2C)' : 'Otlobha Market', icon: ShoppingBag },
              { id: 'support', label: isAr ? 'التواصل مع العملاء والدعم' : 'Customer Support', icon: MessageSquare },
              { id: 'notifications', label: isAr ? 'الإشعارات والحملات' : 'Push Notifications', icon: Bell },
            ],
          },
          {
            groupLabel: isAr ? 'المالية والنظام' : 'Finance & System',
            items: [
              { id: 'pricing', label: isAr ? 'التسعير والتوزيع والمالية' : 'Pricing & Dispatch', icon: Sliders },
              { id: 'services', label: isAr ? 'الخدمات ومناطق المنزلة' : 'Services & Zones', icon: MapPin },
              { id: 'finance', label: isAr ? 'الدفتر المالي والمحافظ' : 'Ledger & Wallets', icon: Wallet },
              { id: 'cloud_db', label: isAr ? 'قاعدة البيانات السحابية' : 'Cloud Database', icon: Cloud },
              { id: 'governance', label: isAr ? 'الصلاحيات والشكاوى والتدقيق' : 'RBAC & Audit Logs', icon: ShieldCheck },
            ],
          },
        ]
      : portalMode === 'merchant' && merchantSession
      ? [
          {
            groupLabel: isAr ? 'بوابة التاجر' : 'Merchant Portal',
            items: [
              { id: 'orders', label: isAr ? 'طلبات متجري الواردة' : 'Store Orders', icon: Store },
              {
                id: 'merchant_excel',
                label: isAr ? 'رفع Excel للإدارة للاعتماد' : 'Upload Excel for Approval',
                icon: FileSpreadsheet,
              },
              { id: 'catalog', label: isAr ? 'المنتجات والأقسام' : 'Products & Categories', icon: Package },
            ],
          },
        ]
      : [];

  const navItems = navGroups.flatMap((g) => g.items);

  const activeNav = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  const portalLabel =
    portalMode === 'admin'
      ? 'Otlobha Super Admin'
      : portalMode === 'merchant'
      ? isAr
        ? 'لوحة التاجر والصيدلي'
        : 'Merchant Portal'
      : portalMode === 'customer'
      ? isAr
        ? 'تطبيق العميل'
        : 'Customer App'
      : isAr
      ? 'تطبيق الطيارين'
      : 'Captain App';

  if (publicStoreSlug) {
    return (
      <PublicStoreWebPage
        merchantId={publicStoreSlug}
        onOpenPlatform={() => {
          setPublicStoreSlug(null);
          setPortalMode('customer');
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/?portal=customer');
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <OfflineIndicator lang={lang} />
      {!standalone && (
        <>
          {/* Desktop Sidebar */}
          <aside className="hidden md:flex w-64 shrink-0 bg-slate-900 text-slate-100 flex-col border-e border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2.5 justify-center">
              <img
                src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                alt="Otlobha Logo"
                className="w-10 h-10 rounded-xl bg-white object-contain p-0.5 shadow-sm"
              />
              <div className="text-start">
                <div className="text-sm font-black text-white leading-tight">اطلبها Otlobha</div>
                <div className="text-[10px] font-bold text-[#F5A623]">{portalLabel}</div>
              </div>
            </div>

            <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
              {navGroups.map((grp) => (
                <div key={grp.groupLabel} className="space-y-1">
                  <div className="px-3 text-[10px] font-black tracking-wider uppercase text-slate-400">
                    {grp.groupLabel}
                  </div>
                  {grp.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-start cursor-pointer ${
                          active
                            ? 'bg-[#A92224] text-white shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#F5A623]' : ''}`} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {((portalMode === 'admin' && !adminUser) || (portalMode === 'merchant' && !merchantSession)) && (
                <div className="p-3 bg-slate-800/70 rounded-lg text-xs text-slate-300 space-y-2">
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-orange-400 shrink-0" />
                    <span>{isAr ? 'تسجيل الدخول مطلوب' : 'Login Required'}</span>
                  </p>
                  <p className="leading-relaxed text-slate-400">
                    {isAr
                      ? 'المنظومة محمية بالكامل. يجب تسجيل الدخول أولاً لتفعيل لوحة التحكم والخدمات.'
                      : 'The system requires authentication before accessing control features.'}
                  </p>
                </div>
              )}
            </nav>

            <div className="p-3 border-t border-slate-800 space-y-1.5">
              <p className="px-2 text-xs text-slate-400 font-semibold">{isAr ? 'تبديل المنصة:' : 'Switch Portal:'}</p>
              {[
                { id: 'admin' as PortalMode, label: isAr ? 'لوحة Super Admin' : 'Super Admin', icon: ShieldCheck },
                { id: 'merchant' as PortalMode, label: isAr ? 'لوحة التاجر والصيدلي' : 'Merchant Portal', icon: Store },
                { id: 'customer' as PortalMode, label: isAr ? 'تطبيق العميل الرئيسي' : 'Customer App', icon: Smartphone },
                { id: 'captain' as PortalMode, label: isAr ? 'تطبيق الطيارين (الكباتن)' : 'Captain App', icon: Truck },
              ].map((p) => {
                const Icon = p.icon;
                const selected = portalMode === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => switchPortal(p.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      selected ? 'bg-orange-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Mobile Drawer Overlay */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex md:hidden">
              <aside className="w-72 bg-slate-900 text-slate-100 flex flex-col h-full shadow-2xl relative">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="absolute top-4 end-4 p-2 text-slate-400 hover:text-white"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-center">
                  <img
                    src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                    alt="Otlobha Logo"
                    className="w-9 h-9 rounded-lg bg-white object-contain p-0.5 shadow-sm"
                  />
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-start ${
                          active ? 'bg-orange-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </nav>

                <div className="p-3 border-t border-slate-800 space-y-1.5">
                  <p className="px-2 text-xs text-slate-400 font-semibold">{isAr ? 'تبديل المنصة:' : 'Switch Portal:'}</p>
                  {[
                    { id: 'admin' as PortalMode, label: isAr ? 'لوحة Super Admin' : 'Super Admin', icon: ShieldCheck },
                    { id: 'merchant' as PortalMode, label: isAr ? 'لوحة التاجر والصيدلي' : 'Merchant Portal', icon: Store },
                    { id: 'customer' as PortalMode, label: isAr ? 'تطبيق العميل الرئيسي' : 'Customer App', icon: Smartphone },
                    { id: 'captain' as PortalMode, label: isAr ? 'تطبيق الطيارين (الكباتن)' : 'Captain App', icon: Truck },
                  ].map((p) => {
                    const Icon = p.icon;
                    const selected = portalMode === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          switchPortal(p.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          selected ? 'bg-orange-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>
              <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
            </div>
          )}
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm font-semibold text-slate-800">
            {!standalone && (
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden p-2 -ms-2 rounded-lg hover:bg-slate-100 text-slate-700"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            {standalone && (
              <img
                src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
                className="w-9 h-9 rounded-lg border border-slate-200 bg-white object-contain p-0.5 shrink-0"
              />
            )}
            <span className="font-semibold text-slate-800 truncate">
              {activeNav?.label || ''}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <PWAInstallButton lang={lang} onNotify={notify} />

            {portalMode === 'admin' && adminUser && (
              <button
                type="button"
                onClick={() => setActiveTab('cloud_db')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                  activeTab === 'cloud_db'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : firebaseUser
                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                }`}
              >
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span>{isAr ? 'قاعدة البيانات السحابية' : 'Cloud DB'}</span>
              </button>
            )}

            {portalMode === 'admin' && adminUser && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span className="font-semibold text-slate-800">{adminUser.full_name}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{adminUser.role_name_ar || adminUser.role}</span>
              </div>
            )}

            <div className="relative">
              <button
                onClick={() => setHeaderMenuOpen((prev) => !prev)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center justify-center shadow-sm"
                aria-label="Settings and actions"
              >
                <Settings className="w-5 h-5" />
              </button>

              {headerMenuOpen && (
                <div className="absolute end-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 text-xs">
                  {standalone && (
                    <button
                      onClick={() => {
                        setStandalone(false);
                        switchPortal('admin');
                        setHeaderMenuOpen(false);
                      }}
                      className="w-full text-start px-4 py-2.5 hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-2.5"
                    >
                      <ShieldCheck className="w-4 h-4 text-orange-600 shrink-0" />
                      <span>{isAr ? 'العودة للوحة الإدارة' : 'Back to Admin'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setLang(isAr ? 'en' : 'ar');
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full text-start px-4 py-2.5 hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-2.5"
                  >
                    <Languages className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>{isAr ? 'English (الإنجليزية)' : 'العربية (Arabic)'}</span>
                  </button>
                  <button
                    onClick={() => {
                      void refreshCore();
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full text-start px-4 py-2.5 hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-2.5"
                  >
                    <RefreshCw className="w-4 h-4 text-teal-600 shrink-0" />
                    <span>{isAr ? 'تحديث البيانات' : 'Refresh Data'}</span>
                  </button>
                  {portalMode === 'admin' && adminUser && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        onClick={() => {
                          handleAdminLogout();
                          setHeaderMenuOpen(false);
                        }}
                        className="w-full text-start px-4 py-2.5 hover:bg-rose-50 text-rose-700 font-semibold flex items-center gap-2.5"
                      >
                        <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{isAr ? 'خروج الإدارة' : 'Admin Sign Out'}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {toast && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-teal-50 border border-teal-200 text-teal-900 rounded-lg text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
            <span>{toast}</span>
          </div>
        )}

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {portalMode === 'admin' && authChecking ? (
            <div className="py-16 text-center text-sm text-slate-500">
              {isAr ? 'جاري التحقق من جلسة الإدارة...' : 'Verifying administrator session...'}
            </div>
          ) : portalMode === 'admin' && !adminUser ? (
            <AdminLoginPortal
              lang={lang}
              onSuccess={async (user) => {
                adminUserRef.current = user;
                setAdminUser(user);
                await refreshCore(true);
              }}
              onNotify={notify}
            />
          ) : portalMode === 'customer' ? (
            <CustomerMobilePreview lang={lang} onNotify={notify} onRefreshCore={() => refreshCore()} />
          ) : portalMode === 'captain' ? (
            <CaptainMobilePreview
              lang={lang}
              captains={captains}
              orders={orders}
              zones={zones}
              onRefreshCore={() => refreshCore()}
              onNotify={notify}
            />
          ) : portalMode === 'merchant' && !merchantSession ? (
            <MerchantAuthPortal
              lang={lang}
              merchants={merchants}
              zones={zones}
              onVerified={(user) => {
                setMerchantSession(user);
                try {
                  localStorage.setItem(MERCHANT_SESSION_KEY, JSON.stringify(user));
                } catch {
                  // ignore
                }
                refreshCore(false, user).catch(() => {});
              }}
              onRefreshCore={() => refreshCore(false)}
              onNotify={notify}
            />
          ) : (
            <>
              {portalMode === 'merchant' && merchantSession && (
                <div className="space-y-3 mb-4">
                  <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {merchantSession.image_url ? (
                        <img
                          src={merchantSession.image_url}
                          alt={merchantSession.business_name_ar}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-full object-cover border-2 border-teal-400 bg-white shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-800 border-2 border-teal-400/70 flex items-center justify-center shrink-0">
                          <Store className="w-5 h-5 text-teal-400" />
                        </div>
                      )}
                      <div className="text-xs">
                        <p className="font-bold text-sm flex items-center gap-1.5">
                          <span>{merchantSession.business_name_ar}</span>
                          <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                        </p>
                        <p className="text-slate-300 tabular-nums">
                          {merchantSession.email && (
                            <>
                              <span dir="ltr" className="font-mono-num">{merchantSession.email}</span> ·{' '}
                            </>
                          )}
                          <span dir="ltr" className="font-mono-num">{merchantSession.phone}</span> · {merchantSession.branch_name} ·{' '}
                          <span className={merchantSession.verification_status === 'approved' ? 'text-teal-300 font-semibold' : 'text-amber-300 font-semibold'}>
                            {merchantSession.verification_status === 'approved'
                              ? isAr ? 'حساب معتمد ✓' : 'Approved ✓'
                              : isAr ? 'قيد المراجعة والاعتماد' : 'Pending Review'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        api.logoutSession().catch(() => {});
                        setMerchantSession(null);
                        setOrders([]);
                        try {
                          localStorage.removeItem(MERCHANT_SESSION_KEY);
                        } catch {
                          // ignore
                        }
                        notify(isAr ? 'تم تسجيل خروج التاجر' : 'Merchant signed out');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/70 rounded-lg text-xs font-semibold text-rose-100"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
                    </button>
                  </div>
                  {merchantSession.verification_status !== 'approved' && (
                    <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-xl px-4 py-2.5 text-xs font-medium">
                      {isAr
                        ? 'تم استلام طلب تسجيلك وتوقيعك على الاتفاقية بنجاح؛ حسابك قيد مراجعة الإدارة حاليًا — لن يتم نشر متجرك أو منتجاتك للعملاء على المنصة إلا بعد موافقة الإدارة، ويمكنك تجهيز الأقسام والمنتجات لحين الاعتماد.'
                        : 'Your registration is pending Admin approval. Your store and products will not be published to customers until approved.'}
                    </div>
                  )}
                </div>
              )}
              {activeTab === 'overview' && (
                <OverviewSection
                  lang={lang}
                  overview={overview}
                  services={services}
                  captains={captains}
                  orders={orders}
                  onNavigate={setActiveTab}
                  onToggleService={handleQuickToggleService}
                  onRefresh={refreshCore}
                  onNotify={notify}
                />
              )}
              {activeTab === 'customers' && (
                <CustomersSection
                  lang={lang}
                  captains={captains}
                  zones={zones}
                  onRefreshCore={refreshCore}
                  onNotify={notify}
                />
              )}
              {activeTab === 'support' && (
                <SupportCenterSection lang={lang} onNotify={notify} onRefreshCore={refreshCore} />
              )}
              {activeTab === 'notifications' && (
                <NotificationsSection lang={lang} zones={zones} captains={captains} onNotify={notify} />
              )}
              {activeTab === 'services' && (
                <ServicesZonesSection lang={lang} services={services} zones={zones} onRefresh={refreshCore} onNotify={notify} />
              )}
              {activeTab === 'pricing' && portalMode === 'admin' && <PricingDispatchSection lang={lang} zones={zones} onNotify={notify} />}
              {activeTab === 'master_catalog' && portalMode === 'admin' && (
                <MasterCatalogAdminSection
                  categories={categories}
                  merchants={merchants}
                  onRefresh={() => void refreshCore()}
                  onToast={notify}
                />
              )}
              {activeTab === 'catalog' && (
                <CatalogSection
                  lang={lang}
                  merchants={merchants}
                  portalMode={portalMode === 'merchant' ? 'merchant' : 'admin'}
                  merchantSession={merchantSession}
                  onOpenMasterCatalog={portalMode === 'admin' ? () => setActiveTab('master_catalog') : undefined}
                  onRefreshCore={refreshCore}
                  onMerchantUpdated={(updated) => {
                    setMerchants((prev) =>
                      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
                    );
                    if (merchantSession && updated.id === merchantSession.id) {
                      const next = { ...merchantSession, ...updated };
                      setMerchantSession(next);
                      try {
                        localStorage.setItem(MERCHANT_SESSION_KEY, JSON.stringify(next));
                      } catch {
                        // ignore
                      }
                    }
                  }}
                  onNotify={notify}
                />
              )}
              {activeTab === 'invoice_design' && <InvoiceDesignSection lang={lang} onNotify={notify} />}
              {activeTab === 'captains' && (
                <CaptainsKycSection lang={lang} captains={captains} onRefresh={refreshCore} onNotify={notify} />
              )}
              {activeTab === 'rides_management' && portalMode === 'admin' && (
                <RidesManagementSection lang={lang} captains={captains} onRefreshCore={refreshCore} notify={notify} />
              )}
              {activeTab === 'store_reviews' && portalMode === 'admin' && (
                <StoreReviewsAdminSection lang={lang} onNotify={notify} />
              )}
              {activeTab === 'merchant_excel' && portalMode === 'merchant' && merchantSession && (
                <MerchantMasterLinkPanel
                  merchantId={merchantSession.id}
                  categories={categories}
                  merchantProducts={[]}
                  initialSubTab="excel"
                  onRefresh={() => void refreshCore()}
                  onToast={notify}
                />
              )}
              {activeTab === 'orders' &&
                (portalMode === 'merchant' && merchantSession ? (
                  <MerchantStoreOrdersView
                    lang={lang}
                    merchant={merchantSession}
                    orders={orders}
                    categories={categories}
                    onRefresh={refreshCore}
                    onNotify={notify}
                  />
                ) : (
                  <MerchantsOrdersSection
                    lang={lang}
                    portalMode={portalMode}
                    merchants={merchants}
                    orders={orders}
                    zones={zones}
                    captains={captains}
                    categories={categories}
                    onRefresh={refreshCore}
                    onNotify={notify}
                  />
                ))}
              {activeTab === 'market' && (
                <MarketFinanceSection lang={lang} mode="market" onNotify={notify} onRefreshOverview={refreshCore} />
              )}
              {activeTab === 'finance' && (
                <MarketFinanceSection lang={lang} mode="finance" onNotify={notify} onRefreshOverview={refreshCore} />
              )}
              {activeTab === 'cloud_db' && (
                <CloudDatabaseSection
                  firebaseUser={firebaseUser}
                  authReady={firebaseAuthReady}
                  serverStatus={serverSyncStatus}
                  cloudMeta={cloudVaultMeta}
                  progress={cloudProgress}
                  autoSyncEnabled={autoCloudSync}
                  onToggleAutoSync={handleToggleAutoCloudSync}
                  onSignInGoogle={handleSignInCloudGoogle}
                  onSignOutGoogle={handleSignOutCloudGoogle}
                  onPushNow={() => handleCloudPushNow(false)}
                  onRestoreNow={() => handleCloudRestoreNow(false)}
                  onRefreshStatus={async () => {
                    await refreshCloudSyncStatus();
                    notify('تم تحديث حالة قاعدة البيانات السحابية');
                  }}
                />
              )}
              {activeTab === 'governance' && (
                <GovernanceAuditSection lang={lang} onNotify={notify} onRefreshOverview={refreshCore} />
              )}
            </>
          )}
        </main>

        {/* Dedicated Merchant Mobile App Bottom Navigation (Standalone or Mobile Screens) */}
        {portalMode === 'merchant' && merchantSession && (
          <nav
            aria-label={isAr ? 'تنقل تطبيق التاجر' : 'Merchant App Navigation'}
            className={`${standalone ? 'flex' : 'flex md:hidden'} sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-2 items-center justify-around shadow-[0_-4px_16px_rgba(15,23,42,0.06)]`}
          >
            {[
              { id: 'orders', label: isAr ? 'الطلبات' : 'Orders', icon: ShoppingBag },
              { id: 'merchant_excel', label: isAr ? 'رفع Excel' : 'Excel', icon: FileSpreadsheet },
              { id: 'catalog', label: isAr ? 'المنتجات' : 'Products', icon: Package },
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex flex-col items-center justify-center gap-1 px-4 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                    isSelected ? 'text-[#A92224] bg-rose-50' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void refreshCore(false, merchantSession)}
              className="flex flex-col items-center justify-center gap-1 px-4 py-1.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-teal-700"
            >
              <RefreshCw className="w-5 h-5" />
              <span>{isAr ? 'تحديث' : 'Refresh'}</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
