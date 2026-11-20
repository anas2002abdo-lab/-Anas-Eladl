import 'package:flutter/material.dart';
import '../core/api_client.dart';

class CartScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final Map<String, Map<String, dynamic>> cartProductsCache;
  final String selectedMerchantId;
  final String selectedZoneId;
  final String customerName;
  final String customerPhone;
  final String addressLandmark;
  final String orderChannel; // 'catalog' | 'free_text'
  final String couponCode;
  final double appliedDiscount;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final void Function(String merchantId) onSelectMerchant;
  final void Function(String zoneId) onSelectZone;
  final void Function(String channel) onSelectChannel;
  final void Function(String code, double discount) onApplyCouponState;
  final VoidCallback onClearCart;
  final Future<void> Function() onOrderPlaced;
  final VoidCallback onBrowseHome;
  final bool isGuest;
  final VoidCallback? onRequireAuth;

  const CartScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    this.cartProductsCache = const {},
    required this.selectedMerchantId,
    required this.selectedZoneId,
    required this.customerName,
    required this.customerPhone,
    required this.addressLandmark,
    required this.orderChannel,
    required this.couponCode,
    required this.appliedDiscount,
    required this.onAddProduct,
    required this.onSelectMerchant,
    required this.onSelectZone,
    required this.onSelectChannel,
    required this.onApplyCouponState,
    required this.onClearCart,
    required this.onOrderPlaced,
    required this.onBrowseHome,
    this.isGuest = false,
    this.onRequireAuth,
  });

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final TextEditingController _freeTextCtrl = TextEditingController();
  late final TextEditingController _couponCtrl = TextEditingController(text: widget.couponCode);
  bool _isExpress = false;
  bool _submitting = false;

  @override
  void didUpdateWidget(covariant CartScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.couponCode != widget.couponCode && _couponCtrl.text != widget.couponCode) {
      _couponCtrl.text = widget.couponCode;
    }
  }

  @override
  Widget build(BuildContext context) {
    final allProducts = (widget.bootstrap['products'] as List?) ?? [];
    final merchants = ((widget.bootstrap['merchants'] as List?) ?? [])
        .where((m) => m['merchant_type'] != 'pharmacy')
        .toList();
    final zones = (widget.bootstrap['zones'] as List?) ?? [];

    final effectiveMerchantId = merchants.any((m) => m['id'] == widget.selectedMerchantId)
        ? widget.selectedMerchantId
        : (merchants.isNotEmpty ? merchants.first['id'] as String : '');

    final effectiveZoneId = zones.any((z) => z['id'] == widget.selectedZoneId)
        ? widget.selectedZoneId
        : (zones.isNotEmpty ? zones.first['id'] as String : 'zn_city_center');

    final selectedZone = zones.firstWhere((z) => z['id'] == effectiveZoneId, orElse: () => {'name_ar': 'وسط مدينة المنزلة', 'remote_area_fee': 0});

    final bootstrapProductById = <String, Map<String, dynamic>>{};
    for (final p in allProducts) {
      if (p is Map && p['id'] != null) {
        bootstrapProductById[p['id'].toString()] = Map<String, dynamic>.from(p);
      }
    }

    final cartItems = <Map<String, dynamic>>[];
    final merchantGroups = <String, Map<String, dynamic>>{};
    double subtotal = 0;
    for (final entry in widget.cart.entries) {
      final qty = entry.value;
      if (qty <= 0) continue;
      final p = widget.cartProductsCache[entry.key] ?? bootstrapProductById[entry.key];
      if (p == null) continue;
      final unit = ((p['sale_price'] ?? p['base_price']) as num).toDouble();
      subtotal += unit * qty;
      final itemMap = {'product': p, 'qty': qty, 'unit': unit};
      cartItems.add(itemMap);
      final mId = (p['merchant_id'] ?? effectiveMerchantId).toString();
      merchantGroups.putIfAbsent(mId, () => {
        'merchant_id': mId,
        'merchant_name': (p['merchant_name'] ?? 'متجر في اطلبها').toString(),
        'items': <Map<String, dynamic>>[],
        'subtotal': 0.0,
      });
      (merchantGroups[mId]!['items'] as List<Map<String, dynamic>>).add(itemMap);
      merchantGroups[mId]!['subtotal'] = (merchantGroups[mId]!['subtotal'] as double) + unit * qty;
    }

    final remoteFee = ((selectedZone['remote_area_fee'] ?? 0) as num).toDouble();
    final singleDelivery = 15 + remoteFee + (_isExpress ? 10 : 0);
    final extraStoreCount = widget.orderChannel == 'catalog' && merchantGroups.length > 1 ? merchantGroups.length - 1 : 0;
    final deliveryEstimate = singleDelivery + extraStoreCount * 5.0;
    final effectiveSubtotal = widget.orderChannel == 'catalog' ? subtotal : 150.0;
    final totalEstimate = (effectiveSubtotal + deliveryEstimate - widget.appliedDiscount).clamp(0, 999999);

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        Row(
          children: [
            Expanded(
              child: ChoiceChip(
                label: const Center(child: Text('سلة المنتجات')),
                selected: widget.orderChannel == 'catalog',
                onSelected: (_) => widget.onSelectChannel('catalog'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ChoiceChip(
                label: const Center(child: Text('طلب نصي حر')),
                selected: widget.orderChannel != 'catalog',
                onSelected: (_) => widget.onSelectChannel('free_text'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (widget.orderChannel != 'catalog' && merchants.isNotEmpty) ...[
          DropdownButtonFormField<String>(
            value: effectiveMerchantId,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'المتجر المستلم للطلب الحر'),
            items: merchants
                .map((m) => DropdownMenuItem<String>(
                      value: m['id'] as String,
                      child: Text('${m['business_name_ar']}'),
                    ))
                .toList(),
            onChanged: (v) {
              if (v != null) widget.onSelectMerchant(v);
            },
          ),
          const SizedBox(height: 10),
        ],
        if (zones.isNotEmpty)
          DropdownButtonFormField<String>(
            value: effectiveZoneId,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'منطقة التوصيل'),
            items: zones
                .map((z) => DropdownMenuItem<String>(
                      value: z['id'] as String,
                      child: Text('${z['name_ar']} (+${z['remote_area_fee']} ج.م)'),
                    ))
                .toList(),
            onChanged: (v) {
              if (v != null) widget.onSelectZone(v);
            },
          ),
        const SizedBox(height: 12),
        if (widget.orderChannel == 'catalog') ...[
          if (cartItems.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    const Icon(Icons.shopping_cart_outlined, size: 42, color: Colors.grey),
                    const SizedBox(height: 8),
                    const Text('السلة فارغة حاليًا', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                      onPressed: widget.onBrowseHome,
                      child: const Text('تصفح المنتجات الآن'),
                    ),
                  ],
                ),
              ),
            )
          else
            Card(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('محتويات السلة (${cartItems.length})', style: const TextStyle(fontWeight: FontWeight.bold)),
                            if (merchantGroups.length > 1)
                              Text(
                                'تضم ${merchantGroups.length} متاجر / أقسام مختلفة',
                                style: const TextStyle(fontSize: 11, color: Color(0xFF0D9488), fontWeight: FontWeight.w600),
                              ),
                          ],
                        ),
                        TextButton(onPressed: widget.onClearCart, child: const Text('إفراغ السلة', style: TextStyle(color: Colors.red))),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  ...merchantGroups.values.expand((grp) {
                    final grpItems = grp['items'] as List<Map<String, dynamic>>;
                    final grpSubtotal = grp['subtotal'] as double;
                    return [
                      Container(
                        width: double.infinity,
                        color: const Color(0xFFF8FAFC),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('${grp['merchant_name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Color(0xFF0F172A))),
                            Text('${grpSubtotal.toStringAsFixed(0)} ج.م', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          ],
                        ),
                      ),
                      ...grpItems.map((item) {
                        final p = item['product'] as Map<String, dynamic>;
                        final qty = item['qty'] as int;
                        final unit = item['unit'] as double;
                        return ListTile(
                          title: Text('${p['name_ar']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          subtitle: Text('${p['category_name'] ?? ''} · ${unit.toStringAsFixed(0)} ج.م للقطعة'),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                onPressed: () => widget.onAddProduct(p, -1),
                                icon: const Icon(Icons.remove_circle_outline),
                              ),
                              Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold)),
                              IconButton(
                                onPressed: () => widget.onAddProduct(p, 1),
                                icon: const Icon(Icons.add_circle, color: Color(0xFFEA580C)),
                              ),
                            ],
                          ),
                        );
                      }),
                    ];
                  }),
                ],
              ),
            ),
        ] else
          TextField(
            controller: _freeTextCtrl,
            maxLines: 4,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'اكتب طلبك الحر',
              hintText: 'مثال: 2 كيلو طماطم + كيلو خيار + عيش بلدي...',
            ),
          ),
        const SizedBox(height: 10),
        SwitchListTile(
          value: _isExpress,
          onChanged: (v) => setState(() => _isExpress = v),
          title: const Text('توصيل مستعجل Express (+10 ج.م)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
        ),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _couponCtrl,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'كود الخصم (مثال: MANZALA20)'),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(minimumSize: const Size(84, 54)),
              onPressed: () async {
                try {
                  final res = await widget.api.validateCoupon(_couponCtrl.text.trim(), effectiveSubtotal > 0 ? effectiveSubtotal : 150, 'stores');
                  widget.onApplyCouponState('${res['code']}', (res['discount_amount'] as num).toDouble());
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('تم تطبيق كوبون ${res['code']} بخصم ${res['discount_amount']} ج.م')),
                    );
                  }
                } catch (e) {
                  widget.onApplyCouponState('', 0);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                  }
                }
              },
              child: const Text('تطبيق'),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(widget.orderChannel == 'catalog' ? 'إجمالي المنتجات' : 'تقدير الطلب الحر'),
                    Text('${effectiveSubtotal.toStringAsFixed(0)} ج.م'),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        extraStoreCount > 0
                            ? 'رسوم التوصيل (+5 ج.م × $extraStoreCount متجر إضافي)'
                            : 'رسوم التوصيل التقديرية',
                      ),
                    ),
                    Text('${deliveryEstimate.toStringAsFixed(0)} ج.م'),
                  ],
                ),
                if (widget.appliedDiscount > 0) ...[
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('خصم الكوبون', style: TextStyle(color: Color(0xFF0D9488))),
                      Text('-${widget.appliedDiscount.toStringAsFixed(0)} ج.م', style: const TextStyle(color: Color(0xFF0D9488))),
                    ],
                  ),
                ],
                const Divider(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('الإجمالي المتوقع (كاش)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    Text('${totalEstimate.toStringAsFixed(0)} ج.م', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFFEA580C))),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFEA580C),
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _submitting
              ? null
              : () async {
                  if (widget.orderChannel == 'catalog' && cartItems.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('أضف منتجًا واحدًا على الأقل للسلة')));
                    return;
                  }
                  if (widget.isGuest) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('يرجى تسجيل الدخول أو إنشاء حساب لإتمام الطلب (سلتك محفوظة)')),
                    );
                    widget.onRequireAuth?.call();
                    return;
                  }
                  if (widget.orderChannel != 'catalog' && _freeTextCtrl.text.trim().isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اكتب تفاصيل الطلب الحر')));
                    return;
                  }
                  setState(() => _submitting = true);
                  try {
                    final createdNumbers = <String>[];
                    if (widget.orderChannel == 'catalog') {
                      double remainingDisc = widget.appliedDiscount;
                      var idx = 0;
                      for (final grp in merchantGroups.values) {
                        final grpItems = grp['items'] as List<Map<String, dynamic>>;
                        final grpSub = grp['subtotal'] as double;
                        final grpDelivery = idx == 0 ? singleDelivery : 5.0;
                        final grpDisc = remainingDisc > (grpSub + grpDelivery) ? (grpSub + grpDelivery) : remainingDisc;
                        remainingDisc = (remainingDisc - grpDisc).clamp(0, 999999);
                        final summary = grpItems.map((c) => "${c['product']['name_ar']} × ${c['qty']}").join(' + ');
                        final res = await widget.api.createOrder({
                          'customer_name': widget.customerName,
                          'customer_phone': widget.customerPhone,
                          'merchant_id': grp['merchant_id'],
                          'zone_id': effectiveZoneId,
                          'zone_name': selectedZone['name_ar'],
                          'address_landmark': widget.addressLandmark,
                          'order_channel': 'catalog',
                          'free_order_text': summary,
                          'items': grpItems
                              .map((c) => {
                                    'product_id': c['product']['id'],
                                    'name_ar': c['product']['name_ar'],
                                    'quantity': c['qty'],
                                    'unit_price': (c['product']['sale_price'] ?? c['product']['base_price']),
                                  })
                              .toList(),
                          'is_express': _isExpress,
                          'is_additional_store_stop': idx > 0,
                          'subtotal': grpSub,
                          if (widget.couponCode.trim().isNotEmpty) 'coupon_code': widget.couponCode.trim(),
                          'discount_amount': grpDisc,
                          'payment_method': 'cash',
                        });
                        createdNumbers.add('${res['order_number']}');
                        idx++;
                      }
                    } else {
                      final res = await widget.api.createOrder({
                        'customer_name': widget.customerName,
                        'customer_phone': widget.customerPhone,
                        'merchant_id': effectiveMerchantId,
                        'zone_id': effectiveZoneId,
                        'zone_name': selectedZone['name_ar'],
                        'address_landmark': widget.addressLandmark,
                        'order_channel': widget.orderChannel,
                        'free_order_text': _freeTextCtrl.text.trim(),
                        'is_express': _isExpress,
                        'subtotal': 150,
                        if (widget.couponCode.trim().isNotEmpty) 'coupon_code': widget.couponCode.trim(),
                        'discount_amount': widget.appliedDiscount,
                        'payment_method': 'cash',
                      });
                      createdNumbers.add('${res['order_number']}');
                    }
                    _freeTextCtrl.clear();
                    widget.onClearCart();
                    widget.onApplyCouponState('', 0);
                    await widget.onOrderPlaced();
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            createdNumbers.length > 1
                                ? 'تم إرسال ${createdNumbers.length} طلبات بنجاح: ${createdNumbers.map((n) => '#$n').join(' · ')}'
                                : 'تم إرسال الطلب #${createdNumbers.first} بنجاح',
                          ),
                        ),
                      );
                    }
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
                      );
                    }
                  } finally {
                    if (mounted) setState(() => _submitting = false);
                  }
                },
          child: Text(_submitting ? 'جاري الإرسال...' : (widget.isGuest ? 'سجّل الدخول لإتمام الطلب' : 'تأكيد وإرسال الطلب الآن')),
        ),
      ],
    );
  }
}
