import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  UserPlus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Edit3,
  Trash2,
  Key,
  Check,
  X,
  Lock,
  UserCheck,
  UserX,
  Users,
  CheckSquare,
  Square,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { AdminUserDetail, AuditLogRecord, ComplaintRecord, Language, RoleRecord } from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify: (msg: string) => void;
  onRefreshOverview: () => Promise<void>;
}

interface ReadinessItem {
  key: string;
  label_ar: string;
  label_en: string;
  passed: boolean;
  detail_ar: string;
  detail_en: string;
}

interface PermissionDefinition {
  key: string;
  label_ar: string;
  label_en: string;
  desc_ar: string;
}

interface PermissionCategory {
  category_ar: string;
  category_en: string;
  permissions: PermissionDefinition[];
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    category_ar: 'الطلبات والتشغيل الميداني',
    category_en: 'Orders & Operations',
    permissions: [
      { key: 'orders.view', label_ar: 'استعراض ومتابعة الطلبات', label_en: 'View Orders', desc_ar: 'متابعة قائمة الطلبات وحالاتها وتفاصيل الأقسام' },
      { key: 'orders.delete', label_ar: 'حذف الطلبات نهائيًا (إدارة عليا)', label_en: 'Delete Orders Permanently', desc_ar: 'حذف الطلبات وأقسامها وسجلاتها نهائيًا من قاعدة البيانات' },
      { key: 'orders.reassign', label_ar: 'إعادة تعيين وإسناد الطلبات', label_en: 'Reassign Orders', desc_ar: 'تغيير الكابتن المسند أو الإسناد المباشر للطلبات' },
      { key: 'dispatch.manage', label_ar: 'إدارة خوارزمية التوزيع والديسباتش', label_en: 'Manage Dispatching', desc_ar: 'التحكم في أوزان خوارزمية التوزيع ونطاق التوجيه' },
      { key: 'zones.manage', label_ar: 'إدارة النطاقات الجغرافية', label_en: 'Manage Service Zones', desc_ar: 'إضافة وتعديل مناطق وقرى المنزلة ورسوم الأطراف' },
    ],
  },
  {
    category_ar: 'الكباتن والأسطول',
    category_en: 'Captains & Fleet',
    permissions: [
      { key: 'captains.monitor', label_ar: 'مراقبة الكباتن ومواقعهم', label_en: 'Monitor Captains', desc_ar: 'تتبع مواقع الكباتن الحية وحالات الاتصال والشغل' },
      { key: 'captains.review', label_ar: 'مراجعة واعتماد الكباتن الجدد', label_en: 'Review & Approve Captains', desc_ar: 'فحص طلبات الانضمام واتخاذ قرار القبول أو الرفض' },
      { key: 'captains.suspend', label_ar: 'إيقاف وتجميد حسابات الكباتن', label_en: 'Suspend Captains', desc_ar: 'تعطيل الحسابات المخالفة وتدوين سبب التعليق' },
      { key: 'docs.verify', label_ar: 'فحص مستندات KYC الـ 9', label_en: 'Verify KYC Documents', desc_ar: 'مراجعة الرخص والبطاقات والصور الشخصية للمركبات' },
    ],
  },
  {
    category_ar: 'المتاجر والصيدليات والشركاء',
    category_en: 'Merchants & Pharmacies',
    permissions: [
      { key: 'merchants.verify', label_ar: 'اعتماد وتفعيل المتاجر والأنشطة', label_en: 'Verify & Approve Merchants', desc_ar: 'مراجعة وقبول المحال والمتاجر والأنشطة التجارية' },
      { key: 'merchants.commission', label_ar: 'تعديل نسب العمولة للمتاجر', label_en: 'Manage Merchant Commissions', desc_ar: 'تحديد وتعديل نسبة العمولة لكل متجر وشريك' },
      { key: 'pharmacy.verify_license', label_ar: 'فحص تراخيص الصيدليات (قانون 127)', label_en: 'Verify Pharmacy Licenses', desc_ar: 'التحقق من ترخيص مزاولة المهنة ورخصة المنشأة الطبية' },
      { key: 'prescriptions.audit', label_ar: 'تدقيق ومراجعة الروشتات الطبية', label_en: 'Audit Prescriptions', desc_ar: 'مراجعة صور الروشتات والبدائل المسجلة من الصيدلي' },
      { key: 'complaints.pharmacy', label_ar: 'إشراف شكاوى الأدوية والصيدليات', label_en: 'Pharmacy Complaints', desc_ar: 'متابعة والبت في نزاعات الأدوية والروشتات' },
    ],
  },
  {
    category_ar: 'المالية والمحاسبة والمحافظ',
    category_en: 'Finance & Ledger',
    permissions: [
      { key: 'pricing.manage', label_ar: 'إدارة قواعد التسعير', label_en: 'Manage Pricing Rules', desc_ar: 'تعديل فتح العداد وسعر الكيلو والانتظار وحدود العمولة' },
      { key: 'ledger.view', label_ar: 'استعراض الدفتر المالي المزدوج', label_en: 'View Double-Entry Ledger', desc_ar: 'الاطلاع على قيود اليومية وميزان المراجعة والتسويات' },
      { key: 'settlements.approve', label_ar: 'اعتماد التسويات وسحب الأرباح', label_en: 'Approve Payout Settlements', desc_ar: 'صرف الأرباح ومستحقات الكباتن والتجار بعد مراجعتها' },
      { key: 'wallet.adjust_with_reason', label_ar: 'تعديل أرصدة المحافظ مع السبب', label_en: 'Adjust Wallet Balances', desc_ar: 'إضافة أو خصم رصيد مالي مع إرفاق سبب تدقيقي ملزم' },
      { key: 'refunds.process', label_ar: 'معالجة المبالغ المرتجعة', label_en: 'Process Refunds', desc_ar: 'إرجاع المبالغ للمحافظ والعملاء في حالات النزاع' },
      { key: 'coupons.manage', label_ar: 'إدارة كوبونات الخصم', label_en: 'Manage Coupons', desc_ar: 'إنشاء وتفعيل وحظر أكواد الخصم الترويجية' },
    ],
  },
  {
    category_ar: 'الحوكمة والإشراف العام',
    category_en: 'Governance & Platform',
    permissions: [
      { key: 'services.manage', label_ar: 'إدارة مفاتيح الخدمات الميدانية', label_en: 'Manage Service Flags', desc_ar: 'تشغيل أو إيقاف خدمات المنصة الرئيسية وصمامات الأمان' },
      { key: 'reports.view', label_ar: 'استعراض التقارير والنموذج المالي', label_en: 'View Analytics & Reports', desc_ar: 'متابعة مؤشرات الأداء والنمو والتوقعات المالية' },
      { key: 'complaints.resolve', label_ar: 'حل وإغلاق شكاوى العملاء', label_en: 'Resolve Customer Complaints', desc_ar: 'معالجة تذاكر الدعم الفني وتدوين الحلول والتعويضات' },
      { key: 'refunds.request', label_ar: 'طلب تعويض مالي للعميل', label_en: 'Request Customer Compensation', desc_ar: 'رفع طلبات التعويض المالي للإدارة المالية' },
      { key: 'market.approve', label_ar: 'اعتماد إعلانات السوق المفتوح', label_en: 'Approve Market Listings', desc_ar: 'مراجعة وتنشيط إعلانات سوق المستعمل' },
      { key: 'market.delete', label_ar: 'حذف إعلانات السوق المخالفة', label_en: 'Delete Market Listings', desc_ar: 'إزالة الإعلانات المخالفة للشروط أو المحظورة' },
      { key: 'market.disputes', label_ar: 'حل نزاعات سوق المستعمل', label_en: 'Market Disputes', desc_ar: 'الفصل في الخلافات بين البائعين والمشترين' },
      { key: '*', label_ar: 'الصلاحية الشاملة الكاملة (Super Admin)', label_en: 'All Permissions (*)', desc_ar: 'صلاحيات مطلقة غير مقيدة على كافة أقسام ووظائف المنظومة' },
    ],
  },
];

