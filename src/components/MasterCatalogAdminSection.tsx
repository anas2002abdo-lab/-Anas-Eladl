import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FolderTree,
  GitCompare,
  GitMerge,
  History,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Store,
  Tag,
  Trash2,
  Unlink,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { MasterCatalogExcelPanel } from './MasterCatalogExcelPanel';
import { CategoryPathPicker } from './CategoryPathPicker';
import type {
  CategoryRecord,
  MasterProductRecord,
  MerchantRecord,
  ProductMatchingRequestRecord,
  StorefrontBannerRecord,
} from '../shared/types';

interface Props {
  categories: CategoryRecord[];
  merchants: MerchantRecord[];
  onRefresh: () => void;
  onToast: (msg: string) => void;
}

type AdminCatalogTab = 'masters' | 'excel' | 'requests' | 'duplicates' | 'banners' | 'audit';

function compressRequestImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxDim = 600;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(rawUrl);
      img.src = rawUrl;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
    reader.readAsDataURL(file);
  });
}

export const MasterCatalogAdminSection: React.FC<Props> = ({ categories, merchants, onRefresh, onToast }) => {
  const [tab, setTab] = useState<AdminCatalogTab>('masters');
  const [excelMode, setExcelMode] = useState<'import' | 'compare'>('import');
  const [loading, setLoading] = useState(false);

  // Master products list
  const [searchQ, setSearchQ] = useState('');
  const [masters, setMasters] = useState<MasterProductRecord[]>([]);
  const [stats, setStats] = useState({
    approved_masters: 0,
    pending_requests: 0,
    linked_listings: 0,
    multi_store_masters: 0,
  });

  // Create Master modal (auto-publishes directly into the live Store)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMaster, setNewMaster] = useState({
    canonical_name_ar: '',
    canonical_name_en: '',
    brand: '',
    category_id: '',
    category_path: '',
    barcode: '',
    size_label: '',
    image_url: '',
    description: '',
    usage_notes: '',
    ingredients: '',
    base_price: '',
    sale_price: '',
    stock_quantity: '50',
    merchant_id: '',
  });

  // Inspect Master & linked stores modal
  const [inspectedMaster, setInspectedMaster] = useState<{
    master: MasterProductRecord;
    listings: any[];
    attributes: any[];
  } | null>(null);

  // Requests tab
  const [reqFilter, setReqFilter] = useState<'pending' | 'all' | 'approved_new' | 'linked_existing' | 'rejected'>('pending');
  const [requests, setRequests] = useState<ProductMatchingRequestRecord[]>([]);
  const [linkTargetByReq, setLinkTargetByReq] = useState<Record<string, string>>({});
  const [reqCategoryFilter, setReqCategoryFilter] = useState<string>('ALL');
  const [reqBatchFilter, setReqBatchFilter] = useState<string>('ALL');
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [editingRequest, setEditingRequest] = useState<ProductMatchingRequestRecord | null>(null);
  const [savingReqEdit, setSavingReqEdit] = useState(false);
  const [editReqForm, setEditReqForm] = useState({
    product_name_ar: '',
    product_name_en: '',
    brand: '',
    category_id: '',
    category_path: '',
    size_label: '',
    barcode: '',
    image_url: '',
    proposed_price: '',
    proposed_stock: '',
    is_weighted: false,
    weight_step: '0.25',
    weight_unit: 'كجم',
  });

  const openEditRequestModal = (r: ProductMatchingRequestRecord) => {
    setEditingRequest(r);
    setEditReqForm({
      product_name_ar: r.product_name_ar || '',
      product_name_en: r.product_name_en || '',
      brand: r.brand || '',
      category_id: r.category_id || '',
      category_path: r.resolved_category_path || r.category_path || r.category_name || '',
      size_label: r.size_label || '',
      barcode: r.barcode || '',
      image_url: r.image_url || r.suggested_master_image || '',
      proposed_price: r.proposed_price !== undefined && r.proposed_price !== null ? String(r.proposed_price) : '0',
      proposed_stock: r.proposed_stock !== undefined && r.proposed_stock !== null ? String(r.proposed_stock) : '0',
      is_weighted: Boolean(r.is_weighted),
      weight_step: r.weight_step !== undefined && r.weight_step !== null ? String(r.weight_step) : '0.25',
      weight_unit: r.weight_unit || 'كجم',
    });
  };

  const handleUploadEditReqImage = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('يرجى اختيار ملف صورة صالح (JPG / PNG / WebP)');
      return;
    }
    try {
      const dataUrl = await compressRequestImage(file);
      setEditReqForm((prev) => ({ ...prev, image_url: dataUrl }));
    } catch (err) {
      onToast((err as Error).message || 'تعذر تجهيز الصورة');
    }
  };

  const handleSaveRequestEdit = async (approveAfter = false) => {
    if (!editingRequest) return;
    if (!editReqForm.product_name_ar.trim()) {
      onToast('يرجى إدخال اسم المنتج بالعربية');
      return;
    }
    setSavingReqEdit(true);
    try {
      await api.updateAdminMatchingRequest(editingRequest.id, {
        product_name_ar: editReqForm.product_name_ar.trim(),
        product_name_en: editReqForm.product_name_en.trim(),
        brand: editReqForm.brand.trim(),
        category_id: editReqForm.category_id || null,
        category_path: editReqForm.category_path.trim(),
        size_label: editReqForm.size_label.trim(),
        barcode: editReqForm.barcode.trim() || null,
        image_url: editReqForm.image_url.trim(),
        proposed_price: editReqForm.proposed_price === '' ? 0 : Number(editReqForm.proposed_price),
        proposed_stock: editReqForm.proposed_stock === '' ? 0 : Number(editReqForm.proposed_stock),
        is_weighted: Boolean(editReqForm.is_weighted),
        weight_step: Number(editReqForm.weight_step || 0.25),
        weight_unit: editReqForm.weight_unit || 'كجم',
      });
      if (approveAfter && editingRequest.status === 'pending') {
        await api.reviewAdminMatchingRequest(editingRequest.id, {
          decision: 'approve_smart',
          target_master_id: editingRequest.suggested_master_id || null,
          auto_create_listing: true,
        });
        onToast('تم حفظ تعديلات المنتج واعتماده ونشره بالقسم بنجاح');
      } else {
        onToast('تم حفظ تعديلات المنتج (الاسم، القسم، الصورة) بنجاح');
      }
      setEditingRequest(null);
      await Promise.all([loadRequests(), loadMasters()]);
      onRefresh();
    } catch (err) {
      onToast((err as Error).message || 'تعذر حفظ تعديلات المنتج');
    } finally {
      setSavingReqEdit(false);
    }
  };

  // Duplicates tab
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [manualSourceId, setManualSourceId] = useState('');
  const [manualTargetId, setManualTargetId] = useState('');

  // Banners & Deals tab
  const OTLOBHA_BANNER_SERVICES = [
    { key: 'pharmacy', label: 'الصيدليات (فارما اطلبها)' },
    { key: 'rides', label: 'اطلبها مشوار (توصيل ركاب)' },
    { key: 'parcels', label: 'أي حاجة (توصيل طرود ومشتريات)' },
    { key: 'market', label: 'سوق اطلبها (بيع وشراء)' },
    { key: 'free_order', label: 'طلب نصي حر (اطلب أي شيء)' },
    { key: 'stores', label: 'دليل جميع المتاجر' },
    { key: 'hub', label: 'مركز جميع الخدمات' },
  ] as const;

  const [banners, setBanners] = useState<StorefrontBannerRecord[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [newBanner, setNewBanner] = useState({
    title_ar: '',
    subtitle_ar: '',
    badge_ar: 'عرض اطلبها',
    banner_type: 'hero' as 'hero' | 'strip',
    cta_label: 'تسوّق الآن',
    destination_type: 'filter' as 'filter' | 'service' | 'category' | 'merchant',
    target_filter: 'offers',
    target_service: 'pharmacy',
    target_category_id: '',
    target_merchant_id: '',
    image_url: '',
    accent_color: '#A92224',
  });

  // Audit log tab
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const loadMasters = async (q = searchQ) => {
    setLoading(true);
    try {
      const res = await api.getAdminMasterProducts({ q, limit: 60 });
      setMasters(res.items || []);
      setStats(res.stats || stats);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = async (st = reqFilter) => {
    setLoading(true);
    try {
      const rows = await api.getAdminMatchingRequests(st);
      setRequests(rows || []);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const rows = await api.getAdminMasterDuplicates();
      setDuplicates(rows || []);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadBannersAndDeals = async () => {
    setLoading(true);
    try {
      const [bRows, dRows] = await Promise.all([api.getAdminStorefrontBanners(), api.getProductDeals()]);
      setBanners(bRows || []);
      setDeals(dRows || []);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadAudit = async () => {
    setLoading(true);
    try {
      const rows = await api.getMasterCatalogAudit();
      setAuditLogs(rows || []);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMasters();
  }, []);

  useEffect(() => {
    if (tab === 'requests') void loadRequests();
    else if (tab === 'duplicates') void loadDuplicates();
    else if (tab === 'banners') void loadBannersAndDeals();
    else if (tab === 'audit') void loadAudit();
  }, [tab, reqFilter]);

  const handleCreateMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAdminMasterProduct({
        ...newMaster,
        base_price: newMaster.base_price !== '' ? Number(newMaster.base_price) : 0,
        sale_price: newMaster.sale_price !== '' ? Number(newMaster.sale_price) : null,
        stock_quantity: newMaster.stock_quantity !== '' ? Number(newMaster.stock_quantity) : 50,
        merchant_id: newMaster.merchant_id || undefined,
      });
      onToast('تم إنشاء المنتج في الكتالوج المركزي ونشره مباشرة في المتجر بنجاح');
      setShowCreateModal(false);
      setNewMaster({
        canonical_name_ar: '',
        canonical_name_en: '',
        brand: '',
        category_id: '',
        category_path: '',
        barcode: '',
        size_label: '',
        image_url: '',
        description: '',
        usage_notes: '',
        ingredients: '',
        base_price: '',
        sale_price: '',
        stock_quantity: '50',
        merchant_id: '',
      });
      await loadMasters();
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleInspectMaster = async (masterId: string) => {
    try {
      const data = await api.getAdminMasterProductListings(masterId);
      setInspectedMaster(data);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleUnlinkListing = async (listingId: string) => {
    try {
      await api.unlinkMasterListing(listingId, 'فصل ارتباط من لوحة الإدارة');
      onToast('تم فصل عرض المتجر عن المنتج المركزي وتسجيل العملية في سجل التدقيق');
      if (inspectedMaster) {
        await handleInspectMaster(inspectedMaster.master.id);
      }
      await loadMasters();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleReviewRequest = async (
    reqId: string,
    decision: 'approve_smart' | 'approve_new' | 'link_existing' | 'reject',
    targetMasterId?: string | null
  ) => {
    try {
      await api.reviewAdminMatchingRequest(reqId, {
        decision,
        target_master_id: targetMasterId || null,
        auto_create_listing: true,
      });
      onToast(
        decision === 'approve_smart'
          ? 'تمت الموافقة ونشر المنتج في المنصة وفقًا لقسمه بنجاح'
          : decision === 'approve_new'
          ? 'تم اعتماد المنتج المركزي الجديد ونشره بالقسم بنجاح'
          : decision === 'link_existing'
          ? 'تم ربط طلب التاجر بالمنتج المركزي ونشره بالقسم بنجاح'
          : 'تم رفض الطلب'
      );
      await Promise.all([loadRequests(), loadMasters()]);
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleBulkReview = async (payload: {
    request_ids?: string[];
    batch_id?: string;
    category_path?: string;
    decision: 'approve_smart' | 'approve_new' | 'link_existing' | 'reject';
    label: string;
  }) => {
    setBulkReviewing(true);
    try {
      const res = await api.bulkReviewAdminMatchingRequests({
        request_ids: payload.request_ids,
        batch_id: payload.batch_id,
        category_path: payload.category_path,
        decision: payload.decision,
      });
      if (payload.decision === 'reject') {
        onToast(`تم رفض ${res.rejected_count} طلب من ${payload.label}`);
      } else {
        onToast(
          `تمت الموافقة والنشر بالمنصة (${res.processed_count} منتج: ${res.linked_existing_count} مرتبط بالمركزي، ${res.approved_new_count} مركزي جديد${
            res.categories_created_count > 0 ? `، ${res.categories_created_count} قسم جديد` : ''
          })`
        );
      }
      setReqCategoryFilter('ALL');
      setReqBatchFilter('ALL');
      await Promise.all([loadRequests(), loadMasters()]);
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBulkReviewing(false);
    }
  };

  const getReqCategoryLabel = (r: ProductMatchingRequestRecord) => {
    const raw = String(
      r.resolved_category_path || r.category_path || r.category_name || r.suggested_master_category_name || ''
    )
      .replace(/;+\s*$/g, '')
      .trim();
    return raw || 'عام';
  };

  const pendingBatches = useMemo(() => {
    const map = new Map<
      string,
      {
        batch_id: string;
        file_name: string;
        merchant_name: string;
        count: number;
        enriched_count: number;
        categories: Map<string, number>;
      }
    >();
    for (const r of requests) {
      if (r.status !== 'pending' || !r.batch_id) continue;
      let entry = map.get(r.batch_id);
      if (!entry) {
        entry = {
          batch_id: r.batch_id,
          file_name: r.source_file_name || 'ملف Excel',
          merchant_name: r.merchant_name || r.merchant_id,
          count: 0,
          enriched_count: 0,
          categories: new Map(),
        };
        map.set(r.batch_id, entry);
      }
      entry.count++;
      if (r.enriched_from_master || r.suggested_master_id) entry.enriched_count++;
      const catLabel = getReqCategoryLabel(r);
      entry.categories.set(catLabel, (entry.categories.get(catLabel) || 0) + 1);
    }
    return Array.from(map.values());
  }, [requests]);

  const requestCategoryBreakdown = useMemo(() => {
    const map = new Map<string, { label: string; rawPath: string; count: number; pendingIds: string[] }>();
    for (const r of requests) {
      if (reqBatchFilter !== 'ALL' && r.batch_id !== reqBatchFilter) continue;
      const label = getReqCategoryLabel(r);
      const existing = map.get(label);
      if (existing) {
        existing.count++;
        if (r.status === 'pending') existing.pendingIds.push(r.id);
      } else {
        map.set(label, {
          label,
          rawPath: r.category_path || label,
          count: 1,
          pendingIds: r.status === 'pending' ? [r.id] : [],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [requests, reqBatchFilter]);

  const visibleRequests = useMemo(() => {
    return requests.filter((r) => {
      if (reqBatchFilter !== 'ALL' && r.batch_id !== reqBatchFilter) return false;
      if (reqCategoryFilter !== 'ALL' && getReqCategoryLabel(r) !== reqCategoryFilter) return false;
      return true;
    });
  }, [requests, reqBatchFilter, reqCategoryFilter]);

  const visiblePendingIds = useMemo(
    () => visibleRequests.filter((r) => r.status === 'pending').map((r) => r.id),
    [visibleRequests]
  );

  const handleMergeMasters = async (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      onToast('يرجى اختيار منتجين مختلفين للدمج');
      return;
    }
    try {
      const res = await api.mergeAdminMasterProducts({
        source_master_id: sourceId,
        target_master_id: targetId,
        reason: 'توحيد منتجات مكررة من لوحة الكتالوج المركزي',
      });
      onToast(`تم الدمج بنجاح: نقل ${res.moved_listings} عروض متاجر بأمان`);
      setManualSourceId('');
      setManualTargetId('');
      await Promise.all([loadDuplicates(), loadMasters()]);
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDeleteAllMasters = async () => {
    if (!window.confirm('هل أنت متأكد من حذف جميع المنتجات في الكتالوج المركزي بالكامل؟ سيتم فك ارتباط المنتجات المرتبطة بالمتاجر.')) {
      return;
    }
    try {
      const res = await api.deleteAllAdminMasterProducts();
      onToast(res.message || 'تم حذف جميع المنتجات المركزية بنجاح');
      await loadMasters();
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleDeleteSingleMaster = async (masterId: string, nameAr: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف المنتج المركزي "${nameAr}"؟`)) {
      return;
    }
    try {
      const res = await api.deleteAdminMasterProduct(masterId);
      onToast(res.message || 'تم حذف المنتج المركزي بنجاح');
      await loadMasters();
      onRefresh();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleCreateBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newBanner.destination_type === 'category' && !newBanner.target_category_id) {
      onToast('يرجى اختيار القسم المطلوب ربط البانر به');
      return;
    }
    if (newBanner.destination_type === 'merchant' && !newBanner.target_merchant_id) {
      onToast('يرجى اختيار المتجر المطلوب ربط البانر به');
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        title_ar: newBanner.title_ar,
        subtitle_ar: newBanner.subtitle_ar,
        badge_ar: newBanner.badge_ar,
        banner_type: newBanner.banner_type,
        cta_label: newBanner.cta_label,
        image_url: newBanner.image_url.trim(),
        accent_color: newBanner.accent_color,
        target_filter:
          newBanner.destination_type === 'service'
            ? `service:${newBanner.target_service}`
            : newBanner.destination_type === 'filter'
            ? newBanner.target_filter
            : 'for_you',
        target_service: newBanner.destination_type === 'service' ? newBanner.target_service : '',
        target_category_id: newBanner.destination_type === 'category' ? newBanner.target_category_id : null,
        target_merchant_id: newBanner.destination_type === 'merchant' ? newBanner.target_merchant_id : null,
      };
      await api.createAdminStorefrontBanner(payload);
      onToast('تم إضافة بانر الواجهة الرئيسية بنجاح');
      setNewBanner({
        title_ar: '',
        subtitle_ar: '',
        badge_ar: 'عرض اطلبها',
        banner_type: 'hero',
        cta_label: 'تسوّق الآن',
        destination_type: 'filter',
        target_filter: 'offers',
        target_service: 'pharmacy',
        target_category_id: '',
        target_merchant_id: '',
        image_url: '',
        accent_color: '#A92224',
      });
      await loadBannersAndDeals();
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const describeBannerDestination = (b: StorefrontBannerRecord): string => {
    const tf = String(b.target_filter || '');
    const srvKey = (b.target_service || (tf.startsWith('service:') ? tf.slice('service:'.length) : '')).trim();
    if (srvKey) {
      const found = OTLOBHA_BANNER_SERVICES.find((s) => s.key === srvKey);
      return `خدمة: ${found ? found.label : srvKey}`;
    }
    if (b.target_category_id) {
      const cat = categories.find((c) => c.id === b.target_category_id);
      return `قسم: ${cat ? cat.name_ar : b.target_category_id}`;
    }
    if (b.target_merchant_id) {
      const mer = merchants.find((m) => m.id === b.target_merchant_id);
      return `متجر: ${mer ? mer.business_name_ar : b.target_merchant_id}`;
    }
    if (tf === 'free_delivery') return 'فلتر: التوصيل المجاني';
    if (tf === 'fresh') return 'فلتر: المنتجات الطازجة';
    if (tf === 'groceries') return 'فلتر: المقاضي';
    if (tf === 'for_you') return 'فلتر: الكل';
    return 'فلتر: العروض والخصومات';
  };

  const merchantCategories = categories.filter((c) => !c.merchant_id && c.scope !== 'market');

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-[#A92224] via-[#8E1B1D] to-[#6E1315] text-white rounded-3xl p-6 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#F5A623] bg-white/10 px-3 py-1 rounded-full mb-2">
              <Layers className="w-3.5 h-3.5" />
              الكتالوج المركزي الموحّد ومقارنة أسعار المتاجر
            </div>
            <h2 className="text-2xl font-black">إدارة المنتجات المركزية وتوحيد المتاجر</h2>
            <p className="text-sm text-white/80 mt-1 max-w-2xl">
              منع تكرار المنتجات بين المتاجر، مراجعة طلبات التجار، دمج التكرارات بأمان، وضمان مقارنة أسعار دقيقة 100% لنفس العلامة التجارية والحجم.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setExcelMode('import');
                setTab('excel');
              }}
              className="px-3.5 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/25 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Upload className="w-4 h-4 text-[#F5A623]" />
              رفع بالـ Excel
            </button>
            <button
              onClick={() => {
                setExcelMode('compare');
                setTab('excel');
              }}
              className="px-3.5 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/25 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <GitCompare className="w-4 h-4 text-[#F5A623]" />
              مقارنة Excel
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2.5 rounded-2xl bg-[#F5A623] hover:bg-[#E0961A] text-[#3B180E] font-black text-sm flex items-center gap-2 shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              إضافة منتج مركزي معتمد
            </button>
            <button
              onClick={() => void handleDeleteAllMasters()}
              className="px-3.5 py-2.5 rounded-2xl bg-red-950/40 hover:bg-red-950/70 border border-red-400/40 text-red-200 hover:text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
              title="حذف جميع المنتجات في الكتالوج المركزي"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              حذف كل الكتالوج
            </button>
            <button
              onClick={() => void loadMasters()}
              className="p-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white transition cursor-pointer"
              title="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/15">
            <div className="text-xs text-white/75 font-semibold">المنتجات المركزية المعتمدة</div>
            <div className="text-2xl font-black mt-1">{stats.approved_masters}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/15">
            <div className="text-xs text-white/75 font-semibold">منتجات متعددة المتاجر (للمقارنة)</div>
            <div className="text-2xl font-black text-[#F5A623] mt-1">{stats.multi_store_masters}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/15">
            <div className="text-xs text-white/75 font-semibold">إجمالي عروض المتاجر المرتبطة</div>
            <div className="text-2xl font-black mt-1">{stats.linked_listings}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/15">
            <div className="text-xs text-white/75 font-semibold">طلبات تجار قيد المراجعة</div>
            <div className="text-2xl font-black text-amber-300 mt-1">{stats.pending_requests}</div>
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
        {[
          { id: 'masters', label: 'المنتجات المركزية', icon: Package, badge: stats.approved_masters },
          { id: 'excel', label: 'رفع ومقارنة Excel', icon: FileSpreadsheet },
          { id: 'requests', label: 'طلبات التجار للمراجعة', icon: AlertTriangle, badge: stats.pending_requests },
          { id: 'duplicates', label: 'اكتشاف ودمج التكرارات', icon: GitMerge, badge: duplicates.length || undefined },
          { id: 'banners', label: 'بانرات الواجهة وعروض التوفير', icon: Sparkles },
          { id: 'audit', label: 'سجل الدمج والتدقيق', icon: History },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as AdminCatalogTab)}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
                active
                  ? 'bg-[#A92224] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[11px] font-black ${
                    active ? 'bg-[#F5A623] text-[#3B180E]' : 'bg-red-100 text-[#A92224]'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1B: EXCEL IMPORT & COMPARE */}
      {tab === 'excel' && (
        <MasterCatalogExcelPanel
          key={excelMode}
          categories={categories}
          merchants={merchants}
          initialMode={excelMode}
          onImported={() => {
            void loadMasters();
            onRefresh();
          }}
          onToast={onToast}
        />
      )}

      {/* TAB 1: MASTER PRODUCTS */}
      {tab === 'masters' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadMasters(searchQ)}
                placeholder="ابحث بالاسم، العلامة التجارية، أو الباركود..."
                className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#A92224] focus:outline-none"
              />
            </div>
            <button
              onClick={() => void loadMasters(searchQ)}
              className="px-4 py-2.5 rounded-xl bg-[#A92224] text-white text-sm font-bold hover:bg-[#86191B] cursor-pointer"
            >
              بحث
            </button>
          </div>

          {masters.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Package className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="font-bold">لا توجد منتجات مركزية مطابقة حاليًا</p>
              <p className="text-xs mt-1">أضف منتجًا مركزيًا جديدًا أو اعتمد طلبات التجار لتوحيد مقارنة الأسعار.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-xs">
                    <th className="py-3 px-2">المنتج المركزي</th>
                    <th className="py-3 px-2">العلامة والحجم</th>
                    <th className="py-3 px-2">الباركود</th>
                    <th className="py-3 px-2">عدد المتاجر</th>
                    <th className="py-3 px-2">نطاق السعر</th>
                    <th className="py-3 px-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {masters.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-3">
                          {m.image_url ? (
                            <img src={m.image_url} alt={m.canonical_name_ar} className="w-11 h-11 rounded-xl object-cover border border-slate-200" />
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-red-50 text-[#A92224] flex items-center justify-center font-black">
                              <Package className="w-5 h-5" />
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-900">{m.canonical_name_ar}</div>
                            <div className="text-xs text-slate-500">
                              {(m.category_path ? m.category_path.replace(/;\s*$/, '') : m.category_name) || 'عام'}
                              {m.canonical_name_en ? ` · ${m.canonical_name_en}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-bold text-slate-800">{m.brand || '—'}</div>
                        <div className="text-xs text-[#A92224] font-bold">{m.size_label || 'غير محدد'}</div>
                      </td>
                      <td className="py-3 px-2 font-mono text-xs text-slate-600">{m.barcode || '—'}</td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                          (m.active_stores_count || 0) >= 2
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          <Store className="w-3.5 h-3.5" />
                          {m.active_stores_count || 0} متجر نشط
                        </span>
                      </td>
                      <td className="py-3 px-2 font-bold">
                        {m.lowest_price !== null && m.lowest_price !== undefined ? (
                          <div>
                            <span className="text-emerald-700">{m.lowest_price} ج.م</span>
                            {m.highest_price && m.highest_price > m.lowest_price && (
                              <span className="text-xs text-slate-400 mr-1">حتى {m.highest_price} ج.م</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">بدون عروض بعد</span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void handleInspectMaster(m.id)}
                            className="px-3 py-1.5 rounded-xl bg-red-50 text-[#A92224] hover:bg-red-100 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            المتاجر والأسعار
                          </button>
                          <button
                            onClick={() => void handleDeleteSingleMaster(m.id, m.canonical_name_ar)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-red-700 hover:bg-red-50 text-xs font-bold inline-flex items-center cursor-pointer"
                            title="حذف هذا المنتج المركزي"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MERCHANT MATCHING & EXCEL APPROVAL REQUESTS */}
      {tab === 'requests' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'pending', label: 'قيد الموافقة' },
                { id: 'approved_new', label: 'تم اعتمادها كجديدة' },
                { id: 'linked_existing', label: 'تم ربطها بالمركزي' },
                { id: 'rejected', label: 'مرفوضة' },
                { id: 'all', label: 'الكل' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setReqFilter(f.id as any);
                    setReqCategoryFilter('ALL');
                    setReqBatchFilter('ALL');
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                    reqFilter === f.id ? 'bg-[#A92224] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {visiblePendingIds.length > 0 && (
              <button
                type="button"
                disabled={bulkReviewing}
                onClick={() =>
                  void handleBulkReview({
                    request_ids: visiblePendingIds,
                    decision: 'approve_smart',
                    label: reqCategoryFilter !== 'ALL' ? `قسم ${reqCategoryFilter}` : 'جميع الطلبات المعروضة',
                  })
                }
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                {bulkReviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {reqCategoryFilter !== 'ALL'
                  ? `موافقة ونشر قسم «${reqCategoryFilter}» بالكامل (${visiblePendingIds.length})`
                  : `موافقة ونشر الكل بالمنصة حسب الأقسام (${visiblePendingIds.length})`}
              </button>
            )}
          </div>

          {/* Excel Batches Pending Approval */}
          {reqFilter === 'pending' && pendingBatches.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-[#A92224]" />
                ملفات Excel مرفوعة من التجار بانتظار موافقة الإدارة:
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {pendingBatches.map((batch) => {
                  const isFiltered = reqBatchFilter === batch.batch_id;
                  return (
                    <div
                      key={batch.batch_id}
                      className={`rounded-2xl border-2 p-4 space-y-3 transition ${
                        isFiltered ? 'border-[#A92224] bg-red-50/40' : 'border-amber-200 bg-amber-50/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                            <FileSpreadsheet className="w-4 h-4 text-[#A92224]" />
                            {batch.file_name}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            التاجر: <b>{batch.merchant_name}</b> · <b>{batch.count}</b> منتج ·{' '}
                            <span className="text-emerald-700 font-bold">{batch.enriched_count} مطابق ومُستكمل من المركزي</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setReqBatchFilter(isFiltered ? 'ALL' : batch.batch_id);
                            setReqCategoryFilter('ALL');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[11px] font-bold text-slate-700 cursor-pointer"
                        >
                          {isFiltered ? 'إظهار الكل' : 'عرض منتجات الملف'}
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(batch.categories.entries()).map(([cat, cnt]) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => {
                              setReqBatchFilter(batch.batch_id);
                              setReqCategoryFilter(cat);
                            }}
                            className="px-2 py-0.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-slate-800 hover:border-[#A92224] cursor-pointer"
                          >
                            {cat} ({cnt})
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={bulkReviewing}
                          onClick={() =>
                            void handleBulkReview({
                              batch_id: batch.batch_id,
                              decision: 'approve_smart',
                              label: batch.file_name,
                            })
                          }
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          موافقة ونشر الدفعة كاملة حسب الأقسام ({batch.count})
                        </button>
                        <button
                          type="button"
                          disabled={bulkReviewing}
                          onClick={() =>
                            void handleBulkReview({
                              batch_id: batch.batch_id,
                              decision: 'reject',
                              label: batch.file_name,
                            })
                          }
                          className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          رفض الدفعة
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category Filter Chips */}
          {requestCategoryBreakdown.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <div className="text-[11px] font-black text-slate-700 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-[#A92224]" />
                تصفية ومراجعة حسب القسم:
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setReqCategoryFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                    reqCategoryFilter === 'ALL'
                      ? 'bg-[#A92224] text-white border-[#A92224]'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  كل الأقسام ({requests.filter((r) => reqBatchFilter === 'ALL' || r.batch_id === reqBatchFilter).length})
                </button>
                {requestCategoryBreakdown.map((cat) => (
                  <button
                    key={cat.label}
                    type="button"
                    onClick={() => setReqCategoryFilter(cat.label)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                      reqCategoryFilter === cat.label
                        ? 'bg-[#A92224] text-white border-[#A92224]'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-red-300'
                    }`}
                  >
                    {cat.label} ({cat.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {visibleRequests.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm font-bold">
              لا توجد طلبات منتجات جديدة في هذه الحالة حاليًا.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRequests.map((r) => {
                const thumb = r.image_url || r.suggested_master_image;
                const catLabel = getReqCategoryLabel(r);
                return (
                  <div key={r.id} className="rounded-2xl border border-slate-200 p-4 bg-slate-50/60 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={r.product_name_ar}
                            className="w-14 h-14 rounded-2xl object-cover border border-slate-200 bg-white shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-slate-200/70 flex items-center justify-center text-slate-400 shrink-0">
                            <ImageIcon className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-black text-slate-900 text-base">{r.product_name_ar}</span>
                            {r.size_label && (
                              <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 text-xs font-bold">
                                {r.size_label}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-900 text-xs font-bold inline-flex items-center gap-1">
                              <FolderTree className="w-3 h-3" />
                              {catLabel}
                            </span>
                            {r.source_file_name && (
                              <span className="px-2 py-0.5 rounded-lg bg-slate-200/80 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1">
                                <FileSpreadsheet className="w-3 h-3" />
                                {r.source_file_name}
                              </span>
                            )}
                            {Boolean(r.enriched_from_master) && (
                              <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                                مُستكمل من الكتالوج المركزي
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-3">
                            <span>المتجر: <b>{r.merchant_name || r.merchant_id}</b></span>
                            <span>العلامة: <b>{r.brand || '—'}</b></span>
                            <span>الباركود: <b className="font-mono">{r.barcode || '—'}</b></span>
                            <span>السعر المقترح: <b className="text-[#A92224]">{r.proposed_price} ج.م</b></span>
                            <span>المخزون: <b>{r.proposed_stock}</b></span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditRequestModal(r)}
                          className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:border-[#A92224] hover:text-[#A92224] text-slate-800 text-xs font-black inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          title="تعديل الاسم والقسم والصورة"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          تعديل
                        </button>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            r.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : r.status === 'rejected'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {r.status === 'pending'
                            ? 'قيد الموافقة'
                            : r.status === 'approved_new'
                            ? 'تم اعتماده ونشره ✓'
                            : r.status === 'linked_existing'
                            ? 'تم ربطه ونشره ✓'
                            : 'مرفوض'}
                        </span>
                      </div>
                    </div>

                    {r.suggested_master_id && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900 flex items-center justify-between gap-2">
                        <span>
                          <Sparkles className="w-3.5 h-3.5 inline ml-1" />
                          مطابقة الكتالوج المركزي: <b>{r.suggested_master_name}</b> ({r.suggested_master_size || 'نفس المواصفات'}) · درجة الثقة: <b>{r.match_confidence}%</b>
                        </span>
                      </div>
                    )}

                    {r.status === 'pending' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => void handleReviewRequest(r.id, 'approve_smart', r.suggested_master_id)}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {r.suggested_master_id
                            ? 'موافقة ونشر بالقسم (ربط تلقائي بالمركزي)'
                            : 'موافقة ونشر بالقسم (إضافة للمركزي)'}
                        </button>

                        <button
                          onClick={() => void handleReviewRequest(r.id, 'approve_new')}
                          className="px-3 py-2 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          اعتماد كمنتج جديد منفصل
                        </button>

                        <div className="flex items-center gap-1.5">
                          <select
                            value={linkTargetByReq[r.id] || r.suggested_master_id || ''}
                            onChange={(e) => setLinkTargetByReq((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white max-w-[220px]"
                          >
                            <option value="">اختر منتجًا مركزيًا للربط...</option>
                            {masters.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.canonical_name_ar} {m.size_label ? `(${m.size_label})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() =>
                              void handleReviewRequest(r.id, 'link_existing', linkTargetByReq[r.id] || r.suggested_master_id)
                            }
                            className="px-3 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            ربط بموجود
                          </button>
                        </div>

                        <button
                          onClick={() => void handleReviewRequest(r.id, 'reject')}
                          className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          رفض
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DUPLICATES & MERGE */}
      {tab === 'duplicates' && (
        <div className="space-y-4">
          {/* Manual Safe Merge */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h3 className="font-black text-slate-900 flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-[#A92224]" />
              دمج يدوي آمن لمنتجين مركزيين
            </h3>
            <p className="text-xs text-slate-500">
              يتم نقل جميع عروض المتاجر والأسعار والصور من المنتج المصدر إلى المنتج الهدف داخل معاملة واحدة آمنة مع تسجيل العملية بالكامل.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={manualSourceId}
                onChange={(e) => setManualSourceId(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              >
                <option value="">المنتج المصدر (المكرر الذي سيُدمج)...</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.canonical_name_ar} {m.size_label ? `(${m.size_label})` : ''}
                  </option>
                ))}
              </select>
              <select
                value={manualTargetId}
                onChange={(e) => setManualTargetId(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              >
                <option value="">المنتج الهدف (الرسمي المعتمد)...</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.canonical_name_ar} {m.size_label ? `(${m.size_label})` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleMergeMasters(manualSourceId, manualTargetId)}
                className="px-4 py-2.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white font-bold text-sm cursor-pointer"
              >
                تنفيذ الدمج الآمن
              </button>
            </div>
          </div>

          {/* Auto-detected potential duplicates */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-3">
            <h3 className="font-black text-slate-900">التكرارات المحتملة المكتشفة تلقائيًا</h3>
            {duplicates.length === 0 ? (
              <div className="text-center py-8 text-emerald-700 bg-emerald-50 rounded-2xl text-sm font-bold">
                ممتاز! لم يتم اكتشاف أي تكرارات محتملة بين المنتجات المركزية حاليًا.
              </div>
            ) : (
              <div className="space-y-3">
                {duplicates.map((pair, idx) => (
                  <div key={idx} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1 text-sm">
                      <div className="font-bold text-slate-900">
                        1) {pair.master_a.canonical_name_ar} ({pair.master_a.size_label || '—'})
                        <span className="mx-2 text-[#A92224]">↔</span>
                        2) {pair.master_b.canonical_name_ar} ({pair.master_b.size_label || '—'})
                      </div>
                      <div className="text-xs text-amber-800">
                        نسبة التطابق: <b>{pair.confidence_score}%</b> · {(pair.reasons || []).join(' · ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleMergeMasters(pair.master_b.id, pair.master_a.id)}
                        className="px-3 py-1.5 rounded-xl bg-[#A92224] text-white text-xs font-bold cursor-pointer"
                      >
                        دمج (2) داخل (1)
                      </button>
                      <button
                        onClick={() => void handleMergeMasters(pair.master_a.id, pair.master_b.id)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 text-white text-xs font-bold cursor-pointer"
                      >
                        دمج (1) داخل (2)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: BANNERS & DEALS */}
      {tab === 'banners' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#A92224]" />
              بانرات الصفحة الرئيسية لمتجر اطلبها
            </h3>
            <form onSubmit={handleCreateBanner} className="space-y-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <input
                required
                value={newBanner.title_ar}
                onChange={(e) => setNewBanner({ ...newBanner, title_ar: e.target.value })}
                placeholder="عنوان البانر (مثال: اطلب مشوارك الآن بأرخص سعر أو توصيل مجاني)"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <input
                value={newBanner.subtitle_ar}
                onChange={(e) => setNewBanner({ ...newBanner, subtitle_ar: e.target.value })}
                placeholder="وصف مختصر للعرض أو الخدمة..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newBanner.badge_ar}
                  onChange={(e) => setNewBanner({ ...newBanner, badge_ar: e.target.value })}
                  placeholder="الشارة (مثال: خدمة جديدة / عرض اطلبها)"
                  className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                />
                <input
                  value={newBanner.cta_label}
                  onChange={(e) => setNewBanner({ ...newBanner, cta_label: e.target.value })}
                  placeholder="نص الزر (مثال: اطلب الخدمة الآن)"
                  className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                />
              </div>

              {/* Destination Type Selector: Service / Filter / Category / Merchant */}
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newBanner.banner_type}
                  onChange={(e) => setNewBanner({ ...newBanner, banner_type: e.target.value as any })}
                  className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white font-bold"
                >
                  <option value="hero">بانر رئيسي (Hero)</option>
                  <option value="strip">شريط إعلاني (Strip)</option>
                </select>
                <select
                  value={newBanner.destination_type}
                  onChange={(e) => {
                    const nextDest = e.target.value as 'filter' | 'service' | 'category' | 'merchant';
                    setNewBanner({
                      ...newBanner,
                      destination_type: nextDest,
                      cta_label:
                        nextDest === 'service' && (newBanner.cta_label === 'تسوّق الآن' || !newBanner.cta_label)
                          ? 'اطلب الخدمة الآن'
                          : nextDest !== 'service' && newBanner.cta_label === 'اطلب الخدمة الآن'
                          ? 'تسوّق الآن'
                          : newBanner.cta_label,
                    });
                  }}
                  className="px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white font-bold text-[#A92224]"
                >
                  <option value="service">وجهة: خدمة من خدمات اطلبها</option>
                  <option value="filter">وجهة: عروض / فلتر منتجات</option>
                  <option value="category">وجهة: قسم محدد</option>
                  <option value="merchant">وجهة: متجر محدد</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  {newBanner.destination_type === 'service' && (
                    <select
                      value={newBanner.target_service}
                      onChange={(e) => setNewBanner({ ...newBanner, target_service: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border border-[#A92224]/30 text-xs bg-white font-bold"
                    >
                      {OTLOBHA_BANNER_SERVICES.map((srv) => (
                        <option key={srv.key} value={srv.key}>
                          {srv.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {newBanner.destination_type === 'filter' && (
                    <select
                      value={newBanner.target_filter}
                      onChange={(e) => setNewBanner({ ...newBanner, target_filter: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="offers">العروض والخصومات</option>
                      <option value="free_delivery">التوصيل المجاني</option>
                      <option value="fresh">المنتجات الطازجة</option>
                      <option value="groceries">المقاضي</option>
                    </select>
                  )}

                  {newBanner.destination_type === 'category' && (
                    <select
                      value={newBanner.target_category_id}
                      onChange={(e) => setNewBanner({ ...newBanner, target_category_id: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="">-- اختر القسم --</option>
                      {merchantCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_path_ar || c.name_ar}
                        </option>
                      ))}
                    </select>
                  )}

                  {newBanner.destination_type === 'merchant' && (
                    <select
                      value={newBanner.target_merchant_id}
                      onChange={(e) => setNewBanner({ ...newBanner, target_merchant_id: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="">-- اختر المتجر --</option>
                      {merchants.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.business_name_ar}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl bg-[#A92224] text-white text-xs font-bold cursor-pointer hover:brightness-105"
                >
                  إضافة بانر
                </button>
              </div>

              <input
                value={newBanner.image_url}
                onChange={(e) => setNewBanner({ ...newBanner, image_url: e.target.value })}
                placeholder="رابط صورة اختيارية لخلفية البانر (URL)"
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
              />
            </form>

            <div className="space-y-2">
              {banners.map((b) => {
                const isActive = Boolean(b.is_active);
                const isServiceTarget = Boolean(b.target_service || String(b.target_filter || '').startsWith('service:'));
                return (
                  <div
                    key={b.id}
                    className={`rounded-2xl border p-3 flex items-center justify-between gap-3 ${
                      isActive ? 'border-slate-200 bg-white' : 'border-slate-200/70 bg-slate-50 opacity-65'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{b.title_ar}</span>
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                            isServiceTarget
                              ? 'bg-[#FEF2F2] text-[#A92224]'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {describeBannerDestination(b)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {b.subtitle_ar || 'بدون وصف'} · ({b.banner_type === 'strip' ? 'شريط' : 'رئيسي'})
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateAdminStorefrontBanner(b.id, { is_active: !isActive });
                          onToast(isActive ? 'تم إيقاف البانر مؤقتًا' : 'تم تفعيل البانر');
                          await loadBannersAndDeals();
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                      >
                        {isActive ? 'نشط' : 'متوقف'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteAdminStorefrontBanner(b.id);
                          onToast('تم حذف البانر');
                          await loadBannersAndDeals();
                        }}
                        className="p-2 rounded-xl text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="font-black text-slate-900 flex items-center gap-2">
              <Tag className="w-4 h-4 text-[#F5A623]" />
              عروض التوفير والهدايا المجانية النشطة ({deals.length})
            </h3>
            {deals.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                يمكن للتجار أو الإدارة إضافة عروض التوفير (اشترِ واحصل على هدية / خصم كمية) من قسم «منتجات المتاجر».
              </div>
            ) : (
              <div className="space-y-2">
                {deals.map((d) => (
                  <div key={d.id} className="rounded-2xl border border-slate-200 p-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{d.title_ar}</div>
                      <div className="text-xs text-slate-500">
                        {d.merchant_name || 'عرض منصة'} · {d.product_name_ar || 'عام'} · ({d.deal_type})
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await api.deleteProductDeal(d.id);
                        onToast('تم حذف عرض التوفير');
                        await loadBannersAndDeals();
                      }}
                      className="p-2 rounded-xl text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOG */}
      {tab === 'audit' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="font-black text-slate-900">سجل عمليات التوحيد والدمج وفصل الارتباط</h3>
          {auditLogs.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">لا توجد عمليات مسجلة بعد.</div>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((a) => (
                <div key={a.id} className="rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="px-2 py-0.5 rounded-lg bg-red-50 text-[#A92224] font-bold ml-2">{a.action}</span>
                    <span className="font-bold text-slate-900">{a.reason}</span>
                    <span className="text-slate-500 mr-2">بواسطة {a.actor_name}</span>
                  </div>
                  <span className="text-slate-400 font-mono">{a.created_at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: CREATE NEW MASTER PRODUCT (AUTO-PUBLISHES TO STORE) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">إضافة منتج جديد (الكتالوج المركزي + المتجر)</h3>
                <p className="text-xs text-slate-500 mt-0.5">يُضاف المنتج تلقائيًا للكتالوج المركزي ويُعرض مباشرة للعملاء في المتجر.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateMaster} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700">الاسم الرسمي بالعربية *</label>
                  <input
                    required
                    value={newMaster.canonical_name_ar}
                    onChange={(e) => setNewMaster({ ...newMaster, canonical_name_ar: e.target.value })}
                    placeholder="مثال: نسكافيه كلاسيك 200 جرام"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">الاسم بالإنجليزية</label>
                  <input
                    value={newMaster.canonical_name_en}
                    onChange={(e) => setNewMaster({ ...newMaster, canonical_name_en: e.target.value })}
                    placeholder="Nescafe Classic 200g"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">السعر الأساسي في المتجر (ج.م) *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    value={newMaster.base_price}
                    onChange={(e) => setNewMaster({ ...newMaster, base_price: e.target.value })}
                    placeholder="مثال: 45"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">سعر العرض / الخصم (اختياري)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={newMaster.sale_price}
                    onChange={(e) => setNewMaster({ ...newMaster, sale_price: e.target.value })}
                    placeholder="اتركه فارغًا بدون خصم"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">المخزون المتاح</label>
                  <input
                    type="number"
                    min="0"
                    value={newMaster.stock_quantity}
                    onChange={(e) => setNewMaster({ ...newMaster, stock_quantity: e.target.value })}
                    placeholder="50"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">المتجر المستهدف</label>
                  <select
                    value={newMaster.merchant_id}
                    onChange={(e) => setNewMaster({ ...newMaster, merchant_id: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
                  >
                    <option value="">متجر اطلبها الرئيسي (تلقائي)</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.business_name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">العلامة التجارية (اختياري)</label>
                  <input
                    value={newMaster.brand}
                    onChange={(e) => setNewMaster({ ...newMaster, brand: e.target.value })}
                    placeholder="مثال: نسكافيه"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">الحجم / الوزن / السعة (اختياري)</label>
                  <input
                    value={newMaster.size_label}
                    onChange={(e) => setNewMaster({ ...newMaster, size_label: e.target.value })}
                    placeholder="مثال: 200 جرام أو 1 لتر"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Barcode className="w-3.5 h-3.5" /> الباركود الدولي (اختياري)
                  </label>
                  <input
                    value={newMaster.barcode}
                    onChange={(e) => setNewMaster({ ...newMaster, barcode: e.target.value })}
                    placeholder="6221031002001"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                  />
                </div>
                <div className="md:col-span-2">
                  <CategoryPathPicker
                    categories={merchantCategories}
                    valueCategoryId={newMaster.category_id}
                    valueCategoryPath={newMaster.category_path}
                    compact
                    label="مسار المنتج في الأقسام (رئيسي ← فرعي ← القسم الأخير)"
                    onChange={({ category_id, category_path }) =>
                      setNewMaster((prev) => ({ ...prev, category_id, category_path }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">رابط الصورة الرسمية</label>
                <input
                  value={newMaster.image_url}
                  onChange={(e) => setNewMaster({ ...newMaster, image_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">الوصف والمواصفات</label>
                <textarea
                  rows={2}
                  value={newMaster.description}
                  onChange={(e) => setNewMaster({ ...newMaster, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-sm font-bold cursor-pointer"
                >
                  حفظ ونشر في الكتالوج المركزي والمتجر
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: INSPECT MASTER PRODUCT STORES & PRICES */}
      {inspectedMaster && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl max-h-[88vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-[#A92224]">{inspectedMaster.master.brand} · {inspectedMaster.master.size_label}</div>
                <h3 className="text-xl font-black text-slate-900">{inspectedMaster.master.canonical_name_ar}</h3>
                {inspectedMaster.master.barcode && (
                  <div className="text-xs font-mono text-slate-500 mt-0.5">باركود: {inspectedMaster.master.barcode}</div>
                )}
              </div>
              <button onClick={() => setInspectedMaster(null)} className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-black text-slate-800">المتاجر المرتبطة وأسعارها (مرتبة من الأرخص للأعلى)</h4>
              {inspectedMaster.listings.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-50 text-slate-500 text-sm">
                  لا توجد متاجر مرتبطة بهذا المنتج المركزي حتى الآن.
                </div>
              ) : (
                inspectedMaster.listings.map((l, idx) => {
                  const eff = l.sale_price !== null && l.sale_price < l.base_price ? l.sale_price : l.base_price;
                  return (
                    <div
                      key={l.id}
                      className={`rounded-2xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                        idx === 0 && l.is_available ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <span>{l.merchant_name}</span>
                          {idx === 0 && l.is_available ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black">
                              الأقل سعرًا
                            </span>
                          ) : null}
                          {!l.is_available && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold">
                              غير متاح
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          المخزون: {l.stock_quantity} · SKU: {l.merchant_sku || l.product_code}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-left">
                          <div className="text-base font-black text-[#A92224]">{eff} ج.م</div>
                          {l.sale_price !== null && l.sale_price < l.base_price && (
                            <div className="text-[11px] line-through text-slate-400">{l.base_price} ج.م</div>
                          )}
                        </div>
                        <button
                          onClick={() => void handleUnlinkListing(l.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                          title="فصل الارتباط عن المنتج المركزي"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                          فصل
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT MERCHANT CATALOG MATCHING REQUEST (NAME, CATEGORY, IMAGE & DETAILS) */}
      {editingRequest && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-[#A92224]" />
                  تعديل بيانات المنتج قبل الاعتماد
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  المتجر: <b>{editingRequest.merchant_name || editingRequest.merchant_id}</b> — عدّل الاسم أو القسم أو الصورة ثم احفظ أو اعتمد مباشرة.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRequest(null)}
                className="p-2 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Image Preview + Direct Upload + URL */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <div className="flex items-center gap-3.5">
                  {editReqForm.image_url ? (
                    <img
                      src={editReqForm.image_url}
                      alt={editReqForm.product_name_ar}
                      className="w-20 h-20 rounded-2xl object-cover border border-slate-200 bg-white shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-slate-200/80 flex items-center justify-center text-slate-400 shrink-0">
                      <ImageIcon className="w-7 h-7" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="text-xs font-black text-slate-800">صورة المنتج</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="px-3 py-1.5 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>رفع صورة من الجهاز</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            void handleUploadEditReqImage(file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                      {editReqForm.image_url && (
                        <button
                          type="button"
                          onClick={() => setEditReqForm((prev) => ({ ...prev, image_url: '' }))}
                          className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-red-50 hover:text-red-700 text-slate-600 text-xs font-bold cursor-pointer"
                        >
                          إزالة الصورة
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600">أو رابط الصورة المباشر</label>
                  <input
                    dir="ltr"
                    value={editReqForm.image_url}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, image_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-mono"
                  />
                </div>
              </div>

              {/* Name Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700">اسم المنتج بالعربية *</label>
                  <input
                    required
                    value={editReqForm.product_name_ar}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, product_name_ar: e.target.value }))}
                    placeholder="مثال: لبن جهينة كامل الدسم 1 لتر"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">الاسم بالإنجليزية (اختياري)</label>
                  <input
                    dir="ltr"
                    value={editReqForm.product_name_en}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, product_name_en: e.target.value }))}
                    placeholder="Juhayna Full Cream Milk 1L"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
              </div>

              {/* Category Picker */}
              <div>
                <CategoryPathPicker
                  categories={merchantCategories}
                  valueCategoryId={editReqForm.category_id}
                  valueCategoryPath={editReqForm.category_path}
                  compact
                  label="القسم (اختر القسم الرئيسي أو الفرعي)"
                  onChange={({ category_id, category_path }) =>
                    setEditReqForm((prev) => ({ ...prev, category_id, category_path }))
                  }
                />
              </div>

              {/* Brand / Size / Price / Stock */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-700">العلامة التجارية</label>
                  <input
                    value={editReqForm.brand}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, brand: e.target.value }))}
                    className="w-full mt-1 px-2.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700">الحجم / الوزن</label>
                  <input
                    value={editReqForm.size_label}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, size_label: e.target.value }))}
                    className="w-full mt-1 px-2.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700">السعر (ج.م)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editReqForm.proposed_price}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, proposed_price: e.target.value }))}
                    className="w-full mt-1 px-2.5 py-2 rounded-xl border border-slate-200 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700">المخزون</label>
                  <input
                    type="number"
                    min="0"
                    value={editReqForm.proposed_stock}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, proposed_stock: e.target.value }))}
                    className="w-full mt-1 px-2.5 py-2 rounded-xl border border-slate-200 text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editReqForm.is_weighted}
                    onChange={(e) => setEditReqForm((prev) => ({ ...prev, is_weighted: e.target.checked }))}
                  />
                  <span>منتج يُباع بالوزن (زيادة بأقل من واحد صحيح مثل 0.25 أو 0.5)</span>
                </label>
                {editReqForm.is_weighted && (
                  <div className="flex flex-wrap items-center gap-2">
                    {[0.1, 0.125, 0.25, 0.5].map((stepVal) => (
                      <button
                        key={stepVal}
                        type="button"
                        onClick={() => setEditReqForm((prev) => ({ ...prev, weight_step: String(stepVal) }))}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                          Math.abs(Number(editReqForm.weight_step) - stepVal) < 0.001
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white text-amber-900 border-amber-200'
                        }`}
                      >
                        {stepVal}
                      </button>
                    ))}
                    <input
                      type="number"
                      min="0.05"
                      max="10"
                      step="0.05"
                      value={editReqForm.weight_step}
                      onChange={(e) => setEditReqForm((prev) => ({ ...prev, weight_step: e.target.value }))}
                      className="w-20 px-2 py-1 text-xs rounded-lg border border-amber-300 bg-white tabular-nums"
                    />
                    <select
                      value={editReqForm.weight_unit}
                      onChange={(e) => setEditReqForm((prev) => ({ ...prev, weight_unit: e.target.value }))}
                      className="px-2 py-1 text-xs rounded-lg border border-amber-300 bg-white font-semibold"
                    >
                      <option value="كجم">كجم</option>
                      <option value="جم">جم</option>
                      <option value="لتر">لتر</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={savingReqEdit}
                  onClick={() => setEditingRequest(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={savingReqEdit}
                  onClick={() => void handleSaveRequestEdit(false)}
                  className="px-4 py-2 rounded-xl bg-[#A92224] hover:bg-[#86191B] text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {savingReqEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  حفظ التعديلات
                </button>
                {editingRequest.status === 'pending' && (
                  <button
                    type="button"
                    disabled={savingReqEdit}
                    onClick={() => void handleSaveRequestEdit(true)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    حفظ واعتماد ونشر بالقسم
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
