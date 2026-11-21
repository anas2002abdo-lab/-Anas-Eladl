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

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_handleScroll);
    _fetchStorefront(reset: true);
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
    _scrollCtrl.removeListener(_handleScroll);
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _handleScroll() {
    if (_loading || _loadingMore || !_hasMore) return;
    if (!_scrollCtrl.hasClients) return;
    final pos = _scrollCtrl.position;
    if (pos.pixels >= pos.maxScrollExtent - 340) {
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

      if (parsedCats.isNotEmpty) {
        widget.onCategoriesLoaded(parsedCats);
      }

      setState(() {
        if (reset) {
          _products = parsedProducts;
          if (parsedBanners.isNotEmpty) _banners = parsedBanners;
          if (parsedCats.isNotEmpty) _categories = parsedCats;
          if (parsedBrands.isNotEmpty) _brands = parsedBrands;
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

  double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse((v ?? '').toString()) ?? 0;
  }

  String _formatPrice(double value) {
    if (value == value.roundToDouble()) return value.toInt().toString();
    return value.toStringAsFixed(2);
  }

  int _getCartTotalQty() => widget.cart.values.fold<int>(0, (sum, q) => sum + q);

  double _getCartSubtotal() {
    double total = 0;
    for (final entry in widget.cart.entries) {
      if (entry.value <= 0) continue;
      final cached = widget.cartProductsCache[entry.key];
      if (cached != null) {
        final eff = cached['effective_price'] ?? cached['sale_price'] ?? cached['base_price'];
        total += _toDouble(eff) * entry.value;
      }
    }
    return total;
  }

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
              borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
            ),
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
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
                    height: 46,
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

  @override
  Widget build(BuildContext context) {
    final zones = ((widget.bootstrap['zones'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final pendingRatings = ((widget.bootstrap['pending_ratings'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final totalQty = _getCartTotalQty();
    final subtotal = _getCartSubtotal();

    return Container(
      color: const Color(0xFFF6F7F9),
      child: Stack(
        children: [
          RefreshIndicator(
            color: const Color(0xFFA92224),
            onRefresh: () => _fetchStorefront(reset: true),
            child: CustomScrollView(
              controller: _scrollCtrl,
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                // 1. Sticky Zone Selector + Smart Search Bar Header
                SliverToBoxAdapter(
                  child: Container(
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.location_on_rounded, size: 18, color: Color(0xFFA92224)),
                            const SizedBox(width: 6),
                            const Text(
                              'التوصيل إلى:',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF64748B)),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: zones.isNotEmpty
                                  ? DropdownButtonHideUnderline(
                                      child: DropdownButton<String>(
                                        value: zones.any((z) => (z['id'] ?? '').toString() == widget.selectedZoneId)
                                            ? widget.selectedZoneId
                                            : (zones.first['id'] ?? '').toString(),
                                        isDense: true,
                                        isExpanded: true,
                                        icon: const Icon(Icons.keyboard_arrow_down_rounded, color: Color(0xFFA92224)),
                                        style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF0F172A),
                                        ),
                                        items: zones
                                            .map(
                                              (z) => DropdownMenuItem<String>(
                                                value: (z['id'] ?? '').toString(),
                                                child: Text(
                                                  (z['name_ar'] ?? 'المنزلة').toString(),
                                                  overflow: TextOverflow.ellipsis,
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
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w900,
                                        color: Color(0xFF0F172A),
                                      ),
                                    ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        InkWell(
                          onTap: widget.onOpenSearch,
                          borderRadius: BorderRadius.circular(14),
                          child: Container(
                            height: 44,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.search_rounded, color: Color(0xFFA92224), size: 20),
                                const SizedBox(width: 8),
                                const Expanded(
                                  child: Text(
                                    'ابحث عن منتج، ماركة، أو قارن الأسعار...',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      color: Color(0xFF64748B),
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFEF2F2),
                                    borderRadius: BorderRadius.circular(9),
                                  ),
                                  child: const Text(
                                    'بحث ذكي',
                                    style: TextStyle(
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w900,
                                      color: Color(0xFFA92224),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // 2. Pending Captain Ratings Banner (Preserved from Mobile App)
                if (pendingRatings.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(16),
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

                // 3. Hero Promotional Banners Carousel
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _buildHeroCarousel(),
                  ),
                ),

                // 4. Compact Otlobha Multi-Services Strip
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 14),
                    child: _buildServicesStrip(),
                  ),
                ),

                // 6. Active Scoped Filter Banner (if Category / Brand / Merchant active)
                if (_hasScopedFilter)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFFECACA)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.filter_alt_rounded, size: 17, color: Color(0xFFA92224)),
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
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFA92224),
                                  borderRadius: BorderRadius.circular(8),
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

                // 7. Quick Filter Chips Row
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(0, 14, 0, 10),
                    child: _buildQuickFilterChips(),
                  ),
                ),

                // 8. Section Title + Count
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
                    child: Row(
                      children: [
                        const Text(
                          'تصفح المنتجات',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                        ),
                        const SizedBox(width: 6),
                        if (!_loading)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: Text(
                              '$_totalCount منتج',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF475569),
                              ),
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
                                fontSize: 10.5,
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

                // 9. Products Grid / Loading / Error / Empty
                if (_loading)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 48),
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
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    sliver: SliverGrid(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                        childAspectRatio: 0.62,
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

                // 10. Load More Button / Spinner + Bottom Safe Spacer
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(14, 16, 14, totalQty > 0 ? 90 : 28),
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
                                    padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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

          // Sticky Bottom Cart Summary Bar when items exist in cart
          if (totalQty > 0)
            Positioned(
              left: 14,
              right: 14,
              bottom: 10,
              child: Material(
                elevation: 8,
                shadowColor: const Color(0x55A92224),
                borderRadius: BorderRadius.circular(18),
                color: Colors.transparent,
                child: InkWell(
                  onTap: widget.onOpenCart,
                  borderRadius: BorderRadius.circular(18),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.centerRight,
                        end: Alignment.centerLeft,
                        colors: [Color(0xFFA92224), Color(0xFF86191B)],
                      ),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: const Color(0x66F5A623)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF5A623),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '$totalQty',
                            style: const TextStyle(
                              color: Color(0xFF3B180E),
                              fontSize: 13,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(
                                'عرض السلة وإتمام الطلب',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              if (subtotal > 0)
                                Text(
                                  'الإجمالي المبدئي: ${_formatPrice(subtotal)} ج.م',
                                  style: const TextStyle(
                                    color: Color(0xFFFDE68A),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildHeroCarousel() {
    final items = _banners.isNotEmpty
        ? _banners
        : [
            {
              'badge': 'عروض اطلبها الحصرية',
              'title': 'قارن أسعار السوبر ماركت ووفّر على كل طلب',
              'subtitle': 'اكتشف أرخص سعر لنفس المنتج بين متاجر المنزلة بنقرة واحدة',
              'action_filter': 'offers',
            },
            {
              'badge': 'طازج يوميًا',
              'title': 'المخبوزات والخضار والألبان لباب البيت',
              'subtitle': 'توصيل سريع بمتابعة مباشرة مع الطيار حتى الاستلام',
              'action_filter': 'fresh',
            },
          ];

    return SizedBox(
      height: 136,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, idx) {
          final b = items[idx];
          final badge = (b['badge'] ?? b['tag_ar'] ?? 'عرض اطلبها').toString();
          final title = (b['title'] ?? b['title_ar'] ?? '').toString();
          final subtitle = (b['subtitle'] ?? b['subtitle_ar'] ?? '').toString();
          final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(b['image_url']);
          final actionFilter = (b['action_filter'] ?? 'offers').toString();
          final isAlt = idx.isOdd;

          return InkWell(
            onTap: () => widget.onChangeFilter(actionFilter),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              width: MediaQuery.of(context).size.width * 0.82,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topRight,
                  end: Alignment.bottomLeft,
                  colors: isAlt
                      ? const [Color(0xFF86191B), Color(0xFFB45309)]
                      : const [Color(0xFFA92224), Color(0xFF7F1D1D)],
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: const [
                  BoxShadow(color: Color(0x26A92224), blurRadius: 12, offset: Offset(0, 4)),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  if (imgUrl.isNotEmpty)
                    Positioned.fill(
                      child: Opacity(
                        opacity: 0.22,
                        child: Image.network(
                          imgUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                        ),
                      ),
                    ),
                  Positioned(
                    left: -18,
                    bottom: -18,
                    child: Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFFF5A623).withOpacity(0.18),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF5A623),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            badge,
                            style: const TextStyle(
                              color: Color(0xFF3B180E),
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14.5,
                                fontWeight: FontWeight.w900,
                                height: 1.25,
                              ),
                            ),
                            if (subtitle.isNotEmpty) ...[
                              const SizedBox(height: 3),
                              Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Color(0xFFFDE68A),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ],
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
    );
  }


  Widget _buildServicesStrip() {
    final services = [
      (
        label: 'طلب نصي حر',
        icon: Icons.edit_note_rounded,
        color: const Color(0xFFA92224),
        onTap: widget.onOpenFreeOrderCart,
      ),
      (
        label: 'الصيدليات',
        icon: Icons.medication_rounded,
        color: const Color(0xFF0D9488),
        onTap: () => widget.onOpenService('pharmacy'),
      ),
      (
        label: 'اطلبها مشوار',
        icon: Icons.directions_car_rounded,
        color: const Color(0xFFD97706),
        onTap: () => widget.onOpenService('rides_parcels'),
      ),
      (
        label: 'طرود أي حاجة',
        icon: Icons.inventory_2_rounded,
        color: const Color(0xFFEA580C),
        onTap: () => widget.onOpenService('rides_parcels'),
      ),
      (
        label: 'سوق اطلبها',
        icon: Icons.shopping_bag_rounded,
        color: const Color(0xFF4F46E5),
        onTap: () => widget.onOpenService('market'),
      ),
      (
        label: 'كل المتاجر',
        icon: Icons.storefront_rounded,
        color: const Color(0xFF334155),
        onTap: () => widget.onOpenService('stores'),
      ),
    ];

    return SizedBox(
      height: 76,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        itemCount: services.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, idx) {
          final svc = services[idx];
          return Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: svc.onTap,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                width: 86,
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: svc.color.withOpacity(0.11),
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Icon(svc.icon, size: 19, color: svc.color),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      svc.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
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

  Widget _buildQuickFilterChips() {
    final hasNoCat = widget.selectedCategoryId.isEmpty && widget.selectedBrand.isEmpty && widget.selectedMerchantId.isEmpty;
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

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Row(
        children: [
          // 1. زر الفلاتر
          InkWell(
            onTap: _openFilterModal,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: _hasScopedFilter ? const Color(0xFF86191B) : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _hasScopedFilter ? const Color(0xFF86191B) : const Color(0xFFCBD5E1),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.tune_rounded,
                    size: 16,
                    color: _hasScopedFilter ? const Color(0xFFF5A623) : const Color(0xFF0F172A),
                  ),
                  const SizedBox(width: 5),
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
          const SizedBox(width: 8),

          // 2. زر الكل
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: InkWell(
              onTap: () {
                if (_hasScopedFilter) widget.onClearAllFilters();
                widget.onSelectCategory('', '');
                widget.onChangeFilter('all');
              },
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                decoration: BoxDecoration(
                  color: hasNoCat ? const Color(0xFFA92224) : Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: hasNoCat ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                  ),
                ),
                child: Text(
                  'الكل',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: hasNoCat ? Colors.white : const Color(0xFF334155),
                  ),
                ),
              ),
            ),
          ),

          // 3. مستطيلات الأقسام الأكثر رواجًا
          ...trendingCats.map((cat) {
            final catId = (cat['id'] ?? '').toString();
            final catName = (cat['name_ar'] ?? '').toString().trim();
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
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                  decoration: BoxDecoration(
                    color: active ? const Color(0xFFA92224) : Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: active ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                    ),
                  ),
                  child: Text(
                    catName,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: active ? Colors.white : const Color(0xFF334155),
                    ),
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
