import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../core/api_client.dart';

enum _AuthScreenMode { login, register, verifyLinkSent, forgot, forgotLinkSent }

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
  _AuthScreenMode _mode = _AuthScreenMode.login;

  // Login controllers
  final TextEditingController _loginIdentifierCtrl = TextEditingController();
  final TextEditingController _loginPasswordCtrl = TextEditingController();
  bool _obscureLoginPass = true;

  // Register controllers (clickable email verification link — no OTP code)
  final TextEditingController _regNameCtrl = TextEditingController();
  final TextEditingController _regEmailCtrl = TextEditingController();
  final TextEditingController _regPasswordCtrl = TextEditingController();
  final TextEditingController _regConfirmPassCtrl = TextEditingController();
  bool _obscureRegPass = true;
  bool _obscureRegConfirmPass = true;
  String _regNormalizedEmail = '';
  int _regResendSec = 0;
  Timer? _regTimer;

  // Forgot password controllers (clickable reset link — no OTP code)
  final TextEditingController _forgotEmailCtrl = TextEditingController();
  String _forgotNormalizedEmail = '';
  int _forgotResendSec = 0;
  Timer? _forgotTimer;

  bool _loading = false;
  bool _googleLoading = false;

  @override
  void dispose() {
    _regTimer?.cancel();
    _forgotTimer?.cancel();
    _loginIdentifierCtrl.dispose();
    _loginPasswordCtrl.dispose();
    _regNameCtrl.dispose();
    _regEmailCtrl.dispose();
    _regPasswordCtrl.dispose();
    _regConfirmPassCtrl.dispose();
    _forgotEmailCtrl.dispose();
    super.dispose();
  }

  void _showMessage(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _cleanError(Object e) => e.toString().replaceFirst('Exception: ', '');

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

  Future<void> _signInWithGoogle() async {
    if (_loading || _googleLoading) return;
    setState(() => _googleLoading = true);
    try {
      final googleSignIn = GoogleSignIn(scopes: const ['email', 'profile']);
      // Clear stale cached account selection so the Google account chooser always opens cleanly
      try {
        await googleSignIn.signOut();
      } catch (_) {}

      final account = await googleSignIn.signIn();
      if (account == null) {
        // User dismissed Google picker
        return;
      }
      final googleAuth = await account.authentication;
      String? tokenToVerify = googleAuth.idToken;

      // Prefer Firebase Auth ID token when Firebase is configured on device
      if (Firebase.apps.isNotEmpty && (googleAuth.idToken != null || googleAuth.accessToken != null)) {
        try {
          final cred = GoogleAuthProvider.credential(
            accessToken: googleAuth.accessToken,
            idToken: googleAuth.idToken,
          );
          final userCred = await FirebaseAuth.instance.signInWithCredential(cred);
          final fbToken = await userCred.user?.getIdToken();
          if (fbToken != null && fbToken.isNotEmpty) {
            tokenToVerify = fbToken;
          }
        } catch (fbErr) {
          debugPrint('[GoogleSignIn] FirebaseAuth exchange fallback: $fbErr');
        }
      }

      if (tokenToVerify == null || tokenToVerify.isEmpty) {
        _showMessage('تعذر الحصول على رمز التحقق من جوجل، تأكد من تفعيل Google Sign-In في إعدادات Firebase');
        return;
      }

      final res = await widget.api.signInWithGoogle(tokenToVerify);
      final user = res['user'] is Map
          ? Map<String, dynamic>.from(res['user'] as Map)
          : <String, dynamic>{};
      if (res['needs_profile_completion'] == true) {
        user['needs_profile_completion'] = true;
      }
      if (!mounted) return;
      _showMessage(
        user['needs_profile_completion'] == true
            ? 'تم تسجيل الدخول بحساب جوجل — يرجى إكمال بياناتك الشخصية للمتابعة'
            : 'أهلاً بك! تم تسجيل الدخول بحساب جوجل بنجاح',
      );
      widget.onVerified(user);
    } catch (e) {
      _showMessage('تعذر تسجيل الدخول بجوجل: ${_cleanError(e)}');
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  Future<void> _submitLogin() async {
    final rawIdent = _loginIdentifierCtrl.text.trim();
    final pass = _loginPasswordCtrl.text;
    if (rawIdent.isEmpty || pass.isEmpty) {
      _showMessage('يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور');
      return;
    }
    final identifier = (rawIdent.contains('@') || rawIdent.contains('＠'))
        ? OtlobhaCustomerApi.normalizeEmail(rawIdent)
        : rawIdent;
    if (identifier == null || identifier.isEmpty) {
      _showMessage('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.loginCustomer(identifier: identifier, password: pass);
      final user = res['user'] is Map
          ? Map<String, dynamic>.from(res['user'] as Map)
          : <String, dynamic>{};
      await widget.api.persistUserSnapshot(user);
      if (mounted) {
        _showMessage('تم تسجيل الدخول بنجاح');
        widget.onVerified(user);
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendVerificationLink() async {
    final name = _regNameCtrl.text.trim();
    final rawEmail = _regEmailCtrl.text;
    final cleanEmail = OtlobhaCustomerApi.normalizeEmail(rawEmail);
    final pass = _regPasswordCtrl.text;
    final confirm = _regConfirmPassCtrl.text;

    if (name.length < 2) {
      _showMessage('يرجى إدخال الاسم الكامل (حرفين على الأقل)');
      return;
    }
    if (cleanEmail == null) {
      _showMessage('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }
    if (pass.length < 6) {
      _showMessage('كلمة المرور يجب أن لا تقل عن 6 أحرف');
      return;
    }
    if (pass != confirm) {
      _showMessage('كلمتا المرور غير متطابقتين');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.sendRegisterVerificationLink(
        fullName: name,
        email: cleanEmail,
        password: pass,
      );
      if (mounted) {
        setState(() {
          _regNormalizedEmail = res['email']?.toString() ?? cleanEmail;
          _mode = _AuthScreenMode.verifyLinkSent;
        });
        _startRegTimer();
        _showMessage(
          res['message']?.toString() ?? 'تم إرسال رابط تأكيد الحساب إلى $_regNormalizedEmail',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _checkVerificationAndContinue() async {
    final cleanEmail = OtlobhaCustomerApi.normalizeEmail(
      _regNormalizedEmail.isNotEmpty ? _regNormalizedEmail : _regEmailCtrl.text,
    );
    if (cleanEmail == null) return;

    setState(() => _loading = true);
    try {
      final res = await widget.api.checkRegisterEmailVerified(
        email: cleanEmail,
        password: _regPasswordCtrl.text,
      );
      if (res['verified'] == true && res['user'] is Map) {
        final user = Map<String, dynamic>.from(res['user'] as Map);
        if (res['needs_profile_completion'] == true) {
          user['needs_profile_completion'] = true;
        }
        if (mounted) {
          _showMessage('تم تأكيد بريدك الإلكتروني بنجاح! أكمل بياناتك الشخصية الآن.');
          widget.onVerified(user);
        }
      } else {
        _showMessage(
          res['message']?.toString() ??
              'لم يتم تأكيد البريد بعد. افتح بريدك واضغط على رابط التأكيد ثم اضغط متابعة.',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendPasswordResetLink() async {
    final cleanEmail = OtlobhaCustomerApi.normalizeEmail(_forgotEmailCtrl.text);
    if (cleanEmail == null) {
      _showMessage('أدخل بريدك الإلكتروني المسجل بشكل صحيح أولًا');
      return;
    }

    setState(() => _loading = true);
    try {
      final res = await widget.api.sendPasswordResetLink(cleanEmail);
      if (mounted) {
        setState(() {
          _forgotNormalizedEmail = res['email']?.toString() ?? cleanEmail;
          _mode = _AuthScreenMode.forgotLinkSent;
        });
        _startForgotTimer();
        _showMessage(
          res['message']?.toString() ?? 'تم إرسال رابط تغيير كلمة المرور إلى $_forgotNormalizedEmail',
        );
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  InputDecoration _inputDecoration({
    required String label,
    required IconData icon,
    String? hint,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(icon, size: 20, color: const Color(0xFF64748B)),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: const Color(0xFFF8FAFC),
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

  Widget _buildGoogleButton() {
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        side: const BorderSide(color: Color(0xFFCBD5E1), width: 1.2),
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      onPressed: (_loading || _googleLoading) ? null : _signInWithGoogle,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (_googleLoading)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFA92224)),
            )
          else
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'G',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFFEA4335),
                ),
              ),
            ),
          const SizedBox(width: 10),
          Text(
            _googleLoading ? 'جاري الاتصال بجوجل...' : 'المتابعة باستخدام حساب جوجل',
            style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isPrimaryTabs = _mode == _AuthScreenMode.login || _mode == _AuthScreenMode.register;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Brand Hero Header
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.centerRight,
                          end: Alignment.centerLeft,
                          colors: [Color(0xFF9E1C1E), Color(0xFFB52325), Color(0xFFC8431D)],
                        ),
                        borderRadius: BorderRadius.circular(20),
                        border: const Border(
                          bottom: BorderSide(color: Color(0xFFF5A623), width: 3),
                        ),
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              color: Colors.white,
                              padding: const EdgeInsets.all(4),
                              child: Image.asset(
                                'assets/images/otlobha_logo.jpg',
                                width: 56,
                                height: 56,
                                fit: BoxFit.contain,
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _mode == _AuthScreenMode.register || _mode == _AuthScreenMode.verifyLinkSent
                                      ? 'إنشاء حساب جديد'
                                      : _mode == _AuthScreenMode.forgot || _mode == _AuthScreenMode.forgotLinkSent
                                          ? 'استعادة كلمة المرور'
                                          : 'أهلاً بك في اطلبها',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 19,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                const Text(
                                  'توصيل الطلبات والصيدليات والمشاوير في المنزلة',
                                  style: TextStyle(color: Color(0xFFFDE68A), fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Main Auth Card
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (isPrimaryTabs) ...[
                            _buildGoogleButton(),
                            const SizedBox(height: 14),
                            Row(
                              children: [
                                Expanded(child: Divider(color: Colors.grey.shade300)),
                                const Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 10),
                                  child: Text(
                                    'أو بالبريد الإلكتروني',
                                    style: TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                                  ),
                                ),
                                Expanded(child: Divider(color: Colors.grey.shade300)),
                              ],
                            ),
                            const SizedBox(height: 14),
                            Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: GestureDetector(
                                      onTap: () => setState(() => _mode = _AuthScreenMode.login),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(vertical: 11),
                                        decoration: BoxDecoration(
                                          color: _mode == _AuthScreenMode.login ? Colors.white : Colors.transparent,
                                          borderRadius: BorderRadius.circular(10),
                                        ),
                                        child: Text(
                                          'تسجيل الدخول',
                                          textAlign: TextAlign.center,
                                          style: TextStyle(
                                            fontSize: 13.5,
                                            fontWeight: FontWeight.bold,
                                            color: _mode == _AuthScreenMode.login
                                                ? const Color(0xFFA92224)
                                                : const Color(0xFF475569),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  Expanded(
                                    child: GestureDetector(
                                      onTap: () => setState(() => _mode = _AuthScreenMode.register),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(vertical: 11),
                                        decoration: BoxDecoration(
                                          color: _mode == _AuthScreenMode.register ? Colors.white : Colors.transparent,
                                          borderRadius: BorderRadius.circular(10),
                                        ),
                                        child: Text(
                                          'إنشاء حساب جديد',
                                          textAlign: TextAlign.center,
                                          style: TextStyle(
                                            fontSize: 13.5,
                                            fontWeight: FontWeight.bold,
                                            color: _mode == _AuthScreenMode.register
                                                ? const Color(0xFFA92224)
                                                : const Color(0xFF475569),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 18),
                          ],

                          // 1. LOGIN VIEW
                          if (_mode == _AuthScreenMode.login) ...[
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _loginIdentifierCtrl,
                                keyboardType: TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                                decoration: _inputDecoration(
                                  label: 'البريد الإلكتروني أو رقم الهاتف',
                                  hint: 'name@gmail.com / 01xxxxxxxxx',
                                  icon: Icons.mail_outline,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _loginPasswordCtrl,
                                obscureText: _obscureLoginPass,
                                onSubmitted: (_) => _submitLogin(),
                                decoration: _inputDecoration(
                                  label: 'كلمة المرور',
                                  hint: '••••••••',
                                  icon: Icons.lock_outline,
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      _obscureLoginPass ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                    ),
                                    onPressed: () => setState(() => _obscureLoginPass = !_obscureLoginPass),
                                  ),
                                ),
                              ),
                            ),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton(
                                onPressed: () {
                                  final raw = _loginIdentifierCtrl.text.trim();
                                  if (raw.contains('@') && _forgotEmailCtrl.text.isEmpty) {
                                    _forgotEmailCtrl.text = raw;
                                  }
                                  setState(() => _mode = _AuthScreenMode.forgot);
                                },
                                child: const Text(
                                  'هل نسيت كلمة المرور؟',
                                  style: TextStyle(
                                    color: Color(0xFFA92224),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12.5,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 6),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                elevation: 0,
                              ),
                              onPressed: _loading ? null : _submitLogin,
                              icon: const Icon(Icons.login, size: 19),
                              label: Text(
                                _loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],

                          // 2. MANUAL EMAIL REGISTRATION (LINK-BASED — NO OTP CODE)
                          if (_mode == _AuthScreenMode.register) ...[
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF8FAFC),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: const Text(
                                'سنرسل لك رابط تأكيد مباشر على بريدك الإلكتروني (بدون كود). اضغط على الرابط لتفعيل حسابك فورًا.',
                                style: TextStyle(fontSize: 12, color: Color(0xFF475569), height: 1.5),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _regNameCtrl,
                              textInputAction: TextInputAction.next,
                              decoration: _inputDecoration(
                                label: 'الاسم الكامل',
                                hint: 'اكتب اسمك الكامل',
                                icon: Icons.person_outline,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _regEmailCtrl,
                                keyboardType: TextInputType.emailAddress,
                                autocorrect: false,
                                enableSuggestions: false,
                                textInputAction: TextInputAction.next,
                                decoration: _inputDecoration(
                                  label: 'البريد الإلكتروني (Gmail)',
                                  hint: 'name@gmail.com',
                                  icon: Icons.mail_outline,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _regPasswordCtrl,
                                obscureText: _obscureRegPass,
                                textInputAction: TextInputAction.next,
                                decoration: _inputDecoration(
                                  label: 'كلمة المرور (6 أحرف على الأقل)',
                                  hint: '••••••••',
                                  icon: Icons.lock_outline,
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      _obscureRegPass ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                    ),
                                    onPressed: () => setState(() => _obscureRegPass = !_obscureRegPass),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _regConfirmPassCtrl,
                                obscureText: _obscureRegConfirmPass,
                                onSubmitted: (_) => _sendVerificationLink(),
                                decoration: _inputDecoration(
                                  label: 'تأكيد كلمة المرور',
                                  hint: '••••••••',
                                  icon: Icons.key_outlined,
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      _obscureRegConfirmPass ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                    ),
                                    onPressed: () => setState(() => _obscureRegConfirmPass = !_obscureRegConfirmPass),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                elevation: 0,
                              ),
                              onPressed: _loading ? null : _sendVerificationLink,
                              icon: const Icon(Icons.mark_email_read_outlined, size: 19),
                              label: Text(
                                _loading ? 'جاري إرسال رابط التأكيد...' : 'إرسال رابط تأكيد الحساب',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],

                          // 2B. VERIFICATION LINK SENT WAITING SCREEN
                          if (_mode == _AuthScreenMode.verifyLinkSent) ...[
                            Center(
                              child: Container(
                                width: 64,
                                height: 64,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF0FDFA),
                                  borderRadius: BorderRadius.circular(18),
                                  border: Border.all(color: const Color(0xFF99F6E4)),
                                ),
                                child: const Icon(Icons.mark_email_unread_outlined, color: Color(0xFF0F766E), size: 34),
                              ),
                            ),
                            const SizedBox(height: 14),
                            const Text(
                              'افتح بريدك لتأكيد حسابك',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'أرسلنا رابط تأكيد مباشر إلى البريد التالي. اضغط على الزر داخل الرسالة ثم عد هنا واضغط متابعة:',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 12.5, color: Color(0xFF475569), height: 1.5),
                            ),
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                _regNormalizedEmail,
                                textAlign: TextAlign.center,
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                            ),
                            const SizedBox(height: 18),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0F766E),
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                elevation: 0,
                              ),
                              onPressed: _loading ? null : _checkVerificationAndContinue,
                              icon: const Icon(Icons.check_circle_outline, size: 20),
                              label: Text(
                                _loading ? 'جاري التحقق...' : 'تم التأكيد في البريد — متابعة',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                TextButton.icon(
                                  onPressed: (_loading || _regResendSec > 0) ? null : _sendVerificationLink,
                                  icon: const Icon(Icons.refresh, size: 16),
                                  label: Text(
                                    _regResendSec > 0 ? 'إعادة الإرسال بعد $_regResendSec ث' : 'إعادة إرسال الرابط',
                                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
                                  ),
                                ),
                                TextButton(
                                  onPressed: _loading ? null : () => setState(() => _mode = _AuthScreenMode.register),
                                  child: const Text('تعديل البريد', style: TextStyle(fontSize: 12.5)),
                                ),
                              ],
                            ),
                          ],

                          // 3. FORGOT PASSWORD (LINK-BASED — NO OTP CODE)
                          if (_mode == _AuthScreenMode.forgot) ...[
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  'تغيير كلمة المرور عبر البريد',
                                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                ),
                                TextButton.icon(
                                  onPressed: () => setState(() => _mode = _AuthScreenMode.login),
                                  icon: const Icon(Icons.arrow_forward, size: 16),
                                  label: const Text('رجوع'),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'أدخل بريدك الإلكتروني المسجل وسنرسل لك رابطًا مباشرًا على Gmail، عند الضغط عليه يمكنك إدخال كلمة المرور الجديدة فورًا.',
                              style: TextStyle(fontSize: 12.5, color: Color(0xFF475569), height: 1.5),
                            ),
                            const SizedBox(height: 14),
                            Directionality(
                              textDirection: TextDirection.ltr,
                              child: TextField(
                                controller: _forgotEmailCtrl,
                                keyboardType: TextInputType.emailAddress,
                                autocorrect: false,
                                enableSuggestions: false,
                                onSubmitted: (_) => _sendPasswordResetLink(),
                                decoration: _inputDecoration(
                                  label: 'البريد الإلكتروني المسجل',
                                  hint: 'name@gmail.com',
                                  icon: Icons.mail_outline,
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                elevation: 0,
                              ),
                              onPressed: _loading ? null : _sendPasswordResetLink,
                              icon: const Icon(Icons.send_outlined, size: 18),
                              label: Text(
                                _loading ? 'جاري إرسال الرابط...' : 'إرسال رابط تغيير كلمة المرور',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],

                          // 3B. FORGOT LINK SENT SCREEN
                          if (_mode == _AuthScreenMode.forgotLinkSent) ...[
                            Center(
                              child: Container(
                                width: 64,
                                height: 64,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFEF2F2),
                                  borderRadius: BorderRadius.circular(18),
                                  border: Border.all(color: const Color(0xFFFECACA)),
                                ),
                                child: const Icon(Icons.lock_reset_outlined, color: Color(0xFFA92224), size: 34),
                              ),
                            ),
                            const SizedBox(height: 14),
                            const Text(
                              'تم إرسال رابط تغيير كلمة المرور',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'افتح رسالة اطلبها في بريدك الإلكتروني واضغط على رابط «تغيير كلمة المرور الآن» لإدخال كلمة مرورك الجديدة، ثم عد لتسجيل الدخول.',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 12.5, color: Color(0xFF475569), height: 1.5),
                            ),
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                _forgotNormalizedEmail,
                                textAlign: TextAlign.center,
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                            ),
                            const SizedBox(height: 18),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(50),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                elevation: 0,
                              ),
                              onPressed: () {
                                _loginIdentifierCtrl.text = _forgotNormalizedEmail;
                                setState(() => _mode = _AuthScreenMode.login);
                              },
                              icon: const Icon(Icons.login, size: 19),
                              label: const Text(
                                'العودة لتسجيل الدخول',
                                style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                TextButton.icon(
                                  onPressed: (_loading || _forgotResendSec > 0) ? null : _sendPasswordResetLink,
                                  icon: const Icon(Icons.refresh, size: 16),
                                  label: Text(
                                    _forgotResendSec > 0 ? 'إعادة الإرسال بعد $_forgotResendSec ث' : 'إعادة إرسال الرابط',
                                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold),
                                  ),
                                ),
                                TextButton(
                                  onPressed: () => setState(() => _mode = _AuthScreenMode.forgot),
                                  child: const Text('تغيير البريد', style: TextStyle(fontSize: 12.5)),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),

                    if (widget.onContinueAsGuest != null) ...[
                      const SizedBox(height: 14),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0F172A),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(48),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          elevation: 0,
                        ),
                        onPressed: (_loading || _googleLoading) ? null : widget.onContinueAsGuest,
                        icon: const Icon(Icons.explore_outlined, color: Color(0xFFF5A623), size: 19),
                        label: Text(
                          widget.openedFromGuest ? 'العودة للتصفح كزائر' : 'الدخول كزائر',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
