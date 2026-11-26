import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';
import '../core/safe_camera_picker.dart';

class RegisterKycScreen extends StatefulWidget {
  static const String prefDraftActive = 'otlobha_cap_kyc_draft_active';
  static const String _prefDraftData = 'otlobha_cap_kyc_draft_data';

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
  final TextEditingController _emailCtrl = TextEditingController();
  final TextEditingController _nidCtrl = TextEditingController();
  final TextEditingController _residenceIdCtrl = TextEditingController();
  final TextEditingController _brandCtrl = TextEditingController();
  final TextEditingController _modelCtrl = TextEditingController();
  final TextEditingController _colorCtrl = TextEditingController();
  final TextEditingController _plateCtrl = TextEditingController();
  final TextEditingController _licenseNumCtrl = TextEditingController();
  final TextEditingController _regNumCtrl = TextEditingController();
  final TextEditingController _insuranceNumCtrl = TextEditingController();
  String _vehicleType = 'moto';
  String _zoneName = 'وسط مدينة المنزلة';
  bool _submitting = false;
  bool _obscurePw = true;

  final Map<String, Uint8List?> _capturedBytes = {};
  final Map<String, String?> _capturedDataUrls = {};
  final Map<String, String> _capturedFilePaths = {};

  final Map<String, String> _docLabels = const {
    'vehicle_right': 'الجانب الأيمن للمركبة',
    'vehicle_left': 'الجانب الأيسر للمركبة',
    'vehicle_plate': 'صورة لوحة المركبة',
    'vehicle_license': 'استمارة / رخصة المركبة السارية',
    'driving_license': 'رخصة القيادة',
    'insurance_doc': 'وثيقة تأمين المركبة',
    'national_id_front': 'الهوية الوطنية / الإقامة',
    'selfie': 'الصورة الشخصية المباشرة (Selfie)',
  };

  @override
  void initState() {
    super.initState();
    _restoreDraftAndLostPhoto();
  }

  @override
  void dispose() {
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _nidCtrl.dispose();
    _residenceIdCtrl.dispose();
    _brandCtrl.dispose();
    _modelCtrl.dispose();
    _colorCtrl.dispose();
    _plateCtrl.dispose();
    _licenseNumCtrl.dispose();
    _regNumCtrl.dispose();
    _insuranceNumCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveDraft({bool markActive = true}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(RegisterKycScreen.prefDraftActive, markActive);
      final draft = <String, dynamic>{
        'username': _usernameCtrl.text,
        'name': _nameCtrl.text,
        'phone': _phoneCtrl.text,
        'nid': _nidCtrl.text,
        'model': _modelCtrl.text,
        'plate': _plateCtrl.text,
        'vehicle_type': _vehicleType,
        'zone_name': _zoneName,
        'file_paths': _capturedFilePaths,
      };
      await prefs.setString(RegisterKycScreen._prefDraftData, jsonEncode(draft));
    } catch (_) {}
  }

