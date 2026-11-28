import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';
import '../core/config.dart';

class MerchantJoinScreen extends StatefulWidget {
  final MerchantApiClient api;
  final bool startInTrackMode;

  const MerchantJoinScreen({
    super.key,
    required this.api,
    this.startInTrackMode = false,
  });

  @override
  State<MerchantJoinScreen> createState() => _MerchantJoinScreenState();
}

class _MerchantJoinScreenState extends State<MerchantJoinScreen> {
  static const String _prefAppNum = 'otlobha_merchant_onboarding_app_num';
  static const String _prefAppSecret = 'otlobha_merchant_onboarding_secret';

  late bool _trackMode;
  int _step = 0; // 0: activity, 1: owner & biz, 2: activity details & docs, 3: review/submit
  bool _busy = false;
  String? _error;
  String? _notice;

  // Draft / Application tracking
  String? _appNumber;
  String? _appSecret;
  String _appStatus = 'draft';
  String? _adminNotes;
  List<Map<String, dynamic>> _uploadedDocs = [];

  // Activity selection
  String _activityCategory = 'store';
  String _merchantType = 'supermarket';

  // Common form controllers
  final _ownerNameCtrl = TextEditingController();
  final _ownerNationalIdCtrl = TextEditingController();
  final _bizNameArCtrl = TextEditingController();
  final _bizNameEnCtrl = TextEditingController();
  final _branchNameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _whatsappCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _zoneNameCtrl = TextEditingController(text: 'وسط مدينة المنزلة');
  final _addressCtrl = TextEditingController();
  final _workingHoursCtrl = TextEditingController(text: '09:00 ص - 12:00 م');
  final _commercialRegCtrl = TextEditingController();
  final _taxCardCtrl = TextEditingController();
  final _descriptionCtrl = TextEditingController();

  // Restaurant / Cafe fields
  final _cuisineCtrl = TextEditingController();
  final _prepTimeCtrl = TextEditingController(text: '20');
  bool _supportsMenuVariants = true;

  // Pharmacy fields
  final _pharmacyLicenseCtrl = TextEditingController();
  final _pharmacistNameCtrl = TextEditingController();
  final _syndicateNoCtrl = TextEditingController();
  bool _acceptsPrescriptions = true;

  // Other activity fields
  final _customActivityCtrl = TextEditingController();
  bool _termsAccepted = true;

  // Track mode controllers
  final _trackNumberCtrl = TextEditingController();
  final _trackContactCtrl = TextEditingController();
  Map<String, dynamic>? _trackedSummary;

  static const List<Map<String, dynamic>> _activities = [
    {
      'key': 'store',
      'title': 'متجر / سوبر ماركت / بقالة',
      'subtitle': 'إدارة المنتجات، الأسعار، العروض، المخزون، الفواتير وملفات Excel',
      'icon': Icons.storefront_rounded,
      'defaultType': 'supermarket',
      'subtypes': [
        {'id': 'supermarket', 'label': 'سوبر ماركت وبقالة'},
        {'id': 'vegetables_fruits', 'label': 'خضار وفاكهة'},
        {'id': 'butcher', 'label': 'جزارة ودواجن'},
        {'id': 'bakery', 'label': 'مخبز وحلويات'},
        {'id': 'mini_market', 'label': 'ميني ماركت / عطارة'},
      ],
    },
    {
      'key': 'restaurant_cafe',
      'title': 'مطعم / كافيه',
      'subtitle': 'إدارة قائمة الطعام والوجبات والأحجام والإضافات ووقت التحضير والإيقاف المؤقت',
      'icon': Icons.restaurant_menu_rounded,
      'defaultType': 'restaurant',
      'subtypes': [
        {'id': 'restaurant', 'label': 'مطعم ومأكولات'},
        {'id': 'cafe', 'label': 'كافيه ومشروبات'},
        {'id': 'fish_grill', 'label': 'أسماك ومشويات'},
        {'id': 'fast_food', 'label': 'وجبات سريعة وبيتزا'},
      ],
    },
    {
      'key': 'pharmacy',
      'title': 'صيدلية معتمدة',
      'subtitle': 'إدارة المنتجات الطبية والأسعار والطلبات وصرف الروشتات والمتطلبات النظامية',
      'icon': Icons.local_pharmacy_rounded,
      'defaultType': 'pharmacy',
      'subtypes': [
        {'id': 'pharmacy', 'label': 'صيدلية'},
      ],
    },
    {
      'key': 'other',
      'title': 'نشاط تجاري آخر',
      'subtitle': 'مكتبات، مستلزمات منزلية، إلكترونيات، هدايا، وأي نشاط معتمد بالمنزلة',
      'icon': Icons.business_center_rounded,
      'defaultType': 'other',
      'subtypes': [
        {'id': 'other', 'label': 'نشاط تجاري آخر'},
      ],
    },
  ];

