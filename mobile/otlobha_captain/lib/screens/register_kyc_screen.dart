import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../core/api_client.dart';

class RegisterKycScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final void Function(String captainId) onRegistered;

  const RegisterKycScreen({super.key, required this.api, required this.onRegistered});

  @override
  State<RegisterKycScreen> createState() => _RegisterKycScreenState();
}

class _RegisterKycScreenState extends State<RegisterKycScreen> {
  final TextEditingController _usernameCtrl = TextEditingController();
  final TextEditingController _passwordCtrl = TextEditingController();
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _phoneCtrl = TextEditingController();
  final TextEditingController _nidCtrl = TextEditingController();
  final TextEditingController _modelCtrl = TextEditingController();
  final TextEditingController _plateCtrl = TextEditingController();
  String _vehicleType = 'moto';
  String _zoneName = 'وسط مدينة المنزلة';
  bool _submitting = false;
  bool _obscurePw = true;

  final ImagePicker _picker = ImagePicker();
  final Map<String, Uint8List?> _capturedBytes = {};
  final Map<String, String?> _capturedDataUrls = {};

  final Map<String, String> _docLabels = const {
    'vehicle_right': 'الجانب الأيمن للمركبة',
    'vehicle_left': 'الجانب الأيسر للمركبة',
    'vehicle_plate': 'صورة لوحة المركبة',
    'vehicle_license': 'رخصة المركبة السارية',
    'driving_license': 'رخصة القيادة',
    'national_id_front': 'الرقم القومي',
    'selfie': 'الصورة الشخصية المباشرة (Selfie)',
  };

