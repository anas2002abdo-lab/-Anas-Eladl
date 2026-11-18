import 'package:flutter/material.dart';

class OrdersTrackingScreen extends StatelessWidget {
  final Map<String, dynamic> bootstrap;
  final void Function(String orderId)? onOpenOrderChat;

  const OrdersTrackingScreen({super.key, required this.bootstrap, this.onOpenOrderChat});

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
        const SizedBox(height: 16),
        const Text('طلبات المتاجر والصيدليات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 8),
        ...orders.take(8).map((o) => Card(
              child: ListTile(
                title: Text('${o['order_number']} · ${o['merchant_name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                subtitle: Text('${o['free_order_text'] ?? ''}\nالحالة: ${o['status']}'),
                isThreeLine: true,
                trailing: onOpenOrderChat != null && o['captain_id'] != null
                    ? IconButton(
                        icon: const Icon(Icons.chat_bubble_outline, color: Color(0xFFEA580C)),
                        onPressed: () => onOpenOrderChat!(o['id'].toString()),
                      )
                    : Text('${o['total_amount']} ج.م', style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            )),
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
