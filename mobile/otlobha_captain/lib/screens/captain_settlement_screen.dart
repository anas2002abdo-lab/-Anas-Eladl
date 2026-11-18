import 'package:flutter/material.dart';
import '../core/api_client.dart';

class CaptainSettlementScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final Map<String, dynamic> captain;
  final List<dynamic> orders;
  final List<dynamic> settlements;
  final Future<void> Function() onRefresh;

  const CaptainSettlementScreen({
    super.key,
    required this.api,
    required this.captain,
    required this.orders,
    required this.settlements,
    required this.onRefresh,
  });

  @override
  State<CaptainSettlementScreen> createState() => _CaptainSettlementScreenState();
}

class _CaptainSettlementScreenState extends State<CaptainSettlementScreen> {
  final TextEditingController _settleCtrl = TextEditingController(text: '300');
  String _payoutMethod = 'vodafone_cash';
  bool _submitting = false;

  @override
  void dispose() {
    _settleCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final capId = widget.captain['id'].toString();
    final capName = widget.captain['full_name']?.toString() ?? '';
    final cashOnHand = (widget.captain['cash_on_hand'] as num?)?.toDouble() ?? 0;
    final cashLimit = (widget.captain['cash_limit'] as num?)?.toDouble() ?? 1500;
    final completedOrders = widget.orders
        .where((o) => o['captain_id'] == capId && o['status'] == 'delivered')
        .toList();
    final collectedTotal = completedOrders.fold<double>(
      0,
      (sum, o) => sum + ((o['total_amount'] as num?)?.toDouble() ?? 0),
    );
    final deliveryFees = completedOrders.fold<double>(
      0,
      (sum, o) => sum + ((o['delivery_fee'] as num?)?.toDouble() ?? 0),
    );

    final mySettlements = widget.settlements
        .where((s) => s['beneficiary_type'] == 'captain' && s['beneficiary_name'] == capName)
        .toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('حساب الكاش والتسوية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'الكاش بيدك: ${cashOnHand.toStringAsFixed(0)} / ${cashLimit.toStringAsFixed(0)} ج.م',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    Text('القبول: ${widget.captain['acceptance_rate']}%'),
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: (cashOnHand / (cashLimit > 0 ? cashLimit : 1)).clamp(0.0, 1.0).toDouble(),
                  color: const Color(0xFFEA580C),
                ),
                if (((widget.captain['total_penalties'] ?? 0) as num) > 0) ...[
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFECACA)),
                    ),
                    child: Text(
                      'إجمالي غرامات إلغاء المشاوير (10%): ${widget.captain['total_penalties']} ج.م',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: Color(0xFFB91C1C)),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade100,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('تحصيل الأوردرات', style: TextStyle(fontSize: 11, color: Colors.black54)),
                            Text('${collectedTotal.toStringAsFixed(0)} ج.م', style: const TextStyle(fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFCCFBF1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('أجور التوصيل', style: TextStyle(fontSize: 11, color: Color(0xFF115E59))),
                            Text(
                              '${deliveryFees.toStringAsFixed(0)} ج.م',
                              style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F766E)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('طلب تسوية وسحب أرباح', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _settleCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, labelText: 'المبلغ (ج.م)'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    DropdownButton<String>(
                      value: _payoutMethod,
                      items: const [
                        DropdownMenuItem(value: 'vodafone_cash', child: Text('فودافون كاش')),
                        DropdownMenuItem(value: 'instapay', child: Text('إنستاباي')),
                      ],
                      onChanged: (v) => setState(() => _payoutMethod = v ?? 'vodafone_cash'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFEA580C),
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(46),
                    ),
                    onPressed: _submitting
                        ? null
                        : () async {
                            final amt = double.tryParse(_settleCtrl.text) ?? 0;
                            if (amt <= 0) return;
                            setState(() => _submitting = true);
                            try {
                              await widget.api.requestSettlement(capId, amt, _payoutMethod);
                              await widget.onRefresh();
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('تم إرسال طلب التسوية للمالية بنجاح')),
                                );
                              }
                            } catch (e) {
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                              }
                            } finally {
                              if (mounted) setState(() => _submitting = false);
                            }
                          },
                    child: Text(_submitting ? 'جاري الإرسال...' : 'إرسال طلب التسوية'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        const Text('سجل طلبات التسوية', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 6),
        if (mySettlements.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('لا توجد طلبات تسوية سابقة حتى الآن.', style: TextStyle(color: Colors.black54)),
            ),
          )
        else
          ...mySettlements.map((s) => Card(
                child: ListTile(
                  title: Text('${s['net_payout']} ج.م · ${s['payout_method'] == 'vodafone_cash' ? 'فودافون كاش' : 'إنستاباي'}'),
                  subtitle: Text('${s['created_at'] ?? ''}'),
                  trailing: Text(
                    '${s['status']}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: s['status'] == 'paid' ? const Color(0xFF0D9488) : const Color(0xFFB45309),
                    ),
                  ),
                ),
              )),
      ],
    );
  }
}
