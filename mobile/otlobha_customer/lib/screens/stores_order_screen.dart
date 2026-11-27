import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class StoresOrderScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final Map<String, Map<String, dynamic>> cartProductsCache;
  final String selectedZoneId;
  final String addressLandmark;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final Future<void> Function() onRefresh;
  final void Function(String merchantId, String merchantName)? onOpenStore;

  const StoresOrderScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    this.cartProductsCache = const {},
    this.selectedZoneId = 'zn_city_center',
    this.addressLandmark = '',
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onRefresh,
    this.onOpenStore,
  });

  @override
  State<StoresOrderScreen> createState() => _StoresOrderScreenState();
}

class _StoresOrderScreenState extends State<StoresOrderScreen> {
  String _selectedMerchantId = '';
  String _selectedSectionId = 'all';
  String _flashingMerchantId = '';
  String _flashingSectionId = '';
  late String _selectedZoneId = widget.selectedZoneId;
  String _channel = 'catalog';
  bool _isExpress = false;
  double _discount = 0;

  final TextEditingController _freeOrderCtrl = TextEditingController();
  final TextEditingController _couponCtrl = TextEditingController();
  final TextEditingController _searchCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();

  Timer? _searchDebounce;
  String _searchQuery = '';
  bool _submitting = false;

