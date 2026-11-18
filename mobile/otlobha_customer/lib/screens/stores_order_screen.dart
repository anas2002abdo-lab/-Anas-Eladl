import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class StoresOrderScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final String selectedZoneId;
  final String addressLandmark;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final Future<void> Function() onRefresh;

  const StoresOrderScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    this.selectedZoneId = 'zn_city_center',
    this.addressLandmark = '',
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onRefresh,
  });

  @override
  State<StoresOrderScreen> createState() => _StoresOrderScreenState();
}

class _StoresOrderScreenState extends State<StoresOrderScreen> {
  String _selectedMerchantId = '';
  String _selectedSectionId = 'all';
  String _flashingMerchantId = '';
  String _flashingSectionId = '';
  late String _selectedZoneId = widget.selectedZoneId;
  String _channel = 'catalog';
  bool _isExpress = false;
  double _discount = 0;
  final TextEditingController _freeOrderCtrl = TextEditingController();
  final TextEditingController _couponCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void didUpdateWidget(covariant StoresOrderScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedZoneId != widget.selectedZoneId) {
      _selectedZoneId = widget.selectedZoneId;
    }
  }

  Widget _buildRemoteOrDataImage(String? rawUrl, Widget fallback) {
    final url = (rawUrl ?? '').trim();
    if (url.isEmpty) return fallback;
    if (url.startsWith('data:image')) {
      final commaIdx = url.indexOf(',');
      if (commaIdx != -1) {
        try {
          final bytes = base64Decode(url.substring(commaIdx + 1));
          return Image.memory(
            bytes,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
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
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, __, ___) => fallback,
      );
    }
    return fallback;
  }

  void _triggerFlashMerchant(String id) {
    setState(() {
      _flashingMerchantId = id;
      _selectedMerchantId = id;
      _selectedSectionId = 'all';
    });
    Timer(const Duration(milliseconds: 420), () {
      if (mounted && _flashingMerchantId == id) {
        setState(() => _flashingMerchantId = '');
      }
    });
  }

  void _triggerFlashSection(String id) {
    setState(() {
      _flashingSectionId = id;
      _selectedSectionId = id;
    });
    Timer(const Duration(milliseconds: 420), () {
      if (mounted && _flashingSectionId == id) {
        setState(() => _flashingSectionId = '');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final merchants = ((widget.bootstrap['merchants'] as List?) ?? [])
        .where((m) => m['merchant_type'] != 'pharmacy')
        .toList();
    final zones = (widget.bootstrap['zones'] as List?) ?? [];
    final allCategories = (widget.bootstrap['categories'] as List?) ?? [];
    final allProducts = (widget.bootstrap['products'] as List?) ?? [];

    if (_selectedMerchantId.isEmpty && merchants.isNotEmpty) {
      _selectedMerchantId = '${merchants.first['id']}';
    }
    final selectedMerchant = merchants.cast<Map<String, dynamic>?>().firstWhere(
          (m) => m?['id'] == _selectedMerchantId,
          orElse: () => null,
        );

    final offersCategoryIds = allCategories
        .where((c) => c['is_offers_section'] == true || c['is_offers_section'] == 1)
        .map((c) => '${c['id']}')
        .toSet();

    bool isProductOffer(dynamic p) {
      if (p['is_offer'] == true || p['is_offer'] == 1) return true;
      if (offersCategoryIds.contains('${p['category_id']}')) return true;
      final base = p['base_price'] as num?;
      final sale = p['sale_price'] as num?;
      return sale != null && base != null && sale < base;
    }

    final merchantProducts = allProducts
        .where((p) => p['merchant_id'] == _selectedMerchantId)
        .toList();

    final merchantOffersCat = allCategories.cast<Map<String, dynamic>?>().firstWhere(
          (c) =>
              c?['merchant_id'] == _selectedMerchantId &&
              (c?['is_offers_section'] == true || c?['is_offers_section'] == 1),
          orElse: () => null,
        );

    final List<Map<String, dynamic>> storeSections = [
      {
        'id': 'all',
        'name_ar': 'الكل',
        'image_url': selectedMerchant?['image_url'] ?? '',
        'kind': 'all',
      },
      {
        'id': merchantOffersCat?['id'] ?? 'offers',
        'name_ar': merchantOffersCat?['name_ar'] ?? 'العروض',
        'image_url': merchantOffersCat?['image_url'] ?? '',
        'kind': 'offers',
      },
      ...allCategories.where((c) {
        if (c['scope'] == 'market' || c['is_active'] == false) return false;
        if (c['is_offers_section'] == true || c['is_offers_section'] == 1) return false;
        final ownerId = c['merchant_id'];
        if (ownerId == _selectedMerchantId) return true;
        if (ownerId == null || '$ownerId'.isEmpty) {
          return merchantProducts.any((p) => p['category_id'] == c['id']);
        }
        return false;
      }).map((c) => {
            'id': '${c['id']}',
            'name_ar': '${c['name_ar']}',
            'image_url': '${c['image_url'] ?? ''}',
            'kind': 'category',
          }),
    ];

    final products = merchantProducts.where((p) {
      if (_selectedSectionId == 'all') return true;
      final isOffersSelected =
          _selectedSectionId == 'offers' || offersCategoryIds.contains(_selectedSectionId);
      if (isOffersSelected) {
        return isProductOffer(p);
      }
      return '${p['category_id']}' == _selectedSectionId;
    }).toList();

    int totalCartQty = 0;
    double totalCartEgp = 0;
    for (final p in allProducts) {
      final qty = widget.cart[p['id']] ?? 0;
      if (qty > 0) {
        totalCartQty += qty;
        final unit = (p['sale_price'] ?? p['base_price']) as num;
        totalCartEgp += unit.toDouble() * qty;
      }
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('المتاجر المعتمدة في المنزلة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        const Text(
          'اسحب لاختيار المتجر ثم تصفح أقسامه وعروضه؛ تبقى جميع مشترياتك محفوظة في السلة.',
          style: TextStyle(fontSize: 11, color: Colors.black54),
        ),
        const SizedBox(height: 10),
        if (zones.isNotEmpty)
          DropdownButtonFormField<String>(
            value: zones.any((z) => z['id'] == _selectedZoneId) ? _selectedZoneId : zones.first['id'],
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'منطقة التوصيل'),
            items: zones
                .map((z) => DropdownMenuItem<String>(
                      value: z['id'],
                      child: Text('${z['name_ar']} (+${z['remote_area_fee']} ج.م)'),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _selectedZoneId = v ?? 'zn_city_center'),
          ),
        const SizedBox(height: 12),
        SizedBox(
          height: 108,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            itemCount: merchants.length,
            separatorBuilder: (_, __) => const SizedBox(width: 14),
            itemBuilder: (context, index) {
              final m = merchants[index];
              final mId = '${m['id']}';
              final selected = mId == _selectedMerchantId;
              final flashing = mId == _flashingMerchantId;
              return GestureDetector(
                onTap: () => _triggerFlashMerchant(mId),
                child: SizedBox(
                  width: 78,
                  child: Column(
                    children: [
                      AnimatedScale(
                        scale: flashing ? 1.12 : 1.0,
                        duration: const Duration(milliseconds: 220),
                        child: Container(
                          width: 66,
                          height: 66,
                          padding: const EdgeInsets.all(2.5),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: flashing
                                  ? const Color(0xFFF5A623)
                                  : selected
                                      ? const Color(0xFFEA580C)
                                      : Colors.black12,
                              width: selected || flashing ? 2.5 : 1.5,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: flashing
                                    ? const Color(0x88F5A623)
                                    : selected
                                        ? const Color(0x33EA580C)
                                        : Colors.black12,
                                blurRadius: flashing ? 14 : 6,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: ClipOval(
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                _buildRemoteOrDataImage(
                                  '${m['image_url'] ?? ''}',
                                  Container(
                                    color: const Color(0xFFFFF7ED),
                                    child: const Icon(Icons.storefront, color: Color(0xFFEA580C), size: 30),
                                  ),
                                ),
                                AnimatedOpacity(
                                  opacity: flashing ? 0.55 : 0.0,
                                  duration: const Duration(milliseconds: 200),
                                  child: Container(color: Colors.white),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${m['business_name_ar'] ?? ''}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: selected ? FontWeight.bold : FontWeight.w600,
                          color: selected ? const Color(0xFFC2410C) : Colors.black87,
                          height: 1.15,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 12),
        if (storeSections.isNotEmpty) ...[
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('أقسام المتجر', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
              Text('اسحب أفقيًا ←', style: TextStyle(fontSize: 11, color: Colors.black45)),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 98,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              itemCount: storeSections.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (context, idx) {
                final sec = storeSections[idx];
                final secId = '${sec['id']}';
                final secKind = '${sec['kind']}';
                final selected = _selectedSectionId == secId;
                final flashing = _flashingSectionId == secId;
                final fallbackWidget = Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: secKind == 'offers'
                          ? const [Color(0xFFE11D48), Color(0xFFEA580C)]
                          : secKind == 'all'
                              ? const [Color(0xFF1E293B), Color(0xFF475569)]
                              : const [Color(0xFF0D9488), Color(0xFF10B981)],
                    ),
                  ),
                  child: Icon(
                    secKind == 'offers'
                        ? Icons.local_offer
                        : secKind == 'all'
                            ? Icons.grid_view_rounded
                            : Icons.category,
                    color: Colors.white,
                    size: 26,
                  ),
                );
                return GestureDetector(
                  onTap: () => _triggerFlashSection(secId),
                  child: SizedBox(
                    width: 72,
                    child: Column(
                      children: [
                        AnimatedScale(
                          scale: flashing ? 1.12 : 1.0,
                          duration: const Duration(milliseconds: 220),
                          child: Container(
                            width: 58,
                            height: 58,
                            padding: const EdgeInsets.all(2),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: flashing
                                    ? const Color(0xFFF5A623)
                                    : selected
                                        ? (secKind == 'offers' ? const Color(0xFFE11D48) : const Color(0xFFEA580C))
                                        : Colors.black12,
                                width: selected || flashing ? 2.5 : 1.5,
                              ),
                              boxShadow: [
                                if (flashing || selected)
                                  BoxShadow(
                                    color: flashing ? const Color(0x88F5A623) : const Color(0x33EA580C),
                                    blurRadius: flashing ? 12 : 6,
                                    offset: const Offset(0, 2),
                                  ),
                              ],
                            ),
                            child: ClipOval(
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  _buildRemoteOrDataImage('${sec['image_url'] ?? ''}', fallbackWidget),
                                  AnimatedOpacity(
                                    opacity: flashing ? 0.55 : 0.0,
                                    duration: const Duration(milliseconds: 200),
                                    child: Container(color: Colors.white),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          '${sec['name_ar'] ?? ''}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                            color: selected
                                ? (secKind == 'offers' ? const Color(0xFFBE123C) : const Color(0xFFC2410C))
                                : Colors.black87,
                            height: 1.15,
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
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'catalog', label: Text('المنتجات')),
            ButtonSegment(value: 'free_text', label: Text('طلب حر')),
            ButtonSegment(value: 'voice', label: Text('صوت / صورة')),
          ],
          selected: {_channel},
          onSelectionChanged: (v) => setState(() => _channel = v.first),
        ),
        const SizedBox(height: 14),
        if (_channel == 'catalog') ...[
          if (products.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: Text('لا توجد منتجات في هذا القسم حاليًا', style: TextStyle(color: Colors.grey))),
              ),
            )
          else
            ...products.map((p) {
              final qty = widget.cart[p['id']] ?? 0;
              final price = p['sale_price'] ?? p['base_price'];
              final hasOffer = isProductOffer(p);
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: ListTile(
                  leading: SizedBox(
                    width: 48,
                    height: 48,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: _buildRemoteOrDataImage(
                        '${p['image_url'] ?? ''}',
                        Container(
                          color: const Color(0xFFF1F5F9),
                          child: const Icon(Icons.inventory_2_outlined, color: Color(0xFFEA580C)),
                        ),
                      ),
                    ),
                  ),
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(p['name_ar'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      ),
                      if (hasOffer)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: const Color(0xFFE11D48), borderRadius: BorderRadius.circular(6)),
                          child: const Text('عرض', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                        ),
                    ],
                  ),
                  subtitle: Text('${p['category_name']} · $price ج.م'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (qty > 0)
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: () => widget.onAddProduct(Map<String, dynamic>.from(p as Map), -1),
                        ),
                      if (qty > 0) Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold)),
                      IconButton(
                        icon: const Icon(Icons.add_circle, color: Color(0xFFEA580C)),
                        onPressed: () => widget.onAddProduct(Map<String, dynamic>.from(p as Map), 1),
                      ),
                    ],
                  ),
                ),
              );
            }),
          if (totalCartQty > 0) ...[
            const SizedBox(height: 12),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEA580C),
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: widget.onOpenCart,
              icon: const Icon(Icons.shopping_cart),
              label: Text('عرض السلة الموحدة ($totalCartQty منتجات · ${totalCartEgp.toStringAsFixed(0)} ج.م)'),
            ),
          ],
        ] else ...[
          TextField(
            controller: _freeOrderCtrl,
            maxLines: 4,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'اكتب طلبك الحر أو وصف المرفق',
              hintText: 'مثال: 2 كيلو طماطم + علبة جبنة + عيش بلدي',
            ),
          ),
          const SizedBox(height: 10),
          SwitchListTile(
            value: _isExpress,
            onChanged: (v) => setState(() => _isExpress = v),
            title: const Text('توصيل مستعجل Express', style: TextStyle(fontSize: 13)),
            contentPadding: EdgeInsets.zero,
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _couponCtrl,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    isDense: true,
                    labelText: 'كود الخصم (مثال: MANZALA20)',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: _applyCoupon,
                child: const Text('تطبيق'),
              ),
            ],
          ),
          if (_discount > 0) ...[
            const SizedBox(height: 6),
            Text('تم تطبيق خصم: -${_discount.toStringAsFixed(0)} ج.م', style: const TextStyle(color: Color(0xFF0D9488), fontWeight: FontWeight.bold)),
          ],
          const SizedBox(height: 16),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEA580C),
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: _submitting ? null : () => _submitFreeOrder(zones),
            child: const Text('إرسال الطلب الحر للتسعير'),
          ),
        ],
      ],
    );
  }

  Future<void> _applyCoupon() async {
    try {
      final res = await widget.api.validateCoupon(_couponCtrl.text, 150, 'stores');
      setState(() => _discount = (res['discount_amount'] as num).toDouble());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('تم خصم ${res['discount_amount']} ج.م')));
      }
    } catch (e) {
      setState(() => _discount = 0);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _submitFreeOrder(List zones) async {
    if (_selectedMerchantId.isEmpty || _freeOrderCtrl.text.trim().isEmpty) return;

    final zoneObj = zones.firstWhere((z) => z['id'] == _selectedZoneId, orElse: () => {'name_ar': 'وسط مدينة المنزلة'});
    setState(() => _submitting = true);
    try {
      final res = await widget.api.createOrder({
        'merchant_id': _selectedMerchantId,
        'zone_id': _selectedZoneId,
        'zone_name': zoneObj['name_ar'],
        'address_landmark': widget.addressLandmark,
        'order_channel': _channel,
        'free_order_text': _freeOrderCtrl.text.trim(),
        'is_express': _isExpress,
        'subtotal': 150,
        if (_couponCtrl.text.trim().isNotEmpty) 'coupon_code': _couponCtrl.text.trim(),
        'discount_amount': _discount,
        'payment_method': 'cash',
      });
      _freeOrderCtrl.clear();
      _couponCtrl.clear();
      setState(() => _discount = 0);
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم إرسال الطلب #${res['order_number']} بنجاح')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
