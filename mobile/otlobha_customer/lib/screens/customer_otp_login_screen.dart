import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';

enum _AuthScreenMode { login, register }

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

  // Register controllers (instant entry without prior email verification)
  final TextEditingController _regNameCtrl = TextEditingController();
  final TextEditingController _regEmailCtrl = TextEditingController();
  final TextEditingController _regPasswordCtrl = TextEditingController();
  final TextEditingController _regConfirmPassCtrl = TextEditingController();
  bool _obscureRegPass = true;
  bool _obscureRegConfirmPass = true;

  bool _loading = false;
  bool _googleLoading = false;

  @override
  void dispose() {
    _loginIdentifierCtrl.dispose();
    _loginPasswordCtrl.dispose();
    _regNameCtrl.dispose();
    _regEmailCtrl.dispose();
    _regPasswordCtrl.dispose();
    _regConfirmPassCtrl.dispose();
    super.dispose();
  }

  void _showMessage(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  String _cleanError(Object e) => e.toString().replaceFirst('Exception: ', '');

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

      // Fall back to Firebase Auth ID token only if Google OAuth idToken is absent
      if ((tokenToVerify == null || tokenToVerify.isEmpty) &&
          Firebase.apps.isNotEmpty &&
          (googleAuth.idToken != null || googleAuth.accessToken != null)) {
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
    } on ApiException catch (e) {
      if (e.statusCode == 404 && identifier.contains('@')) {
        await _fallbackOtpAuthFlow(email: identifier, password: pass);
      } else {
        _showMessage(_cleanError(e));
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _registerDirect() async {
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
      final res = await widget.api.registerCustomerDirect(
        fullName: name,
        email: cleanEmail,
        password: pass,
      );
      final user = res['user'] is Map
          ? Map<String, dynamic>.from(res['user'] as Map)
          : <String, dynamic>{};
      if (res['needs_profile_completion'] == true) {
        user['needs_profile_completion'] = true;
      }
      await widget.api.persistUserSnapshot(user);
      if (mounted) {
        _showMessage('أهلاً بك في اطلبها! سيصلك إشعار لتوثيق بريدك الإلكتروني.');
        widget.onVerified(user);
      }
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        await _fallbackOtpAuthFlow(email: cleanEmail, fullName: name, password: pass, isRegister: true);
      } else {
        _showMessage(_cleanError(e));
      }
    } catch (e) {
      _showMessage(_cleanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _fallbackOtpAuthFlow({
    required String email,
    String? fullName,
    String? password,
    bool isRegister = false,
  }) async {
    try {
      bool useLegacy = true;
      if (isRegister && fullName != null && password != null) {
        final reqRes = await widget.api.requestCustomerRegisterOtp(
          fullName: fullName,
          email: email,
          password: password,
        );
        useLegacy = reqRes['auth_flow'] == 'legacy_otp';
      } else {
        await widget.api.requestOtp(email, role: 'customer');
      }
      if (!mounted) return;
      _showMessage('تم إرسال رمز تحقق من 6 أرقام إلى بريدك الإلكتروني');
      final codeCtrl = TextEditingController();
      bool submitting = false;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, setDialogState) => Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
              title: Text(isRegister ? 'تأكيد إنشاء الحساب' : 'تأكيد تسجيل الدخول'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('أدخل الرمز المكون من 6 أرقام المرسل إلى $email', style: const TextStyle(fontSize: 13)),
                  const SizedBox(height: 12),
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: TextField(
                      controller: codeCtrl,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(
                        hintText: '000000',
                        counterText: '',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: submitting ? null : () => Navigator.of(ctx).pop(),
                  child: const Text('إلغاء'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA92224), foregroundColor: Colors.white),
                  onPressed: submitting
                      ? null
                      : () async {
                          final code = codeCtrl.text.trim();
                          if (code.length != 6) {
                            _showMessage('أدخل رمز التحقق المكون من 6 أرقام');
                            return;
                          }
                          setDialogState(() => submitting = true);
                          try {
                            final Map<String, dynamic> res = (isRegister && fullName != null && password != null)
                                ? await widget.api.registerCustomer(
                                    fullName: fullName,
                                    email: email,
                                    password: password,
                                    code: code,
                                    useLegacyOtpFlow: useLegacy,
                                  )
                                : await widget.api.verifyOtp(
                                    email,
                                    code,
                                    role: 'customer',
                                    fullName: fullName,
                                    password: password,
                                  );
                            final user = res['user'] is Map
                                ? Map<String, dynamic>.from(res['user'] as Map)
                                : <String, dynamic>{};
                            await widget.api.persistUserSnapshot(user);
                            if (ctx.mounted) Navigator.of(ctx).pop();
                            if (mounted) {
                              _showMessage('تم تسجيل الدخول بنجاح');
                              widget.onVerified(user);
                            }
                          } catch (err) {
                            setDialogState(() => submitting = false);
                            _showMessage(_cleanError(err));
                          }
                        },
                  child: Text(submitting ? 'جاري التحقق...' : 'تأكيد'),
                ),
              ],
            ),
          ),
        ),
      );
      codeCtrl.dispose();
    } catch (err) {
      _showMessage(_cleanError(err));
    }
  }

  Future<void> _openForgotPasswordExternalPage() async {
    final raw = _loginIdentifierCtrl.text.trim();
    final prefillEmail = (raw.contains('@') || raw.contains('＠')) ? raw : null;
    final uri = widget.api.forgotPasswordExternalUri(email: prefillEmail);
    setState(() => _loading = true);
    bool safeExternal = false;
    try {
      safeExternal = await widget.api.isSafeExternalPortalUri(uri);
    } finally {
      if (mounted) setState(() => _loading = false);
    }

    if (safeExternal) {
      try {
        final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (launched) return;
      } catch (_) {}
    }

    // Never open an unverified URL that could show the Admin Dashboard; use safe in-app 2-step reset dialog instead.
    if (!mounted) return;
    await _showInAppForgotPasswordDialog(initialEmail: prefillEmail ?? '');
  }

  Future<void> _showInAppForgotPasswordDialog({String initialEmail = ''}) async {
    final emailCtrl = TextEditingController(text: initialEmail);
    final codeCtrl = TextEditingController();
    final passCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    int step = 1;
    bool busy = false;
    String? errMsg;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: const Text('استعادة كلمة المرور'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (errMsg != null) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFFECACA)),
                      ),
                      child: Text(errMsg!, style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 12.5)),
                    ),
                    const SizedBox(height: 10),
                  ],
                  if (step == 1) ...[
                    const Text('أدخل بريدك الإلكتروني لإرسال رمز الاستعادة المكون من 6 أرقام.', style: TextStyle(fontSize: 13)),
                    const SizedBox(height: 12),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: TextField(
                        controller: emailCtrl,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(labelText: 'البريد الإلكتروني', border: OutlineInputBorder()),
                      ),
                    ),
                  ] else ...[
                    Text('أدخل الرمز المرسل إلى ${emailCtrl.text.trim()} وكلمة المرور الجديدة.', style: const TextStyle(fontSize: 13)),
                    const SizedBox(height: 10),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: TextField(
                        controller: codeCtrl,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        textAlign: TextAlign.center,
                        decoration: const InputDecoration(labelText: 'رمز التحقق (6 أرقام)', counterText: '', border: OutlineInputBorder()),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: TextField(
                        controller: passCtrl,
                        obscureText: true,
                        decoration: const InputDecoration(labelText: 'كلمة المرور الجديدة', border: OutlineInputBorder()),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: TextField(
                        controller: confirmCtrl,
                        obscureText: true,
                        decoration: const InputDecoration(labelText: 'تأكيد كلمة المرور الجديدة', border: OutlineInputBorder()),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: busy ? null : () => Navigator.of(ctx).pop(),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFA92224), foregroundColor: Colors.white),
                onPressed: busy
                    ? null
                    : () async {
                        final cleanEmail = OtlobhaCustomerApi.normalizeEmail(emailCtrl.text);
                        if (cleanEmail == null) {
                          setDialogState(() => errMsg = 'يرجى إدخال بريد إلكتروني صحيح');
                          return;
                        }
                        if (step == 1) {
                          setDialogState(() {
                            busy = true;
                            errMsg = null;
                          });
                          try {
                            await widget.api.requestPasswordReset(cleanEmail);
                            setDialogState(() {
                              busy = false;
                              step = 2;
                            });
                          } catch (e) {
                            setDialogState(() {
                              busy = false;
                              errMsg = _cleanError(e);
                            });
                          }
                        } else {
                          final code = codeCtrl.text.trim();
                          if (code.length != 6) {
                            setDialogState(() => errMsg = 'أدخل رمز التحقق المكون من 6 أرقام');
                            return;
                          }
                          if (passCtrl.text.length < 6) {
                            setDialogState(() => errMsg = 'كلمة المرور يجب أن لا تقل عن 6 أحرف');
                            return;
                          }
                          if (passCtrl.text != confirmCtrl.text) {
                            setDialogState(() => errMsg = 'كلمتا المرور غير متطابقتين');
                            return;
                          }
                          setDialogState(() {
                            busy = true;
                            errMsg = null;
                          });
                          try {
                            await widget.api.resetPassword(email: cleanEmail, code: code, newPassword: passCtrl.text);
                            if (ctx.mounted) Navigator.of(ctx).pop();
                            _showMessage('تم تغيير كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن.');
                          } catch (e) {
                            setDialogState(() {
                              busy = false;
                              errMsg = _cleanError(e);
                            });
                          }
                        }
                      },
                child: Text(busy ? 'جاري التنفيذ...' : (step == 1 ? 'إرسال الرمز' : 'حفظ كلمة المرور')),
              ),
            ],
          ),
        ),
      ),
    );
    emailCtrl.dispose();
    codeCtrl.dispose();
    passCtrl.dispose();
    confirmCtrl.dispose();
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
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      onPressed: (_loading || _googleLoading) ? null : _signInWithGoogle,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
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
          Flexible(
            child: Text(
              _googleLoading ? 'جاري الاتصال بجوجل...' : 'المتابعة باستخدام حساب جوجل',
              textAlign: TextAlign.center,
              softWrap: true,
              style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800),
            ),
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
                                  _mode == _AuthScreenMode.register
                                      ? 'إنشاء حساب جديد'
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
                                ConstrainedBox(
                                  constraints: const BoxConstraints(maxWidth: 240),
                                  child: const Padding(
                                    padding: EdgeInsets.symmetric(horizontal: 10),
                                    child: Text(
                                      'أو بالبريد الإلكتروني',
                                      textAlign: TextAlign.center,
                                      softWrap: true,
                                      style: TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                                    ),
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
                                onPressed: _loading ? null : _openForgotPasswordExternalPage,
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

                          // 2. INSTANT REGISTRATION (NO PRIOR EMAIL VERIFICATION REQUIRED)
                          if (_mode == _AuthScreenMode.register) ...[
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF8FAFC),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: const Text(
                                'ادخل فورًا بدون تأكيد مسبق للبريد الإلكتروني، وسيصلك إشعار داخل التطبيق لتوثيق بريدك برمز تحقق وقتما تشاء.',
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
                                onSubmitted: (_) => _registerDirect(),
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
                              onPressed: _loading ? null : _registerDirect,
                              icon: const Icon(Icons.person_add_alt_1_outlined, size: 19),
                              label: Text(
                                _loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب والدخول فورًا',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.bold),
                              ),
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
