import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'core/api_client.dart';
import 'screens/home_screen.dart';
import 'screens/services_hub_screen.dart';
import 'screens/offers_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/order_chat_screen.dart';
import 'screens/trip_chat_screen.dart';
import 'screens/customer_otp_login_screen.dart';
import 'screens/support_screen.dart';

void main() {
  runApp(const OtlobhaCustomerApp());
}

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

class _CustomerShellState extends State<CustomerShell> {
  final OtlobhaCustomerApi api = OtlobhaCustomerApi();
  bool _isAuthenticated = false;
  int _index = 0; // 0: الرئيسية | 1: العروض | 2: الخدمات (المنتصف) | 3: السلة | 4: الملف الشخصي
  String _serviceSubView = 'hub';
  bool _loading = true;
  Map<String, dynamic> _bootstrap = {};
  final Map<String, int> _quickCart = {};
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

  @override
  void initState() {
    super.initState();
    _pollTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      if (_isAuthenticated) _silentSync();
    });
  }

  @override
  void dispose() {
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
      final name = cust['full_name']?.toString() ?? '';
      final email = cust['email']?.toString() ?? '';
      final phone = cust['phone']?.toString() ?? '';
      final addr = cust['address_landmark']?.toString() ?? '';
      final zoneId = cust['default_zone_id']?.toString() ?? '';
      if (name.isNotEmpty) _customerName = name;
      if (email.isNotEmpty) _customerEmail = email;
      _customerPhone = phone;
      _addressLandmark = addr;
      if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
    }
  }

  Future<void> _silentSync() async {
    try {
      final data = await api.bootstrap();
      if (mounted) {
        setState(() {
          _bootstrap = data;
        });
      }
    } catch (_) {}
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    try {
      final data = await api.bootstrap();
      if (mounted) {
        setState(() {
          _bootstrap = data;
          _applyCustomerFromBootstrap(data);
          final merchants = ((data['merchants'] as List?) ?? [])
              .where((m) => m['merchant_type'] != 'pharmacy')
              .toList();
          if (_quickMerchantId.isEmpty && merchants.isNotEmpty) {
            _quickMerchantId = merchants.first['id'] as String;
          }
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onQuickAdd(Map<String, dynamic> product, int delta) {
    final prodId = product['id'] as String;
    final merchId = product['merchant_id'] as String;
    final current = _quickCart[prodId] ?? 0;
    final next = (current + delta).clamp(0, 99);
    setState(() {
      if (delta > 0) {
        _quickMerchantId = merchId;
        _orderChannel = 'catalog';
      }
      if (next == 0) {
        _quickCart.remove(prodId);
      } else {
        _quickCart[prodId] = next;
      }
    });
  }

  Future<void> _applyCouponFromOffers(String code) async {
    final products = (_bootstrap['products'] as List?) ?? [];
    double subtotal = 0;
    for (final p in products) {
      final q = _quickCart[p['id']] ?? 0;
      if (q > 0) {
        subtotal += ((p['sale_price'] ?? p['base_price']) as num).toDouble() * q;
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
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NotificationsScreen(api: api)),
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

  void _logout() {
    _ridesSub?.cancel();
    _ridesWs?.sink.close();
    api.logout();
    setState(() {
      _isAuthenticated = false;
      _customerName = '';
      _customerEmail = '';
      _customerPhone = '';
      _addressLandmark = '';
      _bootstrap = {};
      _quickCart.clear();
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
                      style: TextButton.styleFrom(foregroundColor: Colors.red.shade700),
                      onPressed: () {
                        Navigator.pop(ctx);
                        _logout();
                      },
                      icon: const Icon(Icons.logout, size: 18),
                      label: const Text('تسجيل الخروج'),
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
    if (!_isAuthenticated) {
      return Directionality(
        textDirection: TextDirection.rtl,
        child: CustomerOtpLoginScreen(
          api: api,
          onVerified: (user) {
            setState(() {
              _isAuthenticated = true;
              _customerEmail = user['email']?.toString() ?? '';
              _customerName = user['full_name']?.toString() ?? '';
              _customerPhone = user['phone']?.toString() ?? '';
              _addressLandmark = user['address_landmark']?.toString() ?? '';
              final zoneId = user['default_zone_id']?.toString() ?? '';
              if (zoneId.isNotEmpty) _selectedZoneId = zoneId;
              _index = 0;
            });
            _connectRidesWs();
            _loadData();
          },
        ),
      );
    }

    final unread = ((_bootstrap['notifications'] as List?) ?? [])
        .where((n) => n['is_read'] != true)
        .length;
    final cartTotalQty = _quickCart.values.fold<int>(0, (sum, q) => sum + q);

    final screens = [
      HomeScreen(
        bootstrap: _bootstrap,
        cart: _quickCart,
        onAddProduct: _onQuickAdd,
        onOpenCart: () => setState(() => _index = 3),
        onOpenFreeOrderCart: () => setState(() {
          _orderChannel = 'free_text';
          _index = 3;
        }),
        onOpenService: (sub) => setState(() {
          _serviceSubView = sub;
          _index = 2;
        }),
        onOpenOffers: () => setState(() => _index = 1),
        onOpenOrderChat: _openOrderChat,
        onOpenTripChat: _openTripChat,
        onRateCaptain: _showCaptainRatingDialog,
      ),
      OffersScreen(
        bootstrap: _bootstrap,
        cart: _quickCart,
        onAddProduct: _onQuickAdd,
        onApplyCoupon: _applyCouponFromOffers,
      ),
      ServicesHubScreen(
        api: api,
        bootstrap: _bootstrap,
        cart: _quickCart,
        onAddProduct: _onQuickAdd,
        onOpenCart: () => setState(() => _index = 3),
        onRefresh: _loadData,
        activeSubView: _serviceSubView,
        onSelectSubView: (sub) => setState(() => _serviceSubView = sub),
        onOpenFreeOrderCart: () => setState(() {
          _orderChannel = 'free_text';
          _index = 3;
        }),
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
        onClearCart: () => setState(() => _quickCart.clear()),
        onOrderPlaced: () async {
          await _loadData();
          if (mounted) setState(() => _index = 4);
        },
        onBrowseHome: () => setState(() => _index = 0),
      ),
      ProfileScreen(
        bootstrap: _bootstrap,
        customerEmail: _customerEmail,
        customerName: _customerName,
        customerPhone: _customerPhone,
        addressLandmark: _addressLandmark,
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
        onOpenOffers: () => setState(() => _index = 1),
        onOpenOrderChat: _openOrderChat,
        onOpenTripChat: _openTripChat,
        onRateCaptain: _showCaptainRatingDialog,
        onLogout: _logout,
      ),
    ];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
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
            : IndexedStack(index: _index, children: screens),
        bottomNavigationBar: _buildCustomerBottomBar(cartTotalQty),
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
                          _customerName,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                        Text(
                          _customerPhone.isNotEmpty ? _customerPhone : _customerEmail,
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
              child: Text('الخدمات والأقسام', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.grid_view_rounded, color: Color(0xFFA92224)),
              title: const Text('مركز كل الخدمات', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _serviceSubView = 'hub';
                  _index = 2;
                });
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.storefront, color: Color(0xFFEA580C)),
              title: const Text('المتاجر والمطاعم المعتمدة', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _serviceSubView = 'stores';
                  _index = 2;
                });
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.medication, color: Color(0xFF0D9488)),
              title: const Text('الصيدلية والروشتة', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _serviceSubView = 'pharmacy';
                  _index = 2;
                });
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.directions_car, color: Color(0xFFD97706)),
              title: const Text('مشوار أو طرد', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _serviceSubView = 'rides_parcels';
                  _index = 2;
                });
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.shopping_bag, color: Color(0xFF4F46E5)),
              title: const Text('سوق اطلبها', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _serviceSubView = 'market';
                  _index = 2;
                });
              },
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.edit_note, color: Color(0xFFE11D48)),
              title: const Text('طلب نصي حر', style: TextStyle(fontWeight: FontWeight.w600)),
              onTap: () {
                Navigator.pop(context);
                setState(() {
                  _orderChannel = 'free_text';
                  _index = 3;
                });
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
              leading: Icon(Icons.logout, color: Colors.red.shade700),
              title: Text('تسجيل الخروج', style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.bold)),
              onTap: () {
                Navigator.pop(context);
                _logout();
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
          onTap: () => setState(() => _index = idx),
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

    final servicesActive = _index == 2;
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
              sideTab(idx: 0, icon: Icons.home_outlined, activeIcon: Icons.home, label: 'الرئيسية'),
              sideTab(idx: 1, icon: Icons.local_offer_outlined, activeIcon: Icons.local_offer, label: 'العروض'),
              Expanded(
                child: GestureDetector(
                  onTap: () {
                    setState(() {
                      if (_index != 2) _serviceSubView = 'hub';
                      _index = 2;
                    });
                  },
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
                              colors: [Color(0xFF9E1C1E), Color(0xFFC8431D), Color(0xFFF5A623)],
                            ),
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: servicesActive ? const Color(0xFFF5A623) : Colors.white,
                              width: 3,
                            ),
                            boxShadow: const [
                              BoxShadow(color: Color(0x33A92224), blurRadius: 10, offset: Offset(0, 4)),
                            ],
                          ),
                          child: const Icon(Icons.grid_view_rounded, color: Colors.white, size: 26),
                        ),
                      ),
                      Transform.translate(
                        offset: const Offset(0, -6),
                        child: Text(
                          'الخدمات',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: servicesActive ? const Color(0xFFA92224) : const Color(0xFF0F172A),
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
                activeIcon: Icons.shopping_cart,
                label: 'السلة',
                badge: cartTotalQty,
              ),
              sideTab(idx: 4, icon: Icons.person_outline, activeIcon: Icons.person, label: 'الملف الشخصي'),
            ],
          ),
        ),
      ),
    );
  }
}
