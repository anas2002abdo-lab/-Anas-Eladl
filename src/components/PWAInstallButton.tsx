import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Smartphone,
  Terminal,
  Truck,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../lib/usePWAInstall.ts';
import type { Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify?: (msg: string) => void;
}

export const PWAInstallButton: React.FC<Props> = ({ lang, onNotify }) => {
  const isAr = lang === 'ar';
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showHubModal, setShowHubModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const customerAppUrl = `${origin}/?portal=customer&standalone=1`;
  const captainAppUrl = `${origin}/?portal=captain&standalone=1`;
  const merchantAppUrl = `${origin}/?portal=merchant&standalone=1`;

  const copyText = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
      onNotify?.(isAr ? `تم نسخ ${label}` : `Copied ${label}`);
    } catch {
      onNotify?.(text);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={async () => {
              const ok = await install();
              if (ok) {
                onNotify?.(isAr ? 'تم تثبيت تطبيق اطلبها على جهازك بنجاح' : 'App installed');
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-xs transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isAr ? 'تثبيت التطبيق' : 'Install App'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowHubModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors whitespace-nowrap"
        >
          <Smartphone className="w-3.5 h-3.5 text-orange-400" />
          <span>{isAr ? 'إصدار APK & تطبيقات الموبايل' : 'APK & Mobile Apps'}</span>
        </button>
      </div>

      {showHubModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {isAr
                      ? 'مركز استخراج ملفات APK وتثبيت تطبيقات الموبايل (العميل & الطيارين & التجار)'
                      : 'Android APK Builder & PWA Mobile Installer'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? 'ثبّت التطبيق فورًا على هاتفك أو استخرج ملفات Android APK الأصلية (العميل، الكابتن، والتاجر)'
                      : 'Install directly as a standalone mobile app or build native Android APKs'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHubModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Method 1: Instant PWA / WebAPK Installation */}
            <div className="p-4 rounded-xl bg-orange-50/70 border border-orange-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-orange-600" />
                  <span>
                    {isAr
                      ? 'الطريقة 1: التثبيت الفوري كتطبيق موبايل مستقل (WebAPK / PWA) أو تحويل الرابط لـ APK'
                      : 'Method 1: Instant Standalone Mobile App & Direct APK Wrapper'}
                  </span>
                </span>
                {isInstallable && !isInstalled && (
                  <button
                    type="button"
                    onClick={install}
                    className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold"
                  >
                    {isAr ? 'تثبيت على هذا الجهاز الآن' : 'Install Now'}
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                {isAr
                  ? 'كل تطبيق يمتلك رابطًا مستقلًا يفتح بشاشة كاملة بدون أي قوائم إدارة. يمكنك فتح الرابط في متصفح Chrome على الأندرويد والضغط على «تثبيت التطبيق»، أو وضع الرابط في موقع PWABuilder.com لتنزيل ملف APK و AAB جاهز لمتجر Google Play في ثوانٍ:'
                  : 'Each portal has a standalone mobile URL. Open in Chrome on Android and tap "Install App", or paste into PWABuilder.com to download a signed APK:'}
              </p>

              <div className="space-y-2 text-xs">
                {[
                  {
                    key: 'cust',
                    title: isAr ? '1. رابط تطبيق العميل المستقل (Otlobha Customer):' : '1. Customer App Standalone URL:',
                    url: customerAppUrl,
                    icon: Smartphone,
                  },
                  {
                    key: 'cap',
                    title: isAr ? '2. رابط تطبيق الطيارين المستقل (Otlobha Captain):' : '2. Captain App Standalone URL:',
                    url: captainAppUrl,
                    icon: Truck,
                  },
                  {
                    key: 'mer',
                    title: isAr ? '3. رابط تطبيق التاجر والصيدلي المستقل (Otlobha Merchant):' : '3. Merchant App Standalone URL:',
                    url: merchantAppUrl,
                    icon: ExternalLink,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.key}
                      className="bg-white border border-orange-200/80 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-bold text-slate-900 flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                          <span>{item.title}</span>
                        </p>
                        <p dir="ltr" className="text-[11px] font-mono-num text-slate-500 truncate">
                          {item.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => copyText(item.url, item.key, item.title)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-bold"
                        >
                          {copiedKey === item.key ? (
                            <Check className="w-3.5 h-3.5 text-teal-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedKey === item.key ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'نسخ الرابط' : 'Copy')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {isIOS && (
                <div className="p-2.5 bg-white border border-orange-200 rounded-lg text-[11px] text-slate-700">
                  {isAr
                    ? '📱 لتثبيت التطبيق على iPhone / iPad: افتح الرابط في متصفح Safari ثم اضغط على زر المشاركة (Share) واختر «إضافة إلى الشاشة الرئيسية / Add to Home Screen».'
                    : 'On iPhone/iPad: Tap Share in Safari and select "Add to Home Screen".'}
                </div>
              )}
            </div>

            {/* Method 2: Native Flutter Android APK (Customer & Captain) */}
            <div className="p-4 rounded-xl bg-slate-900 text-slate-100 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-teal-400" />
                  <span>
                    {isAr
                      ? 'الطريقة 2: استخراج ملفات Android APK الأصلية (Flutter Apps المدمجة في المشروع)'
                      : 'Method 2: Build Native Flutter Android APKs'}
                  </span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Flutter SDK + GitHub Actions
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {isAr
                  ? 'يحتوي المشروع على الكود المصدري الكامل لـ 3 تطبيقات موبايل بـ Flutter داخل مجلد /mobile (تطبيق العميل otlobha_customer، تطبيق الطيارين otlobha_captain، وتطبيق التجار otlobha_merchant) بالإضافة إلى بناء سحابي تلقائي عبر GitHub Actions:'
                  : 'Full native Flutter source code is included under /mobile for Customer, Captain, and Merchant apps:'}
              </p>

              <div className="space-y-2 text-xs">
                <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-teal-300">
                      {isAr ? 'أ) البناء السحابي المجاني بدون تثبيت Flutter (GitHub Actions):' : 'A) Cloud Build via GitHub Actions:'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isAr
                      ? 'ارفع المشروع إلى حسابك في GitHub ثم افتح تبويب Actions وشغّل Build Otlobha Android & iOS Apps لتحصل فورًا على ملفات APK الجاهزة:'
                      : 'Push repository to GitHub and run the Actions workflow to download:'}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1 font-mono-num text-[11px]">
                    <span className="px-2 py-1 rounded bg-slate-950 text-orange-300 border border-slate-700">
                      otlobha-customer-apk (app-release.apk)
                    </span>
                    <span className="px-2 py-1 rounded bg-slate-950 text-teal-300 border border-slate-700">
                      otlobha-captain-apk (app-release.apk)
                    </span>
                    <span className="px-2 py-1 rounded bg-slate-950 text-rose-300 border border-slate-700">
                      otlobha-merchant-apk (app-release.apk)
                    </span>
                  </div>
                </div>

                <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-orange-300">
                      {isAr ? 'ب) أمر بناء الـ APK مباشرة على جهازك:' : 'B) Local Terminal Build Command:'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          `chmod +x mobile/build_both_apps.sh && ./mobile/build_both_apps.sh ${origin}`,
                          'cmd',
                          isAr ? 'أمر بناء الـ APK' : 'Build command'
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[10px] font-bold"
                    >
                      {copiedKey === 'cmd' ? <Check className="w-3 h-3 text-teal-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'cmd' ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'نسخ الأمر' : 'Copy Command')}</span>
                    </button>
                  </div>
                  <pre
                    dir="ltr"
                    className="p-2.5 rounded-lg bg-slate-950 text-slate-200 font-mono-num text-[11px] overflow-x-auto"
                  >
                    {`chmod +x mobile/build_both_apps.sh\n./mobile/build_both_apps.sh ${origin}`}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowHubModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ lang: Language }> = ({ lang }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 start-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>
        {lang === 'ar'
          ? 'وضع عدم الاتصال — يتم استخدام البيانات المخزنة مؤقتًا'
          : 'Offline Mode — Using cached data'}
      </span>
    </div>
  );
};
