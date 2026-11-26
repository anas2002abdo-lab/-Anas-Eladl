import React, { useEffect, useState } from 'react';
import {
  Banknote,
  Bell,
  Camera,
  Car,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Receipt,
  RefreshCw,
  Settings,
  ShieldAlert,
  Smartphone,
  Store,
  Trash2,
  Truck,
  User,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  computeOrderStoreStats,
  getSectionItemCount,
  isSectionPickedUpByCaptain,
} from '../lib/orderBundles.ts';
import { OrderChatPage } from './OrderChatPage.tsx';
import { TripChatPage } from './TripChatPage.tsx';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import { CaptainPosSection } from './CaptainPosSection.tsx';
import { CaptainRidesPanel } from './rides/CaptainRidesPanel.tsx';
import type {
  CaptainRecord,
  Language,
  NotificationRecord,
  OrderRecord,
  PosPrefillReceipt,
  ServiceZone,
  SettlementRecord,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  captains: CaptainRecord[];
  orders: OrderRecord[];
  zones: ServiceZone[];
  onRefreshCore: () => Promise<void>;
  onNotify: (msg: string) => void;
}

type CaptainTab = 'home' | 'orders' | 'pos' | 'settlement' | 'profile';
type OrderSubFilter = 'all_today' | 'open' | 'completed';

const CAPTAIN_SESSION_KEY = 'otlobha_captain_session_id';

