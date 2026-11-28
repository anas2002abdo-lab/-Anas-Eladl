import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';

class RecipesHubScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final void Function(List<Map<String, dynamic>> selectedItems) onAddItemsToCart;

  const RecipesHubScreen({
    super.key,
    required this.api,
    required this.onAddItemsToCart,
  });

  @override
  State<RecipesHubScreen> createState() => _RecipesHubScreenState();
}

class _RecipesHubScreenState extends State<RecipesHubScreen> {
  static const Color _brandCrimson = Color(0xFFA92224);
  static const Color _canvasBg = Color(0xFFF6F7F9);

  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _searchDebounce;

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _recipes = [];
  List<String> _categories = [];
  String _selectedCategory = 'all';

  @override
  void initState() {
    super.initState();
    _loadRecipes();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadRecipes() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api.getRecipes(
        q: _searchCtrl.text.trim(),
        category: _selectedCategory,
      );
      if (!mounted) return;
      final list = ((res['recipes'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final cats = ((res['categories'] as List?) ?? [])
          .map((e) => e.toString())
          .where((e) => e.isNotEmpty)
          .toList();
      setState(() {
        _recipes = list;
        if (cats.isNotEmpty || _selectedCategory == 'all') {
          _categories = cats;
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'تعذر تحميل الوصفات حاليًا، حاول مرة أخرى';
        _loading = false;
      });
    }
  }

  void _onSearchChanged(String _) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      _loadRecipes();
    });
  }

