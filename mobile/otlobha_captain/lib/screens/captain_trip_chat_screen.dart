import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';

class CaptainTripChatScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final String tripId;
  final String captainId;
  final String captainName;

  const CaptainTripChatScreen({
    super.key,
    required this.api,
    required this.tripId,
    required this.captainId,
    required this.captainName,
  });

  @override
  State<CaptainTripChatScreen> createState() => _CaptainTripChatScreenState();
}

class _CaptainTripChatScreenState extends State<CaptainTripChatScreen> {
  final TextEditingController _msgCtrl = TextEditingController();
  final TextEditingController _fareCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();

  Map<String, dynamic>? _trip;
  List<Map<String, dynamic>> _messages = [];
  LatLng? _captainCoords;
  bool _loading = true;
  bool _sending = false;
  bool _updatingStatus = false;
  bool _tripClosed = false;
  bool _wsConnected = false;
  bool _showMap = true;
  bool _disposed = false;

  WebSocketChannel? _channel;
  StreamSubscription? _wsSub;
  Timer? _reconnectTimer;

  @override
  void initState() {
    super.initState();
    _loadData();
    _connectWs();
  }

  @override
  void dispose() {
    _disposed = true;
    _tripClosed = true;
    _reconnectTimer?.cancel();
    _wsSub?.cancel();
    _channel?.sink.close();
    _msgCtrl.dispose();
    _fareCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    if (_tripClosed) return;
    try {
      final results = await Future.wait([
        widget.api.getRideChat(widget.tripId),
        widget.api.getRideTracking(widget.tripId),
      ]);
      if (!mounted || _tripClosed) return;
      final chatData = results[0];
      final trackData = results[1];
      final tripMap = Map<String, dynamic>.from(chatData['trip'] as Map);
      final list = ((chatData['messages'] as List?) ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final capGps = trackData['captain_gps'] as Map?;
      setState(() {
        _trip = tripMap;
        if (_fareCtrl.text.trim().isEmpty) {
          final currentFare = tripMap['final_fare'] ?? tripMap['estimated_fare'] ?? '';
          _fareCtrl.text = '$currentFare';
        }
        _messages = list;
        if (capGps != null && capGps['lat'] != null && capGps['lng'] != null) {
          _captainCoords = LatLng(
            (capGps['lat'] as num).toDouble(),
            (capGps['lng'] as num).toDouble(),
          );
        }
        _loading = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (mounted && !_tripClosed) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _connectWs() {
    if (_disposed || _tripClosed || !widget.api.hasTokens) return;
    try {
      _channel = IOWebSocketChannel.connect(widget.api.tripChatWsUri(widget.tripId), headers: widget.api.wsHeaders);
      if (mounted) setState(() => _wsConnected = true);

      _wsSub = _channel!.stream.listen(
        (raw) {
          try {
            final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
            final type = payload['type']?.toString();
            if ((type == 'trip_chat:message' || type == 'trip:chat:message') &&
                payload['trip_id'] == widget.tripId &&
                payload['message'] is Map) {
              final incoming = Map<String, dynamic>.from(payload['message'] as Map);
              if (!mounted) return;
              setState(() {
                if (!_messages.any((m) => m['id'] == incoming['id'])) {
                  _messages.add(incoming);
                }
              });
              _scrollToBottom();
            } else if (type == 'trip:fare_updated' && payload['trip_id'] == widget.tripId) {
              if (!mounted) return;
              setState(() {
                if (payload['trip'] is Map) {
                  _trip = Map<String, dynamic>.from(payload['trip'] as Map);
                }
                if (payload['final_fare'] != null) {
                  _fareCtrl.text = '${payload['final_fare']}';
                }
                if (payload['message'] is Map) {
                  final incoming = Map<String, dynamic>.from(payload['message'] as Map);
                  if (!_messages.any((m) => m['id'] == incoming['id'])) {
                    _messages.add(incoming);
                  }
                }
              });
              _scrollToBottom();
            } else if ((type == 'trip:status' || type == 'trip:accepted') &&
                payload['trip_id'] == widget.tripId &&
                payload['trip'] is Map) {
              if (!mounted) return;
              setState(() => _trip = Map<String, dynamic>.from(payload['trip'] as Map));
            } else if (type == 'trip:completed' && payload['trip_id'] == widget.tripId) {
              if (_tripClosed) return;
              _tripClosed = true;
              _reconnectTimer?.cancel();
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('تم إنهاء المشوار وحذفه من النظام (حصة التطبيق 10%: ${payload['fee_10pct'] ?? '--'} ج.م)'),
                ),
              );
              Navigator.of(context).pop();
            } else if (type == 'trip:cancelled' && payload['trip_id'] == widget.tripId) {
              if (_tripClosed) return;
              _tripClosed = true;
              _reconnectTimer?.cancel();
              if (!mounted) return;
              final pen = (payload['penalty_10pct'] as num?)?.toDouble() ?? 0;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    pen > 0
                        ? 'تم إلغاء المشوار وخصم 10% ($pen ج.م) على حسابك'
                        : 'تم إلغاء المشوار بواسطة العميل وحذفه من النظام',
                  ),
                ),
              );
              Navigator.of(context).pop();
            } else if (type == 'captain:location' &&
                !_tripClosed &&
                payload['captain_id'] == widget.captainId &&
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
    if (_disposed || _tripClosed) return;
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
    if (text.isEmpty || _sending || _tripClosed) return;
    setState(() => _sending = true);
    try {
      final res = await widget.api.sendRideChatMessage(widget.tripId, {
        'sender_role': 'captain',
        'sender_name': widget.captainName,
        'message_text': text,
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

  Future<void> _advanceStatus(String nextStatus) async {
    if (_updatingStatus || _tripClosed) return;
    if (nextStatus == 'completed') {
      await _finishTrip();
      return;
    }
    setState(() => _updatingStatus = true);
    try {
      final res = await widget.api.updateTripStatus(widget.captainId, widget.tripId, nextStatus);
      if (res['trip'] is Map && mounted) {
        setState(() => _trip = Map<String, dynamic>.from(res['trip'] as Map));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _updatingStatus = false);
    }
  }

  Future<void> _finishTrip() async {
    if (_updatingStatus || _tripClosed) return;
    setState(() => _updatingStatus = true);
    try {
      final res = await widget.api.finishTrip(
        widget.tripId,
        actorRole: 'captain',
        actorName: widget.captainName,
        captainId: widget.captainId,
      );
      _tripClosed = true;
      _reconnectTimer?.cancel();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم إنهاء المشوار (${res['fare']} ج.م) وإضافة 10% (${res['fee_10pct']} ج.م) لحساب التطبيق ✓'),
        ),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _updatingStatus = false);
    }
  }

  Future<void> _cancelTrip() async {
    if (_updatingStatus || _tripClosed) return;
    final currentFare = ((_trip?['final_fare'] ?? _trip?['estimated_fare'] ?? 0) as num).toDouble();
    final penalty = (currentFare * 0.10).toStringAsFixed(2);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تأكيد إلغاء الرحلة (خصم 10%)'),
          content: Text('تنبيه: إلغاء الطيار للرحلة يحذفها من النظام ويُضاف عليك غرامة 10% من السعر المحدد ($penalty ج.م). هل تريد المتابعة؟'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('تأكيد الإلغاء وخصم 10%'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    setState(() => _updatingStatus = true);
    try {
      final res = await widget.api.cancelTrip(
        widget.tripId,
        actorRole: 'captain',
        actorName: widget.captainName,
        captainId: widget.captainId,
      );
      _tripClosed = true;
      _reconnectTimer?.cancel();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تم إلغاء الرحلة وحذفها — تم قيد غرامة 10% (${res['penalty_10pct']} ج.م)')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _updatingStatus = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _trip?['status']?.toString() ?? 'captain_accepted';
    final pickupLat = (_trip?['pickup_lat'] as num?)?.toDouble() ?? 31.1583;
    final pickupLng = (_trip?['pickup_lng'] as num?)?.toDouble() ?? 31.9369;
    final dropoffLat = (_trip?['dropoff_lat'] as num?)?.toDouble();
    final dropoffLng = (_trip?['dropoff_lng'] as num?)?.toDouble();
    final pickupPoint = LatLng(pickupLat, pickupLng);
    final dropoffPoint = (dropoffLat != null && dropoffLng != null) ? LatLng(dropoffLat, dropoffLng) : null;
    final currentFare = ((_trip?['final_fare'] ?? _trip?['estimated_fare'] ?? 0) as num).toDouble();
    final fee10 = (currentFare * 0.10).toStringAsFixed(2);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('شات مشوار ${_trip?['trip_number'] ?? ''}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
              Text(
                '${_trip?['customer_name'] ?? 'العميل'} · ${_wsConnected ? 'متصل GPS' : 'جاري الاتصال'}',
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              ),
            ],
          ),
          actions: [
            IconButton(
              onPressed: () => setState(() => _showMap = !_showMap),
              icon: Icon(_showMap ? Icons.map : Icons.map_outlined),
            ),
            IconButton(onPressed: _loadData, icon: const Icon(Icons.refresh)),
          ],
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              color: const Color(0xFFFFF7ED),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'من: ${_trip?['pickup_address'] ?? ''} ← إلى: ${_trip?['dropoff_address'] ?? ''}',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'الأجرة النهائية: $currentFare ج.م (حصة التطبيق 10%: $fee10 ج.م) · الحالة: $status',
                    style: const TextStyle(fontSize: 11, color: Color(0xFFEA580C), fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFFED7AA)),
                    ),
                    child: Text(
                      'الأجرة المعتمدة للرحلة: $currentFare ج.م (يُعدل السعر إداريًا فقط بعد التفاوض)',
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF0F172A), fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      if (status == 'captain_accepted')
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                          onPressed: _updatingStatus ? null : () => _advanceStatus('arrived'),
                          child: const Text('وصلت للعميل', style: TextStyle(fontSize: 11)),
                        ),
                      if (status == 'captain_accepted' || status == 'arrived')
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4F46E5), foregroundColor: Colors.white),
                          onPressed: _updatingStatus ? null : () => _advanceStatus('in_progress'),
                          child: const Text('بدء المشوار', style: TextStyle(fontSize: 11)),
                        ),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                        onPressed: _updatingStatus ? null : _finishTrip,
                        child: const Text('إنهاء المشوار', style: TextStyle(fontSize: 11)),
                      ),
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.red.shade700,
                          side: BorderSide(color: Colors.red.shade300),
                        ),
                        onPressed: _updatingStatus ? null : _cancelTrip,
                        child: const Text('إلغاء الرحلة (خصم 10%)', style: TextStyle(fontSize: 11)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (_showMap)
              SizedBox(
                height: 170,
                child: FlutterMap(
                  options: MapOptions(initialCenter: _captainCoords ?? pickupPoint, initialZoom: 14),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.otlobha.captain',
                    ),
                    if (dropoffPoint != null)
                      PolylineLayer(
                        polylines: [
                          Polyline(points: [pickupPoint, dropoffPoint], color: const Color(0xFFEA580C), strokeWidth: 3.5),
                        ],
                      ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: pickupPoint,
                          width: 90,
                          height: 36,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0D9488),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                            child: const Center(
                              child: Text('موقع العميل', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                            ),
                          ),
                        ),
                        if (dropoffPoint != null)
                          Marker(
                            point: dropoffPoint,
                            width: 80,
                            height: 36,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEA580C),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Center(
                                child: Text('الوجهة', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                            ),
                          ),
                        if (_captainCoords != null)
                          Marker(
                            point: _captainCoords!,
                            width: 90,
                            height: 36,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                              decoration: BoxDecoration(
                                color: const Color(0xFF4F46E5),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Center(
                                child: Text('🛵 موقعي', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
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
                        final role = m['sender_role']?.toString() ?? 'captain';
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
                              child: Text(m['message_text']?.toString() ?? '',
                                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Colors.black54)),
                            ),
                          );
                        }
                        final isMine = role == 'captain';
                        return Align(
                          alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.all(11),
                            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                            decoration: BoxDecoration(
                              color: isMine ? Colors.white : const Color(0xFFFFF7ED),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: isMine ? Colors.grey.shade300 : const Color(0xFFFED7AA)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${role == 'customer' ? 'العميل' : role == 'admin' ? 'الإدارة' : 'أنت'} · ${m['sender_name'] ?? ''}',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 4),
                                Text(m['message_text']?.toString() ?? '', style: const TextStyle(fontSize: 13)),
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
                    Expanded(
                      child: TextField(
                        controller: _msgCtrl,
                        decoration: const InputDecoration(
                          hintText: 'تحدث مع العميل هنا...',
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
