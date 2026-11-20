import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class OffersScreen extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final Map<String, dynamic> bootstrap;
  final Map<String, int> cart;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final Future<void> Function(String code) onApplyCoupon;

  const OffersScreen({
    super.key,
    required this.api,
    required this.bootstrap,
    required this.cart,
    required this.onAddProduct,
    required this.onApplyCoupon,
  });

  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  final List<Map<String, dynamic>> _offers = [];
  final ScrollController _scrollCtrl = ScrollController();
  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _searchDebounce;
  String _searchQuery = '';
  int _page = 1;
  int _totalOffers = 0;
  bool _hasMore = false;
  bool _loading = false;
  bool _loadingMore = false;
  int _fetchSeq = 0;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetchOffers(reset: true);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _scrollCtrl.removeListener(_onScroll);
    _scrollCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_loading || _loadingMore || !_hasMore || !_scrollCtrl.hasClients) return;
    if (_scrollCtrl.position.pixels >= _scrollCtrl.position.maxScrollExtent - 340) {
      _fetchOffers(reset: false);
    }
  }

  Future<void> _fetchOffers({required bool reset}) async {
    if (!reset && (_loadingMore || !_hasMore)) return;
    final nextPage = reset ? 1 : _page + 1;
    final seq = ++_fetchSeq;

    setState(() {
      if (reset) {
        _loading = true;
      } else {
        _loadingMore = true;
      }
    });

    try {
      final res = await widget.api.getProductsPaginated(
        offersOnly: true,
        query: _searchQuery.isEmpty ? null : _searchQuery,
        page: nextPage,
        limit: 35,
      );
      if (!mounted || seq != _fetchSeq) return;
      final rawItems = (res['items'] as List?) ?? const [];
      final parsed = rawItems.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();

      setState(() {
        if (reset) {
          _offers
            ..clear()
            ..addAll(parsed);
        } else {
          final seen = _offers.map((e) => e['id']?.toString()).toSet();
          for (final item in parsed) {
            if (!seen.contains(item['id']?.toString())) {
              _offers.add(item);
            }
          }
        }
        _page = nextPage;
        _totalOffers = (res['total'] as num?)?.toInt() ?? _offers.length;
        _hasMore = res['has_more'] == true;
        _loading = false;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted || seq != _fetchSeq) return;
      // Graceful fallback to bootstrap offers if offline
      if (reset && _offers.isEmpty) {
        final bootstrapProds = (widget.bootstrap['products'] as List?) ?? const [];
        final fallback = bootstrapProds
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .where((p) {
              if (p['is_offer'] == true || p['is_offer'] == 1) return true;
              final base = p['base_price'] as num?;
              final sale = p['sale_price'] as num?;
              return sale != null && base != null && sale < base;
            })
            .toList();
        setState(() {
          _offers.addAll(fallback);
          _totalOffers = fallback.length;
          _hasMore = false;
          _loading = false;
          _loadingMore = false;
        });
      } else {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  void _onSearchChanged(String val) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      final clean = val.trim();
      if (clean != _searchQuery) {
        setState(() => _searchQuery = clean);
        _fetchOffers(reset: true);
      }
    });
  }

  Widget _buildProductThumb(String? rawUrl) {
    final url = (rawUrl ?? '').trim();
    const fallback = Icon(Icons.local_offer, color: Color(0xFFEA580C));
    if (url.isEmpty) {
      return Container(color: const Color(0xFFFFF7ED), child: fallback);
    }
    if (url.startsWith('data:image')) {
      final commaIdx = url.indexOf(',');
      if (commaIdx != -1) {
        try {
          return Image.memory(
            base64Decode(url.substring(commaIdx + 1)),
            fit: BoxFit.cover,
            width: 48,
            height: 48,
            cacheWidth: 140,
            errorBuilder: (_, __, ___) => fallback,
          );
        } catch (_) {
          return fallback;
        }
      }
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: 48,
        height: 48,
        cacheWidth: 140,
        errorBuilder: (_, __, ___) => fallback,
      );
    }
    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    final coupons = (widget.bootstrap['coupons'] as List?) ?? [];
    final promoNotifs = ((widget.bootstrap['notifications'] as List?) ?? [])
        .where((n) => n['category'] == 'promo')
        .toList();

    return CustomScrollView(
      controller: _scrollCtrl,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('أكواد الخصم الفعالة', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                if (coupons.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text('لا توجد كوبونات فعالة حاليًا', style: TextStyle(color: Colors.grey)),
                    ),
                  )
                else
                  ...coupons.map((c) {
                    final isPct = c['discount_type'] == 'percentage';
                    return Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF7ED),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFFDBA74)),
                                  ),
                                  child: Text(
                                    '${c['code']}',
                                    style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFC2410C)),
                                  ),
                                ),
                                Text(
                                  isPct ? 'خصم ${c['discount_value']}%' : 'خصم ${c['discount_value']} ج.م',
                                  style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0D9488)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'الحد الأدنى للطلب: ${c['min_order_amount']} ج.م · بحد أقصى ${c['max_discount']} ج.م',
                              style: const TextStyle(fontSize: 12, color: Colors.black54),
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF0F172A),
                                  foregroundColor: Colors.white,
                                  minimumSize: const Size.fromHeight(42),
                                ),
                                onPressed: () => widget.onApplyCoupon('${c['code']}'),
                                child: const Text('تطبيق الكود في السلة'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                const SizedBox(height: 14),
                Text(
                  'عروض المتاجر والمنتجات ($_totalOffers)',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _searchCtrl,
                  onChanged: _onSearchChanged,
                  decoration: InputDecoration(
                    isDense: true,
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    prefixIcon: const Icon(Icons.search, size: 20),
                    hintText: 'ابحث في العروض والخصومات...',
                    suffixIcon: _searchCtrl.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchCtrl.clear();
                              _searchDebounce?.cancel();
                              setState(() => _searchQuery = '');
                              _fetchOffers(reset: true);
                            },
                          )
                        : null,
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
        if (_loading && _offers.isEmpty)
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator(color: Color(0xFFEA580C))),
            ),
          )
        else if (_offers.isEmpty)
          const SliverPadding(
            padding: EdgeInsets.symmetric(horizontal: 14),
            sliver: SliverToBoxAdapter(
              child: Card(
                child: Padding(
                  padding: EdgeInsets.all(14),
                  child: Text('لا توجد عروض منتجات حاليًا', style: TextStyle(color: Colors.grey)),
                ),
              ),
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            sliver: SliverList.builder(
              itemCount: _offers.length,
              itemBuilder: (context, idx) {
                final p = _offers[idx];
                final qty = widget.cart[p['id']] ?? 0;
                final base = (p['base_price'] as num).toDouble();
                final saleNum = p['sale_price'] as num?;
                final hasPctDiscount = saleNum != null && saleNum.toDouble() < base && base > 0;
                final finalPrice = saleNum != null ? saleNum.toDouble() : base;
                final pct = hasPctDiscount ? (((base - finalPrice) / base) * 100).round() : 0;
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    leading: SizedBox(
                      width: 48,
                      height: 48,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: _buildProductThumb('${p['image_url'] ?? ''}'),
                      ),
                    ),
                    title: Row(
                      children: [
                        Expanded(
                          child: Text(
                            p['name_ar'] ?? '',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFE11D48),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            hasPctDiscount ? '-$pct%' : 'عرض المتجر',
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                    subtitle: Text(
                      hasPctDiscount
                          ? '${p['merchant_name'] ?? ''}\n${finalPrice.toStringAsFixed(0)} ج.م  (بدلًا من ${base.toStringAsFixed(0)} ج.م)'
                          : '${p['merchant_name'] ?? ''}\n${finalPrice.toStringAsFixed(0)} ج.م',
                      style: const TextStyle(fontSize: 12),
                    ),
                    isThreeLine: true,
                    trailing: qty == 0
                        ? ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFFEA580C),
                              foregroundColor: Colors.white,
                            ),
                            onPressed: () => widget.onAddProduct(p, 1),
                            child: const Text('+ أضف'),
                          )
                        : Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                onPressed: () => widget.onAddProduct(p, -1),
                                icon: const Icon(Icons.remove_circle_outline),
                              ),
                              Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold)),
                              IconButton(
                                onPressed: () => widget.onAddProduct(p, 1),
                                icon: const Icon(Icons.add_circle, color: Color(0xFFEA580C)),
                              ),
                            ],
                          ),
                  ),
                );
              },
            ),
          ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 24),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_loadingMore)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Center(child: CircularProgressIndicator(strokeWidth: 2.5, color: Color(0xFFEA580C))),
                  )
                else if (_hasMore)
                  OutlinedButton.icon(
                    onPressed: () => _fetchOffers(reset: false),
                    icon: const Icon(Icons.expand_more),
                    label: Text('تحميل المزيد من العروض (${_offers.length} / $_totalOffers)'),
                  ),
                if (promoNotifs.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  const Text('إشعارات العروض', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  ...promoNotifs.take(4).map((n) => Card(
                        child: ListTile(
                          leading: const Icon(Icons.campaign, color: Color(0xFFEA580C)),
                          title: Text(
                            n['title_ar'] ?? '',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                          subtitle: Text(n['body_ar'] ?? '', style: const TextStyle(fontSize: 12)),
                        ),
                      )),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}
