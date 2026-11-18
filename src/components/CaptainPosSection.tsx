import React, { useEffect, useState } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  Car,
  CheckCircle2,
  Package,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  connectBluetoothPrinter,
  DEFAULT_INVOICE_DESIGN,
  disconnectBluetoothPrinter,
  getConnectedPrinterName,
  isBluetoothPrinterSupported,
  printBluetoothTestPage,
  printInvoiceViaBluetooth,
  printInvoiceViaHiddenIframe,
  type PrintablePosInvoice,
  type ThermalPaperWidth,
} from '../lib/bluetoothPrinter.ts';
import type {
  CaptainRecord,
  InvoiceDesignConfig,
  Language,
  OrderRecord,
  PosInvoiceItem,
  PosInvoiceRecord,
  PosPrefillReceipt,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  captain: CaptainRecord;
  orders: OrderRecord[];
  trips: TripRecord[];
  parcels: Array<Record<string, unknown>>;
  recentFinishedTrip?: PosPrefillReceipt | null;
  prefillReceipt?: PosPrefillReceipt | null;
  onClearPrefill?: () => void;
  onNotify: (msg: string) => void;
}

type SourceTab = 'orders' | 'trips' | 'parcels';

export const CaptainPosSection: React.FC<Props> = ({
  lang,
  captain,
  orders,
  trips,
  parcels,
  recentFinishedTrip,
  prefillReceipt,
  onClearPrefill,
  onNotify,
}) => {
  const isAr = lang === 'ar';

  const [sourceTab, setSourceTab] = useState<SourceTab>('orders');
  const [invoices, setInvoices] = useState<PosInvoiceRecord[]>([]);
  const [invoiceDesign, setInvoiceDesign] = useState<InvoiceDesignConfig>(DEFAULT_INVOICE_DESIGN);
  const [loadingPos, setLoadingPos] = useState(false);

  // Active delivery/ride invoice state
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedRefLabel, setSelectedRefLabel] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('عميل اطلبها');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [items, setItems] = useState<PosInvoiceItem[]>([]);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'network' | 'wallet' | 'instapay'>('cash');

  // Optional extra fee/adjustment line (e.g., انتظار، مشتريات إضافية)
  const [extraName, setExtraName] = useState('');
  const [extraPrice, setExtraPrice] = useState('');

  // Bluetooth Printer state
  const [printerName, setPrinterName] = useState<string | null>(() => getConnectedPrinterName());
  const [connectingBt, setConnectingBt] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>(DEFAULT_INVOICE_DESIGN.default_paper_width);
  const [lastSavedInvoice, setLastSavedInvoice] = useState<PosInvoiceRecord | null>(null);

  const btSupported = isBluetoothPrinterSupported();

  const loadPosData = async () => {
    setLoadingPos(true);
    try {
      const [invs, designRes] = await Promise.all([
        api.getPosInvoices(captain.id),
        api.getInvoiceDesign().catch(() => DEFAULT_INVOICE_DESIGN),
      ]);
      setInvoices(invs as PosInvoiceRecord[]);
      if (designRes) {
        const merged = { ...DEFAULT_INVOICE_DESIGN, ...designRes };
        setInvoiceDesign(merged);
        setPaperWidth(merged.default_paper_width || '58mm');
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingPos(false);
    }
  };

  useEffect(() => {
    loadPosData();
  }, [captain.id]);

  // Apply external prefill (from OrderCard / OrderChat / TripChat)
  useEffect(() => {
    if (!prefillReceipt) return;
    setSelectedOrderId(prefillReceipt.ref_type === 'order' && prefillReceipt.ref_id ? prefillReceipt.ref_id : '');
    setSelectedRefLabel(prefillReceipt.ref_number);
    setCustomerName(prefillReceipt.customer_name || 'عميل اطلبها');
    setCustomerPhone(prefillReceipt.customer_phone || '');
    setItems(prefillReceipt.items || []);
    setDeliveryFee(Number(prefillReceipt.delivery_fee || 0));
    setDiscountAmount(Number(prefillReceipt.discount_amount || 0));
    setPaymentMethod(prefillReceipt.payment_method || 'cash');
    setLastSavedInvoice(null);
    if (prefillReceipt.ref_type === 'trip') setSourceTab('trips');
    else if (prefillReceipt.ref_type === 'parcel') setSourceTab('parcels');
    else setSourceTab('orders');
    onClearPrefill?.();
  }, [prefillReceipt]);

  const loadOrderIntoReceipt = (o: OrderRecord) => {
    const sub = Number(o.subtotal || 0);
    const fallbackTotal = Number(o.total_amount || 0);
    const purchasesVal = sub > 0 ? sub : Math.max(0, fallbackTotal - Number(o.delivery_fee || 0));
    setSelectedOrderId(o.id);
    setSelectedRefLabel(o.order_number);
    setCustomerName(o.customer_name || 'عميل اطلبها');
    setCustomerPhone(o.customer_phone || '');
    setDeliveryFee(Number(o.delivery_fee || 0));
    setDiscountAmount(Number(o.discount_amount || 0));
    setPaymentMethod(o.payment_method === 'network' ? 'network' : (o.payment_method === 'wallet' ? 'wallet' : 'cash'));
    setItems([
      {
        product_code: o.order_number,
        name_ar: o.free_order_text
          ? `أوردر #${o.order_number}: ${o.free_order_text.slice(0, 80)}`
          : `طلب #${o.order_number} (${o.merchant_name})`,
        category_name: o.merchant_name,
        unit_price: purchasesVal,
        qty: 1,
        line_total: purchasesVal,
      },
    ]);
    setLastSavedInvoice(null);
    onNotify(isAr ? `تم تحميل بيانات الأوردر #${o.order_number} للفاتورة` : 'Order loaded into receipt');
  };

  const loadTripIntoReceipt = (t: TripRecord) => {
    const fare = Number(t.final_fare ?? t.customer_proposed_fare ?? t.estimated_fare ?? 0);
    setSelectedOrderId('');
    setSelectedRefLabel(t.trip_number);
    setCustomerName(t.customer_name || 'عميل مشوار');
    setCustomerPhone(t.customer_phone || '');
    setDeliveryFee(0);
    setDiscountAmount(0);
    setPaymentMethod('cash');
    setItems([
      {
        product_code: t.trip_number,
        name_ar: `مشوار #${t.trip_number}: من ${t.pickup_address} إلى ${t.dropoff_address} (${t.distance_km} كم)`,
        category_name: 'اطلبها مشوار',
        unit_price: fare,
        qty: 1,
        line_total: fare,
      },
    ]);
    setLastSavedInvoice(null);
    onNotify(isAr ? `تم تحميل فاتورة المشوار #${t.trip_number}` : 'Ride loaded into receipt');
  };

  const loadFinishedTripSnapshot = (snap: PosPrefillReceipt) => {
    setSelectedOrderId('');
    setSelectedRefLabel(snap.ref_number);
    setCustomerName(snap.customer_name || 'عميل مشوار');
    setCustomerPhone(snap.customer_phone || '');
    setItems(snap.items || []);
    setDeliveryFee(Number(snap.delivery_fee || 0));
    setDiscountAmount(Number(snap.discount_amount || 0));
    setPaymentMethod(snap.payment_method || 'cash');
    setLastSavedInvoice(null);
    onNotify(isAr ? `تم تحميل فاتورة المشوار المنتهي #${snap.ref_number}` : 'Finished ride loaded');
  };

  const loadParcelIntoReceipt = (p: Record<string, unknown>) => {
    const delNum = String(p.delivery_number || p.id || 'PRC');
    const fee = Number(p.delivery_fee || 0);
    setSelectedOrderId('');
    setSelectedRefLabel(delNum);
    setCustomerName(String(p.sender_name || p.recipient_name || 'عميل طرد'));
    setCustomerPhone(String(p.recipient_phone || p.sender_phone || ''));
    setDeliveryFee(0);
    setDiscountAmount(0);
    setPaymentMethod('cash');
    setItems([
      {
        product_code: delNum,
        name_ar: `توصيل طرد #${delNum} (${String(p.item_category || 'طرد')}): ${String(p.pickup_address || '')} ← ${String(p.dropoff_address || '')}`,
        category_name: 'توصيل طرود',
        unit_price: fee,
        qty: 1,
        line_total: fee,
      },
    ]);
    setLastSavedInvoice(null);
    onNotify(isAr ? `تم تحميل بيانات الطرد #${delNum} للفاتورة` : 'Parcel loaded into receipt');
  };

  const handleUpdateLineAmount = (index: number, nextAmount: number) => {
    const safePrice = Math.max(0, Number.isFinite(nextAmount) ? nextAmount : 0);
    setItems((prev) => {
      const next = [...prev];
      const it = next[index];
      if (!it) return prev;
      next[index] = {
        ...it,
        unit_price: safePrice,
        line_total: Number((safePrice * it.qty).toFixed(2)),
      };
      return next;
    });
    setLastSavedInvoice(null);
  };

  const handleUpdateLineTitle = (index: number, nextTitle: string) => {
    setItems((prev) => {
      const next = [...prev];
      const it = next[index];
      if (!it) return prev;
      next[index] = { ...it, name_ar: nextTitle };
      return next;
    });
    setLastSavedInvoice(null);
  };

  const handleAddExtraLine = (e: React.FormEvent) => {
    e.preventDefault();
    const title = extraName.trim();
    const price = Number(extraPrice);
    if (!title || !Number.isFinite(price) || price < 0) {
      onNotify(isAr ? 'أدخل وصف البند الإضافي وقيمته' : 'Enter valid description and amount');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        product_code: selectedRefLabel || `EXT-${prev.length + 1}`,
        name_ar: title,
        unit_price: price,
        qty: 1,
        line_total: price,
      },
    ]);
    setExtraName('');
    setExtraPrice('');
    setLastSavedInvoice(null);
  };

  const subtotal = Number(items.reduce((sum, it) => sum + Number(it.line_total || 0), 0).toFixed(2));
  const netTotal = Number(Math.max(0, subtotal + Number(deliveryFee || 0) - Number(discountAmount || 0)).toFixed(2));

  const handleConnectBt = async () => {
    setConnectingBt(true);
    try {
      const res = await connectBluetoothPrinter();
      setPrinterName(res.name);
      onNotify(isAr ? `تم ربط الطابعة الحرارية عبر البلوتوث: ${res.name}` : `Connected: ${res.name}`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setConnectingBt(false);
    }
  };

  const handleDisconnectBt = () => {
    disconnectBluetoothPrinter();
    setPrinterName(null);
    onNotify(isAr ? 'تم فصل طابعة البلوتوث' : 'Bluetooth printer disconnected');
  };

  const handleTestBtPrint = async () => {
    setPrinting(true);
    try {
      await printBluetoothTestPage(captain.full_name, invoiceDesign, paperWidth);
      onNotify(isAr ? 'تم إرسال صفحة الاختبار بتصميم الفاتورة المعتمد للطابعة ✓' : 'Test page printed');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setPrinting(false);
    }
  };

  const saveAndPrint = async (mode: 'bluetooth' | 'thermal_iframe') => {
    if (items.length === 0) {
      onNotify(isAr ? 'اختر طلبًا أو مشوارًا أو طردًا أولاً لإصدار الفاتورة' : 'Select an order, ride, or parcel first');
      return;
    }
    setPrinting(true);
    try {
      const res = await api.createPosInvoice({
        captain_id: captain.id,
        order_id: selectedOrderId || null,
        customer_name: customerName.trim() || 'عميل اطلبها',
        customer_phone: customerPhone.trim(),
        items,
        delivery_fee: Number(deliveryFee || 0),
        discount_amount: Number(discountAmount || 0),
        payment_method: paymentMethod,
        printed_via: mode,
      });

      const saved = res.invoice as PosInvoiceRecord;
      setLastSavedInvoice(saved);
      await loadPosData();

      const printable: PrintablePosInvoice = {
        invoice_number: saved.invoice_number,
        created_at: saved.created_at,
        captain_name: saved.captain_name,
        captain_phone: captain.phone,
        customer_name: saved.customer_name,
        customer_phone: saved.customer_phone,
        order_number: selectedRefLabel || (saved as unknown as { order_number?: string | null }).order_number || null,
        items: saved.items,
        subtotal: saved.subtotal,
        delivery_fee: saved.delivery_fee,
        discount_amount: saved.discount_amount,
        total_amount: saved.total_amount,
        payment_method: saved.payment_method,
      };

      if (mode === 'bluetooth') {
        if (getConnectedPrinterName()) {
          await printInvoiceViaBluetooth(printable, invoiceDesign, paperWidth);
          onNotify(isAr ? `تم إصدار الفاتورة ${saved.invoice_number} وطباعتها بالبلوتوث ✓` : 'Printed via Bluetooth');
        } else {
          printInvoiceViaHiddenIframe(printable, invoiceDesign, paperWidth);
          onNotify(
            isAr
              ? `تم حفظ الفاتورة ${saved.invoice_number} — اربط طابعة بلوتوث للطباعة المباشرة أو استخدم الطباعة الحرارية`
              : 'Saved — connect Bluetooth printer for direct printing'
          );
        }
      } else {
        printInvoiceViaHiddenIframe(printable, invoiceDesign, paperWidth);
        onNotify(isAr ? `تم حفظ الفاتورة ${saved.invoice_number} وفتح الطباعة الحرارية` : 'Thermal print opened');
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setPrinting(false);
    }
  };

  const handleReprintSaved = async (inv: PosInvoiceRecord, viaBluetooth: boolean) => {
    const printable: PrintablePosInvoice = {
      invoice_number: inv.invoice_number,
      created_at: inv.created_at,
      captain_name: inv.captain_name,
      captain_phone: captain.phone,
      customer_name: inv.customer_name,
      customer_phone: inv.customer_phone,
      items: inv.items,
      subtotal: inv.subtotal,
      delivery_fee: inv.delivery_fee,
      discount_amount: inv.discount_amount,
      total_amount: inv.total_amount,
      payment_method: inv.payment_method,
    };
    setPrinting(true);
    try {
      if (viaBluetooth && getConnectedPrinterName()) {
        await printInvoiceViaBluetooth(printable, invoiceDesign, paperWidth);
        onNotify(isAr ? `تمت إعادة طباعة ${inv.invoice_number} بالبلوتوث ✓` : 'Reprinted via Bluetooth');
      } else {
        printInvoiceViaHiddenIframe(printable, invoiceDesign, paperWidth);
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setPrinting(false);
    }
  };

  const captainTrips = trips.filter((t) => t.captain_id === captain.id || t.status === 'searching');
  const sortedOrders = [...orders].sort((a, b) => {
    const score = (s: string) => (s === 'delivered' ? 0 : s === 'on_the_way' ? 1 : 2);
    return score(a.status) - score(b.status);
  });

  const previewInvoiceNumber = lastSavedInvoice?.invoice_number || 'INV-PREVIEW';
  const previewDate = (lastSavedInvoice?.created_at || new Date().toISOString()).slice(0, 16).replace('T', ' ');
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(invoiceDesign.accent_color || '') ? invoiceDesign.accent_color : '#A92224';

  return (
    <div className="space-y-5">
      {/* 1. Bluetooth Thermal Printer Status Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                printerName
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              {printerName ? <BluetoothConnected className="w-5 h-5" /> : <Bluetooth className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {isAr ? 'إصدار وطباعة فواتير العملاء (الأوردرات والمشاوير)' : 'Customer Delivery & Ride Invoice Printing'}
              </h3>
              <p className="text-xs text-slate-500">
                {printerName
                  ? `متصل بالطابعة: ${printerName} (ESC/POS ${paperWidth})`
                  : btSupported
                  ? 'اربط طابعة البلوتوث الحرارية لطباعة فاتورة التسليم أو المشوار للعميل فورًا'
                  : 'استخدم الطباعة الحرارية المباشرة أو متصفح Chrome على أندرويد لربط البلوتوث'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value as ThermalPaperWidth)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white min-h-[38px]"
            >
              <option value="58mm">ورق حراري 58mm</option>
              <option value="80mm">ورق حراري 80mm</option>
            </select>

            {printerName ? (
              <>
                <button
                  type="button"
                  disabled={printing}
                  onClick={handleTestBtPrint}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold min-h-[38px]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{isAr ? 'طباعة اختبار' : 'Test Print'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectBt}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-semibold min-h-[38px]"
                >
                  <BluetoothOff className="w-3.5 h-3.5" />
                  <span>{isAr ? 'فصل الطابعة' : 'Disconnect'}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={connectingBt}
                onClick={handleConnectBt}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-xs font-bold min-h-[38px]"
              >
                <Bluetooth className="w-4 h-4" />
                <span>{connectingBt ? 'جاري البحث...' : isAr ? 'ربط طابعة بلوتوث' : 'Connect Bluetooth'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Delivery / Ride Picker + Editable Receipt + Branded Thermal Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSourceTab('orders')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    sourceTab === 'orders' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-orange-600" />
                  <span>الأوردرات ({sortedOrders.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('trips')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    sourceTab === 'trips' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Car className="w-3.5 h-3.5 text-[#A92224]" />
                  <span>المشاوير ({captainTrips.length + (recentFinishedTrip ? 1 : 0)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('parcels')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    sourceTab === 'parcels' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Package className="w-3.5 h-3.5 text-teal-700" />
                  <span>الطرود ({parcels.length})</span>
                </button>
              </div>

              <button
                type="button"
                onClick={loadPosData}
                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPos ? 'animate-spin' : ''}`} />
                <span>تحديث التصميم والسجل</span>
              </button>
            </div>

            {sourceTab === 'orders' && (
              <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
                {sortedOrders.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">لا توجد أوردرات مسجلة لك حاليًا.</p>
                ) : (
                  sortedOrders.map((o) => (
                    <div
                      key={o.id}
                      className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                        selectedOrderId === o.id ? 'border-[#A92224] bg-red-50/40' : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span dir="ltr" className="font-mono-num font-bold text-slate-900">
                            #{o.order_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              o.status === 'delivered' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {o.status === 'delivered' ? 'تم التسليم ✓' : o.status}
                          </span>
                        </div>
                        <p className="font-semibold text-slate-800 truncate">
                          {o.customer_name} · {o.merchant_name}
                        </p>
                        <p className="text-[11px] text-slate-500 tabular-nums">
                          الإجمالي: <strong>{o.total_amount} ج.م</strong> (توصيل {o.delivery_fee} ج.م)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadOrderIntoReceipt(o)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0"
                      >
                        <Receipt className="w-3.5 h-3.5 text-amber-400" />
                        <span>تجهيز الفاتورة</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {sourceTab === 'trips' && (
              <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
                {recentFinishedTrip && (
                  <div className="p-3 rounded-xl border-2 border-teal-400 bg-teal-50/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <span className="inline-block px-2 py-0.5 rounded bg-teal-700 text-white text-[10px] font-bold">
                        آخر مشوار منتهي الآن ✓
                      </span>
                      <p className="font-bold text-slate-900">
                        <span className="font-mono-num">#{recentFinishedTrip.ref_number}</span> · {recentFinishedTrip.customer_name}
                      </p>
                      <p className="text-[11px] text-slate-700 truncate">
                        {recentFinishedTrip.items[0]?.name_ar}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => loadFinishedTripSnapshot(recentFinishedTrip)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>تحميل للطباعة</span>
                    </button>
                  </div>
                )}
                {captainTrips.length === 0 && !recentFinishedTrip ? (
                  <p className="text-xs text-slate-500 py-4 text-center">لا توجد مشاوير نشطة حاليًا.</p>
                ) : (
                  captainTrips.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-bold text-slate-900">
                          <span className="font-mono-num">#{t.trip_number}</span> · {t.customer_name}
                        </p>
                        <p className="text-[11px] text-slate-600 truncate">
                          من: {t.pickup_address} ← إلى: {t.dropoff_address}
                        </p>
                        <p className="text-[11px] font-bold text-[#A92224] tabular-nums">
                          {t.distance_km} كم · الأجرة: {t.final_fare ?? t.customer_proposed_fare ?? t.estimated_fare} ج.م
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadTripIntoReceipt(t)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0"
                      >
                        <Receipt className="w-3.5 h-3.5 text-amber-400" />
                        <span>تجهيز فاتورة المشوار</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {sourceTab === 'parcels' && (
              <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
                {parcels.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">لا توجد طرود مسجلة حاليًا.</p>
                ) : (
                  parcels.map((p) => (
                    <div
                      key={String(p.id)}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-bold text-slate-900 font-mono-num">
                          #{String(p.delivery_number || p.id)} · {String(p.item_category || 'طرد')}
                        </p>
                        <p className="text-[11px] text-slate-600 truncate">
                          من: {String(p.pickup_address || '')} ← إلى: {String(p.dropoff_address || '')}
                        </p>
                        <p className="text-[11px] font-bold text-teal-800 tabular-nums">
                          أجرة التوصيل: {Number(p.delivery_fee || 0)} ج.م
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadParcelIntoReceipt(p)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0"
                      >
                        <Receipt className="w-3.5 h-3.5 text-amber-400" />
                        <span>تجهيز فاتورة الطرد</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Editable Receipt Lines & Customer Info */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                تفاصيل الفاتورة المحددة ({items.length})
              </h4>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setItems([]);
                    setSelectedOrderId('');
                    setSelectedRefLabel('');
                    setLastSavedInvoice(null);
                  }}
                  className="text-xs text-rose-600 hover:underline"
                >
                  تفريغ الفاتورة
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                اختر طلبًا أو مشوارًا أو طردًا من القائمة أعلاه لتجهيز فاتورة العميل وطباعتها.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div
                    key={`${it.product_code}-${idx}`}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-wrap items-center gap-2 text-xs"
                  >
                    <input
                      type="text"
                      value={it.name_ar}
                      onChange={(e) => handleUpdateLineTitle(idx, e.target.value)}
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-900"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">المبلغ:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={it.unit_price}
                        onChange={(e) => handleUpdateLineAmount(idx, Number(e.target.value))}
                        className="w-24 px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-bold tabular-nums text-center"
                      />
                      <span className="text-slate-600">ج.م</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Optional Extra Fee/Purchase Line */}
            <form onSubmit={handleAddExtraLine} className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                placeholder="بند إضافي (مثال: رسوم انتظار / فاتورة مشتريات فعلية)..."
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                className="sm:col-span-7 px-3 py-2 border border-slate-200 rounded-xl text-xs"
              />
              <input
                type="number"
                step="0.5"
                min="0"
                placeholder="القيمة (ج.م)"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                className="sm:col-span-3 px-3 py-2 border border-slate-200 rounded-xl text-xs tabular-nums"
              />
              <button
                type="submit"
                className="sm:col-span-2 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة</span>
              </button>
            </form>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-3 border-t border-slate-100 text-xs">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1">اسم العميل</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">هاتف العميل</label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder="010..."
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-xl font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">رسوم التوصيل</label>
                <input
                  type="number"
                  min="0"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(Number(e.target.value))}
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">الخصم (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(Number(e.target.value))}
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Admin-Designed Customer Receipt Preview + Print */}
        <div className="lg:col-span-5 space-y-4">
          <div
            className="bg-white border-2 rounded-2xl p-5 shadow-sm space-y-3"
            style={{ borderColor: accent }}
          >
            <div className="text-center space-y-1.5 pb-3 border-b-2" style={{ borderColor: accent }}>
              {invoiceDesign.show_logo && invoiceDesign.logo_url && (
                <img
                  src={invoiceDesign.logo_url}
                  alt="شعار الفاتورة"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 mx-auto rounded-xl object-contain bg-white border border-slate-200 p-1"
                />
              )}
              <h4 className="text-base font-extrabold" style={{ color: accent }}>
                {invoiceDesign.header_title}
              </h4>
              {invoiceDesign.header_subtitle && (
                <p className="text-[11px] text-slate-500">{invoiceDesign.header_subtitle}</p>
              )}
              {invoiceDesign.show_support_phone && invoiceDesign.support_phone && (
                <p className="text-[11px] font-mono-num text-slate-700">خدمة العملاء: {invoiceDesign.support_phone}</p>
              )}
            </div>

            <div className="text-xs space-y-1 pb-3 border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">رقم الفاتورة:</span>
                <strong className="font-mono-num text-slate-900">{previewInvoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">التاريخ:</span>
                <span className="font-mono-num text-slate-700">{previewDate}</span>
              </div>
              {invoiceDesign.show_captain_info && (
                <div className="flex justify-between">
                  <span className="text-slate-500">الطيار:</span>
                  <span className="font-semibold text-slate-800">{captain.full_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">العميل:</span>
                <span className="font-semibold text-slate-800">{customerName || 'عميل اطلبها'}</span>
              </div>
              {customerPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500">الهاتف:</span>
                  <span className="font-mono-num text-slate-700">{customerPhone}</span>
                </div>
              )}
              {selectedRefLabel && (
                <div className="flex justify-between">
                  <span className="text-slate-500">مرجع الطلب/المشوار:</span>
                  <span className="font-mono-num font-bold text-slate-800">{selectedRefLabel}</span>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs pb-3 border-b border-dashed border-slate-300 max-h-52 overflow-y-auto">
              {items.length === 0 ? (
                <p className="text-center text-slate-400 py-3">ستظهر تفاصيل الأوردر أو المشوار هنا...</p>
              ) : (
                items.map((it, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{it.name_ar}</p>
                      {invoiceDesign.show_item_codes && (
                        <p className="text-[11px] text-slate-500 font-mono-num">
                          المرجع: {it.product_code} · {it.qty} × {it.unit_price} ج.م
                        </p>
                      )}
                    </div>
                    <span className="font-bold tabular-nums text-slate-900 shrink-0">
                      {it.line_total.toFixed(2)} ج.م
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>المبلغ الأساسي:</span>
                <span className="tabular-nums font-semibold">{subtotal.toFixed(2)} ج.م</span>
              </div>
              {deliveryFee > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>رسوم التوصيل:</span>
                  <span className="tabular-nums font-semibold">{Number(deliveryFee).toFixed(2)} ج.م</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>الخصم:</span>
                  <span className="tabular-nums font-semibold">-{Number(discountAmount).toFixed(2)} ج.م</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-900 text-sm font-extrabold text-slate-900">
                <span>الصافي المستحق:</span>
                <span className="tabular-nums text-base" style={{ color: accent }}>
                  {netTotal.toFixed(2)} ج.م
                </span>
              </div>
            </div>

            {invoiceDesign.show_qr_badge && (
              <div className="border border-slate-900 rounded-md py-1 px-2 text-center font-mono text-[10px] font-bold">
                OTLOBHA VERIFIED · {previewInvoiceNumber}
              </div>
            )}

            {(invoiceDesign.footer_message || invoiceDesign.footer_note) && (
              <div className="text-center pt-2 border-t border-dashed border-slate-300 text-[11px] text-slate-600 space-y-0.5">
                {invoiceDesign.footer_message && <p className="font-semibold">{invoiceDesign.footer_message}</p>}
                {invoiceDesign.footer_note && <p className="text-slate-400">{invoiceDesign.footer_note}</p>}
              </div>
            )}

            <div className="grid grid-cols-4 gap-1 pt-1 text-[11px]">
              {[
                { id: 'cash' as const, label: 'كاش' },
                { id: 'network' as const, label: 'شبكة/POS' },
                { id: 'wallet' as const, label: 'محفظة' },
                { id: 'instapay' as const, label: 'إنستاباي' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id)}
                  className={`py-1.5 rounded-lg border font-bold text-center ${
                    paymentMethod === m.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={printing || items.length === 0}
                onClick={() => saveAndPrint('bluetooth')}
                className="w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[42px]"
                style={{ backgroundColor: accent }}
              >
                <Bluetooth className="w-4 h-4" />
                <span>{printing ? 'جاري الطباعة...' : 'حفظ الفاتورة وطباعة بالبلوتوث'}</span>
              </button>
              <button
                type="button"
                disabled={printing || items.length === 0}
                onClick={() => saveAndPrint('thermal_iframe')}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[42px]"
              >
                <Printer className="w-4 h-4 text-amber-400" />
                <span>حفظ وطباعة حرارية ({paperWidth})</span>
              </button>
            </div>

            {lastSavedInvoice && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>تم إصدار الفاتورة {lastSavedInvoice.invoice_number} وحفظها بنجاح.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Saved Customer Invoices History */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#A92224]" />
            <h4 className="text-sm font-bold text-slate-900">سجل فواتير التسليم والمشاوير الصادرة ({invoices.length})</h4>
          </div>
        </div>

        {invoices.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">لم يتم إصدار فواتير بعد.</p>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {invoices.slice(0, 12).map((inv) => (
              <div key={inv.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">
                    <span dir="ltr" className="font-mono-num text-[#A92224]">{inv.invoice_number}</span> · {inv.customer_name}
                  </p>
                  <p className="text-slate-500">
                    {inv.items.map((i) => i.name_ar).join(' | ').slice(0, 75)} ·{' '}
                    <span className="font-mono-num">{String(inv.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 tabular-nums">{inv.total_amount} ج.م</span>
                  <button
                    type="button"
                    onClick={() => handleReprintSaved(inv, Boolean(printerName))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 font-semibold"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-700" />
                    <span>إعادة طباعة</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
