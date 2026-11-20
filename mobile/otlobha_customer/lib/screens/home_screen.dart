import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class HomeScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final Map<String, Map<String, dynamic>> cartProductsCache;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final VoidCallback onOpenFreeOrderCart;
  final void Function(String serviceSubView) onOpenService;
  final VoidCallback onOpenOffers;
  final void Function(String orderId) onOpenOrderChat;
  final void Function(String tripId) onOpenTripChat;
  final Future<void> Function(Map<String, dynamic> target) onRateCaptain;

  const HomeScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    this.cartProductsCache = const {},
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onOpenFreeOrderCart,
    required this.onOpenService,
    required this.onOpenOffers,
    required this.onOpenOrderChat,
    required this.onOpenTripChat,
    required this.onRateCaptain,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const int _pageSize = 30;

  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;

  String _searchQuery = '';
  String _selectedCatId = 'all';
  String? _flashingServiceKey;

  List<Map<String, dynamic>> _remoteProducts = [];
  int _remotePage = 1;
  int _remoteTotal = 0;
  bool _remoteHasMore = false;
  bool _loadingRemote = false;
  bool _loadingMore = false;
  bool _usingRemote = false;
  int _requestSeq = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _seedInitialProducts();
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_usingRemote && oldWidget.bootstrap != widget.bootstrap) {
      _seedInitialProducts();
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _seedInitialProducts() {
    final initial = ((widget.bootstrap['products'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final totalCount = (widget.bootstrap['products_total_count'] as num?)?.toInt() ?? initial.length;
    _remoteProducts = initial;
    _remoteTotal = totalCount;
    _remotePage = 1;
    _remoteHasMore = totalCount > initial.length;
  }

  void _onScroll() {
    if (!_remoteHasMore || _loadingMore || _loadingRemote) return;
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    if (pos.pixels >= pos.maxScrollExtent - 360) {
      _loadNextPage();
    }
  }

  void _onSearchChanged(String value) {
    setState(() => _searchQuery = value);
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      _fetchProducts(reset: true);
    });
  }

  void _onCategorySelected(String catId) {
    if (_selectedCatId == catId) return;
    setState(() => _selectedCatId = catId);
    _fetchProducts(reset: true);
  }

  Future<void> _fetchProducts({required bool reset}) async {
    final trimmed = _searchQuery.trim();
    if (reset && trimmed.isEmpty && _selectedCatId == 'all') {
      setState(() {
        _usingRemote = false;
        _loadingRemote = false;
        _loadingMore = false;
        _seedInitialProducts();
      });
      return;
    }

    final seq = ++_requestSeq;
    final targetPage = reset ? 1 : _remotePage + 1;
    setState(() {
      _usingRemote = true;
      if (reset) {
        _loadingRemote = true;
      } else {
        _loadingMore = true;
      }
    });

    try {
      final res = await widget.api.getProductsPaginated(
        categoryId: _selectedCatId == 'all' ? null : _selectedCatId,
        query: trimmed.isEmpty ? null : trimmed,
        page: targetPage,
        limit: _pageSize,
      );
      if (!mounted || seq != _requestSeq) return;
      final items = ((res['items'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      setState(() {
        if (reset) {
          _remoteProducts = items;
        } else {
          final seen = _remoteProducts.map((e) => e['id']?.toString()).toSet();
          for (final item in items) {
            if (seen.add(item['id']?.toString())) {
              _remoteProducts.add(item);
            }
          }
        }
        _remotePage = (res['page'] as num?)?.toInt() ?? targetPage;
        _remoteTotal = (res['total'] as num?)?.toInt() ?? _remoteProducts.length;
        _remoteHasMore = res['has_more'] == true;
        _loadingRemote = false;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted || seq != _requestSeq) return;
      setState(() {
        _loadingRemote = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _loadNextPage() async {
    if (!_usingRemote) {
      // Transition from bootstrap initial slice into server pagination starting at page 2
      final loadedPages = (_remoteProducts.length / _pageSize).floor();
      _remotePage = loadedPages < 1 ? 1 : loadedPages;
      _usingRemote = true;
    }
    await _fetchProducts(reset: false);
  }

  void _triggerServiceTap(String key, VoidCallback action) {
    setState(() => _flashingServiceKey = key);
    Future.delayed(const Duration(milliseconds: 230), () {
      if (!mounted) return;
      setState(() => _flashingServiceKey = null);
      action();
    });
  }

  String _resolveImageUrl(dynamic raw) {
    final str = (raw ?? '').toString().trim();
    if (str.isEmpty) return '';
    if (str.startsWith('http://') || str.startsWith('https://')) return str;
    if (str.startsWith('/')) return '${OtlobhaCustomerApi.normalizeBaseUrl(OtlobhaCustomerApi.baseUrl)}$str';
    return str;
  }

  @override
  Widget build(BuildContext context) {
    final services = (widget.bootstrap['services'] as List?) ?? [];
    final serviceMap = {for (var s in services) s['service_key']: s};
    final categories = ((widget.bootstrap['categories'] as List?) ?? [])
        .where((c) => c['scope'] != 'market')
        .toList();
    final bootstrapProducts = (widget.bootstrap['products'] as List?) ?? [];
    final pendingRatings = (widget.bootstrap['pending_ratings'] as List?) ?? [];

    // O(cart.length) cart summary using cartProductsCache + bootstrap fallback
    int totalQty = 0;
    double totalEgp = 0;
    if (widget.cart.isNotEmpty) {
      Map<String, Map<String, dynamic>>? fallbackIndex;
      for (final entry in widget.cart.entries) {
        final q = entry.value;
        if (q <= 0) continue;
        Map<String, dynamic>? prod = widget.cartProductsCache[entry.key];
        if (prod == null) {
          fallbackIndex ??= {
            for (final p in bootstrapProducts)
              if (p is Map && p['id'] != null) p['id'].toString(): Map<String, dynamic>.from(p),
          };
          prod = fallbackIndex[entry.key];
        }
        totalQty += q;
        if (prod != null) {
          totalEgp += ((prod['sale_price'] ?? prod['base_price'] ?? 0) as num).toDouble() * q;
        }
      }
    }

    final displayProducts = _remoteProducts;

    final tiles = [
      {'key': 'stores', 'title': 'المتاجر والمطاعم', 'sub': 'stores', 'icon': Icons.storefront, 'color': const Color(0xFFEA580C)},
      {'key': 'pharmacy', 'title': 'الصيدلية', 'sub': 'pharmacy', 'icon': Icons.medication, 'color': const Color(0xFF0D9488)},
      {'key': 'parcels', 'title': 'أي حاجة', 'sub': 'rides_parcels', 'icon': Icons.inventory_2, 'color': const Color(0xFF0F172A)},
      {'key': 'rides', 'title': 'اطلبها مشوار', 'sub': 'rides_parcels', 'icon': Icons.directions_car, 'color': const Color(0xFFD97706)},
      {'key': 'market', 'title': 'سوق اطلبها', 'sub': 'market', 'icon': Icons.shopping_bag, 'color': const Color(0xFF4F46E5)},
      {'key': 'free', 'title': 'طلب نصي حر', 'sub': 'free', 'icon': Icons.edit_note, 'color': const Color(0xFFE11D48)},
    ];

    return Column(
      children: [
        Expanded(
          child: CustomScrollView(
            controller: _scrollController,
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    TextField(
                      controller: _searchController,
                      onChanged: _onSearchChanged,
                      decoration: InputDecoration(
                        hintText: 'ابحث عن منتج، وجبة، دواء، أو متجر في المنزلة...',
                        prefixIcon: const Icon(Icons.search),
                        suffixIcon: _searchQuery.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.close, size: 18),
                                onPressed: () {
                                  _searchController.clear();
                                  _onSearchChanged('');
                                },
                              )
                            : null,
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        contentPadding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                    const SizedBox(height: 12),

                    if (pendingRatings.isNotEmpty) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFFDE68A)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.star, size: 17, color: Color(0xFFD97706)),
                                SizedBox(width: 6),
                                Text('قيّم الطيار بعد العملية ⭐', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFFB45309))),
                              ],
                            ),
                            const SizedBox(height: 8),
                            ...pendingRatings.take(2).map((pr) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          '${pr['ref_number']} · الطيار: ${pr['captain_name']}',
                                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      ElevatedButton.icon(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFFD97706),
                                          foregroundColor: Colors.white,
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                        ),
                                        onPressed: () => widget.onRateCaptain({
                                          'rating_id': pr['id'],
                                          'captain_id': pr['captain_id'],
                                          'captain_name': pr['captain_name'],
                                          'ref_type': pr['ref_type'],
                                          'ref_id': pr['ref_id'],
                                          'ref_number': pr['ref_number'],
                                          'final_amount': pr['final_amount'],
                                        }),
                                        icon: const Icon(Icons.star, size: 15),
                                        label: const Text('قيّم الآن', style: TextStyle(fontSize: 11)),
                                      ),
                                    ],
                                  ),
                                )),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('الخدمات السريعة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        TextButton(
                          onPressed: () => widget.onOpenService('hub'),
                          child: const Text('كل الخدمات', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      height: 110,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        physics: const BouncingScrollPhysics(),
                        itemCount: tiles.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 12),
                        itemBuilder: (_, i) {
                          final t = tiles[i];
                          final key = t['key'] as String;
                          final cfg = serviceMap[key];
                          final enabled = key == 'rides' ? true : (cfg == null ? true : (cfg['is_enabled'] == true));
                          final color = t['color'] as Color;
                          final isFlashing = _flashingServiceKey == key;

                          return GestureDetector(
                            onTap: () => _triggerServiceTap(key, () {
                              if (t['sub'] == 'free') {
                                widget.onOpenFreeOrderCart();
                              } else {
                                widget.onOpenService(t['sub'] as String);
                              }
                            }),
                            child: SizedBox(
                              width: 82,
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  AnimatedScale(
                                    scale: isFlashing ? 1.12 : 1.0,
                                    duration: const Duration(milliseconds: 180),
                                    curve: Curves.easeOutBack,
                                    child: AnimatedContainer(
                                      duration: const Duration(milliseconds: 180),
                                      width: 64,
                                      height: 64,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: enabled ? color : Colors.grey,
                                        border: Border.all(
                                          color: isFlashing ? const Color(0xFFF5A623) : Colors.white,
                                          width: isFlashing ? 3 : 2,
                                        ),
                                        boxShadow: [
                                          BoxShadow(
                                            color: isFlashing ? const Color(0x99F5A623) : color.withOpacity(0.28),
                                            blurRadius: isFlashing ? 16 : 8,
                                            spreadRadius: isFlashing ? 3 : 0,
                                            offset: const Offset(0, 3),
                                          ),
                                        ],
                                      ),
                                      child: Stack(
                                        alignment: Alignment.center,
                                        children: [
                                          Icon(t['icon'] as IconData, color: Colors.white, size: 28),
                                          AnimatedOpacity(
                                            opacity: isFlashing ? 0.45 : 0.0,
                                            duration: const Duration(milliseconds: 140),
                                            child: Container(
                                              decoration: const BoxDecoration(
                                                shape: BoxShape.circle,
                                                color: Colors.white,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    t['title'] as String,
                                    textAlign: TextAlign.center,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11.5, height: 1.2),
                                  ),
                                  if (!enabled)
                                    const Text('موقوفة', style: TextStyle(fontSize: 9.5, color: Colors.red)),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 14),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            _remoteTotal > 0
                                ? 'المنتجات المتوفرة ($_remoteTotal)'
                                : 'المنتجات المتوفرة للطلب الفوري',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        TextButton(
                          onPressed: widget.onOpenOffers,
                          child: const Text('العروض', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFE11D48))),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      height: 38,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(left: 8),
                            child: ChoiceChip(
                              label: const Text('الكل'),
                              selected: _selectedCatId == 'all',
                              onSelected: (_) => _onCategorySelected('all'),
                            ),
                          ),
                          ...categories.map((c) => Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: ChoiceChip(
                                  label: Text(c['name_ar']?.toString() ?? ''),
                                  selected: _selectedCatId == c['id'],
                                  onSelected: (_) => _onCategorySelected(c['id'].toString()),
                                ),
                              )),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ]),
                ),
              ),

              if (_loadingRemote)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 36),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                )
              else if (displayProducts.isEmpty)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 36, horizontal: 16),
                    child: Center(
                      child: Text(
                        'لا توجد منتجات مطابقة لبحثك حالياً',
                        style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                  sliver: SliverGrid(
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 10,
                      childAspectRatio: 0.78,
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (_, i) {
                        final p = displayProducts[i];
                        final qty = widget.cart[p['id']] ?? 0;
                        final finalPrice = p['sale_price'] ?? p['base_price'];
                        final requiresRx = p['requires_prescription'] == true;
                        final imgUrl = _resolveImageUrl(p['image_url']);
                        final hasDiscount = p['sale_price'] != null &&
                            p['base_price'] != null &&
                            (p['sale_price'] as num) < (p['base_price'] as num);
                        return GestureDetector(
                          onTap: () => _openProductDetailSheet(p),
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: const [
                                BoxShadow(color: Color(0x0A000000), blurRadius: 8, offset: Offset(0, 2)),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                ClipRRect(
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
                                  child: Stack(
                                    children: [
                                      Container(
                                        height: 86,
                                        width: double.infinity,
                                        color: const Color(0xFFF6F7F9),
                                        child: imgUrl.isNotEmpty
                                            ? Image.network(
                                                imgUrl,
                                                fit: BoxFit.cover,
                                                cacheWidth: 260,
                                                errorBuilder: (_, __, ___) => Center(
                                                  child: Icon(
                                                    requiresRx ? Icons.medication : Icons.shopping_basket_outlined,
                                                    size: 32,
                                                    color: requiresRx ? const Color(0xFFA92224) : const Color(0xFFF5A623),
                                                  ),
                                                ),
                                              )
                                            : Center(
                                                child: Icon(
                                                  requiresRx ? Icons.medication : Icons.shopping_basket_outlined,
                                                  size: 32,
                                                  color: requiresRx ? const Color(0xFFA92224) : const Color(0xFFF5A623),
                                                ),
                                              ),
                                      ),
                                      if (hasDiscount)
                                        Positioned(
                                          top: 6,
                                          right: 6,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFA92224),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: const Text(
                                              'عرض',
                                              style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.all(10),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              p['merchant_name']?.toString() ?? '',
                                              style: const TextStyle(fontSize: 10, color: Color(0xFFA92224), fontWeight: FontWeight.w700),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              p['name_ar']?.toString() ?? '',
                                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                            if ((p['size_label'] ?? '').toString().isNotEmpty)
                                              Text(
                                                p['size_label'].toString(),
                                                style: const TextStyle(fontSize: 10, color: Color(0xFF64748B)),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                          ],
                                        ),
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  '$finalPrice ج.م',
                                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: Color(0xFFA92224)),
                                                ),
                                                if (hasDiscount)
                                                  Text(
                                                    '${p['base_price']} ج.م',
                                                    style: const TextStyle(
                                                      fontSize: 10,
                                                      color: Color(0xFF94A3B8),
                                                      decoration: TextDecoration.lineThrough,
                                                    ),
                                                  ),
                                              ],
                                            ),
                                            if (requiresRx)
                                              InkWell(
                                                onTap: () => widget.onOpenService('pharmacy'),
                                                child: Container(
                                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                                                  decoration: BoxDecoration(color: const Color(0xFFA92224), borderRadius: BorderRadius.circular(8)),
                                                  child: const Text('روشتة', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                                                ),
                                              )
                                            else if (qty == 0)
                                              InkWell(
                                                onTap: () => widget.onAddProduct(p, 1),
                                                child: Container(
                                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                                  decoration: BoxDecoration(color: const Color(0xFFA92224), borderRadius: BorderRadius.circular(10)),
                                                  child: const Text('+ أضف', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                                                ),
                                              )
                                            else
                                              Row(
                                                children: [
                                                  InkWell(
                                                    onTap: () => widget.onAddProduct(p, -1),
                                                    child: const Icon(Icons.remove_circle_outline, size: 20, color: Color(0xFFA92224)),
                                                  ),
                                                  Padding(
                                                    padding: const EdgeInsets.symmetric(horizontal: 4),
                                                    child: Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                                  ),
                                                  InkWell(
                                                    onTap: () => widget.onAddProduct(p, 1),
                                                    child: const Icon(Icons.add_circle, size: 20, color: Color(0xFFA92224)),
                                                  ),
                                                ],
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                      childCount: displayProducts.length,
                    ),
                  ),
                ),

              if (_loadingMore)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 20),
                    child: Center(child: CircularProgressIndicator(strokeWidth: 2.2)),
                  ),
                )
              else if (_remoteHasMore && !_loadingRemote)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 20),
                    child: OutlinedButton(
                      onPressed: _loadNextPage,
                      child: const Text('تحميل المزيد من المنتجات'),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (totalQty > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: const Color(0xFF0F172A),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('$totalQty منتجات · ${totalEgp.toStringAsFixed(0)} ج.م', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA92224), foregroundColor: Colors.white),
                  onPressed: widget.onOpenCart,
                  child: const Text('مراجعة السلة'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _openProductDetailSheet(Map<String, dynamic> initialProduct) async {
    final prodId = initialProduct['id']?.toString() ?? '';
    if (prodId.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: DraggableScrollableSheet(
            initialChildSize: 0.78,
            minChildSize: 0.5,
            maxChildSize: 0.94,
            expand: false,
            builder: (_, scrollCtrl) {
              return FutureBuilder<Map<String, dynamic>>(
                future: widget.api.getStorefrontProductDetails(prodId),
                builder: (_, snap) {
                  final data = snap.data;
                  final product = (data?['product'] is Map)
                      ? Map<String, dynamic>.from(data!['product'] as Map)
                      : initialProduct;
                  final comparison = (data?['comparison'] is Map)
                      ? Map<String, dynamic>.from(data!['comparison'] as Map)
                      : <String, dynamic>{};
                  final stores = ((comparison['stores'] as List?) ?? [])
                      .whereType<Map>()
                      .map((e) => Map<String, dynamic>.from(e))
                      .toList();
                  final deals = ((data?['deals'] as List?) ?? [])
                      .whereType<Map>()
                      .map((e) => Map<String, dynamic>.from(e))
                      .toList();
                  final imgUrl = _resolveImageUrl(product['image_url']);
                  final effectivePrice = product['effective_price'] ?? product['sale_price'] ?? product['base_price'] ?? 0;

                  return ListView(
                    controller: scrollCtrl,
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                    children: [
                      Center(
                        child: Container(
                          width: 44,
                          height: 4,
                          margin: const EdgeInsets.only(bottom: 12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFCBD5E1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: Container(
                          height: 190,
                          color: const Color(0xFFF6F7F9),
                          child: imgUrl.isNotEmpty
                              ? Image.network(imgUrl, fit: BoxFit.contain)
                              : const Center(
                                  child: Icon(Icons.shopping_bag_outlined, size: 54, color: Color(0xFFA92224)),
                                ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      if ((product['brand'] ?? '').toString().isNotEmpty)
                        Text(
                          product['brand'].toString(),
                          style: const TextStyle(color: Color(0xFFA92224), fontWeight: FontWeight.w700, fontSize: 12),
                        ),
                      Text(
                        product['name_ar']?.toString() ?? '',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Text(
                            '$effectivePrice ج.م',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFA92224)),
                          ),
                          const SizedBox(width: 8),
                          if ((product['size_label'] ?? '').toString().isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                product['size_label'].toString(),
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      if (snap.connectionState == ConnectionState.waiting)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 16),
                          child: Center(child: CircularProgressIndicator(color: Color(0xFFA92224))),
                        ),
                      if (stores.isNotEmpty) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFFBEB),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: const Color(0xFFF5A623)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'مقارنة السعر بين المتاجر (${stores.length})',
                                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Color(0xFF0F172A)),
                                  ),
                                  if ((comparison['savings_vs_highest'] as num? ?? 0) > 0)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFA92224),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Text(
                                        'وفّر ${comparison['savings_vs_highest']} ج.م',
                                        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              ...stores.map((s) {
                                final isLowest = s['is_lowest'] == true;
                                return Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: isLowest ? const Color(0xFFA92224) : const Color(0xFFE2E8F0),
                                      width: isLowest ? 1.5 : 1,
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              s['merchant_name']?.toString() ?? '',
                                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                            ),
                                            if (isLowest)
                                              const Text(
                                                'أقل سعر متاح ✓',
                                                style: TextStyle(fontSize: 11, color: Color(0xFFA92224), fontWeight: FontWeight.w700),
                                              ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        '${s['effective_price']} ج.م',
                                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFFA92224)),
                                      ),
                                      const SizedBox(width: 8),
                                      ElevatedButton(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFFA92224),
                                          foregroundColor: Colors.white,
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                          minimumSize: Size.zero,
                                        ),
                                        onPressed: () {
                                          widget.onAddProduct({
                                            'id': s['product_id'],
                                            'merchant_id': s['merchant_id'],
                                            'merchant_name': s['merchant_name'],
                                            'name_ar': product['name_ar'],
                                            'base_price': s['base_price'],
                                            'sale_price': s['sale_price'],
                                            'image_url': s['image_url'] ?? product['image_url'],
                                          }, 1);
                                          Navigator.pop(ctx);
                                        },
                                        child: const Text('+ أضف', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (deals.isNotEmpty) ...[
                        const Text(
                          'عروض التوفير والهدايا',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                        ),
                        const SizedBox(height: 6),
                        ...deals.map((d) => Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF2F2),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFFFECACA)),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.card_giftcard, color: Color(0xFFA92224), size: 20),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      d['title_ar']?.toString() ?? '',
                                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5, color: Color(0xFF7F1D1D)),
                                    ),
                                  ),
                                ],
                              ),
                            )),
                        const SizedBox(height: 12),
                      ],
                      if ((product['description'] ?? '').toString().isNotEmpty) ...[
                        const Text('وصف المنتج', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 4),
                        Text(
                          product['description'].toString(),
                          style: const TextStyle(fontSize: 13, color: Color(0xFF475569), height: 1.5),
                        ),
                        const SizedBox(height: 16),
                      ],
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFA92224),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          onPressed: () {
                            widget.onAddProduct(initialProduct, 1);
                            Navigator.pop(ctx);
                          },
                          icon: const Icon(Icons.add_shopping_cart),
                          label: Text(
                            'أضف إلى السلة · $effectivePrice ج.م',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                        ),
                      ),
                    ],
                  );
                },
              );
            },
          ),
        );
      },
    );
  }
}
