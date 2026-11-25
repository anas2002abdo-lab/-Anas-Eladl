import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';

const Color _kBrandPrimary = Color(0xFF9F1D20);
const Color _kBrandDark = Color(0xFF1E293B);
const Color _kBrandGreen = Color(0xFF059669);

double _toDouble(dynamic v, [double fallback = 0]) {
  if (v is num) return v.toDouble();
  return double.tryParse('$v') ?? fallback;
}

int _toInt(dynamic v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse('$v') ?? fallback;
}

bool _toBool(dynamic v, [bool fallback = false]) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '$v'.trim().toLowerCase();
  if (s == 'true' || s == '1') return true;
  if (s == 'false' || s == '0') return false;
  return fallback;
}

/// Reusable UI section for Weighted Product settings (< 1 fractional increments).
class _WeightedSettingsCard extends StatelessWidget {
  final bool isWeighted;
  final double weightStep;
  final String weightUnit;
  final TextEditingController customStepCtrl;
  final ValueChanged<bool> onWeightedChanged;
  final ValueChanged<double> onStepChanged;
  final ValueChanged<String> onUnitChanged;

  const _WeightedSettingsCard({
    required this.isWeighted,
    required this.weightStep,
    required this.weightUnit,
    required this.customStepCtrl,
    required this.onWeightedChanged,
    required this.onStepChanged,
    required this.onUnitChanged,
  });