  static const Map<String, Map<String, dynamic>> _statusMeta = {
    'draft': {'label': 'مسودة محفوظة', 'color': Color(0xFF475569), 'bg': Color(0xFFF1F5F9)},
    'under_review': {'label': 'قيد المراجعة', 'color': Color(0xFFB45309), 'bg': Color(0xFFFEF3C7)},
    'needs_completion': {'label': 'مطلوب استكمال', 'color': Color(0xFFC2410C), 'bg': Color(0xFFFFEDD5)},
    'approved': {'label': 'مقبول', 'color': Color(0xFF047857), 'bg': Color(0xFFD1FAE5)},
    'activated': {'label': 'مفعل وجاهز للدخول', 'color': Color(0xFF0F766E), 'bg': Color(0xFFCCFBF1)},
    'rejected': {'label': 'مرفوض', 'color': Color(0xFFBE123C), 'bg': Color(0xFFFFE4E6)},
  };

  @override
  void initState() {
    super.initState();
    _trackMode = widget.startInTrackMode;
    _restoreSavedDraftIfAny();
  }

  @override
  void dispose() {
    _ownerNameCtrl.dispose();
    _ownerNationalIdCtrl.dispose();
    _bizNameArCtrl.dispose();
    _bizNameEnCtrl.dispose();
    _branchNameCtrl.dispose();
    _phoneCtrl.dispose();
    _whatsappCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _zoneNameCtrl.dispose();
    _addressCtrl.dispose();
    _workingHoursCtrl.dispose();
    _commercialRegCtrl.dispose();
    _taxCardCtrl.dispose();
    _descriptionCtrl.dispose();
    _cuisineCtrl.dispose();
    _prepTimeCtrl.dispose();
    _pharmacyLicenseCtrl.dispose();
    _pharmacistNameCtrl.dispose();
    _syndicateNoCtrl.dispose();
    _customActivityCtrl.dispose();
    _trackNumberCtrl.dispose();
    _trackContactCtrl.dispose();
    super.dispose();
  }

