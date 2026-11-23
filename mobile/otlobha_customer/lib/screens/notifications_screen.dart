import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';

class NotificationsScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String? customerEmail;
  final VoidCallback? onOpenVerifyEmail;
  final void Function(Map<String, dynamic> notif)? onNotificationTap;
  final VoidCallback? onNotificationsRead;

  const NotificationsScreen({
    super.key,
    required this.api,
    this.customerEmail,
    this.onOpenVerifyEmail,
    this.onNotificationTap,
    this.onNotificationsRead,
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
      final unreadIds = <String>[];
      final normalized = rows.map((raw) {
        final map = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
        final isRead = map['is_read'] == true || map['is_read'] == 1;
        final id = (map['id'] ?? '').toString().trim();
        if (!isRead && id.isNotEmpty) {
          unreadIds.add(id);
        }
        return map;
      }).toList();

      if (mounted) {
        setState(() {
          // Immediately mark all loaded notifications as read in the UI upon entering the screen
          _items = normalized.map((m) => <String, dynamic>{...m, 'is_read': true}).toList();
        });
      }

      if (unreadIds.isNotEmpty) {
        widget.onNotificationsRead?.call();
        try {
          await widget.api.markAllNotificationsRead(ids: unreadIds);
        } catch (_) {
          for (final id in unreadIds) {
            try {
              await widget.api.markNotificationRead(id);
            } catch (_) {}
          }
        }
      }
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

  String? _destinationLabel(String deepLink) {
    final low = deepLink.trim().toLowerCase();
    if (low.isEmpty || low == 'notifications') return null;
    if (low == 'verify_email') return 'توثيق البريد';
    if (low == 'home') return 'الرئيسية';
    if (low == 'categories' || low.startsWith('category:')) return 'فتح القسم';
    if (low.startsWith('merchant:') || low == 'stores') return 'فتح المتجر';
    if (low.startsWith('product:')) return 'عرض المنتج';
    if (low == 'offers' || low == 'promo') return 'العروض';
    if (low == 'pharmacy') return 'الصيدلية';
    if (low == 'rides' || low == 'parcels') return 'المشاوير والطرود';
    if (low == 'market') return 'سوق اطلبها';
    if (low == 'cart' || low == 'free_order') return 'السلة';
    if (low == 'orders' || low == 'profile' || low == 'wallet') return 'طلباتي وحسابي';
    if (low == 'support') return 'الدعم الفني';
    if (low.startsWith('url:')) return 'فتح الرابط';
    return 'الانتقال';
  }

  void _handleItemTap(Map<String, dynamic> notif) {
    final dl = (notif['deep_link'] ?? '').toString().trim();
    final low = dl.toLowerCase();
    if (low == 'verify_email') {
      _openVerifyEmail();
      return;
    }
    if (low.isEmpty || low == 'notifications') return;
    if (widget.onNotificationTap != null) {
      Navigator.pop(context);
      widget.onNotificationTap!(notif);
      return;
    }
    if (low.startsWith('url:')) {
      final targetUrl = dl.substring(4).trim();
      final uri = Uri.tryParse(targetUrl);
      if (uri != null) {
        launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('إشعارات اطلبها'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: _load,
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _items.isEmpty
                ? const Center(child: Text('لا توجد إشعارات حاليًا'))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final raw = _items[i];
                        final n = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
                        final deepLink = (n['deep_link'] ?? '').toString().trim();
                        final isVerifyEmail = deepLink.toLowerCase() == 'verify_email';
                        final destLabel = _destinationLabel(deepLink);
                        final isTappable = destLabel != null;
                        return Card(
                          color: Colors.white,
                          elevation: 0.5,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: BorderSide(color: Colors.grey.shade200),
                          ),
                          child: ListTile(
                            onTap: isTappable ? () => _handleItemTap(n) : null,
                            leading: CircleAvatar(
                              backgroundColor: isVerifyEmail
                                  ? const Color(0xFFFEF2F2)
                                  : const Color(0xFFFFF7ED),
                              child: Icon(
                                isVerifyEmail
                                    ? Icons.mark_email_unread_outlined
                                    : Icons.notifications_active_outlined,
                                color: const Color(0xFFA92224),
                                size: 20,
                              ),
                            ),
                            title: Text(
                              (n['title_ar'] ?? '').toString(),
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const SizedBox(height: 4),
                                Text(
                                  (n['body_ar'] ?? '').toString(),
                                  style: const TextStyle(fontSize: 12),
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    const Icon(Icons.done_all, color: Color(0xFF0D9488), size: 14),
                                    const SizedBox(width: 4),
                                    Expanded(
                                      child: Text(
                                        (n['created_at'] ?? '').toString(),
                                        style: TextStyle(fontSize: 10, color: Colors.grey.shade600),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            trailing: isTappable
                                ? Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: isVerifyEmail
                                          ? const Color(0xFFA92224)
                                          : const Color(0xFFFFF7ED),
                                      borderRadius: BorderRadius.circular(8),
                                      border: isVerifyEmail
                                          ? null
                                          : Border.all(color: const Color(0xFFFED7AA)),
                                    ),
                                    child: Text(
                                      destLabel,
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: isVerifyEmail
                                            ? Colors.white
                                            : const Color(0xFFC2410C),
                                      ),
                                    ),
                                  )
                                : const Icon(Icons.done_all, color: Color(0xFF0D9488), size: 18),
                          ),
                        );
                      },
                    ),
                  ),
      ),
    );
  }
}
