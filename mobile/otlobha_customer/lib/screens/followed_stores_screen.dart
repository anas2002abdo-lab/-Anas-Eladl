import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../widgets/storefront_product_card.dart';

class FollowedStoresScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, int> cart;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final void Function(String merchantId, String merchantName) onOpenStore;

  const FollowedStoresScreen({
    super.key,
    required this.api,
    required this.cart,
    required this.onAddProduct,
    required this.onOpenStore,
  });

  @override
  State<FollowedStoresScreen> createState() => _FollowedStoresScreenState();
}

class _FollowedStoresScreenState extends State<FollowedStoresScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _stores = [];
  List<Map<String, dynamic>> _products = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final res = await widget.api.getFollowedStores();
      if (!mounted) return;
      final rawStores = (res['stores'] as List?) ?? [];
      final rawProds = (res['products_and_offers'] as List?) ?? [];
      setState(() {
        _stores = rawStores.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _products = rawProds.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _unfollow(String merchantId) async {
    try {
      await widget.api.unfollowStore(merchantId);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تمت إزالة المتجر من قائمة المتابعة')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          title: const Text('المتاجر المفضلة والمتابعة', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          backgroundColor: const Color(0xFFA92224),
          foregroundColor: Colors.white,
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 10),
                        ElevatedButton(onPressed: _load, child: const Text('إعادة المحاولة')),
                      ],
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _stores.isEmpty
                        ? ListView(
                            padding: const EdgeInsets.all(28),
                            children: const [
                              SizedBox(height: 60),
                              Icon(Icons.favorite_border_rounded, size: 54, color: Color(0xFF94A3B8)),
                              SizedBox(height: 12),
                              Text(
                                'لم تقم بمتابعة أي متجر بعد',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                              ),
                              SizedBox(height: 6),
                              Text(
                                'افتح صفحة أي متجر واضغط "متابعة وإضافة للمفضلة" لتصلك أحدث عروضه ومنتجاته أولاً بأول.',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                              ),
                            ],
                          )
                        : ListView(
                            padding: const EdgeInsets.all(14),
                            children: [
                              Text(
                                'المتاجر التي تتابعها (${_stores.length})',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                              ),
                              const SizedBox(height: 10),
                              ..._stores.map((s) {
                                final mId = (s['id'] ?? '').toString();
                                final mName = (s['business_name_ar'] ?? '').toString();
                                final logo = OtlobhaCustomerApi.resolveMediaUrl(s['image_url']);
                                final ratingAvg = (s['rating_avg'] as num?)?.toDouble() ?? 0.0;
                                final ratingCnt = (s['rating_count'] as num?)?.toInt() ?? 0;
                                final isOpen = s['is_open_now'] != false;
                                final offersCnt = (s['offers_count'] as num?)?.toInt() ?? 0;

                                return Container(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: const Color(0xFFE2E8F0)),
                                  ),
                                  child: ListTile(
                                    onTap: () => widget.onOpenStore(mId, mName),
                                    leading: ClipRRect(
                                      borderRadius: BorderRadius.circular(12),
                                      child: Container(
                                        width: 48,
                                        height: 48,
                                        color: const Color(0xFFF1F5F9),
                                        child: logo.isNotEmpty
                                            ? Image.network(
                                                logo,
                                                fit: BoxFit.cover,
                                                errorBuilder: (_, __, ___) => const Icon(Icons.storefront_rounded, color: Color(0xFFA92224)),
                                              )
                                            : const Icon(Icons.storefront_rounded, color: Color(0xFFA92224)),
                                      ),
                                    ),
                                    title: Text(mName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                                    subtitle: Text(
                                      '${isOpen ? 'مفتوح' : 'مغلق'} · ${ratingCnt > 0 ? '${ratingAvg.toStringAsFixed(1)} ★ ($ratingCnt)' : 'جديد'}${offersCnt > 0 ? ' · $offersCnt عروض' : ''}',
                                      style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                    ),
                                    trailing: IconButton(
                                      tooltip: 'إلغاء المتابعة',
                                      onPressed: () => _unfollow(mId),
                                      icon: const Icon(Icons.favorite_rounded, color: Color(0xFFA92224)),
                                    ),
                                  ),
                                );
                              }),
                              if (_products.isNotEmpty) ...[
                                const SizedBox(height: 16),
                                const Text(
                                  'أحدث المنتجات والعروض من متاجرك المفضلة',
                                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                                ),
                                const SizedBox(height: 10),
                                GridView.builder(
                                  shrinkWrap: true,
                                  physics: const NeverScrollableScrollPhysics(),
                                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                                    crossAxisCount: 2,
                                    mainAxisSpacing: 10,
                                    crossAxisSpacing: 10,
                                    childAspectRatio: 0.62,
                                  ),
                                  itemCount: _products.length,
                                  itemBuilder: (_, i) {
                                    final prod = _products[i];
                                    final pid = (prod['id'] ?? '').toString();
                                    return StorefrontProductCardWidget(
                                      product: prod,
                                      cartQty: widget.cart[pid] ?? 0,
                                      onTapDetails: () => widget.onOpenStore(
                                        (prod['merchant_id'] ?? '').toString(),
                                        (prod['merchant_name_ar'] ?? '').toString(),
                                      ),
                                      onAdd: () {
                                        widget.onAddProduct(prod, 1);
                                        setState(() {});
                                      },
                                      onDecrement: () {
                                        widget.onAddProduct(prod, -1);
                                        setState(() {});
                                      },
                                    );
                                  },
                                ),
                              ],
                            ],
                          ),
                  ),
      ),
    );
  }
}
