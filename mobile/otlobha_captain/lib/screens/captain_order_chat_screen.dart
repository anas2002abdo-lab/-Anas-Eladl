import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';

class CaptainOrderChatScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final String orderId;
  final String captainId;
  final String captainName;

  const CaptainOrderChatScreen({
    super.key,
    required this.api,
    required this.orderId,
    required this.captainId,
    required this.captainName,
  });

  @override
  State<CaptainOrderChatScreen> createState() => _CaptainOrderChatScreenState();
}

class _CaptainOrderChatScreenState extends State<CaptainOrderChatScreen> {
  final TextEditingController _msgCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();
  final ImagePicker _picker = ImagePicker();

  Map<String, dynamic>? _order;
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  bool _uploadingProof = false;
  bool _confirmingDelivery = false;
  bool _wsConnected = false;
  bool _disposed = false;
  WebSocketChannel? _channel;
  StreamSubscription? _wsSub;
  Timer? _reconnectTimer;

  @override
  void initState() {
    super.initState();
    _loadChat();
    _connectWs();
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _wsSub?.cancel();
    _channel?.sink.close();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadChat() async {
    try {
      final data = await widget.api.getOrderChat(widget.orderId);
      if (!mounted) return;
      final list = ((data['messages'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      setState(() {
        _order = Map<String, dynamic>.from(data['order'] as Map);
        _messages = list;
        _loading = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _connectWs() {
    if (_disposed || !widget.api.hasTokens) return;
    try {
      _channel = IOWebSocketChannel.connect(widget.api.orderChatWsUri(widget.orderId), headers: widget.api.wsHeaders);
      if (mounted) setState(() => _wsConnected = true);

      _wsSub = _channel!.stream.listen(
        (raw) {
          try {
            final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
            if (payload['order_id'] != null && payload['order_id'] != widget.orderId) return;

            if (payload['type'] == 'chat:message' && payload['message'] is Map) {
              final incoming = Map<String, dynamic>.from(payload['message'] as Map);
              if (!mounted) return;
              setState(() {
                final exists = _messages.any((m) => m['id'] == incoming['id']);
                if (!exists) _messages.add(incoming);
                if (payload['delivery_proof_image_url'] != null && _order != null) {
                  _order!['delivery_proof_image_url'] = payload['delivery_proof_image_url'];
                }
              });
              _scrollToBottom();
            } else if (payload['type'] == 'order:status' && payload['status'] != null) {
              if (mounted && _order != null) {
                setState(() => _order!['status'] = payload['status']);
              }
            }
          } catch (_) {}
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    if (mounted) setState(() => _wsConnected = false);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), _connectWs);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendText() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final res = await widget.api.sendOrderChatMessage(widget.orderId, {
        'sender_role': 'captain',
        'sender_name': widget.captainName,
        'message_text': text,
        'is_delivery_proof': false,
      });
      _msgCtrl.clear();
      if (res['message'] is Map && mounted) {
        final msg = Map<String, dynamic>.from(res['message'] as Map);
        setState(() {
          if (!_messages.any((m) => m['id'] == msg['id'])) {
            _messages.add(msg);
          }
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _captureAndSendPhoto({required bool isDeliveryProof, required ImageSource source}) async {
    try {
      final picked = await _picker.pickImage(source: source, maxWidth: 1000, imageQuality: 78);
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final b64 = 'data:image/jpeg;base64,${base64Encode(bytes)}';

      setState(() {
        if (isDeliveryProof) {
          _uploadingProof = true;
        } else {
          _sending = true;
        }
      });

      final res = await widget.api.sendOrderChatMessage(widget.orderId, {
        'sender_role': 'captain',
        'sender_name': widget.captainName,
        'message_text': isDeliveryProof
            ? 'تم تصوير الأوردر عند منزل العميل وإرسال صورة إثبات التسليم'
            : 'صورة مرفقة من الطيار',
        'image_url': b64,
        'is_delivery_proof': isDeliveryProof,
      });

      if (mounted) {
        setState(() {
          if (res['message'] is Map) {
            final msg = Map<String, dynamic>.from(res['message'] as Map);
            if (!_messages.any((m) => m['id'] == msg['id'])) {
              _messages.add(msg);
            }
          }
          if (res['delivery_proof_image_url'] != null && _order != null) {
            _order!['delivery_proof_image_url'] = res['delivery_proof_image_url'];
          }
        });
        _scrollToBottom();
        if (isDeliveryProof) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم إرسال صورة الأوردر عند منزل العميل بنجاح — يمكنك الآن تأكيد التسليم')),
          );
        }
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) {
        setState(() {
          _uploadingProof = false;
          _sending = false;
        });
      }
    }
  }

  Future<void> _confirmDelivery() async {
    setState(() => _confirmingDelivery = true);
    try {
      await widget.api.updateOrderStatus(widget.captainId, widget.orderId, 'delivered');
      if (mounted) {
        setState(() {
          if (_order != null) _order!['status'] = 'delivered';
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم تأكيد التسليم بنجاح بعد تصوير الأوردر عند منزل العميل')),
        );
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _confirmingDelivery = false);
    }
  }

  Widget _buildChatImage(String url) {
    if (url.startsWith('data:image')) {
      final commaIdx = url.indexOf(',');
      if (commaIdx != -1) {
        final bytes = base64Decode(url.substring(commaIdx + 1));
        return ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.memory(bytes, height: 180, fit: BoxFit.cover),
        );
      }
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.network(url, height: 180, fit: BoxFit.cover),
    );
  }

  @override
  Widget build(BuildContext context) {
    final proofUrl = _order?['delivery_proof_image_url']?.toString();
    final hasProof = (proofUrl != null && proofUrl.isNotEmpty) ||
        _messages.any((m) => m['is_delivery_proof'] == true && (m['image_url']?.toString().isNotEmpty ?? false));
    final isDelivered = _order?['status'] == 'delivered';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'شات الطلب ${_order?['order_number'] ?? ''}',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
              ),
              Text(
                'العميل: ${_order?['customer_name'] ?? ''} · ${_wsConnected ? 'متصل لحظيًا' : 'جاري الاتصال'}',
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              ),
            ],
          ),
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              color: hasProof ? const Color(0xFFCCFBF1) : const Color(0xFFFEF3C7),
              child: Row(
                children: [
                  Icon(
                    hasProof ? Icons.check_circle : Icons.camera_alt_outlined,
                    size: 18,
                    color: hasProof ? const Color(0xFF0F766E) : const Color(0xFFB45309),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      hasProof
                          ? 'تم تصوير الأوردر عند منزل العميل وإرسال الصورة في الشات ✓'
                          : 'شرط إلزامي: التقط صورة للأوردر عند منزل العميل وأرسلها هنا قبل تأكيد التسليم.',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: hasProof ? const Color(0xFF115E59) : const Color(0xFF92400E),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : ListView.builder(
                      controller: _scrollCtrl,
                      padding: const EdgeInsets.all(14),
                      itemCount: _messages.length,
                      itemBuilder: (_, i) {
                        final m = _messages[i];
                        final role = m['sender_role']?.toString() ?? 'customer';
                        if (role == 'system') {
                          return Center(
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 6),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: Colors.grey.shade300),
                              ),
                              child: Text(
                                m['message_text']?.toString() ?? '',
                                textAlign: TextAlign.center,
                                style: const TextStyle(fontSize: 11, color: Colors.black54),
                              ),
                            ),
                          );
                        }

                        final isMine = role == 'captain';
                        final isProof = m['is_delivery_proof'] == true;
                        final imgUrl = m['image_url']?.toString();

                        return Align(
                          alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.all(11),
                            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                            decoration: BoxDecoration(
                              color: isMine
                                  ? const Color(0xFFFFF7ED)
                                  : role == 'admin'
                                      ? const Color(0xFFEEF2FF)
                                      : Colors.white,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: isMine
                                    ? const Color(0xFFFED7AA)
                                    : role == 'admin'
                                        ? const Color(0xFFC7D2FE)
                                        : Colors.grey.shade300,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${role == 'captain' ? 'أنت (الطيار)' : role == 'admin' ? 'الإدارة' : 'العميل'} · ${m['sender_name'] ?? ''}',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                                ),
                                if (isProof) ...[
                                  const SizedBox(height: 4),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF0D9488),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      'صورة إثبات التسليم عند منزل العميل',
                                      style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                                    ),
                                  ),
                                ],
                                if (imgUrl != null && imgUrl.isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  _buildChatImage(imgUrl),
                                ],
                                if ((m['message_text']?.toString() ?? '').isNotEmpty) ...[
                                  const SizedBox(height: 4),
                                  Text(m['message_text'].toString(), style: const TextStyle(fontSize: 13)),
                                ],
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
            if (!isDelivered)
              Container(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                color: Colors.white,
                child: Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFEA580C),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(44),
                        ),
                        onPressed: _uploadingProof
                            ? null
                            : () => _captureAndSendPhoto(isDeliveryProof: true, source: ImageSource.camera),
                        icon: const Icon(Icons.camera_alt),
                        label: Text(
                          _uploadingProof
                              ? 'جاري رفع صورة الأوردر...'
                              : hasProof
                                  ? 'إعادة تصوير الأوردر عند منزل العميل'
                                  : 'تصوير الأوردر عند منزل العميل (شرط التسليم)',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                        ),
                      ),
                    ),
                    if (hasProof) ...[
                      const SizedBox(height: 6),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0D9488),
                            foregroundColor: Colors.white,
                            minimumSize: const Size.fromHeight(44),
                          ),
                          onPressed: _confirmingDelivery ? null : _confirmDelivery,
                          icon: const Icon(Icons.check_circle_outline),
                          label: Text(
                            _confirmingDelivery ? 'جاري تأكيد التسليم...' : 'تأكيد التسليم الآن',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            SafeArea(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Colors.grey.shade300)),
                ),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: _sending ? null : () => _captureAndSendPhoto(isDeliveryProof: false, source: ImageSource.gallery),
                      icon: const Icon(Icons.image_outlined, color: Color(0xFF0F172A)),
                      tooltip: 'إرسال صورة',
                    ),
                    Expanded(
                      child: TextField(
                        controller: _msgCtrl,
                        decoration: const InputDecoration(
                          hintText: 'اكتب رسالة للعميل...',
                          border: OutlineInputBorder(),
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0F172A),
                        foregroundColor: Colors.white,
                        minimumSize: const Size(52, 44),
                      ),
                      onPressed: _sending ? null : _sendText,
                      child: const Icon(Icons.send, size: 18),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
