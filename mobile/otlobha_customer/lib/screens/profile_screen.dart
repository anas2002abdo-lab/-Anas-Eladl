import 'package:flutter/material.dart';

class ProfileScreen extends StatefulWidget {
  final Map<String, dynamic> bootstrap;
  final String customerEmail;
  final String customerName;
  final String customerPhone;
  final String addressLandmark;
  final Future<void> Function(String name, String phone, String address) onSaveProfile;
  final VoidCallback onOpenNotifications;
  final VoidCallback onOpenOffers;
  final void Function(String orderId) onOpenOrderChat;
  final void Function(String tripId) onOpenTripChat;
  final Future<void> Function(Map<String, dynamic> target) onRateCaptain;
  final VoidCallback onLogout;
  final VoidCallback? onOpenFollowedStores;
  final bool isGuest;
  final VoidCallback? onRequireAuth;

  const ProfileScreen({
    super.key,
    required this.bootstrap,
    required this.customerEmail,
    required this.customerName,
    required this.customerPhone,
    required this.addressLandmark,
    required this.onSaveProfile,
    required this.onOpenNotifications,
    required this.onOpenOffers,
    required this.onOpenOrderChat,
    required this.onOpenTripChat,
    required this.onRateCaptain,
    required this.onLogout,
    this.onOpenFollowedStores,
    this.isGuest = false,
    this.onRequireAuth,
  });

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _nameCtrl = TextEditingController(text: widget.customerName);
  late final TextEditingController _phoneCtrl = TextEditingController(text: widget.customerPhone);
  late final TextEditingController _addrCtrl = TextEditingController(text: widget.addressLandmark);
  bool _savingProfile = false;

