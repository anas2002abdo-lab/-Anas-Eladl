import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import '../core/api_client.dart';

class CaptainPosScreen extends StatefulWidget {
  final OtlobhaCaptainApi api;
  final Map<String, dynamic> captain;
  final List<dynamic> orders;
  final List<dynamic> trips;
  final List<dynamic> parcels;

  const CaptainPosScreen({
    super.key,
    required this.api,
    required this.captain,
    required this.orders,
    this.trips = const [],
    this.parcels = const [],
  });

  @override
  State<CaptainPosScreen> createState() => _CaptainPosScreenState();
}

class _CaptainPosScreenState extends State<CaptainPosScreen> {
  List<dynamic> _invoices = [];
  final List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _design = {
    'header_title': 'اطلبها – Otlobha المنزلة',
    'header_subtitle': 'فاتورة توصيل ومشوار معتمدة للعميل',
    'show_logo': true,
    'support_phone': '01000000000',
    'show_support_phone': true,
    'show_captain_info': true,
    'show_item_codes': true,
    'show_qr_badge': true,
    'footer_message': 'شكرًا لاستخدامكم تطبيق اطلبها – المنزلة',
    'footer_note': 'خدمة سريعة تغطي المدينة والقرى',
    'default_paper_width': '58mm',
  };

  List<BluetoothInfo> _pairedPrinters = [];
  String? _connectedMac;
  String? _connectedName;
  bool _btBusy = false;
  bool _printing = false;
  bool _loadingPos = false;
  String _paperWidth = '58mm';

  String _sourceTab = 'orders'; // orders | trips | parcels
  String? _selectedOrderId;
  String _selectedRefLabel = '';

  final TextEditingController _customerNameCtrl = TextEditingController(text: 'عميل اطلبها');
  final TextEditingController _customerPhoneCtrl = TextEditingController();
  final TextEditingController _deliveryFeeCtrl = TextEditingController(text: '0');
  final TextEditingController _discountCtrl = TextEditingController(text: '0');
  final TextEditingController _extraNameCtrl = TextEditingController();
  final TextEditingController _extraPriceCtrl = TextEditingController();
  String _paymentMethod = 'cash';

  @override
  void initState() {
    super.initState();
    _loadPosData();
    _checkPrinterStatus();
  }

  @override
  void dispose() {
    _customerNameCtrl.dispose();
    _customerPhoneCtrl.dispose();
    _deliveryFeeCtrl.dispose();
    _discountCtrl.dispose();
    _extraNameCtrl.dispose();
    _extraPriceCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadPosData() async {
    setState(() => _loadingPos = true);
    try {
      final invs = await widget.api.getPosInvoices(widget.captain['id'].toString());
      Map<String, dynamic>? design;
      try {
        design = await widget.api.getInvoiceDesign();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _invoices = invs;
        if (design != null) {
          _design = {..._design, ...design};
          final w = design['default_paper_width']?.toString();
          if (w == '58mm' || w == '80mm') {
            _paperWidth = w!;
          }
        }
      });
    } catch (e) {
      _showMsg('تعذر تحديث سجل الفواتير: $e');
    } finally {
      if (mounted) setState(() => _loadingPos = false);
    }
  }

  Future<void> _checkPrinterStatus() async {
    try {
      final ok = await PrintBluetoothThermal.connectionStatus;
      if (!ok && mounted) {
        setState(() {
          _connectedMac = null;
          _connectedName = null;
        });
      }
    } catch (_) {}
  }

