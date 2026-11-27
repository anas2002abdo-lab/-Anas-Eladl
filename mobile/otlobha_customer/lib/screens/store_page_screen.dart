import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';
import 'storefront_product_pager_sheet.dart';

class StorePageScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String merchantId;
  final String? initialStoreName;
  final Map<String, int> cart;
  final int Function() getCartCount;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onOpenStore;
  final bool isGuest;
  final VoidCallback? onRequireAuth;

  const StorePageScreen({
    super.key,
    required this.api,
    required this.merchantId,
    this.initialStoreName,
    required this.cart,
    required this.getCartCount,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onSelectBrand,
    required this.onOpenStore,
    this.isGuest = false,
    this.onRequireAuth,
  });

  @override
  State<StorePageScreen> createState() => _StorePageScreenState();
}

class _StorePageScreenState extends State<StorePageScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl = TabController(length: 3, vsync: this);
  final ScrollController _productsScrollCtrl = ScrollController();
  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _searchDebounce;

  bool _loadingStore = true;
  String? _storeError;
  Map<String, dynamic> _store = {};
  List<Map<String, dynamic>> _storeCategories = [];
  List<Map<String, dynamic>> _deals = [];
  Map<String, dynamic> _customerState = {};

  // Products state (paginated / infinite scroll)
  bool _loadingProducts = true;
  bool _loadingMoreProducts = false;
  bool _hasMoreProducts = false;
  int _productsPage = 1;
  String _selectedCategoryId = '';
  bool _offersOnly = false;
  String _searchQuery = '';
  String _productSort = 'default';
  List<Map<String, dynamic>> _products = [];

  // Reviews state
  bool _loadingReviews = false;
  String _reviewsSort = 'newest';
  Map<String, dynamic> _reviewsSummary = {};
  List<Map<String, dynamic>> _reviews = [];
  bool _followBusy = false;

  static const Color _brandRed = Color(0xFFA92224);
  static const Color _brandGold = Color(0xFFF5A623);

  @override
  void initState() {
    super.initState();
    _productsScrollCtrl.addListener(_onProductsScroll);
    _loadStoreProfile();
    _loadProducts(reset: true);
    _loadReviews();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _tabCtrl.dispose();
    _productsScrollCtrl.removeListener(_onProductsScroll);
    _productsScrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onProductsScroll() {
    if (!_productsScrollCtrl.hasClients || _loadingProducts || _loadingMoreProducts || !_hasMoreProducts) return;
    final pos = _productsScrollCtrl.position;
    if (pos.pixels >= pos.maxScrollExtent - 300) {
      _loadProducts(reset: false);
    }
  }

  Future<void> _loadStoreProfile() async {
    if (mounted) {
      setState(() {
        _loadingStore = _store.isEmpty;
        _storeError = null;
      });
    }
    try {
      final res = await widget.api.getStorePage(widget.merchantId);
      if (!mounted) return;
      final storeMap = res['store'] is Map ? Map<String, dynamic>.from(res['store'] as Map) : <String, dynamic>{};
      final rawCats = (res['categories'] as List?) ?? [];
      final rawDeals = (res['deals'] as List?) ?? [];
      final custState =
          res['customer_state'] is Map ? Map<String, dynamic>.from(res['customer_state'] as Map) : <String, dynamic>{};
      setState(() {
        _store = storeMap;
        _storeCategories = rawCats.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _deals = rawDeals.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _customerState = custState;
        _loadingStore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingStore = false;
        _storeError = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _loadProducts({required bool reset}) async {
    if (reset) {
      if (mounted) {
        setState(() {
          _loadingProducts = true;
          _productsPage = 1;
        });
      }
    } else {
      if (_loadingMoreProducts || !_hasMoreProducts) return;
      if (mounted) setState(() => _loadingMoreProducts = true);
    }

    final targetPage = reset ? 1 : _productsPage + 1;
    try {
      final res = await widget.api.getStoreProducts(
        widget.merchantId,
        categoryId: _selectedCategoryId.isNotEmpty ? _selectedCategoryId : null,
        offersOnly: _offersOnly,
        query: _searchQuery.isNotEmpty ? _searchQuery : null,
        sort: _productSort,
        page: targetPage,
        limit: 20,
      );
      if (!mounted) return;
      final raw = (res['products'] as List?) ?? [];
      final parsed = raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      final pag = res['pagination'] is Map ? Map<String, dynamic>.from(res['pagination'] as Map) : <String, dynamic>{};
      setState(() {
        if (reset) {
          _products = parsed;
        } else {
          final seen = _products.map((p) => (p['id'] ?? '').toString()).toSet();
          for (final item in parsed) {
            final pid = (item['id'] ?? '').toString();
            if (pid.isEmpty || !seen.contains(pid)) {
              _products.add(item);
              seen.add(pid);
            }
          }
        }
        _productsPage = targetPage;
        _hasMoreProducts = pag['has_more'] == true;
        _loadingProducts = false;
        _loadingMoreProducts = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingProducts = false;
        _loadingMoreProducts = false;
      });
    }
  }

  Future<void> _loadReviews() async {
    if (mounted) setState(() => _loadingReviews = true);
    try {
      final res = await widget.api.getStoreReviews(widget.merchantId, sort: _reviewsSort, page: 1, limit: 30);
      if (!mounted) return;
      final summary = res['summary'] is Map ? Map<String, dynamic>.from(res['summary'] as Map) : <String, dynamic>{};
      final raw = (res['reviews'] as List?) ?? [];
      setState(() {
        _reviewsSummary = summary;
        _reviews = raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loadingReviews = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingReviews = false);
    }
  }

  void _snack(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: isError ? const Color(0xFFB91C1C) : const Color(0xFF0F172A),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> _toggleFollow() async {
    if (widget.isGuest || !widget.api.hasTokens) {
      _snack('سجّل الدخول أولاً لمتابعة المتجر وتلقي إشعارات العروض');
      widget.onRequireAuth?.call();
      return;
    }
    if (_followBusy) return;
    setState(() => _followBusy = true);
    final currentlyFollowing = _customerState['is_following'] == true;
    try {
      final res = currentlyFollowing
          ? await widget.api.unfollowStore(widget.merchantId)
          : await widget.api.followStore(widget.merchantId);
      if (!mounted) return;
      setState(() {
        _customerState = {
          ..._customerState,
          'is_following': res['is_following'] == true,
          if (res['notification_prefs'] is Map) 'notification_prefs': res['notification_prefs'],
        };
        _store = {
          ..._store,
          'followers_count': res['followers_count'] ?? _store['followers_count'] ?? 0,
        };
      });
      _snack(res['is_following'] == true ? 'تمت إضافة المتجر إلى المفضلة والمتابعة ✓' : 'تم إلغاء متابعة المتجر');
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), isError: true);
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  Future<void> _showNotificationPrefsSheet() async {
    if (widget.isGuest || !widget.api.hasTokens) {
      _snack('سجّل الدخول أولاً لتخصيص إشعارات المتجر');
      widget.onRequireAuth?.call();
      return;
    }
    if (_customerState['is_following'] != true) {
      await _toggleFollow();
      if (_customerState['is_following'] != true) return;
    }

    final prefs = _customerState['notification_prefs'] is Map
        ? Map<String, dynamic>.from(_customerState['notification_prefs'] as Map)
        : <String, dynamic>{};
    bool notifyOffers = prefs['notify_new_offers'] != false;
    bool notifyDiscounts = prefs['notify_discounts'] != false;
    bool notifyNewProducts = prefs['notify_new_products'] != false;
    bool notifyBackInStock = prefs['notify_back_in_stock'] != false;
    bool saving = false;

    await showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'إعدادات إشعارات المتجر',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                ),
                const SizedBox(height: 4),
                const Text(
                  'تحكم في التنبيهات التي تصلك من هذا المتجر بدون إزعاج:',
                  style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B)),
                ),
                const SizedBox(height: 10),
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  activeColor: _brandRed,
                  title: const Text('إضافة عرض جديد', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  value: notifyOffers,
                  onChanged: (v) => setModalState(() => notifyOffers = v),
                ),
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  activeColor: _brandRed,
                  title: const Text('خصومات لفترة محدودة', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  value: notifyDiscounts,
                  onChanged: (v) => setModalState(() => notifyDiscounts = v),
                ),
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  activeColor: _brandRed,
                  title: const Text('إضافة منتجات جديدة', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  value: notifyNewProducts,
                  onChanged: (v) => setModalState(() => notifyNewProducts = v),
                ),
                SwitchListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  activeColor: _brandRed,
                  title: const Text('عودة منتج غير متوفر للمخزون', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  value: notifyBackInStock,
                  onChanged: (v) => setModalState(() => notifyBackInStock = v),
                ),
                const SizedBox(height: 12),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _brandRed,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(46),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: saving
                      ? null
                      : () async {
                          setModalState(() => saving = true);
                          try {
                            final res = await widget.api.updateStoreFollowPreferences(
                              widget.merchantId,
                              notifyNewOffers: notifyOffers,
                              notifyDiscounts: notifyDiscounts,
                              notifyNewProducts: notifyNewProducts,
                              notifyBackInStock: notifyBackInStock,
                            );
                            if (mounted && res['notification_prefs'] is Map) {
                              setState(() {
                                _customerState = {
                                  ..._customerState,
                                  'notification_prefs': res['notification_prefs'],
                                };
                              });
                            }
                            if (ctx.mounted) Navigator.pop(ctx);
                            _snack('تم حفظ تفضيلات إشعارات المتجر ✓');
                          } catch (e) {
                            setModalState(() => saving = false);
                            _snack(e.toString().replaceFirst('Exception: ', ''), isError: true);
                          }
                        },
                  child: Text(saving ? 'جاري الحفظ...' : 'حفظ تفضيلات الإشعارات'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _shareStoreLink() async {
    final shareUrl = (_store['share_url'] ?? '').toString().trim();
    final storeName = (_store['business_name_ar'] ?? widget.initialStoreName ?? 'متجر اطلبها').toString();
    final fallbackUrl = '${OtlobhaCustomerApi.baseUrl}/store/${Uri.encodeComponent(widget.merchantId)}';
    final urlToShare = shareUrl.isNotEmpty ? shareUrl : fallbackUrl;
    await Clipboard.setData(ClipboardData(text: urlToShare));
    _snack('تم نسخ رابط متجر "$storeName" لمشاركته:\n$urlToShare');
  }

  Future<void> _openStoreReviewDialog({Map<String, dynamic>? editingReview}) async {
    if (widget.isGuest || !widget.api.hasTokens) {
      _snack('سجّل الدخول أولاً لإضافة تقييمك');
      widget.onRequireAuth?.call();
      return;
    }

    final eligible = ((_customerState['eligible_orders_for_review'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

    if (editingReview == null && eligible.isEmpty) {
      _snack('يمكنك تقييم هذا المتجر بعد إكمال واستلام طلب حقيقي منه.');
      return;
    }

    int stars = editingReview != null ? ((editingReview['rating'] as num?)?.toInt() ?? 5) : 5;
    String selectedOrderId = editingReview != null
        ? (editingReview['order_id'] ?? '').toString()
        : (eligible.first['order_id'] ?? '').toString();
    final commentCtrl = TextEditingController(text: editingReview?['comment']?.toString() ?? '');
    bool submitting = false;

    final done = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: Text(editingReview != null ? 'تعديل تقييم المتجر' : 'تقييم المتجر'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (editingReview == null && eligible.length > 1) ...[
                    const Text('اختر الطلب المكتمل:', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedOrderId,
                      isExpanded: true,
                      decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
                      items: eligible
                          .map(
                            (o) => DropdownMenuItem<String>(
                              value: (o['order_id'] ?? '').toString(),
                              child: Text('طلب #${o['order_number'] ?? ''} (${o['total_amount'] ?? 0} ج.م)'),
                            ),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setModalState(() => selectedOrderId = v);
                      },
                    ),
                    const SizedBox(height: 10),
                  ],
                  const Text('التقييم (من 1 إلى 5 نجوم):', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (i) {
                      final val = i + 1;
                      return IconButton(
                        onPressed: () => setModalState(() => stars = val),
                        icon: Icon(
                          val <= stars ? Icons.star_rounded : Icons.star_outline_rounded,
                          color: _brandGold,
                          size: 32,
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: commentCtrl,
                    maxLines: 3,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'اكتب تجربتك مع المتجر (اختياري)',
                      hintText: 'جودة المنتجات، التغليف، سرعة التجهيز...',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: submitting ? null : () => Navigator.pop(ctx, false),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: _brandRed, foregroundColor: Colors.white),
                onPressed: submitting
                    ? null
                    : () async {
                        setModalState(() => submitting = true);
                        try {
                          if (editingReview != null) {
                            await widget.api.updateStoreReview(
                              widget.merchantId,
                              (editingReview['id'] ?? '').toString(),
                              rating: stars,
                              comment: commentCtrl.text.trim(),
                            );
                          } else {
                            await widget.api.submitStoreReview(
                              widget.merchantId,
                              orderId: selectedOrderId,
                              rating: stars,
                              comment: commentCtrl.text.trim(),
                            );
                          }
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (e) {
                          setModalState(() => submitting = false);
                          _snack(e.toString().replaceFirst('Exception: ', ''), isError: true);
                        }
                      },
                child: Text(submitting ? 'جاري الحفظ...' : (editingReview != null ? 'حفظ التعديل' : 'إرسال التقييم')),
              ),
            ],
          ),
        ),
      ),
    );
    commentCtrl.dispose();
    if (done == true) {
      _snack(editingReview != null ? 'تم تحديث تقييمك للمتجر ✓' : 'شكراً لتقييمك! تم نشر تقييمك بنجاح ✓');
      await Future.wait([_loadStoreProfile(), _loadReviews()]);
    }
  }

  Future<void> _reportStoreReview(String reviewId) async {
    if (widget.isGuest || !widget.api.hasTokens) {
      _snack('سجّل الدخول أولاً للإبلاغ عن تعليق');
      return;
    }
    String selectedReason = 'ألفاظ مسيئة أو غير لائقة';
    final detailsCtrl = TextEditingController();
    bool busy = false;
    const reasons = [
      'ألفاظ مسيئة أو غير لائقة',
      'تقييم وهمي أو مضلّل',
      'محتوى إعلاني أو سبام',
      'معلومات شخصية حساسة',
    ];

    final sent = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Text('الإبلاغ عن تعليق مسيء'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ...reasons.map(
                  (r) => RadioListTile<String>(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    value: r,
                    groupValue: selectedReason,
                    title: Text(r, style: const TextStyle(fontSize: 13)),
                    onChanged: (v) {
                      if (v != null) setModalState(() => selectedReason = v);
                    },
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: detailsCtrl,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'تفاصيل إضافية (اختياري)',
                    isDense: true,
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: busy ? null : () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: _brandRed, foregroundColor: Colors.white),
                onPressed: busy
                    ? null
                    : () async {
                        setModalState(() => busy = true);
                        try {
                          await widget.api.reportReview(
                            reviewType: 'store',
                            reviewId: reviewId,
                            reason: selectedReason,
                            details: detailsCtrl.text.trim(),
                          );
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (e) {
                          setModalState(() => busy = false);
                          _snack(e.toString().replaceFirst('Exception: ', ''), isError: true);
                        }
                      },
                child: Text(busy ? 'جاري الإرسال...' : 'إرسال البلاغ'),
              ),
            ],
          ),
        ),
      ),
    );
    detailsCtrl.dispose();
    if (sent == true) {
      _snack('تم إرسال البلاغ لمراجعة الإدارة بنجاح ✓');
    }
  }

  void _openProductSheet(int index) {
    if (index < 0 || index >= _products.length) return;
    showStorefrontProductPager(
      context: context,
      api: widget.api,
      products: _products,
      initialIndex: index,
      getCartCount: widget.getCartCount,
      onAddToCart: (p, delta) {
        widget.onAddProduct(p, delta);
        if (mounted) setState(() {});
      },
      onOpenCart: () {
        Navigator.of(context).pop();
        widget.onOpenCart();
      },
      onSelectBrand: (brand) {
        Navigator.of(context).pop();
        widget.onSelectBrand(brand);
      },
      onSelectStore: (mId, mName) {
        if (mId != widget.merchantId) {
          widget.onOpenStore(mId, mName);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final storeName = (_store['business_name_ar'] ?? widget.initialStoreName ?? 'صفحة المتجر').toString();
    final logoUrl = OtlobhaCustomerApi.resolveMediaUrl(_store['image_url']);
    final coverUrl = OtlobhaCustomerApi.resolveMediaUrl(_store['cover_image_url']);
    final isOpen = _store['is_open_now'] != false;
    final ratingAvg = (_store['rating_avg'] as num?)?.toDouble() ?? 0.0;
    final ratingCount = (_store['rating_count'] as num?)?.toInt() ?? 0;
    final followersCount = (_store['followers_count'] as num?)?.toInt() ?? 0;
    final workingHours = (_store['working_hours'] ?? '09:00 ص - 12:00 م').toString();
    final address = (_store['address_detail'] ?? _store['branch_name'] ?? _store['zone_name'] ?? '').toString();
    final description = (_store['description_ar'] ?? '').toString().trim();
    final isFollowing = _customerState['is_following'] == true;
    final cartCount = widget.getCartCount();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        floatingActionButton: cartCount > 0
            ? FloatingActionButton.extended(
                onPressed: () {
                  Navigator.of(context).pop();
                  widget.onOpenCart();
                },
                backgroundColor: _brandRed,
                foregroundColor: Colors.white,
                icon: const Icon(Icons.shopping_cart_rounded),
                label: Text('السلة ($cartCount)', style: const TextStyle(fontWeight: FontWeight.w800)),
              )
            : null,
        body: _loadingStore
            ? const Center(child: CircularProgressIndicator())
            : _storeError != null && _store.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.store_mall_directory_outlined, size: 52, color: Color(0xFF94A3B8)),
                          const SizedBox(height: 12),
                          Text(_storeError!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF334155))),
                          const SizedBox(height: 14),
                          ElevatedButton.icon(
                            onPressed: () {
                              _loadStoreProfile();
                              _loadProducts(reset: true);
                              _loadReviews();
                            },
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('إعادة المحاولة'),
                            style: ElevatedButton.styleFrom(backgroundColor: _brandRed, foregroundColor: Colors.white),
                          ),
                        ],
                      ),
                    ),
                  )
                : NestedScrollView(
                    headerSliverBuilder: (context, innerScrolled) => [
                      SliverAppBar(
                        expandedHeight: 195,
                        pinned: true,
                        backgroundColor: _brandRed,
                        foregroundColor: Colors.white,
                        title: innerScrolled
                            ? Text(storeName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))
                            : null,
                        actions: [
                          IconButton(
                            onPressed: _shareStoreLink,
                            tooltip: 'مشاركة رابط المتجر',
                            icon: const Icon(Icons.share_rounded),
                          ),
                          IconButton(
                            onPressed: _showNotificationPrefsSheet,
                            tooltip: 'إعدادات إشعارات المتجر',
                            icon: Icon(isFollowing ? Icons.notifications_active_rounded : Icons.notifications_none_rounded),
                          ),
                        ],
                        flexibleSpace: FlexibleSpaceBar(
                          background: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (coverUrl.isNotEmpty)
                                Image.network(
                                  coverUrl,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => _defaultCoverGradient(),
                                )
                              else
                                _defaultCoverGradient(),
                              Container(
                                decoration: const BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topCenter,
                                    end: Alignment.bottomCenter,
                                    colors: [Color(0x55000000), Color(0x22000000), Color(0xCC0F172A)],
                                  ),
                                ),
                              ),
                              Positioned(
                                right: 16,
                                left: 16,
                                bottom: 14,
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Container(
                                      width: 68,
                                      height: 68,
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        borderRadius: BorderRadius.circular(18),
                                        border: Border.all(color: Colors.white, width: 2.5),
                                        boxShadow: const [
                                          BoxShadow(color: Color(0x33000000), blurRadius: 10, offset: Offset(0, 4)),
                                        ],
                                      ),
                                      clipBehavior: Clip.antiAlias,
                                      child: logoUrl.isNotEmpty
                                          ? Image.network(
                                              logoUrl,
                                              fit: BoxFit.cover,
                                              errorBuilder: (_, __, ___) => const Icon(Icons.storefront_rounded, size: 34, color: _brandRed),
                                            )
                                          : const Icon(Icons.storefront_rounded, size: 34, color: _brandRed),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(
                                            storeName,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 18,
                                              fontWeight: FontWeight.w900,
                                            ),
                                          ),
                                          const SizedBox(height: 4),
                                          Row(
                                            children: [
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: isOpen ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text(
                                                  isOpen ? 'مفتوح الآن' : 'مغلق حالياً',
                                                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800),
                                                ),
                                              ),
                                              const SizedBox(width: 8),
                                              const Icon(Icons.star_rounded, color: _brandGold, size: 16),
                                              const SizedBox(width: 2),
                                              Text(
                                                ratingCount > 0 ? '${ratingAvg.toStringAsFixed(1)} ($ratingCount)' : 'جديد',
                                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
                                              ),
                                              const SizedBox(width: 8),
                                              Text(
                                                '· $followersCount متابع',
                                                style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 11.5),
                                              ),
                                            ],
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      SliverToBoxAdapter(
                        child: Container(
                          color: Colors.white,
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (description.isNotEmpty) ...[
                                Text(
                                  description,
                                  style: const TextStyle(fontSize: 13, color: Color(0xFF334155), height: 1.45),
                                ),
                                const SizedBox(height: 10),
                              ],
                              Wrap(
                                spacing: 14,
                                runSpacing: 6,
                                children: [
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.access_time_rounded, size: 15, color: Color(0xFF64748B)),
                                      const SizedBox(width: 4),
                                      Text(workingHours, style: const TextStyle(fontSize: 12, color: Color(0xFF475569))),
                                    ],
                                  ),
                                  if (address.isNotEmpty)
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const Icon(Icons.location_on_outlined, size: 15, color: Color(0xFF64748B)),
                                        const SizedBox(width: 4),
                                        Flexible(
                                          child: Text(
                                            address,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
                                          ),
                                        ),
                                      ],
                                    ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Expanded(
                                    child: ElevatedButton.icon(
                                      onPressed: _followBusy ? null : _toggleFollow,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: isFollowing ? const Color(0xFFF1F5F9) : _brandRed,
                                        foregroundColor: isFollowing ? const Color(0xFF0F172A) : Colors.white,
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                        padding: const EdgeInsets.symmetric(vertical: 10),
                                      ),
                                      icon: Icon(isFollowing ? Icons.favorite_rounded : Icons.favorite_border_rounded, size: 18, color: isFollowing ? _brandRed : Colors.white),
                                      label: Text(
                                        isFollowing ? 'تتابع المتجر ✓' : 'متابعة وإضافة للمفضلة',
                                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  OutlinedButton.icon(
                                    onPressed: _shareStoreLink,
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: const Color(0xFF0F172A),
                                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                    ),
                                    icon: const Icon(Icons.share_outlined, size: 17),
                                    label: const Text('مشاركة', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _StoreTabHeaderDelegate(
                          TabBar(
                            controller: _tabCtrl,
                            labelColor: _brandRed,
                            unselectedLabelColor: const Color(0xFF64748B),
                            indicatorColor: _brandRed,
                            indicatorWeight: 3,
                            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                            tabs: [
                              Tab(text: 'المنتجات (${_store['total_products'] ?? _products.length})'),
                              Tab(text: 'التقييمات ($ratingCount)'),
                              const Tab(text: 'عن المتجر'),
                            ],
                          ),
                        ),
                      ),
                    ],
                    body: TabBarView(
                      controller: _tabCtrl,
                      children: [
                        _buildProductsTab(),
                        _buildReviewsTab(),
                        _buildAboutTab(),
                      ],
                    ),
                  ),
      ),
    );
  }

  Widget _defaultCoverGradient() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [Color(0xFF7F1D1D), Color(0xFFA92224), Color(0xFFD97706)],
        ),
      ),
    );
  }

  Widget _buildProductsTab() {
    return Column(
      children: [
        // Store internal search & sort bar
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  onChanged: (val) {
                    _searchDebounce?.cancel();
                    _searchDebounce = Timer(const Duration(milliseconds: 350), () {
                      if (!mounted) return;
                      _searchQuery = val.trim();
                      _loadProducts(reset: true);
                    });
                  },
                  decoration: InputDecoration(
                    hintText: 'ابحث داخل منتجات المتجر...',
                    prefixIcon: const Icon(Icons.search_rounded, size: 20),
                    suffixIcon: _searchCtrl.text.isNotEmpty
                        ? IconButton(
                            onPressed: () {
                              _searchCtrl.clear();
                              _searchQuery = '';
                              _loadProducts(reset: true);
                            },
                            icon: const Icon(Icons.close, size: 18),
                          )
                        : null,
                    filled: true,
                    fillColor: const Color(0xFFF1F5F9),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              PopupMenuButton<String>(
                tooltip: 'ترتيب المنتجات',
                onSelected: (val) {
                  setState(() => _productSort = val);
                  _loadProducts(reset: true);
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'default', child: Text('الافتراضي')),
                  PopupMenuItem(value: 'offers', child: Text('العروض أولاً')),
                  PopupMenuItem(value: 'price_asc', child: Text('الأقل سعراً')),
                  PopupMenuItem(value: 'price_desc', child: Text('الأعلى سعراً')),
                  PopupMenuItem(value: 'newest', child: Text('الأحدث')),
                ],
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.tune_rounded, size: 20, color: Color(0xFF334155)),
                ),
              ),
            ],
          ),
        ),

        // Internal Store Categories strip (strictly derived from existing platform categories)
        Container(
          color: Colors.white,
          height: 46,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            children: [
              _categoryFilterButton(
                label: 'الكل',
                selected: _selectedCategoryId.isEmpty && !_offersOnly,
                onTap: () {
                  setState(() {
                    _selectedCategoryId = '';
                    _offersOnly = false;
                  });
                  _loadProducts(reset: true);
                },
              ),
              if (((_store['offers_count'] as num?)?.toInt() ?? 0) > 0)
                _categoryFilterButton(
                  label: 'العروض (${_store['offers_count']})',
                  selected: _offersOnly,
                  onTap: () {
                    setState(() {
                      _offersOnly = true;
                      _selectedCategoryId = '';
                    });
                    _loadProducts(reset: true);
                  },
                ),
              ..._storeCategories.map((cat) {
                final cid = (cat['id'] ?? '').toString();
                final cname = (cat['name_ar'] ?? '').toString();
                final cnt = (cat['products_count'] as num?)?.toInt() ?? 0;
                return _categoryFilterButton(
                  label: '$cname ($cnt)',
                  selected: !_offersOnly && _selectedCategoryId == cid,
                  onTap: () {
                    setState(() {
                      _offersOnly = false;
                      _selectedCategoryId = cid;
                    });
                    _loadProducts(reset: true);
                  },
                );
              }),
            ],
          ),
        ),

        if (_deals.isNotEmpty)
          Container(
            height: 62,
            color: const Color(0xFFFFF7ED),
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _deals.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final d = _deals[i];
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFED7AA)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.local_offer_rounded, size: 16, color: _brandRed),
                      const SizedBox(width: 6),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            (d['title_ar'] ?? '').toString(),
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF9A3412)),
                          ),
                          if ((d['subtitle_ar'] ?? '').toString().isNotEmpty)
                            Text(
                              d['subtitle_ar'].toString(),
                              style: const TextStyle(fontSize: 10.5, color: Color(0xFF7C2D12)),
                            ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),

        const Divider(height: 1, color: Color(0xFFE2E8F0)),

        // Paginated Products Grid
        Expanded(
          child: _loadingProducts
              ? const Center(child: CircularProgressIndicator())
              : _products.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.inventory_2_outlined, size: 46, color: Color(0xFF94A3B8)),
                            const SizedBox(height: 10),
                            const Text('لا توجد منتجات مطابقة في هذا القسم حالياً', style: TextStyle(color: Color(0xFF64748B))),
                            if (_selectedCategoryId.isNotEmpty || _offersOnly || _searchQuery.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              TextButton(
                                onPressed: () {
                                  _searchCtrl.clear();
                                  setState(() {
                                    _selectedCategoryId = '';
                                    _offersOnly = false;
                                    _searchQuery = '';
                                  });
                                  _loadProducts(reset: true);
                                },
                                child: const Text('عرض جميع منتجات المتجر'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _loadProducts(reset: true),
                      child: GridView.builder(
                        controller: _productsScrollCtrl,
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 90),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          childAspectRatio: 0.62,
                        ),
                        itemCount: _products.length + (_loadingMoreProducts ? 2 : 0),
                        itemBuilder: (ctx, i) {
                          if (i >= _products.length) {
                            return const Center(child: CircularProgressIndicator(strokeWidth: 2));
                          }
                          final prod = _products[i];
                          final pid = (prod['id'] ?? '').toString();
                          final available = prod['is_available'] != false;
                          return Stack(
                            children: [
                              Opacity(
                                opacity: available ? 1.0 : 0.6,
                                child: StorefrontProductCardWidget(
                                  product: prod,
                                  cartQty: widget.cart[pid] ?? 0,
                                  onTapDetails: () => _openProductSheet(i),
                                  onAdd: available
                                      ? () {
                                          widget.onAddProduct(prod, 1);
                                          setState(() {});
                                        }
                                      : () => _snack('هذا المنتج غير متوفر حالياً'),
                                  onDecrement: () {
                                    widget.onAddProduct(prod, -1);
                                    setState(() {});
                                  },
                                ),
                              ),
                              if (!available)
                                Positioned(
                                  top: 8,
                                  right: 8,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: const Color(0xCC0F172A),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Text(
                                      'غير متوفر',
                                      style: TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800),
                                    ),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                    ),
        ),
      ],
    );
  }

  Widget _categoryFilterButton({required String label, required bool selected, required VoidCallback onTap}) {
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? _brandRed : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(10),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : const Color(0xFF334155),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildReviewsTab() {
    final avg = (_reviewsSummary['rating_avg'] as num?)?.toDouble() ??
        (_store['rating_avg'] as num?)?.toDouble() ??
        0.0;
    final count = (_reviewsSummary['rating_count'] as num?)?.toInt() ??
        (_store['rating_count'] as num?)?.toInt() ??
        0;
    final dist = _reviewsSummary['distribution'] is Map
        ? Map<String, dynamic>.from(_reviewsSummary['distribution'] as Map)
        : (_store['rating_distribution'] is Map
            ? Map<String, dynamic>.from(_store['rating_distribution'] as Map)
            : <String, dynamic>{});
    final canReview = _customerState['can_review'] == true;

    return RefreshIndicator(
      onRefresh: () async {
        await Future.wait([_loadStoreProfile(), _loadReviews()]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
        children: [
          // Rating Overview Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Column(
                      children: [
                        Text(
                          count > 0 ? avg.toStringAsFixed(1) : '—',
                          style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                        ),
                        Row(
                          children: List.generate(
                            5,
                            (i) => Icon(
                              i < avg.round() ? Icons.star_rounded : Icons.star_outline_rounded,
                              size: 16,
                              color: _brandGold,
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text('$count تقييم موثّق', style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B))),
                      ],
                    ),
                    const SizedBox(width: 20),
                    Expanded(
                      child: Column(
                        children: [5, 4, 3, 2, 1].map((star) {
                          final starCnt = (dist['$star'] as num?)?.toInt() ?? 0;
                          final ratio = count > 0 ? starCnt / count : 0.0;
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              children: [
                                Text('$star', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                                const SizedBox(width: 4),
                                const Icon(Icons.star_rounded, size: 12, color: _brandGold),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: ratio,
                                      minHeight: 6,
                                      backgroundColor: const Color(0xFFF1F5F9),
                                      color: _brandGold,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                SizedBox(
                                  width: 24,
                                  child: Text('$starCnt', textAlign: TextAlign.end, style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _openStoreReviewDialog(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: canReview ? _brandRed : const Color(0xFFF1F5F9),
                      foregroundColor: canReview ? Colors.white : const Color(0xFF475569),
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                    ),
                    icon: const Icon(Icons.rate_review_outlined, size: 18),
                    label: Text(
                      canReview ? 'قيّم هذا المتجر الآن' : 'التقييم متاح بعد استلام طلب مكتمل من المتجر',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // Sort toggle
          Row(
            children: [
              const Text('آراء العملاء', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
              const Spacer(),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'newest', label: Text('الأحدث', style: TextStyle(fontSize: 11.5))),
                  ButtonSegment(value: 'highest', label: Text('الأعلى تقييماً', style: TextStyle(fontSize: 11.5))),
                ],
                selected: {_reviewsSort},
                onSelectionChanged: (sel) {
                  setState(() => _reviewsSort = sel.first);
                  _loadReviews();
                },
              ),
            ],
          ),

          const SizedBox(height: 10),

          if (_loadingReviews)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_reviews.isEmpty)
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: const Column(
                children: [
                  Icon(Icons.reviews_outlined, size: 40, color: Color(0xFF94A3B8)),
                  SizedBox(height: 8),
                  Text('لا توجد تقييمات لهذا المتجر بعد', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF475569))),
                  SizedBox(height: 4),
                  Text('كن أول من يشارك تجربته بعد إتمام طلب من المتجر.', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                ],
              ),
            )
          else
            ..._reviews.map((rev) {
              final rId = (rev['id'] ?? '').toString();
              final rating = (rev['rating'] as num?)?.toInt() ?? 5;
              final isMine = rev['is_mine'] == true;
              final canEdit = rev['can_edit'] == true;
              final comment = (rev['comment'] ?? '').toString().trim();
              final createdAt = (rev['created_at'] ?? '').toString();
              final shortDate = createdAt.length >= 10 ? createdAt.substring(0, 10) : createdAt;

              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 17,
                          backgroundColor: const Color(0xFFFFF7ED),
                          foregroundColor: _brandRed,
                          child: Text(
                            () {
                              final dn = (rev['customer_name_display'] ?? '').toString().trim();
                              return dn.isNotEmpty ? String.fromCharCode(dn.runes.first) : 'ع';
                            }(),
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    (rev['customer_name_display'] ?? 'عميل اطلبها').toString(),
                                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                                  ),
                                  const SizedBox(width: 6),
                                  const Text('· شراء موثّق', style: TextStyle(fontSize: 11, color: Color(0xFF0D9488), fontWeight: FontWeight.w700)),
                                ],
                              ),
                              Row(
                                children: [
                                  ...List.generate(
                                    5,
                                    (i) => Icon(
                                      i < rating ? Icons.star_rounded : Icons.star_outline_rounded,
                                      size: 14,
                                      color: _brandGold,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(shortDate, style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
                                ],
                              ),
                            ],
                          ),
                        ),
                        if (isMine && canEdit)
                          IconButton(
                            tooltip: 'تعديل تقييمي',
                            onPressed: () => _openStoreReviewDialog(editingReview: rev),
                            icon: const Icon(Icons.edit_outlined, size: 18, color: Color(0xFF475569)),
                          )
                        else if (!isMine)
                          IconButton(
                            tooltip: 'إبلاغ عن تعليق مسيء',
                            onPressed: () => _reportStoreReview(rId),
                            icon: const Icon(Icons.flag_outlined, size: 18, color: Color(0xFF94A3B8)),
                          ),
                      ],
                    ),
                    if (comment.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(comment, style: const TextStyle(fontSize: 13, color: Color(0xFF1E293B), height: 1.45)),
                    ],
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildAboutTab() {
    final phone = (_store['phone'] ?? '').toString().trim();
    final whatsapp = (_store['whatsapp_phone'] ?? '').toString().trim();
    final workingHours = (_store['working_hours'] ?? '09:00 ص - 12:00 م').toString();
    final address = (_store['address_detail'] ?? _store['branch_name'] ?? '').toString();
    final zone = (_store['zone_name'] ?? '').toString();
    final description = (_store['description_ar'] ?? '').toString().trim();
    final lat = (_store['lat'] as num?)?.toDouble();
    final lng = (_store['lng'] as num?)?.toDouble();
    final supportsFreeOrder = _store['supports_free_order'] == true;
    final shareUrl = (_store['share_url'] ?? '').toString();

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('معلومات المتجر', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(description, style: const TextStyle(fontSize: 13, color: Color(0xFF334155), height: 1.5)),
              ],
              const Divider(height: 24),
              _infoRow(Icons.access_time_rounded, 'ساعات العمل', workingHours),
              if (zone.isNotEmpty) _infoRow(Icons.map_outlined, 'المنطقة', zone),
              if (address.isNotEmpty) _infoRow(Icons.location_on_outlined, 'العنوان', address),
              _infoRow(
                Icons.edit_note_rounded,
                'الطلب النصي الحر',
                supportsFreeOrder ? 'يدعم إرسال طلبات نصية حرة' : 'الطلب من الكتالوج فقط',
              ),
              if (shareUrl.isNotEmpty) ...[
                const Divider(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        shareUrl,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontSize: 12, color: Color(0xFF475569)),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _shareStoreLink,
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('نسخ الرابط'),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (lat != null && lng != null)
          OutlinedButton.icon(
            onPressed: () {
              final uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');
              launchUrl(uri, mode: LaunchMode.externalApplication);
            },
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.directions_outlined),
            label: const Text('عرض موقع المتجر على الخريطة'),
          ),
        if (phone.isNotEmpty) ...[
          const SizedBox(height: 8),
          ElevatedButton.icon(
            onPressed: () => launchUrl(Uri.parse('tel:$phone')),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0F172A),
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(46),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.phone_outlined),
            label: Text('الاتصال بالمتجر ($phone)'),
          ),
        ],
        if (whatsapp.isNotEmpty) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {
              final digits = whatsapp.replaceAll(RegExp(r'[^0-9]'), '');
              if (digits.isNotEmpty) {
                launchUrl(Uri.parse('https://wa.me/$digits'), mode: LaunchMode.externalApplication);
              }
            },
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFF15803D),
              side: const BorderSide(color: Color(0xFF86EFAC)),
              minimumSize: const Size.fromHeight(46),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.chat_outlined),
            label: const Text('تواصل عبر واتساب'),
          ),
        ],
      ],
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: _brandRed),
          const SizedBox(width: 10),
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(fontSize: 12.5, color: Color(0xFF64748B), fontWeight: FontWeight.w600)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 13, color: Color(0xFF0F172A), fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _StoreTabHeaderDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  _StoreTabHeaderDelegate(this.tabBar);

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: Colors.white,
      child: tabBar,
    );
  }

  @override
  bool shouldRebuild(covariant _StoreTabHeaderDelegate oldDelegate) => false;
}
