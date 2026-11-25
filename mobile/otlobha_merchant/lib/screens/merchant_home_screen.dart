import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import '../core/config.dart';
import '../core/push_notification_service.dart';
import 'merchant_product_tools.dart';

class MerchantHomeScreen extends StatefulWidget {
  final MerchantApiClient api;
  final Map<String, dynamic> merchant;
  final VoidCallback onLogout;
  final void Function(Map<String, dynamic> updatedMerchant) onMerchantUpdated;

  const MerchantHomeScreen({
    super.key,
    required this.api,
    required this.merchant,
    required this.onLogout,
    required this.onMerchantUpdated,
  });

  @override
  State<MerchantHomeScreen> createState() => _MerchantHomeScreenState();
}

class _MerchantHomeScreenState extends State<MerchantHomeScreen> {
  int _tabIndex = 0;
  String _orderFilter = 'all';
  bool _loadingOrders = false;
  bool _loadingProducts = false;
  bool _loadingRequests = false;
  String? _busyOrderId;
  String _productSearch = '';
  String _productViewMode = 'all'; // all | unavailable
  int _productsPage = 1;
  int _productsTotalPages = 1;
  int _productsTotal = 0;
  int _totalAllProducts = 0;
  int _totalOfferProducts = 0;
  int _totalNoImageProducts = 0;
  int _totalUnavailableProducts = 0;
  Timer? _productSearchDebounce;

  List<Map<String, dynamic>> _orders = [];
  List<Map<String, dynamic>> _products = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _approvalRequests = [];
  List<Map<String, dynamic>> _notifications = [];
  final Set<String> _knownOrderIds = {};
  final Map<String, TextEditingController> _quoteControllers = {};

  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSub;
  Timer? _pollTimer;
  Timer? _wsReconnectTimer;
  Timer? _bannerTimer;
  bool _disposed = false;

  String? _bannerTitle;
  String? _bannerBody;
  bool _soundEnabled = true;
  bool _vibrationEnabled = true;

  String get _merchantId => widget.merchant['id']?.toString() ?? '';
  String get _businessName => widget.merchant['business_name_ar']?.toString() ?? 'متجري';
  bool get _isPharmacy => widget.merchant['merchant_type']?.toString() == 'pharmacy';
  int get _unreadCount => _notifications.where((n) => n['is_read'] != true && n['is_read'] != 1).length;

  static const Map<String, String> _statusAr = {
    'awaiting_quote': 'بانتظار التسعير',
    'pending_merchant': 'طلب جديد',
    'preparing': 'قيد التجهيز',
    'ready_for_pickup': 'الطلب جاهز للاستلام',
    'on_the_way': 'مع الطيار في الطريق',
    'delivered': 'تم التسليم',
    'cancelled': 'ملغى / مرفوض',
  };