export const CaptainMobilePreview: React.FC<Props> = ({ lang, captains, orders, zones, onRefreshCore, onNotify }) => {
  const isAr = lang === 'ar';
  const [tab, setTab] = useState<CaptainTab>('home');
  const [orderFilter, setOrderFilter] = useState<OrderSubFilter>('all_today');
  const [loggedCaptainId, setLoggedCaptainId] = useState<string>(() => {
    try {
      return localStorage.getItem(CAPTAIN_SESSION_KEY) || '';
    } catch {
      return '';
    }
  });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [showRegister, setShowRegister] = useState<boolean>(false);
  const [showInbox, setShowInbox] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [parcels, setParcels] = useState<any[]>([]);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [activeChatOrderId, setActiveChatOrderId] = useState<string | null>(null);
  const [activeChatTripId, setActiveChatTripId] = useState<string | null>(null);
  const [prefillReceipt, setPrefillReceipt] = useState<PosPrefillReceipt | null>(null);
  const [lastFinishedTripReceipt, setLastFinishedTripReceipt] = useState<PosPrefillReceipt | null>(null);
  const [gpsLat, setGpsLat] = useState<number>(31.1583);
  const [gpsLng, setGpsLng] = useState<number>(31.9369);
  const [gpsUpdatedAt, setGpsUpdatedAt] = useState<string | null>(null);
  const [autoGps, setAutoGps] = useState<boolean>(true);
  const [showGpsMap, setShowGpsMap] = useState<boolean>(true);
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [acceptingTripId, setAcceptingTripId] = useState<string | null>(null);

  // Registration Form State
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regNationalId, setRegNationalId] = useState('');
  const [regZone, setRegZone] = useState('وسط مدينة المنزلة');
  const [regVehicleType, setRegVehicleType] = useState<'moto' | 'tuktuk' | 'car' | 'bicycle'>('moto');
  const [regVehicleModel, setRegVehicleModel] = useState('');
  const [regPlate, setRegPlate] = useState('');
  const [regVehiclePhoto1, setRegVehiclePhoto1] = useState('');
  const [regVehiclePhoto2, setRegVehiclePhoto2] = useState('');
  const [regDocsReady, setRegDocsReady] = useState(true);
  const [settleAmount, setSettleAmount] = useState(300);
  const [settleMethod, setSettleMethod] = useState<'vodafone_cash' | 'instapay'>('vodafone_cash');

  const [loggedInCaptainProfile, setLoggedInCaptainProfile] = useState<CaptainRecord | null>(null);
  const [localOrders, setLocalOrders] = useState<OrderRecord[]>([]);
  const activeCaptain = loggedInCaptainProfile || captains.find((c) => c.id === loggedCaptainId) || null;

  const setCaptainSession = (id: string) => {
    setLoggedCaptainId(id);
    try {
      if (id) localStorage.setItem(CAPTAIN_SESSION_KEY, id);
      else localStorage.removeItem(CAPTAIN_SESSION_KEY);
    } catch {
      // ignore storage errors
    }
  };

  const loadCaptainData = async (capId?: string) => {
    const targetId = capId || loggedCaptainId;
    if (!targetId) return;
    const [allOrders, allParcels, allTrips, notifs, capSettlements] = await Promise.all([
      api.getOrders().catch(() => []),
      api.getParcels().catch(() => []),
      api.getTrips().catch(() => []),
      api.getMobileNotifications('captain', targetId).catch(() => []),
      api.getCaptainSettlements(targetId).catch(() => ({ settlements: [] })),
    ]);
    setLocalOrders(allOrders || []);
    setParcels(allParcels || []);
    setTrips(allTrips || []);
    setNotifications(notifs || []);
    setSettlements((capSettlements?.settlements || []) as SettlementRecord[]);
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (cancelled) return;
        if (res.authenticated && res.user?.actorType === 'captain') {
          setLoggedInCaptainProfile(res.user as CaptainRecord);
          setCaptainSession(String(res.user.id));
        } else {
          setLoggedInCaptainProfile(null);
          setCaptainSession('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoggedInCaptainProfile(null);
        setCaptainSession('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loggedCaptainId) return;
    loadCaptainData(loggedCaptainId).catch(() => {});

    const onFocus = () => {
      loadCaptainData(loggedCaptainId).catch(() => {});
      onRefreshCore().catch(() => {});
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [loggedCaptainId]);

  useEffect(() => {
    if (activeCaptain) {
      if (typeof activeCaptain.lat === 'number' && typeof activeCaptain.lng === 'number') {
        setGpsLat(activeCaptain.lat);
        setGpsLng(activeCaptain.lng);
      }
      setGpsUpdatedAt(activeCaptain.location_updated_at || null);
    }
  }, [activeCaptain?.id]);

  const captainTabHistoryRef = React.useRef<CaptainTab[]>([]);
  const prevCaptainTabRef = React.useRef<CaptainTab>('home');
  const captainBackGuardActiveRef = React.useRef<boolean>(false);

  useEffect(() => {
    if (prevCaptainTabRef.current !== tab) {
      const prev = prevCaptainTabRef.current;
      if (captainTabHistoryRef.current[captainTabHistoryRef.current.length - 1] !== prev) {
        captainTabHistoryRef.current = [...captainTabHistoryRef.current.slice(-9), prev];
      }
      prevCaptainTabRef.current = tab;
    }
  }, [tab]);

  const hasCaptainBackStep = Boolean(
    activeChatOrderId ||
      activeChatTripId ||
      showInbox ||
      showSettings ||
      showRegister ||
      (tab === 'orders' && orderFilter !== 'all_today') ||
      tab !== 'home'
  );

  const captainBackActionRef = React.useRef<() => boolean>(() => false);
  captainBackActionRef.current = () => {
    if (activeChatOrderId) {
      setActiveChatOrderId(null);
      return true;
    }
    if (activeChatTripId) {
      setActiveChatTripId(null);
      return true;
    }
    if (showInbox) {
      setShowInbox(false);
      return true;
    }
    if (showSettings) {
      setShowSettings(false);
      return true;
    }
    if (showRegister) {
      setShowRegister(false);
      return true;
    }
    if (tab === 'orders' && orderFilter !== 'all_today') {
      setOrderFilter('all_today');
      return true;
    }
    if (captainTabHistoryRef.current.length > 0) {
      const nextStack = [...captainTabHistoryRef.current];
      const prevTab = nextStack.pop()!;
      captainTabHistoryRef.current = nextStack;
      prevCaptainTabRef.current = prevTab;
      setTab(prevTab);
      return true;
    }
    if (tab !== 'home') {
      prevCaptainTabRef.current = 'home';
      setTab('home');
      return true;
    }
    return false;
  };

  const [captainBackPopSeq, setCaptainBackPopSeq] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasCaptainBackStep && !captainBackGuardActiveRef.current) {
      try {
        window.history.pushState({ otlobhaMobileBackGuard: 'captain' }, '');
        captainBackGuardActiveRef.current = true;
      } catch {
        // ignore sandboxed history restrictions
      }
    }
  }, [hasCaptainBackStep, captainBackPopSeq]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      captainBackGuardActiveRef.current = false;
      const handled = captainBackActionRef.current();
      if (handled) {
        setCaptainBackPopSeq((n) => n + 1);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (loggedCaptainId && activeCaptain) {
      loadCaptainData(loggedCaptainId).catch(() => {});
    }
  }, [loggedCaptainId, activeCaptain?.id]);

  const sendCaptainGps = async (capId: string, lat: number, lng: number, silent = false) => {
    try {
      const res = await api.updateCaptainLocation(capId, lat, lng);
      setGpsLat(res.lat);
      setGpsLng(res.lng);
      setGpsUpdatedAt(res.updated_at);
      if (!silent) {
        onNotify(isAr ? 'تم تحديث موقعك بالـ GPS لإظهاره للعملاء في المنزلة' : 'GPS location updated');
      }
    } catch (err) {
      if (!silent) onNotify((err as Error).message);
    }
  };

  const handleSyncMyGpsNow = () => {
    if (!activeCaptain) return;
    if (!navigator.geolocation) {
      setShowGpsMap(true);
      onNotify(isAr ? 'المتصفح لا يدعم GPS — حدد موقعك على الخريطة' : 'Use map to set GPS');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        await sendCaptainGps(activeCaptain.id, lat, lng, false);
        setLocatingGps(false);
      },
      async () => {
        setLocatingGps(false);
        setShowGpsMap(true);
        await sendCaptainGps(activeCaptain.id, gpsLat, gpsLng, true);
        onNotify(isAr ? 'اضغط على الخريطة لتعديل موقع الـ GPS الخاص بك يدويًا' : 'Tap map to set GPS');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  useEffect(() => {
    if (!activeCaptain || !autoGps || activeCaptain.availability_status !== 'available') return;
    const syncOnce = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            sendCaptainGps(
              activeCaptain.id,
              Number(pos.coords.latitude.toFixed(6)),
              Number(pos.coords.longitude.toFixed(6)),
              true
            );
          },
          () => {
            sendCaptainGps(activeCaptain.id, gpsLat, gpsLng, true);
          },
          { enableHighAccuracy: true, timeout: 5000 }
        );
      } else {
        sendCaptainGps(activeCaptain.id, gpsLat, gpsLng, true);
      }
    };
    syncOnce();
    const timer = setInterval(syncOnce, 20000);
    return () => clearInterval(timer);
  }, [activeCaptain?.id, activeCaptain?.availability_status, autoGps]);

  useEffect(() => {
    if (!activeCaptain) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsQuery =
        activeCaptain.verification_status === 'approved'
          ? 'channel=rides'
          : `channel=captain&captainId=${encodeURIComponent(activeCaptain.id)}`;
      ws = new WebSocket(`${proto}//${window.location.host}/ws/order-chat?${wsQuery}`);
      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (
            payload.type === 'trip:created' ||
            payload.type === 'trip:accepted' ||
            payload.type === 'trip:status' ||
            payload.type === 'trip:fare_updated' ||
            payload.type === 'trip:completed' ||
            payload.type === 'trip:cancelled' ||
            payload.type === 'order:status' ||
            payload.type === 'rating:submitted'
          ) {
            Promise.all([loadCaptainData(activeCaptain.id), onRefreshCore()]).catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = (ev) => {
        if (!closed && ev.code !== 4401) reconnectTimer = setTimeout(connectWs, 3000);
      };
    };

    connectWs();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [activeCaptain?.id, activeCaptain?.verification_status]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleToggleAvailability = async () => {
    if (!activeCaptain) return;
    const next = activeCaptain.availability_status === 'available' ? 'offline' : 'available';
    try {
      await api.setCaptainAvailability(activeCaptain.id, next);
      await onRefreshCore();
      onNotify(
        next === 'available'
          ? isAr
            ? 'أنت الآن متاح لاستقبال الطلبات في المنزلة'
            : 'You are now Online'
          : isAr
          ? 'تم تحويل الحالة إلى غير متصل'
          : 'You are now Offline'
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleVehiclePhotoPick = (slot: 1 | 2) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
        const finalUrl = ctx
          ? (() => {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              return canvas.toDataURL('image/jpeg', 0.78);
            })()
          : rawDataUrl;
        if (slot === 1) setRegVehiclePhoto1(finalUrl);
        else setRegVehiclePhoto2(finalUrl);
      };
      img.onerror = () => {
        if (slot === 1) setRegVehiclePhoto1(rawDataUrl);
        else setRegVehiclePhoto2(rawDataUrl);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword) {
      onNotify(isAr ? 'أدخل اسم المستخدم وكلمة المرور' : 'Enter username and password');
      return;
    }
    setLoggingIn(true);
    try {
      const res = await api.loginCaptainMobile(loginUsername.trim(), loginPassword);
      setLoggedInCaptainProfile(res.captain);
      setCaptainSession(res.captain.id);
      await Promise.all([loadCaptainData(res.captain.id), onRefreshCore()]);
      setLoginPassword('');
      setTab('home');
      onNotify(
        isAr
          ? `مرحبًا يا كابتن ${res.captain.full_name} (@${res.captain.username})`
          : `Welcome ${res.captain.full_name}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    api.logoutSession().catch(() => {});
    setLoggedInCaptainProfile(null);
    setLocalOrders([]);
    setParcels([]);
    setTrips([]);
    setNotifications([]);
    setSettlements([]);
    setCaptainSession('');
    setActiveChatOrderId(null);
    setActiveChatTripId(null);
    setShowInbox(false);
    setShowRegister(false);
    setAuthMode('login');
    setTab('home');
    onNotify(isAr ? 'تم تسجيل خروج الطيار' : 'Captain signed out');
  };

  const handleAcceptRide = async (trip: TripRecord) => {
    if (!activeCaptain) return;
    setAcceptingTripId(trip.id);
    try {
      await api.updateCaptainTripStatus(activeCaptain.id, trip.id, 'captain_accepted');
      await Promise.all([loadCaptainData(activeCaptain.id), onRefreshCore()]);
      setActiveChatTripId(trip.id);
      onNotify(
        isAr
          ? `تم قبول المشوار ${trip.trip_number} وفتح صفحة الشات المباشر مع العميل`
          : `Ride ${trip.trip_number} accepted`
      );
    } catch (err) {
      onNotify((err as Error).message);
      await loadCaptainData(activeCaptain.id).catch(() => {});
    } finally {
      setAcceptingTripId(null);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !regUsername.trim() ||
      !regPassword ||
      !regName.trim() ||
      !regPhone.trim() ||
      !regNationalId.trim() ||
      !regVehicleModel.trim() ||
      !regPlate.trim()
    ) {
      onNotify(
        isAr
          ? 'يرجى استكمال اسم المستخدم وكلمة المرور والاسم والهاتف والرقم القومي ونوع/موديل المركبة ورقم اللوحة'
          : 'Complete all required fields'
      );
      return;
    }
    try {
      const res = await api.registerCaptainMobile({
        username: regUsername.trim(),
        password: regPassword,
        full_name: regName,
        phone: regPhone,
        national_id: regNationalId,
        zone_name: regZone,
        vehicle_type: regVehicleType,
        vehicle_model: regVehicleModel.trim(),
        plate_number: regPlate,
        allowed_services: ['stores', 'parcels'],
        doc_images: {
          vehicle_front: regVehiclePhoto1 || undefined,
          vehicle_back: regVehiclePhoto2 || undefined,
        },
      });
      if (res.captain) setLoggedInCaptainProfile(res.captain);
      setCaptainSession(res.id);
      await Promise.all([loadCaptainData(res.id), onRefreshCore()]);
      setShowRegister(false);
      setAuthMode('login');
      setTab('profile');
      setRegUsername('');
      setRegPassword('');
      setRegName('');
      setRegPhone('');
      setRegNationalId('');
      setRegVehicleModel('');
      setRegPlate('');
      setRegVehiclePhoto1('');
      setRegVehiclePhoto2('');
      onNotify(
        isAr
          ? `تم إنشاء حساب الطيار (@${res.username}) وإرسال المستندات للمراجعة — يمكنك اعتماده من لوحة Super Admin ← الكباتن`
          : 'Captain registered and sent for review'
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleVerifyParcelOtp = async (deliveryId: string) => {
    if (!activeCaptain) return;
    try {
      const res = await api.completeParcelWithOtp(activeCaptain.id, deliveryId, otpInputs[deliveryId] || '');
      await Promise.all([loadCaptainData(activeCaptain.id), onRefreshCore()]);
      onNotify(
        isAr
          ? `تم تسليم الطرد وتوثيقه بـ OTP، وترحيل عمولة ${res.commission_posted} ج.م للدفتر المالي`
          : `Parcel delivered, commission ${res.commission_posted} EGP posted`
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleMarkRead = async (id: string) => {
    await api.markNotificationRead(id);
    await loadCaptainData(loggedCaptainId);
  };

  const effectiveOrders = localOrders.length > 0 || loggedInCaptainProfile ? localOrders : orders;

  const handleOrderStep = async (orderId: string, nextStatus: string) => {
    if (!activeCaptain) return;
    const targetOrder = effectiveOrders.find((o) => o.id === orderId);
    if (nextStatus === 'delivered' && !targetOrder?.delivery_proof_image_url) {
      onNotify(
        isAr
          ? 'شرط إلزامي: يجب تصوير الأوردر عند منزل العميل وإرسال الصورة في الشات قبل تأكيد التسليم'
          : 'Capture doorstep photo in chat before marking delivered'
      );
      setActiveChatOrderId(orderId);
      return;
    }
    try {
      await api.updateCaptainOrderStatus(activeCaptain.id, orderId, nextStatus);
      await Promise.all([loadCaptainData(activeCaptain.id), onRefreshCore()]);
      if (nextStatus === 'on_the_way') {
        setActiveChatOrderId(orderId);
        onNotify(
          isAr
            ? 'تم استلام الطلب وفتح صفحة الشات مع العميل — صوّر الأوردر عند منزل العميل لإتمام التسليم'
            : 'Order picked up and chat opened'
        );
      } else {
        onNotify(isAr ? `تم تحديث حالة الطلب إلى ${nextStatus}` : `Order updated to ${nextStatus}`);
      }
    } catch (err) {
      onNotify((err as Error).message);
      if (nextStatus === 'delivered') {
        setActiveChatOrderId(orderId);
      }
    }
  };

  const handleStorePickup = async (orderId: string, storeSectionId: string) => {
    if (!activeCaptain) return;
    try {
      const res = await api.updateCaptainOrderStatus(activeCaptain.id, orderId, 'pickup_store', {
        store_section_id: storeSectionId,
      });
      await Promise.all([loadCaptainData(activeCaptain.id), onRefreshCore()]);
      if (res.all_stores_picked_up) {
        setActiveChatOrderId(res.primary_order_id || orderId);
        onNotify(
          isAr
            ? 'تم استلام الطلب من جميع المتاجر ✓ — تم إشعار العميل أنك في الطريق وفتح الشات لتصوير التسليم'
            : 'All stores picked up — customer notified you are on the way'
        );
      } else {
        onNotify(
          isAr
            ? `تم استلام الطلب من المتجر (${res.picked_up_count || 1} من ${res.total_stores_count || 2}) — استكمل استلام باقي المتاجر`
            : `Store picked up (${res.picked_up_count}/${res.total_stores_count})`
        );
      }
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleRequestSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCaptain) return;
    try {
      await api.requestCaptainSettlement(activeCaptain.id, settleAmount, settleMethod);
      await loadCaptainData(activeCaptain.id);
      onNotify(isAr ? `تم إرسال طلب تسوية بمبلغ ${settleAmount} ج.م للإدارة المالية` : 'Settlement requested');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const captainOrders = effectiveOrders.filter(
    (o) => !activeCaptain || o.captain_id === activeCaptain.id || o.status === 'ready_for_pickup'
  );
  const openOrders = captainOrders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
  const completedOrders = captainOrders.filter((o) => o.status === 'delivered');
  const todayIso = new Date().toISOString().slice(0, 10);
  const completedToday = completedOrders.filter((o) => String(o.created_at || '').slice(0, 10) === todayIso);
  const todayDisplayedCompleted = completedToday.length > 0 ? completedToday : completedOrders;
  const todayCompletedTotal = todayDisplayedCompleted.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const todayDeliveryFees = todayDisplayedCompleted.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);

  const captainParcels = parcels.filter((p) => p.status !== 'delivered');
  const cashPct = activeCaptain ? Math.min(100, Math.round((activeCaptain.cash_on_hand / activeCaptain.cash_limit) * 100)) : 0;
  const captainSettlements = settlements.filter(
    (s) => s.beneficiary_type === 'captain' && (!activeCaptain || s.beneficiary_name === activeCaptain.full_name)
  );

  const filteredTodayOrders =
    orderFilter === 'open'
      ? openOrders
      : orderFilter === 'completed'
      ? todayDisplayedCompleted
      : [...openOrders, ...todayDisplayedCompleted];

  const bottomNavItems: Array<{
    id: CaptainTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home, badge: openOrders.length },
    { id: 'orders', label: isAr ? 'أوردرات اليوم' : 'Today Orders', icon: ClipboardList, badge: todayDisplayedCompleted.length },
    { id: 'pos', label: isAr ? 'الفواتير POS' : 'Receipts', icon: Receipt },
    { id: 'settlement', label: isAr ? 'التسوية' : 'Settlement', icon: Wallet },
    { id: 'profile', label: isAr ? 'الملف الشخصي' : 'Profile', icon: User },
  ];

  const openPosWithOrder = (o: OrderRecord) => {
    const stats = computeOrderStoreStats(o);
    if (stats.isMultiStore) {
      const posItems = stats.activeSections.flatMap((sec) => {
        const validSecItems = Array.isArray(sec.items) ? sec.items.filter((it) => it.status !== 'rejected') : [];
        if (validSecItems.length > 0) {
          return validSecItems.map((it) => ({
            product_code: it.product_id || o.order_number,
            name_ar: `[${sec.merchant_name}] ${it.name_ar}`,
            category_name: sec.merchant_name,
            unit_price: Number(it.unit_price || 0),
            qty: Number(it.quantity || 1),
            line_total: Number(it.total_price || (Number(it.unit_price || 0) * Number(it.quantity || 1))),
          }));
        } else {
          const secSub = Number(sec.subtotal || 0);
          return [
            {
              product_code: o.order_number,
              name_ar: `${sec.merchant_name}: ${sec.free_order_text || `#${o.order_number}`}`,
              category_name: sec.merchant_name,
              unit_price: secSub,
              qty: 1,
              line_total: secSub,
            },
          ];
        }
      });
      setPrefillReceipt({
        ref_type: 'order',
        ref_id: o.id,
        ref_number: o.order_number,
        customer_name: o.customer_name || 'عميل اطلبها',
        customer_phone: o.customer_phone || '',
        items: posItems,
        delivery_fee: Number(o.delivery_fee || 0),
        discount_amount: Number(o.discount_amount || 0),
        payment_method: o.payment_method === 'network' ? 'network' : (o.payment_method === 'wallet' ? 'wallet' : 'cash'),
      });
      setTab('pos');
      return;
    }

    const sub = Number(o.subtotal || 0);
    const total = Number(o.total_amount || 0);
    const purchasesVal = sub > 0 ? sub : Math.max(0, total - Number(o.delivery_fee || 0));
    const validItems = Array.isArray(o.items) ? o.items.filter((it) => it.status !== 'rejected') : [];
    const receiptItems = validItems.length > 0
      ? validItems.map((it) => ({
          product_code: it.product_id || o.order_number,
          name_ar: it.name_ar,
          category_name: o.merchant_name || 'منتج',
          unit_price: Number(it.unit_price || 0),
          qty: Number(it.quantity || 1),
          line_total: Number(it.total_price || (Number(it.unit_price || 0) * Number(it.quantity || 1))),
        }))
      : [
          {
            product_code: o.order_number,
            name_ar: o.free_order_text
              ? `أوردر #${o.order_number}: ${o.free_order_text.slice(0, 80)}`
              : `طلب #${o.order_number} (${o.merchant_name || 'اطلبها'})`,
            category_name: o.merchant_name || 'طلب',
            unit_price: purchasesVal,
            qty: 1,
            line_total: purchasesVal,
          },
        ];

    setPrefillReceipt({
      ref_type: 'order',
      ref_id: o.id,
      ref_number: o.order_number,
      customer_name: o.customer_name || 'عميل اطلبها',
      customer_phone: o.customer_phone || '',
      items: receiptItems,
      delivery_fee: Number(o.delivery_fee || 0),
      discount_amount: Number(o.discount_amount || 0),
      payment_method: o.payment_method === 'network' ? 'network' : (o.payment_method === 'wallet' ? 'wallet' : 'cash'),
    });
    setTab('pos');
  };

  const renderOrderCard = (o: OrderRecord) => {
    const stats = computeOrderStoreStats(o);
    if (stats.isMultiStore) {
      const isDelivered = o.status === 'delivered';
      const isOnTheWay = o.status === 'on_the_way';

      return (
        <div key={o.id} className="my-2 p-3.5 rounded-xl border-2 border-orange-200 bg-orange-50/40 space-y-3">
          {/* Single Multi-Store Order Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-orange-600 text-white text-[11px] font-bold">
                  {isAr ? `طلب مقسم (${stats.activeSections.length} متاجر)` : `Multi-store (${stats.activeSections.length})`}
                </span>
                <span className="font-mono-num font-bold text-slate-900">#{o.order_number}</span>
                {o.payment_method === 'network' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200 inline-flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-blue-700" />
                    <span>{isAr ? 'دفع شبكة / POS' : 'POS'}</span>
                  </span>
                ) : o.payment_method === 'wallet' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200 inline-flex items-center gap-1">
                    <Smartphone className="w-3 h-3 text-purple-700" />
                    <span>{isAr ? 'محفظة' : 'Wallet'}</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200 inline-flex items-center gap-1">
                    <Banknote className="w-3 h-3 text-emerald-700" />
                    <span>{isAr ? 'كاش عند الاستلام' : 'Cash'}</span>
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    stats.allStoresPickedUp ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {isAr
                    ? `تم الاستلام من ${stats.pickedUpCount} من ${stats.activeSections.length} متاجر`
                    : `Picked ${stats.pickedUpCount}/${stats.activeSections.length}`}
                </span>
              </div>
              <p className="text-xs text-slate-600">
                {o.customer_name} ({o.customer_phone}) — {o.address_landmark}
              </p>
            </div>
            <div className="flex items-center gap-2 tabular-nums">
              <span className="font-bold text-slate-900 text-sm">{o.total_amount} ج.م</span>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  isDelivered
                    ? 'bg-teal-600 text-white'
                    : isOnTheWay
                    ? 'bg-teal-100 text-teal-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isDelivered
                  ? isAr
                    ? 'تم التسليم'
                    : 'Delivered'
                  : isOnTheWay
                  ? isAr
                    ? 'في الطريق للعميل'
                    : 'On The Way'
                  : isAr
                  ? 'جاري الاستلام من المتاجر'
                  : 'Collecting'}
              </span>
            </div>
          </div>

          {/* Store-by-store sections inside this single order */}
          <div className="space-y-2 ps-2.5 border-s-2 border-orange-300">
            {stats.activeSections.map((sec) => {
              const picked = isSectionPickedUpByCaptain(sec, o.status);
              const isAnchor = stats.anchorSection?.id === sec.id;
              const itemsSummary =
                Array.isArray(sec.items) && sec.items.length > 0
                  ? sec.items
                      .filter((it) => it.status !== 'rejected')
                      .map((it) => `${it.name_ar} × ${it.quantity}`)
                      .join(' + ')
                  : sec.free_order_text || '-';

              return (
                <div
                  key={sec.id}
                  className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                      <span className="font-bold text-slate-900">{sec.merchant_name}</span>
                      {isAnchor && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                          {isAr ? `الأكثر طلبًا (${getSectionItemCount(sec)})` : 'Main'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600">{itemsSummary}</p>
                    <p className="text-[11px] font-mono-num font-semibold text-slate-700">{sec.subtotal} ج.م</p>
                  </div>

                  <div className="shrink-0">
                    {picked ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                        <span>{isAr ? 'تم استلام الطلب ✓' : 'Picked Up ✓'}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStorePickup(o.id, sec.id)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                      >
                        {isAr ? 'تم استلام الطلب' : 'Mark Picked Up'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Proof status & Single Order Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-orange-200/70">
            <div>
              {o.delivery_proof_image_url ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تم تصوير الأوردر عند منزل العميل ✓' : 'Doorstep proof uploaded'}</span>
                </span>
              ) : isOnTheWay ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isAr ? 'صوّر الطلب عند منزل العميل داخل الشات' : 'Capture doorstep photo in chat'}</span>
                </span>
              ) : !isDelivered ? (
                <span className="text-[11px] font-semibold text-slate-600">
                  {isAr
                    ? 'اضغط «تم استلام الطلب» بجانب كل متجر عند استلام طلباته'
                    : 'Confirm pickup next to each store above'}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveChatOrderId(o.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded text-xs font-semibold whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>
                  {isAr ? 'الشات والتصوير' : 'Chat & Photo'} ({o.chat_count ?? 0})
                </span>
              </button>
              <button
                type="button"
                onClick={() => openPosWithOrder(o)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-[#A92224] rounded text-xs font-semibold whitespace-nowrap"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>{isAr ? 'فاتورة العميل' : 'Invoice'}</span>
              </button>
              {!isDelivered && (
                <button
                  type="button"
                  onClick={() => {
                    if (!stats.allStoresPickedUp) {
                      onNotify(
                        isAr
                          ? 'يرجى تأكيد «تم استلام الطلب» من جميع المتاجر أعلاه أولًا'
                          : 'Confirm pickup from all stores first'
                      );
                      return;
                    }
                    handleOrderStep(o.id, 'delivered');
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold whitespace-nowrap ${
                    stats.allStoresPickedUp
                      ? 'bg-teal-600 hover:bg-teal-700 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isAr ? 'تم التسليم للعميل' : 'Mark Delivered'}
                </button>
              )}
            </div>
          </div>

          {!isDelivered && activeCaptain && (
            <div className="pt-2">
              <GpsMapPicker
                heightClass="h-52"
                pickup={
                  !stats.allStoresPickedUp && (o as any).merchant_lat && (o as any).merchant_lng
                    ? {
                        lat: Number((o as any).merchant_lat),
                        lng: Number((o as any).merchant_lng),
                        label: `المتجر: ${o.merchant_name}`,
                      }
                    : null
                }
                dropoff={{
                  lat: Number(o.customer_lat || 31.1598),
                  lng: Number(o.customer_lng || 31.9385),
                  label: `موقع العميل: ${o.customer_name} (${o.address_landmark})`,
                }}
                captainPin={{
                  id: activeCaptain.id,
                  full_name: activeCaptain.full_name,
                  vehicle_type: activeCaptain.vehicle_type,
                  lat: gpsLat,
                  lng: gpsLng,
                }}
                showNavigationHud={true}
              />
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={o.id} className="py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-[200px]">
            {o.delivery_proof_image_url && (
              <img
                src={o.delivery_proof_image_url}
                alt={o.order_number}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-lg object-cover border-2 border-teal-500 shrink-0"
                title={isAr ? 'صورة الأوردر عند منزل العميل' : 'Delivery Proof'}
              />
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-900">
                <span className="font-mono-num">{o.order_number}</span> · {o.merchant_name}
                {o.payment_method === 'network' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200 inline-flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-blue-700" />
                    <span>{isAr ? 'دفع شبكة / POS' : 'POS'}</span>
                  </span>
                ) : o.payment_method === 'wallet' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200 inline-flex items-center gap-1">
                    <Smartphone className="w-3 h-3 text-purple-700" />
                    <span>{isAr ? 'محفظة' : 'Wallet'}</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200 inline-flex items-center gap-1">
                    <Banknote className="w-3 h-3 text-emerald-700" />
                    <span>{isAr ? 'كاش عند الاستلام' : 'Cash'}</span>
                  </span>
                )}
              </div>
              <p className="text-slate-500">
                {o.customer_name} — {o.address_landmark}
              </p>
              {o.delivery_proof_image_url ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تم تصوير الأوردر عند منزل العميل ✓' : 'Doorstep proof uploaded'}</span>
                </span>
              ) : o.status === 'on_the_way' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isAr ? 'مطلوب تصوير الأوردر عند منزل العميل داخل الشات' : 'Doorstep photo required in chat'}</span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <span className="font-bold text-slate-900">{o.total_amount} ج.م</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                o.status === 'delivered' ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {o.status === 'delivered' ? (isAr ? 'تم التسليم' : 'delivered') : o.status}
            </span>
            <button
              type="button"
              onClick={() => setActiveChatOrderId(o.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded text-xs font-semibold whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>
                {isAr ? 'الشات والتصوير' : 'Chat & Photo'} ({o.chat_count ?? 0})
              </span>
            </button>
            <button
              type="button"
              onClick={() => openPosWithOrder(o)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-[#A92224] rounded text-xs font-semibold whitespace-nowrap"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>{isAr ? 'فاتورة العميل' : 'Invoice'}</span>
            </button>
            {o.status !== 'delivered' && (
              <>
                {o.status !== 'on_the_way' && (
                  <button
                    type="button"
                    onClick={() => handleOrderStep(o.id, 'on_the_way')}
                    className="px-2.5 py-1.5 bg-slate-900 text-white rounded text-xs font-semibold whitespace-nowrap"
                  >
                    {isAr ? 'تم الاستلام' : 'Picked Up'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleOrderStep(o.id, 'delivered')}
                  className="px-2.5 py-1.5 bg-teal-600 text-white rounded text-xs font-semibold whitespace-nowrap"
                >
                  {isAr ? 'تم التسليم' : 'Delivered'}
                </button>
              </>
            )}
          </div>
        </div>

        {o.status !== 'delivered' && activeCaptain && (
          <GpsMapPicker
            heightClass="h-52"
            pickup={
              o.status !== 'on_the_way' && (o as any).merchant_lat && (o as any).merchant_lng
                ? {
                    lat: Number((o as any).merchant_lat),
                    lng: Number((o as any).merchant_lng),
                    label: `المتجر: ${o.merchant_name}`,
                  }
                : null
            }
            dropoff={{
              lat: Number(o.customer_lat || 31.1598),
              lng: Number(o.customer_lng || 31.9385),
              label: `موقع العميل: ${o.customer_name} (${o.address_landmark})`,
            }}
            captainPin={{
              id: activeCaptain.id,
              full_name: activeCaptain.full_name,
              vehicle_type: activeCaptain.vehicle_type,
              lat: gpsLat,
              lng: gpsLng,
            }}
            showNavigationHud={true}
          />
        )}
      </div>
    );
  };

  if (activeChatOrderId) {
    return (
      <OrderChatPage
        orderId={activeChatOrderId}
        senderRole="captain"
        senderName={activeCaptain?.full_name || (isAr ? 'الكابتن' : 'Captain')}
        captainId={activeCaptain?.id}
        lang={lang}
        onBack={() => setActiveChatOrderId(null)}
        onOrderUpdated={async () => {
          await Promise.all([loadCaptainData(activeCaptain?.id), onRefreshCore()]);
        }}
        onOpenPosForOrder={(pre) => {
          setActiveChatOrderId(null);
          setPrefillReceipt(pre);
          setTab('pos');
        }}
        onNotify={onNotify}
      />
    );
  }

  if (activeChatTripId) {
    return (
      <TripChatPage
        tripId={activeChatTripId}
        senderRole="captain"
        senderName={activeCaptain?.full_name || (isAr ? 'الكابتن' : 'Captain')}
        captainId={activeCaptain?.id}
        lang={lang}
        onBack={() => setActiveChatTripId(null)}
        onTripUpdated={async () => {
          await Promise.all([loadCaptainData(activeCaptain?.id), onRefreshCore()]);
        }}
        onTripFinishedReceipt={(snap) => setLastFinishedTripReceipt(snap)}
        onOpenPosForTrip={(snap) => {
          setLastFinishedTripReceipt(snap);
          setActiveChatTripId(null);
          setPrefillReceipt(snap);
          setTab('pos');
        }}
        onNotify={onNotify}
      />
    );
  }

  const renderRegistrationForm = (onCancel: () => void) => (
    <form onSubmit={handleRegister} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">
          {isAr ? 'تسجيل طيار جديد (حساب دخول + الـ 9 مستندات)' : 'Register New Captain'}
        </h3>
      </div>

      <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-orange-900">
          <KeyRound className="w-4 h-4 text-orange-600" />
          <span>{isAr ? 'بيانات دخول التطبيق الخاصة بالطيار' : 'Captain App Login Credentials'}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            dir="ltr"
            required
            placeholder="اسم المستخدم بالإنجليزية (مثال: ali_moto)"
            value={regUsername}
            onChange={(e) => setRegUsername(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
          />
          <div className="relative">
            <input
              type={showRegPw ? 'text' : 'password'}
              dir="ltr"
              required
              placeholder="كلمة المرور (4 أحرف على الأقل)"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              className="w-full px-3 py-2 pe-9 bg-white border border-slate-200 rounded-lg text-xs font-mono-num"
            />
            <button
              type="button"
              onClick={() => setShowRegPw(!showRegPw)}
              className="absolute inset-y-0 end-0 px-2.5 text-slate-500 hover:text-slate-800"
            >
              {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          type="text"
          required
          placeholder="الاسم الرباعي"
          value={regName}
          onChange={(e) => setRegName(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
        />
        <input
          type="text"
          required
          placeholder="رقم الهاتف"
          value={regPhone}
          onChange={(e) => setRegPhone(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
        />
        <input
          type="text"
          required
          placeholder="الرقم القومي (14 رقم)"
          value={regNationalId}
          onChange={(e) => setRegNationalId(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
        />
        <select
          value={regZone}
          onChange={(e) => setRegZone(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
        >
          {zones.map((z) => (
            <option key={z.id} value={z.name_ar}>
              {z.name_ar}
            </option>
          ))}
        </select>
        <select
          value={regVehicleType}
          onChange={(e) => setRegVehicleType(e.target.value as typeof regVehicleType)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
        >
          <option value="moto">موتوسيكل</option>
          <option value="tuktuk">توك توك</option>
          <option value="car">سيارة</option>
          <option value="bicycle">دراجة</option>
        </select>
        <input
          type="text"
          required
          placeholder={
            regVehicleType === 'moto'
              ? 'اكتب نوع وموديل الموتوسيكل (مثال: هوجن 5)'
              : regVehicleType === 'tuktuk'
              ? 'اكتب نوع التوك توك (مثال: بجاج الهندي 2024)'
              : regVehicleType === 'car'
              ? 'اكتب نوع وموديل السيارة (مثال: هيونداي فيرنا)'
              : 'اكتب نوع الدراجة'
          }
          value={regVehicleModel}
          onChange={(e) => setRegVehicleModel(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
        />
        <input
          type="text"
          required
          placeholder="رقم اللوحة (مثال: د ق هـ 4512)"
          value={regPlate}
          onChange={(e) => setRegPlate(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs"
        />
      </div>

      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-900">التقاط صورتين للمركبة (أمامية وخلفية/جانبية)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { slot: 1 as const, label: 'التقاط صورة المركبة (1) — الأمام', url: regVehiclePhoto1, clear: () => setRegVehiclePhoto1('') },
            { slot: 2 as const, label: 'التقاط صورة المركبة (2) — الخلف/الجانب', url: regVehiclePhoto2, clear: () => setRegVehiclePhoto2('') },
          ].map((item) => (
            <div key={item.slot} className="border border-dashed border-slate-300 rounded-xl p-3 bg-slate-50 space-y-2">
              <label className="flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer min-h-[44px]">
                <Camera className="w-4 h-4 shrink-0 text-orange-400" />
                <span>{item.label}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleVehiclePhotoPick(item.slot)}
                  className="hidden"
                />
              </label>
              {item.url ? (
                <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-2">
                  <img
                    src={item.url}
                    alt={item.label}
                    referrerPolicy="no-referrer"
                    className="w-16 h-12 rounded object-cover border border-slate-200"
                  />
                  <span className="text-[11px] font-semibold text-teal-700 flex-1">تم التقاط الصورة ✓</span>
                  <button
                    type="button"
                    onClick={item.clear}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                    title="حذف الصورة"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 text-center">لم يتم التقاط الصورة بعد</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={regDocsReady} onChange={(e) => setRegDocsReady(e.target.checked)} />
        <span>إرفاق حزمة الـ 9 مستندات المطلوبة (صور المركبة + اللوحة + رخصة المركبة + رخصة القيادة + القومي + السيلفي)</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2.5 bg-orange-600 text-white rounded-lg text-xs font-semibold min-h-[44px]">
          إرسال الطلب والمستندات للمراجعة
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 border border-slate-200 rounded-lg text-xs">
          إلغاء
        </button>
      </div>
    </form>
  );

  if (!activeCaptain) {
    return (
      <div className="max-w-xl mx-auto py-6 space-y-5">
        <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] border-b-2 border-[#F5A623]/80 text-white rounded-2xl p-4 sm:p-5 flex items-center gap-4 shadow-sm">
          <img
            src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
            alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
            className="w-14 h-14 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/70"
          />
          <div>
            <p className="text-xs text-amber-200 font-semibold">
              {isAr ? 'تطبيق اطلبها كابتن · المنزلة' : 'Otlobha Captain App'}
            </p>
            <h2 className="text-xl font-bold mt-0.5">
              {authMode === 'login'
                ? isAr
                  ? 'تسجيل دخول الطيار'
                  : 'Captain Sign In'
                : isAr
                ? 'تسجيل طيار جديد'
                : 'Register Captain'}
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            className={`py-2.5 rounded-lg text-xs font-bold transition-colors ${
              authMode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {isAr ? 'دخول بحساب حالي' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('register')}
            className={`py-2.5 rounded-lg text-xs font-bold transition-colors ${
              authMode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {isAr ? 'تسجيل طيار جديد' : 'New Captain'}
          </button>
        </div>

        {authMode === 'login' ? (
          <form onSubmit={handleLogin} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'اسم المستخدم (Username)' : 'Username'}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="captain1"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {isAr ? 'كلمة المرور (Password)' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    type={showLoginPw ? 'text' : 'password'}
                    dir="ltr"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3.5 py-2.5 pe-10 border border-slate-200 rounded-xl text-sm font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPw(!showLoginPw)}
                    className="absolute inset-y-0 end-0 px-3 text-slate-500 hover:text-slate-800"
                  >
                    {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full flex items-center justify-center gap-2 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold min-h-[46px]"
            >
              <LogIn className="w-4 h-4" />
              <span>{loggingIn ? 'جاري التحقق...' : isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
            </button>
          </form>
        ) : (
          renderRegistrationForm(() => setAuthMode('login'))
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)]">
      <div className="flex-1 space-y-5 pb-6">
        {/* Top Captain Brand Strip (Logo-Inspired Crimson & Amber) */}
        <header className="sticky top-0 z-30 bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] text-white rounded-xl border-b-2 border-[#F5A623]/80 shadow-sm px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/80 shadow-sm"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-amber-200 font-semibold truncate">
                {isAr ? 'اطلبها كابتن' : 'Otlobha Captain'} · {activeCaptain.full_name}
              </p>
              <h2 className="text-sm sm:text-base font-bold truncate leading-tight">
                {tab === 'home' && (isAr ? 'الرئيسية — الطلبات المفتوحة والعمل' : 'Home & Active Orders')}
                {tab === 'orders' && (isAr ? 'أوردرات اليوم (المفتوحة والتي تمت)' : 'Today Orders')}
                {tab === 'pos' && (isAr ? 'فواتير العملاء والطباعة بالبلوتوث' : 'Customer Invoices & Printer')}
                {tab === 'settlement' && (isAr ? 'التسوية وحساب الكاش والأرباح' : 'Settlement & Earnings')}
                {tab === 'profile' && (isAr ? 'الملف الشخصي والمركبة والمستندات' : 'Profile & KYC')}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowInbox(!showInbox);
                setShowSettings(false);
              }}
              aria-label={isAr ? 'الإشعارات' : 'Notifications'}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold min-h-[42px] whitespace-nowrap transition-colors border ${
                showInbox
                  ? 'bg-white text-[#A92224] border-white'
                  : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
              }`}
            >
              <Bell className={`w-4 h-4 ${showInbox ? 'text-[#A92224]' : 'text-amber-200'}`} />
              <span className="hidden sm:inline">{isAr ? 'الإشعارات' : 'Alerts'}</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-[#F5A623] text-slate-950 rounded-full text-[10px] font-extrabold tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowSettings(!showSettings);
                setShowInbox(false);
              }}
              aria-label={isAr ? 'الإعدادات' : 'Settings'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold min-h-[42px] whitespace-nowrap transition-colors border ${
                showSettings
                  ? 'bg-white text-[#A92224] border-white'
                  : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
              }`}
            >
              <Settings className={`w-4 h-4 ${showSettings ? 'text-[#A92224]' : 'text-amber-200'}`} />
              <span className="hidden sm:inline">{isAr ? 'الإعدادات' : 'Settings'}</span>
            </button>
          </div>
        </header>

        {/* Captain Settings Drawer */}
        {showSettings && (
          <div className="bg-white border border-red-200/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#A92224]" />
                <h3 className="text-sm font-bold text-slate-900">
                  {isAr ? 'إعدادات تطبيق الطيار' : 'Captain App Settings'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <button
                type="button"
                onClick={handleToggleAvailability}
                className={`px-3.5 py-2.5 rounded-xl font-bold min-h-[42px] transition-colors ${
                  activeCaptain.availability_status === 'available'
                    ? 'bg-teal-600 hover:bg-teal-700 text-white'
                    : 'bg-[#A92224] hover:bg-[#931B1D] text-white'
                }`}
              >
                {activeCaptain.availability_status === 'available'
                  ? isAr
                    ? 'حالة العمل: متاح حاليًا (اضغط للإيقاف)'
                    : 'Online (Tap to go Offline)'
                  : isAr
                  ? 'حالة العمل: غير متصل (اضغط للتشغيل)'
                  : 'Offline (Tap to go Online)'}
              </button>

              <button
                type="button"
                onClick={() => setAutoGps(!autoGps)}
                className={`px-3.5 py-2.5 rounded-xl border font-bold min-h-[42px] transition-colors ${
                  autoGps
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                {autoGps
                  ? isAr
                    ? 'التتبع التلقائي للـ GPS: مفعّل ✓'
                    : 'Auto GPS: Enabled ✓'
                  : isAr
                  ? 'التتبع التلقائي للـ GPS: متوقف'
                  : 'Auto GPS: Paused'}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncMyGpsNow}
                  disabled={locatingGps}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold min-h-[40px]"
                >
                  <Navigation className="w-3.5 h-3.5 text-[#A92224]" />
                  <span>{locatingGps ? '...' : isAr ? 'تحديث موقعي GPS الآن' : 'Sync GPS'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    setTab('profile');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-[#A92224] rounded-xl text-xs font-bold min-h-[40px]"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{isAr ? 'الملف والمركبة والمستندات' : 'Profile & KYC'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => loadCaptainData(activeCaptain.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold min-h-[40px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تحديث' : 'Refresh'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold min-h-[40px]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Notifications Drawer */}
        {showInbox && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {isAr ? 'صندوق إشعارات تطبيق الطيارين' : 'Captain Push Notifications'}
              </h3>
              <button type="button" onClick={() => setShowInbox(false)} className="text-xs text-slate-500">
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">{isAr ? 'لا توجد إشعارات حاليًا' : 'No notifications'}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <div key={n.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{n.title_ar}</span>
                        {!n.is_read && <span className="text-xs font-semibold text-orange-600">{isAr ? 'جديد' : 'New'}</span>}
                      </div>
                      <p className="text-xs text-slate-600">{n.body_ar}</p>
                      <p className="text-xs font-mono-num text-slate-400">{n.created_at}</p>
                    </div>
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(n.id)}
                        className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium whitespace-nowrap"
                      >
                        {isAr ? 'تحديد كمقروء' : 'Mark Read'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 1: HOME (الرئيسية — حالة العمل + الأوردرات المفتوحة + الطرود) */}
        {tab === 'home' && activeCaptain && (
          <div className="space-y-5">
            {/* Availability & Quick Today Strip */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{activeCaptain.full_name}</h3>
                    <p className="text-xs text-slate-500">
                      {activeCaptain.vehicle_model} · {activeCaptain.plate_number}
                    </p>
                  </div>
                  <Truck className="w-5 h-5 text-orange-600" />
                </div>

                {activeCaptain.verification_status !== 'approved' && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">حالة الحساب: {activeCaptain.verification_status}</p>
                      <p>لا يمكنك تفعيل «متاح للعمل» قبل اعتماد المستندات من لوحة Super Admin.</p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleToggleAvailability}
                  className={`w-full py-3 rounded-xl text-sm font-bold min-h-[44px] transition-colors ${
                    activeCaptain.availability_status === 'available'
                      ? 'bg-teal-600 hover:bg-teal-700 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {activeCaptain.availability_status === 'available'
                    ? isAr
                      ? 'متاح لاستقبال الطلبات (اضغط للإيقاف)'
                      : 'Online (Tap to go Offline)'
                    : isAr
                    ? 'غير متصل (اضغط للبدء)'
                    : 'Offline (Tap to go Online)'}
                </button>
              </div>

              <div className="lg:col-span-7 grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOrderFilter('open');
                    setTab('orders');
                  }}
                  className="bg-white border border-slate-200 hover:border-orange-400 rounded-2xl p-4 text-start flex flex-col justify-between"
                >
                  <span className="text-xs text-slate-500">{isAr ? 'أوردرات مفتوحة الآن' : 'Open Orders'}</span>
                  <span className="text-2xl font-bold text-orange-600 tabular-nums mt-2">{openOrders.length}</span>
                  <span className="text-[11px] text-slate-500 mt-1">{isAr ? 'بانتظار الاستلام/التسليم' : 'Active'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOrderFilter('completed');
                    setTab('orders');
                  }}
                  className="bg-white border border-slate-200 hover:border-teal-400 rounded-2xl p-4 text-start flex flex-col justify-between"
                >
                  <span className="text-xs text-slate-500">{isAr ? 'تمت اليوم' : 'Completed Today'}</span>
                  <span className="text-2xl font-bold text-teal-700 tabular-nums mt-2">{todayDisplayedCompleted.length}</span>
                  <span className="text-[11px] text-slate-500 mt-1 tabular-nums">{todayCompletedTotal} ج.م</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('settlement')}
                  className="bg-white border border-slate-200 hover:border-slate-400 rounded-2xl p-4 text-start flex flex-col justify-between"
                >
                  <span className="text-xs text-slate-500">{isAr ? 'الكاش بيدك' : 'Cash On Hand'}</span>
                  <span className="text-2xl font-bold text-slate-900 tabular-nums mt-2">{activeCaptain.cash_on_hand}</span>
                  <span className="text-[11px] text-slate-500 mt-1 tabular-nums">من {activeCaptain.cash_limit} ج.م</span>
                </button>
              </div>
            </div>

            {/* Live Captain GPS Location Card (All Captains) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                    <Navigation className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {isAr ? 'تتبع موقعك المباشر (GPS) في برنامج الطيارين' : 'Captain Live GPS Tracking'}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                      {gpsLat.toFixed(5)}, {gpsLng.toFixed(5)}
                      {gpsUpdatedAt ? ` · ${gpsUpdatedAt}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={autoGps} onChange={(e) => setAutoGps(e.target.checked)} />
                    <span>{isAr ? 'بث تلقائي' : 'Auto GPS'}</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleSyncMyGpsNow}
                    disabled={locatingGps}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{locatingGps ? 'جاري التحديد...' : isAr ? 'تحديث موقعي GPS الآن' : 'Update My GPS'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGpsMap((v) => !v)}
                    className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700"
                  >
                    {showGpsMap ? (isAr ? 'إخفاء الخريطة' : 'Hide Map') : isAr ? 'ضبط على الخريطة' : 'Pick on Map'}
                  </button>
                </div>
              </div>

              {showGpsMap && (
                <div className="space-y-2">
                  <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                    {isAr
                      ? 'خريطة مسار التوصيل المباشر (Google Maps Route) — اضغط في أي مكان على الخريطة لتحديث إحداثيات الـ GPS الخاصة بك فورًا.'
                      : 'Live Google Maps delivery route — click anywhere on the map to update your GPS coordinates.'}
                  </p>
                  {(() => {
                    const activeRouteOrder =
                      openOrders.find((o) => o.status === 'on_the_way' && o.captain_id === activeCaptain.id) ||
                      openOrders[0] ||
                      null;
                    return (
                      <GpsMapPicker
                        heightClass="h-60"
                        pickup={
                          activeRouteOrder &&
                          activeRouteOrder.status !== 'on_the_way' &&
                          (activeRouteOrder as any).merchant_lat &&
                          (activeRouteOrder as any).merchant_lng
                            ? {
                                lat: Number((activeRouteOrder as any).merchant_lat),
                                lng: Number((activeRouteOrder as any).merchant_lng),
                                label: `المتجر: ${activeRouteOrder.merchant_name}`,
                              }
                            : null
                        }
                        dropoff={
                          activeRouteOrder
                            ? {
                                lat: Number(activeRouteOrder.customer_lat || 31.1598),
                                lng: Number(activeRouteOrder.customer_lng || 31.9385),
                                label: `موقع العميل: ${activeRouteOrder.customer_name} (${activeRouteOrder.address_landmark})`,
                              }
                            : null
                        }
                        captainPin={{
                          id: activeCaptain.id,
                          full_name: activeCaptain.full_name,
                          vehicle_type: activeCaptain.vehicle_type,
                          lat: gpsLat,
                          lng: gpsLng,
                        }}
                        showNavigationHud={true}
                        pickTarget="captain"
                        onMapPick={(lat, lng) => sendCaptainGps(activeCaptain.id, lat, lng, false)}
                      />
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Integrated Ride-Hailing Control Panel (اطلبها كابتن - نظام المشاوير) */}
            <CaptainRidesPanel
              captain={activeCaptain}
              lang={lang}
              onOpenTripChat={(tripId) => setActiveChatTripId(tripId)}
              onRefreshCore={onRefreshCore}
              notify={onNotify}
            />

            {/* Open Orders on Home */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'الأوردرات المفتوحة والمتاحة للعمل الآن' : 'Open & Active Orders'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setOrderFilter('all_today');
                    setTab('orders');
                  }}
                  className="text-xs font-bold text-orange-600 hover:underline"
                >
                  {isAr ? 'عرض سجل أوردرات اليوم ←' : 'All Today Orders'}
                </button>
              </div>

              {openOrders.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">
                  {isAr ? 'لا توجد أوردرات مفتوحة حاليًا — يمكنك مراجعة أوردرات اليوم المكتملة من تبويب أوردرات اليوم.' : 'No open orders right now.'}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">{openOrders.map(renderOrderCard)}</div>
              )}
            </div>

            {/* Active Parcels (OTP) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-orange-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'مهام توصيل الطرود وتأكيد التسليم بـ OTP' : 'Parcel Missions (OTP)'}
                </h3>
              </div>
              {captainParcels.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {isAr ? 'لا توجد طرود نشطة الآن' : 'No active parcels'}
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {captainParcels.map((p) => (
                    <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5 text-xs">
                        <p className="font-bold text-slate-900 font-mono-num">
                          {p.delivery_number} · {p.item_category}
                        </p>
                        <p className="text-slate-600">
                          من: {p.pickup_address} ← إلى: {p.dropoff_address}
                        </p>
                        <p className="text-slate-500 tabular-nums">أجرة التوصيل: {p.delivery_fee} ج.م</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="أدخل OTP المستلم"
                          value={otpInputs[p.id] ?? ''}
                          onChange={(e) => setOtpInputs({ ...otpInputs, [p.id]: e.target.value })}
                          className="w-32 px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono-num min-h-[40px]"
                        />
                        <button
                          type="button"
                          onClick={() => handleVerifyParcelOtp(p.id)}
                          className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold min-h-[40px] whitespace-nowrap"
                        >
                          تأكيد التسليم
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: TODAY ORDERS (الأوردرات التي تمت خلال اليوم — المفتوح منها والذي تم) */}
        {tab === 'orders' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-500">{isAr ? 'الأوردرات المفتوحة الآن' : 'Open Now'}</p>
                <p className="text-2xl font-bold text-orange-600 tabular-nums mt-1">{openOrders.length}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-500">{isAr ? 'الأوردرات التي تمت اليوم' : 'Completed Today'}</p>
                <p className="text-2xl font-bold text-teal-700 tabular-nums mt-1">{todayDisplayedCompleted.length}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs text-slate-500">{isAr ? 'إجمالي تحصيل وتوصيل اليوم' : 'Today Total'}</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{todayCompletedTotal} ج.م</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'سجل أوردرات اليوم (المفتوح منها والتي تمت)' : 'Daily Orders Log'}
                </h3>
                <div className="flex gap-1.5">
                  {[
                    { id: 'all_today' as const, label: isAr ? `الكل (${openOrders.length + todayDisplayedCompleted.length})` : 'All' },
                    { id: 'open' as const, label: isAr ? `المفتوحة (${openOrders.length})` : 'Open' },
                    { id: 'completed' as const, label: isAr ? `التي تمت (${todayDisplayedCompleted.length})` : 'Completed' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setOrderFilter(f.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                        orderFilter === f.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTodayOrders.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">{isAr ? 'لا توجد أوردرات في هذا التصنيف اليوم.' : 'No orders found.'}</p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">{filteredTodayOrders.map(renderOrderCard)}</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2B: CAPTAIN DELIVERY & RIDE INVOICE PRINTING + BLUETOOTH */}
        {tab === 'pos' && activeCaptain && (
          <CaptainPosSection
            lang={lang}
            captain={activeCaptain}
            orders={captainOrders}
            trips={trips}
            parcels={parcels}
            recentFinishedTrip={lastFinishedTripReceipt}
            prefillReceipt={prefillReceipt}
            onClearPrefill={() => setPrefillReceipt(null)}
            onNotify={onNotify}
          />
        )}

        {/* TAB 3: SETTLEMENT (التسوية وحساب الكاش والأرباح) */}
        {tab === 'settlement' && activeCaptain && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">{isAr ? 'حساب الكاش والتسوية' : 'Cash & Settlement'}</h3>
                  <Wallet className="w-5 h-5 text-orange-600" />
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">الكاش بيدك مقابل الحد الأقصى</span>
                    <span className="font-bold tabular-nums text-sm">
                      {activeCaptain.cash_on_hand} / {activeCaptain.cash_limit} ج.م
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${cashPct >= 85 ? 'bg-rose-600' : 'bg-teal-600'}`} style={{ width: `${cashPct}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-100 text-xs">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-slate-500">{isAr ? 'تحصيل أوردرات اليوم' : 'Today Collected'}</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums mt-0.5">{todayCompletedTotal} ج.م</p>
                  </div>
                  <div className="bg-teal-50 rounded-xl p-3">
                    <p className="text-teal-800">{isAr ? 'أجرة التوصيل' : 'Delivery Fees'}</p>
                    <p className="text-base font-bold text-teal-800 tabular-nums mt-0.5">{todayDeliveryFees} ج.م</p>
                  </div>
                  <div className="bg-rose-50 rounded-xl p-3">
                    <p className="text-rose-800">{isAr ? 'غرامات الإلغاء 10%' : 'Penalties'}</p>
                    <p className="text-base font-bold text-rose-800 tabular-nums mt-0.5">
                      {activeCaptain.total_penalties ?? 0} ج.م
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleRequestSettlement} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <h4 className="text-sm font-bold text-slate-900">{isAr ? 'إرسال طلب تسوية وسحب أرباح' : 'Request Settlement'}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={50}
                    value={settleAmount}
                    onChange={(e) => setSettleAmount(Number(e.target.value))}
                    className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs tabular-nums"
                  />
                  <select
                    value={settleMethod}
                    onChange={(e) => setSettleMethod(e.target.value as 'vodafone_cash' | 'instapay')}
                    className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs bg-white"
                  >
                    <option value="vodafone_cash">فودافون كاش</option>
                    <option value="instapay">إنستاباي</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold min-h-[42px]"
                >
                  {isAr ? 'إرسال طلب التسوية للمالية' : 'Submit Settlement Request'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h3 className="text-base font-bold text-slate-900">{isAr ? 'سجل طلبات التسوية السابقة' : 'Settlement History'}</h3>
              {captainSettlements.length === 0 ? (
                <p className="text-xs text-slate-500 py-4">
                  {isAr ? 'لم يتم تقديم طلبات تسوية بعد — أرسل طلب تسوية من النموذج الجانبي.' : 'No settlements yet.'}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {captainSettlements.map((s) => (
                    <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">{s.beneficiary_name}</p>
                        <p className="text-slate-500">
                          {s.payout_method === 'vodafone_cash' ? 'فودافون كاش' : 'إنستاباي'} ·{' '}
                          <span className="font-mono-num">{String(s.created_at || '').slice(0, 16)}</span>
                        </p>
                      </div>
                      <div className="text-end tabular-nums">
                        <p className="font-bold text-slate-900">{s.net_payout} ج.م</p>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            s.status === 'paid'
                              ? 'bg-teal-50 text-teal-700'
                              : s.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PROFILE (الملف الشخصي + المركبة + التسجيل وصور المركبة) */}
        {tab === 'profile' && (
          <div className="space-y-5">
            {activeCaptain && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{activeCaptain.full_name}</h3>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {activeCaptain.username && (
                          <span dir="ltr" className="font-mono-num font-bold text-orange-700 me-1.5">
                            @{activeCaptain.username}
                          </span>
                        )}
                        · {activeCaptain.phone} · {activeCaptain.zone_name}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-3.5 text-xs space-y-1.5">
                    <p>
                      <span className="text-slate-500">اسم المستخدم:</span>{' '}
                      <strong dir="ltr" className="font-mono-num text-slate-900">
                        @{activeCaptain.username}
                      </strong>
                    </p>
                    <p>
                      <span className="text-slate-500">نوع وموديل المركبة:</span>{' '}
                      <strong className="text-slate-900">{activeCaptain.vehicle_model}</strong>
                    </p>
                    <p>
                      <span className="text-slate-500">رقم اللوحة:</span>{' '}
                      <strong className="text-slate-900">{activeCaptain.plate_number}</strong>
                    </p>
                    <p>
                      <span className="text-slate-500">حالة الاعتماد:</span>{' '}
                      <strong className="text-teal-700">{activeCaptain.verification_status}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 text-center border-t border-slate-100 text-xs">
                    <div>
                      <p className="text-slate-500">التقييم</p>
                      <p className="font-bold tabular-nums">{activeCaptain.rating_avg}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">القبول</p>
                      <p className="font-bold tabular-nums">{activeCaptain.acceptance_rate}%</p>
                    </div>
                    <div>
                      <p className="text-slate-500">المكتملة</p>
                      <p className="font-bold tabular-nums">{activeCaptain.completed_count}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowRegister(!showRegister)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold min-h-[42px]"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{showRegister ? 'إخفاء نموذج تسجيل كابتن جديد' : 'تسجيل كابتن جديد ورفع صور المركبة'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold min-h-[42px]"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{isAr ? 'تسجيل الخروج وتبديل الحساب' : 'Sign Out'}</span>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">مستندات التوثيق وصور المركبة ({activeCaptain.documents.length})</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {activeCaptain.documents.map((doc) => (
                      <div key={doc.id} className="border border-slate-200 rounded-xl p-2.5 flex items-center gap-2.5 bg-slate-50">
                        {doc.image_url ? (
                          <img
                            src={doc.image_url}
                            alt={doc.label_ar}
                            referrerPolicy="no-referrer"
                            className="w-12 h-10 rounded object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-10 rounded bg-slate-200 flex items-center justify-center shrink-0 text-slate-500">
                            <Camera className="w-4 h-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 truncate">{doc.label_ar}</p>
                          <p className="text-[11px] text-teal-700 font-medium">{doc.review_status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {showRegister && renderRegistrationForm(() => setShowRegister(false))}
          </div>
        )}
      </div>

      {/* STICKY BOTTOM NAVIGATION BAR: الرئيسية | أوردرات اليوم | نقطة البيع POS | التسوية | الملف الشخصي */}
      <nav
        aria-label={isAr ? 'شريط التنقل السفلي لتطبيق الطيار' : 'Captain Bottom Navigation'}
        className="sticky bottom-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 rounded-t-2xl shadow-[0_-4px_20px_rgba(15,23,42,0.06)] px-2 sm:px-6 py-1.5"
      >
        <div className="grid grid-cols-5 gap-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl min-h-[54px] transition-colors ${
                  active ? 'text-[#A92224] bg-red-50/70 font-bold' : 'text-slate-600 hover:bg-slate-50 font-medium'
                }`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="absolute -top-2 -end-2.5 min-w-[18px] h-[18px] px-1 bg-[#A92224] text-white rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[11px] sm:text-xs whitespace-nowrap leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
