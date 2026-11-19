import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

enum _AuthMode { login, register, forgotPassword, otpLogin }

class CustomerOtpLoginScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final void Function(Map<String, dynamic> user) onVerified;
  final VoidCallback? onContinueAsGuest;
  final bool openedFromGuest;

  const CustomerOtpLoginScreen({
    super.key,
    required this.api,
    required this.onVerified,
    this.onContinueAsGuest,
    this.openedFromGuest = false,
  });

  @override
  State<CustomerOtpLoginScreen> createState() => _CustomerOtpLoginScreenState();
}

class _CustomerOtpLoginScreenState extends State<CustomerOtpLoginScreen> {
  _AuthMode _mode = _AuthMode.login;

  // Login controllers
  final TextEditingController _loginIdentifierCtrl = TextEditingController();
  final TextEditingController _loginPasswordCtrl = TextEditingController();
  bool _obscureLoginPass = true;

  // Register controllers (2-step with email OTP verification)
  final TextEditingController _regNameCtrl = TextEditingController();
  final TextEditingController _regEmailCtrl = TextEditingController();
  final TextEditingController _regPhoneCtrl = TextEditingController();
  final TextEditingController _regPasswordCtrl = TextEditingController();
  final TextEditingController _regConfirmPassCtrl = TextEditingController();
  final TextEditingController _regCodeCtrl = TextEditingController();
  bool _regCodeSent = false;
  bool _regUseLegacyOtp = false;
  String _regNormalizedEmail = '';
  int _regResendSec = 0;
  Timer? _regTimer;
  bool _obscureRegPass = true;
  bool _obscureRegConfirmPass = true;

  // Forgot password controllers
  final TextEditingController _forgotEmailCtrl = TextEditingController();
  final TextEditingController _forgotCodeCtrl = TextEditingController();
  final TextEditingController _forgotNewPassCtrl = TextEditingController();
  final TextEditingController _forgotConfirmPassCtrl = TextEditingController();
  bool _forgotCodeSent = false;
  String _forgotNormalizedEmail = '';
  bool _obscureForgotPass = true;
  bool _obscureForgotConfirmPass = true;
  int _forgotResendSec = 0;
  Timer? _forgotTimer;

  // Gmail OTP quick login controllers (preserved)
  final TextEditingController _otpEmailCtrl = TextEditingController();
  final TextEditingController _otpNameCtrl = TextEditingController();
  final TextEditingController _otpPhoneCtrl = TextEditingController();
  final TextEditingController _otpCodeCtrl = TextEditingController();
  bool _otpSent = false;
  String _otpNormalizedEmail = '';
  String _deliveryChannel = 'smtp';
  String? _demoOtp;
  int _otpResendSec = 0;
  Timer? _otpTimer;

  bool _loading = false;

  @override
  void dispose() {
    _otpTimer?.cancel();
    _forgotTimer?.cancel();
    _regTimer?.cancel();
    _loginIdentifierCtrl.dispose();
    _loginPasswordCtrl.dispose();
    _regNameCtrl.dispose();
    _regEmailCtrl.dispose();
    _regPhoneCtrl.dispose();
    _regPasswordCtrl.dispose();
    _regConfirmPassCtrl.dispose();
    _regCodeCtrl.dispose();
    _forgotEmailCtrl.dispose();
    _forgotCodeCtrl.dispose();
    _forgotNewPassCtrl.dispose();
    _forgotConfirmPassCtrl.dispose();
    _otpEmailCtrl.dispose();
    _otpNameCtrl.dispose();
    _otpPhoneCtrl.dispose();
    _otpCodeCtrl.dispose();
    super.dispose();
  }

