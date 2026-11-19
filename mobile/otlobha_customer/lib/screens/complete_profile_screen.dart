import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import '../core/api_client.dart';

class CompleteProfileScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> initialUser;
  final void Function(Map<String, dynamic> updatedUser) onCompleted;
  final VoidCallback? onLogout;

  const CompleteProfileScreen({
    super.key,
    required this.api,
    required this.initialUser,
    required this.onCompleted,
    this.onLogout,
  });

  @override
  State<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends State<CompleteProfileScreen> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _ageCtrl;
  late final TextEditingController _countryCtrl;
  late final TextEditingController _cityCtrl;
  late final TextEditingController _addressCtrl;
  late final TextEditingController _phoneCtrl;
  late final TextEditingController _secondaryPhoneCtrl;

  double? _lat;
  double? _lng;
  bool _locating = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = widget.initialUser;
    _nameCtrl = TextEditingController(text: (u['full_name'] ?? '').toString());
    _ageCtrl = TextEditingController(text: u['age'] != null ? '${u['age']}' : '');
    _countryCtrl = TextEditingController(
      text: (u['country'] ?? '').toString().trim().isNotEmpty ? u['country'].toString() : 'مصر',
    );
    _cityCtrl = TextEditingController(
      text: (u['city'] ?? '').toString().trim().isNotEmpty ? u['city'].toString() : 'المنزلة',
    );
    _addressCtrl = TextEditingController(text: (u['address_landmark'] ?? '').toString());
    _phoneCtrl = TextEditingController(text: (u['phone'] ?? '').toString());
    _secondaryPhoneCtrl = TextEditingController(text: (u['secondary_phone'] ?? '').toString());
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _ageCtrl.dispose();
    _countryCtrl.dispose();
    _cityCtrl.dispose();
    _addressCtrl.dispose();
    _phoneCtrl.dispose();
    _secondaryPhoneCtrl.dispose();
    super.dispose();
  }

  void _showMsg(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _detectGpsLocation() async {
    setState(() => _locating = true);
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) {
        _showMsg('يرجى تفعيل خدمة الموقع (GPS) على الهاتف أولاً');
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        _showMsg('لم يتم منح صلاحية الموقع، يمكنك كتابة العنوان يدويًا');
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (mounted) {
        setState(() {
          _lat = pos.latitude;
          _lng = pos.longitude;
        });
        _showMsg('تم تحديد إحداثيات موقعك الحالي بنجاح ✓');
      }
    } catch (_) {
      _showMsg('تعذر تحديد الموقع تلقائيًا، يمكنك كتابة العنوان يدويًا');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _submit() async {
    final name = _nameCtrl.text.trim();
    final ageVal = int.tryParse(_ageCtrl.text.trim());
    final country = _countryCtrl.text.trim();
    final city = _cityCtrl.text.trim();
    final address = _addressCtrl.text.trim();
    final phone = _phoneCtrl.text.trim();
    final secondaryPhone = _secondaryPhoneCtrl.text.trim();

    if (name.length < 2) {
      _showMsg('يرجى إدخال الاسم الكامل');
      return;
    }
    if (ageVal == null || ageVal < 10 || ageVal > 110) {
      _showMsg('يرجى إدخال السن بشكل صحيح (بين 10 و 110)');
      return;
    }
    if (country.length < 2) {
      _showMsg('يرجى إدخال اسم البلد');
      return;
    }
    if (address.length < 3) {
      _showMsg('يرجى إدخال الموقع والعنوان التفصيلي');
      return;
    }
    if (phone.length < 8) {
      _showMsg('يرجى إدخال رقم هاتف أساسي صحيح');
      return;
    }

    setState(() => _saving = true);
    try {
      final res = await widget.api.updateProfile(
        fullName: name,
        age: ageVal,
        country: country,
        city: city.isNotEmpty ? city : 'المنزلة',
        addressLandmark: address,
        phone: phone,
        secondaryPhone: secondaryPhone,
        lastLat: _lat,
        lastLng: _lng,
        profileCompleted: true,
      );
      final updated = res['customer'] is Map
          ? Map<String, dynamic>.from(res['customer'] as Map)
          : <String, dynamic>{
              ...widget.initialUser,
              'full_name': name,
              'age': ageVal,
              'country': country,
              'city': city.isNotEmpty ? city : 'المنزلة',
              'address_landmark': address,
              'phone': phone,
              'secondary_phone': secondaryPhone,
              'profile_completed': true,
              'needs_profile_completion': false,
            };
      if (mounted) {
        _showMsg('تم حفظ بياناتك بنجاح! مرحبًا بك في اطلبها ✓');
        widget.onCompleted(updated);
      }
    } catch (e) {
      _showMsg(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  InputDecoration _fieldDecor({
    required String label,
    required IconData icon,
    String? hint,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(icon, size: 20, color: const Color(0xFF64748B)),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFA92224), width: 1.6),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final email = (widget.initialUser['email'] ?? '').toString();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          title: const Text('إكمال البيانات الشخصية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          actions: [
            if (widget.onLogout != null)
              TextButton.icon(
                onPressed: _saving ? null : widget.onLogout,
                icon: const Icon(Icons.logout, color: Colors.white, size: 18),
                label: const Text('تغيير الحساب', style: TextStyle(color: Colors.white, fontSize: 12)),
              ),
          ],
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 30),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(Icons.person_pin_outlined, color: Color(0xFFA92224), size: 26),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'خطوة أخيرة للبدء في اطلبها',
                              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              email.isNotEmpty
                                  ? 'حسابك ($email) جاهز — أضف بيانات التوصيل لمرة واحدة فقط'
                                  : 'أضف بياناتك الشخصية وعنوانك لتوصيل طلباتك بدقة',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _nameCtrl,
                        textInputAction: TextInputAction.next,
                        decoration: _fieldDecor(
                          label: 'الاسم الكامل *',
                          hint: 'مثال: أحمد محمد علي',
                          icon: Icons.person_outline,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 1,
                      child: TextField(
                        controller: _ageCtrl,
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.next,
                        decoration: _fieldDecor(
                          label: 'السن *',
                          hint: '25',
                          icon: Icons.cake_outlined,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _countryCtrl,
                        textInputAction: TextInputAction.next,
                        decoration: _fieldDecor(
                          label: 'البلد *',
                          hint: 'مصر',
                          icon: Icons.public_outlined,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _cityCtrl,
                        textInputAction: TextInputAction.next,
                        decoration: _fieldDecor(
                          label: 'المدينة / المركز *',
                          hint: 'المنزلة',
                          icon: Icons.location_city_outlined,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _addressCtrl,
                  textInputAction: TextInputAction.next,
                  decoration: _fieldDecor(
                    label: 'الموقع والعنوان التفصيلي *',
                    hint: 'الشارع، رقم المنزل، أقرب معلم مميز',
                    icon: Icons.location_on_outlined,
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: _locating ? null : _detectGpsLocation,
                    icon: Icon(
                      _lat != null ? Icons.check_circle : Icons.my_location,
                      size: 18,
                      color: const Color(0xFF0F766E),
                    ),
                    label: Text(
                      _locating
                          ? 'جاري تحديد موقعك الحالي...'
                          : _lat != null
                              ? 'تم التقاط موقعك GPS (${_lat!.toStringAsFixed(4)}, ${_lng!.toStringAsFixed(4)}) ✓'
                              : 'تحديد موقعي تلقائيًا عبر GPS (اختياري)',
                      style: const TextStyle(color: Color(0xFF0F766E), fontWeight: FontWeight.bold, fontSize: 12.5),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextField(
                    controller: _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.next,
                    decoration: _fieldDecor(
                      label: 'رقم الهاتف الأساسي *',
                      hint: '01xxxxxxxxx',
                      icon: Icons.phone_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextField(
                    controller: _secondaryPhoneCtrl,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    decoration: _fieldDecor(
                      label: 'رقم هاتف آخر (اختياري إن وجد)',
                      hint: '01xxxxxxxxx',
                      icon: Icons.phone_android_outlined,
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFA92224),
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(52),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                  onPressed: _saving ? null : _submit,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.check_circle_outline),
                  label: Text(
                    _saving ? 'جاري حفظ البيانات...' : 'حفظ البيانات والدخول إلى اطلبها',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
