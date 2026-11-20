import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'storefront_product_pager_sheet.dart';

class _AssistantChatMessage {
  final bool isUser;
  final String text;
  final List<Map<String, dynamic>> products;

  _AssistantChatMessage({
    required this.isUser,
    required this.text,
    this.products = const [],
  });
}

Future<void> showStorefrontAssistantSheet({
  required BuildContext context,
  required OtlobhaCustomerApi api,
  required int Function() getCartCount,
  required void Function(Map<String, dynamic> product, int delta) onAddProduct,
  required VoidCallback onOpenCart,
  required VoidCallback onOpenFreeOrder,
  required void Function(String serviceKey) onOpenService,
  required void Function(String brand) onSelectBrand,
  required void Function(String merchantId, String merchantName) onSelectStore,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _StorefrontAssistantSheetBody(
      api: api,
      getCartCount: getCartCount,
      onAddProduct: onAddProduct,
      onOpenCart: () {
        Navigator.of(ctx).pop();
        onOpenCart();
      },
      onOpenFreeOrder: () {
        Navigator.of(ctx).pop();
        onOpenFreeOrder();
      },
      onOpenService: (svc) {
        Navigator.of(ctx).pop();
        onOpenService(svc);
      },
      onSelectBrand: (b) {
        Navigator.of(ctx).pop();
        onSelectBrand(b);
      },
      onSelectStore: (mId, mName) {
        Navigator.of(ctx).pop();
        onSelectStore(mId, mName);
      },
    ),
  );
}

class _StorefrontAssistantSheetBody extends StatefulWidget {
  final OtlobhaCustomerApi api;
  final int Function() getCartCount;
  final void Function(Map<String, dynamic> product, int delta) onAddProduct;
  final VoidCallback onOpenCart;
  final VoidCallback onOpenFreeOrder;
  final void Function(String serviceKey) onOpenService;
  final void Function(String brand) onSelectBrand;
  final void Function(String merchantId, String merchantName) onSelectStore;

  const _StorefrontAssistantSheetBody({
    required this.api,
    required this.getCartCount,
    required this.onAddProduct,
    required this.onOpenCart,
    required this.onOpenFreeOrder,
    required this.onOpenService,
    required this.onSelectBrand,
    required this.onSelectStore,
  });

  @override
  State<_StorefrontAssistantSheetBody> createState() => _StorefrontAssistantSheetBodyState();
}

class _StorefrontAssistantSheetBodyState extends State<_StorefrontAssistantSheetBody> {
  static const List<String> _quickPrompts = [
    'اقترحلي عروض السوبر ماركت النهاردة',
    'أرخص أسعار الزيت والسكر والمكرونة',
    'منتجات فطار ومخبوزات طازجة',
    'مشروبات وقهوة عليها خصم',
  ];

  final TextEditingController _inputCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();
  final List<_AssistantChatMessage> _messages = [
    _AssistantChatMessage(
      isUser: false,
      text: 'أهلًا بك في مساعد اطلبها الذكي! اكتب اللي محتاجه (مثلاً: عروض اليوم، مقاضي البيت، أو أرخص سعر لمنتج معين) وهقترحلك أفضل المنتجات فورًا.',
    ),
  ];