  void _openRecipeDetail(Map<String, dynamic> recipe) {
    final id = (recipe['id'] ?? '').toString();
    if (id.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RecipeDetailScreen(
          api: widget.api,
          recipeId: id,
          initialTitle: (recipe['title_ar'] ?? '').toString(),
          onAddItemsToCart: (items) {
            widget.onAddItemsToCart(items);
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            }
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _canvasBg,
        appBar: AppBar(
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF0F172A),
          elevation: 0,
          scrolledUnderElevation: 1,
          title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'الوصفات الذكية',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFF0F172A),
                ),
              ),
              Text(
                'تسوّق المكونات الفعلية واطبخ خطوة بخطوة',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ),
        body: Column(
          children: [
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
              child: Column(
                children: [
                  TextField(
                    controller: _searchCtrl,
                    onChanged: _onSearchChanged,
                    decoration: InputDecoration(
                      hintText: 'ابحث عن وصفة أو أكلة...',
                      hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                      prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF64748B), size: 20),
                      suffixIcon: _searchCtrl.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.close_rounded, size: 18),
                              onPressed: () {
                                _searchCtrl.clear();
                                _loadRecipes();
                              },
                            )
                          : null,
                      filled: true,
                      fillColor: _canvasBg,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: _brandCrimson, width: 1.4),
                      ),
                    ),
                  ),
                  if (_categories.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 34,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          _buildCategoryItem('all', 'الكل'),
                          for (final cat in _categories) _buildCategoryItem(cat, cat),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1, color: Color(0xFFEAECEF)),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: _brandCrimson))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.wifi_off_rounded, size: 42, color: Color(0xFF94A3B8)),
                                const SizedBox(height: 10),
                                Text(
                                  _error!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF475569)),
                                ),
                                const SizedBox(height: 12),
                                ElevatedButton(
                                  onPressed: _loadRecipes,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: _brandCrimson,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                  ),
                                  child: const Text('إعادة المحاولة'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _recipes.isEmpty
                          ? const Center(
                              child: Text(
                                'لا توجد وصفات مطابقة لبحثك حاليًا',
                                style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF64748B)),
                              ),
                            )
                          : RefreshIndicator(
                              color: _brandCrimson,
                              onRefresh: _loadRecipes,
                              child: ListView.separated(
                                padding: const EdgeInsets.all(16),
                                itemCount: _recipes.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 14),
                                itemBuilder: (_, idx) => _buildRecipeCard(_recipes[idx]),
                              ),
                            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCategoryItem(String value, String label) {
    final selected = _selectedCategory == value;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 8),
      child: InkWell(
        onTap: () {
          setState(() => _selectedCategory = value);
          _loadRecipes();
        },
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? _brandCrimson : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? _brandCrimson : const Color(0xFFE2E8F0),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: selected ? Colors.white : const Color(0xFF334155),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRecipeCard(Map<String, dynamic> recipe) {
    final imgUrl = widget.api.resolveMediaUrl((recipe['image_url'] ?? '').toString());
    final title = (recipe['title_ar'] ?? '').toString();
    final desc = (recipe['description_ar'] ?? '').toString();
    final source = (recipe['source_name'] ?? 'مطبخ اطلبها').toString();
    final prepMinutes = int.tryParse('${recipe['prep_time_minutes'] ?? 30}') ?? 30;
    final servings = int.tryParse('${recipe['servings'] ?? 2}') ?? 2;
    final productsCount = int.tryParse('${recipe['products_count'] ?? 0}') ?? 0;
    final hasVideo = (recipe['video_url'] ?? '').toString().trim().isNotEmpty;

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openRecipeDetail(recipe),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFEAECEF)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (imgUrl.isNotEmpty)
                      Image.network(
                        imgUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _imageFallback(),
                      )
                    else
                      _imageFallback(),
                    Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.transparent,
                              Colors.black.withOpacity(0.55),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (hasVideo)
                      Positioned(
                        top: 10,
                        left: 10,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.72),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.play_circle_filled_rounded, color: Colors.white, size: 15),
                              SizedBox(width: 4),
                              Text(
                                'فيديو',
                                style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800),
                              ),
                            ],
                          ),
                        ),
                      ),
                    Positioned(
                      bottom: 10,
                      right: 12,
                      left: 12,
                      child: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (desc.isNotEmpty) ...[
                      Text(
                        desc,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5, color: Color(0xFF475569), height: 1.45),
                      ),
                      const SizedBox(height: 10),
                    ],
                    Row(
                      children: [
                        _metaInline(Icons.schedule_rounded, '$prepMinutes دقيقة'),
                        const SizedBox(width: 14),
                        _metaInline(Icons.people_outline_rounded, '$servings أشخاص'),
                        const SizedBox(width: 14),
                        _metaInline(Icons.shopping_basket_outlined, '$productsCount منتجات'),
                      ],
                    ),
                    const SizedBox(height: 10),
                    const Divider(height: 1, color: Color(0xFFF1F5F9)),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          source,
                          style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF64748B),
                          ),
                        ),
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'تسوّق المكونات',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w900,
                                color: _brandCrimson,
                              ),
                            ),
                            SizedBox(width: 4),
                            Icon(Icons.arrow_back_ios_new_rounded, size: 12, color: _brandCrimson),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _metaInline(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: _brandCrimson),
        const SizedBox(width: 4),
        Text(
          text,
          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Color(0xFF334155)),
        ),
      ],
    );
  }

  Widget _imageFallback() {
    return Container(
      color: const Color(0xFFF1F5F9),
      alignment: Alignment.center,
      child: const Icon(Icons.restaurant_menu_rounded, size: 40, color: Color(0xFF94A3B8)),
    );
  }
}

class _IngredientSelection {
  final String? productId;
  final int qty;
  final bool haveAtHome;
  final bool removed;

  const _IngredientSelection({
    required this.productId,
    required this.qty,
    required this.haveAtHome,
    required this.removed,
  });

  _IngredientSelection copyWith({
    String? productId,
    int? qty,
    bool? haveAtHome,
    bool? removed,
  }) {
    return _IngredientSelection(
      productId: productId ?? this.productId,
      qty: qty ?? this.qty,
      haveAtHome: haveAtHome ?? this.haveAtHome,
      removed: removed ?? this.removed,
    );
  }
}

class RecipeDetailScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String recipeId;
  final String initialTitle;
  final void Function(List<Map<String, dynamic>> selectedItems) onAddItemsToCart;

  const RecipeDetailScreen({
    super.key,
    required this.api,
    required this.recipeId,
    this.initialTitle = '',
    required this.onAddItemsToCart,
  });

  @override
  State<RecipeDetailScreen> createState() => _RecipeDetailScreenState();
}

