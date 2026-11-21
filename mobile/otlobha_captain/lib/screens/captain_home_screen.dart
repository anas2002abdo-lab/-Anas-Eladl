import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
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
  final Map<String, TextEditingController> _otpCtrls = {};
  final Set<String> _dismissedTripIds = {};
  bool _updatingGps = false;
  String? _acceptingTripId;

  @override
  void dispose() {
    for (final c in _otpCtrls.values) {
      c.dispose();
    }
    super.dispose();
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
            const SnackBar(content: Text('يرجى السماح بصلاحية الموقع GPS للطيار')),
          );
        }
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      await widget.api.updateCaptainLocation(capId, pos.latitude, pos.longitude);
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال موقعك GPS المباشر للعملاء ✓')),
        );
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _updatingGps = false);
    }
  }

  Future<void> _acceptRide(Map<String, dynamic> trip) async {
    final capId = widget.captain['id'].toString();
    final tripId = trip['id'].toString();
    setState(() => _acceptingTripId = tripId);
    try {
      await widget.api.updateTripStatus(capId, tripId, 'captain_accepted');
      await widget.onRefresh();
      if (mounted) await _openTripChat(tripId);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _acceptingTripId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cap = widget.captain;
    final capId = cap['id'].toString();
    final capOrders = widget.orders
        .where((o) => o['captain_id'] == capId || o['status'] == 'ready_for_pickup')
        .toList();
    final openOrders = capOrders.where((o) => o['status'] != 'delivered' && o['status'] != 'cancelled').toList();
    final completedOrders = capOrders.where((o) => o['status'] == 'delivered').toList();
    final activeParcels = widget.parcels.where((p) => p['status'] != 'delivered').toList();
    final searchingTrips = widget.trips.where((t) {
      if (t['status'] != 'searching') return false;
      final tid = t['id']?.toString() ?? '';
      if (_dismissedTripIds.contains(tid)) return false;
      final prefCap = t['preferred_captain_id']?.toString();
      if (prefCap != null && prefCap.isNotEmpty) {
        return prefCap == capId;
      }
      return t['vehicle_type'] == cap['vehicle_type'] || cap['is_eligible_for_rides'] == true;
    }).toList();
    final myActiveTrips = widget.trips
        .where((t) => t['captain_id'] == capId && t['status'] != 'completed' && t['status'] != 'cancelled')
        .toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text('${cap['full_name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(8)),
                      child: Text('★ ${cap['rating_avg'] ?? 5}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFB45309))),
                    ),
                  ],
                ),
                Text('${cap['vehicle_model']} · ${cap['plate_number']}', style: const TextStyle(fontSize: 12, color: Colors.black54)),
                const SizedBox(height: 6),
                Text(
                  'GPS: ${((cap['lat'] ?? 31.1583) as num).toDouble().toStringAsFixed(4)}, ${((cap['lng'] ?? 31.9369) as num).toDouble().toStringAsFixed(4)}'
                  '${((cap['total_penalties'] ?? 0) as num) > 0 ? ' · خصومات الإلغاء: ${cap['total_penalties']} ج.م' : ''}',
                  style: const TextStyle(fontSize: 11, color: Color(0xFF4F46E5), fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 10),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: cap['availability_status'] == 'available' ? const Color(0xFF0D9488) : const Color(0xFF0F172A),
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  onPressed: () async {
                    final next = cap['availability_status'] == 'available' ? 'offline' : 'available';
                    try {
                      await widget.api.setAvailability(capId, next);
                      if (next == 'available') {
                        _syncGpsNow();
                      }
                      await widget.onRefresh();
                    } catch (e) {
                      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                    }
                  },
                  child: Text(cap['availability_status'] == 'available' ? 'متاح للعمل الآن (اضغط للإيقاف)' : 'غير متصل (اضغط للبدء)'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _updatingGps ? null : _syncGpsNow,
                  icon: const Icon(Icons.my_location, size: 17),
                  label: Text(_updatingGps ? 'جاري تحديث GPS...' : 'تحديث موقعي GPS الآن'),
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(40)),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
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
                        const Text('مفتوحة الآن', style: TextStyle(fontSize: 11, color: Colors.black54)),
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
                        const Text('الكاش بيدك', style: TextStyle(fontSize: 11, color: Colors.black54)),
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
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('الأوردرات المفتوحة الآن', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            TextButton(
              onPressed: () => widget.onOpenOrdersTab('all'),
              child: const Text('سجل أوردرات اليوم'),
            ),
          ],
        ),
        if (openOrders.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('لا توجد أوردرات مفتوحة حاليًا — راجع أوردرات اليوم من الشريط السفلي.', style: TextStyle(color: Colors.black54)),
            ),
          )
        else
          ...openOrders.map((raw) {
            final o = Map<String, dynamic>.from(raw as Map);
            final hasProof = o['delivery_proof_image_url'] != null && o['delivery_proof_image_url'].toString().isNotEmpty;
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: () {
                  final sections = (o['store_sections'] as List?) ?? [];
                  final isMulti = sections.length > 1;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Row(
                              children: [
                                Text('${o['order_number']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                                if (isMulti) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFFFBEB),
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: const Color(0xFFF59E0B)),
                                    ),
                                    child: Text(
                                      'مهمة مجمعة (${sections.length} متاجر)',
                                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFFB45309)),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Text('${o['total_amount']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text('${o['customer_name']} - ${o['address_landmark']}', style: const TextStyle(fontSize: 12)),
                      const SizedBox(height: 6),
                      if (sections.isNotEmpty) ...[
                        ...sections.map((sec) {
                          final s = Map<String, dynamic>.from(sec as Map);
                          final isPicked = s['captain_picked_up_at'] != null || s['prep_status'] == 'on_the_way' || s['prep_status'] == 'delivered';
                          final isReady = s['prep_status'] == 'ready_for_pickup';
                          return Container(
                            margin: const EdgeInsets.only(top: 3),
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: isPicked ? const Color(0xFFECFDF5) : const Color(0xFFF8FAFC),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: isPicked ? const Color(0xFFA7F3D0) : const Color(0xFFE2E8F0)),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  isPicked ? Icons.check_circle_rounded : (isReady ? Icons.storefront : Icons.hourglass_top_rounded),
                                  size: 13,
                                  color: isPicked ? const Color(0xFF047857) : (isReady ? const Color(0xFFD97706) : const Color(0xFF64748B)),
                                ),
                                const SizedBox(width: 5),
                                Expanded(
                                  child: Text(
                                    'محطة: ${s['merchant_name']} (${isPicked ? 'تم الاستلام' : (isReady ? 'جاهز للاستلام' : 'قيد التجهيز')})',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: isPicked ? const Color(0xFF047857) : const Color(0xFF334155),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          );
                        }),
                        const SizedBox(height: 6),
                      ],
                      Text(
                        hasProof
                            ? 'تم تصوير الأوردر عند منزل العميل ✓'
                            : o['status'] == 'on_the_way'
                                ? 'مطلوب تصوير الأوردر عند منزل العميل في الشات قبل التسليم'
                                : 'الحالة: ${o['status']}',
                        style: TextStyle(
                          color: hasProof ? const Color(0xFF0D9488) : const Color(0xFFB45309),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () => _openOrderChat(o),
                            icon: const Icon(Icons.chat_bubble_outline, size: 15),
                            label: Text('الشات والتصوير (${o['chat_count'] ?? 0})', style: const TextStyle(fontSize: 12)),
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
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                  await _openOrderChat(o);
                                }
                              }
                            },
                            child: const Text('تم التسليم', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                    ],
                  );
                }(),
              ),
            );
          }),
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
        if (searchingTrips.isNotEmpty || myActiveTrips.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('طلبات «اطلبها مشوار» ومشاويرك', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ...myActiveTrips.map((raw) {
            final t = Map<String, dynamic>.from(raw as Map);
            return Card(
              color: const Color(0xFFF0FDFA),
              child: ListTile(
                title: Text('${t['trip_number']} · ${t['customer_name'] ?? 'العميل'}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                subtitle: Text('من: ${t['pickup_address']} ← إلى: ${t['dropoff_address']} · ${t['estimated_fare']} ج.م'),
                trailing: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                  onPressed: () => _openTripChat(t['id'].toString()),
                  icon: const Icon(Icons.chat, size: 15),
                  label: const Text('الشات و GPS', style: TextStyle(fontSize: 11)),
                ),
              ),
            );
          }),
          ...searchingTrips.map((raw) {
            final t = Map<String, dynamic>.from(raw as Map);
            final tid = t['id'].toString();
            final isTargeted = t['preferred_captain_id']?.toString() == capId;
            final fare = t['final_fare'] ?? t['estimated_fare'];
            return Card(
              color: const Color(0xFFFFF7ED),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Wrap(
                            spacing: 6,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text('${t['trip_number']} · مشوار جديد', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                              if (isTargeted)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFFEA580C), borderRadius: BorderRadius.circular(6)),
                                  child: const Text('اختارك العميل ★', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                                ),
                            ],
                          ),
                        ),
                        Text('$fare ج.م (${t['distance_km']} كم)', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFEA580C))),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('من: ${t['pickup_address']} ← إلى: ${t['dropoff_address']}', style: const TextStyle(fontSize: 12)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFFEA580C),
                              foregroundColor: Colors.white,
                              minimumSize: const Size.fromHeight(44),
                            ),
                            onPressed: _acceptingTripId == tid ? null : () => _acceptRide(t),
                            icon: const Icon(Icons.check_circle_outline, size: 17),
                            label: Text(_acceptingTripId == tid ? 'جاري القبول...' : 'قبول المشوار'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 1,
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.red.shade700,
                              side: BorderSide(color: Colors.red.shade300),
                              minimumSize: const Size.fromHeight(44),
                            ),
                            onPressed: _acceptingTripId == tid
                                ? null
                                : () {
                                    setState(() => _dismissedTripIds.add(tid));
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(content: Text('تم رفض المشوار وإخفاؤه من قائمتك')),
                                    );
                                  },
                            icon: const Icon(Icons.close, size: 16),
                            label: const Text('رفض'),
                          ),
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
}
