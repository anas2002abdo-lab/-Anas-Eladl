import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'stores_order_screen.dart';
import 'pharmacy_screen.dart';
import 'rides_parcels_screen.dart';
import 'market_wallet_screen.dart';

class ServicesHubScreen extends StatelessWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final Future<void> Function() onRefresh;
  final String activeSubView; // 'hub' | 'stores' | 'pharmacy' | 'rides_parcels' | 'market'
  final void Function(String subView) onSelectSubView;
  final VoidCallback onOpenFreeOrderCart;
  final String customerName;
  final String customerPhone;
  final String selectedZoneId;
  final String addressLandmark;
  final void Function(String tripId) onOpenTripChat;

  const ServicesHubScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onRefresh,
    required this.activeSubView,
    required this.onSelectSubView,
    required this.onOpenFreeOrderCart,
    required this.customerName,
    required this.customerPhone,
    this.selectedZoneId = 'zn_city_center',
    this.addressLandmark = '',
    required this.onOpenTripChat,
  });

  @override
  Widget build(BuildContext context) {
    final services = (bootstrap['services'] as List?) ?? [];
    final serviceMap = {for (var s in services) s['service_key']: s};

    if (activeSubView != 'hub') {
      Widget body;
      switch (activeSubView) {
        case 'stores':
          body = StoresOrderScreen(
            api: api,
            bootstrap: bootstrap,
            cart: cart,
            selectedZoneId: selectedZoneId,
            addressLandmark: addressLandmark,
            onAddProduct: onAddProduct,
            onOpenCart: onOpenCart,
            onRefresh: onRefresh,
          );
          break;
        case 'pharmacy':
          body = PharmacyScreen(
            api: api,
            bootstrap: bootstrap,
            selectedZoneId: selectedZoneId,
            addressLandmark: addressLandmark,
            onRefresh: onRefresh,
          );
          break;
        case 'rides_parcels':
          body = RidesParcelsScreen(
            api: api,
            bootstrap: bootstrap,
            customerName: customerName,
            customerPhone: customerPhone,
            selectedZoneId: selectedZoneId,
            onRefresh: onRefresh,
            onOpenTripChat: onOpenTripChat,
          );
          break;
        case 'market':
        default:
          body = MarketWalletScreen(
            api: api,
            bootstrap: bootstrap,
            customerName: customerName,
            customerPhone: customerPhone,
            selectedZoneId: selectedZoneId,
            onRefresh: onRefresh,
          );
          break;
      }

      return body;
    }

    final cards = [
      {
        'key': 'stores',
        'sub': 'stores',
        'title': 'المتاجر والمطاعم',
        'desc': 'بقالة، مطاعم، أسماك، ومستلزمات يومية في المنزلة',
        'icon': Icons.storefront,
        'color': const Color(0xFFEA580C),
      },
      {
        'key': 'pharmacy',
        'sub': 'pharmacy',
        'title': 'الصيدلية والروشتة',
        'desc': 'إرسال روشتة أو صورة دواء لصيدلي مرخص للتسعير والصرف',
        'icon': Icons.medication,
        'color': const Color(0xFF0D9488),
      },
      {
        'key': 'parcels',
        'sub': 'rides_parcels',
        'title': 'اطلبها أي حاجة (طرد OTP)',
        'desc': 'توصيل أوراق وأغراض داخل المنزلة والقرى برمز استلام آمن',
        'icon': Icons.inventory_2,
        'color': const Color(0xFF0F172A),
      },
      {
        'key': 'rides',
        'sub': 'rides_parcels',
        'title': 'اطلبها مشوار',
        'desc': 'حجز موتوسيكل أو توك توك مرخص للتنقل السريع',
        'icon': Icons.directions_car,
        'color': const Color(0xFFD97706),
      },
      {
        'key': 'market',
        'sub': 'market',
        'title': 'سوق اطلبها (بيع وشراء)',
        'desc': 'إعلانات محلية بين أهالي المنزلة والقرى المجاورة',
        'icon': Icons.shopping_bag,
        'color': const Color(0xFF4F46E5),
      },
      {
        'key': 'free_order',
        'sub': 'free',
        'title': 'طلب نصي حر لأي محل',
        'desc': 'اكتب قائمة مقاضيك وسنرسلها لأقرب متجر وكابتن فورًا',
        'icon': Icons.edit_note,
        'color': const Color(0xFFE11D48),
      },
    ];

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const Text('جميع خدمات اطلبها – المنزلة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 10),
        ...cards.map((c) {
          final cfg = serviceMap[c['key']];
          final enabled = c['key'] == 'rides' ? true : (cfg == null ? true : (cfg['is_enabled'] == true));
          final color = c['color'] as Color;
          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              leading: Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: enabled ? color : Colors.grey,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(c['icon'] as IconData, color: Colors.white),
              ),
              title: Row(
                children: [
                  Expanded(
                    child: Text(c['title'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  ),
                  if (!enabled)
                    const Text('موقوفة', style: TextStyle(color: Colors.red, fontSize: 11, fontWeight: FontWeight.bold)),
                ],
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(c['desc'] as String, style: const TextStyle(fontSize: 12)),
              ),
              trailing: const Icon(Icons.chevron_left),
              onTap: () {
                if (c['sub'] == 'free') {
                  onOpenFreeOrderCart();
                } else {
                  onSelectSubView(c['sub'] as String);
                }
              },
            ),
          );
        }),
      ],
    );
  }
}
