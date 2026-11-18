import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class CustomerOtpLoginScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final void Function(Map<String, dynamic> user) onVerified;

  const CustomerOtpLoginScreen({super.key, required this.api, required this.onVerified});

  @override
  State<CustomerOtpLoginScreen> createState() => _CustomerOtpLoginScreenState();
}

class _CustomerOtpLoginScreenState extends State<CustomerOtpLoginScreen> {
  final TextEditingController _emailCtrl = TextEditingController();
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _phoneCtrl = TextEditingController();
  final TextEditingController _codeCtrl = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;
  String? _demoOtp;
  String _normalizedEmail = '';
  String _deliveryChannel = 'sandbox';
  int _resendSec = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _emailCtrl.dispose();
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  void _startTimer() {
    _timer?.cancel();
    setState(() => _resendSec = 60);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _resendSec <= 0) {
        t.cancel();
        return;
      }
      setState(() => _resendSec--);
    });
  }

  Future<void> _sendOtp() async {
    final raw = _emailCtrl.text.trim();
    if (raw.isEmpty || !raw.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل بريدًا إلكترونيًا صحيحًا أولًا')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.requestOtp(raw, role: 'customer');
      if (mounted) {
        setState(() {
          _otpSent = true;
          _normalizedEmail = res['email']?.toString() ?? raw.toLowerCase();
          _deliveryChannel = res['delivery_channel']?.toString() ?? 'sandbox';
          _demoOtp = res['demo_otp']?.toString();
          _codeCtrl.clear();
        });
        _startTimer();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _demoOtp != null
                  ? 'تم إنشاء رمز التأكيد للبريد $_normalizedEmail (الرمز: $_demoOtp)'
                  : 'تم إرسال رسالة برقم التأكيد إلى بريدك $_normalizedEmail',
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
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyOtp() async {
    final code = _codeCtrl.text.trim();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل رقم التأكيد المكون من 6 أرقام')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.verifyOtp(
        _normalizedEmail,
        code,
        role: 'customer',
        fullName: _nameCtrl.text.trim(),
        phone: _phoneCtrl.text.trim(),
      );
      final user = Map<String, dynamic>.from((res['user'] as Map?) ?? {});
      if (mounted) {
        widget.onVerified(user);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(18),
                    child: Container(
                      color: Colors.white,
                      padding: const EdgeInsets.all(6),
                      child: Image.asset('assets/images/otlobha_logo.jpg', width: 90, height: 90, fit: BoxFit.contain),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'اطلبها – المنزلة',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                ),
                const SizedBox(height: 4),
                const Text(
                  'سجّل الدخول بتأكيد بريدك الإلكتروني مجانًا',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
                const SizedBox(height: 22),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: !_otpSent
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Directionality(
                                textDirection: TextDirection.ltr,
                                child: TextField(
                                  controller: _emailCtrl,
                                  keyboardType: TextInputType.emailAddress,
                                  decoration: const InputDecoration(
                                    border: OutlineInputBorder(),
                                    labelText: 'البريد الإلكتروني',
                                    hintText: 'name@gmail.com',
                                    prefixIcon: Icon(Icons.email_outlined),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              TextField(
                                controller: _nameCtrl,
                                decoration: const InputDecoration(
                                  border: OutlineInputBorder(),
                                  labelText: 'الاسم (اختياري / للعميل الجديد)',
                                  prefixIcon: Icon(Icons.person_outline),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Directionality(
                                textDirection: TextDirection.ltr,
                                child: TextField(
                                  controller: _phoneCtrl,
                                  keyboardType: TextInputType.phone,
                                  decoration: const InputDecoration(
                                    border: OutlineInputBorder(),
                                    labelText: 'رقم الهاتف للتوصيل (اختياري)',
                                    hintText: '01xxxxxxxxx',
                                    prefixIcon: Icon(Icons.phone_android),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                              ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFEA580C),
                                  foregroundColor: Colors.white,
                                  minimumSize: const Size.fromHeight(48),
                                ),
                                onPressed: _loading ? null : _sendOtp,
                                icon: const Icon(Icons.mark_email_read_outlined),
                                label: Text(_loading ? 'جاري إرسال الرمز...' : 'إرسال رمز التأكيد إلى البريد'),
                              ),
                            ],
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      'الرمز مرسل إلى: $_normalizedEmail',
                                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: () => setState(() {
                                      _otpSent = false;
                                      _demoOtp = null;
                                    }),
                                    child: const Text('تغيير البريد'),
                                  ),
                                ],
                              ),
                              if (_deliveryChannel == 'sandbox' && _demoOtp != null) ...[
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF0FDFA),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: const Color(0xFF99F6E4)),
                                  ),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          'رسالة البريد التجريبية: رمز التأكيد $_demoOtp',
                                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF115E59)),
                                        ),
                                      ),
                                      TextButton(
                                        onPressed: () => setState(() => _codeCtrl.text = _demoOtp!),
                                        child: const Text('تعبئة'),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 12),
                              ],
                              Directionality(
                                textDirection: TextDirection.ltr,
                                child: TextField(
                                  controller: _codeCtrl,
                                  keyboardType: TextInputType.number,
                                  maxLength: 6,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 6),
                                  decoration: const InputDecoration(
                                    border: OutlineInputBorder(),
                                    labelText: 'أدخل رمز التأكيد (6 أرقام)',
                                    counterText: '',
                                  ),
                                ),
                              ),
                              const SizedBox(height: 14),
                              ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF0D9488),
                                  foregroundColor: Colors.white,
                                  minimumSize: const Size.fromHeight(48),
                                ),
                                onPressed: _loading ? null : _verifyOtp,
                                icon: const Icon(Icons.verified_user_outlined),
                                label: Text(_loading ? 'جاري التحقق...' : 'تأكيد الرمز وتسجيل الدخول'),
                              ),
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: (_resendSec > 0 || _loading) ? null : _sendOtp,
                                child: Text(_resendSec > 0 ? 'إعادة الإرسال بعد $_resendSec ث' : 'إعادة إرسال الرمز إلى البريد'),
                              ),
                            ],
                          ),
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
