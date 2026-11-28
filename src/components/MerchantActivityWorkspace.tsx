import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  PauseCircle,
  Pill,
  PlayCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  MERCHANT_STAFF_ROLES,
  resolveActivityProfile,
  type MerchantStaffRole,
} from '../shared/merchantActivities.ts';
import type { Language, MerchantRecord } from '../shared/types.ts';

interface Props {
  lang: Language;
  merchant: MerchantRecord;
  mode: 'menu' | 'regulatory' | 'staff';
  onNotify: (msg: string) => void;
}

export const MerchantActivityWorkspace: React.FC<Props> = ({
  lang,
  merchant,
  mode,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const activityProfile = resolveActivityProfile(
    merchant.merchant_type,
    (merchant as any).activity_category
  );

  // Restaurant/Cafe Menu State
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [mealName, setMealName] = useState('');
  const [mealSection, setMealSection] = useState('وجبات رئيسية');
  const [mealPrice, setMealPrice] = useState('');
  const [mealSalePrice, setMealSalePrice] = useState('');
  const [prepMinutes, setPrepMinutes] = useState(20);
  const [sizesText, setSizesText] = useState('وسط: 90، كبير: 125');
  const [addonsText, setAddonsText] = useState('جبنة إضافية: 15، صوص خاص: 10');
  const [mealDesc, setMealDesc] = useState('');
  const [savingMeal, setSavingMeal] = useState(false);

  // Team Staff RBAC State
  const [staff, setStaff] = useState<any[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<MerchantStaffRole>('orders_staff');
  const [addingStaff, setAddingStaff] = useState(false);

  // Pharmacy Profile State
  const [workspaceProfile, setWorkspaceProfile] = useState<any | null>(null);

  const loadMenu = useCallback(async () => {
    setLoadingMenu(true);
    try {
      const res = await api.getMerchantMenuItems(merchant.id);
      setMenuItems(res.items || []);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingMenu(false);
    }
  }, [merchant.id, onNotify]);

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    try {
      const res = await api.getMerchantStaff(merchant.id);
      setStaff(res.staff || []);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingStaff(false);
    }
  }, [merchant.id, onNotify]);

  const loadWorkspaceProfile = useCallback(async () => {
    try {
      const res = await api.getMerchantWorkspaceProfile(merchant.id);
      setWorkspaceProfile(res);
    } catch {
      // ignore
    }
  }, [merchant.id]);

  useEffect(() => {
    if (mode === 'menu') void loadMenu();
    if (mode === 'staff') void loadStaff();
    if (mode === 'regulatory') void loadWorkspaceProfile();
  }, [mode, loadMenu, loadStaff, loadWorkspaceProfile]);

  const parsePairList = (raw: string): Array<{ label: string; price: number }> => {
    return raw
      .split(/[،,\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [label, priceStr] = part.split(':').map((s) => s.trim());
        return { label: label || part, price: Number(priceStr || 0) || 0 };
      });
  };

  const handleAddMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mealName.trim() || !Number(mealPrice)) {
      onNotify('أدخل اسم الوجبة/المشروب وسعرًا صحيحًا');
      return;
    }
    setSavingMeal(true);
    try {
      await api.createMerchantMenuItem({
        merchant_id: merchant.id,
        name_ar: mealName.trim(),
        meal_section: mealSection.trim(),
        base_price: Number(mealPrice),
        sale_price: mealSalePrice ? Number(mealSalePrice) : null,
        prep_time_minutes: prepMinutes,
        variants: parsePairList(sizesText),
        addons: parsePairList(addonsText),
        description: mealDesc.trim(),
      });
      setMealName('');
      setMealPrice('');
      setMealSalePrice('');
      setMealDesc('');
      await loadMenu();
      onNotify('تمت إضافة الصنف إلى قائمة الطعام بنجاح ✓');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingMeal(false);
    }
  };

  const handleToggleMealPause = async (item: any) => {
    try {
      await api.updateMerchantMenuItem(item.id, { is_available: !item.is_available });
      setMenuItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, is_available: !item.is_available } : m))
      );
      onNotify(
        item.is_available
          ? `تم إيقاف «${item.name_ar}» مؤقتًا عن الطلبات`
          : `تمت إعادة إتاحة «${item.name_ar}» في قائمة الطعام ✓`
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName.trim()) {
      onNotify('أدخل اسم عضو الفريق');
      return;
    }
    setAddingStaff(true);
    try {
      await api.addMerchantStaffMember({
        merchant_id: merchant.id,
        full_name: newStaffName.trim(),
        phone: newStaffPhone.trim(),
        email: newStaffEmail.trim(),
        staff_role: newStaffRole,
      });
      setNewStaffName('');
      setNewStaffPhone('');
      setNewStaffEmail('');
      await loadStaff();
      onNotify('تمت إضافة عضو الفريق وتعيين صلاحياته بنجاح ✓');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setAddingStaff(false);
    }
  };

  const handleChangeStaffRole = async (member: any, role: MerchantStaffRole) => {
    try {
      await api.updateMerchantStaffMember(member.id, { staff_role: role });
      await loadStaff();
      onNotify(`تم تحديث صلاحيات ${member.full_name} إلى «${MERCHANT_STAFF_ROLES[role].label_ar}»`);
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleToggleStaffActive = async (member: any) => {
    try {
      await api.updateMerchantStaffMember(member.id, { is_active: !member.is_active });
      await loadStaff();
      onNotify(member.is_active ? 'تم إيقاف صلاحية العضو مؤقتًا' : 'تم تفعيل العضو');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleRemoveStaff = async (member: any) => {
    try {
      await api.deleteMerchantStaffMember(member.id);
      await loadStaff();
      onNotify('تم حذف عضو الفريق');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  // =========================================================================
  // 1. RESTAURANT & CAFE MENU MANAGER
  // =========================================================================
  if (mode === 'menu') {
    return (
      <div className="space-y-5" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-50 text-[#C8431D] flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                {isAr ? 'إدارة قائمة الطعام والوجبات والمشروبات' : 'Restaurant & Cafe Menu'}
              </h2>
              <p className="text-xs text-slate-500">
                إدارة الأحجام والإضافات ووقت التحضير مع إمكانية الإيقاف المؤقت لأي صنف بضغطة واحدة.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <span>
              الإجمالي: <strong>{menuItems.length}</strong>
            </span>
            <span className="text-emerald-700">
              متاح: <strong>{menuItems.filter((i) => i.is_available).length}</strong>
            </span>
            <span className="text-rose-700">
              موقوف مؤقتًا: <strong>{menuItems.filter((i) => !i.is_available).length}</strong>
            </span>
          </div>
        </div>

        {/* Add Meal Form */}
        <form
          onSubmit={handleAddMeal}
          className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs"
        >
          <p className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-[#A92224]" />
            <span>إضافة وجبة أو مشروب جديد للقائمة</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">اسم الوجبة / المشروب *</label>
              <input
                type="text"
                required
                value={mealName}
                onChange={(e) => setMealName(e.target.value)}
                placeholder="مثال: شاورما فراخ سوري / آيس سبانيش لاتيه"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">قسم المنيو (داخل المطعم)</label>
              <input
                type="text"
                value={mealSection}
                onChange={(e) => setMealSection(e.target.value)}
                placeholder="وجبات رئيسية / سندوتشات / مشروبات"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">السعر الأساسي (ج.م) *</label>
              <input
                type="number"
                required
                min={1}
                step={0.5}
                value={mealPrice}
                onChange={(e) => setMealPrice(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">وقت التحضير (دقيقة)</label>
              <input
                type="number"
                min={1}
                max={180}
                value={prepMinutes}
                onChange={(e) => setPrepMinutes(Number(e.target.value) || 15)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">الأحجام والأسعار (مثال: صغير: 70، كبير: 110)</label>
              <input
                type="text"
                value={sizesText}
                onChange={(e) => setSizesText(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">الإضافات (مثال: جبنة: 15، صوص ثومية: 10)</label>
              <input
                type="text"
                value={addonsText}
                onChange={(e) => setAddonsText(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر العرض (اختياري)</label>
              <input
                type="number"
                min={1}
                step={0.5}
                value={mealSalePrice}
                onChange={(e) => setMealSalePrice(e.target.value)}
                placeholder="اتركه فارغًا إن لم يوجد خصم"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block font-bold text-slate-700 mb-1">مكونات / وصف مختصر</label>
              <input
                type="text"
                value={mealDesc}
                onChange={(e) => setMealDesc(e.target.value)}
                placeholder="مكونات الوجبة أو الملاحظات"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingMeal}
              className="px-5 py-2.5 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl font-extrabold cursor-pointer"
            >
              {savingMeal ? 'جاري الإضافة...' : 'حفظ الصنف في قائمة الطعام'}
            </button>
          </div>
        </form>

        {/* Menu Items List */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {loadingMenu ? (
            <div className="p-8 text-center text-xs text-slate-500">جاري تحميل قائمة الطعام...</div>
          ) : menuItems.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              لم تتم إضافة وجبات أو مشروبات بعد — استخدم النموذج أعلاه لإضافة أول صنف.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {menuItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 flex flex-wrap items-center justify-between gap-3 ${
                    item.is_available ? 'bg-white' : 'bg-slate-50/90 opacity-80'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">{item.name_ar}</span>
                      {item.meal_section && (
                        <span className="text-xs text-slate-500">· {item.meal_section}</span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-slate-600 tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {item.prep_time_minutes || 15} د
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          item.is_available ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        · {item.is_available ? 'متاح للطلب' : 'موقوف مؤقتًا'}
                      </span>
                    </div>
                    {Array.isArray(item.variants) && item.variants.length > 0 && (
                      <p className="text-[11px] text-slate-600">
                        الأحجام:{' '}
                        {item.variants.map((v: any) => `${v.label} (${v.price} ج.م)`).join(' · ')}
                      </p>
                    )}
                    {Array.isArray(item.addons) && item.addons.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        الإضافات:{' '}
                        {item.addons.map((a: any) => `${a.label}${a.price > 0 ? ` +${a.price}` : ''}`).join(' · ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-end tabular-nums">
                      <p className="text-sm font-extrabold text-[#A92224]">
                        {item.sale_price ?? item.base_price} ج.م
                      </p>
                      {item.sale_price != null && (
                        <p className="text-[11px] text-slate-400 line-through">{item.base_price} ج.م</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleMealPause(item)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                        item.is_available
                          ? 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      }`}
                    >
                      {item.is_available ? (
                        <>
                          <PauseCircle className="w-4 h-4" />
                          <span>إيقاف مؤقت</span>
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-4 h-4" />
                          <span>تفعيل الصنف</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. PHARMACY REGULATORY & PRESCRIPTIONS COMPLIANCE PANEL
  // =========================================================================
  if (mode === 'regulatory') {
    const mer = workspaceProfile?.merchant || merchant;
    return (
      <div className="space-y-5" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Pill className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              المتطلبات النظامية وترخيص الصيدلية والوصفات الطبية
            </h2>
            <p className="text-xs text-slate-500">
              بيانات الاعتماد الصيدلاني المسجلة وضوابط صرف الروشتات داخل منصة اطلبها.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1">
            <p className="text-slate-500">رقم ترخيص الصيدلية</p>
            <p dir="ltr" className="text-base font-extrabold font-mono text-slate-900">
              {mer.pharmacy_license_no || 'غير مسجل'}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1">
            <p className="text-slate-500">الصيدلي المدير المسؤول</p>
            <p className="text-base font-extrabold text-slate-900">{mer.pharmacist_name || mer.owner_name || '—'}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1">
            <p className="text-slate-500">رقم قيد نقابة الصيادلة</p>
            <p dir="ltr" className="text-base font-extrabold font-mono text-slate-900">
              {mer.syndicate_no || 'غير مسجل'}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-700" />
            <span>ضوابط صرف الروشتات الطبية</span>
          </h3>
          <ul className="space-y-2 text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>لا يتم صرف أي دواء يتطلب وصفة طبية إلا بعد مراجعة صورة الروشتة واعتماد الصيدلي وتسعيرها.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>تظهر ملاحظات الصيدلي والبدائل المقترحة للعميل بوضوح قبل إرسال الطلب للطيار.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>
                عدد المنتجات المصنفة كأدوية بوصفة طبية في صيدليتك حاليًا:{' '}
                <strong className="tabular-nums">{workspaceProfile?.stats?.rx_products_count ?? 0}</strong> منتج.
              </span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. FUTURE-READY MULTI-ROLE TEAM & PERMISSIONS MANAGER
  // =========================================================================
  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              إدارة فريق العمل والصلاحيات · {activityProfile.short_title_ar}
            </h2>
            <p className="text-xs text-slate-500">
              تهيئة الأدوار الوظيفية داخل النشاط (المالك، المدير، موظف الطلبات، مسؤول المنتجات) مع مصفوفة صلاحيات محمية.
            </p>
          </div>
        </div>
      </div>

      {/* Roles Reference Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        {(Object.keys(MERCHANT_STAFF_ROLES) as MerchantStaffRole[]).map((roleKey) => {
          const def = MERCHANT_STAFF_ROLES[roleKey];
          return (
            <div key={roleKey} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
              <p className="text-sm font-extrabold text-slate-900">{def.label_ar}</p>
              <p className="text-slate-600 leading-relaxed">{def.description_ar}</p>
              <p className="text-[11px] text-slate-400 tabular-nums pt-1">
                {def.permissions.length} صلاحية مفعّلة
              </p>
            </div>
          );
        })}
      </div>

      {/* Add Staff Member Form */}
      <form
        onSubmit={handleAddStaff}
        className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs"
      >
        <p className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <UserPlus className="w-4 h-4 text-[#A92224]" />
          <span>إضافة عضو فريق جديد</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            required
            value={newStaffName}
            onChange={(e) => setNewStaffName(e.target.value)}
            placeholder="الاسم الكامل *"
            className="px-3 py-2 border border-slate-200 rounded-xl"
          />
          <input
            type="tel"
            dir="ltr"
            value={newStaffPhone}
            onChange={(e) => setNewStaffPhone(e.target.value)}
            placeholder="رقم الهاتف"
            className="px-3 py-2 border border-slate-200 rounded-xl font-mono"
          />
          <input
            type="email"
            dir="ltr"
            value={newStaffEmail}
            onChange={(e) => setNewStaffEmail(e.target.value)}
            placeholder="البريد الإلكتروني (اختياري)"
            className="px-3 py-2 border border-slate-200 rounded-xl font-mono"
          />
          <select
            value={newStaffRole}
            onChange={(e) => setNewStaffRole(e.target.value as MerchantStaffRole)}
            className="px-3 py-2 border border-slate-200 rounded-xl bg-white font-bold"
          >
            <option value="manager">المدير</option>
            <option value="orders_staff">موظف الطلبات</option>
            <option value="catalog_staff">مسؤول المنتجات</option>
          </select>
          <button
            type="submit"
            disabled={addingStaff}
            className="px-4 py-2 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl font-bold cursor-pointer"
          >
            {addingStaff ? 'جاري الإضافة...' : 'إضافة العضو'}
          </button>
        </div>
      </form>

      {/* Current Staff List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loadingStaff ? (
          <div className="p-8 text-center text-xs text-slate-500">جاري تحميل أعضاء الفريق...</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {staff.map((m) => (
              <div key={m.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    {m.full_name}{' '}
                    <span className={m.is_active ? 'text-emerald-700 font-bold text-xs' : 'text-rose-600 font-bold text-xs'}>
                      · {m.is_active ? 'نشط' : 'موقوف'}
                    </span>
                  </p>
                  <p className="text-slate-500 mt-0.5">
                    {m.role_meta?.label_ar}
                    {m.phone ? ` · ${m.phone}` : ''}
                    {m.email ? ` · ${m.email}` : ''}
                  </p>
                </div>

                {m.staff_role !== 'owner' && (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.staff_role}
                      onChange={(e) => void handleChangeStaffRole(m, e.target.value as MerchantStaffRole)}
                      className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-bold"
                    >
                      <option value="manager">المدير</option>
                      <option value="orders_staff">موظف الطلبات</option>
                      <option value="catalog_staff">مسؤول المنتجات</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleToggleStaffActive(m)}
                      className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 font-bold cursor-pointer"
                    >
                      {m.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveStaff(m)}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
