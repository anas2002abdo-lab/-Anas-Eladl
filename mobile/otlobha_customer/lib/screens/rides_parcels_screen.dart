import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
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
  static const Color _primaryRed = Color(0xFFA92224);
  static const Color _darkRed = Color(0xFF86191B);
  static const Color _gold = Color(0xFFF5A623);

  String _tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  String _attribution = '© OpenStreetMap contributors';
  bool _onlinePaymentEnabled = false;

  LatLng _pickupPoint = const LatLng(31.1583, 31.9369);
  LatLng? _dropoffPoint;
  LatLng? _waypointPoint;
  String _mapPickTarget = 'dropoff'; // 'pickup' | 'dropoff' | 'waypoint'
  bool _showWaypoint = false;
  bool _locatingGps = false;
  bool _estimating = false;
  bool _requestingRide = false;

  String _selectedVehicle = 'car';
  String _paymentMethod = 'cash';
  List<Map<String, dynamic>> _vehicleEstimates = [];
  List<LatLng> _routePoints = [];
  List<Map<String, dynamic>> _searchSuggestions = [];
  bool _searchingPlaces = false;
  bool _usingManualDropoff = false;
  Timer? _searchDebounce;

  Map<String, dynamic>? _activeTrip;
  List<Map<String, dynamic>> _rideHistory = [];
  LatLng? _liveDriverPoint;

  final TextEditingController _pickupCtrl = TextEditingController(text: 'موقعي الحالي (GPS)');
  final TextEditingController _dropoffCtrl = TextEditingController();
  final TextEditingController _waypointCtrl = TextEditingController();

  // Parcels (preserved 100%)
  final TextEditingController _parcelDropoffCtrl = TextEditingController(text: 'البصراط - بجوار الوحدة');
  final TextEditingController _receiverPhoneCtrl = TextEditingController(text: '01099887766');
  final TextEditingController _itemCatCtrl = TextEditingController(text: 'مستندات وأوراق');
  final TextEditingController _parcelFeeCtrl = TextEditingController();
  bool _prohibitedConfirmed = true;
  String? _lastOtp;

  final MapController _mapController = MapController();
  WebSocketChannel? _wsChannel;
  StreamSubscription? _wsSub;
  Timer? _reconnectTimer;
  Timer? _pollTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _initRidesData();
    _connectRidesWs();
    _pollTimer = Timer.periodic(const Duration(seconds: 9), (_) => _loadMyRides(silent: true));
  }

  @override
  void dispose() {
    _disposed = true;
    _searchDebounce?.cancel();
    _reconnectTimer?.cancel();
    _pollTimer?.cancel();
    _wsSub?.cancel();
    _wsChannel?.sink.close();
    _pickupCtrl.dispose();
    _dropoffCtrl.dispose();
    _waypointCtrl.dispose();
    _parcelDropoffCtrl.dispose();
    _receiverPhoneCtrl.dispose();
    _itemCatCtrl.dispose();
    _parcelFeeCtrl.dispose();
    super.dispose();
  }

  Future<void> _initRidesData() async {
    try {
      final cfg = await widget.api.getRidesMapConfig();
      if (mounted) {
        setState(() {
          if (cfg['tile_url'] != null && cfg['tile_url'].toString().isNotEmpty) {
            _tileUrl = cfg['tile_url'].toString();
          }
          if (cfg['attribution'] != null && cfg['attribution'].toString().isNotEmpty) {
            _attribution = cfg['attribution'].toString();
          }
          _onlinePaymentEnabled = cfg['online_payment_enabled'] == true;
        });
      }
    } catch (_) {}
    await _loadMyRides(silent: true);
    _detectGps(silent: true);
  }

  Future<void> _loadMyRides({bool silent = false}) async {
    if (!widget.api.hasTokens) return;
    try {
      final res = await widget.api.getMyRides();
      final rawTrips = (res['trips'] as List?) ?? [];
      final trips = rawTrips.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      Map<String, dynamic>? active;
      for (final t in trips) {
        final st = (t['status'] ?? '').toString();
        if (st != 'completed' && st != 'cancelled' && st != 'no_driver' && st != 'expired') {
          active = t;
          break;
        }
      }
      if (!mounted) return;
      setState(() {
        _activeTrip = active;
        _rideHistory = trips.take(10).toList();
        if (active != null) {
          final dLat = (active['captain_lat'] as num?)?.toDouble();
          final dLng = (active['captain_lng'] as num?)?.toDouble();
          if (dLat != null && dLng != null) {
            _liveDriverPoint = LatLng(dLat, dLng);
          }
          _applyRouteGeometry(active['route_geometry_json']);
        } else {
          _liveDriverPoint = null;
        }
      });
    } catch (_) {}
  }

  void _applyRouteGeometry(dynamic geom) {
    if (geom == null) return;
    try {
      final decoded = geom is String ? jsonDecode(geom) : geom;
      if (decoded is List) {
        final pts = <LatLng>[];
        for (final item in decoded) {
          if (item is List && item.length >= 2) {
            pts.add(LatLng((item[0] as num).toDouble(), (item[1] as num).toDouble()));
          } else if (item is Map && item['lat'] != null && item['lng'] != null) {
            pts.add(LatLng((item['lat'] as num).toDouble(), (item['lng'] as num).toDouble()));
          }
        }
        if (pts.length > 1) {
          _routePoints = pts;
        }
      }
    } catch (_) {}
  }

  void _connectRidesWs() {
    if (_disposed || !widget.api.hasTokens) return;
    try {
      _wsChannel = IOWebSocketChannel.connect(widget.api.customerChannelWsUri(), headers: widget.api.wsHeaders);
      _wsSub = _wsChannel!.stream.listen(
        (raw) {
          try {
            final payload = jsonDecode(raw.toString()) as Map<String, dynamic>;
            final type = payload['type']?.toString() ?? '';
            if (type == 'ride:location') {
              final lat = (payload['lat'] as num?)?.toDouble();
              final lng = (payload['lng'] as num?)?.toDouble();
              if (lat != null && lng != null && mounted) {
                setState(() => _liveDriverPoint = LatLng(lat, lng));
              }
            } else if (type.startsWith('trip:') || type.startsWith('ride:')) {
              _loadMyRides(silent: true);
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

  Future<void> _detectGps({bool silent = false}) async {
    if (!silent) setState(() => _locatingGps = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied && !silent) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        if (!silent && mounted) {
          setState(() {
            _locatingGps = false;
            _mapPickTarget = 'pickup';
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('اضغط على الخريطة لتحديد نقطة الانطلاق يدوياً')),
          );
        }
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (!mounted) return;
      final pt = LatLng(pos.latitude, pos.longitude);
      setState(() {
        _pickupPoint = pt;
        _locatingGps = false;
      });
      try {
        _mapController.move(pt, 14.5);
      } catch (_) {}
      try {
        final rev = await widget.api.reverseGeocodeRide(pt.latitude, pt.longitude);
        final addr = rev['display_name']?.toString() ?? rev['address']?.toString() ?? '';
        if (addr.isNotEmpty && mounted) {
          setState(() => _pickupCtrl.text = addr);
        }
      } catch (_) {
        if (mounted) {
          _pickupCtrl.text = 'موقعي (${pt.latitude.toStringAsFixed(4)}, ${pt.longitude.toStringAsFixed(4)})';
        }
      }
      if (_dropoffPoint != null) {
        await _estimateRide();
      }
    } catch (_) {
      if (mounted && !silent) {
        setState(() => _locatingGps = false);
      }
    }
  }

  void _onSearchQueryChanged(String value) {
    _searchDebounce?.cancel();
    if (value.trim().length < 2) {
      setState(() => _searchSuggestions = []);
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 450), () async {
      setState(() => _searchingPlaces = true);
      try {
        final res = await widget.api.searchRidePlaces(
          value.trim(),
          nearLat: _pickupPoint.latitude,
          nearLng: _pickupPoint.longitude,
        );
        final list = (res['items'] as List?) ?? (res['results'] as List?) ?? [];
        if (mounted) {
          setState(() {
            _searchSuggestions = list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
          });
        }
      } catch (_) {
        if (mounted) setState(() => _searchSuggestions = []);
      } finally {
        if (mounted) setState(() => _searchingPlaces = false);
      }
    });
  }

  Future<void> _selectSuggestion(Map<String, dynamic> place) async {
    final lat = (place['lat'] as num?)?.toDouble();
    final lng = (place['lng'] as num?)?.toDouble();
    final label = place['display_name']?.toString() ?? place['name']?.toString() ?? '';
    if (lat == null || lng == null) return;
    final pt = LatLng(lat, lng);
    setState(() {
      _searchSuggestions = [];
      if (_mapPickTarget == 'pickup') {
        _pickupPoint = pt;
        _pickupCtrl.text = label;
      } else if (_mapPickTarget == 'waypoint') {
        _waypointPoint = pt;
        _waypointCtrl.text = label;
      } else {
        _dropoffPoint = pt;
        _usingManualDropoff = false;
        _dropoffCtrl.text = label;
      }
    });
    try {
      _mapController.move(pt, 14.0);
    } catch (_) {}
    if (_dropoffPoint != null || _usingManualDropoff) {
      await _estimateRide();
    }
  }

  Future<void> _useTypedDropoffAddress() async {
    final text = _dropoffCtrl.text.trim();
    if (text.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اكتب اسم الوجهة أولاً (حرفين على الأقل)')),
      );
      return;
    }
    setState(() {
      _dropoffPoint = null;
      _usingManualDropoff = true;
      _searchSuggestions = [];
      _routePoints = [];
    });
    await _estimateRide();
  }

  Future<void> _estimateRide() async {
    final typedAddr = _dropoffCtrl.text.trim();
    if (_dropoffPoint == null && (!_usingManualDropoff || typedAddr.length < 2)) return;
    setState(() => _estimating = true);
    try {
      final res = await widget.api.estimateRide(
        pickupLat: _pickupPoint.latitude,
        pickupLng: _pickupPoint.longitude,
        dropoffLat: _dropoffPoint?.latitude,
        dropoffLng: _dropoffPoint?.longitude,
        dropoffAddress: typedAddr.isNotEmpty ? typedAddr : null,
        waypointLat: _showWaypoint && _waypointPoint != null ? _waypointPoint!.latitude : null,
        waypointLng: _showWaypoint && _waypointPoint != null ? _waypointPoint!.longitude : null,
        zoneId: widget.selectedZoneId,
      );
      final vehicles = ((res['options'] as List?) ?? (res['vehicles'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!mounted) return;
      setState(() {
        _vehicleEstimates = vehicles;
        if (vehicles.isNotEmpty && !vehicles.any((v) => v['code'] == _selectedVehicle)) {
          _selectedVehicle = vehicles.first['code'].toString();
        }
        final activeVeh = vehicles.firstWhere(
          (v) => v['code'] == _selectedVehicle,
          orElse: () => vehicles.isNotEmpty ? vehicles.first : <String, dynamic>{},
        );
        final pts = activeVeh['route_points'] ?? activeVeh['route_geometry'] ?? res['route_geometry'];
        if (pts != null && pts is List && pts.isNotEmpty) {
          _applyRouteGeometry(pts);
        } else {
          _routePoints = [];
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _estimating = false);
    }
  }

  Map<String, dynamic>? get _selectedVehicleData {
    for (final v in _vehicleEstimates) {
      if (v['code'] == _selectedVehicle) return v;
    }
    return _vehicleEstimates.isNotEmpty ? _vehicleEstimates.first : null;
  }

  Future<void> _showConfirmSheet() async {
    final veh = _selectedVehicleData;
    final hasValidDropoff = _dropoffPoint != null || (_usingManualDropoff && _dropoffCtrl.text.trim().length >= 2);
    if (veh == null || !hasValidDropoff) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اكتب اسم الوجهة أو حددها على الخريطة أولاً')),
      );
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 18,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('مراجعة وتأكيد طلب الرحلة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  _confirmRow('الانطلاق', _pickupCtrl.text.trim().isEmpty ? 'موقعك الحالي' : _pickupCtrl.text.trim()),
                  if (_showWaypoint && _waypointPoint != null)
                    _confirmRow('نقطة توقف وسيطة', _waypointCtrl.text.trim().isEmpty ? 'نقطة وسيطة' : _waypointCtrl.text.trim()),
                  _confirmRow('الوجهة', _dropoffCtrl.text.trim().isEmpty ? 'الوجهة المحددة' : _dropoffCtrl.text.trim()),
                  _confirmRow('نوع المركبة', '${veh['name_ar']} (${veh['max_passengers'] ?? 1} ركاب)'),
                  _confirmRow(
                    'مسافة الطريق والوقت',
                    veh['unmapped_destination'] == true
                        ? 'وجهة مكتوبة يدوياً بدون نقطة على الخريطة'
                        : '${veh['distance_km']} كم · ~${veh['duration_min']} دقيقة',
                  ),
                  _confirmRow('الأجرة المعتمدة (ثابتة)', '${(veh['fare'] is Map ? (veh['fare']['total_fare'] ?? veh['fare']['estimated_fare']) : veh['estimated_fare'])} ج.م'),
                  const SizedBox(height: 10),
                  const Text('وسيلة الدفع', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: ChoiceChip(
                          label: const Center(child: Text('نقداً للسائق')),
                          selected: _paymentMethod == 'cash',
                          onSelected: (_) {
                            setModalState(() => _paymentMethod = 'cash');
                            setState(() => _paymentMethod = 'cash');
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ChoiceChip(
                          label: Center(
                            child: Text(_onlinePaymentEnabled ? 'دفع إلكتروني' : 'إلكتروني (غير مفعل)'),
                          ),
                          selected: _paymentMethod == 'online',
                          onSelected: _onlinePaymentEnabled
                              ? (_) {
                                  setModalState(() => _paymentMethod = 'online');
                                  setState(() => _paymentMethod = 'online');
                                }
                              : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _primaryRed,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    onPressed: _requestingRide
                        ? null
                        : () async {
                            Navigator.pop(ctx);
                            await _confirmAndCreateRide();
                          },
                    child: Text(_requestingRide ? 'جاري إنشاء الرحلة...' : 'تأكيد الرحلة والبحث عن سائق'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _confirmRow(String k, String v) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text('$k:', style: const TextStyle(fontSize: 12, color: Colors.black54)),
          ),
          Expanded(
            child: Text(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmAndCreateRide() async {
    final dropText = _dropoffCtrl.text.trim();
    if (_dropoffPoint == null && (!_usingManualDropoff || dropText.length < 2)) return;
    setState(() => _requestingRide = true);
    try {
      final res = await widget.api.requestRideV2({
        'vehicle_type': _selectedVehicle,
        'pickup_address': _pickupCtrl.text.trim().isEmpty ? 'موقعي الحالي' : _pickupCtrl.text.trim(),
        'pickup_lat': _pickupPoint.latitude,
        'pickup_lng': _pickupPoint.longitude,
        'dropoff_address': dropText.isEmpty ? 'الوجهة المحددة' : dropText,
        if (_dropoffPoint != null) ...{
          'dropoff_lat': _dropoffPoint!.latitude,
          'dropoff_lng': _dropoffPoint!.longitude,
        },
        if (_showWaypoint && _waypointPoint != null) ...{
          'waypoint_lat': _waypointPoint!.latitude,
          'waypoint_lng': _waypointPoint!.longitude,
          'waypoint_address': _waypointCtrl.text.trim(),
        },
        'zone_id': widget.selectedZoneId,
        'payment_method': _paymentMethod,
      });
      await _loadMyRides(silent: true);
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تم إنشاء الرحلة ${res['trip']?['trip_number'] ?? ''} وجاري البحث عن أقرب سائق')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _requestingRide = false);
    }
  }

  Future<void> _showRatingDialog(Map<String, dynamic> trip) async {
    int stars = 5;
    final commentCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) => AlertDialog(
          title: const Text('تقييم السائق والرحلة'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  final idx = i + 1;
                  return IconButton(
                    icon: Icon(
                      idx <= stars ? Icons.star : Icons.star_border,
                      color: _gold,
                      size: 30,
                    ),
                    onPressed: () => setDlg(() => stars = idx),
                  );
                }),
              ),
              TextField(
                controller: commentCtrl,
                maxLines: 2,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  hintText: 'اكتب ملاحظتك عن السائق والرحلة (اختياري)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('لاحقاً')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: _primaryRed, foregroundColor: Colors.white),
              onPressed: () async {
                Navigator.pop(ctx);
                try {
                  await widget.api.rateRideV2(
                    trip['id'].toString(),
                    stars: stars,
                    comment: commentCtrl.text.trim(),
                  );
                  await _loadMyRides(silent: true);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('شكراً لتقييمك!')));
                  }
                } catch (e) {
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                }
              },
              child: const Text('إرسال التقييم'),
            ),
          ],
        ),
      ),
    );
    commentCtrl.dispose();
  }

  Future<void> _showDisputeDialog(String tripId) async {
    String cat = 'fare';
    final descCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) => AlertDialog(
          title: const Text('الإبلاغ عن مشكلة أو شكوى'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: cat,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'نوع الشكوى'),
                items: const [
                  DropdownMenuItem(value: 'fare', child: Text('اختلاف في الأجرة')),
                  DropdownMenuItem(value: 'safety', child: Text('سلامة أو طوارئ')),
                  DropdownMenuItem(value: 'behavior', child: Text('سلوك السائق')),
                  DropdownMenuItem(value: 'route', child: Text('مشكلة في المسار')),
                  DropdownMenuItem(value: 'other', child: Text('أخرى')),
                ],
                onChanged: (v) => setDlg(() => cat = v ?? 'fare'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: descCtrl,
                maxLines: 3,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'اشرح المشكلة بالتفصيل...'),
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
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('تم تسجيل البلاغ وإرساله لإدارة المشاوير')),
                    );
                  }
                } catch (e) {
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                }
              },
              child: const Text('إرسال البلاغ'),
            ),
          ],
        ),
      ),
    );
    descCtrl.dispose();
  }

  String _statusAr(String st) {
    switch (st) {
      case 'searching':
        return 'جاري البحث عن أقرب سائق معتمد...';
      case 'offered':
        return 'تم عرض رحلتك على أقرب سائق...';
      case 'accepted':
        return 'قبل السائق طلبك وهو في طريقه إليك';
      case 'arrived':
        return 'وصل السائق — أعطه رمز بدء الرحلة';
      case 'in_progress':
        return 'الرحلة جارية نحو وجهتك';
      case 'completed':
        return 'اكتملت الرحلة';
      case 'cancelled':
        return 'تم إلغاء الرحلة';
      case 'no_driver':
        return 'لم يتم العثور على سائق متاح حالياً';
      default:
        return st;
    }
  }

  @override
  Widget build(BuildContext context) {
    final mapMarkers = <Marker>[
      Marker(
        point: _pickupPoint,
        width: 90,
        height: 34,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: const Color(0xFF059669),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Center(
            child: Text('الانطلاق', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
        ),
      ),
      if (_showWaypoint && _waypointPoint != null)
        Marker(
          point: _waypointPoint!,
          width: 84,
          height: 34,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF4F46E5),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: const Center(
              child: Text('توقف', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
      if (_dropoffPoint != null)
        Marker(
          point: _dropoffPoint!,
          width: 84,
          height: 34,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: _primaryRed,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white, width: 2),
            ),
            child: const Center(
              child: Text('الوجهة', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
      if (_liveDriverPoint != null)
        Marker(
          point: _liveDriverPoint!,
          width: 96,
          height: 36,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: _gold, width: 2),
            ),
            child: const Center(
              child: Text('الكابتن الآن', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
    ];

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // Header banner
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [_primaryRed, _darkRed]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('مشاوير اطلبها', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
                  SizedBox(height: 2),
                  Text('تسعير حقيقي بمسار الطريق + تتبع مباشر', style: TextStyle(color: Colors.white70, fontSize: 11.5)),
                ],
              ),
              IconButton(
                onPressed: _locatingGps ? null : () => _detectGps(),
                icon: Icon(Icons.my_location, color: _locatingGps ? Colors.white38 : _gold),
                tooltip: 'تحديد موقعي الحالي',
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),

        // Interactive OpenStreetMap
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            height: 260,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: _pickupPoint,
                    initialZoom: 13.8,
                    onTap: (_, latLng) async {
                      setState(() {
                        if (_mapPickTarget == 'pickup') {
                          _pickupPoint = latLng;
                          _pickupCtrl.text = 'نقطة انطلاق (${latLng.latitude.toStringAsFixed(4)}, ${latLng.longitude.toStringAsFixed(4)})';
                        } else if (_mapPickTarget == 'waypoint') {
                          _waypointPoint = latLng;
                          _waypointCtrl.text = 'توقف (${latLng.latitude.toStringAsFixed(4)}, ${latLng.longitude.toStringAsFixed(4)})';
                        } else {
                          _dropoffPoint = latLng;
                          _dropoffCtrl.text = 'وجهة (${latLng.latitude.toStringAsFixed(4)}, ${latLng.longitude.toStringAsFixed(4)})';
                        }
                      });
                      try {
                        final rev = await widget.api.reverseGeocodeRide(latLng.latitude, latLng.longitude);
                        final addr = rev['display_name']?.toString() ?? rev['address']?.toString() ?? '';
                        if (addr.isNotEmpty && mounted) {
                          setState(() {
                            if (_mapPickTarget == 'pickup') {
                              _pickupCtrl.text = addr;
                            } else if (_mapPickTarget == 'waypoint') {
                              _waypointCtrl.text = addr;
                            } else {
                              _dropoffCtrl.text = addr;
                            }
                          });
                        }
                      } catch (_) {}
                      if (_dropoffPoint != null) {
                        await _estimateRide();
                      }
                    },
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: _tileUrl,
                      userAgentPackageName: 'com.otlobha.customer',
                    ),
                    if (_routePoints.length > 1)
                      PolylineLayer(
                        polylines: [
                          Polyline(points: _routePoints, color: _primaryRed, strokeWidth: 4.5),
                        ],
                      )
                    else if (_dropoffPoint != null)
                      PolylineLayer(
                        polylines: [
                          Polyline(points: [_pickupPoint, _dropoffPoint!], color: _primaryRed, strokeWidth: 3.5),
                        ],
                      ),
                    MarkerLayer(markers: mapMarkers),
                  ],
                ),
                Positioned(
                  left: 8,
                  bottom: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.88),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(_attribution, style: const TextStyle(fontSize: 9.5, color: Colors.black87)),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),

        // Active Ride Card (if customer has ongoing ride)
        if (_activeTrip != null) _buildActiveTripCard(_activeTrip!) else _buildBookingCard(),

        // Completed / Recent Ride History
        if (_rideHistory.any((t) => t['status'] == 'completed')) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('سجل رحلاتك الأخيرة', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 8),
                  ..._rideHistory.where((t) => t['status'] == 'completed').take(5).map((t) {
                    final rated = t['customer_rating'] != null;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('${t['trip_number']} · ${t['dropoff_address'] ?? ''}',
                          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                      subtitle: Text('الأجرة: ${t['final_fare'] ?? t['estimated_fare']} ج.م · ${t['captain_name'] ?? ''}',
                          style: const TextStyle(fontSize: 11.5)),
                      trailing: Wrap(
                        spacing: 4,
                        children: [
                          if (!rated)
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(backgroundColor: _gold, foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(horizontal: 10)),
                              onPressed: () => _showRatingDialog(t),
                              child: const Text('قيّم', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                            )
                          else
                            Text('${t['customer_rating']} ★', style: const TextStyle(color: _gold, fontWeight: FontWeight.bold)),
                          IconButton(
                            icon: const Icon(Icons.report_problem_outlined, size: 18, color: Colors.red),
                            onPressed: () => _showDisputeDialog(t['id'].toString()),
                            tooltip: 'شكوى',
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

        // Preserved Parcels (OTP) Service Card
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
                  ),
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

  Widget _buildBookingCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('تحديد الانطلاق', style: TextStyle(fontSize: 11))),
                    selected: _mapPickTarget == 'pickup',
                    onSelected: (_) => setState(() => _mapPickTarget = 'pickup'),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('تحديد الوجهة', style: TextStyle(fontSize: 11))),
                    selected: _mapPickTarget == 'dropoff',
                    onSelected: (_) => setState(() => _mapPickTarget = 'dropoff'),
                  ),
                ),
                const SizedBox(width: 6),
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _showWaypoint = !_showWaypoint;
                      if (_showWaypoint) {
                        _mapPickTarget = 'waypoint';
                      } else {
                        _waypointPoint = null;
                        _waypointCtrl.clear();
                      }
                    });
                  },
                  icon: Icon(_showWaypoint ? Icons.remove_circle_outline : Icons.add_location_alt_outlined, size: 16),
                  label: Text(_showWaypoint ? 'حذف توقف' : 'وجهة وسيطة', style: const TextStyle(fontSize: 11)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _pickupCtrl,
              onTap: () => setState(() => _mapPickTarget = 'pickup'),
              onChanged: (v) {
                _mapPickTarget = 'pickup';
                _onSearchQueryChanged(v);
              },
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                isDense: true,
                labelText: 'موقع الانطلاق',
                prefixIcon: Icon(Icons.trip_origin, color: Color(0xFF059669), size: 18),
              ),
            ),
            if (_showWaypoint) ...[
              const SizedBox(height: 8),
              TextField(
                controller: _waypointCtrl,
                onTap: () => setState(() => _mapPickTarget = 'waypoint'),
                onChanged: (v) {
                  _mapPickTarget = 'waypoint';
                  _onSearchQueryChanged(v);
                },
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  isDense: true,
                  labelText: 'نقطة توقف وسيطة (اختياري)',
                  prefixIcon: Icon(Icons.add_location, color: Color(0xFF4F46E5), size: 18),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _dropoffCtrl,
                    onTap: () => setState(() => _mapPickTarget = 'dropoff'),
                    onChanged: (v) {
                      setState(() {
                        _mapPickTarget = 'dropoff';
                        _usingManualDropoff = false;
                      });
                      _onSearchQueryChanged(v);
                    },
                    onSubmitted: (_) => _useTypedDropoffAddress(),
                    decoration: InputDecoration(
                      border: const OutlineInputBorder(),
                      isDense: true,
                      labelText: 'اكتب اسم الوجهة (حتى لو غير موجودة على الخريطة)',
                      prefixIcon: const Icon(Icons.location_on, color: _primaryRed, size: 18),
                      suffixIcon: _searchingPlaces
                          ? const Padding(
                              padding: EdgeInsets.all(10),
                              child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                            )
                          : null,
                    ),
                  ),
                ),
                if (_dropoffCtrl.text.trim().length >= 2) ...[
                  const SizedBox(width: 6),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _primaryRed,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                    ),
                    onPressed: _useTypedDropoffAddress,
                    child: const Text('اعتماد', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ],
              ],
            ),
            if (_searchSuggestions.isNotEmpty || (_mapPickTarget == 'dropoff' && _dropoffCtrl.text.trim().length >= 2 && !_usingManualDropoff && _dropoffPoint == null)) ...[
              const SizedBox(height: 6),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(10),
                  color: Colors.white,
                ),
                child: Column(
                  children: [
                    ..._searchSuggestions.take(7).map((s) {
                      final src = s['source']?.toString() ?? '';
                      return ListTile(
                        dense: true,
                        leading: const Icon(Icons.place_outlined, size: 18, color: _primaryRed),
                        title: Text(
                          s['short_name']?.toString() ?? s['display_name']?.toString() ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                        subtitle: Text(
                          s['address_line']?.toString() ?? s['display_name']?.toString() ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 10.5, color: Colors.black54),
                        ),
                        trailing: src == 'local_landmark' || src == 'otlobha_place'
                            ? Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: src == 'local_landmark' ? const Color(0xFFECFDF5) : const Color(0xFFFFFBEB),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  src == 'local_landmark' ? 'معلم محلي' : 'اطلبها',
                                  style: TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.bold,
                                    color: src == 'local_landmark' ? const Color(0xFF047857) : const Color(0xFFB45309),
                                  ),
                                ),
                              )
                            : null,
                        onTap: () => _selectSuggestion(s),
                      );
                    }),
                    if (_mapPickTarget == 'dropoff' && _dropoffCtrl.text.trim().length >= 2)
                      ListTile(
                        dense: true,
                        tileColor: const Color(0xFFFFFBEB),
                        leading: const Icon(Icons.edit_location_alt, size: 18, color: _primaryRed),
                        title: Text(
                          'استخدام العنوان كما كُتب: «${_dropoffCtrl.text.trim()}»',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: _primaryRed),
                        ),
                        subtitle: const Text(
                          'اطلب المشوار مباشرة حتى لو المكان غير موجود على الخريطة',
                          style: TextStyle(fontSize: 10.5, color: Colors.black54),
                        ),
                        onTap: _useTypedDropoffAddress,
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),

            if (_estimating)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator(color: _primaryRed)),
              )
            else if (_vehicleEstimates.isNotEmpty) ...[
              const Text('اختر نوع المركبة (التسعير حسب مسافة الطريق الفعلية)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              const SizedBox(height: 8),
              ..._vehicleEstimates.map((v) {
                final code = v['code'].toString();
                final selected = code == _selectedVehicle;
                return InkWell(
                  onTap: () {
                    setState(() {
                      _selectedVehicle = code;
                      final pts = v['route_points'] ?? v['route_geometry'];
                      if (pts != null) {
                        _applyRouteGeometry(pts);
                      }
                    });
                  },
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: selected ? const Color(0xFFFEF2F2) : Colors.grey.shade50,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: selected ? _primaryRed : Colors.grey.shade300, width: selected ? 2 : 1),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          code == 'car'
                              ? Icons.directions_car
                              : code == 'moto'
                                  ? Icons.two_wheeler
                                  : Icons.electric_rickshaw,
                          color: selected ? _primaryRed : Colors.black87,
                          size: 28,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${v['name_ar']} · ${v['max_passengers'] ?? 1} ركاب', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
                              Text(
                                v['unmapped_destination'] == true
                                    ? 'وصول السائق ~${v['driver_eta_min'] ?? 4} د · وجهة مكتوبة يدوياً'
                                    : 'وصول السائق ~${v['driver_eta_min'] ?? 4} د · الرحلة ${v['duration_min']} د · ${v['distance_km']} كم',
                                style: const TextStyle(fontSize: 11, color: Colors.black54),
                              ),
                              if (v['warnings'] is List && (v['warnings'] as List).isNotEmpty)
                                Text((v['warnings'] as List).first.toString(), style: const TextStyle(fontSize: 10.5, color: Color(0xFFB45309))),
                            ],
                          ),
                        ),
                        Text(
                          '${(v['fare'] is Map ? (v['fare']['total_fare'] ?? v['fare']['estimated_fare']) : v['estimated_fare'])} ج.م',
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: _primaryRed),
                        ),
                      ],
                    ),
                  ),
                );
              }),
              const SizedBox(height: 6),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _primaryRed,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(48),
                ),
                onPressed: _showConfirmSheet,
                child: const Text('مراجعة وتأكيد الرحلة', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ] else
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(10)),
                child: const Text(
                  'اختر وجهتك من البحث أو بالضغط على الخريطة لعرض أنواع المركبات المتاحة والأجرة التقديرية.',
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveTripCard(Map<String, dynamic> trip) {
    final st = (trip['status'] ?? '').toString();
    final otp = (trip['start_otp'] ?? trip['start_otp_display'])?.toString();
    final capPhone = trip['captain_phone']?.toString() ?? '';
    final shareToken = trip['share_token']?.toString() ?? '';
    return Card(
      color: const Color(0xFFFFFBEB),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _primaryRed, width: 1.5),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${trip['trip_number']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                Text('${trip['final_fare'] ?? trip['estimated_fare']} ج.م',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: _primaryRed)),
              ],
            ),
            const SizedBox(height: 6),
            Text(_statusAr(st), style: const TextStyle(fontWeight: FontWeight.bold, color: _darkRed, fontSize: 13)),
            const SizedBox(height: 8),
            if (trip['captain_name'] != null) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Row(
                  children: [
                    const CircleAvatar(backgroundColor: _primaryRed, child: Icon(Icons.person, color: Colors.white)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${trip['captain_name']} · ★ ${trip['captain_rating'] ?? 5.0}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                          Text(
                            '${trip['vehicle_model'] ?? ''} · ${trip['vehicle_color'] ?? ''} · لوحة: ${trip['plate_number'] ?? ''}',
                            style: const TextStyle(fontSize: 11.5, color: Colors.black54),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (otp != null && otp.isNotEmpty && (st == 'accepted' || st == 'arrived')) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    const Text('رمز بدء الرحلة (أعطه للسائق عند الركوب فقط)', style: TextStyle(color: Colors.white70, fontSize: 11)),
                    const SizedBox(height: 4),
                    Text(otp, style: const TextStyle(color: _gold, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 8)),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (capPhone.isNotEmpty)
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF059669), foregroundColor: Colors.white),
                    onPressed: () async {
                      final uri = Uri(scheme: 'tel', path: capPhone);
                      if (await canLaunchUrl(uri)) await launchUrl(uri);
                    },
                    icon: const Icon(Icons.call, size: 15),
                    label: const Text('اتصال', style: TextStyle(fontSize: 12)),
                  ),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                  onPressed: () => widget.onOpenTripChat(trip['id'].toString()),
                  icon: const Icon(Icons.chat, size: 15),
                  label: const Text('محادثة', style: TextStyle(fontSize: 12)),
                ),
                if (shareToken.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () {
                      final url = '${OtlobhaCustomerApi.normalizeBaseUrl(OtlobhaCustomerApi.baseUrl)}/api/rides/share/$shareToken';
                      Clipboard.setData(ClipboardData(text: url));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('تم نسخ رابط مشاركة الرحلة المباشرة')),
                      );
                    },
                    icon: const Icon(Icons.share, size: 15),
                    label: const Text('مشاركة', style: TextStyle(fontSize: 12)),
                  ),
                OutlinedButton.icon(
                  onPressed: () => _showDisputeDialog(trip['id'].toString()),
                  icon: const Icon(Icons.warning_amber, size: 15, color: Colors.orange),
                  label: const Text('إبلاغ', style: TextStyle(fontSize: 12)),
                ),
                if (st == 'searching' || st == 'offered' || st == 'accepted' || st == 'arrived')
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                    onPressed: () async {
                      try {
                        await widget.api.cancelRideV2(trip['id'].toString());
                        await _loadMyRides(silent: true);
                        await widget.onRefresh();
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إلغاء الرحلة')));
                        }
                      } catch (e) {
                        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                      }
                    },
                    icon: const Icon(Icons.close, size: 15),
                    label: const Text('إلغاء الرحلة', style: TextStyle(fontSize: 12)),
                  ),
              ],
            ),
          ],
        ),
      ),
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
      });
      setState(() => _lastOtp = '${res['delivery_otp']} (${res['delivery_number']})');
      await widget.onRefresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }
}
