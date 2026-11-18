import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bluetooth,
  Car,
  CheckCircle2,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Printer,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  DEFAULT_INVOICE_DESIGN,
  getConnectedPrinterName,
  printInvoiceViaBluetooth,
  printInvoiceViaHiddenIframe,
  type PrintablePosInvoice,
} from '../lib/bluetoothPrinter.ts';
import { parseLocalizedNumber, sanitizeDecimalInput } from '../lib/num.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import type {
  CaptainRatingRecord,
  Language,
  NearbyCaptainRecord,
  PosInvoiceRecord,
  PosPrefillReceipt,
  TripChatMessage,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  tripId: string;
  senderRole: 'customer' | 'captain' | 'admin';
  senderName: string;
  captainId?: string;
  lang: Language;
  onBack: () => void;
  onTripUpdated?: () => Promise<void>;
  onTripFinishedReceipt?: (receipt: PosPrefillReceipt) => void;
  onOpenPosForTrip?: (receipt: PosPrefillReceipt) => void;
  onNotify?: (msg: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  searching: 'جاري البحث عن طيار',
  captain_accepted: 'وافق الطيار وهو في طريقه إليك',
  arrived: 'الطيار وصل عند نقطة الانطلاق',
  in_progress: 'الرحلة جارية الآن',
  completed: 'تم إنهاء المشوار',
  cancelled: 'تم إلغاء المشوار',
};

