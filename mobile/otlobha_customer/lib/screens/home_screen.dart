import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';
import 'storefront_product_pager_sheet.dart';

class HomeScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final String selectedZoneId;
  final void Function(String zoneId) onChangeZone;
  final Map<String, int> cart;
  final Map<String, Map<String, dynamic>> cartProductsCache;
  final String storefrontFilter;
  final String selectedCategoryId;
  final String selectedCategoryName;
  final String selectedBrand;
  final String selectedMerchantId;
  final String selectedMerchantName;
  final void Function(String filter) onChangeFilter;
  final void Function(String categoryId, String categoryName) onSelectCategory;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectMerchant;
  final VoidCallback onClearAllFilters;
  final void Function(List<Map<String, dynamic>> categories) onCategoriesLoaded;
  final VoidCallback onOpenSearch;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final VoidCallback onOpenFreeOrderCart;
  final void Function(String serviceSubView) onOpenService;
  final VoidCallback onOpenOffers;
  final void Function(Map<String, dynamic> target) onRateCaptain;
  final int unreadCount;
  final int liveTrackingCount;
  final VoidCallback? onOpenLiveTracking;
  final VoidCallback? onOpenNotifications;
  final VoidCallback? onOpenDrawer;

  const HomeScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.selectedZoneId,
    required this.onChangeZone,
    required this.cart,
    required this.cartProductsCache,
    required this.storefrontFilter,
    required this.selectedCategoryId,
    required this.selectedCategoryName,
    required this.selectedBrand,
    required this.selectedMerchantId,
    required this.selectedMerchantName,
    required this.onChangeFilter,
    required this.onSelectCategory,
    required this.onSelectBrand,
    required this.onSelectMerchant,
    required this.onClearAllFilters,
    required this.onCategoriesLoaded,
    required this.onOpenSearch,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onOpenFreeOrderCart,
    required this.onOpenService,
    required this.onOpenOffers,
    required this.onRateCaptain,
    this.unreadCount = 0,
    this.liveTrackingCount = 0,
    this.onOpenLiveTracking,
    this.onOpenNotifications,
    this.onOpenDrawer,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ScrollController _scrollCtrl = ScrollController();

  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  int _totalCount = 0;
  String? _error;

  List<Map<String, dynamic>> _banners = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _products = [];
  List<String> _brands = [];

  Timer? _heroFadeTimer;
  int _heroIndex = 0;
  double _scrollOffset = 0;

  static const List<Map<String, dynamic>> _fallbackHeroSlides = [
    {
      'id': 'fallback-1',
      'badge_ar': 'عروض اطلبها الحصرية',
      'title_ar': 'تسوق مقاضي البيت بأفضل سعر في المنزلة',
      'subtitle_ar': 'قارن أسعار السوبر ماركت ووفّر على كل طلب مع توصيل سريع لباب البيت',
      'cta_label': 'تسوّق العروض',
      'target_filter': 'offers',
    },
    {
      'id': 'fallback-2',
      'badge_ar': 'طازج يوميًا',
      'title_ar': 'المخبوزات والخضار والألبان طازجة يوميًا',
      'subtitle_ar': 'توصيل فوري بمتابعة مباشرة مع الطيار لحظة بلحظة حتى الاستلام',
      'cta_label': 'تصفح الطازج',
      'target_filter': 'fresh',
    },
  ];

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_handleScroll);
    _fetchStorefront(reset: true);
    _startHeroTimer();
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.storefrontFilter != widget.storefrontFilter ||
        oldWidget.selectedCategoryId != widget.selectedCategoryId ||
        oldWidget.selectedBrand != widget.selectedBrand ||
        oldWidget.selectedMerchantId != widget.selectedMerchantId) {
      _fetchStorefront(reset: true);
    }
  }

  @override
  void dispose() {
    _heroFadeTimer?.cancel();
    _scrollCtrl.removeListener(_handleScroll);
    _scrollCtrl.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _heroSlides {
    final heroOnly = _banners.where((b) {
      final placement = (b['placement'] ?? 'hero').toString().trim().toLowerCase();
      return placement.isEmpty || placement == 'hero';
    }).toList();
    if (heroOnly.isNotEmpty) return heroOnly;
    if (_banners.isNotEmpty) return _banners;
    return _fallbackHeroSlides;
  }

  void _startHeroTimer() {
    _heroFadeTimer?.cancel();
    _heroFadeTimer = Timer.periodic(const Duration(milliseconds: 4600), (_) {
      if (!mounted) return;
      final slides = _heroSlides;
      if (slides.length <= 1) return;
      setState(() {
        _heroIndex = (_heroIndex + 1) % slides.length;
      });
    });
  }

  double _computeHeroHeight(BuildContext context) {
    final media = MediaQuery.of(context);
    final scaled = (media.size.width * 0.86).clamp(355.0, 505.0).toDouble();
    return scaled + media.padding.top;
  }

  void _handleScroll() {
    if (!_scrollCtrl.hasClients) return;
    final pos = _scrollCtrl.position;

    // Smoothly track scroll offset over the floating travel range (0..120px)
    final clamped = pos.pixels.clamp(0.0, 120.0);
    if ((clamped - _scrollOffset).abs() >= 0.5 && mounted) {
      setState(() => _scrollOffset = clamped);
    }

    if (_loading || _loadingMore || !_hasMore) return;
    if (pos.pixels >= pos.maxScrollExtent - 360) {
      _fetchStorefront(reset: false);
    }
  }

  Future<List<Map<String, dynamic>>> _loadMoreForPager() async {
    if (_loadingMore || !_hasMore) return _products;
    await _fetchStorefront(reset: false);
    return List<Map<String, dynamic>>.from(_products);
  }

  Future<void> _fetchStorefront({required bool reset}) async {
    if (reset) {
      if (mounted) {
        setState(() {
          _loading = true;
          _error = null;
          _page = 1;
        });
      }
    } else {
      if (_loadingMore || !_hasMore) return;
      if (mounted) setState(() => _loadingMore = true);
    }

    final targetPage = reset ? 1 : _page + 1;
    try {
      final res = await widget.api.getStorefrontHome(
        filter: widget.storefrontFilter,
        categoryId: widget.selectedCategoryId.isNotEmpty ? widget.selectedCategoryId : null,
        brand: widget.selectedBrand.isNotEmpty ? widget.selectedBrand : null,
        merchantId: widget.selectedMerchantId.isNotEmpty ? widget.selectedMerchantId : null,
        page: targetPage,
        limit: 24,
      );
      if (!mounted) return;

      final rawBanners = (res['banners'] as List?) ?? [];
      final rawCats = (res['categories'] as List?) ?? [];
      final rawProducts = (res['products'] as List?) ?? [];
      final rawBrands = (res['brands'] as List?) ?? [];
      final pagination = res['pagination'] is Map
          ? Map<String, dynamic>.from(res['pagination'] as Map)
          : <String, dynamic>{};

      final parsedProducts = rawProducts
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final parsedCats = rawCats
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final parsedBanners = rawBanners
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final parsedBrands = rawBrands
          .map((e) => e.toString().trim())
          .where((s) => s.isNotEmpty)
          .toList();

      if (reset) {
        widget.onCategoriesLoaded(parsedCats);
      }

      setState(() {
        if (reset) {
          _products = parsedProducts;
          _banners = parsedBanners;
          _categories = parsedCats;
          _brands = parsedBrands;
          if (_heroIndex >= _heroSlides.length) _heroIndex = 0;
        } else {
          final existingIds = _products.map((p) => (p['id'] ?? '').toString()).toSet();
          for (final p in parsedProducts) {
            final pid = (p['id'] ?? '').toString();
            if (pid.isEmpty || !existingIds.contains(pid)) {
              _products.add(p);
              if (pid.isNotEmpty) existingIds.add(pid);
            }
          }
        }
        _page = targetPage;
        _hasMore = pagination['has_more'] == true;
        _totalCount = (pagination['total'] as num?)?.toInt() ?? _products.length;
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        if (reset) {
          _error = e.toString().replaceFirst('Exception: ', '');
        }
      });
    }
  }

  int _getCartTotalQty() => widget.cart.values.fold<int>(0, (sum, q) => sum + q);

  bool get _hasScopedFilter =>
      widget.selectedCategoryId.isNotEmpty ||
      widget.selectedBrand.isNotEmpty ||
      widget.selectedMerchantId.isNotEmpty;

  String _activeScopeLabel() {
    final parts = <String>[];
    if (widget.selectedCategoryId.isNotEmpty) {
      final found = _categories.where((c) => (c['id'] ?? '').toString() == widget.selectedCategoryId);
      final name = widget.selectedCategoryName.isNotEmpty
          ? widget.selectedCategoryName
          : (found.isNotEmpty ? (found.first['name_ar'] ?? 'القسم').toString() : 'قسم محدد');
      parts.add('القسم: $name');
    }
    if (widget.selectedBrand.isNotEmpty) {
      parts.add('الماركة: ${widget.selectedBrand}');
    }
    if (widget.selectedMerchantId.isNotEmpty) {
      final merchants = ((widget.bootstrap['merchants'] as List?) ?? []).whereType<Map>();
      final found = merchants.where((m) => (m['id'] ?? '').toString() == widget.selectedMerchantId);
      final mName = widget.selectedMerchantName.isNotEmpty
          ? widget.selectedMerchantName
          : (found.isNotEmpty ? (found.first['name_ar'] ?? 'المتجر').toString() : 'متجر محدد');
      parts.add('المتجر: $mName');
    }
    return parts.join(' · ');
  }

  void _openFilterModal() {
    final merchants = ((widget.bootstrap['merchants'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    String tempCatId = widget.selectedCategoryId;
    String tempCatName = widget.selectedCategoryName;
    String tempBrand = widget.selectedBrand;
    String tempMerchantId = widget.selectedMerchantId;
    String tempMerchantName = widget.selectedMerchantName;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFCBD5E1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.tune_rounded, color: Color(0xFFA92224)),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'تصفية المنتجات بدقة',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.pop(ctx);
                          widget.onClearAllFilters();
                        },
                        style: TextButton.styleFrom(foregroundColor: const Color(0xFFA92224)),
                        child: const Text('مسح الكل', style: TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (merchants.isNotEmpty) ...[
                    DropdownButtonFormField<String>(
                      value: merchants.any((m) => (m['id'] ?? '').toString() == tempMerchantId)
                          ? tempMerchantId
                          : '',
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'تصفية حسب المتجر',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('كل المتاجر')),
                        ...merchants.map(
                          (m) => DropdownMenuItem(
                            value: (m['id'] ?? '').toString(),
                            child: Text(
                              (m['name_ar'] ?? '').toString(),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                      ],
                      onChanged: (val) {
                        final id = val ?? '';
                        final match = merchants.where((m) => (m['id'] ?? '').toString() == id);
                        setModalState(() {
                          tempMerchantId = id;
                          tempMerchantName = match.isNotEmpty ? (match.first['name_ar'] ?? '').toString() : '';
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_categories.isNotEmpty) ...[
                    DropdownButtonFormField<String>(
                      value: _categories.any((c) => (c['id'] ?? '').toString() == tempCatId)
                          ? tempCatId
                          : '',
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'تصفية حسب القسم',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('كل الأقسام')),
                        ..._categories.map(
                          (c) => DropdownMenuItem(
                            value: (c['id'] ?? '').toString(),
                            child: Text(
                              (c['full_path_ar'] ?? c['name_ar'] ?? '').toString(),
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5),
                            ),
                          ),
                        ),
                      ],
                      onChanged: (val) {
                        final id = val ?? '';
                        final match = _categories.where((c) => (c['id'] ?? '').toString() == id);
                        setModalState(() {
                          tempCatId = id;
                          tempCatName = match.isNotEmpty ? (match.first['name_ar'] ?? '').toString() : '';
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_brands.isNotEmpty) ...[
                    DropdownButtonFormField<String>(
                      value: _brands.contains(tempBrand) ? tempBrand : '',
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'تصفية حسب العلامة التجارية',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('كل الماركات')),
                        ..._brands.map(
                          (b) => DropdownMenuItem(
                            value: b,
                            child: Text(b, overflow: TextOverflow.ellipsis),
                          ),
                        ),
                      ],
                      onChanged: (val) => setModalState(() => tempBrand = val ?? ''),
                    ),
                    const SizedBox(height: 14),
                  ],
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFA92224),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      onPressed: () {
                        Navigator.pop(ctx);
                        if (tempMerchantId != widget.selectedMerchantId) {
                          widget.onSelectMerchant(tempMerchantId, tempMerchantName);
                        }
                        if (tempCatId != widget.selectedCategoryId) {
                          widget.onSelectCategory(tempCatId, tempCatName);
                        }
                        if (tempBrand != widget.selectedBrand) {
                          widget.onSelectBrand(tempBrand);
                        }
                      },
                      child: const Text('تطبيق الفلاتر', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openProductPager(int idx) async {
    await showStorefrontProductPager(
      context: context,
      api: widget.api,
      products: _products,
      initialIndex: idx,
      getCartCount: _getCartTotalQty,
      onAddToCart: (product, qty) {
        widget.onAddProduct(product, qty);
      },
      onOpenCart: widget.onOpenCart,
      onSelectBrand: (brand) => widget.onSelectBrand(brand),
      onSelectStore: (mId, mName) => widget.onSelectMerchant(mId, mName),
      onLoadMore: _hasMore ? _loadMoreForPager : null,
    );
  }

  void _handleBannerTap(Map<String, dynamic> b) {
    final targetFilter = (b['target_filter'] ?? b['action_filter'] ?? '').toString().trim();
    final rawService = (b['target_service'] ?? '').toString().trim();
    final serviceKey = rawService.isNotEmpty
        ? rawService
        : (targetFilter.startsWith('service:') ? targetFilter.substring('service:'.length).trim() : '');

    if (serviceKey.isNotEmpty) {
      if (serviceKey == 'free_order') {
        widget.onOpenFreeOrderCart();
        return;
      }
      if (serviceKey == 'rides' || serviceKey == 'parcels' || serviceKey == 'rides_parcels') {
        widget.onOpenService('rides_parcels');
        return;
      }
      if (serviceKey == 'pharmacy' || serviceKey == 'market' || serviceKey == 'stores' || serviceKey == 'hub') {
        widget.onOpenService(serviceKey);
        return;
      }
      widget.onOpenService('hub');
      return;
    }

    final catId = (b['target_category_id'] ?? '').toString().trim();
    if (catId.isNotEmpty) {
      final matched = _categories.firstWhere(
        (c) => (c['id'] ?? '').toString() == catId,
        orElse: () => <String, dynamic>{},
      );
      final catName = (matched['name_ar'] ?? b['title_ar'] ?? b['title'] ?? 'قسم').toString();
      widget.onSelectCategory(catId, catName);
      return;
    }

    final merchantId = (b['target_merchant_id'] ?? '').toString().trim();
    if (merchantId.isNotEmpty) {
      final merchants = (widget.bootstrap['merchants'] as List?) ?? [];
      String merchantName = (b['title_ar'] ?? b['title'] ?? 'متجر').toString();
      for (final m in merchants) {
        if (m is Map && (m['id'] ?? '').toString() == merchantId) {
          merchantName = (m['business_name_ar'] ?? m['name_ar'] ?? merchantName).toString();
          break;
        }
      }
      widget.onSelectMerchant(merchantId, merchantName);
      return;
    }

    final resolvedFilter = targetFilter.isNotEmpty ? targetFilter : 'offers';
    widget.onChangeFilter(resolvedFilter);
  }

  Widget _buildOvalSearchPill({required double screenWidth, required bool sticky}) {
    final barWidth = screenWidth * 0.82;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onOpenSearch,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          width: barWidth,
          height: sticky ? 56 : 64,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(sticky ? 0.96 : 0.98),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: sticky ? const Color(0xFFE2E8F0) : Colors.white.withOpacity(0.95),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(sticky ? 0.16 : 0.24),
                blurRadius: sticky ? 22 : 28,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: sticky ? 38 : 42,
                height: sticky ? 38 : 42,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topRight,
                    end: Alignment.bottomLeft,
                    colors: [Color(0xFFA92224), Color(0xFF86191B)],
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.search_rounded, color: Colors.white, size: 21),
              ),
              const SizedBox(width: 11),
              const Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ابحث عن منتج، ماركة، أو قارن الأسعار...',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color: Color(0xFF334155),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 1),
                    Text(
                      'بحث ذكي فوري في كل متاجر المنزلة',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        color: Color(0xFF94A3B8),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  'بحث',
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
    );
  }

  Widget _buildHeroActionIcon({
    required IconData icon,
    required String tooltip,
    required VoidCallback? onTap,
    int badgeCount = 0,
    Color badgeColor = const Color(0xFFF5A623),
    Color badgeTextColor = const Color(0xFF1E293B),
  }) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.black.withOpacity(0.32),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withOpacity(0.24)),
            ),
            child: Center(
              child: Badge(
                backgroundColor: badgeColor,
                textColor: badgeTextColor,
                isLabelVisible: badgeCount > 0,
                label: Text(
                  '$badgeCount',
                  style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900),
                ),
                child: Icon(icon, color: Colors.white, size: 20),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildImmersiveHeroHeader(BuildContext context, List<Map<String, dynamic>> zones) {
    final media = MediaQuery.of(context);
    final topPadding = media.padding.top;
    final heroHeight = _computeHeroHeight(context);

    final slides = _heroSlides;
    final safeIdx = _heroIndex % slides.length;
    final activeSlide = slides[safeIdx];
    final slideBadge = (activeSlide['badge_ar'] ?? activeSlide['badge'] ?? activeSlide['tag_ar'] ?? 'عرض اطلبها')
        .toString()
        .trim();
    final slideTitle = (activeSlide['title_ar'] ?? activeSlide['title'] ?? 'تسوق أفضل العروض في المنزلة').toString();
    final slideSubtitle = (activeSlide['subtitle_ar'] ?? activeSlide['subtitle'] ?? '').toString();
    final rawTargetFilter = (activeSlide['target_filter'] ?? activeSlide['action_filter'] ?? '').toString().trim();
    final isServiceBanner = (activeSlide['target_service'] ?? '').toString().trim().isNotEmpty ||
        rawTargetFilter.startsWith('service:');
    final rawCta = (activeSlide['cta_label'] ?? '').toString().trim();
    final ctaLabel = rawCta.isNotEmpty ? rawCta : (isServiceBanner ? 'اطلب الخدمة' : 'تسوّق الآن');
    final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(activeSlide['image_url']);
    final isAlt = safeIdx.isOdd;

    return SizedBox(
      height: heroHeight,
      width: double.infinity,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(34)),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // 1. Auto-fading Full-Bleed Hero Banner Background (extends behind entire header!)
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 700),
              switchInCurve: Curves.easeOut,
              switchOutCurve: Curves.easeIn,
              transitionBuilder: (child, animation) => FadeTransition(opacity: animation, child: child),
              child: Container(
                key: ValueKey('hero-slide-$safeIdx-${activeSlide['id'] ?? slideTitle}'),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topRight,
                    end: Alignment.bottomLeft,
                    colors: isAlt
                        ? const [Color(0xFF7C1618), Color(0xFFA92224), Color(0xFFB45309)]
                        : const [Color(0xFF6B1113), Color(0xFFA92224), Color(0xFFC2410C)],
                  ),
                ),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (imgUrl.isNotEmpty)
                      Image.network(
                        imgUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                      ),
                    // Editorial decorative radial glow when banner has no photo
                    if (imgUrl.isEmpty) ...[
                      Positioned(
                        top: -50,
                        left: -40,
                        child: Container(
                          width: 240,
                          height: 240,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFFF5A623).withOpacity(0.18),
                          ),
                        ),
                      ),
                      Positioned(
                        bottom: 40,
                        right: -50,
                        child: Container(
                          width: 200,
                          height: 200,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white.withOpacity(0.08),
                          ),
                        ),
                      ),
                    ],
                    // Contrast scrim so header, copy, and floating oval search stay razor sharp
                    Container(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          stops: const [0.0, 0.35, 0.72, 1.0],
                          colors: [
                            Colors.black.withOpacity(0.58),
                            Colors.black.withOpacity(0.24),
                            Colors.black.withOpacity(0.45),
                            Colors.black.withOpacity(0.76),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 2. Floating Overlay Layer directly over Hero Banner (Logo + Location + Actions + Copy + 82% Oval Search)
            Positioned.fill(
              child: Padding(
                padding: EdgeInsets.fromLTRB(14, topPadding + 8, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Floating Top Header Row (Logo + Delivery Location + Action Icons)
                    Row(
                      children: [
                        // Store Logo
                        Container(
                          width: 44,
                          height: 44,
                          padding: const EdgeInsets.all(2.5),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x33000000),
                                blurRadius: 12,
                                offset: Offset(0, 4),
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(11),
                            child: Image.asset(
                              'assets/images/otlobha_logo.jpg',
                              fit: BoxFit.contain,
                            ),
                          ),
                        ),
                        const SizedBox(width: 9),

                        // Floating Delivery Location Selector
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: Colors.black.withOpacity(0.32),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: Colors.white.withOpacity(0.24)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.location_on_rounded, size: 17, color: Color(0xFFF5A623)),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Text(
                                        'التوصيل إلى',
                                        style: TextStyle(
                                          fontSize: 9.5,
                                          fontWeight: FontWeight.w700,
                                          color: Color(0xFFE2E8F0),
                                          height: 1.1,
                                        ),
                                      ),
                                      zones.isNotEmpty
                                          ? DropdownButtonHideUnderline(
                                              child: DropdownButton<String>(
                                                value: zones.any((z) => (z['id'] ?? '').toString() == widget.selectedZoneId)
                                                    ? widget.selectedZoneId
                                                    : (zones.first['id'] ?? '').toString(),
                                                isDense: true,
                                                isExpanded: true,
                                                dropdownColor: const Color(0xFF1E293B),
                                                icon: const Icon(
                                                  Icons.keyboard_arrow_down_rounded,
                                                  color: Color(0xFFF5A623),
                                                  size: 18,
                                                ),
                                                style: const TextStyle(
                                                  fontSize: 12.5,
                                                  fontWeight: FontWeight.w900,
                                                  color: Colors.white,
                                                ),
                                                items: zones
                                                    .map(
                                                      (z) => DropdownMenuItem<String>(
                                                        value: (z['id'] ?? '').toString(),
                                                        child: Text(
                                                          (z['name_ar'] ?? 'المنزلة').toString(),
                                                          overflow: TextOverflow.ellipsis,
                                                          style: const TextStyle(
                                                            fontSize: 12.5,
                                                            fontWeight: FontWeight.w800,
                                                            color: Colors.white,
                                                          ),
                                                        ),
                                                      ),
                                                    )
                                                    .toList(),
                                                onChanged: (v) {
                                                  if (v != null) widget.onChangeZone(v);
                                                },
                                              ),
                                            )
                                          : const Text(
                                              'المنزلة – وسط المدينة',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                fontSize: 12.5,
                                                fontWeight: FontWeight.w900,
                                                color: Colors.white,
                                              ),
                                            ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),

                        // Live Tracking + Notifications + Menu Drawer
                        if (widget.onOpenLiveTracking != null) ...[
                          _buildHeroActionIcon(
                            icon: Icons.navigation_outlined,
                            tooltip: 'تتبع GPS والشات مع الطيار',
                            onTap: widget.onOpenLiveTracking,
                            badgeCount: widget.liveTrackingCount,
                            badgeColor: const Color(0xFF10B981),
                            badgeTextColor: Colors.white,
                          ),
                          const SizedBox(width: 6),
                        ],
                        if (widget.onOpenNotifications != null) ...[
                          _buildHeroActionIcon(
                            icon: Icons.notifications_outlined,
                            tooltip: 'الإشعارات',
                            onTap: widget.onOpenNotifications,
                            badgeCount: widget.unreadCount,
                          ),
                          const SizedBox(width: 6),
                        ],
                        if (widget.onOpenDrawer != null)
                          _buildHeroActionIcon(
                            icon: Icons.menu_rounded,
                            tooltip: 'القائمة الجانبية',
                            onTap: widget.onOpenDrawer,
                          ),
                      ],
                    ),

                    const Spacer(),

                    // Active Hero Offer Content (tappable)
                    GestureDetector(
                      onTap: () => _handleBannerTap(activeSlide),
                      behavior: HitTestBehavior.opaque,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 500),
                          transitionBuilder: (child, anim) => FadeTransition(opacity: anim, child: child),
                          child: Column(
                            key: ValueKey('hero-copy-$safeIdx-$slideTitle'),
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (slideBadge.isNotEmpty)
                                Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.16),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: const Color(0xFFF5A623).withOpacity(0.65)),
                                  ),
                                  child: Text(
                                    slideBadge,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Color(0xFFFDE68A),
                                      fontSize: 11,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              Text(
                                slideTitle,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w900,
                                  height: 1.25,
                                  shadows: [
                                    Shadow(color: Color(0x66000000), blurRadius: 12, offset: Offset(0, 3)),
                                  ],
                                ),
                              ),
                              if (slideSubtitle.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Text(
                                  slideSubtitle,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xFFF1F5F9),
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF5A623),
                                      borderRadius: BorderRadius.circular(999),
                                      boxShadow: const [
                                        BoxShadow(
                                          color: Color(0x40000000),
                                          blurRadius: 12,
                                          offset: Offset(0, 4),
                                        ),
                                      ],
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          ctaLabel,
                                          style: const TextStyle(
                                            color: Color(0xFF3B180E),
                                            fontSize: 12,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                        const SizedBox(width: 4),
                                        const Icon(
                                          Icons.arrow_back_ios_new_rounded,
                                          size: 11,
                                          color: Color(0xFF3B180E),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Spacer(),
                                  if (slides.length > 1)
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: List.generate(slides.length, (i) {
                                        final isCurr = i == safeIdx;
                                        return GestureDetector(
                                          onTap: () => setState(() => _heroIndex = i),
                                          child: AnimatedContainer(
                                            duration: const Duration(milliseconds: 280),
                                            margin: const EdgeInsets.symmetric(horizontal: 3),
                                            height: 6,
                                            width: isCurr ? 22 : 7,
                                            decoration: BoxDecoration(
                                              color: isCurr
                                                  ? const Color(0xFFF5A623)
                                                  : Colors.white.withOpacity(0.42),
                                              borderRadius: BorderRadius.circular(999),
                                            ),
                                          ),
                                        );
                                      }),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 6),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildServicesStrip() {
    final services = [
      (
        label: 'طلب نصي حر',
        subtitle: 'اكتب طلبك براحتك',
        icon: Icons.edit_note_rounded,
        color: const Color(0xFFA92224),
        onTap: widget.onOpenFreeOrderCart,
      ),
      (
        label: 'الصيدليات',
        subtitle: 'روشتة وأدوية',
        icon: Icons.medication_rounded,
        color: const Color(0xFF0D9488),
        onTap: () => widget.onOpenService('pharmacy'),
      ),
      (
        label: 'اطلبها مشوار',
        subtitle: 'توصيل فوري',
        icon: Icons.directions_car_rounded,
        color: const Color(0xFFD97706),
        onTap: () => widget.onOpenService('rides_parcels'),
      ),
      (
        label: 'طرود أي حاجة',
        subtitle: 'استلام وتسليم',
        icon: Icons.inventory_2_rounded,
        color: const Color(0xFFEA580C),
        onTap: () => widget.onOpenService('rides_parcels'),
      ),
      (
        label: 'سوق اطلبها',
        subtitle: 'عروض ومنتجات',
        icon: Icons.shopping_bag_rounded,
        color: const Color(0xFF4F46E5),
        onTap: () => widget.onOpenService('market'),
      ),
      (
        label: 'كل المتاجر',
        subtitle: 'متاجر المنزلة',
        icon: Icons.storefront_rounded,
        color: const Color(0xFF334155),
        onTap: () => widget.onOpenService('stores'),
      ),
    ];

    return SizedBox(
      height: 98,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: services.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (_, idx) {
              final svc = services[idx];
              return Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                child: InkWell(
                  onTap: svc.onTap,
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    width: 118,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFEAECEF)),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x0A0F172A),
                          blurRadius: 12,
                          offset: Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: svc.color.withOpacity(0.11),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(svc.icon, size: 22, color: svc.color),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          svc.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF0F172A),
                          ),
                        ),
                        const SizedBox(height: 1),
                        Text(
                          svc.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
    );
  }

  Widget _buildCategoriesStrip68() {
    final hasNoCat = widget.selectedCategoryId.isEmpty &&
        widget.selectedBrand.isEmpty &&
        widget.selectedMerchantId.isEmpty;
    final trendingCats = _categories.isNotEmpty
        ? _categories.where((c) => (c['name_ar'] ?? '').toString().trim().isNotEmpty).toList()
        : <Map<String, dynamic>>[
            {'id': 'supermarket', 'name_ar': 'سوبر ماركت'},
            {'id': 'bakery', 'name_ar': 'مخبوزات'},
            {'id': 'fresh', 'name_ar': 'خضار وفواكه'},
            {'id': 'dairy', 'name_ar': 'ألبان وأجبان'},
            {'id': 'meat', 'name_ar': 'لحوم ودواجن'},
            {'id': 'drinks', 'name_ar': 'مشروبات ومياه'},
            {'id': 'care', 'name_ar': 'عناية ومنظفات'},
          ];

    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          // 1. Filters Card (compact 52px height)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: InkWell(
              onTap: _openFilterModal,
              borderRadius: BorderRadius.circular(15),
              child: Container(
                height: 52,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: _hasScopedFilter ? const Color(0xFF86191B) : Colors.white,
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(
                    color: _hasScopedFilter ? const Color(0xFF86191B) : const Color(0xFFE2E8F0),
                  ),
                  boxShadow: const [
                    BoxShadow(color: Color(0x080F172A), blurRadius: 8, offset: Offset(0, 2)),
                  ],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: _hasScopedFilter
                            ? Colors.white.withOpacity(0.16)
                            : const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        Icons.tune_rounded,
                        size: 16,
                        color: _hasScopedFilter ? const Color(0xFFF5A623) : const Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Text(
                      'الفلاتر',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                        color: _hasScopedFilter ? Colors.white : const Color(0xFF0F172A),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // 2. All Categories Card (compact 52px height)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: InkWell(
              onTap: () {
                if (_hasScopedFilter) widget.onClearAllFilters();
                widget.onSelectCategory('', '');
                widget.onChangeFilter('all');
              },
              borderRadius: BorderRadius.circular(15),
              child: Container(
                height: 52,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: hasNoCat ? const Color(0xFFA92224) : Colors.white,
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(
                    color: hasNoCat ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: hasNoCat ? const Color(0x2EA92224) : const Color(0x080F172A),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: hasNoCat ? Colors.white.withOpacity(0.18) : const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        Icons.grid_view_rounded,
                        size: 16,
                        color: hasNoCat ? Colors.white : const Color(0xFFA92224),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Text(
                      'الكل',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                        color: hasNoCat ? Colors.white : const Color(0xFF1E293B),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // 3. Dynamic Categories Cards (compact 52px height)
          ...trendingCats.map((cat) {
            final catId = (cat['id'] ?? '').toString();
            final catName = (cat['name_ar'] ?? '').toString().trim();
            final catImg = OtlobhaCustomerApi.resolveMediaUrl(cat['image_url']);
            final active = widget.selectedCategoryId == catId;

            return Padding(
              padding: const EdgeInsets.only(left: 8),
              child: InkWell(
                onTap: () {
                  if (active) {
                    widget.onSelectCategory('', '');
                  } else {
                    widget.onSelectCategory(catId, catName);
                  }
                },
                borderRadius: BorderRadius.circular(15),
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 9),
                  decoration: BoxDecoration(
                    color: active ? const Color(0xFFA92224) : Colors.white,
                    borderRadius: BorderRadius.circular(15),
                    border: Border.all(
                      color: active ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: active ? const Color(0x2EA92224) : const Color(0x080F172A),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: active ? Colors.white.withOpacity(0.18) : const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: catImg.isNotEmpty
                            ? Image.network(
                                catImg,
                                fit: BoxFit.cover,
                                cacheWidth: 100,
                                errorBuilder: (_, __, ___) => Center(
                                  child: Text(
                                    catName.isNotEmpty ? catName.characters.first : 'ق',
                                    style: TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w900,
                                      color: active ? Colors.white : const Color(0xFFA92224),
                                    ),
                                  ),
                                ),
                              )
                            : Center(
                                child: Text(
                                  catName.isNotEmpty ? catName.characters.first : 'ق',
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w900,
                                    color: active ? Colors.white : const Color(0xFFA92224),
                                  ),
                                ),
                              ),
                      ),
                      const SizedBox(width: 7),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 118),
                        child: Text(
                          catName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: active ? Colors.white : const Color(0xFF1E293B),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final topPadding = media.padding.top;
    final bottomSafe = media.padding.bottom;
    final screenWidth = media.size.width;

    final zones = ((widget.bootstrap['zones'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final pendingRatings = ((widget.bootstrap['pending_ratings'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

    return Container(
      color: const Color(0xFFF7F7F8),
      child: Stack(
        children: [
          RefreshIndicator(
            color: const Color(0xFFA92224),
            edgeOffset: topPadding + 16,
            onRefresh: () => _fetchStorefront(reset: true),
            child: CustomScrollView(
              controller: _scrollCtrl,
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                // 1. Immersive Full-Bleed Auto-Fading Hero Banner with Floating Header & 82% Oval Search Bar
                SliverToBoxAdapter(
                  child: _buildImmersiveHeroHeader(context, zones),
                ),

                // 2. Pending Captain Ratings Banner (Preserved from Mobile App)
                if (pendingRatings.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                      child: Container(
                        padding: const EdgeInsets.all(13),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFFF5A623)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.star_rounded, color: Color(0xFFD97706), size: 26),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'قيّم الطيار بعد آخر طلب',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w900,
                                      color: Color(0xFF86191B),
                                    ),
                                  ),
                                  Text(
                                    'الطيار ${pendingRatings.first['captain_name'] ?? ''} · ${pendingRatings.first['ref_number'] ?? ''}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 11.5, color: Color(0xFF78350F)),
                                  ),
                                ],
                              ),
                            ),
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                minimumSize: Size.zero,
                              ),
                              onPressed: () => widget.onRateCaptain(pendingRatings.first),
                              child: const Text('تقييم', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                // 3. Services Horizontal Swipeable Cards Directly Below Hero
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _buildServicesStrip(),
                  ),
                ),

                // 4. Categories Horizontal Scrollable Strip (compact 52px height)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _buildCategoriesStrip68(),
                  ),
                ),

                // 5. Active Scoped Filter Banner (if Category / Brand / Merchant active)
                if (_hasScopedFilter)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFFECACA)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.filter_alt_rounded, size: 18, color: Color(0xFFA92224)),
                            const SizedBox(width: 7),
                            Expanded(
                              child: Text(
                                _activeScopeLabel(),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFF86191B),
                                ),
                              ),
                            ),
                            InkWell(
                              onTap: widget.onClearAllFilters,
                              borderRadius: BorderRadius.circular(10),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFA92224),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: const Text(
                                  'إلغاء',
                                  style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w900),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                // 6. Products Section Header
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
                    child: Row(
                      children: [
                        const Text(
                          'تصفح المنتجات',
                          style: TextStyle(
                            fontSize: 16.5,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF0F172A),
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (!_loading)
                          Text(
                            '$_totalCount منتج',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        const Spacer(),
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.swipe_rounded, size: 14, color: Color(0xFFA92224)),
                            SizedBox(width: 4),
                            Text(
                              'اسحب بين التفاصيل',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFFA92224),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

                // 7. Products 2-Column Grid with 16px Gap
                if (_loading)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 54),
                      child: Center(child: CircularProgressIndicator(color: Color(0xFFA92224))),
                    ),
                  )
                else if (_error != null)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Column(
                          children: [
                            const Icon(Icons.cloud_off_rounded, size: 42, color: Color(0xFFA92224)),
                            const SizedBox(height: 8),
                            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13)),
                            const SizedBox(height: 12),
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                              ),
                              onPressed: () => _fetchStorefront(reset: true),
                              child: const Text('إعادة المحاولة'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  )
                else if (_products.isEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 38),
                      child: Column(
                        children: [
                          Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF2F2),
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: const Icon(Icons.inventory_2_outlined, size: 32, color: Color(0xFFA92224)),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'لا توجد منتجات في هذا التصنيف حاليًا',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                          ),
                          const SizedBox(height: 10),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFFA92224),
                              foregroundColor: Colors.white,
                            ),
                            onPressed: widget.onClearAllFilters,
                            child: const Text('عرض كل المنتجات'),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    sliver: SliverGrid(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 16,
                        mainAxisSpacing: 16,
                        childAspectRatio: 0.57,
                      ),
                      delegate: SliverChildBuilderDelegate(
                        (ctx, idx) {
                          final prod = _products[idx];
                          final pid = (prod['id'] ?? '').toString();
                          return StorefrontProductCardWidget(
                            product: prod,
                            cartQty: widget.cart[pid] ?? 0,
                            onTapDetails: () => _openProductPager(idx),
                            onAdd: () => widget.onAddProduct(prod, 1),
                            onDecrement: () => widget.onAddProduct(prod, -1),
                          );
                        },
                        childCount: _products.length,
                      ),
                    ),
                  ),

                // 8. Load More + Generous Scroll Space so products scroll cleanly behind Floating Bottom Dock
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      16,
                      20,
                      16,
                      bottomSafe + 124,
                    ),
                    child: _loadingMore
                        ? const Center(
                            child: Padding(
                              padding: EdgeInsets.all(10),
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Color(0xFFA92224)),
                            ),
                          )
                        : _hasMore
                            ? Center(
                                child: OutlinedButton.icon(
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: const Color(0xFFA92224),
                                    side: const BorderSide(color: Color(0xFFA92224)),
                                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 11),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                  ),
                                  onPressed: () => _fetchStorefront(reset: false),
                                  icon: const Icon(Icons.expand_more_rounded),
                                  label: const Text('عرض المزيد من المنتجات', style: TextStyle(fontWeight: FontWeight.w800)),
                                ),
                              )
                            : const SizedBox.shrink(),
                  ),
                ),
              ],
            ),
          ),

          // Single Truly Floating 82% Oval Search Bar hovering independently over Hero & gliding smoothly to top-pinned on scroll
          Positioned(
            top: ((topPadding + 72.0) - _scrollOffset).clamp(topPadding + 10.0, topPadding + 72.0).toDouble(),
            left: 0,
            right: 0,
            child: Center(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                  child: _buildOvalSearchPill(
                    screenWidth: screenWidth,
                    sticky: _scrollOffset > 54.0,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