  void _showMessage(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _cleanError(Object e) => e.toString().replaceFirst('Exception: ', '');

  void _startOtpTimer() {
    _otpTimer?.cancel();
    setState(() => _otpResendSec = 60);
    _otpTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _otpResendSec <= 0) {
        t.cancel();
        return;
      }
      setState(() => _otpResendSec--);
    });
  }

  void _startForgotTimer() {
    _forgotTimer?.cancel();
    setState(() => _forgotResendSec = 60);
    _forgotTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _forgotResendSec <= 0) {
        t.cancel();
        return;
      }
      setState(() => _forgotResendSec--);
    });
  }

  Future<void> _submitLogin() async {
    final identifier = _loginIdentifierCtrl.text.trim();
    final password = _loginPasswordCtrl.text;
    if (identifier.isEmpty) {
      _showMessage('يرجى إدخال البريد الإلكتروني أو رقم الهاتف');
      return;
    }
    if (password.isEmpty) {
      _showMessage('يرجى إدخال كلمة المرور');
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.loginCustomer(
        identifier: identifier,
        password: password,
      );
      final user = Map<String, dynamic>.from((res['user'] as Map?) ?? {});
      if (mounted) widget.onVerified(user);
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _startRegTimer() {
    _regTimer?.cancel();
    setState(() => _regResendSec = 60);
    _regTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _regResendSec <= 0) {
        t.cancel();
        return;
      }
      setState(() => _regResendSec--);
    });
  }

  Future<void> _sendRegisterOtp() async {
    final fullName = _regNameCtrl.text.trim();
    final email = _regEmailCtrl.text.trim();
    final phone = _regPhoneCtrl.text.trim();
    final password = _regPasswordCtrl.text;
    final confirm = _regConfirmPassCtrl.text;

    if (fullName.length < 2) {
      _showMessage('يرجى إدخال الاسم الكامل (حرفين على الأقل)');
      return;
    }
    if (email.isEmpty || !email.contains('@')) {
      _showMessage('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }
    if (password.length < 6) {
      _showMessage('كلمة المرور يجب أن لا تقل عن 6 أحرف');
      return;
    }
    if (password != confirm) {
      _showMessage('كلمتا المرور غير متطابقتين');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.requestCustomerRegisterOtp(
        fullName: fullName,
        email: email,
        phone: phone,
        password: password,
      );
      if (mounted) {
        setState(() {
          _regCodeSent = true;
          _regUseLegacyOtp = res['auth_flow']?.toString() == 'legacy_otp';
          _regNormalizedEmail = res['email']?.toString() ?? email.toLowerCase();
          _regCodeCtrl.clear();
        });
        _startRegTimer();
        _showMessage(
          res['message']?.toString() ?? 'تم إرسال رمز تأكيد البريد إلى $_regNormalizedEmail',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitRegister() async {
    final fullName = _regNameCtrl.text.trim();
    final email = _regNormalizedEmail.isNotEmpty ? _regNormalizedEmail : _regEmailCtrl.text.trim();
    final phone = _regPhoneCtrl.text.trim();
    final password = _regPasswordCtrl.text;
    final code = _regCodeCtrl.text.trim();

    if (code.length != 6) {
      _showMessage('أدخل رمز تأكيد البريد المكون من 6 أرقام');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.registerCustomer(
        fullName: fullName,
        email: email,
        phone: phone,
        password: password,
        code: code,
        useLegacyOtpFlow: _regUseLegacyOtp,
      );
      final user = Map<String, dynamic>.from((res['user'] as Map?) ?? {});
      if (mounted) {
        _showMessage('تم تأكيد بريدك الإلكتروني وإنشاء حسابك بنجاح!');
        widget.onVerified(user);
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendForgotPasswordCode() async {
    final raw = _forgotEmailCtrl.text.trim();
    if (raw.isEmpty || !raw.contains('@')) {
      _showMessage('أدخل البريد الإلكتروني المسجل به حسابك');
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.requestPasswordReset(raw);
      if (mounted) {
        setState(() {
          _forgotCodeSent = true;
          _forgotNormalizedEmail = res['email']?.toString() ?? raw.toLowerCase();
          _forgotCodeCtrl.clear();
        });
        _startForgotTimer();
        _showMessage(
          res['message']?.toString() ?? 'تم إرسال رمز إعادة تعيين كلمة المرور إلى $_forgotNormalizedEmail',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitResetPassword() async {
    final code = _forgotCodeCtrl.text.trim();
    final newPass = _forgotNewPassCtrl.text;
    final confirm = _forgotConfirmPassCtrl.text;

    if (code.length != 6) {
      _showMessage('أدخل رمز التحقق المكون من 6 أرقام');
      return;
    }
    if (newPass.length < 6) {
      _showMessage('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف');
      return;
    }
    if (newPass != confirm) {
      _showMessage('كلمتا المرور غير متطابقتين');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.resetPassword(
        email: _forgotNormalizedEmail,
        code: code,
        newPassword: newPass,
      );
      final user = Map<String, dynamic>.from((res['user'] as Map?) ?? {});
      if (mounted) {
        _showMessage(res['message']?.toString() ?? 'تم تحديث كلمة المرور بنجاح');
        widget.onVerified(user);
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendOtp() async {
    final raw = _otpEmailCtrl.text.trim();
    if (raw.isEmpty || !raw.contains('@')) {
      _showMessage('أدخل بريدًا إلكترونيًا صحيحًا أولًا');
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.requestOtp(raw, role: 'customer');
      if (mounted) {
        setState(() {
          _otpSent = true;
          _otpNormalizedEmail = res['email']?.toString() ?? raw.toLowerCase();
          _deliveryChannel = res['delivery_channel']?.toString() ?? 'smtp';
          _demoOtp = res['demo_otp']?.toString();
          _otpCodeCtrl.clear();
        });
        _startOtpTimer();
        _showMessage(
          _demoOtp != null
              ? 'تم إنشاء رمز التأكيد للبريد $_otpNormalizedEmail (الرمز: $_demoOtp)'
              : 'تم إرسال رسالة برقم التأكيد إلى بريدك $_otpNormalizedEmail',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyOtp() async {
    final code = _otpCodeCtrl.text.trim();
    if (code.length != 6) {
      _showMessage('أدخل رقم التأكيد المكون من 6 أرقام');
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.verifyOtp(
        _otpNormalizedEmail,
        code,
        role: 'customer',
        fullName: _otpNameCtrl.text.trim(),
        phone: _otpPhoneCtrl.text.trim(),
      );
      final user = Map<String, dynamic>.from((res['user'] as Map?) ?? {});
      if (mounted) widget.onVerified(user);
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _buildModeSwitcher() {
    final isLoginTab = _mode == _AuthMode.login || _mode == _AuthMode.otpLogin;
    final isRegisterTab = _mode == _AuthMode.register;

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: _loading ? null : () => setState(() => _mode = _AuthMode.login),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: isLoginTab ? const Color(0xFFA92224) : Colors.transparent,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  'تسجيل الدخول',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13.5,
                    color: isLoginTab ? Colors.white : const Color(0xFF475569),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: GestureDetector(
              onTap: _loading ? null : () => setState(() => _mode = _AuthMode.register),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: isRegisterTab ? const Color(0xFFA92224) : Colors.transparent,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  'إنشاء حساب جديد',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13.5,
                    color: isRegisterTab ? Colors.white : const Color(0xFF475569),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoginForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _loginIdentifierCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'البريد الإلكتروني أو رقم الهاتف',
              hintText: 'name@gmail.com / 01xxxxxxxxx',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _loginPasswordCtrl,
            obscureText: _obscureLoginPass,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              labelText: 'كلمة المرور',
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscureLoginPass = !_obscureLoginPass),
                icon: Icon(_obscureLoginPass ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: _loading
                ? null
                : () {
                    final typed = _loginIdentifierCtrl.text.trim();
                    if (typed.contains('@') && _forgotEmailCtrl.text.trim().isEmpty) {
                      _forgotEmailCtrl.text = typed;
                    }
                    setState(() {
                      _mode = _AuthMode.forgotPassword;
                      _forgotCodeSent = false;
                    });
                  },
            child: const Text(
              'هل نسيت كلمة السر؟',
              style: TextStyle(color: Color(0xFFA92224), fontWeight: FontWeight.bold, fontSize: 12.5),
            ),
          ),
        ),
        const SizedBox(height: 4),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFA92224),
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _loading ? null : _submitLogin,
          icon: const Icon(Icons.login),
          label: Text(_loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'),
        ),
        const SizedBox(height: 10),
        TextButton.icon(
          onPressed: _loading
              ? null
              : () => setState(() {
                    _mode = _AuthMode.otpLogin;
                    _otpSent = false;
                  }),
          icon: const Icon(Icons.mark_email_read_outlined, size: 18, color: Color(0xFF0D9488)),
          label: const Text(
            'أو تسجيل الدخول السريع برمز البريد (OTP)',
            style: TextStyle(color: Color(0xFF0D9488), fontSize: 12.5, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Widget _buildRegisterForm() {
    if (_regCodeSent) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF0FDFA),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF99F6E4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.verified_user_outlined, color: Color(0xFF0F766E), size: 18),
                    const SizedBox(width: 6),
                    const Expanded(
                      child: Text(
                        'تأكيد البريد الإلكتروني',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF134E4A)),
                      ),
                    ),
                    TextButton(
                      onPressed: _loading
                          ? null
                          : () => setState(() {
                                _regCodeSent = false;
                                _regCodeCtrl.clear();
                              }),
                      child: const Text('تعديل البيانات', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
                Text(
                  'تم إرسال رمز تأكيد مكون من 6 أرقام إلى بريدك:\n$_regNormalizedEmail',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF115E59)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _regCodeCtrl,
              keyboardType: TextInputType.number,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: 8),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'رمز تأكيد البريد (6 أرقام)',
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
            onPressed: _loading ? null : _submitRegister,
            icon: const Icon(Icons.check_circle_outline),
            label: Text(_loading ? 'جاري تأكيد البريد وإنشاء الحساب...' : 'تأكيد البريد وإنشاء الحساب'),
          ),
          const SizedBox(height: 6),
          TextButton.icon(
            onPressed: (_loading || _regResendSec > 0) ? null : _sendRegisterOtp,
            icon: const Icon(Icons.refresh, size: 16),
            label: Text(
              _regResendSec > 0 ? 'إعادة الإرسال بعد $_regResendSec ث' : 'إعادة إرسال رمز التأكيد',
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'أدخل بياناتك وسنرسل رمز تأكيد من 6 أرقام إلى بريدك الإلكتروني لتفعيل حسابك.',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _regNameCtrl,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            labelText: 'الاسم الكامل',
            prefixIcon: Icon(Icons.badge_outlined),
          ),
        ),
        const SizedBox(height: 10),
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _regEmailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'البريد الإلكتروني (لإرسال كود التأكيد)',
              hintText: 'name@gmail.com',
              prefixIcon: Icon(Icons.email_outlined),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _regPhoneCtrl,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'رقم الهاتف للتوصيل (اختياري)',
              hintText: '01xxxxxxxxx',
              prefixIcon: Icon(Icons.phone_android),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _regPasswordCtrl,
            obscureText: _obscureRegPass,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              labelText: 'كلمة المرور (6 أحرف على الأقل)',
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscureRegPass = !_obscureRegPass),
                icon: Icon(_obscureRegPass ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Directionality(
          textDirection: TextDirection.ltr,
          child: TextField(
            controller: _regConfirmPassCtrl,
            obscureText: _obscureRegConfirmPass,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              labelText: 'تأكيد كلمة المرور',
              prefixIcon: const Icon(Icons.lock_reset_outlined),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscureRegConfirmPass = !_obscureRegConfirmPass),
                icon: Icon(_obscureRegConfirmPass ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFEA580C),
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _loading ? null : _sendRegisterOtp,
          icon: const Icon(Icons.mark_email_unread_outlined),
          label: Text(_loading ? 'جاري إرسال رمز التأكيد...' : 'إرسال رمز تأكيد البريد الإلكتروني'),
        ),
      ],
    );
  }

  Widget _buildForgotPasswordForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.lock_reset, color: Color(0xFFA92224)),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'استعادة كلمة السر',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFF0F172A)),
              ),
            ),
            TextButton(
              onPressed: _loading ? null : () => setState(() => _mode = _AuthMode.login),
              child: const Text('رجوع للدخول'),
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (!_forgotCodeSent) ...[
          const Text(
            'أدخل بريدك الإلكتروني المسجل وسنرسل لك رمز تحقق مكونًا من 6 أرقام لإعادة تعيين كلمة المرور.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 12),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _forgotEmailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'البريد الإلكتروني المسجل',
                hintText: 'name@gmail.com',
                prefixIcon: Icon(Icons.email_outlined),
              ),
            ),
          ),
          const SizedBox(height: 14),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFA92224),
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(48),
            ),
            onPressed: _loading ? null : _sendForgotPasswordCode,
            icon: const Icon(Icons.send_outlined),
            label: Text(_loading ? 'جاري إرسال الرمز...' : 'إرسال رمز الاستعادة إلى البريد'),
          ),
        ] else ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  'الرمز مرسل إلى: $_forgotNormalizedEmail',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5),
                ),
              ),
              TextButton(
                onPressed: _loading ? null : () => setState(() => _forgotCodeSent = false),
                child: const Text('تغيير البريد'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _forgotCodeCtrl,
              keyboardType: TextInputType.number,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 6),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'رمز التحقق (6 أرقام)',
                counterText: '',
              ),
            ),
          ),
          const SizedBox(height: 10),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _forgotNewPassCtrl,
              obscureText: _obscureForgotPass,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: 'كلمة المرور الجديدة (6 أحرف على الأقل)',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscureForgotPass = !_obscureForgotPass),
                  icon: Icon(_obscureForgotPass ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _forgotConfirmPassCtrl,
              obscureText: _obscureForgotConfirmPass,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: 'تأكيد كلمة المرور الجديدة',
                prefixIcon: const Icon(Icons.lock_reset_outlined),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscureForgotConfirmPass = !_obscureForgotConfirmPass),
                  icon: Icon(_obscureForgotConfirmPass ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                ),
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
            onPressed: _loading ? null : _submitResetPassword,
            icon: const Icon(Icons.check_circle_outline),
            label: Text(_loading ? 'جاري التحديث...' : 'حفظ كلمة المرور الجديدة والدخول'),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: (_forgotResendSec > 0 || _loading) ? null : _sendForgotPasswordCode,
            child: Text(
              _forgotResendSec > 0 ? 'إعادة الإرسال بعد $_forgotResendSec ث' : 'إعادة إرسال الرمز إلى البريد',
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildOtpLoginForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.mark_email_read_outlined, color: Color(0xFF0D9488)),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'الدخول السريع برمز البريد (OTP)',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF0F172A)),
              ),
            ),
            TextButton(
              onPressed: _loading ? null : () => setState(() => _mode = _AuthMode.login),
              child: const Text('دخول بكلمة المرور'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (!_otpSent) ...[
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _otpEmailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'البريد الإلكتروني',
                hintText: 'name@gmail.com',
                prefixIcon: Icon(Icons.email_outlined),
              ),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _otpNameCtrl,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'الاسم (اختياري / للعميل الجديد)',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 10),
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _otpPhoneCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'رقم الهاتف للتوصيل (اختياري)',
                hintText: '01xxxxxxxxx',
                prefixIcon: Icon(Icons.phone_android),
              ),
            ),
          ),
          const SizedBox(height: 14),
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
        ] else ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  'الرمز مرسل إلى: $_otpNormalizedEmail',
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
                    onPressed: () => setState(() => _otpCodeCtrl.text = _demoOtp!),
                    child: const Text('تعبئة'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              controller: _otpCodeCtrl,
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
            onPressed: (_otpResendSec > 0 || _loading) ? null : _sendOtp,
            child: Text(_otpResendSec > 0 ? 'إعادة الإرسال بعد $_otpResendSec ث' : 'إعادة إرسال الرمز إلى البريد'),
          ),
        ],
      ],
    );
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
                      child: Image.asset(
                        'assets/images/otlobha_logo.jpg',
                        width: 84,
                        height: 84,
                        fit: BoxFit.contain,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'اطلبها – المنزلة',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                ),
                const SizedBox(height: 4),
                const Text(
                  'سجّل دخولك أو أنشئ حسابًا جديدًا أو تصفّح التطبيق كزائر',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
                const SizedBox(height: 18),
                Card(
                  elevation: 1.5,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_mode != _AuthMode.forgotPassword) ...[
                          _buildModeSwitcher(),
                          const SizedBox(height: 16),
                        ],
                        if (_mode == _AuthMode.login) _buildLoginForm(),
                        if (_mode == _AuthMode.register) _buildRegisterForm(),
                        if (_mode == _AuthMode.forgotPassword) _buildForgotPasswordForm(),
                        if (_mode == _AuthMode.otpLogin) _buildOtpLoginForm(),
                      ],
                    ),
                  ),
                ),
                if (widget.onContinueAsGuest != null) ...[
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF0F172A),
                      side: const BorderSide(color: Color(0xFFCBD5E1), width: 1.4),
                      backgroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _loading ? null : widget.onContinueAsGuest,
                    icon: const Icon(Icons.explore_outlined),
                    label: Text(
                      widget.openedFromGuest ? 'العودة للتصفح كزائر' : 'الدخول كزائر',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'يمكنك تصفح المتاجر والعروض والمنتجات كزائر ثم التسجيل عند إتمام الطلب',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: Colors.black45),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
