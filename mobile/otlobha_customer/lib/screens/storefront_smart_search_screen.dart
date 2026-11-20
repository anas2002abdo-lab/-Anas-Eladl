import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';
import 'storefront_product_pager_sheet.dart';

class StorefrontSmartSearchScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, int> cart;
  final int Function() getCartCount;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectStore;
  final String initialQuery;

  const StorefrontSmartSearchScreen({
    super.key,
    required this.api,
    required this.cart,
    required this.getCartCount,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onSelectBrand,
    required this.onSelectStore,
    this.initialQuery = '',
  });

  @override
  State<StorefrontSmartSearchScreen> createState() => _StorefrontSmartSearchScreenState();
}

class _StorefrontSmartSearchScreenState extends State<StorefrontSmartSearchScreen> {
  static const List<String> _smartSuggestions = [
    'أرخص أسعار السكر والزيت',
    'عروض المخبوزات والكرواسون',
    'مشروبات وقهوة وشاي',
    'منظفات وعناية بالمنزل',
    'ألبان وأجبان طازجة',
  ];

  late final TextEditingController _queryCtrl;
  late final TextEditingController _minPriceCtrl;
  late final TextEditingController _maxPriceCtrl;
  Timer? _debounce;

  bool _loading = true;
  bool _showFilters = false;
  String? _error;

  String _sort = 'relevance';
  String _selectedMerchantId = '';
  String _selectedBrand = '';

  List<Map<String, dynamic>> _items = [];
  List<Map<String, dynamic>> _topOffers = [];
  List<String> _trendingQueries = [];
  List<String> _facetBrands = [];
  List<Map<String, dynamic>> _facetStores = [];

  @override
  void initState() {
    super.initState();
    _queryCtrl = TextEditingController(text: widget.initialQuery);
    _minPriceCtrl = TextEditingController();
    _maxPriceCtrl = TextEditingController();
    _runSearch();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _queryCtrl.dispose();
    _minPriceCtrl.dispose();
    _maxPriceCtrl.dispose();
    super.dispose();
  }

  int get _activeFiltersCount {
    int count = 0;
    if (_sort != 'relevance') count++;
    if (_selectedMerchantId.isNotEmpty) count++;
    if (_selectedBrand.isNotEmpty) count++;
    if (_minPriceCtrl.text.trim().isNotEmpty) count++;
    if (_maxPriceCtrl.text.trim().isNotEmpty) count++;
    return count;
  }

  bool get _hasActiveQueryOrFilters =>
      _queryCtrl.text.trim().isNotEmpty || _activeFiltersCount > 0;