  @override
  void initState() {
    super.initState();
    _initPushCallbacks();
    _refreshOrders(initial: true);
    _refreshNotifications(isInitial: true);
    _refreshProducts(page: 1);
    _loadCategories();
    _refreshApprovalRequests();
    _connectWs();
    _pollTimer = Timer.periodic(const Duration(seconds: 12), (_) {
      if (!_disposed) {
        _refreshOrders();
        _refreshNotifications();
      }
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _pollTimer?.cancel();
    _wsReconnectTimer?.cancel();
    _bannerTimer?.cancel();
    _productSearchDebounce?.cancel();
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    for (final c in _quoteControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _initPushCallbacks() async {
    final push = MerchantPushNotificationService.instance;
    await push.init(
      onTap: (payload) {
        if (!mounted) return;
        setState(() {
          _tabIndex = 0;
          _orderFilter = 'active';
        });
        _refreshOrders();
        _refreshNotifications();
      },
      onForeground: (title, body, data) {
        if (!mounted) return;
        _showInAppBanner(title, body);
        _refreshOrders();
        _refreshNotifications();
      },
    );
    if (mounted) {
      setState(() {
        _soundEnabled = push.soundEnabled;
        _vibrationEnabled = push.vibrationEnabled;
      });
    }
    if (_merchantId.isNotEmpty) {
      await push.syncTokenWithBackend(widget.api, _merchantId);
    }
  }

  void _showInAppBanner(String title, String body) {
    if (!mounted) return;
    if (_vibrationEnabled) {
      HapticFeedback.heavyImpact();
    }
    if (_soundEnabled) {
      SystemSound.play(SystemSoundType.alert);
    }
    _bannerTimer?.cancel();
    setState(() {
      _bannerTitle = title;
      _bannerBody = body;
    });
    _bannerTimer = Timer(const Duration(seconds: 8), () {
      if (mounted) {
        setState(() {
          _bannerTitle = null;
          _bannerBody = null;
        });
      }
    });
  }

  Future<void> _refreshNotifications({bool isInitial = false}) async {
    if (_merchantId.isEmpty) return;
    try {
      final list = await widget.api.fetchNotifications();
      if (!mounted) return;
      setState(() {
        _notifications = list;
      });
      await MerchantPushNotificationService.instance.syncUnreadNotificationsToStatusBar(
        list,
        isInitialLoad: isInitial,
      );
    } catch (_) {
      // ignore transient network errors
    }
  }

  Future<void> _showNewOrderNotification(String orderNumber, {double? subtotal, int? itemsCount}) async {
    final title = 'طلب جديد لمتجرك #$orderNumber';
    final body = (itemsCount != null && itemsCount > 0 && subtotal != null)
        ? 'وصلك طلب جديد ($itemsCount صنف) بقيمة ${subtotal.toStringAsFixed(subtotal.truncateToDouble() == subtotal ? 0 : 2)} ج.م — افتح لتجهيزه الآن.'
        : 'وصلك طلب جديد #$orderNumber — افتح التطبيق لتجهيز أصناف متجرك الآن.';
    _showInAppBanner(title, body);
    await MerchantPushNotificationService.instance.showSystemNotification(
      title: title,
      body: body,
      channelId: MerchantPushChannels.dispatch,
      payload: {'deep_link': 'order', 'order_number': orderNumber},
      dedupeKey: 'local_order_$orderNumber',
    );
  }

  void _connectWs() {
    if (_disposed || _merchantId.isEmpty) return;
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    try {
      final wsUrl = MerchantAppConfig.wsUrlForMerchant(_merchantId, widget.api.accessToken);
      _wsChannel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _wsSub = _wsChannel!.stream.listen(
        (raw) {
          if (_disposed) return;
          try {
            if (raw is String && raw.trim().startsWith('{')) {
              final data = jsonDecode(raw);
              if (data is Map && data['type'] == 'notification:new' && data['notification'] is Map) {
                final n = Map<String, dynamic>.from(data['notification'] as Map);
                final title = (n['title_ar'] ?? 'إشعار جديد لمتجرك').toString().trim();
                final body = (n['body_ar'] ?? '').toString().trim();
                final nId = (n['id'] ?? '').toString().trim();
                if (title.isNotEmpty) {
                  _showInAppBanner(title, body);
                  MerchantPushNotificationService.instance.showSystemNotification(
                    title: title,
                    body: body,
                    channelId: (n['channel_id'] ?? MerchantPushChannels.dispatch).toString(),
                    payload: n,
                    dedupeKey: nId.isNotEmpty ? nId : '${title}_$body',
                  );
                }
                _refreshNotifications();
              }
            }
          } catch (_) {}
          _refreshOrders();
        },
        onError: (_) => _scheduleWsReconnect(),
        onDone: () => _scheduleWsReconnect(),
      );
    } catch (_) {
      _scheduleWsReconnect();
    }
  }

  void _scheduleWsReconnect() {
    if (_disposed) return;
    _wsReconnectTimer?.cancel();
    _wsReconnectTimer = Timer(const Duration(seconds: 5), _connectWs);
  }

  void _snack(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message, style: const TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: isError ? const Color(0xFFBE123C) : MerchantAppConfig.brandTeal,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Extracts ONLY this merchant's items, subtotal, and section status.
  Map<String, dynamic> _extractMerchantOrderView(Map<String, dynamic> order) {
    final sectionsRaw = order['store_sections'];
    Map<String, dynamic>? mySection;
    var sectionCount = 0;
    if (sectionsRaw is List) {
      sectionCount = sectionsRaw.length;
      for (final s in sectionsRaw) {
        if (s is Map && s['merchant_id']?.toString() == _merchantId) {
          mySection = Map<String, dynamic>.from(s);
          break;
        }
      }
    }

    final rawItemsList = mySection != null
        ? (mySection['items'] is List ? mySection['items'] as List : const [])
        : (order['items'] is List ? order['items'] as List : const []);

    final myItems = <Map<String, dynamic>>[];
    for (final raw in rawItemsList) {
      if (raw is! Map) continue;
      final item = Map<String, dynamic>.from(raw);
      final itemMerchantId = item['merchant_id']?.toString();
      if (mySection == null && itemMerchantId != null && itemMerchantId.isNotEmpty && itemMerchantId != _merchantId) {
        continue;
      }
      myItems.add(item);
    }

    double acceptedSum = 0;
    for (final it in myItems) {
      if (it['status']?.toString() != 'rejected') {
        acceptedSum += (num.tryParse(it['total_price']?.toString() ?? '0') ?? 0).toDouble();
      }
    }

    final mySubtotal = myItems.isNotEmpty
        ? double.parse(acceptedSum.toStringAsFixed(2))
        : (num.tryParse((mySection?['subtotal'] ?? order['subtotal'] ?? 0).toString()) ?? 0).toDouble();

    final parentStatus = order['status']?.toString() ?? 'pending_merchant';
    final orderClosed = parentStatus == 'delivered' || parentStatus == 'cancelled';
    final myStatus = mySection != null
        ? (orderClosed ? parentStatus : (mySection['prep_status']?.toString() ?? parentStatus))
        : ((order['my_section_status'] != null && !orderClosed)
            ? order['my_section_status'].toString()
            : parentStatus);

    final isMultiStore = (order['is_multi_store'] == true) || sectionCount > 1;

    return {
      'myItems': myItems,
      'mySubtotal': mySubtotal,
      'myStatus': myStatus,
      'myFreeText': mySection != null ? mySection['free_order_text'] : order['free_order_text'],
      'myRejectionReason': mySection?['rejection_reason'] ?? order['rejection_reason'],
      'mySubNote': mySection?['substitution_note'] ?? order['substitution_note'],
      'isMultiStore': isMultiStore,
    };
  }

  Future<void> _refreshOrders({bool initial = false}) async {
    if (_loadingOrders || _merchantId.isEmpty) return;
    setState(() => _loadingOrders = true);
    try {
      final list = await widget.api.fetchStoreOrders(_merchantId);
      if (!mounted) return;
      if (!initial && _knownOrderIds.isNotEmpty) {
        for (final ord in list) {
          final oid = ord['id']?.toString() ?? '';
          if (oid.isNotEmpty && !_knownOrderIds.contains(oid)) {
            final view = _extractMerchantOrderView(ord);
            if (['pending_merchant', 'awaiting_quote', 'preparing'].contains(view['myStatus'])) {
              final myItems = view['myItems'] as List<Map<String, dynamic>>;
              final mySubtotal = (view['mySubtotal'] as num?)?.toDouble();
              _showNewOrderNotification(
                ord['order_number']?.toString() ?? oid,
                subtotal: mySubtotal,
                itemsCount: myItems.length,
              );
            }
          }
        }
      }
      _knownOrderIds
        ..clear()
        ..addAll(list.map((e) => e['id']?.toString() ?? '').where((e) => e.isNotEmpty));
      setState(() {
        _orders = list;
      });
    } catch (e) {
      if (initial) _snack(e.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _loadingOrders = false);
    }
  }

  Future<void> _loadCategories() async {
    try {
      final cats = await widget.api.fetchCategories();
      if (mounted) setState(() => _categories = cats);
    } catch (_) {
      // ignore transient error
    }
  }

  Future<void> _refreshProducts({int? page}) async {
    if (_merchantId.isEmpty) return;
    final targetPage = page ?? _productsPage;
    setState(() => _loadingProducts = true);
    try {
      final res = await widget.api.fetchStoreProductsPage(
        merchantId: _merchantId,
        page: targetPage,
        limit: 25,
        query: _productSearch.trim(),
        availability: _productViewMode == 'unavailable' ? 'unavailable' : 'all',
      );
      if (mounted) {
        setState(() {
          _products = res.items;
          _productsPage = res.page;
          _productsTotalPages = res.totalPages;
          _productsTotal = res.total;
          _totalAllProducts = res.totalAll;
          _totalOfferProducts = res.totalOffers;
          _totalNoImageProducts = res.totalNoImage;
          _totalUnavailableProducts = res.totalUnavailable;
        });
      }
    } catch (_) {
      // ignore transient error
    } finally {
      if (mounted) setState(() => _loadingProducts = false);
    }
  }

  Future<void> _refreshApprovalRequests() async {
    if (_loadingRequests || _merchantId.isEmpty) return;
    setState(() => _loadingRequests = true);
    try {
      final list = await widget.api.fetchApprovalRequests(_merchantId);
      if (mounted) setState(() => _approvalRequests = list);
    } catch (_) {
      // ignore transient error
    } finally {
      if (mounted) setState(() => _loadingRequests = false);
    }
  }

  Future<void> _handleMarkReady(Map<String, dynamic> order, Map<String, dynamic> view) async {
    final orderId = order['id']?.toString() ?? '';
    final myStatus = view['myStatus']?.toString() ?? '';
    if (orderId.isEmpty || ['ready_for_pickup', 'on_the_way', 'delivered', 'cancelled'].contains(myStatus)) {
      return;
    }
    final myItems = view['myItems'] as List<Map<String, dynamic>>;
    final isFreeWithoutItems = myItems.isEmpty;
    double? quoteVal;
    if (isFreeWithoutItems) {
      final ctrl = _quoteControllers[orderId];
      if (ctrl != null && ctrl.text.trim().isNotEmpty) {
        quoteVal = double.tryParse(ctrl.text.trim());
      } else {
        quoteVal = (view['mySubtotal'] as num?)?.toDouble();
      }
    }

    setState(() => _busyOrderId = orderId);
    try {
      final res = await widget.api.markOrderReady(
        orderId: orderId,
        merchantId: _merchantId,
        isFreeOrRxWithoutItems: isFreeWithoutItems,
        quoteSubtotal: quoteVal,
        isPharmacy: _isPharmacy,
      );
      await _refreshOrders();
      final cap = res['assigned_captain']?.toString();
      _snack(
        cap != null && cap.isNotEmpty
            ? 'تم تأكيد جاهزية طلب متجرك وإسناده للطيار: $cap ✓'
            : 'تم تأكيد جاهزية طلب متجرك ✓',
      );
    } catch (e) {
      _snack(e.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _busyOrderId = null);
    }
  }

  Future<void> _showRejectItemDialog(Map<String, dynamic> order, Map<String, dynamic> item) async {
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('رفض الصنف: ${item['name_ar']}'),
        content: TextField(
          controller: reasonCtrl,
          decoration: const InputDecoration(
            labelText: 'سبب رفض الصنف (إلزامي)',
            hintText: 'مثال: نفاد الكمية من المتجر',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFBE123C)),
            onPressed: () {
              if (reasonCtrl.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: const Text('تأكيد رفض الصنف'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    final orderId = order['id']?.toString() ?? '';
    setState(() => _busyOrderId = orderId);
    try {
      await widget.api.rejectItems(
        orderId: orderId,
        merchantId: _merchantId,
        rejectedItems: [
          {'item_id': item['id'].toString(), 'reason': reasonCtrl.text.trim()},
        ],
      );
      await _refreshOrders();
      _snack('تم رفض الصنف وتحديث قيمة أصناف متجرك');
    } catch (e) {
      _snack(e.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _busyOrderId = null);
    }
  }

  Future<void> _showRejectInvoiceDialog(Map<String, dynamic> order) async {
    final reasonCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('رفض طلب متجرك #${order['order_number']}'),
        content: TextField(
          controller: reasonCtrl,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'سبب الرفض (إلزامي)',
            hintText: 'مثال: جميع الأصناف غير متوفرة حاليًا',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFBE123C)),
            onPressed: () {
              if (reasonCtrl.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: const Text('تأكيد الرفض'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    final orderId = order['id']?.toString() ?? '';
    setState(() => _busyOrderId = orderId);
    try {
      await widget.api.rejectInvoice(
        orderId: orderId,
        merchantId: _merchantId,
        reason: reasonCtrl.text.trim(),
      );
      await _refreshOrders();
      _snack('تم رفض طلب متجرك وإشعار العميل');
    } catch (e) {
      _snack(e.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _busyOrderId = null);
    }
  }

  Future<void> _openExternalUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Widget _buildOrdersTab() {
    final activeCount = _orders.where((o) {
      final st = _extractMerchantOrderView(o)['myStatus'];
      return ['awaiting_quote', 'pending_merchant', 'preparing'].contains(st);
    }).length;
    final readyCount = _orders.where((o) {
      final st = _extractMerchantOrderView(o)['myStatus'];
      return ['ready_for_pickup', 'on_the_way'].contains(st);
    }).length;

    final filtered = _orders.where((o) {
      final st = _extractMerchantOrderView(o)['myStatus']?.toString() ?? '';
      if (_orderFilter == 'active') return ['awaiting_quote', 'pending_merchant', 'preparing'].contains(st);
      if (_orderFilter == 'ready') return ['ready_for_pickup', 'on_the_way'].contains(st);
      if (_orderFilter == 'delivered') return st == 'delivered';
      if (_orderFilter == 'cancelled') return st == 'cancelled';
      return true;
    }).toList();

    return RefreshIndicator(
      onRefresh: () => _refreshOrders(),
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _filterChip('all', 'الكل (${_orders.length})'),
                const SizedBox(width: 8),
                _filterChip('active', 'قيد التجهيز ($activeCount)'),
                const SizedBox(width: 8),
                _filterChip('ready', 'جاهز ($readyCount)'),
                const SizedBox(width: 8),
                _filterChip('delivered', 'مكتمل'),
                const SizedBox(width: 8),
                _filterChip('cancelled', 'مرفوض'),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (filtered.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: const Column(
                children: [
                  Icon(Icons.receipt_long_outlined, size: 48, color: Color(0xFFCBD5E1)),
                  SizedBox(height: 10),
                  Text(
                    'لا توجد طلبات في هذا التبويب حاليًا',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'ستصلك الطلبات الخاصة بمتجرك فقط هنا بشكل فوري',
                    style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                  ),
                ],
              ),
            )
          else
            ...filtered.map(_buildOrderCard),
        ],
      ),
    );
  }

  Widget _filterChip(String id, String label) {
    final selected = _orderFilter == id;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      selectedColor: MerchantAppConfig.brandSlate,
      labelStyle: TextStyle(
        color: selected ? Colors.white : MerchantAppConfig.brandSlate,
        fontWeight: FontWeight.w700,
        fontSize: 12,
      ),
      onSelected: (_) => setState(() => _orderFilter = id),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final view = _extractMerchantOrderView(order);
    final orderId = order['id']?.toString() ?? '';
    final orderNum = order['order_number']?.toString() ?? '';
    final myStatus = view['myStatus']?.toString() ?? 'pending_merchant';
    final myItems = view['myItems'] as List<Map<String, dynamic>>;
    final mySubtotal = (view['mySubtotal'] as num).toDouble();
    final isMultiStore = view['isMultiStore'] == true;
    final isClosed = myStatus == 'delivered' || myStatus == 'cancelled';
    final isReadyOrFurther = ['ready_for_pickup', 'on_the_way', 'delivered'].contains(myStatus);
    final canAct = !isClosed && !isReadyOrFurther;
    final isBusy = _busyOrderId == orderId;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: Colors.white,
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: myStatus == 'cancelled'
              ? const Color(0xFFFECDD3)
              : isReadyOrFurther
                  ? const Color(0xFF99F6E4)
                  : const Color(0xFFE2E8F0),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      '#$orderNum',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: myStatus == 'cancelled'
                            ? const Color(0xFFFFE4E6)
                            : isReadyOrFurther
                                ? const Color(0xFFCCFBF1)
                                : const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _statusAr[myStatus] ?? myStatus,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: myStatus == 'cancelled'
                              ? const Color(0xFF9F1239)
                              : isReadyOrFurther
                                  ? const Color(0xFF115E59)
                                  : const Color(0xFF92400E),
                        ),
                      ),
                    ),
                    if (isMultiStore)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEEF2FF),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          'طلب مشترك (أصناف متجرك فقط)',
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF3730A3)),
                        ),
                      ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('قيمة أصناف متجرك', style: TextStyle(fontSize: 10, color: Color(0xFF64748B))),
                    Text(
                      '${mySubtotal.toStringAsFixed(mySubtotal.truncateToDouble() == mySubtotal ? 0 : 2)} ج.م',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                        color: MerchantAppConfig.brandSlate,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${order['customer_name'] ?? ''} · ${order['zone_name'] ?? ''} — ${order['address_landmark'] ?? ''}',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
                  ),
                ),
                if ((order['customer_phone']?.toString() ?? '').isNotEmpty)
                  IconButton(
                    icon: const Icon(Icons.call, size: 18, color: MerchantAppConfig.brandTeal),
                    tooltip: 'اتصال بالعميل',
                    onPressed: () => _openExternalUrl('tel:${order['customer_phone']}'),
                  ),
              ],
            ),
            const Divider(height: 16),
            if (myItems.isEmpty)
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  view['myFreeText']?.toString() ?? 'طلب خاص / روشتة',
                  style: const TextStyle(fontSize: 13),
                ),
              )
            else
              ...myItems.map((item) {
                final isRej = item['status']?.toString() == 'rejected';
                return Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: isRej ? const Color(0xFFFFF1F2) : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: isRej ? const Color(0xFFFECDD3) : const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${item['name_ar']}  × ${item['quantity']}',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                                decoration: isRej ? TextDecoration.lineThrough : null,
                                color: isRej ? const Color(0xFF9F1239) : MerchantAppConfig.brandSlate,
                              ),
                            ),
                            if (isRej && (item['rejection_reason']?.toString() ?? '').isNotEmpty)
                              Text(
                                'مرفوض: ${item['rejection_reason']}',
                                style: const TextStyle(fontSize: 11, color: Color(0xFFBE123C)),
                              ),
                          ],
                        ),
                      ),
                      Text(
                        '${item['total_price']} ج.م',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                          decoration: isRej ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (canAct && !isRej)
                        IconButton(
                          icon: const Icon(Icons.cancel_outlined, size: 20, color: Color(0xFFBE123C)),
                          tooltip: 'رفض هذا الصنف',
                          onPressed: isBusy ? null : () => _showRejectItemDialog(order, item),
                        ),
                    ],
                  ),
                );
              }),
            if (canAct && myStatus == 'awaiting_quote' && myItems.isEmpty) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _quoteControllers.putIfAbsent(
                  orderId,
                  () => TextEditingController(text: mySubtotal > 0 ? mySubtotal.toString() : ''),
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'تسعير أصناف متجرك (ج.م)',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  isDense: true,
                ),
              ),
            ],
            if (!isClosed) ...[
              const SizedBox(height: 12),
              if (canAct)
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFFBE123C),
                          side: const BorderSide(color: Color(0xFFFDA4AF)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: isBusy ? null : () => _showRejectInvoiceDialog(order),
                        icon: const Icon(Icons.block, size: 18),
                        label: const Text('رفض الطلب', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: MerchantAppConfig.brandTeal,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: isBusy ? null : () => _handleMarkReady(order, view),
                        icon: isBusy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.check_circle_outline, size: 18),
                        label: Text(
                          isBusy ? 'جاري التأكيد...' : 'الطلب جاهز',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                  ],
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0FDFA),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF99F6E4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.verified, color: MerchantAppConfig.brandTeal, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          order['captain_name'] != null
                              ? 'تم تأكيد تجهيز طلب متجرك ✓ · الطيار: ${order['captain_name']}'
                              : 'تم تأكيد تجهيز طلب متجرك ✓ · بانتظار استلام الطيار',
                          style: const TextStyle(
                            color: Color(0xFF115E59),
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildProductsTopBarButton({
    required IconData icon,
    required String label,
    required Color color,
    int? badgeCount,
    bool active = false,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
          decoration: BoxDecoration(
            color: active ? color : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: active ? color : color.withOpacity(0.32),
              width: active ? 1.8 : 1.1,
            ),
            boxShadow: const [
              BoxShadow(color: Color(0x0A0F172A), blurRadius: 6, offset: Offset(0, 2)),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 18, color: active ? Colors.white : color),
                  if (badgeCount != null && badgeCount > 0) ...[
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: active ? Colors.white.withOpacity(0.24) : color.withOpacity(0.14),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        '$badgeCount',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w900,
                          color: active ? Colors.white : color,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 5),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: active ? Colors.white : MerchantAppConfig.brandSlate,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProductsTab() {
    final isPausedView = _productViewMode == 'unavailable';
    return RefreshIndicator(
      onRefresh: () => _refreshProducts(page: _productsPage),
      child: Column(
        children: [
          // Top action bar: Add to Offers | Products Without Images (Swipe) | Paused/Hidden Products
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
            child: Row(
              children: [
                _buildProductsTopBarButton(
                  icon: Icons.local_offer_rounded,
                  label: 'إضافة للعروض',
                  color: MerchantAppConfig.brandRed,
                  badgeCount: _totalOfferProducts,
                  onTap: () async {
                    final changed = await showMerchantAddToOffersSheet(
                      context: context,
                      api: widget.api,
                      merchantId: _merchantId,
                    );
                    if (changed) {
                      await _refreshProducts(page: _productsPage);
                    }
                  },
                ),
                const SizedBox(width: 8),
                _buildProductsTopBarButton(
                  icon: Icons.style_rounded,
                  label: 'قسم المنتجات',
                  color: const Color(0xFFD97706),
                  badgeCount: (_totalAllProducts - _totalUnavailableProducts).clamp(0, 999999).toInt(),
                  onTap: () async {
                    if (_categories.isEmpty) {
                      await _loadCategories();
                    }
                    if (!mounted) return;
                    final changed = await showMerchantProductsSwipeDeck(
                      context: context,
                      api: widget.api,
                      merchantId: _merchantId,
                      categories: _categories,
                    );
                    await _loadCategories();
                    if (changed) {
                      await _refreshProducts(page: _productsPage);
                    }
                  },
                ),
                const SizedBox(width: 8),
                _buildProductsTopBarButton(
                  icon: Icons.visibility_off_rounded,
                  label: 'المتوقفة عن الظهور',
                  color: const Color(0xFF475569),
                  badgeCount: _totalUnavailableProducts,
                  active: isPausedView,
                  onTap: () {
                    setState(() {
                      _productViewMode = isPausedView ? 'all' : 'unavailable';
                      _productsPage = 1;
                    });
                    _refreshProducts(page: 1);
                  },
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    onChanged: (v) {
                      _productSearch = v;
                      _productSearchDebounce?.cancel();
                      _productSearchDebounce = Timer(const Duration(milliseconds: 350), () {
                        if (!_disposed) _refreshProducts(page: 1);
                      });
                    },
                    decoration: InputDecoration(
                      hintText: isPausedView
                          ? 'ابحث في المتوقفة عن الظهور ($_productsTotal)...'
                          : 'ابحث في كل منتجات متجرك ($_totalAllProducts)...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      filled: true,
                      fillColor: Colors.white,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                      isDense: true,
                    ),
                  ),
                ),
                if (isPausedView) ...[
                  const SizedBox(width: 8),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _productViewMode = 'all';
                        _productsPage = 1;
                      });
                      _refreshProducts(page: 1);
                    },
                    icon: const Icon(Icons.list_alt_rounded, size: 18),
                    label: const Text('كل المنتجات', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                  ),
                ],
              ],
            ),
          ),
          // Status & total count strip
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  isPausedView
                      ? 'المنتجات المتوقفة عن الظهور: $_productsTotal منتج'
                      : 'إجمالي منتجات المتجر: $_productsTotal منتج',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF475569)),
                ),
                Text(
                  'صفحة $_productsPage من $_productsTotalPages',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: MerchantAppConfig.brandRed),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loadingProducts
                ? const Center(child: CircularProgressIndicator())
                : _products.isEmpty
                    ? Center(
                        child: Text(
                          isPausedView
                              ? 'لا توجد منتجات متوقفة عن الظهور حاليًا'
                              : 'لا توجد منتجات مطابقة للبحث',
                          style: const TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.w700),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                        itemCount: _products.length,
                        itemBuilder: (_, idx) {
                          final p = _products[idx];
                          final avail = p['is_available'] == true || p['is_available'] == 1;
                          final isOffer = p['is_offer'] == true || p['is_offer'] == 1;
                          final isWeighted = p['is_weighted'] == true || p['is_weighted'] == 1;
                          final weightStep = double.tryParse('${p['weight_step'] ?? 0.25}') ?? 0.25;
                          final weightUnit = (p['weight_unit'] ?? 'كجم').toString();
                          final basePrice = double.tryParse('${p['base_price'] ?? p['price'] ?? 0}') ?? 0;
                          final salePrice = p['sale_price'] != null ? double.tryParse('${p['sale_price']}') : null;
                          final imgUrl = (p['image_url'] ?? '').toString().trim();
                          final catName = (p['category_name'] ?? p['category_name_ar'] ?? 'عام').toString();

                          return Card(
                            color: Colors.white,
                            elevation: 0,
                            margin: const EdgeInsets.only(bottom: 8),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                              side: BorderSide(
                                color: !avail
                                    ? const Color(0xFFFCA5A5)
                                    : isOffer
                                        ? MerchantAppConfig.brandRed.withOpacity(0.35)
                                        : const Color(0xFFE2E8F0),
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(10),
                              child: Row(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(10),
                                    child: imgUrl.isNotEmpty
                                        ? Image.network(
                                            imgUrl,
                                            width: 56,
                                            height: 56,
                                            fit: BoxFit.cover,
                                            errorBuilder: (_, __, ___) => Container(
                                              width: 56,
                                              height: 56,
                                              color: const Color(0xFFF1F5F9),
                                              child: const Icon(Icons.image_not_supported_outlined, color: Color(0xFF94A3B8)),
                                            ),
                                          )
                                        : Container(
                                            width: 56,
                                            height: 56,
                                            color: const Color(0xFFFEF3C7),
                                            child: const Icon(Icons.hide_image_outlined, color: Color(0xFFD97706)),
                                          ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          p['name_ar']?.toString() ?? '',
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                                        ),
                                        const SizedBox(height: 3),
                                        Wrap(
                                          spacing: 6,
                                          runSpacing: 4,
                                          children: [
                                            Text(
                                              catName,
                                              style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                                            ),
                                            if (salePrice != null && salePrice < basePrice)
                                              Text(
                                                '${salePrice.toStringAsFixed(2)} ج.م (بدل ${basePrice.toStringAsFixed(2)})',
                                                style: const TextStyle(
                                                  fontSize: 11.5,
                                                  fontWeight: FontWeight.w800,
                                                  color: MerchantAppConfig.brandRed,
                                                ),
                                              )
                                            else
                                              Text(
                                                '${basePrice.toStringAsFixed(2)} ج.م',
                                                style: const TextStyle(
                                                  fontSize: 11.5,
                                                  fontWeight: FontWeight.w800,
                                                  color: MerchantAppConfig.brandSlate,
                                                ),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Wrap(
                                          spacing: 5,
                                          runSpacing: 4,
                                          children: [
                                            if (isOffer)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFFFE4E6),
                                                  borderRadius: BorderRadius.circular(6),
                                                ),
                                                child: const Text(
                                                  'في العروض',
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w800,
                                                    color: MerchantAppConfig.brandRed,
                                                  ),
                                                ),
                                              ),
                                            if (isWeighted)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFFEF3C7),
                                                  borderRadius: BorderRadius.circular(6),
                                                ),
                                                child: Text(
                                                  'بالوزن (+$weightStep $weightUnit)',
                                                  style: const TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w800,
                                                    color: Color(0xFF92400E),
                                                  ),
                                                ),
                                              ),
                                            if (!avail)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFFEE2E2),
                                                  borderRadius: BorderRadius.circular(6),
                                                ),
                                                child: const Text(
                                                  'متوقف عن الظهور',
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w800,
                                                    color: Color(0xFFB91C1C),
                                                  ),
                                                ),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        tooltip: 'تعديل المنتج',
                                        icon: const Icon(Icons.edit_rounded, color: MerchantAppConfig.brandRed, size: 20),
                                        onPressed: () async {
                                          if (_categories.isEmpty) await _loadCategories();
                                          if (!mounted) return;
                                          final updated = await showMerchantEditProductSheet(
                                            context: context,
                                            api: widget.api,
                                            product: p,
                                            categories: _categories,
                                          );
                                          await _loadCategories();
                                          if (updated) {
                                            await _refreshProducts(page: _productsPage);
                                            _snack('تم حفظ تعديلات المنتج بنجاح');
                                          }
                                        },
                                      ),
                                      Switch(
                                        value: avail,
                                        activeThumbColor: MerchantAppConfig.brandTeal,
                                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        onChanged: (val) async {
                                          try {
                                            await widget.api.updateProduct(
                                              productId: p['id'].toString(),
                                              isAvailable: val,
                                            );
                                            await _refreshProducts(page: _productsPage);
                                            _snack(val ? 'تم إعادة إظهار المنتج للعملاء' : 'تم إيقاف ظهور المنتج مؤقتًا');
                                          } catch (e) {
                                            _snack(e.toString(), isError: true);
                                          }
                                        },
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          // Sequential Pagination Controls for ALL merchant products
          if (_productsTotalPages > 1)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  OutlinedButton.icon(
                    onPressed: _productsPage > 1 && !_loadingProducts
                        ? () => _refreshProducts(page: _productsPage - 1)
                        : null,
                    icon: const Icon(Icons.chevron_right_rounded, size: 18),
                    label: const Text('الصفحة السابقة', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                  ),
                  Text(
                    '$_productsPage / $_productsTotalPages',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
                  ),
                  OutlinedButton.icon(
                    onPressed: _productsPage < _productsTotalPages && !_loadingProducts
                        ? () => _refreshProducts(page: _productsPage + 1)
                        : null,
                    icon: const Icon(Icons.chevron_left_rounded, size: 18),
                    label: const Text('الصفحة التالية', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildExcelAndApprovalsTab() {
    return RefreshIndicator(
      onRefresh: _refreshApprovalRequests,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [MerchantAppConfig.brandRed, Color(0xFF7F1D1D)],
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'إضافة منتجات جديدة واعتماد الكتالوج',
                  style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                const Text(
                  'أضف منتجًا جديدًا مباشرة من هنا (مع دعم البيع بالوزن بأقل من واحد صحيح) أو ارفع ملف Excel لمنتجاتك للاعتماد والنشر.',
                  style: TextStyle(color: Color(0xFFFEE2E2), fontSize: 12),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: MerchantAppConfig.brandRed,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () async {
                          if (_categories.isEmpty) await _loadCategories();
                          if (!mounted) return;
                          final added = await showMerchantAddProductSheet(
                            context: context,
                            api: widget.api,
                            merchantId: _merchantId,
                            categories: _categories,
                          );
                          await _loadCategories();
                          if (added) {
                            await _refreshApprovalRequests();
                            await _refreshProducts(page: 1);
                            _snack('تم إرسال المنتج الجديد للاعتماد بنجاح ✓');
                          }
                        },
                        icon: const Icon(Icons.add_circle_outline_rounded, size: 20),
                        label: const Text('إضافة منتج', style: TextStyle(fontWeight: FontWeight.w900)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white70),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () => _openExternalUrl(MerchantAppConfig.merchantPortalWebUrl),
                        icon: const Icon(Icons.upload_file, size: 19),
                        label: const Text('رفع ملف Excel', style: TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'طلبات الاعتماد المرسلة للإدارة (${_approvalRequests.length})',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
          ),
          const SizedBox(height: 8),
          if (_approvalRequests.isEmpty)
            const Card(
              color: Colors.white,
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'لا توجد طلبات اعتماد مرسلة حتى الآن — يمكنك الضغط على «إضافة منتج» أعلاه.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            )
          else
            ..._approvalRequests.map((req) {
              final status = req['status']?.toString() ?? 'pending';
              final isApproved = status == 'approved' || status == 'approved_new' || status == 'linked_existing';
              final label = isApproved
                  ? 'معتمد ✓'
                  : status == 'rejected'
                      ? 'مرفوض'
                      : 'قيد مراجعة الإدارة';
              final isWeighted = req['is_weighted'] == true || req['is_weighted'] == 1;
              final weightStep = req['weight_step'] ?? 0.25;
              final weightUnit = req['weight_unit'] ?? 'كجم';
              return Card(
                color: Colors.white,
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(
                    req['product_name_ar']?.toString() ?? '',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  subtitle: Text(
                    '${req['category_path'] ?? req['category_name'] ?? 'بدون قسم'} · ${req['proposed_price'] ?? 0} ج.م${isWeighted ? ' · بالوزن (+$weightStep $weightUnit)' : ''}',
                    style: const TextStyle(fontSize: 11),
                  ),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: isApproved
                          ? const Color(0xFFDCFCE7)
                          : status == 'rejected'
                              ? const Color(0xFFFFE4E6)
                              : const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildStoreProfileTab() {
    final isOpen = widget.merchant['is_open'] == true || widget.merchant['is_open'] == 1;
    final verified = widget.merchant['verification_status']?.toString() == 'approved';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 26,
                      backgroundColor: const Color(0xFFFEE2E2),
                      child: const Icon(Icons.storefront, color: MerchantAppConfig.brandRed, size: 28),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_businessName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                          Text(
                            widget.merchant['branch_name']?.toString() ?? '',
                            style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    Chip(
                      label: Text(verified ? 'معتمد ✓' : 'قيد المراجعة'),
                      backgroundColor: verified ? const Color(0xFFCCFBF1) : const Color(0xFFFEF3C7),
                    ),
                  ],
                ),
                const Divider(height: 24),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('حالة استقبال الطلبات (المتجر مفتوح)', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(isOpen ? 'متجرك ظاهر للعملاء ويستقبل الطلبات الآن' : 'المتجر مغلق مؤقتًا'),
                  value: isOpen,
                  activeThumbColor: MerchantAppConfig.brandTeal,
                  onChanged: (val) async {
                    try {
                      await widget.api.updateStoreOpenStatus(merchantId: _merchantId, isOpen: val);
                      final updated = Map<String, dynamic>.from(widget.merchant)..['is_open'] = val;
                      widget.onMerchantUpdated(updated);
                      _snack(val ? 'تم فتح المتجر لاستقبال الطلبات' : 'تم إغلاق المتجر مؤقتًا');
                    } catch (e) {
                      _snack(e.toString(), isError: true);
                    }
                  },
                ),
                const SizedBox(height: 8),
                Text('البريد: ${widget.merchant['email'] ?? '-'}', style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 4),
                Text('الهاتف: ${widget.merchant['phone'] ?? '-'}', style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.notifications_active_outlined, color: MerchantAppConfig.brandRed, size: 20),
                    SizedBox(width: 8),
                    Text('إعدادات إشعارات الطلبات الجديدة', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'تصل إشعارات الطلبات الواردة خارج التطبيق (شريط الإشعارات وشاشة القفل) وداخله فور وصول أي طلب لمتجرك.',
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                ),
                const Divider(height: 18),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('صوت تنبيه الطلبات الجديدة', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  value: _soundEnabled,
                  activeThumbColor: MerchantAppConfig.brandTeal,
                  onChanged: (val) async {
                    await MerchantPushNotificationService.instance.setPreferences(sound: val);
                    if (mounted) setState(() => _soundEnabled = val);
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('اهتزاز عند وصول طلب جديد', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  value: _vibrationEnabled,
                  activeThumbColor: MerchantAppConfig.brandTeal,
                  onChanged: (val) async {
                    await MerchantPushNotificationService.instance.setPreferences(vibration: val);
                    if (mounted) setState(() => _vibrationEnabled = val);
                  },
                ),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () async {
                      final ok = await MerchantPushNotificationService.instance.requestPermissions();
                      await MerchantPushNotificationService.instance.scheduleNativeBackgroundSync(fastCheck: true);
                      if (_merchantId.isNotEmpty) {
                        await MerchantPushNotificationService.instance.syncTokenWithBackend(widget.api, _merchantId);
                      }
                      await MerchantPushNotificationService.instance.showSystemNotification(
                        title: 'تم تفعيل إشعارات اطلبها للتجار ✓',
                        body: 'ستصلك إشعارات الطلبات الجديدة خارج التطبيق وداخله فورًا.',
                        channelId: MerchantPushChannels.dispatch,
                      );
                      _snack(ok ? 'الإشعارات مفعلة وتعمل بنجاح ✓' : 'يرجى السماح بالإشعارات من إعدادات الهاتف');
                    },
                    icon: const Icon(Icons.notification_add_outlined, size: 18),
                    label: const Text('اختبار وتأكيد إذن الإشعارات'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFBE123C),
            side: const BorderSide(color: Color(0xFFFDA4AF)),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          onPressed: widget.onLogout,
          icon: const Icon(Icons.logout),
          label: const Text('تسجيل الخروج من تطبيق التاجر', style: TextStyle(fontWeight: FontWeight.w800)),
        ),
      ],
    );
  }

  Future<void> _openNotificationsSheet() async {
    await _refreshNotifications();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return SafeArea(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.78),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                      child: Row(
                        children: [
                          const Icon(Icons.notifications_active, color: MerchantAppConfig.brandRed),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'إشعارات متجرك ($_unreadCount غير مقروء)',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                            ),
                          ),
                          if (_unreadCount > 0)
                            TextButton(
                              onPressed: () async {
                                try {
                                  await widget.api.markAllNotificationsRead();
                                  await _refreshNotifications();
                                  setSheetState(() {});
                                } catch (_) {}
                              },
                              child: const Text('تعليم الكل كمقروء'),
                            ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    if (_notifications.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(32),
                        child: Text(
                          'لا توجد إشعارات حتى الآن — ستظهر هنا كل تنبيهات الطلبات الجديدة فور وصولها.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.separated(
                          shrinkWrap: true,
                          padding: const EdgeInsets.all(12),
                          itemCount: _notifications.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, idx) {
                            final n = _notifications[idx];
                            final isRead = n['is_read'] == true || n['is_read'] == 1;
                            final id = n['id']?.toString() ?? '';
                            return InkWell(
                              borderRadius: BorderRadius.circular(14),
                              onTap: () async {
                                if (!isRead && id.isNotEmpty) {
                                  try {
                                    await widget.api.markNotificationRead(id);
                                    await _refreshNotifications();
                                    setSheetState(() {});
                                  } catch (_) {}
                                }
                                if (mounted) {
                                  Navigator.pop(ctx);
                                  setState(() {
                                    _tabIndex = 0;
                                    _orderFilter = 'active';
                                  });
                                }
                              },
                              child: Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: isRead ? const Color(0xFFF8FAFC) : const Color(0xFFFFF1F2),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: isRead ? const Color(0xFFE2E8F0) : const Color(0xFFFECDD3),
                                  ),
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Icon(
                                      isRead ? Icons.notifications_none : Icons.notifications_active,
                                      size: 20,
                                      color: isRead ? const Color(0xFF64748B) : MerchantAppConfig.brandRed,
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            n['title_ar']?.toString() ?? 'إشعار جديد',
                                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                                          ),
                                          const SizedBox(height: 3),
                                          Text(
                                            n['body_ar']?.toString() ?? '',
                                            style: const TextStyle(fontSize: 12, color: Color(0xFF334155)),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _buildOrdersTab(),
      _buildProductsTab(),
      _buildExcelAndApprovalsTab(),
      _buildStoreProfileTab(),
    ];

    return Scaffold(
      backgroundColor: MerchantAppConfig.surfaceBg,
      appBar: AppBar(
        backgroundColor: MerchantAppConfig.brandSlate,
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_businessName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const Text('تطبيق اطلبها للتجار', style: TextStyle(fontSize: 11, color: Color(0xFFCBD5E1))),
          ],
        ),
        actions: [
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: const Icon(Icons.notifications_outlined),
                tooltip: 'الإشعارات',
                onPressed: _openNotificationsSheet,
              ),
              if (_unreadCount > 0)
                Positioned(
                  top: 8,
                  right: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: MerchantAppConfig.brandRed,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      _unreadCount > 99 ? '99+' : '$_unreadCount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
            onPressed: () {
              _refreshOrders();
              _refreshNotifications();
              _refreshProducts();
              _refreshApprovalRequests();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          if (_bannerTitle != null)
            Material(
              color: MerchantAppConfig.brandRed,
              elevation: 4,
              child: InkWell(
                onTap: () {
                  setState(() {
                    _bannerTitle = null;
                    _bannerBody = null;
                    _tabIndex = 0;
                    _orderFilter = 'active';
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Row(
                    children: [
                      const Icon(Icons.notifications_active, color: Colors.white, size: 22),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _bannerTitle!,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 13,
                              ),
                            ),
                            if (_bannerBody != null && _bannerBody!.isNotEmpty)
                              Text(
                                _bannerBody!,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: Color(0xFFFEE2E2), fontSize: 11.5),
                              ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white, size: 18),
                        onPressed: () => setState(() {
                          _bannerTitle = null;
                          _bannerBody = null;
                        }),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          Expanded(child: IndexedStack(index: _tabIndex, children: pages)),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (idx) => setState(() => _tabIndex = idx),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long, color: MerchantAppConfig.brandRed),
            label: 'الطلبات',
          ),
          NavigationDestination(
            icon: Icon(Icons.inventory_2_outlined),
            selectedIcon: Icon(Icons.inventory_2, color: MerchantAppConfig.brandRed),
            label: 'منتجاتي',
          ),
          NavigationDestination(
            icon: Icon(Icons.table_view_outlined),
            selectedIcon: Icon(Icons.table_view, color: MerchantAppConfig.brandRed),
            label: 'Excel والاعتماد',
          ),
          NavigationDestination(
            icon: Icon(Icons.store_outlined),
            selectedIcon: Icon(Icons.store, color: MerchantAppConfig.brandRed),
            label: 'متجري',
          ),
        ],
      ),
    );
  }
}
