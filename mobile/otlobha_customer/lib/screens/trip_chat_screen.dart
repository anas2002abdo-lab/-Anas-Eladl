import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import '../core/num_utils.dart';

class TripChatScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final String tripId;
  final String customerName;

  const TripChatScreen({
    super.key,
    required this.api,
    required this.tripId,
    required this.customerName,
  });

  @override
  State<TripChatScreen> createState() => _TripChatScreenState();
}

class _TripChatScreenState extends State<TripChatScreen> {
  final TextEditingController _msgCtrl = TextEditingController();
  final TextEditingController _fareCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();

  Map<String, dynamic>? _trip;
  List<Map<String, dynamic>> _messages = [];
  List<dynamic> _nearbyCaptains = [];
  LatLng? _captainCoords;
  double? _distanceToPickupKm;
  int? _etaMin;
  bool _loading = true;
  bool _sending = false;
  bool _updatingFare = false;
  bool _updatingCaptain = false;
  bool _actingTrip = false;
  bool _tripClosed = false;
  bool _wsConnected = false;
  bool _showMap = true;
  bool _disposed = false;

  WebSocketChannel? _channel;
  StreamSubscription? _wsSub;
  Timer? _reconnectTimer;

  static const Map<String, String> _statusLabels = {
    'searching': 'جاري البحث عن طيار',
    'captain_accepted': 'وافق الطيار وهو في طريقه إليك',
    'arrived': 'الطيار وصل عند نقطة الانطلاق',
    'in_progress': 'الرحلة جارية الآن',
    'completed': 'تم إنهاء المشوار',
    'cancelled': 'تم إلغاء المشوار',
  };

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
          _distanceToPickupKm = (capGps['distance_to_pickup_km'] as num?)?.toDouble();
          _etaMin = (capGps['eta_min'] as num?)?.toInt();
        }
        _loading = false;
      });
      if (tripMap['status'] == 'searching' && tripMap['captain_id'] == null) {
        final pLat = (tripMap['pickup_lat'] as num?)?.toDouble() ?? 31.1583;
        final pLng = (tripMap['pickup_lng'] as num?)?.toDouble() ?? 31.9369;
        widget.api.getNearbyCaptains(pLat, pLng, vehicleType: 'all').then((caps) {
          if (mounted && !_tripClosed) {
            setState(() => _nearbyCaptains = caps);
          }
        }).catchError((_) {});
      }
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
            } else if ((type == 'trip:status' || type == 'trip:accepted' || type == 'trip:captain_updated') &&
                payload['trip_id'] == widget.tripId &&
                payload['trip'] is Map) {
              if (!mounted) return;
              setState(() {
                _trip = Map<String, dynamic>.from(payload['trip'] as Map);
              });
            } else if (type == 'trip:completed' && payload['trip_id'] == widget.tripId) {
              if (_tripClosed) return;
              _tripClosed = true;
              _reconnectTimer?.cancel();
              if (!mounted) return;
              final prompt = payload['rating_prompt'] is Map
                  ? Map<String, dynamic>.from(payload['rating_prompt'] as Map)
                  : null;
              if (prompt != null) {
                _showPostTripRatingDialog(prompt);
              } else {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('تم إنهاء المشوار وحذفه من النظام ✓')),
                );
                Navigator.of(context).pop();
              }
            } else if (type == 'trip:cancelled' && payload['trip_id'] == widget.tripId) {
              if (_tripClosed) return;
              _tripClosed = true;
              _reconnectTimer?.cancel();
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('تم إلغاء المشوار وحذفه من النظام')),
              );
              Navigator.of(context).pop();
            } else if (type == 'captain:location' &&
                !_tripClosed &&
                _trip != null &&
                payload['captain_id'] == _trip!['captain_id'] &&
                payload['lat'] != null &&
                payload['lng'] != null) {
              if (!mounted) return;
              final nextCoords = LatLng(
                (payload['lat'] as num).toDouble(),
                (payload['lng'] as num).toDouble(),
              );
              setState(() {
                _captainCoords = nextCoords;
              });
              widget.api.getRideTracking(widget.tripId).then((trackData) {
                final capGps = trackData['captain_gps'] as Map?;
                if (mounted && !_tripClosed && capGps != null) {
                  setState(() {
                    _distanceToPickupKm = (capGps['distance_to_pickup_km'] as num?)?.toDouble();
                    _etaMin = (capGps['eta_min'] as num?)?.toInt();
                  });
                }
              }).catchError((_) {});
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
        'sender_role': 'customer',
        'sender_name': widget.customerName,
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

  Future<void> _finishTrip() async {
    if (_actingTrip || _tripClosed) return;
    setState(() => _actingTrip = true);
    try {
      final res = await widget.api.finishTrip(
        widget.tripId,
        actorRole: 'customer',
        actorName: widget.customerName,
      );
      _tripClosed = true;
      _reconnectTimer?.cancel();
      if (!mounted) return;
      final prompt = res['rating_prompt'] is Map
          ? Map<String, dynamic>.from(res['rating_prompt'] as Map)
          : null;
      if (prompt != null) {
        await _showPostTripRatingDialog(prompt);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم إنهاء المشوار (${res['fare']} ج.م) وخصم 10% (${res['fee_10pct']} ج.م) للتطبيق ✓')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _actingTrip = false);
    }
  }

  Future<void> _cancelTrip() async {
    if (_actingTrip || _tripClosed) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تأكيد إلغاء الرحلة'),
          content: const Text('سيتم إلغاء المشوار وحذفه نهائيًا من النظام بدون أي غرامة على العميل. هل تريد المتابعة؟'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('تأكيد الإلغاء'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    setState(() => _actingTrip = true);
    try {
      await widget.api.cancelTrip(
        widget.tripId,
        actorRole: 'customer',
        actorName: widget.customerName,
      );
      _tripClosed = true;
      _reconnectTimer?.cancel();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إلغاء الرحلة وحذفها من النظام')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _actingTrip = false);
    }
  }

  Future<void> _showPostTripRatingDialog(Map<String, dynamic> prompt) async {
    int stars = 5;
    final commentCtrl = TextEditingController();
    bool submitting = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            title: Text('قيّم الطيار ${prompt['captain_name'] ?? _trip?['captain_name'] ?? ''} ⭐'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'تم إنهاء المشوار (${prompt['final_amount'] ?? _trip?['final_fare'] ?? '--'} ج.م) وحذفه من النشطة. ما تقييمك للطيار؟',
                  style: const TextStyle(fontSize: 12.5),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(5, (i) {
                    final s = i + 1;
                    return IconButton(
                      onPressed: () => setModalState(() => stars = s),
                      icon: Icon(
                        s <= stars ? Icons.star : Icons.star_border,
                        color: const Color(0xFFF59E0B),
                        size: 30,
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: commentCtrl,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'اكتب تعليقك عن الطيار (اختياري)',
                    isDense: true,
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: submitting ? null : () => Navigator.pop(ctx),
                child: const Text('لاحقًا'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                onPressed: submitting
                    ? null
                    : () async {
                        setModalState(() => submitting = true);
                        try {
                          await widget.api.submitRating(
                            ratingId: prompt['id']?.toString(),
                            captainId: prompt['captain_id']?.toString(),
                            customerName: widget.customerName,
                            refType: 'trip',
                            refId: widget.tripId,
                            refNumber: prompt['ref_number']?.toString() ?? _trip?['trip_number']?.toString(),
                            finalAmount: (prompt['final_amount'] as num?)?.toDouble(),
                            rating: stars,
                            comment: commentCtrl.text.trim(),
                          );
                          if (ctx.mounted) Navigator.pop(ctx);
                        } catch (e) {
                          setModalState(() => submitting = false);
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                        }
                      },
                child: Text(submitting ? 'جاري الحفظ...' : 'إرسال التقييم'),
              ),
            ],
          ),
        ),
      ),
    );
    commentCtrl.dispose();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('شكرًا لك! تم تسجيل التقييم وإنهاء المشوار ✓')),
      );
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _trip?['status']?.toString() ?? 'searching';
    final statusLabel = _statusLabels[status] ?? status;
    final pickupLat = (_trip?['pickup_lat'] as num?)?.toDouble() ?? 31.1583;
    final pickupLng = (_trip?['pickup_lng'] as num?)?.toDouble() ?? 31.9369;
    final dropoffLat = (_trip?['dropoff_lat'] as num?)?.toDouble();
    final dropoffLng = (_trip?['dropoff_lng'] as num?)?.toDouble();
    final pickupPoint = LatLng(pickupLat, pickupLng);
    final dropoffPoint = (dropoffLat != null && dropoffLng != null) ? LatLng(dropoffLat, dropoffLng) : null;
    final currentFare = ((_trip?['final_fare'] ?? _trip?['estimated_fare'] ?? 0) as num).toDouble();
    final fee10 = (currentFare * 0.10).toStringAsFixed(2);

    final routePoints = <LatLng>[
      pickupPoint,
      if (dropoffPoint != null) dropoffPoint,
    ];

    final markers = <Marker>[
      Marker(
        point: pickupPoint,
        width: 90,
        height: 40,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: const Color(0xFF0D9488),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(
            child: Text('انطلاق GPS', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
        ),
      ),
      if (dropoffPoint != null)
        Marker(
          point: dropoffPoint,
          width: 90,
          height: 40,
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
          width: 110,
          height: 40,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF4F46E5),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: Center(
              child: Text(
                '🛵 ${_trip?['captain_name'] ?? 'الطيار'}',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
              ),
            ),
          ),
        ),
    ];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('مشوار ${_trip?['trip_number'] ?? ''}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
              Text(
                '${_trip?['captain_name'] ?? 'بانتظار الطيار'} · ${_wsConnected ? 'تتبع لحظي GPS' : 'جاري الاتصال'}',
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              ),
            ],
          ),
          actions: [
            IconButton(
              onPressed: () => setState(() => _showMap = !_showMap),
              icon: Icon(_showMap ? Icons.map : Icons.map_outlined),
              tooltip: 'خريطة GPS',
            ),
            IconButton(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              color: const Color(0xFFF0FDFA),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.navigation, size: 17, color: Color(0xFF0D9488)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(statusLabel, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                            Text(
                              'السعر: $currentFare ج.م (حصة التطبيق 10%: $fee10 ج.م) · ${_trip?['distance_km'] ?? '--'} كم'
                              '${_distanceToPickupKm != null ? ' · يبعد ${_distanceToPickupKm!.toStringAsFixed(2)} كم (${_etaMin ?? 3} د)' : ''}',
                              style: const TextStyle(fontSize: 10.5, color: Color(0xFF0F766E)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFCCFBF1)),
                    ),
                    child: Text(
                      'الأجرة المعتمدة للرحلة: $currentFare ج.م · اتفق مع الطيار في الشات أو تواصل مع الإدارة لتعديل الأجرة',
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF0F172A), fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0D9488),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 8),
                          ),
                          onPressed: _actingTrip ? null : _finishTrip,
                          icon: const Icon(Icons.check_circle_outline, size: 15),
                          label: const Text('إنهاء المشوار', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.red.shade700,
                            side: BorderSide(color: Colors.red.shade300),
                            padding: const EdgeInsets.symmetric(vertical: 8),
                          ),
                          onPressed: _actingTrip ? null : _cancelTrip,
                          icon: const Icon(Icons.cancel_outlined, size: 15),
                          label: const Text('إلغاء الرحلة', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (_showMap)
              SizedBox(
                height: 175,
                child: FlutterMap(
                  options: MapOptions(
                    initialCenter: _captainCoords ?? pickupPoint,
                    initialZoom: 14,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.otlobha.customer',
                    ),
                    if (routePoints.length >= 2)
                      PolylineLayer(
                        polylines: [
                          Polyline(points: routePoints, color: const Color(0xFFEA580C), strokeWidth: 3.5),
                        ],
                      ),
                    MarkerLayer(markers: markers),
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
                          hintText: 'تحدث مع الطيار وتفاوض على السعر هنا...',
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
