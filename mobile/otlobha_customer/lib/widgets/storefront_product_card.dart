import 'package:flutter/material.dart';
import '../core/api_client.dart';

class StorefrontProductCardWidget extends StatelessWidget {
  final Map<String, dynamic> product;
  final int cartQty;
  final VoidCallback onTapDetails;
  final VoidCallback onAdd;
  final VoidCallback onDecrement;

  const StorefrontProductCardWidget({
    super.key,
    required this.product,
    required this.cartQty,
    required this.onTapDetails,
    required this.onAdd,
    required this.onDecrement,
  });

  double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse((v ?? '').toString()) ?? 0;
  }

  String _formatPrice(double value) {
    if (value == value.roundToDouble()) return value.toInt().toString();
    return value.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    final basePrice = _toDouble(product['base_price']);
    final rawSale = product['sale_price'];
    final salePrice = rawSale != null ? _toDouble(rawSale) : null;
    final hasDiscount = salePrice != null && salePrice > 0 && salePrice < basePrice;
    final effPrice = product['effective_price'] != null
        ? _toDouble(product['effective_price'])
        : (hasDiscount ? salePrice : basePrice);
    final rawPct = (product['discount_percent'] as num?)?.toInt() ?? 0;
    final discountPct = rawPct > 0
        ? rawPct
        : (hasDiscount && basePrice > 0
            ? (((basePrice - effPrice) / basePrice) * 100).round()
            : 0);
    final isOffer = product['is_offer'] == true || product['is_offer'] == 1;
    final storesCount = (product['stores_count'] as num?)?.toInt() ?? 1;
    final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(product['image_url']);
    final brand = (product['brand'] ?? '').toString().trim();
    final categoryName = (product['category_name'] ?? '').toString().trim();
    final sizeLabel = (product['size_label'] ?? '').toString().trim();
    final merchantName = (product['merchant_name'] ?? '').toString().trim();
    final nameAr = (product['name_ar'] ?? '').toString().trim();
    final activeDeal = product['active_deal'] is Map
        ? Map<String, dynamic>.from(product['active_deal'] as Map)
        : null;
    final activeDealTitle = (activeDeal?['title_ar'] ?? '').toString().trim();

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEAECEF)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D0F172A),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Large, crisp square product image stage + single disciplined ribbon + floating quick add
          GestureDetector(
            onTap: onTapDetails,
            child: AspectRatio(
              aspectRatio: 1.0,
              child: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0xFFFAFAFA), Color(0xFFF3F4F6)],
                  ),
                ),
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: Padding(
                        padding: const EdgeInsets.all(6),
                        child: imgUrl.isNotEmpty
                            ? Image.network(
                                imgUrl,
                                fit: BoxFit.contain,
                                cacheWidth: 420,
                                errorBuilder: (_, __, ___) => _imageFallback(),
                              )
                            : _imageFallback(),
                      ),
                    ),
                    if (discountPct > 0)
                      Positioned(
                        top: 9,
                        right: 9,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFA92224),
                            borderRadius: BorderRadius.circular(10),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x33A92224),
                                blurRadius: 8,
                                offset: Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Text(
                            'خصم $discountPct%',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      )
                    else if (isOffer)
                      Positioned(
                        top: 9,
                        right: 9,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF5A623),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Text(
                            'عرض',
                            style: TextStyle(
                              color: Color(0xFF3B180E),
                              fontSize: 10.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                    // Floating Quick Add (+) / Stepper (Bottom-Left in RTL)
                    Positioned(
                      bottom: 9,
                      left: 9,
                      child: cartQty > 0
                          ? Container(
                              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3.5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFA92224),
                                borderRadius: BorderRadius.circular(28),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0x40A92224),
                                    blurRadius: 12,
                                    offset: Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  InkWell(
                                    onTap: onAdd,
                                    borderRadius: BorderRadius.circular(16),
                                    child: Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: Colors.white.withOpacity(0.2),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.add, size: 16, color: Colors.white),
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    child: Text(
                                      '$cartQty',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                  InkWell(
                                    onTap: onDecrement,
                                    borderRadius: BorderRadius.circular(16),
                                    child: Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: Colors.white.withOpacity(0.2),
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.remove, size: 16, color: Colors.white),
                                    ),
                                  ),
                                ],
                              ),
                            )
                          : Material(
                              color: Colors.white,
                              shape: const CircleBorder(),
                              elevation: 4,
                              shadowColor: const Color(0x260F172A),
                              child: InkWell(
                                customBorder: const CircleBorder(),
                                onTap: onAdd,
                                child: Container(
                                  width: 38,
                                  height: 38,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: const Color(0xFFE2E8F0)),
                                  ),
                                  child: const Icon(
                                    Icons.add_rounded,
                                    size: 22,
                                    color: Color(0xFFA92224),
                                  ),
                                ),
                              ),
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Product Metadata & Price (clean unboxed hierarchy)
          Expanded(
            child: InkWell(
              onTap: onTapDetails,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(11, 9, 11, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                brand.isNotEmpty
                                    ? brand
                                    : (categoryName.isNotEmpty ? categoryName : 'اطلبها'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFFA92224),
                                ),
                              ),
                            ),
                            if (sizeLabel.isNotEmpty) ...[
                              const SizedBox(width: 5),
                              Text(
                                sizeLabel,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF64748B),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          nameAr,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF0F172A),
                            height: 1.25,
                          ),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text(
                              _formatPrice(effPrice),
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            const SizedBox(width: 3),
                            const Text(
                              'ج.م',
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF475569),
                              ),
                            ),
                            if (hasDiscount) ...[
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  _formatPrice(basePrice),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: Color(0xFF94A3B8),
                                    decoration: TextDecoration.lineThrough,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 5),
                        Container(
                          padding: const EdgeInsets.only(top: 5),
                          decoration: const BoxDecoration(
                            border: Border(top: BorderSide(color: Color(0xFFF1F5F9))),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.storefront_outlined, size: 12, color: Color(0xFF94A3B8)),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  merchantName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF64748B),
                                  ),
                                ),
                              ),
                              if (storesCount > 1) ...[
                                const SizedBox(width: 4),
                                Text(
                                  '$storesCount متاجر',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w900,
                                    color: Color(0xFF047857),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (activeDealTitle.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.card_giftcard_rounded, size: 11.5, color: Color(0xFFD97706)),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  activeDealTitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF86191B),
                                  ),
                                ),
                              ),
                            ],
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
    );
  }

  Widget _imageFallback() {
    return Center(
      child: Container(
        width: 64,
        height: 64,
        decoration: BoxDecoration(
          color: const Color(0xFFFEF2F2),
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Icon(
          Icons.inventory_2_outlined,
          size: 32,
          color: Color(0xFFA92224),
        ),
      ),
    );
  }
}