export const TripChatPage: React.FC<Props> = ({
  tripId,
  senderRole,
  senderName,
  captainId,
  lang,
  onBack,
  onTripUpdated,
  onTripFinishedReceipt,
  onOpenPosForTrip,
  onNotify,
}) => {
  const isAr = lang === 'ar';
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [messages, setMessages] = useState<TripChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [printingTripReceipt, setPrintingTripReceipt] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [captainCoords, setCaptainCoords] = useState<{ lat: number; lng: number; updated_at?: string | null } | null>(null);
  const [distanceToPickupKm, setDistanceToPickupKm] = useState<number | null>(null);
  const [etaMin, setEtaMin] = useState<number | null>(null);

  const [fareInput, setFareInput] = useState<string>('');
  const [savingFare, setSavingFare] = useState(false);
  const [nearbyCaptains, setNearbyCaptains] = useState<NearbyCaptainRecord[]>([]);
  const [savingCaptain, setSavingCaptain] = useState(false);

  const [ratingPrompt, setRatingPrompt] = useState<CaptainRatingRecord | null>(null);
  const [finishedReceipt, setFinishedReceipt] = useState<PosPrefillReceipt | null>(null);
  const [savedInvoiceNumber, setSavedInvoiceNumber] = useState<string | null>(null);
  const [ratingScore, setRatingScore] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [submittingRating, setSubmittingRating] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const tripClosedRef = useRef<boolean>(false);
  const tripRef = useRef<TripRecord | null>(null);

  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);

  const makeTripReceiptSnapshot = (t: TripRecord | null, fareOverride?: number): PosPrefillReceipt => {
    const fare = Number(fareOverride ?? t?.final_fare ?? t?.customer_proposed_fare ?? t?.estimated_fare ?? 0);
    const num = t?.trip_number || tripId;
    return {
      ref_type: 'trip',
      ref_id: t?.id || tripId,
      ref_number: num,
      customer_name: t?.customer_name || 'عميل مشوار',
      customer_phone: t?.customer_phone || '',
      items: [
        {
          product_code: num,
          name_ar: t
            ? `مشوار #${num}: من ${t.pickup_address} إلى ${t.dropoff_address} (${t.distance_km} كم)`
            : `أجرة مشوار #${num}`,
          category_name: 'اطلبها مشوار',
          unit_price: fare,
          qty: 1,
          line_total: fare,
        },
      ],
      delivery_fee: 0,
      discount_amount: 0,
      payment_method: 'cash',
    };
  };

  const loadTripAndChat = async () => {
    if (tripClosedRef.current) return;
    try {
      const [chatData, trackData] = await Promise.all([
        api.getRideChat(tripId),
        api.getRideTracking(tripId),
      ]);
      setTrip(chatData.trip);
      setMessages(chatData.messages || []);
      const curFare = Number(chatData.trip?.final_fare ?? chatData.trip?.customer_proposed_fare ?? chatData.trip?.estimated_fare ?? 0);
      if (curFare > 0 && !fareInput) {
        setFareInput(String(curFare));
      }
      if (trackData?.captain_gps) {
        setCaptainCoords({
          lat: trackData.captain_gps.lat,
          lng: trackData.captain_gps.lng,
          updated_at: trackData.captain_gps.updated_at,
        });
        setDistanceToPickupKm(trackData.captain_gps.distance_to_pickup_km ?? null);
        setEtaMin(trackData.captain_gps.eta_min ?? null);
      }
      if (senderRole === 'customer' && chatData.trip?.status === 'searching') {
        api
          .getNearbyCaptains(Number(chatData.trip.pickup_lat || 31.1583), Number(chatData.trip.pickup_lng || 31.9369), 'all')
          .then((caps) => setNearbyCaptains(caps || []))
          .catch(() => {});
      }
    } catch (err) {
      if (!tripClosedRef.current) {
        onNotify?.((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    tripClosedRef.current = false;
    setLoading(true);
    loadTripAndChat();

    let closedByUser = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      tripClosedRef.current = true;
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const connectWs = () => {
      if (closedByUser || tripClosedRef.current) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/order-chat?tripId=${encodeURIComponent(tripId)}`;
      const token = localStorage.getItem('otlobha_access_token');
      ws = new WebSocket(wsUrl, token ? [`bearer.${token}`] : undefined);

      ws.onopen = () => {
        if (!closedByUser) setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (payload.trip_id && payload.trip_id !== tripId && payload.type !== 'captain:location') return;

          if ((payload.type === 'trip_chat:message' || payload.type === 'trip:chat:message') && payload.message) {
            const incoming = payload.message as TripChatMessage;
            setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          } else if (payload.type === 'trip:fare_updated' && payload.trip) {
            setTrip(payload.trip as TripRecord);
            if (payload.final_fare) setFareInput(String(payload.final_fare));
            if (payload.message) {
              const incoming = payload.message as TripChatMessage;
              setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
            }
          } else if ((payload.type === 'trip:accepted' || payload.type === 'trip:status') && payload.trip) {
            setTrip(payload.trip as TripRecord);
          } else if (payload.type === 'trip:completed') {
            stopPolling();
            onTripUpdated?.().catch(() => {});
            if (senderRole === 'customer' && payload.rating_prompt) {
              setRatingPrompt(payload.rating_prompt as CaptainRatingRecord);
              onNotify?.(
                isAr
                  ? `تم إنهاء المشوار (${payload.fare} ج.م) — قيّم الطيار الآن`
                  : 'Ride completed — please rate the captain'
              );
            } else if (senderRole === 'captain') {
              const snap = makeTripReceiptSnapshot(tripRef.current, Number(payload.fare || 0));
              onTripFinishedReceipt?.(snap);
              setFinishedReceipt(snap);
              onNotify?.(
                isAr
                  ? `تم إنهاء المشوار (${payload.fare} ج.م · حصة التطبيق 10%: ${payload.fee_10pct} ج.م) — يمكنك طباعة فاتورة العميل الآن`
                  : 'Ride completed — print customer receipt now'
              );
            } else {
              onNotify?.(
                isAr
                  ? `تم إنهاء المشوار وأرشفته (${payload.fare} ج.م · حصة التطبيق 10%: ${payload.fee_10pct} ج.م)`
                  : 'Ride completed and archived'
              );
              onBack();
            }
          } else if (payload.type === 'trip:cancelled') {
            stopPolling();
            onTripUpdated?.().catch(() => {});
            const pen = Number(payload.penalty_10pct || 0);
            onNotify?.(
              pen > 0
                ? isAr
                  ? `ألغى الطيار المشوار — تم خصم 10% (${pen} ج.م) وأرشفة الطلب`
                  : `Captain cancelled — 10% penalty (${pen} EGP) applied`
                : isAr
                ? 'تم إلغاء المشوار وأرشفته'
                : 'Ride cancelled and archived'
            );
            onBack();
          } else if (payload.type === 'captain:location') {
            if (tripClosedRef.current) return;
            setCaptainCoords({
              lat: Number(payload.lat),
              lng: Number(payload.lng),
              updated_at: payload.updated_at ? String(payload.updated_at) : null,
            });
            api.getRideTracking(tripId).then((t) => {
              if (t?.captain_gps) {
                setDistanceToPickupKm(t.captain_gps.distance_to_pickup_km ?? null);
                setEtaMin(t.captain_gps.eta_min ?? null);
              }
            }).catch(() => {});
          }
        } catch {
          // ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUser && !tripClosedRef.current) reconnectTimer = setTimeout(connectWs, 2500);
      };

      ws.onerror = () => setWsConnected(false);
    };

    connectWs();
    pollId = setInterval(() => {
      if (tripClosedRef.current) return;
      api.getRideTracking(tripId).then((t) => {
        if (t?.trip) setTrip(t.trip);
        if (t?.captain_gps) {
          setCaptainCoords({ lat: t.captain_gps.lat, lng: t.captain_gps.lng, updated_at: t.captain_gps.updated_at });
          setDistanceToPickupKm(t.captain_gps.distance_to_pickup_km ?? null);
          setEtaMin(t.captain_gps.eta_min ?? null);
        }
      }).catch(() => {});
    }, 10000);

    return () => {
      closedByUser = true;
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [tripId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending || tripClosedRef.current) return;
    setSending(true);
    try {
      const res = await api.sendRideChatMessage(tripId, {
        sender_role: senderRole,
        sender_name: senderName,
        message_text: clean,
      });
      setText('');
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      await onTripUpdated?.();
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleSaveFinalFare = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseLocalizedNumber(fareInput);
    if (!Number.isFinite(num) || num <= 0 || savingFare) {
      onNotify?.(isAr ? 'أدخل السعر النهائي المتفق عليه بالجنيه' : 'Enter a valid final fare');
      return;
    }
    setSavingFare(true);
    try {
      const res = await api.updateTripFare(tripId, {
        final_fare: num,
        updated_by_role: senderRole,
        updated_by_name: senderName,
      });
      if (res.trip) setTrip(res.trip);
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      await onTripUpdated?.();
      onNotify?.(
        isAr
          ? `تم رفع السعر النهائي (${res.final_fare} ج.م) — حصة التطبيق 10% = ${res.fee_10pct} ج.م`
          : `Final fare saved (${res.final_fare} EGP)`
      );
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSavingFare(false);
    }
  };

  const handleChangePreferredCaptain = async (capId: string | null) => {
    if (!trip || savingCaptain) return;
    setSavingCaptain(true);
    try {
      const res = await api.updateTripCaptain(trip.id, capId);
      if (res.trip) setTrip(res.trip);
      await onTripUpdated?.();
      onNotify?.(
        res.preferred_captain_name
          ? `تم توجيه المشوار للطيار: ${res.preferred_captain_name}`
          : 'تم فتح المشوار لجميع الطيارين المتاحين'
      );
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSavingCaptain(false);
    }
  };

  const handleCaptainStep = async (nextStatus: 'arrived' | 'in_progress') => {
    const capId = captainId || trip?.captain_id;
    if (!capId || !trip) return;
    setUpdatingStatus(true);
    try {
      const res = await api.updateCaptainTripStatus(capId, trip.id, nextStatus);
      if (res.trip) setTrip(res.trip);
      await onTripUpdated?.();
      onNotify?.(`تم تحديث حالة المشوار: ${STATUS_LABELS[nextStatus] || nextStatus}`);
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleFinishRide = async () => {
    if (!trip || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      tripClosedRef.current = true;
      const res = await api.finishTrip(trip.id, {
        actor_role: senderRole,
        actor_name: senderName,
        captain_id: captainId || trip.captain_id,
      });
      await onTripUpdated?.();
      if (senderRole === 'customer' && res.rating_prompt) {
        setRatingPrompt(res.rating_prompt as CaptainRatingRecord);
        onNotify?.(
          isAr
            ? `تم إنهاء المشوار (${res.fare} ج.م) وإضافته على الطيار 10% (${res.fee_10pct} ج.م) — قيّم الطيار الآن`
            : 'Ride finished — please rate your captain'
        );
      } else if (senderRole === 'captain') {
        const snap = makeTripReceiptSnapshot(trip, Number(res.fare || 0));
        onTripFinishedReceipt?.(snap);
        setFinishedReceipt(snap);
        onNotify?.(
          isAr
            ? `تم إنهاء المشوار (${res.fare} ج.م · 10% للتطبيق = ${res.fee_10pct} ج.م) — اطبع فاتورة العميل الآن`
            : 'Ride finished — print customer receipt now'
        );
      } else {
        onNotify?.(
          isAr
            ? `تم إنهاء المشوار وأرشفته (${res.fare} ج.م · 10% للتطبيق = ${res.fee_10pct} ج.م)`
            : 'Ride finished and archived'
        );
        onBack();
      }
    } catch (err) {
      tripClosedRef.current = false;
      onNotify?.((err as Error).message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePrintFinishedTrip = async (mode: 'bluetooth' | 'thermal_iframe') => {
    if (!finishedReceipt || printingTripReceipt) return;
    const capId = captainId || trip?.captain_id;
    if (!capId) {
      onNotify?.('معرف الطيار غير متوفر لإصدار الفاتورة');
      return;
    }
    setPrintingTripReceipt(true);
    try {
      const [designRes, savedRes] = await Promise.all([
        api.getInvoiceDesign().catch(() => DEFAULT_INVOICE_DESIGN),
        api.createPosInvoice({
          captain_id: capId,
          order_id: null,
          customer_name: finishedReceipt.customer_name,
          customer_phone: finishedReceipt.customer_phone,
          items: finishedReceipt.items,
          delivery_fee: 0,
          discount_amount: 0,
          payment_method: 'cash',
          printed_via: mode,
        }),
      ]);
      const design = { ...DEFAULT_INVOICE_DESIGN, ...(designRes || {}) };
      const saved = savedRes.invoice as PosInvoiceRecord;
      setSavedInvoiceNumber(saved.invoice_number);
      const printable: PrintablePosInvoice = {
        invoice_number: saved.invoice_number,
        created_at: saved.created_at,
        captain_name: saved.captain_name,
        customer_name: saved.customer_name,
        customer_phone: saved.customer_phone,
        order_number: finishedReceipt.ref_number,
        items: saved.items,
        subtotal: saved.subtotal,
        delivery_fee: saved.delivery_fee,
        discount_amount: saved.discount_amount,
        total_amount: saved.total_amount,
        payment_method: saved.payment_method,
      };
      if (mode === 'bluetooth' && getConnectedPrinterName()) {
        await printInvoiceViaBluetooth(printable, design, design.default_paper_width);
        onNotify?.(isAr ? `تمت طباعة فاتورة المشوار ${saved.invoice_number} بالبلوتوث ✓` : 'Printed via Bluetooth');
      } else {
        printInvoiceViaHiddenIframe(printable, design, design.default_paper_width);
        onNotify?.(isAr ? `تم حفظ فاتورة المشوار ${saved.invoice_number} وفتح الطباعة الحرارية` : 'Thermal print opened');
      }
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setPrintingTripReceipt(false);
    }
  };

  const handleCancelRide = async () => {
    if (!trip || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      tripClosedRef.current = true;
      const res = await api.cancelTrip(trip.id, {
        actor_role: senderRole,
        actor_name: senderName,
        captain_id: captainId || trip.captain_id,
      });
      await onTripUpdated?.();
      onNotify?.(
        res.penalty_10pct > 0
          ? isAr
            ? `تم إلغاء المشوار وخصم غرامة 10% (${res.penalty_10pct} ج.م) على الطيار وأرشفة الطلب`
            : `Ride cancelled with 10% captain penalty (${res.penalty_10pct} EGP)`
          : isAr
          ? 'تم إلغاء المشوار وأرشفته'
          : 'Ride cancelled and archived'
      );
      onBack();
    } catch (err) {
      tripClosedRef.current = false;
      onNotify?.((err as Error).message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ratingPrompt || submittingRating) return;
    setSubmittingRating(true);
    try {
      await api.submitRating({
        rating_id: ratingPrompt.id,
        captain_id: ratingPrompt.captain_id,
        customer_name: ratingPrompt.customer_name,
        ref_type: 'trip',
        ref_id: ratingPrompt.ref_id,
        ref_number: ratingPrompt.ref_number,
        final_amount: ratingPrompt.final_amount,
        rating: ratingScore,
        comment: ratingComment,
      });
      await onTripUpdated?.();
      onNotify?.(isAr ? `شكرًا لك! تم تسجيل تقييمك (${ratingScore}/5) للكابتن` : 'Rating submitted');
      onBack();
    } catch (err) {
      onNotify?.((err as Error).message);
    } finally {
      setSubmittingRating(false);
    }
  };

  const roleBadgeLabel = (role: TripChatMessage['sender_role']) => {
    if (role === 'captain') return isAr ? 'الطيار' : 'Captain';
    if (role === 'customer') return isAr ? 'العميل' : 'Customer';
    if (role === 'admin') return isAr ? 'الإدارة' : 'Admin';
    return isAr ? 'النظام' : 'System';
  };

  const BackIcon = isAr ? ArrowRight : ArrowLeft;
  const activeFare = Number(trip?.final_fare ?? trip?.customer_proposed_fare ?? trip?.estimated_fare ?? 0);
  const fee10Pct = Number((activeFare * 0.1).toFixed(2));

  if (finishedReceipt) {
    const tripTotal = finishedReceipt.items.reduce((s, it) => s + Number(it.line_total || 0), 0);
    return (
      <div className="min-h-[calc(100vh-140px)] flex flex-col bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
        <header className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold min-h-[42px]"
            >
              <BackIcon className="w-4 h-4" />
              <span>{isAr ? 'العودة للرئيسية' : 'Back'}</span>
            </button>
            <div>
              <h2 className="text-base font-bold">تم إنهاء المشوار — فاتورة العميل جاهزة</h2>
              <p className="text-xs text-slate-300">
                #{finishedReceipt.ref_number} · العميل: {finishedReceipt.customer_name} · {tripTotal} ج.م
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">اطبع فاتورة المشوار للعميل</h3>
              <p className="text-xs text-slate-500">{finishedReceipt.items[0]?.name_ar}</p>
              <p className="text-xl font-extrabold text-[#A92224] tabular-nums pt-1">{tripTotal.toFixed(2)} ج.م</p>
            </div>

            {savedInvoiceNumber && (
              <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900 text-center font-bold">
                تم إصدار الفاتورة {savedInvoiceNumber} وحفظها في السجل ✓
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={printingTripReceipt}
                onClick={() => handlePrintFinishedTrip('bluetooth')}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#A92224] hover:bg-[#8E1B1D] disabled:opacity-60 text-white rounded-xl text-sm font-bold"
              >
                <Bluetooth className="w-4 h-4" />
                <span>{printingTripReceipt ? 'جاري الطباعة...' : 'حفظ وطباعة بالبلوتوث'}</span>
              </button>
              <button
                type="button"
                disabled={printingTripReceipt}
                onClick={() => handlePrintFinishedTrip('thermal_iframe')}
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
              >
                <Printer className="w-4 h-4 text-amber-400" />
                <span>حفظ وطباعة حرارية (58/80mm)</span>
              </button>
              {onOpenPosForTrip && (
                <button
                  type="button"
                  onClick={() => onOpenPosForTrip(finishedReceipt)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-bold"
                >
                  <Receipt className="w-4 h-4 text-[#A92224]" />
                  <span>فتح الفاتورة وتعديلها في POS</span>
                </button>
              )}
              <button
                type="button"
                onClick={onBack}
                className="w-full py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold"
              >
                تخطي والعودة للرئيسية
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (ratingPrompt) {
    return (
      <div className="min-h-[calc(100vh-140px)] flex flex-col bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
        <header className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold min-h-[42px]"
            >
              <BackIcon className="w-4 h-4" />
              <span>{isAr ? 'تخطي والعودة' : 'Back'}</span>
            </button>
            <div>
              <h2 className="text-base font-bold">تم إنهاء المشوار بنجاح</h2>
              <p className="text-xs text-slate-300">
                {ratingPrompt.ref_number} · السعر النهائي {ratingPrompt.final_amount} ج.م
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <form
            onSubmit={handleSubmitRating}
            className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm"
          >
            <div className="text-center space-y-1">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Star className="w-6 h-6 fill-amber-500 text-amber-500" />
              </div>
              <h3 className="text-base font-bold text-slate-900">قيّم الكابتن {ratingPrompt.captain_name}</h3>
              <p className="text-xs text-slate-500">تقييمك يظهر فورًا في لوحة الإدارة ويساعد في تحسين الخدمة</p>
            </div>

            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingScore(star)}
                  className="p-2 rounded-xl hover:bg-amber-50 transition-colors"
                >
                  <Star
                    className={`w-8 h-8 ${
                      star <= ratingScore ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="اكتب ملاحظتك عن الطيار والتزامه (اختياري)..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
            />

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submittingRating}
                className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold"
              >
                {submittingRating ? 'جاري الإرسال...' : `إرسال التقييم (${ratingScore} ★)`}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold"
              >
                لاحقًا
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
      {/* Top Standalone Page Header */}
      <header className="bg-slate-900 text-white px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold min-h-[42px] shrink-0"
          >
            <BackIcon className="w-4 h-4" />
            <span>{isAr ? 'رجوع' : 'Back'}</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-orange-400 shrink-0" />
              <h2 className="text-sm sm:text-base font-bold truncate">
                {isAr ? `شات وتتبع المشوار ${trip?.trip_number || ''}` : `Trip Chat ${trip?.trip_number || ''}`}
              </h2>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-300 truncate mt-0.5">
              {trip
                ? `${trip.pickup_address} ← ${trip.dropoff_address} · السعر النهائي: ${activeFare} ج.م`
                : 'جاري تحميل تفاصيل المشوار...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2.5 py-1 rounded-lg font-semibold ${
              wsConnected ? 'bg-teal-900/70 text-teal-200 border border-teal-700' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {wsConnected ? 'متصل لحظيًا GPS' : 'إعادة الاتصال...'}
          </span>
          <button
            type="button"
            onClick={loadTripAndChat}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200"
            title="تحديث الموقع والشات"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Live GPS Map + Negotiated Fare + Equal End/Cancel Controls */}
      {trip && (
        <div className="bg-white border-b border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-800 font-bold border border-orange-200">
                  {STATUS_LABELS[trip.status] || trip.status}
                </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {trip.distance_km} كم · السعر الحالي: {activeFare} ج.م
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-num">
                  حصة التطبيق 10%: {fee10Pct} ج.م
                </span>
              </div>
              {trip.captain_name && (
                <p className="text-slate-700">
                  الكابتن: <strong>{trip.captain_name}</strong>
                  {trip.captain_vehicle_model ? ` · ${trip.captain_vehicle_model}` : ''}
                  {trip.captain_plate_number ? ` (${trip.captain_plate_number})` : ''}
                  {trip.captain_phone && (
                    <span className="ms-2 inline-flex items-center gap-1 text-teal-700 font-mono-num">
                      <Phone className="w-3 h-3" /> {trip.captain_phone}
                    </span>
                  )}
                </p>
              )}
            </div>

            {captainCoords && (
              <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 font-semibold tabular-nums">
                <Navigation className="w-4 h-4 text-teal-700 shrink-0" />
                <span>
                  {distanceToPickupKm !== null
                    ? `الطيار على بُعد ${distanceToPickupKm} كم (${etaMin} د)`
                    : `GPS الطيار نشط (${captainCoords.lat.toFixed(4)}, ${captainCoords.lng.toFixed(4)})`}
                </span>
              </div>
            )}
          </div>

          <GpsMapPicker
            heightClass="h-48 sm:h-56"
            pickup={
              trip.pickup_lat && trip.pickup_lng
                ? { lat: trip.pickup_lat, lng: trip.pickup_lng, label: 'نقطة الركوب' }
                : { lat: 31.1583, lng: 31.9369, label: 'نقطة الركوب' }
            }
            dropoff={
              trip.dropoff_lat && trip.dropoff_lng
                ? { lat: trip.dropoff_lat, lng: trip.dropoff_lng, label: 'الوجهة' }
                : null
            }
            captainPin={
              captainCoords && trip.captain_id
                ? {
                    id: trip.captain_id,
                    full_name: trip.captain_name || 'الطيار',
                    vehicle_type: trip.vehicle_type,
                    vehicle_model: trip.captain_vehicle_model || '',
                    lat: captainCoords.lat,
                    lng: captainCoords.lng,
                    distance_km: distanceToPickupKm ?? undefined,
                  }
                : null
            }
          />

          {/* Agreed Fare: editable by Admin only, read-only summary for Customer & Captain */}
          {senderRole === 'admin' ? (
            <form
              onSubmit={handleSaveFinalFare}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <Banknote className="w-4 h-4 text-orange-600 shrink-0" />
                <span>تعديل الأجرة النهائية إداريًا (يُحسب منها 10%):</span>
              </div>
              <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={fareInput}
                  onChange={(e) => setFareInput(sanitizeDecimalInput(e.target.value))}
                  placeholder="السعر النهائي"
                  className="w-28 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold tabular-nums text-center"
                />
                <button
                  type="submit"
                  disabled={savingFare}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                >
                  {savingFare ? 'جاري التحديث...' : 'اعتماد الأجرة'}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <Banknote className="w-4 h-4 text-orange-600 shrink-0" />
                <span>الأجرة المعتمدة للرحلة: {activeFare} ج.م</span>
              </div>
              <span className="text-slate-600">
                {trip.preferred_captain_name
                  ? `موجه للطيار: ${trip.preferred_captain_name}`
                  : 'اتفق في الشات أو تواصل مع الإدارة لتعديل الأجرة'}
              </span>
            </div>
          )}

          {senderRole === 'admin' && trip.status === 'searching' && !trip.captain_id && nearbyCaptains.length > 0 && (
            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <span className="font-bold text-indigo-950">
                توجيه الطلب لطيار محدد: {trip.preferred_captain_name || 'مفتوح لأي طيار'}
              </span>
              <select
                disabled={savingCaptain}
                value={trip.preferred_captain_id || ''}
                onChange={(e) => handleChangePreferredCaptain(e.target.value || null)}
                className="px-3 py-2 bg-white border border-indigo-300 rounded-lg text-xs font-semibold min-w-[210px]"
              >
                <option value="">متاح لجميع الطيارين ({nearbyCaptains.length})</option>
                {nearbyCaptains.map((cap) => (
                  <option key={cap.id} value={cap.id}>
                    {cap.full_name} ({cap.vehicle_model}) · {cap.distance_km} كم
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action Buttons: Equal Finish & Cancel for Customer and Captain + Captain Progress Steps */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-2">
              {senderRole === 'captain' && trip.status === 'captain_accepted' && (
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleCaptainStep('arrived')}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold min-h-[40px]"
                >
                  وصلت لموقع العميل
                </button>
              )}
              {senderRole === 'captain' && (trip.status === 'captain_accepted' || trip.status === 'arrived') && (
                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => handleCaptainStep('in_progress')}
                  className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold min-h-[40px]"
                >
                  بدأت الرحلة الآن
                </button>
              )}
              <button
                type="button"
                disabled={updatingStatus}
                onClick={handleFinishRide}
                className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[40px]"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>إنهاء المشوار ({activeFare} ج.م)</span>
              </button>
              <button
                type="button"
                disabled={updatingStatus}
                onClick={handleCancelRide}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[40px]"
              >
                <XCircle className="w-4 h-4" />
                <span>
                  {senderRole === 'captain' ? `إلغاء الرحلة (خصم 10%: ${fee10Pct} ج.م)` : 'إلغاء الرحلة'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[240px] max-h-[380px]">
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">جاري تحميل المحادثة...</div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 space-y-1">
            <MessageSquare className="w-7 h-7 mx-auto text-slate-400" />
            <p>تفاوضا هنا على السعر النهائي ونقطة الالتقاء، ثم ارفعا السعر للسيستم قبل الإنهاء.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isAutomatedSystemNote =
              m.sender_role === 'system' &&
              (!m.sender_name || m.sender_name === 'النظام' || m.sender_name === 'System');

            if (isAutomatedSystemNote) {
              return (
                <div key={m.id} className="flex justify-center">
                  <div className="max-w-lg px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-600 text-center">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-600 inline-block me-1" />
                    {m.message_text}
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
                ? trip?.captain_name || 'كابتن المشوار'
                : effectiveRole === 'customer'
                ? trip?.customer_name || 'العميل'
                : 'إدارة اطلبها');

            const isMine = effectiveRole === senderRole;
            const senderBadgeStyle =
              effectiveRole === 'captain'
                ? 'bg-orange-600 text-white'
                : effectiveRole === 'admin'
                ? 'bg-indigo-600 text-white'
                : 'bg-teal-700 text-white';
            const roleEmoji =
              effectiveRole === 'captain' ? '🏍️' : effectiveRole === 'customer' ? '👤' : '🛡️';

            return (
              <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[82%] rounded-2xl p-3 text-xs space-y-1.5 border shadow-xs ${
                    effectiveRole === 'captain'
                      ? 'bg-orange-50 border-orange-200 text-slate-900'
                      : effectiveRole === 'admin'
                      ? 'bg-indigo-50 border-indigo-200 text-slate-900'
                      : 'bg-white border-teal-200 text-slate-900'
                  }`}
                >
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
                          أنت
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono-num text-slate-400">
                      {String(m.created_at || '').slice(11, 16)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.message_text}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Chat Composer */}
      <form onSubmit={handleSendText} className="bg-white border-t border-slate-200 p-3 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isAr ? 'اكتب رسالتك أو عرض السعر للتفاوض...' : 'Write a message...'}
          className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold min-h-[44px]"
        >
          <Send className="w-4 h-4" />
          <span>{isAr ? 'إرسال' : 'Send'}</span>
        </button>
      </form>
    </div>
  );
};
