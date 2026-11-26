import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import 'captain_order_chat_screen.dart';
import 'captain_trip_chat_screen.dart';

class CaptainHomeScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final Map<String, dynamic> captain;
  final List<dynamic> orders;
  final List<dynamic> parcels;
  final List<dynamic> trips;
  final Future<void> Function() onRefresh;
  final void Function(String filter) onOpenOrdersTab;
  final VoidCallback onOpenSettlementTab;

  const CaptainHomeScreen({
    super.key,
    required this.api,
    required this.captain,
    required this.orders,
    required this.parcels,
    required this.trips,
    required this.onRefresh,
    required this.onOpenOrdersTab,
    required this.onOpenSettlementTab,
  });

  @override
  State<CaptainHomeScreen> createState() => _CaptainHomeScreenState();
}

class _CaptainHomeScreenState extends State<CaptainHomeScreen> {
  static const Color _primaryRed = Color(0xFFA92224);
  static const Color _darkRed = Color(0xFF86191B);
  static const Color _gold = Color(0xFFF5A623);

  final Map<String, TextEditingController> _otpCtrls = {};
  final TextEditingController _rideOtpCtrl = TextEditingController();
  bool _updatingGps = false;
  bool _busyRideAction = false;

  String _tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  String _attribution = '© OpenStreetMap contributors';
  List<Map<String, dynamic>> _rideOffers = [];
  Map<String, dynamic>? _activeRide;
  LatLng _driverPoint = const LatLng(31.1583, 31.9369);
  DateTime _now = DateTime.now();

  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSub;
  StreamSubscription<Position>? _gpsSub;
  Timer? _tickTimer;
  Timer? _pollTimer;
  Timer? _reconnectTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    final lat = (widget.captain['last_lat'] ?? widget.captain['lat'] as num?)?.toDouble();
    final lng = (widget.captain['last_lng'] ?? widget.captain['lng'] as num?)?.toDouble();
    if (lat != null && lng != null) {
      _driverPoint = LatLng(lat, lng);
    }
    _loadRideState();
    _connectCaptainWs();
    _startGpsStream();
    _tickTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) => _loadRideState());
  }

  @override
  void dispose() {
    _disposed = true;
    _tickTimer?.cancel();
    _pollTimer?.cancel();
    _reconnectTimer?.cancel();
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    _gpsSub?.cancel();
    _rideOtpCtrl.dispose();
    for (final c in _otpCtrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRideState() async {
    try {
      final cfg = await widget.api.getRidesMapConfig();
      if (mounted && cfg['tile_url'] != null) {
        setState(() {
          _tileUrl = cfg['tile_url'].toString();
          if (cfg['attribution'] != null) _attribution = cfg['attribution'].toString();
        });
      }
    } catch (_) {}
    try {
      final res = await widget.api.getCaptainRideOffers();
      if (!mounted) return;
      final rawOffers = (res['offers'] as List?) ?? [];
      setState(() {
        _rideOffers = rawOffers.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _activeRide = res['active_trip'] is Map ? Map<String, dynamic>.from(res['active_trip'] as Map) : null;
      });
    } catch (_) {}
  }

  void _connectCaptainWs() {
    if (_disposed || !widget.api.hasTokens) return;
    final capId = widget.captain['id'].toString();
    try {
      _wsChannel = IOWebSocketChannel.connect(
        widget.api.captainChannelWsUri(capId),
        headers: widget.api.wsHeaders,
      );
      _wsSub = _wsChannel!.stream.listen(
        (raw) {
          try {
            final msg = jsonDecode(raw.toString()) as Map<String, dynamic>;
            final type = msg['type']?.toString() ?? '';
            if (type == 'ride:offer' ||
                type == 'ride:offer_expired' ||
                type == 'ride:offer_cancelled' ||
                type.startsWith('trip:')) {
              _loadRideState();
              widget.onRefresh();
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
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), _connectCaptainWs);
  }

  Future<void> _startGpsStream() async {
    try {
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return;
      DateTime lastSent = DateTime.fromMillisecondsSinceEpoch(0);
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 15),
      ).listen((pos) {
        if (!mounted) return;
        setState(() => _driverPoint = LatLng(pos.latitude, pos.longitude));
        final now = DateTime.now();
        if (now.difference(lastSent).inSeconds < 6) return;
        lastSent = now;
        final active = _activeRide;
        if (active != null &&
            const ['accepted', 'arrived', 'in_progress'].contains(active['status']?.toString())) {
          widget.api
              .updateRideLocation(
                active['id'].toString(),
                lat: pos.latitude,
                lng: pos.longitude,
                heading: pos.heading,
                speedKmh: (pos.speed * 3.6).clamp(0.0, 220.0).toDouble(),
              )
              .catchError((_) => <String, dynamic>{});
        } else if (widget.captain['availability_status'] == 'available') {
          widget.api
              .updateCaptainLocation(widget.captain['id'].toString(), pos.latitude, pos.longitude)
              .catchError((_) => <String, dynamic>{});
        }
      });
    } catch (_) {}
  }

  Future<void> _openOrderChat(Map<String, dynamic> order) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CaptainOrderChatScreen(
          api: widget.api,
          orderId: order['id'].toString(),
          captainId: widget.captain['id'].toString(),
          captainName: widget.captain['full_name']?.toString() ?? 'الكابتن',
        ),
      ),
    );
    await widget.onRefresh();
  }

  Future<void> _openTripChat(String tripId) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CaptainTripChatScreen(
          api: widget.api,
          tripId: tripId,
          captainId: widget.captain['id'].toString(),
          captainName: widget.captain['full_name']?.toString() ?? 'الكابتن',
        ),
      ),
    );
    await _loadRideState();
    await widget.onRefresh();
  }

  Future<void> _syncGpsNow() async {
    final capId = widget.captain['id'].toString();
    setState(() => _updatingGps = true);
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('يرجى السماح بصلاحية الموقع GPS للكابتن')),
          );
        }
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      setState(() => _driverPoint = LatLng(pos.latitude, pos.longitude));
      await widget.api.updateCaptainLocation(capId, pos.latitude, pos.longitude);
      if (_activeRide != null &&
          const ['accepted', 'arrived', 'in_progress'].contains(_activeRide!['status']?.toString())) {
        await widget.api.updateRideLocation(_activeRide!['id'].toString(), lat: pos.latitude, lng: pos.longitude);
      }
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال موقعك GPS المباشر ✓')),
        );
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _updatingGps = false);
    }
  }

  Future<void> _showDisputeDialog(String tripId) async {
    String cat = 'safety';
    final descCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) => AlertDialog(
          title: const Text('إبلاغ / طوارئ للرحلة'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: cat,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'التصنيف'),
                items: const [
                  DropdownMenuItem(value: 'safety', child: Text('طارئ سلامة')),
                  DropdownMenuItem(value: 'payment', child: Text('مشكلة دفع')),
                  DropdownMenuItem(value: 'behavior', child: Text('سلوك العميل')),
                  DropdownMenuItem(value: 'other', child: Text('أخرى')),
                ],
                onChanged: (v) => setDlg(() => cat = v ?? 'safety'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: descCtrl,
                maxLines: 3,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'اشرح الحالة للإدارة...'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: _primaryRed, foregroundColor: Colors.white),
              onPressed: () async {
                if (descCtrl.text.trim().isEmpty) return;
                Navigator.pop(ctx);
                try {
                  await widget.api.reportRideDispute(tripId, category: cat, description: descCtrl.text.trim());
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إرسال البلاغ للإدارة')));
                  }
                } catch (e) {
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                }
              },
              child: const Text('إرسال'),
            ),
          ],
        ),
      ),
    );
    descCtrl.dispose();
  }

  List<LatLng> _parseRoutePoints(dynamic rawGeom) {
    if (rawGeom == null) return [];
    try {
      final decoded = rawGeom is String ? jsonDecode(rawGeom) : rawGeom;
      if (decoded is List) {
        final pts = <LatLng>[];
        for (final p in decoded) {
          if (p is List && p.length >= 2) {
            pts.add(LatLng((p[0] as num).toDouble(), (p[1] as num).toDouble()));
          } else if (p is Map && p['lat'] != null && p['lng'] != null) {
            pts.add(LatLng((p['lat'] as num).toDouble(), (p['lng'] as num).toDouble()));
          }
        }
        return pts;
      }
    } catch (_) {}
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final cap = widget.captain;
    final capId = cap['id'].toString();
    final isApproved = cap['verification_status'] == 'approved' || cap['status'] == 'approved';
    final isOnline = cap['availability_status'] == 'available' || cap['availability_status'] == 'busy';

    final capOrders = widget.orders
        .where((o) => o['captain_id'] == capId || o['status'] == 'ready_for_pickup')
        .toList();
    final openOrders = capOrders.where((o) => o['status'] != 'delivered' && o['status'] != 'cancelled').toList();
    final completedOrders = capOrders.where((o) => o['status'] == 'delivered').toList();
    final activeParcels = widget.parcels.where((p) => p['status'] != 'delivered').toList();

    final liveOffers = _rideOffers.where((o) {
      final exp = DateTime.tryParse(o['expires_at']?.toString() ?? '');
      return exp == null || exp.isAfter(_now);
    }).toList();

    final activeRoute = _activeRide != null ? _parseRoutePoints(_activeRide!['route_geometry_json']) : <LatLng>[];
    final mapMarkers = <Marker>[
      Marker(
        point: _driverPoint,
        width: 90,
        height: 34,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: _primaryRed,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(
            child: Text('موقعي', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
        ),
      ),
      if (_activeRide != null && _activeRide!['pickup_lat'] != null && _activeRide!['pickup_lng'] != null)
        Marker(
          point: LatLng((_activeRide!['pickup_lat'] as num).toDouble(), (_activeRide!['pickup_lng'] as num).toDouble()),
          width: 84,
          height: 34,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF059669),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: const Center(
              child: Text('العميل', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
      if (_activeRide != null && _activeRide!['dropoff_lat'] != null && _activeRide!['dropoff_lng'] != null)
        Marker(
          point: LatLng((_activeRide!['dropoff_lat'] as num).toDouble(), (_activeRide!['dropoff_lng'] as num).toDouble()),
          width: 84,
          height: 34,
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
    ];

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // Captain Status + Online/Offline Control Card
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [_primaryRed, _darkRed]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      '${cap['full_name']}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: Colors.white.withOpacity(0.18), borderRadius: BorderRadius.circular(8)),
                    child: Text('★ ${cap['rating_avg'] ?? 5.0}',
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: _gold)),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '${cap['vehicle_type']} · ${cap['vehicle_model']} · ${cap['plate_number']}',
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 10),
              if (!isApproved)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.amber.shade100,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    'حسابك بانتظار اعتماد الإدارة (${cap['status']}) — لا يمكنك استقبال الرحلات قبل الموافقة.',
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                  ),
                )
              else
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: isOnline ? const Color(0xFF059669) : Colors.white,
                          foregroundColor: isOnline ? Colors.white : const Color(0xFF0F172A),
                          minimumSize: const Size.fromHeight(44),
                        ),
                        onPressed: () async {
                          final nextOnline = !isOnline;
                          try {
                            await widget.api.setCaptainRideAvailability(
                              online: nextOnline,
                              lat: _driverPoint.latitude,
                              lng: _driverPoint.longitude,
                            );
                            if (nextOnline) _syncGpsNow();
                            await widget.onRefresh();
                          } catch (e) {
                            if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                          }
                        },
                        icon: const Icon(Icons.power_settings_new, size: 18),
                        label: Text(isOnline ? 'متصل — يستقبل رحلات' : 'غير متصل — اضغط للاتصال'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      style: IconButton.styleFrom(backgroundColor: Colors.white.withOpacity(0.18)),
                      onPressed: _updatingGps ? null : _syncGpsNow,
                      icon: const Icon(Icons.my_location, color: Colors.white),
                      tooltip: 'تحديث موقعي GPS',
                    ),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 10),

        // Live OpenStreetMap for Captain
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: SizedBox(
            height: 210,
            child: Stack(
              children: [
                FlutterMap(
                  options: MapOptions(initialCenter: _driverPoint, initialZoom: 13.8),
                  children: [
                    TileLayer(urlTemplate: _tileUrl, userAgentPackageName: 'com.otlobha.captain'),
                    if (activeRoute.length > 1)
                      PolylineLayer(
                        polylines: [Polyline(points: activeRoute, color: _primaryRed, strokeWidth: 4)],
                      ),
                    MarkerLayer(markers: mapMarkers),
                  ],
                ),
                Positioned(
                  left: 8,
                  bottom: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: Colors.white.withOpacity(0.88), borderRadius: BorderRadius.circular(6)),
                    child: Text(_attribution, style: const TextStyle(fontSize: 9.5, color: Colors.black87)),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),

        // Incoming Timed Ride Offers (Auto-Dispatch)
        if (liveOffers.isNotEmpty) ...[
          const Text('طلبات المشاوير الواردة إليك الآن', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: _primaryRed)),
          const SizedBox(height: 6),
          ...liveOffers.map((offer) {
            final exp = DateTime.tryParse(offer['expires_at']?.toString() ?? '');
            final remain = exp != null ? exp.difference(_now).inSeconds.clamp(0, 999).toInt() : 30;
            final offerId = offer['id'].toString();
            return Card(
              color: const Color(0xFFFEF2F2),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: _primaryRed, width: 2),
              ),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('طلب رحلة · ${offer['vehicle_type']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(color: Colors.amber.shade100, borderRadius: BorderRadius.circular(8)),
                          child: Text('$remain ثانية', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF92400E))),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text('من: ${offer['pickup_address']}', style: const TextStyle(fontSize: 12.5)),
                    Text('إلى: ${offer['dropoff_address']}', style: const TextStyle(fontSize: 12.5)),
                    const SizedBox(height: 4),
                    Text(
                      'المسافة: ${offer['distance_km']} كم · الأجرة: ${offer['estimated_fare']} ج.م',
                      style: const TextStyle(fontWeight: FontWeight.bold, color: _primaryRed, fontSize: 13.5),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF059669),
                              foregroundColor: Colors.white,
                              minimumSize: const Size.fromHeight(44),
                            ),
                            onPressed: _busyRideAction
                                ? null
                                : () async {
                                    setState(() => _busyRideAction = true);
                                    try {
                                      await widget.api.acceptRideOffer(offerId);
                                      await _loadRideState();
                                      await widget.onRefresh();
                                    } catch (e) {
                                      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                    } finally {
                                      if (mounted) setState(() => _busyRideAction = false);
                                    }
                                  },
                            icon: const Icon(Icons.check_circle, size: 17),
                            label: const Text('قبول الرحلة'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(foregroundColor: Colors.red, minimumSize: const Size.fromHeight(44)),
                            onPressed: _busyRideAction
                                ? null
                                : () async {
                                    setState(() => _busyRideAction = true);
                                    try {
                                      await widget.api.rejectRideOffer(offerId);
                                      await _loadRideState();
                                    } catch (e) {
                                      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                    } finally {
                                      if (mounted) setState(() => _busyRideAction = false);
                                    }
                                  },
                            child: const Text('رفض'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 10),
        ],

        // Active Ride Stepper Card
        if (_activeRide != null) ...[
          _buildActiveRideStepper(_activeRide!),
          const SizedBox(height: 10),
        ],

        // Quick Stats Row (Orders + Cash)
        Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: () => widget.onOpenOrdersTab('open'),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('أوردرات مفتوحة', style: TextStyle(fontSize: 11, color: Colors.black54)),
                        const SizedBox(height: 4),
                        Text('${openOrders.length}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold, color: Color(0xFFEA580C))),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: InkWell(
                onTap: () => widget.onOpenOrdersTab('completed'),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('تمت اليوم', style: TextStyle(fontSize: 11, color: Colors.black54)),
                        const SizedBox(height: 4),
                        Text('${completedOrders.length}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold, color: Color(0xFF0D9488))),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: InkWell(
                onTap: widget.onOpenSettlementTab,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('الأرباح والكاش', style: TextStyle(fontSize: 11, color: Colors.black54)),
                        const SizedBox(height: 4),
                        Text('${cap['cash_on_hand']}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),

        // Preserved Open Store Orders Section
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('الأوردرات المفتوحة الآن', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            TextButton(onPressed: () => widget.onOpenOrdersTab('all'), child: const Text('سجل أوردرات اليوم')),
          ],
        ),
        if (openOrders.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('لا توجد أوردرات متاجر مفتوحة حاليًا.', style: TextStyle(color: Colors.black54)),
            ),
          )
        else
          ...openOrders.map((raw) {
            final o = Map<String, dynamic>.from(raw as Map);
            final hasProof = o['delivery_proof_image_url'] != null && o['delivery_proof_image_url'].toString().isNotEmpty;
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('${o['order_number']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                        Text('${o['total_amount']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('${o['customer_name']} - ${o['address_landmark']}', style: const TextStyle(fontSize: 12)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        OutlinedButton.icon(
                          onPressed: () => _openOrderChat(o),
                          icon: const Icon(Icons.chat_bubble_outline, size: 15),
                          label: Text('الشات (${o['chat_count'] ?? 0})', style: const TextStyle(fontSize: 12)),
                        ),
                        if (o['status'] != 'on_the_way')
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                            onPressed: () async {
                              try {
                                await widget.api.updateOrderStatus(capId, o['id'].toString(), 'on_the_way');
                                await widget.onRefresh();
                                if (mounted) await _openOrderChat(o);
                              } catch (e) {
                                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                              }
                            },
                            child: const Text('تم الاستلام', style: TextStyle(fontSize: 12)),
                          ),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                          onPressed: () async {
                            if (!hasProof) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('شرط إلزامي: صوّر الأوردر عند منزل العميل وأرسله في الشات أولًا')),
                              );
                              await _openOrderChat(o);
                              return;
                            }
                            try {
                              await widget.api.updateOrderStatus(capId, o['id'].toString(), 'delivered');
                              await widget.onRefresh();
                            } catch (e) {
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                            }
                          },
                          child: const Text('تم التسليم', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),

        // Preserved Active Parcels (OTP)
        if (activeParcels.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('مهام الطرود (تأكيد بـ OTP)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ...activeParcels.map((p) {
            final ctrl = _otpCtrls.putIfAbsent(p['id'].toString(), () => TextEditingController());
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${p['delivery_number']} · ${p['item_category']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text('${p['pickup_address']} ← ${p['dropoff_address']}', style: const TextStyle(fontSize: 12)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: ctrl,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, hintText: 'OTP المستلم'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                          onPressed: () async {
                            try {
                              await widget.api.completeParcelWithOtp(capId, p['id'].toString(), ctrl.text);
                              await widget.onRefresh();
                            } catch (e) {
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                            }
                          },
                          child: const Text('تأكيد التسليم'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ],
    );
  }

  Widget _buildActiveRideStepper(Map<String, dynamic> trip) {
    final st = (trip['status'] ?? '').toString();
    final tid = trip['id'].toString();
    final phone = trip['customer_phone']?.toString() ?? '';
    return Card(
      color: const Color(0xFFECFDF5),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFF059669), width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('رحلة نشطة · ${trip['trip_number']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                Text('${trip['final_fare'] ?? trip['estimated_fare']} ج.م',
                    style: const TextStyle(fontWeight: FontWeight.w800, color: _primaryRed, fontSize: 15)),
              ],
            ),
            const SizedBox(height: 4),
            Text('العميل: ${trip['customer_name']} ${phone.isNotEmpty ? '($phone)' : ''}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            Text('الانطلاق: ${trip['pickup_address']}', style: const TextStyle(fontSize: 12)),
            Text('الوجهة: ${trip['dropoff_address']}', style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (phone.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: phone));
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('تم نسخ رقم العميل: $phone')));
                    },
                    icon: const Icon(Icons.phone, size: 15),
                    label: const Text('نسخ الرقم', style: TextStyle(fontSize: 11.5)),
                  ),
                OutlinedButton.icon(
                  onPressed: () => _openTripChat(tid),
                  icon: const Icon(Icons.chat, size: 15),
                  label: const Text('محادثة العميل', style: TextStyle(fontSize: 11.5)),
                ),
                OutlinedButton.icon(
                  onPressed: () => _showDisputeDialog(tid),
                  icon: const Icon(Icons.warning_amber, size: 15, color: Colors.orange),
                  label: const Text('طوارئ', style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (st == 'accepted')
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: _primaryRed, foregroundColor: Colors.white, minimumSize: const Size.fromHeight(44)),
                      onPressed: _busyRideAction
                          ? null
                          : () async {
                              setState(() => _busyRideAction = true);
                              try {
                                await widget.api.markRideArrived(tid);
                                await _loadRideState();
                              } catch (e) {
                                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                              } finally {
                                if (mounted) setState(() => _busyRideAction = false);
                              }
                            },
                      child: const Text('وصلت إلى العميل'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                    onPressed: _busyRideAction
                        ? null
                        : () async {
                            setState(() => _busyRideAction = true);
                            try {
                              await widget.api.cancelRideV2(tid);
                              await _loadRideState();
                              await widget.onRefresh();
                            } catch (e) {
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                            } finally {
                              if (mounted) setState(() => _busyRideAction = false);
                            }
                          },
                    child: const Text('إلغاء'),
                  ),
                ],
              ),
            if (st == 'arrived') ...[
              const Text('أدخل رمز بدء الرحلة (4 أرقام) من تطبيق العميل:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Row(
                children: [
                  SizedBox(
                    width: 110,
                    child: TextField(
                      controller: _rideOtpCtrl,
                      keyboardType: TextInputType.number,
                      maxLength: 4,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        counterText: '',
                        isDense: true,
                        hintText: '0000',
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6D28D9), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(44)),
                      onPressed: _busyRideAction
                          ? null
                          : () async {
                              final code = _rideOtpCtrl.text.trim();
                              if (code.length != 4) {
                                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('أدخل رمزاً من 4 أرقام')));
                                return;
                              }
                              setState(() => _busyRideAction = true);
                              try {
                                await widget.api.startRideWithOtp(tid, code);
                                _rideOtpCtrl.clear();
                                await _loadRideState();
                              } catch (e) {
                                if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                              } finally {
                                if (mounted) setState(() => _busyRideAction = false);
                              }
                            },
                      child: const Text('تحقق وبدء الرحلة'),
                    ),
                  ),
                ],
              ),
            ],
            if (st == 'in_progress')
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF059669), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(46)),
                onPressed: _busyRideAction
                    ? null
                    : () async {
                        setState(() => _busyRideAction = true);
                        try {
                          final res = await widget.api.completeRideV2(tid);
                          await _loadRideState();
                          await widget.onRefresh();
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  'اكتملت الرحلة! الأجرة: ${res['final_fare']} ج.م · صافي ربحك: ${res['driver_net_earnings']} ج.م',
                                ),
                              ),
                            );
                          }
                        } catch (e) {
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                        } finally {
                          if (mounted) setState(() => _busyRideAction = false);
                        }
                      },
                child: const Text('إنهاء الرحلة وتحصيل الأجرة'),
              ),
          ],
        ),
      ),
    );
  }
}
