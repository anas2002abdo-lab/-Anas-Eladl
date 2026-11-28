import 'dart:io';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';
import 'storefront_product_pager_sheet.dart';

class StorefrontCategoriesScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final List<Map<String, dynamic>> categories;
  final List<Map<String, dynamic>> merchants;
  final String zoneName;
  final Map<String, int> cart;
  final VoidCallback onOpenSearch;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectMerchant;
  final void Function(String groupKey)? onSelectGroup;
  final Future<void> Function()? onRefreshCategories;
  final VoidCallback? onOpenAllStores;

  const StorefrontCategoriesScreen({
    super.key,
    required this.api,
    required this.categories,
    this.merchants = const [],
    required this.zoneName,
    required this.cart,
    required this.onOpenSearch,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onSelectBrand,
    required this.onSelectMerchant,
    this.onSelectGroup,
    this.onRefreshCategories,
    this.onOpenAllStores,
  });

  @override
  State<StorefrontCategoriesScreen> createState() => StorefrontCategoriesScreenState();
}

class StorefrontCategoriesScreenState extends State<StorefrontCategoriesScreen> {
  // Step 1: Platform Main Categories
  List<Map<String, dynamic>> _mainCategories = [];
  bool _loadingMainCats = false;
  String? _mainCatsError;

  // Step 2: Active Main Category -> Linked Merchants Strip -> Optional Selected Store -> Internal L1/L2/L3+ -> Products
  Map<String, dynamic>? _selectedMainCat;
  List<Map<String, dynamic>> _linkedMerchants = [];
  String? _selectedMerchantId;

  List<Map<String, dynamic>> _internalCategories = [];
  List<String> _internalPathIds = [];

  List<Map<String, dynamic>> _products = [];
  bool _loadingExplore = false;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  int _totalProducts = 0;
  String? _exploreError;
  int _fetchSeq = 0;

  final ScrollController _productsScrollCtrl = ScrollController();

  @override
  void initState() {
    super.initState();
    _productsScrollCtrl.addListener(_onProductsScroll);
    if (!Platform.environment.containsKey('FLUTTER_TEST')) {
      _loadMainCategories();
    }
  }

  @override
  void dispose() {
    _productsScrollCtrl.removeListener(_onProductsScroll);
    _productsScrollCtrl.dispose();
    super.dispose();
  }

  /// Called by parent PopScope hardware Back button handler.
  /// Steps cleanly: Internal Subcategory -> Selected Store -> Main Categories Root.
  bool handleSystemBack() {
    if (_internalPathIds.isNotEmpty) {
      setState(() {
        _internalPathIds = _internalPathIds.sublist(0, _internalPathIds.length - 1);
      });
      _fetchExplore(reset: true);
      return true;
    }
    if (_selectedMerchantId != null) {
      setState(() {
        _selectedMerchantId = null;
        _internalPathIds = [];
      });
      _fetchExplore(reset: true);
      return true;
    }
    if (_selectedMainCat != null) {
      _backToMainCategories();
      return true;
    }
    return false;
  }

  /// Opens a platform main category (or falls back to General + internal category) from deep link.
  bool openCategoryById(String categoryId) {
    final targetId = categoryId.trim();
    if (targetId.isEmpty) return false;
    for (final mc in _mainCategories) {
      final id = (mc['id'] ?? '').toString();
      final slug = (mc['slug'] ?? '').toString();
      if (id == targetId || slug == targetId) {
        _openMainCategory(mc);
        return true;
      }
    }
    final general = _mainCategories.cast<Map<String, dynamic>?>().firstWhere(
          (m) => m != null && (m['is_general'] == true || m['is_general'] == 1),
          orElse: () => null,
        );
    if (general != null) {
      setState(() {
        _selectedMainCat = general;
        _selectedMerchantId = null;
        _internalPathIds = [targetId];
      });
      _fetchExplore(reset: true);
      return true;
    }
    return false;
  }

  void _onProductsScroll() {
    if (!_productsScrollCtrl.hasClients) return;
    final pos = _productsScrollCtrl.position;
    if (pos.pixels >= pos.maxScrollExtent - 320 &&
        !_loadingMore &&
        _hasMore &&
        !_loadingExplore &&
        _selectedMainCat != null) {
      _fetchExplore(reset: false);
    }
  }

