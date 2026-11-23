import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';
import 'storefront_product_pager_sheet.dart';

class StorefrontCategoriesScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final List<Map<String, dynamic>> categories;
  final String zoneName;
  final Map<String, int> cart;
  final VoidCallback onOpenSearch;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectMerchant;
  final void Function(String groupKey)? onSelectGroup;

  const StorefrontCategoriesScreen({
    super.key,
    required this.api,
    required this.categories,
    required this.zoneName,
    required this.cart,
    required this.onOpenSearch,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onSelectBrand,
    required this.onSelectMerchant,
    this.onSelectGroup,
  });

  @override
  State<StorefrontCategoriesScreen> createState() => StorefrontCategoriesScreenState();
}

class _CategoryGroupMeta {
  final String key;
  final String title;
  final IconData icon;
  final Color accent;
  final Color bg;

  const _CategoryGroupMeta({
    required this.key,
    required this.title,
    required this.icon,
    required this.accent,
    required this.bg,
  });
}

class StorefrontCategoriesScreenState extends State<StorefrontCategoriesScreen> {
  static const List<_CategoryGroupMeta> _groups = [
    _CategoryGroupMeta(
      key: 'groceries',
      title: 'المقاضي والمواد الغذائية',
      icon: Icons.shopping_basket_rounded,
      accent: Color(0xFFA92224),
      bg: Color(0xFFFEF2F2),
    ),
    _CategoryGroupMeta(
      key: 'fresh',
      title: 'المنتجات الطازجة والمخبوزات',
      icon: Icons.eco_rounded,
      accent: Color(0xFF047857),
      bg: Color(0xFFECFDF5),
    ),
    _CategoryGroupMeta(
      key: 'drinks',
      title: 'المشروبات والقهوة والشاي',
      icon: Icons.local_cafe_rounded,
      accent: Color(0xFFD97706),
      bg: Color(0xFFFFFBEB),
    ),
    _CategoryGroupMeta(
      key: 'home_care',
      title: 'المنظفات والعناية بالمنزل',
      icon: Icons.cleaning_services_rounded,
      accent: Color(0xFF0284C7),
      bg: Color(0xFFF0F9FF),
    ),
    _CategoryGroupMeta(
      key: 'kitchen',
      title: 'مستلزمات المطبخ والمنزل',
      icon: Icons.kitchen_rounded,
      accent: Color(0xFF7C3AED),
      bg: Color(0xFFF5F3FF),
    ),
    _CategoryGroupMeta(
      key: 'other',
      title: 'أقسام أخرى والصيدلية',
      icon: Icons.grid_view_rounded,
      accent: Color(0xFF475569),
      bg: Color(0xFFF1F5F9),
    ),
  ];

  // 3-level inline hierarchy:
  // L1 (Root square cards) -> L2 (Horizontal strip 1) -> L3 (Horizontal strip 2) -> Inline products
  String? _selectedL1Id;
  String? _selectedL2Id;
  String? _selectedL3Id;

  List<Map<String, dynamic>> _products = [];
  bool _loadingProducts = false;
  bool _loadingMore = false;
  bool _hasMore = false;
  int _page = 1;
  int _totalProducts = 0;
  String? _error;
  int _fetchSeq = 0;

  final ScrollController _productsScrollCtrl = ScrollController();
  final ScrollController _l2ScrollCtrl = ScrollController();
  final ScrollController _l3ScrollCtrl = ScrollController();

  @override
  void initState() {
    super.initState();
    _productsScrollCtrl.addListener(_onProductsScroll);
  }

  @override
  void dispose() {
    _productsScrollCtrl.removeListener(_onProductsScroll);
    _productsScrollCtrl.dispose();
    _l2ScrollCtrl.dispose();
    _l3ScrollCtrl.dispose();
    super.dispose();
  }

  /// Called by parent PopScope hardware Back button handler.
  /// Returns true if an inline category selection was cleared back to root squares.
  bool handleSystemBack() {
    if (_selectedL1Id != null) {
      _backToRoots();
      return true;
    }
    return false;
  }

