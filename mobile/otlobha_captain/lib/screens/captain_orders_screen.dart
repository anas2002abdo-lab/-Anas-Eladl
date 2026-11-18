import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'captain_order_chat_screen.dart';

class CaptainOrdersScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final Map<String, dynamic> captain;
  final List<dynamic> orders;
  final Future<void> Function() onRefresh;
  final String initialFilter;

  const CaptainOrdersScreen({
    super.key,
    required this.api,
    required this.captain,
    required this.orders,
    required this.onRefresh,
    this.initialFilter = 'all',
  });

  @override
  State<CaptainOrdersScreen> createState() => _CaptainOrdersScreenState();
}

class _CaptainOrdersScreenState extends State<CaptainOrdersScreen> {
  late String _filter = widget.initialFilter;

  @override
  void didUpdateWidget(covariant CaptainOrdersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialFilter != widget.initialFilter) {
      _filter = widget.initialFilter;
    }
  }

  Future<void> _openChat(Map<String, dynamic> order) async {
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

  @override
  Widget build(BuildContext context) {
    final capId = widget.captain['id'].toString();
    final capOrders = widget.orders
        .where((o) => o['captain_id'] == capId || o['status'] == 'ready_for_pickup')
        .toList();

    final openOrders = capOrders.where((o) => o['status'] != 'delivered' && o['status'] != 'cancelled').toList();
    final completedOrders = capOrders.where((o) => o['status'] == 'delivered').toList();
    final todayIso = DateTime.now().toIso8601String().substring(0, 10);
    final completedToday = completedOrders
        .where((o) => (o['created_at']?.toString() ?? '').startsWith(todayIso))
        .toList();
    final displayedCompleted = completedToday.isNotEmpty ? completedToday : completedOrders;

    final todayTotal = displayedCompleted.fold<double>(
      0,
      (sum, o) => sum + ((o['total_amount'] as num?)?.toDouble() ?? 0),
    );

    final shownOrders = _filter == 'open'
        ? openOrders
        : _filter == 'completed'
            ? displayedCompleted
            : [...openOrders, ...displayedCompleted];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: _SummaryCard(
                label: 'المفتوحة الآن',
                value: '${openOrders.length}',
                color: const Color(0xFFEA580C),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryCard(
                label: 'تمت اليوم',
                value: '${displayedCompleted.length}',
                color: const Color(0xFF0D9488),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryCard(
                label: 'إجمالي اليوم',
                value: '${todayTotal.toStringAsFixed(0)} ج.م',
                color: const Color(0xFF0F172A),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: Text('الكل (${openOrders.length + displayedCompleted.length})'),
              selected: _filter == 'all',
              onSelected: (_) => setState(() => _filter = 'all'),
            ),
            ChoiceChip(
              label: Text('المفتوحة (${openOrders.length})'),
              selected: _filter == 'open',
              onSelected: (_) => setState(() => _filter = 'open'),
            ),
            ChoiceChip(
              label: Text('التي تمت (${displayedCompleted.length})'),
              selected: _filter == 'completed',
              onSelected: (_) => setState(() => _filter = 'completed'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (shownOrders.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: Text('لا توجد أوردرات في هذا التصنيف اليوم')),
            ),
          )
        else
          ...shownOrders.map((raw) {
            final o = Map<String, dynamic>.from(raw as Map);
            final hasProof = o['delivery_proof_image_url'] != null && o['delivery_proof_image_url'].toString().isNotEmpty;
            final isDelivered = o['status'] == 'delivered';
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
                    const SizedBox(height: 4),
                    Text('${o['customer_name']} - ${o['address_landmark']}', style: const TextStyle(fontSize: 12)),
                    const SizedBox(height: 6),
                    Text(
                      hasProof
                          ? 'تم تصوير الأوردر عند منزل العميل ✓'
                          : isDelivered
                              ? 'مكتمل ✓'
                              : o['status'] == 'on_the_way'
                                  ? 'مطلوب تصوير الأوردر عند منزل العميل في الشات قبل التسليم'
                                  : 'الحالة: ${o['status']}',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: hasProof || isDelivered ? const Color(0xFF0D9488) : const Color(0xFFB45309),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        OutlinedButton.icon(
                          onPressed: () => _openChat(o),
                          icon: const Icon(Icons.chat_bubble_outline, size: 15),
                          label: Text('الشات (${o['chat_count'] ?? 0})', style: const TextStyle(fontSize: 12)),
                        ),
                        if (!isDelivered) ...[
                          if (o['status'] != 'on_the_way')
                            ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0F172A),
                                foregroundColor: Colors.white,
                              ),
                              onPressed: () async {
                                try {
                                  await widget.api.updateOrderStatus(capId, o['id'].toString(), 'on_the_way');
                                  await widget.onRefresh();
                                  if (mounted) await _openChat(o);
                                } catch (e) {
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                  }
                                }
                              },
                              child: const Text('تم الاستلام', style: TextStyle(fontSize: 12)),
                            ),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF0D9488),
                              foregroundColor: Colors.white,
                            ),
                            onPressed: () async {
                              if (!hasProof) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('شرط إلزامي: صوّر الأوردر عند منزل العميل وأرسله في الشات أولًا')),
                                );
                                await _openChat(o);
                                return;
                              }
                              try {
                                await widget.api.updateOrderStatus(capId, o['id'].toString(), 'delivered');
                                await widget.onRefresh();
                              } catch (e) {
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                                  await _openChat(o);
                                }
                              }
                            },
                            child: const Text('تم التسليم', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _SummaryCard({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 11, color: Colors.black54)),
            const SizedBox(height: 4),
            Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: color)),
          ],
        ),
      ),
    );
  }
}
