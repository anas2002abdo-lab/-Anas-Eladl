import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'register_kyc_screen.dart';

class CaptainProfileScreen extends StatelessWidget {
  final OtlobhaCaptainApi api;
  final Map<String, dynamic> captain;
  final void Function(String captainId) onCaptainSelected;
  final Future<void> Function() onRefresh;
  final VoidCallback onLogout;

  const CaptainProfileScreen({
    super.key,
    required this.api,
    required this.captain,
    required this.onCaptainSelected,
    required this.onRefresh,
    required this.onLogout,
  });

  Widget _docPreview(String? imageUrl) {
    if (imageUrl != null && imageUrl.startsWith('data:image')) {
      final idx = imageUrl.indexOf(',');
      if (idx != -1) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.memory(base64Decode(imageUrl.substring(idx + 1)), width: 48, height: 42, fit: BoxFit.cover),
        );
      }
    }
    return Container(
      width: 48,
      height: 42,
      decoration: BoxDecoration(color: Colors.grey.shade200, borderRadius: BorderRadius.circular(8)),
      child: const Icon(Icons.description_outlined, color: Colors.black54),
    );
  }

  @override
  Widget build(BuildContext context) {
    final docs = (captain['documents'] as List?) ?? [];
    final username = captain['username']?.toString() ?? '';

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
                          Text('${captain['full_name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                          if (username.isNotEmpty)
                            Text(
                              '@$username',
                              textDirection: TextDirection.ltr,
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFEA580C)),
                            ),
                          Text('${captain['phone']} · ${captain['zone_name']}', style: const TextStyle(fontSize: 12, color: Colors.black54)),
                        ],
                      ),
                    ),
                  ],
                ),
                const Divider(height: 20),
                Text('المركبة: ${captain['vehicle_model']} · اللوحة: ${captain['plate_number']}', style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 4),
                Text(
                  'حالة التوثيق: ${captain['verification_status']}',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF0D9488), fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _StatCell(label: 'التقييم', value: '${captain['rating_avg']}'),
                    _StatCell(label: 'القبول', value: '${captain['acceptance_rate']}%'),
                    _StatCell(label: 'المكتملة', value: '${captain['completed_count']}'),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEA580C),
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(46),
            ),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => RegisterKycScreen(
                    api: api,
                    onRegistered: (newId) {
                      Navigator.pop(context);
                      onCaptainSelected(newId);
                      onRefresh();
                    },
                  ),
                ),
              );
            },
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('تسجيل كابتن جديد ورفع صور المركبة (9 مستندات)'),
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red.shade700,
              side: BorderSide(color: Colors.red.shade200),
              minimumSize: const Size.fromHeight(44),
            ),
            onPressed: onLogout,
            icon: const Icon(Icons.logout),
            label: const Text('تسجيل الخروج'),
          ),
        ),
        const SizedBox(height: 14),
        Text('مستندات التوثيق وصور المركبة (${docs.length})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 6),
        ...docs.map((d) => Card(
              child: ListTile(
                leading: _docPreview(d['image_url']?.toString()),
                title: Text('${d['label_ar']}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text('الحالة: ${d['review_status']}', style: const TextStyle(fontSize: 11, color: Color(0xFF0D9488))),
              ),
            )),
      ],
    );
  }
}

class _StatCell extends StatelessWidget {
  final String label;
  final String value;

  const _StatCell({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.black54)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
      ],
    );
  }
}
