import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';

class NotificationsScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String? customerEmail;
  final VoidCallback? onOpenVerifyEmail;

  const NotificationsScreen({
    super.key,
    required this.api,
    this.customerEmail,
    this.onOpenVerifyEmail,
  });

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<dynamic> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final rows = await widget.api.getNotifications();
      if (mounted) setState(() => _items = rows);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openVerifyEmail() async {
    if (widget.onOpenVerifyEmail != null) {
      widget.onOpenVerifyEmail!();
      return;
    }
    final uri = widget.api.verifyEmailExternalUri(email: widget.customerEmail, autoSend: true);
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر فتح صفحة توثيق البريد في المتصفح')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر فتح صفحة توثيق البريد في المتصفح')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('إشعارات اطلبها')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _items.isEmpty
                ? const Center(child: Text('لا توجد إشعارات حاليًا'))
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final n = _items[i];
                      final isRead = n['is_read'] == true || n['is_read'] == 1;
                      final isVerifyEmail = (n['deep_link']?.toString().toLowerCase() ?? '') == 'verify_email';
                      return Card(
                        color: isRead ? Colors.white : const Color(0xFFFFF7ED),
                        child: ListTile(
                          onTap: isVerifyEmail
                              ? () async {
                                  await _openVerifyEmail();
                                }
                              : null,
                          leading: isVerifyEmail
                              ? const CircleAvatar(
                                  backgroundColor: Color(0xFFFEF2F2),
                                  child: Icon(Icons.mark_email_unread_outlined, color: Color(0xFFA92224)),
                                )
                              : null,
                          title: Text(n['title_ar'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 4),
                              Text(n['body_ar'] ?? '', style: const TextStyle(fontSize: 12)),
                              const SizedBox(height: 4),
                              Text(n['created_at'] ?? '', style: TextStyle(fontSize: 10, color: Colors.grey.shade600)),
                            ],
                          ),
                          trailing: isVerifyEmail && !isRead
                              ? ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: const Color(0xFFA92224),
                                    foregroundColor: Colors.white,
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                    minimumSize: Size.zero,
                                  ),
                                  onPressed: _openVerifyEmail,
                                  child: const Text('توثيق', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                                )
                              : isRead
                                  ? const Icon(Icons.done_all, color: Color(0xFF0D9488), size: 18)
                                  : TextButton(
                                      onPressed: () async {
                                        await widget.api.markNotificationRead(n['id']);
                                        _load();
                                      },
                                      child: const Text('مقروء'),
                                    ),
                        ),
                      );
                    },
                  ),
      ),
    );
  }
}
