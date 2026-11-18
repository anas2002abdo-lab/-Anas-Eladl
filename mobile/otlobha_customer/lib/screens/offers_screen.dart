import 'dart:convert';
import 'package:flutter/material.dart';

class OffersScreen extends StatelessWidget {
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final Future<void> Function(String code) onApplyCoupon;

  const OffersScreen({
    super.key,
    required this.bootstrap,
    required this.cart,
    required this.onAddProduct,
    required this.onApplyCoupon,
  });

  Widget _buildProductThumb(String? rawUrl) {
    final url = (rawUrl ?? '').trim();
    const fallback = Icon(Icons.local_offer, color: Color(0xFFEA580C));
    if (url.isEmpty) {
      return Container(color: const Color(0xFFFFF7ED), child: fallback);
    }
    if (url.startsWith('data:image')) {
      final commaIdx = url.indexOf(',');
      if (commaIdx != -1) {
        try {
          return Image.memory(
            base64Decode(url.substring(commaIdx + 1)),
            fit: BoxFit.cover,
            width: 48,
            height: 48,
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
        width: 48,
        height: 48,
        errorBuilder: (_, __, ___) => fallback,
      );
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    final coupons = (bootstrap['coupons'] as List?) ?? [];
    final allCategories = (bootstrap['categories'] as List?) ?? [];
    final offersCategoryIds = allCategories
        .where((c) => c['is_offers_section'] == true || c['is_offers_section'] == 1)
        .map((c) => '${c['id']}')
        .toSet();
    final allProducts = (bootstrap['products'] as List?) ?? [];
    final discountedProducts = allProducts.where((p) {
      if (p['is_offer'] == true || p['is_offer'] == 1) return true;
      if (offersCategoryIds.contains('${p['category_id']}')) return true;
      final base = p['base_price'] as num?;
      final sale = p['sale_price'] as num?;
      return sale != null && base != null && sale < base;
    }).toList();
    final promoNotifs = ((bootstrap['notifications'] as List?) ?? [])
        .where((n) => n['category'] == 'promo')
        .toList();

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const Text('أكواد الخصم الفعالة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (coupons.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(14),
              child: Text('لا توجد كوبونات فعالة حاليًا', style: TextStyle(color: Colors.grey)),
            ),
          )
        else
          ...coupons.map((c) {
            final isPct = c['discount_type'] == 'percentage';
            return Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF7ED),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFFDBA74)),
                          ),
                          child: Text(
                            '${c['code']}',
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFC2410C)),
                          ),
                        ),
                        Text(
                          isPct ? 'خصم ${c['discount_value']}%' : 'خصم ${c['discount_value']} ج.م',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0D9488)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'الحد الأدنى للطلب: ${c['min_order_amount']} ج.م · بحد أقصى ${c['max_discount']} ج.م',
                      style: const TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0F172A),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(42),
                        ),
                        onPressed: () => onApplyCoupon('${c['code']}'),
                        child: const Text('تطبيق الكود في السلة'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        const SizedBox(height: 14),
        Text('عروض المتاجر والمنتجات (${discountedProducts.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (discountedProducts.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(14),
              child: Text('لا توجد عروض منتجات حاليًا', style: TextStyle(color: Colors.grey)),
            ),
          )
        else
          ...discountedProducts.map((p) {
            final qty = cart[p['id']] ?? 0;
            final base = (p['base_price'] as num).toDouble();
            final saleNum = p['sale_price'] as num?;
            final hasPctDiscount = saleNum != null && saleNum.toDouble() < base && base > 0;
            final finalPrice = saleNum != null ? saleNum.toDouble() : base;
            final pct = hasPctDiscount ? (((base - finalPrice) / base) * 100).round() : 0;
            return Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                leading: SizedBox(
                  width: 48,
                  height: 48,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: _buildProductThumb('${p['image_url'] ?? ''}'),
                  ),
                ),
                title: Row(
                  children: [
                    Expanded(
                      child: Text(p['name_ar'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: const Color(0xFFE11D48), borderRadius: BorderRadius.circular(6)),
                      child: Text(
                        hasPctDiscount ? '-$pct%' : 'عرض المتجر',
                        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                subtitle: Text(
                  hasPctDiscount
                      ? '${p['merchant_name'] ?? ''}\n${finalPrice.toStringAsFixed(0)} ج.م  (بدلًا من ${base.toStringAsFixed(0)} ج.م)'
                      : '${p['merchant_name'] ?? ''}\n${finalPrice.toStringAsFixed(0)} ج.م',
                  style: const TextStyle(fontSize: 12),
                ),
                isThreeLine: true,
                trailing: qty == 0
                    ? ElevatedButton(
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                        onPressed: () => onAddProduct(p as Map<String, dynamic>, 1),
                        child: const Text('+ أضف'),
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            onPressed: () => onAddProduct(p as Map<String, dynamic>, -1),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                          Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold)),
                          IconButton(
                            onPressed: () => onAddProduct(p as Map<String, dynamic>, 1),
                            icon: const Icon(Icons.add_circle, color: Color(0xFFEA580C)),
                          ),
                        ],
                      ),
              ),
            );
          }),
        if (promoNotifs.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('إشعارات العروض', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ...promoNotifs.take(4).map((n) => Card(
                child: ListTile(
                  leading: const Icon(Icons.campaign, color: Color(0xFFEA580C)),
                  title: Text(n['title_ar'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  subtitle: Text(n['body_ar'] ?? '', style: const TextStyle(fontSize: 12)),
                ),
              )),
        ],
      ],
    );
  }
}
