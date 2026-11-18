import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../core/api_client.dart';

class PharmacyScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final String selectedZoneId;
  final String addressLandmark;
  final Future<void> Function() onRefresh;

  const PharmacyScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    this.selectedZoneId = 'zn_city_center',
    this.addressLandmark = '',
    required this.onRefresh,
  });

  @override
  State<PharmacyScreen> createState() => _PharmacyScreenState();
}

class _PharmacyScreenState extends State<PharmacyScreen> {
  String _selectedPharmacyId = '';
  final TextEditingController _rxCtrl = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  Uint8List? _rxPhotoBytes;
  String? _rxImageDataUrl;
  bool _sending = false;

  Future<void> _pickRxPhoto(ImageSource source) async {
    final file = await _picker.pickImage(source: source, maxWidth: 1000, imageQuality: 78);
    if (file != null) {
      final bytes = await file.readAsBytes();
      final dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      if (mounted) {
        setState(() {
          _rxPhotoBytes = bytes;
          _rxImageDataUrl = dataUrl;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pharmacies = ((widget.bootstrap['merchants'] as List?) ?? [])
        .where((m) => m['merchant_type'] == 'pharmacy')
        .toList();
    if (_selectedPharmacyId.isEmpty && pharmacies.isNotEmpty) {
      _selectedPharmacyId = pharmacies.first['id'];
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFF0FDFA),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFF99F6E4)),
          ),
          child: const Text(
            'المنصة وسيط تقني فقط: تتم مراجعة الروشتة وصرف الدواء بواسطة صيدلي مرخص وفق قانون الصيدلة المصري.',
            style: TextStyle(fontSize: 12, color: Color(0xFF115E59)),
          ),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          value: pharmacies.any((p) => p['id'] == _selectedPharmacyId) ? _selectedPharmacyId : null,
          decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'اختر الصيدلية المعتمدة'),
          items: pharmacies
              .map((p) => DropdownMenuItem<String>(
                    value: p['id'],
                    child: Text('${p['business_name_ar']} (${p['pharmacy_license_no'] ?? ''})'),
                  ))
              .toList(),
          onChanged: (v) => setState(() => _selectedPharmacyId = v ?? ''),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _pickRxPhoto(ImageSource.camera),
                icon: const Icon(Icons.camera_alt_outlined),
                label: const Text('تصوير الروشتة'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _pickRxPhoto(ImageSource.gallery),
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text('من الاستوديو'),
              ),
            ),
          ],
        ),
        if (_rxPhotoBytes != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.teal.shade200),
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.memory(_rxPhotoBytes!, width: 72, height: 72, fit: BoxFit.cover),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'تم إرفاق صورة الروشتة بنجاح وجاهزة للإرسال للصيدلي',
                    style: TextStyle(color: Color(0xFF0F766E), fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  onPressed: () => setState(() {
                    _rxPhotoBytes = null;
                    _rxImageDataUrl = null;
                  }),
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 14),
        TextField(
          controller: _rxCtrl,
          maxLines: 5,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            labelText: 'اكتب اسم الدواء أو ملاحظات الصيدلي (اختياري مع الصورة)',
          ),
        ),
        const SizedBox(height: 16),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0D9488),
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _sending ? null : _submitRx,
          icon: const Icon(Icons.local_pharmacy),
          label: Text(_sending ? 'جاري إرسال الروشتة...' : 'إرسال الروشتة للصيدلي للمراجعة'),
        ),
      ],
    );
  }

  Future<void> _submitRx() async {
    if (_selectedPharmacyId.isEmpty || (_rxCtrl.text.trim().isEmpty && _rxImageDataUrl == null)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اكتب تفاصيل الدواء أو أرفق صورة للروشتة أولًا')),
      );
      return;
    }
    setState(() => _sending = true);
    try {
      final note = _rxCtrl.text.trim().isNotEmpty
          ? (_rxImageDataUrl != null ? '${_rxCtrl.text.trim()} (مرفق صورة روشتة)' : _rxCtrl.text.trim())
          : 'روشتة طبية مرفقة بالصورة';
      final zones = (widget.bootstrap['zones'] as List?) ?? [];
      final zoneObj = zones.cast<Map<String, dynamic>?>().firstWhere(
            (z) => z?['id']?.toString() == widget.selectedZoneId,
            orElse: () => zones.isNotEmpty && zones.first is Map ? Map<String, dynamic>.from(zones.first as Map) : null,
          );
      final resolvedZoneId = zoneObj?['id']?.toString() ?? widget.selectedZoneId;
      final resolvedZoneName = zoneObj?['name_ar']?.toString() ?? 'وسط مدينة المنزلة';
      final res = await widget.api.createOrder({
        'merchant_id': _selectedPharmacyId,
        'zone_id': resolvedZoneId,
        'zone_name': resolvedZoneName,
        'address_landmark': widget.addressLandmark,
        'order_channel': 'prescription',
        'free_order_text': note,
        'prescription_image_url': _rxImageDataUrl,
        'is_express': true,
        'subtotal': 0,
        'payment_method': 'cash',
      });
      _rxCtrl.clear();
      setState(() {
        _rxPhotoBytes = null;
        _rxImageDataUrl = null;
      });
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم إرسال الروشتة #${res['order_number']} للصيدلي')),
        );
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }
}