  Future<void> _scanAndPickBluetoothPrinter() async {
    setState(() => _btBusy = true);
    try {
      final permGranted = await PrintBluetoothThermal.isPermissionBluetoothGranted;
      if (!permGranted) {
        _showMsg('يرجى منح صلاحية البلوتوث للتطبيق من إعدادات الهاتف');
        return;
      }
      final btOn = await PrintBluetoothThermal.bluetoothEnabled;
      if (!btOn) {
        _showMsg('يرجى تشغيل البلوتوث على الهاتف أولاً');
        return;
      }
      final devices = await PrintBluetoothThermal.pairedBluetooths;
      if (!mounted) return;
      setState(() => _pairedPrinters = devices);

      if (devices.isEmpty) {
        _showMsg('لا توجد طابعات مقترنة — قم بإقران الطابعة من إعدادات بلوتوث الهاتف أولاً');
        return;
      }

      await showModalBottomSheet(
        context: context,
        builder: (ctx) => Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('اختر طابعة البلوتوث الحرارية', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                const SizedBox(height: 10),
                ..._pairedPrinters.map(
                  (d) => ListTile(
                    leading: const Icon(Icons.bluetooth, color: Color(0xFFA92224)),
                    title: Text(d.name),
                    subtitle: Text(d.macAdress),
                    onTap: () async {
                      Navigator.pop(ctx);
                      await _connectDevice(d);
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    } catch (e) {
      _showMsg('تعذر البحث عن طابعات البلوتوث: $e');
    } finally {
      if (mounted) setState(() => _btBusy = false);
    }
  }

  Future<void> _connectDevice(BluetoothInfo device) async {
    setState(() => _btBusy = true);
    try {
      final ok = await PrintBluetoothThermal.connect(macPrinterAddress: device.macAdress);
      if (!mounted) return;
      if (ok) {
        setState(() {
          _connectedMac = device.macAdress;
          _connectedName = device.name;
        });
        _showMsg('تم ربط طابعة البلوتوث: ${device.name}');
      } else {
        _showMsg('فشل الاتصال بالطابعة ${device.name}');
      }
    } catch (e) {
      _showMsg('خطأ في ربط الطابعة: $e');
    } finally {
      if (mounted) setState(() => _btBusy = false);
    }
  }

  Future<void> _disconnectPrinter() async {
    await PrintBluetoothThermal.disconnect;
    if (!mounted) return;
    setState(() {
      _connectedMac = null;
      _connectedName = null;
    });
    _showMsg('تم فصل طابعة البلوتوث');
  }

  void _loadOrder(Map<String, dynamic> ord) {
    final sub = ((ord['subtotal'] ?? 0) as num).toDouble();
    final tot = ((ord['total_amount'] ?? 0) as num).toDouble();
    final del = ((ord['delivery_fee'] ?? 0) as num).toDouble();
    final baseAmount = sub > 0 ? sub : (tot - del).clamp(0.0, 999999.0);
    final numStr = (ord['order_number'] ?? ord['id']).toString();
    final freeTxt = (ord['free_order_text'] ?? '').toString().trim();

    setState(() {
      _selectedOrderId = ord['id'].toString();
      _selectedRefLabel = numStr;
      _customerNameCtrl.text = (ord['customer_name'] ?? 'عميل اطلبها').toString();
      _customerPhoneCtrl.text = (ord['customer_phone'] ?? '').toString();
      _deliveryFeeCtrl.text = del.toString();
      _discountCtrl.text = ((ord['discount_amount'] ?? 0) as num).toString();
      _paymentMethod = ord['payment_method'] == 'wallet' ? 'wallet' : 'cash';
      _items
        ..clear()
        ..add({
          'product_code': numStr,
          'name_ar': freeTxt.isNotEmpty
              ? 'أوردر #$numStr: ${freeTxt.length > 70 ? freeTxt.substring(0, 70) : freeTxt}'
              : 'طلب #$numStr (${ord['merchant_name'] ?? ''})',
          'unit_price': baseAmount,
          'qty': 1,
          'line_total': baseAmount,
        });
    });
  }

  void _loadTrip(Map<String, dynamic> trp) {
    final fare = ((trp['final_fare'] ?? trp['customer_proposed_fare'] ?? trp['estimated_fare'] ?? 0) as num).toDouble();
    final numStr = (trp['trip_number'] ?? trp['id']).toString();
    setState(() {
      _selectedOrderId = null;
      _selectedRefLabel = numStr;
      _customerNameCtrl.text = (trp['customer_name'] ?? 'عميل مشوار').toString();
      _customerPhoneCtrl.text = (trp['customer_phone'] ?? '').toString();
      _deliveryFeeCtrl.text = '0';
      _discountCtrl.text = '0';
      _paymentMethod = 'cash';
      _items
        ..clear()
        ..add({
          'product_code': numStr,
          'name_ar': 'مشوار #$numStr: من ${trp['pickup_address']} إلى ${trp['dropoff_address']} (${trp['distance_km']} كم)',
          'unit_price': fare,
          'qty': 1,
          'line_total': fare,
        });
    });
  }

  void _loadParcel(Map<String, dynamic> prc) {
    final fee = ((prc['delivery_fee'] ?? 0) as num).toDouble();
    final numStr = (prc['delivery_number'] ?? prc['id']).toString();
    setState(() {
      _selectedOrderId = null;
      _selectedRefLabel = numStr;
      _customerNameCtrl.text = (prc['sender_name'] ?? prc['recipient_name'] ?? 'عميل طرد').toString();
      _customerPhoneCtrl.text = (prc['recipient_phone'] ?? prc['sender_phone'] ?? '').toString();
      _deliveryFeeCtrl.text = '0';
      _discountCtrl.text = '0';
      _paymentMethod = 'cash';
      _items
        ..clear()
        ..add({
          'product_code': numStr,
          'name_ar': 'توصيل طرد #$numStr (${prc['item_category'] ?? 'طرد'}): ${prc['pickup_address']} ← ${prc['dropoff_address']}',
          'unit_price': fee,
          'qty': 1,
          'line_total': fee,
        });
    });
  }

  void _addExtraItem() {
    final name = _extraNameCtrl.text.trim();
    final price = double.tryParse(_extraPriceCtrl.text.trim());
    if (name.isEmpty || price == null || price < 0) {
      _showMsg('أدخل وصف البند الإضافي وقيمته');
      return;
    }
    setState(() {
      _items.add({
        'product_code': _selectedRefLabel.isNotEmpty ? _selectedRefLabel : 'EXT-${_items.length + 1}',
        'name_ar': name,
        'unit_price': price,
        'qty': 1,
        'line_total': price,
      });
      _extraNameCtrl.clear();
      _extraPriceCtrl.clear();
    });
  }

  double get _subtotal => _items.fold(0.0, (s, it) => s + ((it['line_total'] as num?)?.toDouble() ?? 0.0));
  double get _deliveryFee => double.tryParse(_deliveryFeeCtrl.text.trim()) ?? 0.0;
  double get _discount => double.tryParse(_discountCtrl.text.trim()) ?? 0.0;
  double get _netTotal => (_subtotal + _deliveryFee - _discount).clamp(0.0, 999999.0);

  Future<ui.Image> _loadLogoImage() async {
    final data = await rootBundle.load('assets/images/otlobha_logo.jpg');
    final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
    final frame = await codec.getNextFrame();
    return frame.image;
  }

  Future<Uint8List> _renderReceiptEscPosRaster(Map<String, dynamic> invoice) async {
    final int widthPx = _paperWidth == '80mm' ? 576 : 384;
    final double pad = 14;
    final showLogo = _design['show_logo'] != false;
    final showSupport = _design['show_support_phone'] != false;
    final showCaptain = _design['show_captain_info'] != false;
    final showCodes = _design['show_item_codes'] != false;
    final showQr = _design['show_qr_badge'] != false;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final bgPaint = Paint()..color = Colors.white;
    canvas.drawRect(Rect.fromLTWH(0, 0, widthPx.toDouble(), 2600), bgPaint);

    double y = 12;
    if (showLogo) {
      final logo = await _loadLogoImage();
      const double logoH = 84;
      final double logoW = logoH * (logo.width / logo.height);
      canvas.drawImageRect(
        logo,
        Rect.fromLTWH(0, 0, logo.width.toDouble(), logo.height.toDouble()),
        Rect.fromLTWH((widthPx - logoW) / 2, y, logoW, logoH),
        Paint(),
      );
      y += logoH + 8;
    }

    void drawText(String text, {double size = 18, FontWeight weight = FontWeight.w600, TextAlign align = TextAlign.center}) {
      if (text.trim().isEmpty) return;
      final tp = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(color: Colors.black, fontSize: size, fontWeight: weight),
        ),
        textDirection: TextDirection.rtl,
        textAlign: align,
      )..layout(maxWidth: widthPx - pad * 2);
      final dx = align == TextAlign.center
          ? (widthPx - tp.width) / 2
          : align == TextAlign.left
              ? pad
              : widthPx - pad - tp.width;
      tp.paint(canvas, Offset(dx, y));
      y += tp.height + 5;
    }

    drawText(_design['header_title']?.toString() ?? 'اطلبها – Otlobha المنزلة', size: 22, weight: FontWeight.w800);
    drawText(_design['header_subtitle']?.toString() ?? '', size: 14);
    if (showSupport && (_design['support_phone']?.toString() ?? '').isNotEmpty) {
      drawText('خدمة العملاء: ${_design['support_phone']}', size: 13);
    }
    y += 6;
    canvas.drawLine(Offset(pad, y), Offset(widthPx - pad, y), Paint()..strokeWidth = 2);
    y += 10;

    drawText('رقم الفاتورة: ${invoice['invoice_number']}', size: 17, weight: FontWeight.bold, align: TextAlign.right);
    if (showCaptain) {
      drawText('الطيار: ${invoice['captain_name']}', size: 15, align: TextAlign.right);
    }
    drawText('العميل: ${invoice['customer_name']}', size: 15, align: TextAlign.right);
    if ((invoice['customer_phone'] ?? '').toString().isNotEmpty) {
      drawText('الهاتف: ${invoice['customer_phone']}', size: 14, align: TextAlign.right);
    }
    y += 6;
    canvas.drawLine(Offset(pad, y), Offset(widthPx - pad, y), Paint()..strokeWidth = 1);
    y += 10;

    final invItems = (invoice['items'] as List?) ?? [];
    for (final raw in invItems) {
      final it = Map<String, dynamic>.from(raw as Map);
      final title = showCodes ? '${it['name_ar']} (${it['product_code']})' : '${it['name_ar']}';
      drawText(title, size: 16, weight: FontWeight.bold, align: TextAlign.right);
      drawText('${it['qty']} × ${it['unit_price']} = ${it['line_total']} ج.م', size: 15, align: TextAlign.left);
    }
    y += 6;
    canvas.drawLine(Offset(pad, y), Offset(widthPx - pad, y), Paint()..strokeWidth = 2);
    y += 10;
    if (((invoice['delivery_fee'] ?? 0) as num) > 0) {
      drawText('رسوم التوصيل: ${invoice['delivery_fee']} ج.م', size: 15, align: TextAlign.right);
    }
    if (((invoice['discount_amount'] ?? 0) as num) > 0) {
      drawText('الخصم: -${invoice['discount_amount']} ج.م', size: 15, align: TextAlign.right);
    }
    drawText('الصافي المستحق: ${invoice['total_amount']} ج.م', size: 21, weight: FontWeight.w800, align: TextAlign.center);
    if (showQr) {
      drawText('OTLOBHA VERIFIED · ${invoice['invoice_number']}', size: 13, weight: FontWeight.bold, align: TextAlign.center);
    }
    drawText(_design['footer_message']?.toString() ?? '', size: 14, align: TextAlign.center);
    drawText(_design['footer_note']?.toString() ?? '', size: 12, align: TextAlign.center);
    y += 24;

    final int finalHeight = y.ceil();
    final picture = recorder.endRecording();
    final img = await picture.toImage(widthPx, finalHeight);
    final byteData = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (byteData == null) return Uint8List(0);
    final rgba = byteData.buffer.asUint8List();

    final int widthBytes = (widthPx + 7) ~/ 8;
    final List<int> out = [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, finalHeight & 0xff, (finalHeight >> 8) & 0xff];

    for (int row = 0; row < finalHeight; row++) {
      for (int xb = 0; xb < widthBytes; xb++) {
        int b = 0;
        for (int bit = 0; bit < 8; bit++) {
          final x = xb * 8 + bit;
          if (x < widthPx) {
            final idx = (row * widthPx + x) * 4;
            final lum = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
            if (rgba[idx + 3] > 100 && lum < 165) {
              b |= (0x80 >> bit);
            }
          }
        }
        out.add(b);
      }
    }
    out.addAll([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x01]);
    return Uint8List.fromList(out);
  }

  Future<void> _saveAndPrint() async {
    if (_items.isEmpty) {
      _showMsg('اختر طلبًا أو مشوارًا أولاً لإصدار الفاتورة');
      return;
    }
    setState(() => _printing = true);
    try {
      final res = await widget.api.createPosInvoice({
        'captain_id': widget.captain['id'],
        'order_id': _selectedOrderId,
        'customer_name': _customerNameCtrl.text.trim().isEmpty ? 'عميل اطلبها' : _customerNameCtrl.text.trim(),
        'customer_phone': _customerPhoneCtrl.text.trim(),
        'items': _items,
        'delivery_fee': _deliveryFee,
        'discount_amount': _discount,
        'payment_method': _paymentMethod,
        'printed_via': _connectedMac != null ? 'bluetooth' : 'saved_only',
      });
      final inv = Map<String, dynamic>.from(res['invoice'] as Map);

      if (_connectedMac != null) {
        final bytes = await _renderReceiptEscPosRaster(inv);
        await PrintBluetoothThermal.writeBytes(bytes.toList());
        _showMsg('تم حفظ الفاتورة ${inv['invoice_number']} وطباعتها بالبلوتوث ✓');
      } else {
        _showMsg('تم حفظ الفاتورة ${inv['invoice_number']} — اربط طابعة بلوتوث للطباعة الحرارية');
      }
      await _loadPosData();
    } catch (e) {
      _showMsg('تعذر إصدار الفاتورة: $e');
    } finally {
      if (mounted) setState(() => _printing = false);
    }
  }

  void _showMsg(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final captainTrips = widget.trips.where((t) => t['captain_id'] == widget.captain['id'] || t['status'] == 'searching').toList();

    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // Bluetooth Printer Card
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      _connectedMac != null ? Icons.bluetooth_connected : Icons.bluetooth,
                      color: _connectedMac != null ? const Color(0xFF0D9488) : const Color(0xFFA92224),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _connectedMac != null
                            ? 'متصل بطابعة: ${_connectedName ?? _connectedMac}'
                            : 'طباعة فواتير التسليم والمشاوير بالبلوتوث',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                    ),
                    DropdownButton<String>(
                      value: _paperWidth,
                      items: const [
                        DropdownMenuItem(value: '58mm', child: Text('58mm')),
                        DropdownMenuItem(value: '80mm', child: Text('80mm')),
                      ],
                      onChanged: (v) => setState(() => _paperWidth = v ?? '58mm'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: _btBusy ? null : _scanAndPickBluetoothPrinter,
                        icon: const Icon(Icons.bluetooth_searching, size: 18),
                        label: Text(_connectedMac != null ? 'تغيير الطابعة' : 'ربط طابعة بلوتوث'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFA92224),
                          foregroundColor: Colors.white,
                        ),
                      ),
                    ),
                    if (_connectedMac != null) ...[
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: _disconnectPrinter,
                        child: const Text('فصل'),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),

        // Source Tabs: Orders / Rides / Parcels
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'orders', label: Text('الأوردرات (${widget.orders.length})')),
            ButtonSegment(value: 'trips', label: Text('المشاوير (${captainTrips.length})')),
            ButtonSegment(value: 'parcels', label: Text('الطرود (${widget.parcels.length})')),
          ],
          selected: {_sourceTab},
          onSelectionChanged: (s) => setState(() => _sourceTab = s.first),
        ),
        const SizedBox(height: 8),

        if (_loadingPos) const LinearProgressIndicator(),

        if (_sourceTab == 'orders')
          ...widget.orders.take(10).map((raw) {
            final o = Map<String, dynamic>.from(raw as Map);
            return Card(
              child: ListTile(
                dense: true,
                title: Text('#${o['order_number']} · ${o['customer_name']} (${o['merchant_name']})', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                subtitle: Text('الإجمالي: ${o['total_amount']} ج.م · ${o['status']}', style: const TextStyle(fontSize: 11)),
                trailing: ElevatedButton(
                  onPressed: () => _loadOrder(o),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                  child: const Text('تجهيز', style: TextStyle(fontSize: 11)),
                ),
              ),
            );
          }),

        if (_sourceTab == 'trips')
          ...captainTrips.take(10).map((raw) {
            final t = Map<String, dynamic>.from(raw as Map);
            final fare = t['final_fare'] ?? t['customer_proposed_fare'] ?? t['estimated_fare'] ?? 0;
            return Card(
              child: ListTile(
                dense: true,
                title: Text('#${t['trip_number']} · ${t['customer_name']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                subtitle: Text('من ${t['pickup_address']} إلى ${t['dropoff_address']} ($fare ج.م)', style: const TextStyle(fontSize: 11)),
                trailing: ElevatedButton(
                  onPressed: () => _loadTrip(t),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                  child: const Text('تجهيز', style: TextStyle(fontSize: 11)),
                ),
              ),
            );
          }),

        if (_sourceTab == 'parcels')
          ...widget.parcels.take(10).map((raw) {
            final p = Map<String, dynamic>.from(raw as Map);
            return Card(
              child: ListTile(
                dense: true,
                title: Text('#${p['delivery_number']} · ${p['item_category']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                subtitle: Text('أجرة التوصيل: ${p['delivery_fee']} ج.م', style: const TextStyle(fontSize: 11)),
                trailing: ElevatedButton(
                  onPressed: () => _loadParcel(p),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F172A), foregroundColor: Colors.white),
                  child: const Text('تجهيز', style: TextStyle(fontSize: 11)),
                ),
              ),
            );
          }),

        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              flex: 2,
              child: TextField(
                controller: _extraNameCtrl,
                decoration: const InputDecoration(hintText: 'بند إضافي (انتظار/مشتريات)...', border: OutlineInputBorder(), isDense: true),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: TextField(
                controller: _extraPriceCtrl,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(hintText: 'المبلغ', border: OutlineInputBorder(), isDense: true),
              ),
            ),
            const SizedBox(width: 6),
            ElevatedButton(onPressed: _addExtraItem, child: const Text('+ إضافة')),
          ],
        ),
        const SizedBox(height: 12),

        // Branded Invoice Preview Card (Obeying Admin Design)
        Card(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: const BorderSide(color: Color(0xFF0F172A), width: 1.5),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                if (_design['show_logo'] != false)
                  Image.asset('assets/images/otlobha_logo.jpg', width: 58, height: 58, fit: BoxFit.contain),
                const SizedBox(height: 4),
                Text(
                  _design['header_title']?.toString() ?? 'اطلبها – Otlobha المنزلة',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                ),
                if ((_design['header_subtitle']?.toString() ?? '').isNotEmpty)
                  Text(_design['header_subtitle'].toString(), style: const TextStyle(fontSize: 11, color: Colors.black54)),
                if (_design['show_captain_info'] != false)
                  Text('الطيار: ${widget.captain['full_name']}', style: const TextStyle(fontSize: 11, color: Colors.black54)),
                const Divider(),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _customerNameCtrl,
                        decoration: const InputDecoration(labelText: 'اسم العميل', isDense: true),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _deliveryFeeCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'رسوم التوصيل', isDense: true),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Text('اختر طلبًا أو مشوارًا من الأعلى لتظهر تفاصيل الفاتورة...', style: TextStyle(color: Colors.black45, fontSize: 12)),
                  )
                else
                  ..._items.asMap().entries.map((entry) {
                    final idx = entry.key;
                    final it = entry.value;
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${it['name_ar']}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      subtitle: Text('${it['qty']} × ${it['unit_price']} = ${it['line_total']} ج.م', style: const TextStyle(fontSize: 11)),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline, color: Colors.red, size: 18),
                        onPressed: () => setState(() => _items.removeAt(idx)),
                      ),
                    );
                  }),
                const Divider(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('الصافي المستحق:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    Text(
                      '${_netTotal.toStringAsFixed(2)} ج.م',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17, color: Color(0xFFA92224)),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if ((_design['footer_message']?.toString() ?? '').isNotEmpty)
                  Text(_design['footer_message'].toString(), style: const TextStyle(fontSize: 11, color: Colors.black54), textAlign: TextAlign.center),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _printing ? null : _saveAndPrint,
                    icon: const Icon(Icons.print),
                    label: Text(_printing ? 'جاري الطباعة...' : 'حفظ الفاتورة وطباعة بالبلوتوث'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFA92224),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (_invoices.isNotEmpty) ...[
          const Text('فواتير العملاء الصادرة حديثًا', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(height: 6),
          ..._invoices.take(8).map((raw) {
            final inv = Map<String, dynamic>.from(raw as Map);
            return Card(
              child: ListTile(
                dense: true,
                title: Text('${inv['invoice_number']} · ${inv['customer_name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                subtitle: Text('${inv['total_amount']} ج.م', style: const TextStyle(fontSize: 11)),
                trailing: IconButton(
                  icon: const Icon(Icons.print, color: Color(0xFFA92224)),
                  onPressed: _connectedMac == null
                      ? () => _showMsg('اربط طابعة البلوتوث أولاً لإعادة الطباعة')
                      : () async {
                          final bytes = await _renderReceiptEscPosRaster(inv);
                          await PrintBluetoothThermal.writeBytes(bytes.toList());
                          _showMsg('تمت إعادة الطباعة ✓');
                        },
                ),
              ),
            );
          }),
        ],
      ],
    );
  }
}