  void _scheduleSearch() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 220), _runSearch);
  }

  Future<void> _runSearch() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api.searchStorefront(
        q: _queryCtrl.text.trim(),
        brand: _selectedBrand.isNotEmpty ? _selectedBrand : null,
        merchantId: _selectedMerchantId.isNotEmpty ? _selectedMerchantId : null,
        minPrice: _minPriceCtrl.text.trim().isNotEmpty ? _minPriceCtrl.text.trim() : null,
        maxPrice: _maxPriceCtrl.text.trim().isNotEmpty ? _maxPriceCtrl.text.trim() : null,
        sort: _sort != 'relevance' ? _sort : null,
        limit: 40,
      );
      if (!mounted) return;

      final rawItems = (res['items'] as List?) ?? [];
      final rawOffers = (res['top_offers'] as List?) ?? [];
      final rawTrending = (res['trending_queries'] as List?) ?? [];
      final facets = res['facets'] is Map
          ? Map<String, dynamic>.from(res['facets'] as Map)
          : <String, dynamic>{};
      final rawBrands = (facets['brands'] as List?) ?? [];
      final rawStores = (facets['stores'] as List?) ?? [];

      setState(() {
        _items = rawItems
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _topOffers = rawOffers
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _trendingQueries = rawTrending
            .map((e) => e.toString().trim())
            .where((s) => s.isNotEmpty)
            .toList();
        _facetBrands = rawBrands
            .map((e) => e.toString().trim())
            .where((s) => s.isNotEmpty)
            .toList();
        _facetStores = rawStores
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _clearFilters() {
    setState(() {
      _sort = 'relevance';
      _selectedMerchantId = '';
      _selectedBrand = '';
      _minPriceCtrl.clear();
      _maxPriceCtrl.clear();
    });
    _runSearch();
  }

  void _handleProductDelta(Map<String, dynamic> product, int delta) {
    widget.onAddProduct(product, delta);
    if (mounted) setState(() {});
  }

  Future<void> _openPager(List<Map<String, dynamic>> list, int idx) async {
    await showStorefrontProductPager(
      context: context,
      api: widget.api,
      products: list,
      initialIndex: idx,
      getCartCount: widget.getCartCount,
      onAddToCart: (product, qty) {
        _handleProductDelta(product, qty);
      },
      onOpenCart: () {
        Navigator.of(context).pop();
        widget.onOpenCart();
      },
      onSelectBrand: (brand) {
        Navigator.of(context).pop();
        widget.onSelectBrand(brand);
      },
      onSelectStore: (merchantId, merchantName) {
        Navigator.of(context).pop();
        widget.onSelectStore(merchantId, merchantName);
      },
    );
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final cartCount = widget.getCartCount();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFFF6F7F9),
        body: SafeArea(
          child: Column(
            children: [
              // Sticky Search Top Bar
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                child: Column(
                  children: [
                    Row(
                      children: [
                        IconButton(
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.arrow_forward_rounded, color: Color(0xFF0F172A)),
                          tooltip: 'رجوع',
                        ),
                        Expanded(
                          child: Container(
                            height: 44,
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: TextField(
                              controller: _queryCtrl,
                              autofocus: widget.initialQuery.isEmpty,
                              textInputAction: TextInputAction.search,
                              onChanged: (_) => _scheduleSearch(),
                              onSubmitted: (_) => _runSearch(),
                              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                              decoration: InputDecoration(
                                hintText: 'ابحث عن منتج، ماركة، أو متجر...',
                                hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                                prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFFA92224), size: 20),
                                suffixIcon: _queryCtrl.text.isNotEmpty
                                    ? IconButton(
                                        onPressed: () {
                                          _queryCtrl.clear();
                                          _runSearch();
                                        },
                                        icon: const Icon(Icons.close_rounded, size: 18, color: Color(0xFF64748B)),
                                      )
                                    : null,
                                border: InputBorder.none,
                                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        InkWell(
                          onTap: () => setState(() => _showFilters = !_showFilters),
                          borderRadius: BorderRadius.circular(14),
                          child: Container(
                            height: 44,
                            padding: const EdgeInsets.symmetric(horizontal: 11),
                            decoration: BoxDecoration(
                              color: _showFilters || _activeFiltersCount > 0
                                  ? const Color(0xFFA92224)
                                  : const Color(0xFFFEF2F2),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: _showFilters || _activeFiltersCount > 0
                                    ? const Color(0xFFA92224)
                                    : const Color(0xFFFECACA),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.tune_rounded,
                                  size: 18,
                                  color: _showFilters || _activeFiltersCount > 0
                                      ? Colors.white
                                      : const Color(0xFFA92224),
                                ),
                                if (_activeFiltersCount > 0) ...[
                                  const SizedBox(width: 4),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF5A623),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      '$_activeFiltersCount',
                                      style: const TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w900,
                                        color: Color(0xFF3B180E),
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),

                    // Collapsible Filter Bar
                    if (_showFilters) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Sort options
                            const Text(
                              'ترتيب النتائج',
                              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Color(0xFF475569)),
                            ),
                            const SizedBox(height: 6),
                            SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(
                                children: [
                                  _sortChip('relevance', 'الأكثر صلة'),
                                  const SizedBox(width: 6),
                                  _sortChip('price_asc', 'الأقل سعرًا'),
                                  const SizedBox(width: 6),
                                  _sortChip('price_desc', 'الأعلى سعرًا'),
                                  const SizedBox(width: 6),
                                  _sortChip('discount_desc', 'أكبر خصم'),
                                ],
                              ),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                if (_facetStores.isNotEmpty)
                                  Expanded(
                                    child: DropdownButtonFormField<String>(
                                      value: _facetStores.any((s) => (s['id'] ?? '').toString() == _selectedMerchantId)
                                          ? _selectedMerchantId
                                          : '',
                                      isExpanded: true,
                                      decoration: const InputDecoration(
                                        labelText: 'المتجر',
                                        isDense: true,
                                        filled: true,
                                        fillColor: Colors.white,
                                        border: OutlineInputBorder(),
                                      ),
                                      items: [
                                        const DropdownMenuItem(value: '', child: Text('كل المتاجر', style: TextStyle(fontSize: 12))),
                                        ..._facetStores.map(
                                          (s) => DropdownMenuItem(
                                            value: (s['id'] ?? '').toString(),
                                            child: Text(
                                              (s['name_ar'] ?? s['name'] ?? '').toString(),
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(fontSize: 12),
                                            ),
                                          ),
                                        ),
                                      ],
                                      onChanged: (v) {
                                        setState(() => _selectedMerchantId = v ?? '');
                                        _runSearch();
                                      },
                                    ),
                                  ),
                                if (_facetStores.isNotEmpty && _facetBrands.isNotEmpty) const SizedBox(width: 8),
                                if (_facetBrands.isNotEmpty)
                                  Expanded(
                                    child: DropdownButtonFormField<String>(
                                      value: _facetBrands.contains(_selectedBrand) ? _selectedBrand : '',
                                      isExpanded: true,
                                      decoration: const InputDecoration(
                                        labelText: 'العلامة التجارية',
                                        isDense: true,
                                        filled: true,
                                        fillColor: Colors.white,
                                        border: OutlineInputBorder(),
                                      ),
                                      items: [
                                        const DropdownMenuItem(value: '', child: Text('كل الماركات', style: TextStyle(fontSize: 12))),
                                        ..._facetBrands.map(
                                          (b) => DropdownMenuItem(
                                            value: b,
                                            child: Text(b, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                                          ),
                                        ),
                                      ],
                                      onChanged: (v) {
                                        setState(() => _selectedBrand = v ?? '');
                                        _runSearch();
                                      },
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: _minPriceCtrl,
                                    keyboardType: TextInputType.number,
                                    onChanged: (_) => _scheduleSearch(),
                                    decoration: const InputDecoration(
                                      labelText: 'أقل سعر (ج.م)',
                                      isDense: true,
                                      filled: true,
                                      fillColor: Colors.white,
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: TextField(
                                    controller: _maxPriceCtrl,
                                    keyboardType: TextInputType.number,
                                    onChanged: (_) => _scheduleSearch(),
                                    decoration: const InputDecoration(
                                      labelText: 'أعلى سعر (ج.م)',
                                      isDense: true,
                                      filled: true,
                                      fillColor: Colors.white,
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                if (_activeFiltersCount > 0) ...[
                                  const SizedBox(width: 8),
                                  TextButton(
                                    onPressed: _clearFilters,
                                    style: TextButton.styleFrom(foregroundColor: const Color(0xFFA92224)),
                                    child: const Text('مسح', style: TextStyle(fontWeight: FontWeight.w800)),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),

              // Main Content
              Expanded(
                child: _loading
                    ? const Center(
                        child: CircularProgressIndicator(color: Color(0xFFA92224)),
                      )
                    : _error != null
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.wifi_off_rounded, size: 42, color: Color(0xFFA92224)),
                                  const SizedBox(height: 10),
                                  Text(_error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13)),
                                  const SizedBox(height: 12),
                                  ElevatedButton(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFFA92224),
                                      foregroundColor: Colors.white,
                                    ),
                                    onPressed: _runSearch,
                                    child: const Text('إعادة المحاولة'),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : _hasActiveQueryOrFilters
                            ? _buildSearchResultsView()
                            : _buildDiscoveryView(),
              ),

              // Floating Mini Cart Strip when items exist
              if (cartCount > 0)
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
                  child: InkWell(
                    onTap: () {
                      Navigator.of(context).pop();
                      widget.onOpenCart();
                    },
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFA92224), Color(0xFF86191B)],
                        ),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF5A623),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              '$cartCount',
                              style: const TextStyle(
                                color: Color(0xFF3B180E),
                                fontSize: 12,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'عرض السلة وإتمام الطلب',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          const Icon(Icons.shopping_cart_checkout_rounded, color: Colors.white, size: 19),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sortChip(String value, String label) {
    final active = _sort == value;
    return InkWell(
      onTap: () {
        setState(() => _sort = value);
        _runSearch();
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
        decoration: BoxDecoration(
          color: active ? const Color(0xFFA92224) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: active ? const Color(0xFFA92224) : const Color(0xFFCBD5E1)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: active ? Colors.white : const Color(0xFF334155),
          ),
        ),
      ),
    );
  }

  Widget _buildDiscoveryView() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
      children: [
        if (_trendingQueries.isNotEmpty) ...[
          const Row(
            children: [
              Icon(Icons.trending_up_rounded, size: 18, color: Color(0xFFA92224)),
              SizedBox(width: 6),
              Text(
                'الأكثر بحثًا حولك',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _trendingQueries.map((q) {
              return InkWell(
                onTap: () {
                  _queryCtrl.text = q;
                  _runSearch();
                },
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.search_rounded, size: 14, color: Color(0xFF64748B)),
                      const SizedBox(width: 5),
                      Text(
                        q,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF0F172A)),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 18),
        ],

        // Smart Suggestions
        const Row(
          children: [
            Icon(Icons.auto_awesome_rounded, size: 18, color: Color(0xFFF5A623)),
            SizedBox(width: 6),
            Text(
              'مقترحات ذكية',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _smartSuggestions.map((s) {
            return InkWell(
              onTap: () {
                _queryCtrl.text = s;
                _runSearch();
              },
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0x66F5A623)),
                ),
                child: Text(
                  s,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF86191B)),
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 20),

        // Top Offers Grid
        if (_topOffers.isNotEmpty) ...[
          Row(
            children: [
              const Icon(Icons.local_fire_department_rounded, size: 19, color: Color(0xFFA92224)),
              const SizedBox(width: 6),
              const Expanded(
                child: Text(
                  'أفضل العروض المتاحة الآن',
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                ),
              ),
              Text(
                '${_topOffers.length} عرض',
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF64748B)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 0.62,
            ),
            itemCount: _topOffers.length,
            itemBuilder: (_, idx) {
              final prod = _topOffers[idx];
              final pid = (prod['id'] ?? '').toString();
              return StorefrontProductCardWidget(
                product: prod,
                cartQty: widget.cart[pid] ?? 0,
                onTapDetails: () => _openPager(_topOffers, idx),
                onAdd: () => _handleProductDelta(prod, 1),
                onDecrement: () => _handleProductDelta(prod, -1),
              );
            },
          ),
        ],
      ],
    );
  }

  Widget _buildSearchResultsView() {
    if (_items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 66,
                height: 66,
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.search_off_rounded, size: 34, color: Color(0xFFA92224)),
              ),
              const SizedBox(height: 12),
              const Text(
                'لم نجد منتجات مطابقة لبحثك',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 6),
              const Text(
                'جرّب كلمة بحث أقصر أو قم بمسح بعض الفلاتر',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5, color: Color(0xFF64748B)),
              ),
              if (_activeFiltersCount > 0) ...[
                const SizedBox(height: 14),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFA92224),
                    foregroundColor: Colors.white,
                  ),
                  onPressed: _clearFilters,
                  child: const Text('مسح كل الفلاتر'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
      children: [
        Row(
          children: [
            Text(
              'تم العثور على ${_items.length} منتج',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
            ),
            const Spacer(),
            if (_activeFiltersCount > 0)
              TextButton(
                onPressed: _clearFilters,
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFFA92224),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('إعادة ضبط الفلاتر', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
              ),
          ],
        ),
        const SizedBox(height: 10),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 0.62,
          ),
          itemCount: _items.length,
          itemBuilder: (_, idx) {
            final prod = _items[idx];
            final pid = (prod['id'] ?? '').toString();
            return StorefrontProductCardWidget(
              product: prod,
              cartQty: widget.cart[pid] ?? 0,
              onTapDetails: () => _openPager(_items, idx),
              onAdd: () => _handleProductDelta(prod, 1),
              onDecrement: () => _handleProductDelta(prod, -1),
            );
          },
        ),
      ],
    );
  }
}