  /// Opens a specific category (L1, L2, or L3) directly from a push notification deep link.
  bool openCategoryById(String categoryId) {
    final targetId = categoryId.trim();
    if (targetId.isEmpty) return false;
    final target = _findById(targetId);
    if (target == null) return false;

    final chain = <String>[];
    String? curId = targetId;
    var guard = 0;
    while (curId != null && curId.isNotEmpty && guard < 5) {
      guard++;
      chain.insert(0, curId);
      final node = _findById(curId);
      final pid = node != null ? _parentIdOf(node) : '';
      if (pid.isEmpty || _findById(pid) == null) break;
      curId = pid;
    }

    setState(() {
      _selectedL1Id = chain.isNotEmpty ? chain[0] : targetId;
      _selectedL2Id = chain.length >= 2 ? chain[1] : null;
      _selectedL3Id = chain.length >= 3 ? chain[2] : null;
    });
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchCategoryProducts(targetId, reset: true);
    return true;
  }

  void _onProductsScroll() {
    if (!_productsScrollCtrl.hasClients) return;
    final pos = _productsScrollCtrl.position;
    if (pos.pixels >= pos.maxScrollExtent - 320 && !_loadingMore && _hasMore && !_loadingProducts) {
      final activeId = _activeCategoryId();
      if (activeId != null) {
        _fetchCategoryProducts(activeId, reset: false);
      }
    }
  }

  String _idOf(Map<String, dynamic> c) => (c['id'] ?? '').toString().trim();

  String _parentIdOf(Map<String, dynamic> c) => (c['parent_id'] ?? '').toString().trim();

  Map<String, dynamic>? _findById(String? id) {
    if (id == null || id.isEmpty) return null;
    for (final c in widget.categories) {
      if (_idOf(c) == id) return c;
    }
    return null;
  }

  List<Map<String, dynamic>> _childrenOf(String parentId) {
    return widget.categories.where((c) => _parentIdOf(c) == parentId).toList();
  }

  List<Map<String, dynamic>> _rootCategories() {
    final ids = widget.categories.map(_idOf).toSet();
    return widget.categories.where((c) {
      final pid = _parentIdOf(c);
      return pid.isEmpty || !ids.contains(pid);
    }).toList();
  }

  String? _activeCategoryId() => _selectedL3Id ?? _selectedL2Id ?? _selectedL1Id;

  String _resolveGroupKey(Map<String, dynamic> c) {
    final explicit = (c['group_key'] ?? '').toString().trim().toLowerCase();
    if (_groups.any((g) => g.key == explicit)) return explicit;
    final name = '${c['name_ar'] ?? ''} ${c['full_path_ar'] ?? ''}'.toLowerCase();
    if (name.contains('خضار') ||
        name.contains('فاكه') ||
        name.contains('طازج') ||
        name.contains('مخبوز') ||
        name.contains('لحوم') ||
        name.contains('دواجن') ||
        name.contains('ألبان') ||
        name.contains('جبن')) {
      return 'fresh';
    }
    if (name.contains('مشروب') ||
        name.contains('قهو') ||
        name.contains('شاي') ||
        name.contains('عصير') ||
        name.contains('مياه')) {
      return 'drinks';
    }
    if (name.contains('منظف') ||
        name.contains('عناي') ||
        name.contains('تنظيف') ||
        name.contains('غسيل') ||
        name.contains('شخصي')) {
      return 'home_care';
    }
    if (name.contains('مطبخ') || name.contains('أواني') || name.contains('أدوات')) {
      return 'kitchen';
    }
    if (name.contains('سوبر') ||
        name.contains('مقاض') ||
        name.contains('غذائ') ||
        name.contains('بقال') ||
        name.contains('معلب') ||
        name.contains('حلويات') ||
        name.contains('سناكس')) {
      return 'groceries';
    }
    return 'other';
  }

  void _selectL1(Map<String, dynamic> cat) {
    final id = _idOf(cat);
    if (id.isEmpty) return;
    setState(() {
      _selectedL1Id = id;
      _selectedL2Id = null;
      _selectedL3Id = null;
    });
    if (_l2ScrollCtrl.hasClients) _l2ScrollCtrl.jumpTo(0);
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchCategoryProducts(id, reset: true);
  }