  Future<void> _restoreSavedDraftIfAny() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedNum = prefs.getString(_prefAppNum)?.trim() ?? '';
      final savedSecret = prefs.getString(_prefAppSecret)?.trim() ?? '';
      if (savedNum.isEmpty || savedSecret.isEmpty) return;
      _trackNumberCtrl.text = savedNum;
      final res = await widget.api.fetchOnboardingApplication(
        applicationNumber: savedNum,
        secret: savedSecret,
      );
      if (!mounted) return;
      _hydrateFromApplication(res, secretOverride: savedSecret);
    } catch (_) {
      // ignore stale draft reference
    }
  }

  void _hydrateFromApplication(Map<String, dynamic> data, {String? secretOverride}) {
    final app = data['application'] is Map
        ? Map<String, dynamic>.from(data['application'] as Map)
        : Map<String, dynamic>.from(data);
    final docs = (data['documents'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    final extraRaw = app['activity_details'] ?? app['activity_payload'];
    final extra = extraRaw is Map
        ? Map<String, dynamic>.from(extraRaw)
        : <String, dynamic>{};

    setState(() {
      _appNumber = app['application_number']?.toString() ?? _appNumber;
      if (secretOverride != null && secretOverride.isNotEmpty) {
        _appSecret = secretOverride;
      }
      _appStatus = app['status']?.toString() ?? 'draft';
      _adminNotes = app['review_note']?.toString() ??
          app['admin_notes']?.toString() ??
          app['rejection_reason']?.toString();
      _uploadedDocs = docs;
      _activityCategory = app['activity_category']?.toString() ?? 'store';
      _merchantType = app['merchant_type']?.toString() ?? 'supermarket';
      _ownerNameCtrl.text = app['owner_name']?.toString() ?? '';
      _ownerNationalIdCtrl.text = app['owner_national_id']?.toString() ?? '';
      _bizNameArCtrl.text = app['business_name_ar']?.toString() ?? '';
      _bizNameEnCtrl.text = app['business_name_en']?.toString() ?? '';
      _branchNameCtrl.text = app['branch_name']?.toString() ?? '';
      _phoneCtrl.text = app['phone']?.toString() ?? '';
      _whatsappCtrl.text = app['whatsapp_phone']?.toString() ?? '';
      _emailCtrl.text = app['email']?.toString() ?? '';
      _zoneNameCtrl.text = app['zone_name']?.toString() ?? 'وسط مدينة المنزلة';
      _addressCtrl.text = app['address_detail']?.toString() ?? '';
      _workingHoursCtrl.text = app['working_hours']?.toString() ?? '09:00 ص - 12:00 م';
      _commercialRegCtrl.text = app['commercial_reg_no']?.toString() ?? '';
      _taxCardCtrl.text = app['tax_card_no']?.toString() ?? '';
      _descriptionCtrl.text = app['description_ar']?.toString() ?? '';
      _cuisineCtrl.text = extra['cuisine_type']?.toString() ?? '';
      _prepTimeCtrl.text = (extra['avg_prep_time_min'] ?? '20').toString();
      _supportsMenuVariants = extra['supports_menu_variants'] != false;
      _pharmacyLicenseCtrl.text = extra['pharmacy_license_no']?.toString() ?? '';
      _pharmacistNameCtrl.text = extra['pharmacist_name']?.toString() ?? '';
      _syndicateNoCtrl.text = extra['syndicate_no']?.toString() ?? '';
      _acceptsPrescriptions = extra['accepts_prescriptions'] != false;
      _customActivityCtrl.text = extra['custom_activity_name']?.toString() ?? '';
    });
  }

  Map<String, dynamic> _buildPayload() {
    final extra = <String, dynamic>{};
    if (_activityCategory == 'restaurant_cafe') {
      extra['cuisine_type'] = _cuisineCtrl.text.trim();
      extra['avg_prep_time_min'] = int.tryParse(_prepTimeCtrl.text.trim()) ?? 20;
      extra['supports_menu_variants'] = _supportsMenuVariants;
    } else if (_activityCategory == 'pharmacy') {
      extra['pharmacy_license_no'] = _pharmacyLicenseCtrl.text.trim();
      extra['pharmacist_name'] = _pharmacistNameCtrl.text.trim();
      extra['syndicate_no'] = _syndicateNoCtrl.text.trim();
      extra['accepts_prescriptions'] = _acceptsPrescriptions;
    } else if (_activityCategory == 'other') {
      extra['custom_activity_name'] = _customActivityCtrl.text.trim();
    }

    final map = <String, dynamic>{
      'activity_category': _activityCategory,
      'merchant_type': _merchantType,
      'owner_name': _ownerNameCtrl.text.trim(),
      'owner_national_id': _ownerNationalIdCtrl.text.trim(),
      'business_name_ar': _bizNameArCtrl.text.trim(),
      'business_name_en': _bizNameEnCtrl.text.trim(),
      'branch_name': _branchNameCtrl.text.trim(),
      'phone': _phoneCtrl.text.trim(),
      'whatsapp_phone': _whatsappCtrl.text.trim(),
      'email': _emailCtrl.text.trim(),
      'zone_name': _zoneNameCtrl.text.trim(),
      'address_detail': _addressCtrl.text.trim(),
      'working_hours': _workingHoursCtrl.text.trim(),
      'commercial_reg_no': _commercialRegCtrl.text.trim(),
      'tax_card_no': _taxCardCtrl.text.trim(),
      'description_ar': _descriptionCtrl.text.trim(),
      'activity_details': extra,
      'terms_accepted': _termsAccepted,
    };
    if (_passwordCtrl.text.trim().length >= 6) {
      map['password'] = _passwordCtrl.text.trim();
    }
    return map;
  }

  Future<bool> _saveDraft({bool showMessage = true}) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final payload = _buildPayload();
      if (_appNumber == null || _appSecret == null) {
        final created = await widget.api.createOnboardingDraft(payload);
        final appNum = created['application_number']?.toString() ??
            (created['application'] is Map ? created['application']['application_number']?.toString() : null);
        final secret = created['applicant_secret']?.toString() ?? '';
        if (appNum == null || appNum.isEmpty || secret.isEmpty) {
          throw MerchantApiException('تعذر إنشاء مسودة الطلب');
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefAppNum, appNum);
        await prefs.setString(_prefAppSecret, secret);
        _hydrateFromApplication(created, secretOverride: secret);
      } else {
        final updated = await widget.api.updateOnboardingApplication(
          applicationNumber: _appNumber!,
          secret: _appSecret!,
          payload: payload,
        );
        _hydrateFromApplication(updated);
      }
      if (showMessage && mounted) {
        setState(() {
          _notice = 'تم حفظ المسودة برقم طلب $_appNumber — يمكنك استكمالها في أي وقت ✓';
        });
      }
      return true;
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString());
      }
      return false;
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _attachTextDocument(String docType, String docLabel) async {
    final ok = await _saveDraft(showMessage: false);
    if (!ok || _appNumber == null || _appSecret == null) return;

    final noteCtrl = TextEditingController();
    final submitted = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('إرفاق مستند: $docLabel', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'أدخل رقم المستند / رابط الصورة أو ملاحظة التوثيق (لرفع صور من المعرض بسهولة يمكنك أيضًا استخدام بوابة الويب):',
              style: TextStyle(fontSize: 12, color: Color(0xFF475569)),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: noteCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'رقم الترخيص / رابط الصورة / تفاصيل المستند',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: MerchantAppConfig.brandRed),
            onPressed: () => Navigator.pop(ctx, noteCtrl.text.trim()),
            child: const Text('حفظ المستند'),
          ),
        ],
      ),
    );
    noteCtrl.dispose();
    if (submitted == null || submitted.isEmpty) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final encoded = base64Encode(utf8.encode('OTLOBHA_DOC::$docType::$submitted'));
      await widget.api.uploadOnboardingDocument(
        applicationNumber: _appNumber!,
        secret: _appSecret!,
        docType: docType,
        docLabel: docLabel,
        fileName: '$docType.txt',
        mimeType: 'text/plain',
        fileData: 'data:text/plain;base64,$encoded',
      );
      final refreshed = await widget.api.fetchOnboardingApplication(
        applicationNumber: _appNumber!,
        secret: _appSecret!,
      );
      _hydrateFromApplication(refreshed);
      if (mounted) {
        setState(() => _notice = 'تم حفظ مستند "$docLabel" بشكل آمن ✓');
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitApplication() async {
    if (_ownerNameCtrl.text.trim().isEmpty ||
        _bizNameArCtrl.text.trim().isEmpty ||
        _phoneCtrl.text.trim().isEmpty ||
        _emailCtrl.text.trim().isEmpty) {
      setState(() => _error = 'يرجى استكمال اسم المالك واسم النشاط ورقم الهاتف والبريد الإلكتروني قبل الإرسال.');
      return;
    }
    if (_activityCategory == 'pharmacy' &&
        (_pharmacyLicenseCtrl.text.trim().isEmpty || _pharmacistNameCtrl.text.trim().isEmpty)) {
      setState(() => _error = 'يرجى إدخال رقم ترخيص الصيدلية واسم الصيدلي المسؤول.');
      return;
    }

    final saved = await _saveDraft(showMessage: false);
    if (!saved || _appNumber == null || _appSecret == null) return;

    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final res = await widget.api.submitOnboardingApplication(
        applicationNumber: _appNumber!,
        secret: _appSecret!,
      );
      _hydrateFromApplication(res);
      if (mounted) {
        setState(() {
          _notice = 'تم إرسال طلب الانضمام بنجاح برقم $_appNumber وهو الآن قيد مراجعة الإدارة.';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _lookupStatus() async {
    if (_trackNumberCtrl.text.trim().isEmpty || _trackContactCtrl.text.trim().isEmpty) {
      setState(() => _error = 'أدخل رقم الطلب ورقم الهاتف أو البريد الإلكتروني المسجل');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _trackedSummary = null;
    });
    try {
      final res = await widget.api.checkOnboardingStatus(
        applicationNumber: _trackNumberCtrl.text.trim(),
        contact: _trackContactCtrl.text.trim(),
      );
      if (mounted) {
        setState(() => _trackedSummary = res);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Map<String, String>> _requiredDocsForActivity() {
    if (_activityCategory == 'pharmacy') {
      return const [
        {'type': 'national_id_front', 'label': 'بطاقة الرقم القومي للمالك (مطلوب)'},
        {'type': 'pharmacy_license', 'label': 'ترخيص مزاولة الصيدلية (مطلوب)'},
        {'type': 'pharmacist_syndicate', 'label': 'كارنيه نقابة الصيادلة (مطلوب)'},
      ];
    }
    if (_activityCategory == 'restaurant_cafe') {
      return const [
        {'type': 'national_id_front', 'label': 'بطاقة الرقم القومي للمالك (مطلوب)'},
        {'type': 'health_cert', 'label': 'الشهادة الصحية / ترخيص التشغيل'},
        {'type': 'storefront_photo', 'label': 'صورة واجهة المطعم / الكافيه'},
      ];
    }
    return const [
      {'type': 'national_id_front', 'label': 'بطاقة الرقم القومي للمالك (مطلوب)'},
      {'type': 'commercial_reg', 'label': 'السجل التجاري / البطاقة الضريبية'},
      {'type': 'storefront_photo', 'label': 'صورة واجهة المتجر'},
    ];
  }

  Widget _buildStatusBadge(String status) {
    final meta = _statusMeta[status] ?? _statusMeta['draft']!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: meta['bg'] as Color,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        meta['label'] as String,
        style: TextStyle(
          color: meta['color'] as Color,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedAct = _activities.firstWhere(
      (a) => a['key'] == _activityCategory,
      orElse: () => _activities.first,
    );
    final subtypes = (selectedAct['subtypes'] as List).cast<Map<String, String>>();

    return Scaffold(
      backgroundColor: MerchantAppConfig.surfaceBg,
      appBar: AppBar(
        backgroundColor: MerchantAppConfig.brandSlate,
        foregroundColor: Colors.white,
        title: Text(
          _trackMode ? 'متابعة طلب الانضمام' : 'انضم إلى اطلبها للتجار',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        actions: [
          TextButton(
            onPressed: () => setState(() {
              _trackMode = !_trackMode;
              _error = null;
            }),
            child: Text(
              _trackMode ? 'تقديم طلب جديد' : 'متابعة طلب',
              style: const TextStyle(color: Color(0xFFFDE68A), fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF1F2),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFECDD3)),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFF9F1239), fontSize: 12.5, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (_notice != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFECFDF5),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFA7F3D0)),
                ),
                child: Text(
                  _notice!,
                  style: const TextStyle(color: Color(0xFF065F46), fontSize: 12.5, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(height: 12),
            ],

            if (_trackMode) ...[
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'الاستعلام عن حالة طلب الانضمام',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'أدخل رقم الطلب ورقم الهاتف أو البريد الإلكتروني المسجل لمتابعة قرار الإدارة.',
                        style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        controller: _trackNumberCtrl,
                        textDirection: TextDirection.ltr,
                        decoration: const InputDecoration(
                          labelText: 'رقم الطلب (مثال: OTL-JOIN-XXXX)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _trackContactCtrl,
                        textDirection: TextDirection.ltr,
                        decoration: const InputDecoration(
                          labelText: 'رقم الهاتف أو البريد الإلكتروني المسجل',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: MerchantAppConfig.brandRed,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                        ),
                        onPressed: _busy ? null : _lookupStatus,
                        icon: const Icon(Icons.search),
                        label: Text(_busy ? 'جاري البحث...' : 'عرض حالة الطلب'),
                      ),
                    ],
                  ),
                ),
              ),
              if (_trackedSummary != null) ...[
                const SizedBox(height: 12),
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              _trackedSummary!['business_name_ar']?.toString() ?? 'طلب انضمام',
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                            ),
                            _buildStatusBadge(_trackedSummary!['status']?.toString() ?? 'draft'),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'رقم الطلب: ${_trackedSummary!['application_number'] ?? '-'}',
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                        if ((_trackedSummary!['admin_notes'] ?? '').toString().isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF7ED),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: const Color(0xFFFED7AA)),
                            ),
                            child: Text(
                              'ملاحظات الإدارة: ${_trackedSummary!['admin_notes']}',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF9A3412)),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ] else ...[
              // Active draft/application header banner
              if (_appNumber != null)
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                Text(
                                  'رقم الطلب: $_appNumber',
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.copy, size: 16),
                                  tooltip: 'نسخ رقم الطلب',
                                  onPressed: () {
                                    Clipboard.setData(ClipboardData(text: _appNumber!));
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(content: Text('تم نسخ رقم الطلب ✓')),
                                    );
                                  },
                                ),
                              ],
                            ),
                            _buildStatusBadge(_appStatus),
                          ],
                        ),
                        if (_adminNotes != null && _adminNotes!.trim().isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            'ملاحظات الإدارة: $_adminNotes',
                            style: const TextStyle(fontSize: 12, color: Color(0xFFC2410C), fontWeight: FontWeight.w700),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 10),

              // Step indicator
              Row(
                children: [
                  for (int i = 0; i < 4; i++)
                    Expanded(
                      child: GestureDetector(
                        onTap: () => setState(() => _step = i),
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          decoration: BoxDecoration(
                            color: _step == i ? MerchantAppConfig.brandRed : Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: _step == i ? MerchantAppConfig.brandRed : const Color(0xFFE2E8F0),
                            ),
                          ),
                          child: Text(
                            ['1. النشاط', '2. البيانات', '3. المستندات', '4. الإرسال'][i],
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: _step == i ? Colors.white : const Color(0xFF475569),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 14),

              if (_step == 0) ...[
                const Text(
                  'اختر نوع النشاط التجاري',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                ..._activities.map((act) {
                  final key = act['key'] as String;
                  final selected = _activityCategory == key;
                  return Card(
                    color: selected ? const Color(0xFFFFF1F2) : Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                      side: BorderSide(
                        color: selected ? MerchantAppConfig.brandRed : const Color(0xFFE2E8F0),
                        width: selected ? 1.8 : 1,
                      ),
                    ),
                    margin: const EdgeInsets.only(bottom: 10),
                    child: ListTile(
                      onTap: () {
                        setState(() {
                          _activityCategory = key;
                          _merchantType = act['defaultType'] as String;
                        });
                      },
                      leading: CircleAvatar(
                        backgroundColor: selected
                            ? MerchantAppConfig.brandRed
                            : MerchantAppConfig.brandRed.withOpacity(0.1),
                        child: Icon(
                          act['icon'] as IconData,
                          color: selected ? Colors.white : MerchantAppConfig.brandRed,
                        ),
                      ),
                      title: Text(act['title'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                      subtitle: Text(act['subtitle'] as String, style: const TextStyle(fontSize: 11.5)),
                      trailing: selected
                          ? const Icon(Icons.check_circle, color: MerchantAppConfig.brandRed)
                          : const Icon(Icons.radio_button_unchecked, color: Color(0xFF94A3B8)),
                    ),
                  );
                }),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: subtypes.any((s) => s['id'] == _merchantType) ? _merchantType : subtypes.first['id'],
                  decoration: const InputDecoration(
                    labelText: 'التخصص الدقيق للنشاط',
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(),
                  ),
                  items: subtypes
                      .map((s) => DropdownMenuItem<String>(value: s['id'], child: Text(s['label']!)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) setState(() => _merchantType = v);
                  },
                ),
              ],

              if (_step == 1) ...[
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      children: [
                        TextField(
                          controller: _bizNameArCtrl,
                          decoration: const InputDecoration(labelText: 'اسم النشاط بالعربية *', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _bizNameEnCtrl,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'الاسم بالإنجليزية (اختياري)', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _ownerNameCtrl,
                          decoration: const InputDecoration(labelText: 'اسم المالك / المدير المسؤول *', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _ownerNationalIdCtrl,
                          keyboardType: TextInputType.number,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'الرقم القومي للمالك', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _phoneCtrl,
                          keyboardType: TextInputType.phone,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'رقم الهاتف *', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _whatsappCtrl,
                          keyboardType: TextInputType.phone,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'رقم واتساب (اختياري)', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _emailCtrl,
                          keyboardType: TextInputType.emailAddress,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'البريد الإلكتروني للحساب *', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _passwordCtrl,
                          obscureText: true,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(
                            labelText: 'كلمة مرور مقترحة للدخول بعد الاعتماد (6+ أحرف)',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _branchNameCtrl,
                          decoration: const InputDecoration(labelText: 'اسم الفرع', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _zoneNameCtrl,
                          decoration: const InputDecoration(labelText: 'المنطقة / النطاق', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _addressCtrl,
                          decoration: const InputDecoration(labelText: 'العنوان التفصيلي', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _workingHoursCtrl,
                          decoration: const InputDecoration(labelText: 'ساعات العمل اليومية', border: OutlineInputBorder()),
                        ),
                      ],
                    ),
                  ),
                ),
              ],

              if (_step == 2) ...[
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('تفاصيل النشاط والمتطلبات النظامية', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _commercialRegCtrl,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'رقم السجل التجاري (إن وجد)', border: OutlineInputBorder()),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _taxCardCtrl,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'رقم البطاقة الضريبية (اختياري)', border: OutlineInputBorder()),
                        ),
                        if (_activityCategory == 'restaurant_cafe') ...[
                          const SizedBox(height: 10),
                          TextField(
                            controller: _cuisineCtrl,
                            decoration: const InputDecoration(labelText: 'نوع المطبخ / الأصناف (مشويات، بيتزا، قهوة...)', border: OutlineInputBorder()),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _prepTimeCtrl,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(labelText: 'متوسط وقت التحضير (بالدقائق)', border: OutlineInputBorder()),
                          ),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('دعم الأحجام والإضافات في المنيو', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                            value: _supportsMenuVariants,
                            onChanged: (v) => setState(() => _supportsMenuVariants = v),
                          ),
                        ],
                        if (_activityCategory == 'pharmacy') ...[
                          const SizedBox(height: 10),
                          TextField(
                            controller: _pharmacyLicenseCtrl,
                            textDirection: TextDirection.ltr,
                            decoration: const InputDecoration(labelText: 'رقم ترخيص الصيدلية *', border: OutlineInputBorder()),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _pharmacistNameCtrl,
                            decoration: const InputDecoration(labelText: 'اسم الصيدلي المسؤول *', border: OutlineInputBorder()),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _syndicateNoCtrl,
                            textDirection: TextDirection.ltr,
                            decoration: const InputDecoration(labelText: 'رقم قيد نقابة الصيادلة', border: OutlineInputBorder()),
                          ),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('استقبال وصرف الوصفات الطبية (الروشتات)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                            value: _acceptsPrescriptions,
                            onChanged: (v) => setState(() => _acceptsPrescriptions = v),
                          ),
                        ],
                        if (_activityCategory == 'other') ...[
                          const SizedBox(height: 10),
                          TextField(
                            controller: _customActivityCtrl,
                            decoration: const InputDecoration(labelText: 'وصف النشاط التجاري', border: OutlineInputBorder()),
                          ),
                        ],
                        const SizedBox(height: 14),
                        const Text('المستندات المطلوبة (محمية ولا تظهر إلا للإدارة)', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                        const SizedBox(height: 8),
                        ..._requiredDocsForActivity().map((d) {
                          final attached = _uploadedDocs.any((u) => u['doc_type'] == d['type']);
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              attached ? Icons.verified_rounded : Icons.upload_file_outlined,
                              color: attached ? MerchantAppConfig.brandTeal : MerchantAppConfig.brandRed,
                            ),
                            title: Text(d['label']!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                            subtitle: Text(attached ? 'مرفق ومحفوظ بأمان ✓' : 'اضغط لإرفاق بيانات/مرجع المستند', style: const TextStyle(fontSize: 11)),
                            trailing: OutlinedButton(
                              onPressed: _busy ? null : () => _attachTextDocument(d['type']!, d['label']!),
                              child: Text(attached ? 'تحديث' : 'إرفاق'),
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
                ),
              ],

              if (_step == 3) ...[
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('مراجعة قبل الإرسال للاعتماد', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 10),
                        Text('نوع النشاط: ${selectedAct['title']}'),
                        Text('اسم المنشأة: ${_bizNameArCtrl.text.isEmpty ? '-' : _bizNameArCtrl.text}'),
                        Text('المالك: ${_ownerNameCtrl.text.isEmpty ? '-' : _ownerNameCtrl.text}'),
                        Text('الهاتف: ${_phoneCtrl.text.isEmpty ? '-' : _phoneCtrl.text}'),
                        Text('البريد: ${_emailCtrl.text.isEmpty ? '-' : _emailCtrl.text}'),
                        Text('المستندات المرفقة: ${_uploadedDocs.length}'),
                        const SizedBox(height: 10),
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _termsAccepted,
                          onChanged: (v) => setState(() => _termsAccepted = v == true),
                          title: const Text(
                            'أقر بصحة البيانات والمستندات وأوافق على شروط واتفاقية الانضمام لمنصة اطلبها',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF3C7),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Text(
                            'تنبيه: لن يتم تفعيل الحساب أو ظهوره للعملاء إلا بعد مراجعة واعتماد إدارة اطلبها.',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF92400E)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _saveDraft(showMessage: true),
                      icon: const Icon(Icons.save_outlined),
                      label: const Text('حفظ كمسودة'),
                      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 13)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (_step < 3)
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: MerchantAppConfig.brandRed,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                        ),
                        onPressed: _busy ? null : () => setState(() => _step += 1),
                        icon: const Icon(Icons.arrow_back_ios_new, size: 15),
                        label: const Text('التالي'),
                      ),
                    )
                  else
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: MerchantAppConfig.brandTeal,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                        ),
                        onPressed: _busy ? null : _submitApplication,
                        icon: const Icon(Icons.send_rounded),
                        label: Text(_busy ? 'جاري الإرسال...' : 'إرسال للاعتماد'),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