  Future<void> _pickPhoto(String key) async {
    final file = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1000, imageQuality: 78);
    if (file != null) {
      final bytes = await file.readAsBytes();
      final dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      if (mounted) {
        setState(() {
          _capturedBytes[key] = bytes;
          _capturedDataUrls[key] = dataUrl;
        });
      }
    }
  }

  String _modelHint() {
    switch (_vehicleType) {
      case 'tuktuk':
        return 'مثال: بجاج الهندي 2024 / TVS';
      case 'car':
        return 'مثال: هيونداي فيرنا / نيسان صني';
      case 'bicycle':
        return 'مثال: دراجة جبلية ترينكس';
      case 'moto':
      default:
        return 'مثال: هوجن 5 / دايون 4 / بوكسر 150';
    }
  }

  Future<void> _submit() async {
    final username = _usernameCtrl.text.trim();
    final password = _passwordCtrl.text;
    if (username.length < 3 ||
        password.length < 4 ||
        _nameCtrl.text.trim().isEmpty ||
        _phoneCtrl.text.trim().isEmpty ||
        _nidCtrl.text.trim().isEmpty ||
        _modelCtrl.text.trim().isEmpty ||
        _plateCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('يرجى إدخال اسم المستخدم (3 أحرف+) وكلمة المرور (4 أحرف+) وكافة البيانات الأساسية'),
        ),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final res = await widget.api.registerCaptain({
        'username': username,
        'password': password,
        'full_name': _nameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'national_id': _nidCtrl.text.trim(),
        'zone_name': _zoneName,
        'vehicle_type': _vehicleType,
        'vehicle_model': _modelCtrl.text.trim(),
        'plate_number': _plateCtrl.text.trim(),
        'allowed_services': ['stores', 'parcels'],
        'doc_images': {
          for (final entry in _capturedDataUrls.entries)
            if (entry.value != null) entry.key: entry.value,
        },
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال التسجيل وصور المركبة والمستندات للمراجعة')),
        );
        widget.onRegistered(res['id']);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final photo1 = _capturedBytes['vehicle_front'];
    final photo2 = _capturedBytes['vehicle_back'];

    return Scaffold(
      appBar: AppBar(title: const Text('تسجيل كابتن جديد ورفع المستندات')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.orange.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.orange.shade200),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('بيانات دخول التطبيق الخاصة بالطيار', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 10),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextField(
                    controller: _usernameCtrl,
                    decoration: const InputDecoration(
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(),
                      labelText: 'اسم المستخدم (مثال: ali_moto)',
                      prefixIcon: Icon(Icons.alternate_email),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextField(
                    controller: _passwordCtrl,
                    obscureText: _obscurePw,
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: Colors.white,
                      border: const OutlineInputBorder(),
                      labelText: 'كلمة المرور (4 أحرف على الأقل)',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscurePw ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscurePw = !_obscurePw),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          TextField(controller: _nameCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'الاسم الرباعي')),
          const SizedBox(height: 10),
          TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم الهاتف')),
          const SizedBox(height: 10),
          TextField(controller: _nidCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'الرقم القومي (14 رقم)')),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _vehicleType,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'اختر نوع المركبة'),
            items: const [
              DropdownMenuItem(value: 'moto', child: Text('موتوسيكل')),
              DropdownMenuItem(value: 'tuktuk', child: Text('توك توك')),
              DropdownMenuItem(value: 'car', child: Text('سيارة')),
              DropdownMenuItem(value: 'bicycle', child: Text('دراجة')),
            ],
            onChanged: (v) => setState(() => _vehicleType = v ?? 'moto'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _modelCtrl,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              labelText: 'اكتب نوع وموديل المركبة (مثل هوجن 5)',
              hintText: _modelHint(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(controller: _plateCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم اللوحة')),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: _zoneName,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'نطاق العمل في المنزلة'),
            items: const [
              DropdownMenuItem(value: 'وسط مدينة المنزلة', child: Text('وسط مدينة المنزلة')),
              DropdownMenuItem(value: 'البصراط', child: Text('البصراط')),
              DropdownMenuItem(value: 'العصافرة', child: Text('العصافرة')),
            ],
            onChanged: (v) => setState(() => _zoneName = v ?? 'وسط مدينة المنزلة'),
          ),
          const SizedBox(height: 16),

          // Dedicated Two Vehicle Photos Capture Section
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.orange.shade200),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('التقاط صورتين للمركبة (أمامية وخلفية)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0F172A),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                        ),
                        onPressed: () => _pickPhoto('vehicle_front'),
                        icon: const Icon(Icons.camera_alt_outlined, size: 18),
                        label: Text(photo1 != null ? 'صورة 1 ✓' : 'صورة المركبة 1', style: const TextStyle(fontSize: 12)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0F172A),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(46),
                        ),
                        onPressed: () => _pickPhoto('vehicle_back'),
                        icon: const Icon(Icons.camera_alt_outlined, size: 18),
                        label: Text(photo2 != null ? 'صورة 2 ✓' : 'صورة المركبة 2', style: const TextStyle(fontSize: 12)),
                      ),
                    ),
                  ],
                ),
                if (photo1 != null || photo2 != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      if (photo1 != null)
                        Expanded(
                          child: Column(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.memory(photo1, height: 90, width: double.infinity, fit: BoxFit.cover),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  _capturedBytes.remove('vehicle_front');
                                  _capturedDataUrls.remove('vehicle_front');
                                }),
                                child: const Text('حذف صورة 1', style: TextStyle(color: Colors.red, fontSize: 11)),
                              ),
                            ],
                          ),
                        ),
                      if (photo1 != null && photo2 != null) const SizedBox(width: 10),
                      if (photo2 != null)
                        Expanded(
                          child: Column(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.memory(photo2, height: 90, width: double.infinity, fit: BoxFit.cover),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  _capturedBytes.remove('vehicle_back');
                                  _capturedDataUrls.remove('vehicle_back');
                                }),
                                child: const Text('حذف صورة 2', style: TextStyle(color: Colors.red, fontSize: 11)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),

          const Text('باقي مستندات التوثيق المطلوبة', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ..._docLabels.entries.map((entry) {
            final picked = _capturedBytes[entry.key] != null;
            return Card(
              child: ListTile(
                leading: Icon(picked ? Icons.check_circle : Icons.camera_alt_outlined, color: picked ? const Color(0xFF0D9488) : Colors.grey),
                title: Text(entry.value, style: const TextStyle(fontSize: 13)),
                trailing: TextButton(
                  onPressed: () => _pickPhoto(entry.key),
                  child: Text(picked ? 'تم الالتقاط' : 'تصوير'),
                ),
              ),
            );
          }),
          const SizedBox(height: 16),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(48)),
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? 'جاري الإرسال...' : 'إرسال طلب الانضمام للمراجعة'),
          ),
        ],
      ),
    );
  }
}
