import React, { useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, Printer, RotateCcw, Save } from 'lucide-react';
import { api } from '../lib/api.ts';
import { DEFAULT_INVOICE_DESIGN, printInvoiceViaHiddenIframe } from '../lib/bluetoothPrinter.ts';
import type { InvoiceDesignConfig, Language } from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify: (msg: string) => void;
}

const ACCENT_PRESETS = [
  { label: 'أحمر اطلبها', color: '#A92224' },
  { label: 'كحلي داكن', color: '#0F172A' },
  { label: 'أخضر زمردي', color: '#0D9488' },
  { label: 'برتقالي', color: '#EA580C' },
  { label: 'أزرق ملكي', color: '#1D4ED8' },
];

export const InvoiceDesignSection: React.FC<Props> = ({ lang, onNotify }) => {
  const isAr = lang === 'ar';
  const [design, setDesign] = useState<InvoiceDesignConfig>(DEFAULT_INVOICE_DESIGN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getInvoiceDesign()
      .then((cfg) => {
        if (cfg) setDesign({ ...DEFAULT_INVOICE_DESIGN, ...cfg });
      })
      .catch((err) => onNotify((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxDim = 320;
        const scale = Math.max(img.width, img.height) > maxDim ? maxDim / Math.max(img.width, img.height) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(40, Math.round(img.width * scale));
        canvas.height = Math.max(40, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setDesign((prev) => ({ ...prev, logo_url: canvas.toDataURL('image/png') }));
        } else {
          setDesign((prev) => ({ ...prev, logo_url: raw }));
        }
      };
      img.onerror = () => setDesign((prev) => ({ ...prev, logo_url: raw }));
      img.src = raw;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.updateInvoiceDesign(design as unknown as Record<string, unknown>);
      if (res.config) setDesign(res.config as InvoiceDesignConfig);
      onNotify(isAr ? 'تم حفظ تصميم فاتورة العميل وتطبيقه على تطبيق الطيار والطابعات الحرارية ✓' : 'Invoice design saved');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDesign(DEFAULT_INVOICE_DESIGN);
    onNotify(isAr ? 'تمت استعادة الإعدادات الافتراضية — اضغط حفظ لتثبيتها' : 'Restored defaults');
  };

  const handleTestPrint = () => {
    printInvoiceViaHiddenIframe(
      {
        invoice_number: 'INV-1042',
        created_at: new Date().toISOString(),
        captain_name: 'محمود السيد عبده',
        captain_phone: '01011223344',
        customer_name: 'أحمد عوض',
        customer_phone: '01022334455',
        order_number: 'OTL-1003',
        items: [
          {
            product_code: 'OTL-1003',
            name_ar: 'قيمة مشتريات طلب #OTL-1003 (أسماك بحيرة المنزلة)',
            qty: 1,
            unit_price: 245,
            line_total: 245,
          },
        ],
        subtotal: 245,
        delivery_fee: 15,
        discount_amount: 0,
        total_amount: 260,
        payment_method: 'cash',
      },
      design,
      design.default_paper_width
    );
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
        {isAr ? 'جاري تحميل إعدادات تصميم فاتورة العميل...' : 'Loading invoice design...'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Controls Form */}
      <form onSubmit={handleSave} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isAr ? 'التحكم في تصميم فاتورة العميل (للطيار والطابعات الحرارية)' : 'Customer Invoice Designer'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAr
                ? 'خصص الشعار والعنوان والبيانات الظاهرة وألوان الفاتورة التي يطبعها الطيار للعميل عند التسليم أو المشوار.'
                : 'Customize header, logo, visibility toggles, colors, and footer of thermal customer receipts.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>استعادة الافتراضي</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">العنوان الرئيسي أعلى الفاتورة</label>
            <input
              type="text"
              required
              value={design.header_title}
              onChange={(e) => setDesign({ ...design, header_title: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">العنوان الفرعي / الوصف</label>
            <input
              type="text"
              value={design.header_subtitle}
              onChange={(e) => setDesign({ ...design, header_subtitle: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">رقم خدمة العملاء / الشكاوى</label>
            <input
              type="text"
              dir="ltr"
              value={design.support_phone}
              onChange={(e) => setDesign({ ...design, support_phone: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono-num"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">مقاس الورق الافتراضي وحجم الخط</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={design.default_paper_width}
                onChange={(e) => setDesign({ ...design, default_paper_width: e.target.value as '58mm' | '80mm' })}
                className="px-2.5 py-2 border border-slate-200 rounded-lg bg-white text-xs font-semibold"
              >
                <option value="58mm">حراري 58mm</option>
                <option value="80mm">حراري 80mm</option>
              </select>
              <select
                value={design.font_scale}
                onChange={(e) => setDesign({ ...design, font_scale: e.target.value as 'compact' | 'normal' | 'large' })}
                className="px-2.5 py-2 border border-slate-200 rounded-lg bg-white text-xs font-semibold"
              >
                <option value="compact">خط مضغوط</option>
                <option value="normal">خط قياسي</option>
                <option value="large">خط كبير</option>
              </select>
            </div>
          </div>
        </div>

        {/* Logo Control */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800">شعار المشروع على الفاتورة</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={design.show_logo}
                onChange={(e) => setDesign({ ...design, show_logo: e.target.checked })}
              />
              <span>إظهار الشعار في الفاتورة</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {design.logo_url && (
              <img
                src={design.logo_url}
                alt="شعار الفاتورة"
                className="w-14 h-14 rounded-lg object-contain bg-white border border-slate-200 p-1 shrink-0"
              />
            )}
            <div className="flex-1 min-w-[200px] space-y-2">
              <input
                type="text"
                dir="ltr"
                value={design.logo_url}
                onChange={(e) => setDesign({ ...design, logo_url: e.target.value })}
                placeholder="/assets/aistudio/..."
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono-num text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer font-semibold">
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>رفع شعار مخصص</span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => setDesign({ ...design, logo_url: DEFAULT_INVOICE_DESIGN.logo_url })}
                  className="px-2.5 py-1.5 border border-slate-200 bg-white rounded-lg hover:bg-slate-100"
                >
                  استخدام شعار اطلبها الرسمي
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Accent Color & Toggles */}
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-700 me-1">لون تمييز الفاتورة:</span>
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.color}
                type="button"
                onClick={() => setDesign({ ...design, accent_color: p.color })}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold ${
                  design.accent_color === p.color ? 'border-slate-900 bg-slate-100' : 'border-slate-200 bg-white'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full border border-black/15" style={{ backgroundColor: p.color }} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {[
              { key: 'show_support_phone' as const, label: 'إظهار رقم خدمة العملاء أعلى الفاتورة' },
              { key: 'show_captain_info' as const, label: 'إظهار اسم وهاتف الطيار في الفاتورة' },
              { key: 'show_item_codes' as const, label: 'إظهار مرجع/كود الطلب والأصناف' },
              { key: 'show_qr_badge' as const, label: 'إظهار ختم التحقق التسلسلي (OTLOBHA VERIFIED)' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={design[item.key]}
                  onChange={(e) => setDesign({ ...design, [item.key]: e.target.checked })}
                />
                <span className="font-medium text-slate-800">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">رسالة ختام الفاتورة</label>
            <input
              type="text"
              value={design.footer_message}
              onChange={(e) => setDesign({ ...design, footer_message: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">ملاحظة أسفل التذييل</label>
            <input
              type="text"
              value={design.footer_note}
              onChange={(e) => setDesign({ ...design, footer_note: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-xs font-bold"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'جاري الحفظ...' : 'حفظ تصميم الفاتورة وتفعيله'}</span>
          </button>
          <button
            type="button"
            onClick={handleTestPrint}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-bold"
          >
            <Printer className="w-4 h-4" />
            <span>معاينة الطباعة الحرارية</span>
          </button>
        </div>
      </form>

      {/* Live Thermal Receipt Preview */}
      <div className="lg:col-span-5">
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-5 flex flex-col items-center space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <CheckCircle2 className="w-4 h-4 text-teal-600" />
            <span>معاينة حية لفاتورة العميل ({design.default_paper_width})</span>
          </div>

          <div
            className={`bg-white border-2 border-slate-300 rounded-2xl p-5 shadow-sm space-y-3 w-full ${
              design.default_paper_width === '58mm' ? 'max-w-[300px]' : 'max-w-[380px]'
            } ${
              design.font_scale === 'compact' ? 'text-[11px]' : design.font_scale === 'large' ? 'text-[13px]' : 'text-xs'
            }`}
          >
            <div className="text-center space-y-1 pb-3 border-b-2" style={{ borderColor: design.accent_color }}>
              {design.show_logo && design.logo_url && (
                <img
                  src={design.logo_url}
                  alt="Logo"
                  className="w-14 h-14 mx-auto rounded-lg object-contain border border-slate-200 p-0.5"
                />
              )}
              <h4 className="font-extrabold text-sm" style={{ color: design.accent_color }}>
                {design.header_title}
              </h4>
              {design.header_subtitle && <p className="text-[11px] text-slate-500">{design.header_subtitle}</p>}
              {design.show_support_phone && design.support_phone && (
                <p className="text-[11px] font-mono-num text-slate-700">خدمة العملاء: {design.support_phone}</p>
              )}
            </div>

            <div className="space-y-1 pb-2.5 border-b border-dashed border-slate-300 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">رقم الفاتورة:</span>
                <strong className="font-mono-num">INV-1042</strong>
              </div>
              {design.show_captain_info && (
                <div className="flex justify-between">
                  <span className="text-slate-500">الطيار:</span>
                  <span className="font-semibold">محمود السيد عبده</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">العميل:</span>
                <span className="font-semibold">أحمد عوض</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">مرجع الطلب:</span>
                <span className="font-mono-num">OTL-1003</span>
              </div>
            </div>

            <div className="space-y-1.5 pb-2.5 border-b border-dashed border-slate-300 text-[11px]">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">توصيل طلب #OTL-1003 (أسماك المنزلة)</p>
                  {design.show_item_codes && <p className="text-[10px] font-mono-num text-slate-500">المرجع: OTL-1003 · 1 × 245 ج.م</p>}
                </div>
                <span className="font-bold tabular-nums shrink-0">245.00 ج.م</span>
              </div>
            </div>

            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>المبلغ الأساسي:</span>
                <span className="tabular-nums">245.00 ج.م</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>رسوم التوصيل:</span>
                <span className="tabular-nums">15.00 ج.م</span>
              </div>
              <div
                className="flex justify-between items-center pt-1.5 border-t border-slate-900 font-extrabold text-sm"
                style={{ color: design.accent_color }}
              >
                <span>الصافي المستحق:</span>
                <span className="tabular-nums">260.00 ج.م</span>
              </div>
            </div>

            {design.show_qr_badge && (
              <div className="border border-slate-900 rounded py-1 text-center font-mono-num text-[10px] font-bold">
                OTLOBHA VERIFIED · INV-1042
              </div>
            )}

            <div className="text-center pt-2 border-t border-dashed border-slate-300 text-[11px] space-y-0.5">
              {design.footer_message && <p className="font-semibold text-slate-800">{design.footer_message}</p>}
              {design.footer_note && <p className="text-[10px] text-slate-500">{design.footer_note}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
