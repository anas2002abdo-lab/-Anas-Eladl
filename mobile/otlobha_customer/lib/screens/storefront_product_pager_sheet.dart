import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';

class _ProductCardSavedState {
  int qty;
  String selectedStoreProductId;
  String activeImage;
  String selectedGiftId;
  Set<String> bundleSelectedIds;

  _ProductCardSavedState({
    this.qty = 1,
    this.selectedStoreProductId = '',
    this.activeImage = '',
    this.selectedGiftId = '',
    Set<String>? bundleSelectedIds,
  }) : bundleSelectedIds = bundleSelectedIds ?? <String>{};
}

/// Opens the native Horizontal Swipe Product Navigation modal pager (PageView with peeking adjacent cards)
/// over a dimmed backdrop, preserving the caller's exact scroll position when dismissed.
Future<void> showStorefrontProductPager({
  required BuildContext context,
  required OtlobhaCustomerApi api,
  required List<Map<String, dynamic>> products,
  required int initialIndex,
  required int Function() getCartCount,
  required void Function(Map<String, dynamic> product, int quantity) onAddToCart,
  required VoidCallback onOpenCart,
  required void Function(String brand) onSelectBrand,
  required void Function(String merchantId, String merchantName) onSelectStore,
  Future<List<Map<String, dynamic>>> Function()? onLoadMore,
}) async {
  if (products.isEmpty) return;
  final safeInitial = initialIndex.clamp(0, products.length - 1);

  await showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'إغلاق تفاصيل المنتج',
    barrierColor: const Color(0x990F172A),
    transitionDuration: const Duration(milliseconds: 240),
    pageBuilder: (dialogCtx, _, __) {
      return _StorefrontProductPagerOverlay(
        api: api,
        initialProducts: List<Map<String, dynamic>>.from(products),
        initialIndex: safeInitial,
        getCartCount: getCartCount,
        onAddToCart: onAddToCart,
        onOpenCart: onOpenCart,
        onSelectBrand: onSelectBrand,
        onSelectStore: onSelectStore,
        onLoadMore: onLoadMore,
      );
    },
    transitionBuilder: (ctx, anim, __, child) {
      final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutCubic);
      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.06),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}

class _StorefrontProductPagerOverlay extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final List<Map<String, dynamic>> initialProducts;
  final int initialIndex;
  final int Function() getCartCount;
  final void Function(Map<String, dynamic> product, int quantity) onAddToCart;
  final VoidCallback onOpenCart;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectStore;
  final Future<List<Map<String, dynamic>>> Function()? onLoadMore;

  const _StorefrontProductPagerOverlay({
    required this.api,
    required this.initialProducts,
    required this.initialIndex,
    required this.getCartCount,
    required this.onAddToCart,
    required this.onOpenCart,
    required this.onSelectBrand,
    required this.onSelectStore,
    this.onLoadMore,
  });

  @override
  State<_StorefrontProductPagerOverlay> createState() => _StorefrontProductPagerOverlayState();
}

class _StorefrontProductPagerOverlayState extends State<_StorefrontProductPagerOverlay> {
  static const String _favPrefKey = 'otlobha_favorite_products_v1';
  static final Map<String, Map<String, dynamic>> _sessionDetailsCache = {};

  late final PageController _pageController;
  late List<Map<String, dynamic>> _products;
  late int _currentIndex;

  final Map<String, Map<String, dynamic>> _detailsMap = {};
  final Set<String> _loadingIds = {};
  final Map<String, String?> _errorMap = {};
  final Map<String, _ProductCardSavedState> _savedStates = {};
  Set<String> _favorites = {};
  bool _loadingMore = false;
  int _liveCartCount = 0;

