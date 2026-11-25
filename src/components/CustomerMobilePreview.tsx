import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  Bell,
  Camera,
  Car,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  CreditCard,
  Crosshair,
  FileText,
  Headphones,
  Home,
  ImagePlus,
  LayoutGrid,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Navigation,
  Package,
  Percent,
  Pill,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Tag,
  Trash2,
  Upload,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  computeLiveEta,
  computeOrderStoreStats,
  isSectionPickedUpByCaptain,
  isStorePrepared,
} from '../lib/orderBundles.ts';
import { parseLocalizedNumber, sanitizeDecimalInput } from '../lib/num.ts';
import { OrderChatPage } from './OrderChatPage.tsx';
import { TripChatPage } from './TripChatPage.tsx';
import { GpsMapPicker } from './GpsMapPicker.tsx';
import { CustomerAuthPortal } from './CustomerAuthPortal.tsx';
import { OtlobhaStorefrontHome } from './storefront/OtlobhaStorefrontHome.tsx';
import { OtlobhaCategoriesView } from './storefront/OtlobhaCategoriesView.tsx';
import { OtlobhaSmartSearchOverlay } from './storefront/OtlobhaSmartSearchOverlay.tsx';
import {
  OtlobhaProductDetailSheet,
  type SwipeProductPreview,
} from './storefront/OtlobhaProductDetailSheet.tsx';
import { OtlobhaSmartAssistantModal } from './storefront/OtlobhaSmartAssistantModal.tsx';
import type {
  CaptainRatingRecord,
  CategoryRecord,
  CouponRecord,
  Language,
  MarketListingRecord,
  MerchantRecord,
  NearbyCaptainRecord,
  NotificationRecord,
  OrderRecord,
  PaymentSettings,
  ProductRecord,
  ServiceConfig,
  ServiceZone,
  StorefrontBannerRecord,
  StorefrontCategoryRecord,
  StorefrontProductCard,
  SupportMessageRecord,
  SupportTicketRecord,
  TripRecord,
} from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify: (msg: string) => void;
  onRefreshCore: () => Promise<void>;
}

type BottomTab = 'home' | 'categories' | 'services' | 'offers' | 'cart' | 'profile';
type ServiceSubView = 'hub' | 'stores' | 'pharmacy' | 'rides_parcels' | 'market';

const CUSTOMER_SESSION_KEY = 'otlobha_customer_email_session';

interface CustomerSession {
  id: string;
  email: string;
  phone?: string;
  full_name: string;
}