  void _selectL2(String? l2Id) {
    final l1Id = _selectedL1Id;
    if (l1Id == null) return;
    setState(() {
      _selectedL2Id = l2Id;
      _selectedL3Id = null;
    });
    if (_l3ScrollCtrl.hasClients) _l3ScrollCtrl.jumpTo(0);
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchCategoryProducts(l2Id ?? l1Id, reset: true);
  }

  void _selectL3(String? l3Id) {
    final fallbackId = _selectedL2Id ?? _selectedL1Id;
    if (fallbackId == null) return;
    setState(() {
      _selectedL3Id = l3Id;
    });
    if (_productsScrollCtrl.hasClients) _productsScrollCtrl.jumpTo(0);
    _fetchCategoryProducts(l3Id ?? fallbackId, reset: true);
  }

  void _backToRoots() {
    _fetchSeq++;
    setState(() {
      _selectedL1Id = null;
      _selectedL2Id = null;
      _selectedL3Id = null;
      _products = [];
      _loadingProducts = false;
      _loadingMore = false;
      _hasMore = false;
      _page = 1;
      _totalProducts = 0;
      _error = null;
    });
  }

  Future<void> _fetchCategoryProducts(String categoryId, {required bool reset}) async {
    final seq = ++_fetchSeq;
    if (reset) {
      if (mounted) {
        setState(() {
          _loadingProducts = true;
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
        categoryId: categoryId,
        page: targetPage,
        limit: 24,
      );
      if (!mounted || seq != _fetchSeq) return;

      final rawProducts = (res['products'] as List?) ?? [];
      final pagination = res['pagination'] is Map
          ? Map<String, dynamic>.from(res['pagination'] as Map)
          : <String, dynamic>{};

      final parsedProducts = rawProducts
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      setState(() {
        if (reset) {
          _products = parsedProducts;
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
        _totalProducts = (pagination['total'] as num?)?.toInt() ?? _products.length;
        _loadingProducts = false;
        _loadingMore = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted || seq != _fetchSeq) return;
      setState(() {
        _loadingProducts = false;
        _loadingMore = false;
        if (reset) {
          _error = e.toString().replaceFirst('Exception: ', '');
          _products = [];
        }
      });
    }
  }

  Future<List<Map<String, dynamic>>> _loadMoreForPager() async {
    final activeId = _activeCategoryId();
    if (activeId == null || !_hasMore) return _products;
    await _fetchCategoryProducts(activeId, reset: false);
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

  @override
  Widget build(BuildContext context) {
    final selectedL1 = _findById(_selectedL1Id);
    final l2Children = selectedL1 != null ? _childrenOf(_idOf(selectedL1)) : <Map<String, dynamic>>[];
    final selectedL2 = _findById(_selectedL2Id);
    final l3Children = selectedL2 != null ? _childrenOf(_idOf(selectedL2)) : <Map<String, dynamic>>[];
    final selectedL3 = _findById(_selectedL3Id);

    return Container(
      color: const Color(0xFFF6F7F9),
      child: Column(
        children: [
          // Top Header + Horizontal Level 2 & Level 3 Strips when a Root Category is selected
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
                      if (selectedL1 != null) ...[
                        Material(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(12),
                          child: InkWell(
                            onTap: _backToRoots,
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
                              selectedL1 != null
                                  ? (selectedL1['name_ar'] ?? 'القسم').toString()
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
                            if (selectedL1 != null && selectedL2 != null)
                              Text(
                                selectedL3 != null
                                    ? '${selectedL2['name_ar'] ?? ''} / ${selectedL3['name_ar'] ?? ''}'
                                    : (selectedL2['name_ar'] ?? '').toString(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: Color(0xFFA92224),
                                  fontWeight: FontWeight.w700,
                                ),
                              )
                            else
                              Row(
                                children: [
                                  const Icon(Icons.location_on_outlined, size: 13, color: Color(0xFFA92224)),
                                  const SizedBox(width: 3),
                                  Expanded(
                                    child: Text(
                                      'التوصيل إلى ${widget.zoneName.isNotEmpty ? widget.zoneName : 'المنزلة'}',
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

                // Horizontal Scrollable Strip 1 — Level 2 Subcategories (Text only, NO squares or icons)
                if (selectedL1 != null && l2Children.isNotEmpty)
                  SizedBox(
                    height: 46,
                    child: ListView.separated(
                      controller: _l2ScrollCtrl,
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
                      itemCount: l2Children.length + 1,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, idx) {
                        final isAll = idx == 0;
                        final item = isAll ? null : l2Children[idx - 1];
                        final itemId = item != null ? _idOf(item) : null;
                        final isActive = _selectedL2Id == itemId;
                        final label = isAll ? 'الكل' : (item?['name_ar'] ?? '').toString().trim();

                        return Material(
                          color: isActive ? const Color(0xFFA92224) : const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(10),
                          child: InkWell(
                            onTap: () => _selectL2(itemId),
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              alignment: Alignment.center,
                              padding: const EdgeInsets.symmetric(horizontal: 14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: isActive ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                                ),
                              ),
                              child: Text(
                                label,
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w800,
                                  color: isActive ? Colors.white : const Color(0xFF334155),
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),

                // Horizontal Scrollable Strip 2 — Level 3 Subcategories directly underneath Strip 1
                if (selectedL1 != null && selectedL2 != null && l3Children.isNotEmpty)
                  Container(
                    height: 44,
                    decoration: const BoxDecoration(
                      color: Color(0xFFF8FAFC),
                      border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                    ),
                    child: ListView.separated(
                      controller: _l3ScrollCtrl,
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      itemCount: l3Children.length + 1,
                      separatorBuilder: (_, __) => const SizedBox(width: 7),
                      itemBuilder: (_, idx) {
                        final isAll = idx == 0;
                        final item = isAll ? null : l3Children[idx - 1];
                        final itemId = item != null ? _idOf(item) : null;
                        final isActive = _selectedL3Id == itemId;
                        final label = isAll ? 'الكل' : (item?['name_ar'] ?? '').toString().trim();

                        return Material(
                          color: isActive ? const Color(0xFFFEF2F2) : Colors.white,
                          borderRadius: BorderRadius.circular(9),
                          child: InkWell(
                            onTap: () => _selectL3(itemId),
                            borderRadius: BorderRadius.circular(9),
                            child: Container(
                              alignment: Alignment.center,
                              padding: const EdgeInsets.symmetric(horizontal: 12),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(9),
                                border: Border.all(
                                  color: isActive ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                                  width: isActive ? 1.3 : 1.0,
                                ),
                              ),
                              child: Text(
                                label,
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: isActive ? const Color(0xFFA92224) : const Color(0xFF475569),
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),

          // Body: either Level 1 Root Square Cards OR Inline Products directly below the 2 strips
          Expanded(
            child: widget.categories.isEmpty
                ? _buildEmptyCategoriesState()
                : selectedL1 != null
                    ? _buildInlineProductsBody(
                        selectedL1: selectedL1,
                        activeCategory: selectedL3 ?? selectedL2 ?? selectedL1,
                      )
                    : _buildRootSquareGridView(),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyCategoriesState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 68,
              height: 68,
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.category_outlined, size: 34, color: Color(0xFFA92224)),
            ),
            const SizedBox(height: 12),
            const Text(
              'جاري تحميل الأقسام والتصنيفات...',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
            ),
            const SizedBox(height: 6),
            const Text(
              'ستظهر الأقسام الرئيسية والفرعية فور مزامنة المتجر',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInlineProductsBody({
    required Map<String, dynamic> selectedL1,
    required Map<String, dynamic> activeCategory,
  }) {
    final activeTitle = (activeCategory['name_ar'] ?? '').toString().trim();
    final l1Title = (selectedL1['name_ar'] ?? '').toString().trim();
    final activeId = _activeCategoryId();

    return RefreshIndicator(
      color: const Color(0xFFA92224),
      onRefresh: () async {
        if (activeId != null) {
          await _fetchCategoryProducts(activeId, reset: true);
        }
      },
      child: CustomScrollView(
        controller: _productsScrollCtrl,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Clean unboxed heading line for active category + count
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
                            activeTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                        ),
                        if (!_loadingProducts) ...[
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
                  if (_selectedL2Id != null || _selectedL3Id != null)
                    TextButton(
                      onPressed: () => _selectL2(null),
                      style: TextButton.styleFrom(
                        foregroundColor: const Color(0xFFA92224),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(
                        'كل $l1Title',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                      ),
                    ),
                ],
              ),
            ),
          ),

          if (_loadingProducts)
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
                    padding: const EdgeInsets.all(10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          flex: 6,
                          child: Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Container(height: 10, width: 70, color: const Color(0xFFF1F5F9)),
                        const SizedBox(height: 6),
                        Container(height: 12, width: double.infinity, color: const Color(0xFFF1F5F9)),
                        const SizedBox(height: 10),
                        Container(height: 14, width: 55, color: const Color(0xFFE2E8F0)),
                      ],
                    ),
                  ),
                  childCount: 6,
                ),
              ),
            )
          else if (_error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 20, 14, 24),
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    children: [
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF334155)),
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: () {
                          if (activeId != null) _fetchCategoryProducts(activeId, reset: true);
                        },
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
              ),
            )
          else if (_products.isEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 20, 14, 24),
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
                      Text(
                        'لا توجد منتجات متاحة حاليًا في «$activeTitle»',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'اختر قسمًا فرعيًا آخر من الشريط أعلاه أو تصفّح كل منتجات $l1Title',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                      ),
                      if (_selectedL2Id != null || _selectedL3Id != null) ...[
                        const SizedBox(height: 14),
                        ElevatedButton(
                          onPressed: () => _selectL2(null),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFA92224),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          child: Text(
                            'عرض كل منتجات $l1Title',
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
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
                              onPressed: () {
                                if (activeId != null) {
                                  _fetchCategoryProducts(activeId, reset: false);
                                }
                              },
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

  Widget _buildRootSquareGridView() {
    final roots = _rootCategories();
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final cat in roots) {
      final k = _resolveGroupKey(cat);
      grouped.putIfAbsent(k, () => []).add(cat);
    }

    final activeGroups = _groups.where((g) => (grouped[g.key] ?? []).isNotEmpty).toList();
    if (activeGroups.isEmpty) {
      return GridView.builder(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: 0.74,
        ),
        itemCount: roots.length,
        itemBuilder: (_, idx) => _buildRootSquareTile(roots[idx], accent: const Color(0xFFA92224)),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
      itemCount: activeGroups.length,
      separatorBuilder: (_, __) => const SizedBox(height: 18),
      itemBuilder: (_, idx) {
        final meta = activeGroups[idx];
        final cats = grouped[meta.key] ?? [];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    meta.title,
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                if (widget.onSelectGroup != null)
                  TextButton(
                    onPressed: () => widget.onSelectGroup!(meta.key),
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFFA92224),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('عرض الكل', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                        SizedBox(width: 2),
                        Icon(Icons.chevron_left_rounded, size: 16),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: 0.74,
              ),
              itemCount: cats.length,
              itemBuilder: (_, cIdx) => _buildRootSquareTile(
                cats[cIdx],
                accent: meta.accent,
                fallbackBg: meta.bg,
                fallbackIcon: meta.icon,
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildRootSquareTile(
    Map<String, dynamic> cat, {
    required Color accent,
    Color fallbackBg = const Color(0xFFFEF2F2),
    IconData fallbackIcon = Icons.category_rounded,
  }) {
    final name = (cat['name_ar'] ?? '').toString().trim();
    final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(cat['image_url']);

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _selectL1(cat),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
            boxShadow: const [
              BoxShadow(color: Color(0x080F172A), blurRadius: 8, offset: Offset(0, 2)),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Clean full-bleed square image with zero overlaid badge clutter
              AspectRatio(
                aspectRatio: 1.0,
                child: Container(
                  color: fallbackBg,
                  child: imgUrl.isNotEmpty
                      ? Image.network(
                          imgUrl,
                          fit: BoxFit.cover,
                          cacheWidth: 260,
                          errorBuilder: (_, __, ___) => Center(
                            child: Icon(fallbackIcon, size: 30, color: accent),
                          ),
                        )
                      : Center(
                          child: Icon(fallbackIcon, size: 30, color: accent),
                        ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                  child: Center(
                    child: Text(
                      name,
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                        height: 1.2,
                      ),
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
}
