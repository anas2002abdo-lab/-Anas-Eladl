import 'dart:async';
import 'dart:convert';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'core/api_client.dart';
import 'core/push_notification_service.dart';
import 'screens/home_screen.dart';
import 'screens/services_hub_screen.dart';
import 'screens/offers_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/order_chat_screen.dart';
import 'screens/trip_chat_screen.dart';
import 'screens/customer_otp_login_screen.dart';
import 'screens/complete_profile_screen.dart';
import 'screens/support_screen.dart';
import 'screens/storefront_categories_screen.dart';
import 'screens/storefront_product_pager_sheet.dart';
import 'screens/storefront_smart_search_screen.dart';
import 'screens/storefront_assistant_sheet.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
    FirebaseMessaging.onBackgroundMessage(otlobhaCustomerBackgroundHandler);
  } catch (e) {
    debugPrint('[CustomerMain] Firebase pre-init skipped: $e');
  }
  await CustomerPushNotificationService.instance.initialize();
  runApp(const OtlobhaCustomerApp());
}

typedef MyApp = OtlobhaCustomerApp;

class OtlobhaCustomerApp extends StatelessWidget {
  const OtlobhaCustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'اطلبها – Otlobha',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar', 'EG'),
      supportedLocales: const [Locale('ar', 'EG'), Locale('en', 'US')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFA92224),
          primary: const Color(0xFFA92224),
          secondary: const Color(0xFFF5A623),
        ),
        scaffoldBackgroundColor: const Color(0xFFF8FAFC),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFA92224),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
      ),
      home: const CustomerShell(),
    );
  }
}

