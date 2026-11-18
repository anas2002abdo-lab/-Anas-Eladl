import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'register_kyc_screen.dart';

class CaptainLoginScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final void Function(String captainId) onLoggedIn;

  const CaptainLoginScreen({super.key, required this.api, required this.onLoggedIn});

  @override
  State<CaptainLoginScreen> createState() => _CaptainLoginScreenState();
}

class _CaptainLoginScreenState extends State<CaptainLoginScreen> {
  final TextEditingController _usernameCtrl = TextEditingController();
  final TextEditingController _passwordCtrl = TextEditingController();
  bool _obscure = true;
  bool _loading = false;

  @override
  void dispose() {
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final username = _usernameCtrl.text.trim();
    final password = _passwordCtrl.text;
    if (username.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل اسم المستخدم وكلمة المرور')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await widget.api.loginCaptain(username, password);
      final cap = res['captain'] as Map<String, dynamic>?;
      final id = cap?['id']?.toString() ?? '';
      if (id.isNotEmpty && mounted) {
        widget.onLoggedIn(id);
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
                  'تطبيق اطلبها كابتن – المنزلة',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                ),
                const SizedBox(height: 4),
                const Text(
                  'سجّل الدخول باسم المستخدم وكلمة المرور الخاصة بك',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Directionality(
                          textDirection: TextDirection.ltr,
                          child: TextField(
                            controller: _usernameCtrl,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              labelText: 'اسم المستخدم (Username)',
                              hintText: 'captain1',
                              prefixIcon: Icon(Icons.person_outline),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Directionality(
                          textDirection: TextDirection.ltr,
                          child: TextField(
                            controller: _passwordCtrl,
                            obscureText: _obscure,
                            onSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              border: const OutlineInputBorder(),
                              labelText: 'كلمة المرور (Password)',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                onPressed: () => setState(() => _obscure = !_obscure),
                              ),
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
                          onPressed: _loading ? null : _submit,
                          icon: const Icon(Icons.login),
                          label: Text(_loading ? 'جاري التحقق...' : 'تسجيل الدخول'),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    foregroundColor: const Color(0xFF0F172A),
                  ),
                  onPressed: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => RegisterKycScreen(
                          api: widget.api,
                          onRegistered: (newId) {
                            Navigator.pop(context);
                            widget.onLoggedIn(newId);
                          },
                        ),
                      ),
                    );
                  },
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('طيار جديد؟ إنشاء حساب ورفع المستندات'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