  // High-scale server-side paginated catalog state (handles 500,000+ products at 60 FPS)
  final List<Map<String, dynamic>> _pagedProducts = [];
  int _currentPage = 1;
  int _totalProducts = 0;
  bool _hasMore = false;
  bool _loadingProducts = false;
  bool _loadingMore = false;
  String? _loadError;
  int _fetchSeq = 0;
  bool _initialFetchTriggered = false;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _syncDefaultMerchantAndLoad();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _scrollCtrl.removeListener(_onScroll);
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    _freeOrderCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_channel != 'catalog' || _loadingProducts || _loadingMore || !_hasMore) return;
    if (!_scrollCtrl.hasClients) return;
    final pos = _scrollCtrl.position;
    if (pos.pixels >= pos.maxScrollExtent - 360) {
      _fetchProducts(reset: false);
    }
  }

  void _syncDefaultMerchantAndLoad() {
    final merchants = ((widget.bootstrap['merchants'] as List?) ?? [])
        .where((m) => m['merchant_type'] != 'pharmacy')
        .toList();
    if (_selectedMerchantId.isEmpty && merchants.isNotEmpty) {
      _selectedMerchantId = '${merchants.first['id']}';
    }
    if (_selectedMerchantId.isNotEmpty && !_initialFetchTriggered) {
      _initialFetchTriggered = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fetchProducts(reset: true);
      });
    }
  }

  @override
  void didUpdateWidget(covariant StoresOrderScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedZoneId != widget.selectedZoneId) {
      _selectedZoneId = widget.selectedZoneId;
    }
    if (!_initialFetchTriggered) {
      _syncDefaultMerchantAndLoad();
    }
  }

  Set<String> _getOffersCategoryIds() {
    final allCategories = (widget.bootstrap['categories'] as List?) ?? [];
    return allCategories
        .where((c) => c['is_offers_section'] == true || c['is_offers_section'] == 1)
        .map((c) => '${c['id']}')
        .toSet();
  }

  Future<void> _fetchProducts({required bool reset}) async {
    if (_selectedMerchantId.isEmpty) return;
    if (!reset && (_loadingMore || !_hasMore)) return;

    final nextPage = reset ? 1 : _currentPage + 1;
    final seq = ++_fetchSeq;
    final offersCategoryIds = _getOffersCategoryIds();
    final isOffersSelected =
        _selectedSectionId == 'offers' || offersCategoryIds.contains(_selectedSectionId);

    setState(() {
      if (reset) {
        _loadingProducts = true;
        _loadError = null;
      } else {
        _loadingMore = true;
      }
    });

    try {
      final res = await widget.api.getProductsPaginated(
        merchantId: _selectedMerchantId,
        categoryId: (_selectedSectionId == 'all' || isOffersSelected) ? null : _selectedSectionId,
        offersOnly: isOffersSelected,
        query: _searchQuery.isEmpty ? null : _searchQuery,
        page: nextPage,
        limit: 40,
      );
      if (!mounted || seq != _fetchSeq) return;

      final rawItems = (res['items'] as List?) ?? const [];
      final parsed = rawItems
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      setState(() {
        if (reset) {
          _pagedProducts
            ..clear()
            ..addAll(parsed);
        } else {
          final seen = _pagedProducts.map((e) => e['id']?.toString()).toSet();
          for (final item in parsed) {
            if (!seen.contains(item['id']?.toString())) {
              _pagedProducts.add(item);
            }
          }
        }
        _currentPage = nextPage;
        _totalProducts = (res['total'] as num?)?.toInt() ?? _pagedProducts.length;
        _hasMore = res['has_more'] == true;
        _loadingProducts = false;
        _loadingMore = false;
        _loadError = null;
      });
    } catch (e) {
      if (!mounted || seq != _fetchSeq) return;
      setState(() {
        _loadingProducts = false;
        _loadingMore = false;
        _loadError = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _onSearchChanged(String val) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      final clean = val.trim();
      if (clean != _searchQuery) {
        setState(() => _searchQuery = clean);
        _fetchProducts(reset: true);
      }
    });
  }

  Widget _buildRemoteOrDataImage(String? rawUrl, Widget fallback) {
    final url = (rawUrl ?? '').trim();
    if (url.isEmpty) return fallback;
    if (url.startsWith('data:image')) {
      final commaIdx = url.indexOf(',');
      if (commaIdx != -1) {
        try {
          final bytes = base64Decode(url.substring(commaIdx + 1));
          return Image.memory(
            bytes,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            cacheWidth: 160,
            errorBuilder: (_, __, ___) => fallback,
          );
        } catch (_) {
          return fallback;
        }
      }
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        cacheWidth: 160,
        errorBuilder: (_, __, ___) => fallback,
      );
    }
    return fallback;
  }

  void _triggerFlashMerchant(String id) {
    final changed = _selectedMerchantId != id;
    setState(() {
      _flashingMerchantId = id;
      _selectedMerchantId = id;
      _selectedSectionId = 'all';
    });
    if (changed || _pagedProducts.isEmpty) {
      _fetchProducts(reset: true);
    }
    Timer(const Duration(milliseconds: 420), () {
      if (mounted && _flashingMerchantId == id) {
        setState(() => _flashingMerchantId = '');
      }
    });
  }

  void _triggerFlashSection(String id) {
    final changed = _selectedSectionId != id;
    setState(() {
      _flashingSectionId = id;
      _selectedSectionId = id;
    });
    if (changed) {
      _fetchProducts(reset: true);
    }
    Timer(const Duration(milliseconds: 420), () {
      if (mounted && _flashingSectionId == id) {
        setState(() => _flashingSectionId = '');
      }
    });
  }

  bool _isProductOffer(Map<String, dynamic> p, Set<String> offersCategoryIds) {
    if (p['is_offer'] == true || p['is_offer'] == 1) return true;
    if (offersCategoryIds.contains('${p['category_id']}')) return true;
    final base = p['base_price'] as num?;
    final sale = p['sale_price'] as num?;
    return sale != null && base != null && sale < base;
  }

  @override
  Widget build(BuildContext context) {
    final merchants = ((widget.bootstrap['merchants'] as List?) ?? [])
        .where((m) => m['merchant_type'] != 'pharmacy')
        .toList();
    final zones = (widget.bootstrap['zones'] as List?) ?? [];
    final allCategories = (widget.bootstrap['categories'] as List?) ?? [];
    final bootstrapProducts = (widget.bootstrap['products'] as List?) ?? [];

    if (_selectedMerchantId.isEmpty && merchants.isNotEmpty) {
      _selectedMerchantId = '${merchants.first['id']}';
      if (!_initialFetchTriggered) {
        _initialFetchTriggered = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _fetchProducts(reset: true);
        });
      }
    }

    final selectedMerchant = merchants.cast<Map<String, dynamic>?>().firstWhere(
          (m) => m?['id'] == _selectedMerchantId,
          orElse: () => null,
        );

    final offersCategoryIds = _getOffersCategoryIds();

    // Use server-indexed merchant_category_ids map when present (O(1) even with 500K products)
    final rawMerchantCatMap = widget.bootstrap['merchant_category_ids'];
    final Set<String> merchantActiveCatIds = {};
    if (rawMerchantCatMap is Map && rawMerchantCatMap[_selectedMerchantId] is List) {
      for (final cid in (rawMerchantCatMap[_selectedMerchantId] as List)) {
        merchantActiveCatIds.add('$cid');
      }
    } else {
      for (final p in bootstrapProducts) {
        if (p is Map && p['merchant_id'] == _selectedMerchantId && p['category_id'] != null) {
          merchantActiveCatIds.add('${p['category_id']}');
        }
      }
    }

    final merchantOffersCat = allCategories.cast<Map<String, dynamic>?>().firstWhere(
          (c) =>
              c?['merchant_id'] == _selectedMerchantId &&
              (c?['is_offers_section'] == true || c?['is_offers_section'] == 1),
          orElse: () => null,
        );

    final List<Map<String, dynamic>> storeSections = [
      {
        'id': 'all',
        'name_ar': 'الكل',
        'image_url': selectedMerchant?['image_url'] ?? '',
        'kind': 'all',
      },
      {
        'id': merchantOffersCat?['id'] ?? 'offers',
        'name_ar': merchantOffersCat?['name_ar'] ?? 'العروض',
        'image_url': merchantOffersCat?['image_url'] ?? '',
        'kind': 'offers',
      },
      ...allCategories.where((c) {
        if (c['scope'] == 'market' || c['is_active'] == false) return false;
        if (c['is_offers_section'] == true || c['is_offers_section'] == 1) return false;
        final ownerId = c['merchant_id'];
        if (ownerId == _selectedMerchantId) return true;
        if (ownerId == null || '$ownerId'.isEmpty) {
          return merchantActiveCatIds.contains('${c['id']}');
        }
        return false;
      }).map((c) => {
            'id': '${c['id']}',
            'name_ar': '${c['name_ar']}',
            'image_url': '${c['image_url'] ?? ''}',
            'kind': 'category',
          }),
    ];

    // O(cart.length) cart summary using cartProductsCache (no O(N) scan across all products)
    int totalCartQty = 0;
    double totalCartEgp = 0;
    if (widget.cart.isNotEmpty) {
      Map<String, Map<String, dynamic>>? fallbackById;
      for (final entry in widget.cart.entries) {
        if (entry.value <= 0) continue;
        totalCartQty += entry.value;
        var prod = widget.cartProductsCache[entry.key];
        if (prod == null) {
          fallbackById ??= {
            for (final p in _pagedProducts)
              if (p['id'] != null) p['id'].toString(): p,
            for (final p in bootstrapProducts)
              if (p is Map && p['id'] != null) p['id'].toString(): Map<String, dynamic>.from(p),
          };
          prod = fallbackById[entry.key];
        }
        if (prod != null) {
          final unit = (prod['sale_price'] ?? prod['base_price']) as num?;
          if (unit != null) totalCartEgp += unit.toDouble() * entry.value;
        }
      }
    }

    return CustomScrollView(
      controller: _scrollCtrl,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('المتاجر المعتمدة في المنزلة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text(
                  'اسحب لاختيار المتجر ثم تصفح أقسامه وعروضه؛ تبقى جميع مشترياتك محفوظة في السلة.',
                  style: TextStyle(fontSize: 11, color: Colors.black54),
                ),
                const SizedBox(height: 10),
                if (zones.isNotEmpty)
                  DropdownButtonFormField<String>(
                    value: zones.any((z) => z['id'] == _selectedZoneId) ? _selectedZoneId : zones.first['id'],
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'منطقة التوصيل'),
                    items: zones
                        .map((z) => DropdownMenuItem<String>(
                              value: z['id'],
                              child: Text('${z['name_ar']} (+${z['remote_area_fee']} ج.م)'),
                            ))
                        .toList(),
                    onChanged: (v) => setState(() => _selectedZoneId = v ?? 'zn_city_center'),
                  ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 108,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    physics: const BouncingScrollPhysics(),
                    itemCount: merchants.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 14),
                    itemBuilder: (context, index) {
                      final m = merchants[index];
                      final mId = '${m['id']}';
                      final selected = mId == _selectedMerchantId;
                      final flashing = mId == _flashingMerchantId;
                      return GestureDetector(
                        onTap: () => _triggerFlashMerchant(mId),
                        child: SizedBox(
                          width: 78,
                          child: Column(
                            children: [
                              AnimatedScale(
                                scale: flashing ? 1.12 : 1.0,
                                duration: const Duration(milliseconds: 220),
                                child: Container(
                                  width: 66,
                                  height: 66,
                                  padding: const EdgeInsets.all(2.5),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: flashing
                                          ? const Color(0xFFF5A623)
                                          : selected
                                              ? const Color(0xFFEA580C)
                                              : Colors.black12,
                                      width: selected || flashing ? 2.5 : 1.5,
                                    ),
                                    boxShadow: [
                                      BoxShadow(
                                        color: flashing
                                            ? const Color(0x88F5A623)
                                            : selected
                                                ? const Color(0x33EA580C)
                                                : Colors.black12,
                                        blurRadius: flashing ? 14 : 6,
                                        offset: const Offset(0, 3),
                                      ),
                                    ],
                                  ),
                                  child: ClipOval(
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        _buildRemoteOrDataImage(
                                          '${m['image_url'] ?? ''}',
                                          Container(
                                            color: const Color(0xFFFFF7ED),
                                            child: const Icon(Icons.storefront, color: Color(0xFFEA580C), size: 30),
                                          ),
                                        ),
                                        AnimatedOpacity(
                                          opacity: flashing ? 0.55 : 0.0,
                                          duration: const Duration(milliseconds: 200),
                                          child: Container(color: Colors.white),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${m['business_name_ar'] ?? ''}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: selected ? FontWeight.bold : FontWeight.w600,
                                  color: selected ? const Color(0xFFC2410C) : Colors.black87,
                                  height: 1.15,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
                if (selectedMerchant != null && widget.onOpenStore != null) ...[
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: () => widget.onOpenStore!(
                      '${selectedMerchant['id']}',
                      '${selectedMerchant['business_name_ar'] ?? selectedMerchant['name_ar'] ?? ''}',
                    ),
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFFECACA)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.storefront_rounded, color: Color(0xFFA92224), size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'صفحة ${selectedMerchant['business_name_ar'] ?? selectedMerchant['name_ar'] ?? 'المتجر'} المستقلة',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w900,
                                    color: Color(0xFF86191B),
                                  ),
                                ),
                                const Text(
                                  'عرض التقييمات، ساعات العمل، المتابعة ومشاركة الرابط',
                                  style: TextStyle(fontSize: 10.5, color: Color(0xFF64748B)),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.arrow_back_ios_new_rounded, size: 14, color: Color(0xFFA92224)),
                        ],
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                if (storeSections.isNotEmpty) ...[
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('أقسام المتجر', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      Text('اسحب أفقيًا ←', style: TextStyle(fontSize: 11, color: Colors.black45)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 98,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(),
                      itemCount: storeSections.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 12),
                      itemBuilder: (context, idx) {
                        final sec = storeSections[idx];
                        final secId = '${sec['id']}';
                        final secKind = '${sec['kind']}';
                        final selected = _selectedSectionId == secId;
                        final flashing = _flashingSectionId == secId;
                        final fallbackWidget = Container(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: secKind == 'offers'
                                  ? const [Color(0xFFE11D48), Color(0xFFEA580C)]
                                  : secKind == 'all'
                                      ? const [Color(0xFF1E293B), Color(0xFF475569)]
                                      : const [Color(0xFF0D9488), Color(0xFF10B981)],
                            ),
                          ),
                          child: Icon(
                            secKind == 'offers'
                                ? Icons.local_offer
                                : secKind == 'all'
                                    ? Icons.grid_view_rounded
                                    : Icons.category,
                            color: Colors.white,
                            size: 26,
                          ),
                        );
                        return GestureDetector(
                          onTap: () => _triggerFlashSection(secId),
                          child: SizedBox(
                            width: 72,
                            child: Column(
                              children: [
                                AnimatedScale(
                                  scale: flashing ? 1.12 : 1.0,
                                  duration: const Duration(milliseconds: 220),
                                  child: Container(
                                    width: 58,
                                    height: 58,
                                    padding: const EdgeInsets.all(2),
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: flashing
                                            ? const Color(0xFFF5A623)
                                            : selected
                                                ? (secKind == 'offers' ? const Color(0xFFE11D48) : const Color(0xFFEA580C))
                                                : Colors.black12,
                                        width: selected || flashing ? 2.5 : 1.5,
                                      ),
                                      boxShadow: [
                                        if (flashing || selected)
                                          BoxShadow(
                                            color: flashing ? const Color(0x88F5A623) : const Color(0x33EA580C),
                                            blurRadius: flashing ? 12 : 6,
                                            offset: const Offset(0, 2),
                                          ),
                                      ],
                                    ),
                                    child: ClipOval(
                                      child: Stack(
                                        fit: StackFit.expand,
                                        children: [
                                          _buildRemoteOrDataImage('${sec['image_url'] ?? ''}', fallbackWidget),
                                          AnimatedOpacity(
                                            opacity: flashing ? 0.55 : 0.0,
                                            duration: const Duration(milliseconds: 200),
                                            child: Container(color: Colors.white),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Text(
                                  '${sec['name_ar'] ?? ''}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                                    color: selected
                                        ? (secKind == 'offers' ? const Color(0xFFBE123C) : const Color(0xFFC2410C))
                                        : Colors.black87,
                                    height: 1.15,
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
                const SizedBox(height: 10),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'catalog', label: Text('المنتجات')),
                    ButtonSegment(value: 'free_text', label: Text('طلب حر')),
                    ButtonSegment(value: 'voice', label: Text('صوت / صورة')),
                  ],
                  selected: {_channel},
                  onSelectionChanged: (v) => setState(() => _channel = v.first),
                ),
                if (_channel == 'catalog') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _searchCtrl,
                    onChanged: _onSearchChanged,
                    decoration: InputDecoration(
                      isDense: true,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      prefixIcon: const Icon(Icons.search, size: 20),
                      hintText: 'ابحث باسم المنتج أو الكود داخل المتجر...',
                      suffixIcon: _searchCtrl.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchCtrl.clear();
                                _searchDebounce?.cancel();
                                setState(() => _searchQuery = '');
                                _fetchProducts(reset: true);
                              },
                            )
                          : null,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        _loadingProducts
                            ? 'جاري تحميل المنتجات...'
                            : 'عرض ${_pagedProducts.length} من أصل $_totalProducts منتج',
                        style: const TextStyle(fontSize: 11.5, color: Colors.black54, fontWeight: FontWeight.w600),
                      ),
                      if (_loadError != null)
                        TextButton(
                          onPressed: () => _fetchProducts(reset: true),
                          child: const Text('إعادة المحاولة', style: TextStyle(fontSize: 11.5)),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
        if (_channel == 'catalog') ...[
          if (_loadingProducts && _pagedProducts.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(color: Color(0xFFEA580C)),
                ),
              ),
            )
          else if (_pagedProducts.isEmpty)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverToBoxAdapter(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Center(
                      child: Text(
                        _searchQuery.isNotEmpty
                            ? 'لا توجد منتجات مطابقة للبحث "$_searchQuery"'
                            : 'لا توجد منتجات في هذا القسم حاليًا',
                        style: const TextStyle(color: Colors.grey),
                      ),
                    ),
                  ),
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.builder(
                itemCount: _pagedProducts.length,
                itemBuilder: (context, idx) {
                  final p = _pagedProducts[idx];
                  final qty = widget.cart[p['id']] ?? 0;
                  final price = p['sale_price'] ?? p['base_price'];
                  final hasOffer = _isProductOffer(p, offersCategoryIds);
                  return Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: ListTile(
                      leading: SizedBox(
                        width: 48,
                        height: 48,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: _buildRemoteOrDataImage(
                            '${p['image_url'] ?? ''}',
                            Container(
                              color: const Color(0xFFF1F5F9),
                              child: const Icon(Icons.inventory_2_outlined, color: Color(0xFFEA580C)),
                            ),
                          ),
                        ),
                      ),
                      title: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${p['name_ar'] ?? ''}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                          ),
                          if (hasOffer)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFE11D48),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text(
                                'عرض',
                                style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                            ),
                        ],
                      ),
                      subtitle: Text('${p['category_name'] ?? ''} · $price ج.م'),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (qty > 0)
                            IconButton(
                              icon: const Icon(Icons.remove_circle_outline),
                              onPressed: () => widget.onAddProduct(p, -1),
                            ),
                          if (qty > 0) Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold)),
                          IconButton(
                            icon: const Icon(Icons.add_circle, color: Color(0xFFEA580C)),
                            onPressed: () => widget.onAddProduct(p, 1),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
            sliver: SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_loadingMore)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Center(child: CircularProgressIndicator(strokeWidth: 2.5, color: Color(0xFFEA580C))),
                    )
                  else if (_hasMore)
                    OutlinedButton.icon(
                      onPressed: () => _fetchProducts(reset: false),
                      icon: const Icon(Icons.expand_more),
                      label: Text('تحميل المزيد (${_pagedProducts.length} / $_totalProducts)'),
                    ),
                  if (totalCartQty > 0) ...[
                    const SizedBox(height: 12),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFEA580C),
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(48),
                      ),
                      onPressed: widget.onOpenCart,
                      icon: const Icon(Icons.shopping_cart),
                      label: Text('عرض السلة الموحدة ($totalCartQty منتجات · ${totalCartEgp.toStringAsFixed(0)} ج.م)'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ] else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
            sliver: SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _freeOrderCtrl,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'اكتب طلبك الحر أو وصف المرفق',
                      hintText: 'مثال: 2 كيلو طماطم + علبة جبنة + عيش بلدي',
                    ),
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    value: _isExpress,
                    onChanged: (v) => setState(() => _isExpress = v),
                    title: const Text('توصيل مستعجل Express', style: TextStyle(fontSize: 13)),
                    contentPadding: EdgeInsets.zero,
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _couponCtrl,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            isDense: true,
                            labelText: 'كود الخصم (مثال: MANZALA20)',
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: _applyCoupon,
                        child: const Text('تطبيق'),
                      ),
                    ],
                  ),
                  if (_discount > 0) ...[
                    const SizedBox(height: 6),
                    Text(
                      'تم تطبيق خصم: -${_discount.toStringAsFixed(0)} ج.م',
                      style: const TextStyle(color: Color(0xFF0D9488), fontWeight: FontWeight.bold),
                    ),
                  ],
                  const SizedBox(height: 16),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFEA580C),
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    onPressed: _submitting ? null : () => _submitFreeOrder(zones),
                    child: const Text('إرسال الطلب الحر للتسعير'),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _applyCoupon() async {
    try {
      final res = await widget.api.validateCoupon(_couponCtrl.text, 150, 'stores');
      setState(() => _discount = (res['discount_amount'] as num).toDouble());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('تم خصم ${res['discount_amount']} ج.م')));
      }
    } catch (e) {
      setState(() => _discount = 0);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _submitFreeOrder(List zones) async {
    if (_selectedMerchantId.isEmpty || _freeOrderCtrl.text.trim().isEmpty) return;

    final zoneObj = zones.firstWhere((z) => z['id'] == _selectedZoneId, orElse: () => {'name_ar': 'وسط مدينة المنزلة'});
    setState(() => _submitting = true);
    try {
      final res = await widget.api.createOrder({
        'merchant_id': _selectedMerchantId,
        'zone_id': _selectedZoneId,
        'zone_name': zoneObj['name_ar'],
        'address_landmark': widget.addressLandmark,
        'order_channel': _channel,
        'free_order_text': _freeOrderCtrl.text.trim(),
        'is_express': _isExpress,
        'subtotal': 150,
        if (_couponCtrl.text.trim().isNotEmpty) 'coupon_code': _couponCtrl.text.trim(),
        'discount_amount': _discount,
        'payment_method': 'cash',
      });
      _freeOrderCtrl.clear();
      _couponCtrl.clear();
      setState(() => _discount = 0);
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم إرسال الطلب #${res['order_number']} بنجاح')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
