import 'package:flutter/material.dart';

class OrdersTrackingScreen extends StatelessWidget {
  final Map<String, dynamic> bootstrap;
  final void Function(String orderId)? onOpenOrderChat;

  const OrdersTrackingScreen({super.key, required this.bootstrap, this.onOpenOrderChat});

  String _statusLabel(dynamic s) {
    switch (s?.toString()) {
      case 'pending_merchant':
        return 'بانتظار موافقة المتجر';
      case 'awaiting_quote':
        return 'بانتظار التسعير';
      case 'preparing':
        return 'جارٍ التجهيز بالمتجر';
      case 'ready_for_pickup':
        return 'جاهز وبانتظار الطيار';
      case 'on_the_way':
        return 'في الطريق إليك مع الطيار 🚀';
      case 'delivered':
        return 'تم التسليم بنجاح ✓';
      case 'cancelled':
        return 'ملغي';
      default:
        return s?.toString() ?? 'قيد المتابعة';
    }
  }

  Color _statusColor(dynamic s) {
    switch (s?.toString()) {
      case 'delivered':
        return const Color(0xFF047857);
      case 'on_the_way':
        return const Color(0xFF0284C7);
      case 'ready_for_pickup':
      case 'preparing':
        return const Color(0xFFD97706);
      case 'cancelled':
        return const Color(0xFFDC2626);
      default:
        return const Color(0xFF64748B);
    }
  }

  @override
  Widget build(BuildContext context) {
    final orders = (bootstrap['orders'] as List?) ?? [];
    final parcels = (bootstrap['parcels'] as List?) ?? [];
    final trips = (bootstrap['trips'] as List?) ?? [];
    final wallet = (bootstrap['wallet'] as Map?) ?? {'available_balance': 0};

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
                  style: const TextStyle(color: Color(0xFFF5A623), fontWeight: FontWeight.bold, fontSize: 22),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'طلبات المتاجر والصيدليات',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Color(0xFF0F172A)),
        ),
        const SizedBox(height: 8),
        if (orders.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text('لا توجد طلبات سابقة حتى الآن', style: TextStyle(color: Color(0xFF64748B))),
              ),
            ),
          )
        else
          ...orders.take(12).map((raw) {
            final o = Map<String, dynamic>.from(raw as Map);
            final orderId = (o['id'] ?? '').toString();
            final orderNum = (o['order_number'] ?? orderId).toString();
            final sections = (o['store_sections'] as List?) ?? [];
            final isMulti = sections.length > 1;
            final statusStr = _statusLabel(o['status']);
            final statusClr = _statusColor(o['status']);

            return Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header: Order Number + Multi-store badge + Amount
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Text(
                              '#$orderNum',
                              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFF0F172A)),
                            ),
                            if (isMulti) ...[
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFEF2F2),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: const Color(0xFFA92224).withOpacity(0.3)),
                                ),
                                child: Text(
                                  'طلب مجمع (${sections.length} متاجر)',
                                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFFA92224)),
                                ),
                              ),
                            ],
                          ],
                        ),
                        Text(
                          '${o['total_amount'] ?? o['subtotal'] ?? 0} ج.م',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFFA92224)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // Overall status badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusClr.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        statusStr,
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: statusClr),
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Stores breakdown
                    if (sections.isNotEmpty) ...[
                      const Text(
                        'المتاجر والمنتجات:',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF475569)),
                      ),
                      const SizedBox(height: 4),
                      ...sections.map((secRaw) {
                        final sec = Map<String, dynamic>.from(secRaw as Map);
                        final mName = (sec['merchant_name'] ?? 'متجر').toString();
                        final secStatus = _statusLabel(sec['prep_status']);
                        final secStatusColor = _statusColor(sec['prep_status']);
                        final secItems = (sec['items'] as List?) ?? [];
                        final secItemsSummary = secItems.isNotEmpty
                            ? secItems.map((it) => "${it['name_ar']} × ${it['quantity']}").join(' + ')
                            : (sec['free_order_text'] ?? '');

                        return Container(
                          margin: const EdgeInsets.only(top: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFFF1F5F9)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    '• $mName',
                                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: Color(0xFF1E293B)),
                                  ),
                                  Text(
                                    secStatus,
                                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 10, color: secStatusColor),
                                  ),
                                ],
                              ),
                              if (secItemsSummary.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(
                                  secItemsSummary,
                                  style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ],
                          ),
                        );
                      }),
                    ] else ...[
                      Text(
                        '${o['merchant_name'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: Color(0xFF1E293B)),
                      ),
                      if ((o['free_order_text'] ?? '').toString().isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          '${o['free_order_text']}',
                          style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                        ),
                      ],
                    ],

                    if (onOpenOrderChat != null && o['captain_id'] != null) ...[
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFFA92224),
                            side: const BorderSide(color: Color(0xFFA92224)),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                          ),
                          icon: const Icon(Icons.chat_bubble_outline, size: 14),
                          label: Text('تواصل مع الطيار (${o['captain_name'] ?? 'الكابتن'})', style: const TextStyle(fontSize: 11)),
                          onPressed: () => onOpenOrderChat!(orderId),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          }),
        const SizedBox(height: 14),
        const Text('طرود اطلبها أي حاجة (OTP)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        ...parcels.take(6).map((p) => Card(
              child: ListTile(
                title: Text('${p['delivery_number']} · ${p['item_category']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                subtitle: Text('OTP: ${p['delivery_otp']} · الحالة: ${p['status']}'),
                trailing: Text('${p['delivery_fee']} ج.م'),
              ),
            )),
        if (trips.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Text('رحلات المشاوير', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ...trips.take(5).map((t) => Card(
                child: ListTile(
                  title: Text('${t['trip_number']} · ${t['dropoff_address']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  subtitle: Text('الحالة: ${t['status']}'),
                  trailing: Text('${t['estimated_fare']} ج.م'),
                ),
              )),
        ],
      ],
    );
  }
}
