import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'core/api_client.dart';
import 'core/push_notification_service.dart';
import 'screens/captain_home_screen.dart';
import 'screens/captain_login_screen.dart';
import 'screens/captain_orders_screen.dart';
import 'screens/captain_order_chat_screen.dart';
import 'screens/captain_pos_screen.dart';
import 'screens/captain_settlement_screen.dart';
import 'screens/captain_profile_screen.dart';
import 'screens/captain_trip_chat_screen.dart';
import 'screens/register_kyc_screen.dart';

class _OtlobhaHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    client.connectionTimeout = const Duration(seconds: 10);
    client.idleTimeout = const Duration(seconds: 8);
    client.maxConnectionsPerHost = 6;
    return client;
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = _OtlobhaHttpOverrides();
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp().timeout(const Duration(seconds: 3));
    }
    FirebaseMessaging.onBackgroundMessage(otlobhaCaptainBackgroundHandler);
  } catch (e) {
    debugPrint('[CaptainMain] Firebase pre-init skipped: $e');
  }
  runApp(const OtlobhaCaptainApp());
}

typedef MyApp = OtlobhaCaptainApp;

class OtlobhaCaptainApp extends StatelessWidget {
  const OtlobhaCaptainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'اطلبها كابتن – Otlobha Captain',
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
      home: const CaptainShell(),
    );
  }
}

class CaptainShell extends StatefulWidget {
  const CaptainShell({super.key});

  @override
  State<CaptainShell> createState() => _CaptainShellState();
}

class _CaptainShellState extends State<CaptainShell> with WidgetsBindingObserver {
  final OtlobhaCaptainApi api = OtlobhaCaptainApi();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final List<int> _tabHistory = <int>[];
  DateTime? _lastBackPressAt;
  int _index = 0; // 0: الرئيسية | 1: أوردرات اليوم | 2: نقطة البيع POS | 3: التسوية | 4: الملف الشخصي
  String _ordersInitialFilter = 'all';
  String? _activeCaptainId;
  Map<String, dynamic>? _activeCaptain;
  bool _loading = true;
  List<dynamic> _orders = [];
  List<dynamic> _parcels = [];
  List<dynamic> _trips = [];
  List<dynamic> _notifications = [];
  List<dynamic> _settlements = [];
  Timer? _pollTimer;
  Timer? _gpsTimer;
  WebSocketChannel? _ridesWs;
  StreamSubscription? _ridesSub;
  Map<String, dynamic>? _pendingPushTap;
  int _loadSeq = 0;

  static const String _prefTabIndex = 'otlobha_cap_tab_index';

  void _switchTab(int nextIndex, {String? ordersFilter, bool recordHistory = true}) {
    final prevIndex = _index;
    setState(() {
      if (recordHistory && prevIndex != nextIndex) {
        if (_tabHistory.isEmpty || _tabHistory.last != prevIndex) {
          _tabHistory.add(prevIndex);
          if (_tabHistory.length > 20) _tabHistory.removeAt(0);
        }
      }
      if (ordersFilter != null) {
        _ordersInitialFilter = ordersFilter;
      }
      _index = nextIndex;
    });
    _persistTabIndex(nextIndex);
  }

