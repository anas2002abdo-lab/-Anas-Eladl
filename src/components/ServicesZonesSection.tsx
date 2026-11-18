import React, { useState } from 'react';
import { api } from '../lib/api.ts';
import type { Language, ServiceConfig, ServiceZone } from '../shared/types.ts';

interface Props {
  lang: Language;
  services: ServiceConfig[];
  zones: ServiceZone[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export const ServicesZonesSection: React.FC<Props> = ({ lang, services, zones, onRefresh, onNotify }) => {
  const isAr = lang === 'ar';
  const [newZone, setNewZone] = useState({
    name_ar: '',
    zone_type: 'village',
    remote_area_fee: 12,
    radius_km: 3,
  });
  const [editingMin, setEditingMin] = useState<Record<string, number>>({});
  const [editingZoneFee, setEditingZoneFee] = useState<Record<string, number>>({});

  const handleToggleService = async (s: ServiceConfig) => {
    if (s.service_key === 'rides') {
      onNotify(isAr ? 'خدمة اطلبها مشوار مفتوحة دائمًا ولا يمكن إغلاقها' : 'Rides service stays always open');
      return;
    }
    if (!s.is_enabled && s.requires_license && !s.license_ready) {
      const confirmed = confirm(
        isAr
          ? `تنبيه قانوني: خدمة "${s.name_ar}" تتطلب استيفاء التراخيص أولًا. هل تم استيفاء الترخيص وتريد تفعيلها؟`
          : `Legal Warning: "${s.name_en}" requires regulatory licensing. Confirm license readiness and enable?`
      );
      if (!confirmed) return;
      await api.updateService(s.service_key, { is_enabled: true, license_ready: true, reason: 'تفعيل الخدمة بعد تأكيد الجاهزية' });
    } else {
      await api.updateService(s.service_key, { is_enabled: !s.is_enabled, reason: 'تغيير حالة الخدمة من لوحة التحكم' });
    }
    await onRefresh();
    onNotify(isAr ? 'تم تحديث حالة الخدمة وتسجيلها في سجل التدقيق' : 'Service status updated & audited');
  };

  const handleSaveMinOrder = async (s: ServiceConfig) => {
    const val = editingMin[s.service_key] ?? s.min_order_amount;
    await api.updateService(s.service_key, { min_order_amount: val, reason: 'تعديل الحد الأدنى للطلب' });
    await onRefresh();
    onNotify(isAr ? 'تم حفظ الحد الأدنى للطلب' : 'Minimum order updated');
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZone.name_ar.trim()) return;
    await api.createZone(newZone);
    setNewZone({ name_ar: '', zone_type: 'village', remote_area_fee: 12, radius_km: 3 });
    await onRefresh();
    onNotify(isAr ? 'تمت إضافة المنطقة الجغرافية بنجاح' : 'Operating zone created');
  };

  const handleUpdateZone = async (z: ServiceZone) => {
    const fee = editingZoneFee[z.id] ?? z.remote_area_fee;
    await api.updateZone(z.id, { remote_area_fee: fee, is_active: z.is_active });
    await onRefresh();
    onNotify(isAr ? 'تم تحديث رسوم المنطقة' : 'Zone fee updated');
  };

  const handleToggleZone = async (z: ServiceZone) => {
    await api.updateZone(z.id, { is_active: !z.is_active });
    await onRefresh();
    onNotify(isAr ? 'تم تحديث حالة المنطقة' : 'Zone availability updated');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-bold text-slate-900 mb-1">
          {isAr ? 'التحكم في خدمات التطبيق (Super Admin Feature Flags)' : 'Application Service Toggles'}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {isAr
            ? 'تحكم في إظهار أو إيقاف أي خدمة أو قسم لحظيًا دون التأثير على باقي المنظومة، مع تنبيه إلزامي للخدمات التي تتطلب تراخيص.'
            : 'Enable or pause individual services instantaneously while safeguarding regulated verticals.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2.5 text-start font-medium">{isAr ? 'الخدمة' : 'Service'}</th>
                <th className="py-2.5 text-start font-medium">{isAr ? 'الوضع القانوني' : 'Compliance'}</th>
                <th className="py-2.5 text-start font-medium">{isAr ? 'الحد الأدنى (ج.م)' : 'Min Order (EGP)'}</th>
                <th className="py-2.5 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="py-2.5 text-end font-medium">{isAr ? 'تحكم' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((s) => (
                <tr key={s.service_key} className="hover:bg-slate-50">
                  <td className="py-3 font-medium text-slate-900">{isAr ? s.name_ar : s.name_en}</td>
                  <td className="py-3 text-xs text-slate-600">
                    {s.requires_license
                      ? s.license_ready
                        ? isAr
                          ? 'مرخص / متعاقد'
                          : 'Licensed'
                        : isAr
                        ? 'موقوف لعدم استيفاء الترخيص'
                        : 'Requires License'
                      : isAr
                      ? 'لا يتطلب ترخيصًا خاصًا'
                      : 'Standard'}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={editingMin[s.service_key] ?? s.min_order_amount}
                        onChange={(e) => setEditingMin({ ...editingMin, [s.service_key]: Number(e.target.value) })}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-xs tabular-nums"
                      />
                      <button
                        onClick={() => handleSaveMinOrder(s)}
                        className="px-2.5 py-1 bg-slate-900 text-white text-xs rounded hover:bg-slate-800 whitespace-nowrap"
                      >
                        {isAr ? 'حفظ' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="py-3 text-xs font-medium">
                    <span className={s.is_enabled ? 'text-teal-700' : 'text-slate-500'}>
                      {s.is_enabled ? (isAr ? 'مفعّل' : 'Active') : isAr ? 'مخفي / متوقف' : 'Paused'}
                    </span>
                  </td>
                  <td className="py-3 text-end">
                    {s.service_key === 'rides' ? (
                      <span className="inline-block px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200 whitespace-nowrap">
                        {isAr ? 'مفتوحة دائمًا' : 'Always Open'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleToggleService(s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                          s.is_enabled
                            ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                            : 'bg-orange-600 text-white hover:bg-orange-700'
                        }`}
                      >
                        {s.is_enabled ? (isAr ? 'إيقاف مؤقت' : 'Disable') : isAr ? 'تفعيل الآن' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-bold text-slate-900 mb-1">
          {isAr ? 'المناطق الجغرافية — مركز ومدينة المنزلة والقرى' : 'Operating Zones — El Manzala & Villages'}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {isAr
            ? 'حدد رسوم المناطق البعيدة لكل قرية في المنزلة وفعّل المناطق الجديدة عند التوسع.'
            : 'Configure remote area surcharges per village and activate new zones.'}
        </p>

        <form onSubmit={handleCreateZone} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5 pb-5 border-b border-slate-200">
          <input
            type="text"
            placeholder={isAr ? 'اسم القرية أو المنطقة (مثال: قرية أولاد علم)' : 'Zone / Village Name'}
            value={newZone.name_ar}
            onChange={(e) => setNewZone({ ...newZone, name_ar: e.target.value })}
            className="md:col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          <select
            value={newZone.zone_type}
            onChange={(e) => setNewZone({ ...newZone, zone_type: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="city_core">{isAr ? 'داخل المدينة' : 'City Core'}</option>
            <option value="village">{isAr ? 'قرية تابعة' : 'Village'}</option>
            <option value="neighbor_center">{isAr ? 'مركز مجاور' : 'Neighboring Center'}</option>
          </select>
          <input
            type="number"
            placeholder={isAr ? 'رسوم المنطقة البعيدة' : 'Remote Fee (EGP)'}
            value={newZone.remote_area_fee}
            onChange={(e) => setNewZone({ ...newZone, remote_area_fee: Number(e.target.value) })}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg whitespace-nowrap"
          >
            {isAr ? 'إضافة منطقة' : 'Add Zone'}
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 text-start font-medium">{isAr ? 'المنطقة / القرية' : 'Zone'}</th>
                <th className="py-2 text-start font-medium">{isAr ? 'التصنيف' : 'Type'}</th>
                <th className="py-2 text-start font-medium">{isAr ? 'رسوم المنطقة البعيدة (ج.م)' : 'Remote Fee (EGP)'}</th>
                <th className="py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="py-2 text-end font-medium">{isAr ? 'تفعيل' : 'Toggle'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {zones.map((z) => (
                <tr key={z.id} className="hover:bg-slate-50">
                  <td className="py-2.5 font-medium text-slate-900">{isAr ? z.name_ar : z.name_en}</td>
                  <td className="py-2.5 text-xs text-slate-600">
                    {z.zone_type === 'city_core'
                      ? isAr
                        ? 'مدينة'
                        : 'City'
                      : z.zone_type === 'village'
                      ? isAr
                        ? 'قرية'
                        : 'Village'
                      : isAr
                      ? 'مركز مجاور'
                      : 'Neighbor'}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={editingZoneFee[z.id] ?? z.remote_area_fee}
                        onChange={(e) => setEditingZoneFee({ ...editingZoneFee, [z.id]: Number(e.target.value) })}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-xs tabular-nums"
                      />
                      <button
                        onClick={() => handleUpdateZone(z)}
                        className="px-2.5 py-1 bg-slate-900 text-white text-xs rounded hover:bg-slate-800 whitespace-nowrap"
                      >
                        {isAr ? 'حفظ' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 text-xs font-medium">
                    <span className={z.is_active ? 'text-teal-700' : 'text-slate-500'}>
                      {z.is_active ? (isAr ? 'مفعّلة' : 'Active') : isAr ? 'متوقفة' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2.5 text-end">
                    <button
                      onClick={() => handleToggleZone(z)}
                      className="px-3 py-1 border border-slate-200 hover:bg-slate-100 rounded text-xs font-medium whitespace-nowrap"
                    >
                      {z.is_active ? (isAr ? 'إيقاف' : 'Pause') : isAr ? 'تفعيل' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
