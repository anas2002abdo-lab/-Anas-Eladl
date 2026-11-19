import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import '../core/safe_camera_picker.dart';

class OrderChatScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String orderId;
  final String customerName;

  const OrderChatScreen({
    super.key,
    required this.api,
    required this.orderId,
    required this.customerName,
  });

  @override
  State<OrderChatScreen> createState() => _OrderChatScreenState();
}

class _OrderChatScreenState extends State<OrderChatScreen> {
  final TextEditingController _msgCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();

  Map<String, dynamic>? _order;
  List<Map<String, dynamic>> _messages = [];
  LatLng? _captainCoords;
  LatLng? _customerCoords;
  double? _distanceKm;
  int? _etaMin;
  bool _showMap = false;
  bool _loading = true;
  bool _sending = false;
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
      final results = await Future.wait([
        widget.api.getOrderChat(widget.orderId),
        widget.api.getOrderTracking(widget.orderId),
      ]);
      if (!mounted) return;
      final data = results[0];
      final track = results[1];
      final list = ((data['messages'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final capGps = track['captain_gps'] as Map?;
      final custGps = track['customer_gps'] as Map?;
      setState(() {
        _order = Map<String, dynamic>.from(data['order'] as Map);
        _messages = list;
        if (capGps != null && capGps['lat'] != null && capGps['lng'] != null) {
          _captainCoords = LatLng((capGps['lat'] as num).toDouble(), (capGps['lng'] as num).toDouble());
          _distanceKm = (capGps['distance_km'] as num?)?.toDouble();
          _etaMin = (capGps['eta_min'] as num?)?.toInt();
        }
        if (custGps != null && custGps['lat'] != null && custGps['lng'] != null) {
          _customerCoords = LatLng((custGps['lat'] as num).toDouble(), (custGps['lng'] as num).toDouble());
        }
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
            } else if (payload['type'] == 'captain:location' &&
                _order != null &&
                payload['captain_id'] == _order!['captain_id'] &&
                payload['lat'] != null &&
                payload['lng'] != null) {
              if (mounted) {
                setState(() {
                  _captainCoords = LatLng(
                    (payload['lat'] as num).toDouble(),
                    (payload['lng'] as num).toDouble(),
                  );
                });
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
        'sender_role': 'customer',
        'sender_name': widget.customerName,
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

  Future<void> _sendImage() async {
    try {
      final picked = await SafeCameraPicker.pickImage(
        source: ImageSource.gallery,
        targetKey: 'order_chat_${widget.orderId}',
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 76,
      );
      if (picked == null || !mounted) return;
      final b64 = picked.dataUrl;
      setState(() => _sending = true);
      final res = await widget.api.sendOrderChatMessage(widget.orderId, {
        'sender_role': 'customer',
        'sender_name': widget.customerName,
        'message_text': 'صورة مرفقة من العميل',
        'image_url': b64,
        'is_delivery_proof': false,
      });
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
    final hasProof = proofUrl != null && proofUrl.isNotEmpty;

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
                '${_order?['captain_name'] ?? 'الطيار'} · ${_wsConnected ? 'متصل لحظيًا' : 'جاري الاتصال'}',
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              ),
            ],
          ),
          actions: [
            if (_captainCoords != null)
              IconButton(
                onPressed: () => setState(() => _showMap = !_showMap),
                icon: Icon(_showMap ? Icons.map : Icons.location_on_outlined),
                tooltip: 'تتبع الطيار GPS',
              ),
          ],
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
                          ? 'قام الطيار بتصوير الأوردر عند منزلك وإرسال الصورة في الشات ✓'
                          : 'سيتواصل الطيار معك هنا وسيصوّر الأوردر عند منزلك قبل تأكيد التسليم.'
                            '${_distanceKm != null ? ' (الطيار يبعد ${_distanceKm!.toStringAsFixed(2)} كم · ${_etaMin ?? 3} د)' : ''}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: hasProof ? const Color(0xFF115E59) : const Color(0xFF92400E),
                      ),
                    ),
                  ),
                  if (_captainCoords != null)
                    TextButton(
                      onPressed: () => setState(() => _showMap = !_showMap),
                      child: Text(_showMap ? 'إخفاء الخريطة' : 'تتبع GPS', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                ],
              ),
            ),
            if (_showMap && _captainCoords != null)
              SizedBox(
                height: 185,
                child: FlutterMap(
                  options: MapOptions(initialCenter: _captainCoords!, initialZoom: 14),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.otlobha.customer',
                    ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: _captainCoords!,
                          width: 100,
                          height: 38,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFF4F46E5),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                            child: Center(
                              child: Text('🛵 ${_order?['captain_name'] ?? 'الطيار'}',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                            ),
                          ),
                        ),
                        if (_customerCoords != null)
                          Marker(
                            point: _customerCoords!,
                            width: 85,
                            height: 36,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0D9488),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Center(
                                child: Text('موقعك GPS',
                                    style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                            ),
                          ),
                      ],
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

                        final isMine = role == 'customer';
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
                                  ? Colors.white
                                  : role == 'admin'
                                      ? const Color(0xFFEEF2FF)
                                      : const Color(0xFFFFF7ED),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: isMine
                                    ? Colors.grey.shade300
                                    : role == 'admin'
                                        ? const Color(0xFFC7D2FE)
                                        : const Color(0xFFFED7AA),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${role == 'captain' ? 'الطيار' : role == 'admin' ? 'الإدارة' : 'أنت'} · ${m['sender_name'] ?? ''}',
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
                                      'صورة إثبات التسليم عند المنزل',
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
                      onPressed: _sending ? null : _sendImage,
                      icon: const Icon(Icons.image_outlined, color: Color(0xFF0F172A)),
                      tooltip: 'إرسال صورة',
                    ),
                    Expanded(
                      child: TextField(
                        controller: _msgCtrl,
                        decoration: const InputDecoration(
                          hintText: 'تحدث مع الطيار هنا...',
                          border: OutlineInputBorder(),
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFEA580C),
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