export const GovernanceAuditSection: React.FC<Props> = ({ lang, onNotify, onRefreshOverview }) => {
  const isAr = lang === 'ar';
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [complaints, setComplaints] = useState<ComplaintRecord[]>([]);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [readiness, setReadiness] = useState<ReadinessItem[]>([]);

  // Admin users & permissions management states
  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUserDetail | null>(null);
  const [formFullName, setFormFullName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRoleCode, setFormRoleCode] = useState('operations_manager');
  const [formUseCustomPerms, setFormUseCustomPerms] = useState(false);
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [adminToDelete, setAdminToDelete] = useState<AdminUserDetail | null>(null);
  const [deletingAdminUser, setDeletingAdminUser] = useState(false);

  const loadAll = async () => {
    setLoadingAdmins(true);
    try {
      const [r, c, l, srvs, caps, mers, fin, zns, admins] = await Promise.all([
        api.getRoles(),
        api.getComplaints(),
        api.getAuditLogs(),
        api.getServices(),
        api.getCaptains(),
        api.getMerchants(),
        api.getFinance(),
        api.getZones(),
        api.getAdminUsers().catch(() => []),
      ]);
      setRoles(r);
      setComplaints(c);
      setLogs(l);
      setAdminUsers(admins);

      const ridesSrv = srvs.find((s: any) => s.service_key === 'rides');
      const approvedCaps = caps.filter((x: any) => x.verification_status === 'approved');
      const approvedPharmacies = mers.filter(
        (m: any) => m.merchant_type === 'pharmacy' && m.verification_status === 'approved'
      );
      const activeZones = zns.filter((z: any) => z.is_active);
      const ledgerBalanced = Boolean(fin?.reconciliation?.is_balanced);

      setReadiness([
        {
          key: 'ledger',
          label_ar: 'توازن الدفتر المالي المزدوج (Double-Entry Zero-Sum)',
          label_en: 'Double-Entry Ledger Zero-Sum Check',
          passed: ledgerBalanced,
          detail_ar: `المدين = ${fin?.reconciliation?.total_debit ?? 0} ج.م | الدائن = ${fin?.reconciliation?.total_credit ?? 0} ج.م`,
          detail_en: `DR ${fin?.reconciliation?.total_debit ?? 0} = CR ${fin?.reconciliation?.total_credit ?? 0}`,
        },
        {
          key: 'zones',
          label_ar: 'نطاقات المنزلة والقرى المجاورة',
          label_en: 'El Manzala Zones & Villages Active',
          passed: activeZones.length >= 3,
          detail_ar: `${activeZones.length} مناطق مفعّلة`,
          detail_en: `${activeZones.length} active zones`,
        },
        {
          key: 'captains',
          label_ar: 'الكباتن المعتمدون بمستندات كاملة (9 KYC)',
          label_en: 'Approved Captains with Full KYC',
          passed: approvedCaps.length >= 1,
          detail_ar: `${approvedCaps.length} كباتن جاهزين للتشغيل`,
          detail_en: `${approvedCaps.length} approved captains`,
        },
        {
          key: 'pharmacy',
          label_ar: 'صيدلية مرخصة معتمدة (قانون 127/1955)',
          label_en: 'Licensed Pharmacy Partner Approved',
          passed: approvedPharmacies.length >= 1,
          detail_ar: `${approvedPharmacies.length} صيدليات معتمدة`,
          detail_en: `${approvedPharmacies.length} approved pharmacies`,
        },
        {
          key: 'rides_gate',
          label_ar: 'بوابة الامتثال القانوني لخدمة المشاوير (قانون 87/2018)',
          label_en: 'Rides Legal Feature Flag Compliance',
          passed: ridesSrv ? !ridesSrv.is_enabled || Boolean(ridesSrv.license_ready) : true,
          detail_ar: ridesSrv?.is_enabled ? 'الخدمة مفعّلة الآن' : 'موقوفة بأمان لحين ترخيص المركبات',
          detail_en: ridesSrv?.is_enabled ? 'Enabled' : 'Safely disabled pending licensing',
        },
      ]);
    } finally {
      setLoadingAdmins(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleResolveComplaint = async (c: ComplaintRecord, status: 'resolved' | 'escalated') => {
    await api.updateComplaint(c.id, {
      status,
      resolution_notes: notesMap[c.id] || (status === 'resolved' ? 'تم التواصل مع العميل وحل المشكلة' : 'تم التصعيد للإدارة'),
    });
    await Promise.all([loadAll(), onRefreshOverview()]);
    onNotify(isAr ? 'تم تحديث حالة الشكوى وتسجيلها' : 'Complaint updated');
  };

  const handleExportAuditCsv = () => {
    const header = ['id', 'created_at', 'actor_name', 'actor_role', 'action', 'entity_type', 'entity_id', 'details', 'reason'];
    const rows = logs.map((l) =>
      [l.id, l.created_at, l.actor_name, l.actor_role, l.action, l.entity_type, l.entity_id, l.details, l.reason ?? '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `otlobha_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(isAr ? 'تم تنزيل ملف سجل التدقيق CSV' : 'Audit CSV exported');
  };

  // Open modal to create new admin user
  const openCreateAdminModal = () => {
    setEditingAdmin(null);
    setFormFullName('');
    setFormEmail('');
    setFormPassword('');
    const initialRole = 'operations_manager';
    setFormRoleCode(initialRole);
    const matchingRole = roles.find((r) => r.code === initialRole);
    setFormPermissions(matchingRole ? matchingRole.permissions : []);
    setFormUseCustomPerms(false);
    setShowAdminModal(true);
  };

  // Open modal to edit existing admin user
  const openEditAdminModal = (user: AdminUserDetail) => {
    setEditingAdmin(user);
    setFormFullName(user.full_name);
    setFormEmail(user.email);
    setFormPassword('');
    setFormRoleCode(user.role_code);
    const hasCustom = user.custom_permissions !== null && user.custom_permissions !== undefined;
    setFormUseCustomPerms(hasCustom);
    setFormPermissions(user.permissions || []);
    setShowAdminModal(true);
  };

  const handleRoleChangeInForm = (newRoleCode: string) => {
    setFormRoleCode(newRoleCode);
    if (!formUseCustomPerms) {
      const matchingRole = roles.find((r) => r.code === newRoleCode);
      if (matchingRole) {
        setFormPermissions(matchingRole.permissions);
      }
    }
  };

  const handleTogglePermission = (permKey: string) => {
    setFormPermissions((prev) =>
      prev.includes(permKey) ? prev.filter((p) => p !== permKey) : [...prev, permKey]
    );
  };

  const handleToggleCategoryAll = (categoryKeys: string[]) => {
    const allChecked = categoryKeys.every((k) => formPermissions.includes(k));
    if (allChecked) {
      setFormPermissions((prev) => prev.filter((p) => !categoryKeys.includes(p)));
    } else {
      setFormPermissions((prev) => Array.from(new Set([...prev, ...categoryKeys])));
    }
  };

  const handleSaveAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFullName.trim() || !formEmail.trim()) {
      onNotify(isAr ? 'يرجى إدخال الاسم والبريد الإلكتروني' : 'Name and email are required');
      return;
    }
    if (!editingAdmin && (!formPassword || formPassword.length < 6)) {
      onNotify(isAr ? 'كلمة المرور يجب أن لا تقل عن 6 أحرف' : 'Password must be at least 6 characters');
      return;
    }

    setSavingAdmin(true);
    try {
      const payload: {
        full_name: string;
        email: string;
        role_code: string;
        permissions?: string[] | null;
        password?: string;
      } = {
        full_name: formFullName.trim(),
        email: formEmail.trim(),
        role_code: formRoleCode,
        permissions: formUseCustomPerms ? formPermissions : null,
      };
      if (formPassword.trim()) {
        payload.password = formPassword.trim();
      }

      if (editingAdmin) {
        await api.updateAdminUser(editingAdmin.id, payload);
        onNotify(isAr ? `تم تحديث بيانات وصلاحيات «${formFullName}» بنجاح` : 'Admin user updated');
      } else {
        await api.createAdminUser(payload);
        onNotify(isAr ? `تمت إضافة المستخدم الإداري «${formFullName}» وتعيين صلاحياته بنجاح` : 'Admin user created');
      }
      setShowAdminModal(false);
      await loadAll();
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleToggleAdminActive = async (user: AdminUserDetail) => {
    try {
      const nextActive = !user.is_active;
      await api.updateAdminUser(user.id, { is_active: nextActive });
      onNotify(
        isAr
          ? nextActive
            ? `تم تفعيل حساب ${user.full_name} بنجاح`
            : `تم تعطيل حساب ${user.full_name}`
          : 'Admin user status updated'
      );
      await loadAll();
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleConfirmDeleteAdmin = async () => {
    if (!adminToDelete) return;
    setDeletingAdminUser(true);
    try {
      const res = await api.deleteAdminUser(adminToDelete.id);
      setAdminToDelete(null);
      await loadAll();
      onNotify(isAr ? (res.message || `تم حذف حساب ${adminToDelete.full_name} نهائيًا`) : 'Admin user deleted');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setDeletingAdminUser(false);
    }
  };

  const roleColors: Record<string, { bg: string; text: string; border: string }> = {
    super_admin: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
    general_manager: { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200' },
    operations_manager: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
    finance_manager: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200' },
    captain_manager: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
    merchant_manager: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
    market_moderator: { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200' },
    customer_support: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200' },
    pharmacy_supervisor: { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200' },
  };

  return (
    <div className="space-y-6">
      {/* 1. Launch Readiness Checklist */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {isAr ? 'فحص الجاهزية الميدانية للإطلاق في المنزلة (Launch Readiness)' : 'El Manzala Launch Readiness Checklist'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAr
                ? 'فحص آلي من قاعدة البيانات الحية + ملفات PostgreSQL و Docker جاهزة في مجلد /deploy/'
                : 'Live database checks · PostgreSQL & Docker configs available in /deploy/'}
            </p>
          </div>
          <span className="text-xs font-bold tabular-nums text-teal-700">
            {readiness.filter((x) => x.passed).length} / {readiness.length}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {readiness.map((item) => (
            <div key={item.key} className="p-3.5 border border-slate-200 rounded-lg flex items-start gap-2.5 bg-slate-50/50">
              {item.passed ? (
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-bold text-slate-900">{isAr ? item.label_ar : item.label_en}</p>
                <p className="text-xs text-slate-600 mt-1 tabular-nums">{isAr ? item.detail_ar : item.detail_en}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Admin Users & Permissions Management (فريق الإدارة والمشرفين وتحديد الصلاحيات) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-orange-100 text-orange-700">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'إدارة مستخدمي الإدارة وفريق العمل وتحديد الصلاحيات' : 'Admin Team & Custom Permissions'}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isAr
                ? 'إضافة مسؤولين ومديرين جدد إلى الإدارة، وتعيين أدوارهم أو تخصيص صلاحيات تفصيلية محددة لكل مستخدم'
                : 'Add new administrators, assign baseline roles, or customize fine-grained permissions per user'}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateAdminModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>{isAr ? '+ إضافة مستخدم إدارة جديد' : '+ Add Admin User'}</span>
          </button>
        </div>

        {/* Admin Users Cards / Table */}
        {loadingAdmins && adminUsers.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            {isAr ? 'جاري تحميل قائمة مستخدمي الإدارة...' : 'Loading admin users...'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {adminUsers.map((admin) => {
              const roleStyle = roleColors[admin.role_code] || {
                bg: 'bg-slate-100',
                text: 'text-slate-800',
                border: 'border-slate-200',
              };
              const hasCustom = admin.custom_permissions !== null && admin.custom_permissions !== undefined;

              return (
                <div
                  key={admin.id}
                  className={`p-4 rounded-xl border ${admin.is_active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/70 opacity-75'} shadow-xs flex flex-col justify-between space-y-3`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{admin.full_name}</span>
                          {admin.role_code === 'super_admin' && (
                            <span title={isAr ? 'المالك وصاحب الصلاحية العليا' : 'Super Admin'} className="text-purple-600">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </h4>
                        <p className="text-xs font-mono-num text-slate-500">{admin.email}</p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          admin.is_active ? 'bg-teal-100 text-teal-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {admin.is_active ? (isAr ? 'نشط' : 'Active') : isAr ? 'معطل' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}>
                        {isAr ? admin.role_name_ar : admin.role_name_en}
                      </span>
                      {hasCustom ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                          <Key className="w-3 h-3" />
                          <span>{isAr ? `مخصص (${admin.permissions.length} صلاحيات)` : `Custom (${admin.permissions.length})`}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600">
                          {isAr ? `دور قياسي (${admin.permissions.length})` : `Standard (${admin.permissions.length})`}
                        </span>
                      )}
                    </div>

                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-600 line-clamp-2" title={admin.permissions.join(', ')}>
                      <strong>{isAr ? 'الصلاحيات الفعالة:' : 'Effective:'}</strong>{' '}
                      {admin.permissions.includes('*') ? (
                        <span className="font-bold text-purple-700">{isAr ? 'صلاحية شاملة غير مقيدة (*)' : 'All Permissions (*)'}</span>
                      ) : (
                        admin.permissions.join(' · ')
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditAdminModal(admin)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold transition-colors"
                        title={isAr ? 'تعديل الدور والصلاحيات' : 'Edit role and permissions'}
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>{isAr ? 'تعديل' : 'Edit'}</span>
                      </button>

                      {admin.role_code !== 'super_admin' && (
                        <button
                          type="button"
                          onClick={() => handleToggleAdminActive(admin)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold transition-colors ${
                            admin.is_active
                              ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200'
                          }`}
                          title={admin.is_active ? (isAr ? 'تعطيل الحساب' : 'Deactivate') : isAr ? 'تفعيل الحساب' : 'Activate'}
                        >
                          {admin.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          <span>{admin.is_active ? (isAr ? 'تعطيل' : 'Deactivate') : isAr ? 'تفعيل' : 'Activate'}</span>
                        </button>
                      )}
                    </div>

                    {admin.role_code !== 'super_admin' && (
                      <button
                        type="button"
                        onClick={() => setAdminToDelete(admin)}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors"
                        title={isAr ? 'حذف هذا المستخدم الإداري' : 'Delete user'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. 9-Tier Administrative RBAC Roles Matrix */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-bold text-slate-900 mb-3">
          {isAr ? 'مرجع الأدوار التسعة في المنظومة (9-Tier RBAC Reference)' : '9-Tier Administrative RBAC Roles'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {roles.map((r) => (
            <div key={r.code} className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50">
              <p className="text-sm font-bold text-slate-900">{isAr ? r.name_ar : r.name_en}</p>
              <p className="text-xs font-mono-num text-slate-500 mt-0.5">{r.code}</p>
              <p className="text-xs text-slate-600 mt-2">{r.permissions.join(' · ')}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Complaints & Disputes */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h3 className="text-base font-bold text-slate-900">{isAr ? 'الشكاوى والنزاعات' : 'Complaints & Disputes'}</h3>
        <div className="divide-y divide-slate-200">
          {complaints.map((c) => (
            <div key={c.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 tabular-nums">
                  {c.ticket_number} · {c.complainant_name} ({c.service_type} / {c.category})
                </span>
                <span className="font-semibold text-slate-700">{c.status}</span>
              </div>
              <p className="text-xs text-slate-700">{c.description}</p>
              {c.status !== 'resolved' && c.status !== 'closed' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder={isAr ? 'ملاحظة المعالجة أو التعويض...' : 'Resolution note...'}
                    value={notesMap[c.id] ?? ''}
                    onChange={(e) => setNotesMap({ ...notesMap, [c.id]: e.target.value })}
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-slate-200 rounded text-xs"
                  />
                  <button
                    onClick={() => handleResolveComplaint(c, 'resolved')}
                    className="px-3 py-1.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                  >
                    {isAr ? 'إغلاق وحل الشكوى' : 'Resolve'}
                  </button>
                  <button
                    onClick={() => handleResolveComplaint(c, 'escalated')}
                    className="px-3 py-1.5 border border-slate-200 text-xs rounded hover:bg-slate-50"
                  >
                    {isAr ? 'تصعيد' : 'Escalate'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 5. Immutable Audit Logs */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-base font-bold text-slate-900">
            {isAr ? 'سجل التدقيق غير القابل للتعديل (Immutable Audit Logs)' : 'Immutable Audit Trail'}
          </h3>
          <button
            onClick={handleExportAuditCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isAr ? 'تصدير CSV' : 'Export CSV'}</span>
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 text-start">{isAr ? 'الوقت' : 'Time'}</th>
              <th className="py-2 text-start">{isAr ? 'المنفذ' : 'Actor'}</th>
              <th className="py-2 text-start">{isAr ? 'الإجراء' : 'Action'}</th>
              <th className="py-2 text-start">{isAr ? 'التفاصيل والسبب' : 'Details & Reason'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="py-2 font-mono-num text-slate-500 whitespace-nowrap">{l.created_at}</td>
                <td className="py-2 font-medium text-slate-800 whitespace-nowrap">
                  {l.actor_name} ({l.actor_role})
                </td>
                <td className="py-2 font-mono-num text-orange-700 whitespace-nowrap">{l.action}</td>
                <td className="py-2 text-slate-700">
                  {l.details}
                  {l.reason && <span className="text-slate-500"> — ({l.reason})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL: Create / Edit Admin User with Granular Permissions */}
      {showAdminModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full my-8 overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-orange-400" />
                <h3 className="text-sm font-bold">
                  {editingAdmin
                    ? isAr
                      ? `تعديل بيانات وصلاحيات: ${editingAdmin.full_name}`
                      : `Edit Admin: ${editingAdmin.full_name}`
                    : isAr
                    ? 'إضافة مستخدم إداري جديد وتحديد صلاحياته'
                    : 'Add Admin User & Set Permissions'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !savingAdmin && setShowAdminModal(false)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdminUser} className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-900 mb-1">
                    {isAr ? 'الاسم بالكامل' : 'Full Name'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    placeholder={isAr ? 'مثال: أحمد عبد الرحمن' : 'e.g. Ahmed Abdelrahman'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-900 mb-1">
                    {isAr ? 'البريد الإلكتروني (لتسجيل الدخول)' : 'Email'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="admin@otlobha.local"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-orange-500 font-mono-num"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-900 mb-1">
                    {editingAdmin
                      ? isAr
                        ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء على الحالية)'
                        : 'New Password (leave empty to keep current)'
                      : isAr
                      ? 'كلمة المرور (6 أحرف على الأقل)'
                      : 'Password (min 6 characters)'}
                    {!editingAdmin && <span className="text-rose-500"> *</span>}
                  </label>
                  <input
                    type="password"
                    required={!editingAdmin}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-900 mb-1">
                    {isAr ? 'الدور الأساسي (RBAC Role)' : 'Base Role'} <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formRoleCode}
                    onChange={(e) => handleRoleChangeInForm(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold bg-white focus:outline-none focus:border-orange-500"
                  >
                    {roles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {isAr ? `${r.name_ar} (${r.code})` : `${r.name_en} (${r.code})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Permissions Mode Selector */}
              <div className="p-4 rounded-xl bg-orange-50/60 border border-orange-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-xs">
                    {isAr ? 'طريقة تحديد وتخصيص الصلاحيات:' : 'Permissions Assignment Mode:'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      !formUseCustomPerms
                        ? 'bg-white border-orange-500 shadow-xs'
                        : 'bg-white/60 border-slate-200 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="perm_mode"
                      checked={!formUseCustomPerms}
                      onChange={() => {
                        setFormUseCustomPerms(false);
                        const match = roles.find((r) => r.code === formRoleCode);
                        if (match) setFormPermissions(match.permissions);
                      }}
                      className="mt-0.5 text-orange-600 focus:ring-orange-500"
                    />
                    <div>
                      <p className="font-bold text-slate-900 text-xs">
                        {isAr ? 'صلاحيات الدور القياسية الافتراضية' : 'Default Role Permissions'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isAr
                          ? 'يرث المستخدم الصلاحيات المحددة رسميًا لهذا الدور في النظام'
                          : 'Inherit the standard permissions configured for this RBAC role'}
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      formUseCustomPerms
                        ? 'bg-white border-orange-500 shadow-xs'
                        : 'bg-white/60 border-slate-200 hover:bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="perm_mode"
                      checked={formUseCustomPerms}
                      onChange={() => setFormUseCustomPerms(true)}
                      className="mt-0.5 text-orange-600 focus:ring-orange-500"
                    />
                    <div>
                      <p className="font-bold text-slate-900 text-xs">
                        {isAr ? 'تخصيص صلاحيات محددة تفصيليًا' : 'Custom Fine-Grained Permissions'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isAr
                          ? 'تحديد أو استبعاد صلاحيات معينة بشكل دقيق ومستقل'
                          : 'Check/uncheck exact capabilities independently for this user'}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Categorized Permissions Checklists */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-orange-600" />
                    <span>{isAr ? 'قائمة الصلاحيات التفصيلية بالمنظومة:' : 'Fine-Grained Permissions Matrix:'}</span>
                  </h4>
                  <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                    {isAr ? `المحدد: ${formPermissions.length} صلاحيات` : `Selected: ${formPermissions.length}`}
                  </span>
                </div>

                <div className="space-y-3.5">
                  {PERMISSION_CATEGORIES.map((cat) => {
                    const catKeys = cat.permissions.map((p) => p.key);
                    const allChecked = catKeys.every((k) => formPermissions.includes(k));
                    const someChecked = catKeys.some((k) => formPermissions.includes(k));

                    return (
                      <div key={cat.category_ar} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50 space-y-2.5">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                          <span className="font-bold text-slate-900 text-xs">
                            {isAr ? cat.category_ar : cat.category_en}
                          </span>
                          {formUseCustomPerms && (
                            <button
                              type="button"
                              onClick={() => handleToggleCategoryAll(catKeys)}
                              className="text-[11px] font-bold text-orange-700 hover:text-orange-800 transition-colors"
                            >
                              {allChecked ? (isAr ? 'إلغاء تحديد الكل' : 'Uncheck All') : isAr ? 'تحديد الكل' : 'Select All'}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {cat.permissions.map((perm) => {
                            const isChecked = formPermissions.includes(perm.key) || formPermissions.includes('*');

                            return (
                              <label
                                key={perm.key}
                                className={`p-2.5 rounded-lg border flex items-start gap-2.5 transition-colors ${
                                  formUseCustomPerms ? 'cursor-pointer' : 'cursor-not-allowed opacity-90'
                                } ${
                                  isChecked
                                    ? 'bg-orange-50/80 border-orange-200 text-orange-950'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={!formUseCustomPerms}
                                  checked={isChecked}
                                  onChange={() => handleTogglePermission(perm.key)}
                                  className="mt-0.5 text-orange-600 rounded focus:ring-orange-500"
                                />
                                <div className="space-y-0.5 flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-1">
                                    <p className="font-bold text-xs">{isAr ? perm.label_ar : perm.label_en}</p>
                                    <span className="font-mono text-[10px] text-slate-400 shrink-0">{perm.key}</span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 leading-normal">{perm.desc_ar}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={savingAdmin}
                  onClick={() => setShowAdminModal(false)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700 transition-colors"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingAdmin}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {savingAdmin
                      ? isAr
                        ? 'جاري الحفظ...'
                        : 'Saving...'
                      : editingAdmin
                      ? isAr
                        ? 'حفظ التعديلات'
                        : 'Save Changes'
                      : isAr
                      ? 'إنشاء وتعيين الصلاحيات'
                      : 'Create Admin User'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete Admin Confirmation */}
      {adminToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/65">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-rose-100">
            <div className="bg-rose-700 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <span>{isAr ? 'حذف حساب مستخدم إدارة' : 'Delete Admin User'}</span>
              </h3>
              <button
                type="button"
                onClick={() => !deletingAdminUser && setAdminToDelete(null)}
                className="p-1 rounded-lg bg-white/15 hover:bg-white/25"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700 leading-relaxed">
              <p className="text-sm font-bold text-slate-900">
                {isAr
                  ? `هل أنت متأكد من حذف حساب المسؤول «${adminToDelete.full_name}» (${adminToDelete.email})؟`
                  : `Are you sure you want to permanently delete admin user "${adminToDelete.full_name}"?`}
              </p>
              <p className="text-slate-600">
                {isAr
                  ? 'سيتم إبطال جميع جلسات هذا المستخدم الإداري فورًا ومنعه نهائيًا من تسجيل الدخول إلى لوحة التحكم.'
                  : 'All sessions for this user will be revoked immediately and access to the control panel will be removed.'}
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingAdminUser}
                onClick={() => setAdminToDelete(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingAdminUser}
                onClick={handleConfirmDeleteAdmin}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {deletingAdminUser
                    ? isAr
                      ? 'جاري الحذف...'
                      : 'Deleting...'
                    : isAr
                    ? 'تأكيد الحذف'
                    : 'Confirm Delete'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
