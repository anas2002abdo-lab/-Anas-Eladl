import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bluetooth,
  Camera,
  CheckCircle2,
  ImagePlus,
  MessageSquare,
  Navigation,
  Printer,
  Receipt,
  Send,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  DEFAULT_INVOICE_DESIGN,
  getConnectedPrinterName,
  printInvoiceViaBluetooth,
  printInvoiceViaHiddenIframe,
  type PrintablePosInvoice,
} from '../lib/bluetoothPrinter.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import type { Language, OrderChatMessage, OrderRecord, PosInvoiceRecord, PosPrefillReceipt } from '../shared/types.ts';

interface Props {
  orderId: string;
  senderRole: 'customer' | 'captain' | 'admin';
  senderName: string;
  captainId?: string;
  lang: Language;
  onBack: () => void;
  onOrderUpdated?: () => Promise<void>;
  onOpenPosForOrder?: (prefill: PosPrefillReceipt) => void;
  onNotify?: (msg: string) => void;
}

function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxW = 1000;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } else {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    reader.readAsDataURL(file);
  });
}

export const OrderChatPage: React.FC<Props> = ({
  orderId,
  senderRole,
  senderName,
  captainId,
  lang,
  onBack,
  onOrderUpdated,
  onOpenPosForOrder,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [showGpsMap, setShowGpsMap] = useState(true);
  const [captainGps, setCaptainGps] = useState<{
    lat: number;
    lng: number;
    distance_km?: number | null;
    eta_min?: number | null;
    vehicle_model?: string | null;
    plate_number?: string | null;
  } | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const loadChat = async () => {
    try {
      const [data, track] = await Promise.all([
        api.getOrderChat(orderId),
        api.getOrderTracking(orderId).catch(() => null),
      ]);
      setOrder(data.order);
      setMessages(data.messages || []);
      if (track?.captain_gps) {
        setCaptainGps(track.captain_gps);
      }
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setPreviewImg(null);
    loadChat();

    let closedByUser = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      if (closedByUser) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/order-chat?orderId=${encodeURIComponent(orderId)}`;
      const token = localStorage.getItem('otlobha_access_token');
      ws = new WebSocket(wsUrl, token ? [`bearer.${token}`] : undefined);

      ws.onopen = () => {
        if (!closedByUser) setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (payload.order_id && payload.order_id !== orderId) return;

          if (payload.type === 'chat:message' && payload.message) {
            const incoming = payload.message as OrderChatMessage;
            setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
            if (payload.delivery_proof_image_url) {
              setOrder((prev) =>
                prev ? { ...prev, delivery_proof_image_url: String(payload.delivery_proof_image_url) } : prev
              );
            }
          } else if (payload.type === 'order:status' && payload.status) {
            setOrder((prev) => (prev ? { ...prev, status: String(payload.status) } : prev));
          } else if (payload.type === 'captain:location' && Number.isFinite(Number(payload.lat))) {
            setCaptainGps((prev) => ({
              ...(prev || {}),
              lat: Number(payload.lat),
              lng: Number(payload.lng),
            }));
          }
        } catch {
          // ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUser) {
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    };

    connectWs();

    const pollTimer = setInterval(() => {
      loadChat().catch(() => {});
    }, 4000);

    return () => {
      closedByUser = true;
      clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [orderId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      const res = await api.sendOrderChatMessage(orderId, {
        sender_role: senderRole,
        sender_name: senderName,
        message_text: clean,
        is_delivery_proof: false,
      });
      setText('');
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      await onOrderUpdated?.();
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleImageSend = (isDeliveryProof: boolean) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (isDeliveryProof) setUploadingProof(true);
    else setSending(true);

    try {
      const dataUrl = await compressImageFile(file);
      const res = await api.sendOrderChatMessage(orderId, {
        sender_role: senderRole,
        sender_name: senderName,
        message_text: isDeliveryProof
          ? 'تم تصوير الأوردر عند منزل العميل وإرسال صورة إثبات التسليم'
          : 'صورة مرفقة في الشات',
        image_url: dataUrl,
        is_delivery_proof: isDeliveryProof,
      });
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      if (res.delivery_proof_image_url) {
        setOrder((prev) =>
          prev ? { ...prev, delivery_proof_image_url: res.delivery_proof_image_url } : prev
        );
      }
      await onOrderUpdated?.();
      if (isDeliveryProof) {
        onNotify?.(
          isAr
            ? 'تم إرسال صورة الأوردر عند منزل العميل في الشات بنجاح — يمكنك الآن تأكيد التسليم'
            : 'Delivery proof photo sent in chat'
        );
      }
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setUploadingProof(false);
      setSending(false);
    }
  };

  const handleConfirmDelivery = async () => {
    const capId = captainId || order?.captain_id;
    if (!capId || !order) return;
    setConfirmingDelivery(true);
    try {
      await api.updateCaptainOrderStatus(capId, order.id, 'delivered');
      setOrder((prev) => (prev ? { ...prev, status: 'delivered' } : prev));
      await onOrderUpdated?.();
      onNotify?.(isAr ? 'تم تأكيد تسليم الطلب بعد إرسال صورة الأوردر عند منزل العميل' : 'Order delivered');
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setConfirmingDelivery(false);
    }
  };

  const buildOrderReceiptPrefill = (): PosPrefillReceipt | null => {
    if (!order) return null;
    const sub = Number(order.subtotal || 0);
    const total = Number(order.total_amount || 0);
    const baseAmount = sub > 0 ? sub : Math.max(0, total - Number(order.delivery_fee || 0));

    const validItems = Array.isArray(order.items) ? order.items.filter((it) => it.status !== 'rejected') : [];
    const receiptItems = validItems.length > 0
      ? validItems.map((it) => ({
          product_code: it.product_id || order.order_number,
          name_ar: it.name_ar,
          category_name: order.merchant_name || 'منتج',
          unit_price: Number(it.unit_price || 0),
          qty: Number(it.quantity || 1),
          line_total: Number(it.total_price || (Number(it.unit_price || 0) * Number(it.quantity || 1))),
        }))
      : [
          {
            product_code: order.order_number,
            name_ar: order.free_order_text
              ? `أوردر #${order.order_number}: ${order.free_order_text.slice(0, 80)}`
              : `طلب #${order.order_number} (${order.merchant_name})`,
            category_name: order.merchant_name || 'طلب',
            unit_price: baseAmount,
            qty: 1,
            line_total: baseAmount,
          },
        ];

    return {
      ref_type: 'order',
      ref_id: order.id,
      ref_number: order.order_number,
      customer_name: order.customer_name || 'عميل اطلبها',
      customer_phone: order.customer_phone || '',
      items: receiptItems,
      delivery_fee: Number(order.delivery_fee || 0),
      discount_amount: Number(order.discount_amount || 0),
      payment_method: order.payment_method === 'network' ? 'network' : (order.payment_method === 'wallet' ? 'wallet' : 'cash'),
    };
  };

  const handlePrintOrderReceipt = async (mode: 'bluetooth' | 'thermal_iframe') => {
    const capId = captainId || order?.captain_id;
    const prefill = buildOrderReceiptPrefill();
    if (!order || !capId || !prefill || printingReceipt) return;
    setPrintingReceipt(true);
    try {
      const [designRes, savedRes] = await Promise.all([
        api.getInvoiceDesign().catch(() => DEFAULT_INVOICE_DESIGN),
        api.createPosInvoice({
          captain_id: capId,
          order_id: order.id,
          customer_name: prefill.customer_name,
          customer_phone: prefill.customer_phone,
          items: prefill.items,
          delivery_fee: prefill.delivery_fee,
          discount_amount: prefill.discount_amount,
          payment_method: prefill.payment_method,
          printed_via: mode,
        }),
      ]);
      const design = { ...DEFAULT_INVOICE_DESIGN, ...(designRes || {}) };
      const saved = savedRes.invoice as PosInvoiceRecord;
      const printable: PrintablePosInvoice = {
        invoice_number: saved.invoice_number,
        created_at: saved.created_at,
        captain_name: saved.captain_name,
        customer_name: saved.customer_name,
        customer_phone: saved.customer_phone,
        order_number: order.order_number,
        items: saved.items,
        subtotal: saved.subtotal,
        delivery_fee: saved.delivery_fee,
        discount_amount: saved.discount_amount,
        total_amount: saved.total_amount,
        payment_method: saved.payment_method,
      };
      if (mode === 'bluetooth' && getConnectedPrinterName()) {
        await printInvoiceViaBluetooth(printable, design, design.default_paper_width);
        onNotify?.(isAr ? `تمت طباعة فاتورة العميل ${saved.invoice_number} عبر البلوتوث ✓` : 'Printed via Bluetooth');
      } else {
        printInvoiceViaHiddenIframe(printable, design, design.default_paper_width);
        onNotify?.(isAr ? `تم حفظ الفاتورة ${saved.invoice_number} وفتح الطباعة الحرارية` : 'Thermal print opened');
      }
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setPrintingReceipt(false);
    }
  };

  const hasProof = Boolean(order?.delivery_proof_image_url) || messages.some((m) => m.is_delivery_proof && m.image_url);
  const effectiveProofUrl =
    order?.delivery_proof_image_url || messages.find((m) => m.is_delivery_proof && m.image_url)?.image_url || null;

  const roleBadgeLabel = (role: OrderChatMessage['sender_role']) => {
    if (role === 'captain') return isAr ? 'الطيار' : 'Captain';
    if (role === 'customer') return isAr ? 'العميل' : 'Customer';
    if (role === 'admin') return isAr ? 'الإدارة' : 'Admin';
    return isAr ? 'النظام' : 'System';
  };

  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  if (previewImg) {
    return (
      <div
        className="min-h-[calc(100vh-140px)] bg-slate-950 rounded-2xl border border-slate-800 flex flex-col overflow-hidden"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        <div className="bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between gap-3 border-b border-slate-800">
          <button
            type="button"
            onClick={() => setPreviewImg(null)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
          >
            <BackIcon className="w-4 h-4" />
            <span>{isAr ? 'العودة إلى صفحة الشات' : 'Back to Chat'}</span>
          </button>
          <span className="text-xs text-slate-300 font-mono-num">{order?.order_number || orderId}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <img
            src={previewImg}
            alt="Chat Attachment Preview"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[75vh] rounded-xl object-contain"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[calc(100vh-140px)] bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Standalone Page Header with Back Button */}
      <div className="bg-slate-900 text-white px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold shrink-0 min-h-[40px]"
          >
            <BackIcon className="w-4 h-4" />
            <span>{isAr ? 'رجوع' : 'Back'}</span>
          </button>
          <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold truncate">
                {isAr ? 'صفحة شات الطلب المباشر' : 'Order Chat Page'} ·{' '}
                <span className="font-mono-num text-orange-400">{order?.order_number || orderId}</span>
              </h2>
              {Array.isArray(order?.store_sections) && order.store_sections.length > 1 && (
                <span className="px-2 py-0.5 rounded bg-orange-600/80 text-white text-[10px] font-bold">
                  {isAr ? `مقسم على ${order.store_sections.length} متاجر` : `${order.store_sections.length} stores`}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                  wsConnected ? 'bg-teal-600/30 text-teal-200' : 'bg-slate-700 text-slate-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-teal-400' : 'bg-slate-400'}`} />
                {wsConnected ? (isAr ? 'متصل لحظيًا' : 'Live') : isAr ? 'جاري الاتصال' : 'Connecting'}
              </span>
            </div>
            {order && (
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {order.merchant_name} · {isAr ? 'العميل:' : 'Customer:'} {order.customer_name}
                {order.captain_name ? ` · ${isAr ? 'الطيار:' : 'Captain:'} ${order.captain_name}` : ''} ·{' '}
                <span className="text-orange-300 font-semibold">{order.status}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Live Captain GPS Tracking Bar */}
      {order?.captain_id && captainGps && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 sm:px-5 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-800 font-bold">
              <Navigation className="w-4 h-4 text-teal-600 shrink-0" />
              <span>
                {isAr ? `تتبع GPS للطيار (${order.captain_name})` : `Live Captain GPS (${order.captain_name})`}
                {typeof captainGps.distance_km === 'number' && ` · على بُعد ${captainGps.distance_km} كم`}
                {typeof captainGps.eta_min === 'number' && ` (${captainGps.eta_min} د)`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowGpsMap((v) => !v)}
              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-[11px] font-semibold"
            >
              {showGpsMap ? 'إخفاء الخريطة' : 'عرض خريطة GPS'}
            </button>
          </div>
          {showGpsMap && (
            <GpsMapPicker
              heightClass="h-52"
              pickup={
                (order as any).merchant_lat && (order as any).merchant_lng
                  ? {
                      lat: Number((order as any).merchant_lat),
                      lng: Number((order as any).merchant_lng),
                      label: `المتجر: ${order.merchant_name}`,
                    }
                  : null
              }
              dropoff={{
                lat: Number(order.customer_lat || 31.1583),
                lng: Number(order.customer_lng || 31.9369),
                label: `موقع العميل: ${order.customer_name}`,
              }}
              captainPin={{
                id: order.captain_id,
                full_name: order.captain_name || 'الطيار',
                vehicle_type: 'moto',
                vehicle_model: captainGps.vehicle_model || '',
                lat: captainGps.lat,
                lng: captainGps.lng,
                distance_km: captainGps.distance_km ?? undefined,
                eta_min: captainGps.eta_min ?? undefined,
              }}
              showNavigationHud={true}
            />
          )}
        </div>
      )}

      {/* Delivery Proof Requirement Strip */}
      <div
        className={`px-4 sm:px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs ${
          hasProof ? 'bg-teal-50 border-teal-200 text-teal-900' : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {hasProof ? (
            <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
          ) : (
            <Camera className="w-4 h-4 text-amber-700 shrink-0" />
          )}
          <p className="font-semibold leading-snug">
            {hasProof
              ? isAr
                ? 'تم تصوير الأوردر عند منزل العميل وإرسال صورة إثبات التسليم في الشات ✓'
                : 'Doorstep delivery proof photo verified in chat ✓'
              : isAr
              ? 'شرط التسليم: يجب على الطيار تصوير الأوردر عند منزل العميل وإرساله هنا قبل تأكيد التسليم.'
              : 'Mandatory rule: Captain must capture & send doorstep order photo here before completing delivery.'}
          </p>
        </div>
        {effectiveProofUrl && (
          <button
            type="button"
            onClick={() => setPreviewImg(effectiveProofUrl)}
            className="shrink-0 flex items-center gap-1.5 bg-white border border-teal-300 rounded-lg p-1 pe-2 hover:bg-teal-100/50"
          >
            <img
              src={effectiveProofUrl}
              alt="Delivery Proof"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded object-cover"
            />
            <span className="text-[11px] font-bold text-teal-800">{isAr ? 'عرض الصورة' : 'View Photo'}</span>
          </button>
        )}
      </div>

      {/* Admin Live Monitoring Notice */}
      {senderRole === 'admin' && (
        <div className="px-4 sm:px-5 py-2 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-900 flex items-center gap-2 font-medium">
          <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>
            {isAr
              ? 'أنت تتابع المحادثة مباشرة من واجهة تحكم الإدارة (Super Admin) — يمكنك المشاهدة أو إرسال رسالة إشرافية.'
              : 'Live Super Admin supervision page.'}
          </span>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-slate-50 min-h-[340px]">
        {loading ? (
          <p className="text-center text-xs text-slate-500 py-10">{isAr ? 'جاري تحميل رسائل الشات...' : 'Loading chat...'}</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 space-y-1">
            <p className="text-xs font-semibold text-slate-600">
              {isAr ? 'لم تبدأ المحادثة بعد — أرسل رسالة للبدء' : 'No messages yet'}
            </p>
            <p className="text-[11px] text-slate-400">
              {isAr
                ? 'هنا يتواصل العميل والطيار مباشرة، ويرسل الطيار صورة الأوردر عند منزل العميل.'
                : 'Customer and Captain communicate directly here.'}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isAutomatedSystemNote =
              m.sender_role === 'system' &&
              (!m.sender_name || m.sender_name === 'النظام' || m.sender_name === 'System');

            if (isAutomatedSystemNote) {
              return (
                <div key={m.id} className="flex justify-center">
                  <div className="max-w-[90%] bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-center text-[11px] text-slate-600 shadow-xs">
                    <p>{m.message_text}</p>
                  </div>
                </div>
              );
            }

            const effectiveRole: 'customer' | 'captain' | 'admin' =
              m.sender_role === 'captain'
                ? 'captain'
                : m.sender_role === 'customer'
                ? 'customer'
                : 'admin';

            const senderDisplayName =
              (m.sender_name && m.sender_name !== 'النظام' ? m.sender_name : '') ||
              (effectiveRole === 'captain'
                ? order?.captain_name || 'كابتن التوصيل'
                : effectiveRole === 'customer'
                ? order?.customer_name || 'العميل'
                : 'إدارة اطلبها');

            const isMine = effectiveRole === senderRole;
            const bubbleStyle =
              effectiveRole === 'captain'
                ? 'bg-orange-50 border-orange-200 text-slate-900'
                : effectiveRole === 'admin'
                ? 'bg-indigo-50 border-indigo-200 text-slate-900'
                : 'bg-white border-teal-200 text-slate-900';

            const senderBadgeStyle =
              effectiveRole === 'captain'
                ? 'bg-orange-600 text-white'
                : effectiveRole === 'admin'
                ? 'bg-indigo-600 text-white'
                : 'bg-teal-700 text-white';

            const roleEmoji =
              effectiveRole === 'captain' ? '🏍️' : effectiveRole === 'customer' ? '👤' : '🛡️';

            return (
              <div key={m.id} className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}>
                <div className={`max-w-[85%] rounded-2xl border px-3.5 py-2.5 space-y-1.5 shadow-xs ${bubbleStyle}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-200/70">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black ${senderBadgeStyle}`}>
                        <span>{roleEmoji}</span>
                        <span>{roleBadgeLabel(effectiveRole)}</span>
                      </span>
                      <span className="text-xs font-black text-slate-900">
                        {senderDisplayName}
                      </span>
                      {isMine && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          {isAr ? 'أنت' : 'You'}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono-num text-slate-400">
                      {String(m.created_at || '').slice(11, 16) || ''}
                    </span>
                  </div>

                  {m.is_delivery_proof && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-600 text-white rounded-md text-[10px] font-bold">
                      <Truck className="w-3 h-3" />
                      <span>{isAr ? 'صورة إثبات التسليم عند منزل العميل' : 'Doorstep Delivery Proof'}</span>
                    </div>
                  )}

                  {m.image_url && (
                    <button
                      type="button"
                      onClick={() => setPreviewImg(m.image_url)}
                      className="block rounded-xl overflow-hidden border border-slate-200 bg-white"
                    >
                      <img
                        src={m.image_url}
                        alt="Chat attachment"
                        referrerPolicy="no-referrer"
                        className="max-h-60 w-auto object-cover"
                      />
                    </button>
                  )}

                  {m.message_text && <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.message_text}</p>}
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Captain Delivery Proof Capture + Confirm Delivery Bar */}
      {senderRole === 'captain' && order && order.status !== 'delivered' && (
        <div className="px-4 sm:px-5 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
          <label className="flex-1 min-w-[220px] flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold cursor-pointer min-h-[44px]">
            <Camera className="w-4 h-4 shrink-0" />
            <span>
              {uploadingProof
                ? isAr
                  ? 'جاري رفع صورة الأوردر...'
                  : 'Uploading...'
                : hasProof
                ? isAr
                  ? 'إعادة تصوير الأوردر عند منزل العميل'
                  : 'Retake Doorstep Photo'
                : isAr
                ? 'تصوير الأوردر عند منزل العميل وإرساله (شرط التسليم)'
                : 'Capture Doorstep Order Photo (Required)'}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageSend(true)}
              disabled={uploadingProof}
              className="hidden"
            />
          </label>

          {hasProof && (captainId || order.captain_id) && (
            <button
              type="button"
              disabled={confirmingDelivery}
              onClick={handleConfirmDelivery}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold min-h-[44px] whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{confirmingDelivery ? (isAr ? 'جاري التأكيد...' : 'Confirming...') : isAr ? 'تأكيد التسليم الآن' : 'Confirm Delivery'}</span>
            </button>
          )}
        </div>
      )}

      {/* Post-Delivery Invoice Printing Bar for Captain */}
      {senderRole === 'captain' && order && order.status === 'delivered' && (
        <div className="px-4 sm:px-5 py-3 bg-teal-50/90 border-t border-teal-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-teal-950">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
            <span>
              {isAr
                ? `تم تسليم الطلب #${order.order_number} — اطبع فاتورة العميل الآن`
                : `Delivered #${order.order_number} — Print customer receipt`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={printingReceipt}
              onClick={() => handlePrintOrderReceipt('bluetooth')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[40px]"
            >
              <Bluetooth className="w-3.5 h-3.5" />
              <span>{printingReceipt ? 'جاري الطباعة...' : 'طباعة بالبلوتوث'}</span>
            </button>
            <button
              type="button"
              disabled={printingReceipt}
              onClick={() => handlePrintOrderReceipt('thermal_iframe')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[40px]"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span>طباعة حرارية</span>
            </button>
            {onOpenPosForOrder && (
              <button
                type="button"
                onClick={() => {
                  const pre = buildOrderReceiptPrefill();
                  if (pre) onOpenPosForOrder(pre);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-bold min-h-[40px]"
              >
                <Receipt className="w-3.5 h-3.5 text-[#A92224]" />
                <span>تعديل المبلغ في POS</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSendText} className="p-3 sm:p-4 bg-white border-t border-slate-200 flex items-center gap-2">
        <label
          className="w-10 h-10 rounded-xl border border-slate-200 hover:bg-slate-50 flex items-center justify-center cursor-pointer shrink-0 text-slate-600"
          title={isAr ? 'إرسال صورة في الشات' : 'Attach image'}
        >
          <ImagePlus className="w-4 h-4" />
          <input type="file" accept="image/*" onChange={handleImageSend(false)} className="hidden" />
        </label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            senderRole === 'captain'
              ? isAr
                ? 'اكتب رسالة للعميل (مثال: أنا وصلت عند العمارة)...'
                : 'Message customer...'
              : senderRole === 'customer'
              ? isAr
                ? 'تحدث مع الطيار هنا (مثال: الدور الثالث شقة 5)...'
                : 'Message captain...'
              : isAr
              ? 'أرسل رسالة متابعة من الإدارة للطرفين...'
              : 'Admin monitoring note...'
          }
          className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:border-orange-500 min-h-[44px]"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[44px] whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          <span>{isAr ? 'إرسال' : 'Send'}</span>
        </button>
      </form>
    </div>
  );
};
