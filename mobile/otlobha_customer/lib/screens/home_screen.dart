import 'package:flutter/material.dart';

class HomeScreen extends StatefulWidget {
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
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
    required this.bootstrap,
    required this.cart,
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
  String _searchQuery = '';
  String _selectedCatId = 'all';
  String? _flashingServiceKey;

  void _triggerServiceTap(String key, VoidCallback action) {
    setState(() => _flashingServiceKey = key);
    Future.delayed(const Duration(milliseconds: 230), () {
      if (!mounted) return;
      setState(() => _flashingServiceKey = null);
      action();
    });
  }

  @override
  Widget build(BuildContext context) {
    final services = (widget.bootstrap['services'] as List?) ?? [];
    final serviceMap = {for (var s in services) s['service_key']: s};
    final categories = ((widget.bootstrap['categories'] as List?) ?? [])
        .where((c) => c['scope'] != 'market')
        .toList();
    final allProducts = (widget.bootstrap['products'] as List?) ?? [];
    final pendingRatings = (widget.bootstrap['pending_ratings'] as List?) ?? [];

    final filteredProducts = allProducts.where((p) {
      final matchesCat = _selectedCatId == 'all' || p['category_id'] == _selectedCatId;
      if (!matchesCat) return false;
      if (_searchQuery.trim().isEmpty) return true;
      final q = _searchQuery.trim().toLowerCase();
      return (p['name_ar'] ?? '').toString().toLowerCase().contains(q) ||
          (p['merchant_name'] ?? '').toString().toLowerCase().contains(q);
    }).toList();

    int totalQty = 0;
    double totalEgp = 0;
    for (final p in allProducts) {
      final q = widget.cart[p['id']] ?? 0;
      if (q > 0) {
        totalQty += q;
        totalEgp += ((p['sale_price'] ?? p['base_price']) as num).toDouble() * q;
      }
    }

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
          child: ListView(
            padding: const EdgeInsets.all(14),
            children: [
              TextField(
                onChanged: (v) => setState(() => _searchQuery = v),
                decoration: InputDecoration(
                  hintText: 'ابحث عن منتج، وجبة، دواء، أو متجر في المنزلة...',
                  prefixIcon: const Icon(Icons.search),
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
                  const Text('المنتجات المتوفرة للطلب الفوري', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
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
                        onSelected: (_) => setState(() => _selectedCatId = 'all'),
                      ),
                    ),
                    ...categories.map((c) => Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: ChoiceChip(
                            label: Text(c['name_ar']),
                            selected: _selectedCatId == c['id'],
                            onSelected: (_) => setState(() => _selectedCatId = c['id']),
                          ),
                        )),
                  ],
                ),
              ),
              const SizedBox(height: 12),

              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: filteredProducts.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 0.78,
                ),
                itemBuilder: (_, i) {
                  final p = filteredProducts[i] as Map<String, dynamic>;
                  final qty = widget.cart[p['id']] ?? 0;
                  final finalPrice = p['sale_price'] ?? p['base_price'];
                  final requiresRx = p['requires_prescription'] == true;
                  return Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.grey.shade300),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          height: 82,
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: Colors.grey.shade100,
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
                          ),
                          child: Center(
                            child: Icon(
                              requiresRx ? Icons.medication : Icons.shopping_basket_outlined,
                              size: 32,
                              color: requiresRx ? const Color(0xFF0D9488) : const Color(0xFFEA580C),
                            ),
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
                                      p['merchant_name'] ?? '',
                                      style: const TextStyle(fontSize: 10, color: Color(0xFFEA580C), fontWeight: FontWeight.w600),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      p['name_ar'] ?? '',
                                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text('$finalPrice ج.م', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                    if (requiresRx)
                                      InkWell(
                                        onTap: () => widget.onOpenService('pharmacy'),
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                                          decoration: BoxDecoration(color: const Color(0xFF0D9488), borderRadius: BorderRadius.circular(8)),
                                          child: const Text('روشتة', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                                        ),
                                      )
                                    else if (qty == 0)
                                      InkWell(
                                        onTap: () => widget.onAddProduct(p, 1),
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                          decoration: BoxDecoration(color: const Color(0xFFEA580C), borderRadius: BorderRadius.circular(8)),
                                          child: const Text('+ أضف', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                                        ),
                                      )
                                    else
                                      Row(
                                        children: [
                                          InkWell(
                                            onTap: () => widget.onAddProduct(p, -1),
                                            child: const Icon(Icons.remove_circle_outline, size: 20),
                                          ),
                                          Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: 4),
                                            child: Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                          ),
                                          InkWell(
                                            onTap: () => widget.onAddProduct(p, 1),
                                            child: const Icon(Icons.add_circle, size: 20, color: Color(0xFFEA580C)),
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
                  );
                },
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
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                  onPressed: widget.onOpenCart,
                  child: const Text('مراجعة السلة'),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