  Future<void> _clearDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(RegisterKycScreen.prefDraftActive);
      await prefs.remove(RegisterKycScreen._prefDraftData);
    } catch (_) {}
  }

  Future<void> _restoreDraftAndLostPhoto() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(RegisterKycScreen._prefDraftData);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          _usernameCtrl.text = (decoded['username'] ?? '').toString();
          _nameCtrl.text = (decoded['name'] ?? '').toString();
          _phoneCtrl.text = (decoded['phone'] ?? '').toString();
          _nidCtrl.text = (decoded['nid'] ?? '').toString();
          _modelCtrl.text = (decoded['model'] ?? '').toString();
          _plateCtrl.text = (decoded['plate'] ?? '').toString();
          final vt = (decoded['vehicle_type'] ?? '').toString();
          if (const ['moto', 'tuktuk', 'car', 'bicycle'].contains(vt)) {
            _vehicleType = vt;
          }
          final zn = (decoded['zone_name'] ?? '').toString();
          if (const ['وسط مدينة المنزلة', 'البصراط', 'العصافرة'].contains(zn)) {
            _zoneName = zn;
          }
          final paths = decoded['file_paths'];
          if (paths is Map) {
            for (final entry in paths.entries) {
              final k = entry.key.toString();
              final p = entry.value?.toString() ?? '';
              if (p.isNotEmpty) {
                final f = File(p);
                if (await f.exists()) {
                  final bytes = await f.readAsBytes();
                  if (bytes.isNotEmpty) {
                    _capturedFilePaths[k] = p;
                    _capturedBytes[k] = bytes;
                    _capturedDataUrls[k] = 'data:image/jpeg;base64,${base64Encode(bytes)}';
                  }
                }
              }
            }
          }
        }
      }

      // Recover photo taken right before Android killed & recreated the Activity
      final lost = await SafeCameraPicker.recoverLostImage(expectedTargetPrefix: 'kyc_');
      if (lost != null) {
        final target = (lost.targetKey ?? 'kyc_vehicle_front').replaceFirst('kyc_', '');
        _capturedFilePaths[target] = lost.filePath;
        _capturedBytes[target] = lost.bytes;
        _capturedDataUrls[target] = lost.dataUrl;
        await _saveDraft(markActive: true);
      }

      if (mounted) setState(() {});
    } catch (_) {}
  }

  Future<void> _pickPhoto(String key) async {
    await _saveDraft(markActive: true);
    try {
      final result = await SafeCameraPicker.pickImage(
        source: ImageSource.camera,
        targetKey: 'kyc_$key',
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 76,
      );
      if (result != null && mounted) {
        setState(() {
          _capturedFilePaths[key] = result.filePath;
          _capturedBytes[key] = result.bytes;
          _capturedDataUrls[key] = result.dataUrl;
        });
        await _saveDraft(markActive: true);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر فتح الكاميرا أو قراءة الصورة، تأكد من منح صلاحية الكاميرا وحاول مرة أخرى')),
        );
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
        if (_emailCtrl.text.trim().isNotEmpty) 'email': _emailCtrl.text.trim(),
        'national_id': _nidCtrl.text.trim(),
        if (_residenceIdCtrl.text.trim().isNotEmpty) 'residence_id': _residenceIdCtrl.text.trim(),
        'zone_name': _zoneName,
        'vehicle_type': _vehicleType,
        if (_brandCtrl.text.trim().isNotEmpty) 'vehicle_brand': _brandCtrl.text.trim(),
        'vehicle_model': _modelCtrl.text.trim(),
        if (_colorCtrl.text.trim().isNotEmpty) 'vehicle_color': _colorCtrl.text.trim(),
        'plate_number': _plateCtrl.text.trim(),
        if (_licenseNumCtrl.text.trim().isNotEmpty) 'license_number': _licenseNumCtrl.text.trim(),
        if (_regNumCtrl.text.trim().isNotEmpty) 'registration_number': _regNumCtrl.text.trim(),
        if (_insuranceNumCtrl.text.trim().isNotEmpty) 'insurance_number': _insuranceNumCtrl.text.trim(),
        'allowed_services': ['rides', 'stores', 'parcels'],
        'doc_images': {
          for (final entry in _capturedDataUrls.entries)
            if (entry.value != null) entry.key: entry.value,
        },
      });
      await _clearDraft();
      if (mounted) {
        final newId = res['id']?.toString() ?? '';
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال التسجيل وصور المركبة والمستندات للمراجعة')),
        );
        if (newId.isNotEmpty) {
          widget.onRegistered(newId);
        }
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
  }

  @override
  Widget build(BuildContext context) {
    final photo1 = _capturedBytes['vehicle_front'];
    final photo2 = _capturedBytes['vehicle_back'];

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) {
          _clearDraft();
        }
      },
      child: Scaffold(
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
            TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم الجوال / الهاتف')),
            const SizedBox(height: 10),
            TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'البريد الإلكتروني (اختياري)')),
            const SizedBox(height: 10),
            TextField(controller: _nidCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم الهوية / الرقم القومي')),
            const SizedBox(height: 10),
            TextField(controller: _residenceIdCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم الإقامة (إن وجد)')),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _vehicleType,
              decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'اختر نوع المركبة'),
              items: const [
                DropdownMenuItem(value: 'car', child: Text('سيارة')),
                DropdownMenuItem(value: 'moto', child: Text('موتوسيكل')),
                DropdownMenuItem(value: 'tuktuk', child: Text('توك توك')),
                DropdownMenuItem(value: 'bicycle', child: Text('دراجة')),
              ],
              onChanged: (v) => setState(() => _vehicleType = v ?? 'moto'),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _brandCtrl,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'الماركة (مثال: تويوتا)'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _colorCtrl,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'لون المركبة'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _modelCtrl,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: 'موديل المركبة وسنة الصنع',
                hintText: _modelHint(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(controller: _plateCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم اللوحة')),
            const SizedBox(height: 10),
            TextField(controller: _licenseNumCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم رخصة القيادة')),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _regNumCtrl,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم استمارة المركبة'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _insuranceNumCtrl,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم وثيقة التأمين'),
                  ),
                ),
              ],
            ),
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
                                  onPressed: () {
                                    setState(() {
                                      _capturedBytes.remove('vehicle_front');
                                      _capturedDataUrls.remove('vehicle_front');
                                      _capturedFilePaths.remove('vehicle_front');
                                    });
                                    _saveDraft(markActive: true);
                                  },
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
                                  onPressed: () {
                                    setState(() {
                                      _capturedBytes.remove('vehicle_back');
                                      _capturedDataUrls.remove('vehicle_back');
                                      _capturedFilePaths.remove('vehicle_back');
                                    });
                                    _saveDraft(markActive: true);
                                  },
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
      ),
    );
  }
}