  @override
  Widget build(BuildContext context) {
    const presetSteps = [0.1, 0.125, 0.25, 0.5];
    const units = ['كجم', 'جم', 'لتر'];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isWeighted ? const Color(0xFFFEF3C7).withOpacity(0.55) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isWeighted ? const Color(0xFFF59E0B) : const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.scale_rounded,
                size: 20,
                color: isWeighted ? const Color(0xFFB45309) : const Color(0xFF64748B),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'منتج يُباع بالوزن (زيادة بأقل من 1 صحيح)',
                      style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                    Text(
                      'يتيح للعميل طلب ربع أو نصف كيلو (مثل 0.25 أو 0.5)',
                      style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                    ),
                  ],
                ),
              ),
              Switch(
                value: isWeighted,
                activeColor: const Color(0xFFD97706),
                onChanged: onWeightedChanged,
              ),
            ],
          ),
          if (isWeighted) ...[
            const SizedBox(height: 10),
            const Text(
              'مقدار الزيادة لكل ضغطة (أقل من واحد صحيح):',
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF92400E)),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: presetSteps.map((s) {
                final selected = (weightStep - s).abs() < 0.001;
                final label = s == 0.25
                    ? '0.25 (ربع)'
                    : s == 0.5
                        ? '0.5 (نصف)'
                        : s == 0.125
                            ? '0.125 (ثمن)'
                            : '0.1 (عُشر)';
                return ChoiceChip(
                  label: Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  selected: selected,
                  selectedColor: const Color(0xFFF59E0B),
                  labelStyle: TextStyle(color: selected ? Colors.white : _kBrandDark),
                  onSelected: (_) {
                    customStepCtrl.text = '$s';
                    onStepChanged(s);
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: customStepCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'قيمة الزيادة المخصصة',
                      hintText: '0.25',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (v) {
                      final parsed = double.tryParse(v.trim());
                      if (parsed != null && parsed >= 0.05 && parsed <= 10) {
                        onStepChanged(parsed);
                      }
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: units.contains(weightUnit) ? weightUnit : 'كجم',
                    decoration: const InputDecoration(
                      labelText: 'وحدة القياس',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    items: units
                        .map((u) => DropdownMenuItem<String>(value: u, child: Text(u)))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) onUnitChanged(v);
                    },
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// 1. Full Edit Product Bottom Sheet
Future<bool> showMerchantEditProductSheet({
  required BuildContext context,
  required MerchantApiClient api,
  required Map<String, dynamic> product,
  required List<Map<String, dynamic>> categories,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _MerchantEditProductSheet(
      api: api,
      product: product,
      categories: categories,
    ),
  );
  return result == true;
}

class _MerchantEditProductSheet extends StatefulWidget {
  final MerchantApiClient api;
  final Map<String, dynamic> product;
  final List<Map<String, dynamic>> categories;

  const _MerchantEditProductSheet({
    required this.api,
    required this.product,
    required this.categories,
  });

  @override
  State<_MerchantEditProductSheet> createState() => _MerchantEditProductSheetState();
}

class _MerchantEditProductSheetState extends State<_MerchantEditProductSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _priceCtrl;
  late final TextEditingController _salePriceCtrl;
  late final TextEditingController _stockCtrl;
  late final TextEditingController _imageCtrl;
  late final TextEditingController _weightStepCtrl;

  late List<Map<String, dynamic>> _categories;
  String? _selectedCategoryId;
  bool _isAvailable = true;
  bool _isOffer = false;
  bool _isWeighted = false;
  double _weightStep = 0.25;
  String _weightUnit = 'كجم';
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    _categories = List<Map<String, dynamic>>.from(widget.categories);
    _nameCtrl = TextEditingController(text: (p['name_ar'] ?? '').toString());
    _priceCtrl = TextEditingController(text: '${_toDouble(p['base_price'] ?? p['price'])}');
    final rawSale = p['sale_price'];
    _salePriceCtrl = TextEditingController(
      text: rawSale != null && '$rawSale'.trim().isNotEmpty ? '${_toDouble(rawSale)}' : '',
    );
    _stockCtrl = TextEditingController(text: '${_toInt(p['stock_quantity'], 10)}');
    _imageCtrl = TextEditingController(text: (p['image_url'] ?? '').toString());
    _isAvailable = _toBool(p['is_available'], true);
    _isOffer = _toBool(p['is_offer'], false);
    _isWeighted = _toBool(p['is_weighted'], false);
    _weightStep = _toDouble(p['weight_step'], 0.25);
    if (_weightStep < 0.05) _weightStep = 0.25;
    _weightUnit = (p['weight_unit'] ?? 'كجم').toString().trim().isEmpty
        ? 'كجم'
        : (p['weight_unit'] ?? 'كجم').toString().trim();
    _weightStepCtrl = TextEditingController(text: '$_weightStep');

    final catId = (p['category_id'] ?? '').toString().trim();
    if (catId.isNotEmpty && _categories.any((c) => '${c['id']}' == catId)) {
      _selectedCategoryId = catId;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    _salePriceCtrl.dispose();
    _stockCtrl.dispose();
    _imageCtrl.dispose();
    _weightStepCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    final basePrice = double.tryParse(_priceCtrl.text.trim());
    final saleText = _salePriceCtrl.text.trim();
    final salePrice = saleText.isEmpty ? null : double.tryParse(saleText);
    final stock = int.tryParse(_stockCtrl.text.trim()) ?? 10;

    if (name.isEmpty) {
      setState(() => _error = 'يرجى إدخال اسم المنتج');
      return;
    }
    if (basePrice == null || basePrice < 0) {
      setState(() => _error = 'يرجى إدخال سعر أساسي صحيح');
      return;
    }
    if (saleText.isNotEmpty && (salePrice == null || salePrice < 0 || salePrice > basePrice)) {
      setState(() => _error = 'سعر العرض يجب أن يكون أقل من أو يساوي السعر الأساسي');
      return;
    }

    final parsedStep = double.tryParse(_weightStepCtrl.text.trim()) ?? _weightStep;
    if (_isWeighted && (parsedStep < 0.05 || parsedStep > 10)) {
      setState(() => _error = 'قيمة الزيادة بالوزن يجب أن تكون بين 0.05 و 10');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final effectiveOffer = _isOffer || (salePrice != null && salePrice < basePrice);
      await widget.api.updateProduct(
        productId: (widget.product['id'] ?? '').toString(),
        nameAr: name,
        categoryId: _selectedCategoryId,
        basePrice: basePrice,
        salePrice: salePrice,
        clearSalePrice: saleText.isEmpty,
        isOffer: effectiveOffer,
        stockQuantity: stock < 0 ? 0 : stock,
        isAvailable: _isAvailable,
        imageUrl: _imageCtrl.text.trim(),
        isWeighted: _isWeighted,
        weightStep: parsedStep,
        weightUnit: _weightUnit,
        minOrderQty: _isWeighted ? parsedStep : 1,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset + 18),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(Icons.edit_note_rounded, color: _kBrandPrimary, size: 26),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'تعديل بيانات المنتج',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ],
              ),
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 12.5, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'اسم المنتج',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              _CategorySelectorWithAdd(
                api: widget.api,
                categories: _categories,
                selectedCategoryId: _selectedCategoryId,
                labelText: 'القسم',
                onChanged: (v) => setState(() => _selectedCategoryId = v),
                onCategoryCreated: (newId, updatedCats) {
                  setState(() {
                    _categories = updatedCats;
                    _selectedCategoryId = newId;
                  });
                },
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _priceCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'السعر الأساسي (ج.م)',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _salePriceCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'سعر العرض (اختياري)',
                        hintText: 'أقل من الأساسي',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (v) {
                        final sale = double.tryParse(v.trim());
                        final base = double.tryParse(_priceCtrl.text.trim());
                        if (sale != null && base != null && sale < base && !_isOffer) {
                          setState(() => _isOffer = true);
                        }
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _stockCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'المخزون المتاح',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: const Text('ظاهر للعملاء', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                      value: _isAvailable,
                      activeColor: _kBrandGreen,
                      onChanged: (v) => setState(() => _isAvailable = v),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: _isOffer ? const Color(0xFFFFF1F2) : const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _isOffer ? _kBrandPrimary : const Color(0xFFE2E8F0)),
                ),
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'تحويل تلقائي إلى قسم العروض الرئيسي',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
                  ),
                  subtitle: const Text(
                    'يظهر المنتج للعملاء داخل قسم «العروض» مباشرة',
                    style: TextStyle(fontSize: 11),
                  ),
                  value: _isOffer,
                  activeColor: _kBrandPrimary,
                  onChanged: (v) => setState(() => _isOffer = v),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _imageCtrl,
                decoration: const InputDecoration(
                  labelText: 'رابط صورة المنتج (اختياري)',
                  hintText: 'https://...',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              _WeightedSettingsCard(
                isWeighted: _isWeighted,
                weightStep: _weightStep,
                weightUnit: _weightUnit,
                customStepCtrl: _weightStepCtrl,
                onWeightedChanged: (v) => setState(() => _isWeighted = v),
                onStepChanged: (s) => setState(() => _weightStep = s),
                onUnitChanged: (u) => setState(() => _weightUnit = u),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  style: FilledButton.styleFrom(
                    backgroundColor: _kBrandPrimary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(
                    _saving ? 'جاري حفظ التعديلات...' : 'حفظ التعديلات',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 2. Add New Product Sheet (Used inside Excel & Approvals tab)
Future<bool> showMerchantAddProductSheet({
  required BuildContext context,
  required MerchantApiClient api,
  required String merchantId,
  required List<Map<String, dynamic>> categories,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _MerchantAddProductSheet(
      api: api,
      merchantId: merchantId,
      categories: categories,
    ),
  );
  return result == true;
}

class _MerchantAddProductSheet extends StatefulWidget {
  final MerchantApiClient api;
  final String merchantId;
  final List<Map<String, dynamic>> categories;

  const _MerchantAddProductSheet({
    required this.api,
    required this.merchantId,
    required this.categories,
  });

  @override
  State<_MerchantAddProductSheet> createState() => _MerchantAddProductSheetState();
}

class _MerchantAddProductSheetState extends State<_MerchantAddProductSheet> {
  final _nameCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _salePriceCtrl = TextEditingController();
  final _stockCtrl = TextEditingController(text: '25');
  final _brandCtrl = TextEditingController();
  final _sizeCtrl = TextEditingController();
  final _imageCtrl = TextEditingController();
  final _weightStepCtrl = TextEditingController(text: '0.25');

  late List<Map<String, dynamic>> _categories;
  String? _selectedCategoryId;
  bool _isWeighted = false;
  double _weightStep = 0.25;
  String _weightUnit = 'كجم';
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _categories = List<Map<String, dynamic>>.from(widget.categories);
    if (_categories.isNotEmpty) {
      _selectedCategoryId = '${_categories.first['id']}';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    _salePriceCtrl.dispose();
    _stockCtrl.dispose();
    _brandCtrl.dispose();
    _sizeCtrl.dispose();
    _imageCtrl.dispose();
    _weightStepCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameCtrl.text.trim();
    final price = double.tryParse(_priceCtrl.text.trim());
    final saleText = _salePriceCtrl.text.trim();
    final sale = saleText.isEmpty ? null : double.tryParse(saleText);
    final stock = int.tryParse(_stockCtrl.text.trim()) ?? 20;

    if (name.isEmpty) {
      setState(() => _error = 'يرجى كتابة اسم المنتج');
      return;
    }
    if (price == null || price <= 0) {
      setState(() => _error = 'يرجى إدخال سعر بيع صحيح');
      return;
    }
    if (saleText.isNotEmpty && (sale == null || sale < 0 || sale > price)) {
      setState(() => _error = 'سعر العرض يجب أن يكون أقل من السعر الأساسي');
      return;
    }

    final parsedStep = double.tryParse(_weightStepCtrl.text.trim()) ?? _weightStep;
    if (_isWeighted && (parsedStep < 0.05 || parsedStep > 10)) {
      setState(() => _error = 'قيمة الزيادة بالوزن يجب أن تكون بين 0.05 و 10');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      String? catPath;
      if (_selectedCategoryId != null) {
        final found = _categories.where((c) => '${c['id']}' == _selectedCategoryId);
        if (found.isNotEmpty) {
          catPath = (found.first['full_path_ar'] ?? found.first['name_ar'] ?? '').toString();
        }
      }

      await widget.api.submitNewProductRequest(
        merchantId: widget.merchantId,
        productNameAr: name,
        categoryId: _selectedCategoryId,
        categoryPath: catPath,
        proposedPrice: price,
        proposedSalePrice: sale,
        proposedStock: stock < 0 ? 0 : stock,
        brand: _brandCtrl.text.trim(),
        sizeLabel: _sizeCtrl.text.trim(),
        imageUrl: _imageCtrl.text.trim(),
        isWeighted: _isWeighted,
        weightStep: parsedStep,
        weightUnit: _weightUnit,
      );

      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset + 18),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(Icons.add_box_rounded, color: _kBrandPrimary, size: 26),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'إضافة منتج جديد للاعتماد',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ],
              ),
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 12.5, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'اسم المنتج *',
                  hintText: 'مثال: جبنة رومي قديمة أو طماطم بلدي',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              _CategorySelectorWithAdd(
                api: widget.api,
                categories: _categories,
                selectedCategoryId: _selectedCategoryId,
                labelText: 'القسم',
                onChanged: (v) => setState(() => _selectedCategoryId = v),
                onCategoryCreated: (newId, updatedCats) {
                  setState(() {
                    _categories = updatedCats;
                    _selectedCategoryId = newId;
                  });
                },
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _priceCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'السعر (ج.م) *',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _salePriceCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'سعر العرض (اختياري)',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _stockCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'الكمية بالمخزون',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _sizeCtrl,
                      decoration: const InputDecoration(
                        labelText: 'الحجم / الوزن (اختياري)',
                        hintText: 'مثال: 1 كجم',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _brandCtrl,
                      decoration: const InputDecoration(
                        labelText: 'الماركة (اختياري)',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _imageCtrl,
                      decoration: const InputDecoration(
                        labelText: 'رابط الصورة (اختياري)',
                        hintText: 'https://...',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _WeightedSettingsCard(
                isWeighted: _isWeighted,
                weightStep: _weightStep,
                weightUnit: _weightUnit,
                customStepCtrl: _weightStepCtrl,
                onWeightedChanged: (v) => setState(() => _isWeighted = v),
                onStepChanged: (s) => setState(() => _weightStep = s),
                onUnitChanged: (u) => setState(() => _weightUnit = u),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: _kBrandPrimary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: _submitting
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.send_rounded),
                  label: Text(
                    _submitting ? 'جاري إرسال المنتج للاعتماد...' : 'إرسال المنتج للاعتماد',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 3. Add Products to Offers Modal (Automatically adds to main Offers section)
Future<bool> showMerchantAddToOffersSheet({
  required BuildContext context,
  required MerchantApiClient api,
  required String merchantId,
}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _MerchantAddToOffersSheet(api: api, merchantId: merchantId),
  );
  return changed == true;
}

class _MerchantAddToOffersSheet extends StatefulWidget {
  final MerchantApiClient api;
  final String merchantId;

  const _MerchantAddToOffersSheet({required this.api, required this.merchantId});

  @override
  State<_MerchantAddToOffersSheet> createState() => _MerchantAddToOffersSheetState();
}

class _MerchantAddToOffersSheetState extends State<_MerchantAddToOffersSheet> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _items = [];
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;
  bool _loading = true;
  bool _changedAny = false;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _loadPage(1);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadPage(int page) async {
    setState(() => _loading = true);
    try {
      final res = await widget.api.fetchStoreProductsPage(
        merchantId: widget.merchantId,
        page: page,
        limit: 20,
        query: _searchCtrl.text.trim(),
        availability: 'available',
      );
      if (!mounted) return;
      setState(() {
        _items = res.items;
        _page = res.page;
        _totalPages = res.totalPages;
        _total = res.total;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openOfferPriceDialog(Map<String, dynamic> p) async {
    final id = (p['id'] ?? '').toString();
    final name = (p['name_ar'] ?? '').toString();
    final basePrice = _toDouble(p['base_price'] ?? p['price']);
    final currentSale = p['sale_price'] != null ? _toDouble(p['sale_price']) : null;
    final alreadyOffer = _toBool(p['is_offer']);

    final ctrl = TextEditingController(
      text: currentSale != null && currentSale > 0 && currentSale < basePrice
          ? currentSale.toStringAsFixed(2)
          : (basePrice * 0.9).toStringAsFixed(2),
    );

    final action = await showDialog<String>(
      context: context,
      builder: (dCtx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text('إضافة "$name" للعروض', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'السعر الأساسي: ${basePrice.toStringAsFixed(2)} ج.م',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF475569)),
              ),
              const SizedBox(height: 10),
              const Text('اختر خصم سريع أو اكتب سعر العرض:', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: [10, 15, 20, 25].map((pct) {
                  return ActionChip(
                    label: Text('خصم $pct%', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                    onPressed: () {
                      ctrl.text = (basePrice * (1 - pct / 100)).toStringAsFixed(2);
                    },
                  );
                }).toList(),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: ctrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'سعر العرض الجديد (ج.م)',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'سيتم تحويل المنتج تلقائيًا ليظهر في قسم «العروض» الرئيسي للعملاء.',
                style: TextStyle(fontSize: 11, color: _kBrandGreen, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          actions: [
            if (alreadyOffer)
              TextButton(
                onPressed: () => Navigator.pop(dCtx, 'remove'),
                child: const Text('إزالة من العروض', style: TextStyle(color: Colors.red)),
              ),
            TextButton(
              onPressed: () => Navigator.pop(dCtx, null),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: _kBrandPrimary),
              onPressed: () => Navigator.pop(dCtx, 'save'),
              child: const Text('حفظ وتحويل للعروض'),
            ),
          ],
        ),
      ),
    );

    if (action == null) return;

    setState(() => _busyId = id);
    try {
      if (action == 'remove') {
        await widget.api.updateProduct(
          productId: id,
          clearSalePrice: true,
          isOffer: false,
        );
        _changedAny = true;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('تم إزالة "$name" من قسم العروض')),
          );
        }
      } else {
        final saleVal = double.tryParse(ctrl.text.trim());
        if (saleVal == null || saleVal < 0 || saleVal > basePrice) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('سعر العرض يجب أن يكون أقل من أو يساوي السعر الأساسي')),
            );
          }
          return;
        }
        await widget.api.updateProduct(
          productId: id,
          basePrice: basePrice,
          salePrice: saleVal,
          isOffer: true,
        );
        _changedAny = true;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: _kBrandGreen,
              content: Text('تم إضافة "$name" لقسم العروض الرئيسي بنجاح!'),
            ),
          );
        }
      }
      await _loadPage(_page);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        height: MediaQuery.of(context).size.height * 0.88,
        decoration: const BoxDecoration(
          color: Color(0xFFF8FAFC),
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(Icons.local_offer_rounded, color: _kBrandPrimary, size: 24),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'إضافة منتجات إلى قسم العروض',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                            ),
                            Text(
                              'أي منتج تضيف له عرض يتحول تلقائيًا لقسم العروض الرئيسي ($_total منتج)',
                              style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close_rounded),
                        onPressed: () => Navigator.pop(context, _changedAny),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _searchCtrl,
                    decoration: InputDecoration(
                      hintText: 'ابحث باسم المنتج...',
                      prefixIcon: const Icon(Icons.search_rounded),
                      filled: true,
                      fillColor: const Color(0xFFF1F5F9),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide.none,
                      ),
                      isDense: true,
                    ),
                    onChanged: (_) {
                      _debounce?.cancel();
                      _debounce = Timer(const Duration(milliseconds: 350), () => _loadPage(1));
                    },
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _items.isEmpty
                      ? const Center(child: Text('لا توجد منتجات مطابقة'))
                      : ListView.separated(
                          padding: const EdgeInsets.all(14),
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            final p = _items[i];
                            final id = (p['id'] ?? '').toString();
                            final name = (p['name_ar'] ?? '').toString();
                            final base = _toDouble(p['base_price'] ?? p['price']);
                            final sale = p['sale_price'] != null ? _toDouble(p['sale_price']) : null;
                            final isOffer = _toBool(p['is_offer']);
                            final busy = _busyId == id;

                            return Card(
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                                side: BorderSide(
                                  color: isOffer ? _kBrandPrimary.withOpacity(0.45) : const Color(0xFFE2E8F0),
                                ),
                              ),
                              child: ListTile(
                                title: Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                                subtitle: Text(
                                  isOffer && sale != null
                                      ? 'في العروض حاليًا: ${sale.toStringAsFixed(2)} ج.م بدلًا من ${base.toStringAsFixed(2)} ج.م'
                                      : 'السعر الحالي: ${base.toStringAsFixed(2)} ج.م',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: isOffer ? _kBrandPrimary : const Color(0xFF64748B),
                                    fontWeight: isOffer ? FontWeight.w700 : FontWeight.w500,
                                  ),
                                ),
                                trailing: busy
                                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                                    : FilledButton(
                                        style: FilledButton.styleFrom(
                                          backgroundColor: isOffer ? _kBrandGreen : _kBrandPrimary,
                                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                        ),
                                        onPressed: () => _openOfferPriceDialog(p),
                                        child: Text(
                                          isOffer ? 'تعديل العرض' : 'إضافة للعرض',
                                          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800),
                                        ),
                                      ),
                              ),
                            );
                          },
                        ),
            ),
            if (_totalPages > 1)
              Container(
                color: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _page > 1 && !_loading ? () => _loadPage(_page - 1) : null,
                      icon: const Icon(Icons.chevron_right_rounded),
                      label: const Text('السابق'),
                    ),
                    Text('صفحة $_page من $_totalPages', style: const TextStyle(fontWeight: FontWeight.w800)),
                    OutlinedButton.icon(
                      onPressed: _page < _totalPages && !_loading ? () => _loadPage(_page + 1) : null,
                      icon: const Icon(Icons.chevron_left_rounded),
                      label: const Text('التالي'),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 4. Products Swipe Card Deck
/// Displays all active merchant products as swipeable cards containing:
/// - Product Category (قسم المنتج)
/// - Product Name (اسم المنتج)
/// - Image Preview & Image URL (رابط الصورة)
/// Swipe RIGHT -> Skip to next product
/// Swipe LEFT  -> Stop/Hide product (is_available = false)
Future<bool> showMerchantProductsSwipeDeck({
  required BuildContext context,
  required MerchantApiClient api,
  required String merchantId,
  List<Map<String, dynamic>> categories = const [],
}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    enableDrag: false,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _MerchantProductsSwipeDeck(
      api: api,
      merchantId: merchantId,
      categories: categories,
    ),
  );
  return changed == true;
}

class _MerchantProductsSwipeDeck extends StatefulWidget {
  final MerchantApiClient api;
  final String merchantId;
  final List<Map<String, dynamic>> categories;

  const _MerchantProductsSwipeDeck({
    required this.api,
    required this.merchantId,
    this.categories = const [],
  });

  @override
  State<_MerchantProductsSwipeDeck> createState() => _MerchantProductsSwipeDeckState();
}

class _MerchantProductsSwipeDeckState extends State<_MerchantProductsSwipeDeck> {
  static const String _kEndSentinel = '__END__';
  static const int _kPageSize = 50;

  final List<Map<String, dynamic>> _deck = [];
  List<Map<String, dynamic>> _categories = [];
  int _index = 0;
  int _baseOffset = 0;
  int _nextPage = 1;
  bool _serverSupportsCursor = false;
  bool _hasMore = true;
  bool _fetchingMore = false;
  int _totalAvailable = 0;
  int _skippedCount = 0;
  int _hiddenCount = 0;
  bool _loading = true;
  bool _busyAction = false;
  bool _changedAny = false;
  bool _completedAll = false;
  String? _loadError;
  double _dragDx = 0;
  String? _lastSavedProductId;
  int _lastSavedCardIndex = -1;

  String get _localBookmarkKey => 'otlobha_merchant_swipe_bookmark_${widget.merchantId}';

  int get _currentAbsoluteIndex => (_baseOffset + _index - _hiddenCount).clamp(0, 999999);

  @override
  void initState() {
    super.initState();
    _categories = List<Map<String, dynamic>>.from(widget.categories);
    if (_categories.isEmpty) {
      unawaited(_ensureCategoriesLoaded());
    }
    unawaited(_initAndRestoreDeck());
  }

  @override
  void dispose() {
    if (_deck.isNotEmpty) {
      _persistCurrentCardPosition(force: true);
    }
    super.dispose();
  }

  Future<void> _ensureCategoriesLoaded() async {
    try {
      final cats = await widget.api.fetchCategories();
      if (mounted && cats.isNotEmpty) {
        setState(() => _categories = cats);
      }
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> _readLocalBookmark() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_localBookmarkKey);
      if (raw == null || raw.trim().isEmpty) return null;
      final decoded = jsonDecode(raw);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {}
    return null;
  }

  Future<void> _writeLocalBookmark({
    required String productId,
    required int cardIndex,
    required bool pendingSync,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _localBookmarkKey,
        jsonEncode({
          'product_id': productId,
          'card_index': cardIndex,
          'pending_sync': pendingSync,
          'updated_at': DateTime.now().millisecondsSinceEpoch,
        }),
      );
    } catch (_) {}
  }

  Future<void> _persistProgress({
    required String productId,
    required int cardIndex,
    bool force = false,
  }) async {
    final safeIdx = cardIndex < 0 ? 0 : cardIndex;
    if (!force && _lastSavedProductId == productId && _lastSavedCardIndex == safeIdx) {
      return;
    }
    _lastSavedProductId = productId;
    _lastSavedCardIndex = safeIdx;

    // 1. Always write locally first so closing the app or logging out immediately never loses progress.
    await _writeLocalBookmark(
      productId: productId,
      cardIndex: safeIdx,
      pendingSync: true,
    );

    // 2. Persist to server account so logging out of the email or switching phones resumes identically.
    try {
      await widget.api.saveSwipeDeckProgress(
        merchantId: widget.merchantId,
        productId: productId,
        cardIndex: safeIdx,
      );
      await _writeLocalBookmark(
        productId: productId,
        cardIndex: safeIdx,
        pendingSync: false,
      );
    } catch (_) {
      // Keep pending_sync=true locally so the next open automatically syncs it once server is reachable.
    }
  }

  void _persistCurrentCardPosition({bool force = false}) {
    if (_index < _deck.length) {
      final productId = (_deck[_index]['id'] ?? '').toString().trim();
      if (productId.isNotEmpty) {
        unawaited(
          _persistProgress(
            productId: productId,
            cardIndex: _currentAbsoluteIndex,
            force: force,
          ),
        );
      }
    } else if (!_hasMore && _completedAll && _totalAvailable > 0) {
      unawaited(
        _persistProgress(
          productId: _kEndSentinel,
          cardIndex: _totalAvailable,
          force: force,
        ),
      );
    }
  }

  Future<void> _initAndRestoreDeck() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _completedAll = false;
        _loadError = null;
      });
    }

    final local = await _readLocalBookmark();
    if (local != null && local['pending_sync'] == true) {
      final localPid = (local['product_id'] ?? '').toString().trim();
      final localIdx = _toInt(local['card_index']);
      try {
        await widget.api.saveSwipeDeckProgress(
          merchantId: widget.merchantId,
          productId: localPid,
          cardIndex: localIdx,
        );
        await _writeLocalBookmark(
          productId: localPid,
          cardIndex: localIdx,
          pendingSync: false,
        );
      } catch (_) {}
    }

    String savedProductId = '';
    int resolvedOffset = 0;
    int totalAvailable = 0;
    bool isCompleted = false;
    bool loadedFromServer = false;

    try {
      final progress = await widget.api.fetchSwipeDeckProgress(widget.merchantId);
      savedProductId = (progress['product_id'] ?? '').toString().trim();
      resolvedOffset = _toInt(progress['resolved_offset']);
      totalAvailable = _toInt(progress['total_available']);
      isCompleted = progress['is_completed'] == true;
      loadedFromServer = true;
    } catch (_) {
      loadedFromServer = false;
      if (local != null) {
        savedProductId = (local['product_id'] ?? '').toString().trim();
        resolvedOffset = _toInt(local['card_index']);
        isCompleted = savedProductId == _kEndSentinel;
      }
    }

    if (!mounted) return;
    _serverSupportsCursor = loadedFromServer;

    if (isCompleted && (totalAvailable > 0 || !loadedFromServer)) {
      setState(() {
        _deck.clear();
        _index = 0;
        _baseOffset = totalAvailable;
        _totalAvailable = totalAvailable;
        _hasMore = false;
        _completedAll = true;
        _loading = false;
      });
      return;
    }

    try {
      MerchantProductsPageResult res;
      int initialIndex = 0;
      int initialBaseOffset = 0;
      int nextPage = 2;

      if (_serverSupportsCursor) {
        if (savedProductId.isNotEmpty && savedProductId != _kEndSentinel) {
          res = await widget.api.fetchStoreProductsPage(
            merchantId: widget.merchantId,
            page: 1,
            limit: _kPageSize,
            noImageOnly: false,
            availability: 'available',
            sort: 'id_asc',
            fromId: savedProductId,
          );
          if (res.items.isEmpty && totalAvailable > 0) {
            final fallbackOffset = resolvedOffset.clamp(0, totalAvailable - 1);
            res = await widget.api.fetchStoreProductsPage(
              merchantId: widget.merchantId,
              page: (fallbackOffset ~/ _kPageSize) + 1,
              limit: _kPageSize,
              noImageOnly: false,
              availability: 'available',
              sort: 'id_asc',
              offset: fallbackOffset,
            );
            resolvedOffset = fallbackOffset;
          }
        } else {
          res = await widget.api.fetchStoreProductsPage(
            merchantId: widget.merchantId,
            page: (resolvedOffset ~/ _kPageSize) + 1,
            limit: _kPageSize,
            noImageOnly: false,
            availability: 'available',
            sort: 'id_asc',
            offset: resolvedOffset,
          );
        }
        initialBaseOffset = resolvedOffset;
        initialIndex = 0;
        nextPage = (resolvedOffset ~/ _kPageSize) + 2;
      } else {
        // Fallback mode when backend is running an older version without /swipe-progress & keyset params:
        // Use standard page-based pagination so we resume directly on the saved page and traverse ALL products.
        final targetPage = resolvedOffset > 0 ? (resolvedOffset ~/ _kPageSize) + 1 : 1;
        res = await widget.api.fetchStoreProductsPage(
          merchantId: widget.merchantId,
          page: targetPage,
          limit: _kPageSize,
          noImageOnly: false,
          availability: 'available',
          sort: 'id_asc',
        );
        if (res.items.isEmpty && targetPage > 1) {
          res = await widget.api.fetchStoreProductsPage(
            merchantId: widget.merchantId,
            page: 1,
            limit: _kPageSize,
            noImageOnly: false,
            availability: 'available',
            sort: 'id_asc',
          );
          initialBaseOffset = 0;
          initialIndex = 0;
          nextPage = 2;
        } else {
          initialBaseOffset = (res.page - 1) * res.limit;
          nextPage = res.page + 1;
          if (savedProductId.isNotEmpty && savedProductId != _kEndSentinel) {
            final foundAt = res.items.indexWhere((e) => '${e['id']}' == savedProductId);
            if (foundAt >= 0) {
              initialIndex = foundAt;
            } else if (res.items.isNotEmpty) {
              initialIndex = (resolvedOffset - initialBaseOffset).clamp(0, res.items.length - 1);
            }
          } else if (resolvedOffset > 0 && res.items.isNotEmpty) {
            initialIndex = (resolvedOffset - initialBaseOffset).clamp(0, res.items.length - 1);
          }
        }
      }

      if (!mounted) return;
      final computedTotal = totalAvailable > 0
          ? totalAvailable
          : (res.totalAll > 0 ? (res.totalAll - res.totalUnavailable) : res.total).clamp(res.items.length, 999999);

      setState(() {
        _deck
          ..clear()
          ..addAll(res.items);
        _index = res.items.isNotEmpty ? initialIndex.clamp(0, res.items.length - 1) : 0;
        _baseOffset = initialBaseOffset.clamp(0, computedTotal);
        _nextPage = nextPage;
        _totalAvailable = computedTotal;
        _hasMore = _serverSupportsCursor
            ? res.hasMore
            : (res.hasMore || res.page < res.totalPages);
        _completedAll = res.items.isEmpty && computedTotal > 0;
        _loading = false;
      });

      // Only persist current position if we actually have items (never overwrite a saved bookmark on empty load).
      if (_deck.isNotEmpty) {
        _lastSavedProductId = (_deck[_index]['id'] ?? '').toString().trim();
        _lastSavedCardIndex = _currentAbsoluteIndex;
        _maybePrefetch();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadError = e.toString();
        });
      }
    }
  }

  Future<void> _loadNextBatch() async {
    if (!_hasMore || _fetchingMore) return;
    _fetchingMore = true;
    if (mounted) {
      setState(() {
        _loadError = null;
        if (_deck.isEmpty || _index >= _deck.length) {
          _loading = true;
        }
      });
    }
    try {
      final existingIds = _deck.map((e) => '${e['id']}').toSet();
      MerchantProductsPageResult res;
      List<Map<String, dynamic>> fresh = const [];

      if (_serverSupportsCursor) {
        final lastId = _deck.isNotEmpty ? (_deck.last['id'] ?? '').toString().trim() : '';
        res = await widget.api.fetchStoreProductsPage(
          merchantId: widget.merchantId,
          page: _nextPage,
          limit: _kPageSize,
          noImageOnly: false,
          availability: 'available',
          sort: 'id_asc',
          afterId: lastId.isNotEmpty ? lastId : null,
          offset: lastId.isEmpty ? _baseOffset : 0,
        );
        fresh = res.items.where((e) => !existingIds.contains('${e['id']}')).toList();

        // Safety fallback: if server ignored after_id and returned duplicates while claiming hasMore,
        // automatically switch to page-based pagination so we NEVER stop at 30/50 products!
        if (fresh.isEmpty && (res.hasMore || res.page < res.totalPages)) {
          _serverSupportsCursor = false;
          res = await widget.api.fetchStoreProductsPage(
            merchantId: widget.merchantId,
            page: _nextPage,
            limit: _kPageSize,
            noImageOnly: false,
            availability: 'available',
            sort: 'id_asc',
          );
          fresh = res.items.where((e) => !existingIds.contains('${e['id']}')).toList();
          _nextPage = res.page + 1;
        }
      } else {
        // Page-based pagination: loop past any duplicate-only page caused by hidden items shifting offsets.
        var pageToFetch = _nextPage;
        res = const MerchantProductsPageResult.empty();
        for (var attempts = 0; attempts < 3; attempts++) {
          res = await widget.api.fetchStoreProductsPage(
            merchantId: widget.merchantId,
            page: pageToFetch,
            limit: _kPageSize,
            noImageOnly: false,
            availability: 'available',
            sort: 'id_asc',
          );
          fresh = res.items.where((e) => !existingIds.contains('${e['id']}')).toList();
          pageToFetch = res.page + 1;
          if (fresh.isNotEmpty || (!res.hasMore && res.page >= res.totalPages)) {
            break;
          }
        }
        _nextPage = pageToFetch;
      }

      if (!mounted) return;
      final stillHasMore = _serverSupportsCursor
          ? (res.hasMore && fresh.isNotEmpty)
          : (res.hasMore || res.page < res.totalPages);

      setState(() {
        _deck.addAll(fresh);
        if (_totalAvailable == 0) {
          _totalAvailable = (res.totalAll > 0 ? (res.totalAll - res.totalUnavailable) : res.total)
              .clamp(_deck.length, 999999);
        }
        _hasMore = stillHasMore;
        if (_index >= _deck.length && !_hasMore) {
          _completedAll = true;
        }
        _loading = false;
      });

      if (_index < _deck.length) {
        _persistCurrentCardPosition();
      } else if (!_hasMore && _completedAll) {
        _persistCurrentCardPosition(force: true);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadError = e.toString();
        });
      }
    } finally {
      _fetchingMore = false;
    }
  }

  Future<void> _resetToFirstCard() async {
    if (_busyAction) return;
    setState(() {
      _busyAction = true;
      _loading = true;
      _loadError = null;
      _skippedCount = 0;
      _hiddenCount = 0;
      _baseOffset = 0;
      _nextPage = 1;
      _index = 0;
      _completedAll = false;
      _deck.clear();
    });
    await _persistProgress(productId: '', cardIndex: 0, force: true);
    if (!mounted) return;
    setState(() => _busyAction = false);
    await _initAndRestoreDeck();
  }

  void _maybePrefetch() {
    if (_hasMore && !_fetchingMore && (_deck.length - _index) <= 10) {
      unawaited(_loadNextBatch());
    }
  }

  Future<void> _handleSwipeRightSkip() async {
    if (_busyAction || _index >= _deck.length) return;
    setState(() {
      _skippedCount++;
      _index++;
      _dragDx = 0;
      if (_index >= _deck.length && !_hasMore) {
        _completedAll = true;
      }
    });
    _persistCurrentCardPosition();
    _maybePrefetch();
  }

  Future<void> _handleSwipeLeftHide() async {
    if (_busyAction || _index >= _deck.length) return;
    final product = _deck[_index];
    final id = (product['id'] ?? '').toString();
    final name = (product['name_ar'] ?? '').toString();

    setState(() {
      _busyAction = true;
      _dragDx = 0;
    });
    try {
      await widget.api.updateProduct(productId: id, isAvailable: false);
      _changedAny = true;
      if (!mounted) return;
      setState(() {
        _hiddenCount++;
        if (_totalAvailable > 0) _totalAvailable--;
        _index++;
        _busyAction = false;
        if (_index >= _deck.length && !_hasMore) {
          _completedAll = true;
        }
      });
      _persistCurrentCardPosition(force: true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 2),
          backgroundColor: const Color(0xFFB91C1C),
          content: Text('تم إيقاف ظهور "$name" ونقله للمتوقفة عن الظهور'),
        ),
      );
      _maybePrefetch();
    } catch (e) {
      if (mounted) {
        setState(() => _busyAction = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _editCurrentCardDetails() async {
    if (_busyAction || _index >= _deck.length) return;
    if (_categories.isEmpty) {
      await _ensureCategoriesLoaded();
    }
    if (!mounted) return;
    final product = _deck[_index];

    final updated = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _SwipeCardEditSheet(
        api: widget.api,
        product: product,
        categories: _categories,
        onCategoriesChanged: (updatedCats) {
          if (mounted) {
            setState(() => _categories = updatedCats);
          }
        },
      ),
    );

    if (updated == null || !mounted) return;
    _changedAny = true;
    setState(() {
      _deck[_index] = {
        ...product,
        ...updated,
      };
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 2),
        backgroundColor: _kBrandGreen,
        content: Text('تم حفظ تعديلات "${updated['name_ar'] ?? product['name_ar'] ?? ''}" بنجاح'),
      ),
    );
  }

  Future<void> _closeDeck() async {
    if (_index < _deck.length) {
      final productId = (_deck[_index]['id'] ?? '').toString().trim();
      if (productId.isNotEmpty) {
        await _persistProgress(
          productId: productId,
          cardIndex: _currentAbsoluteIndex,
          force: true,
        );
      }
    }
    if (mounted) {
      Navigator.pop(context, _changedAny);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = _index < _deck.length ? _deck[_index] : null;
    final swipeProgress = (_dragDx / 110).clamp(-1.0, 1.0);
    final currentImgUrl = current != null ? (current['image_url'] ?? '').toString().trim() : '';
    final currentCategory = current != null
        ? (current['category_name'] ?? current['category_name_ar'] ?? 'بدون قسم').toString().trim()
        : '';
    final displayTotal = _totalAvailable > 0 ? _totalAvailable : _deck.length;
    final currentPosition = (_currentAbsoluteIndex + 1).clamp(1, displayTotal > 0 ? displayTotal : 1);
    final remainingCount = (displayTotal - _currentAbsoluteIndex).clamp(0, 999999);
    final canRestartFromBeginning = _currentAbsoluteIndex > 0 || _completedAll;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        height: MediaQuery.of(context).size.height * 0.88,
        decoration: const BoxDecoration(
          color: Color(0xFFF8FAFC),
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.style_rounded, color: Color(0xFFD97706), size: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'قسم المنتجات (بطاقات السحب السريع)',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                        ),
                        Text(
                          'متبقي $remainingCount • تم التخطي $_skippedCount • تم الإيقاف $_hiddenCount',
                          style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
                        ),
                      ],
                    ),
                  ),
                  if (canRestartFromBeginning && !_loading)
                    IconButton(
                      tooltip: 'البدء من أول بطاقة',
                      onPressed: _busyAction ? null : _resetToFirstCard,
                      icon: const Icon(Icons.restart_alt_rounded, color: _kBrandPrimary),
                    ),
                  FilledButton.tonalIcon(
                    onPressed: _closeDeck,
                    icon: const Icon(Icons.close_rounded, size: 18),
                    label: const Text('إغلاق'),
                  ),
                ],
              ),
            ),
            // Clear swipe legend bar
            Container(
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(Icons.arrow_forward_rounded, color: _kBrandGreen, size: 18),
                      SizedBox(width: 4),
                      Text(
                        'اسحب يمين للتخطي',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: _kBrandGreen),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Text(
                        'اسحب يسار للإيقاف',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFFDC2626)),
                      ),
                      SizedBox(width: 4),
                      Icon(Icons.arrow_back_rounded, color: Color(0xFFDC2626), size: 18),
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading || (current == null && _hasMore && _fetchingMore)
                  ? const Center(child: CircularProgressIndicator())
                  : current == null && _hasMore
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.cloud_sync_rounded, size: 56, color: Color(0xFFD97706)),
                                const SizedBox(height: 12),
                                const Text(
                                  'يوجد المزيد من المنتجات للمراجعة',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w900),
                                ),
                                if (_loadError != null && _loadError!.trim().isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    _loadError!,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                  ),
                                ],
                                const SizedBox(height: 16),
                                FilledButton.icon(
                                  style: FilledButton.styleFrom(backgroundColor: _kBrandPrimary),
                                  onPressed: _deck.isEmpty ? _initAndRestoreDeck : _loadNextBatch,
                                  icon: const Icon(Icons.refresh_rounded, size: 18),
                                  label: const Text('تحميل الدفعة التالية'),
                                ),
                              ],
                            ),
                          ),
                        )
                  : current == null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.check_circle_rounded, size: 64, color: _kBrandGreen),
                                const SizedBox(height: 12),
                                const Text(
                                  'انتهت مراجعة جميع المنتجات!',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  _skippedCount > 0 || _hiddenCount > 0
                                      ? 'تم إيقاف ظهور $_hiddenCount منتج وتخطي $_skippedCount منتج.'
                                      : 'تم الوصول لآخر بطاقة محفوظة على حسابك.',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Color(0xFF64748B)),
                                ),
                                const SizedBox(height: 16),
                                Wrap(
                                  spacing: 10,
                                  runSpacing: 10,
                                  alignment: WrapAlignment.center,
                                  children: [
                                    if (displayTotal > 0)
                                      FilledButton.icon(
                                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFFD97706)),
                                        onPressed: _resetToFirstCard,
                                        icon: const Icon(Icons.restart_alt_rounded, size: 18),
                                        label: const Text('البدء من أول بطاقة'),
                                      ),
                                    FilledButton(
                                      style: FilledButton.styleFrom(backgroundColor: _kBrandPrimary),
                                      onPressed: _closeDeck,
                                      child: const Text('العودة لقسم منتجاتي'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        )
                      : Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                            child: GestureDetector(
                              onHorizontalDragUpdate: _busyAction
                                  ? null
                                  : (d) => setState(() => _dragDx += d.delta.dx),
                              onHorizontalDragEnd: _busyAction
                                  ? null
                                  : (d) {
                                      // Positive dx = swipe RIGHT -> Skip
                                      // Negative dx = swipe LEFT  -> Hide/Disable product
                                      if (_dragDx > 95 || (d.primaryVelocity ?? 0) > 650) {
                                        _handleSwipeRightSkip();
                                      } else if (_dragDx < -95 || (d.primaryVelocity ?? 0) < -650) {
                                        _handleSwipeLeftHide();
                                      } else {
                                        setState(() => _dragDx = 0);
                                      }
                                    },
                              child: AnimatedContainer(
                                duration: Duration(milliseconds: _dragDx == 0 ? 220 : 0),
                                transform: Matrix4.identity()
                                  ..translate(_dragDx, 0.0)
                                  ..rotateZ(swipeProgress * 0.07),
                                child: Container(
                                  width: double.infinity,
                                  constraints: const BoxConstraints(maxHeight: 470),
                                  padding: const EdgeInsets.all(18),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(24),
                                    border: Border.all(
                                      width: 2.5,
                                      color: swipeProgress > 0.2
                                          ? _kBrandGreen
                                          : swipeProgress < -0.2
                                              ? const Color(0xFFDC2626)
                                              : const Color(0xFFE2E8F0),
                                    ),
                                    boxShadow: const [
                                      BoxShadow(
                                        color: Color(0x180F172A),
                                        blurRadius: 20,
                                        offset: Offset(0, 8),
                                      ),
                                    ],
                                  ),
                                  child: SingleChildScrollView(
                                    child: Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        if (swipeProgress.abs() > 0.2)
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                                            margin: const EdgeInsets.only(bottom: 10),
                                            decoration: BoxDecoration(
                                              color: swipeProgress > 0
                                                  ? _kBrandGreen.withOpacity(0.14)
                                                  : const Color(0xFFFEE2E2),
                                              borderRadius: BorderRadius.circular(99),
                                            ),
                                            child: Text(
                                              swipeProgress > 0 ? 'تخطي المنتج ←' : '→ إيقاف المنتج',
                                              style: TextStyle(
                                                fontWeight: FontWeight.w900,
                                                fontSize: 13.5,
                                                color: swipeProgress > 0 ? _kBrandGreen : const Color(0xFFDC2626),
                                              ),
                                            ),
                                          ),
                                        // Product Image Preview (tappable to edit)
                                        GestureDetector(
                                          onTap: _busyAction ? null : _editCurrentCardDetails,
                                          child: ClipRRect(
                                            borderRadius: BorderRadius.circular(18),
                                            child: Container(
                                              width: 108,
                                              height: 108,
                                              color: const Color(0xFFF8FAFC),
                                              child: currentImgUrl.isNotEmpty
                                                  ? Image.network(
                                                      currentImgUrl,
                                                      fit: BoxFit.cover,
                                                      errorBuilder: (_, __, ___) => const Center(
                                                        child: Icon(
                                                          Icons.broken_image_outlined,
                                                          size: 42,
                                                          color: Color(0xFFD97706),
                                                        ),
                                                      ),
                                                    )
                                                  : const Center(
                                                      child: Icon(
                                                        Icons.hide_image_outlined,
                                                        size: 42,
                                                        color: Color(0xFFD97706),
                                                      ),
                                                    ),
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 12),
                                        // Product Category (قسم المنتج — tappable to edit)
                                        InkWell(
                                          onTap: _busyAction ? null : _editCurrentCardDetails,
                                          borderRadius: BorderRadius.circular(99),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFFEF3C7),
                                              borderRadius: BorderRadius.circular(99),
                                            ),
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                const Icon(Icons.category_rounded, size: 14, color: Color(0xFFB45309)),
                                                const SizedBox(width: 5),
                                                Flexible(
                                                  child: Text(
                                                    'القسم: ${currentCategory.isNotEmpty ? currentCategory : 'بدون قسم'}',
                                                    maxLines: 1,
                                                    overflow: TextOverflow.ellipsis,
                                                    style: const TextStyle(
                                                      fontSize: 12.5,
                                                      fontWeight: FontWeight.w800,
                                                      color: Color(0xFF92400E),
                                                    ),
                                                  ),
                                                ),
                                                const SizedBox(width: 5),
                                                const Icon(Icons.edit_rounded, size: 13, color: Color(0xFFB45309)),
                                              ],
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        // Product Name (اسم المنتج — tappable to edit)
                                        InkWell(
                                          onTap: _busyAction ? null : _editCurrentCardDetails,
                                          borderRadius: BorderRadius.circular(10),
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                            child: Text(
                                              (current['name_ar'] ?? '').toString(),
                                              textAlign: TextAlign.center,
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                fontSize: 18,
                                                fontWeight: FontWeight.w900,
                                                color: _kBrandDark,
                                              ),
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        // Product Image URL (رابط الصورة — tappable to edit)
                                        InkWell(
                                          onTap: _busyAction ? null : _editCurrentCardDetails,
                                          borderRadius: BorderRadius.circular(12),
                                          child: Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFF8FAFC),
                                              borderRadius: BorderRadius.circular(12),
                                              border: Border.all(color: const Color(0xFFE2E8F0)),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                const Row(
                                                  children: [
                                                    Icon(Icons.link_rounded, size: 15, color: Color(0xFF475569)),
                                                    SizedBox(width: 5),
                                                    Text(
                                                      'رابط الصورة:',
                                                      style: TextStyle(
                                                        fontSize: 11.5,
                                                        fontWeight: FontWeight.w800,
                                                        color: Color(0xFF475569),
                                                      ),
                                                    ),
                                                    Spacer(),
                                                    Text(
                                                      'اضغط للتعديل',
                                                      style: TextStyle(
                                                        fontSize: 11,
                                                        fontWeight: FontWeight.w800,
                                                        color: _kBrandPrimary,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                                const SizedBox(height: 4),
                                                Text(
                                                  currentImgUrl.isNotEmpty ? currentImgUrl : 'لا يوجد رابط صورة (اضغط للإضافة)',
                                                  textDirection: currentImgUrl.isNotEmpty ? TextDirection.ltr : TextDirection.rtl,
                                                  maxLines: 2,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    fontSize: 11.5,
                                                    fontWeight: FontWeight.w600,
                                                    color: currentImgUrl.isNotEmpty
                                                        ? const Color(0xFF0F172A)
                                                        : const Color(0xFF94A3B8),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        InkWell(
                                          onTap: _busyAction ? null : _editCurrentCardDetails,
                                          borderRadius: BorderRadius.circular(12),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFF1F5F9),
                                              borderRadius: BorderRadius.circular(12),
                                            ),
                                            child: Text(
                                              'السعر: ${_toDouble(current['base_price'] ?? current['price']).toStringAsFixed(2)} ج.م  •  المخزون: ${_toInt(current['stock_quantity'])}',
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w800,
                                                fontSize: 12.5,
                                                color: _kBrandPrimary,
                                              ),
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        OutlinedButton.icon(
                                          onPressed: _busyAction ? null : _editCurrentCardDetails,
                                          style: OutlinedButton.styleFrom(
                                            foregroundColor: _kBrandPrimary,
                                            side: const BorderSide(color: _kBrandPrimary),
                                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                          ),
                                          icon: const Icon(Icons.edit_rounded, size: 16),
                                          label: const Text(
                                            'تعديل بيانات البطاقة (القسم، الاسم، الصورة، السعر)',
                                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          'بطاقة $currentPosition من $displayTotal • محفوظة تلقائياً',
                                          style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w700),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
            ),
            if (current != null)
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
                child: Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busyAction ? null : _handleSwipeRightSkip,
                        style: FilledButton.styleFrom(
                          backgroundColor: _kBrandGreen,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        icon: const Icon(Icons.skip_next_rounded, size: 20),
                        label: const Text('تخطي (يمين)', style: TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.tonalIcon(
                      onPressed: _busyAction ? null : _editCurrentCardDetails,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFFFEF3C7),
                        foregroundColor: const Color(0xFF92400E),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      ),
                      icon: const Icon(Icons.edit_rounded, size: 18),
                      label: const Text('تعديل', style: TextStyle(fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busyAction ? null : _handleSwipeLeftHide,
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFDC2626),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        icon: const Icon(Icons.visibility_off_rounded, size: 20),
                        label: const Text('إيقاف (يسار)', style: TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SwipeCardEditSheet extends StatefulWidget {
  final MerchantApiClient api;
  final Map<String, dynamic> product;
  final List<Map<String, dynamic>> categories;
  final ValueChanged<List<Map<String, dynamic>>>? onCategoriesChanged;

  const _SwipeCardEditSheet({
    required this.api,
    required this.product,
    required this.categories,
    this.onCategoriesChanged,
  });

  @override
  State<_SwipeCardEditSheet> createState() => _SwipeCardEditSheetState();
}

class _SwipeCardEditSheetState extends State<_SwipeCardEditSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _imageCtrl;
  late final TextEditingController _priceCtrl;
  late final TextEditingController _stockCtrl;
  late List<Map<String, dynamic>> _categories;
  String? _selectedCategoryId;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    _categories = List<Map<String, dynamic>>.from(widget.categories);
    _nameCtrl = TextEditingController(text: (p['name_ar'] ?? '').toString());
    _imageCtrl = TextEditingController(text: (p['image_url'] ?? '').toString());
    _priceCtrl = TextEditingController(text: _toDouble(p['base_price'] ?? p['price']).toString());
    _stockCtrl = TextEditingController(text: _toInt(p['stock_quantity']).toString());

    final catId = (p['category_id'] ?? '').toString();
    if (catId.isNotEmpty && _categories.any((c) => '${c['id']}' == catId)) {
      _selectedCategoryId = catId;
    } else if (_categories.isNotEmpty) {
      _selectedCategoryId = '${_categories.first['id']}';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _imageCtrl.dispose();
    _priceCtrl.dispose();
    _stockCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'يرجى كتابة اسم المنتج');
      return;
    }
    final price = double.tryParse(_priceCtrl.text.trim().replaceAll(',', '.'));
    if (price == null || price < 0) {
      setState(() => _error = 'يرجى إدخال سعر صحيح');
      return;
    }
    final stock = int.tryParse(_stockCtrl.text.trim()) ?? _toInt(widget.product['stock_quantity']);
    final imageUrl = _imageCtrl.text.trim();

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await widget.api.updateProduct(
        productId: (widget.product['id'] ?? '').toString(),
        nameAr: name,
        categoryId: _selectedCategoryId,
        imageUrl: imageUrl,
        basePrice: price,
        stockQuantity: stock < 0 ? 0 : stock,
      );

      String nextCategoryName = (widget.product['category_name'] ?? widget.product['category_name_ar'] ?? 'بدون قسم').toString();
      if (_selectedCategoryId != null) {
        final match = _categories.where((c) => '${c['id']}' == _selectedCategoryId);
        if (match.isNotEmpty) {
          nextCategoryName = (match.first['full_path_ar'] ?? match.first['name_ar'] ?? nextCategoryName).toString();
        }
      }

      if (!mounted) return;
      Navigator.pop<Map<String, dynamic>>(context, {
        'name_ar': name,
        if (_selectedCategoryId != null) 'category_id': _selectedCategoryId,
        'category_name': nextCategoryName,
        'category_name_ar': nextCategoryName,
        'image_url': imageUrl,
        'base_price': price,
        'price': price,
        'stock_quantity': stock < 0 ? 0 : stock,
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: EdgeInsets.fromLTRB(16, 14, 16, bottomInset + 18),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(Icons.edit_note_rounded, color: _kBrandPrimary, size: 26),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'تعديل معلومات البطاقة',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(context, null),
                  ),
                ],
              ),
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 12.5, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              _CategorySelectorWithAdd(
                api: widget.api,
                categories: _categories,
                selectedCategoryId: _selectedCategoryId,
                labelText: 'قسم المنتج',
                onChanged: (v) => setState(() => _selectedCategoryId = v),
                onCategoryCreated: (newId, updatedCats) {
                  setState(() {
                    _categories = updatedCats;
                    _selectedCategoryId = newId;
                  });
                  widget.onCategoriesChanged?.call(updatedCats);
                },
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'اسم المنتج *',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _imageCtrl,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: 'رابط الصورة (URL)',
                  hintText: 'https://...',
                  border: const OutlineInputBorder(),
                  isDense: true,
                  suffixIcon: IconButton(
                    tooltip: 'مسح الرابط',
                    icon: const Icon(Icons.clear_rounded, size: 18),
                    onPressed: () => _imageCtrl.clear(),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _priceCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'السعر (ج.م)',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _stockCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'المخزون',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  style: FilledButton.styleFrom(
                    backgroundColor: _kBrandPrimary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(
                    _saving ? 'جاري حفظ التعديلات...' : 'حفظ التعديلات',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CategorySelectorWithAdd extends StatelessWidget {
  final MerchantApiClient api;
  final List<Map<String, dynamic>> categories;
  final String? selectedCategoryId;
  final String labelText;
  final ValueChanged<String?> onChanged;
  final void Function(String newCategoryId, List<Map<String, dynamic>> updatedCategories) onCategoryCreated;

  const _CategorySelectorWithAdd({
    required this.api,
    required this.categories,
    required this.selectedCategoryId,
    required this.labelText,
    required this.onChanged,
    required this.onCategoryCreated,
  });

  Future<void> _openCreateDialog(BuildContext context) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => _CreateCategoryDialog(
        api: api,
        categories: categories,
      ),
    );
    if (result == null) return;
    final newId = (result['id'] ?? '').toString().trim();
    final updatedCats = (result['categories'] as List<Map<String, dynamic>>?) ?? categories;
    final createdName = (result['name_ar'] ?? '').toString().trim();
    if (newId.isNotEmpty) {
      onCategoryCreated(newId, updatedCats);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            duration: const Duration(seconds: 2),
            backgroundColor: _kBrandGreen,
            content: Text('تم إضافة القسم "$createdName" واختياره بنجاح ✓'),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final validSelected = (selectedCategoryId != null &&
            categories.any((c) => '${c['id']}' == selectedCategoryId))
        ? selectedCategoryId
        : null;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: DropdownButtonFormField<String>(
            value: validSelected,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: labelText,
              hintText: categories.isEmpty ? 'لا توجد أقسام بعد — أضف قسمًا جديدًا' : 'اختر القسم',
              border: const OutlineInputBorder(),
              isDense: true,
            ),
            items: categories
                .map(
                  (c) => DropdownMenuItem<String>(
                    value: '${c['id']}',
                    child: Text(
                      (c['full_path_ar'] ?? c['name_ar'] ?? '').toString(),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                )
                .toList(),
            onChanged: categories.isEmpty ? null : onChanged,
          ),
        ),
        const SizedBox(width: 8),
        FilledButton.tonalIcon(
          onPressed: () => _openCreateDialog(context),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFFEF3C7),
            foregroundColor: const Color(0xFF92400E),
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 13),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
          label: const Text(
            'قسم جديد',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
          ),
        ),
      ],
    );
  }
}

class _CreateCategoryDialog extends StatefulWidget {
  final MerchantApiClient api;
  final List<Map<String, dynamic>> categories;

  const _CreateCategoryDialog({
    required this.api,
    required this.categories,
  });

  @override
  State<_CreateCategoryDialog> createState() => _CreateCategoryDialogState();
}

class _CreateCategoryDialogState extends State<_CreateCategoryDialog> {
  final TextEditingController _nameCtrl = TextEditingController();
  final TextEditingController _imageCtrl = TextEditingController();
  String? _parentId;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _imageCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'يرجى كتابة اسم القسم الجديد');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final created = await widget.api.createCategory(
        nameAr: name,
        parentId: _parentId,
        imageUrl: _imageCtrl.text.trim(),
      );
      final newId = (created['id'] ?? '').toString().trim();
      if (newId.isEmpty) {
        throw Exception('تعذر استلام معرف القسم الجديد من الخادم');
      }

      List<Map<String, dynamic>> refreshed = List<Map<String, dynamic>>.from(widget.categories);
      try {
        final serverCats = await widget.api.fetchCategories();
        if (serverCats.isNotEmpty) {
          refreshed = serverCats;
        }
      } catch (_) {}

      if (!refreshed.any((c) => '${c['id']}' == newId)) {
        String fullPath = name;
        if (_parentId != null) {
          final parentMatch = refreshed.where((c) => '${c['id']}' == _parentId);
          if (parentMatch.isNotEmpty) {
            final pName = (parentMatch.first['full_path_ar'] ?? parentMatch.first['name_ar'] ?? '')
                .toString()
                .replaceAll(';', '')
                .trim();
            if (pName.isNotEmpty) {
              fullPath = '$pName > $name';
            }
          }
        }
        refreshed.add({
          'id': newId,
          'name_ar': name,
          'full_path_ar': fullPath,
          'parent_id': _parentId,
          'image_url': _imageCtrl.text.trim(),
        });
      }

      if (!mounted) return;
      Navigator.pop<Map<String, dynamic>>(context, {
        'id': newId,
        'name_ar': name,
        'categories': refreshed,
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.create_new_folder_rounded, color: _kBrandPrimary, size: 24),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'إضافة قسم جديد',
                style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w900),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
              TextField(
                controller: _nameCtrl,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'اسم القسم الجديد *',
                  hintText: 'مثال: مخبوزات طازجة أو بقالة > زيوت',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              if (widget.categories.isNotEmpty) ...[
                DropdownButtonFormField<String?>(
                  value: _parentId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'القسم الأب (اختياري)',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('بدون (قسم رئيسي)'),
                    ),
                    ...widget.categories.map(
                      (c) => DropdownMenuItem<String?>(
                        value: '${c['id']}',
                        child: Text(
                          (c['full_path_ar'] ?? c['name_ar'] ?? '').toString(),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                  onChanged: (v) => setState(() => _parentId = v),
                ),
                const SizedBox(height: 10),
              ],
              TextField(
                controller: _imageCtrl,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(
                  labelText: 'رابط صورة القسم (اختياري)',
                  hintText: 'https://...',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : () => Navigator.pop(context, null),
            child: const Text('إلغاء'),
          ),
          FilledButton.icon(
            onPressed: _saving ? null : _submit,
            style: FilledButton.styleFrom(backgroundColor: _kBrandPrimary),
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.check_rounded, size: 18),
            label: Text(_saving ? 'جاري الإضافة...' : 'إضافة واختيار'),
          ),
        ],
      ),
    );
  }
}