  @override
  void initState() {
    super.initState();
    _products = List<Map<String, dynamic>>.from(widget.initialProducts);
    _currentIndex = widget.initialIndex.clamp(0, _products.length - 1);
    _liveCartCount = widget.getCartCount();
    _pageController = PageController(
      initialPage: _currentIndex,
      viewportFraction: 0.87,
    );
    _loadFavorites();
    _prefetchWindow(_currentIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _loadFavorites() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_favPrefKey);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is List && mounted) {
          setState(() {
            _favorites = decoded.map((e) => e.toString()).toSet();
          });
        }
      }
    } catch (_) {}
  }

  Future<void> _toggleFavorite(String productId) async {
    final existed = _favorites.contains(productId);
    setState(() {
      if (existed) {
        _favorites.remove(productId);
      } else {
        _favorites.add(productId);
      }
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_favPrefKey, jsonEncode(_favorites.toList()));
    } catch (_) {}
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(milliseconds: 1400),
        content: Text(existed ? 'تمت إزالة المنتج من المفضلة' : 'تمت إضافة المنتج إلى المفضلة ❤️'),
      ),
    );
  }

  void _prefetchWindow(int index) {
    final indices = [index, index + 1, index - 1];
    for (final idx in indices) {
      if (idx >= 0 && idx < _products.length) {
        final id = _products[idx]['id']?.toString() ?? '';
        if (id.isNotEmpty) {
          _fetchDetails(id);
        }
      }
    }

    if (widget.onLoadMore != null && !_loadingMore && index >= _products.length - 3) {
      _triggerLoadMore();
    }
  }

  Future<void> _triggerLoadMore() async {
    if (_loadingMore || widget.onLoadMore == null) return;
    _loadingMore = true;
    try {
      final more = await widget.onLoadMore!();
      if (!mounted || more.isEmpty) return;
      final existingIds = _products.map((e) => e['id']?.toString()).toSet();
      final additions = more.where((m) => existingIds.add(m['id']?.toString())).toList();
      if (additions.isNotEmpty) {
        setState(() {
          _products.addAll(additions);
        });
      }
    } catch (_) {
    } finally {
      _loadingMore = false;
    }
  }

  Future<void> _fetchDetails(String productId) async {
    if (_sessionDetailsCache.containsKey(productId)) {
      if (!_detailsMap.containsKey(productId) && mounted) {
        setState(() {
          _detailsMap[productId] = _sessionDetailsCache[productId]!;
        });
      }
      return;
    }
    if (_loadingIds.contains(productId)) return;

    _loadingIds.add(productId);
    if (mounted) {
      setState(() {
        _errorMap.remove(productId);
      });
    }
    try {
      final data = await widget.api.getStorefrontProductDetails(productId);
      _sessionDetailsCache[productId] = data;
      if (mounted) {
        setState(() {
          _detailsMap[productId] = data;
          _loadingIds.remove(productId);
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadingIds.remove(productId);
          _errorMap[productId] = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  void _jumpOrAppendProduct(Map<String, dynamic> targetProduct) {
    final targetId = targetProduct['id']?.toString() ?? '';
    if (targetId.isEmpty) return;
    final existingIdx = _products.indexWhere((p) => p['id']?.toString() == targetId);
    if (existingIdx >= 0) {
      _pageController.animateToPage(
        existingIdx,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
      return;
    }
    final insertIdx = (_currentIndex + 1).clamp(0, _products.length);
    setState(() {
      _products.insert(insertIdx, Map<String, dynamic>.from(targetProduct));
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_pageController.hasClients) {
        _pageController.animateToPage(
          insertIdx,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutCubic,
        );
      }
    });
  }

  void _openZoomLightbox(String imageUrl, String title) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black87,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: Stack(
            children: [
              GestureDetector(
                onTap: () => Navigator.of(ctx).pop(),
                child: Container(color: Colors.transparent),
              ),
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: InteractiveViewer(
                    minScale: 1,
                    maxScale: 4,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        color: Colors.white,
                        padding: const EdgeInsets.all(14),
                        child: Image.network(imageUrl, fit: BoxFit.contain),
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 44,
                left: 16,
                child: IconButton(
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white24,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => Navigator.of(ctx).pop(),
                  icon: const Icon(Icons.close, size: 26),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = _products.length;
    const maxDots = 7;
    final halfDots = maxDots ~/ 2;
    int dotStart = (_currentIndex - halfDots).clamp(0, total > 0 ? total - 1 : 0);
    final dotEnd = (dotStart + maxDots - 1).clamp(0, total > 0 ? total - 1 : 0);
    dotStart = (dotEnd - maxDots + 1).clamp(0, total > 0 ? total - 1 : 0);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Material(
        type: MaterialType.transparency,
        child: SafeArea(
          child: Column(
            children: [
              // Compact Top Pager Position & Swipe Cue Bar
              if (total > 1)
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 8, 22, 8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                      color: const Color(0x990F172A),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: Colors.white24),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${_currentIndex + 1} / $total',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (int d = dotStart; d <= dotEnd; d++)
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                margin: const EdgeInsets.symmetric(horizontal: 2.5),
                                height: 6,
                                width: d == _currentIndex ? 18 : 6,
                                decoration: BoxDecoration(
                                  color: d == _currentIndex
                                      ? const Color(0xFFF5A623)
                                      : Colors.white38,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                              ),
                          ],
                        ),
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.chevron_right, size: 14, color: Color(0xFFF5A623)),
                            Text(
                              'اسحب للتنقل',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Icon(Icons.chevron_left, size: 14, color: Color(0xFFF5A623)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

              // Native Horizontal Swipe PageView with Peeking Adjacent Rounded Cards
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: PageView.builder(
                    controller: _pageController,
                    physics: const BouncingScrollPhysics(),
                    itemCount: total,
                    onPageChanged: (idx) {
                      setState(() => _currentIndex = idx);
                      _prefetchWindow(idx);
                    },
                    itemBuilder: (ctx, index) {
                      final preview = _products[index];
                      final pid = preview['id']?.toString() ?? '';
                      final details = _detailsMap[pid] ?? _sessionDetailsCache[pid];
                      final isLoading = _loadingIds.contains(pid);
                      final error = _errorMap[pid];
                      final saved = _savedStates.putIfAbsent(
                        pid,
                        () => _ProductCardSavedState(
                          activeImage: OtlobhaCustomerApi.resolveMediaUrl(preview['image_url']),
                        ),
                      );

                      return AnimatedBuilder(
                        animation: _pageController,
                        builder: (context, child) {
                          double dist = (index - _currentIndex).abs().toDouble();
                          if (_pageController.hasClients &&
                              _pageController.position.hasContentDimensions) {
                            final currentPage = _pageController.page ?? _currentIndex.toDouble();
                            dist = (index - currentPage).abs().clamp(0.0, 1.5);
                          }
                          final scale = 1.0 - (dist.clamp(0.0, 1.0) * 0.055);
                          final opacity = 1.0 - (dist.clamp(0.0, 1.0) * 0.14);

                          return Transform.scale(
                            scale: scale,
                            child: Opacity(
                              opacity: opacity,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 6),
                                child: child,
                              ),
                            ),
                          );
                        },
                        child: _ProductDetailPageCard(
                          key: ValueKey('pager_card_$pid'),
                          api: widget.api,
                          productId: pid,
                          preview: preview,
                          details: details,
                          isLoading: isLoading,
                          error: error,
                          isActive: index == _currentIndex,
                          isFavorite: _favorites.contains(pid),
                          cartCount: _liveCartCount,
                          savedState: saved,
                          onSelectPeekingCard: () {
                            _pageController.animateToPage(
                              index,
                              duration: const Duration(milliseconds: 280),
                              curve: Curves.easeOutCubic,
                            );
                          },
                          onClose: () => Navigator.of(context).pop(),
                          onOpenCart: () {
                            Navigator.of(context).pop();
                            widget.onOpenCart();
                          },
                          onToggleFavorite: () => _toggleFavorite(pid),
                          onZoomImage: _openZoomLightbox,
                          onOpenRelatedProduct: _jumpOrAppendProduct,
                          onSelectBrand: (brand) {
                            Navigator.of(context).pop();
                            widget.onSelectBrand(brand);
                          },
                          onSelectStore: (merchantId, merchantName) {
                            Navigator.of(context).pop();
                            widget.onSelectStore(merchantId, merchantName);
                          },
                          onAddToCart: (productPayload, quantity) {
                            widget.onAddToCart(productPayload, quantity);
                            setState(() {
                              _liveCartCount = widget.getCartCount();
                            });
                          },
                        ),
                      );
                    },
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

class _ProductDetailPageCard extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String productId;
  final Map<String, dynamic> preview;
  final Map<String, dynamic>? details;
  final bool isLoading;
  final String? error;
  final bool isActive;
  final bool isFavorite;
  final int cartCount;
  final _ProductCardSavedState savedState;
  final VoidCallback onSelectPeekingCard;
  final VoidCallback onClose;
  final VoidCallback onOpenCart;
  final VoidCallback onToggleFavorite;
  final void Function(String imageUrl, String title) onZoomImage;
  final void Function(Map<String, dynamic> product) onOpenRelatedProduct;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectStore;
  final void Function(Map<String, dynamic> product, int quantity) onAddToCart;

  const _ProductDetailPageCard({
    super.key,
    required this.api,
    required this.productId,
    required this.preview,
    required this.details,
    required this.isLoading,
    required this.error,
    required this.isActive,
    required this.isFavorite,
    required this.cartCount,
    required this.savedState,
    required this.onSelectPeekingCard,
    required this.onClose,
    required this.onOpenCart,
    required this.onToggleFavorite,
    required this.onZoomImage,
    required this.onOpenRelatedProduct,
    required this.onSelectBrand,
    required this.onSelectStore,
    required this.onAddToCart,
  });

  @override
  State<_ProductDetailPageCard> createState() => _ProductDetailPageCardState();
}

class _ProductDetailPageCardState extends State<_ProductDetailPageCard> {
  bool _justAdded = false;
  bool _hydratedDefaults = false;

  @override
  void initState() {
    super.initState();
    _syncDefaultsFromDetails();
  }

  @override
  void didUpdateWidget(covariant _ProductDetailPageCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.details != widget.details) {
      _syncDefaultsFromDetails();
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

  List<Map<String, dynamic>> _extractList(dynamic raw) {
    if (raw is! List) return const [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  void _syncDefaultsFromDetails() {
    final details = widget.details;
    if (details == null || _hydratedDefaults) return;
    _hydratedDefaults = true;

    final prod = details['product'] is Map
        ? Map<String, dynamic>.from(details['product'] as Map)
        : widget.preview;
    final comp = details['comparison'] is Map
        ? Map<String, dynamic>.from(details['comparison'] as Map)
        : <String, dynamic>{};
    final availStores = _extractList(comp['available_stores']);
    final deals = _extractList(details['deals']);

    if (widget.savedState.activeImage.isEmpty) {
      final firstImg = OtlobhaCustomerApi.resolveMediaUrl(prod['image_url']);
      if (firstImg.isNotEmpty) {
        widget.savedState.activeImage = firstImg;
      }
    }
    if (widget.savedState.selectedStoreProductId.isEmpty && availStores.isNotEmpty) {
      widget.savedState.selectedStoreProductId = availStores.first['product_id']?.toString() ?? '';
    }
    if (widget.savedState.selectedGiftId.isEmpty) {
      for (final d in deals) {
        final gifts = _extractList(d['gift_products']);
        if (gifts.isNotEmpty) {
          widget.savedState.selectedGiftId = gifts.first['id']?.toString() ?? '';
          break;
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final details = widget.details;
    final product = details != null && details['product'] is Map
        ? Map<String, dynamic>.from(details['product'] as Map)
        : widget.preview;
    final comparison = details != null && details['comparison'] is Map
        ? Map<String, dynamic>.from(details['comparison'] as Map)
        : <String, dynamic>{};
    final availableStores = _extractList(comparison['available_stores']);
    final unavailableStores = _extractList(comparison['unavailable_stores']);
    final deals = _extractList(details?['deals']);
    final attributes = _extractList(details?['attributes']);
    final cheaperAlts = _extractList(details?['cheaper_alternatives']);
    final sameBrandProds = _extractList(details?['same_brand_products']);
    final compProds = _extractList(details?['complementary_products']);

    Map<String, dynamic>? selectedStore;
    for (final st in availableStores) {
      if (st['product_id']?.toString() == widget.savedState.selectedStoreProductId) {
        selectedStore = st;
        break;
      }
    }
    selectedStore ??= availableStores.isNotEmpty ? availableStores.first : null;

    final displayName = (product['name_ar'] ?? widget.preview['name_ar'] ?? 'منتج في اطلبها').toString();
    final displayBrand = (product['brand'] ?? widget.preview['brand'] ?? '').toString().trim();
    final displaySize = (product['size_label'] ?? widget.preview['size_label'] ?? '').toString().trim();
    final gallery = ((product['images'] as List?) ?? [])
        .map((e) => OtlobhaCustomerApi.resolveMediaUrl(e))
        .where((e) => e.isNotEmpty)
        .toList();
    final displayImage = widget.savedState.activeImage.isNotEmpty
        ? widget.savedState.activeImage
        : OtlobhaCustomerApi.resolveMediaUrl(product['image_url'] ?? widget.preview['image_url']);

    final activeEffectivePrice = selectedStore != null
        ? _toDouble(selectedStore['effective_price'])
        : _toDouble(product['effective_price'] ?? product['sale_price'] ?? product['base_price']);
    final activeBasePrice = selectedStore != null
        ? _toDouble(selectedStore['base_price'])
        : _toDouble(product['base_price'] ?? activeEffectivePrice);
    final activeMerchantName = selectedStore != null
        ? (selectedStore['merchant_name'] ?? '').toString()
        : (product['merchant_name'] ?? widget.preview['merchant_name'] ?? '').toString();
    final activeMerchantId = selectedStore != null
        ? (selectedStore['merchant_id'] ?? '').toString()
        : (product['merchant_id'] ?? widget.preview['merchant_id'] ?? '').toString();
    final activeListingId = selectedStore != null
        ? (selectedStore['product_id'] ?? widget.productId).toString()
        : (product['id'] ?? widget.productId).toString();
    final activeAvailable = selectedStore != null
        ? (selectedStore['is_available'] == true || selectedStore['is_available'] == 1)
        : (product['is_available'] == null ||
            product['is_available'] == true ||
            product['is_available'] == 1);

    final hasDiscount = activeBasePrice > activeEffectivePrice && activeBasePrice > 0;
    final discountPct = hasDiscount
        ? (((activeBasePrice - activeEffectivePrice) / activeBasePrice) * 100).round()
        : ((product['discount_percent'] as num?)?.toInt() ?? 0);
    final qty = widget.savedState.qty;
    final totalLinePrice = activeEffectivePrice * qty;
    final totalBasePrice = activeBasePrice * qty;
    final purchaseCount = (product['purchase_count'] as num?)?.toInt() ?? 0;
    final maxSavings = _toDouble(comparison['max_savings']);
    final hasMultiStore = comparison['has_multi_store'] == true || availableStores.length > 1;
    final storesCount = (comparison['stores_count'] as num?)?.toInt() ?? availableStores.length;

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF6F7F9),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: widget.isActive ? Colors.white : Colors.white38,
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Color(widget.isActive ? 0x550F172A : 0x330F172A),
            blurRadius: widget.isActive ? 28 : 14,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Column(
            children: [
              // Drag Handle
              Container(
                color: Colors.white,
                padding: const EdgeInsets.only(top: 10, bottom: 4),
                child: Center(
                  child: Container(
                    width: 40,
                    height: 5,
                    decoration: BoxDecoration(
                      color: const Color(0xFFCBD5E1),
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                ),
              ),

              // Vertically Scrollable Details Body
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 18),
                  physics: const BouncingScrollPhysics(),
                  children: [
                    // 1. HERO IMAGE + FLOATING ACTIONS
                    Container(
                      padding: const EdgeInsets.fromLTRB(16, 6, 16, 18),
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            height: 215,
                            child: Stack(
                              children: [
                                // Main Zoomable Image
                                Positioned.fill(
                                  child: GestureDetector(
                                    onTap: displayImage.isNotEmpty
                                        ? () => widget.onZoomImage(displayImage, displayName)
                                        : null,
                                    child: Center(
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(horizontal: 42, vertical: 8),
                                        child: displayImage.isNotEmpty
                                            ? Image.network(
                                                displayImage,
                                                fit: BoxFit.contain,
                                                errorBuilder: (_, __, ___) => _heroPlaceholder(),
                                              )
                                            : _heroPlaceholder(),
                                      ),
                                    ),
                                  ),
                                ),

                                // Close Button (Top-Left in RTL)
                                Positioned(
                                  top: 2,
                                  left: 0,
                                  child: _circleActionButton(
                                    icon: Icons.close,
                                    color: const Color(0xFF334155),
                                    onTap: widget.onClose,
                                  ),
                                ),

                                // Action Stack (Top-Right in RTL: Cart, Favorite, Share)
                                Positioned(
                                  top: 2,
                                  right: 0,
                                  child: Column(
                                    children: [
                                      Stack(
                                        clipBehavior: Clip.none,
                                        children: [
                                          _circleActionButton(
                                            icon: Icons.shopping_cart_outlined,
                                            color: const Color(0xFF334155),
                                            onTap: widget.onOpenCart,
                                          ),
                                          if (widget.cartCount > 0)
                                            Positioned(
                                              top: -4,
                                              right: -4,
                                              child: Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFA92224),
                                                  borderRadius: BorderRadius.circular(10),
                                                ),
                                                child: Text(
                                                  '${widget.cartCount}',
                                                  style: const TextStyle(
                                                    color: Colors.white,
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w900,
                                                  ),
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      _circleActionButton(
                                        icon: widget.isFavorite ? Icons.favorite : Icons.favorite_border,
                                        color: widget.isFavorite
                                            ? const Color(0xFFA92224)
                                            : const Color(0xFF475569),
                                        onTap: widget.onToggleFavorite,
                                      ),
                                      const SizedBox(height: 8),
                                      _circleActionButton(
                                        icon: Icons.share_outlined,
                                        color: const Color(0xFF475569),
                                        onTap: () {
                                          final text =
                                              '$displayName — بسعر ${_formatPrice(activeEffectivePrice)} ج.م عبر تطبيق اطلبها Otlobha';
                                          Clipboard.setData(ClipboardData(text: text));
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            const SnackBar(
                                              duration: Duration(milliseconds: 1400),
                                              content: Text('تم نسخ تفاصيل المنتج للمشاركة'),
                                            ),
                                          );
                                        },
                                      ),
                                    ],
                                  ),
                                ),

                                if (displayImage.isNotEmpty)
                                  Positioned(
                                    bottom: 4,
                                    left: 4,
                                    child: GestureDetector(
                                      onTap: () => widget.onZoomImage(displayImage, displayName),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: const Color(0xB30F172A),
                                          borderRadius: BorderRadius.circular(14),
                                        ),
                                        child: const Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(Icons.zoom_in, size: 13, color: Colors.white),
                                            SizedBox(width: 4),
                                            Text(
                                              'تكبير',
                                              style: TextStyle(
                                                color: Colors.white,
                                                fontSize: 10,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),

                          if (gallery.length > 1) ...[
                            const SizedBox(height: 8),
                            SizedBox(
                              height: 48,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: gallery.length,
                                separatorBuilder: (_, __) => const SizedBox(width: 8),
                                itemBuilder: (_, i) {
                                  final url = gallery[i];
                                  final selected = displayImage == url;
                                  return GestureDetector(
                                    onTap: () => setState(() => widget.savedState.activeImage = url),
                                    child: Container(
                                      width: 48,
                                      padding: const EdgeInsets.all(4),
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                          color: selected
                                              ? const Color(0xFFA92224)
                                              : const Color(0xFFE2E8F0),
                                          width: selected ? 2 : 1,
                                        ),
                                      ),
                                      child: Image.network(url, fit: BoxFit.contain),
                                    ),
                                  );
                                },
                              ),
                            ),
                          ],

                          const SizedBox(height: 12),

                          // 2. CORE PRODUCT INFO
                          Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              if (discountPct > 0)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFA92224),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    'خصم $discountPct%',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              if (displayBrand.isNotEmpty)
                                InkWell(
                                  onTap: () => widget.onSelectBrand(displayBrand),
                                  child: Text(
                                    displayBrand,
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                      color: Color(0xFFA92224),
                                    ),
                                  ),
                                ),
                              if (displaySize.isNotEmpty)
                                Text(
                                  '· $displaySize',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: Color(0xFF475569),
                                  ),
                                ),
                              Text(
                                activeAvailable ? '· متوفر الآن' : '· غير متوفر حاليًا',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                  color: activeAvailable
                                      ? const Color(0xFF047857)
                                      : const Color(0xFFA92224),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            displayName,
                            style: const TextStyle(
                              fontSize: 17.5,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A),
                              height: 1.3,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Text(
                                    _formatPrice(activeEffectivePrice),
                                    style: const TextStyle(
                                      fontSize: 23,
                                      fontWeight: FontWeight.w900,
                                      color: Color(0xFF0F172A),
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'ج.م',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFF475569),
                                    ),
                                  ),
                                  if (hasDiscount) ...[
                                    const SizedBox(width: 8),
                                    Text(
                                      '${_formatPrice(activeBasePrice)} ج.م',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: Color(0xFF94A3B8),
                                        decoration: TextDecoration.lineThrough,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              if (purchaseCount > 0)
                                Text(
                                  'اشتراه +$purchaseCount عميل',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: Color(0xFF64748B),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 12),

                    // Loading / Error / Detailed Sections
                    if (widget.isLoading && details == null)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 28),
                        child: Center(
                          child: CircularProgressIndicator(color: Color(0xFFA92224)),
                        ),
                      )
                    else if (widget.error != null && details == null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: const Color(0xFFFECACA)),
                          ),
                          child: Text(
                            widget.error!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFFA92224),
                            ),
                          ),
                        ),
                      )
                    else if (details != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            // 3. MULTI-STORE PRICE COMPARISON
                            Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(22),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              children: [
                                                const Icon(Icons.trending_down,
                                                    size: 17, color: Color(0xFFA92224)),
                                                const SizedBox(width: 6),
                                                Expanded(
                                                  child: Text(
                                                    hasMultiStore
                                                        ? 'مقارنة الأسعار بين المتاجر ($storesCount متاجر)'
                                                        : 'المتجر الموفّر للمنتج',
                                                    style: const TextStyle(
                                                      fontSize: 13.5,
                                                      fontWeight: FontWeight.w900,
                                                      color: Color(0xFF0F172A),
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              hasMultiStore
                                                  ? 'مرتّبة تلقائيًا من الأقل سعرًا للأعلى لنفس العلامة والحجم'
                                                  : 'سعر وتوفر هذا المنتج في المتجر المعتمد',
                                              style: const TextStyle(
                                                fontSize: 11,
                                                color: Color(0xFF64748B),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      if (maxSavings > 0)
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 8, vertical: 5),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFFFFBEB),
                                            borderRadius: BorderRadius.circular(10),
                                            border: Border.all(color: const Color(0x99F5A623)),
                                          ),
                                          child: Text(
                                            'وفّر حتى ${_formatPrice(maxSavings)} ج.م',
                                            style: const TextStyle(
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.w900,
                                              color: Color(0xFF92400E),
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  ...availableStores.map((st) {
                                    final stProdId = st['product_id']?.toString() ?? '';
                                    final isSelected = selectedStore?['product_id']?.toString() == stProdId;
                                    final isLowest = st['is_lowest'] == true;
                                    final stEff = _toDouble(st['effective_price']);
                                    final savingsVsHighest = _toDouble(st['savings_vs_highest']);
                                    final diffFromLowest = _toDouble(st['price_diff_from_lowest']);
                                    final stImg = OtlobhaCustomerApi.resolveMediaUrl(st['image_url']);
                                    return GestureDetector(
                                      onTap: () => setState(
                                        () => widget.savedState.selectedStoreProductId = stProdId,
                                      ),
                                      child: Container(
                                        margin: const EdgeInsets.only(bottom: 8),
                                        padding: const EdgeInsets.all(10),
                                        decoration: BoxDecoration(
                                          color: isSelected
                                              ? const Color(0x99FEF2F2)
                                              : Colors.white,
                                          borderRadius: BorderRadius.circular(16),
                                          border: Border.all(
                                            color: isSelected
                                                ? const Color(0xFFA92224)
                                                : const Color(0xFFE2E8F0),
                                            width: isSelected ? 1.8 : 1,
                                          ),
                                        ),
                                        child: Row(
                                          children: [
                                            Container(
                                              width: 38,
                                              height: 38,
                                              decoration: BoxDecoration(
                                                color: Colors.white,
                                                borderRadius: BorderRadius.circular(10),
                                                border: Border.all(color: const Color(0xFFE2E8F0)),
                                              ),
                                              child: stImg.isNotEmpty
                                                  ? Padding(
                                                      padding: const EdgeInsets.all(3),
                                                      child: Image.network(stImg, fit: BoxFit.contain),
                                                    )
                                                  : const Icon(Icons.storefront,
                                                      size: 20, color: Color(0xFFA92224)),
                                            ),
                                            const SizedBox(width: 10),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Row(
                                                    children: [
                                                      Flexible(
                                                        child: Text(
                                                          (st['merchant_name'] ?? '').toString(),
                                                          maxLines: 1,
                                                          overflow: TextOverflow.ellipsis,
                                                          style: const TextStyle(
                                                            fontSize: 13,
                                                            fontWeight: FontWeight.w800,
                                                            color: Color(0xFF0F172A),
                                                          ),
                                                        ),
                                                      ),
                                                      if (isLowest && availableStores.length > 1)
                                                        const Text(
                                                          ' · أقل سعر',
                                                          style: TextStyle(
                                                            fontSize: 10.5,
                                                            fontWeight: FontWeight.w900,
                                                            color: Color(0xFF047857),
                                                          ),
                                                        ),
                                                    ],
                                                  ),
                                                  const SizedBox(height: 2),
                                                  Text(
                                                    '${(st['size_label'] ?? displaySize).toString().isNotEmpty ? (st['size_label'] ?? displaySize) : 'نفس العبوة'} · متوفر (${st['stock_quantity'] ?? 0})',
                                                    style: const TextStyle(
                                                      fontSize: 11,
                                                      color: Color(0xFF64748B),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            Column(
                                              crossAxisAlignment: CrossAxisAlignment.end,
                                              children: [
                                                Text(
                                                  '${_formatPrice(stEff)} ج.م',
                                                  style: const TextStyle(
                                                    fontSize: 15,
                                                    fontWeight: FontWeight.w900,
                                                    color: Color(0xFFA92224),
                                                  ),
                                                ),
                                                if (isLowest && savingsVsHighest > 0)
                                                  Text(
                                                    'توفّر ${_formatPrice(savingsVsHighest)} ج.م',
                                                    style: const TextStyle(
                                                      fontSize: 10,
                                                      fontWeight: FontWeight.w900,
                                                      color: Color(0xFF047857),
                                                    ),
                                                  )
                                                else if (diffFromLowest > 0)
                                                  Text(
                                                    '+${_formatPrice(diffFromLowest)} ج.م فرق',
                                                    style: const TextStyle(
                                                      fontSize: 10,
                                                      color: Color(0xFF94A3B8),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ],
                                        ),
                                      ),
                                    );
                                  }),
                                  if (unavailableStores.isNotEmpty) ...[
                                    const Divider(height: 16),
                                    const Text(
                                      'غير متوفر حاليًا في:',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: Color(0xFF94A3B8),
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    ...unavailableStores.map((st) => Container(
                                          margin: const EdgeInsets.only(bottom: 6),
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 10, vertical: 8),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF8FAFC),
                                            borderRadius: BorderRadius.circular(12),
                                            border: Border.all(color: const Color(0xFFE2E8F0)),
                                          ),
                                          child: Row(
                                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                            children: [
                                              Text(
                                                (st['merchant_name'] ?? '').toString(),
                                                style: const TextStyle(
                                                  fontSize: 11.5,
                                                  fontWeight: FontWeight.w700,
                                                  color: Color(0xFF94A3B8),
                                                ),
                                              ),
                                              Text(
                                                'غير متاح · ${_formatPrice(_toDouble(st['effective_price']))} ج.م',
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  color: Color(0xFF94A3B8),
                                                ),
                                              ),
                                            ],
                                          ),
                                        )),
                                  ],
                                ],
                              ),
                            ),

                            // 4. SAVINGS DEALS & FREE GIFTS
                            if (deals.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              ...deals.map((deal) {
                                final reqQty = ((deal['required_qty'] as num?)?.toInt() ?? 1).clamp(1, 99);
                                final gifts = _extractList(deal['gift_products']);
                                final bundleProds = _extractList(deal['bundle_products']);
                                final chosenCount = bundleProds.isNotEmpty
                                    ? widget.savedState.bundleSelectedIds.length
                                    : qty.clamp(0, reqQty);
                                final remaining = (reqQty - chosenCount).clamp(0, reqQty);
                                final progress = (chosenCount / reqQty).clamp(0.0, 1.0);
                                final discAmt = _toDouble(deal['discount_amount']);

                                return Container(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(22),
                                    border: Border.all(color: const Color(0x88F5A623)),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Container(
                                            width: 34,
                                            height: 34,
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFFEF2F2),
                                              borderRadius: BorderRadius.circular(10),
                                            ),
                                            child: Icon(
                                              deal['deal_type'] == 'free_gift'
                                                  ? Icons.card_giftcard
                                                  : Icons.local_offer_outlined,
                                              size: 18,
                                              color: const Color(0xFFA92224),
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  (deal['title_ar'] ?? '').toString(),
                                                  style: const TextStyle(
                                                    fontSize: 13.5,
                                                    fontWeight: FontWeight.w900,
                                                    color: Color(0xFF0F172A),
                                                  ),
                                                ),
                                                if ((deal['subtitle_ar'] ?? '').toString().isNotEmpty)
                                                  Text(
                                                    deal['subtitle_ar'].toString(),
                                                    style: const TextStyle(
                                                      fontSize: 11,
                                                      color: Color(0xFF64748B),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                          if (discAmt > 0)
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFFA92224),
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: Text(
                                                'وفّر ${_formatPrice(discAmt)} ج.م',
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 10.5,
                                                  fontWeight: FontWeight.w900,
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                      if (reqQty > 1) ...[
                                        const SizedBox(height: 10),
                                        Container(
                                          padding: const EdgeInsets.all(10),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF8FAFC),
                                            borderRadius: BorderRadius.circular(14),
                                          ),
                                          child: Column(
                                            children: [
                                              Row(
                                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                                children: [
                                                  Text(
                                                    'المختار: $chosenCount من $reqQty',
                                                    style: const TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: FontWeight.w700,
                                                      color: Color(0xFF334155),
                                                    ),
                                                  ),
                                                  Text(
                                                    remaining == 0
                                                        ? 'اكتمل العرض ✓'
                                                        : 'المتبقي $remaining لإكمال العرض',
                                                    style: const TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: FontWeight.w800,
                                                      color: Color(0xFFA92224),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              const SizedBox(height: 6),
                                              ClipRRect(
                                                borderRadius: BorderRadius.circular(6),
                                                child: LinearProgressIndicator(
                                                  value: progress,
                                                  minHeight: 7,
                                                  backgroundColor: const Color(0xFFE2E8F0),
                                                  valueColor: const AlwaysStoppedAnimation<Color>(
                                                    Color(0xFFA92224),
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                      if (gifts.isNotEmpty) ...[
                                        const SizedBox(height: 10),
                                        const Text(
                                          'اختر هديتك المجانية مع هذا المنتج:',
                                          style: TextStyle(
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w800,
                                            color: Color(0xFF334155),
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        ...gifts.map((gift) {
                                          final gid = gift['id']?.toString() ?? '';
                                          final picked = widget.savedState.selectedGiftId == gid;
                                          final gImg = OtlobhaCustomerApi.resolveMediaUrl(gift['image_url']);
                                          return GestureDetector(
                                            onTap: () => setState(
                                              () => widget.savedState.selectedGiftId = gid,
                                            ),
                                            child: Container(
                                              margin: const EdgeInsets.only(bottom: 6),
                                              padding: const EdgeInsets.all(9),
                                              decoration: BoxDecoration(
                                                color: picked
                                                    ? const Color(0x99FEF2F2)
                                                    : Colors.white,
                                                borderRadius: BorderRadius.circular(14),
                                                border: Border.all(
                                                  color: picked
                                                      ? const Color(0xFFA92224)
                                                      : const Color(0xFFE2E8F0),
                                                ),
                                              ),
                                              child: Row(
                                                children: [
                                                  if (gImg.isNotEmpty)
                                                    Image.network(gImg,
                                                        width: 32, height: 32, fit: BoxFit.contain)
                                                  else
                                                    const Icon(Icons.card_giftcard,
                                                        size: 20, color: Color(0xFFA92224)),
                                                  const SizedBox(width: 8),
                                                  Expanded(
                                                    child: Text(
                                                      (gift['name_ar'] ?? '').toString(),
                                                      maxLines: 1,
                                                      overflow: TextOverflow.ellipsis,
                                                      style: const TextStyle(
                                                        fontSize: 12,
                                                        fontWeight: FontWeight.w700,
                                                      ),
                                                    ),
                                                  ),
                                                  const Text(
                                                    'مجانًا',
                                                    style: TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: FontWeight.w900,
                                                      color: Color(0xFF047857),
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  Icon(
                                                    Icons.check_circle,
                                                    size: 18,
                                                    color: picked
                                                        ? const Color(0xFFA92224)
                                                        : const Color(0xFFCBD5E1),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          );
                                        }),
                                      ],
                                      if (bundleProds.isNotEmpty) ...[
                                        const SizedBox(height: 8),
                                        const Text(
                                          'اختر منتجات الباقة:',
                                          style: TextStyle(
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w800,
                                            color: Color(0xFF334155),
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        ...bundleProds.map((bp) {
                                          final bpId = bp['id']?.toString() ?? '';
                                          final picked =
                                              widget.savedState.bundleSelectedIds.contains(bpId);
                                          return GestureDetector(
                                            onTap: () => setState(() {
                                              if (picked) {
                                                widget.savedState.bundleSelectedIds.remove(bpId);
                                              } else {
                                                widget.savedState.bundleSelectedIds.add(bpId);
                                              }
                                            }),
                                            child: Container(
                                              margin: const EdgeInsets.only(bottom: 6),
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 10, vertical: 8),
                                              decoration: BoxDecoration(
                                                color: picked
                                                    ? const Color(0x99FEF2F2)
                                                    : Colors.white,
                                                borderRadius: BorderRadius.circular(12),
                                                border: Border.all(
                                                  color: picked
                                                      ? const Color(0xFFA92224)
                                                      : const Color(0xFFE2E8F0),
                                                ),
                                              ),
                                              child: Row(
                                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                                children: [
                                                  Expanded(
                                                    child: Text(
                                                      (bp['name_ar'] ?? '').toString(),
                                                      maxLines: 1,
                                                      overflow: TextOverflow.ellipsis,
                                                      style: const TextStyle(
                                                        fontSize: 12,
                                                        fontWeight: FontWeight.w700,
                                                      ),
                                                    ),
                                                  ),
                                                  Icon(
                                                    Icons.check_circle,
                                                    size: 18,
                                                    color: picked
                                                        ? const Color(0xFFA92224)
                                                        : const Color(0xFFCBD5E1),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          );
                                        }),
                                      ],
                                    ],
                                  ),
                                );
                              }),
                            ],

                            // 5. DESCRIPTION & SPECIFICATIONS
                            if ((product['description'] ?? '').toString().trim().isNotEmpty ||
                                (product['usage_notes'] ?? '').toString().trim().isNotEmpty ||
                                (product['ingredients'] ?? '').toString().trim().isNotEmpty ||
                                attributes.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(22),
                                  border: Border.all(color: const Color(0xFFE2E8F0)),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Row(
                                      children: [
                                        Icon(Icons.info_outline,
                                            size: 17, color: Color(0xFFA92224)),
                                        SizedBox(width: 6),
                                        Text(
                                          'وصف المنتج والمواصفات',
                                          style: TextStyle(
                                            fontSize: 13.5,
                                            fontWeight: FontWeight.w900,
                                            color: Color(0xFF0F172A),
                                          ),
                                        ),
                                      ],
                                    ),
                                    if ((product['description'] ?? '').toString().trim().isNotEmpty) ...[
                                      const SizedBox(height: 8),
                                      Text(
                                        product['description'].toString(),
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Color(0xFF475569),
                                          height: 1.5,
                                        ),
                                      ),
                                    ],
                                    if ((product['usage_notes'] ?? '').toString().trim().isNotEmpty) ...[
                                      const SizedBox(height: 6),
                                      Text(
                                        'الاستخدامات: ${product['usage_notes']}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Color(0xFF334155),
                                        ),
                                      ),
                                    ],
                                    if ((product['ingredients'] ?? '').toString().trim().isNotEmpty) ...[
                                      const SizedBox(height: 6),
                                      Text(
                                        'المكونات: ${product['ingredients']}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Color(0xFF334155),
                                        ),
                                      ),
                                    ],
                                    if (attributes.isNotEmpty ||
                                        displaySize.isNotEmpty ||
                                        (product['barcode'] ?? '').toString().isNotEmpty) ...[
                                      const SizedBox(height: 10),
                                      Wrap(
                                        spacing: 8,
                                        runSpacing: 8,
                                        children: [
                                          if (displaySize.isNotEmpty)
                                            _specBox('الحجم / الوزن', displaySize),
                                          if ((product['barcode'] ?? '').toString().isNotEmpty)
                                            _specBox('الباركود', product['barcode'].toString()),
                                          ...attributes.map((a) => _specBox(
                                                (a['attr_key'] ?? '').toString(),
                                                (a['attr_value'] ?? '').toString(),
                                              )),
                                        ],
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],

                            // 5B. INDEPENDENT PRODUCT REVIEWS (verified purchasers only)
                            const SizedBox(height: 10),
                            _ProductReviewsSection(
                              key: ValueKey('prod_reviews_$activeListingId'),
                              api: widget.api,
                              productId: activeListingId,
                              productName: displayName,
                              onZoomImage: widget.onZoomImage,
                            ),

                            // 6. BRAND & STORE NAVIGATION CARDS
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                if (displayBrand.isNotEmpty)
                                  Expanded(
                                    child: _navCard(
                                      subtitle: 'العلامة التجارية',
                                      title: displayBrand,
                                      cta: 'اكتشف المزيد',
                                      onTap: () => widget.onSelectBrand(displayBrand),
                                    ),
                                  ),
                                if (displayBrand.isNotEmpty && activeMerchantName.isNotEmpty)
                                  const SizedBox(width: 8),
                                if (activeMerchantName.isNotEmpty)
                                  Expanded(
                                    child: _navCard(
                                      subtitle: 'المتجر المختار',
                                      title: activeMerchantName,
                                      cta: 'تصفّح المتجر',
                                      onTap: () => widget.onSelectStore(
                                        activeMerchantId,
                                        activeMerchantName,
                                      ),
                                    ),
                                  ),
                              ],
                            ),

                            // 7. ALTERNATIVE & COMPLEMENTARY PRODUCTS
                            _miniHorizontalStrip('بدائل مشابهة بسعر أقل', cheaperAlts),
                            _miniHorizontalStrip(
                              'منتجات أخرى من ${displayBrand.isNotEmpty ? displayBrand : 'نفس العلامة'}',
                              sameBrandProds,
                            ),
                            _miniHorizontalStrip('منتجات مكملة يمكنك شراؤها معًا', compProds),
                          ],
                        ),
                      ),
                  ],
                ),
              ),

              // 8. STICKY BOTTOM ADD-TO-CART BAR
              Container(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
                  boxShadow: [
                    BoxShadow(
                      color: Color(0x100F172A),
                      blurRadius: 12,
                      offset: Offset(0, -3),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    // Quantity Stepper
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          InkWell(
                            onTap: () => setState(() => widget.savedState.qty++),
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              width: 34,
                              height: 34,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Icon(Icons.add, size: 17, color: Color(0xFFA92224)),
                            ),
                          ),
                          SizedBox(
                            width: 28,
                            child: Text(
                              '$qty',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          InkWell(
                            onTap: () => setState(() {
                              if (widget.savedState.qty > 1) widget.savedState.qty--;
                            }),
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              width: 34,
                              height: 34,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Icon(Icons.remove, size: 17, color: Color(0xFF334155)),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),

                    // Primary Add CTA
                    Expanded(
                      child: SizedBox(
                        height: 46,
                        child: ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: !activeAvailable
                                ? const Color(0xFFE2E8F0)
                                : (_justAdded
                                    ? const Color(0xFF059669)
                                    : const Color(0xFFA92224)),
                            foregroundColor:
                                activeAvailable ? Colors.white : const Color(0xFF64748B),
                            elevation: activeAvailable ? 2 : 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                          ),
                          onPressed: !activeAvailable
                              ? null
                              : () {
                                  widget.onAddToCart(
                                    {
                                      'id': activeListingId,
                                      'merchant_id': activeMerchantId,
                                      'merchant_name': activeMerchantName,
                                      'name_ar': displayName,
                                      'base_price': activeBasePrice > 0
                                          ? activeBasePrice
                                          : activeEffectivePrice,
                                      'sale_price': hasDiscount ? activeEffectivePrice : null,
                                      'effective_price': activeEffectivePrice,
                                      'image_url': displayImage,
                                    },
                                    qty,
                                  );
                                  setState(() => _justAdded = true);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      duration: const Duration(milliseconds: 1400),
                                      content: Text(
                                        'تمت إضافة $qty × $displayName للسلة',
                                      ),
                                    ),
                                  );
                                  Future.delayed(const Duration(milliseconds: 1400), () {
                                    if (mounted) setState(() => _justAdded = false);
                                  });
                                },
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Flexible(
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    if (_justAdded) ...[
                                      const Icon(Icons.check, size: 16),
                                      const SizedBox(width: 4),
                                    ],
                                    Flexible(
                                      child: Text(
                                        !activeAvailable
                                            ? 'غير متوفر'
                                            : (_justAdded ? 'تمت الإضافة' : 'أضف للسلة'),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w900,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                    if (!_justAdded &&
                                        activeAvailable &&
                                        widget.savedState.selectedGiftId.isNotEmpty) ...[
                                      const SizedBox(width: 5),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 5, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFF5A623),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Text(
                                          '+1 هدية',
                                          style: TextStyle(
                                            color: Color(0xFF3B180E),
                                            fontSize: 9.5,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Text(
                                    '${_formatPrice(totalLinePrice)} ج.م',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w900,
                                      fontSize: 13,
                                    ),
                                  ),
                                  if (hasDiscount) ...[
                                    const SizedBox(width: 4),
                                    Text(
                                      _formatPrice(totalBasePrice),
                                      style: const TextStyle(
                                        fontSize: 10.5,
                                        color: Colors.white70,
                                        decoration: TextDecoration.lineThrough,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // Tapping a peeking adjacent card glides straight to it
          if (!widget.isActive)
            Positioned.fill(
              child: GestureDetector(
                onTap: widget.onSelectPeekingCard,
                child: Container(color: const Color(0x120F172A)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _circleActionButton({
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white.withOpacity(0.95),
      shape: const CircleBorder(),
      elevation: 3,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Icon(icon, size: 19, color: color),
        ),
      ),
    );
  }

  Widget _heroPlaceholder() {
    return Container(
      width: 110,
      height: 110,
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(26),
      ),
      child: const Icon(Icons.inventory_2_outlined, size: 52, color: Color(0xFFA92224)),
    );
  }

  Widget _specBox(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8))),
          Text(
            value,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: Color(0xFF1E293B),
            ),
          ),
        ],
      ),
    );
  }

  Widget _navCard({
    required String subtitle,
    required String title,
    required String cta,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(subtitle,
                      style: const TextStyle(
                          fontSize: 10, fontWeight: FontWeight.w700, color: Color(0xFF94A3B8))),
                  const SizedBox(height: 2),
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    cta,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFA92224),
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_left, size: 18, color: Color(0xFF94A3B8)),
          ],
        ),
      ),
    );
  }

  Widget _miniHorizontalStrip(String title, List<Map<String, dynamic>> items) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w900,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 162,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final item = items[i];
                final img = OtlobhaCustomerApi.resolveMediaUrl(item['image_url']);
                final base = _toDouble(item['base_price']);
                final sale = item['sale_price'] != null ? _toDouble(item['sale_price']) : null;
                final eff = (sale != null && sale > 0 && sale < base) ? sale : base;
                return InkWell(
                  onTap: () => widget.onOpenRelatedProduct(item),
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    width: 118,
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(6),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF9FAFB),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: img.isNotEmpty
                                ? Image.network(img, fit: BoxFit.contain)
                                : const Icon(Icons.inventory_2_outlined,
                                    color: Color(0xFFA92224)),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          (item['name_ar'] ?? '').toString(),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF0F172A),
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${_formatPrice(eff)} ج.م',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFA92224),
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
    );
  }
}

class _ProductReviewsSection extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String productId;
  final String productName;
  final void Function(String imageUrl, String title) onZoomImage;

  const _ProductReviewsSection({
    super.key,
    required this.api,
    required this.productId,
    required this.productName,
    required this.onZoomImage,
  });

  @override
  State<_ProductReviewsSection> createState() => _ProductReviewsSectionState();
}

class _ProductReviewsSectionState extends State<_ProductReviewsSection> {
  bool _loading = true;
  double _ratingAvg = 0;
  int _ratingCount = 0;
  List<Map<String, dynamic>> _reviews = [];
  List<Map<String, dynamic>> _eligibleOrders = [];
  String _sort = 'newest';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.productId.isEmpty) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    try {
      final res = await widget.api.getProductReviews(
        widget.productId,
        sort: _sort,
        limit: 10,
      );
      if (!mounted) return;
      final summary = res['summary'] is Map
          ? Map<String, dynamic>.from(res['summary'] as Map)
          : <String, dynamic>{};
      final rawItems = (res['reviews'] as List?) ?? (res['items'] as List?) ?? [];
      final rawEligible = (res['eligible_orders'] as List?) ?? [];
      setState(() {
        _ratingAvg = (summary['rating_avg'] as num?)?.toDouble() ??
            (res['rating_avg'] as num?)?.toDouble() ??
            0;
        _ratingCount = (summary['rating_count'] as num?)?.toInt() ??
            (res['rating_count'] as num?)?.toInt() ??
            0;
        _reviews = rawItems.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _eligibleOrders = rawEligible.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openWriteDialog() async {
    if (!widget.api.hasTokens) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى تسجيل الدخول لتقييم المنتج')),
      );
      return;
    }
    if (_eligibleOrders.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('يمكن تقييم المنتج فقط بعد إتمام طلب مكتمل يحتوي على هذا المنتج'),
        ),
      );
      return;
    }

    int stars = 5;
    String selectedOrderId = (_eligibleOrders.first['order_id'] ?? '').toString();
    final commentCtrl = TextEditingController();
    final List<String> imagesBase64 = [];
    final picker = ImagePicker();
    bool submitting = false;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: Text(
              'تقييم المنتج: ${widget.productName}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_eligibleOrders.length > 1) ...[
                    DropdownButtonFormField<String>(
                      value: selectedOrderId,
                      decoration: const InputDecoration(
                        labelText: 'الطلب المكتمل',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: _eligibleOrders
                          .map((o) => DropdownMenuItem<String>(
                                value: (o['order_id'] ?? '').toString(),
                                child: Text('طلب #${o['order_number'] ?? o['order_id']}'),
                              ))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setModalState(() => selectedOrderId = v);
                      },
                    ),
                    const SizedBox(height: 10),
                  ],
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (i) {
                      final s = i + 1;
                      return IconButton(
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                        onPressed: () => setModalState(() => stars = s),
                        icon: Icon(
                          s <= stars ? Icons.star_rounded : Icons.star_border_rounded,
                          color: const Color(0xFFF5A623),
                          size: 32,
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: commentCtrl,
                    maxLines: 3,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'رأيك في جودة المنتج (اختياري)',
                      hintText: 'هل المنتج طازج ومطابق للوصف؟',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'صور المنتج (اختياري - حتى 4)',
                        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF475569)),
                      ),
                      if (imagesBase64.length < 4)
                        TextButton.icon(
                          onPressed: () async {
                            try {
                              final picked = await picker.pickImage(
                                source: ImageSource.gallery,
                                maxWidth: 960,
                                imageQuality: 72,
                              );
                              if (picked == null) return;
                              final bytes = await picked.readAsBytes();
                              final ext = picked.path.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
                              setModalState(() {
                                imagesBase64.add('data:image/$ext;base64,${base64Encode(bytes)}');
                              });
                            } catch (_) {}
                          },
                          icon: const Icon(Icons.add_a_photo_outlined, size: 16),
                          label: const Text('إضافة صورة', style: TextStyle(fontSize: 12)),
                        ),
                    ],
                  ),
                  if (imagesBase64.isNotEmpty)
                    SizedBox(
                      height: 60,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: imagesBase64.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, idx) {
                          final raw = imagesBase64[idx];
                          final b64 = raw.split(',').last;
                          return Stack(
                            clipBehavior: Clip.none,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.memory(
                                  base64Decode(b64),
                                  width: 56,
                                  height: 56,
                                  fit: BoxFit.cover,
                                ),
                              ),
                              Positioned(
                                top: -6,
                                left: -6,
                                child: GestureDetector(
                                  onTap: () => setModalState(() => imagesBase64.removeAt(idx)),
                                  child: Container(
                                    width: 20,
                                    height: 20,
                                    decoration: const BoxDecoration(
                                      color: Color(0xFFA92224),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.close, size: 13, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
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
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFA92224),
                  foregroundColor: Colors.white,
                ),
                onPressed: submitting
                    ? null
                    : () async {
                        setModalState(() => submitting = true);
                        try {
                          await widget.api.submitProductReview(
                            widget.productId,
                            orderId: selectedOrderId,
                            rating: stars,
                            comment: commentCtrl.text.trim(),
                            imageUrls: imagesBase64,
                          );
                          if (ctx.mounted) Navigator.pop(ctx, true);
                        } catch (e) {
                          setModalState(() => submitting = false);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
                            );
                          }
                        }
                      },
                child: Text(submitting ? 'جاري الإرسال...' : 'نشر تقييم المنتج'),
              ),
            ],
          ),
        ),
      ),
    );
    commentCtrl.dispose();
    if (saved == true) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم حفظ تقييم المنتج بنجاح ✓')),
        );
      }
    }
  }

  Future<void> _reportReview(String reviewId) async {
    if (!widget.api.hasTokens) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('يرجى تسجيل الدخول للإبلاغ عن تعليق')),
      );
      return;
    }
    String reason = 'تعليق مسيء أو غير لائق';
    final detailsCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: const Text('الإبلاغ عن تعليق', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: reason,
                  decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, labelText: 'سبب البلاغ'),
                  items: const [
                    DropdownMenuItem(value: 'تعليق مسيء أو غير لائق', child: Text('تعليق مسيء أو غير لائق')),
                    DropdownMenuItem(value: 'تقييم وهمي أو مضلل', child: Text('تقييم وهمي أو مضلل')),
                    DropdownMenuItem(value: 'محتوى غير متعلق بالمنتج', child: Text('محتوى غير متعلق بالمنتج')),
                  ],
                  onChanged: (v) {
                    if (v != null) setModalState(() => reason = v);
                  },
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: detailsCtrl,
                  decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, labelText: 'تفاصيل إضافية (اختياري)'),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA92224), foregroundColor: Colors.white),
                onPressed: () async {
                  try {
                    await widget.api.reportReview(
                      reviewType: 'product',
                      reviewId: reviewId,
                      reason: reason,
                      details: detailsCtrl.text.trim(),
                    );
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
                      );
                    }
                  }
                },
                child: const Text('إرسال البلاغ'),
              ),
            ],
          ),
        ),
      ),
    );
    detailsCtrl.dispose();
    if (ok == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم استلام البلاغ وسيتم مراجعته من الإدارة ✓')),
      );
    }
  }

  Widget _buildReviewPhotoThumb(String rawUrl) {
    final resolved = OtlobhaCustomerApi.resolveMediaUrl(rawUrl);
    if (resolved.startsWith('data:image')) {
      try {
        final b64 = resolved.split(',').last;
        return ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.memory(base64Decode(b64), width: 54, height: 54, fit: BoxFit.cover),
        );
      } catch (_) {
        return const SizedBox.shrink();
      }
    }
    if (resolved.isEmpty) return const SizedBox.shrink();
    return GestureDetector(
      onTap: () => widget.onZoomImage(resolved, widget.productName),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Image.network(
          resolved,
          width: 54,
          height: 54,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.star_rounded, size: 19, color: Color(0xFFF5A623)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  _ratingCount > 0
                      ? 'تقييمات المنتج (${_ratingAvg.toStringAsFixed(1)} · $_ratingCount)'
                      : 'تقييمات المنتج',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF0F172A),
                  ),
                ),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFA92224),
                  side: const BorderSide(color: Color(0xFFFECACA)),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: _openWriteDialog,
                icon: const Icon(Icons.rate_review_outlined, size: 14),
                label: const Text('قيّم المنتج', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          if (_reviews.length > 1) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                ChoiceChip(
                  label: const Text('الأحدث', style: TextStyle(fontSize: 11)),
                  selected: _sort == 'newest',
                  onSelected: (_) {
                    setState(() => _sort = 'newest');
                    _load();
                  },
                ),
                const SizedBox(width: 6),
                ChoiceChip(
                  label: const Text('الأعلى تقييمًا', style: TextStyle(fontSize: 11)),
                  selected: _sort == 'highest',
                  onSelected: (_) {
                    setState(() => _sort = 'highest');
                    _load();
                  },
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
            )
          else if (_reviews.isEmpty)
            const Text(
              'لا توجد تقييمات لهذا المنتج بعد. كن أول من يقيّمه بعد شرائه واستلامه.',
              style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
            )
          else
            Column(
              children: _reviews.take(5).map((r) {
                final rating = (r['rating'] as num?)?.toInt() ?? 5;
                final comment = (r['comment'] ?? '').toString().trim();
                final photos = ((r['image_urls'] as List?) ?? (r['images'] as List?) ?? [])
                    .map((e) => e.toString())
                    .toList();
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              (r['customer_name_display'] ?? 'عميل اطلبها').toString(),
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                            ),
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: List.generate(
                              5,
                              (i) => Icon(
                                i < rating ? Icons.star_rounded : Icons.star_border_rounded,
                                size: 13,
                                color: const Color(0xFFF5A623),
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          InkWell(
                            onTap: () => _reportReview((r['id'] ?? '').toString()),
                            child: const Padding(
                              padding: EdgeInsets.all(2),
                              child: Icon(Icons.flag_outlined, size: 14, color: Color(0xFF94A3B8)),
                            ),
                          ),
                        ],
                      ),
                      if (comment.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          comment,
                          style: const TextStyle(fontSize: 11.5, color: Color(0xFF334155), height: 1.4),
                        ),
                      ],
                      if (photos.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: photos.map(_buildReviewPhotoThumb).toList(),
                        ),
                      ],
                    ],
                  ),
                );
              }).toList(),
            ),
        ],
      ),
    );
  }
}