class _RecipeDetailScreenState extends State<RecipeDetailScreen> {
  static const Color _brandCrimson = Color(0xFFA92224);
  static const Color _canvasBg = Color(0xFFF6F7F9);

  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _recipe;
  int _activeTab = 0; // 0 = تسوق المكونات, 1 = اطبخ خطوة بخطوة

  // Ingredient shopping state (preserved across tab switches)
  final Map<String, _IngredientSelection> _selections = {};

  // Step-by-step cooking state (preserved across tab switches)
  final Set<String> _completedSteps = {};
  final Map<String, int> _timerRemaining = {};
  final Set<String> _runningTimers = {};
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _loadDetail();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _runningTimers.isEmpty) return;
      final finished = <String>[];
      setState(() {
        for (final stepId in _runningTimers.toList()) {
          final rem = _timerRemaining[stepId] ?? 0;
          if (rem <= 1) {
            _timerRemaining[stepId] = 0;
            _runningTimers.remove(stepId);
            finished.add(stepId);
          } else {
            _timerRemaining[stepId] = rem - 1;
          }
        }
      });
      if (finished.isNotEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('انتهى وقت خطوة التحضير!'),
            backgroundColor: Color(0xFF059669),
            duration: Duration(seconds: 3),
          ),
        );
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _loadDetail() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api.getRecipeDetail(widget.recipeId);
      if (!mounted) return;
      final recipe = res['recipe'] is Map
          ? Map<String, dynamic>.from(res['recipe'] as Map)
          : Map<String, dynamic>.from(res);

      _selections.clear();
      _timerRemaining.clear();

      final groups = ((recipe['groups'] as List?) ?? []).whereType<Map>();
      for (final g in groups) {
        final ings = ((g['ingredients'] as List?) ?? []).whereType<Map>();
        for (final ing in ings) {
          final ingId = (ing['id'] ?? '').toString();
          final products = ((ing['products'] as List?) ?? [])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          final alts = ((ing['suggested_alternatives'] as List?) ?? [])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();

          Map<String, dynamic>? picked;
          final defProdId = (ing['default_product_id'] ?? '').toString();
          if (defProdId.isNotEmpty) {
            picked = products.cast<Map<String, dynamic>?>().firstWhere(
                  (p) => p != null && (p['product_id'] ?? '').toString() == defProdId && p['is_available'] == true,
                  orElse: () => null,
                );
          }
          for (final p in products) {
            if (picked != null) break;
            if (p['is_available'] == true && p['is_recommended'] == true) {
              picked = p;
              break;
            }
          }
          picked ??= products.cast<Map<String, dynamic>?>().firstWhere(
                (p) => p != null && p['is_available'] == true,
                orElse: () => null,
              );
          picked ??= alts.isNotEmpty ? alts.first : null;

          final defaultQtyRaw = double.tryParse('${picked?['default_qty'] ?? picked?['default_quantity'] ?? 1}') ?? 1;
          final defaultQty = defaultQtyRaw.ceil().clamp(1, 20);
          _selections[ingId] = _IngredientSelection(
            productId: picked != null ? (picked['product_id'] ?? '').toString() : null,
            qty: defaultQty,
            haveAtHome: false,
            removed: false,
          );
        }
      }

      final steps = ((recipe['steps'] as List?) ?? []).whereType<Map>();
      for (final s in steps) {
        final sid = (s['id'] ?? '').toString();
        final secs = int.tryParse('${s['timer_seconds'] ?? 0}') ?? 0;
        if (secs > 0) {
          _timerRemaining[sid] = secs;
        }
      }

      setState(() {
        _recipe = recipe;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'تعذر تحميل تفاصيل الوصفة، حاول مرة أخرى';
        _loading = false;
      });
    }
  }

  List<Map<String, dynamic>> _allOptionsForIngredient(Map<String, dynamic> ing) {
    final products = ((ing['products'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final alts = ((ing['suggested_alternatives'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final seen = <String>{};
    final out = <Map<String, dynamic>>[];
    for (final p in [...products, ...alts]) {
      final pid = (p['product_id'] ?? '').toString();
      if (pid.isNotEmpty && seen.add(pid)) {
        out.add(p);
      }
    }
    return out;
  }

  List<Map<String, dynamic>> _computeSelectedCartItems() {
    if (_recipe == null) return const [];
    final out = <Map<String, dynamic>>[];
    final groups = ((_recipe!['groups'] as List?) ?? []).whereType<Map>();
    for (final g in groups) {
      final ings = ((g['ingredients'] as List?) ?? []).whereType<Map>();
      for (final ing in ings) {
        final ingMap = Map<String, dynamic>.from(ing);
        final ingId = (ingMap['id'] ?? '').toString();
        final sel = _selections[ingId];
        if (sel == null || sel.haveAtHome || sel.removed || sel.productId == null || sel.qty <= 0) {
          continue;
        }
        final opts = _allOptionsForIngredient(ingMap);
        final prod = opts.cast<Map<String, dynamic>?>().firstWhere(
              (p) => p != null && (p['product_id'] ?? '').toString() == sel.productId && p['is_available'] == true,
              orElse: () => null,
            );
        if (prod == null) continue;
        out.add({
          'product': prod,
          'qty': sel.qty,
        });
      }
    }
    return out;
  }

  String _formatTimer(int seconds) {
    final s = seconds.clamp(0, 86400);
    final m = (s ~/ 60).toString().padLeft(2, '0');
    final r = (s % 60).toString().padLeft(2, '0');
    return '$m:$r';
  }

  Future<void> _openVideoUrl(String url) async {
    final uri = Uri.tryParse(url.trim());
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedItems = _computeSelectedCartItems();
    double totalPrice = 0;
    final storeIds = <String>{};
    for (final item in selectedItems) {
      final prod = item['product'] as Map<String, dynamic>;
      final qty = (item['qty'] as int?) ?? 1;
      final effPrice = double.tryParse('${prod['effective_price'] ?? prod['base_price'] ?? 0}') ?? 0;
      totalPrice += effPrice * qty;
      final mid = (prod['merchant_id'] ?? '').toString();
      if (mid.isNotEmpty) storeIds.add(mid);
    }

    final title = (_recipe?['title_ar'] ?? widget.initialTitle).toString();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _canvasBg,
        appBar: AppBar(
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF0F172A),
          elevation: 0,
          scrolledUnderElevation: 1,
          title: Text(
            title.isNotEmpty ? title : 'تفاصيل الوصفة',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w900),
          ),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: _brandCrimson))
            : _error != null || _recipe == null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error ?? 'الوصفة غير متوفرة', style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: _loadDetail,
                          style: ElevatedButton.styleFrom(backgroundColor: _brandCrimson, foregroundColor: Colors.white),
                          child: const Text('إعادة المحاولة'),
                        ),
                      ],
                    ),
                  )
                : Stack(
                    children: [
                      ListView(
                        padding: const EdgeInsets.only(bottom: 112),
                        children: [
                          _buildHeroHeader(_recipe!),
                          const SizedBox(height: 12),
                          _buildTabBar(_recipe!),
                          const SizedBox(height: 12),
                          if (_activeTab == 0)
                            _buildIngredientsTab(_recipe!)
                          else
                            _buildStepsTab(_recipe!),
                        ],
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: _buildBottomCartBar(selectedItems, totalPrice, storeIds.length),
                      ),
                    ],
                  ),
      ),
    );
  }

  Widget _buildHeroHeader(Map<String, dynamic> recipe) {
    final imgUrl = widget.api.resolveMediaUrl((recipe['image_url'] ?? '').toString());
    final videoUrl = (recipe['video_url'] ?? '').toString().trim();
    final title = (recipe['title_ar'] ?? '').toString();
    final desc = (recipe['description_ar'] ?? '').toString();
    final source = (recipe['source_name'] ?? 'مطبخ اطلبها').toString();
    final prep = int.tryParse('${recipe['prep_time_minutes'] ?? 30}') ?? 30;
    final servings = int.tryParse('${recipe['servings'] ?? 2}') ?? 2;
    final productsCount = int.tryParse('${recipe['products_count'] ?? 0}') ?? 0;

    return Container(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (imgUrl.isNotEmpty)
                  Image.network(
                    imgUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color: const Color(0xFFF1F5F9),
                      child: const Icon(Icons.restaurant_menu_rounded, size: 46, color: Color(0xFF94A3B8)),
                    ),
                  )
                else
                  Container(
                    color: const Color(0xFFF1F5F9),
                    child: const Icon(Icons.restaurant_menu_rounded, size: 46, color: Color(0xFF94A3B8)),
                  ),
                if (videoUrl.isNotEmpty)
                  Positioned(
                    bottom: 12,
                    left: 12,
                    child: ElevatedButton.icon(
                      onPressed: () => _openVideoUrl(videoUrl),
                      icon: const Icon(Icons.play_arrow_rounded, size: 18),
                      label: const Text('شاهد فيديو الوصفة', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.black.withOpacity(0.78),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  source,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: _brandCrimson),
                ),
                const SizedBox(height: 4),
                Text(
                  title,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                ),
                if (desc.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    desc,
                    style: const TextStyle(fontSize: 13, color: Color(0xFF475569), height: 1.5),
                  ),
                ],
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                  decoration: BoxDecoration(
                    color: _canvasBg,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFEAECEF)),
                  ),
                  child: Row(
                    children: [
                      Expanded(child: _metaTile(Icons.schedule_rounded, '$prep دقيقة', 'مدة التحضير')),
                      Container(width: 1, height: 28, color: const Color(0xFFE2E8F0)),
                      Expanded(child: _metaTile(Icons.people_outline_rounded, '$servings أشخاص', 'عدد الأفراد')),
                      Container(width: 1, height: 28, color: const Color(0xFFE2E8F0)),
                      Expanded(child: _metaTile(Icons.shopping_basket_outlined, '$productsCount منتجات', 'المطلوبة')),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _metaTile(IconData icon, String value, String label) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 15, color: _brandCrimson),
            const SizedBox(width: 4),
            Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
          ],
        ),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: Color(0xFF64748B))),
      ],
    );
  }

  Widget _buildTabBar(Map<String, dynamic> recipe) {
    final stepsCount = ((recipe['steps'] as List?) ?? []).length;
    final doneSteps = _completedSteps.length;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Expanded(
              child: _tabButton(
                index: 0,
                icon: Icons.shopping_cart_outlined,
                label: 'تسوق المكونات',
              ),
            ),
            Expanded(
              child: _tabButton(
                index: 1,
                icon: Icons.checklist_rounded,
                label: stepsCount > 0 ? 'اطبخ خطوة بخطوة ($doneSteps/$stepsCount)' : 'اطبخ خطوة بخطوة',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tabButton({required int index, required IconData icon, required String label}) {
    final active = _activeTab == index;
    return InkWell(
      onTap: () => setState(() => _activeTab = index),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 8),
        decoration: BoxDecoration(
          color: active ? _brandCrimson : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: active ? Colors.white : const Color(0xFF475569)),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  color: active ? Colors.white : const Color(0xFF334155),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildIngredientsTab(Map<String, dynamic> recipe) {
    final groups = ((recipe['groups'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final group in groups) ...[
            Padding(
              padding: const EdgeInsets.only(top: 6, bottom: 8),
              child: Text(
                (group['title_ar'] ?? 'المكونات').toString(),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
            ),
            for (final rawIng in ((group['ingredients'] as List?) ?? []).whereType<Map>())
              _buildIngredientCard(Map<String, dynamic>.from(rawIng)),
          ],
        ],
      ),
    );
  }

  Widget _buildIngredientCard(Map<String, dynamic> ing) {
    final ingId = (ing['id'] ?? '').toString();
    final nameAr = (ing['name_ar'] ?? '').toString();
    final qtyVal = ing['quantity'];
    final qtyText = qtyVal != null ? '$qtyVal' : '';
    final unitText = (ing['unit_ar'] ?? '').toString();
    final primaryUnavailable = ing['primary_unavailable'] == true;
    final options = _allOptionsForIngredient(ing);
    final sel = _selections[ingId] ??
        const _IngredientSelection(productId: null, qty: 1, haveAtHome: false, removed: false);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: sel.haveAtHome
              ? const Color(0xFFBBF7D0)
              : sel.removed
                  ? const Color(0xFFE2E8F0)
                  : const Color(0xFFEAECEF),
        ),
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
                    Text(
                      nameAr,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                        color: sel.haveAtHome || sel.removed
                            ? const Color(0xFF94A3B8)
                            : const Color(0xFF0F172A),
                        decoration: sel.haveAtHome ? TextDecoration.lineThrough : null,
                      ),
                    ),
                    if (qtyText.isNotEmpty || unitText.isNotEmpty)
                      Text(
                        '$qtyText $unitText'.trim(),
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFF64748B)),
                      ),
                  ],
                ),
              ),
              InkWell(
                onTap: () {
                  setState(() {
                    _selections[ingId] = sel.copyWith(haveAtHome: !sel.haveAtHome, removed: false);
                  });
                },
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: sel.haveAtHome ? const Color(0xFFDCFCE7) : _canvasBg,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: sel.haveAtHome ? const Color(0xFF16A34A) : const Color(0xFFE2E8F0),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        sel.haveAtHome ? Icons.check_circle_rounded : Icons.home_outlined,
                        size: 14,
                        color: sel.haveAtHome ? const Color(0xFF15803D) : const Color(0xFF475569),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'متوفر لديّ',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: sel.haveAtHome ? const Color(0xFF15803D) : const Color(0xFF334155),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (sel.haveAtHome)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'تم استبعاد هذا المكون من المشتريات لأنه متوفر لديك.',
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF15803D)),
              ),
            )
          else if (sel.removed)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'تم حذف هذا المكون من السلة',
                    style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                  ),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _selections[ingId] = sel.copyWith(removed: false);
                      });
                    },
                    child: const Text('إعادة إضافة', style: TextStyle(color: _brandCrimson, fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            )
          else ...[
            if (primaryUnavailable)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline_rounded, size: 15, color: Color(0xFFB45309)),
                    SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'المنتج الأساسي غير متوفر حاليًا — اخترنا لك بدائل مقترحة متوفرة في متاجر اطلبها',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF92400E)),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 10),
            if (options.isEmpty)
              const Text(
                'لا توجد منتجات متاحة حاليًا لهذا المكون.',
                style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
              )
            else
              Column(
                children: [
                  for (final prod in options) _buildProductOptionRow(ingId, prod, sel, options.length > 1),
                ],
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildProductOptionRow(
    String ingId,
    Map<String, dynamic> prod,
    _IngredientSelection sel,
    bool hasMultipleOptions,
  ) {
    final pid = (prod['product_id'] ?? '').toString();
    final available = prod['is_available'] == true;
    final selected = available && sel.productId == pid;
    final isRecommended = prod['is_recommended'] == true;
    final isAlternative = prod['is_alternative'] == true || prod['is_suggested_alternative'] == true;
    final isOffer = prod['is_offer'] == true;
    final basePrice = double.tryParse('${prod['base_price'] ?? 0}') ?? 0;
    final effPrice = double.tryParse('${prod['effective_price'] ?? basePrice}') ?? basePrice;
    final imgUrl = widget.api.resolveMediaUrl((prod['image_url'] ?? '').toString());
    final storeName = (prod['merchant_name'] ?? '').toString();
    final sizeLabel = (prod['size_label'] ?? '').toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: selected ? _brandCrimson.withOpacity(0.04) : _canvasBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: selected ? _brandCrimson : const Color(0xFFE2E8F0),
          width: selected ? 1.5 : 1,
        ),
      ),
      child: InkWell(
        onTap: available
            ? () {
                setState(() {
                  _selections[ingId] = sel.copyWith(productId: pid, removed: false, haveAtHome: false);
                });
              }
            : null,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(
                      width: 56,
                      height: 56,
                      child: imgUrl.isNotEmpty
                          ? Image.network(
                              imgUrl,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => _miniImgPlaceholder(),
                            )
                          : _miniImgPlaceholder(),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                (prod['name_ar'] ?? '').toString(),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w800,
                                  color: available ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
                                ),
                              ),
                            ),
                            if (available)
                              Icon(
                                selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                                size: 20,
                                color: selected ? _brandCrimson : const Color(0xFF94A3B8),
                              ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            if (storeName.isNotEmpty)
                              Text(
                                storeName,
                                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF475569)),
                              ),
                            if (sizeLabel.isNotEmpty)
                              Text(
                                '• $sizeLabel',
                                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                              ),
                            if (isRecommended && hasMultipleOptions && available)
                              const Text(
                                '• موصى به',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: _brandCrimson),
                              ),
                            if (isAlternative)
                              const Text(
                                '• بديل مقترح',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Color(0xFFB45309)),
                              ),
                            if (!available)
                              const Text(
                                '• غير متوفر حاليًا',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFFDC2626)),
                              ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Text(
                              '${effPrice.toStringAsFixed(effPrice.truncateToDouble() == effPrice ? 0 : 2)} ج.م',
                              style: const TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w900,
                                color: _brandCrimson,
                              ),
                            ),
                            if (isOffer && basePrice > effPrice) ...[
                              const SizedBox(width: 6),
                              Text(
                                '${basePrice.toStringAsFixed(basePrice.truncateToDouble() == basePrice ? 0 : 2)} ج.م',
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: Color(0xFF94A3B8),
                                  decoration: TextDecoration.lineThrough,
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
              if (selected) ...[
                const SizedBox(height: 8),
                const Divider(height: 1, color: Color(0xFFE2E8F0)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        _qtyBtn(
                          icon: Icons.remove_rounded,
                          onTap: () {
                            setState(() {
                              if (sel.qty <= 1) {
                                _selections[ingId] = sel.copyWith(removed: true);
                              } else {
                                _selections[ingId] = sel.copyWith(qty: sel.qty - 1);
                              }
                            });
                          },
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          child: Text(
                            '${sel.qty}',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900),
                          ),
                        ),
                        _qtyBtn(
                          icon: Icons.add_rounded,
                          onTap: () {
                            setState(() {
                              _selections[ingId] = sel.copyWith(qty: (sel.qty + 1).clamp(1, 20));
                            });
                          },
                        ),
                      ],
                    ),
                    TextButton.icon(
                      onPressed: () {
                        setState(() {
                          _selections[ingId] = sel.copyWith(removed: true);
                        });
                      },
                      icon: const Icon(Icons.delete_outline_rounded, size: 16, color: Color(0xFF64748B)),
                      label: const Text('حذف', style: TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _qtyBtn({required IconData icon, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 30,
        height: 30,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFCBD5E1)),
        ),
        child: Icon(icon, size: 16, color: const Color(0xFF0F172A)),
      ),
    );
  }

  Widget _miniImgPlaceholder() {
    return Container(
      color: const Color(0xFFE2E8F0),
      alignment: Alignment.center,
      child: const Icon(Icons.shopping_bag_outlined, size: 22, color: Color(0xFF94A3B8)),
    );
  }

  Widget _buildStepsTab(Map<String, dynamic> recipe) {
    final steps = ((recipe['steps'] as List?) ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final total = steps.length;
    final done = _completedSteps.length;
    final ratio = total > 0 ? (done / total).clamp(0.0, 1.0) : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFEAECEF)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'تقدم التحضير',
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                    ),
                    Text(
                      '$done من $total خطوات',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: _brandCrimson),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: ratio,
                    minHeight: 8,
                    backgroundColor: const Color(0xFFE2E8F0),
                    valueColor: const AlwaysStoppedAnimation<Color>(_brandCrimson),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < steps.length; i++) _buildStepCard(steps[i], i + 1),
        ],
      ),
    );
  }

  Widget _buildStepCard(Map<String, dynamic> step, int number) {
    final sid = (step['id'] ?? 'step_$number').toString();
    final title = (step['title_ar'] ?? '').toString();
    final instruction = (step['instruction_ar'] ?? '').toString();
    final initialSeconds = int.tryParse('${step['timer_seconds'] ?? 0}') ?? 0;
    final remaining = _timerRemaining[sid] ?? initialSeconds;
    final running = _runningTimers.contains(sid);
    final completed = _completedSteps.contains(sid);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: completed ? const Color(0xFFF0FDF4) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: completed ? const Color(0xFF86EFAC) : const Color(0xFFEAECEF),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () {
              setState(() {
                if (completed) {
                  _completedSteps.remove(sid);
                } else {
                  _completedSteps.add(sid);
                }
              });
            },
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: completed ? const Color(0xFF16A34A) : _brandCrimson.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  alignment: Alignment.center,
                  child: completed
                      ? const Icon(Icons.check_rounded, size: 17, color: Colors.white)
                      : Text(
                          '$number',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: _brandCrimson),
                        ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (title.isNotEmpty)
                        Text(
                          title,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w900,
                            color: completed ? const Color(0xFF15803D) : const Color(0xFF0F172A),
                            decoration: completed ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      if (instruction.isNotEmpty) ...[
                        if (title.isNotEmpty) const SizedBox(height: 4),
                        Text(
                          instruction,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.5,
                            color: completed ? const Color(0xFF166534) : const Color(0xFF334155),
                            decoration: completed ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (initialSeconds > 0) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: _canvasBg,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.timer_outlined,
                    size: 18,
                    color: running ? _brandCrimson : const Color(0xFF475569),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _formatTimer(remaining),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: running ? _brandCrimson : const Color(0xFF0F172A),
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        if (running) {
                          _runningTimers.remove(sid);
                        } else {
                          if ((_timerRemaining[sid] ?? 0) <= 0) {
                            _timerRemaining[sid] = initialSeconds;
                          }
                          _runningTimers.add(sid);
                        }
                      });
                    },
                    icon: Icon(
                      running ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      size: 18,
                      color: _brandCrimson,
                    ),
                    label: Text(
                      running ? 'إيقاف' : 'ابدأ المؤقت',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _brandCrimson),
                    ),
                  ),
                  IconButton(
                    tooltip: 'إعادة ضبط',
                    onPressed: () {
                      setState(() {
                        _runningTimers.remove(sid);
                        _timerRemaining[sid] = initialSeconds;
                      });
                    },
                    icon: const Icon(Icons.refresh_rounded, size: 18, color: Color(0xFF64748B)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBottomCartBar(List<Map<String, dynamic>> selectedItems, double totalPrice, int storesCount) {
    final count = selectedItems.length;
    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(context).padding.bottom + 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: Color(0xFFE2E8F0))),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${totalPrice.toStringAsFixed(totalPrice.truncateToDouble() == totalPrice ? 0 : 2)} ج.م',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                ),
                Text(
                  storesCount > 1
                      ? '$count منتجات من $storesCount متاجر'
                      : '$count منتجات مختارة',
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF64748B)),
                ),
              ],
            ),
          ),
          ElevatedButton.icon(
            onPressed: count == 0
                ? null
                : () {
                    widget.onAddItemsToCart(selectedItems);
                  },
            icon: const Icon(Icons.shopping_cart_checkout_rounded, size: 18),
            label: const Text(
              'أضف للسلة',
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w900),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: _brandCrimson,
              foregroundColor: Colors.white,
              disabledBackgroundColor: const Color(0xFFCBD5E1),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ],
      ),
    );
  }
}
