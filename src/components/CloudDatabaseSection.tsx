import React from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Database,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
  Package,
  ShoppingBag,
  Layers,
} from 'lucide-react';
import type { CloudSyncProgress, CloudVaultMeta, ServerSyncStatus } from '../lib/cloudVaultSync.ts';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from '../lib/firebase.ts';

interface Props {
  firebaseUser: User | null;
  authReady: boolean;
  serverStatus: ServerSyncStatus | null;
  cloudMeta: CloudVaultMeta | null;
  progress: CloudSyncProgress;
  autoSyncEnabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  onSignInGoogle: () => Promise<void>;
  onSignOutGoogle: () => Promise<void>;
  onPushNow: () => Promise<void>;
  onRestoreNow: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

export function CloudDatabaseSection({
  firebaseUser,
  authReady,
  serverStatus,
  cloudMeta,
  progress,
  autoSyncEnabled,
  onToggleAutoSync,
  onSignInGoogle,
  onSignOutGoogle,
  onPushNow,
  onRestoreNow,
  onRefreshStatus,
}: Props) {
  const busy = progress.phase === 'pushing' || progress.phase === 'restoring' || progress.phase === 'checking';
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0;

  const cards = [
    {
      key: 'customers',
      label: 'حسابات العملاء',
      icon: Users,
      local: serverStatus?.counts.customers ?? 0,
      cloud: cloudMeta?.customersCount ?? 0,
      tone: 'text-blue-700 bg-blue-50 border-blue-200',
    },
    {
      key: 'orders',
      label: 'الطلبات والمشاوير والطرود',
      icon: ShoppingBag,
      local: (serverStatus?.counts.orders ?? 0) + (serverStatus?.counts.trips ?? 0) + (serverStatus?.counts.deliveries ?? 0),
      cloud: (cloudMeta?.ordersCount ?? 0) + (cloudMeta?.tripsCount ?? 0) + (cloudMeta?.deliveriesCount ?? 0),
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      key: 'captains',
      label: 'حسابات الطيارين',
      icon: Truck,
      local: serverStatus?.counts.captains ?? 0,
      cloud: cloudMeta?.captainsCount ?? 0,
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      key: 'merchants',
      label: 'حسابات التجار والمتاجر',
      icon: Store,
      local: serverStatus?.counts.merchants ?? 0,
      cloud: cloudMeta?.merchantsCount ?? 0,
      tone: 'text-orange-700 bg-orange-50 border-orange-200',
    },
    {
      key: 'wallets',
      label: 'المحافظ والأرصدة',
      icon: Wallet,
      local: serverStatus?.counts.wallets ?? 0,
      cloud: cloudMeta?.walletsCount ?? 0,
      tone: 'text-purple-700 bg-purple-50 border-purple-200',
    },
    {
      key: 'categories',
      label: 'الأقسام والتصنيفات',
      icon: Layers,
      local: serverStatus?.counts.categories ?? 0,
      cloud: cloudMeta?.categoriesCount ?? 0,
      tone: 'text-cyan-700 bg-cyan-50 border-cyan-200',
    },
    {
      key: 'products',
      label: 'المنتجات والأصناف',
      icon: Package,
      local: serverStatus?.counts.products ?? 0,
      cloud: cloudMeta?.productsCount ?? 0,
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
    },
    {
      key: 'ledger',
      label: 'القيود المالية والتسويات',
      icon: Database,
      local: (serverStatus?.counts.ledger_entries ?? 0) + (serverStatus?.counts.settlements ?? 0),
      cloud: (cloudMeta?.ledgerEntriesCount ?? 0) + (cloudMeta?.settlementsCount ?? 0),
      tone: 'text-slate-700 bg-slate-100 border-slate-200',
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">
                النسخ الاحتياطي السحابي الخارجي والاستعادة (Firebase Firestore)
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                أداة نسخ احتياطي يدوي مخصصة لأخذ نسخة احتياطية قبل التحديثات الكبرى أو استعادتها عند الحاجة فقط. يتم تنظيف السجلات المحذوفة تلقائيًا عند كل عملية نسخ احتياطي لضمان عدم عودتها.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <ShieldCheck className="w-4 h-4" />
                  مشروع Firebase: <code className="font-mono">{FIREBASE_PROJECT_ID}</code>
                </span>
                <span className="text-slate-500">
                  قاعدة البيانات: <code className="font-mono">{FIRESTORE_DATABASE_ID}</code>
                </span>
                <a
                  href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-blue-700 hover:underline"
                >
                  فتح قاعدة البيانات في Firebase Console ↗
                </a>
                {cloudMeta?.updatedAt && (
                  <span>
                    آخر نسخة محفوظة بالسحابة: {cloudMeta.updatedAt.toLocaleString('ar-EG')} (إصدار #{cloudMeta.version})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!authReady ? (
              <span className="text-xs text-slate-500 font-semibold">جاري التحقق من الاتصال السحابي...</span>
            ) : !firebaseUser ? (
              <button
                type="button"
                onClick={() => void onSignInGoogle()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold shadow-sm transition"
              >
                <Cloud className="w-4 h-4" />
                ربط حساب Google للنسخ الاحتياطي اليدوي
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{firebaseUser.email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void onSignOutGoogle()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  فصل الربط
                </button>
              </>
            )}
          </div>
        </div>

        {firebaseUser && (
          <div className="mt-5 pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold text-slate-600">
              النسخ الاحتياطي والاستعادة يعملان بشكل يدوي فقط عند الطلب، ولا يعملان تلقائيًا في الخلفية.
            </p>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRefreshStatus()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                تحديث الإحصائيات
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPushNow()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-extrabold"
              >
                <CloudUpload className="w-4 h-4" />
                أخذ نسخة احتياطية الآن
              </button>
              <button
                type="button"
                disabled={busy || !cloudMeta}
                onClick={() => void onRestoreNow()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-extrabold"
              >
                <CloudDownload className="w-4 h-4" />
                استعادة من النسخة الاحتياطية الآن
              </button>
            </div>
          </div>
        )}

        {progress.phase !== 'idle' && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>{progress.message}</span>
              {busy && <span>{pct}%</span>}
            </div>
            {busy && (
              <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${Math.max(6, pct)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {!firebaseUser && authReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <CloudOff className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 space-y-1">
            <p className="font-extrabold">نسخة احتياطية خارجية اختيارية عند التحديثات:</p>
            <p className="text-xs leading-relaxed">
              يمكنك ربط حساب Google المعتمد (<code>anas2002abdo@gmail.com</code>) لأخذ نسخة احتياطية يدوية إلى Firestore قبل أي تحديث كبير أو استعادتها عند الحاجة.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const synced = firebaseUser ? card.local === card.cloud && card.cloud > 0 : false;
          return (
            <div key={card.key} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${card.tone}`}>
                  <Icon className="w-5 h-5" />
                </div>
                {synced && (
                  <span className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    متطابق
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500">{card.label}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                  <div>
                    <span className="block text-[10px] text-slate-400">على السيرفر الآن</span>
                    <span className="text-lg font-extrabold text-slate-900">{card.local.toLocaleString('ar-EG')}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-emerald-600">محفوظ بالسحابة</span>
                    <span className="text-lg font-extrabold text-emerald-700">
                      {firebaseUser ? card.cloud.toLocaleString('ar-EG') : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
