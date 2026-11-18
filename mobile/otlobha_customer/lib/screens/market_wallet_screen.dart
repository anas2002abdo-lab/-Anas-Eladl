import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../core/api_client.dart';

class MarketWalletScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final String customerName;
  final String customerPhone;
  final String selectedZoneId;
  final Future<void> Function() onRefresh;

  const MarketWalletScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    this.customerName = '',
    this.customerPhone = '',
    this.selectedZoneId = 'zn_city_center',
    required this.onRefresh,
  });

  @override
  State<MarketWalletScreen> createState() => _MarketWalletScreenState();
}

class _MarketWalletScreenState extends State<MarketWalletScreen> {
  final TextEditingController _titleCtrl = TextEditingController();
  final TextEditingController _priceCtrl = TextEditingController(text: '350');
  final TextEditingController _descCtrl = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  Uint8List? _mktPhotoBytes;
  String? _mktImageDataUrl;
  bool _submitting = false;

  Future<void> _pickMarketPhoto(ImageSource source) async {
    final picked = await _picker.pickImage(source: source, maxWidth: 1000, imageQuality: 78);
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    setState(() {
      _mktPhotoBytes = bytes;
      _mktImageDataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
    });
  }

  Widget _buildListingThumbnail(dynamic imageUrlRaw) {
    final imageUrl = (imageUrlRaw ?? '').toString().trim();
    if (imageUrl.isEmpty) {
      return Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7ED),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Icon(Icons.sell_outlined, color: Color(0xFFEA580C)),
      );
    }
    if (imageUrl.startsWith('data:image') && imageUrl.contains(',')) {
      try {
        final b64 = imageUrl.split(',').last;
        final bytes = base64Decode(b64);
        return ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.memory(bytes, width: 56, height: 56, fit: BoxFit.cover),
        );
      } catch (_) {}
    }
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Image.network(
          imageUrl,
          width: 56,
          height: 56,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined),
        ),
      );
    }
    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Icon(Icons.image_outlined, color: Color(0xFFEA580C)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final listings = (widget.bootstrap['market'] as List?) ?? [];
    final parcels = (widget.bootstrap['parcels'] as List?) ?? [];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('نشر إعلان في سوق اطلبها (C2C)', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                const SizedBox(height: 10),
                TextField(controller: _titleCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'اسم السلعة')),
                const SizedBox(height: 10),
                TextField(controller: _priceCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'السعر بالجنيه')),
                const SizedBox(height: 10),
                TextField(controller: _descCtrl, maxLines: 2, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'وصف المنتج وحالته')),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                        onPressed: () => _pickMarketPhoto(ImageSource.camera),
                        icon: const Icon(Icons.camera_alt_outlined, size: 18),
                        label: const Text('تصوير المنتج', style: TextStyle(fontSize: 12)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _pickMarketPhoto(ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_outlined, size: 18),
                        label: const Text('من المعرض', style: TextStyle(fontSize: 12)),
                      ),
                    ),
                  ],
                ),
                if (_mktPhotoBytes != null) ...[
                  const SizedBox(height: 10),
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.memory(_mktPhotoBytes!, height: 150, width: double.infinity, fit: BoxFit.cover),
                      ),
                      Positioned(
                        top: 6,
                        left: 6,
                        child: InkWell(
                          onTap: () => setState(() {
                            _mktPhotoBytes = null;
                            _mktImageDataUrl = null;
                          }),
                          child: Container(
                            padding: const EdgeInsets.all(6),
                            decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                            child: const Icon(Icons.close, color: Colors.white, size: 16),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 10),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(44)),
                  onPressed: _submitting
                      ? null
                      : () async {
                          if (_titleCtrl.text.trim().isEmpty) return;
                          setState(() => _submitting = true);
                          try {
                            final zones = (widget.bootstrap['zones'] as List?) ?? [];
                            final zoneObj = zones.cast<Map<String, dynamic>?>().firstWhere(
                                  (z) => z?['id']?.toString() == widget.selectedZoneId,
                                  orElse: () => zones.isNotEmpty && zones.first is Map ? Map<String, dynamic>.from(zones.first as Map) : null,
                                );
                            await widget.api.createMarketListing({
                              if (widget.customerName.isNotEmpty) 'seller_name': widget.customerName,
                              if (widget.customerPhone.isNotEmpty) 'seller_phone': widget.customerPhone,
                              'category_ar': 'منتجات يدوية ومنزلية',
                              'title': _titleCtrl.text.trim(),
                              'description': _descCtrl.text.trim().isNotEmpty ? _descCtrl.text.trim() : 'حالة ممتازة — المعاينة في المنزلة',
                              'price': double.tryParse(_priceCtrl.text) ?? 350,
                              'zone_name': zoneObj?['name_ar']?.toString() ?? 'وسط مدينة المنزلة',
                              'image_url': _mktImageDataUrl ?? '',
                            });
                            _titleCtrl.clear();
                            _descCtrl.clear();
                            setState(() {
                              _mktPhotoBytes = null;
                              _mktImageDataUrl = null;
                            });
                            await widget.onRefresh();
                          } finally {
                            if (mounted) setState(() => _submitting = false);
                          }
                        },
                  child: const Text('نشر الإعلان الآن'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        const Text('إعلانات سوق اطلبها', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 8),
        ...listings.map((m) => Card(
              child: ListTile(
                leading: _buildListingThumbnail(m['image_url']),
                title: Text(m['title'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                subtitle: Text('${m['category_ar']} · ${m['zone_name']}'),
                trailing: Text('${m['price']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFEA580C))),
              ),
            )),
        const SizedBox(height: 14),
        const Text('طرودي النشطة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        ...parcels.take(5).map((p) => Card(
              child: ListTile(
                title: Text('${p['delivery_number']} · ${p['item_category']}'),
                subtitle: Text('OTP: ${p['delivery_otp']} · الحالة: ${p['status']}'),
                trailing: Text('${p['delivery_fee']} ج.م'),
              ),
            )),
      ],
    );
  }
}
