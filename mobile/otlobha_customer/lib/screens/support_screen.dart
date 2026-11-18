import 'package:flutter/material.dart';
import '../core/api_client.dart';

class SupportScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String customerName;
  final String customerPhone;
  final String customerEmail;

  const SupportScreen({
    super.key,
    required this.api,
    required this.customerName,
    required this.customerPhone,
    required this.customerEmail,
  });

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  final _subjectCtrl = TextEditingController();
  final _messageCtrl = TextEditingController();
  final _replyCtrl = TextEditingController();
  String _category = 'general';
  bool _loading = true;
  bool _sending = false;
  List<dynamic> _tickets = [];
  String? _selectedTicketId;
  List<dynamic> _messages = [];

  @override
  void initState() {
    super.initState();
    _loadTickets(keepSelection: false);
  }

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _messageCtrl.dispose();
    _replyCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadTickets({bool keepSelection = true}) async {
    setState(() => _loading = true);
    try {
      final list = await widget.api.getSupportTickets(
        customerEmail: widget.customerEmail.isNotEmpty ? widget.customerEmail : null,
      );
      if (!mounted) return;
      String? nextId;
      if (list.isNotEmpty) {
        if (keepSelection && _selectedTicketId != null && list.any((t) => t['id'] == _selectedTicketId)) {
          nextId = _selectedTicketId;
        } else {
          nextId = list.first['id']?.toString();
        }
      }
      setState(() {
        _tickets = list;
        _selectedTicketId = nextId;
        _loading = false;
      });
      if (nextId != null) {
        await _loadMessages(nextId);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _loadMessages(String ticketId) async {
    try {
      final detail = await widget.api.getSupportMessages(ticketId);
      if (!mounted) return;
      setState(() {
        _messages = (detail['messages'] as List?) ?? [];
      });
    } catch (_) {}
  }

  Future<void> _createTicket() async {
    final subj = _subjectCtrl.text.trim();
    final msg = _messageCtrl.text.trim();
    if ((subj.isEmpty && msg.isEmpty) || _sending) return;
    setState(() => _sending = true);
    try {
      final res = await widget.api.createSupportTicket(
        customerName: widget.customerName,
        customerPhone: widget.customerPhone,
        customerEmail: widget.customerEmail.isNotEmpty ? widget.customerEmail : null,
        subject: subj.isNotEmpty ? subj : msg,
        category: _category,
        messageText: msg.isNotEmpty ? msg : subj,
      );
      _subjectCtrl.clear();
      _messageCtrl.clear();
      final createdId = res['ticket']?['id']?.toString();
      if (mounted) {
        setState(() => _selectedTicketId = createdId);
      }
      await _loadTickets(keepSelection: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendReply() async {
    final txt = _replyCtrl.text.trim();
    final id = _selectedTicketId;
    if (id == null || txt.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.api.sendSupportMessage(
        id,
        senderName: widget.customerName,
        messageText: txt,
      );
      _replyCtrl.clear();
      await Future.wait([_loadMessages(id), _loadTickets(keepSelection: true)]);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('تواصل مع الدعم والإدارة'),
          backgroundColor: const Color(0xFFA92224),
          foregroundColor: Colors.white,
          actions: [
            IconButton(
              onPressed: () => _loadTickets(keepSelection: true),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: _loading && _tickets.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(14),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('إرسال رسالة جديدة للإدارة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                          const SizedBox(height: 10),
                          TextField(
                            controller: _subjectCtrl,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              labelText: 'موضوع الرسالة',
                              isDense: true,
                            ),
                          ),
                          const SizedBox(height: 8),
                          DropdownButtonFormField<String>(
                            value: _category,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              labelText: 'القسم',
                              isDense: true,
                            ),
                            items: const [
                              DropdownMenuItem(value: 'general', child: Text('استفسار عام')),
                              DropdownMenuItem(value: 'order_support', child: Text('مشكلة في طلب')),
                              DropdownMenuItem(value: 'ride_support', child: Text('مشكلة في مشوار')),
                              DropdownMenuItem(value: 'suggestion', child: Text('شكوى أو اقتراح')),
                            ],
                            onChanged: (v) {
                              if (v != null) setState(() => _category = v);
                            },
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _messageCtrl,
                            maxLines: 2,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              labelText: 'تفاصيل الرسالة',
                              isDense: true,
                            ),
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFA92224),
                                foregroundColor: Colors.white,
                              ),
                              onPressed: _sending ? null : _createTicket,
                              icon: const Icon(Icons.send, size: 17),
                              label: const Text('إرسال للإدارة'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text('محادثات الدعم السابقة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 8),
                  if (_tickets.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(20),
                      child: Center(child: Text('لا توجد محادثات دعم بعد')),
                    )
                  else ...[
                    SizedBox(
                      height: 84,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _tickets.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final t = _tickets[i] as Map<String, dynamic>;
                          final selected = t['id'] == _selectedTicketId;
                          return InkWell(
                            onTap: () {
                              setState(() => _selectedTicketId = t['id']?.toString());
                              _loadMessages(t['id'].toString());
                            },
                            child: Container(
                              width: 210,
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: selected ? const Color(0xFFFFF7ED) : Colors.white,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: selected ? const Color(0xFFEA580C) : const Color(0xFFE2E8F0),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    '${t['ticket_number']} · ${t['status']}',
                                    style: const TextStyle(fontSize: 10, color: Color(0xFF64748B), fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    (t['subject'] ?? '').toString(),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (_selectedTicketId != null)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            children: [
                              for (final m in _messages)
                                Align(
                                  alignment: m['sender_role'] == 'admin'
                                      ? Alignment.centerRight
                                      : Alignment.centerLeft,
                                  child: Container(
                                    margin: const EdgeInsets.only(bottom: 8),
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: m['sender_role'] == 'admin'
                                          ? const Color(0xFF0F172A)
                                          : const Color(0xFFFFEDD5),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          (m['sender_name'] ?? '').toString(),
                                          style: TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                            color: m['sender_role'] == 'admin' ? Colors.amber.shade200 : Colors.brown,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          (m['message_text'] ?? '').toString(),
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: m['sender_role'] == 'admin' ? Colors.white : Colors.black87,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _replyCtrl,
                                      decoration: const InputDecoration(
                                        border: OutlineInputBorder(),
                                        hintText: 'أضف ردًا...',
                                        isDense: true,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  ElevatedButton(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFFEA580C),
                                      foregroundColor: Colors.white,
                                    ),
                                    onPressed: _sending ? null : _sendReply,
                                    child: const Text('إرسال'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ],
              ),
      ),
    );
  }
}
