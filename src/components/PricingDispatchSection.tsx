import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { DispatchConfig, FinancialModelInput, Language, PricingRule, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  zones: ServiceZone[];
  onNotify: (msg: string) => void;
}

export const PricingDispatchSection: React.FC<Props> = ({ lang, zones, onNotify }) => {
  const isAr = lang === 'ar';
  const [subTab, setSubTab] = useState<'pricing' | 'dispatch' | 'simulator' | 'financial'>('pricing');
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [selectedRule, setSelectedRule] = useState<PricingRule | null>(null);
  const [dispatchCfg, setDispatchCfg] = useState<DispatchConfig | null>(null);

  // Simulator state
  const [simInput, setSimInput] = useState({
    service_type: 'stores',
    vehicle_type: 'moto',
    zone_id: zones[0]?.id || 'zn_city_center',
    distance_km: 4.5,
    waiting_minutes: 0,
    is_express: false,
    basket_or_item_amount: 200,
    apply_peak_override: 1.0,
  });
  const [simResult, setSimResult] = useState<any>(null);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  // Financial Model state
  const [finInput, setFinInput] = useState<FinancialModelInput | null>(null);
  const [finOutput, setFinOutput] = useState<any>(null);

  const loadAll = async () => {
    const [r, d, fm] = await Promise.all([api.getPricing(), api.getDispatchConfig(), api.getFinancialModel()]);
    setRules(r);
    if (!selectedRule && r.length > 0) setSelectedRule(r[0]);
    setDispatchCfg(d);
    setFinInput(fm.input);
    setFinOutput(fm.output);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRule) return;
    await api.updatePricing(selectedRule.id, { ...selectedRule, reason: 'تعديل قاعدة التسعير من لوحة التحكم' });
    await loadAll();
    onNotify(isAr ? 'تم حفظ قاعدة التسعير والعمولة بنجاح' : 'Pricing rule saved');
  };

  const handleSaveDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchCfg) return;
    try {
      await api.updateDispatchConfig(dispatchCfg as unknown as Record<string, unknown>);
      await loadAll();
      onNotify(isAr ? 'تم حفظ أوزان وإعدادات التوزيع بنجاح' : 'Dispatch config saved');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleRunSimulation = async () => {
    const priceRes = await api.simulatePrice(simInput);
    setSimResult(priceRes);
    if (simInput.service_type !== 'market') {
      const dispRes = await api.testDispatch({
        service_type: simInput.service_type,
        required_vehicle: simInput.service_type === 'rides' ? simInput.vehicle_type : undefined,
        pickup_lat: 31.1583,
        pickup_lng: 31.9369,
      });
      setDispatchResult(dispRes);
    } else {
      setDispatchResult(null);
    }
  };

  const handleSaveFinancialModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finInput) return;
    const res = await api.updateFinancialModel(finInput as unknown as Record<string, unknown>);
    setFinInput(res.input);
    setFinOutput(res.output);
    onNotify(isAr ? 'تم تحديث وحفظ حسابات النموذج المالي للسيناريوهات الثلاثة' : 'Financial model recalculated & saved');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {[
          { id: 'pricing', label: isAr ? 'أسعار التوصيل والرحلات والعمولات' : 'Pricing & Commissions' },
          { id: 'dispatch', label: isAr ? 'خوارزمية التوزيع وسقف الكاش' : 'Dispatch Weights & Cash Cap' },
          { id: 'simulator', label: isAr ? 'مختبر حساب الطلب والتوزيع' : 'Live Price & Dispatch Tester' },
          { id: 'financial', label: isAr ? 'النموذج المالي (3 سيناريوهات)' : '3-Scenario Financial Model' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id as typeof subTab)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'pricing' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              {isAr ? 'اختر القاعدة للتعديل' : 'Select Pricing Rule'}
            </h3>
            <div className="divide-y divide-slate-100">
              {rules.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRule({ ...r })}
                  className={`w-full text-start py-3 px-3 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                    selectedRule?.id === r.id ? 'bg-orange-50 text-orange-900' : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold">{isAr ? r.title_ar : r.title_en}</p>
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      {isAr
                        ? `عمولة: ${r.commission_rate}% · أساسي: ${r.base_fee} ج.م · كم: ${r.per_km_rate} ج.م`
                        : `Comm: ${r.commission_rate}% · Base: ${r.base_fee} EGP · Km: ${r.per_km_rate}`}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">{r.vehicle_type}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
            {selectedRule ? (
              <form onSubmit={handleSaveRule} className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{isAr ? selectedRule.title_ar : selectedRule.title_en}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{selectedRule.rule_code}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRule.is_active}
                      onChange={(e) => setSelectedRule({ ...selectedRule, is_active: e.target.checked })}
                      className="rounded border-slate-300"
                    />
                    {isAr ? 'قاعدة مفعّلة' : 'Active Rule'}
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    ['base_fee', isAr ? 'الرسوم الأساسية / الفتح (ج.م)' : 'Base Fee (EGP)'],
                    ['base_distance_km', isAr ? 'مسافة السماح الأساسية (كم)' : 'Base Distance (km)'],
                    ['per_km_rate', isAr ? 'سعر الكيلومتر الإضافي (ج.م)' : 'Per Km Rate (EGP)'],
                    ['min_fare', isAr ? 'الحد الأدنى للرسوم/الرحلة' : 'Minimum Fare (EGP)'],
                    ['express_fee', isAr ? 'رسوم الطلب العاجل Express' : 'Express Fee (EGP)'],
                    ['peak_multiplier', isAr ? 'معامل وقت الذروة (مثل 1.2)' : 'Peak Multiplier'],
                    ['per_min_waiting_rate', isAr ? 'رسوم دقيقة الانتظار' : 'Waiting / Min (EGP)'],
                    ['waiting_grace_min', isAr ? 'دقائق سماح الانتظار' : 'Waiting Grace (min)'],
                    ['cancellation_fee', isAr ? 'رسوم الإلغاء (ج.م)' : 'Cancellation Fee (EGP)'],
                    ['commission_rate', isAr ? 'نسبة عمولة المنصة (%)' : 'Platform Commission (%)'],
                    ['captain_delivery_share_pct', isAr ? 'حصة الكابتن من التوصيل (%)' : 'Captain Delivery Share (%)'],
                    ['min_commission', isAr ? 'الحد الأدنى للعمولة (ج.م)' : 'Min Commission (EGP)'],
                    ['max_commission', isAr ? 'الحد الأقصى للعمولة (ج.م)' : 'Max Commission (EGP)'],
                  ].map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                      <input
                        type="number"
                        step="0.05"
                        value={Number((selectedRule as unknown as Record<string, unknown>)[field] ?? 0)}
                        onChange={(e) => setSelectedRule({ ...selectedRule, [field]: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm tabular-nums"
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg whitespace-nowrap"
                  >
                    {isAr ? 'حفظ تعديلات التسعير' : 'Save Pricing Changes'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-slate-500">{isAr ? 'اختر قاعدة للتعديل' : 'Select a rule'}</p>
            )}
          </div>
        </div>
      )}

      {subTab === 'dispatch' && dispatchCfg && (
        <form onSubmit={handleSaveDispatch} className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'إعدادات خوارزمية توزيع الطلبات وسقف الكاش' : 'Smart Dispatch Algorithm & Cash Cap'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {isAr
                ? 'اضبط أوزان اختيار الكابتن (يجب أن يكون مجموع الأوزان الأربعة = 1.00)، ومهلة القبول بالثواني، ونطاق البحث بالكيلومتر، والسقف النقدي الافتراضي.'
                : 'Adjust captain scoring weights (sum must equal 1.00), response timeout, search radii, and default cash limit.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['weight_proximity', isAr ? 'وزن القرب الجغرافي (0..1)' : 'Proximity Weight'],
              ['weight_acceptance', isAr ? 'وزن نسبة القبول (0..1)' : 'Acceptance Weight'],
              ['weight_rating', isAr ? 'وزن تقييم العملاء (0..1)' : 'Rating Weight'],
              ['weight_idle_time', isAr ? 'وزن عدالة الانتظار (0..1)' : 'Idle Fairness Weight'],
              ['offer_timeout_sec', isAr ? 'مهلة رد الكابتن (ثانية)' : 'Offer Timeout (sec)'],
              ['initial_radius_km', isAr ? 'نطاق البحث المبدئي (كم)' : 'Initial Radius (km)'],
              ['expanded_radius_km', isAr ? 'نطاق التوسيع للقرى (كم)' : 'Expanded Radius (km)'],
              ['max_radius_km', isAr ? 'أقصى نطاق بحث (كم)' : 'Max Radius (km)'],
              ['max_rejections_before_alert', isAr ? 'تنبيه المشرف بعد رفض (مرة)' : 'Alert After Rejections'],
              ['default_cash_limit', isAr ? 'السقف النقدي للكابتن (ج.م)' : 'Default Cash Cap (EGP)'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input
                  type="number"
                  step="0.05"
                  value={Number((dispatchCfg as unknown as Record<string, unknown>)[field] ?? 0)}
                  onChange={(e) => setDispatchCfg({ ...dispatchCfg, [field]: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <span className="text-xs text-slate-600 tabular-nums">
              {isAr ? 'مجموع الأوزان الحالي:' : 'Current Weights Sum:'}{' '}
              <strong className="text-slate-900">
                {(
                  Number(dispatchCfg.weight_proximity) +
                  Number(dispatchCfg.weight_acceptance) +
                  Number(dispatchCfg.weight_rating) +
                  Number(dispatchCfg.weight_idle_time)
                ).toFixed(2)}
              </strong>
            </span>
            <button
              type="submit"
              className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg whitespace-nowrap"
            >
              {isAr ? 'حفظ إعدادات التوزيع' : 'Save Dispatch Config'}
            </button>
          </div>
        </form>
      )}

      {subTab === 'simulator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'اختبار التسعير الفعلي وتوزيع الكابتن' : 'Simulate Price & Dispatch'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'الخدمة' : 'Service'}</label>
                <select
                  value={simInput.service_type}
                  onChange={(e) => setSimInput({ ...simInput, service_type: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  <option value="stores">{isAr ? 'طلب متجر / مطعم' : 'Store / Restaurant'}</option>
                  <option value="pharmacy">{isAr ? 'اطلبها فارما (صيدلية)' : 'Pharmacy'}</option>
                  <option value="parcels">{isAr ? 'اطلبها أي حاجة (طرد)' : 'Parcel (Anything)'}</option>
                  <option value="rides">{isAr ? 'اطلبها مشوار (رحلة)' : 'Ride'}</option>
                  <option value="market">{isAr ? 'السوق (بيع بين الأفراد)' : 'Market C2C'}</option>
                </select>
              </div>
              {simInput.service_type === 'rides' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'نوع المركبة' : 'Vehicle'}</label>
                  <select
                    value={simInput.vehicle_type}
                    onChange={(e) => setSimInput({ ...simInput, vehicle_type: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    <option value="moto">Moto – موتوسيكل</option>
                    <option value="tuktuk">TukTuk – توكتوك مرخص</option>
                    <option value="car">Car – سيارة</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'المنطقة / القرية' : 'Zone'}</label>
                <select
                  value={simInput.zone_id}
                  onChange={(e) => setSimInput({ ...simInput, zone_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name_ar} (+{z.remote_area_fee} ج.م)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isAr ? 'المسافة (كم)' : 'Distance (km)'}</label>
                  <input
                    type="number"
                    step="0.5"
                    value={simInput.distance_km}
                    onChange={(e) => setSimInput({ ...simInput, distance_km: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {isAr ? 'قيمة الطلب / السلعة (ج.م)' : 'Basket / Item Value'}
                  </label>
                  <input
                    type="number"
                    value={simInput.basket_or_item_amount}
                    onChange={(e) => setSimInput({ ...simInput, basket_or_item_amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simInput.is_express}
                  onChange={(e) => setSimInput({ ...simInput, is_express: e.target.checked })}
                />
                {isAr ? 'طلب عاجل (Express)' : 'Express Delivery'}
              </label>
              <button
                type="button"
                onClick={handleRunSimulation}
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg"
              >
                {isAr ? 'احسب التكلفة واختبر التوزيع الآن' : 'Calculate & Test Dispatch'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {simResult ? (
              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <h4 className="text-sm font-bold text-slate-900">
                  {isAr ? 'نتيجة التسعير التفصيلية' : 'Pricing Breakdown'} — {simResult.rule_used}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-500">{isAr ? 'يدفع العميل' : 'Customer Pays'}</p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{simResult.customer_total} ج.م</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-500">{isAr ? 'رسوم التوصيل/الرحلة' : 'Delivery / Fare'}</p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{simResult.delivery_or_fare_fee} ج.م</p>
                  </div>
                  <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                    <p className="text-xs text-teal-700">{isAr ? 'صافي ربح المنصة' : 'Platform Revenue'}</p>
                    <p className="text-lg font-bold text-teal-800 tabular-nums mt-1">{simResult.platform_commission} ج.م</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-500">{isAr ? 'صافي الكابتن' : 'Captain Payout'}</p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{simResult.captain_payout} ج.م</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
                {isAr
                  ? 'اضغط على «احسب التكلفة واختبر التوزيع الآن» لمشاهدة توزيع الجنيهات على العميل والتاجر والكابتن والمنصة حسب قواعدك الحالية.'
                  : 'Run a simulation to inspect exact pricing & dispatch ranking.'}
              </div>
            )}

            {dispatchResult && (
              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <h4 className="text-sm font-bold text-slate-900">
                  {isAr ? 'نتيجة خوارزمية التوزيع الذكي (من الكباتن الفعليين)' : 'Live Smart Dispatch Ranking'}
                </h4>
                {dispatchResult.winner ? (
                  <p className="text-xs text-teal-700 font-medium">
                    {isAr
                      ? `المرشح الأول لاستقبال الطلب: ${dispatchResult.winner.full_name} (${dispatchResult.winner.vehicle_type} · ${dispatchResult.winner.plate_number}) — درجة الأولوية: ${dispatchResult.winner.score}/100`
                      : `Top Dispatch Candidate: ${dispatchResult.winner.full_name} — Score: ${dispatchResult.winner.score}/100`}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 font-medium">
                    {isAr ? 'لا يوجد كابتن متاح ومؤهل لهذه الخدمة حاليًا.' : 'No eligible captain available right now.'}
                  </p>
                )}
                {dispatchResult.candidates.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 text-start">{isAr ? 'الكابتن' : 'Captain'}</th>
                        <th className="py-2 text-start">{isAr ? 'المسافة' : 'Dist'}</th>
                        <th className="py-2 text-start">{isAr ? 'القبول' : 'Accept'}</th>
                        <th className="py-2 text-start">{isAr ? 'الكاش بيده' : 'Cash'}</th>
                        <th className="py-2 text-end">{isAr ? 'الدرجة' : 'Score'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dispatchResult.candidates.map((c: any) => (
                        <tr key={c.captain_id}>
                          <td className="py-2 font-medium text-slate-800">{c.full_name}</td>
                          <td className="py-2 tabular-nums">{c.distance_km} كم</td>
                          <td className="py-2 tabular-nums">{c.acceptance_rate}%</td>
                          <td className="py-2 tabular-nums">
                            {c.cash_on_hand}/{c.cash_limit}
                          </td>
                          <td className="py-2 text-end font-bold text-orange-600 tabular-nums">{c.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {dispatchResult.excluded.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                    <p className="font-medium text-slate-700">{isAr ? 'كباتن مستبعدون تلقائيًا:' : 'Auto-excluded captains:'}</p>
                    {dispatchResult.excluded.map((ex: any, i: number) => (
                      <p key={i}>
                        {ex.captain_name} · {ex.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'financial' && finInput && finOutput && (
        <div className="space-y-6">
          <form onSubmit={handleSaveFinancialModel} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'مُخطّط النموذج المالي (تعديل افتراضات المنزلة وحساب التعادل)' : 'Interactive 3-Scenario Financial Model'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAr ? 'عدل حجم العمليات والعمولات والتكاليف الثابتة لمعاينة الأثر المالي الفوري.' : 'Adjust order volume, rates, and fixed costs.'}
                </p>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded-lg whitespace-nowrap"
              >
                {isAr ? 'إعادة الحساب والحفظ' : 'Recalculate & Save'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                ['monthly_orders_conservative', isAr ? 'عمليات/شهر (متحفظ)' : 'Conservative Orders'],
                ['monthly_orders_moderate', isAr ? 'عمليات/شهر (متوسط)' : 'Moderate Orders'],
                ['monthly_orders_optimistic', isAr ? 'عمليات/شهر (متفائل)' : 'Optimistic Orders'],
                ['store_commission_pct', isAr ? 'عمولة المتاجر (%)' : 'Store Comm %'],
                ['parcel_commission_pct', isAr ? 'عمولة الطرود (%)' : 'Parcel Comm %'],
                ['ride_commission_pct', isAr ? 'عمولة المشاوير (%)' : 'Ride Comm %'],
                ['market_commission_pct', isAr ? 'عمولة السوق (%)' : 'Market Comm %'],
                ['variable_cost_per_tx', isAr ? 'تكلفة متغيرة/عملية' : 'Variable Cost/Tx'],
                ['fixed_cost_conservative', isAr ? 'تكلفة ثابتة (متحفظ)' : 'Fixed Cost (Cons.)'],
                ['fixed_cost_moderate', isAr ? 'تكلفة ثابتة (متوسط)' : 'Fixed Cost (Mod.)'],
                ['fixed_cost_optimistic', isAr ? 'تكلفة ثابتة (متفائل)' : 'Fixed Cost (Opt.)'],
                ['avg_store_basket', isAr ? 'متوسط سلة المتجر' : 'Avg Basket (EGP)'],
              ].map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    type="number"
                    value={Number((finInput as unknown as Record<string, unknown>)[k] ?? 0)}
                    onChange={(e) => setFinInput({ ...finInput, [k]: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs tabular-nums"
                  />
                </div>
              ))}
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600 mb-4 pb-3 border-b border-slate-100 tabular-nums">
              <span>
                {isAr ? 'متوسط GMV للعملية:' : 'Blended GMV/Tx:'} <strong className="text-slate-900">{finOutput.unit_economics.blended_gmv} ج.م</strong>
              </span>
              <span>
                {isAr ? 'إيراد المنصة/عملية:' : 'Revenue/Tx:'}{' '}
                <strong className="text-slate-900">{finOutput.unit_economics.blended_platform_revenue} ج.م</strong>
              </span>
              <span>
                {isAr ? 'هامش المساهمة/عملية:' : 'Contribution Margin/Tx:'}{' '}
                <strong className="text-teal-700">{finOutput.unit_economics.contribution_margin_per_tx} ج.م</strong>
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 text-start">{isAr ? 'البند المالي الشهري' : 'Monthly Metric'}</th>
                  <th className="py-2.5 text-end">{isAr ? 'المتحفظ' : 'Conservative'}</th>
                  <th className="py-2.5 text-end">{isAr ? 'المتوسط' : 'Moderate'}</th>
                  <th className="py-2.5 text-end">{isAr ? 'المتفائل' : 'Optimistic'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {[
                  ['orders', isAr ? 'عدد العمليات الشهرية' : 'Monthly Transactions'],
                  ['gmv', isAr ? 'إجمالي المبيعات (GMV)' : 'Total GMV (EGP)'],
                  ['merchant_payables', isAr ? 'مستحقات التجار والبائعين' : 'Merchant Payables'],
                  ['captain_payables', isAr ? 'مستحقات الكباتن' : 'Captain Payables'],
                  ['platform_revenue', isAr ? 'إيرادات المنصة الإجمالية' : 'Platform Revenue'],
                  ['variable_costs', isAr ? 'التكاليف المتغيرة' : 'Variable Costs'],
                  ['contribution_margin', isAr ? 'إجمالي هامش المساهمة' : 'Contribution Margin'],
                  ['fixed_costs', isAr ? 'التكاليف الثابتة' : 'Fixed Costs'],
                  ['break_even_orders', isAr ? 'نقطة التعادل (عدد العمليات)' : 'Break-Even Orders'],
                  ['net_profit', isAr ? 'صافي الربح التشغيلي (ج.م)' : 'Net Operating Profit'],
                ].map(([field, label]) => (
                  <tr key={field} className={field === 'net_profit' ? 'font-bold bg-slate-50' : ''}>
                    <td className="py-2.5 text-slate-800">{label}</td>
                    {finOutput.scenarios.map((sc: any) => (
                      <td
                        key={sc.scenario}
                        className={`py-2.5 text-end ${
                          field === 'net_profit' ? (sc[field] >= 0 ? 'text-teal-700' : 'text-red-600') : 'text-slate-900'
                        }`}
                      >
                        {Number(sc[field]).toLocaleString('en-US')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