  void _handleSystemBack() {
    if (_scaffoldKey.currentState?.isDrawerOpen == true) {
      Navigator.of(context).pop();
      return;
    }

    if (_index == 1 && _ordersInitialFilter != 'all') {
      setState(() => _ordersInitialFilter = 'all');
      return;
    }

    while (_tabHistory.isNotEmpty) {
      final prev = _tabHistory.removeLast();
      if (prev != _index) {
        setState(() => _index = prev);
        _persistTabIndex(prev);
        return;
      }
    }

    if (_index != 0) {
      setState(() => _index = 0);
      _persistTabIndex(0);
      return;
    }

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

  void _startForegroundTimers() {
    _pollTimer?.cancel();
    _gpsTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 25), (_) => _silentSync());
    _gpsTimer = Timer.periodic(const Duration(seconds: 20), (_) => _pushCaptainGps());
  }

  void _stopForegroundTimers() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _gpsTimer?.cancel();
    _gpsTimer = null;
  }

  void _closeRidesWs() {
    _ridesSub?.cancel();
    _ridesSub = null;
    try {
      _ridesWs?.sink.close();
    } catch (_) {}
    _ridesWs = null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restorePersistedSession();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(
        CaptainPushNotificationService.instance
            .initialize(
              onNotificationTap: _handlePushNotificationTap,
              onForegroundNotification: () {
                if (_activeCaptainId != null) _silentSync();
              },
            )
            .then((_) {
          if (mounted) {
            unawaited(CaptainPushNotificationService.instance.requestPermission());
          }
        }),
      );
    });
    _startForegroundTimers();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final push = CaptainPushNotificationService.instance;
    if (state == AppLifecycleState.inactive) {
      push.scheduleNativeBackgroundSync(fastCheck: true);
      return;
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      _stopForegroundTimers();
      _closeRidesWs();
      push.scheduleNativeBackgroundSync(fastCheck: true);
      return;
    }
    if (state == AppLifecycleState.resumed) {
      api.resetConnectionPool();
      _startForegroundTimers();
      push.refreshShownIdsFromStorage();
      if (_activeCaptainId != null && api.hasTokens) {
        unawaited(
          api.reloadTokensFromStorage().then((_) {
            if (!mounted || _activeCaptainId == null || !api.hasTokens) return;
            _connectRidesWs();
            if (_loading || _activeCaptain == null) {
              _loadAll();
            } else {
              _silentSync();
            }
            if (push.currentToken == null || !push.isTokenSynced) {
              push.registerForAuthenticatedCaptain(api);
            }
          }),
        );
      }
    }
  }

  Future<void> _persistTabIndex(int idx) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_prefTabIndex, idx);
    } catch (_) {}
  }

  Future<void> _restorePersistedSession() async {
    try {
      final prefs = await SharedPreferences.getInstance().timeout(const Duration(seconds: 3));
      final savedId = await api.restorePersistedSession();
      final cachedCap = await api.restoreCaptainSnapshot();
      final savedTab = prefs.getInt(_prefTabIndex) ?? 0;
      final kycDraftActive = prefs.getBool(RegisterKycScreen.prefDraftActive) ?? false;

      if (!mounted) return;
      if (savedId != null && savedId.isNotEmpty) {
        setState(() {
          _activeCaptainId = savedId;
          if (cachedCap != null) {
            _activeCaptain = cachedCap;
            _loading = false;
          }
          _index = savedTab.clamp(0, 4);
        });
        _connectRidesWs();
        unawaited(_loadAll());
        _pushCaptainGps();
        unawaited(CaptainPushNotificationService.instance.registerForAuthenticatedCaptain(api));
        return;
      }

      setState(() => _loading = false);

      // If Android killed the Activity during first-time camera capture in KYC registration,
      // automatically reopen RegisterKycScreen with the saved form & captured photos!
      if (kycDraftActive && mounted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted || _activeCaptainId != null) return;
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => Directionality(
                textDirection: TextDirection.rtl,
                child: RegisterKycScreen(
                  api: api,
                  onRegistered: (newId) {
                    if (Navigator.of(context).canPop()) {
                      Navigator.of(context).pop();
                    }
                    _onCaptainLoggedIn(newId);
                  },
                ),
              ),
            ),
          );
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onCaptainLoggedIn(String id) {
    setState(() {
      _activeCaptainId = id;
      _index = 0;
    });
    api.persistActiveCaptainId(id);
    _persistTabIndex(0);
    _connectRidesWs();
    _loadAll();
    _pushCaptainGps();
    CaptainPushNotificationService.instance.registerForAuthenticatedCaptain(api);
    if (_pendingPushTap != null) {
      final pending = _pendingPushTap!;
      _pendingPushTap = null;
      WidgetsBinding.instance.addPostFrameCallback((_) => _handlePushNotificationTap(pending));
    }
  }

  void _markLocalNotificationRead(String notifId) {
    final cleanId = notifId.trim();
    if (cleanId.isEmpty) return;
    if (!mounted) return;
    setState(() {
      _notifications = _notifications.map((raw) {
        if (raw is Map && (raw['id']?.toString().trim() ?? '') == cleanId) {
          return <String, dynamic>{...Map<String, dynamic>.from(raw), 'is_read': true};
        }
        return raw;
      }).toList();
    });
  }

  void _markAllLocalNotificationsRead() {
    if (!mounted) return;
    setState(() {
      _notifications = _notifications.map((raw) {
        if (raw is Map) {
          return <String, dynamic>{...Map<String, dynamic>.from(raw), 'is_read': true};
        }
        return raw;
      }).toList();
    });
  }

  void _handlePushNotificationTap(Map<String, dynamic> data) {
    if (!mounted) return;
    final capId = _activeCaptainId;
    if (capId == null) {
      _pendingPushTap = data;
      return;
    }

    final rawDeepLink = (data['deep_link'] ?? '').toString().trim();
    final deepLink = rawDeepLink.toLowerCase();
    final orderId = (data['order_id'] ?? '').toString().trim();
    final tripId = (data['trip_id'] ?? '').toString().trim();
    final notifId = (data['notification_id'] ?? data['id'] ?? '').toString().trim();
    final capName = (_activeCaptain?['full_name'] ?? 'الكابتن').toString();

    if (notifId.isNotEmpty) {
      _markLocalNotificationRead(notifId);
      api.markNotificationRead(notifId).catchError((_) {});
    }

    if (deepLink == 'order_chat' && orderId.isNotEmpty) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CaptainOrderChatScreen(
            api: api,
            orderId: orderId,
            captainId: capId,
            captainName: capName,
          ),
        ),
      ).then((_) => _loadAll());
      return;
    }
    if ((deepLink == 'trip_chat' || deepLink == 'trip') && tripId.isNotEmpty) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CaptainTripChatScreen(
            api: api,
            tripId: tripId,
            captainId: capId,
            captainName: capName,
          ),
        ),
      ).then((_) => _loadAll());
      return;
    }
    if (deepLink == 'home') {
      _switchTab(0);
      return;
    }
    if (deepLink == 'order' ||
        deepLink == 'orders' ||
        deepLink == 'parcels' ||
        deepLink == 'rides' ||
        deepLink == 'stores' ||
        deepLink == 'pharmacy' ||
        deepLink == 'market') {
      _switchTab(1, ordersFilter: 'all');
      _loadAll();
      return;
    }
    if (deepLink == 'pos') {
      _switchTab(2);
      return;
    }
    if (deepLink == 'wallet' || deepLink == 'settlement') {
      _switchTab(3);
      _loadAll();
      return;
    }
    if (deepLink == 'profile' || deepLink == 'kyc_upload') {
      _switchTab(4);
      _loadAll();
      return;
    }
    if (deepLink.startsWith('url:')) {
      final urlStr = rawDeepLink.substring(4).trim();
      if (urlStr.isNotEmpty) {
        Clipboard.setData(ClipboardData(text: urlStr));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم نسخ الرابط: $urlStr')),
        );
        return;
      }
    }
    _showNotificationsSheet();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopForegroundTimers();
    _closeRidesWs();
    super.dispose();
  }

  void _connectRidesWs() {
    _closeRidesWs();
    final capId = _activeCaptainId;
    if (capId == null || !api.hasTokens) return;
    try {
      final isApproved = _activeCaptain?['verification_status'] == 'approved';
      final wsUri = isApproved ? api.ridesChannelWsUri() : api.captainChannelWsUri(capId);
      _ridesWs = IOWebSocketChannel.connect(wsUri, headers: api.wsHeaders);
      _ridesSub = _ridesWs!.stream.listen((raw) {
        try {
          final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
          final type = payload['type']?.toString();
          if (type == 'notification:new' && payload['notification'] is Map) {
            final notifMap = Map<String, dynamic>.from(payload['notification'] as Map);
            CaptainPushNotificationService.instance.showSystemNotificationFromRecord(notifMap);
            _silentSync();
            return;
          }
          if (type == 'trip:created' ||
              type == 'trip:accepted' ||
              type == 'trip:status' ||
              type == 'trip:fare_updated' ||
              type == 'trip:completed' ||
              type == 'trip:cancelled' ||
              type == 'order:created' ||
              type == 'order:status' ||
              type == 'order:assigned' ||
              type == 'rating:submitted') {
            _silentSync();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  Future<void> _pushCaptainGps() async {
    final capId = _activeCaptainId;
    if (capId == null || !api.hasTokens) return;
    if (_activeCaptain == null || _activeCaptain!['availability_status'] != 'available') return;
    try {
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.always || perm == LocationPermission.whileInUse) {
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
        );
        await api.updateCaptainLocation(capId, pos.latitude, pos.longitude);
      }
    } catch (_) {}
  }

  Future<void> _fetchDashboardParallel({required bool isInitial}) async {
    final seq = ++_loadSeq;
    final selectedId = _activeCaptainId ?? '';
    if (selectedId.isEmpty || !api.hasTokens) {
      if (mounted && _loading) setState(() => _loading = false);
      return;
    }

    if (isInitial && _activeCaptain == null && mounted && !_loading) {
      setState(() => _loading = true);
    }

    try {
      final results = await Future.wait<dynamic>([
        api.getMe().timeout(const Duration(seconds: 18)).catchError((_) => <String, dynamic>{}),
        api.getOrders().timeout(const Duration(seconds: 18)).catchError((_) => _orders),
        api.getParcels().timeout(const Duration(seconds: 18)).catchError((_) => _parcels),
        api.getTrips().timeout(const Duration(seconds: 18)).catchError((_) => _trips),
        api
            .getSettlements(selectedId)
            .timeout(const Duration(seconds: 18))
            .catchError((_) => <String, dynamic>{'settlements': _settlements}),
        selectedId.isNotEmpty
            ? api.getNotifications(selectedId).timeout(const Duration(seconds: 18)).catchError((_) => _notifications)
            : Future.value(<dynamic>[]),
      ]);

      if (!mounted || seq != _loadSeq) return;

      final meRes = results[0] is Map ? Map<String, dynamic>.from(results[0] as Map) : <String, dynamic>{};
      final user = meRes['user'];
      final orders = results[1] is List ? results[1] as List<dynamic> : _orders;
      final parcels = results[2] is List ? results[2] as List<dynamic> : _parcels;
      final trips = results[3] is List ? results[3] as List<dynamic> : _trips;
      final settlementsRes = results[4] is Map ? Map<String, dynamic>.from(results[4] as Map) : <String, dynamic>{};
      final notifs = results[5] is List ? results[5] as List<dynamic> : _notifications;

      final prevApproved = _activeCaptain?['verification_status'] == 'approved';
      final nextCap = user is Map ? Map<String, dynamic>.from(user) : _activeCaptain;
      if (user is Map) {
        unawaited(api.persistCaptainSnapshot(Map<String, dynamic>.from(user)));
      }
      final nextApproved = nextCap?['verification_status'] == 'approved';

      setState(() {
        if (nextCap != null) _activeCaptain = nextCap;
        _parcels = parcels;
        _trips = trips;
        _orders = orders;
        _settlements = (settlementsRes['settlements'] as List?) ?? _settlements;
        _notifications = notifs;
        _loading = false;
      });

      if (_ridesWs == null || prevApproved != nextApproved) {
        _connectRidesWs();
      }
      if (!isInitial) {
        CaptainPushNotificationService.instance.syncUnreadNotificationsToStatusBar(notifs);
      }
    } catch (_) {
      if (mounted && seq == _loadSeq) setState(() => _loading = false);
    } finally {
      if (mounted && seq == _loadSeq && _loading) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _silentSync() async {
    await _fetchDashboardParallel(isInitial: false);
  }

  Future<void> _loadAll() async {
    await _fetchDashboardParallel(isInitial: true);
  }

  Future<void> _logout() async {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    _ridesWs = null;
    final push = CaptainPushNotificationService.instance;
    final token = push.currentToken;
    final devId = push.deviceId;
    await push.unregisterOnLogout(api);
    await api.logout(fcmToken: token, deviceId: devId);
    await _persistTabIndex(0);
    if (!mounted) return;
    setState(() {
      _activeCaptainId = null;
      _activeCaptain = null;
      _orders = [];
      _parcels = [];
      _trips = [];
      _settlements = [];
      _index = 0;
      _notifications = [];
    });
  }

  void _showNotificationsSheet() {
    final unreadIds = _notifications
        .where((n) => n is Map && n['is_read'] != true && n['is_read'] != 1)
        .map((n) => (n['id'] ?? '').toString().trim())
        .where((id) => id.isNotEmpty)
        .toList();

    if (unreadIds.isNotEmpty) {
      _markAllLocalNotificationsRead();
      api
          .markAllNotificationsRead(ids: unreadIds, recipientId: _activeCaptainId)
          .catchError((_) async {
        for (final id in unreadIds) {
          try {
            await api.markNotificationRead(id);
          } catch (_) {}
        }
      });
    }

    final snapshot = _notifications
        .whereType<Map>()
        .map((m) => <String, dynamic>{...Map<String, dynamic>.from(m), 'is_read': true})
        .toList();

    showModalBottomSheet(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: snapshot.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: Text('لا توجد إشعارات حاليًا')),
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: snapshot.length,
                separatorBuilder: (_, __) => const Divider(),
                itemBuilder: (_, i) {
                  final n = snapshot[i];
                  final dl = (n['deep_link'] ?? '').toString().trim().toLowerCase();
                  final hasRedirect = dl.isNotEmpty && dl != 'notifications';
                  return ListTile(
                    onTap: hasRedirect
                        ? () {
                            Navigator.pop(ctx);
                            _handlePushNotificationTap(n);
                          }
                        : null,
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFFFF7ED),
                      child: Icon(Icons.notifications_active_outlined, color: Color(0xFFA92224), size: 20),
                    ),
                    title: Text((n['title_ar'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.bold)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text((n['body_ar'] ?? '').toString()),
                        if ((n['created_at'] ?? '').toString().isNotEmpty)
                          Text(
                            n['created_at'].toString(),
                            style: TextStyle(fontSize: 10, color: Colors.grey.shade600),
                          ),
                      ],
                    ),
                    trailing: hasRedirect
                        ? const Chip(
                            label: Text('انتقال', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFC2410C))),
                            backgroundColor: Color(0xFFFFF7ED),
                            side: BorderSide(color: Color(0xFFFED7AA)),
                            visualDensity: VisualDensity.compact,
                          )
                        : const Icon(Icons.done_all, color: Color(0xFF0D9488)),
                  );
                },
              ),
      ),
    );
  }

  void _showCaptainSettingsSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.all(16),
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
                          Text('إعدادات تطبيق الطيار', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(ctx),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
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
                          'إعدادات إشعارات الطلبات (Android Push)',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                        ),
                        SwitchListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('صوت تنبيهات الطلبات', style: TextStyle(fontSize: 13)),
                          value: CaptainPushNotificationService.instance.soundEnabled,
                          activeColor: const Color(0xFFA92224),
                          onChanged: (val) async {
                            await CaptainPushNotificationService.instance.setSoundEnabled(val);
                            setModalState(() {});
                          },
                        ),
                        SwitchListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('الاهتزاز عند إسناد طلب جديد', style: TextStyle(fontSize: 13)),
                          value: CaptainPushNotificationService.instance.vibrationEnabled,
                          activeColor: const Color(0xFFA92224),
                          onChanged: (val) async {
                            await CaptainPushNotificationService.instance.setVibrationEnabled(val);
                            setModalState(() {});
                          },
                        ),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: () async {
                              final ok = await CaptainPushNotificationService.instance.requestPermission();
                              if (_activeCaptainId != null) {
                                await CaptainPushNotificationService.instance.registerForAuthenticatedCaptain(api);
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
                  const SizedBox(height: 8),
                  ListTile(
                    leading: const Icon(Icons.my_location, color: Color(0xFFA92224)),
                    title: const Text('تحديث موقعي بالـ GPS الآن'),
                    onTap: () {
                      Navigator.pop(ctx);
                      _pushCaptainGps();
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.refresh, color: Color(0xFF0D9488)),
                    title: const Text('تحديث الأوردرات والمشاوير'),
                    onTap: () {
                      Navigator.pop(ctx);
                      _loadAll();
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.person_outline, color: Color(0xFF475569)),
                    title: const Text('الملف الشخصي والمركبة والمستندات'),
                    onTap: () {
                      Navigator.pop(ctx);
                      setState(() => _index = 4);
                    },
                  ),
                  ListTile(
                    leading: Icon(Icons.logout, color: Colors.red.shade700),
                    title: Text('تسجيل الخروج', style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.bold)),
                    onTap: () {
                      Navigator.pop(ctx);
                      _logout();
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_activeCaptainId == null) {
      return Directionality(
        textDirection: TextDirection.rtl,
        child: CaptainLoginScreen(
          api: api,
          onLoggedIn: _onCaptainLoggedIn,
        ),
      );
    }

    final Map<String, dynamic>? cap = _activeCaptain;
    final unread = _notifications.where((n) => n['is_read'] != true).length;

    final openCount = cap == null
        ? 0
        : _orders
            .where((o) =>
                (o['captain_id'] == cap['id'] || o['status'] == 'ready_for_pickup') &&
                o['status'] != 'delivered' &&
                o['status'] != 'cancelled')
            .length;

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
          appBar: AppBar(
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
                  'اطلبها كابتن – المنزلة',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
          actions: [
            IconButton(
              onPressed: _showNotificationsSheet,
              tooltip: 'الإشعارات',
              icon: Badge(
                backgroundColor: const Color(0xFFF5A623),
                textColor: Colors.black,
                isLabelVisible: unread > 0,
                label: Text('$unread'),
                child: const Icon(Icons.notifications_outlined),
              ),
            ),
            IconButton(
              onPressed: _showCaptainSettingsSheet,
              tooltip: 'الإعدادات',
              icon: const Icon(Icons.settings_outlined),
            ),
          ],
        ),
        body: (_loading && cap == null)
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 16),
                    TextButton.icon(
                      onPressed: () {
                        api.resetConnectionPool();
                        _loadAll();
                      },
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      label: const Text('إعادة المحاولة'),
                    ),
                  ],
                ),
              )
            : cap == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.wifi_off_rounded, size: 48, color: Color(0xFF94A3B8)),
                          const SizedBox(height: 12),
                          const Text(
                            'تعذّر تحميل بيانات الطيار، تحقق من الاتصال بالإنترنت',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF334155)),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: () {
                              api.resetConnectionPool();
                              _loadAll();
                            },
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('إعادة المحاولة'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFFA92224),
                              foregroundColor: Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                : IndexedStack(
                    index: _index,
                    children: [
                      CaptainHomeScreen(
                        api: api,
                        captain: cap,
                        orders: _orders,
                        parcels: _parcels,
                        trips: _trips,
                        onRefresh: _loadAll,
                        onOpenOrdersTab: (filter) => _switchTab(1, ordersFilter: filter),
                        onOpenSettlementTab: () => _switchTab(3),
                      ),
                      CaptainOrdersScreen(
                        api: api,
                        captain: cap,
                        orders: _orders,
                        onRefresh: _loadAll,
                        initialFilter: _ordersInitialFilter,
                      ),
                      CaptainPosScreen(
                        api: api,
                        captain: cap,
                        orders: _orders,
                        trips: _trips,
                        parcels: _parcels,
                      ),
                      CaptainSettlementScreen(
                        api: api,
                        captain: cap,
                        orders: _orders,
                        settlements: _settlements,
                        onRefresh: _loadAll,
                      ),
                      CaptainProfileScreen(
                        api: api,
                        captain: cap,
                        onCaptainSelected: (id) {
                          setState(() => _activeCaptainId = id);
                          _loadAll();
                        },
                        onRefresh: _loadAll,
                        onLogout: _logout,
                      ),
                    ],
                  ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => _switchTab(i),
          destinations: [
            NavigationDestination(
              icon: Badge(
                isLabelVisible: openCount > 0,
                label: Text('$openCount'),
                child: const Icon(Icons.home_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: openCount > 0,
                label: Text('$openCount'),
                child: const Icon(Icons.home),
              ),
              label: 'الرئيسية',
            ),
            const NavigationDestination(
              icon: Icon(Icons.list_alt_outlined),
              selectedIcon: Icon(Icons.list_alt),
              label: 'أوردرات اليوم',
            ),
            const NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined),
              selectedIcon: Icon(Icons.receipt_long),
              label: 'الفواتير',
            ),
            const NavigationDestination(
              icon: Icon(Icons.account_balance_wallet_outlined),
              selectedIcon: Icon(Icons.account_balance_wallet),
              label: 'التسوية',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'الملف الشخصي',
            ),
          ],
        ),
      ),
      ),
    );
  }
}
