export type MerchantActivityCategory = 'store' | 'restaurant_cafe' | 'pharmacy' | 'other';

export type OnboardingApplicationStatus =
  | 'draft'
  | 'under_review'
  | 'needs_completion'
  | 'approved'
  | 'rejected'
  | 'activated';

export type MerchantStaffRole = 'owner' | 'manager' | 'orders_staff' | 'catalog_staff';

export type MerchantPermissionKey =
  | 'orders.view'
  | 'orders.manage'
  | 'products.view'
  | 'products.manage'
  | 'menu.manage'
  | 'offers.manage'
  | 'inventory.manage'
  | 'prescriptions.manage'
  | 'excel.upload'
  | 'invoices.view'
  | 'settings.manage'
  | 'staff.manage';

export type MerchantCapabilityKey =
  | 'orders'
  | 'products'
  | 'offers'
  | 'inventory'
  | 'invoices'
  | 'excel'
  | 'menu'
  | 'variants_addons'
  | 'prep_time'
  | 'quick_pause'
  | 'prescriptions'
  | 'regulatory'
  | 'staff';

export interface ActivityDocumentSpec {
  doc_type: string;
  label_ar: string;
  required: boolean;
  hint_ar: string;
}

export interface ActivitySubtypeOption {
  value: string;
  label_ar: string;
}

export interface ActivityProfileDefinition {
  category: MerchantActivityCategory;
  title_ar: string;
  short_title_ar: string;
  subtitle_ar: string;
  accent_hex: string;
  default_merchant_type: string;
  subtypes: ActivitySubtypeOption[];
  capabilities: MerchantCapabilityKey[];
  documents: ActivityDocumentSpec[];
  workspace_labels: {
    portal_subtitle_ar: string;
    orders_tab_ar: string;
    catalog_tab_ar: string;
    tools_tab_ar: string;
    profile_tab_ar: string;
  };
}

