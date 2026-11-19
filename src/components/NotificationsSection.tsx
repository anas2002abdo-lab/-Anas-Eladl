import React, { useEffect, useState } from 'react';
import { Bell, Send, Smartphone, Truck, Store, Users } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CaptainRecord, Language, NotificationRecord, NotificationTargetApp, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  zones: ServiceZone[];
  captains: CaptainRecord[];
  onNotify: (msg: string) => void;
}

export const NotificationsSection: React.FC<Props> = ({ lang, zones, captains, onNotify }) => {
  const isAr = lang === 'ar';
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [filterApp, setFilterApp] = useState<string>('all_filter');

  const [targetApp, setTargetApp] = useState<NotificationTargetApp>('customer');
  const [targetZone, setTargetZone] = useState<string>('all');
  const [recipientId, setRecipientId] = useState<string>('');
  const [category, setCategory] = useState<'promo' | 'operational' | 'compliance' | 'alert'>('promo');
  const [deepLink, setDeepLink] = useState<string>('stores');
  const [titleAr, setTitleAr] = useState<string>('');
  const [bodyAr, setBodyAr] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [fcmStatus, setFcmStatus] = useState<{
    configured: boolean;
    source: string;
    project_id: string | null;
    registered_devices: { total: number; customer: number; captain: number };
  } | null>(null);

  const loadHistory = async () => {
    const [rows, status] = await Promise.all([
      api.getNotifications(filterApp === 'all_filter' ? undefined : filterApp),
      api.getFcmStatus().catch(() => null),
    ]);
    setHistory(rows);
    if (status) setFcmStatus(status);
  };

  useEffect(() => {
    loadHistory();
  }, [filterApp]);

  const applyTemplate = (preset: 'cust_promo' | 'cust_rx' | 'cap_peak' | 'cap_kyc') => {
    if (preset === 'cust_promo') {
      setTargetApp('customer');
      setCategory('promo');
      setDeepLink('stores');
      setRecipientId('');
      setTitleAr('عرض نهاية الأسبوع في المنزلة: توصيل بـ 10 ج.م فقط');
      setBodyAr('اطلب من أي سوبرماركت أو مطعم في المنزلة الآن واستمتع بتوصيل مخفض لفترة محدودة.');
    } else if (preset === 'cust_rx') {
      setTargetApp('customer');
      setCategory('operational');
      setDeepLink('pharmacy');
      setRecipientId('');
      setTitleAr('صيدليات المنزلة المناوبة متاحة الآن');
      setBodyAr('ارسل صورة الروشتة أو اكتب طلبك ليراجعه الصيدلي المرخص خلال دقائق.');
    } else if (preset === 'cap_peak') {
      setTargetApp('captain');
      setCategory('operational');
      setDeepLink('orders');
      setTitleAr('ذروة طلبات الآن في وسط المنزلة والبصراط');
      setBodyAr('فرصة مضاعفة لزيادة دخلك: حوّل حالتك إلى متاح لاستقبال طلبات المتاجر والطرود الفورية.');
    } else {
      setTargetApp('captain');
      setCategory('compliance');
      setDeepLink('kyc_upload');
      setTitleAr('تذكير مهم بتحديث مستندات المركبة وحد الكاش');
      setBodyAr('تأكد من سريان رخصة المركبة وعدم تجاوز حد الكاش (1000 ج.م) لضمان استمرار استقبال الطلبات.');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleAr.trim() || !bodyAr.trim()) return;
    setSending(true);
    try {
      const res = await api.sendNotification({
        target_app: targetApp,
        target_zone: targetZone,
        recipient_id: recipientId || null,
        category,
        title_ar: titleAr,
        body_ar: bodyAr,
        deep_link: deepLink,
      });
      setTitleAr('');
      setBodyAr('');
      await loadHistory();
      const fcm = res.fcm_delivery;
      const fcmNoteAr = fcm
        ? fcm.fcm_enabled
          ? ` — إرسال FCM فعلي: ${fcm.sent_count} من ${fcm.targeted_devices} جهاز`
          : ` — محفوظ داخل التطبيق (${fcm.targeted_devices} جهاز مسجل، FCM بانتظار مفتاح الخدمة)`
        : '';
      const fcmNoteEn = fcm
        ? fcm.fcm_enabled
          ? ` — FCM delivered: ${fcm.sent_count}/${fcm.targeted_devices} devices`
          : ` — In-app saved (${fcm.targeted_devices} registered devices, FCM credentials pending)`
        : '';
      onNotify(
        isAr
          ? `تم بث الإشعار بنجاح (${res.fcm_topic})${fcmNoteAr}`
          : `Notification broadcast sent (${res.fcm_topic})${fcmNoteEn}`
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
            <span>{isAr ? 'محرك Firebase FCM والأجهزة' : 'Firebase FCM & Devices'}</span>
            <Users className={`w-4 h-4 ${fcmStatus?.configured ? 'text-emerald-600' : 'text-amber-600'}`} />
          </div>
          <p className="text-sm font-bold text-slate-900 mt-1">
            {fcmStatus?.configured
              ? isAr
                ? 'FCM مفعّل وجاهز'
                : 'FCM Active'
              : isAr
              ? 'FCM بانتظار مفتاح الخدمة'
              : 'FCM Key Pending'}
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
              {isAr ? 'إرسال إشعار جديد (Push Broadcast)' : 'Send Push Notification'}
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
                      if (item.id !== 'captain') setRecipientId('');
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

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              {isAr ? 'الشاشة التي يفتحها الإشعار (Deep Link)' : 'Deep Link Screen'}
            </label>
            <select
              value={deepLink}
              onChange={(e) => setDeepLink(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="home">{isAr ? 'الشاشة الرئيسية' : 'Home'}</option>
              <option value="stores">{isAr ? 'المتاجر والمنتجات' : 'Stores & Products'}</option>
              <option value="pharmacy">{isAr ? 'الصيدلية والروشتات' : 'Pharmacy'}</option>
              <option value="parcels">{isAr ? 'اطلبها أي حاجة (طرود)' : 'Parcels'}</option>
              <option value="market">{isAr ? 'سوق اطلبها (C2C)' : 'Otlobha Market'}</option>
              <option value="orders">{isAr ? 'الطلبات النشطة (للكباتن/العملاء)' : 'Active Orders'}</option>
              <option value="kyc_upload">{isAr ? 'مستندات الكابتن (KYC)' : 'Captain KYC'}</option>
              <option value="wallet">{isAr ? 'المحفظة والرصيد' : 'Wallet'}</option>
            </select>
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
                onClick={() => applyTemplate('cust_promo')}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs whitespace-nowrap"
              >
                {isAr ? 'عرض للعملاء' : 'Customer Promo'}
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
                {isAr ? 'تذكير مستندات وكاش' : 'Captain KYC/Cash'}
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
                    {isAr ? 'الوجهة:' : 'Screen:'} <strong className="text-slate-800">{item.deep_link}</strong>
                  </span>
                  <span>
                    {isAr ? 'الحالة:' : 'Status:'}{' '}
                    <strong className={item.is_read ? 'text-teal-700' : 'text-orange-700'}>
                      {item.is_read ? (isAr ? 'تمت القراءة في التطبيق' : 'Read in App') : isAr ? 'متاح في صندوق الإشعارات' : 'Delivered to Inbox'}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
