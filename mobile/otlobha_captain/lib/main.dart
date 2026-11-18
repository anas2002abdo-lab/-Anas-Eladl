import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:geolocator/geolocator.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'core/api_client.dart';
import 'screens/captain_home_screen.dart';
import 'screens/captain_login_screen.dart';
import 'screens/captain_orders_screen.dart';
import 'screens/captain_pos_screen.dart';
import 'screens/captain_settlement_screen.dart';
import 'screens/captain_profile_screen.dart';

void main() {
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

class _CaptainShellState extends State<CaptainShell> {
  final OtlobhaCaptainApi api = OtlobhaCaptainApi();
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

  @override
  void initState() {
    super.initState();
    _loadAll();
    _pollTimer = Timer.periodic(const Duration(seconds: 25), (_) => _silentSync());
    _gpsTimer = Timer.periodic(const Duration(seconds: 20), (_) => _pushCaptainGps());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _gpsTimer?.cancel();
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    super.dispose();
  }

  void _connectRidesWs() {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
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
          if (type == 'trip:created' ||
              type == 'trip:accepted' ||
              type == 'trip:status' ||
              type == 'trip:fare_updated' ||
              type == 'trip:completed' ||
              type == 'trip:cancelled' ||
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

  Future<void> _silentSync() async {
    if (_activeCaptainId == null || !api.hasTokens) return;
    try {
      final selectedId = _activeCaptainId ?? '';
      final meRes = await api.getMe();
      final user = meRes['user'];
      final orders = await api.getOrders();
      final parcels = await api.getParcels();
      final trips = await api.getTrips();
      final settlementsRes = await api.getSettlements(selectedId);
      final notifs = selectedId.isNotEmpty ? await api.getNotifications(selectedId) : [];
      if (mounted) {
        final prevApproved = _activeCaptain?['verification_status'] == 'approved';
        final nextCap = user is Map ? Map<String, dynamic>.from(user) : _activeCaptain;
        final nextApproved = nextCap?['verification_status'] == 'approved';
        setState(() {
          if (nextCap != null) _activeCaptain = nextCap;
          _parcels = parcels;
          _trips = trips;
          _orders = orders;
          _settlements = (settlementsRes['settlements'] as List?) ?? [];
          _notifications = notifs;
        });
        if (prevApproved != nextApproved) {
          _connectRidesWs();
        }
      }
    } catch (_) {}
  }

  Future<void> _loadAll() async {
    if (_activeCaptainId == null || !api.hasTokens) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    setState(() => _loading = true);
    try {
      final selectedId = _activeCaptainId ?? '';
      final meRes = await api.getMe();
      final user = meRes['user'];
      final orders = await api.getOrders();
      final parcels = await api.getParcels();
      final trips = await api.getTrips();
      final settlementsRes = await api.getSettlements(selectedId);
      final notifs = selectedId.isNotEmpty ? await api.getNotifications(selectedId) : [];
      if (mounted) {
        final prevApproved = _activeCaptain?['verification_status'] == 'approved';
        final nextCap = user is Map ? Map<String, dynamic>.from(user) : _activeCaptain;
        final nextApproved = nextCap?['verification_status'] == 'approved';
        setState(() {
          if (nextCap != null) _activeCaptain = nextCap;
          _parcels = parcels;
          _trips = trips;
          _orders = orders;
          _settlements = (settlementsRes['settlements'] as List?) ?? [];
          _notifications = notifs;
          _loading = false;
        });
        if (_ridesWs == null || prevApproved != nextApproved) {
          _connectRidesWs();
        }
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _logout() {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    _ridesWs = null;
    api.logout();
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
    showModalBottomSheet(
      context: context,
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: _notifications.length,
          separatorBuilder: (_, __) => const Divider(),
          itemBuilder: (_, i) {
            final n = _notifications[i];
            return ListTile(
              title: Text(n['title_ar'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text(n['body_ar'] ?? ''),
              trailing: n['is_read'] == true
                  ? const Icon(Icons.done_all, color: Color(0xFF0D9488))
                  : TextButton(
                      onPressed: () async {
                        await api.markNotificationRead(n['id'].toString());
                        if (mounted) Navigator.pop(context);
                        _loadAll();
                      },
                      child: const Text('مقروء'),
                    ),
            );
          },
        ),
      ),
    );
  }

  void _showCaptainSettingsSheet() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Padding(
          padding: const EdgeInsets.all(16),
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
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_activeCaptainId == null) {
      return Directionality(
        textDirection: TextDirection.rtl,
        child: CaptainLoginScreen(
          api: api,
          onLoggedIn: (id) {
            setState(() {
              _activeCaptainId = id;
              _index = 0;
            });
            _connectRidesWs();
            _loadAll();
            _pushCaptainGps();
          },
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

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
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
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : cap == null
                ? const Center(child: Text('جاري تحميل بيانات الطيار...'))
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
                        onOpenOrdersTab: (filter) => setState(() {
                          _ordersInitialFilter = filter;
                          _index = 1;
                        }),
                        onOpenSettlementTab: () => setState(() => _index = 3),
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
          onDestinationSelected: (i) => setState(() => _index = i),
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
    );
  }
}