export const MERCHANT_ACTIVITY_REGISTRY: Record<MerchantActivityCategory, ActivityProfileDefinition> = {
  store: {
    category: 'store',
    title_ar: 'متجر / سوبر ماركت / بقالة',
    short_title_ar: 'متجر وسوبر ماركت',
    subtitle_ar: 'إدارة المنتجات والأسعار والعروض والمخزون والفواتير وملفات Excel',
    accent_hex: '#A92224',
    default_merchant_type: 'supermarket',
    subtypes: [
      { value: 'supermarket', label_ar: 'سوبر ماركت / هايبر ماركت' },
      { value: 'grocery', label_ar: 'بقالة ومنتجات غذائية' },
      { value: 'vegetables_fruits', label_ar: 'خضار وفاكهة طازجة' },
      { value: 'butcher', label_ar: 'جزارة ولحوم ودواجن' },
      { value: 'fish_grill', label_ar: 'أسماك ومأكولات بحرية' },
      { value: 'bakery', label_ar: 'مخبوزات وحلويات' },
    ],
    capabilities: ['orders', 'products', 'offers', 'inventory', 'invoices', 'excel', 'staff'],
    documents: [
      {
        doc_type: 'national_id_front',
        label_ar: 'صورة بطاقة المالك (الرقم القومي)',
        required: true,
        hint_ar: 'صورة واضحة لوجه البطاقة الشخصية للمالك أو المفوض',
      },
      {
        doc_type: 'commercial_reg',
        label_ar: 'السجل التجاري أو البطاقة الضريبية',
        required: false,
        hint_ar: 'يسرّع اعتماد المتجر وتوثيقه على المنصة',
      },
      {
        doc_type: 'storefront_photo',
        label_ar: 'صورة واجهة المتجر أو الشعار',
        required: false,
        hint_ar: 'تظهر للعملاء داخل صفحة المتجر المعتمدة',
      },
    ],
    workspace_labels: {
      portal_subtitle_ar: 'إدارة المتجر · المنتجات والمخزون والفواتير',
      orders_tab_ar: 'الطلبات والفواتير',
      catalog_tab_ar: 'المنتجات والمخزون',
      tools_tab_ar: 'ملفات Excel والاعتماد',
      profile_tab_ar: 'متجري والفريق',
    },
  },
  restaurant_cafe: {
    category: 'restaurant_cafe',
    title_ar: 'مطعم / كافيه',
    short_title_ar: 'مطعم وكافيه',
    subtitle_ar: 'إدارة قائمة الطعام والوجبات والأحجام والإضافات ووقت التحضير والإيقاف المؤقت',
    accent_hex: '#C8431D',
    default_merchant_type: 'restaurant',
    subtypes: [
      { value: 'restaurant', label_ar: 'مطعم وجبات رئيسية ومشويات' },
      { value: 'cafe', label_ar: 'كافيه ومشروبات وحلويات' },
      { value: 'fast_food', label_ar: 'وجبات سريعة وسندوتشات' },
      { value: 'sweets', label_ar: 'حلواني ومعجنات' },
    ],
    capabilities: ['orders', 'menu', 'variants_addons', 'prep_time', 'quick_pause', 'offers', 'invoices', 'staff'],
    documents: [
      {
        doc_type: 'national_id_front',
        label_ar: 'صورة بطاقة المالك أو المدير المسؤول',
        required: true,
        hint_ar: 'صورة واضحة لإثبات الهوية',
      },
      {
        doc_type: 'health_cert',
        label_ar: 'رخصة التشغيل أو الشهادة الصحية',
        required: false,
        hint_ar: 'مستند تشغيل المطعم أو الكافيه إن وُجد',
      },
      {
        doc_type: 'storefront_photo',
        label_ar: 'شعار المطعم / الكافيه أو صورة القائمة',
        required: false,
        hint_ar: 'يساعد في تجهيز واجهة المطعم بسرعة',
      },
    ],
    workspace_labels: {
      portal_subtitle_ar: 'إدارة المطعم / الكافيه · المنيو والتحضير والطلبات',
      orders_tab_ar: 'طلبات المطبخ',
      catalog_tab_ar: 'قائمة الطعام والوجبات',
      tools_tab_ar: 'العروض والربط',
      profile_tab_ar: 'مطعمي والفريق',
    },
  },
  pharmacy: {
    category: 'pharmacy',
    title_ar: 'صيدلية',
    short_title_ar: 'صيدلية معتمدة',
    subtitle_ar: 'إدارة المنتجات والأسعار والطلبات والوصفات الطبية والمتطلبات النظامية',
    accent_hex: '#0D9488',
    default_merchant_type: 'pharmacy',
    subtypes: [
      { value: 'pharmacy', label_ar: 'صيدلية مرخصة (أدوية ومستحضرات طبية)' },
    ],
    capabilities: ['orders', 'prescriptions', 'products', 'regulatory', 'offers', 'invoices', 'staff'],
    documents: [
      {
        doc_type: 'national_id_front',
        label_ar: 'صورة بطاقة الصيدلي المالك / المدير',
        required: true,
        hint_ar: 'مطلوب للتحقق من هوية مقدم الطلب',
      },
      {
        doc_type: 'pharmacy_license',
        label_ar: 'صورة ترخيص الصيدلية الساري',
        required: true,
        hint_ar: 'وثيقة رسمية إلزامية لاعتماد الصيدليات على اطلبها',
      },
      {
        doc_type: 'pharmacist_syndicate',
        label_ar: 'كارنيه نقابة الصيادلة للصيدلي المدير',
        required: true,
        hint_ar: 'إلزامي للتحقق من القيد النقابي الساري',
      },
    ],
    workspace_labels: {
      portal_subtitle_ar: 'إدارة الصيدلية · الروشتات والأدوية والالتزام النظامي',
      orders_tab_ar: 'الطلبات والروشتات',
      catalog_tab_ar: 'الأدوية والمنتجات',
      tools_tab_ar: 'المتطلبات النظامية',
      profile_tab_ar: 'صيدليتي والفريق',
    },
  },
  other: {
    category: 'other',
    title_ar: 'نشاط آخر',
    short_title_ar: 'نشاط تجاري / خدمي',
    subtitle_ar: 'مكتبات، مستحضرات تجميل، إلكترونيات، مستلزمات منزلية، أو أي نشاط محلي آخر',
    accent_hex: '#475569',
    default_merchant_type: 'other',
    subtypes: [
      { value: 'other', label_ar: 'نشاط تجاري / خدمي مخصص' },
      { value: 'electronics', label_ar: 'إلكترونيات وموبايلات وإكسسوارات' },
      { value: 'fashion', label_ar: 'ملابس وأحذية ومستلزمات شخصية' },
      { value: 'stationery', label_ar: 'مكتبة وأدوات مدرسية وهدايا' },
      { value: 'cosmetics', label_ar: 'مستحضرات تجميل وعناية' },
    ],
    capabilities: ['orders', 'products', 'offers', 'inventory', 'invoices', 'staff'],
    documents: [
      {
        doc_type: 'national_id_front',
        label_ar: 'صورة بطاقة المالك',
        required: true,
        hint_ar: 'إثبات هوية صاحب النشاط',
      },
      {
        doc_type: 'commercial_reg',
        label_ar: 'مستند إثبات النشاط (سجل تجاري أو ترخيص)',
        required: false,
        hint_ar: 'أي مستند يوضح طبيعة النشاط التجاري',
      },
      {
        doc_type: 'storefront_photo',
        label_ar: 'صورة النشاط أو الشعار',
        required: false,
        hint_ar: 'اختياري لتعريف العملاء بالنشاط',
      },
    ],
    workspace_labels: {
      portal_subtitle_ar: 'إدارة النشاط · المنتجات والطلبات والفواتير',
      orders_tab_ar: 'الطلبات والفواتير',
      catalog_tab_ar: 'المنتجات والخدمات',
      tools_tab_ar: 'ملفات Excel والعروض',
      profile_tab_ar: 'نشاطي والفريق',
    },
  },
};