  bool _sending = false;

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 240),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendPrompt([String? preset]) async {
    final text = (preset ?? _inputCtrl.text).trim();
    if (text.isEmpty || _sending) return;
    if (preset == null) _inputCtrl.clear();

    setState(() {
      _messages.add(_AssistantChatMessage(isUser: true, text: text));
      _sending = true;
    });
    _scrollToBottom();

    try {
      final res = await widget.api.askStorefrontAssistant(text);
      final reply = (res['reply_ar'] ?? res['reply'] ?? 'تم العثور على هذه المقترحات لك:').toString().trim();
      final rawProducts = (res['suggested_products'] as List?) ?? [];
      final products = rawProducts
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!mounted) return;
      setState(() {
        _messages.add(_AssistantChatMessage(
          isUser: false,
          text: reply.isNotEmpty ? reply : 'تفضل أفضل الترشيحات المتاحة الآن:',
          products: products,
        ));
        _sending = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _messages.add(_AssistantChatMessage(
          isUser: false,
          text: 'تعذر الاتصال بالمساعد حاليًا. يمكنك المحاولة مرة أخرى أو استخدام البحث الذكي.',
        ));
        _sending = false;
      });
      _scrollToBottom();
    }
  }

  double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse((v ?? '').toString()) ?? 0;
  }

  String _formatPrice(double value) {
    if (value == value.roundToDouble()) return value.toInt().toString();
    return value.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final sheetHeight = MediaQuery.of(context).size.height * 0.86;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: Container(
          height: sheetHeight,
          decoration: const BoxDecoration(
            color: Color(0xFFF6F7F9),
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              // Otlobha Crimson Header
              Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerRight,
                    end: Alignment.centerLeft,
                    colors: [Color(0xFFA92224), Color(0xFF86191B)],
                  ),
                ),
                child: Column(
                  children: [
                    Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.35),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.16),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: const Color(0x88F5A623)),
                          ),
                          child: const Icon(Icons.auto_awesome_rounded, color: Color(0xFFF5A623), size: 22),
                        ),
                        const SizedBox(width: 10),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'مساعد اطلبها الذكي',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 15.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              Text(
                                'ترشيح فوري للمنتجات · مقارنة أسعار · وصول سريع للخدمات',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Color(0xFFFDE68A),
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded, color: Colors.white),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Quick Services Launcher Strip
              Container(
                color: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _serviceChip(
                        icon: Icons.edit_note_rounded,
                        label: 'طلب نصي حر',
                        color: const Color(0xFFA92224),
                        onTap: widget.onOpenFreeOrder,
                      ),
                      const SizedBox(width: 8),
                      _serviceChip(
                        icon: Icons.medication_rounded,
                        label: 'الصيدليات',
                        color: const Color(0xFF0D9488),
                        onTap: () => widget.onOpenService('pharmacy'),
                      ),
                      const SizedBox(width: 8),
                      _serviceChip(
                        icon: Icons.directions_car_rounded,
                        label: 'مشوار',
                        color: const Color(0xFFD97706),
                        onTap: () => widget.onOpenService('rides_parcels'),
                      ),
                      const SizedBox(width: 8),
                      _serviceChip(
                        icon: Icons.inventory_2_rounded,
                        label: 'طرود أي حاجة',
                        color: const Color(0xFFEA580C),
                        onTap: () => widget.onOpenService('rides_parcels'),
                      ),
                      const SizedBox(width: 8),
                      _serviceChip(
                        icon: Icons.shopping_bag_rounded,
                        label: 'سوق اطلبها',
                        color: const Color(0xFF4F46E5),
                        onTap: () => widget.onOpenService('market'),
                      ),
                      const SizedBox(width: 8),
                      _serviceChip(
                        icon: Icons.storefront_rounded,
                        label: 'كل المتاجر',
                        color: const Color(0xFF334155),
                        onTap: () => widget.onOpenService('stores'),
                      ),
                    ],
                  ),
                ),
              ),

              // Chat Messages
              Expanded(
                child: ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
                  itemCount: _messages.length + (_sending ? 1 : 0),
                  itemBuilder: (_, idx) {
                    if (idx == _messages.length) {
                      return Align(
                        alignment: Alignment.centerRight,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 15,
                                height: 15,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFA92224)),
                              ),
                              SizedBox(width: 8),
                              Text(
                                'جاري البحث عن أفضل الترشيحات...',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF475569)),
                              ),
                            ],
                          ),
                        ),
                      );
                    }

                    final msg = _messages[idx];
                    return Column(
                      crossAxisAlignment: msg.isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                      children: [
                        Container(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.of(context).size.width * 0.84,
                          ),
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                          decoration: BoxDecoration(
                            color: msg.isUser ? const Color(0xFFA92224) : Colors.white,
                            borderRadius: BorderRadius.only(
                              topLeft: const Radius.circular(18),
                              topRight: const Radius.circular(18),
                              bottomLeft: Radius.circular(msg.isUser ? 18 : 6),
                              bottomRight: Radius.circular(msg.isUser ? 6 : 18),
                            ),
                            border: msg.isUser ? null : Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: Text(
                            msg.text,
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.45,
                              fontWeight: FontWeight.w600,
                              color: msg.isUser ? Colors.white : const Color(0xFF0F172A),
                            ),
                          ),
                        ),
                        if (msg.products.isNotEmpty) ...[
                          SizedBox(
                            height: 184,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: msg.products.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 10),
                              itemBuilder: (_, pIdx) => _buildSuggestedProductCard(msg.products, pIdx),
                            ),
                          ),
                          const SizedBox(height: 12),
                        ],
                      ],
                    );
                  },
                ),
              ),

              // Quick Prompt Suggestions
              Container(
                color: const Color(0xFFF6F7F9),
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _quickPrompts.map((prompt) {
                      return Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: InkWell(
                          onTap: () => _sendPrompt(prompt),
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFFFECACA)),
                            ),
                            child: Text(
                              prompt,
                              style: const TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF86191B),
                              ),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),

              // Input Bar
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: SafeArea(
                  top: false,
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _inputCtrl,
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _sendPrompt(),
                          decoration: InputDecoration(
                            hintText: 'اسألني عن منتج، عرض، أو أرخص سعر...',
                            hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                            filled: true,
                            fillColor: const Color(0xFFF1F5F9),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16),
                              borderSide: BorderSide.none,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Material(
                        color: const Color(0xFFA92224),
                        borderRadius: BorderRadius.circular(14),
                        child: InkWell(
                          onTap: _sending ? null : () => _sendPrompt(),
                          borderRadius: BorderRadius.circular(14),
                          child: const SizedBox(
                            width: 44,
                            height: 44,
                            child: Icon(Icons.send_rounded, color: Colors.white, size: 20),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _serviceChip({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: color.withOpacity(0.09),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withOpacity(0.24)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: color),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: color),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSuggestedProductCard(List<Map<String, dynamic>> list, int idx) {
    final prod = list[idx];
    final imgUrl = OtlobhaCustomerApi.resolveMediaUrl(prod['image_url']);
    final basePrice = _toDouble(prod['base_price']);
    final rawSale = prod['sale_price'];
    final salePrice = rawSale != null ? _toDouble(rawSale) : null;
    final effPrice = prod['effective_price'] != null
        ? _toDouble(prod['effective_price'])
        : (salePrice != null && salePrice > 0 && salePrice < basePrice ? salePrice : basePrice);
    final nameAr = (prod['name_ar'] ?? '').toString().trim();
    final merchantName = (prod['merchant_name'] ?? '').toString().trim();

    return Container(
      width: 154,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: InkWell(
              onTap: () {
                showStorefrontProductPager(
                  context: context,
                  api: widget.api,
                  products: list,
                  initialIndex: idx,
                  getCartCount: widget.getCartCount,
                  onAddToCart: (p, qty) => widget.onAddProduct(p, qty),
                  onOpenCart: widget.onOpenCart,
                  onSelectBrand: widget.onSelectBrand,
                  onSelectStore: widget.onSelectStore,
                );
              },
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Center(
                        child: imgUrl.isNotEmpty
                            ? Image.network(
                                imgUrl,
                                fit: BoxFit.contain,
                                cacheWidth: 220,
                                errorBuilder: (_, __, ___) => const Icon(
                                  Icons.inventory_2_outlined,
                                  color: Color(0xFFA92224),
                                  size: 28,
                                ),
                              )
                            : const Icon(
                                Icons.inventory_2_outlined,
                                color: Color(0xFFA92224),
                                size: 28,
                              ),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      nameAr,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                        height: 1.2,
                      ),
                    ),
                    if (merchantName.isNotEmpty)
                      Text(
                        merchantName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 9.5, color: Color(0xFF64748B)),
                      ),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 2, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${_formatPrice(effPrice)} ج.م',
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                InkWell(
                  onTap: () {
                    widget.onAddProduct(prod, 1);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        duration: const Duration(seconds: 1),
                        content: Text('تمت إضافة $nameAr للسلة'),
                      ),
                    );
                  },
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFA92224),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Text(
                      '+ أضف',
                      style: TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w900),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