class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key});

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> with WidgetsBindingObserver {
  final OtlobhaCustomerApi api = OtlobhaCustomerApi();
  bool _isAuthenticated = false;
  bool _isGuest = false;
  bool _showAuthScreen = true;
  bool _needsProfileCompletion = false;
  bool _isEmailVerified = true;
  bool _verifyNotifShownForSession = false;
  Map<String, dynamic> _currentUserSnapshot = {};
  int _index = 0; // 0: الرئيسية | 1: الأقسام | 2: الخدمات | 3: السلة | 4: حسابي | 5: العروض والكوبونات
  String _serviceSubView = 'hub';
  bool _loading = true;
  Map<String, dynamic> _bootstrap = {};
  List<Map<String, dynamic>> _storefrontCategories = [];
  String _storefrontFilter = 'for_you';
  String _storefrontCategoryId = '';
  String _storefrontCategoryName = '';
  String _storefrontBrand = '';
  String _storefrontMerchantId = '';
  String _storefrontMerchantName = '';
  final Map<String, int> _quickCart = {};
  final Map<String, Map<String, dynamic>> _cartProductsCache = {};
  String _quickMerchantId = '';
  String _selectedZoneId = 'zn_city_center';
  String _orderChannel = 'catalog';
  String _couponCode = '';
  double _appliedDiscount = 0;
  String _customerName = '';
  String _customerEmail = '';
  String _customerPhone = '';
  String _addressLandmark = '';
  Timer? _pollTimer;
  WebSocketChannel? _ridesWs;
  StreamSubscription? _ridesSub;
  Map<String, dynamic>? _pendingPushTap;

  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final GlobalKey<StorefrontCategoriesScreenState> _categoriesKey =
      GlobalKey<StorefrontCategoriesScreenState>();
  final List<int> _tabHistory = <int>[];
  DateTime? _lastBackPressAt;

  static const String _prefGuestMode = 'otlobha_cust_is_guest';
  static const String _prefTabIndex = 'otlobha_cust_tab_index';
  static const String _prefServiceSubView = 'otlobha_cust_service_sub_view';

  Future<void> _refreshStorefrontCategories() async {
    try {
      final res = await api.getStorefrontHome(page: 1, limit: 1);
      final rawCats = (res['categories'] as List?) ?? [];
      final parsedCats = rawCats
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (mounted) {
        setState(() => _storefrontCategories = parsedCats);
      }
    } catch (_) {}
  }

  void _switchTab(int nextIndex, {String? serviceSubView, bool recordHistory = true}) {
    final prevIndex = _index;
    setState(() {
      if (recordHistory && prevIndex != nextIndex) {
        if (_tabHistory.isEmpty || _tabHistory.last != prevIndex) {
          _tabHistory.add(prevIndex);
          if (_tabHistory.length > 20) _tabHistory.removeAt(0);
        }
      }
      if (serviceSubView != null) {
        _serviceSubView = serviceSubView;
      }
      _index = nextIndex;
    });
    _persistNavState(tabIndex: nextIndex, subView: serviceSubView);
    if (nextIndex == 1) {
      _refreshStorefrontCategories();
    }
  }

  void _handleSystemBack() {
    // 1. Close open Drawer first
    if (_scaffoldKey.currentState?.isDrawerOpen == true) {
      Navigator.of(context).pop();
      return;
    }

    // 2. If currently on Home tab with any active filter/category/brand/merchant, clear it first
    if (_index == 0 &&
        (_storefrontCategoryId.isNotEmpty ||
            _storefrontBrand.isNotEmpty ||
            _storefrontMerchantId.isNotEmpty ||
            _storefrontFilter != 'for_you')) {
      setState(() {
        _storefrontFilter = 'for_you';
        _storefrontCategoryId = '';
        _storefrontCategoryName = '';
        _storefrontBrand = '';
        _storefrontMerchantId = '';
        _storefrontMerchantName = '';
      });
      return;
    }

    // 2B. If inside Categories tab viewing inline subcategories/products, step back to Root Squares first
    if (_index == 1 && _categoriesKey.currentState?.handleSystemBack() == true) {
      return;
    }

    // 3. If inside Services tab sub-view (stores / pharmacy / rides_parcels / market), return to hub
    if (_index == 2 && _serviceSubView != 'hub') {
      setState(() => _serviceSubView = 'hub');
      _persistNavState(subView: 'hub');
      return;
    }

    // 4. Step back through previous visited tabs
    while (_tabHistory.isNotEmpty) {
      final prev = _tabHistory.removeLast();
      if (prev != _index) {
        setState(() => _index = prev);
        _persistNavState(tabIndex: prev);
        return;
      }
    }

    // 5. Return to Home tab if currently on another tab
    if (_index != 0) {
      setState(() => _index = 0);
      _persistNavState(tabIndex: 0);
      return;
    }

    // 6. On Home root: double-back within 2 seconds exits the app cleanly
    final now = DateTime.now();
    if (_lastBackPressAt != null && now.difference(_lastBackPressAt!) <= const Duration(seconds: 2)) {
      SystemNavigator.pop();
      return;
    }
    _lastBackPressAt = now;
    if (mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('اضغط زر الرجوع مرة أخرى للخروج من التطبيق'),
            duration: Duration(seconds: 2),
          ),
        );
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    CustomerPushNotificationService.instance.initialize(
      onNotificationTap: _handlePushNotificationTap,
      onForegroundNotification: () {
        if (_isAuthenticated && !_isGuest) _silentSync();
      },
    );
    _restoreSavedNavigationAndSession();
    _pollTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      if (_isAuthenticated && !_isGuest) _silentSync();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final push = CustomerPushNotificationService.instance;
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      push.scheduleNativeBackgroundSync(fastCheck: true);
      return;
    }
    if (state == AppLifecycleState.resumed) {
      push.refreshShownIdsFromStorage();
      if (_isAuthenticated && !_isGuest) {
        _silentSync();
        if (push.currentToken == null || !push.isTokenSynced) {
          push.registerForAuthenticatedUser(api);
        }
      }
    }
  }

  Future<void> _openExternalVerifyEmailPage({String? email}) async {
    final targetEmail = (email != null && email.trim().isNotEmpty) ? email.trim() : _customerEmail.trim();
    final uri = api.verifyEmailExternalUri(email: targetEmail, autoSend: true);
    final safeExternal = await api.isSafeExternalPortalUri(uri);
    if (safeExternal) {
      try {
        final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (ok) return;
      } catch (_) {}
    }

    // Never open an unverified URL that could expose the Admin Dashboard; verify securely inside the app.
    if (!mounted) return;
    await _showInAppEmailVerifyDialog(targetEmail);
  }

  Future<void> _showInAppEmailVerifyDialog(String email) async {
    final emailCtrl = TextEditingController(text: email);
    final codeCtrl = TextEditingController();
    bool codeSent = false;
    bool useLegacyOtp = false;
    bool busy = false;
    String? feedback;
    bool feedbackOk = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Text('توثيق البريد الإلكتروني'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (feedback != null) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: feedbackOk ? const Color(0xFFF0FDFA) : const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: feedbackOk ? const Color(0xFF99F6E4) : const Color(0xFFFECACA)),
                      ),
                      child: Text(
                        feedback!,
                        style: TextStyle(
                          color: feedbackOk ? const Color(0xFF0F766E) : const Color(0xFFB91C1C),
                          fontSize: 12.5,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: TextField(
                      controller: emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'البريد الإلكتروني', border: OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final cleanEmail = OtlobhaCustomerApi.normalizeEmail(emailCtrl.text);
                            if (cleanEmail == null) {
                              setDialogState(() {
                                feedback = 'يرجى إدخال بريد إلكتروني صحيح';
                                feedbackOk = false;
                              });
                              return;
                            }
                            setDialogState(() => busy = true);
                            try {
                              final res = await api.requestEmailVerifyCode(cleanEmail);
                              if (res['already_verified'] == true) {
                                if (ctx.mounted) Navigator.of(ctx).pop();
                                _silentSync();
                                return;
                              }
                              setDialogState(() {
                                busy = false;
                                codeSent = true;
                                useLegacyOtp = res['verify_flow'] == 'legacy_otp';
                                feedback = (res['message'] ?? 'تم إرسال رمز التوثيق المكون من 6 أرقام إلى بريدك').toString();
                                feedbackOk = true;
                              });
                            } catch (e) {
                              setDialogState(() {
                                busy = false;
                                feedback = e.toString().replaceFirst('Exception: ', '');
                                feedbackOk = false;
                              });
                            }
                          },
                    child: Text(codeSent ? 'إعادة إرسال الرمز' : 'إرسال رمز التوثيق على البريد'),
                  ),
                  const SizedBox(height: 10),
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: TextField(
                      controller: codeCtrl,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(labelText: 'رمز التوثيق (6 أرقام)', counterText: '', border: OutlineInputBorder()),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: busy ? null : () => Navigator.of(ctx).pop(),
                child: const Text('إغلاق'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA92224), foregroundColor: Colors.white),
                onPressed: busy
                    ? null
                    : () async {
                        final cleanEmail = OtlobhaCustomerApi.normalizeEmail(emailCtrl.text);
                        final code = codeCtrl.text.trim();
                        if (cleanEmail == null || code.length != 6) {
                          setDialogState(() {
                            feedback = 'أدخل البريد الإلكتروني ورمز التوثيق المكون من 6 أرقام';
                            feedbackOk = false;
                          });
                          return;
                        }
                        setDialogState(() => busy = true);
                        try {
                          await api.confirmEmailVerifyCode(
                            email: cleanEmail,
                            code: code,
                            useLegacyOtpFlow: useLegacyOtp,
                          );
                          if (ctx.mounted) Navigator.of(ctx).pop();
                          if (mounted) {
                            setState(() => _isEmailVerified = true);
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('تم توثيق بريدك الإلكتروني بنجاح ✓')),
                            );
                          }
                          _silentSync();
                        } catch (e) {
                          setDialogState(() {
                            busy = false;
                            feedback = e.toString().replaceFirst('Exception: ', '');
                            feedbackOk = false;
                          });
                        }
                      },
                child: Text(busy ? 'جاري التحقق...' : 'تأكيد التوثيق'),
              ),
            ],
          ),
        ),
      ),
    );
    emailCtrl.dispose();
    codeCtrl.dispose();
  }

  void _maybeTriggerEmailVerificationNotification() {
    if (_isAuthenticated &&
        !_isGuest &&
        !_isEmailVerified &&
        _customerEmail.trim().isNotEmpty &&
        !_verifyNotifShownForSession) {
      _verifyNotifShownForSession = true;
      CustomerPushNotificationService.instance.showEmailVerificationLocalNotification(email: _customerEmail);
    }
  }

  Future<void> _persistNavState({int? tabIndex, String? subView, bool? guest}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (tabIndex != null) await prefs.setInt(_prefTabIndex, tabIndex);
      if (subView != null) await prefs.setString(_prefServiceSubView, subView);
      if (guest != null) await prefs.setBool(_prefGuestMode, guest);
    } catch (_) {}
  }

  bool _checkNeedsProfileCompletion(Map<String, dynamic> user) {
    if (user['needs_profile_completion'] == true) return true;
    if (user['profile_completed'] == false) return true;
    final phone = (user['phone'] ?? '').toString().trim();
    if (phone.isEmpty && user['profile_completed'] != true) return true;
    return false;
  }

  Future<void> _restoreSavedNavigationAndSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedTab = prefs.getInt(_prefTabIndex) ?? 0;
      final savedSub = prefs.getString(_prefServiceSubView) ?? 'hub';
      final savedGuest = prefs.getBool(_prefGuestMode) ?? false;
      final savedUser = await api.restorePersistedSession();

      if (!mounted) return;
      if (savedUser != null && api.hasTokens) {
        final needsProfile = _checkNeedsProfileCompletion(savedUser);
        setState(() {
          _isAuthenticated = true;
          _isGuest = false;
          _showAuthScreen = false;
          _needsProfileCompletion = needsProfile;
          _isEmailVerified = savedUser['is_email_verified'] == true || savedUser['is_email_verified'] == 1;
          _currentUserSnapshot = savedUser;
          _customerEmail = savedUser['email']?.toString() ?? '';
          _customerName = savedUser['full_name']?.toString() ?? '';
          _customerPhone = savedUser['phone']?.toString() ?? '';
          _addressLandmark = savedUser['address_landmark']?.toString() ?? '';
          final zoneId = savedUser['default_zone_id']?.toString() ?? '';
          if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
          _index = savedTab.clamp(0, 5);
          _serviceSubView = savedSub;
        });
        if (!needsProfile) {
          _connectRidesWs();
          _loadData();
          CustomerPushNotificationService.instance.registerForAuthenticatedUser(api);
          _maybeTriggerEmailVerificationNotification();
        }
      } else if (savedGuest) {
        setState(() {
          _isGuest = true;
          _isAuthenticated = false;
          _showAuthScreen = false;
          _customerName = 'زائر اطلبها';
          _index = savedTab.clamp(0, 5);
          _serviceSubView = savedSub;
        });
        _loadData();
      }
    } catch (_) {}
  }

  void _markLocalNotificationRead(String notifId) {
    final cleanId = notifId.trim();
    if (cleanId.isEmpty) return;
    final current = _bootstrap['notifications'];
    if (current is! List) return;
    final updated = current.map((raw) {
      if (raw is Map && (raw['id']?.toString().trim() ?? '') == cleanId) {
        return <String, dynamic>{...Map<String, dynamic>.from(raw), 'is_read': true};
      }
      return raw;
    }).toList();
    if (mounted) {
      setState(() {
        _bootstrap = <String, dynamic>{..._bootstrap, 'notifications': updated};
      });
    }
  }

  void _markAllLocalNotificationsRead() {
    final current = _bootstrap['notifications'];
    if (current is! List) return;
    final updated = current.map((raw) {
      if (raw is Map) {
        return <String, dynamic>{...Map<String, dynamic>.from(raw), 'is_read': true};
      }
      return raw;
    }).toList();
    if (mounted) {
      setState(() {
        _bootstrap = <String, dynamic>{..._bootstrap, 'notifications': updated};
      });
    }
  }

  Future<void> _openProductDeepLink(String productId) async {
    final cleanId = productId.trim();
    if (cleanId.isEmpty) {
      _switchTab(0);
      return;
    }
    try {
      final list = ((_bootstrap['products'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final idx = list.indexWhere((p) => (p['id'] ?? '').toString() == cleanId);
      if (idx >= 0 && mounted) {
        await showStorefrontProductPager(
          context: context,
          api: api,
          products: list,
          initialIndex: idx,
          getCartCount: () => _quickCart.values.fold<int>(0, (s, v) => s + v),
          onAddToCart: _onQuickAdd,
          onOpenCart: () => _switchTab(3),
          onSelectBrand: _selectStorefrontBrand,
          onSelectStore: _selectStorefrontMerchant,
        );
        return;
      }
    } catch (_) {}
    _switchTab(0);
  }

  void _handlePushNotificationTap(Map<String, dynamic> data) {
    if (!mounted) return;
    if (!_isAuthenticated || _isGuest) {
      _pendingPushTap = data;
      return;
    }

    final rawDeepLink = (data['deep_link'] ?? '').toString().trim();
    final deepLink = rawDeepLink.toLowerCase();
    final orderId = (data['order_id'] ?? '').toString().trim();
    final tripId = (data['trip_id'] ?? '').toString().trim();
    final notifId = (data['notification_id'] ?? data['id'] ?? '').toString().trim();

    if (notifId.isNotEmpty) {
      _markLocalNotificationRead(notifId);
      api.markNotificationRead(notifId).catchError((_) {});
    }

    if (deepLink == 'verify_email') {
      _openExternalVerifyEmailPage(email: data['email']?.toString());
      return;
    }
    if ((deepLink == 'order_chat' || deepLink == 'order') && orderId.isNotEmpty) {
      _openOrderChat(orderId);
      return;
    }
    if ((deepLink == 'trip_chat' || deepLink == 'trip') && tripId.isNotEmpty) {
      _openTripChat(tripId);
      return;
    }
    if (deepLink == 'home') {
      _clearStorefrontFilters();
      _switchTab(0);
      return;
    }
    if (deepLink == 'categories') {
      _switchTab(1);
      return;
    }
    if (deepLink.startsWith('category:')) {
      final catId = rawDeepLink.substring(9).trim();
      _switchTab(1);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final opened = _categoriesKey.currentState?.openCategoryById(catId) ?? false;
        if (!opened && catId.isNotEmpty) {
          _selectStorefrontCategory(catId, '');
        }
      });
      return;
    }
    if (deepLink.startsWith('merchant:')) {
      final merId = rawDeepLink.substring(9).trim();
      if (merId.isNotEmpty) {
        final merchants = (_bootstrap['merchants'] as List?) ?? const [];
        String merName = '';
        for (final m in merchants) {
          if (m is Map && (m['id'] ?? '').toString() == merId) {
            merName = (m['name_ar'] ?? '').toString();
            break;
          }
        }
        _selectStorefrontMerchant(merId, merName);
        _switchTab(0);
        return;
      }
      _switchTab(2, serviceSubView: 'stores');
      return;
    }
    if (deepLink.startsWith('product:')) {
      final prodId = rawDeepLink.substring(8).trim();
      _openProductDeepLink(prodId);
      return;
    }
    if (deepLink.startsWith('url:')) {
      final urlStr = rawDeepLink.substring(4).trim();
      final uri = Uri.tryParse(urlStr);
      if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
        launchUrl(uri, mode: LaunchMode.externalApplication);
        return;
      }
    }
    if (deepLink == 'cart') {
      _switchTab(3);
      return;
    }
    if (deepLink == 'free_order') {
      _orderChannel = 'free_text';
      _switchTab(3);
      return;
    }
    if (deepLink == 'orders' || deepLink == 'profile' || deepLink == 'wallet') {
      _switchTab(4);
      _loadData();
      return;
    }
    if (deepLink == 'offers' || deepLink == 'promo') {
      _switchTab(5);
      return;
    }
    if (deepLink == 'support') {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => SupportScreen(
            api: api,
            customerName: _customerName,
            customerPhone: _customerPhone,
            customerEmail: _customerEmail,
          ),
        ),
      );
      return;
    }
    if (deepLink == 'pharmacy' ||
        deepLink == 'stores' ||
        deepLink == 'rides' ||
        deepLink == 'parcels' ||
        deepLink == 'market') {
      final sub = (deepLink == 'parcels' || deepLink == 'rides') ? 'rides_parcels' : deepLink;
      _switchTab(2, serviceSubView: sub);
      return;
    }
    _openNotifications();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    super.dispose();
  }

  void _connectRidesWs() {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    if (!api.hasTokens) return;
    try {
      _ridesWs = IOWebSocketChannel.connect(api.customerChannelWsUri(), headers: api.wsHeaders);
      _ridesSub = _ridesWs!.stream.listen((raw) {
        try {
          final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
          final type = payload['type']?.toString();
          if (type == 'notification:new') {
            final notif = payload['notification'];
            if (notif is Map) {
              CustomerPushNotificationService.instance.showSystemNotificationFromRecord(
                Map<String, dynamic>.from(notif),
                fallbackEmail: _customerEmail,
              );
            }
            _silentSync();
            return;
          }
          if (type == 'trip:accepted' ||
              type == 'trip:completed' ||
              type == 'trip:cancelled' ||
              type == 'trip:fare_updated' ||
              type == 'trip:status' ||
              type == 'rating:submitted') {
            _silentSync();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  Future<void> _showCaptainRatingDialog(Map<String, dynamic> target) async {
    int stars = 5;
    final commentCtrl = TextEditingController();
    bool submitting = false;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: Text('تقييم الطيار ${target['captain_name'] ?? ''} ⭐'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'عملية ${target['ref_number'] ?? ''} · اختر تقييمك من 1 إلى 5 نجوم',
                  style: const TextStyle(fontSize: 12.5),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (i) {
                    final s = i + 1;
                    return IconButton(
                      onPressed: () => setModalState(() => stars = s),
                      icon: Icon(
                        s <= stars ? Icons.star : Icons.star_border,
                        color: const Color(0xFFF59E0B),
                        size: 30,
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: commentCtrl,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'اكتب تعليقك عن الطيار (اختياري)',
                    isDense: true,
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: submitting ? null : () => Navigator.pop(ctx, false),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                onPressed: submitting
                    ? null
                    : () async {
                        setModalState(() => submitting = true);
                        try {
                          await api.submitRating(
                            ratingId: target['rating_id']?.toString(),
                            captainId: target['captain_id']?.toString(),
                            customerName: _customerName,
                            customerPhone: _customerPhone.isNotEmpty ? _customerPhone : null,
                            refType: target['ref_type']?.toString(),
                            refId: target['ref_id']?.toString(),
                            refNumber: target['ref_number']?.toString(),
                            finalAmount: (target['final_amount'] as num?)?.toDouble(),
                            rating: stars,
                            comment: commentCtrl.text.trim(),
                          );
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (e) {
                          setModalState(() => submitting = false);
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                        }
                      },
                child: Text(submitting ? 'جاري الإرسال...' : 'إرسال التقييم'),
              ),
            ],
          ),
        ),
      ),
    );
    commentCtrl.dispose();
    if (saved == true) {
      await _loadData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال تقييم الطيار بنجاح وظهوره في الإدارة ✓')),
        );
      }
    }
  }

  void _applyCustomerFromBootstrap(Map<String, dynamic> data) {
    final cust = data['customer'];
    if (cust is Map) {
      final wasUnverified = !_isEmailVerified;
      final nowVerified = cust['is_email_verified'] == true || cust['is_email_verified'] == 1;
      final name = cust['full_name']?.toString() ?? '';
      final email = cust['email']?.toString() ?? '';
      final phone = cust['phone']?.toString() ?? '';
      final addr = cust['address_landmark']?.toString() ?? '';
      final zoneId = cust['default_zone_id']?.toString() ?? '';
      if (name.isNotEmpty) _customerName = name;
      if (email.isNotEmpty) _customerEmail = email;
      _customerPhone = phone;
      _addressLandmark = addr;
      _isEmailVerified = nowVerified;
      if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
      api.persistUserSnapshot(Map<String, dynamic>.from(cust));
      if (wasUnverified && nowVerified && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم توثيق بريدك الإلكتروني بنجاح ✓')),
        );
      }

      final notifs = data['notifications'];
      if (notifs is List && notifs.isNotEmpty) {
        CustomerPushNotificationService.instance
            .syncUnreadNotificationsToStatusBar(
          notifs,
          customerEmail: _customerEmail,
          isEmailVerified: nowVerified,
        )
            .then((showedVerifyFromInbox) {
          if (showedVerifyFromInbox) {
            _verifyNotifShownForSession = true;
          } else if (!nowVerified) {
            _maybeTriggerEmailVerificationNotification();
          }
        });
      } else if (!nowVerified) {
        _maybeTriggerEmailVerificationNotification();
      }
    }
  }

  Future<void> _silentSync() async {
    if (_isGuest) return;
    try {
      final data = await api.bootstrap(lite: true);
      if (mounted) {
        setState(() {
          if (_bootstrap.isEmpty) {
            _bootstrap = Map<String, dynamic>.from(data);
          } else {
            _bootstrap = {
              ..._bootstrap,
              if (data.containsKey('customer')) 'customer': data['customer'],
              if (data.containsKey('orders')) 'orders': data['orders'],
              if (data.containsKey('trips')) 'trips': data['trips'],
              if (data.containsKey('parcels')) 'parcels': data['parcels'],
              if (data.containsKey('ratings')) 'ratings': data['ratings'],
              if (data.containsKey('pending_ratings')) 'pending_ratings': data['pending_ratings'],
              if (data.containsKey('wallet')) 'wallet': data['wallet'],
              if (data.containsKey('notifications')) 'notifications': data['notifications'],
            };
          }
          _applyCustomerFromBootstrap(data);
        });
      }
    } catch (_) {}
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    try {
      final data = _isGuest ? await api.guestBootstrap() : await api.bootstrap();
      if (mounted) {
        setState(() {
          _bootstrap = data;
          if (!_isGuest) {
            _applyCustomerFromBootstrap(data);
          }
          final merchants = ((data['merchants'] as List?) ?? [])
              .where((m) => m['merchant_type'] != 'pharmacy')
              .toList();
          if (_quickMerchantId.isEmpty && merchants.isNotEmpty) {
            _quickMerchantId = merchants.first['id'] as String;
          }
          _loading = false;
        });
      }
      _refreshStorefrontCategories();
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  void _enterGuestMode() {
    final wasAlreadyGuest = _isGuest && _bootstrap.isNotEmpty;
    setState(() {
      _isGuest = true;
      _isAuthenticated = false;
      _showAuthScreen = false;
      _needsProfileCompletion = false;
      if (!wasAlreadyGuest) {
        _customerName = 'زائر اطلبها';
        _customerEmail = '';
        _customerPhone = '';
      }
    });
    _persistNavState(guest: true);
    if (!wasAlreadyGuest) {
      _loadData();
    }
  }

  void _openAuthFromGuest() {
    setState(() {
      _showAuthScreen = true;
    });
  }

  void _onQuickAdd(Map<String, dynamic> product, int delta) {
    final prodId = (product['id'] ?? '').toString().trim();
    if (prodId.isEmpty) return;
    final merchId = (product['merchant_id'] ?? '').toString().trim();
    final current = _quickCart[prodId] ?? 0;
    final next = (current + delta).clamp(0, 99);
    setState(() {
      if (delta > 0) {
        if (merchId.isNotEmpty) _quickMerchantId = merchId;
        _orderChannel = 'catalog';
      }
      if (next == 0) {
        _quickCart.remove(prodId);
        _cartProductsCache.remove(prodId);
      } else {
        _quickCart[prodId] = next;
        _cartProductsCache[prodId] = Map<String, dynamic>.from(product);
      }
    });
  }

  String _currentZoneName() {
    final zones = ((_bootstrap['zones'] as List?) ?? []).whereType<Map>();
    for (final z in zones) {
      if ((z['id'] ?? '').toString() == _selectedZoneId) {
        return (z['name_ar'] ?? 'المنزلة').toString();
      }
    }
    if (zones.isNotEmpty) return (zones.first['name_ar'] ?? 'المنزلة').toString();
    return 'المنزلة';
  }

  void _selectStorefrontCategory(String categoryId, String categoryName) {
    setState(() {
      _storefrontCategoryId = categoryId;
      _storefrontCategoryName = categoryName;
      _storefrontBrand = '';
      _storefrontMerchantId = '';
      _storefrontMerchantName = '';
      _index = 0;
    });
    _persistNavState(tabIndex: 0);
  }

  void _selectStorefrontBrand(String brand) {
    setState(() {
      _storefrontBrand = brand;
      _storefrontCategoryId = '';
      _storefrontCategoryName = '';
      _storefrontMerchantId = '';
      _storefrontMerchantName = '';
      _index = 0;
    });
    _persistNavState(tabIndex: 0);
  }

  void _selectStorefrontMerchant(String merchantId, String merchantName) {
    setState(() {
      _storefrontMerchantId = merchantId;
      _storefrontMerchantName = merchantName;
      _storefrontCategoryId = '';
      _storefrontCategoryName = '';
      _storefrontBrand = '';
      _index = 0;
    });
    _persistNavState(tabIndex: 0);
  }

  void _clearStorefrontFilters() {
    setState(() {
      _storefrontCategoryId = '';
      _storefrontCategoryName = '';
      _storefrontBrand = '';
      _storefrontMerchantId = '';
      _storefrontMerchantName = '';
    });
  }

  void _openSmartSearch({String initialQuery = ''}) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => StorefrontSmartSearchScreen(
          api: api,
          cart: _quickCart,
          getCartCount: () => _quickCart.values.fold<int>(0, (sum, q) => sum + q),
          onAddProduct: _onQuickAdd,
          onOpenCart: () {
            setState(() => _index = 3);
            _persistNavState(tabIndex: 3);
          },
          onSelectBrand: _selectStorefrontBrand,
          onSelectStore: _selectStorefrontMerchant,
          initialQuery: initialQuery,
        ),
      ),
    );
  }

  void _openSmartAssistant() {
    showStorefrontAssistantSheet(
      context: context,
      api: api,
      getCartCount: () => _quickCart.values.fold<int>(0, (sum, q) => sum + q),
      onAddProduct: _onQuickAdd,
      onOpenCart: () {
        setState(() => _index = 3);
        _persistNavState(tabIndex: 3);
      },
      onOpenFreeOrder: () {
        setState(() {
          _orderChannel = 'free_text';
          _index = 3;
        });
        _persistNavState(tabIndex: 3);
      },
      onOpenService: (sub) {
        setState(() {
          _serviceSubView = sub;
          _index = 2;
        });
        _persistNavState(tabIndex: 2, subView: sub);
      },
      onSelectBrand: _selectStorefrontBrand,
      onSelectStore: _selectStorefrontMerchant,
    );
  }

  Future<void> _applyCouponFromOffers(String code) async {
    final products = (_bootstrap['products'] as List?) ?? [];
    final bootstrapById = {
      for (final p in products)
        if (p is Map && p['id'] != null) p['id'].toString(): Map<String, dynamic>.from(p),
    };
    double subtotal = 0;
    for (final entry in _quickCart.entries) {
      if (entry.value <= 0) continue;
      final p = _cartProductsCache[entry.key] ?? bootstrapById[entry.key];
      if (p != null) {
        subtotal += ((p['sale_price'] ?? p['base_price']) as num).toDouble() * entry.value;
      }
    }
    try {
      final res = await api.validateCoupon(code, subtotal > 0 ? subtotal : 150, 'stores');
      setState(() {
        _couponCode = '${res['code']}';
        _appliedDiscount = (res['discount_amount'] as num).toDouble();
        _index = 3; // Navigate directly to Cart
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم تطبيق كوبون ${res['code']} بخصم ${res['discount_amount']} ج.م')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _openNotifications() async {
    if (_isGuest) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('سجّل الدخول لعرض إشعاراتك الخاصة')),
      );
      _openAuthFromGuest();
      return;
    }
    _markAllLocalNotificationsRead();
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => NotificationsScreen(
          api: api,
          customerEmail: _customerEmail,
          onOpenVerifyEmail: () => _openExternalVerifyEmailPage(),
          onNotificationsRead: _markAllLocalNotificationsRead,
          onNotificationTap: (notif) => _handlePushNotificationTap(notif),
        ),
      ),
    );
    _loadData();
  }

  Future<void> _openOrderChat(String orderId) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => OrderChatScreen(
          api: api,
          orderId: orderId,
          customerName: _customerName,
        ),
      ),
    );
    _loadData();
  }

  Future<void> _openTripChat(String tripId) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => TripChatScreen(
          api: api,
          tripId: tripId,
          customerName: _customerName,
        ),
      ),
    );
    _loadData();
  }

  Future<void> _logout() async {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    final push = CustomerPushNotificationService.instance;
    final token = push.currentToken;
    final devId = push.deviceId;
    await push.unregisterOnLogout(api);
    await api.logout(fcmToken: token, deviceId: devId);
    await _persistNavState(guest: false, tabIndex: 0, subView: 'hub');
    if (!mounted) return;
    setState(() {
      _isAuthenticated = false;
      _isGuest = false;
      _showAuthScreen = true;
      _needsProfileCompletion = false;
      _isEmailVerified = true;
      _verifyNotifShownForSession = false;
      _currentUserSnapshot = {};
      _customerName = '';
      _customerEmail = '';
      _customerPhone = '';
      _addressLandmark = '';
      _bootstrap = {};
      _quickCart.clear();
      _cartProductsCache.clear();
      _index = 0;
    });
  }

  void _showLiveTrackingSheet() {
    final activeOrders = ((_bootstrap['orders'] as List?) ?? [])
        .where((o) => o['captain_id'] != null && o['status'] != 'delivered' && o['status'] != 'cancelled')
        .toList();
    final activeTrips = ((_bootstrap['trips'] as List?) ?? [])
        .where((t) => t['status'] != 'completed' && t['status'] != 'cancelled')
        .toList();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.navigation, color: Color(0xFFA92224)),
                        SizedBox(width: 8),
                        Text('تتبع GPS والشات المباشر مع الطيار', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                      ],
                    ),
                    IconButton(onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close)),
                  ],
                ),
                const SizedBox(height: 10),
                if (activeOrders.isEmpty && activeTrips.isEmpty)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7ED),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFFED7AA)),
                    ),
                    child: Column(
                      children: [
                        const Text('لا توجد طلبات أو مشاوير نشطة مع طيارين حاليًا.', style: TextStyle(fontSize: 13)),
                        const SizedBox(height: 10),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                          onPressed: () {
                            Navigator.pop(ctx);
                            setState(() {
                              _serviceSubView = 'rides_parcels';
                              _index = 2;
                            });
                          },
                          child: const Text('اطلب مشوار الآن'),
                        ),
                      ],
                    ),
                  ),
                ...activeOrders.map((o) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: Color(0xFFFFF7ED),
                          child: Icon(Icons.delivery_dining, color: Color(0xFFEA580C)),
                        ),
                        title: Text('${o['order_number']} · ${o['merchant_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                        subtitle: Text('الطيار: ${o['captain_name'] ?? 'الطيار'} · ${o['status']}'),
                        trailing: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                          onPressed: () {
                            Navigator.pop(ctx);
                            _openOrderChat(o['id'].toString());
                          },
                          icon: const Icon(Icons.chat, size: 15),
                          label: Text('الشات (${o['chat_count'] ?? 0})', style: const TextStyle(fontSize: 11)),
                        ),
                      ),
                    )),
                ...activeTrips.map((t) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: Color(0xFFF0FDFA),
                          child: Icon(Icons.directions_car, color: Color(0xFF0D9488)),
                        ),
                        title: Text('${t['trip_number']} · ${t['dropoff_address'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                        subtitle: Text(
                          t['captain_name'] != null
                              ? 'الطيار: ${t['captain_name']}'
                              : 'بانتظار قبول طيار · ${t['final_fare'] ?? t['customer_proposed_fare'] ?? t['estimated_fare']} ج.م',
                        ),
                        trailing: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                          onPressed: () {
                            Navigator.pop(ctx);
                            _openTripChat(t['id'].toString());
                          },
                          icon: const Icon(Icons.navigation, size: 15),
                          label: const Text('GPS والشات', style: TextStyle(fontSize: 11)),
                        ),
                      ),
                    )),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showCustomerSettingsSheet() {
    final zones = (_bootstrap['zones'] as List?) ?? [];
    final addressCtrl = TextEditingController(text: _addressLandmark);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 16,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.settings, color: Color(0xFFA92224)),
                          SizedBox(width: 8),
                          Text('إعدادات التطبيق والحساب', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(ctx),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (zones.isNotEmpty)
                    DropdownButtonFormField<String>(
                      value: zones.any((z) => z['id'] == _selectedZoneId) ? _selectedZoneId : zones.first['id']?.toString(),
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: 'منطقة التوصيل في المنزلة',
                        isDense: true,
                      ),
                      items: zones
                          .map((z) => DropdownMenuItem<String>(
                                value: z['id']?.toString(),
                                child: Text('${z['name_ar']} (+${z['remote_area_fee']} ج.م)', style: const TextStyle(fontSize: 13)),
                              ))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setState(() => _selectedZoneId = val);
                          setModalState(() {});
                        }
                      },
                    ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: addressCtrl,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'العنوان التفصيلي للتوصيل',
                      isDense: true,
                    ),
                    onChanged: (val) => setState(() => _addressLandmark = val),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'إعدادات إشعارات النظام (Android Push)',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                        ),
                        SwitchListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('صوت الإشعارات', style: TextStyle(fontSize: 13)),
                          value: CustomerPushNotificationService.instance.soundEnabled,
                          activeColor: const Color(0xFFA92224),
                          onChanged: (val) async {
                            await CustomerPushNotificationService.instance.setSoundEnabled(val);
                            setModalState(() {});
                          },
                        ),
                        SwitchListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('الاهتزاز عند وصول إشعار', style: TextStyle(fontSize: 13)),
                          value: CustomerPushNotificationService.instance.vibrationEnabled,
                          activeColor: const Color(0xFFA92224),
                          onChanged: (val) async {
                            await CustomerPushNotificationService.instance.setVibrationEnabled(val);
                            setModalState(() {});
                          },
                        ),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: () async {
                              final ok = await CustomerPushNotificationService.instance.requestPermission();
                              if (_isAuthenticated && !_isGuest) {
                                await CustomerPushNotificationService.instance.registerForAuthenticatedUser(api);
                              }
                              setModalState(() {});
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      ok
                                          ? 'صلاحية الإشعارات مفعّلة بنجاح'
                                          : 'يرجى تفعيل صلاحية الإشعارات من إعدادات الهاتف',
                                    ),
                                  ),
                                );
                              }
                            },
                            icon: const Icon(Icons.notifications_active_outlined, size: 16),
                            label: const Text('فحص وتفعيل صلاحية الإشعارات', style: TextStyle(fontSize: 12)),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.pop(ctx);
                            _loadData();
                          },
                          icon: const Icon(Icons.refresh, size: 17),
                          label: const Text('تحديث البيانات'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFA92224),
                            foregroundColor: Colors.white,
                          ),
                          onPressed: () {
                            Navigator.pop(ctx);
                            setState(() => _index = 4);
                          },
                          icon: const Icon(Icons.person_outline, size: 17),
                          label: const Text('الملف الشخصي'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      style: TextButton.styleFrom(
                        foregroundColor: _isGuest ? const Color(0xFFA92224) : Colors.red.shade700,
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        if (_isGuest) {
                          _openAuthFromGuest();
                        } else {
                          _logout();
                        }
                      },
                      icon: Icon(_isGuest ? Icons.login : Icons.logout, size: 18),
                      label: Text(_isGuest ? 'تسجيل الدخول أو إنشاء حساب' : 'تسجيل الخروج'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ).whenComplete(() => addressCtrl.dispose());
  }

  @override
  Widget build(BuildContext context) {
    if (_showAuthScreen || (!_isAuthenticated && !_isGuest)) {
      return PopScope(
        canPop: !_isGuest,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          if (_isGuest && _showAuthScreen) {
            setState(() => _showAuthScreen = false);
          }
        },
        child: Directionality(
          textDirection: TextDirection.rtl,
          child: CustomerOtpLoginScreen(
            api: api,
            openedFromGuest: _isGuest,
            onContinueAsGuest: _enterGuestMode,
            onVerified: (user) {
              final wasGuest = _isGuest;
              final needsProfile = _checkNeedsProfileCompletion(user);
              setState(() {
                _isAuthenticated = true;
                _isGuest = false;
                _showAuthScreen = false;
                _needsProfileCompletion = needsProfile;
                _isEmailVerified = user['is_email_verified'] == true || user['is_email_verified'] == 1;
                _verifyNotifShownForSession = false;
                _currentUserSnapshot = Map<String, dynamic>.from(user);
                _customerEmail = user['email']?.toString() ?? '';
                _customerName = user['full_name']?.toString() ?? '';
                _customerPhone = user['phone']?.toString() ?? '';
                _addressLandmark = user['address_landmark']?.toString() ?? '';
                final zoneId = user['default_zone_id']?.toString() ?? '';
                if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
                if (!wasGuest) _index = 0;
              });
              api.persistUserSnapshot(user);
              _persistNavState(guest: false, tabIndex: _index);
              if (!needsProfile) {
                _connectRidesWs();
                _loadData();
                CustomerPushNotificationService.instance.registerForAuthenticatedUser(api);
                _maybeTriggerEmailVerificationNotification();
                if (_pendingPushTap != null) {
                  final pending = _pendingPushTap!;
                  _pendingPushTap = null;
                  WidgetsBinding.instance.addPostFrameCallback((_) => _handlePushNotificationTap(pending));
                }
              }
            },
          ),
        ),
      );
    }

    if (_isAuthenticated && !_isGuest && _needsProfileCompletion) {
      return CompleteProfileScreen(
        api: api,
        initialUser: _currentUserSnapshot,
        onLogout: _logout,
        onCompleted: (updatedUser) {
          setState(() {
            _needsProfileCompletion = false;
            _isEmailVerified = updatedUser['is_email_verified'] == true || updatedUser['is_email_verified'] == 1;
            _currentUserSnapshot = Map<String, dynamic>.from(updatedUser);
            _customerName = updatedUser['full_name']?.toString() ?? _customerName;
            _customerPhone = updatedUser['phone']?.toString() ?? _customerPhone;
            _addressLandmark = updatedUser['address_landmark']?.toString() ?? _addressLandmark;
            final zoneId = updatedUser['default_zone_id']?.toString() ?? '';
            if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
          });
          api.persistUserSnapshot(updatedUser);
          _connectRidesWs();
          _loadData();
          CustomerPushNotificationService.instance.registerForAuthenticatedUser(api);
          _maybeTriggerEmailVerificationNotification();
          if (_pendingPushTap != null) {
            final pending = _pendingPushTap!;
            _pendingPushTap = null;
            WidgetsBinding.instance.addPostFrameCallback((_) => _handlePushNotificationTap(pending));
          }
        },
      );
    }

    final unread = ((_bootstrap['notifications'] as List?) ?? [])
        .where((n) => n['is_read'] != true)
        .length;
    final cartTotalQty = _quickCart.values.fold<int>(0, (sum, q) => sum + q);

    final screens = [
      HomeScreen(
        api: api,
        bootstrap: _bootstrap,
        selectedZoneId: _selectedZoneId,
        onChangeZone: (zId) => setState(() => _selectedZoneId = zId),
        cart: _quickCart,
        cartProductsCache: _cartProductsCache,
        storefrontFilter: _storefrontFilter,
        selectedCategoryId: _storefrontCategoryId,
        selectedCategoryName: _storefrontCategoryName,
        selectedBrand: _storefrontBrand,
        selectedMerchantId: _storefrontMerchantId,
        selectedMerchantName: _storefrontMerchantName,
        onChangeFilter: (f) => setState(() => _storefrontFilter = f),
        onSelectCategory: _selectStorefrontCategory,
        onSelectBrand: _selectStorefrontBrand,
        onSelectMerchant: _selectStorefrontMerchant,
        onClearAllFilters: _clearStorefrontFilters,
        onCategoriesLoaded: (cats) {
          if (mounted) {
            setState(() => _storefrontCategories = cats);
          }
        },
        onOpenSearch: () => _openSmartSearch(),
        onAddProduct: _onQuickAdd,
        onOpenCart: () => _switchTab(3),
        onOpenFreeOrderCart: () {
          _orderChannel = 'free_text';
          _switchTab(3);
        },
        onOpenService: (sub) => _switchTab(2, serviceSubView: sub),
        onOpenOffers: () => _switchTab(5),
        onRateCaptain: _showCaptainRatingDialog,
      ),
      StorefrontCategoriesScreen(
        key: _categoriesKey,
        api: api,
        categories: _storefrontCategories,
        zoneName: _currentZoneName(),
        cart: _quickCart,
        onOpenSearch: () => _openSmartSearch(),
        onAddProduct: _onQuickAdd,
        onOpenCart: () => _switchTab(3),
        onSelectBrand: _selectStorefrontBrand,
        onSelectMerchant: _selectStorefrontMerchant,
        onRefreshCategories: _refreshStorefrontCategories,
        onSelectGroup: (groupKey) {
          setState(() {
            _clearStorefrontFilters();
            _storefrontFilter = groupKey == 'fresh' ? 'fresh' : 'groceries';
            _index = 0;
          });
          _persistNavState(tabIndex: 0);
        },
      ),
      ServicesHubScreen(
        api: api,
        bootstrap: _bootstrap,
        cart: _quickCart,
        cartProductsCache: _cartProductsCache,
        onAddProduct: _onQuickAdd,
        onOpenCart: () => _switchTab(3),
        onRefresh: _loadData,
        activeSubView: _serviceSubView,
        onSelectSubView: (sub) {
          setState(() => _serviceSubView = sub);
          _persistNavState(subView: sub);
        },
        onOpenFreeOrderCart: () {
          _orderChannel = 'free_text';
          _switchTab(3);
        },
        customerName: _customerName,
        customerPhone: _customerPhone,
        selectedZoneId: _selectedZoneId,
        addressLandmark: _addressLandmark,
        onOpenTripChat: _openTripChat,
      ),
      CartScreen(
        api: api,
        bootstrap: _bootstrap,
        cart: _quickCart,
        cartProductsCache: _cartProductsCache,
        selectedMerchantId: _quickMerchantId,
        selectedZoneId: _selectedZoneId,
        customerName: _customerName,
        customerPhone: _customerPhone,
        addressLandmark: _addressLandmark,
        orderChannel: _orderChannel,
        couponCode: _couponCode,
        appliedDiscount: _appliedDiscount,
        onAddProduct: _onQuickAdd,
        onSelectMerchant: (mId) => setState(() => _quickMerchantId = mId),
        onSelectZone: (zId) => setState(() => _selectedZoneId = zId),
        onSelectChannel: (ch) => setState(() => _orderChannel = ch),
        onApplyCouponState: (code, disc) => setState(() {
          _couponCode = code;
          _appliedDiscount = disc;
        }),
        onClearCart: () => setState(() {
          _quickCart.clear();
          _cartProductsCache.clear();
        }),
        onOrderPlaced: () async {
          await _loadData();
          if (mounted) _switchTab(4);
        },
        onBrowseHome: () => _switchTab(0),
        isGuest: _isGuest,
        onRequireAuth: _openAuthFromGuest,
      ),
      ProfileScreen(
        bootstrap: _bootstrap,
        customerEmail: _customerEmail,
        customerName: _customerName,
        customerPhone: _customerPhone,
        addressLandmark: _addressLandmark,
        isGuest: _isGuest,
        onRequireAuth: _openAuthFromGuest,
        onSaveProfile: (n, p, a) async {
          final res = await api.updateProfile(
            fullName: n,
            phone: p,
            addressLandmark: a,
            defaultZoneId: _selectedZoneId,
          );
          final updated = res['customer'];
          if (mounted) {
            setState(() {
              if (updated is Map) {
                _customerName = updated['full_name']?.toString() ?? n;
                _customerPhone = updated['phone']?.toString() ?? p;
                _addressLandmark = updated['address_landmark']?.toString() ?? a;
                final z = updated['default_zone_id']?.toString() ?? '';
                if (z.isNotEmpty) _selectedZoneId = z;
              } else {
                if (n.isNotEmpty) _customerName = n;
                _customerPhone = p;
                _addressLandmark = a;
              }
            });
          }
          await _silentSync();
        },
        onOpenNotifications: _openNotifications,
        onOpenOffers: () => _switchTab(5),
        onOpenOrderChat: _openOrderChat,
        onOpenTripChat: _openTripChat,
        onRateCaptain: _showCaptainRatingDialog,
        onLogout: _logout,
      ),
      OffersScreen(
        api: api,
        bootstrap: _bootstrap,
        cart: _quickCart,
        onAddProduct: _onQuickAdd,
        onApplyCoupon: _applyCouponFromOffers,
      ),
    ];

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _handleSystemBack();
      },
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          key: _scaffoldKey,
          drawer: _buildCustomerDrawer(context),
        appBar: AppBar(
          automaticallyImplyLeading: false,
          flexibleSpace: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerRight,
                end: Alignment.centerLeft,
                colors: [Color(0xFF9E1C1E), Color(0xFFB52325), Color(0xFFC8431D)],
              ),
              border: Border(
                bottom: BorderSide(color: Color(0xFFF5A623), width: 2),
              ),
            ),
          ),
          title: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(2),
                  child: Image.asset('assets/images/otlobha_logo.jpg', width: 34, height: 34, fit: BoxFit.contain),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'اطلبها – المنزلة',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
          actions: [
            Builder(
              builder: (_) {
                final liveCount = ((_bootstrap['orders'] as List?) ?? [])
                        .where((o) => o['captain_id'] != null && o['status'] != 'delivered' && o['status'] != 'cancelled')
                        .length +
                    ((_bootstrap['trips'] as List?) ?? [])
                        .where((t) => t['status'] != 'completed' && t['status'] != 'cancelled')
                        .length;
                return IconButton(
                  onPressed: _showLiveTrackingSheet,
                  tooltip: 'تتبع GPS والشات مع الطيار',
                  icon: Badge(
                    backgroundColor: const Color(0xFF10B981),
                    textColor: Colors.white,
                    isLabelVisible: liveCount > 0,
                    label: Text('$liveCount'),
                    child: const Icon(Icons.navigation_outlined),
                  ),
                );
              },
            ),
            IconButton(
              onPressed: _openNotifications,
              tooltip: 'الإشعارات',
              icon: Badge(
                backgroundColor: const Color(0xFFF5A623),
                textColor: Colors.black,
                isLabelVisible: unread > 0,
                label: Text('$unread'),
                child: const Icon(Icons.notifications_outlined),
              ),
            ),
            Builder(
              builder: (ctx) => IconButton(
                onPressed: () => Scaffold.of(ctx).openDrawer(),
                tooltip: 'القائمة الجانبية',
                icon: const Icon(Icons.menu),
              ),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  if (_isAuthenticated && !_isGuest && !_isEmailVerified && _customerEmail.trim().isNotEmpty)
                    Material(
                      color: const Color(0xFFFFF7ED),
                      child: InkWell(
                        onTap: () => _openExternalVerifyEmailPage(),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: const BoxDecoration(
                            border: Border(bottom: BorderSide(color: Color(0xFFFED7AA))),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.mark_email_unread_outlined, color: Color(0xFFC2410C), size: 20),
                              const SizedBox(width: 10),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      'وثّق بريدك الإلكتروني الآن',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w800,
                                        fontSize: 12.5,
                                        color: Color(0xFF9A3412),
                                      ),
                                    ),
                                    Text(
                                      'اضغط هنا لفتح صفحة التوثيق وإدخال الرمز',
                                      style: TextStyle(fontSize: 11, color: Color(0xFF7C2D12)),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFA92224),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Text(
                                  'توثيق الآن',
                                  style: TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  Expanded(child: IndexedStack(index: _index, children: screens)),
                ],
              ),
        bottomNavigationBar: _buildCustomerBottomBar(cartTotalQty),
      ),
      ),
    );
  }

  Widget _buildCustomerDrawer(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerRight,
                  end: Alignment.centerLeft,
                  colors: [Color(0xFF9E1C1E), Color(0xFFB52325), Color(0xFFC8431D)],
                ),
              ),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      color: Colors.white,
                      padding: const EdgeInsets.all(2),
                      child: Image.asset('assets/images/otlobha_logo.jpg', width: 42, height: 42, fit: BoxFit.contain),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isGuest ? 'زائر اطلبها' : _customerName,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                        Text(
                          _isGuest
                              ? 'تصفح كزائر · سجّل لإتمام الطلبات'
                              : (_customerPhone.isNotEmpty ? _customerPhone : _customerEmail),
                          style: const TextStyle(color: Color(0xFFFDE68A), fontSize: 11),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 14, 16, 4),
              child: Text('التسوق الذكي والخدمات', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.search_rounded, color: Color(0xFFA92224)),
              title: const Text('البحث الذكي ومقارنة الأسعار', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _openSmartSearch();
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.auto_awesome_rounded, color: Color(0xFFD97706)),
              title: const Text('مساعد اطلبها الذكي', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _openSmartAssistant();
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.category_rounded, color: Color(0xFFA92224)),
              title: const Text('الأقسام الرئيسية والفرعية', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(1);
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.local_offer_rounded, color: Color(0xFF7C3AED)),
              title: const Text('العروض والكوبونات', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(5);
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.grid_view_rounded, color: Color(0xFFA92224)),
              title: const Text('مركز كل الخدمات', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(2, serviceSubView: 'hub');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.storefront, color: Color(0xFFEA580C)),
              title: const Text('المتاجر والمطاعم المعتمدة', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(2, serviceSubView: 'stores');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.medication, color: Color(0xFF0D9488)),
              title: const Text('الصيدلية والروشتة', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(2, serviceSubView: 'pharmacy');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.directions_car, color: Color(0xFFD97706)),
              title: const Text('مشوار أو طرد', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(2, serviceSubView: 'rides_parcels');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.shopping_bag, color: Color(0xFF4F46E5)),
              title: const Text('سوق اطلبها', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _switchTab(2, serviceSubView: 'market');
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.edit_note, color: Color(0xFFE11D48)),
              title: const Text('طلب نصي حر', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                _orderChannel = 'free_text';
                _switchTab(3);
              },
            ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 6, 16, 4),
              child: Text('الدعم والمساعدة', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
            ),
            ListTile(
              leading: const Icon(Icons.support_agent, color: Color(0xFFA92224)),
              title: const Text('تواصل مع الدعم والإدارة', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFA92224))),
              subtitle: const Text('أرسل استفسارك وتابع رد الإدارة', style: TextStyle(fontSize: 11)),
              onTap: () {
                Navigator.pop(context);
                if (_isGuest) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('يرجى تسجيل الدخول أولًا للتواصل مع الدعم الفني')),
                  );
                  _openAuthFromGuest();
                  return;
                }
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => SupportScreen(
                      api: api,
                      customerName: _customerName,
                      customerPhone: _customerPhone,
                      customerEmail: _customerEmail,
                    ),
                  ),
                );
              },
            ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 6, 16, 4),
              child: Text('الإعدادات والحساب', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.settings_outlined),
              title: const Text('إعدادات المنطقة والعنوان'),
              onTap: () {
                Navigator.pop(context);
                _showCustomerSettingsSheet();
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.person_outline),
              title: const Text('حسابي وطلباتي'),
              onTap: () {
                Navigator.pop(context);
                setState(() => _index = 4);
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.refresh),
              title: const Text('تحديث البيانات'),
              onTap: () {
                Navigator.pop(context);
                _loadData();
              },
            ),
            ListTile(
              dense: true,
              leading: Icon(_isGuest ? Icons.login : Icons.logout, color: _isGuest ? const Color(0xFFA92224) : Colors.red.shade700),
              title: Text(
                _isGuest ? 'تسجيل الدخول أو إنشاء حساب' : 'تسجيل الخروج',
                style: TextStyle(color: _isGuest ? const Color(0xFFA92224) : Colors.red.shade700, fontWeight: FontWeight.bold),
              ),
              onTap: () {
                Navigator.pop(context);
                if (_isGuest) {
                  _openAuthFromGuest();
                } else {
                  _logout();
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomerBottomBar(int cartTotalQty) {
    Widget sideTab({
      required int idx,
      required IconData icon,
      required IconData activeIcon,
      required String label,
      int badge = 0,
    }) {
      final active = _index == idx;
      return Expanded(
        child: InkWell(
          onTap: () => _switchTab(idx),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Badge(
                  backgroundColor: const Color(0xFFA92224),
                  isLabelVisible: badge > 0,
                  label: Text('$badge'),
                  child: Icon(
                    active ? activeIcon : icon,
                    size: 23,
                    color: active ? const Color(0xFFA92224) : const Color(0xFF475569),
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: active ? FontWeight.bold : FontWeight.w500,
                    color: active ? const Color(0xFFA92224) : const Color(0xFF475569),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
        boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 12, offset: Offset(0, -3))],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              sideTab(idx: 0, icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'الرئيسية'),
              sideTab(idx: 1, icon: Icons.category_outlined, activeIcon: Icons.category_rounded, label: 'الأقسام'),
              Expanded(
                child: GestureDetector(
                  onTap: _openSmartAssistant,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Transform.translate(
                        offset: const Offset(0, -10),
                        child: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              begin: Alignment.topRight,
                              end: Alignment.bottomLeft,
                              colors: [Color(0xFFA92224), Color(0xFF86191B), Color(0xFFF5A623)],
                            ),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: Colors.white,
                              width: 3,
                            ),
                            boxShadow: const [
                              BoxShadow(color: Color(0x3DA92224), blurRadius: 12, offset: Offset(0, 4)),
                            ],
                          ),
                          child: const Icon(Icons.auto_awesome_rounded, color: Colors.white, size: 25),
                        ),
                      ),
                      Transform.translate(
                        offset: const Offset(0, -6),
                        child: const Text(
                          'المساعد',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFA92224),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              sideTab(
                idx: 3,
                icon: Icons.shopping_cart_outlined,
                activeIcon: Icons.shopping_cart_rounded,
                label: 'السلة',
                badge: cartTotalQty,
              ),
              sideTab(idx: 4, icon: Icons.person_outline_rounded, activeIcon: Icons.person_rounded, label: 'حسابي'),
            ],
          ),
        ),
      ),
    );
  }
}
