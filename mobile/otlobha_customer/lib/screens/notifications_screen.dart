import 'package:flutter/material.dart';
import '../core/api_client.dart';

class NotificationsScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;

  const NotificationsScreen({super.key, required this.api});

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

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('إشعارات اطلبها')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) {
                  final n = _items[i];
                  final isRead = n['is_read'] == true;
                  return Card(
                    color: isRead ? Colors.white : const Color(0xFFFFF7ED),
                    child: ListTile(
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
                      trailing: isRead
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