export const ONBOARDING_STATUS_META: Record<
  OnboardingApplicationStatus,
  { label_ar: string; description_ar: string; tone: 'slate' | 'amber' | 'orange' | 'teal' | 'rose' | 'emerald' }
> = {
  draft: {
    label_ar: 'مسودة محفوظة',
    description_ar: 'تم حفظ بياناتك كمسودة ويمكنك استكمالها وإرسالها في أي وقت.',
    tone: 'slate',
  },
  under_review: {
    label_ar: 'قيد المراجعة',
    description_ar: 'تم استلام طلب الانضمام بنجاح وتقوم إدارة اطلبها بمراجعة البيانات والمستندات.',
    tone: 'amber',
  },
  needs_completion: {
    label_ar: 'مطلوب استكمال',
    description_ar: 'طلبت الإدارة استكمال بعض البيانات أو المستندات قبل الاعتماد النهائي.',
    tone: 'orange',
  },
  approved: {
    label_ar: 'مقبول',
    description_ar: 'تمت الموافقة على الطلب وجارٍ تجهيز التفعيل.',
    tone: 'teal',
  },
  rejected: {
    label_ar: 'مرفوض',
    description_ar: 'تعذر قبول الطلب حاليًا وفق سبب المراجعة الموضح من الإدارة.',
    tone: 'rose',
  },
  activated: {
    label_ar: 'مفعل',
    description_ar: 'تم اعتماد وتفعيل حساب النشاط بنجاح ويمكنك تسجيل الدخول الآن.',
    tone: 'emerald',
  },
};

export interface MerchantStaffRoleDefinition {
  role: MerchantStaffRole;
  label_ar: string;
  description_ar: string;
  permissions: MerchantPermissionKey[];
}

export const MERCHANT_STAFF_ROLES: Record<MerchantStaffRole, MerchantStaffRoleDefinition> = {
  owner: {
    role: 'owner',
    label_ar: 'المالك',
    description_ar: 'صلاحيات كاملة لإدارة النشاط والطلبات والمنتجات والفواتير وفريق العمل.',
    permissions: [
      'orders.view',
      'orders.manage',
      'products.view',
      'products.manage',
      'menu.manage',
      'offers.manage',
      'inventory.manage',
      'prescriptions.manage',
      'excel.upload',
      'invoices.view',
      'settings.manage',
      'staff.manage',
    ],
  },
  manager: {
    role: 'manager',
    label_ar: 'المدير',
    description_ar: 'إدارة التشغيل اليومي والطلبات والمنتجات والعروض والمخزون ومتابعة الفريق.',
    permissions: [
      'orders.view',
      'orders.manage',
      'products.view',
      'products.manage',
      'menu.manage',
      'offers.manage',
      'inventory.manage',
      'prescriptions.manage',
      'excel.upload',
      'invoices.view',
      'staff.manage',
    ],
  },
  orders_staff: {
    role: 'orders_staff',
    label_ar: 'موظف الطلبات',
    description_ar: 'استقبال الطلبات الواردة وتحديث حالة التجهيز والتسليم للطيار فقط.',
    permissions: ['orders.view', 'orders.manage', 'prescriptions.manage', 'invoices.view'],
  },
  catalog_staff: {
    role: 'catalog_staff',
    label_ar: 'مسؤول المنتجات',
    description_ar: 'إدارة المنتجات أو قائمة الطعام والأسعار والعروض والمخزون وملفات Excel.',
    permissions: ['products.view', 'products.manage', 'menu.manage', 'offers.manage', 'inventory.manage', 'excel.upload'],
  },
};

export function resolveActivityCategory(
  merchantType?: string | null,
  explicitCategory?: string | null
): MerchantActivityCategory {
  const exp = String(explicitCategory || '').trim().toLowerCase();
  if (exp === 'store' || exp === 'restaurant_cafe' || exp === 'pharmacy' || exp === 'other') {
    return exp;
  }
  const mt = String(merchantType || '').trim().toLowerCase();
  if (mt === 'pharmacy') return 'pharmacy';
  if (['restaurant', 'cafe', 'coffee_shop', 'fast_food', 'sweets', 'restaurant_cafe'].includes(mt)) {
    return 'restaurant_cafe';
  }
  if (
    ['supermarket', 'grocery', 'butcher', 'bakery', 'vegetables_fruits', 'vegetables', 'fish_grill', 'store'].includes(mt)
  ) {
    return 'store';
  }
  if (mt === 'other' || mt === 'electronics' || mt === 'fashion' || mt === 'stationery' || mt === 'cosmetics') {
    return 'other';
  }
  return 'store';
}

export function resolveActivityProfile(
  merchantType?: string | null,
  explicitCategory?: string | null
): ActivityProfileDefinition {
  const cat = resolveActivityCategory(merchantType, explicitCategory);
  return MERCHANT_ACTIVITY_REGISTRY[cat];
}
