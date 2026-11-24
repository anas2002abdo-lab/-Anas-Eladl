import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import '../core/num_utils.dart';

class RidesParcelsScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final String customerName;
  final String customerPhone;
  final String selectedZoneId;
  final Future<void> Function() onRefresh;
  final void Function(String tripId) onOpenTripChat;

  const RidesParcelsScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.customerName,
    required this.customerPhone,
    this.selectedZoneId = 'zn_city_center',
    required this.onRefresh,
    required this.onOpenTripChat,
  });

  @override
  State<RidesParcelsScreen> createState() => _RidesParcelsScreenState();
}

class _RidesParcelsScreenState extends State<RidesParcelsScreen> {
  String _vehicle = 'moto';
  LatLng _pickupPoint = const LatLng(31.1583, 31.9369);
  LatLng? _dropoffPoint = const LatLng(31.1645, 31.9442);
  String _mapPickTarget = 'dropoff'; // 'pickup' | 'dropoff'
  bool _locatingGps = false;
  bool _bookingRide = false;
  double _distanceKm = 2.5;
  List<dynamic> _nearbyCaptains = [];
  String? _selectedCaptainId;
  String _captainFilterVehicle = 'all';
  String? _pendingTripId;

  final TextEditingController _pickupCtrl = TextEditingController(text: 'موقعي الحالي (GPS) — وسط المنزلة');
  final TextEditingController _dropoffCtrl = TextEditingController(text: 'موقف المنزلة العمومي');
  final TextEditingController _proposedFareCtrl = TextEditingController(text: '25');
  final TextEditingController _parcelDropoffCtrl = TextEditingController(text: 'البصراط - بجوار الوحدة');
  final TextEditingController _receiverPhoneCtrl = TextEditingController(text: '01099887766');
  final TextEditingController _itemCatCtrl = TextEditingController(text: 'مستندات وأوراق');
  final TextEditingController _parcelFeeCtrl = TextEditingController();
  String? _parcelCaptainId;
  bool _prohibitedConfirmed = true;
  String? _lastOtp;

  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSub;
  Timer? _reconnectTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _refreshDistanceAndCaptains();
    _connectRidesWs();
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    _pickupCtrl.dispose();
    _dropoffCtrl.dispose();
    _proposedFareCtrl.dispose();
    _parcelDropoffCtrl.dispose();
    _receiverPhoneCtrl.dispose();
    _itemCatCtrl.dispose();
    _parcelFeeCtrl.dispose();
    super.dispose();
  }

  void _connectRidesWs() {
    if (_disposed || !widget.api.hasTokens) return;
    try {
      _wsChannel = IOWebSocketChannel.connect(widget.api.customerChannelWsUri(), headers: widget.api.wsHeaders);
      _wsSub = _wsChannel!.stream.listen(
        (raw) {
          try {
            final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
            final type = payload['type']?.toString();
            if (type == 'captain:location' || type == 'captains:updated') {
              _refreshNearbyOnly();
            } else if (type == 'trip:accepted' && payload['trip'] is Map) {
              final trip = Map<String, dynamic>.from(payload['trip'] as Map);
              widget.onRefresh();
              if (_pendingTripId == trip['id']?.toString() ||
                  trip['customer_name']?.toString() == widget.customerName) {
                _pendingTripId = null;
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('قبل الكابتن ${trip['captain_name'] ?? ''} مشوارك — تم فتح الشات')),
                  );
                  widget.onOpenTripChat(trip['id'].toString());
                }
              }
            } else if (type == 'trip:status' ||
                type == 'trip:fare_updated' ||
                type == 'trip:captain_updated' ||
                type == 'trip:completed' ||
                type == 'trip:cancelled' ||
                type == 'rating:submitted') {
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
    _reconnectTimer = Timer(const Duration(seconds: 3), _connectRidesWs);
  }

  Future<void> _refreshNearbyOnly() async {
    try {
      final caps = await widget.api.getNearbyCaptains(
        _pickupPoint.latitude,
        _pickupPoint.longitude,
        vehicleType: 'all',
      );
      final onlineOnly = caps.where((c) => c['availability_status']?.toString() == 'available').toList();
      if (mounted) {
        setState(() {
          _nearbyCaptains = onlineOnly;
          if (_selectedCaptainId != null && !onlineOnly.any((c) => c['id']?.toString() == _selectedCaptainId)) {
            _selectedCaptainId = null;
          }
          if (_parcelCaptainId != null && !onlineOnly.any((c) => c['id']?.toString() == _parcelCaptainId)) {
            _parcelCaptainId = null;
          }
        });
      }
    } catch (_) {}
  }

  Future<void> _refreshDistanceAndCaptains() async {
    final dist = _dropoffPoint != null
        ? (const Distance().as(LengthUnit.Kilometer, _pickupPoint, _dropoffPoint!) * 1.25).clamp(1.0, 60.0)
        : 2.5;
    final roundedDist = double.parse(dist.toStringAsFixed(2));
    try {
      final caps = await widget.api.getNearbyCaptains(
        _pickupPoint.latitude,
        _pickupPoint.longitude,
        vehicleType: 'all',
      );
      final onlineOnly = caps.where((c) => c['availability_status']?.toString() == 'available').toList();
      if (!mounted) return;
      setState(() {
        _distanceKm = roundedDist;
        _nearbyCaptains = onlineOnly;
        if (_selectedCaptainId != null && !onlineOnly.any((c) => c['id']?.toString() == _selectedCaptainId)) {
          _selectedCaptainId = null;
        }
        if (_parcelCaptainId != null && !onlineOnly.any((c) => c['id']?.toString() == _parcelCaptainId)) {
          _parcelCaptainId = null;
        }
      });
    } catch (_) {
      if (mounted) setState(() => _distanceKm = roundedDist);
    }
  }

  Future<void> _detectGps() async {
    setState(() => _locatingGps = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(() {
            _locatingGps = false;
            _mapPickTarget = 'pickup';
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('اضغط على الخريطة لتحديد موقع الانطلاق GPS يدويًا')),
          );
        }
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (!mounted) return;
      setState(() {
        _pickupPoint = LatLng(pos.latitude, pos.longitude);
        _pickupCtrl.text = 'موقعي الحالي (GPS: ${pos.latitude.toStringAsFixed(4)}, ${pos.longitude.toStringAsFixed(4)})';
        _locatingGps = false;
      });
      await _refreshDistanceAndCaptains();
    } catch (_) {
      if (mounted) {
        setState(() {
          _locatingGps = false;
          _mapPickTarget = 'pickup';
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر التقاط GPS تلقائيًا — اضغط على الخريطة لتحديد موقعك')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final trips = (widget.bootstrap['trips'] as List?) ?? [];
    final activeTrips = trips.where((t) => t['status'] != 'completed' && t['status'] != 'cancelled').toList();

    Map<String, dynamic>? selectedCaptain;
    for (final c in _nearbyCaptains) {
      if (c is Map && c['id']?.toString() == _selectedCaptainId) {
        selectedCaptain = Map<String, dynamic>.from(c);
        break;
      }
    }

    final mapMarkers = <Marker>[
      Marker(
        point: _pickupPoint,
        width: 96,
        height: 36,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: const Color(0xFF0D9488),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(
            child: Text('انطلاقي GPS', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
        ),
      ),
      if (_dropoffPoint != null)
        Marker(
          point: _dropoffPoint!,
          width: 84,
          height: 36,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFFEA580C),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: const Center(
              child: Text('التوصيل', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
      ..._nearbyCaptains
          .where((c) => c['lat'] != null && c['lng'] != null && c['availability_status']?.toString() == 'available')
          .map((c) {
        final cid = c['id']?.toString();
        final isSelected = cid == _selectedCaptainId;
        final avail = c['availability_status']?.toString() ?? 'offline';
        final pinColor = isSelected
            ? const Color(0xFFEA580C)
            : avail == 'available'
                ? const Color(0xFF4F46E5)
                : avail == 'busy'
                    ? const Color(0xFFD97706)
                    : const Color(0xFF64748B);
        return Marker(
          point: LatLng((c['lat'] as num).toDouble(), (c['lng'] as num).toDouble()),
          width: 118,
          height: 36,
          child: GestureDetector(
            onTap: () {
              setState(() {
                _selectedCaptainId = isSelected ? null : cid;
                if (_selectedCaptainId != null && c['vehicle_type'] != null) {
                  _vehicle = c['vehicle_type'].toString();
                }
              });
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(
                color: pinColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: isSelected ? const Color(0xFFFEF08A) : Colors.white, width: isSelected ? 2.5 : 1.5),
              ),
              child: Center(
                child: Text(
                  '${isSelected ? '★ ' : '🛵 '}${c['full_name']} (${c['distance_km']} كم)',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                ),
              ),
            ),
          ),
        );
      }),
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // 1) اطلبها مشوار - مفتوحة دائماً بالترتيب المطلوب
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('اطلبها مشوار (تنقل الركاب)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: const Color(0xFFCCFBF1), borderRadius: BorderRadius.circular(8)),
                      child: const Text('متاحة دائمًا ✓', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF0F766E))),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'moto', label: Text('موتوسيكل')),
                    ButtonSegment(value: 'tuktuk', label: Text('توك توك')),
                    ButtonSegment(value: 'car', label: Text('سيارة')),
                  ],
                  selected: {_vehicle},
                  onSelectionChanged: (v) {
                    setState(() => _vehicle = v.first);
                  },
                ),
                const SizedBox(height: 14),

                // أولاً: إرسال الموقع بالـ GPS
                const Text('1. أولًا: إرسال موقع الانطلاق بالـ GPS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF0F766E))),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _pickupCtrl,
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          labelText: 'موقع الانطلاق',
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0D9488), foregroundColor: Colors.white),
                      onPressed: _locatingGps ? null : _detectGps,
                      icon: const Icon(Icons.my_location, size: 17),
                      label: Text(_locatingGps ? '...' : 'موقعي GPS', style: const TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
                const SizedBox(height: 14),

                // ثانياً: كتابة مكان التوصيل أو تحديده على الخريطة GPS
                const Text('2. ثانيًا: اكتب مكان التوصيل أو حدده على الـ GPS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFFEA580C))),
                const SizedBox(height: 6),
                TextField(
                  controller: _dropoffCtrl,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'مكان التوصيل (الوجهة)',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('تحديد الانطلاق على الخريطة', style: TextStyle(fontSize: 11))),
                        selected: _mapPickTarget == 'pickup',
                        onSelected: (_) => setState(() => _mapPickTarget = 'pickup'),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('تحديد مكان التوصيل على GPS', style: TextStyle(fontSize: 11))),
                        selected: _mapPickTarget == 'dropoff',
                        onSelected: (_) => setState(() => _mapPickTarget = 'dropoff'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: SizedBox(
                    height: 215,
                    child: FlutterMap(
                      options: MapOptions(
                        initialCenter: _pickupPoint,
                        initialZoom: 13.8,
                        onTap: (_, latLng) {
                          setState(() {
                            if (_mapPickTarget == 'pickup') {
                              _pickupPoint = latLng;
                              _pickupCtrl.text = 'موقع الانطلاق (${latLng.latitude.toStringAsFixed(4)}, ${latLng.longitude.toStringAsFixed(4)})';
                            } else {
                              _dropoffPoint = latLng;
                              _dropoffCtrl.text = 'وجهة GPS (${latLng.latitude.toStringAsFixed(4)}, ${latLng.longitude.toStringAsFixed(4)})';
                            }
                          });
                          _refreshDistanceAndCaptains();
                        },
                      ),
                      children: [
                        TileLayer(
                          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'com.otlobha.customer',
                        ),
                        if (_dropoffPoint != null)
                          PolylineLayer(
                            polylines: [
                              Polyline(points: [_pickupPoint, _dropoffPoint!], color: const Color(0xFFEA580C), strokeWidth: 3.5),
                            ],
                          ),
                        MarkerLayer(markers: mapMarkers),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),

                // ثالثاً: العميل يحدد سعره بنفسه (بدون تسعير تلقائي)
                const Text('3. ثالثًا: حدد سعرك للمشوار (أرقام عربية أو إنجليزية)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _proposedFareCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                          border: OutlineInputBorder(),
                          labelText: 'السعر الذي تعرضه للمشوار (ج.م)',
                          hintText: 'مثال: 25 أو ٢٥',
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF7ED),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFFED7AA)),
                      ),
                      child: Text('المسافة: $_distanceKm كم', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFEA580C))),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [20, 25, 30, 40, 50, 75, 100].map((preset) {
                    final parsed = parseLocalizedNumber(_proposedFareCtrl.text);
                    final active = parsed != null && parsed.round() == preset;
                    return ChoiceChip(
                      label: Text('$preset ج.م', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                      selected: active,
                      selectedColor: const Color(0xFFEA580C),
                      labelStyle: TextStyle(color: active ? Colors.white : const Color(0xFF0F172A)),
                      onSelected: (_) {
                        setState(() {
                          _proposedFareCtrl.text = '$preset';
                        });
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 6),
                const Text(
                  'ملاحظة: السعر يحدده العميل بالكامل ويمكن التفاوض مع الطيار داخل الشات ورفع السعر النهائي لحساب نسبة التطبيق 10%.',
                  style: TextStyle(fontSize: 11, color: Colors.black54),
                ),
                const SizedBox(height: 12),

                // رابعاً: حرية اختيار طيار محدد أو ترك الطلب مفتوحًا للجميع
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('4. اختيار الطيار (محدد أو للجميع)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5, color: Color(0xFF4F46E5))),
                    IconButton(
                      tooltip: 'تحديث قائمة الطيارين',
                      onPressed: _refreshNearbyOnly,
                      icon: const Icon(Icons.refresh, size: 18, color: Color(0xFF4F46E5)),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('أي طيار متاح', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold))),
                        selected: _selectedCaptainId == null,
                        onSelected: (_) => setState(() => _selectedCaptainId = null),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('اختيار طيار محدد ✓', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold))),
                        selected: _selectedCaptainId != null,
                        onSelected: (_) {
                          if (_selectedCaptainId == null && _nearbyCaptains.isNotEmpty) {
                            final first = _nearbyCaptains.firstWhere(
                              (c) => c['availability_status'] == 'available',
                              orElse: () => _nearbyCaptains.first,
                            );
                            setState(() {
                              _selectedCaptainId = first['id']?.toString();
                              if (first['vehicle_type'] != null) {
                                _vehicle = first['vehicle_type'].toString();
                              }
                            });
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String?>(
                  value: _nearbyCaptains.any((c) => c['id']?.toString() == _selectedCaptainId) ? _selectedCaptainId : null,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'اختر الطيار بالاسم من القائمة',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  ),
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('أي طيار متاح (إرسال الطلب لجميع الطيارين)', style: TextStyle(fontSize: 12)),
                    ),
                    ..._nearbyCaptains.map((c) {
                      final cid = c['id']?.toString();
                      final vehLabel = c['vehicle_type'] == 'tuktuk'
                          ? 'توك توك'
                          : c['vehicle_type'] == 'car'
                              ? 'سيارة'
                              : 'موتوسيكل';
                      final avail = c['availability_status']?.toString() ?? 'offline';
                      final availLabel = avail == 'available'
                          ? 'متاح'
                          : avail == 'busy'
                              ? 'في مهمة'
                              : 'غير متاح';
                      return DropdownMenuItem<String?>(
                        value: cid,
                        child: Text(
                          '${c['full_name']} ($vehLabel · ${c['distance_km']} كم · $availLabel)',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12),
                        ),
                      );
                    }),
                  ],
                  onChanged: (val) {
                    setState(() {
                      _selectedCaptainId = val;
                      if (val != null) {
                        for (final c in _nearbyCaptains) {
                          if (c['id']?.toString() == val && c['vehicle_type'] != null) {
                            _vehicle = c['vehicle_type'].toString();
                            break;
                          }
                        }
                      }
                    });
                  },
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  children: [
                    ('all', 'الكل'),
                    ('moto', 'موتوسيكل'),
                    ('tuktuk', 'توك توك'),
                    ('car', 'سيارة'),
                  ].map((entry) {
                    final active = _captainFilterVehicle == entry.$1;
                    return ChoiceChip(
                      label: Text(entry.$2, style: const TextStyle(fontSize: 10.5)),
                      selected: active,
                      onSelected: (_) => setState(() => _captainFilterVehicle = entry.$1),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 8),
                if (selectedCaptain != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7ED),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFEA580C)),
                    ),
                    child: Text(
                      'تم اختيار الطيار: ${selectedCaptain['full_name']} (${selectedCaptain['distance_km']} كم · ★ ${selectedCaptain['rating_avg'] ?? 5})',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: Color(0xFFEA580C)),
                    ),
                  ),
                if (_nearbyCaptains.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFBEB),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFFDE68A)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text(
                            'لا يوجد طيار متاح حاليًا — يمكنك إرسال الطلب وسيتلقاه أول طيار متاح.',
                            style: TextStyle(fontSize: 11.5, color: Color(0xFF92400E), fontWeight: FontWeight.w600),
                          ),
                        ),
                        TextButton(onPressed: _refreshNearbyOnly, child: const Text('تحديث')),
                      ],
                    ),
                  )
                else
                  ..._nearbyCaptains
                      .where((c) => _captainFilterVehicle == 'all' || c['vehicle_type'] == _captainFilterVehicle)
                      .map((c) {
                    final cid = c['id']?.toString();
                    final isSelected = cid == _selectedCaptainId;
                    final avail = c['availability_status']?.toString() ?? 'offline';
                    return InkWell(
                      onTap: () {
                        setState(() {
                          _selectedCaptainId = isSelected ? null : cid;
                          if (_selectedCaptainId != null && c['vehicle_type'] != null) {
                            _vehicle = c['vehicle_type'].toString();
                          }
                        });
                      },
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: isSelected ? const Color(0xFFFFF7ED) : Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: isSelected ? const Color(0xFFEA580C) : Colors.grey.shade300, width: isSelected ? 1.6 : 1),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${isSelected ? '★ ' : '🛵 '}${c['full_name']} · ${c['vehicle_model'] ?? c['vehicle_type']}',
                                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  Text(
                                    'التقييم ★ ${c['rating_avg'] ?? 5} · ${avail == 'available' ? 'متاح الآن' : avail == 'busy' ? 'في مهمة' : 'غير متصل'}',
                                    style: const TextStyle(fontSize: 10.5, color: Colors.black54),
                                  ),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('${c['distance_km']} كم · ${c['eta_min']} د', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF0D9488))),
                                Text(isSelected ? 'مختار ✓' : 'اختر', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: isSelected ? const Color(0xFFEA580C) : const Color(0xFF4F46E5))),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                const SizedBox(height: 10),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(48)),
                  onPressed: _bookingRide ? null : _submitRide,
                  child: Text(
                    _bookingRide
                        ? 'جاري إرسال الطلب...'
                        : () {
                            final shownFare = parseLocalizedNumber(_proposedFareCtrl.text)?.toString() ?? _proposedFareCtrl.text.trim();
                            return selectedCaptain != null
                                ? 'إرسال عرضي ($shownFare ج.م) للطيار ${selectedCaptain['full_name']}'
                                : 'نشر عرضي ($shownFare ج.م) للطيارين';
                          }(),
                  ),
                ),
              ],
            ),
          ),
        ),

        if (activeTrips.isNotEmpty) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('مشاويرك النشطة (الشات وتتبع GPS)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  ...activeTrips.map((t) {
                    final fare = t['final_fare'] ?? t['estimated_fare'];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${t['trip_number']} · ${t['dropoff_address']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                                Text(
                                  '${t['status'] == 'searching' ? (t['preferred_captain_name'] != null ? 'بانتظار: ${t['preferred_captain_name']}' : 'بانتظار قبول طيار') : 'الطيار: ${t['captain_name'] ?? ''}'} · $fare ج.م',
                                  style: const TextStyle(fontSize: 11, color: Colors.black54),
                                ),
                              ],
                            ),
                          ),
                          if (t['status'] == 'searching')
                            IconButton(
                              tooltip: 'إلغاء الطلب',
                              onPressed: () async {
                                try {
                                  await widget.api.cancelTrip(
                                    t['id'].toString(),
                                    actorRole: 'customer',
                                    actorName: widget.customerName,
                                  );
                                  await widget.onRefresh();
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(content: Text('تم إلغاء طلب المشوار وحذفه من النظام')),
                                    );
                                  }
                                } catch (e) {
                                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                }
                              },
                              icon: const Icon(Icons.close, color: Colors.red),
                            ),
                          ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white),
                            onPressed: () => widget.onOpenTripChat(t['id'].toString()),
                            icon: const Icon(Icons.chat, size: 15),
                            label: const Text('الشات و GPS', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
        ],

        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('اطلبها أي حاجة (توصيل طرود بـ OTP)', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                const SizedBox(height: 10),
                TextField(controller: _parcelDropoffCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'عنوان التسليم')),
                const SizedBox(height: 10),
                TextField(controller: _receiverPhoneCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'هاتف المستلم')),
                const SizedBox(height: 10),
                TextField(controller: _itemCatCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'نوع الغرض')),
                const SizedBox(height: 10),
                TextField(
                  controller: _parcelFeeCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'رسوم التوصيل المقترحة (اختياري - ج.م)',
                    hintText: 'مثال: 25 أو ٢٥',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  value: _nearbyCaptains.any((c) => c['id']?.toString() == _parcelCaptainId) ? _parcelCaptainId : null,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    labelText: 'توجيه الطرد لطيار محدد (اختياري)',
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('إسناد ذكي لأقرب طيار متاح', style: TextStyle(fontSize: 12)),
                    ),
                    ..._nearbyCaptains.map((c) => DropdownMenuItem<String?>(
                          value: c['id']?.toString(),
                          child: Text(
                            '${c['full_name']} (${c['distance_km']} كم)',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12),
                          ),
                        )),
                  ],
                  onChanged: (val) => setState(() => _parcelCaptainId = val),
                ),
                CheckboxListTile(
                  value: _prohibitedConfirmed,
                  onChanged: (v) => setState(() => _prohibitedConfirmed = v ?? false),
                  title: const Text('أقر بعدم احتواء الطرد على مواد محظورة قانونًا', style: TextStyle(fontSize: 12)),
                  contentPadding: EdgeInsets.zero,
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEA580C), foregroundColor: Colors.white, minimumSize: const Size.fromHeight(46)),
                  onPressed: _submitParcel,
                  child: const Text('إرسال الطرد وتوليد رمز OTP'),
                ),
                if (_lastOtp != null) ...[
                  const SizedBox(height: 10),
                  Text('رمز التسليم OTP الخاص بالمستلم: $_lastOtp', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0D9488))),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _submitParcel() async {
    try {
      final parsedFee = parseLocalizedNumber(_parcelFeeCtrl.text);
      final res = await widget.api.requestParcel({
        'sender_name': widget.customerName,
        if (widget.customerPhone.isNotEmpty) 'sender_phone': widget.customerPhone,
        'receiver_phone': _receiverPhoneCtrl.text,
        'pickup_address': _pickupCtrl.text,
        'dropoff_address': _parcelDropoffCtrl.text,
        'zone_id': widget.selectedZoneId,
        'item_category': _itemCatCtrl.text,
        'size_tier': 'small',
        'required_vehicle_type': 'moto',
        'prohibited_confirmed': _prohibitedConfirmed,
        if (parsedFee != null && parsedFee > 0) 'customer_proposed_fee': parsedFee,
        if (_parcelCaptainId != null) 'preferred_captain_id': _parcelCaptainId,
      });
      setState(() => _lastOtp = '${res['delivery_otp']} (${res['delivery_number']})');
      await widget.onRefresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _submitRide() async {
    if (_dropoffCtrl.text.trim().isEmpty && _dropoffPoint == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اكتب مكان التوصيل أو حدده على الـ GPS')));
      return;
    }
    final proposedFare = parseLocalizedNumber(_proposedFareCtrl.text);
    if (proposedFare == null || proposedFare <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('يرجى كتابة السعر الذي تعرضه للمشوار بالجنيه')));
      return;
    }
    setState(() => _bookingRide = true);
    try {
      final res = await widget.api.requestRide({
        'customer_name': widget.customerName,
        if (widget.customerPhone.isNotEmpty) 'customer_phone': widget.customerPhone,
        'vehicle_type': _vehicle,
        'pickup_address': _pickupCtrl.text.trim(),
        'pickup_lat': _pickupPoint.latitude,
        'pickup_lng': _pickupPoint.longitude,
        'dropoff_address': _dropoffCtrl.text.trim(),
        'dropoff_lat': _dropoffPoint?.latitude,
        'dropoff_lng': _dropoffPoint?.longitude,
        'distance_km': _distanceKm,
        'customer_proposed_fare': proposedFare,
        if (_selectedCaptainId != null) 'preferred_captain_id': _selectedCaptainId,
      });
      _pendingTripId = res['id']?.toString();
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم نشر مشوار ${res['trip_number']} بعرض ${res['fare']} ج.م — سيفتح الشات فور القبول')),
        );
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _bookingRide = false);
    }
  }
}