  Future<void> _loadMainCategories() async {
    if (mounted) {
      setState(() {
        _loadingMainCats = true;
        _mainCatsError = null;
      });
    }
    try {
      final res = await widget.api.getMainCategories();
      if (!mounted) return;
      final list = ((res['main_categories'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      setState(() {
        _mainCategories = list;
        _loadingMainCats = false;
        _mainCatsError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMainCats = false;
        _mainCatsError = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _openMainCategory(Map<String, dynamic> mc) {
    setState(() {
      _selectedMainCat = mc;
      _selectedMerchantId = null;
      _internalPathIds = [];
      _linkedMerchants = [];
      _internalCategories = [];
      _products = [];
      _totalProducts = 0;
      _hasMore = false;
      _page = 1;
      _exploreError = null;
    });
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchExplore(reset: true);
  }

  void _backToMainCategories() {
    _fetchSeq++;
    setState(() {
      _selectedMainCat = null;
      _selectedMerchantId = null;
      _internalPathIds = [];
      _linkedMerchants = [];
      _internalCategories = [];
      _products = [];
      _loadingExplore = false;
      _loadingMore = false;
      _hasMore = false;
      _page = 1;
      _totalProducts = 0;
      _exploreError = null;
    });
  }

  void _toggleMerchantSelection(String? merchantId) {
    final nextId = (_selectedMerchantId == merchantId) ? null : merchantId;
    setState(() {
      _selectedMerchantId = nextId;
      _internalPathIds = [];
    });
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchExplore(reset: true);
  }

  void _selectInternalAtDepth(int depth, String? catId) {
    final next = _internalPathIds.take(depth).toList();
    if (catId != null && catId.isNotEmpty) {
      next.add(catId);
    }
    setState(() {
      _internalPathIds = next;
    });
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchExplore(reset: true);
  }

  String? get _activeInternalId =>
      _internalPathIds.isNotEmpty ? _internalPathIds.last : null;

  Future<void> _fetchExplore({required bool reset}) async {
    final mc = _selectedMainCat;
    if (mc == null) return;
    final mcId = (mc['id'] ?? '').toString();
    if (mcId.isEmpty) return;

    final seq = ++_fetchSeq;
    if (reset) {
      if (mounted) {
        setState(() {
          _loadingExplore = true;
          _exploreError = null;
          _page = 1;
        });
      }
    } else {
      if (_loadingMore || !_hasMore) return;
      if (mounted) setState(() => _loadingMore = true);
    }

    final targetPage = reset ? 1 : _page + 1;
    try {
      final res = await widget.api.exploreMainCategory(
        mcId,
        merchantId: _selectedMerchantId,
        internalCategoryId: _activeInternalId,
        page: targetPage,
        limit: 24,
      );
      if (!mounted || seq != _fetchSeq) return;

      final merchantsList = ((res['merchants'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final internalList = ((res['internal_categories'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final parsedProducts = ((res['products'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final pagination = res['pagination'] is Map
          ? Map<String, dynamic>.from(res['pagination'] as Map)
          : <String, dynamic>{};

      setState(() {
        _linkedMerchants = merchantsList;
        _internalCategories = internalList;
        if (reset) {
          _products = parsedProducts;
        } else {
          final seen = _products.map((p) => (p['id'] ?? '').toString()).toSet();
          for (final p in parsedProducts) {
            final pid = (p['id'] ?? '').toString();
            if (pid.isEmpty || !seen.contains(pid)) {
              _products.add(p);
              if (pid.isNotEmpty) seen.add(pid);
            }
          }
        }
        _page = targetPage;
        _hasMore = pagination['has_more'] == true;
        _totalProducts = (pagination['total'] as num?)?.toInt() ?? _products.length;
        _loadingExplore = false;
        _loadingMore = false;
        _exploreError = null;
      });
    } catch (e) {
      if (!mounted || seq != _fetchSeq) return;
      setState(() {
        _loadingExplore = false;
        _loadingMore = false;
        if (reset) {
          _exploreError = e.toString().replaceFirst('Exception: ', '');
          _products = [];
        }
      });
    }
  }

  Future<List<Map<String, dynamic>>> _loadMoreForPager() async {
    if (_selectedMainCat == null || !_hasMore) return _products;
    await _fetchExplore(reset: false);
    return List<Map<String, dynamic>>.from(_products);
  }

  int _getCartTotalQty() => widget.cart.values.fold<int>(0, (sum, q) => sum + q);

  Future<void> _openProductPager(int idx) async {
    await showStorefrontProductPager(
      context: context,
      api: widget.api,
      products: _products,
      initialIndex: idx,
      getCartCount: _getCartTotalQty,
      onAddToCart: (product, qty) => widget.onAddProduct(product, qty),
      onOpenCart: widget.onOpenCart,
      onSelectBrand: widget.onSelectBrand,
      onSelectStore: widget.onSelectMerchant,
      onLoadMore: _hasMore ? _loadMoreForPager : null,
    );
  }

  IconData _iconForKey(String key) {
    switch (key) {
      case 'shopping_basket':
        return Icons.shopping_basket_rounded;
      case 'meat':
        return Icons.local_fire_department_rounded;
      case 'produce':
        return Icons.eco_rounded;
      case 'fish':
        return Icons.set_meal_rounded;
      case 'detergents':
        return Icons.cleaning_services_rounded;
      case 'electronics':
        return Icons.devices_other_rounded;
      case 'perfumes':
        return Icons.auto_awesome_rounded;
      case 'restaurants':
        return Icons.restaurant_rounded;
      case 'home':
        return Icons.kitchen_rounded;
      case 'clothing':
        return Icons.checkroom_rounded;
      default:
        return Icons.grid_view_rounded;
    }
  }

  Color _parseHexColor(String? hex, {Color fallback = const Color(0xFFA92224)}) {
    final clean = (hex ?? '').trim().replaceFirst('#', '');
    if (clean.length == 6) {
      final val = int.tryParse('FF$clean', radix: 16);
      if (val != null) return Color(val);
    }
    return fallback;
  }

  List<_InternalLevelStrip> _buildInternalLevelStrips() {
    if (_internalCategories.isEmpty) return const [];
    final idSet = _internalCategories.map((c) => (c['id'] ?? '').toString()).toSet();
    final childrenByParent = <String, List<Map<String, dynamic>>>{};

    for (final c in _internalCategories) {
      final rawPid = (c['parent_id'] ?? '').toString().trim();
      final key = (rawPid.isNotEmpty && idSet.contains(rawPid)) ? rawPid : '__root__';
      childrenByParent.putIfAbsent(key, () => []).add(c);
    }

    final strips = <_InternalLevelStrip>[];
    final roots = childrenByParent['__root__'] ?? const [];
    if (roots.isEmpty) return strips;

    strips.add(_InternalLevelStrip(
      depth: 0,
      selectedId: _internalPathIds.isNotEmpty ? _internalPathIds[0] : null,
      items: roots,
    ));

    for (var i = 0; i < _internalPathIds.length; i++) {
      final cur = _internalPathIds[i];
      final kids = childrenByParent[cur] ?? const [];
      if (kids.isNotEmpty) {
        strips.add(_InternalLevelStrip(
          depth: i + 1,
          selectedId: _internalPathIds.length > i + 1 ? _internalPathIds[i + 1] : null,
          items: kids,
        ));
      }
    }
    return strips;
  }

  Map<String, dynamic>? _findSelectedMerchant() {
    if (_selectedMerchantId == null) return null;
    for (final m in _linkedMerchants) {
      if ((m['id'] ?? '').toString() == _selectedMerchantId) return m;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final selectedMain = _selectedMainCat;
    final selectedMerchant = _findSelectedMerchant();
    final levelStrips = selectedMain != null ? _buildInternalLevelStrips() : const <_InternalLevelStrip>[];

    return Container(
      color: const Color(0xFFF6F7F9),
      child: Column(
        children: [
          // Top Header + Internal Multi-Level Category Strips
          Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0))),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                  child: Row(
                    children: [
                      if (selectedMain != null) ...[
                        Material(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(12),
                          child: InkWell(
                            onTap: _backToMainCategories,
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              height: 38,
                              padding: const EdgeInsets.symmetric(horizontal: 10),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.arrow_forward_ios_rounded, size: 15, color: Color(0xFF0F172A)),
                                  SizedBox(width: 4),
                                  Text(
                                    'الأقسام',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                      color: Color(0xFF0F172A),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                      ],
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              selectedMain != null
                                  ? (selectedMain['name_ar'] ?? 'القسم').toString()
                                  : 'الأقسام الرئيسية',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 2),
                            if (selectedMain != null && selectedMerchant != null)
                              Row(
                                children: [
                                  const Icon(Icons.storefront_rounded, size: 13, color: Color(0xFFA92224)),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      (selectedMerchant['business_name_ar'] ?? '').toString(),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 11.5,
                                        color: Color(0xFFA92224),
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ],
                              )
                            else
                              Row(
                                children: [
                                  const Icon(Icons.location_on_outlined, size: 13, color: Color(0xFFA92224)),
                                  const SizedBox(width: 3),
                                  Expanded(
                                    child: Text(
                                      selectedMain != null
                                          ? '${_linkedMerchants.length} متجر · ${widget.zoneName.isNotEmpty ? widget.zoneName : 'المنزلة'}'
                                          : 'التوصيل إلى ${widget.zoneName.isNotEmpty ? widget.zoneName : 'المنزلة'}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 11.5,
                                        color: Color(0xFF64748B),
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      InkWell(
                        onTap: widget.onOpenSearch,
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          height: 38,
                          padding: const EdgeInsets.symmetric(horizontal: 11),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF2F2),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFFECACA)),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.search_rounded, size: 18, color: Color(0xFFA92224)),
                              SizedBox(width: 4),
                              Text(
                                'بحث',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFFA92224),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                // Multi-level internal category strips when exploring a store (or General)
                for (final strip in levelStrips) _buildInternalLevelRow(strip),
              ],
            ),
          ),

          // Main Content Body
          Expanded(
            child: selectedMain != null
                ? _buildExploreBody(selectedMain, selectedMerchant)
                : _buildMainCategoriesGrid(),
          ),
        ],
      ),
    );
  }

  Widget _buildInternalLevelRow(_InternalLevelStrip strip) {
    final isRootLevel = strip.depth == 0;
    return Container(
      height: isRootLevel ? 46 : 42,
      decoration: isRootLevel
          ? null
          : const BoxDecoration(
              color: Color(0xFFF8FAFC),
              border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
            ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.fromLTRB(14, isRootLevel ? 0 : 6, 14, isRootLevel ? 10 : 6),
        itemCount: strip.items.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: 7),
        itemBuilder: (_, idx) {
          final isAll = idx == 0;
          final node = isAll ? null : strip.items[idx - 1];
          final nodeId = node != null ? (node['id'] ?? '').toString() : null;
          final isActive = strip.selectedId == nodeId;
          final label = isAll ? 'الكل' : (node?['name_ar'] ?? '').toString().trim();

          return Material(
            color: isActive
                ? (isRootLevel ? const Color(0xFFA92224) : const Color(0xFFFEF2F2))
                : (isRootLevel ? const Color(0xFFF8FAFC) : Colors.white),
            borderRadius: BorderRadius.circular(10),
            child: InkWell(
              onTap: () => _selectInternalAtDepth(strip.depth, nodeId),
              borderRadius: BorderRadius.circular(10),
              child: Container(
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 13),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isActive ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                    width: isActive ? 1.25 : 1.0,
                  ),
                ),
                child: Text(
                  label,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: isRootLevel ? 12.5 : 11.5,
                    fontWeight: FontWeight.w800,
                    color: isActive
                        ? (isRootLevel ? Colors.white : const Color(0xFFA92224))
                        : const Color(0xFF334155),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildMainCategoriesGrid() {
    if (_loadingMainCats && _mainCategories.isEmpty) {
      return GridView.builder(
        padding: const EdgeInsets.all(14),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 11,
          mainAxisSpacing: 11,
          childAspectRatio: 1.05,
        ),
        itemCount: 8,
        itemBuilder: (_, __) => Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
        ),
      );
    }

    if (_mainCatsError != null && _mainCategories.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _mainCatsError!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155)),
              ),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _loadMainCategories,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFA92224),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('إعادة المحاولة', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      color: const Color(0xFFA92224),
      onRefresh: () async {
        await _loadMainCategories();
        if (widget.onRefreshCategories != null) {
          await widget.onRefreshCategories!();
        }
      },
      child: GridView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 11,
          mainAxisSpacing: 11,
          childAspectRatio: 1.02,
        ),
        itemCount: _mainCategories.length,
        itemBuilder: (_, idx) {
          final mc = _mainCategories[idx];
          final nameAr = (mc['name_ar'] ?? '').toString();
          final iconKey = (mc['icon_key'] ?? 'general').toString();
          final accent = _parseHexColor(mc['accent_color']?.toString());
          final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(mc['image_url']);
          final merchantsCount = (mc['merchants_count'] as num?)?.toInt() ?? 0;
          final productsCount = (mc['products_count'] as num?)?.toInt() ?? 0;

          return Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            child: InkWell(
              onTap: () => _openMainCategory(mc),
              borderRadius: BorderRadius.circular(20),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0A0F172A),
                      blurRadius: 10,
                      offset: Offset(0, 3),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      flex: 6,
                      child: Container(
                        color: accent.withOpacity(0.10),
                        child: imgUrl.isNotEmpty
                            ? Image.network(
                                imgUrl,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => _mainCatIconBox(iconKey, accent),
                              )
                            : _mainCatIconBox(iconKey, accent),
                      ),
                    ),
                    Expanded(
                      flex: 4,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              nameAr,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '$merchantsCount متجر · $productsCount منتج',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF64748B),
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
          );
        },
      ),
    );
  }

  Widget _mainCatIconBox(String iconKey, Color accent) {
    return Center(
      child: Container(
        width: 54,
        height: 54,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: accent.withOpacity(0.14),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Icon(_iconForKey(iconKey), size: 28, color: accent),
      ),
    );
  }

  Widget _buildExploreBody(
    Map<String, dynamic> selectedMain,
    Map<String, dynamic>? selectedMerchant,
  ) {
    final mainName = (selectedMain['name_ar'] ?? '').toString();
    final merchantName = (selectedMerchant?['business_name_ar'] ?? '').toString();

    return RefreshIndicator(
      color: const Color(0xFFA92224),
      onRefresh: () => _fetchExplore(reset: true),
      child: CustomScrollView(
        controller: _productsScrollCtrl,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Horizontal Swipeable Strip of ONLY Linked Merchants
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.storefront_rounded, size: 17, color: Color(0xFFA92224)),
                            const SizedBox(width: 6),
                            Text(
                              'متاجر $mainName',
                              style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF2F2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '${_linkedMerchants.length}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFFA92224),
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (_selectedMerchantId != null)
                          InkWell(
                            onTap: () => _toggleMerchantSelection(null),
                            child: const Text(
                              'عرض كل المتاجر',
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFFA92224),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (_linkedMerchants.isNotEmpty)
                    SizedBox(
                      height: 108,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        physics: const BouncingScrollPhysics(),
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        itemCount: _linkedMerchants.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(width: 9),
                        itemBuilder: (_, idx) {
                          if (idx == 0) {
                            final allSelected = _selectedMerchantId == null;
                            return Material(
                              color: allSelected ? const Color(0xFFA92224) : Colors.white,
                              borderRadius: BorderRadius.circular(18),
                              child: InkWell(
                                onTap: () => _toggleMerchantSelection(null),
                                borderRadius: BorderRadius.circular(18),
                                child: Container(
                                  width: 88,
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(18),
                                    border: Border.all(
                                      color: allSelected
                                          ? const Color(0xFFA92224)
                                          : const Color(0xFFE2E8F0),
                                    ),
                                  ),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Container(
                                        width: 44,
                                        height: 44,
                                        decoration: BoxDecoration(
                                          color: allSelected
                                              ? Colors.white.withOpacity(0.18)
                                              : const Color(0xFFFEF2F2),
                                          borderRadius: BorderRadius.circular(14),
                                        ),
                                        child: Icon(
                                          Icons.grid_view_rounded,
                                          size: 22,
                                          color: allSelected
                                              ? Colors.white
                                              : const Color(0xFFA92224),
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        'كل المتاجر',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w800,
                                          color: allSelected
                                              ? Colors.white
                                              : const Color(0xFF0F172A),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          }

                          final m = _linkedMerchants[idx - 1];
                          final mId = (m['id'] ?? '').toString();
                          final mName = (m['business_name_ar'] ?? 'متجر').toString();
                          final logo = OtlobhaCustomerApi.resolveMediaUrl(m['image_url']);
                          final isSelected = _selectedMerchantId == mId;
                          final isOpen = m['is_open_now'] == true || m['is_open_now'] == 1;
                          final pCount = (m['products_count'] as num?)?.toInt() ?? 0;

                          return Material(
                            color: isSelected ? const Color(0xFFFEF2F2) : Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            child: InkWell(
                              onTap: () => _toggleMerchantSelection(mId),
                              borderRadius: BorderRadius.circular(18),
                              child: Container(
                                width: 104,
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(18),
                                  border: Border.all(
                                    color: isSelected
                                        ? const Color(0xFFA92224)
                                        : const Color(0xFFE2E8F0),
                                    width: isSelected ? 1.6 : 1.0,
                                  ),
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Stack(
                                      clipBehavior: Clip.none,
                                      children: [
                                        Container(
                                          width: 44,
                                          height: 44,
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFFEF2F2),
                                            borderRadius: BorderRadius.circular(14),
                                            border: Border.all(color: const Color(0xFFF1F5F9)),
                                          ),
                                          clipBehavior: Clip.antiAlias,
                                          child: logo.isNotEmpty
                                              ? Image.network(
                                                  logo,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (_, __, ___) => const Icon(
                                                    Icons.storefront_rounded,
                                                    color: Color(0xFFA92224),
                                                    size: 22,
                                                  ),
                                                )
                                              : const Icon(
                                                  Icons.storefront_rounded,
                                                  color: Color(0xFFA92224),
                                                  size: 22,
                                                ),
                                        ),
                                        Positioned(
                                          bottom: -1,
                                          left: -1,
                                          child: Container(
                                            width: 11,
                                            height: 11,
                                            decoration: BoxDecoration(
                                              color: isOpen
                                                  ? const Color(0xFF10B981)
                                                  : const Color(0xFF94A3B8),
                                              shape: BoxShape.circle,
                                              border: Border.all(color: Colors.white, width: 1.8),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      mName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w800,
                                        color: isSelected
                                            ? const Color(0xFFA92224)
                                            : const Color(0xFF0F172A),
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '${isOpen ? 'مفتوح' : 'مغلق'} · $pCount',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: FontWeight.w700,
                                        color: isOpen
                                            ? const Color(0xFF059669)
                                            : const Color(0xFF64748B),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    )
                  else if (!_loadingExplore)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 14),
                      child: Text(
                        'لا توجد متاجر مرتبطة بهذا القسم حاليًا',
                        style: TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // Context Line: Section Title + Count
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            selectedMerchant != null
                                ? 'منتجات $merchantName في $mainName'
                                : 'جميع منتجات $mainName',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                        ),
                        if (!_loadingExplore) ...[
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 6),
                            child: Text('·', style: TextStyle(color: Color(0xFF94A3B8), fontWeight: FontWeight.w900)),
                          ),
                          Text(
                            '$_totalProducts منتج',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Products Grid / Loading / Error / Empty
          if (_loadingExplore)
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
                  (_, __) => Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                  ),
                  childCount: 6,
                ),
              ),
            )
          else if (_exploreError != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Text(
                      _exploreError!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155)),
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () => _fetchExplore(reset: true),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFA92224),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('إعادة المحاولة', style: TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  ],
                ),
              ),
            )
          else if (_products.isEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 16, 14, 24),
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.inventory_2_outlined, size: 28, color: Color(0xFFA92224)),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'لا توجد منتجات متاحة حاليًا في هذا القسم',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                      ),
                      if (_selectedMerchantId != null || _internalPathIds.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: () {
                            setState(() {
                              _selectedMerchantId = null;
                              _internalPathIds = [];
                            });
                            _fetchExplore(reset: true);
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFA92224),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          child: Text(
                            'عرض كل منتجات $mainName',
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            )
          else ...[
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
                  (_, idx) {
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
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 16, 14, 28),
                child: _loadingMore
                    ? const Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2.4, color: Color(0xFFA92224)),
                        ),
                      )
                    : _hasMore
                        ? Center(
                            child: OutlinedButton(
                              onPressed: () => _fetchExplore(reset: false),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFFA92224),
                                side: const BorderSide(color: Color(0xFFE2E8F0)),
                                backgroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: const Text(
                                'عرض المزيد من المنتجات',
                                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
                              ),
                            ),
                          )
                        : const SizedBox(height: 12),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InternalLevelStrip {
  final int depth;
  final String? selectedId;
  final List<Map<String, dynamic>> items;

  const _InternalLevelStrip({
    required this.depth,
    required this.selectedId,
    required this.items,
  });
}
