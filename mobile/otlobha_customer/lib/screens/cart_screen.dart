import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
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
  final TextEditingController _orderNotesCtrl = TextEditingController();
  late final TextEditingController _couponCtrl = TextEditingController(text: widget.couponCode);
  final ImagePicker _imagePicker = ImagePicker();
  bool _isExpress = false;
  bool _submitting = false;
  String _paymentMethod = 'cash'; // cash | instapay | vodafone_cash
  Map<String, dynamic> _paymentSettings = const {};
  String? _paymentProofDataUrl;
  Uint8List? _paymentProofBytes;

  @override
  void initState() {
    super.initState();
    final bootPay = widget.bootstrap['payment_settings'];
    if (bootPay is Map) {
      _paymentSettings = Map<String, dynamic>.from(bootPay);
    }
    _refreshPaymentSettings();
  }

  Future<void> _refreshPaymentSettings() async {
    try {
      final live = await widget.api.getPaymentSettings();
      if (!mounted) return;
      setState(() {
        _paymentSettings = live;
      });
    } catch (_) {
      // Fall back silently to bootstrap payment_settings
    }
  }

  @override
  void dispose() {
    _freeTextCtrl.dispose();
    _orderNotesCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  String _paymentMethodLabel(String method) {
    switch (method) {
      case 'instapay':
        return 'إنستا باي';
      case 'vodafone_cash':
        return 'فودافون كاش';
      default:
        return 'كاش عند الاستلام';
    }
  }

  Future<void> _copyText(String value, String label) async {
    final clean = value.trim();
    if (clean.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: clean));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('تم نسخ $label: $clean'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Future<void> _pickTransferReceipt(ImageSource source) async {
    try {
      final picked = await _imagePicker.pickImage(
        source: source,
        maxWidth: 1200,
        imageQuality: 78,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      if (!mounted) return;
      setState(() {
        _paymentProofBytes = bytes;
        _paymentProofDataUrl = dataUrl;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم إرفاق صورة إيصال التحويل بنجاح'),
          duration: Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذّر اختيار الصورة: $e')),
      );
    }
  }

  void _showReceiptSourceSheet() {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'إضافة صورة إيصال التحويل',
                textAlign: TextAlign.center,
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
              ),
              const SizedBox(height: 12),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFFEF2F2),
                  child: Icon(Icons.photo_library_rounded, color: Color(0xFFA92224)),
                ),
                title: const Text('اختيار من معرض الصور', style: TextStyle(fontWeight: FontWeight.bold)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickTransferReceipt(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEEF2FF),
                  child: Icon(Icons.camera_alt_rounded, color: Color(0xFF4F46E5)),
                ),
                title: const Text('التقاط صورة بالكاميرا', style: TextStyle(fontWeight: FontWeight.bold)),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickTransferReceipt(ImageSource.camera);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Uint8List? _tryDecodeDataUrl(String raw) {
    final trimmed = raw.trim();
    if (!trimmed.startsWith('data:image/')) return null;
    final comma = trimmed.indexOf(',');
    if (comma < 0 || comma + 1 >= trimmed.length) return null;
    try {
      return base64Decode(trimmed.substring(comma + 1).replaceAll(RegExp(r'\s+'), ''));
    } catch (_) {
      return null;
    }
  }

  Widget _buildQrPreview(String rawUrl) {
    final bytes = _tryDecodeDataUrl(rawUrl);
    if (bytes != null) {
      return Image.memory(
        bytes,
        width: 176,
        height: 176,
        fit: BoxFit.contain,
      );
    }
    return Image.network(
      rawUrl,
      width: 176,
      height: 176,
      fit: BoxFit.contain,
      errorBuilder: (_, __, ___) => const SizedBox(
        width: 176,
        height: 120,
        child: Center(
          child: Text(
            'تعذّر عرض صورة الباركود',
            style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
          ),
        ),
      ),
    );
  }

  Widget _buildTransferProofUploader(Color accentColor) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accentColor.withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_paymentProofBytes != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(
                _paymentProofBytes!,
                height: 150,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _showReceiptSourceSheet,
                    icon: const Icon(Icons.photo_camera_rounded, size: 17),
                    label: const Text('تغيير صورة التحويل', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: accentColor,
                      side: BorderSide(color: accentColor),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () => setState(() {
                    _paymentProofBytes = null;
                    _paymentProofDataUrl = null;
                  }),
                  icon: const Icon(Icons.delete_outline_rounded, color: Colors.red),
                  tooltip: 'حذف الصورة',
                ),
              ],
            ),
          ] else
            ElevatedButton.icon(
              onPressed: _showReceiptSourceSheet,
              icon: const Icon(Icons.add_photo_alternate_rounded, size: 20),
              label: const Text(
                'إضافة صورة التحويل',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: accentColor,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(44),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildActivePaymentDetails() {
    if (_paymentMethod == 'vodafone_cash') {
      final vfNumber = (_paymentSettings['vodafone_cash_number'] ?? '').toString().trim();
      final vfNote = (_paymentSettings['vodafone_cash_instructions_ar'] ?? '').toString().trim();
      return Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFFEF2F2),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFFECACA)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.phone_android_rounded, size: 18, color: Color(0xFFDC2626)),
                SizedBox(width: 6),
                Text(
                  'بيانات التحويل — فودافون كاش',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF991B1B)),
                ),
              ],
            ),
            if (vfNote.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                vfNote,
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF7F1D1D)),
              ),
            ],
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'رقم التحويل (فودافون كاش):',
                          style: TextStyle(fontSize: 11, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        SelectableText(
                          vfNumber.isNotEmpty ? vfNumber : 'لم يتم إضافة الرقم بعد من لوحة التحكم',
                          textDirection: TextDirection.ltr,
                          style: TextStyle(
                            fontSize: vfNumber.isNotEmpty ? 17 : 12,
                            fontWeight: FontWeight.w900,
                            letterSpacing: vfNumber.isNotEmpty ? 1.1 : 0,
                            color: vfNumber.isNotEmpty ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (vfNumber.isNotEmpty)
                    ElevatedButton.icon(
                      onPressed: () => _copyText(vfNumber, 'رقم فودافون كاش'),
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('نسخ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDC2626),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            _buildTransferProofUploader(const Color(0xFFDC2626)),
          ],
        ),
      );
    }

    if (_paymentMethod == 'instapay') {
      final ipQr = (_paymentSettings['instapay_qr_image_url'] ?? '').toString().trim();
      final ipLink = (_paymentSettings['instapay_link'] ?? '').toString().trim();
      final ipNote = (_paymentSettings['instapay_instructions_ar'] ?? '').toString().trim();
      return Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFF5F3FF),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFDDD6FE)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.qr_code_2_rounded, size: 19, color: Color(0xFF7C3AED)),
                SizedBox(width: 6),
                Text(
                  'بيانات التحويل — إنستا باي (InstaPay)',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF5B21B6)),
                ),
              ],
            ),
            if (ipNote.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                ipNote,
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF4C1D95)),
              ),
            ],
            const SizedBox(height: 10),
            Center(
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFC4B5FD)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x127C3AED),
                      blurRadius: 8,
                      offset: Offset(0, 3),
                    ),
                  ],
                ),
                child: ipQr.isNotEmpty
                    ? _buildQrPreview(ipQr)
                    : const SizedBox(
                        width: 170,
                        height: 120,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.qr_code_2_rounded, size: 44, color: Color(0xFFA78BFA)),
                            SizedBox(height: 6),
                            Text(
                              'باركود إنستا باي غير مضاف بعد',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFC4B5FD)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'رابط / عنوان إنستا باي:',
                          style: TextStyle(fontSize: 11, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        SelectableText(
                          ipLink.isNotEmpty ? ipLink : 'لم يتم إضافة الرابط بعد من لوحة التحكم',
                          textDirection: TextDirection.ltr,
                          style: TextStyle(
                            fontSize: ipLink.isNotEmpty ? 13 : 11.5,
                            fontWeight: FontWeight.w800,
                            color: ipLink.isNotEmpty ? const Color(0xFF4C1D95) : const Color(0xFF94A3B8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (ipLink.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    ElevatedButton.icon(
                      onPressed: () => _copyText(ipLink, 'رابط إنستا باي'),
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('نسخ الرابط', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11.5)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF7C3AED),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
            _buildTransferProofUploader(const Color(0xFF7C3AED)),
          ],
        ),
      );
    }

    return const SizedBox.shrink();
  }

  @override
  void didUpdateWidget(covariant CartScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.couponCode != widget.couponCode && _couponCtrl.text != widget.couponCode) {
      _couponCtrl.text = widget.couponCode;
    }
    if (oldWidget.bootstrap['payment_settings'] != widget.bootstrap['payment_settings'] &&
        widget.bootstrap['payment_settings'] is Map) {
      _paymentSettings = Map<String, dynamic>.from(widget.bootstrap['payment_settings'] as Map);
    }
  }

  String _formatQty(double v) {
    final rounded = double.parse(v.toStringAsFixed(3));
    if (rounded == rounded.roundToDouble()) return rounded.toInt().toString();
    return rounded.toString().replaceFirst(RegExp(r'\.?0+$'), '');
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
      final isWeighted = p['is_weighted'] == true || p['is_weighted'] == 1;
      final rawStep = (p['weight_step'] is num)
          ? (p['weight_step'] as num).toDouble()
          : (double.tryParse((p['weight_step'] ?? '').toString()) ?? 0.25);
      final weightStep = isWeighted ? (rawStep > 0 && rawStep <= 10 ? rawStep : 0.25) : 1.0;
      final weightUnit = (p['weight_unit'] ?? 'كجم').toString().trim().isNotEmpty
          ? (p['weight_unit'] ?? 'كجم').toString().trim()
          : 'كجم';
      final effectiveQty = isWeighted
          ? double.parse((qty * weightStep).toStringAsFixed(3))
          : qty.toDouble();
      final lineTotal = double.parse((unit * effectiveQty).toStringAsFixed(2));
      subtotal += lineTotal;
      final itemMap = {
        'product': p,
        'qty': qty,
        'effective_qty': effectiveQty,
        'is_weighted': isWeighted,
        'weight_step': weightStep,
        'weight_unit': weightUnit,
        'unit': unit,
        'line_total': lineTotal,
      };
      cartItems.add(itemMap);
      final mId = (p['merchant_id'] ?? effectiveMerchantId).toString();
      merchantGroups.putIfAbsent(mId, () => {
        'merchant_id': mId,
        'merchant_name': (p['merchant_name'] ?? 'متجر في اطلبها').toString(),
        'items': <Map<String, dynamic>>[],
        'subtotal': 0.0,
      });
      (merchantGroups[mId]!['items'] as List<Map<String, dynamic>>).add(itemMap);
      merchantGroups[mId]!['subtotal'] = (merchantGroups[mId]!['subtotal'] as double) + lineTotal;
    }

    final remoteFee = ((selectedZone['remote_area_fee'] ?? 0) as num).toDouble();
    final singleDelivery = 15 + remoteFee + (_isExpress ? 10 : 0);
    final extraStoreCount = widget.orderChannel == 'catalog' && merchantGroups.length > 1 ? merchantGroups.length - 1 : 0;
    final deliveryEstimate = singleDelivery + extraStoreCount * 5.0;
    final effectiveSubtotal = widget.orderChannel == 'catalog' ? subtotal : 150.0;
    final totalEstimate = (effectiveSubtotal + deliveryEstimate - widget.appliedDiscount).clamp(0.0, 999999.0).toDouble();
    final showCheckoutBar = widget.orderChannel != 'catalog' || cartItems.isNotEmpty;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
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
                        final isWeighted = item['is_weighted'] == true;
                        final effectiveQty = (item['effective_qty'] as num).toDouble();
                        final weightStep = (item['weight_step'] as num).toDouble();
                        final weightUnit = (item['weight_unit'] ?? 'كجم').toString();
                        final unit = item['unit'] as double;
                        return ListTile(
                          title: Text('${p['name_ar']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          subtitle: Text(
                            isWeighted
                                ? '${p['category_name'] ?? ''} · ${unit.toStringAsFixed(0)} ج.م / $weightUnit (الزيادة ${_formatQty(weightStep)} $weightUnit)'
                                : '${p['category_name'] ?? ''} · ${unit.toStringAsFixed(0)} ج.م للقطعة',
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                onPressed: () => widget.onAddProduct(p, -1),
                                icon: const Icon(Icons.remove_circle_outline),
                              ),
                              Text(
                                isWeighted ? '${_formatQty(effectiveQty)} $weightUnit' : '$qty',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                              ),
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
          const SizedBox(height: 10),
          TextField(
            controller: _orderNotesCtrl,
            maxLines: 3,
            minLines: 2,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'إضافة طلب نصي أو ملاحظة مع المنتجات (اختياري)',
              hintText: 'مثال: أضف مع الطلب عيش بلدي أو أي ملاحظة للمتجر والطيار...',
              prefixIcon: Icon(Icons.edit_note_rounded),
              filled: true,
              fillColor: Colors.white,
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
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.account_balance_wallet_rounded, size: 18, color: Color(0xFFA92224)),
                    SizedBox(width: 6),
                    Text(
                      'طريقة الدفع',
                      style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    for (final opt in [
                      if (_paymentSettings['cod_enabled'] != false)
                        ('cash', 'كاش', Icons.payments_rounded),
                      if (_paymentSettings['instapay_enabled'] != false)
                        ('instapay', 'إنستا باي', Icons.qr_code_2_rounded),
                      if (_paymentSettings['vodafone_cash_enabled'] != false)
                        ('vodafone_cash', 'فودافون كاش', Icons.phone_android_rounded),
                    ]) ...[
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 3),
                          child: InkWell(
                            onTap: () => setState(() => _paymentMethod = opt.$1),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
                              decoration: BoxDecoration(
                                color: _paymentMethod == opt.$1
                                    ? const Color(0xFFFEF2F2)
                                    : const Color(0xFFF8FAFC),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: _paymentMethod == opt.$1
                                      ? const Color(0xFFA92224)
                                      : const Color(0xFFE2E8F0),
                                  width: _paymentMethod == opt.$1 ? 1.8 : 1.0,
                                ),
                              ),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    opt.$3,
                                    size: 20,
                                    color: _paymentMethod == opt.$1
                                        ? const Color(0xFFA92224)
                                        : const Color(0xFF64748B),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    opt.$2,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: _paymentMethod == opt.$1 ? FontWeight.w900 : FontWeight.w700,
                                      color: _paymentMethod == opt.$1
                                          ? const Color(0xFFA92224)
                                          : const Color(0xFF334155),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                _buildActivePaymentDetails(),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
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
                    Text(
                      'الإجمالي المتوقع (${_paymentMethodLabel(_paymentMethod)})',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    Text('${totalEstimate.toStringAsFixed(0)} ج.م', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFFEA580C))),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
      ],
    ),
        ),
        if (showCheckoutBar)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
              boxShadow: [
                BoxShadow(
                  color: Color(0x140F172A),
                  blurRadius: 10,
                  offset: Offset(0, -3),
                ),
              ],
            ),
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEA580C),
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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
                        String createdOrderNumber = '';
                        int storeCount = 1;
                        if (widget.orderChannel == 'catalog') {
                          final extraNote = _orderNotesCtrl.text.trim();
                          final storesPayload = <Map<String, dynamic>>[];
                          for (final grp in merchantGroups.values) {
                            final grpItems = grp['items'] as List<Map<String, dynamic>>;
                            final grpSub = (grp['subtotal'] as num).toDouble();
                            final summary = grpItems
                                .map((c) => c['is_weighted'] == true
                                    ? "${c['product']['name_ar']} × ${_formatQty((c['effective_qty'] as num).toDouble())} ${c['weight_unit']}"
                                    : "${c['product']['name_ar']} × ${c['qty']}")
                                .join(' + ');
                            final storeFreeText = extraNote.isNotEmpty
                                ? '$summary | طلب نصي / ملاحظة: $extraNote'
                                : summary;
                            storesPayload.add({
                              'merchant_id': grp['merchant_id'],
                              'order_channel': 'catalog',
                              'free_order_text': storeFreeText,
                              'subtotal': double.parse(grpSub.toStringAsFixed(2)),
                              'items': grpItems
                                  .map((c) => {
                                        'product_id': c['product']['id'],
                                        'name_ar': c['product']['name_ar'],
                                        'quantity': c['is_weighted'] == true ? c['effective_qty'] : c['qty'],
                                        'unit_price': (c['product']['sale_price'] ?? c['product']['base_price']),
                                      })
                                  .toList(),
                            });
                          }
                          storeCount = storesPayload.length;
                          final res = await widget.api.createBundleOrder({
                            'customer_name': widget.customerName,
                            'customer_phone': widget.customerPhone,
                            'zone_id': effectiveZoneId,
                            'address_landmark': widget.addressLandmark,
                            'is_express': _isExpress,
                            if (widget.couponCode.trim().isNotEmpty) 'coupon_code': widget.couponCode.trim(),
                            if (extraNote.isNotEmpty) 'customer_notes': extraNote,
                            'payment_method': _paymentMethod,
                            if ((_paymentMethod == 'vodafone_cash' || _paymentMethod == 'instapay') &&
                                _paymentProofDataUrl != null &&
                                _paymentProofDataUrl!.isNotEmpty)
                              'payment_proof_image_url': _paymentProofDataUrl,
                            'stores': storesPayload,
                          });
                          createdOrderNumber = '${res['order_number'] ?? res['id']}';
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
                            'payment_method': _paymentMethod,
                            if ((_paymentMethod == 'vodafone_cash' || _paymentMethod == 'instapay') &&
                                _paymentProofDataUrl != null &&
                                _paymentProofDataUrl!.isNotEmpty)
                              'payment_proof_image_url': _paymentProofDataUrl,
                          });
                          createdOrderNumber = '${res['order_number'] ?? res['id']}';
                        }
                        _freeTextCtrl.clear();
                        _orderNotesCtrl.clear();
                        setState(() {
                          _paymentProofBytes = null;
                          _paymentProofDataUrl = null;
                        });
                        widget.onClearCart();
                        widget.onApplyCouponState('', 0);
                        await widget.onOrderPlaced();
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                storeCount > 1
                                    ? 'تم إرسال الطلب الموحد #$createdOrderNumber بنجاح من $storeCount متاجر'
                                    : 'تم إرسال الطلب #$createdOrderNumber بنجاح',
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
              child: Text(
                _submitting
                    ? 'جاري الإرسال...'
                    : (widget.isGuest
                        ? 'سجّل الدخول لإتمام الطلب'
                        : 'تأكيد وإرسال الطلب الآن · ${totalEstimate.toStringAsFixed(0)} ج.م'),
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5),
              ),
            ),
          ),
      ],
    );
  }
}
