import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Truck,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { parseLocalizedNumber, sanitizeDecimalInput } from '../lib/num.ts';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import type {
  AdminCustomerDetail,
  AdminCustomerSummary,
  CaptainRecord,
  Language,
  OrderChatMessage,
  OrderRecord,
  ServiceZone,
  TripChatMessage,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  captains: CaptainRecord[];
  zones: ServiceZone[];
  onRefreshCore: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const ORDER_STATUS_LABELS: Record<string, { ar: string; en: string; cls: string }> = {
  pending_merchant: { ar: 'بانتظار التاجر', en: 'Pending Merchant', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  awaiting_quote: { ar: 'بانتظار التسعير', en: 'Awaiting Quote', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  preparing: { ar: 'جاري التجهيز', en: 'Preparing', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  ready_for_pickup: { ar: 'جاهز للاستلام', en: 'Ready', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  on_the_way: { ar: 'في الطريق للعميل', en: 'On the Way', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  delivered: { ar: 'تم التسليم', en: 'Delivered', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  cancelled: { ar: 'ملغي', en: 'Cancelled', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const TRIP_STATUS_LABELS: Record<string, { ar: string; en: string; cls: string }> = {
  searching: { ar: 'جاري البحث عن طيار', en: 'Searching', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  captain_accepted: { ar: 'وافق الطيار', en: 'Accepted', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  arrived: { ar: 'الطيار وصل', en: 'Arrived', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  in_progress: { ar: 'الرحلة جارية', en: 'In Progress', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  completed: { ar: 'مكتمل', en: 'Completed', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  cancelled: { ar: 'ملغي', en: 'Cancelled', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const GPS_SOURCE_LABELS: Record<AdminCustomerSummary['gps_source'], { ar: string; en: string }> = {
  customer_gps: { ar: 'موقع العميل المباشر (GPS)', en: 'Customer Live GPS' },
  latest_trip: { ar: 'من آخر طلب مشوار GPS', en: 'Latest Ride GPS' },
  latest_order: { ar: 'من آخر طلب متجر/صيدلية', en: 'Latest Order GPS' },
  zone_default: { ar: 'مركز المنطقة المسجلة', en: 'Zone Center Fallback' },
};

export const CustomersSection: React.FC<Props> = ({ lang, captains, onRefreshCore, onNotify }) => {
  const isAr = lang === 'ar';

  const [customers, setCustomers] = useState<AdminCustomerSummary[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'registered'>('all');
  const [customerPage, setCustomerPage] = useState<number>(1);
  const [filteredTotal, setFilteredTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [customerStats, setCustomerStats] = useState<{
    total_customers: number;
    registered_count: number;
    active_users_count: number;
  }>({ total_customers: 0, registered_count: 0, active_users_count: 0 });

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<'orders' | 'trips' | 'parcels'>('orders');

  // Selected Order & Admin Control State
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderStatusDraft, setOrderStatusDraft] = useState<string>('pending_merchant');
  const [orderCaptainDraft, setOrderCaptainDraft] = useState<string>('');
  const [orderSubtotalDraft, setOrderSubtotalDraft] = useState<string>('');
  const [orderAddressDraft, setOrderAddressDraft] = useState<string>('');
  const [orderCancelReason, setOrderCancelReason] = useState<string>('');
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState<boolean>(false);

  // Order Chat Viewer State
  const [orderChatMessages, setOrderChatMessages] = useState<OrderChatMessage[]>([]);
  const [loadingOrderChat, setLoadingOrderChat] = useState<boolean>(false);
  const [orderChatInput, setOrderChatInput] = useState<string>('');
  const [sendingOrderChat, setSendingOrderChat] = useState<boolean>(false);
  const [orderWsLive, setOrderWsLive] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const orderChatEndRef = useRef<HTMLDivElement | null>(null);

  // Selected Trip & Admin Control State
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripFareDraft, setTripFareDraft] = useState<string>('');
  const [tripPreferredCapDraft, setTripPreferredCapDraft] = useState<string>('');
  const [tripCancelReason, setTripCancelReason] = useState<string>('');
  const [confirmCancelTripId, setConfirmCancelTripId] = useState<string | null>(null);
  const [savingTripAction, setSavingTripAction] = useState<boolean>(false);

  // Trip Chat Viewer State
  const [tripChatMessages, setTripChatMessages] = useState<TripChatMessage[]>([]);
  const [loadingTripChat, setLoadingTripChat] = useState<boolean>(false);
  const [tripChatInput, setTripChatInput] = useState<string>('');
  const [sendingTripChat, setSendingTripChat] = useState<boolean>(false);
  const [tripWsLive, setTripWsLive] = useState<boolean>(false);
  const tripChatEndRef = useRef<HTMLDivElement | null>(null);

  const loadCustomers = async (keepSelection = true, opts?: { page?: number; search?: string; filter?: 'all' | 'active' | 'registered' }) => {
    const targetPage = opts?.page ?? customerPage;
    const targetSearch = opts?.search !== undefined ? opts.search : debouncedSearch;
    const targetFilter = opts?.filter ?? filterMode;
    setLoadingList(true);
    try {
      const res = await api.getAdminCustomersPaginated({
        q: targetSearch || undefined,
        filter: targetFilter,
        page: targetPage,
        limit: 50,
      });
      const list = (res.items || []) as AdminCustomerSummary[];
      setCustomers(list);
      setFilteredTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
      if (res.stats) setCustomerStats(res.stats);
      if (list.length > 0) {
        if (!keepSelection || !selectedCustomerId || !list.some((c) => c.id === selectedCustomerId)) {
          setSelectedCustomerId(list[0].id);
        }
      } else {
        setSelectedCustomerId(null);
        setDetail(null);
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingList(false);
    }
  };

  const loadCustomerDetail = async (custId: string) => {
    setLoadingDetail(true);
    try {
      const data = (await api.getAdminCustomerDetail(custId)) as AdminCustomerDetail;
      setDetail(data);
      const nextOrders = data.orders || [];
      const nextTrips = data.trips || [];

      if (nextOrders.length > 0) {
        setSelectedOrderId((prev) => (prev && nextOrders.some((o) => o.id === prev) ? prev : nextOrders[0].id));
      } else {
        setSelectedOrderId(null);
      }

      if (nextTrips.length > 0) {
        setSelectedTripId((prev) => (prev && nextTrips.some((t) => t.id === prev) ? prev : nextTrips[0].id));
      } else {
        setSelectedTripId(null);
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setCustomerPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    loadCustomers(true, { page: customerPage, search: debouncedSearch, filter: filterMode });
  }, [customerPage, debouncedSearch, filterMode]);

  useEffect(() => {
    if (selectedCustomerId) {
      setConfirmCancelOrderId(null);
      setConfirmCancelTripId(null);
      loadCustomerDetail(selectedCustomerId);
    }
  }, [selectedCustomerId]);

  const selectedOrder: OrderRecord | null = useMemo(() => {
    if (!detail?.orders || !selectedOrderId) return null;
    return detail.orders.find((o) => o.id === selectedOrderId) || null;
  }, [detail?.orders, selectedOrderId]);

  const selectedTrip: TripRecord | null = useMemo(() => {
    if (!detail?.trips || !selectedTripId) return null;
    return detail.trips.find((t) => t.id === selectedTripId) || null;
  }, [detail?.trips, selectedTripId]);

  // Sync draft form fields when selectedOrder changes
  useEffect(() => {
    if (!selectedOrder) return;
    setOrderStatusDraft(selectedOrder.status);
    setOrderCaptainDraft(selectedOrder.captain_id || '');
    setOrderSubtotalDraft(String(selectedOrder.subtotal ?? 0));
    setOrderAddressDraft(selectedOrder.address_landmark || '');
    setOrderCancelReason('');
    setConfirmCancelOrderId(null);
  }, [selectedOrder?.id, selectedOrder?.status, selectedOrder?.captain_id, selectedOrder?.subtotal]);

  // Sync draft form fields when selectedTrip changes
  useEffect(() => {
    if (!selectedTrip) return;
    const activeFare = selectedTrip.final_fare ?? selectedTrip.customer_proposed_fare ?? selectedTrip.estimated_fare ?? 0;
    setTripFareDraft(String(activeFare));
    setTripPreferredCapDraft(selectedTrip.preferred_captain_id || '');
    setTripCancelReason('');
    setConfirmCancelTripId(null);
  }, [selectedTrip?.id, selectedTrip?.final_fare, selectedTrip?.preferred_captain_id]);

  // Load & subscribe to Order Chat when selectedOrder changes
  useEffect(() => {
    if (!selectedOrder) {
      setOrderChatMessages([]);
      return;
    }
    const orderId = selectedOrder.id;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    setLoadingOrderChat(true);
    api
      .getOrderChat(orderId)
      .then((res) => {
        if (!closed) setOrderChatMessages(res.messages || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!closed) setLoadingOrderChat(false);
      });

    const connectWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/order-chat?orderId=${encodeURIComponent(orderId)}`);
      ws.onopen = () => {
        if (!closed) setOrderWsLive(true);
      };
      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (payload.order_id && payload.order_id !== orderId) return;
          if (payload.type === 'chat:message' && payload.message) {
            const incoming = payload.message as OrderChatMessage;
            setOrderChatMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          } else if (payload.type === 'order:status' && selectedCustomerId) {
            loadCustomerDetail(selectedCustomerId).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        setOrderWsLive(false);
        if (!closed) reconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onerror = () => setOrderWsLive(false);
    };

    connectWs();
    return () => {
      closed = true;
      setOrderWsLive(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    };
  }, [selectedOrder?.id]);

  // Load & subscribe to Trip Chat when selectedTrip changes
  useEffect(() => {
    if (!selectedTrip) {
      setTripChatMessages([]);
      return;
    }
    const tripId = selectedTrip.id;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    setLoadingTripChat(true);
    api
      .getRideChat(tripId)
      .then((res) => {
        if (!closed) setTripChatMessages(res.messages || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!closed) setLoadingTripChat(false);
      });

    const connectWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/order-chat?tripId=${encodeURIComponent(tripId)}`);
      ws.onopen = () => {
        if (!closed) setTripWsLive(true);
      };
      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (payload.trip_id && payload.trip_id !== tripId) return;
          if ((payload.type === 'trip_chat:message' || payload.type === 'trip:chat:message') && payload.message) {
            const incoming = payload.message as TripChatMessage;
            setTripChatMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          } else if (payload.type === 'trip:fare_updated' && payload.message) {
            const incoming = payload.message as TripChatMessage;
            setTripChatMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
            if (selectedCustomerId) loadCustomerDetail(selectedCustomerId).catch(() => {});
          } else if ((payload.type === 'trip:completed' || payload.type === 'trip:cancelled') && selectedCustomerId) {
            loadCustomers(true).catch(() => {});
            loadCustomerDetail(selectedCustomerId).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        setTripWsLive(false);
        if (!closed) reconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onerror = () => setTripWsLive(false);
    };

    connectWs();
    return () => {
      closed = true;
      setTripWsLive(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    };
  }, [selectedTrip?.id]);

  // Server-side filtered and paginated (50 customers/page)
  const filteredCustomers = customers;

  const refreshAll = async () => {
    await Promise.all([
      loadCustomers(true),
      selectedCustomerId ? loadCustomerDetail(selectedCustomerId) : Promise.resolve(),
      onRefreshCore(),
    ]);
  };

  const handleSaveOrderChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || savingOrder) return;
    setSavingOrder(true);
    try {
      const subNum = parseLocalizedNumber(orderSubtotalDraft);
      await api.adminUpdateOrder(selectedOrder.id, {
        status: orderStatusDraft,
        captain_id: orderCaptainDraft ? orderCaptainDraft : null,
        subtotal: Number.isFinite(subNum) && subNum >= 0 ? subNum : selectedOrder.subtotal,
        address_landmark: orderAddressDraft.trim(),
      });
      await refreshAll();
      onNotify(isAr ? `تم حفظ تعديلات الطلب #${selectedOrder.order_number}` : `Order #${selectedOrder.order_number} updated`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };

  const handleSmartAssignOrderCaptain = async () => {
    if (!selectedOrder || savingOrder) return;
    setSavingOrder(true);
    try {
      const res = await api.adminUpdateOrder(selectedOrder.id, {
        assign_best_captain: true,
      });
      await refreshAll();
      const capName = res.order?.captain_name;
      onNotify(
        capName
          ? isAr
            ? `تم إسناد الطلب #${selectedOrder.order_number} ذكيًا للكابتن ${capName}`
            : `Assigned to ${capName}`
          : isAr
          ? 'لم يتوفر كابتن متاح حاليًا — اختر كابتنًا يدويًا من القائمة'
          : 'No available captain found'
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!selectedOrder || savingOrder) return;
    setSavingOrder(true);
    try {
      await api.adminUpdateOrder(selectedOrder.id, {
        status: 'cancelled',
        reason: orderCancelReason.trim() || 'إلغاء إداري من صفحة العملاء',
      });
      setConfirmCancelOrderId(null);
      setOrderCancelReason('');
      await refreshAll();
      onNotify(isAr ? `تم إلغاء الطلب #${selectedOrder.order_number}` : `Order #${selectedOrder.order_number} cancelled`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };

  const handleSendAdminOrderChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !orderChatInput.trim() || sendingOrderChat) return;
    setSendingOrderChat(true);
    try {
      const res = await api.sendOrderChatMessage(selectedOrder.id, {
        sender_role: 'admin',
        sender_name: isAr ? 'إدارة اطلبها' : 'Otlobha Admin',
        message_text: orderChatInput.trim(),
        is_delivery_proof: false,
      });
      setOrderChatInput('');
      if (res.message) {
        setOrderChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSendingOrderChat(false);
    }
  };

  const handleUpdateTripFare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip || savingTripAction) return;
    const num = parseLocalizedNumber(tripFareDraft);
    if (!Number.isFinite(num) || num <= 0) {
      onNotify(isAr ? 'أدخل سعرًا صحيحًا للمشوار' : 'Enter valid fare');
      return;
    }
    setSavingTripAction(true);
    try {
      const res = await api.updateTripFare(selectedTrip.id, {
        final_fare: num,
        updated_by_role: 'admin',
        updated_by_name: isAr ? 'إدارة اطلبها' : 'Super Admin',
      });
      await refreshAll();
      onNotify(isAr ? `تم تعديل السعر النهائي إلى ${res.final_fare} ج.م` : `Fare updated to ${res.final_fare}`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingTripAction(false);
    }
  };

  const handleAssignTripPreferredCaptain = async (capId: string | null) => {
    if (!selectedTrip || savingTripAction) return;
    setSavingTripAction(true);
    try {
      const res = await api.updateTripCaptain(selectedTrip.id, capId);
      setTripPreferredCapDraft(capId || '');
      await refreshAll();
      onNotify(
        res.preferred_captain_name
          ? isAr
            ? `تم توجيه المشوار للطيار: ${res.preferred_captain_name}`
            : `Directed to ${res.preferred_captain_name}`
          : isAr
          ? 'تم فتح المشوار لجميع الطيارين'
          : 'Opened to all captains'
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingTripAction(false);
    }
  };

  const handleFinishTripAdmin = async () => {
    if (!selectedTrip || savingTripAction) return;
    setSavingTripAction(true);
    try {
      const res = await api.finishTrip(selectedTrip.id, {
        actor_role: 'admin',
        actor_name: isAr ? 'إدارة اطلبها' : 'Super Admin',
        captain_id: selectedTrip.captain_id,
      });
      await refreshAll();
      onNotify(
        isAr
          ? `تم إنهاء المشوار #${selectedTrip.trip_number} (${res.fare} ج.م · 10% = ${res.fee_10pct} ج.م)`
          : `Trip #${selectedTrip.trip_number} finished`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingTripAction(false);
    }
  };

  const handleCancelTripAdmin = async () => {
    if (!selectedTrip || savingTripAction) return;
    setSavingTripAction(true);
    try {
      await api.cancelTrip(selectedTrip.id, {
        actor_role: 'admin',
        actor_name: isAr ? 'إدارة اطلبها' : 'Super Admin',
        captain_id: selectedTrip.captain_id,
        reason: tripCancelReason.trim() || 'إلغاء إداري من صفحة العملاء',
      });
      setConfirmCancelTripId(null);
      setTripCancelReason('');
      await refreshAll();
      onNotify(isAr ? `تم إلغاء المشوار #${selectedTrip.trip_number}` : `Trip #${selectedTrip.trip_number} cancelled`);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSavingTripAction(false);
    }
  };

  const handleSendAdminTripChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip || !tripChatInput.trim() || sendingTripChat) return;
    setSendingTripChat(true);
    try {
      const res = await api.sendRideChatMessage(selectedTrip.id, {
        sender_role: 'admin',
        sender_name: isAr ? 'إدارة اطلبها' : 'Otlobha Admin',
        message_text: tripChatInput.trim(),
      });
      setTripChatInput('');
      if (res.message) {
        setTripChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSendingTripChat(false);
    }
  };

  const totalCustomers = customerStats.total_customers;
  const registeredCount = customerStats.registered_count;
  const activeUsersCount = customerStats.active_users_count;
  const activeCustomer = detail?.customer ?? customers.find((c) => c.id === selectedCustomerId) ?? null;

  // Map pins: show active customer + active order/trip captain & dropoff if currently viewing that tab
  const mapPickup = useMemo(() => {
    if (!activeCustomer) return null;
    if (detailTab === 'trips' && selectedTrip && selectedTrip.pickup_lat && selectedTrip.pickup_lng) {
      return {
        lat: Number(selectedTrip.pickup_lat),
        lng: Number(selectedTrip.pickup_lng),
        label: `${activeCustomer.full_name} (انطلاق ${selectedTrip.trip_number})`,
      };
    }
    if (detailTab === 'orders' && selectedOrder && selectedOrder.customer_lat && selectedOrder.customer_lng) {
      return {
        lat: Number(selectedOrder.customer_lat),
        lng: Number(selectedOrder.customer_lng),
        label: `${activeCustomer.full_name} (${selectedOrder.order_number})`,
      };
    }
    return {
      lat: Number(activeCustomer.lat || 31.1583),
      lng: Number(activeCustomer.lng || 31.9369),
      label: `موقع ${activeCustomer.full_name}`,
    };
  }, [activeCustomer, detailTab, selectedOrder, selectedTrip]);

  const mapDropoff = useMemo(() => {
    if (detailTab === 'trips' && selectedTrip && selectedTrip.dropoff_lat && selectedTrip.dropoff_lng) {
      return {
        lat: Number(selectedTrip.dropoff_lat),
        lng: Number(selectedTrip.dropoff_lng),
        label: `وجهة: ${selectedTrip.dropoff_address}`,
      };
    }
    return null;
  }, [detailTab, selectedTrip]);

  const mapCaptainPin = useMemo(() => {
    if (detailTab === 'orders' && selectedOrder?.captain_id && selectedOrder.captain_lat && selectedOrder.captain_lng) {
      return {
        id: selectedOrder.captain_id,
        full_name: selectedOrder.captain_name || 'الطيار',
        vehicle_type: 'moto',
        lat: Number(selectedOrder.captain_lat),
        lng: Number(selectedOrder.captain_lng),
      };
    }
    if (detailTab === 'trips' && selectedTrip?.captain_id && selectedTrip.captain_lat && selectedTrip.captain_lng) {
      return {
        id: selectedTrip.captain_id,
        full_name: selectedTrip.captain_name || 'الطيار',
        vehicle_type: selectedTrip.vehicle_type,
        vehicle_model: selectedTrip.captain_vehicle_model || '',
        lat: Number(selectedTrip.captain_lat),
        lng: Number(selectedTrip.captain_lng),
      };
    }
    return null;
  }, [detailTab, selectedOrder, selectedTrip]);

  const roleLabel = (role: string) => {
    if (role === 'customer') return isAr ? 'العميل' : 'Customer';
    if (role === 'captain') return isAr ? 'الطيار' : 'Captain';
    if (role === 'admin') return isAr ? 'الإدارة' : 'Admin';
    return isAr ? 'النظام' : 'System';
  };

  return (
    <div className="space-y-5">
      {/* Image Lightbox Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4" onClick={() => setPreviewImageUrl(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">{isAr ? 'معاينة الصورة المرفقة' : 'Attachment Preview'}</span>
              <button
                type="button"
                onClick={() => setPreviewImageUrl(null)}
                className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-bold"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex justify-center">
              <img src={previewImageUrl} alt="Attachment" className="max-h-[70vh] rounded-lg object-contain" referrerPolicy="no-referrer" />
            </div>
          </div>
        </div>
      )}

      {/* Top KPI Strip (Single-Elevation SaaS Metrics) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-[11px] font-medium text-slate-500">{isAr ? 'إجمالي المستخدمين والعملاء' : 'Total Customers'}</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{totalCustomers}</p>
          </div>
          <div className="h-8 w-px bg-slate-200 hidden sm:block" />
          <div>
            <p className="text-[11px] font-medium text-slate-500">{isAr ? 'حسابات موثقة بالبريد' : 'Registered Accounts'}</p>
            <p className="text-xl font-bold text-teal-700 tabular-nums mt-0.5">{registeredCount}</p>
          </div>
          <div className="h-8 w-px bg-slate-200 hidden sm:block" />
          <div>
            <p className="text-[11px] font-medium text-slate-500">{isAr ? 'عملاء لديهم طلبات أو مشاوير جارية' : 'Active Requests'}</p>
            <p className="text-xl font-bold text-orange-600 tabular-nums mt-0.5">{activeUsersCount}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{isAr ? 'تحديث قائمة العملاء والمواقع' : 'Refresh Directory'}</span>
        </button>
      </div>

      {/* Master-Detail Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left/Start Column: Customer Directory */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-600" />
                <span>{isAr ? 'دليل المستخدمين' : 'Users Directory'}</span>
              </h2>
              <span className="text-[11px] text-slate-500 tabular-nums font-semibold">
                {filteredTotal.toLocaleString('en-US')} / {totalCustomers.toLocaleString('en-US')}
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? 'بحث بالاسم أو الهاتف أو البريد أو المنطقة...' : 'Search name, phone, email, zone...'}
                className="w-full ps-8 pe-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-orange-500 focus:bg-white"
              />
            </div>

            <div className="flex gap-1.5 text-[11px]">
              {[
                { id: 'all' as const, label: isAr ? 'الكل' : 'All' },
                { id: 'active' as const, label: isAr ? 'طلبات ومشاوير نشطة' : 'Active' },
                { id: 'registered' as const, label: isAr ? 'موثقين بالبريد' : 'Verified' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFilterMode(f.id);
                    setCustomerPage(1);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-semibold transition-colors ${
                    filterMode === f.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
            {loadingList ? (
              <p className="p-6 text-center text-xs text-slate-500">{isAr ? 'جاري تحميل المستخدمين...' : 'Loading customers...'}</p>
            ) : filteredCustomers.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">{isAr ? 'لا يوجد مستخدمون مطابقون للبحث' : 'No matching users'}</p>
            ) : (
              filteredCustomers.map((c) => {
                const selected = c.id === selectedCustomerId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(c.id)}
                    className={`w-full text-start p-3.5 transition-colors flex items-start justify-between gap-2.5 ${
                      selected ? 'bg-orange-50/70 border-s-4 border-s-orange-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 truncate">{c.full_name}</span>
                        {c.is_registered ? (
                          <span className="text-[10px] font-semibold text-teal-700 shrink-0">✓ موثق</span>
                        ) : (
                          <span className="text-[10px] font-medium text-slate-400 shrink-0">زائر</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate tabular-nums">
                        {c.phone ? <span dir="ltr" className="font-mono-num">{c.phone}</span> : isAr ? 'بدون هاتف' : 'No phone'}
                        {c.email ? (
                          <>
                            {' · '}
                            <span dir="ltr" className="font-mono-num">{c.email}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {c.zone_name} · <span className="tabular-nums font-semibold text-slate-700">{c.orders_count} طلب</span> ·{' '}
                        <span className="tabular-nums font-semibold text-slate-700">{c.trips_count} مشوار</span>
                      </p>
                    </div>
                    {(c.active_orders_count > 0 || c.trips_count > 0) && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded text-[10px] font-bold tabular-nums">
                        {c.active_orders_count + c.trips_count} نشط
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {totalPages > 1 && (
            <div className="px-3.5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[11px] text-slate-600">
              <button
                type="button"
                disabled={customerPage <= 1 || loadingList}
                onClick={() => setCustomerPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 border border-slate-200 bg-white rounded-md font-semibold hover:bg-slate-100 disabled:opacity-40"
              >
                {isAr ? 'السابق' : 'Prev'}
              </button>
              <span className="font-bold tabular-nums text-slate-800">
                {customerPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={customerPage >= totalPages || loadingList}
                onClick={() => setCustomerPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 border border-slate-200 bg-white rounded-md font-semibold hover:bg-slate-100 disabled:opacity-40"
              >
                {isAr ? 'التالي' : 'Next'}
              </button>
            </div>
          )}
        </div>

        {/* Right/End Column: Customer Inspector */}
        <div className="lg:col-span-8 space-y-5">
          {!activeCustomer ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <User className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700">{isAr ? 'اختر مستخدمًا من القائمة لعرض ملفه وموقعه وطلباته' : 'Select a customer'}</p>
            </div>
          ) : loadingDetail && !detail ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              {isAr ? 'جاري تحميل بيانات العميل وموقعه وطلباته...' : 'Loading customer details...'}
            </div>
          ) : (
            <>
              {/* 1. Customer Profile Summary & GPS Map */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{activeCustomer.full_name}</h3>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            activeCustomer.is_registered
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {activeCustomer.is_registered ? (isAr ? 'حساب عميل موثق' : 'Verified Account') : isAr ? 'طلب زائر' : 'Guest'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                        {activeCustomer.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span dir="ltr" className="font-mono-num font-semibold text-slate-800">{activeCustomer.phone}</span>
                          </span>
                        )}
                        {activeCustomer.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <span dir="ltr" className="font-mono-num">{activeCustomer.email}</span>
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-orange-600" />
                          <span>{activeCustomer.zone_name}</span>
                        </span>
                      </div>
                      {activeCustomer.address_landmark && (
                        <p className="text-xs text-slate-500">
                          {isAr ? 'العنوان المسجل:' : 'Address:'} <span className="text-slate-800 font-medium">{activeCustomer.address_landmark}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs tabular-nums">
                    <div className="text-end">
                      <p className="text-[11px] text-slate-500">{isAr ? 'إجمالي إنفاق الطلبات' : 'Total Order Spend'}</p>
                      <p className="text-base font-bold text-slate-900">{activeCustomer.total_spent} ج.م</p>
                    </div>
                    <div className="text-end">
                      <p className="text-[11px] text-slate-500">{isAr ? 'آخر دخول / نشاط' : 'Last Activity'}</p>
                      <p className="text-xs font-mono-num text-slate-700">
                        {activeCustomer.last_login_at ? String(activeCustomer.last_login_at).slice(0, 16).replace('T', ' ') : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live Customer GPS Map */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <Navigation className="w-4 h-4 text-teal-600 shrink-0" />
                      <span>{isAr ? 'موقع المستخدم على الخريطة (GPS)' : 'Customer GPS Location'}</span>
                      <span className="text-[11px] font-medium text-slate-500">
                        · {isAr ? GPS_SOURCE_LABELS[activeCustomer.gps_source].ar : GPS_SOURCE_LABELS[activeCustomer.gps_source].en}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 tabular-nums">
                      <span dir="ltr" className="font-mono-num text-slate-700 font-semibold">
                        {Number(activeCustomer.lat).toFixed(5)}, {Number(activeCustomer.lng).toFixed(5)}
                      </span>
                      {activeCustomer.location_updated_at && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {String(activeCustomer.location_updated_at).slice(0, 16).replace('T', ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <GpsMapPicker
                    heightClass="h-52"
                    pickup={mapPickup}
                    dropoff={mapDropoff}
                    captainPin={mapCaptainPin}
                  />
                </div>
              </div>

              {/* 2. Activity Sub-Tabs */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="border-b border-slate-200 px-4 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
                  <div className="flex items-center gap-1">
                    {[
                      {
                        id: 'orders' as const,
                        label: isAr ? 'الطلبات والمتاجر' : 'Orders',
                        count: detail?.orders.length ?? activeCustomer.orders_count,
                        icon: ShoppingBag,
                      },
                      {
                        id: 'trips' as const,
                        label: isAr ? 'المشاوير والرحلات' : 'Rides & Trips',
                        count: detail?.trips.length ?? activeCustomer.trips_count,
                        icon: Car,
                      },
                      {
                        id: 'parcels' as const,
                        label: isAr ? 'الطرود والتقييمات' : 'Parcels & Ratings',
                        count: (detail?.parcels.length ?? 0) + (detail?.ratings.length ?? 0),
                        icon: Package,
                      },
                    ].map((t) => {
                      const Icon = t.icon;
                      const active = detailTab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setDetailTab(t.id)}
                          className={`flex items-center gap-1.5 px-3.5 py-3 text-xs font-bold border-b-2 transition-colors ${
                            active
                              ? 'border-orange-600 text-orange-700 bg-white'
                              : 'border-transparent text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{t.label}</span>
                          <span className="px-1.5 py-0.5 bg-slate-200/70 text-slate-800 rounded text-[10px] tabular-nums">
                            {t.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ORDERS TAB */}
                {detailTab === 'orders' && (
                  <div className="p-4 space-y-4">
                    {!detail || detail.orders.length === 0 ? (
                      <p className="py-8 text-center text-xs text-slate-500">
                        {isAr ? 'لا توجد طلبات مسجلة لهذا المستخدم حتى الآن.' : 'No orders found for this customer.'}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                        {/* Orders Selector List */}
                        <div className="xl:col-span-5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
                          {detail.orders.map((ord) => {
                            const st = ORDER_STATUS_LABELS[ord.status] || {
                              ar: ord.status,
                              en: ord.status,
                              cls: 'bg-slate-100 text-slate-700 border-slate-200',
                            };
                            const active = ord.id === selectedOrder?.id;
                            return (
                              <button
                                key={ord.id}
                                type="button"
                                onClick={() => setSelectedOrderId(ord.id)}
                                className={`w-full text-start p-3 space-y-1.5 transition-colors ${
                                  active ? 'bg-orange-50/70 border-s-4 border-s-orange-600' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono-num text-xs font-bold text-slate-900">#{ord.order_number}</span>
                                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${st.cls}`}>
                                    {isAr ? st.ar : st.en}
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-slate-800 truncate flex items-center gap-1">
                                  <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span>{ord.merchant_name}</span>
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {ord.free_order_text || ord.address_landmark}
                                </p>
                                <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums pt-0.5">
                                  <span className="font-bold text-slate-900">{ord.total_amount} ج.م</span>
                                  <span>
                                    {ord.captain_name ? `الطيار: ${ord.captain_name}` : 'بدون طيار'} · 💬 {ord.chat_count || 0}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Selected Order Detail + Admin Controls + Live Chat */}
                        {selectedOrder && (
                          <div className="xl:col-span-7 space-y-4">
                            {/* Order Details Card */}
                            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                                <div>
                                  <h4 className="text-sm font-bold text-slate-900">
                                    {isAr ? 'تفاصيل الطلب' : 'Order'} <span className="font-mono-num">#{selectedOrder.order_number}</span>
                                  </h4>
                                  <p className="text-[11px] text-slate-500">
                                    {selectedOrder.merchant_name} · {selectedOrder.zone_name} ·{' '}
                                    <span className="font-mono-num">{String(selectedOrder.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                                  </p>
                                </div>
                                <div className="text-end tabular-nums">
                                  <p className="text-xs text-slate-500">
                                    {isAr ? 'السلة:' : 'Sub:'} {selectedOrder.subtotal} + {isAr ? 'توصيل:' : 'Fee:'} {selectedOrder.delivery_fee}
                                    {selectedOrder.discount_amount > 0 ? ` - خصم: ${selectedOrder.discount_amount}` : ''}
                                  </p>
                                  <p className="text-sm font-bold text-slate-900">{isAr ? 'الإجمالي:' : 'Total:'} {selectedOrder.total_amount} ج.م</p>
                                </div>
                              </div>

                              {selectedOrder.free_order_text && (
                                <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 whitespace-pre-wrap">
                                  <span className="font-bold text-slate-600">{isAr ? 'الأصناف / نص الطلب: ' : 'Items / Notes: '}</span>
                                  {selectedOrder.free_order_text}
                                </div>
                              )}

                              {(selectedOrder.prescription_image_url || selectedOrder.delivery_proof_image_url) && (
                                <div className="flex flex-wrap gap-3">
                                  {selectedOrder.prescription_image_url && (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewImageUrl(selectedOrder.prescription_image_url!)}
                                      className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-50"
                                    >
                                      <img
                                        src={selectedOrder.prescription_image_url}
                                        alt="Rx"
                                        className="w-10 h-10 rounded object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                      <span>{isAr ? 'عرض صورة الروشتة' : 'View Rx'}</span>
                                    </button>
                                  )}
                                  {selectedOrder.delivery_proof_image_url && (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewImageUrl(selectedOrder.delivery_proof_image_url!)}
                                      className="flex items-center gap-2 p-2 bg-teal-50 border border-teal-200 rounded-lg text-xs font-semibold text-teal-900 hover:bg-teal-100"
                                    >
                                      <Camera className="w-4 h-4 text-teal-700" />
                                      <span>{isAr ? 'صورة تسليم الطيار عند المنزل' : 'Delivery Proof'}</span>
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Admin Control Form */}
                              <form onSubmit={handleSaveOrderChanges} className="pt-2 border-t border-slate-200 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                                    <span>{isAr ? 'تحكم الإدارة في الطلب' : 'Admin Order Controls'}</span>
                                  </span>
                                  <button
                                    type="button"
                                    disabled={savingOrder}
                                    onClick={handleSmartAssignOrderCaptain}
                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg text-[11px] font-bold"
                                  >
                                    {isAr ? 'تعيين ذكي لأقرب طيار' : 'Smart Assign Captain'}
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                  <label className="space-y-1 block">
                                    <span className="text-[11px] font-semibold text-slate-600">{isAr ? 'حالة الطلب' : 'Status'}</span>
                                    <select
                                      value={orderStatusDraft}
                                      onChange={(e) => setOrderStatusDraft(e.target.value)}
                                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                                    >
                                      {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {isAr ? v.ar : v.en}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="space-y-1 block">
                                    <span className="text-[11px] font-semibold text-slate-600">{isAr ? 'تعيين / تغيير الطيار' : 'Assign Captain'}</span>
                                    <select
                                      value={orderCaptainDraft}
                                      onChange={(e) => setOrderCaptainDraft(e.target.value)}
                                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                                    >
                                      <option value="">{isAr ? 'بدون طيار محدد' : 'Unassigned'}</option>
                                      {captains.map((cap) => (
                                        <option key={cap.id} value={cap.id}>
                                          {cap.full_name} ({cap.availability_status === 'available' ? 'متاح' : cap.availability_status === 'busy' ? 'مشغول' : 'غير متصل'})
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="space-y-1 block">
                                    <span className="text-[11px] font-semibold text-slate-600">{isAr ? 'قيمة السلة (ج.م)' : 'Subtotal (EGP)'}</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      dir="ltr"
                                      value={orderSubtotalDraft}
                                      onChange={(e) => setOrderSubtotalDraft(sanitizeDecimalInput(e.target.value))}
                                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
                                    />
                                  </label>

                                  <label className="space-y-1 block">
                                    <span className="text-[11px] font-semibold text-slate-600">{isAr ? 'العنوان التفصيلي' : 'Address'}</span>
                                    <input
                                      type="text"
                                      value={orderAddressDraft}
                                      onChange={(e) => setOrderAddressDraft(e.target.value)}
                                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                                    />
                                  </label>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                  <button
                                    type="submit"
                                    disabled={savingOrder}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>{savingOrder ? (isAr ? 'جاري الحفظ...' : 'Saving...') : isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
                                  </button>

                                  {selectedOrder.status !== 'cancelled' && (
                                    confirmCancelOrderId === selectedOrder.id ? (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <input
                                          type="text"
                                          value={orderCancelReason}
                                          onChange={(e) => setOrderCancelReason(e.target.value)}
                                          placeholder={isAr ? 'سبب الإلغاء (اختياري)...' : 'Cancel reason...'}
                                          className="px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs w-44"
                                        />
                                        <button
                                          type="button"
                                          disabled={savingOrder}
                                          onClick={handleCancelOrder}
                                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold"
                                        >
                                          {isAr ? 'تأكيد الإلغاء' : 'Confirm Cancel'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmCancelOrderId(null)}
                                          className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold"
                                        >
                                          {isAr ? 'تراجع' : 'Back'}
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmCancelOrderId(selectedOrder.id)}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                        <span>{isAr ? 'إلغاء الطلب' : 'Cancel Order'}</span>
                                      </button>
                                    )
                                  )}
                                </div>
                              </form>
                            </div>

                            {/* Order Customer <-> Captain Chat Transcript + Admin Reply */}
                            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                              <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold">
                                  <MessageSquare className="w-4 h-4 text-orange-400" />
                                  <span>
                                    {isAr
                                      ? `الشات بين العميل والطيار للطلب #${selectedOrder.order_number}`
                                      : `Order #${selectedOrder.order_number} Chat`}
                                  </span>
                                </div>
                                <span className={`text-[10px] font-semibold ${orderWsLive ? 'text-teal-300' : 'text-slate-400'}`}>
                                  {orderWsLive ? '● متصل لحظيًا' : '○ تحديث تلقائي'}
                                </span>
                              </div>

                              <div className="p-3.5 bg-slate-50 space-y-2.5 max-h-64 overflow-y-auto">
                                {loadingOrderChat ? (
                                  <p className="text-center text-xs text-slate-500 py-6">{isAr ? 'جاري تحميل الرسائل...' : 'Loading chat...'}</p>
                                ) : orderChatMessages.length === 0 ? (
                                  <p className="text-center text-xs text-slate-500 py-6">
                                    {isAr ? 'لا توجد رسائل مسجلة بعد في هذا الطلب.' : 'No messages yet in this order.'}
                                  </p>
                                ) : (
                                  orderChatMessages.map((m) => (
                                    <div
                                      key={m.id}
                                      className={`rounded-xl border px-3 py-2 text-xs space-y-1 ${
                                        m.sender_role === 'system'
                                          ? 'bg-white border-slate-200 text-slate-600 text-center'
                                          : m.sender_role === 'captain'
                                          ? 'bg-orange-50 border-orange-200 text-slate-900'
                                          : m.sender_role === 'admin'
                                          ? 'bg-indigo-50 border-indigo-200 text-slate-900'
                                          : 'bg-white border-slate-200 text-slate-900'
                                      }`}
                                    >
                                      {m.sender_role !== 'system' && (
                                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                                          <span>
                                            {roleLabel(m.sender_role)} · {m.sender_name}
                                          </span>
                                          <span className="font-mono-num text-[10px] text-slate-400">
                                            {String(m.created_at || '').slice(11, 16)}
                                          </span>
                                        </div>
                                      )}
                                      {m.image_url && (
                                        <button type="button" onClick={() => setPreviewImageUrl(m.image_url)} className="block">
                                          <img
                                            src={m.image_url}
                                            alt="Chat Attachment"
                                            className="max-h-36 rounded-lg border border-slate-200 object-cover"
                                            referrerPolicy="no-referrer"
                                          />
                                        </button>
                                      )}
                                      {m.message_text && <p className="leading-relaxed whitespace-pre-wrap">{m.message_text}</p>}
                                    </div>
                                  ))
                                )}
                                <div ref={orderChatEndRef} />
                              </div>

                              <form onSubmit={handleSendAdminOrderChat} className="p-2.5 bg-white border-t border-slate-200 flex items-center gap-2">
                                <input
                                  type="text"
                                  value={orderChatInput}
                                  onChange={(e) => setOrderChatInput(e.target.value)}
                                  placeholder={isAr ? 'أرسل رسالة إدارية في شات الطلب للعميل والطيار...' : 'Send admin message...'}
                                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-orange-500"
                                />
                                <button
                                  type="submit"
                                  disabled={sendingOrderChat || !orderChatInput.trim()}
                                  className="inline-flex items-center gap-1 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>{isAr ? 'إرسال' : 'Send'}</span>
                                </button>
                              </form>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TRIPS TAB */}
                {detailTab === 'trips' && (
                  <div className="p-4 space-y-4">
                    {(!detail || (detail.trips.length === 0 && detail.trip_history_logs.length === 0)) ? (
                      <p className="py-8 text-center text-xs text-slate-500">
                        {isAr ? 'لا توجد مشاوير جارية أو سابقة مسجلة لهذا المستخدم.' : 'No rides found for this customer.'}
                      </p>
                    ) : (
                      <>
                        {detail.trips.length > 0 && (
                          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
                            {/* Trips Selector List */}
                            <div className="xl:col-span-5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                              {detail.trips.map((trp) => {
                                const st = TRIP_STATUS_LABELS[trp.status] || {
                                  ar: trp.status,
                                  en: trp.status,
                                  cls: 'bg-slate-100 text-slate-700 border-slate-200',
                                };
                                const active = trp.id === selectedTrip?.id;
                                const fareVal = trp.final_fare ?? trp.customer_proposed_fare ?? trp.estimated_fare;
                                return (
                                  <button
                                    key={trp.id}
                                    type="button"
                                    onClick={() => setSelectedTripId(trp.id)}
                                    className={`w-full text-start p-3 space-y-1.5 transition-colors ${
                                      active ? 'bg-orange-50/70 border-s-4 border-s-orange-600' : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono-num text-xs font-bold text-slate-900">#{trp.trip_number}</span>
                                      <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${st.cls}`}>
                                        {isAr ? st.ar : st.en}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-700 truncate">
                                      {trp.pickup_address} ← {trp.dropoff_address}
                                    </p>
                                    <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                                      <span className="font-bold text-slate-900">{fareVal} ج.م · {trp.distance_km} كم</span>
                                      <span>{trp.captain_name || trp.preferred_captain_name || 'بحث مفتوح'} · 💬 {trp.chat_count || 0}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Selected Trip Detail + Admin Controls + Live Chat */}
                            {selectedTrip && (
                              <div className="xl:col-span-7 space-y-4">
                                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                                    <div>
                                      <h4 className="text-sm font-bold text-slate-900">
                                        {isAr ? 'تفاصيل المشوار' : 'Trip'} <span className="font-mono-num">#{selectedTrip.trip_number}</span>
                                      </h4>
                                      <p className="text-[11px] text-slate-500">
                                        {selectedTrip.vehicle_type} · {selectedTrip.distance_km} كم ·{' '}
                                        {selectedTrip.captain_name
                                          ? `الطيار المقبول: ${selectedTrip.captain_name}`
                                          : selectedTrip.preferred_captain_name
                                          ? `موجه إلى: ${selectedTrip.preferred_captain_name}`
                                          : 'بانتظار قبول أي طيار'}
                                      </p>
                                    </div>
                                    <div className="text-end tabular-nums">
                                      <p className="text-[11px] text-slate-500">
                                        {isAr ? 'سعر العميل المقترح:' : 'Proposed:'} {selectedTrip.customer_proposed_fare ?? selectedTrip.estimated_fare} ج.م
                                      </p>
                                      <p className="text-sm font-bold text-slate-900">
                                        {isAr ? 'النهائي:' : 'Final:'} {selectedTrip.final_fare ?? selectedTrip.customer_proposed_fare ?? selectedTrip.estimated_fare} ج.م
                                      </p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
                                      <p className="text-[10px] font-bold text-teal-700">{isAr ? 'نقطة الانطلاق (GPS)' : 'Pickup'}</p>
                                      <p className="text-slate-800 mt-0.5">{selectedTrip.pickup_address}</p>
                                    </div>
                                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
                                      <p className="text-[10px] font-bold text-orange-700">{isAr ? 'وجهة التوصيل' : 'Dropoff'}</p>
                                      <p className="text-slate-800 mt-0.5">{selectedTrip.dropoff_address}</p>
                                    </div>
                                  </div>

                                  {/* Admin Trip Controls */}
                                  <div className="pt-2 border-t border-slate-200 space-y-2.5">
                                    <form onSubmit={handleUpdateTripFare} className="flex flex-wrap items-center justify-between gap-2">
                                      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                                        <Banknote className="w-4 h-4 text-orange-600" />
                                        <span>{isAr ? 'تعديل السعر النهائي (لحساب 10%):' : 'Final Fare:'}</span>
                                      </label>
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          dir="ltr"
                                          value={tripFareDraft}
                                          onChange={(e) => setTripFareDraft(sanitizeDecimalInput(e.target.value))}
                                          className="w-24 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold font-mono-num text-center"
                                        />
                                        <button
                                          type="submit"
                                          disabled={savingTripAction}
                                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold"
                                        >
                                          {isAr ? 'حفظ السعر' : 'Update Fare'}
                                        </button>
                                      </div>
                                    </form>

                                    {selectedTrip.status === 'searching' && !selectedTrip.captain_id && (
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="font-semibold text-slate-700">{isAr ? 'توجيه المشوار لطيار محدد:' : 'Direct to Captain:'}</span>
                                        <select
                                          disabled={savingTripAction}
                                          value={tripPreferredCapDraft}
                                          onChange={(e) => handleAssignTripPreferredCaptain(e.target.value || null)}
                                          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold min-w-[200px]"
                                        >
                                          <option value="">{isAr ? 'مفتوح لجميع الطيارين' : 'Open to All Captains'}</option>
                                          {captains.map((cap) => (
                                            <option key={cap.id} value={cap.id}>
                                              {cap.full_name} ({cap.vehicle_model})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                      <button
                                        type="button"
                                        disabled={savingTripAction}
                                        onClick={handleFinishTripAdmin}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>{isAr ? 'إنهاء المشوار (10% على الطيار)' : 'Finish Trip'}</span>
                                      </button>

                                      {confirmCancelTripId === selectedTrip.id ? (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <input
                                            type="text"
                                            value={tripCancelReason}
                                            onChange={(e) => setTripCancelReason(e.target.value)}
                                            placeholder={isAr ? 'سبب الإلغاء...' : 'Reason...'}
                                            className="px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs w-40"
                                          />
                                          <button
                                            type="button"
                                            disabled={savingTripAction}
                                            onClick={handleCancelTripAdmin}
                                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold"
                                          >
                                            {isAr ? 'تأكيد إلغاء المشوار' : 'Confirm'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setConfirmCancelTripId(null)}
                                            className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs"
                                          >
                                            {isAr ? 'تراجع' : 'Back'}
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setConfirmCancelTripId(selectedTrip.id)}
                                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold"
                                        >
                                          <XCircle className="w-3.5 h-3.5" />
                                          <span>{isAr ? 'إلغاء المشوار وإزالته' : 'Cancel Trip'}</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Trip Customer <-> Captain Chat Transcript + Admin Reply */}
                                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                                  <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-2 text-xs">
                                    <div className="flex items-center gap-2 font-bold">
                                      <MessageSquare className="w-4 h-4 text-orange-400" />
                                      <span>
                                        {isAr
                                          ? `شات التفاوض بين العميل والطيار (#${selectedTrip.trip_number})`
                                          : `Trip #${selectedTrip.trip_number} Chat`}
                                      </span>
                                    </div>
                                    <span className={`text-[10px] font-semibold ${tripWsLive ? 'text-teal-300' : 'text-slate-400'}`}>
                                      {tripWsLive ? '● متصل لحظيًا' : '○ تحديث تلقائي'}
                                    </span>
                                  </div>

                                  <div className="p-3.5 bg-slate-50 space-y-2.5 max-h-60 overflow-y-auto">
                                    {loadingTripChat ? (
                                      <p className="text-center text-xs text-slate-500 py-6">{isAr ? 'جاري تحميل الشات...' : 'Loading chat...'}</p>
                                    ) : tripChatMessages.length === 0 ? (
                                      <p className="text-center text-xs text-slate-500 py-6">
                                        {isAr ? 'لم يتم إرسال رسائل تفاوض في هذا المشوار بعد.' : 'No messages yet in this trip.'}
                                      </p>
                                    ) : (
                                      tripChatMessages.map((m) => (
                                        <div
                                          key={m.id}
                                          className={`rounded-xl border px-3 py-2 text-xs space-y-1 ${
                                            m.sender_role === 'system'
                                              ? 'bg-white border-slate-200 text-slate-600 text-center'
                                              : m.sender_role === 'captain'
                                              ? 'bg-orange-50 border-orange-200 text-slate-900'
                                              : m.sender_role === 'admin'
                                              ? 'bg-indigo-50 border-indigo-200 text-slate-900'
                                              : 'bg-white border-slate-200 text-slate-900'
                                          }`}
                                        >
                                          {m.sender_role !== 'system' && (
                                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                                              <span>
                                                {roleLabel(m.sender_role)} · {m.sender_name}
                                              </span>
                                              <span className="font-mono-num text-[10px] text-slate-400">
                                                {String(m.created_at || '').slice(11, 16)}
                                              </span>
                                            </div>
                                          )}
                                          <p className="leading-relaxed whitespace-pre-wrap">{m.message_text}</p>
                                        </div>
                                      ))
                                    )}
                                    <div ref={tripChatEndRef} />
                                  </div>

                                  <form onSubmit={handleSendAdminTripChat} className="p-2.5 bg-white border-t border-slate-200 flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={tripChatInput}
                                      onChange={(e) => setTripChatInput(e.target.value)}
                                      placeholder={isAr ? 'أرسل رسالة إدارية للعميل والطيار في المشوار...' : 'Send admin note...'}
                                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-orange-500"
                                    />
                                    <button
                                      type="submit"
                                      disabled={sendingTripChat || !tripChatInput.trim()}
                                      className="inline-flex items-center gap-1 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold"
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                      <span>{isAr ? 'إرسال' : 'Send'}</span>
                                    </button>
                                  </form>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Historical Completed/Cancelled Trip Audit Trail */}
                        {detail.trip_history_logs.length > 0 && (
                          <div className="border-t border-slate-200 pt-4 space-y-2">
                            <h5 className="text-xs font-bold text-slate-700">
                              {isAr ? 'سجل المشاوير السابقة المنتهية / الملغاة' : 'Historical Completed/Cancelled Ride Log'}
                            </h5>
                            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                              {detail.trip_history_logs.map((log) => (
                                <div key={log.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <p className="text-slate-800 font-medium">{log.details}</p>
                                  <span className="font-mono-num text-[11px] text-slate-400">
                                    {String(log.created_at || '').slice(0, 16).replace('T', ' ')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* PARCELS & RATINGS TAB */}
                {detailTab === 'parcels' && (
                  <div className="p-4 space-y-5">
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-orange-600" />
                        <span>{isAr ? 'الطرود والشحنات المرسلة' : 'Parcels'}</span>
                      </h4>
                      {!detail || detail.parcels.length === 0 ? (
                        <p className="py-4 text-xs text-slate-500">{isAr ? 'لا توجد طرود مرسلة من هذا العميل.' : 'No parcels.'}</p>
                      ) : (
                        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                          {detail.parcels.map((p) => (
                            <div key={String(p.id)} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="space-y-0.5">
                                <p className="font-bold text-slate-900">
                                  <span className="font-mono-num">#{String(p.delivery_number)}</span> · {String(p.item_category)}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {String(p.pickup_address)} ← {String(p.dropoff_address)} · هاتف المستلم:{' '}
                                  <span dir="ltr" className="font-mono-num">{String(p.receiver_phone)}</span>
                                </p>
                              </div>
                              <div className="text-end tabular-nums">
                                <p className="font-bold text-slate-900">{String(p.delivery_fee)} ج.م · OTP: {String(p.delivery_otp)}</p>
                                <p className="text-[11px] text-slate-500">
                                  {p.captain_name ? `الطيار: ${String(p.captain_name)}` : 'بانتظار طيار'} · {String(p.status)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-amber-500" />
                        <span>{isAr ? 'تقييمات العميل للطيارين' : 'Captain Ratings'}</span>
                      </h4>
                      {!detail || detail.ratings.length === 0 ? (
                        <p className="py-4 text-xs text-slate-500">{isAr ? 'لم يرسل العميل تقييمات بعد.' : 'No ratings submitted.'}</p>
                      ) : (
                        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                          {detail.ratings.map((r) => (
                            <div key={r.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div>
                                <p className="font-bold text-slate-900">
                                  {r.captain_name} · <span className="font-mono-num">#{r.ref_number}</span>
                                </p>
                                {r.comment && <p className="text-[11px] text-slate-600 mt-0.5">"{r.comment}"</p>}
                              </div>
                              <div className="text-end tabular-nums">
                                <p className="font-bold text-amber-600">
                                  {r.rating !== null ? `${r.rating} / 5 ★` : isAr ? 'بانتظار التقييم' : 'Pending'}
                                </p>
                                <p className="text-[11px] text-slate-400">{r.final_amount} ج.م</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
