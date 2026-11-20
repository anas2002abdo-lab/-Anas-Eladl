import 'package:flutter/material.dart';
import '../core/api_client.dart';

class StorefrontCategoriesScreen extends StatefulWidget {
  final List<Map<String, dynamic>> categories;
  final String zoneName;
  final VoidCallback onOpenSearch;
  final void Function(Map<String, dynamic> category) onSelectCategory;
  final void Function(String groupKey) onSelectGroup;

  const StorefrontCategoriesScreen({
    super.key,
    required this.categories,
    required this.zoneName,
    required this.onOpenSearch,
    required this.onSelectCategory,
    required this.onSelectGroup,
  });

  @override
  State<StorefrontCategoriesScreen> createState() => _StorefrontCategoriesScreenState();
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

class _StorefrontCategoriesScreenState extends State<StorefrontCategoriesScreen> {
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

  final List<Map<String, dynamic>> _trail = [];

  String _idOf(Map<String, dynamic> c) => (c['id'] ?? '').toString().trim();

  String _parentIdOf(Map<String, dynamic> c) => (c['parent_id'] ?? '').toString().trim();

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

  void _handleCategoryTap(Map<String, dynamic> cat) {
    final children = _childrenOf(_idOf(cat));
    if (children.isNotEmpty) {
      setState(() => _trail.add(cat));
    } else {
      widget.onSelectCategory(cat);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentParent = _trail.isNotEmpty ? _trail.last : null;
    final currentChildren = currentParent != null ? _childrenOf(_idOf(currentParent)) : <Map<String, dynamic>>[];

    return Container(
      color: const Color(0xFFF6F7F9),
      child: Column(
        children: [
          // Top Search + Context Header
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (currentParent != null) ...[
                      InkWell(
                        onTap: () => setState(() => _trail.removeLast()),
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: Color(0xFF0F172A)),
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            currentParent != null
                                ? (currentParent['name_ar'] ?? 'القسم').toString()
                                : 'جميع الأقسام والتصنيفات',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16.5,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                          const SizedBox(height: 2),
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
                    InkWell(
                      onTap: widget.onOpenSearch,
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFFECACA)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.search_rounded, size: 18, color: Color(0xFFA92224)),
                            SizedBox(width: 5),
                            Text(
                              'بحث ذكي',
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

                // Interactive RTL Breadcrumb
                if (_trail.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _breadcrumbChip(
                          label: 'الأقسام الرئيسية',
                          isActive: false,
                          onTap: () => setState(() => _trail.clear()),
                        ),
                        for (int i = 0; i < _trail.length; i++) ...[
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 4),
                            child: Icon(Icons.chevron_left_rounded, size: 16, color: Color(0xFF94A3B8)),
                          ),
                          _breadcrumbChip(
                            label: (_trail[i]['name_ar'] ?? '').toString(),
                            isActive: i == _trail.length - 1,
                            onTap: i == _trail.length - 1
                                ? null
                                : () => setState(() => _trail.removeRange(i + 1, _trail.length)),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Body
          Expanded(
            child: widget.categories.isEmpty
                ? _buildEmptyState()
                : currentParent != null
                    ? _buildSubcategoryView(currentParent, currentChildren)
                    : _buildRootGroupedView(),
          ),
        ],
      ),
    );
  }

  Widget _breadcrumbChip({
    required String label,
    required bool isActive,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFFA92224) : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: isActive ? Colors.white : const Color(0xFF334155),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
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

  Widget _buildSubcategoryView(Map<String, dynamic> parent, List<Map<String, dynamic>> children) {
    final totalProducts = (parent['products_count'] as num?)?.toInt() ?? 0;
    final fullPath = (parent['full_path_ar'] ?? parent['name_ar'] ?? '').toString().trim();

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
      children: [
        // Crimson CTA Banner to view ALL products inside this parent category
        InkWell(
          onTap: () => widget.onSelectCategory(parent),
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.centerRight,
                end: Alignment.centerLeft,
                colors: [Color(0xFFA92224), Color(0xFF86191B)],
              ),
              borderRadius: BorderRadius.circular(18),
              boxShadow: const [
                BoxShadow(color: Color(0x28A92224), blurRadius: 12, offset: Offset(0, 4)),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.16),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(Icons.storefront_rounded, color: Color(0xFFF5A623), size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'عرض كل منتجات ${parent['name_ar'] ?? ''}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        totalProducts > 0
                            ? '$totalProducts منتج متاح · $fullPath'
                            : fullPath,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFFDE68A),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
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
        const SizedBox(height: 16),
        Row(
          children: [
            const Text(
              'الأقسام الفرعية',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '${children.length}',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFFA92224),
                ),
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
            childAspectRatio: 0.78,
          ),
          itemCount: children.length,
          itemBuilder: (_, idx) => _buildCategoryTile(children[idx], accent: const Color(0xFFA92224)),
        ),
      ],
    );
  }

  Widget _buildRootGroupedView() {
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
          childAspectRatio: 0.78,
        ),
        itemCount: roots.length,
        itemBuilder: (_, idx) => _buildCategoryTile(roots[idx], accent: const Color(0xFFA92224)),
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
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: meta.bg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(meta.icon, size: 17, color: meta.accent),
                ),
                const SizedBox(width: 8),
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
                TextButton(
                  onPressed: () => widget.onSelectGroup(meta.key),
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
                childAspectRatio: 0.78,
              ),
              itemCount: cats.length,
              itemBuilder: (_, cIdx) => _buildCategoryTile(
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

  Widget _buildCategoryTile(
    Map<String, dynamic> cat, {
    required Color accent,
    Color fallbackBg = const Color(0xFFFEF2F2),
    IconData fallbackIcon = Icons.category_rounded,
  }) {
    final name = (cat['name_ar'] ?? '').toString().trim();
    final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(cat['image_url']);
    final childrenCount = _childrenOf(_idOf(cat)).length;
    final productsCount = (cat['products_count'] as num?)?.toInt() ?? 0;

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () => _handleCategoryTap(cat),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
            boxShadow: const [
              BoxShadow(color: Color(0x080F172A), blurRadius: 8, offset: Offset(0, 2)),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: Container(
                        decoration: BoxDecoration(
                          color: fallbackBg,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: imgUrl.isNotEmpty
                            ? Image.network(
                                imgUrl,
                                fit: BoxFit.cover,
                                cacheWidth: 220,
                                errorBuilder: (_, __, ___) => Center(
                                  child: Icon(fallbackIcon, size: 28, color: accent),
                                ),
                              )
                            : Center(
                                child: Icon(fallbackIcon, size: 28, color: accent),
                              ),
                      ),
                    ),
                    if (childrenCount > 0)
                      Positioned(
                        top: 4,
                        right: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFA92224),
                            borderRadius: BorderRadius.circular(7),
                          ),
                          child: Text(
                            '$childrenCount فرعي',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 8.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      )
                    else if (productsCount > 0)
                      Positioned(
                        top: 4,
                        right: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.92),
                            borderRadius: BorderRadius.circular(7),
                          ),
                          child: Text(
                            '$productsCount',
                            style: const TextStyle(
                              color: Color(0xFF0F172A),
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Text(
                name,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF0F172A),
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