export const CustomerMobilePreview: React.FC<Props> = ({ lang, onNotify, onRefreshCore }) => {
  const isAr = lang === 'ar';
  const [customerSession, setCustomerSession] = useState<CustomerSession | null>(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_SESSION_KEY);
      return raw ? (JSON.parse(raw) as CustomerSession) : null;
    } catch {
      return null;
    }
  });
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [showAuthScreen, setShowAuthScreen] = useState<boolean>(false);
  const [tab, setTab] = useState<BottomTab>('home');
  const [serviceView, setServiceView] = useState<ServiceSubView>('hub');
  const [showInbox, setShowInbox] = useState<boolean>(false);
  const [showSideDrawer, setShowSideDrawer] = useState<boolean>(false);
  const [showSupportModal, setShowSupportModal] = useState<boolean>(false);
  const [showLiveTracking, setShowLiveTracking] = useState<boolean>(false);
  const [supportTickets, setSupportTickets] = useState<SupportTicketRecord[]>([]);
  const [activeSupportTicketId, setActiveSupportTicketId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessageRecord[]>([]);
  const [newTicketSubject, setNewTicketSubject] = useState<string>('');
  const [newTicketCategory, setNewTicketCategory] = useState<string>('general');
  const [newTicketMessage, setNewTicketMessage] = useState<string>('');
  const [supportReplyText, setSupportReplyText] = useState<string>('');
  const [loadingSupport, setLoadingSupport] = useState<boolean>(false);
  const [sendingSupport, setSendingSupport] = useState<boolean>(false);
  const [flashingServiceKey, setFlashingServiceKey] = useState<string | null>(null);
  const [flashingMerchantId, setFlashingMerchantId] = useState<string | null>(null);
  const [flashingSectionId, setFlashingSectionId] = useState<string | null>(null);
  const [selectedStoreSectionId, setSelectedStoreSectionId] = useState<string>('all');
  const servicesStripRef = React.useRef<HTMLDivElement | null>(null);
  const stripDragRef = React.useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false });
  const merchantsStripRef = React.useRef<HTMLDivElement | null>(null);
  const merchantsDragRef = React.useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false });
  const sectionsStripRef = React.useRef<HTMLDivElement | null>(null);
  const sectionsDragRef = React.useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false });
  const storeHeaderRef = React.useRef<HTMLDivElement | null>(null);
  const [activeChatOrderId, setActiveChatOrderId] = useState<string | null>(null);
  const [activeChatTripId, setActiveChatTripId] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [market, setMarket] = useState<MarketListingRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [parcels, setParcels] = useState<any[]>([]);
  const [ratings, setRatings] = useState<CaptainRatingRecord[]>([]);
  const [pendingRatings, setPendingRatings] = useState<CaptainRatingRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const [customerName, setCustomerName] = useState(customerSession?.full_name || '');
  const [customerPhone, setCustomerPhone] = useState(customerSession?.phone || '');
  const [selectedZoneId, setSelectedZoneId] = useState('zn_city_center');
  const [addressLandmark, setAddressLandmark] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const handleCustomerVerified = (user: any) => {
    const sess: CustomerSession = {
      id: String(user.id || 'cust'),
      email: String(user.email || ''),
      phone: user.phone ? String(user.phone) : '',
      full_name: String(user.full_name || 'عميل اطلبها'),
    };
    setCustomerSession(sess);
    setIsGuest(false);
    setShowAuthScreen(false);
    setCustomerName(sess.full_name);
    setCustomerPhone(sess.phone || '');
    if (user.default_zone_id) setSelectedZoneId(String(user.default_zone_id));
    if (user.address_landmark) setAddressLandmark(String(user.address_landmark));
    try {
      localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(sess));
    } catch {
      // ignore
    }
  };

  const handleContinueAsGuest = () => {
    setIsGuest(true);
    setShowAuthScreen(false);
    if (!customerName) setCustomerName(isAr ? 'زائر اطلبها' : 'Guest');
    onNotify(
      isAr
        ? 'أنت تتصفح الآن كزائر — يمكنك استعراض المتاجر والعروض وإضافة للسلة ثم التسجيل عند الطلب'
        : 'Browsing as guest'
    );
  };

  const openAuthFromGuest = () => {
    setShowAuthScreen(true);
  };

  const requireCustomerAccount = (actionAr: string, actionEn: string): boolean => {
    if (customerSession) return false;
    onNotify(
      isAr
        ? `يرجى تسجيل الدخول أو إنشاء حساب ${actionAr} (سلتك محفوظة)`
        : `Please sign in or create an account to ${actionEn}`
    );
    setShowAuthScreen(true);
    return true;
  };

  const handleCustomerLogout = () => {
    api.logoutSession().catch(() => {});
    setCustomerSession(null);
    setIsGuest(false);
    setShowAuthScreen(false);
    setActiveChatOrderId(null);
    setActiveChatTripId(null);
    setOrders([]);
    setTrips([]);
    setParcels([]);
    setNotifications([]);
    setSupportTickets([]);
    setPendingRatings([]);
    setWalletBalance(0);
    setShowInbox(false);
    setTab('home');
    try {
      localStorage.removeItem(CUSTOMER_SESSION_KEY);
    } catch {
      // ignore
    }
    onNotify(isAr ? 'تم تسجيل خروج العميل' : 'Signed out');
  };

  // Cart & Store Free-Text State
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [freeTextOrder, setFreeTextOrder] = useState('');
  const [orderChannel, setOrderChannel] = useState<'catalog' | 'free_text' | 'voice' | 'image'>('catalog');
  const [isExpress, setIsExpress] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [walletBalance, setWalletBalance] = useState(45);
  const [homeSearch, setHomeSearch] = useState('');
  const [homeCategoryId, setHomeCategoryId] = useState<string>('all');

  // Flagship Storefront State (Home, Categories, Smart Search, Product Details Sheet, Smart Assistant)
  const [storefrontBanners, setStorefrontBanners] = useState<StorefrontBannerRecord[]>([]);
  const [storefrontCategories, setStorefrontCategories] = useState<StorefrontCategoryRecord[]>([]);
  const [storefrontProducts, setStorefrontProducts] = useState<StorefrontProductCard[]>([]);
  const [storefrontBrands, setStorefrontBrands] = useState<string[]>([]);
  const [storefrontLoading, setStorefrontLoading] = useState(false);
  const [storefrontPage, setStorefrontPage] = useState(1);
  const [storefrontHasMore, setStorefrontHasMore] = useState(false);
  const storefrontShuffleSeedRef = useRef<string>('');
  const [storefrontFilter, setStorefrontFilter] = useState<
    'for_you' | 'fresh' | 'groceries' | 'offers' | 'free_delivery'
  >('for_you');
  const [storefrontCategoryId, setStorefrontCategoryId] = useState('');
  const [storefrontBrand, setStorefrontBrand] = useState('');
  const [storefrontMerchantId, setStorefrontMerchantId] = useState('');
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailProductList, setDetailProductList] = useState<SwipeProductPreview[]>([]);
  const [detailFromStorefrontHome, setDetailFromStorefrontHome] = useState<boolean>(false);
  const [assistantModalOpen, setAssistantModalOpen] = useState(false);

  // Pharmacy Rx State
  const [pharmacyId, setPharmacyId] = useState<string>('');
  const [rxText, setRxText] = useState('');
  const [rxImageUrl, setRxImageUrl] = useState<string>('');
  const [rxImageName, setRxImageName] = useState<string>('');

  // Ride & Parcel State
  const [rideVehicle, setRideVehicle] = useState<'moto' | 'tuktuk' | 'car'>('moto');
  const [pickupLat, setPickupLat] = useState<number>(31.1583);
  const [pickupLng, setPickupLng] = useState<number>(31.9369);
  const [pickupAddress, setPickupAddress] = useState<string>('موقعي الحالي (GPS) — وسط المنزلة');
  const [rideDropoff, setRideDropoff] = useState('موقف المنزلة العمومي');
  const [rideDropoffLat, setRideDropoffLat] = useState<number | null>(31.1645);
  const [rideDropoffLng, setRideDropoffLng] = useState<number | null>(31.9442);
  const [mapPickTarget, setMapPickTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [locatingGps, setLocatingGps] = useState(false);
  const [nearbyCaptains, setNearbyCaptains] = useState<NearbyCaptainRecord[]>([]);
  const [selectedCaptainId, setSelectedCaptainId] = useState<string | null>(null);
  const [captainFilterVehicle, setCaptainFilterVehicle] = useState<'all' | 'moto' | 'tuktuk' | 'car'>('all');
  const [customerProposedFare, setCustomerProposedFare] = useState<string>('');
  const [rideDistanceKm, setRideDistanceKm] = useState<number>(2.5);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{
    rating_id?: string;
    captain_id: string;
    captain_name: string;
    ref_type: 'trip' | 'order' | 'parcel';
    ref_id: string;
    ref_number: string;
    final_amount: number;
  } | null>(null);
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [submittingRating, setSubmittingRating] = useState<boolean>(false);
  const [parcelReceiverPhone, setParcelReceiverPhone] = useState('01099887766');
  const [parcelDropoff, setParcelDropoff] = useState('البصراط — بجوار الوحدة الصحية');
  const [parcelItemCat, setParcelItemCat] = useState('مستندات وأوراق');
  const [parcelSize, setParcelSize] = useState<'small' | 'medium' | 'large'>('small');
  const [parcelCustomFee, setParcelCustomFee] = useState<string>('');
  const [parcelCaptainId, setParcelCaptainId] = useState<string>('');
  const [prohibitedConfirmed, setProhibitedConfirmed] = useState(true);
  const [lastParcelOtp, setLastParcelOtp] = useState<{ num: string; otp: string } | null>(null);

  // Market Listing State
  const [mktTitle, setMktTitle] = useState('');
  const [mktPrice, setMktPrice] = useState(450);
  const [mktCategory, setMktCategory] = useState('هواتف وإلكترونيات');
  const [mktDesc, setMktDesc] = useState('');
  const [mktImageUrl, setMktImageUrl] = useState('');
  const [mktImageName, setMktImageName] = useState('');
  const [mktCondition, setMktCondition] = useState<'new' | 'used'>('used');
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'cash' | 'vodafone_cash' | 'instapay' | 'network'>('cash');
  const [paymentProofImageUrl, setPaymentProofImageUrl] = useState<string>('');
  const [showCheckoutMap, setShowCheckoutMap] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const autoOpenedCaptainChatIdsRef = useRef<Set<string>>(new Set());
  const prevOrderStatusMapRef = useRef<Record<string, string>>({});
  const customerTabHistoryRef = useRef<BottomTab[]>([]);
  const prevCustomerTabRef = useRef<BottomTab>('home');
  const customerBackGuardActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (prevCustomerTabRef.current !== tab) {
      const prev = prevCustomerTabRef.current;
      if (customerTabHistoryRef.current[customerTabHistoryRef.current.length - 1] !== prev) {
        customerTabHistoryRef.current = [...customerTabHistoryRef.current.slice(-9), prev];
      }
      prevCustomerTabRef.current = tab;
    }
  }, [tab]);

  const hasCustomerBackStep = Boolean(
    detailProductId ||
      searchOverlayOpen ||
      assistantModalOpen ||
      showSupportModal ||
      showLiveTracking ||
      showCheckoutMap ||
      activeChatOrderId ||
      activeChatTripId ||
      showInbox ||
      showSideDrawer ||
      (showAuthScreen && isGuest) ||
      (tab === 'services' && serviceView !== 'hub') ||
      (tab === 'home' &&
        (storefrontFilter !== 'for_you' ||
          Boolean(storefrontCategoryId) ||
          Boolean(storefrontBrand) ||
          Boolean(storefrontMerchantId) ||
          Boolean(homeSearch.trim()))) ||
      tab !== 'home'
  );

  const customerBackActionRef = useRef<() => boolean>(() => false);
  customerBackActionRef.current = () => {
    if (detailProductId) {
      setDetailProductId(null);
      return true;
    }
    if (searchOverlayOpen) {
      setSearchOverlayOpen(false);
      return true;
    }
    if (assistantModalOpen) {
      setAssistantModalOpen(false);
      return true;
    }
    if (showSupportModal) {
      setShowSupportModal(false);
      return true;
    }
    if (showLiveTracking) {
      setShowLiveTracking(false);
      return true;
    }
    if (showCheckoutMap) {
      setShowCheckoutMap(false);
      return true;
    }
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
    if (showSideDrawer) {
      setShowSideDrawer(false);
      return true;
    }
    if (showAuthScreen && isGuest) {
      setShowAuthScreen(false);
      return true;
    }
    if (tab === 'services' && serviceView !== 'hub') {
      setServiceView('hub');
      return true;
    }
    if (
      tab === 'home' &&
      (storefrontFilter !== 'for_you' ||
        storefrontCategoryId ||
        storefrontBrand ||
        storefrontMerchantId ||
        homeSearch.trim())
    ) {
      setStorefrontFilter('for_you');
      setStorefrontCategoryId('');
      setStorefrontBrand('');
      setStorefrontMerchantId('');
      setHomeSearch('');
      return true;
    }
    if (customerTabHistoryRef.current.length > 0) {
      const nextStack = [...customerTabHistoryRef.current];
      const prevTab = nextStack.pop()!;
      customerTabHistoryRef.current = nextStack;
      prevCustomerTabRef.current = prevTab;
      setTab(prevTab);
      return true;
    }
    if (tab !== 'home') {
      prevCustomerTabRef.current = 'home';
      setTab('home');
      return true;
    }
    return false;
  };

  const [customerBackPopSeq, setCustomerBackPopSeq] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hasCustomerBackStep && !customerBackGuardActiveRef.current) {
      try {
        window.history.pushState({ otlobhaMobileBackGuard: 'customer' }, '');
        customerBackGuardActiveRef.current = true;
      } catch {
        // ignore sandboxed history restrictions
      }
    }
  }, [hasCustomerBackStep, customerBackPopSeq]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      customerBackGuardActiveRef.current = false;
      const handled = customerBackActionRef.current();
      if (handled) {
        setCustomerBackPopSeq((n) => n + 1);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadBootstrap = async (isAuthed = Boolean(customerSession)) => {
    const [boot, allOrders, notifs] = await Promise.all([
      isAuthed ? api.getCustomerBootstrap() : api.getCustomerGuestBootstrap(),
      isAuthed ? api.getOrders().catch(() => []) : Promise.resolve([]),
      isAuthed ? api.getMobileNotifications('customer').catch(() => []) : Promise.resolve([]),
    ]);
    setServices(boot.services || []);
    setZones(boot.zones || []);
    setMerchants(boot.merchants || []);
    setCategories(boot.categories || []);
    setProducts(boot.products || []);
    setCoupons(boot.coupons || []);
    setMarket(boot.market || []);
    setTrips(boot.trips || []);
    setParcels(boot.parcels || []);
    setRatings(boot.ratings || []);
    setPendingRatings(boot.pending_ratings || []);
    const mergedOrders: OrderRecord[] =
      Array.isArray(allOrders) && allOrders.length > 0 ? allOrders : (boot.orders as OrderRecord[]) || [];
    setOrders(mergedOrders);
    setNotifications(notifs);
    if (boot.wallet && typeof boot.wallet.available_balance === 'number') {
      setWalletBalance(boot.wallet.available_balance);
    }
    if (boot.customer) {
      if (boot.customer.full_name && !customerName) setCustomerName(String(boot.customer.full_name));
      if (boot.customer.phone && !customerPhone) setCustomerPhone(String(boot.customer.phone));
      if (boot.customer.address_landmark && !addressLandmark) setAddressLandmark(String(boot.customer.address_landmark));
      if (boot.customer.default_zone_id) setSelectedZoneId(String(boot.customer.default_zone_id));
      if (boot.customer.last_lat && boot.customer.last_lng) {
        setPickupLat(Number(boot.customer.last_lat));
        setPickupLng(Number(boot.customer.last_lng));
      }
    }

    if (boot.payment_settings) {
      setPaymentSettings(boot.payment_settings);
      if (!boot.payment_settings.cod_enabled) {
        if (boot.payment_settings.vodafone_cash_enabled) {
          setCheckoutPaymentMethod('vodafone_cash');
        } else if (boot.payment_settings.instapay_enabled) {
          setCheckoutPaymentMethod('instapay');
        } else if (boot.payment_settings.network_pos_enabled) {
          setCheckoutPaymentMethod('network');
        }
      }
    }

    const storeMer = (boot.merchants || []).find((m: MerchantRecord) => m.merchant_type !== 'pharmacy');
    if (storeMer && !selectedMerchantId) setSelectedMerchantId(storeMer.id);
    const pharmaMer = (boot.merchants || []).find((m: MerchantRecord) => m.merchant_type === 'pharmacy');
    if (pharmaMer && !pharmacyId) setPharmacyId(pharmaMer.id);
  };

  const loadCustomerSupportTickets = async (keepSelection = true) => {
    setLoadingSupport(true);
    try {
      const list = await api.getSupportTickets(
        customerSession?.email ? { customer_email: customerSession.email } : undefined
      );
      setSupportTickets(list);
      if (list.length > 0) {
        const nextId =
          keepSelection && activeSupportTicketId && list.some((t) => t.id === activeSupportTicketId)
            ? activeSupportTicketId
            : list[0].id;
        setActiveSupportTicketId(nextId);
        const detail = await api.getSupportMessages(nextId);
        setSupportMessages(detail.messages || []);
      } else {
        setActiveSupportTicketId(null);
        setSupportMessages([]);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSupport(false);
    }
  };

  const handleSelectSupportTicket = async (ticketId: string) => {
    setActiveSupportTicketId(ticketId);
    try {
      const detail = await api.getSupportMessages(ticketId);
      setSupportMessages(detail.messages || []);
    } catch {
      setSupportMessages([]);
    }
  };

  const handleCreateSupportTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireCustomerAccount('للتواصل مع الدعم الفني', 'contact support')) return;
    if ((!newTicketSubject.trim() && !newTicketMessage.trim()) || sendingSupport) return;
    setSendingSupport(true);
    try {
      const res = await api.createSupportTicket({
        customer_id: customerSession?.id,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerSession?.email,
        subject: newTicketSubject.trim() || newTicketMessage.trim().slice(0, 60),
        category: newTicketCategory,
        message_text: newTicketMessage.trim() || newTicketSubject.trim(),
      });
      setNewTicketSubject('');
      setNewTicketMessage('');
      setActiveSupportTicketId(res.ticket.id);
      setSupportMessages(res.messages || []);
      await Promise.all([loadCustomerSupportTickets(true), onRefreshCore()]);
      onNotify(isAr ? `تم إرسال رسالتك للإدارة (${res.ticket.ticket_number})` : 'Support ticket sent');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSendingSupport(false);
    }
  };

  const handleSendSupportReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSupportTicketId || !supportReplyText.trim() || sendingSupport) return;
    setSendingSupport(true);
    try {
      await api.sendSupportMessage(activeSupportTicketId, {
        sender_role: 'customer',
        sender_name: customerName,
        message_text: supportReplyText.trim(),
      });
      setSupportReplyText('');
      await Promise.all([handleSelectSupportTicket(activeSupportTicketId), loadCustomerSupportTickets(true)]);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSendingSupport(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (cancelled) return;
        if (res.authenticated && res.user?.actorType === 'customer') {
          handleCustomerVerified(res.user);
          loadBootstrap(true).catch(() => {});
        } else {
          setCustomerSession(null);
          try {
            localStorage.removeItem(CUSTOMER_SESSION_KEY);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCustomerSession(null);
        try {
          localStorage.removeItem(CUSTOMER_SESSION_KEY);
        } catch {
          // ignore
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customerSession && !isGuest) return;
    const isAuthed = Boolean(customerSession);
    loadBootstrap(isAuthed).catch(() => {});
    if (isAuthed) {
      loadCustomerSupportTickets(false);
    }

    const onFocus = () => loadBootstrap(isAuthed).catch(() => {});
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [customerSession?.id, isGuest]);

  const calcAirKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const refreshNearbyCaptains = async (
    pLat = pickupLat,
    pLng = pickupLng,
    dLat = rideDropoffLat,
    dLng = rideDropoffLng
  ) => {
    const distKm =
      dLat !== null && dLng !== null
        ? Math.max(1.0, Number((calcAirKm(pLat, pLng, dLat, dLng) * 1.25).toFixed(2)))
        : 2.5;
    setRideDistanceKm(distKm);
    try {
      const caps = await api.getNearbyCaptains(pLat, pLng, 'all');
      const onlineOnly = (caps || []).filter((c) => c.availability_status === 'available');
      setNearbyCaptains(onlineOnly);
      setSelectedCaptainId((prev) => (prev && onlineOnly.some((c) => c.id === prev) ? prev : null));
      setParcelCaptainId((prev) => (prev && onlineOnly.some((c) => c.id === prev) ? prev : ''));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshNearbyCaptains(pickupLat, pickupLng, rideDropoffLat, rideDropoffLng);
  }, [pickupLat, pickupLng, rideDropoffLat, rideDropoffLng, selectedZoneId, tab, serviceView]);

  useEffect(() => {
    if (!customerSession) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectRidesWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(
        `${proto}//${window.location.host}/ws/order-chat?channel=customer&customerId=${encodeURIComponent(customerSession.id)}`
      );
      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(String(evt.data || '{}'));
          if (
            payload.type === 'captain:location' ||
            payload.type === 'captains:updated' ||
            payload.type === 'order:status' ||
            payload.type === 'chat:message'
          ) {
            api
              .getNearbyCaptains(pickupLat, pickupLng, 'all')
              .then((caps) => {
                const onlineOnly = (caps || []).filter((c) => c.availability_status === 'available');
                setNearbyCaptains(onlineOnly);
                setSelectedCaptainId((prev) => (prev && onlineOnly.some((c) => c.id === prev) ? prev : null));
                setParcelCaptainId((prev) => (prev && onlineOnly.some((c) => c.id === prev) ? prev : ''));
              })
              .catch(() => {});
            loadBootstrap(true).catch(() => {});
          } else if (payload.type === 'trip:accepted' && payload.trip) {
            const acceptedTrip = payload.trip as TripRecord;
            loadBootstrap(true).catch(() => {});
            if (pendingTripId === acceptedTrip.id || acceptedTrip.customer_name === customerName) {
              setPendingTripId(null);
              setActiveChatTripId(acceptedTrip.id);
              onNotify(
                isAr
                  ? `قبل الكابتن ${acceptedTrip.captain_name} مشوارك — تم فتح صفحة الشات وتتبع الـ GPS`
                  : `Captain ${acceptedTrip.captain_name} accepted your ride`
              );
            }
          } else if (
            payload.type === 'trip:status' ||
            payload.type === 'trip:fare_updated' ||
            payload.type === 'rating:submitted'
          ) {
            loadBootstrap(true).catch(() => {});
            onRefreshCore().catch(() => {});
          } else if (payload.type === 'trip:completed') {
            loadBootstrap(true).catch(() => {});
            onRefreshCore().catch(() => {});
            if (payload.rating_prompt) {
              const rp = payload.rating_prompt as CaptainRatingRecord;
              setRatingTarget({
                rating_id: rp.id,
                captain_id: rp.captain_id,
                captain_name: rp.captain_name,
                ref_type: 'trip',
                ref_id: rp.ref_id,
                ref_number: rp.ref_number,
                final_amount: rp.final_amount,
              });
              setRatingStars(5);
              setRatingComment('');
            }
          } else if (payload.type === 'trip:cancelled') {
            loadBootstrap(true).catch(() => {});
            onRefreshCore().catch(() => {});
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = (ev) => {
        if (!closed && ev.code !== 4401) reconnectTimer = setTimeout(connectRidesWs, 3000);
      };
    };

    connectRidesWs();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [customerSession?.email, customerSession?.id, pendingTripId, pickupLat, pickupLng]);

  // Auto-open Captain Chat as soon as an order is picked up by the captain (transitions to 'on_the_way')
  useEffect(() => {
    if (!orders.length) return;
    const prevMap = prevOrderStatusMapRef.current;
    const isInitialLoad = Object.keys(prevMap).length === 0;

    for (const o of orders) {
      const prevStatus = prevMap[o.id];
      const isMyOrder =
        o.id === trackedOrderId ||
        (customerSession?.id && (o as any).customer_id === customerSession.id) ||
        o.customer_name === customerName;

      if (isInitialLoad && o.status === 'on_the_way' && o.id !== trackedOrderId) {
        // Mark pre-existing on_the_way orders on initial boot so we don't pop open old chats unexpectedly
        autoOpenedCaptainChatIdsRef.current.add(o.id);
      } else if (
        isMyOrder &&
        o.status === 'on_the_way' &&
        Boolean(o.captain_id) &&
        !autoOpenedCaptainChatIdsRef.current.has(o.id) &&
        (o.id === trackedOrderId || (prevStatus && prevStatus !== 'on_the_way'))
      ) {
        autoOpenedCaptainChatIdsRef.current.add(o.id);
        setActiveChatOrderId(o.id);
        onNotify(
          isAr
            ? `استلم الطيار ${o.captain_name || ''} طلبك #${o.order_number} من المتجر وهو في الطريق إليك — تم فتح الشات المباشر بينكما الآن!`
            : `Captain ${o.captain_name || ''} picked up order #${o.order_number} — Chat opened!`
        );
      }
      prevMap[o.id] = o.status;
    }
  }, [orders, trackedOrderId, customerSession?.id, customerName]);

  const serviceMap = Object.fromEntries(services.map((s) => [s.service_key, s]));
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const merchantProducts = products.filter((p) => p.merchant_id === selectedMerchantId);
  const cartItems = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([pid, qty]) => {
      const prod = products.find((p) => p.id === pid);
      const unitPrice = prod ? prod.sale_price ?? prod.base_price : 0;
      return { prod, qty, unitPrice };
    })
    .filter((x) => x.prod);
  const cartSubtotal = cartItems.reduce((acc, item) => acc + item.unitPrice * item.qty, 0);
  const cartTotalQty = cartItems.reduce((acc, item) => acc + item.qty, 0);
  const cartGroups = Array.from(
    cartItems
      .reduce((map, item) => {
        const mId = item.prod!.merchant_id;
        if (!map.has(mId)) {
          map.set(mId, {
            merchant_id: mId,
            merchant_name: item.prod!.merchant_name || (isAr ? 'متجر في اطلبها' : 'Otlobha Store'),
            items: [] as typeof cartItems,
            subtotal: 0,
          });
        }
        const grp = map.get(mId)!;
        grp.items.push(item);
        grp.subtotal += item.unitPrice * item.qty;
        return map;
      }, new Map<string, { merchant_id: string; merchant_name: string; items: typeof cartItems; subtotal: number }>())
      .values()
  );
  const offersCategoryIds = new Set(categories.filter((c) => c.is_offers_section).map((c) => c.id));
  const isProductInOffers = (p: ProductRecord) =>
    Boolean(p.is_offer) ||
    offersCategoryIds.has(p.category_id) ||
    (p.sale_price !== null && p.sale_price !== undefined && p.sale_price < p.base_price);

  const selectedStoreMerchant = merchants.find((m) => m.id === selectedMerchantId);
  const selectedMerchantOffersCat = categories.find(
    (c) => c.merchant_id === selectedMerchantId && c.is_offers_section
  );
  const storeSectionsForMerchant: Array<{
    id: string;
    name_ar: string;
    name_en: string;
    image_url?: string;
    kind: 'all' | 'offers' | 'category';
  }> = [
    {
      id: 'all',
      name_ar: 'الكل',
      name_en: 'All',
      image_url: selectedStoreMerchant?.image_url || '',
      kind: 'all',
    },
    {
      id: selectedMerchantOffersCat?.id || 'offers',
      name_ar: selectedMerchantOffersCat?.name_ar || 'العروض',
      name_en: selectedMerchantOffersCat?.name_en || 'Offers',
      image_url: selectedMerchantOffersCat?.image_url || '',
      kind: 'offers',
    },
    ...categories
      .filter((c) => c.scope !== 'market' && c.is_active !== false && !c.is_offers_section)
      .filter(
        (c) =>
          c.merchant_id === selectedMerchantId ||
          (!c.merchant_id && merchantProducts.some((p) => p.category_id === c.id))
      )
      .map((c) => ({
        id: c.id,
        name_ar: c.name_ar,
        name_en: c.name_en,
        image_url: c.image_url || '',
        kind: 'category' as const,
      })),
  ];

  const filteredStoreProducts = merchantProducts.filter((p) => {
    if (selectedStoreSectionId === 'all') return true;
    const isSelectedOffers =
      selectedStoreSectionId === 'offers' || offersCategoryIds.has(selectedStoreSectionId);
    if (isSelectedOffers) {
      return isProductInOffers(p);
    }
    return p.category_id === selectedStoreSectionId;
  });

  const discountedProducts = products.filter(isProductInOffers);
  const promoNotifications = notifications.filter((n) => n.category === 'promo');

  const openServiceView = (view: ServiceSubView) => {
    setServiceView(view);
    setTab('services');
  };

  const loadStorefrontData = async (opts?: {
    page?: number;
    append?: boolean;
    filter?: 'for_you' | 'fresh' | 'groceries' | 'offers' | 'free_delivery';
    categoryId?: string;
    brand?: string;
    merchantId?: string;
  }) => {
    const nextPage = opts?.page ?? 1;
    const nextFilter = opts?.filter ?? storefrontFilter;
    const nextCat = opts?.categoryId !== undefined ? opts.categoryId : storefrontCategoryId;
    const nextBrand = opts?.brand !== undefined ? opts.brand : storefrontBrand;
    const nextMerchant = opts?.merchantId !== undefined ? opts.merchantId : storefrontMerchantId;
    if (!opts?.append || !storefrontShuffleSeedRef.current) {
      storefrontShuffleSeedRef.current = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    }
    setStorefrontLoading(true);
    try {
      const res = await api.getStorefrontHome({
        filter: nextFilter,
        category_id: nextCat || undefined,
        brand: nextBrand || undefined,
        merchant_id: nextMerchant || undefined,
        page: nextPage,
        limit: 24,
        shuffle_seed: storefrontShuffleSeedRef.current,
      });
      setStorefrontBanners(res.banners || []);
      setStorefrontCategories(res.categories || []);
      setStorefrontBrands(res.brands || []);
      setStorefrontProducts((prev) =>
        opts?.append ? [...prev, ...(res.products || [])] : res.products || []
      );
      setStorefrontPage(nextPage);
      setStorefrontHasMore(Boolean(res.pagination?.has_more));
    } catch {
      // ignore transient storefront fetch errors
    } finally {
      setStorefrontLoading(false);
    }
  };

  useEffect(() => {
    void loadStorefrontData({
      page: 1,
      append: false,
      filter: storefrontFilter,
      categoryId: storefrontCategoryId,
      brand: storefrontBrand,
      merchantId: storefrontMerchantId,
    });
  }, [storefrontFilter, storefrontCategoryId, storefrontBrand, storefrontMerchantId, tab]);

  const ensureProductInCatalogState = (p: {
    id: string;
    merchant_id: string;
    merchant_name?: string;
    category_id?: string;
    name_ar: string;
    name_en?: string;
    image_url?: string;
    base_price: number;
    sale_price?: number | null;
    is_weighted?: boolean;
    weight_step?: number;
    weight_unit?: string;
  }) => {
    setProducts((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev;
      const stub: ProductRecord = {
        id: p.id,
        merchant_id: p.merchant_id,
        merchant_name: p.merchant_name || '',
        category_id: p.category_id || 'cat_grocery',
        name_ar: p.name_ar,
        name_en: p.name_en || p.name_ar,
        description: '',
        image_url: p.image_url || '',
        base_price: Number(p.base_price || 0),
        sale_price: p.sale_price !== undefined ? p.sale_price : null,
        is_offer: Boolean(p.sale_price !== null && p.sale_price !== undefined && p.sale_price < p.base_price),
        is_weighted: Boolean(p.is_weighted),
        weight_step: Number(p.weight_step || 0.25),
        weight_unit: p.weight_unit || 'كجم',
        stock_quantity: 50,
        low_stock_threshold: 5,
        requires_prescription: false,
        addons_text: '',
        is_available: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return [stub, ...prev];
    });
  };

  const handleAddStorefrontCard = (card: StorefrontProductCard) => {
    ensureProductInCatalogState({
      id: card.id,
      merchant_id: card.merchant_id,
      merchant_name: card.merchant_name,
      category_id: card.category_id,
      name_ar: card.name_ar,
      name_en: card.name_en,
      image_url: card.image_url,
      base_price: card.base_price,
      sale_price: card.sale_price,
      is_weighted: Boolean(card.is_weighted),
      weight_step: Number(card.weight_step || 0.25),
      weight_unit: card.weight_unit || 'كجم',
    });
    handleAddToCart(
      {
        id: card.id,
        merchant_id: card.merchant_id,
        merchant_name: card.merchant_name,
        category_id: card.category_id,
        name_ar: card.name_ar,
        name_en: card.name_en || card.name_ar,
        description: card.description || '',
        image_url: card.image_url || '',
        base_price: card.base_price,
        sale_price: card.sale_price,
        is_offer: card.is_offer,
        is_weighted: Boolean(card.is_weighted),
        weight_step: Number(card.weight_step || 0.25),
        weight_unit: card.weight_unit || 'كجم',
        stock_quantity: card.stock_quantity,
        low_stock_threshold: 5,
        requires_prescription: Boolean(card.requires_prescription),
        addons_text: '',
        is_available: card.is_available,
        created_at: '',
        updated_at: '',
      },
      card.is_weighted ? Number(card.weight_step || 0.25) : 1
    );
  };

  const handleDecrementStorefrontProduct = (prodId: string) => {
    const prod = products.find((p) => p.id === prodId);
    const step = prod?.is_weighted ? Number(prod.weight_step || 0.25) : 1;
    setCart((prev) => {
      const next = { ...prev };
      const cur = next[prodId] || 0;
      const updated = Math.round((cur - step) * 1000) / 1000;
      if (updated <= 0.0001) delete next[prodId];
      else next[prodId] = updated;
      return next;
    });
  };

  const handleOpenOtlobhaService = (
    srv: 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order' | 'stores' | 'hub'
  ) => {
    if (srv === 'free_order') {
      setOrderChannel('free_text');
      setTab('cart');
      return;
    }
    if (srv === 'rides' || srv === 'parcels') {
      openServiceView('rides_parcels');
      return;
    }
    openServiceView(srv);
  };

  const handleAddToCart = (prod: ProductRecord, delta: number) => {
    const step = prod.is_weighted ? Number(prod.weight_step || 0.25) : 1;
    const effectiveDelta =
      prod.is_weighted && Math.abs(delta) === 1 ? (delta > 0 ? step : -step) : delta;
    const currentQty = cart[prod.id] || 0;
    const nextQty = Math.max(0, Math.round((currentQty + effectiveDelta) * 1000) / 1000);
    if (effectiveDelta > 0) {
      setSelectedMerchantId(prod.merchant_id);
      setOrderChannel('catalog');
      if (currentQty === 0) {
        onNotify(
          isAr
            ? `تمت إضافة "${prod.name_ar}" إلى السلة (${cartTotalQty + 1} منتجات)`
            : `Added "${prod.name_ar}" to cart`
        );
      }
    }
    setCart((prev) => {
      const updated = { ...prev };
      if (nextQty <= 0.0001) {
        delete updated[prod.id];
      } else {
        updated[prod.id] = nextQty;
      }
      return updated;
    });
  };

  const handleMarkRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await api.markNotificationRead(id).catch(() => {});
  };

  const handleMarkAllInboxRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await api.markAllNotificationsRead({
        ids: unreadIds,
        app: 'customer',
        recipient_id: customerSession?.id,
      });
    } catch {
      // Fallback per-id if needed
      await Promise.all(unreadIds.map((id) => api.markNotificationRead(id).catch(() => {})));
    }
  };

  const openInboxDrawer = () => {
    const opening = !showInbox;
    setShowInbox(opening);
    setShowSideDrawer(false);
    setShowLiveTracking(false);
    if (opening) {
      void handleMarkAllInboxRead();
    }
  };

  const handleNotificationClick = (n: NotificationRecord) => {
    if (!n.is_read) {
      void handleMarkRead(n.id);
    }
    const raw = String(n.deep_link || '').trim();
    const low = raw.toLowerCase();
    setShowInbox(false);
    if (!low || low === 'notifications') return;
    if (low === 'home') {
      setTab('home');
      return;
    }
    if (low === 'categories') {
      setTab('categories');
      return;
    }
    if (low.startsWith('category:')) {
      const catId = raw.slice(9).trim();
      if (catId) {
        setStorefrontCategoryId(catId);
        setStorefrontMerchantId('');
        setStorefrontBrand('');
        setStorefrontFilter('for_you');
        setTab('home');
      } else {
        setTab('categories');
      }
      return;
    }
    if (low.startsWith('merchant:')) {
      const merId = raw.slice(9).trim();
      if (merId) {
        setSelectedMerchantId(merId);
        setStorefrontMerchantId(merId);
        setStorefrontCategoryId('');
        setStorefrontBrand('');
        setTab('home');
      } else {
        handleOpenOtlobhaService('stores');
      }
      return;
    }
    if (low.startsWith('product:')) {
      const prodId = raw.slice(8).trim();
      const found = products.find((p) => p.id === prodId) || storefrontProducts.find((p) => p.id === prodId);
      if (found) {
        setStorefrontCategoryId(found.category_id || '');
        setStorefrontMerchantId(found.merchant_id || '');
      }
      setTab('home');
      return;
    }
    if (low === 'offers' || low === 'promo') {
      setTab('offers');
      return;
    }
    if (low === 'cart') {
      setTab('cart');
      return;
    }
    if (low === 'orders' || low === 'profile' || low === 'wallet') {
      setTab('profile');
      return;
    }
    if (low === 'support') {
      setShowSupportModal(true);
      return;
    }
    if (low === 'pharmacy') {
      handleOpenOtlobhaService('pharmacy');
      return;
    }
    if (low === 'rides') {
      handleOpenOtlobhaService('rides');
      return;
    }
    if (low === 'parcels') {
      handleOpenOtlobhaService('parcels');
      return;
    }
    if (low === 'market') {
      handleOpenOtlobhaService('market');
      return;
    }
    if (low === 'stores') {
      handleOpenOtlobhaService('stores');
      return;
    }
    if (low === 'free_order') {
      handleOpenOtlobhaService('free_order');
      return;
    }
  };

  const handleSubmitStoreOrder = async () => {
    if (requireCustomerAccount('لإتمام وإرسال الطلب', 'place an order')) return;
    if (orderChannel === 'catalog' && cartItems.length === 0) {
      onNotify(isAr ? 'أضف منتجًا واحدًا على الأقل إلى السلة' : 'Add at least one item to cart');
      return;
    }
    if (orderChannel !== 'catalog' && !selectedMerchantId) {
      onNotify(isAr ? 'اختر المتجر المستلم للطلب الحر' : 'Select a merchant');
      return;
    }
    if (orderChannel !== 'catalog' && !freeTextOrder.trim()) {
      onNotify(isAr ? 'اكتب تفاصيل الطلب الحر أو وصف الصورة/الصوت' : 'Enter free-text order details');
      return;
    }
    const zone = zones.find((z) => z.id === selectedZoneId);
    let createdOrderId = '';
    let createdOrderNumber = '';
    let createdStoreCount = 1;
    try {
      if (orderChannel === 'catalog') {
        const res = await api.createOrderBundle({
          customer_id: customerSession?.id,
          customer_name: customerName,
          customer_phone: customerPhone,
          zone_id: selectedZoneId,
          zone_name: zone?.name_ar || 'وسط مدينة المنزلة',
          address_landmark: addressLandmark,
          is_express: isExpress,
          coupon_code: couponCode.trim() || undefined,
          customer_lat: pickupLat,
          customer_lng: pickupLng,
          payment_method: checkoutPaymentMethod,
          payment_proof_image_url:
            (checkoutPaymentMethod === 'vodafone_cash' || checkoutPaymentMethod === 'instapay') && paymentProofImageUrl
              ? paymentProofImageUrl
              : undefined,
          stores: cartGroups.map((grp) => ({
            merchant_id: grp.merchant_id,
            order_channel: 'catalog',
            free_order_text: grp.items.map((c) => `${c.prod!.name_ar} × ${c.qty}`).join(' + '),
            items: grp.items.map((c) => ({
              product_id: c.prod!.id,
              name_ar: c.prod!.name_ar,
              quantity: c.qty,
              unit_price: Number(c.prod!.sale_price ?? c.prod!.base_price),
            })),
          })),
        });
        createdOrderId = res.id || res.order?.id || '';
        createdOrderNumber = res.order_number || '';
        createdStoreCount = res.store_count || cartGroups.length;
      } else {
        const res = await api.createOrder({
          customer_id: customerSession?.id,
          customer_name: customerName,
          customer_phone: customerPhone,
          merchant_id: selectedMerchantId,
          zone_id: selectedZoneId,
          zone_name: zone?.name_ar || 'وسط مدينة المنزلة',
          address_landmark: addressLandmark,
          order_channel: orderChannel,
          free_order_text: freeTextOrder,
          is_express: isExpress,
          subtotal: 150,
          coupon_code: couponCode.trim() || undefined,
          discount_amount: appliedDiscount,
          customer_lat: pickupLat,
          customer_lng: pickupLng,
          payment_method: checkoutPaymentMethod,
          payment_proof_image_url:
            (checkoutPaymentMethod === 'vodafone_cash' || checkoutPaymentMethod === 'instapay') && paymentProofImageUrl
              ? paymentProofImageUrl
              : undefined,
        });
        createdOrderId = res.id || '';
        createdOrderNumber = res.order_number;
      }
    } catch (err) {
      onNotify((err as Error).message);
      return;
    }
    if (createdOrderId) {
      setTrackedOrderId(createdOrderId);
    }
    setCart({});
    setFreeTextOrder('');
    setPaymentProofImageUrl('');
    setCouponCode('');
    setAppliedDiscount(0);
    await Promise.all([loadBootstrap(true), onRefreshCore()]);
    onNotify(
      createdStoreCount > 1
        ? isAr
          ? `تم إرسال طلبك الموحد #${createdOrderNumber} (${createdStoreCount} متاجر) — تابع حالة التجهيز أدناه، وسيفتح الشات تلقائيًا فور استلام الطيار للطلب`
          : `Order #${createdOrderNumber} (${createdStoreCount} stores) placed`
        : isAr
        ? `تم إرسال الطلب #${createdOrderNumber} للمتجر — تابع حالة التجهيز الآن، وسيفتح الشات تلقائيًا عند استلام الطيار للطلب`
        : `Order #${createdOrderNumber} placed`
    );
    setTab('profile');
  };

  const handleApplyCoupon = async (overrideCode?: string) => {
    const codeToTry = (overrideCode ?? couponCode).trim();
    if (!codeToTry) {
      onNotify(isAr ? 'أدخل كود الخصم أولًا' : 'Enter coupon code');
      return;
    }
    try {
      const sub = orderChannel === 'catalog' && cartSubtotal > 0 ? cartSubtotal : 150;
      const res = await api.validateCoupon(codeToTry, sub, 'stores');
      setCouponCode(res.code);
      setAppliedDiscount(res.discount_amount);
      onNotify(isAr ? `تم تطبيق كوبون ${res.code} بخصم ${res.discount_amount} ج.م` : `Coupon ${res.code} applied`);
      if (overrideCode) {
        setTab('cart');
      }
    } catch (err) {
      setAppliedDiscount(0);
      onNotify((err as Error).message);
    }
  };

  const handleRxImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRxImageName(file.name);
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
          setRxImageUrl(canvas.toDataURL('image/jpeg', 0.78));
        } else {
          setRxImageUrl(rawDataUrl);
        }
      };
      img.onerror = () => setRxImageUrl(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleMarketImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMktImageName(file.name);
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
          setMktImageUrl(canvas.toDataURL('image/jpeg', 0.78));
        } else {
          setMktImageUrl(rawDataUrl);
        }
      };
      img.onerror = () => setMktImageUrl(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmitRx = async () => {
    if (requireCustomerAccount('لإرسال الروشتة للصيدلية', 'submit a prescription')) return;
    if (!pharmacyId) return;
    if (!rxText.trim() && !rxImageUrl) {
      onNotify(isAr ? 'اكتب اسم الدواء أو أرفق صورة للروشتة أولًا' : 'Enter medication details or attach Rx photo');
      return;
    }
    const zone = zones.find((z) => z.id === selectedZoneId);
    const noteText = rxText.trim()
      ? rxImageUrl
        ? `${rxText.trim()} (مرفق صورة روشتة)`
        : rxText.trim()
      : 'روشتة طبية مرفقة بالصورة';
    const res = await api.createOrder({
      customer_id: customerSession?.id,
      customer_name: customerName,
      customer_phone: customerPhone,
      merchant_id: pharmacyId,
      zone_id: selectedZoneId,
      zone_name: zone?.name_ar || 'وسط مدينة المنزلة',
      address_landmark: addressLandmark,
      order_channel: 'prescription',
      free_order_text: noteText,
      prescription_image_url: rxImageUrl || null,
      is_express: true,
      subtotal: 0,
      customer_lat: pickupLat,
      customer_lng: pickupLng,
      payment_method: checkoutPaymentMethod,
    });
    if (res.id) {
      setTrackedOrderId(res.id);
    }
    setRxText('');
    setRxImageUrl('');
    setRxImageName('');
    await Promise.all([loadBootstrap(true), onRefreshCore()]);
    onNotify(isAr ? `تم إرسال الروشتة #${res.order_number} للصيدلي — تابع حالة التجهيز الآن` : `Rx #${res.order_number} submitted`);
    setTab('profile');
  };

  const handleDetectMyGps = () => {
    if (!navigator.geolocation) {
      onNotify(isAr ? 'المتصفح لا يدعم GPS — اضغط على الخريطة لتحديد موقعك' : 'Geolocation unsupported');
      setMapPickTarget('pickup');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setPickupLat(lat);
        setPickupLng(lng);
        setPickupAddress(`موقعي الحالي (GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        api
          .updateCustomerLocation({
            customer_id: customerSession?.id,
            email: customerSession?.email,
            phone: customerPhone,
            full_name: customerName,
            lat,
            lng,
            address_landmark: addressLandmark,
            default_zone_id: selectedZoneId,
          })
          .catch(() => {});
        setLocatingGps(false);
        onNotify(isAr ? 'تم تحديد موقعك الحالي بالـ GPS بنجاح' : 'GPS location detected');
      },
      () => {
        setLocatingGps(false);
        setMapPickTarget('pickup');
        onNotify(
          isAr
            ? 'استخدم الخريطة للضغط على موقعك الحالي في المنزلة (تم ضبط المركز تلقائيًا)'
            : 'Tap the map to adjust your GPS pin'
        );
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handleSelectCaptain = (capId: string | null) => {
    setSelectedCaptainId(capId);
    if (capId) {
      const cap = nearbyCaptains.find((c) => c.id === capId);
      if (cap && (cap.vehicle_type === 'moto' || cap.vehicle_type === 'tuktuk' || cap.vehicle_type === 'car')) {
        setRideVehicle(cap.vehicle_type);
      }
    }
  };

  const handleBookRide = async () => {
    if (requireCustomerAccount('لحجز مشوار', 'book a ride')) return;
    if (!rideDropoff.trim() && rideDropoffLat === null) {
      onNotify(isAr ? 'اكتب مكان التوصيل أو حدده على الخريطة GPS أولًا' : 'Enter or pick destination');
      return;
    }
    const proposedFareNum = parseLocalizedNumber(customerProposedFare);
    if (!Number.isFinite(proposedFareNum) || proposedFareNum <= 0) {
      onNotify(isAr ? 'اكتب السعر الذي تقترحه للمشوار بالجنيه أولًا (مثال: 35)' : 'Enter your proposed ride fare');
      return;
    }
    try {
      const selectedCap = selectedCaptainId ? nearbyCaptains.find((c) => c.id === selectedCaptainId) : null;
      const res = await api.requestRide({
        customer_id: customerSession?.id,
        customer_name: customerName,
        customer_phone: customerPhone,
        vehicle_type: selectedCap?.vehicle_type || rideVehicle,
        pickup_address: pickupAddress.trim() || addressLandmark,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_address: rideDropoff.trim() || `نقطة على الخريطة (${rideDropoffLat?.toFixed(4)}, ${rideDropoffLng?.toFixed(4)})`,
        dropoff_lat: rideDropoffLat,
        dropoff_lng: rideDropoffLng,
        distance_km: rideDistanceKm,
        customer_proposed_fare: proposedFareNum,
        preferred_captain_id: selectedCaptainId,
      });
      setPendingTripId(res.id);
      await Promise.all([loadBootstrap(), onRefreshCore()]);
      onNotify(
        selectedCap
          ? isAr
            ? `تم إرسال طلب المشوار ${res.trip_number} (${proposedFareNum} ج.م) للطيار ${selectedCap.full_name} — سيفتح الشات فور قبوله`
            : `Ride ${res.trip_number} sent to ${selectedCap.full_name}`
          : isAr
          ? `تم إرسال طلب المشوار ${res.trip_number} (${proposedFareNum} ج.م) لجميع الطيارين — سيفتح الشات فور قبول طيار`
          : `Ride ${res.trip_number} sent to captains`
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleSubmitCaptainRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ratingTarget || submittingRating) return;
    setSubmittingRating(true);
    try {
      await api.submitRating({
        rating_id: ratingTarget.rating_id,
        captain_id: ratingTarget.captain_id,
        customer_name: customerName,
        customer_phone: customerPhone,
        ref_type: ratingTarget.ref_type,
        ref_id: ratingTarget.ref_id,
        ref_number: ratingTarget.ref_number,
        final_amount: ratingTarget.final_amount,
        rating: ratingStars,
        comment: ratingComment,
      });
      setRatingTarget(null);
      setRatingComment('');
      await Promise.all([loadBootstrap(), onRefreshCore()]);
      onNotify(isAr ? `تم إرسال تقييمك (${ratingStars}/5 ★) للكابتن ${ratingTarget.captain_name}` : 'Rating submitted');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleRequestParcel = async () => {
    if (requireCustomerAccount('لإرسال طرد', 'send a parcel')) return;
    try {
      const customFeeNum = parcelCustomFee.trim() ? parseLocalizedNumber(parcelCustomFee) : NaN;
      const res = await api.requestParcel({
        customer_id: customerSession?.id,
        sender_name: customerName,
        sender_phone: customerPhone,
        receiver_phone: parcelReceiverPhone,
        pickup_address: addressLandmark,
        dropoff_address: parcelDropoff,
        zone_id: selectedZoneId,
        item_category: parcelItemCat,
        size_tier: parcelSize,
        required_vehicle_type: parcelSize === 'large' ? 'tuktuk' : 'moto',
        prohibited_confirmed: prohibitedConfirmed,
        ...(Number.isFinite(customFeeNum) && customFeeNum > 0 ? { customer_proposed_fee: customFeeNum } : {}),
        ...(parcelCaptainId ? { preferred_captain_id: parcelCaptainId } : {}),
      });
      setLastParcelOtp({ num: res.delivery_number, otp: res.delivery_otp });
      await Promise.all([loadBootstrap(), onRefreshCore()]);
      onNotify(
        isAr
          ? `تم إنشاء شحنة ${res.delivery_number} (${res.delivery_fee} ج.م)${res.assigned_captain ? ` · الطيار: ${res.assigned_captain}` : ''} — رمز التسليم: ${res.delivery_otp}`
          : `Parcel ${res.delivery_number} created`
      );
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  const handleCreateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireCustomerAccount('لنشر إعلان في سوق اطلبها', 'post a listing')) return;
    if (!mktTitle.trim()) return;
    const zone = zones.find((z) => z.id === selectedZoneId);
    await api.createMarketListing({
      seller_name: customerName,
      seller_phone: customerPhone,
      category_ar: mktCategory,
      title: mktTitle,
      description: mktDesc || 'حالة ممتازة — المعاينة في المنزلة',
      condition: mktCondition,
      price: mktPrice,
      quantity: 1,
      zone_name: zone?.name_ar || 'وسط مدينة المنزلة',
      is_negotiable: true,
      image_url: mktImageUrl || '',
    });
    setMktTitle('');
    setMktDesc('');
    setMktImageUrl('');
    setMktImageName('');
    setMktCondition('used');
    await loadBootstrap();
    onNotify(isAr ? 'تم نشر إعلانك في سوق اطلبها فورًا' : 'Listing published');
  };

  const quickServiceTiles = [
    {
      key: 'stores',
      title: isAr ? 'المتاجر والمطاعم' : 'Stores',
      sub: isAr ? 'بقالة وأسماك ومطاعم' : 'Groceries & Food',
      icon: Store,
      boxClass: 'bg-orange-600 text-white',
      onClick: () => {
        setOrderChannel('catalog');
        openServiceView('stores');
      },
    },
    {
      key: 'pharmacy',
      title: isAr ? 'الصيدلية والروشتة' : 'Pharmacy',
      sub: isAr ? 'صرف ومراجعة صيدلي' : 'Rx & Care',
      icon: Pill,
      boxClass: 'bg-teal-600 text-white',
      onClick: () => openServiceView('pharmacy'),
    },
    {
      key: 'parcels',
      title: isAr ? 'اطلبها أي حاجة' : 'Parcels',
      sub: isAr ? 'توصيل طرد بـ OTP' : 'OTP Delivery',
      icon: Package,
      boxClass: 'bg-slate-900 text-white',
      onClick: () => openServiceView('rides_parcels'),
    },
    {
      key: 'rides',
      title: isAr ? 'اطلبها مشوار' : 'Rides',
      sub: isAr ? 'موتوسيكل / توك توك' : 'City Rides',
      icon: Car,
      boxClass: 'bg-amber-600 text-white',
      onClick: () => openServiceView('rides_parcels'),
    },
    {
      key: 'market',
      title: isAr ? 'سوق اطلبها' : 'Market',
      sub: isAr ? 'بيع وشراء محلي' : 'Local C2C',
      icon: ShoppingBag,
      boxClass: 'bg-indigo-600 text-white',
      onClick: () => openServiceView('market'),
    },
    {
      key: 'free_order',
      title: isAr ? 'طلب نصي حر' : 'Free Order',
      sub: isAr ? 'اكتب أو صوّر طلبك' : 'Text / Voice',
      icon: FileText,
      boxClass: 'bg-rose-600 text-white',
      onClick: () => {
        setOrderChannel('free_text');
        setTab('cart');
      },
    },
  ];

  const bottomNavItems: Array<{
    id: BottomTab | 'assistant';
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
    isCenterFeatured?: boolean;
  }> = [
    { id: 'home', label: isAr ? 'الرئيسية' : 'Home', icon: Home },
    { id: 'categories', label: isAr ? 'الأقسام' : 'Categories', icon: LayoutGrid },
    { id: 'assistant', label: isAr ? 'المساعد الذكي' : 'Assistant', icon: Sparkles, isCenterFeatured: true },
    { id: 'cart', label: isAr ? 'السلة' : 'Cart', icon: ShoppingCart, badge: cartTotalQty },
    { id: 'profile', label: isAr ? 'حسابي' : 'Account', icon: User },
  ];

  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const singleDeliveryFee = selectedZone ? 15 + selectedZone.remote_area_fee + (isExpress ? 10 : 0) : 15;
  const extraStoreCount = orderChannel === 'catalog' ? Math.max(0, cartGroups.length - 1) : 0;
  const deliveryFeeEstimate = singleDeliveryFee + extraStoreCount * 5;
  const effectiveSubtotal = orderChannel === 'catalog' ? cartSubtotal : 150;
  const finalTotalEstimate = Math.max(0, effectiveSubtotal + deliveryFeeEstimate - appliedDiscount);
  const activeCaptainOrders = orders.filter(
    (o) => Boolean(o.captain_id) && o.status !== 'delivered' && o.status !== 'cancelled'
  );
  const activeTrips = trips.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const liveTrackingCount = activeCaptainOrders.length + activeTrips.length;

  const handleServiceCircleClick = (key: string, action: () => void) => {
    if (stripDragRef.current.moved) return;
    setFlashingServiceKey(key);
    window.setTimeout(() => {
      setFlashingServiceKey(null);
      action();
    }, 240);
  };

  if (showAuthScreen || (!customerSession && !isGuest)) {
    return (
      <CustomerAuthPortal
        lang={lang}
        openedFromGuest={isGuest}
        onVerified={handleCustomerVerified}
        onContinueAsGuest={handleContinueAsGuest}
        onNotify={onNotify}
      />
    );
  }

  if (activeChatOrderId) {
    return (
      <OrderChatPage
        orderId={activeChatOrderId}
        senderRole="customer"
        senderName={customerName}
        lang={lang}
        onBack={() => setActiveChatOrderId(null)}
        onOrderUpdated={async () => {
          await Promise.all([loadBootstrap(), onRefreshCore()]);
        }}
        onNotify={onNotify}
      />
    );
  }

  if (activeChatTripId) {
    return (
      <TripChatPage
        tripId={activeChatTripId}
        senderRole="customer"
        senderName={customerName}
        lang={lang}
        onBack={() => setActiveChatTripId(null)}
        onTripUpdated={async () => {
          await Promise.all([loadBootstrap(), onRefreshCore()]);
        }}
        onNotify={onNotify}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-140px)]">
      {/* Main Scrollable Content Area */}
      <div className="flex-1 space-y-5 pb-32">
        {/* Top Brand Strip (Shown on secondary tabs; on Home tab the Hero Banner extends behind the floating overlay header) */}
        {tab !== 'home' && (
        <header className="sticky top-0 z-30 bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] text-white rounded-xl border-b-2 border-[#F5A623]/80 shadow-sm px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
              alt={isAr ? 'شعار اطلبها' : 'Otlobha Logo'}
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white object-contain p-0.5 shrink-0 ring-1 ring-amber-200/80 shadow-sm"
            />
            <div className="min-w-0">
              <p className="text-[11px] text-amber-200 font-semibold truncate">
                {isAr ? 'اطلبها – المنزلة' : 'Otlobha Customer'}
              </p>
              <h2 className="text-sm sm:text-base font-bold truncate leading-tight">
                {tab === 'categories' && (isAr ? 'الأقسام والتصنيفات' : 'Categories')}
                {tab === 'services' && (isAr ? 'جميع خدمات اطلبها' : 'Services')}
                {tab === 'offers' && (isAr ? 'العروض وكوبونات الخصم' : 'Offers & Coupons')}
                {tab === 'cart' && (isAr ? 'سلة المشتريات وإتمام الطلب' : 'Cart & Checkout')}
                {tab === 'profile' && (isAr ? 'حسابي وطلباتي' : 'My Account & Orders')}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowLiveTracking(!showLiveTracking);
                setShowInbox(false);
                setShowSideDrawer(false);
              }}
              aria-label={isAr ? 'تتبع GPS والشات المباشر مع الطيار' : 'GPS Tracking & Captain Chat'}
              title={isAr ? 'تتبع GPS والشات المباشر مع الطيار' : 'GPS Tracking & Captain Chat'}
              className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold min-h-[42px] whitespace-nowrap transition-colors border ${
                showLiveTracking
                  ? 'bg-white text-[#A92224] border-white'
                  : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
              }`}
            >
              <Navigation className={`w-4 h-4 ${showLiveTracking ? 'text-[#A92224]' : 'text-amber-200'}`} />
              <span className="hidden md:inline">{isAr ? 'تتبع وشات' : 'Track & Chat'}</span>
              {liveTrackingCount > 0 && (
                <span className="px-1.5 py-0.5 bg-emerald-400 text-slate-950 rounded-full text-[10px] font-extrabold tabular-nums">
                  {liveTrackingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={openInboxDrawer}
              aria-label={isAr ? 'الإشعارات' : 'Notifications'}
              className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold min-h-[42px] whitespace-nowrap transition-colors border ${
                showInbox
                  ? 'bg-white text-[#A92224] border-white'
                  : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
              }`}
            >
              <Bell className={`w-4 h-4 ${showInbox ? 'text-[#A92224]' : 'text-amber-200'}`} />
              <span className="hidden sm:inline">{isAr ? 'الإشعارات' : 'Inbox'}</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-[#F5A623] text-slate-950 rounded-full text-[10px] font-extrabold tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowSideDrawer(true);
                setShowInbox(false);
                setShowLiveTracking(false);
              }}
              aria-label={isAr ? 'القائمة الجانبية' : 'Side Menu'}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-semibold min-h-[42px] whitespace-nowrap transition-colors border ${
                showSideDrawer
                  ? 'bg-white text-[#A92224] border-white'
                  : 'bg-white/15 hover:bg-white/25 text-white border-white/20'
              }`}
            >
              <Menu className={`w-4 h-4 ${showSideDrawer ? 'text-[#A92224]' : 'text-amber-200'}`} />
              <span className="hidden sm:inline">{isAr ? 'القائمة' : 'Menu'}</span>
            </button>
          </div>
        </header>
        )}

        {/* Live Order Preparation & Captain Pickup Tracker Banner (Visible whenever customer has an active order) */}
        {(() => {
          const customerOrders = orders.filter(
            (o) =>
              o.id === trackedOrderId ||
              (customerSession?.id && (o as any).customer_id === customerSession.id) ||
              o.customer_name === customerName
          );
          const candidatePool = customerOrders.length > 0 ? customerOrders : orders;
          const activeOrder =
            (trackedOrderId ? candidatePool.find((o) => o.id === trackedOrderId) : null) ||
            candidatePool.find((o) =>
              ['pending_merchant', 'awaiting_quote', 'preparing', 'ready_for_pickup', 'on_the_way'].includes(o.status)
            );

          if (!activeOrder) return null;

          const stats = computeOrderStoreStats(activeOrder);
          const isPendingMerchant =
            activeOrder.status === 'pending_merchant' || activeOrder.status === 'awaiting_quote';
          const isPreparing = activeOrder.status === 'preparing';
          const isPrepared = activeOrder.status === 'ready_for_pickup';
          const isWithCaptain = activeOrder.status === 'on_the_way';
          const isDelivered = activeOrder.status === 'delivered';

          const stepIndex = isDelivered
            ? 4
            : isWithCaptain
            ? 3
            : isPrepared
            ? 2
            : isPreparing
            ? 1
            : 0;

          const activeItems = Array.isArray(activeOrder.items)
            ? activeOrder.items.filter((it) => it.status !== 'rejected')
            : [];

          return (
            <div className="bg-white border-2 border-orange-400 rounded-2xl p-4 shadow-md space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-orange-600 text-white font-black text-xs shadow-xs">
                    📦
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-900">
                        متابعة طلبك الحالي #{activeOrder.order_number}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-900">
                        {activeOrder.total_amount} ج.م
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 font-semibold">
                      المتجر: <span className="text-slate-900 font-bold">{activeOrder.merchant_name}</span>
                      {stats.isMultiStore ? ` (${stats.activeSections.length} متاجر)` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      loadBootstrap(true).catch(() => {});
                      onRefreshCore().catch(() => {});
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold"
                  >
                    تحديث الحالة ↻
                  </button>
                  {isDelivered && (
                    <button
                      type="button"
                      onClick={() => setTrackedOrderId(null)}
                      className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-700 text-[11px] font-bold"
                    >
                      إخفاء ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Explicit Answer: Has the order been prepared or not? */}
              <div
                className={`rounded-xl p-3 border flex flex-wrap items-center justify-between gap-3 ${
                  isWithCaptain
                    ? 'bg-teal-50 border-teal-300 text-teal-950'
                    : isPrepared
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : isPreparing
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : isDelivered
                    ? 'bg-slate-100 border-slate-300 text-slate-900'
                    : 'bg-orange-50 border-orange-300 text-orange-950'
                }`}
              >
                <div className="space-y-1">
                  <p className="text-[11px] font-bold opacity-80">حالة تجهيز الطلب في المتجر:</p>
                  <p className="text-xs sm:text-sm font-black">
                    {isPendingMerchant && '⏳ لم يتم تجهيز الطلب بعد — بانتظار استلام وموافقة المتجر'}
                    {isPreparing && '👨‍🍳 جاري تجهيز طلبك الآن داخل المتجر (لم يكتمل التجهيز بعد)'}
                    {isPrepared && '✅ تم تجهيز الطلب بالكامل في المتجر! وبانتظار استلام الطيار الآن'}
                    {isWithCaptain &&
                      `🏍️ تم التجهيز واستلمه الطيار (${activeOrder.captain_name || 'الكابتن'}) وهو في الطريق إليك الآن!`}
                    {isDelivered && '🎉 تم توصيل وتسليم الطلب بنجاح'}
                  </p>
                </div>

                {isWithCaptain && activeOrder.captain_id ? (
                  <button
                    type="button"
                    onClick={() => setActiveChatOrderId(activeOrder.id)}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-black shadow-sm animate-pulse"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>فتح الشات مع الطيار وتتبع الخريطة</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/80 border border-current/20">
                    💬 يفتح الشات تلقائيًا فور استلام الطيار للطلب
                  </span>
                )}
              </div>

              {/* 4-Step Visual Progress Bar */}
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold">
                {[
                  { idx: 0, label: '1. أُرسل للمتجر' },
                  { idx: 1, label: '2. جاري التجهيز' },
                  { idx: 2, label: '3. تم التجهيز ✓' },
                  { idx: 3, label: '4. مع الطيار (شات)' },
                ].map((st) => {
                  const done = stepIndex >= st.idx;
                  const current = stepIndex === st.idx;
                  return (
                    <div
                      key={st.idx}
                      className={`py-1.5 px-1 rounded-lg border transition-colors ${
                        current
                          ? 'bg-orange-600 text-white border-orange-700 font-black'
                          : done
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                    >
                      {st.label}
                    </div>
                  );
                })}
              </div>

              {/* Order Items & Multi-Store Preparation Breakdown */}
              {stats.isMultiStore ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {stats.sections.map((sec) => {
                    const picked = isSectionPickedUpByCaptain(sec, activeOrder.status);
                    const ready = isStorePrepared(sec.prep_status);
                    const preparing = sec.prep_status === 'preparing';
                    return (
                      <div
                        key={sec.id}
                        className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">{sec.merchant_name}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              picked
                                ? 'bg-teal-100 text-teal-800'
                                : ready
                                ? 'bg-emerald-100 text-emerald-800'
                                : preparing
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {picked
                              ? 'استلمه الطيار ✓'
                              : ready
                              ? 'تم التجهيز ✓'
                              : preparing
                              ? 'جاري التجهيز...'
                              : 'لم يتم التجهيز بعد'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">
                          {Array.isArray(sec.items) && sec.items.length > 0
                            ? sec.items.map((it) => `${it.name_ar} × ${it.quantity}`).join(' + ')
                            : sec.free_order_text || '-'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-slate-500">تفاصيل طلبك:</span>
                    <p className="font-bold text-slate-900">
                      {activeItems.length > 0
                        ? activeItems.map((it) => `${it.name_ar} × ${it.quantity}`).join(' + ')
                        : activeOrder.free_order_text || 'طلب متجر'}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600">
                    العنوان: {activeOrder.address_landmark}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Live GPS Tracking & Captain Chat Drawer (opened from top strip icon) */}
        {showLiveTracking && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-orange-600" />
                <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                  {isAr ? 'تتبع GPS والشات المباشر مع الطيار' : 'Live Captain GPS & Chat'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLiveTracking(false)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>

            {liveTrackingCount === 0 ? (
              <div className="bg-white border border-orange-100 rounded-xl p-4 text-center space-y-2.5">
                <p className="text-xs text-slate-600">
                  {isAr
                    ? 'لا توجد طلبات أو مشاوير نشطة مع طيارين حاليًا.'
                    : 'No active deliveries or rides with captains right now.'}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLiveTracking(false);
                      openServiceView('rides_parcels');
                    }}
                    className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold"
                  >
                    {isAr ? 'اطلب مشوار الآن' : 'Book a Ride'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLiveTracking(false);
                      setTab('profile');
                    }}
                    className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-bold"
                  >
                    {isAr ? 'سجل طلباتي' : 'Order History'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {activeCaptainOrders.map((o) => (
                  <div
                    key={o.id}
                    className="bg-white border border-orange-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 text-xs">
                      <p className="font-bold text-slate-900">
                        <span className="font-mono-num">{o.order_number}</span> · {o.merchant_name}
                      </p>
                      <p className="text-slate-600">
                        {isAr ? 'الطيار:' : 'Captain:'} <strong>{o.captain_name}</strong> ·{' '}
                        <span className="text-teal-700 font-semibold">{o.status}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLiveTracking(false);
                        setActiveChatOrderId(o.id);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold min-h-[40px] whitespace-nowrap"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>
                        {isAr ? 'الشات وتتبع GPS' : 'Chat & GPS'} ({o.chat_count ?? 0})
                      </span>
                    </button>
                  </div>
                ))}
                {activeTrips.map((t) => (
                  <div
                    key={t.id}
                    className="bg-white border border-teal-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 text-xs">
                      <p className="font-bold text-slate-900">
                        <span className="font-mono-num">{t.trip_number}</span> · مشوار إلى {t.dropoff_address}
                      </p>
                      <p className="text-slate-600">
                        {t.captain_name ? (
                          <>
                            الطيار: <strong>{t.captain_name}</strong> ·{' '}
                          </>
                        ) : t.preferred_captain_name ? (
                          <>
                            مرسل للطيار: <strong>{t.preferred_captain_name}</strong> ·{' '}
                          </>
                        ) : (
                          'بانتظار قبول طيار... · '
                        )}
                        <span className="text-teal-700 font-semibold">
                          {t.final_fare ?? t.customer_proposed_fare ?? t.estimated_fare} ج.م
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowLiveTracking(false);
                          setActiveChatTripId(t.id);
                        }}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold min-h-[40px] whitespace-nowrap"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>{t.captain_id ? 'فتح الشات وتتبع الطيار' : 'تعديل السعر / الطيار'}</span>
                      </button>
                      {!t.captain_id && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.cancelTrip(t.id, { actor_role: 'customer', actor_name: customerName });
                            await Promise.all([loadBootstrap(), onRefreshCore()]);
                            onNotify('تم إلغاء طلب المشوار وإزالته من النظام');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg text-[11px] font-bold"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>إلغاء الطلب</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Side Navigation Drawer (Services + Support + Settings) */}
        {showSideDrawer && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
              onClick={() => setShowSideDrawer(false)}
            />
            <aside className="relative z-10 w-full max-w-sm bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
              <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] text-white p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src="/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg"
                    alt="Otlobha"
                    className="w-10 h-10 rounded-xl bg-white object-contain p-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">
                      {customerSession ? customerName : isAr ? 'زائر اطلبها' : 'Guest'}
                    </p>
                    <p className="text-[11px] text-amber-200 truncate" dir={customerSession ? 'ltr' : 'rtl'}>
                      {customerSession
                        ? customerPhone || customerSession.email
                        : isAr
                        ? 'تصفح كزائر · سجّل لإتمام الطلبات'
                        : 'Guest browsing mode'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSideDrawer(false)}
                  aria-label={isAr ? 'إغلاق القائمة' : 'Close menu'}
                  className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-5 flex-1">
                {/* 1. Services inside Side Drawer */}
                <div className="space-y-2">
                  <p className="text-xs font-extrabold text-slate-500 px-1">
                    {isAr ? 'الخدمات والأقسام' : 'Services'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSideDrawer(false);
                        setServiceView('hub');
                        setTab('services');
                      }}
                      className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 hover:bg-orange-50 border border-slate-200 hover:border-orange-300 text-xs font-bold text-slate-800"
                    >
                      <LayoutGrid className="w-4 h-4 text-[#A92224] shrink-0" />
                      <span className="truncate">{isAr ? 'كل الخدمات' : 'All Services'}</span>
                    </button>
                    {quickServiceTiles.map((tile) => {
                      const Icon = tile.icon;
                      return (
                        <button
                          key={tile.key}
                          type="button"
                          onClick={() => {
                            setShowSideDrawer(false);
                            tile.onClick();
                          }}
                          className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 hover:bg-orange-50 border border-slate-200 hover:border-orange-300 text-xs font-bold text-slate-800"
                        >
                          <Icon className="w-4 h-4 text-orange-600 shrink-0" />
                          <span className="truncate">{tile.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Support & Admin Communication */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <p className="text-xs font-extrabold text-slate-500 px-1">
                    {isAr ? 'الدعم والمساعدة' : 'Support & Help'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSideDrawer(false);
                      setShowSupportModal(true);
                      loadCustomerSupportTickets(true);
                    }}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-[#A92224] text-xs font-bold transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Headphones className="w-4 h-4 shrink-0" />
                      <span>{isAr ? 'تواصل مع الدعم والإدارة' : 'Contact Support & Admin'}</span>
                    </div>
                    {supportTickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-[#A92224] text-white text-[10px] font-extrabold tabular-nums">
                        {supportTickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length}
                      </span>
                    )}
                  </button>
                </div>

                {/* 3. Settings & Account */}
                <div className="space-y-3 pt-3 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-700 font-extrabold px-1">
                    <Settings className="w-3.5 h-3.5 text-[#A92224]" />
                    <span>{isAr ? 'الإعدادات والحساب' : 'Settings & Account'}</span>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {isAr ? 'منطقة التوصيل في المنزلة' : 'Delivery Zone'}
                    </label>
                    <select
                      value={selectedZoneId}
                      onChange={(e) => setSelectedZoneId(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                    >
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name_ar} (+{z.remote_area_fee} ج.م)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {isAr ? 'العنوان التفصيلي للتوصيل' : 'Delivery Landmark'}
                    </label>
                    <input
                      type="text"
                      value={addressLandmark}
                      onChange={(e) => setAddressLandmark(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSideDrawer(false);
                        setTab('profile');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>{isAr ? 'حسابي وطلباتي' : 'My Profile'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        loadBootstrap();
                        onNotify(isAr ? 'تم تحديث بيانات التطبيق' : 'App data refreshed');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isAr ? 'تحديث البيانات' : 'Refresh'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSideDrawer(false);
                      if (customerSession) {
                        handleCustomerLogout();
                      } else {
                        openAuthFromGuest();
                      }
                    }}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold ${
                      customerSession
                        ? 'bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700'
                        : 'bg-[#A92224] hover:bg-[#8E1B1D] text-white'
                    }`}
                  >
                    {customerSession ? <LogOut className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
                    <span>
                      {customerSession
                        ? isAr
                          ? 'تسجيل الخروج'
                          : 'Sign Out'
                        : isAr
                        ? 'تسجيل الدخول أو إنشاء حساب'
                        : 'Sign In or Sign Up'}
                    </span>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Customer <-> Admin Support Modal */}
        {showSupportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
              <div className="bg-gradient-to-l from-[#9E1C1E] via-[#B52325] to-[#C8431D] text-white px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Headphones className="w-5 h-5 text-amber-200" />
                  <div>
                    <h3 className="text-sm font-bold">{isAr ? 'تواصل مع الدعم وإدارة اطلبها' : 'Contact Support & Admin'}</h3>
                    <p className="text-[11px] text-amber-100">
                      {isAr ? 'أرسل استفسارك أو مشكلتك وتابع ردود الإدارة مباشرة' : 'Send an inquiry and track admin replies'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                {/* New Ticket Form */}
                <form onSubmit={handleCreateSupportTicket} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <p className="text-xs font-bold text-slate-900">
                    {isAr ? 'فتح محادثة / تذكرة جديدة مع الإدارة' : 'Start a new support conversation'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newTicketSubject}
                      onChange={(e) => setNewTicketSubject(e.target.value)}
                      placeholder={isAr ? 'عنوان الرسالة (مثال: تعديل طلب)' : 'Subject'}
                      className="sm:col-span-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                    <select
                      value={newTicketCategory}
                      onChange={(e) => setNewTicketCategory(e.target.value)}
                      className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    >
                      <option value="general">{isAr ? 'استفسار عام' : 'General'}</option>
                      <option value="order_support">{isAr ? 'مشكلة في طلب' : 'Order Issue'}</option>
                      <option value="ride_support">{isAr ? 'مشكلة في مشوار' : 'Ride Issue'}</option>
                      <option value="suggestion">{isAr ? 'اقتراح أو شكوى' : 'Feedback'}</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTicketMessage}
                      onChange={(e) => setNewTicketMessage(e.target.value)}
                      placeholder={isAr ? 'اكتب تفاصيل رسالتك لإدارة اطلبها...' : 'Write message details...'}
                      className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                    <button
                      type="submit"
                      disabled={sendingSupport || (!newTicketSubject.trim() && !newTicketMessage.trim())}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#A92224] hover:bg-[#8E1B1D] disabled:bg-slate-300 text-white rounded-lg text-xs font-bold whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isAr ? 'إرسال للإدارة' : 'Send'}</span>
                    </button>
                  </div>
                </form>

                {/* Existing Tickets & Thread */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {loadingSupport && supportTickets.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4 text-center">{isAr ? 'جاري التحميل...' : 'Loading...'}</p>
                    ) : supportTickets.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4 text-center">
                        {isAr ? 'لم ترسل أي رسائل دعم بعد' : 'No tickets yet'}
                      </p>
                    ) : (
                      supportTickets.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectSupportTicket(t.id)}
                          className={`w-full text-start p-2.5 text-xs ${
                            t.id === activeSupportTicketId ? 'bg-orange-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono-num font-bold text-[10px] text-slate-500">{t.ticket_number}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">
                              {t.status === 'open'
                                ? isAr ? 'مفتوح' : 'Open'
                                : t.status === 'in_progress'
                                ? isAr ? 'متابعة الإدارة' : 'In Progress'
                                : isAr ? 'تم الحل' : 'Resolved'}
                            </span>
                          </div>
                          <p className="font-bold text-slate-900 mt-0.5 line-clamp-1">{t.subject}</p>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="sm:col-span-7 border border-slate-200 rounded-xl p-3 flex flex-col justify-between bg-slate-50/50 min-h-[240px]">
                    {!activeSupportTicketId ? (
                      <p className="text-xs text-slate-400 m-auto">
                        {isAr ? 'اختر تذكرة لعرض المحادثة' : 'Select a ticket'}
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2 max-h-48 overflow-y-auto py-1">
                          {supportMessages.map((m) => {
                            const isAdmin = m.sender_role === 'admin';
                            return (
                              <div key={m.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                                <div
                                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                                    isAdmin
                                      ? 'bg-slate-900 text-white'
                                      : 'bg-orange-100 text-slate-900 border border-orange-200'
                                  }`}
                                >
                                  <p className="text-[10px] font-bold opacity-75 mb-0.5">{m.sender_name}</p>
                                  <p>{m.message_text}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <form onSubmit={handleSendSupportReply} className="pt-2 border-t border-slate-200 flex gap-2 mt-2">
                          <input
                            type="text"
                            value={supportReplyText}
                            onChange={(e) => setSupportReplyText(e.target.value)}
                            placeholder={isAr ? 'أضف ردًا أو توضيحًا...' : 'Reply...'}
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                          />
                          <button
                            type="submit"
                            disabled={sendingSupport || !supportReplyText.trim()}
                            className="px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold"
                          >
                            {isAr ? 'إرسال' : 'Send'}
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notifications Drawer */}
        {showInbox && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {isAr ? 'صندوق إشعارات التطبيق الرئيسي' : 'Customer Notifications'}
              </h3>
              <button type="button" onClick={() => setShowInbox(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">{isAr ? 'لا توجد إشعارات حاليًا' : 'No notifications'}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.map((n) => {
                  const dl = String(n.deep_link || '').trim();
                  const isExternalUrl = dl.toLowerCase().startsWith('url:');
                  const externalHref = isExternalUrl ? dl.slice(4).trim() : '';
                  const hasAction = Boolean(dl && dl.toLowerCase() !== 'notifications');
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!isExternalUrl && hasAction) handleNotificationClick(n);
                      }}
                      className={`py-3 flex flex-wrap items-start justify-between gap-3 ${
                        hasAction && !isExternalUrl ? 'cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors' : ''
                      }`}
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{n.title_ar}</span>
                          {!n.is_read && <span className="text-xs font-semibold text-orange-600">{isAr ? 'جديد' : 'New'}</span>}
                        </div>
                        <p className="text-xs text-slate-600">{n.body_ar}</p>
                        <p className="text-xs font-mono-num text-slate-400">{n.created_at}</p>
                      </div>
                      {isExternalUrl && externalHref ? (
                        <a
                          href={externalHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (!n.is_read) void handleMarkRead(n.id);
                          }}
                          className="px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 rounded-lg text-xs font-semibold whitespace-nowrap"
                        >
                          {isAr ? 'فتح الرابط' : 'Open Link'}
                        </a>
                      ) : hasAction ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNotificationClick(n);
                          }}
                          className="px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 rounded-lg text-xs font-semibold whitespace-nowrap"
                        >
                          {isAr ? 'الانتقال للصفحة' : 'Open'}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 1. HOME TAB — Flagship Otlobha Storefront */}
        {tab === 'home' && (
          <div className="space-y-4">
            {/* Pending Ratings Prompt + Inline Rating Box (Preserved) */}
            {(ratingTarget || pendingRatings.length > 0) && (
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                    <h3 className="text-xs sm:text-sm font-bold text-amber-950">
                      {isAr ? 'تقييم الطيار بعد انتهاء الخدمة' : 'Rate Your Captain'}
                    </h3>
                  </div>
                </div>

                {ratingTarget ? (
                  <form onSubmit={handleSubmitCaptainRating} className="bg-white border border-amber-200 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        الكابتن: {ratingTarget.captain_name} ({ratingTarget.ref_number})
                      </span>
                      <button
                        type="button"
                        onClick={() => setRatingTarget(null)}
                        className="text-slate-500 hover:text-slate-800"
                      >
                        إغلاق
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setRatingStars(s)}
                          className="p-1.5 rounded-lg hover:bg-amber-50"
                        >
                          <Star className={`w-6 h-6 ${s <= ratingStars ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`} />
                        </button>
                      ))}
                      <span className="text-xs font-bold text-amber-700 ms-2">{ratingStars} / 5</span>
                    </div>
                    <input
                      type="text"
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="أضف تعليقًا عن الخدمة (اختياري)..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                    <button
                      type="submit"
                      disabled={submittingRating}
                      className="px-4 py-2 bg-[#A92224] hover:bg-[#86191B] disabled:opacity-60 text-white rounded-xl text-xs font-bold"
                    >
                      {submittingRating ? 'جاري الإرسال...' : 'إرسال التقييم الآن'}
                    </button>
                  </form>
                ) : (
                  <div className="space-y-2">
                    {pendingRatings.slice(0, 3).map((pr) => (
                      <div
                        key={pr.id}
                        className="bg-white border border-amber-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            قيّم الكابتن {pr.captain_name} · <span className="font-mono-num">{pr.ref_number}</span>
                          </p>
                          <p className="text-slate-500">القيمة: {pr.final_amount} ج.م</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRatingTarget({
                              rating_id: pr.id,
                              captain_id: pr.captain_id,
                              captain_name: pr.captain_name,
                              ref_type: pr.ref_type,
                              ref_id: pr.ref_id,
                              ref_number: pr.ref_number,
                              final_amount: pr.final_amount,
                            });
                            setRatingStars(5);
                            setRatingComment('');
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F5A623] hover:bg-[#D97706] text-white rounded-xl text-xs font-bold"
                        >
                          <Star className="w-3.5 h-3.5 fill-white" />
                          <span>قيّم الطيار الآن</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <OtlobhaStorefrontHome
              zones={zones}
              selectedZoneId={selectedZoneId}
              onChangeZone={setSelectedZoneId}
              merchants={merchants}
              banners={storefrontBanners}
              categories={storefrontCategories}
              products={storefrontProducts}
              brands={storefrontBrands}
              loading={storefrontLoading}
              hasMore={storefrontHasMore}
              activeFilter={storefrontFilter}
              selectedCategoryId={storefrontCategoryId}
              selectedBrand={storefrontBrand}
              selectedMerchantId={storefrontMerchantId}
              cartQtyMap={cart}
              unreadNotifCount={unreadCount}
              liveTrackingCount={liveTrackingCount}
              onOpenLiveTracking={() => {
                setShowLiveTracking(!showLiveTracking);
                setShowInbox(false);
                setShowSideDrawer(false);
              }}
              onOpenMenu={() => {
                setShowSideDrawer(true);
                setShowInbox(false);
                setShowLiveTracking(false);
              }}
              onChangeFilter={(f) => setStorefrontFilter(f)}
              onSelectCategory={(catId) => setStorefrontCategoryId(catId)}
              onSelectBrand={(brand) => setStorefrontBrand(brand)}
              onSelectMerchant={(mid) => setStorefrontMerchantId(mid)}
              onClearAllFilters={() => {
                setStorefrontFilter('for_you');
                setStorefrontCategoryId('');
                setStorefrontBrand('');
                setStorefrontMerchantId('');
              }}
              onLoadMore={() => {
                void loadStorefrontData({
                  page: storefrontPage + 1,
                  append: true,
                });
              }}
              onOpenSearch={() => setSearchOverlayOpen(true)}
              onOpenProduct={(pid) => {
                setDetailFromStorefrontHome(true);
                setDetailProductList(storefrontProducts);
                setDetailProductId(pid);
              }}
              onOpenNotifications={() => {
                setShowInbox(true);
                setShowSideDrawer(false);
                setShowLiveTracking(false);
              }}
              onOpenService={handleOpenOtlobhaService}
              onAddProduct={handleAddStorefrontCard}
              onDecrementProduct={handleDecrementStorefrontProduct}
            />
          </div>
        )}

        {/* 1B. CATEGORIES TAB — Visual Square Root Categories + Inline Horizontal Subcategories & Products */}
        {tab === 'categories' && (
          <OtlobhaCategoriesView
            categories={storefrontCategories}
            zoneName={zones.find((z) => z.id === selectedZoneId)?.name_ar || 'المنزلة - الدقهلية'}
            cartQtyMap={cart}
            onOpenSearch={() => setSearchOverlayOpen(true)}
            onOpenProduct={(pid, list) => {
              setDetailFromStorefrontHome(false);
              setDetailProductList(list);
              setDetailProductId(pid);
            }}
            onAddProduct={handleAddStorefrontCard}
            onDecrementProduct={handleDecrementStorefrontProduct}
            onSelectGroup={(groupKey) => {
              setStorefrontCategoryId('');
              setStorefrontBrand('');
              setStorefrontMerchantId('');
              if (groupKey === 'fresh') setStorefrontFilter('fresh');
              else if (groupKey === 'groceries') setStorefrontFilter('groceries');
              else setStorefrontFilter('for_you');
              setTab('home');
            }}
          />
        )}

        {/* 2. SERVICES TAB (Hub + Inline Sub-Views for Stores, Pharmacy, Rides/Parcels, Market) */}
        {tab === 'services' && (
          <div className="space-y-5">
            {serviceView === 'hub' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {quickServiceTiles.map((tile) => {
                  const Icon = tile.icon;
                  const cfg = serviceMap[tile.key];
                  const enabled = cfg ? cfg.is_enabled : true;
                  return (
                    <button
                      key={tile.key}
                      type="button"
                      onClick={tile.onClick}
                      className="bg-white border border-slate-200 hover:border-orange-500 rounded-2xl p-5 text-start flex items-start gap-4 transition-all"
                    >
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${enabled ? tile.boxClass : 'bg-slate-400 text-white'}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-bold text-slate-900">{tile.title}</h4>
                          {!enabled && <span className="text-[11px] font-bold text-rose-700">موقوفة</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{tile.sub}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {serviceView === 'stores' && (
              <div className="space-y-4">
                {/* Circular Merchants Strip */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {isAr ? 'متاجر اطلبها في المنزلة' : 'Otlobha Stores'}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        {isAr ? 'اسحب لعرض المتاجر واضغط على أي متجر لتصفح أقسامه وعروضه' : 'Swipe stores & tap to browse sections'}
                      </p>
                    </div>
                    {cartTotalQty > 0 && (
                      <button
                        type="button"
                        onClick={() => setTab('cart')}
                        className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold min-h-[40px] whitespace-nowrap"
                      >
                        الذهاب للسلة ({cartTotalQty} · {cartSubtotal} ج.م)
                      </button>
                    )}
                  </div>

                  <div
                    ref={merchantsStripRef}
                    onPointerDown={(e) => {
                      const el = merchantsStripRef.current;
                      if (!el) return;
                      merchantsDragRef.current = {
                        isDown: true,
                        startX: e.clientX,
                        scrollLeft: el.scrollLeft,
                        moved: false,
                      };
                    }}
                    onPointerMove={(e) => {
                      const el = merchantsStripRef.current;
                      if (!el || !merchantsDragRef.current.isDown) return;
                      const dx = e.clientX - merchantsDragRef.current.startX;
                      if (Math.abs(dx) > 6) merchantsDragRef.current.moved = true;
                      el.scrollLeft = merchantsDragRef.current.scrollLeft - dx;
                    }}
                    onPointerUp={() => {
                      window.setTimeout(() => {
                        merchantsDragRef.current.isDown = false;
                        merchantsDragRef.current.moved = false;
                      }, 40);
                    }}
                    onPointerLeave={() => {
                      merchantsDragRef.current.isDown = false;
                    }}
                    className="flex items-start gap-4 overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing select-none py-1.5 px-1"
                  >
                    {merchants
                      .filter((m) => m.merchant_type !== 'pharmacy')
                      .map((m) => {
                        const isSelected = selectedMerchantId === m.id;
                        const isFlashing = flashingMerchantId === m.id;
                        return (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => {
                              if (merchantsDragRef.current.moved) return;
                              setFlashingMerchantId(m.id);
                              window.setTimeout(() => {
                                setFlashingMerchantId((cur) => (cur === m.id ? null : cur));
                              }, 520);
                              setSelectedMerchantId(m.id);
                              setSelectedStoreSectionId('all');
                              window.setTimeout(() => {
                                storeHeaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }, 50);
                            }}
                            className="group shrink-0 w-[84px] sm:w-[92px] flex flex-col items-center gap-2 focus:outline-none"
                          >
                            <div
                              className={`relative w-16 h-16 sm:w-[68px] sm:h-[68px] rounded-full flex items-center justify-center shadow-md transition-transform duration-200 overflow-hidden group-hover:scale-105 ${
                                isSelected
                                  ? 'ring-3 ring-orange-600 ring-offset-2'
                                  : 'ring-2 ring-slate-200'
                              } ${isFlashing ? 'animate-otlobha-flash-pulse ring-[#F5A623]' : ''}`}
                            >
                              {m.image_url ? (
                                <img
                                  src={m.image_url}
                                  alt={m.business_name_ar}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover pointer-events-none"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center">
                                  <Store className="w-7 h-7 drop-shadow-sm" />
                                </div>
                              )}
                              <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-black/10 via-transparent to-white/25" />
                              {isFlashing && (
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute -inset-y-4 w-8 bg-gradient-to-r from-transparent via-white/95 to-transparent blur-[1px] animate-otlobha-flash-sweep z-20"
                                />
                              )}
                            </div>
                            <span
                              className={`text-[11px] sm:text-xs font-bold text-center leading-tight line-clamp-2 ${
                                isSelected ? 'text-orange-700' : 'text-slate-800 group-hover:text-orange-600'
                              }`}
                            >
                              {m.business_name_ar}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
                {/* Selected Store Header + Horizontal Circular Sections Strip */}
                {selectedStoreMerchant && (
                  <div ref={storeHeaderRef} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        {selectedStoreMerchant.image_url ? (
                          <img
                            src={selectedStoreMerchant.image_url}
                            alt={selectedStoreMerchant.business_name_ar}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-full object-cover border border-orange-300 shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                            <Store className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">
                            {selectedStoreMerchant.business_name_ar}
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {selectedStoreMerchant.branch_name} · {selectedStoreMerchant.zone_name}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
                        {selectedStoreMerchant.is_open_now ? (isAr ? 'مفتوح الآن' : 'Open') : isAr ? 'مغلق' : 'Closed'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">
                          {isAr ? 'أقسام المتجر' : 'Store Sections'}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {isAr ? 'اسحب أفقيًا للتنقل بين الأقسام' : 'Swipe sections'}
                        </span>
                      </div>

                      <div
                        ref={sectionsStripRef}
                        onPointerDown={(e) => {
                          const el = sectionsStripRef.current;
                          if (!el) return;
                          sectionsDragRef.current = {
                            isDown: true,
                            startX: e.clientX,
                            scrollLeft: el.scrollLeft,
                            moved: false,
                          };
                        }}
                        onPointerMove={(e) => {
                          const el = sectionsStripRef.current;
                          if (!el || !sectionsDragRef.current.isDown) return;
                          const dx = e.clientX - sectionsDragRef.current.startX;
                          if (Math.abs(dx) > 6) sectionsDragRef.current.moved = true;
                          el.scrollLeft = sectionsDragRef.current.scrollLeft - dx;
                        }}
                        onPointerUp={() => {
                          window.setTimeout(() => {
                            sectionsDragRef.current.isDown = false;
                            sectionsDragRef.current.moved = false;
                          }, 40);
                        }}
                        onPointerLeave={() => {
                          sectionsDragRef.current.isDown = false;
                        }}
                        className="flex items-start gap-3.5 overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing select-none py-1.5 px-1"
                      >
                        {storeSectionsForMerchant.map((sec) => {
                          const isSecSelected = selectedStoreSectionId === sec.id;
                          const isFlashing = flashingSectionId === sec.id;
                          return (
                            <button
                              type="button"
                              key={sec.id}
                              onClick={() => {
                                if (sectionsDragRef.current.moved) return;
                                setFlashingSectionId(sec.id);
                                window.setTimeout(() => {
                                  setFlashingSectionId((cur) => (cur === sec.id ? null : cur));
                                }, 520);
                                setSelectedStoreSectionId(sec.id);
                              }}
                              className="group shrink-0 w-[76px] sm:w-[82px] flex flex-col items-center gap-1.5 focus:outline-none"
                            >
                              <div
                                className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-sm transition-transform duration-200 overflow-hidden group-hover:scale-105 ${
                                  isSecSelected
                                    ? 'ring-3 ring-orange-600 ring-offset-2'
                                    : 'ring-2 ring-slate-200'
                                } ${isFlashing ? 'animate-otlobha-flash-pulse ring-[#F5A623]' : ''}`}
                              >
                                {sec.image_url ? (
                                  <img
                                    src={sec.image_url}
                                    alt={sec.name_ar}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover pointer-events-none"
                                  />
                                ) : sec.kind === 'offers' ? (
                                  <div className="w-full h-full bg-gradient-to-br from-rose-600 to-orange-500 text-white flex items-center justify-center">
                                    <Percent className="w-6 h-6 drop-shadow-sm" />
                                  </div>
                                ) : sec.kind === 'all' ? (
                                  <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-600 text-white flex items-center justify-center">
                                    <LayoutGrid className="w-6 h-6 drop-shadow-sm" />
                                  </div>
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-teal-600 to-emerald-500 text-white flex items-center justify-center">
                                    <Tag className="w-5 h-5 drop-shadow-sm" />
                                  </div>
                                )}
                                <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-black/10 via-transparent to-white/25" />
                                {isFlashing && (
                                  <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute -inset-y-4 w-8 bg-gradient-to-r from-transparent via-white/95 to-transparent blur-[1px] animate-otlobha-flash-sweep z-20"
                                  />
                                )}
                              </div>
                              <span
                                className={`text-[11px] font-bold text-center leading-tight line-clamp-2 ${
                                  isSecSelected
                                    ? sec.kind === 'offers'
                                      ? 'text-rose-700'
                                      : 'text-orange-700'
                                    : 'text-slate-700 group-hover:text-orange-600'
                                }`}
                              >
                                {isAr ? sec.name_ar : sec.name_en}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {filteredStoreProducts.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                    {isAr ? 'لا توجد منتجات مضافة في هذا القسم حاليًا.' : 'No products in this section yet.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredStoreProducts.map((p) => {
                      const qty = cart[p.id] || 0;
                      const price = p.sale_price ?? p.base_price;
                      const hasOfferBadge = isProductInOffers(p);
                      return (
                        <div key={p.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between">
                          {p.image_url && (
                            <div
                              onClick={() => {
                                setDetailFromStorefrontHome(false);
                                setDetailProductList(filteredStoreProducts);
                                setDetailProductId(p.id);
                              }}
                              className="h-32 bg-slate-100 relative overflow-hidden cursor-pointer"
                            >
                              <img
                                src={p.image_url}
                                alt={p.name_ar}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                              {hasOfferBadge && (
                                <span className="absolute top-2 start-2 px-2 py-0.5 bg-rose-600 text-white text-[10px] font-bold rounded">
                                  {isAr ? 'في العروض' : 'Offer'}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                            <div
                              onClick={() => {
                                setDetailFromStorefrontHome(false);
                                setDetailProductList(filteredStoreProducts);
                                setDetailProductId(p.id);
                              }}
                              className="cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-slate-500">{p.category_name}</p>
                                {!p.image_url && hasOfferBadge && (
                                  <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold rounded">
                                    {isAr ? 'في العروض' : 'Offer'}
                                  </span>
                                )}
                              </div>
                              <h4 className="text-sm font-bold text-slate-900 mt-0.5 hover:text-[#A92224] transition-colors">{p.name_ar}</h4>
                              <p className="text-xs text-slate-600 mt-1">{p.description}</p>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                              <div className="tabular-nums">
                                <span className="text-base font-bold text-slate-900">{price} ج.م</span>
                                {p.sale_price !== null && p.sale_price < p.base_price && (
                                  <span className="text-xs text-slate-400 line-through ms-2">{p.base_price}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {qty > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleAddToCart(p, -1)}
                                      className="w-9 h-9 border border-slate-200 rounded-lg font-bold"
                                    >
                                      -
                                    </button>
                                    <span className="text-sm font-bold tabular-nums w-5 text-center">{qty}</span>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleAddToCart(p, 1)}
                                  className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold min-h-[40px]"
                                >
                                  {qty > 0 ? '+' : 'إضافة للسلة'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {serviceView === 'pharmacy' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-4">
                {!serviceMap.pharmacy?.is_enabled ? (
                  <p className="text-sm font-semibold text-rose-700">{serviceMap.pharmacy?.maintenance_msg_ar || 'الخدمة متوقفة حاليًا'}</p>
                ) : (
                  <>
                    <h3 className="text-base font-bold text-slate-900">طلب دواء أو روشتة من صيدلية مرخصة</h3>
                    <p className="text-xs text-slate-600">
                      تعمل المنصة كوسيط تقني فقط؛ يراجع الصيدلي المرخص الروشتة ويحدد السعر والبدائل قبل الصرف.
                    </p>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">اختر الصيدلية</label>
                      <select
                        value={pharmacyId}
                        onChange={(e) => setPharmacyId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs bg-white"
                      >
                        {merchants
                          .filter((m) => m.merchant_type === 'pharmacy')
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.business_name_ar} — ترخيص {p.pharmacy_license_no}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">صورة الروشتة (اختياري أو مع ملاحظات)</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-teal-400 bg-teal-50/50 hover:bg-teal-50 text-teal-800 rounded-xl text-xs font-semibold cursor-pointer min-h-[46px]">
                          <Camera className="w-4 h-4 shrink-0" />
                          <span>{isAr ? 'تصوير الروشتة بالكاميرا' : 'Take Rx Photo'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleRxImagePick}
                            className="hidden"
                          />
                        </label>
                        <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer min-h-[46px]">
                          <ImagePlus className="w-4 h-4 shrink-0 text-teal-600" />
                          <span>{isAr ? 'اختيار صورة من الجهاز' : 'Upload from Gallery'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleRxImagePick}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {rxImageUrl && (
                        <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={rxImageUrl}
                              alt="صورة الروشتة المرفقة"
                              referrerPolicy="no-referrer"
                              className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-teal-700">{isAr ? 'تم إرفاق صورة الروشتة بنجاح' : 'Prescription photo attached'}</p>
                              <p className="text-[11px] text-slate-500 truncate">{rxImageName || 'rx-photo.jpg'}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setRxImageUrl('');
                              setRxImageName('');
                            }}
                            className="flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{isAr ? 'حذف' : 'Remove'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">تفاصيل الروشتة أو اسم الدواء</label>
                      <textarea
                        rows={4}
                        value={rxText}
                        onChange={(e) => setRxText(e.target.value)}
                        placeholder="مثال: روشتة عظام + بانادول إكسترا + مسكن موضعي..."
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
                      />
                    </div>

                    {/* Pharmacy Delivery GPS & Payment Method */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-teal-600" />
                          <span>{isAr ? 'موقع توصيل الروشتة (GPS):' : 'Rx Delivery GPS:'}</span>
                        </span>
                        <span className="font-mono-num text-[11px] text-teal-800 font-semibold" dir="ltr">
                          {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={addressLandmark}
                        onChange={(e) => setAddressLandmark(e.target.value)}
                        placeholder="العلامة المميزة أو العنوان لتسليم العلاج"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                      <div className="pt-1 border-t border-slate-200 flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-700">{isAr ? 'طريقة السداد:' : 'Payment:'}</span>
                        {paymentSettings?.cod_enabled !== false && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="rx_payment"
                              value="cash"
                              checked={checkoutPaymentMethod === 'cash'}
                              onChange={() => setCheckoutPaymentMethod('cash')}
                            />
                            <span>{isAr ? 'كاش عند الاستلام' : 'Cash'}</span>
                          </label>
                        )}
                        {paymentSettings?.network_pos_enabled !== false && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="rx_payment"
                              value="network"
                              checked={checkoutPaymentMethod === 'network'}
                              onChange={() => setCheckoutPaymentMethod('network')}
                            />
                            <span>{isAr ? 'شبكة / POS مع الكابتن' : 'POS'}</span>
                          </label>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitRx}
                      className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-semibold min-h-[44px]"
                    >
                      إرسال الروشتة للصيدلي للمراجعة
                    </button>
                  </>
                )}
              </div>
            )}

            {serviceView === 'rides_parcels' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Car className="w-5 h-5 text-orange-600" />
                      <h3 className="text-base font-bold text-slate-900">اطلبها مشوار (تنقل ذكي بالـ GPS)</h3>
                    </div>
                    <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-lg border border-teal-200">
                      مفتوحة 24/7 ✓
                    </span>
                  </div>

                  {/* Vehicle Selector */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'moto' as const, label: 'موتوسيكل' },
                      { id: 'tuktuk' as const, label: 'توك توك مرخص' },
                      { id: 'car' as const, label: 'سيارة ملاكي' },
                    ].map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        onClick={() => setRideVehicle(v.id)}
                        className={`py-2.5 px-2 rounded-xl border text-xs font-semibold min-h-[44px] ${
                          rideVehicle === v.id ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>

                  {/* Step 1: GPS Pickup */}
                  <div className="p-3.5 bg-teal-50/60 border border-teal-200 rounded-xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-teal-900">1. أولًا: إرسال موقعك الحالي بالـ GPS</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleDetectMyGps}
                          disabled={locatingGps}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>{locatingGps ? 'جاري التحديد...' : 'إرسال موقعي GPS'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setMapPickTarget('pickup')}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
                            mapPickTarget === 'pickup'
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          تعديل من الخريطة
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                      placeholder="وصف موقع الانطلاق أو علامة مميزة..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                    />
                    <p className="text-[11px] font-mono-num text-teal-800">
                      إحداثيات الانطلاق: {pickupLat.toFixed(5)}, {pickupLng.toFixed(5)}
                    </p>
                  </div>

                  {/* Step 2: Dropoff Text OR GPS Map */}
                  <div className="p-3.5 bg-orange-50/50 border border-orange-200 rounded-xl space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-orange-950">2. ثانيًا: مكان التوصيل (كتابة أو تحديد GPS)</span>
                      <button
                        type="button"
                        onClick={() => setMapPickTarget('dropoff')}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
                          mapPickTarget === 'dropoff'
                            ? 'bg-orange-600 text-white border-orange-600'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>تحديد الوجهة على الخريطة</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={rideDropoff}
                      onChange={(e) => setRideDropoff(e.target.value)}
                      placeholder="اكتب مكان التوصيل في المنزلة أو اضغط على الخريطة..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                    />
                    {rideDropoffLat !== null && rideDropoffLng !== null && (
                      <p className="text-[11px] font-mono-num text-orange-800">
                        إحداثيات الوجهة: {rideDropoffLat.toFixed(5)}, {rideDropoffLng.toFixed(5)}
                      </p>
                    )}
                  </div>

                  {/* Interactive GPS Map */}
                  <GpsMapPicker
                    heightClass="h-60"
                    pickup={{ lat: pickupLat, lng: pickupLng, label: 'موقعك (GPS)' }}
                    dropoff={
                      rideDropoffLat !== null && rideDropoffLng !== null
                        ? { lat: rideDropoffLat, lng: rideDropoffLng, label: rideDropoff || 'الوجهة' }
                        : null
                    }
                    nearbyCaptains={nearbyCaptains}
                    selectedCaptainId={selectedCaptainId}
                    onCaptainPinClick={(capId) => {
                      const nextId = selectedCaptainId === capId ? null : capId;
                      handleSelectCaptain(nextId);
                      const found = nearbyCaptains.find((c) => c.id === capId);
                      if (nextId && found) {
                        onNotify(`تم اختيار الطيار: ${found.full_name}`);
                      } else if (!nextId) {
                        onNotify('تم إلغاء تحديد الطيار — متاح لجميع الطيارين');
                      }
                    }}
                    pickTarget={mapPickTarget}
                    onMapPick={(lat, lng) => {
                      if (mapPickTarget === 'pickup') {
                        setPickupLat(lat);
                        setPickupLng(lng);
                        setPickupAddress(`نقطة الانطلاق GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
                        api
                          .updateCustomerLocation({
                            customer_id: customerSession?.id,
                            email: customerSession?.email,
                            phone: customerPhone,
                            full_name: customerName,
                            lat,
                            lng,
                            address_landmark: addressLandmark,
                            default_zone_id: selectedZoneId,
                          })
                          .catch(() => {});
                        onNotify('تم تحديث نقطة الانطلاق على الخريطة');
                      } else {
                        setRideDropoffLat(lat);
                        setRideDropoffLng(lng);
                        if (!rideDropoff.trim() || rideDropoff.startsWith('نقطة GPS')) {
                          setRideDropoff(`نقطة GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
                        }
                        onNotify('تم تحديد مكان التوصيل على الخريطة');
                      }
                    }}
                  />

                  {/* Step 3: Customer-Proposed Fare (Customer specifies price freely, supports Arabic & English digits) */}
                  <div className="p-4 bg-amber-50/70 border-2 border-orange-300 rounded-xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <label htmlFor="customer-proposed-fare-input" className="font-bold text-slate-900">
                        3. ثالثًا: حدد السعر الذي تعرضه للمشوار (ج.م)
                      </label>
                      <span className="font-mono-num text-orange-800 font-bold">المسافة: {rideDistanceKm} كم</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="customer-proposed-fare-input"
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={customerProposedFare}
                        onChange={(e) => setCustomerProposedFare(sanitizeDecimalInput(e.target.value))}
                        placeholder="اكتب السعر هنا (مثال: 35)"
                        className="flex-1 px-4 py-3 bg-white border-2 border-orange-400 text-slate-900 rounded-xl text-base font-bold tabular-nums text-center focus:outline-none focus:border-orange-600"
                      />
                      <span className="text-xs font-bold text-slate-700 shrink-0">ج.م</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-600">اختيار سريع أو اكتب أي مبلغ:</span>
                      {[20, 25, 30, 40, 50, 75, 100].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setCustomerProposedFare(String(amt))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border tabular-nums transition-colors ${
                            customerProposedFare === String(amt)
                              ? 'bg-orange-600 text-white border-orange-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-orange-400'
                          }`}
                        >
                          {amt} ج.م
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 4: Free Captain Choice Across All Captains (Map Pin + Dropdown + Cards) */}
                  <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        4. رابعًا: اختيار طيار محدد (من القائمة أو من الخريطة):
                      </span>
                      <button
                        type="button"
                        onClick={() => refreshNearbyCaptains()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>تحديث الطيارين</span>
                      </button>
                    </div>

                    {/* Explicit Selection Mode Toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectCaptain(null)}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors ${
                          selectedCaptainId === null
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        أي طيار متاح ({nearbyCaptains.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedCaptainId && nearbyCaptains.length > 0) {
                            const firstAvail =
                              nearbyCaptains.find((c) => c.availability_status === 'available') || nearbyCaptains[0];
                            handleSelectCaptain(firstAvail.id);
                          }
                        }}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors ${
                          selectedCaptainId !== null
                            ? 'bg-orange-600 text-white border-orange-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-orange-400'
                        }`}
                      >
                        اختيار طيار محدد ✓
                      </button>
                    </div>

                    {/* Direct Dropdown Selector (Guaranteed 1-tap Selection) */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        اختر الطيار بالاسم من القائمة المنسدلة:
                      </label>
                      <select
                        value={selectedCaptainId || ''}
                        onChange={(e) => handleSelectCaptain(e.target.value || null)}
                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                      >
                        <option value="">إرسال لجميع الطيارين المتاحين ({nearbyCaptains.length})</option>
                        {nearbyCaptains.map((cap) => {
                          const vehLabel =
                            cap.vehicle_type === 'car' ? 'سيارة' : cap.vehicle_type === 'tuktuk' ? 'توك توك' : 'موتوسيكل';
                          const statusLabel =
                            cap.availability_status === 'available'
                              ? 'متاح'
                              : cap.availability_status === 'busy'
                              ? 'مشغول'
                              : 'غير متصل';
                          return (
                            <option key={cap.id} value={cap.id}>
                              {cap.full_name} — {vehLabel} ({cap.vehicle_model}) · {cap.distance_km} كم · {statusLabel}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Vehicle Filter for Captain Cards */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { id: 'all' as const, label: `الكل (${nearbyCaptains.length})` },
                        { id: 'moto' as const, label: 'موتوسيكل' },
                        { id: 'tuktuk' as const, label: 'توك توك' },
                        { id: 'car' as const, label: 'سيارة' },
                      ].map((vf) => (
                        <button
                          key={vf.id}
                          type="button"
                          onClick={() => setCaptainFilterVehicle(vf.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                            captainFilterVehicle === vf.id
                              ? 'bg-orange-100 text-orange-800 border-orange-400'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {vf.label}
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const visibleCaptains =
                        captainFilterVehicle === 'all'
                          ? nearbyCaptains
                          : nearbyCaptains.filter((c) => c.vehicle_type === captainFilterVehicle);
                      if (nearbyCaptains.length === 0) {
                        return (
                          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 font-semibold">
                            لا يوجد طيار متاح حاليًا — عند إرسال الطلب سيصل فورًا لأول طيار يصبح متاحًا.
                          </div>
                        );
                      }
                      if (visibleCaptains.length === 0) {
                        return (
                          <p className="text-xs text-slate-500 py-1">
                            لا يوجد طيارون متاحون ضمن هذا الفلتر — اضغط «الكل» لعرض الطيارين المتاحين.
                          </p>
                        );
                      }
                      return (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto">
                          {visibleCaptains.map((cap) => {
                            const isChosen = selectedCaptainId === cap.id;
                            const vehLabel =
                              cap.vehicle_type === 'car' ? 'سيارة' : cap.vehicle_type === 'tuktuk' ? 'توك توك' : 'موتوسيكل';
                            return (
                              <button
                                type="button"
                                key={cap.id}
                                onClick={() => handleSelectCaptain(isChosen ? null : cap.id)}
                                className={`w-full text-start rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs border transition-colors ${
                                  isChosen
                                    ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500'
                                    : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-900 truncate">
                                    {isChosen ? '✓ مختار: ' : ''}
                                    {cap.full_name}{' '}
                                    <span className="text-amber-600 font-bold">★ {Number(cap.rating_avg || 5).toFixed(1)}</span>
                                  </p>
                                  <p className="text-[11px] text-slate-500 truncate">
                                    {vehLabel} · {cap.vehicle_model} · {cap.plate_number}
                                  </p>
                                </div>
                                <div className="text-end shrink-0 tabular-nums">
                                  <p className="font-bold text-teal-700">{cap.distance_km} كم</p>
                                  <p className="text-[10px] text-slate-500">
                                    {cap.availability_status === 'available'
                                      ? `~${cap.eta_min} د · متاح`
                                      : cap.availability_status === 'busy'
                                      ? 'مشغول'
                                      : 'غير متصل'}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {selectedCaptainId && (() => {
                      const chosen = nearbyCaptains.find((c) => c.id === selectedCaptainId);
                      if (!chosen) return null;
                      return (
                        <div className="p-2.5 bg-orange-100/80 border border-orange-400 rounded-xl flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-orange-950">
                            سيتم إرسال الطلب مباشرة إلى: {chosen.full_name} ({chosen.vehicle_model})
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSelectCaptain(null)}
                            className="text-[11px] font-bold text-rose-700 hover:underline shrink-0"
                          >
                            إلغاء التحديد
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  <button
                    type="button"
                    onClick={handleBookRide}
                    className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-bold min-h-[46px]"
                  >
                    {customerProposedFare
                      ? `إرسال طلب المشوار (${customerProposedFare} ج.م)${
                          selectedCaptainId
                            ? ` إلى ${nearbyCaptains.find((c) => c.id === selectedCaptainId)?.full_name || 'الطيار المختار'}`
                            : ' لجميع الطيارين'
                        }`
                      : 'إرسال طلب المشوار بالسعر المحدد'}
                  </button>

                  {/* Active Rides List with Direct Chat & Fare/Captain Edit */}
                  {trips.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length > 0 && (
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <p className="text-xs font-bold text-slate-900">مشاويرك الحالية</p>
                      {trips
                        .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
                        .slice(0, 3)
                        .map((t) => (
                          <div
                            key={t.id}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <p className="font-bold text-slate-900 font-mono-num">
                                {t.trip_number} · {t.final_fare ?? t.customer_proposed_fare ?? t.estimated_fare} ج.م
                              </p>
                              <p className="text-slate-600">
                                {t.pickup_address} ← {t.dropoff_address}
                              </p>
                              <p className="text-teal-700 font-semibold mt-0.5">
                                {t.captain_name
                                  ? `قبله الكابتن: ${t.captain_name}`
                                  : t.preferred_captain_name
                                  ? `موجه إلى الطيار: ${t.preferred_captain_name}...`
                                  : 'بانتظار قبول طيار...'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveChatTripId(t.id)}
                                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold min-h-[40px]"
                              >
                                <MessageSquare className="w-4 h-4" />
                                <span>{t.captain_id ? 'فتح الشات وتتبع GPS' : 'تعديل السعر / الطيار'}</span>
                              </button>
                              {!t.captain_id && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await api.cancelTrip(t.id, { actor_role: 'customer', actor_name: customerName });
                                    await Promise.all([loadBootstrap(), onRefreshCore()]);
                                    onNotify('تم إلغاء الطلب وإزالته من النظام');
                                  }}
                                  className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg text-[11px] font-bold"
                                >
                                  إلغاء الطلب
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 h-fit">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-orange-600" />
                    <h3 className="text-base font-bold text-slate-900">اطلبها أي حاجة (توصيل طرد بـ OTP)</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={parcelDropoff}
                      onChange={(e) => setParcelDropoff(e.target.value)}
                      placeholder="عنوان التسليم"
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                    <input
                      type="text"
                      value={parcelReceiverPhone}
                      onChange={(e) => setParcelReceiverPhone(e.target.value)}
                      placeholder="رقم هاتف المستلم"
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs tabular-nums"
                    />
                    <input
                      type="text"
                      value={parcelItemCat}
                      onChange={(e) => setParcelItemCat(e.target.value)}
                      placeholder="نوع الغرض"
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                    <select
                      value={parcelSize}
                      onChange={(e) => setParcelSize(e.target.value as 'small' | 'medium' | 'large')}
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      <option value="small">صغير (موتوسيكل)</option>
                      <option value="medium">متوسط (موتوسيكل/توك توك)</option>
                      <option value="large">كبير (توك توك/سيارة)</option>
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={parcelCustomFee}
                      onChange={(e) => setParcelCustomFee(sanitizeDecimalInput(e.target.value))}
                      placeholder="السعر المقترح ج.م (اختياري)"
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs tabular-nums text-center"
                    />
                    <select
                      value={parcelCaptainId}
                      onChange={(e) => setParcelCaptainId(e.target.value)}
                      className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      <option value="">أي طيار متاح (تلقائي)</option>
                      {nearbyCaptains.map((cap) => (
                        <option key={cap.id} value={cap.id}>
                          طيار محدد: {cap.full_name} ({cap.distance_km} كم)
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={prohibitedConfirmed}
                      onChange={(e) => setProhibitedConfirmed(e.target.checked)}
                    />
                    <span>أقر بعدم احتواء الشحنة على مواد خطرة أو مخالفة للقانون المصري</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleRequestParcel}
                    className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-semibold min-h-[44px]"
                  >
                    إرسال الطرد وتوليد رمز OTP للمستلم
                  </button>

                  {lastParcelOtp && (
                    <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 flex items-center justify-between">
                      <span>تم إنشاء الشحنة {lastParcelOtp.num}</span>
                      <strong className="font-mono-num text-sm">OTP: {lastParcelOtp.otp}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {serviceView === 'market' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form onSubmit={handleCreateMarket} className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 space-y-3 h-fit">
                  <h3 className="text-base font-bold text-slate-900">انشر منتجًا للبيع في سوق اطلبها</h3>
                  <input
                    type="text"
                    required
                    value={mktTitle}
                    onChange={(e) => setMktTitle(e.target.value)}
                    placeholder="اسم المنتج أو السلعة"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={mktCategory}
                      onChange={(e) => setMktCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      {categories
                        .filter((c) => c.scope === 'market')
                        .map((c) => (
                          <option key={c.id} value={c.name_ar}>
                            {c.name_ar}
                          </option>
                        ))}
                    </select>
                    <select
                      value={mktCondition}
                      onChange={(e) => setMktCondition(e.target.value as 'new' | 'used')}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      <option value="used">الحالة: مستعمل</option>
                      <option value="new">الحالة: جديد</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    required
                    value={mktPrice}
                    onChange={(e) => setMktPrice(Number(e.target.value))}
                    placeholder="السعر بالجنيه"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs tabular-nums"
                  />
                  <textarea
                    rows={3}
                    value={mktDesc}
                    onChange={(e) => setMktDesc(e.target.value)}
                    placeholder="وصف الحالة والمكان في المنزلة..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />

                  <div className="border border-dashed border-orange-300 bg-orange-50/40 rounded-xl p-3 space-y-2">
                    <p className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5 text-orange-600" />
                      {isAr ? 'تصوير المنتج أو إرفاق صورة مع الإعلان' : 'Capture or attach product photo'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[11px] font-bold cursor-pointer min-h-[38px]">
                        <Camera className="w-3.5 h-3.5" />
                        <span>{isAr ? 'تصوير بالكاميرا' : 'Take Photo'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handleMarketImagePick}
                          className="hidden"
                        />
                      </label>
                      <label className="flex items-center justify-center gap-1.5 px-2.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-[11px] font-bold cursor-pointer min-h-[38px]">
                        <ImagePlus className="w-3.5 h-3.5 text-orange-600" />
                        <span>{isAr ? 'من المعرض' : 'From Gallery'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleMarketImagePick}
                          className="hidden"
                        />
                      </label>
                    </div>
                    {mktImageUrl && (
                      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
                        <img
                          src={mktImageUrl}
                          alt={mktImageName || 'صورة المنتج'}
                          className="w-full h-36 object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setMktImageUrl('');
                            setMktImageName('');
                          }}
                          className="absolute top-2 end-2 p-1.5 rounded-lg bg-slate-900/75 hover:bg-red-600 text-white"
                          title={isAr ? 'إزالة الصورة' : 'Remove photo'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-semibold min-h-[44px]"
                  >
                    نشر الإعلان الآن
                  </button>
                </form>

                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {market.map((item) => (
                    <div key={item.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-44 object-cover bg-slate-100"
                        />
                      ) : (
                        <div className="w-full h-28 bg-slate-50 border-b border-slate-100 flex items-center justify-center text-slate-300">
                          <Tag className="w-8 h-8" />
                        </div>
                      )}
                      <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>{item.category_ar}</span>
                            <span>{item.zone_name}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                              {item.condition === 'new' ? 'جديد' : 'مستعمل'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 line-clamp-2">{item.description}</p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <span className="text-base font-bold text-orange-700 tabular-nums">{item.price} ج.م</span>
                          <span className="text-xs text-slate-500">{item.seller_name}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. OFFERS TAB (Coupons + Discounted Products + Promo Broadcasts) */}
        {tab === 'offers' && (
          <div className="space-y-6">
            {/* Active Coupons */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-orange-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'أكواد الخصم الفعالة في المنزلة' : 'Active Discount Coupons'}
                </h3>
              </div>
              {coupons.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-500">
                  {isAr ? 'لا توجد كوبونات خصم نشطة حاليًا.' : 'No active coupons right now.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {coupons.map((c) => (
                    <div key={c.id} className="bg-white border border-orange-200 rounded-2xl p-4 flex flex-col justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2.5 py-1 bg-orange-50 text-orange-700 font-mono-num text-sm font-bold rounded-lg border border-orange-200">
                            {c.code}
                          </span>
                          <span className="text-xs font-bold text-teal-700 tabular-nums">
                            {c.discount_type === 'percentage' ? `خصم ${c.discount_value}%` : `خصم ${c.discount_value} ج.م`}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 tabular-nums">
                          الحد الأدنى للطلب: {c.min_order_amount} ج.م · بحد أقصى {c.max_discount} ج.م
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleApplyCoupon(c.code)}
                        className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold min-h-[42px]"
                      >
                        {isAr ? 'تطبيق الكود في السلة' : 'Apply in Cart'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Discounted Products */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">
                  {isAr ? 'عروض المتاجر والمنتجات المخفضة الآن' : 'Store Offers & Products on Sale'}
                </h3>
                <span className="text-xs text-slate-500 tabular-nums">{discountedProducts.length} منتج</span>
              </div>
              {discountedProducts.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-500">
                  {isAr ? 'لا توجد عروض منتجات حاليًا.' : 'No offer products.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {discountedProducts.map((p) => {
                    const qty = cart[p.id] || 0;
                    const finalPrice = p.sale_price ?? p.base_price;
                    const hasPctDiscount =
                      p.sale_price !== null && p.sale_price < p.base_price && p.base_price > 0;
                    const pct = hasPctDiscount
                      ? Math.round(((p.base_price - finalPrice) / p.base_price) * 100)
                      : 0;
                    return (
                      <div key={p.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between">
                        {p.image_url && (
                          <div
                            onClick={() => {
                              setDetailFromStorefrontHome(false);
                              setDetailProductList(discountedProducts);
                              setDetailProductId(p.id);
                            }}
                            className="h-28 bg-slate-100 relative overflow-hidden cursor-pointer"
                          >
                            <img
                              src={p.image_url}
                              alt={p.name_ar}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute top-2 start-2 px-2 py-0.5 bg-rose-600 text-white text-[11px] font-bold rounded tabular-nums">
                              {hasPctDiscount ? `-${pct}%` : isAr ? 'عرض المتجر ⭐' : 'Store Offer'}
                            </span>
                          </div>
                        )}
                        <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                          <div
                            onClick={() => {
                              setDetailFromStorefrontHome(false);
                              setDetailProductList(discountedProducts);
                              setDetailProductId(p.id);
                            }}
                            className="cursor-pointer"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-orange-700 truncate">{p.merchant_name}</span>
                              {!p.image_url && (
                                <span className="px-2 py-0.5 bg-rose-600 text-white text-[11px] font-bold rounded tabular-nums">
                                  {hasPctDiscount ? `-${pct}%` : isAr ? 'عرض المتجر ⭐' : 'Store Offer'}
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 mt-1 hover:text-[#A92224] transition-colors">{p.name_ar}</h4>
                            {p.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>}
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                            <div className="tabular-nums">
                              <span className="text-base font-bold text-slate-900">{finalPrice} ج.م</span>
                              {hasPctDiscount && (
                                <span className="text-xs text-slate-400 line-through ms-1.5">{p.base_price}</span>
                              )}
                            </div>
                            {qty > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleAddToCart(p, -1)}
                                  className="w-8 h-8 border border-slate-200 rounded-lg font-bold"
                                >
                                  -
                                </button>
                                <span className="text-xs font-bold tabular-nums w-5 text-center">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => handleAddToCart(p, 1)}
                                  className="w-8 h-8 bg-orange-600 text-white rounded-lg font-bold"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAddToCart(p, 1)}
                                className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-semibold min-h-[40px]"
                              >
                                + أضف للسلة
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Promo Broadcasts */}
            {promoNotifications.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">{isAr ? 'رسائل العروض من الإدارة' : 'Promotional Announcements'}</h3>
                <div className="divide-y divide-slate-100">
                  {promoNotifications.map((n) => (
                    <div key={n.id} className="py-2.5 text-xs">
                      <p className="font-bold text-slate-900">{n.title_ar}</p>
                      <p className="text-slate-600 mt-0.5">{n.body_ar}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. CART TAB (Dedicated Cart, Free-Text / Voice / Image Order & Checkout) */}
        {tab === 'cart' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              {/* Order Mode Selector */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-slate-900">{isAr ? 'طريقة الطلب' : 'Order Mode'}</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'catalog' as const, label: 'سلة المنتجات' },
                    { id: 'free_text' as const, label: 'طلب نصي حر' },
                    { id: 'voice' as const, label: 'تسجيل صوتي' },
                    { id: 'image' as const, label: 'صورة قائمة' },
                  ].map((ch) => (
                    <button
                      type="button"
                      key={ch.id}
                      onClick={() => setOrderChannel(ch.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border min-h-[40px] ${
                        orderChannel === ch.id ? 'bg-orange-600 text-white border-orange-600' : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      {ch.label}
                    </button>
                  ))}
                </div>

                {orderChannel !== 'catalog' && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      {isAr ? 'المتجر المستلم للطلب الحر' : 'Selected Merchant'}
                    </label>
                    <select
                      value={selectedMerchantId}
                      onChange={(e) => setSelectedMerchantId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      {merchants
                        .filter((m) => m.merchant_type !== 'pharmacy')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.business_name_ar} — {m.zone_name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {orderChannel === 'catalog' ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {isAr ? `المنتجات في السلة (${cartTotalQty})` : `Items in Cart (${cartTotalQty})`}
                      </h3>
                      {cartGroups.length > 1 && (
                        <p className="text-[11px] text-teal-700 font-semibold mt-0.5">
                          {isAr
                            ? `طلب واحد مقسم على ${cartGroups.length} متاجر — طيار واحد وتوصيل موحد`
                            : `Single order across ${cartGroups.length} stores`}
                        </p>
                      )}
                    </div>
                    {cartItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCart({})}
                        className="text-xs font-semibold text-rose-600 hover:underline"
                      >
                        {isAr ? 'إفراغ السلة' : 'Clear Cart'}
                      </button>
                    )}
                  </div>
                  {cartItems.length === 0 ? (
                    <div className="py-8 text-center space-y-3">
                      <p className="text-xs text-slate-500">
                        {isAr ? 'سلة المشتريات فارغة حاليًا — يمكنك إضافة منتجات من أي قسم أو متجر.' : 'Your cart is empty.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('home')}
                        className="px-4 py-2.5 bg-orange-600 text-white rounded-xl text-xs font-bold min-h-[42px]"
                      >
                        {isAr ? 'تصفح المنتجات الآن' : 'Browse Products'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {cartGroups.map((grp) => (
                        <div key={grp.merchant_id} className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 font-bold text-slate-900">
                              <Store className="w-4 h-4 text-orange-600 shrink-0" />
                              <span>{grp.merchant_name}</span>
                            </div>
                            <span className="font-bold text-slate-700 tabular-nums">{grp.subtotal} ج.م</span>
                          </div>
                          <div className="divide-y divide-slate-100 px-3.5">
                            {grp.items.map(({ prod, qty, unitPrice }) => (
                              <div key={prod!.id} className="py-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-900 truncate">{prod!.name_ar}</p>
                                  <p className="text-xs text-slate-500 tabular-nums">
                                    {prod!.category_name ? `${prod!.category_name} · ` : ''}
                                    {unitPrice} ج.م للقطعة
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleAddToCart(prod!, -1)}
                                    className="w-8 h-8 border border-slate-200 rounded-lg flex items-center justify-center"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="w-6 text-center text-sm font-bold tabular-nums">{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleAddToCart(prod!, 1)}
                                    className="w-8 h-8 bg-orange-600 text-white rounded-lg flex items-center justify-center"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                  <h4 className="text-sm font-bold text-slate-900">
                    {orderChannel === 'free_text'
                      ? 'اكتب طلبك الحر كما تحب (مثال: 2 كيلو طماطم + كيلو خيار + عيش بلدي)'
                      : orderChannel === 'voice'
                      ? 'محاكاة مرفق رسالة صوتية للطلب الحر'
                      : 'محاكاة إرفاق صورة ورقة مقاضي'}
                  </h4>
                  <textarea
                    rows={4}
                    value={freeTextOrder}
                    onChange={(e) => setFreeTextOrder(e.target.value)}
                    placeholder="اكتب طلبك أو وصف المرفق ليقوم التاجر بتسعيره..."
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              )}
            </div>

            {/* Checkout Summary Panel */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4 h-fit">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">{isAr ? 'ملخص الحساب والتوصيل' : 'Checkout Summary'}</h3>
                <span className="text-xs text-slate-500 font-mono-num">{customerPhone}</span>
              </div>

              {/* 1. Interactive Delivery Location & GPS Map Pinpoint */}
              <div className="p-3.5 bg-orange-50/60 border border-orange-200 rounded-xl space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-orange-600" />
                    <span>{isAr ? 'موقع التوصيل على الخريطة (GPS)' : 'Delivery Pin (GPS)'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCheckoutMap(!showCheckoutMap)}
                    className="text-[11px] font-bold text-orange-800 bg-white border border-orange-300 hover:bg-orange-100 px-2.5 py-1 rounded-lg transition-colors shadow-xs"
                  >
                    {showCheckoutMap ? (isAr ? 'إخفاء الخريطة' : 'Hide Map') : (isAr ? '📍 حدد / غيّر الدبوس' : '📍 Pick on Map')}
                  </button>
                </div>

                {/* Zone & Landmark details */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-700 bg-white/90 p-2 rounded-lg border border-orange-100">
                    <span className="font-semibold">{selectedZone?.name_ar || 'وسط مدينة المنزلة'}</span>
                    <span className="font-mono-num text-orange-700 font-bold" dir="ltr">
                      {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {isAr ? 'العلامة المميزة أو رقم العقار/الشقة:' : 'Landmark / Building / Apt:'}
                    </label>
                    <input
                      type="text"
                      value={addressLandmark}
                      onChange={(e) => setAddressLandmark(e.target.value)}
                      placeholder="مثال: شارع بورسعيد أمام مسجد الأنصار - الدور الثاني"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  {/* Fast GPS Auto-Locate Button */}
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (!navigator.geolocation) {
                          onNotify(isAr ? 'المتصفح لا يدعم تحديد الموقع التلقائي' : 'Geolocation unsupported');
                          return;
                        }
                        setLocatingGps(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setPickupLat(Number(pos.coords.latitude.toFixed(6)));
                            setPickupLng(Number(pos.coords.longitude.toFixed(6)));
                            setLocatingGps(false);
                            onNotify(isAr ? 'تم تحديد موقعك بدقة عبر GPS' : 'GPS location pinned');
                          },
                          (err) => {
                            setLocatingGps(false);
                            onNotify(isAr ? 'تعذر جلب موقع GPS: ' + err.message : 'GPS error');
                          },
                          { enableHighAccuracy: true, timeout: 8000 }
                        );
                      }}
                      className="flex-1 py-1.5 px-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                    >
                      <Crosshair className="w-3.5 h-3.5 text-orange-600" />
                      <span>{locatingGps ? (isAr ? 'جاري التحديد...' : 'Locating...') : (isAr ? 'تحديد موقعي الحالي GPS' : 'Locate Me (GPS)')}</span>
                    </button>
                  </div>

                  {/* Quick Manzala Location Buttons */}
                  <div className="pt-1.5 border-t border-orange-200/50">
                    <p className="text-[10px] font-bold text-slate-500 mb-1">
                      {isAr ? 'أماكن وميادين سريعة بالمنزلة:' : 'Quick Select Locations:'}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { name: 'وسط المنزلة', lat: 31.1583, lng: 31.9369 },
                        { name: 'شارع بورسعيد', lat: 31.1601, lng: 31.9385 },
                        { name: 'موقف المنزلة', lat: 31.1645, lng: 31.9442 },
                        { name: 'البصراط', lat: 31.124, lng: 31.961 },
                        { name: 'العزيزة', lat: 31.182, lng: 31.915 },
                        { name: 'المستشفى العام', lat: 31.155, lng: 31.942 },
                      ].map((spot) => (
                        <button
                          key={spot.name}
                          type="button"
                          onClick={() => {
                            setPickupLat(spot.lat);
                            setPickupLng(spot.lng);
                            setAddressLandmark((prev) => (prev ? prev : spot.name));
                            onNotify(isAr ? `تم تثبيت الموقع: ${spot.name}` : `Selected ${spot.name}`);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                            Math.abs(pickupLat - spot.lat) < 0.002 && Math.abs(pickupLng - spot.lng) < 0.002
                              ? 'bg-orange-600 text-white border-orange-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-orange-50'
                          }`}
                        >
                          {spot.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Map Picker Component */}
                  {showCheckoutMap && (
                    <div className="pt-2">
                      <p className="text-[10px] text-slate-600 font-medium mb-1">
                        {isAr ? 'اضغط على الخريطة لتثبيت دبوس التوصيل عند باب منزلك بدقة:' : 'Tap map to place delivery pin:'}
                      </p>
                      <GpsMapPicker
                        heightClass="h-44"
                        center={[pickupLat, pickupLng]}
                        pickup={{
                          lat: pickupLat,
                          lng: pickupLng,
                          label: isAr ? 'موقع استلام طلبك' : 'Delivery Pin',
                        }}
                        pickTarget="pickup"
                        onMapPick={(lat: number, lng: number) => {
                          setPickupLat(Number(lat.toFixed(6)));
                          setPickupLng(Number(lng.toFixed(6)));
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Payment Method Selector (Cash vs Network/POS vs Wallet) */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-orange-600" />
                    <span>{isAr ? 'طريقة الدفع عند الاستلام' : 'Payment Method'}</span>
                  </label>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {checkoutPaymentMethod === 'vodafone_cash'
                      ? (isAr ? 'فودافون كاش' : 'Vodafone Cash')
                      : checkoutPaymentMethod === 'instapay'
                      ? (isAr ? 'إنستا باي' : 'InstaPay')
                      : checkoutPaymentMethod === 'network'
                      ? (isAr ? 'شبكة / POS مع الكابتن' : 'Card / POS')
                      : (isAr ? 'كاش يدًا بيد' : 'Cash')}
                  </span>
                </div>

                <div className="space-y-2">
                  {/* Option 1: Cash on Delivery */}
                  {paymentSettings?.cod_enabled !== false && (
                    <label
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checkoutPaymentMethod === 'cash'
                          ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500 shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="checkout_payment"
                        value="cash"
                        checked={checkoutPaymentMethod === 'cash'}
                        onChange={() => setCheckoutPaymentMethod('cash')}
                        className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>{isAr ? 'كاش عند الاستلام' : 'Cash on Delivery'}</span>
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                            {isAr ? 'نقدًا' : 'Cash'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {paymentSettings?.cod_instructions_ar ||
                            (isAr ? 'سداد المبلغ نقدًا يدًا بيد للكابتن عند استلام الطلب' : 'Pay cash to captain upon delivery')}
                        </p>
                      </div>
                    </label>
                  )}

                  {/* Option 2: Vodafone Cash */}
                  {paymentSettings?.vodafone_cash_enabled !== false && (
                    <div
                      className={`rounded-xl border transition-all ${
                        checkoutPaymentMethod === 'vodafone_cash'
                          ? 'bg-rose-50/70 border-red-500 ring-1 ring-red-500 shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <label className="flex items-start gap-3 p-3 cursor-pointer">
                        <input
                          type="radio"
                          name="checkout_payment"
                          value="vodafone_cash"
                          checked={checkoutPaymentMethod === 'vodafone_cash'}
                          onChange={() => setCheckoutPaymentMethod('vodafone_cash')}
                          className="mt-0.5 text-red-600 focus:ring-red-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <Smartphone className="w-4 h-4 text-red-600 shrink-0" />
                              <span>{isAr ? 'فودافون كاش' : 'Vodafone Cash'}</span>
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-800 rounded">
                              {isAr ? 'تحويل محفظة' : 'Wallet'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            {paymentSettings?.vodafone_cash_instructions_ar ||
                              (isAr ? 'حوّل المبلغ على رقم فودافون كاش ثم أرفق صورة إيصال التحويل' : 'Transfer to Vodafone Cash number and attach receipt')}
                          </p>
                        </div>
                      </label>

                      {checkoutPaymentMethod === 'vodafone_cash' && (
                        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-red-200/70">
                          <div className="flex items-center justify-between gap-2 bg-white border border-red-200 rounded-xl p-2.5">
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold text-slate-500">{isAr ? 'رقم فودافون كاش للتحويل:' : 'Vodafone Cash Number:'}</div>
                              <div dir="ltr" className="text-sm font-mono-num font-extrabold text-slate-900 text-left">
                                {paymentSettings?.vodafone_cash_number || (isAr ? 'لم يتم إضافة الرقم بعد من لوحة التحكم' : 'Not configured yet')}
                              </div>
                            </div>
                            {paymentSettings?.vodafone_cash_number && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(paymentSettings.vodafone_cash_number);
                                  onNotify(isAr ? `تم نسخ رقم فودافون كاش: ${paymentSettings.vodafone_cash_number}` : 'Copied Vodafone Cash number');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold shrink-0"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>{isAr ? 'نسخ' : 'Copy'}</span>
                              </button>
                            )}
                          </div>

                          <div className="bg-white border border-red-200 rounded-xl p-2.5 space-y-2">
                            {paymentProofImageUrl ? (
                              <div className="space-y-2">
                                <img
                                  src={paymentProofImageUrl}
                                  alt="Transfer receipt"
                                  className="w-full max-h-40 object-cover rounded-lg border border-slate-200"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-teal-700">{isAr ? 'تم إرفاق صورة التحويل ✓' : 'Receipt attached ✓'}</span>
                                  <button
                                    type="button"
                                    onClick={() => setPaymentProofImageUrl('')}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{isAr ? 'حذف' : 'Remove'}</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors">
                                <Upload className="w-4 h-4" />
                                <span>{isAr ? 'إضافة صورة التحويل' : 'Attach Transfer Photo'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                      setPaymentProofImageUrl(String(reader.result || ''));
                                      onNotify(isAr ? 'تم إرفاق صورة التحويل بنجاح' : 'Receipt attached');
                                    };
                                    reader.readAsDataURL(file);
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Option 3: InstaPay */}
                  {paymentSettings?.instapay_enabled !== false && (
                    <div
                      className={`rounded-xl border transition-all ${
                        checkoutPaymentMethod === 'instapay'
                          ? 'bg-purple-50/70 border-purple-500 ring-1 ring-purple-500 shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <label className="flex items-start gap-3 p-3 cursor-pointer">
                        <input
                          type="radio"
                          name="checkout_payment"
                          value="instapay"
                          checked={checkoutPaymentMethod === 'instapay'}
                          onChange={() => setCheckoutPaymentMethod('instapay')}
                          className="mt-0.5 text-purple-600 focus:ring-purple-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <QrCode className="w-4 h-4 text-purple-600 shrink-0" />
                              <span>{isAr ? 'إنستا باي (InstaPay)' : 'InstaPay'}</span>
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded">
                              {isAr ? 'تحويل لحظي' : 'Instant'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            {paymentSettings?.instapay_instructions_ar ||
                              (isAr ? 'امسح باركود إنستا باي أو انسخ الرابط وحوّل المبلغ ثم أرفق صورة التحويل' : 'Scan InstaPay QR or copy link and attach receipt')}
                          </p>
                        </div>
                      </label>

                      {checkoutPaymentMethod === 'instapay' && (
                        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-purple-200/70">
                          <div className="flex justify-center">
                            {paymentSettings?.instapay_qr_image_url ? (
                              <div className="bg-white border border-purple-200 rounded-xl p-2 shadow-xs">
                                <img
                                  src={paymentSettings.instapay_qr_image_url}
                                  alt="InstaPay QR"
                                  className="w-40 h-40 object-contain"
                                />
                              </div>
                            ) : (
                              <div className="w-40 h-28 bg-white border border-dashed border-purple-200 rounded-xl flex flex-col items-center justify-center text-purple-400 gap-1">
                                <QrCode className="w-8 h-8" />
                                <span className="text-[10px] font-semibold text-center px-2">
                                  {isAr ? 'باركود إنستا باي غير مضاف بعد' : 'No QR configured yet'}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-2 bg-white border border-purple-200 rounded-xl p-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-semibold text-slate-500">{isAr ? 'رابط / عنوان إنستا باي:' : 'InstaPay Link:'}</div>
                              <div dir="ltr" className="text-xs font-mono-num font-bold text-purple-900 break-all text-left">
                                {paymentSettings?.instapay_link || (isAr ? 'لم يتم إضافة الرابط بعد من لوحة التحكم' : 'Not configured yet')}
                              </div>
                            </div>
                            {paymentSettings?.instapay_link && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(paymentSettings.instapay_link);
                                  onNotify(isAr ? `تم نسخ رابط إنستا باي: ${paymentSettings.instapay_link}` : 'Copied InstaPay link');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-bold shrink-0"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>{isAr ? 'نسخ الرابط' : 'Copy'}</span>
                              </button>
                            )}
                          </div>

                          <div className="bg-white border border-purple-200 rounded-xl p-2.5 space-y-2">
                            {paymentProofImageUrl ? (
                              <div className="space-y-2">
                                <img
                                  src={paymentProofImageUrl}
                                  alt="Transfer receipt"
                                  className="w-full max-h-40 object-cover rounded-lg border border-slate-200"
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-teal-700">{isAr ? 'تم إرفاق صورة التحويل ✓' : 'Receipt attached ✓'}</span>
                                  <button
                                    type="button"
                                    onClick={() => setPaymentProofImageUrl('')}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{isAr ? 'حذف' : 'Remove'}</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors">
                                <Upload className="w-4 h-4" />
                                <span>{isAr ? 'إضافة صورة التحويل' : 'Attach Transfer Photo'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                      setPaymentProofImageUrl(String(reader.result || ''));
                                      onNotify(isAr ? 'تم إرفاق صورة التحويل بنجاح' : 'Receipt attached');
                                    };
                                    reader.readAsDataURL(file);
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Option 4: Network / Card with Captain POS */}
                  {paymentSettings?.network_pos_enabled !== false && (
                    <label
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checkoutPaymentMethod === 'network'
                          ? 'bg-blue-50/70 border-blue-500 ring-1 ring-blue-500 shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="checkout_payment"
                        value="network"
                        checked={checkoutPaymentMethod === 'network'}
                        onChange={() => setCheckoutPaymentMethod('network')}
                        className="mt-0.5 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                            <span>{isAr ? 'دفع بالشبكة / فيزا (ماكينة POS مع الكابتن)' : 'Network / POS with Captain'}</span>
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded">
                            {isAr ? 'شبكة / POS' : 'POS'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {paymentSettings?.network_instructions_ar ||
                            (isAr
                              ? 'الكابتن يحضر ماكينة دفع إلكترونية POS لقبول بطاقات مدى، فيزا، وماستركارد'
                              : 'Captain brings a mobile POS machine for card payment')}
                        </p>
                      </div>
                    </label>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 font-semibold pt-1 border-t border-slate-100">
                <input type="checkbox" checked={isExpress} onChange={(e) => setIsExpress(e.target.checked)} />
                <span>توصيل مستعجل Express (+10 ج.م)</span>
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="كود الخصم (مثال: MANZALA20)"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono-num"
                />
                <button
                  type="button"
                  onClick={() => handleApplyCoupon()}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[42px]"
                >
                  تطبيق
                </button>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2 text-xs tabular-nums">
                <div className="flex justify-between text-slate-600">
                  <span>{orderChannel === 'catalog' ? 'إجمالي المنتجات' : 'تقدير الطلب الحر'}</span>
                  <span>{effectiveSubtotal} ج.م</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>
                    رسوم التوصيل التقديرية
                    {extraStoreCount > 0 ? ` (+5 ج.م × ${extraStoreCount} متجر إضافي)` : ''}
                  </span>
                  <span>{deliveryFeeEstimate} ج.م</span>
                </div>
                {extraStoreCount > 0 && (
                  <p className="text-[11px] text-teal-700 font-medium">
                    التوصيل الأساسي ({singleDeliveryFee} ج.م) + 5 ج.م فقط عن كل متجر إضافي في السلة
                  </p>
                )}
                {appliedDiscount > 0 && (
                  <div className="flex justify-between text-teal-700 font-semibold">
                    <span>خصم الكوبون ({couponCode})</span>
                    <span>-{appliedDiscount} ج.م</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>
                    {checkoutPaymentMethod === 'vodafone_cash'
                      ? (isAr ? 'الإجمالي المطلوب (فودافون كاش):' : 'Total (Vodafone Cash):')
                      : checkoutPaymentMethod === 'instapay'
                      ? (isAr ? 'الإجمالي المطلوب (إنستا باي):' : 'Total (InstaPay):')
                      : checkoutPaymentMethod === 'network'
                      ? (isAr ? 'الإجمالي المطلوب (دفع بالشبكة / POS):' : 'Total (Network / POS):')
                      : (isAr ? 'الإجمالي المطلوب (كاش عند الاستلام):' : 'Total (Cash on delivery):')}
                  </span>
                  <span>{finalTotalEstimate} ج.م</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubmitStoreOrder}
                className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-bold min-h-[46px] shadow-sm transition-colors"
              >
                {isAr ? 'تأكيد وإرسال الطلب الآن' : 'Confirm Order'}
              </button>
            </div>
          </div>
        )}

        {/* 5. PROFILE TAB (Account Info + Wallet + Orders / Parcels / Rides Tracking) */}
        {tab === 'profile' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 space-y-4">
              {/* Customer Data Form or Guest Sign-In Prompt */}
              {!customerSession ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-[#A92224] flex items-center justify-center">
                    <User className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    {isAr ? 'أنت تتصفح التطبيق كزائر' : 'You are browsing as a guest'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? 'سجّل دخولك أو أنشئ حسابًا جديدًا لإتمام الطلبات، متابعة الشات و GPS مع الطيار، والاستفادة من المحفظة والعروض.'
                      : 'Sign in or create an account to place orders, track captains live, and access your wallet.'}
                  </p>
                  <button
                    type="button"
                    onClick={openAuthFromGuest}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 bg-[#A92224] hover:bg-[#8E1B1D] text-white rounded-xl text-xs sm:text-sm font-bold min-h-[44px]"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{isAr ? 'تسجيل الدخول أو إنشاء حساب' : 'Sign In or Create Account'}</span>
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{customerName}</h3>
                      <p className="text-xs text-slate-500 tabular-nums flex flex-wrap items-center gap-1.5">
                        <span dir="ltr" className="font-mono-num">{customerSession.email}</span>
                        <span className="inline-flex items-center gap-0.5 text-teal-700 font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>{isAr ? 'موثق بالبريد ✓' : 'Verified ✓'}</span>
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">الاسم</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">البريد الإلكتروني المؤكد</label>
                      <input
                        type="email"
                        dir="ltr"
                        readOnly
                        value={customerSession.email}
                        className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-600 rounded-xl text-xs font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">رقم الهاتف للتوصيل</label>
                      <input
                        type="tel"
                        dir="ltr"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="01xxxxxxxxx"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs tabular-nums font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">العنوان التفصيلي في المنزلة</label>
                      <input
                        type="text"
                        value={addressLandmark}
                        onChange={(e) => setAddressLandmark(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={savingProfile}
                      onClick={async () => {
                        if (!customerName.trim() || customerName.trim().length < 2) {
                          onNotify(isAr ? 'أدخل الاسم (حرفين على الأقل)' : 'Enter valid name');
                          return;
                        }
                        setSavingProfile(true);
                        try {
                          const res = await api.updateCustomerProfile({
                            full_name: customerName.trim(),
                            phone: customerPhone.trim(),
                            address_landmark: addressLandmark.trim(),
                            default_zone_id: selectedZoneId,
                          });
                          if (res.customer) {
                            handleCustomerVerified(res.customer);
                          }
                          onNotify(isAr ? 'تم حفظ بياناتك في حسابك بنجاح ✓' : 'Profile saved');
                        } catch (err) {
                          onNotify((err as Error).message);
                        } finally {
                          setSavingProfile(false);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold min-h-[42px]"
                    >
                      <span>{savingProfile ? (isAr ? 'جاري الحفظ...' : 'Saving...') : isAr ? 'حفظ بياناتي' : 'Save Profile'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCustomerLogout}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold min-h-[42px]"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{isAr ? 'تسجيل الخروج وتغيير الحساب' : 'Sign Out'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Wallet Card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">محفظة اطلبها</h3>
                  <Wallet className="w-4 h-4 text-teal-600" />
                </div>
                {!serviceMap.wallet?.is_enabled ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    {serviceMap.wallet?.maintenance_msg_ar || 'المحفظة قيد التجهيز مع مزود الدفع المرخص — الدفع كاش عند الاستلام متاح.'}
                  </p>
                ) : (
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{walletBalance.toFixed(2)} ج.م</p>
                )}
                <button
                  type="button"
                  onClick={() => setTab('offers')}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold min-h-[42px]"
                >
                  استعراض العروض وكوبونات الخصم
                </button>
              </div>
            </div>

            <div className="lg:col-span-8 space-y-4">
              {ratingTarget && (
                <form
                  onSubmit={handleSubmitCaptainRating}
                  className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-amber-950">
                      تقييم الكابتن {ratingTarget.captain_name} ({ratingTarget.ref_number})
                    </span>
                    <button
                      type="button"
                      onClick={() => setRatingTarget(null)}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      إلغاء
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setRatingStars(s)}
                        className="p-1.5 bg-white rounded-lg border border-amber-200"
                      >
                        <Star className={`w-6 h-6 ${s <= ratingStars ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`} />
                      </button>
                    ))}
                    <span className="text-xs font-bold text-amber-800 ms-2">{ratingStars} / 5</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="ملاحظتك عن الطيار (اختياري)..."
                      className="flex-1 min-w-[180px] px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs"
                    />
                    <button
                      type="submit"
                      disabled={submittingRating}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold"
                    >
                      {submittingRating ? '...' : 'إرسال التقييم'}
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-orange-600" />
                  <h3 className="text-base font-bold text-slate-900">طلباتي والروشتات</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {orders.slice(0, 8).map((o) => {
                    const stats = computeOrderStoreStats(o);
                    const orderRating = ratings.find((r) => r.ref_type === 'order' && r.ref_id === o.id);
                    const isSubmitted = orderRating?.status === 'submitted';

                    if (stats.isMultiStore) {
                      const isDelivered = o.status === 'delivered';
                      const isInTransit = o.status === 'on_the_way';
                      const liveEta =
                        isInTransit && o.captain_id
                          ? computeLiveEta(
                              o.captain_lat,
                              o.captain_lng,
                              o.customer_lat,
                              o.customer_lng
                            )
                          : null;

                      return (
                        <div key={o.id} className="py-3.5 space-y-2.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-orange-600 text-white text-[11px] font-bold">
                                {isAr ? `طلب مقسم (${stats.activeSections.length} متاجر)` : `Multi-store (${stats.activeSections.length})`}
                              </span>
                              <span className="font-bold text-slate-900 font-mono-num">#{o.order_number}</span>
                              {o.captain_name && (
                                <span className="text-slate-600 font-semibold">· الطيار: {o.captain_name}</span>
                              )}
                            </div>
                            <div className="text-end tabular-nums">
                              <p className="font-bold text-slate-900 text-sm">{o.total_amount} ج.م</p>
                              <p className="text-[11px] font-semibold text-teal-700">
                                {isDelivered
                                  ? 'تم التسليم ✓'
                                  : isInTransit
                                  ? 'في الطريق إليك الآن'
                                  : stats.allStoresReady
                                  ? `تم الاستلام من ${stats.pickedUpCount}/${stats.activeSections.length} متاجر`
                                  : `تم تجهيز ${stats.readyCount}/${stats.activeSections.length} متاجر`}
                              </p>
                            </div>
                          </div>

                          {/* Store-by-store status */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {stats.sections.map((sec) => {
                              const picked = isSectionPickedUpByCaptain(sec, o.status);
                              const ready = isStorePrepared(sec.prep_status);
                              const itemsLine =
                                Array.isArray(sec.items) && sec.items.length > 0
                                  ? sec.items
                                      .filter((it) => it.status !== 'rejected')
                                      .map((it) => `${it.name_ar} × ${it.quantity}`)
                                      .join(' + ')
                                  : sec.free_order_text || '-';
                              return (
                                <div
                                  key={sec.id}
                                  className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1.5">
                                    <span className="font-bold text-slate-900">{sec.merchant_name}</span>
                                    {sec.prep_status === 'cancelled' ? (
                                      <span className="text-[10px] font-bold text-rose-700">ملغي</span>
                                    ) : picked ? (
                                      <span className="text-[10px] font-bold text-teal-700">تم استلامه من المتجر ✓</span>
                                    ) : ready ? (
                                      <span className="text-[10px] font-bold text-indigo-700">تم التجهيز ✓</span>
                                    ) : (
                                      <span className="text-[10px] font-bold text-amber-700">قيد التجهيز</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-600 line-clamp-2">{itemsLine}</p>
                                  {Array.isArray(sec.items) && sec.items.some((it) => it.status === 'rejected') && (
                                    <div className="space-y-0.5 pt-0.5">
                                      {sec.items
                                        .filter((it) => it.status === 'rejected')
                                        .map((it) => (
                                          <p key={it.id} className="text-[10px] font-semibold text-rose-700">
                                            • تم رفض «{it.name_ar}»: {it.rejection_reason || 'غير متوفر'}
                                          </p>
                                        ))}
                                    </div>
                                  )}
                                  {sec.prep_status === 'cancelled' && sec.rejection_reason && (
                                    <p className="text-[10px] font-bold text-rose-700">سبب الرفض: {sec.rejection_reason}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* In-transit live banner + ETA + Captain Live GPS Map when ALL stores are picked up */}
                          {isInTransit && (
                            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="space-y-0.5">
                                  <p className="font-bold text-teal-900 text-xs flex items-center gap-1.5">
                                    <Navigation className="w-4 h-4 text-teal-700 shrink-0" />
                                    <span>تم استلام الطلب من جميع المتاجر وهو في الطريق إليك الآن</span>
                                  </p>
                                  <p className="text-[11px] font-semibold text-teal-800 flex items-center gap-1.5 tabular-nums">
                                    <Clock className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                                    {liveEta ? (
                                      <span>
                                        الوقت المتوقع للاستلام: ~ {liveEta.etaMin} دقيقة (حوالي الساعة {liveEta.arrivalTimeLabel}) · على بُعد {liveEta.distanceKm} كم
                                      </span>
                                    ) : (
                                      <span>الطيار في طريقه إليك — جاري تحديث وقت الوصول الدقيق</span>
                                    )}
                                  </p>
                                </div>
                                {o.captain_id && (
                                  <button
                                    type="button"
                                    onClick={() => setActiveChatOrderId(o.id)}
                                    className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-[11px] font-bold whitespace-nowrap"
                                  >
                                    فتح تتبع GPS والشات
                                  </button>
                                )}
                              </div>
                              {o.captain_id &&
                                o.captain_lat !== null &&
                                o.captain_lat !== undefined &&
                                o.captain_lng !== null &&
                                o.captain_lng !== undefined && (
                                  <GpsMapPicker
                                    heightClass="h-44"
                                    pickup={{
                                      lat: Number(o.customer_lat || pickupLat || 31.1583),
                                      lng: Number(o.customer_lng || pickupLng || 31.9369),
                                      label: 'موقع الاستلام',
                                    }}
                                    captainPin={{
                                      id: o.captain_id,
                                      full_name: o.captain_name || 'الطيار',
                                      vehicle_type: 'moto',
                                      lat: Number(o.captain_lat),
                                      lng: Number(o.captain_lng),
                                    }}
                                  />
                                )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-2">
                              {o.delivery_proof_image_url && (
                                <div className="flex items-center gap-1.5 text-teal-700 font-semibold">
                                  <img
                                    src={o.delivery_proof_image_url}
                                    alt={`${o.order_number} proof`}
                                    referrerPolicy="no-referrer"
                                    className="w-9 h-9 rounded object-cover border border-teal-400"
                                  />
                                  <span>تم تصوير الأوردر عند المنزل ✓</span>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {isDelivered && o.captain_id && (
                                isSubmitted ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 font-bold">
                                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                    <span>{orderRating?.rating}/5</span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRatingTarget({
                                        rating_id: orderRating?.id,
                                        captain_id: o.captain_id!,
                                        captain_name: o.captain_name || 'الطيار',
                                        ref_type: 'order',
                                        ref_id: o.id,
                                        ref_number: o.order_number,
                                        final_amount: o.total_amount,
                                      });
                                      setRatingStars(5);
                                      setRatingComment('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold"
                                  >
                                    <Star className="w-3.5 h-3.5 fill-white" />
                                    <span>تقييم الطيار</span>
                                  </button>
                                )
                              )}
                              {(o.captain_id || (o.chat_count ?? 0) > 0 || isInTransit) && (
                                <button
                                  type="button"
                                  onClick={() => setActiveChatOrderId(o.id)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold whitespace-nowrap min-h-[36px]"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  <span>
                                    {isAr ? 'الشات مع الطيار' : 'Chat'} ({o.chat_count ?? 0})
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const singleLiveEta =
                      o.status === 'on_the_way' && o.captain_id
                        ? computeLiveEta(o.captain_lat, o.captain_lng, o.customer_lat, o.customer_lng)
                        : null;
                    return (
                      <div key={o.id} className="py-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-start gap-2.5 flex-1 min-w-[200px]">
                            {o.prescription_image_url && (
                              <img
                                src={o.prescription_image_url}
                                alt={o.order_number}
                                referrerPolicy="no-referrer"
                                className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
                              />
                            )}
                            {o.delivery_proof_image_url && (
                              <img
                                src={o.delivery_proof_image_url}
                                alt={`${o.order_number} proof`}
                                referrerPolicy="no-referrer"
                                className="w-11 h-11 rounded-lg object-cover border-2 border-teal-500 shrink-0"
                                title={isAr ? 'صورة الأوردر عند المنزل' : 'Delivery Proof'}
                              />
                            )}
                            <div>
                              <span className="font-bold text-slate-900 font-mono-num">{o.order_number}</span>
                              <span className="mx-2 text-slate-400">·</span>
                              <span className="text-slate-700">{o.merchant_name}</span>
                              {o.captain_name && (
                                <span className="text-slate-500"> · الطيار: {o.captain_name}</span>
                              )}
                              {o.free_order_text && <p className="text-slate-500 mt-0.5">{o.free_order_text}</p>}
                              {Array.isArray(o.items) && o.items.some((it) => it.status === 'rejected') && (
                                <div className="mt-1 space-y-0.5">
                                  {o.items
                                    .filter((it) => it.status === 'rejected')
                                    .map((it) => (
                                      <p key={it.id} className="text-[11px] font-semibold text-rose-700">
                                        • تم رفض «{it.name_ar}»: {it.rejection_reason || 'غير متوفر'}
                                      </p>
                                    ))}
                                </div>
                              )}
                              {o.status === 'cancelled' && o.rejection_reason && (
                                <p className="text-[11px] font-bold text-rose-700 mt-0.5">
                                  سبب إلغاء الفاتورة: {o.rejection_reason}
                                </p>
                              )}
                              {o.status === 'ready_for_pickup' && (
                                <p className="text-[11px] font-bold text-teal-700 mt-0.5">
                                  الطلب جاهز للاستلام من المتجر ✓
                                </p>
                              )}
                              {o.delivery_proof_image_url && (
                                <p className="text-teal-700 font-semibold mt-0.5 inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>{isAr ? 'تم تصوير الأوردر عند المنزل ✓' : 'Delivery proof captured'}</span>
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {o.status === 'delivered' && o.captain_id && (
                              isSubmitted ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 font-bold">
                                  <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                  <span>{orderRating?.rating}/5</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRatingTarget({
                                      rating_id: orderRating?.id,
                                      captain_id: o.captain_id!,
                                      captain_name: o.captain_name || 'الطيار',
                                      ref_type: 'order',
                                      ref_id: o.id,
                                      ref_number: o.order_number,
                                      final_amount: o.total_amount,
                                    });
                                    setRatingStars(5);
                                    setRatingComment('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold"
                                >
                                  <Star className="w-3.5 h-3.5 fill-white" />
                                  <span>تقييم الطيار</span>
                                </button>
                              )
                            )}
                            {(o.captain_id || (o.chat_count ?? 0) > 0 || o.status === 'on_the_way') && (
                              <button
                                type="button"
                                onClick={() => setActiveChatOrderId(o.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold whitespace-nowrap min-h-[36px]"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>
                                  {isAr ? 'الشات مع الطيار' : 'Chat'} ({o.chat_count ?? 0})
                                </span>
                              </button>
                            )}
                            <div className="text-end tabular-nums">
                              <p className="font-bold text-slate-900">{o.total_amount} ج.م</p>
                              <p className="text-teal-700 font-semibold">{o.status}</p>
                            </div>
                          </div>
                        </div>

                        {o.status === 'on_the_way' && (
                          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2">
                            <p className="font-bold text-teal-900 flex items-center gap-1.5">
                              <Navigation className="w-3.5 h-3.5 text-teal-700" />
                              <span>تم استلام الطلب وهو في الطريق إليك الآن</span>
                            </p>
                            {singleLiveEta && (
                              <p className="text-[11px] font-semibold text-teal-800 flex items-center gap-1.5 tabular-nums">
                                <Clock className="w-3.5 h-3.5 text-teal-700" />
                                <span>
                                  الوقت المتوقع للاستلام: ~ {singleLiveEta.etaMin} دقيقة (حوالي الساعة {singleLiveEta.arrivalTimeLabel}) · على بُعد {singleLiveEta.distanceKm} كم
                                </span>
                              </p>
                            )}
                            {o.captain_id &&
                              o.captain_lat !== null &&
                              o.captain_lat !== undefined &&
                              o.captain_lng !== null &&
                              o.captain_lng !== undefined && (
                                <GpsMapPicker
                                  heightClass="h-40"
                                  pickup={{
                                    lat: Number(o.customer_lat || pickupLat || 31.1583),
                                    lng: Number(o.customer_lng || pickupLng || 31.9369),
                                    label: 'موقع الاستلام',
                                  }}
                                  captainPin={{
                                    id: o.captain_id,
                                    full_name: o.captain_name || 'الطيار',
                                    vehicle_type: 'moto',
                                    lat: Number(o.captain_lat),
                                    lng: Number(o.captain_lng),
                                  }}
                                />
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <h3 className="text-base font-bold text-slate-900">الطرود والرحلات الأخيرة</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {parcels.slice(0, 5).map((p) => {
                    const parcelRating = ratings.find((r) => r.ref_type === 'parcel' && r.ref_id === p.id);
                    const isSubmitted = parcelRating?.status === 'submitted';
                    return (
                      <div key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold font-mono-num">{p.delivery_number}</span> — {p.item_category} ({p.dropoff_address})
                        </div>
                        <div className="flex items-center gap-2.5 tabular-nums">
                          <span className="font-mono-num text-orange-700 font-bold">OTP: {p.delivery_otp}</span>
                          <span className="font-semibold text-slate-700">{p.status}</span>
                          {p.status === 'delivered' && p.captain_id && (
                            isSubmitted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-amber-700 font-bold">
                                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                <span>{parcelRating?.rating}/5</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRatingTarget({
                                    rating_id: parcelRating?.id,
                                    captain_id: p.captain_id,
                                    captain_name: p.captain_name || 'الطيار',
                                    ref_type: 'parcel',
                                    ref_id: p.id,
                                    ref_number: p.delivery_number,
                                    final_amount: Number(p.delivery_fee || 0),
                                  });
                                  setRatingStars(5);
                                  setRatingComment('');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold"
                              >
                                <Star className="w-3 h-3 fill-white" />
                                <span>تقييم الطيار</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {trips.slice(0, 5).map((t) => (
                    <div key={t.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold font-mono-num">{t.trip_number}</span> — {t.pickup_address} ← {t.dropoff_address}
                        {t.captain_name && <span className="text-slate-500"> · الكابتن: {t.captain_name}</span>}
                      </div>
                      <div className="flex items-center gap-2 tabular-nums font-semibold">
                        <span>
                          {t.final_fare ?? t.customer_proposed_fare ?? t.estimated_fare} ج.م ({t.status})
                        </span>
                        {t.captain_id && (
                          <button
                            type="button"
                            onClick={() => setActiveChatTripId(t.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>الشات و GPS</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SMART SEARCH OVERLAY, PRODUCT DETAIL + COMPARISON SHEET, AND SMART ASSISTANT MODAL */}
      <OtlobhaSmartSearchOverlay
        open={searchOverlayOpen}
        cartQtyMap={cart}
        onClose={() => setSearchOverlayOpen(false)}
        onOpenProduct={(pid, orderedList) => {
          setDetailFromStorefrontHome(false);
          setDetailProductList(orderedList && orderedList.length > 0 ? orderedList : storefrontProducts);
          setDetailProductId(pid);
        }}
        onAddProduct={handleAddStorefrontCard}
        onDecrementProduct={handleDecrementStorefrontProduct}
      />

      <OtlobhaProductDetailSheet
        productId={detailProductId}
        productList={detailFromStorefrontHome ? storefrontProducts : detailProductList}
        hasMore={detailFromStorefrontHome && storefrontHasMore}
        onLoadMore={
          detailFromStorefrontHome
            ? () => {
                void loadStorefrontData({
                  page: storefrontPage + 1,
                  append: true,
                });
              }
            : undefined
        }
        onActiveProductChange={(pid) => setDetailProductId(pid)}
        cartCount={cartTotalQty}
        onClose={() => setDetailProductId(null)}
        onOpenCart={() => {
          setSearchOverlayOpen(false);
          setTab('cart');
        }}
        onOpenProduct={(pid, listHint) => {
          if (listHint && listHint.length > 0) {
            setDetailFromStorefrontHome(false);
            setDetailProductList(listHint);
          }
          setDetailProductId(pid);
        }}
        onSelectBrand={(brandName) => {
          setSearchOverlayOpen(false);
          setStorefrontBrand(brandName);
          setStorefrontCategoryId('');
          setStorefrontMerchantId('');
          setTab('home');
        }}
        onSelectStore={(mid) => {
          setSearchOverlayOpen(false);
          setStorefrontMerchantId(mid);
          setStorefrontCategoryId('');
          setStorefrontBrand('');
          setTab('home');
        }}
        onAddToCart={(item) => {
          ensureProductInCatalogState({
            id: item.id,
            merchant_id: item.merchant_id,
            merchant_name: item.merchant_name,
            name_ar: item.name_ar,
            image_url: item.image_url,
            base_price: item.price,
            sale_price: null,
          });
          setSelectedMerchantId(item.merchant_id);
          setOrderChannel('catalog');
          setCart((prev) => ({
            ...prev,
            [item.id]: (prev[item.id] || 0) + item.quantity,
          }));
        }}
        onNotify={onNotify}
      />

      <OtlobhaSmartAssistantModal
        open={assistantModalOpen}
        onClose={() => setAssistantModalOpen(false)}
        onOpenProduct={(pid, orderedList) => {
          setDetailFromStorefrontHome(false);
          setDetailProductList(orderedList && orderedList.length > 0 ? orderedList : storefrontProducts);
          setDetailProductId(pid);
        }}
        onAddProduct={handleAddStorefrontCard}
        onOpenService={handleOpenOtlobhaService}
      />

      {/* FLOATING 89% WIDTH BOTTOM NAVIGATION DOCK: الرئيسية | الأقسام | [المساعد الذكي المركزي] | السلة | حسابي */}
      <div className="fixed bottom-3 inset-x-0 z-40 flex justify-center pointer-events-none px-2">
        <nav
          aria-label={isAr ? 'شريط التنقل السفلي لتطبيق العميل' : 'Customer Bottom Navigation'}
          className="pointer-events-auto w-[89%] max-w-[560px] h-[82px] sm:h-[96px] bg-white/92 backdrop-blur-xl border border-slate-200/85 rounded-[34px] shadow-[0_14px_40px_rgba(15,23,42,0.18)] px-2.5 sm:px-5 flex items-center"
        >
          <div className="w-full grid grid-cols-5 items-center gap-1">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              const active = item.id !== 'assistant' && tab === item.id;
              if (item.isCenterFeatured) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAssistantModalOpen(true)}
                    className="relative flex flex-col items-center justify-center gap-1 group cursor-pointer"
                  >
                    <div
                      className={`-mt-7 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-[0_10px_24px_rgba(169,34,36,0.34)] transition-transform duration-200 group-hover:scale-105 ring-4 ${
                        assistantModalOpen
                          ? 'bg-gradient-to-br from-[#86191B] via-[#A92224] to-[#F5A623] text-white ring-[#F5A623]/40'
                          : 'bg-gradient-to-br from-[#A92224] via-[#C62F28] to-[#F5A623] text-white ring-white'
                      }`}
                    >
                      <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <span
                      className={`text-[10.5px] sm:text-xs whitespace-nowrap leading-none font-black ${
                        assistantModalOpen ? 'text-[#A92224]' : 'text-slate-800'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id as BottomTab)}
                  className={`relative flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-2xl min-h-[54px] transition-all duration-200 cursor-pointer ${
                    active ? 'text-[#A92224] bg-[#FEF2F2]/90 font-black' : 'text-slate-500 hover:bg-slate-100/70 font-bold'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="absolute -top-2 -end-2.5 min-w-[18px] h-[18px] px-1 bg-[#A92224] text-white rounded-full text-[10px] font-black flex items-center justify-center tabular-nums">
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
    </div>
  );
};
