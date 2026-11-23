import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Send, Smartphone, Truck, Store, Users, ExternalLink, Compass } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CaptainRecord, Language, NotificationRecord, NotificationTargetApp, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  zones: ServiceZone[];
  captains: CaptainRecord[];
  onNotify: (msg: string) => void;
}

type RedirectKind =
  | 'home'
  | 'categories'
  | 'category'
  | 'merchant'
  | 'product'
  | 'offers'
  | 'stores'
  | 'pharmacy'
  | 'rides'
  | 'parcels'
  | 'market'
  | 'free_order'
  | 'cart'
  | 'orders'
  | 'profile'
  | 'wallet'
  | 'support'
  | 'verify_email'
  | 'kyc_upload'
  | 'notifications'
  | 'url';

interface SimpleCategory {
  id: string;
  name_ar: string;
  name_en?: string;
  full_path_ar?: string;
}

interface SimpleMerchant {
  id: string;
  name_ar: string;
  zone_name?: string;
}

interface SimpleProduct {
  id: string;
  name_ar: string;
  merchant_name?: string;
  base_price?: number;
  sale_price?: number | null;
}

export const NotificationsSection: React.FC<Props> = ({ lang, zones, captains, onNotify }) => {
  const isAr = lang === 'ar';
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [filterApp, setFilterApp] = useState<string>('all_filter');

  const [targetApp, setTargetApp] = useState<NotificationTargetApp>('customer');
  const [targetZone, setTargetZone] = useState<string>('all');
  const [recipientId, setRecipientId] = useState<string>('');
  const [customerSegment, setCustomerSegment] = useState<'all' | 'unverified_email'>('all');
  const [customers, setCustomers] = useState<
    Array<{ id: string; full_name: string; email?: string | null; is_email_verified?: boolean | number }>
  >([]);
  const [categories, setCategories] = useState<SimpleCategory[]>([]);
  const [merchants, setMerchants] = useState<SimpleMerchant[]>([]);
  const [products, setProducts] = useState<SimpleProduct[]>([]);
  const [productSearch, setProductSearch] = useState<string>('');

  const [category, setCategory] = useState<'promo' | 'operational' | 'compliance' | 'alert'>('promo');
  const [redirectKind, setRedirectKind] = useState<RedirectKind>('home');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>('');

  const [titleAr, setTitleAr] = useState<string>('');
  const [bodyAr, setBodyAr] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [fcmStatus, setFcmStatus] = useState<{
    configured: boolean;
    source: string;
    project_id: string | null;
    registered_devices: { total: number; customer: number; captain: number };
    auth_probe?: { ok: boolean; code?: string; message?: string };
  } | null>(null);

  const unverifiedCustomersCount = customers.filter((c) => !Boolean(c.is_email_verified)).length;

  const computedDeepLink = useMemo(() => {
    if (redirectKind === 'category') {
      return selectedCategoryId ? `category:${selectedCategoryId}` : 'categories';
    }
    if (redirectKind === 'merchant') {
      return selectedMerchantId ? `merchant:${selectedMerchantId}` : 'stores';
    }
    if (redirectKind === 'product') {
      return selectedProductId ? `product:${selectedProductId}` : 'home';
    }
    if (redirectKind === 'url') {
      const trimmed = customUrl.trim();
      return trimmed ? `url:${trimmed}` : 'home';
    }
    return redirectKind;
  }, [redirectKind, selectedCategoryId, selectedMerchantId, selectedProductId, customUrl]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products
      .filter(
        (p) =>
          (p.name_ar || '').toLowerCase().includes(q) ||
          (p.merchant_name || '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [products, productSearch]);

  const loadHistory = async () => {
    const [rows, status, custRows] = await Promise.all([
      api.getNotifications(filterApp === 'all_filter' ? undefined : filterApp),
      api.getFcmStatus(true).catch(() => null),
      api.getAdminCustomers().catch(() => []),
    ]);
    setHistory(rows);
    if (status) setFcmStatus(status);
    if (Array.isArray(custRows)) setCustomers(custRows);
  };

  useEffect(() => {
    loadHistory();
  }, [filterApp]);

  useEffect(() => {
    Promise.all([
      api.getCategories().catch(() => []),
      api.getMerchants().catch(() => []),
      api.getProductsPaginated({ page: 1, limit: 100 }).catch(() => ({ items: [] })),
    ]).then(([catRows, merRows, prodRes]) => {
      if (Array.isArray(catRows)) setCategories(catRows);
      if (Array.isArray(merRows)) setMerchants(merRows);
      const prodList = Array.isArray((prodRes as any)?.items)
        ? (prodRes as any).items
        : Array.isArray((prodRes as any)?.products)
        ? (prodRes as any).products
        : [];
      setProducts(prodList);
    });
  }, []);

  const applyTemplate = (preset: 'cust_verify_email' | 'cust_promo' | 'cust_offers' | 'cust_rx' | 'cap_peak' | 'cap_kyc') => {
    if (preset === 'cust_verify_email') {
      setTargetApp('customer');
      setCategory('alert');
      setRedirectKind('verify_email');
      setRecipientId('');
      setCustomerSegment('unverified_email');
      setTitleAr('وثّق بريدك الإلكتروني الآن');
      setBodyAr('اضغط على الإشعار لفتح صفحة التوثيق وإدخال الرمز المرسل على بريدك الإلكتروني لتأمين حسابك في اطلبها.');
    } else if (preset === 'cust_promo') {
      setTargetApp('customer');
      setCategory('promo');
      setRedirectKind('stores');
      setRecipientId('');
      setCustomerSegment('all');
      setTitleAr('عرض نهاية الأسبوع في المنزلة: توصيل بـ 10 ج.م فقط');
      setBodyAr('اطلب من أي سوبرماركت أو مطعم في المنزلة الآن واستمتع بتوصيل مخفض لفترة محدودة.');
    } else if (preset === 'cust_offers') {
      setTargetApp('customer');
      setCategory('promo');
      setRedirectKind('offers');
      setRecipientId('');
      setCustomerSegment('all');
      setTitleAr('تخفيضات اليوم متاحة الآن في قسم العروض');
      setBodyAr('اضغط على الإشعار للانتقال مباشرة إلى أحدث العروض والكوبونات النشطة في اطلبها.');
    } else if (preset === 'cust_rx') {
      setTargetApp('customer');
      setCategory('operational');
      setRedirectKind('pharmacy');
      setRecipientId('');
      setCustomerSegment('all');
      setTitleAr('صيدليات المنزلة المناوبة متاحة الآن');
      setBodyAr('ارسل صورة الروشتة أو اكتب طلبك ليراجعه الصيدلي المرخص خلال دقائق.');
    } else if (preset === 'cap_peak') {
      setTargetApp('captain');
      setCategory('operational');
      setRedirectKind('orders');
      setRecipientId('');
      setCustomerSegment('all');
      setTitleAr('ذروة طلبات الآن في وسط المنزلة والبصراط');
      setBodyAr('فرصة مضاعفة لزيادة دخلك: حوّل حالتك إلى متاح لاستقبال طلبات المتاجر والطرود الفورية.');
    } else {
      setTargetApp('captain');
      setCategory('compliance');
      setRedirectKind('kyc_upload');
      setRecipientId('');
      setCustomerSegment('all');
      setTitleAr('تذكير مهم بتحديث مستندات المركبة وحد الكاش');
      setBodyAr('تأكد من سريان رخصة المركبة وعدم تجاوز حد الكاش (1000 ج.م) لضمان استمرار استقبال الطلبات.');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleAr.trim() || !bodyAr.trim()) return;
    if (redirectKind === 'category' && !selectedCategoryId) {
      onNotify(isAr ? 'اختر القسم المستهدف أولًا' : 'Please select a target category');
      return;
    }
    if (redirectKind === 'merchant' && !selectedMerchantId) {
      onNotify(isAr ? 'اختر المتجر المستهدف أولًا' : 'Please select a target store');
      return;
    }
    if (redirectKind === 'product' && !selectedProductId) {
      onNotify(isAr ? 'اختر المنتج المستهدف أولًا' : 'Please select a target product');
      return;
    }
    if (redirectKind === 'url') {
      const trimmed = customUrl.trim();
      if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
        onNotify(isAr ? 'أدخل رابطًا صحيحًا يبدأ بـ https://' : 'Enter a valid URL starting with https://');
        return;
      }
    }

    setSending(true);
    try {
      const res = await api.sendNotification({
        target_app: targetApp,
        target_zone: targetZone,
        recipient_id: recipientId || null,
        target_segment: targetApp === 'customer' && !recipientId ? customerSegment : 'all',
        category,
        title_ar: titleAr,
        body_ar: bodyAr,
        deep_link: computedDeepLink,
      });
      setTitleAr('');
      setBodyAr('');
      await loadHistory();
      const fcm = res.fcm_delivery;
      const fcmNoteAr = fcm
        ? fcm.topic_sent
          ? ` — تم البث عبر قناة FCM (${fcm.topic_name})`
          : fcm.sent_count > 0
          ? ` — إرسال FCM فعلي: ${fcm.sent_count} من ${fcm.targeted_devices} جهاز`
          : fcm.reason === 'messaging/mismatched-credential'
          ? ' — تم الحفظ في التطبيق (مطلوب ربط صلاحية FCM لمشروع Firebase لإشعارات الخلفية)'
          : ` — تم الحفظ في التطبيق (${fcm.targeted_devices} جهاز مسجل)`
        : '';
      const fcmNoteEn = fcm
        ? fcm.topic_sent
          ? ` — FCM topic broadcast (${fcm.topic_name})`
          : fcm.sent_count > 0
          ? ` — FCM delivered: ${fcm.sent_count}/${fcm.targeted_devices} devices`
          : ` — Saved to inbox (${fcm.targeted_devices} registered devices)`
        : '';
      onNotify(
        isAr
          ? `تم إرسال الإشعار بنجاح${fcmNoteAr}`
          : `Notification sent${fcmNoteEn}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const appLabel = (app: string) => {
    if (app === 'customer') return isAr ? 'التطبيق الرئيسي (العملاء)' : 'Customer App';
    if (app === 'captain') return isAr ? 'تطبيق الطيارين (الكباتن)' : 'Captain App';
    if (app === 'merchant') return isAr ? 'بوابة التجار والصيدليات' : 'Merchant Portal';
    return isAr ? 'جميع التطبيقات' : 'All Apps';
  };

  const describeDeepLink = (dl?: string | null) => {
    const raw = String(dl || 'notifications').trim();
    const low = raw.toLowerCase();
    if (low === 'home') return isAr ? 'الصفحة الرئيسية' : 'Home';
    if (low === 'categories') return isAr ? 'صفحة الأقسام' : 'Categories';
    if (low.startsWith('category:')) {
      const id = raw.slice(9);
      const found = categories.find((c) => c.id === id);
      return isAr ? `قسم: ${found?.name_ar || id}` : `Category: ${found?.name_en || found?.name_ar || id}`;
    }
    if (low.startsWith('merchant:')) {
      const id = raw.slice(9);
      const found = merchants.find((m) => m.id === id);
      return isAr ? `متجر: ${found?.name_ar || id}` : `Store: ${found?.name_ar || id}`;
    }
    if (low.startsWith('product:')) {
      const id = raw.slice(8);
      const found = products.find((p) => p.id === id);
      return isAr ? `منتج: ${found?.name_ar || id}` : `Product: ${found?.name_ar || id}`;
    }
    if (low.startsWith('url:')) {
      return isAr ? `رابط خارجي: ${raw.slice(4)}` : `External URL: ${raw.slice(4)}`;
    }
    const mapAr: Record<string, string> = {
      offers: 'العروض والكوبونات',
      promo: 'العروض والكوبونات',
      stores: 'المتاجر والمطاعم',
      pharmacy: 'الصيدلية والروشتات',
      rides: 'المشاوير والتوصيل',
      parcels: 'اطلبها أي حاجة (طرود)',
      market: 'سوق اطلبها (C2C)',
      free_order: 'طلب نصي حر',
      cart: 'السلة',
      orders: 'الطلبات النشطة',
      profile: 'الملف الشخصي وحسابي',
      wallet: 'المحفظة والتسوية',
      support: 'الدعم الفني',
      verify_email: 'توثيق البريد الإلكتروني',
      kyc_upload: 'مستندات الكابتن (KYC)',
      notifications: 'صندوق الإشعارات',
    };
    return isAr ? mapAr[low] || raw : raw;
  };

  const fcmReady = Boolean(fcmStatus?.configured && fcmStatus?.auth_probe?.ok !== false);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>{isAr ? 'إجمالي الإشعارات المرسلة' : 'Total Broadcasts'}</span>
            <Bell className="w-4 h-4 text-orange-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{history.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>{isAr ? 'إشعارات تطبيق العملاء' : 'Customer App Push'}</span>
            <Smartphone className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {history.filter((h) => h.target_app === 'customer' || h.target_app === 'all').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>{isAr ? 'إشعارات تطبيق الطيارين' : 'Captain App Push'}</span>
            <Truck className="w-4 h-4 text-slate-700" />
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {history.filter((h) => h.target_app === 'captain' || h.target_app === 'all').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>{isAr ? 'أجهزة Push المسجلة' : 'Registered Push Devices'}</span>
            <Users className={`w-4 h-4 ${fcmReady ? 'text-emerald-600' : 'text-amber-600'}`} />
          </div>
          <p className="text-sm font-bold text-slate-900 mt-1">
            {fcmReady
              ? isAr
                ? 'إشعارات الهاتف مفعّلة'
                : 'Push Active'
              : isAr
              ? 'بانتظار اعتماد FCM السحابي'
              : 'FCM Credentials Pending'}
          </p>
          <p className="text-xs text-slate-500 tabular-nums">
            {isAr
              ? `أجهزة مسجلة: ${fcmStatus?.registered_devices.total ?? 0} (عملاء ${fcmStatus?.registered_devices.customer ?? 0} · طيارون ${fcmStatus?.registered_devices.captain ?? 0})`
              : `Devices: ${fcmStatus?.registered_devices.total ?? 0} (Cust ${fcmStatus?.registered_devices.customer ?? 0} · Cap ${fcmStatus?.registered_devices.captain ?? 0})`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSend} className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'إرسال إشعار جديد مع توجيه مخصص' : 'Send Push Notification'}
            </h3>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              {isAr ? 'اختر التطبيق المستهدف' : 'Target Application'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'customer' as const, label: isAr ? 'التطبيق الرئيسي (العملاء)' : 'Customer App', icon: Smartphone },
                { id: 'captain' as const, label: isAr ? 'تطبيق الطيارين (الكباتن)' : 'Captain App', icon: Truck },
                { id: 'merchant' as const, label: isAr ? 'بوابة التجار' : 'Merchant Portal', icon: Store },
                { id: 'all' as const, label: isAr ? 'جميع التطبيقات' : 'All Apps', icon: Users },
              ].map((item) => {
                const Icon = item.icon;
                const selected = targetApp === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setTargetApp(item.id);
                      setRecipientId('');
                      if (item.id !== 'customer') setCustomerSegment('all');
                    }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                      selected
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {isAr ? 'النطاق الجغرافي (المنزلة)' : 'Target Zone'}
              </label>
              <select
                value={targetZone}
                onChange={(e) => setTargetZone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
              >
                <option value="all">{isAr ? 'كل مدينة ومركز المنزلة' : 'All El Manzala Zones'}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.name_ar}>
                    {isAr ? z.name_ar : z.name_en}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {isAr ? 'نوع الإشعار' : 'Category'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
              >
                <option value="promo">{isAr ? 'عرض / خصم / ذروة' : 'Promo / Peak'}</option>
                <option value="operational">{isAr ? 'تشغيلي / تحديث خدمة' : 'Operational'}</option>
                <option value="compliance">{isAr ? 'تنبيه مستندات / حد كاش' : 'Compliance / KYC'}</option>
                <option value="alert">{isAr ? 'تنبيه عاجل / صيانة' : 'Urgent Alert'}</option>
              </select>
            </div>
          </div>

          {targetApp === 'customer' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {isAr ? 'استهداف العملاء' : 'Customer Targeting'}
              </label>
              <select
                value={recipientId ? `cust:${recipientId}` : customerSegment}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'all' || val === 'unverified_email') {
                    setRecipientId('');
                    setCustomerSegment(val);
                  } else if (val.startsWith('cust:')) {
                    setCustomerSegment('all');
                    setRecipientId(val.slice(5));
                  }
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
              >
                <option value="all">{isAr ? 'جميع العملاء في النطاق المختار' : 'All Customers in Zone'}</option>
                <option value="unverified_email">
                  {isAr
                    ? `العملاء غير الموثّق بريدهم فقط (${unverifiedCustomersCount})`
                    : `Unverified Email Customers Only (${unverifiedCustomersCount})`}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={`cust:${c.id}`}>
                    {c.full_name}
                    {c.email ? ` — ${c.email}` : ''} ({c.is_email_verified ? (isAr ? 'موثّق' : 'Verified') : isAr ? 'غير موثّق' : 'Unverified'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetApp === 'captain' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {isAr ? 'استهداف طيار محدد (اختياري)' : 'Specific Captain (Optional)'}
              </label>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
              >
                <option value="">{isAr ? 'جميع الكباتن في النطاق المختار' : 'All Captains in Zone'}</option>
                {captains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} — {c.zone_name} ({c.verification_status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Notification Redirect / Deep-Link Target */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Compass className="w-4 h-4 text-orange-600" />
              <span>{isAr ? 'توجيه الإشعار عند الضغط عليه (الصفحة المستهدفة)' : 'Redirect Destination on Tap'}</span>
            </div>

            <select
              value={redirectKind}
              onChange={(e) => {
                const next = e.target.value as RedirectKind;
                setRedirectKind(next);
                if (next === 'verify_email' && targetApp !== 'customer') {
                  setTargetApp('customer');
                  setRecipientId('');
                }
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <optgroup label={isAr ? 'صفحات التطبيق الرئيسية' : 'Main Pages'}>
                <option value="home">{isAr ? 'الصفحة الرئيسية' : 'Home Page'}</option>
                <option value="categories">{isAr ? 'صفحة الأقسام الرئيسية والفرعية' : 'Categories Page'}</option>
                <option value="offers">{isAr ? 'صفحة العروض والكوبونات' : 'Offers & Coupons'}</option>
                <option value="stores">{isAr ? 'المتاجر والمطاعم' : 'Stores & Restaurants'}</option>
                <option value="cart">{isAr ? 'سلة المشتريات' : 'Shopping Cart'}</option>
                <option value="orders">{isAr ? 'الطلبات النشطة / طلباتي' : 'Orders'}</option>
                <option value="profile">{isAr ? 'حسابي والملف الشخصي' : 'Profile / Account'}</option>
                <option value="wallet">{isAr ? 'المحفظة والتسوية' : 'Wallet / Settlement'}</option>
                <option value="support">{isAr ? 'الدعم الفني والتواصل' : 'Customer Support'}</option>
                <option value="notifications">{isAr ? 'صندوق الإشعارات فقط' : 'Notifications Inbox'}</option>
              </optgroup>
              <optgroup label={isAr ? 'توجيه إلى عنصر محدد' : 'Specific Target'}>
                <option value="category">{isAr ? 'قسم محدد (اختر القسم)' : 'Specific Category'}</option>
                <option value="merchant">{isAr ? 'متجر محدد (اختر المتجر)' : 'Specific Store'}</option>
                <option value="product">{isAr ? 'منتج محدد (اختر المنتج)' : 'Specific Product'}</option>
                <option value="url">{isAr ? 'رابط خارجي مخصص (URL)' : 'Custom External URL'}</option>
              </optgroup>
              <optgroup label={isAr ? 'خدمات اطلبها والحساب' : 'Services & Account'}>
                <option value="pharmacy">{isAr ? 'خدمة الصيدلية والروشتات' : 'Pharmacy & Prescriptions'}</option>
                <option value="rides">{isAr ? 'خدمة المشاوير والتوصيل' : 'Rides Service'}</option>
                <option value="parcels">{isAr ? 'خدمة الطرود (اطلبها أي حاجة)' : 'Parcels Service'}</option>
                <option value="market">{isAr ? 'سوق اطلبها (C2C)' : 'Otlobha Market'}</option>
                <option value="free_order">{isAr ? 'طلب نصي حر' : 'Free-Text Order'}</option>
                <option value="verify_email">{isAr ? 'توثيق البريد الإلكتروني' : 'Verify Email'}</option>
                <option value="kyc_upload">{isAr ? 'مستندات الكابتن (KYC)' : 'Captain KYC'}</option>
              </optgroup>
            </select>

            {redirectKind === 'category' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {isAr ? 'اختر القسم الذي سيُفتح مباشرة' : 'Select Target Category'}
                </label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                >
                  <option value="">{isAr ? '-- اختر القسم --' : '-- Choose Category --'}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.full_path_ar || cat.name_ar}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {redirectKind === 'merchant' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {isAr ? 'اختر المتجر الذي سيُفتح مباشرة' : 'Select Target Store'}
                </label>
                <select
                  value={selectedMerchantId}
                  onChange={(e) => setSelectedMerchantId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                >
                  <option value="">{isAr ? '-- اختر المتجر --' : '-- Choose Store --'}</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name_ar} {m.zone_name ? `— ${m.zone_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {redirectKind === 'product' && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-600 block">
                  {isAr ? 'ابحث واختر المنتج الذي سيُفتح مباشرة' : 'Search & Select Target Product'}
                </label>
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={isAr ? 'اكتب اسم المنتج أو المتجر للتصفية...' : 'Filter products...'}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                />
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                >
                  <option value="">{isAr ? '-- اختر المنتج --' : '-- Choose Product --'}</option>
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name_ar} {p.merchant_name ? `(${p.merchant_name})` : ''}
                      {p.sale_price ?? p.base_price ? ` — ${p.sale_price ?? p.base_price} ج.م` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {redirectKind === 'url' && (
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {isAr ? 'الرابط الخارجي (يفتح عند الضغط على الإشعار)' : 'External URL'}
                </label>
                <div className="flex items-center gap-1.5">
                  <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="url"
                    dir="ltr"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://example.com/offer"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-600">
              {isAr ? 'عند الضغط على الإشعار سيتم التحويل إلى: ' : 'Tapping redirects to: '}
              <strong className="text-orange-700">{describeDeepLink(computedDeepLink)}</strong>
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              {isAr ? 'عنوان الإشعار' : 'Notification Title'}
            </label>
            <input
              type="text"
              required
              value={titleAr}
              onChange={(e) => setTitleAr(e.target.value)}
              placeholder={isAr ? 'مثال: خصم 20 ج.م على طلبات اليوم في المنزلة' : 'Notification title...'}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              {isAr ? 'نص الرسالة' : 'Message Body'}
            </label>
            <textarea
              rows={3}
              required
              value={bodyAr}
              onChange={(e) => setBodyAr(e.target.value)}
              placeholder={isAr ? 'اكتب تفاصيل الإشعار التي ستظهر في الهاتف...' : 'Message body...'}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-slate-500">{isAr ? 'قوالب جاهزة سريعة:' : 'Quick Templates:'}</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyTemplate('cust_offers')}
                className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 rounded text-xs font-semibold whitespace-nowrap"
              >
                {isAr ? 'توجيه للعروض' : 'Offers Promo'}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('cust_verify_email')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'توثيق البريد' : 'Verify Email'}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('cust_promo')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'عرض متاجر' : 'Stores Promo'}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('cust_rx')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'تنبيه صيدليات' : 'Pharmacy Alert'}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('cap_peak')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'ذروة للطيارين' : 'Captain Peak'}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('cap_kyc')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'مستندات وكاش' : 'Captain KYC'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            <span>{sending ? (isAr ? 'جاري الإرسال...' : 'Sending...') : isAr ? 'إرسال الإشعار الآن' : 'Send Push Broadcast'}</span>
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'سجل الإشعارات والحملات المرسلة' : 'Broadcast History'}
            </h3>
            <select
              value={filterApp}
              onChange={(e) => setFilterApp(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="all_filter">{isAr ? 'كل التطبيقات' : 'All Apps'}</option>
              <option value="customer">{isAr ? 'تطبيق العملاء فقط' : 'Customer App'}</option>
              <option value="captain">{isAr ? 'تطبيق الطيارين فقط' : 'Captain App'}</option>
              <option value="merchant">{isAr ? 'بوابة التجار' : 'Merchant Portal'}</option>
              <option value="all">{isAr ? 'إشعارات عامة للجميع' : 'Broadcast to All'}</option>
            </select>
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              {isAr ? 'لا توجد إشعارات مرسلة في هذا النطاق بعد.' : 'No notifications sent yet.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {history.map((item) => (
                <div key={item.id} className="py-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-slate-900">{appLabel(item.target_app)}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{item.target_zone === 'all' ? (isAr ? 'كل المنزلة' : 'All Zones') : item.target_zone}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono-num text-slate-500">{item.fcm_topic}</span>
                    </div>
                    <span className="text-xs font-mono-num text-slate-500">{item.created_at}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-900">{item.title_ar}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{item.body_ar}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                    <span className="tabular-nums">
                      {isAr ? 'المستهدفون:' : 'Reach:'} <strong className="text-slate-800">{item.audience_count}</strong>
                    </span>
                    <span>
                      {isAr ? 'التوجيه:' : 'Target:'}{' '}
                      <strong className="text-orange-700">{describeDeepLink(item.deep_link)}</strong>
                    </span>
                    <span>
                      {isAr ? 'الحالة:' : 'Status:'}{' '}
                      <strong className={item.is_read ? 'text-teal-700' : 'text-orange-700'}>
                        {item.is_read ? (isAr ? 'تمت المشاهدة' : 'Seen') : isAr ? 'غير مقروء' : 'Unread'}
                      </strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