  @override
  void didUpdateWidget(covariant ProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.customerName != widget.customerName && _nameCtrl.text != widget.customerName) {
      _nameCtrl.text = widget.customerName;
    }
    if (oldWidget.customerPhone != widget.customerPhone && _phoneCtrl.text != widget.customerPhone) {
      _phoneCtrl.text = widget.customerPhone;
    }
    if (oldWidget.addressLandmark != widget.addressLandmark && _addrCtrl.text != widget.addressLandmark) {
      _addrCtrl.text = widget.addressLandmark;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _addrCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final orders = (widget.bootstrap['orders'] as List?) ?? [];
    final parcels = (widget.bootstrap['parcels'] as List?) ?? [];
    final trips = (widget.bootstrap['trips'] as List?) ?? [];
    final pendingRatings = (widget.bootstrap['pending_ratings'] as List?) ?? [];
    final submittedRatings = ((widget.bootstrap['ratings'] as List?) ?? [])
        .where((r) => r['status'] == 'submitted')
        .toList();
    final wallet = (widget.bootstrap['wallet'] as Map?) ?? {'available_balance': 0};

    Map<String, dynamic>? findRating(String refType, String refId) {
      for (final r in submittedRatings) {
        if (r is Map && r['ref_type'] == refType && r['ref_id'] == refId) {
          return Map<String, dynamic>.from(r);
        }
      }
      return null;
    }

    if (widget.isGuest) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  const CircleAvatar(
                    radius: 32,
                    backgroundColor: Color(0xFFFFF7ED),
                    foregroundColor: Color(0xFFA92224),
                    child: Icon(Icons.person_outline, size: 34),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'أنت تتصفح التطبيق كزائر',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFF0F172A)),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'سجّل دخولك أو أنشئ حسابًا جديدًا لإتمام الطلبات، متابعة الشات و GPS مع الطيار، والاستفادة من المحفظة والعروض.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12.5, color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFA92224),
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(48),
                      ),
                      onPressed: widget.onRequireAuth,
                      icon: const Icon(Icons.login),
                      label: const Text('تسجيل الدخول أو إنشاء حساب'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: widget.onOpenOffers,
            icon: const Icon(Icons.local_offer_outlined, size: 18),
            label: const Text('تصفح العروض والكوبونات'),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const CircleAvatar(
                      backgroundColor: Color(0xFF0F172A),
                      foregroundColor: Colors.white,
                      child: Icon(Icons.person),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.customerName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                          Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 6,
                            children: [
                              Text(widget.customerEmail, style: const TextStyle(fontSize: 12, color: Colors.black54)),
                              const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.verified, size: 14, color: Color(0xFF0D9488)),
                                  SizedBox(width: 2),
                                  Text('موثق بالبريد', style: TextStyle(fontSize: 11, color: Color(0xFF0D9488), fontWeight: FontWeight.bold)),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _nameCtrl,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'الاسم'),
                ),
                const SizedBox(height: 8),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextFormField(
                    key: ValueKey(widget.customerEmail),
                    initialValue: widget.customerEmail,
                    readOnly: true,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'البريد الإلكتروني المؤكد'),
                  ),
                ),
                const SizedBox(height: 8),
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: TextField(
                    controller: _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'رقم الهاتف للتوصيل'),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _addrCtrl,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'العنوان في المنزلة'),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                    onPressed: _savingProfile
                        ? null
                        : () async {
                            setState(() => _savingProfile = true);
                            try {
                              await widget.onSaveProfile(
                                _nameCtrl.text.trim(),
                                _phoneCtrl.text.trim(),
                                _addrCtrl.text.trim(),
                              );
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('تم حفظ بيانات الملف الشخصي في حسابك ✓')),
                                );
                              }
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
                                );
                              }
                            } finally {
                              if (mounted) setState(() => _savingProfile = false);
                            }
                          },
                    child: Text(_savingProfile ? 'جاري الحفظ...' : 'حفظ بياناتي'),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade700,
                      side: BorderSide(color: Colors.red.shade200),
                    ),
                    onPressed: widget.onLogout,
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('تسجيل الخروج'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        if (pendingRatings.isNotEmpty) ...[
          Card(
            color: const Color(0xFFFFFBEB),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: Color(0xFFFDE68A)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('عمليات بانتظار تقييمك للطيار ⭐', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5, color: Color(0xFFB45309))),
                  const SizedBox(height: 6),
                  ...pendingRatings.map((pr) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                '${pr['ref_number']} · الطيار: ${pr['captain_name']}',
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            ),
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD97706), foregroundColor: Colors.white),
                              onPressed: () => widget.onRateCaptain({
                                'rating_id': pr['id'],
                                'captain_id': pr['captain_id'],
                                'captain_name': pr['captain_name'],
                                'ref_type': pr['ref_type'],
                                'ref_id': pr['ref_id'],
                                'ref_number': pr['ref_number'],
                                'final_amount': pr['final_amount'],
                              }),
                              icon: const Icon(Icons.star, size: 15),
                              label: const Text('قيّم الآن', style: TextStyle(fontSize: 11)),
                            ),
                          ],
                        ),
                      )),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
        ],
        Card(
          color: const Color(0xFF0F172A),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('محفظة اطلبها', style: TextStyle(color: Colors.white70, fontSize: 12)),
                    SizedBox(height: 4),
                    Text('الرصيد المتاح', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Text(
                  '${wallet['available_balance'] ?? 0} ج.م',
                  style: const TextStyle(color: Color(0xFFFB923C), fontWeight: FontWeight.bold, fontSize: 22),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: widget.onOpenOffers,
                icon: const Icon(Icons.local_offer_outlined, size: 18),
                label: const Text('العروض والكوبونات'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: widget.onOpenNotifications,
                icon: const Icon(Icons.notifications_outlined, size: 18),
                label: const Text('الإشعارات'),
              ),
            ),
          ],
        ),
        if (widget.onOpenFollowedStores != null) ...[
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFA92224),
                side: const BorderSide(color: Color(0xFFFECACA)),
                backgroundColor: const Color(0xFFFEF2F2),
                padding: const EdgeInsets.symmetric(vertical: 11),
              ),
              onPressed: widget.onOpenFollowedStores,
              icon: const Icon(Icons.favorite_rounded, size: 18),
              label: const Text(
                'المتاجر المفضلة والمتابعة وأحدث عروضها',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ],
        const SizedBox(height: 14),
        const Text('طلباتي والروشتات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 6),
        ...orders.take(8).map((o) {
              final hasChat = o['captain_id'] != null || ((o['chat_count'] ?? 0) as num) > 0 || o['status'] == 'on_the_way';
              final hasProof = o['delivery_proof_image_url'] != null && o['delivery_proof_image_url'].toString().isNotEmpty;
              final existingRating = findRating('order', o['id'].toString());
              final canRate = o['status'] == 'delivered' && o['captain_id'] != null && existingRating == null;
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              '${o['order_number']} · ${o['merchant_name']}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                          ),
                          Text('${o['total_amount']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold)),
                        ],
                      ),
                      if ((o['free_order_text']?.toString() ?? '').isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('${o['free_order_text']}', style: const TextStyle(fontSize: 12, color: Colors.black54)),
                        ),
                      const SizedBox(height: 6),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              'الحالة: ${o['status']}${o['captain_name'] != null ? ' · الطيار: ${o['captain_name']}' : ''}${hasProof ? ' · تم التصوير ✓' : ''}',
                              style: const TextStyle(fontSize: 11, color: Color(0xFF0D9488), fontWeight: FontWeight.w600),
                            ),
                          ),
                          if (existingRating != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(8)),
                              child: Text('تم التقييم ★ ${existingRating['rating']}/5', style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: Color(0xFFB45309))),
                            ),
                          if (canRate)
                            Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFD97706),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                                ),
                                onPressed: () => widget.onRateCaptain({
                                  'captain_id': o['captain_id'],
                                  'captain_name': o['captain_name'],
                                  'ref_type': 'order',
                                  'ref_id': o['id'],
                                  'ref_number': o['order_number'],
                                  'final_amount': o['total_amount'],
                                }),
                                icon: const Icon(Icons.star, size: 14),
                                label: const Text('تقييم الطيار', style: TextStyle(fontSize: 10.5)),
                              ),
                            ),
                          if (hasChat)
                            ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFEA580C),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              ),
                              onPressed: () => widget.onOpenOrderChat(o['id'].toString()),
                              icon: const Icon(Icons.chat_bubble_outline, size: 15),
                              label: Text('الشات (${o['chat_count'] ?? 0})', style: const TextStyle(fontSize: 11)),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
        if (parcels.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Text('طرود اطلبها أي حاجة (OTP)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ...parcels.take(5).map((p) {
            final existingRating = findRating('parcel', p['id'].toString());
            final canRate = p['status'] == 'delivered' && p['captain_id'] != null && existingRating == null;
            return Card(
              child: ListTile(
                title: Text('${p['delivery_number']} · ${p['item_category']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                subtitle: Text('OTP: ${p['delivery_otp']} · الحالة: ${p['status']}${p['captain_name'] != null ? ' · ${p['captain_name']}' : ''}'),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${p['delivery_fee']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                    if (existingRating != null)
                      Text('★ ${existingRating['rating']}/5', style: const TextStyle(fontSize: 11, color: Color(0xFFD97706), fontWeight: FontWeight.bold))
                    else if (canRate)
                      InkWell(
                        onTap: () => widget.onRateCaptain({
                          'captain_id': p['captain_id'],
                          'captain_name': p['captain_name'],
                          'ref_type': 'parcel',
                          'ref_id': p['id'],
                          'ref_number': p['delivery_number'],
                          'final_amount': p['delivery_fee'],
                        }),
                        child: const Text('قيّم الطيار ⭐', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFD97706))),
                      ),
                  ],
                ),
              ),
            );
          }),
        ],
        if (trips.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Text('رحلات المشاوير', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ...trips.take(4).map((t) => Card(
                child: ListTile(
                  title: Text('${t['trip_number']} · ${t['dropoff_address']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  subtitle: Text('الحالة: ${t['status']}${t['captain_name'] != null ? ' · ${t['captain_name']}' : ''} · ${t['final_fare'] ?? t['estimated_fare']} ج.م'),
                  trailing: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0D9488),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    ),
                    onPressed: () => widget.onOpenTripChat(t['id'].toString()),
                    icon: const Icon(Icons.chat, size: 14),
                    label: const Text('الشات و GPS', style: TextStyle(fontSize: 11)),
                  ),
                ),
              )),
        ],
      ],
    );
  }
}
