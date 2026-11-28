import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'config.dart';

class MerchantApiException implements Exception {
  final String message;
  final int statusCode;

  MerchantApiException(this.message, [this.statusCode = 0]);

  @override
  String toString() => message;
}

class MerchantApiClient {
  static const String _prefAccessToken = 'otlobha_merchant_access_token';
  static const String _prefRefreshToken = 'otlobha_merchant_refresh_token';

  String? accessToken;
  String? refreshToken;
  Future<bool>? _refreshFuture;
  DateTime? _refreshStartedAt;

  void resetConnectionPool() {
    if (_refreshFuture != null &&
        (_refreshStartedAt == null || DateTime.now().difference(_refreshStartedAt!).inSeconds >= 8)) {
      _refreshFuture = null;
      _refreshStartedAt = null;
    }
  }

  MerchantApiClient({this.accessToken, this.refreshToken});

  Map<String, String> _headers() {
    final map = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (accessToken != null && accessToken!.isNotEmpty) {
      map['Authorization'] = 'Bearer $accessToken';
    }
    return map;
  }

  Future<void> reloadTokensFromStorage() async {
    try {
      final prefs = await SharedPreferences.getInstance().timeout(const Duration(seconds: 3));
      try {
        await prefs.reload().timeout(const Duration(seconds: 3));
      } catch (_) {}
      final savedAccess = prefs.getString(_prefAccessToken)?.trim();
      final savedRefresh = prefs.getString(_prefRefreshToken)?.trim();
      if (savedAccess != null && savedAccess.isNotEmpty) {
        accessToken = savedAccess;
      }
      if (savedRefresh != null && savedRefresh.isNotEmpty) {
        refreshToken = savedRefresh;
      }
    } catch (_) {}
  }

  Future<bool> _tryRefreshSession() async {
    await reloadTokensFromStorage();
    final currentRefresh = refreshToken?.trim() ?? '';
    if (currentRefresh.isEmpty) return false;
    if (_refreshFuture != null) {
      final elapsed = _refreshStartedAt == null
          ? const Duration(seconds: 99)
          : DateTime.now().difference(_refreshStartedAt!);
      if (elapsed.inSeconds < 12) {
        return _refreshFuture!;
      }
      _refreshFuture = null;
      _refreshStartedAt = null;
    }

    _refreshStartedAt = DateTime.now();
    final future = () async {
      try {
        final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/auth/refresh');
        final res = await http
            .post(
              uri,
              headers: const {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: jsonEncode({'refresh_token': currentRefresh}),
            )
            .timeout(const Duration(seconds: 12));
        if (res.statusCode < 200 || res.statusCode >= 300) return false;
        final decoded = jsonDecode(utf8.decode(res.bodyBytes));
        if (decoded is! Map) return false;
        final tokens = decoded['tokens'];
        if (tokens is! Map) return false;
        final nextAccess = (tokens['access_token'] ?? '').toString().trim();
        final nextRefresh = (tokens['refresh_token'] ?? '').toString().trim();
        if (nextAccess.isEmpty) return false;
        accessToken = nextAccess;
        if (nextRefresh.isNotEmpty) refreshToken = nextRefresh;
        try {
          final prefs = await SharedPreferences.getInstance().timeout(const Duration(seconds: 3));
          await prefs.setString(_prefAccessToken, nextAccess);
          if (nextRefresh.isNotEmpty) {
            await prefs.setString(_prefRefreshToken, nextRefresh);
          }
        } catch (_) {}
        return true;
      } catch (_) {
        return false;
      } finally {
        _refreshFuture = null;
        _refreshStartedAt = null;
      }
    }();
    _refreshFuture = future;
    return future;
  }

  Future<http.Response> _sendWithRetry(Future<http.Response> Function() send) async {
    for (int attempt = 0; attempt < 2; attempt++) {
      try {
        return await send().timeout(const Duration(seconds: 15));
      } on TimeoutException {
        if (attempt == 0) {
          await Future.delayed(const Duration(milliseconds: 350));
          continue;
        }
        throw MerchantApiException('انتهت مهلة الاتصال بالخادم، يرجى المحاولة مرة أخرى');
      } on SocketException {
        if (attempt == 0) {
          await Future.delayed(const Duration(milliseconds: 400));
          continue;
        }
        throw MerchantApiException('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت');
      } on http.ClientException {
        if (attempt == 0) {
          await Future.delayed(const Duration(milliseconds: 400));
          continue;
        }
        throw MerchantApiException('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت');
      }
    }
    throw MerchantApiException('تعذر الاتصال بالخادم، يرجى المحاولة مرة أخرى');
  }

  Future<http.Response> _authedRequest(Future<http.Response> Function() send) async {
    if ((accessToken?.trim().isEmpty ?? true) && (refreshToken?.trim().isNotEmpty ?? false)) {
      await _tryRefreshSession();
    }
    final sentAccess = accessToken;
    var res = await _sendWithRetry(send);
    if (res.statusCode == 401) {
      await reloadTokensFromStorage();
      if ((accessToken?.trim().isNotEmpty ?? false) && accessToken != sentAccess) {
        res = await _sendWithRetry(send);
        if (res.statusCode != 401) return res;
      }
      if (refreshToken?.trim().isNotEmpty ?? false) {
        final refreshed = await _tryRefreshSession();
        if (refreshed) {
          res = await _sendWithRetry(send);
        }
      }
    }
    return res;
  }

  dynamic _decode(http.Response res) {
    final text = utf8.decode(res.bodyBytes);
    dynamic data;
    try {
      data = text.isNotEmpty ? jsonDecode(text) : {};
    } catch (_) {
      data = {'error': 'استجابة غير متوقعة من الخادم (${res.statusCode})'};
    }
    if (res.statusCode >= 400) {
      final msg = (data is Map && data['error'] != null)
          ? data['error'].toString()
          : 'حدث خطأ في الاتصال بالخادم (${res.statusCode})';
      throw MerchantApiException(msg, res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/auth/merchant/login');
    final res = await http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'email': email.trim(),
            'password': password,
          }),
        )
        .timeout(const Duration(seconds: 20));
    final data = _decode(res) as Map<String, dynamic>;
    final tokens = data['tokens'] as Map<String, dynamic>?;
    if (tokens != null) {
      if (tokens['access_token'] != null) {
        accessToken = tokens['access_token'].toString();
      }
      if (tokens['refresh_token'] != null) {
        refreshToken = tokens['refresh_token'].toString();
      }
    }
    return data;
  }

  Future<void> registerPushToken({
    required String fcmToken,
    String? deviceId,
    String platform = 'android',
    String? appVersion,
    String? deviceLabel,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/push/register');
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'fcm_token': fcmToken,
            if (deviceId != null) 'device_id': deviceId,
            'platform': platform,
            if (appVersion != null) 'app_version': appVersion,
            if (deviceLabel != null) 'device_label': deviceLabel,
          }),
        )
        .timeout(const Duration(seconds: 15)));
    _decode(res);
  }

  Future<void> registerGuestPushToken({
    required String fcmToken,
    required String deviceId,
    String platform = 'android',
    String? appVersion,
    String? deviceLabel,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/push/register-guest');
    final res = await http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'fcm_token': fcmToken,
            'device_id': deviceId,
            'platform': platform,
            'app': 'merchant',
            if (appVersion != null) 'app_version': appVersion,
            if (deviceLabel != null) 'device_label': deviceLabel,
          }),
        )
        .timeout(const Duration(seconds: 15));
    _decode(res);
  }

  Future<void> unregisterPushToken({String? fcmToken, String? deviceId}) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/push/unregister');
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            if (fcmToken != null) 'fcm_token': fcmToken,
            if (deviceId != null) 'device_id': deviceId,
          }),
        )
        .timeout(const Duration(seconds: 12)));
    _decode(res);
  }

  Future<List<Map<String, dynamic>>> fetchNotifications() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/notifications?app=merchant');
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 15)));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<void> markNotificationRead(String id) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/mobile/notifications/${Uri.encodeComponent(id)}/read',
    );
    final res = await _authedRequest(() => http.patch(uri, headers: _headers()).timeout(const Duration(seconds: 12)));
    _decode(res);
  }

  Future<void> markAllNotificationsRead({List<String>? ids}) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/notifications/read-all');
    final res = await _authedRequest(() => http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'app': 'merchant',
            if (ids != null && ids.isNotEmpty) 'ids': ids,
          }),
        )
        .timeout(const Duration(seconds: 12)));
    _decode(res);
  }

  Future<List<Map<String, dynamic>>> fetchStoreOrders(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/orders?merchant_id=${Uri.encodeQueryComponent(merchantId)}&scope=merchant',
    );
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    if (data is Map && data['items'] is List) {
      return (data['items'] as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    }
    return [];
  }

  Future<Map<String, dynamic>> markOrderReady({
    required String orderId,
    required String merchantId,
    required bool isFreeOrRxWithoutItems,
    double? quoteSubtotal,
    String? notes,
    bool isPharmacy = false,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/orders/${Uri.encodeComponent(orderId)}/merchant-action',
    );
    final body = <String, dynamic>{
      'action': 'ready',
      'merchant_id': merchantId,
      'assign_best_captain': true,
    };
    if (notes != null && notes.trim().isNotEmpty) {
      body['pharmacist_notes'] = notes.trim();
    }
    if (isPharmacy) {
      body['prescription_status'] = 'reviewed';
    }
    // Never send subtotal for itemized catalog orders so prices can never be overwritten.
    if (isFreeOrRxWithoutItems && quoteSubtotal != null && quoteSubtotal >= 0) {
      body['subtotal'] = quoteSubtotal;
    }
    final res = await _authedRequest(() => http
        .patch(uri, headers: _headers(), body: jsonEncode(body))
        .timeout(const Duration(seconds: 20)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> rejectItems({
    required String orderId,
    required String merchantId,
    required List<Map<String, String>> rejectedItems,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/orders/${Uri.encodeComponent(orderId)}/merchant-action',
    );
    final res = await _authedRequest(() => http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'action': 'reject_items',
            'merchant_id': merchantId,
            'rejected_items': rejectedItems,
          }),
        )
        .timeout(const Duration(seconds: 20)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> rejectInvoice({
    required String orderId,
    required String merchantId,
    required String reason,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/orders/${Uri.encodeComponent(orderId)}/merchant-action',
    );
    final res = await _authedRequest(() => http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'action': 'reject_invoice',
            'merchant_id': merchantId,
            'rejection_reason': reason.trim(),
          }),
        )
        .timeout(const Duration(seconds: 20)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<List<Map<String, dynamic>>> fetchStoreProducts(String merchantId) async {
    final page = await fetchStoreProductsPage(merchantId: merchantId, page: 1, limit: 100);
    return page.items;
  }

  Future<MerchantProductsPageResult> fetchStoreProductsPage({
    required String merchantId,
    int page = 1,
    int limit = 25,
    String query = '',
    bool offersOnly = false,
    bool noImageOnly = false,
    String availability = 'all', // all | available | unavailable
    String? sort,
    String? fromId,
    String? afterId,
    int? offset,
  }) async {
    final qp = <String, String>{
      'merchant_id': merchantId,
      'paginated': '1',
      'page': '$page',
      'limit': '$limit',
    };
    if (query.trim().isNotEmpty) qp['q'] = query.trim();
    if (offersOnly) qp['offers_only'] = '1';
    if (noImageOnly) qp['no_image'] = '1';
    if (availability != 'all') qp['availability'] = availability;
    if (sort != null && sort.trim().isNotEmpty) qp['sort'] = sort.trim();
    if (fromId != null && fromId.trim().isNotEmpty) qp['from_id'] = fromId.trim();
    if (afterId != null && afterId.trim().isNotEmpty) qp['after_id'] = afterId.trim();
    if (offset != null && offset >= 0) qp['offset'] = '$offset';

    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/products')
        .replace(queryParameters: qp);
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is Map) {
      final rawItems = (data['items'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final sum = data['summary'] is Map ? Map<String, dynamic>.from(data['summary'] as Map) : const <String, dynamic>{};
      return MerchantProductsPageResult(
        items: rawItems,
        total: int.tryParse('${data['total'] ?? rawItems.length}') ?? rawItems.length,
        page: int.tryParse('${data['page'] ?? page}') ?? page,
        limit: int.tryParse('${data['limit'] ?? limit}') ?? limit,
        totalPages: int.tryParse('${data['total_pages'] ?? 1}') ?? 1,
        hasMore: data['has_more'] == true,
        totalAll: int.tryParse('${sum['total_all'] ?? data['total'] ?? rawItems.length}') ?? rawItems.length,
        totalOffers: int.tryParse('${sum['total_offers'] ?? 0}') ?? 0,
        totalNoImage: int.tryParse('${sum['total_no_image'] ?? 0}') ?? 0,
        totalUnavailable: int.tryParse('${sum['total_unavailable'] ?? 0}') ?? 0,
      );
    }
    if (data is List) {
      final rawItems = data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      return MerchantProductsPageResult(
        items: rawItems,
        total: rawItems.length,
        page: 1,
        limit: rawItems.length,
        totalPages: 1,
        hasMore: false,
        totalAll: rawItems.length,
        totalOffers: rawItems.where((p) => p['is_offer'] == true).length,
        totalNoImage: rawItems.where((p) => (p['image_url'] ?? '').toString().trim().isEmpty && p['is_available'] == true).length,
        totalUnavailable: rawItems.where((p) => p['is_available'] == false || p['is_available'] == 0).length,
      );
    }
    return const MerchantProductsPageResult.empty();
  }

  Future<List<Map<String, dynamic>>> fetchCategories() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/categories');
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>> createCategory({
    required String nameAr,
    String? parentId,
    String? imageUrl,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/categories');
    final payload = <String, dynamic>{
      'name_ar': nameAr.trim(),
    };
    if (parentId != null && parentId.trim().isNotEmpty) {
      payload['parent_id'] = parentId.trim();
    }
    if (imageUrl != null && imageUrl.trim().isNotEmpty) {
      payload['image_url'] = imageUrl.trim();
    }
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    return <String, dynamic>{};
  }

  Future<void> updateProduct({
    required String productId,
    String? nameAr,
    String? categoryId,
    bool? isAvailable,
    double? basePrice,
    double? salePrice,
    bool clearSalePrice = false,
    bool? isOffer,
    int? stockQuantity,
    String? imageUrl,
    String? description,
    bool? isWeighted,
    double? weightStep,
    String? weightUnit,
    double? minOrderQty,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/products/${Uri.encodeComponent(productId)}',
    );
    final payload = <String, dynamic>{};
    if (nameAr != null && nameAr.trim().isNotEmpty) payload['name_ar'] = nameAr.trim();
    if (categoryId != null && categoryId.trim().isNotEmpty) payload['category_id'] = categoryId.trim();
    if (isAvailable != null) payload['is_available'] = isAvailable;
    if (basePrice != null && basePrice >= 0) payload['base_price'] = basePrice;
    if (clearSalePrice) {
      payload['sale_price'] = null;
    } else if (salePrice != null && salePrice >= 0) {
      payload['sale_price'] = salePrice;
    }
    if (isOffer != null) payload['is_offer'] = isOffer;
    if (stockQuantity != null && stockQuantity >= 0) payload['stock_quantity'] = stockQuantity;
    if (imageUrl != null) payload['image_url'] = imageUrl.trim();
    if (description != null) payload['description'] = description.trim();
    if (isWeighted != null) payload['is_weighted'] = isWeighted;
    if (weightStep != null && weightStep > 0) payload['weight_step'] = weightStep;
    if (weightUnit != null && weightUnit.trim().isNotEmpty) payload['weight_unit'] = weightUnit.trim();
    if (minOrderQty != null && minOrderQty > 0) payload['min_order_qty'] = minOrderQty;

    final res = await _authedRequest(() => http
        .patch(uri, headers: _headers(), body: jsonEncode(payload))
        .timeout(const Duration(seconds: 20)));
    _decode(res);
  }

  Future<Map<String, dynamic>> submitNewProductRequest({
    required String merchantId,
    required String productNameAr,
    String? categoryId,
    String? categoryPath,
    required double proposedPrice,
    double? proposedSalePrice,
    int proposedStock = 20,
    String? brand,
    String? sizeLabel,
    String? barcode,
    String? imageUrl,
    String? description,
    bool isWeighted = false,
    double weightStep = 0.25,
    String weightUnit = 'كجم',
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/master-catalog/request-new');
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'merchant_id': merchantId,
            'product_name_ar': productNameAr.trim(),
            if (categoryId != null && categoryId.trim().isNotEmpty) 'category_id': categoryId.trim(),
            if (categoryPath != null && categoryPath.trim().isNotEmpty) 'category_path': categoryPath.trim(),
            'proposed_price': proposedPrice,
            if (proposedSalePrice != null && proposedSalePrice > 0) 'proposed_sale_price': proposedSalePrice,
            'proposed_stock': proposedStock,
            if (brand != null && brand.trim().isNotEmpty) 'brand': brand.trim(),
            if (sizeLabel != null && sizeLabel.trim().isNotEmpty) 'size_label': sizeLabel.trim(),
            if (barcode != null && barcode.trim().isNotEmpty) 'barcode': barcode.trim(),
            if (imageUrl != null && imageUrl.trim().isNotEmpty) 'image_url': imageUrl.trim(),
            if (description != null && description.trim().isNotEmpty) 'description': description.trim(),
            'is_weighted': isWeighted,
            'weight_step': weightStep,
            'weight_unit': weightUnit,
          }),
        )
        .timeout(const Duration(seconds: 25)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<List<Map<String, dynamic>>> fetchApprovalRequests(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant/master-catalog/my-requests?merchant_id=${Uri.encodeQueryComponent(merchantId)}',
    );
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>?> updateStoreOpenStatus({
    required String merchantId,
    required bool isOpen,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchants/${Uri.encodeComponent(merchantId)}',
    );
    final res = await _authedRequest(() => http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({'is_open_now': isOpen, 'is_open': isOpen}),
        )
        .timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is Map && data['merchant'] is Map) {
      return Map<String, dynamic>.from(data['merchant'] as Map);
    }
    return null;
  }

  Future<Map<String, dynamic>> fetchSwipeDeckProgress(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchants/${Uri.encodeComponent(merchantId)}/swipe-progress',
    );
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 15)));
    final data = _decode(res);
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    return const <String, dynamic>{};
  }

  Future<void> saveSwipeDeckProgress({
    required String merchantId,
    required String productId,
    required int cardIndex,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchants/${Uri.encodeComponent(merchantId)}/swipe-progress',
    );
    final res = await _authedRequest(() => http
        .put(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'product_id': productId,
            'card_index': cardIndex,
          }),
        )
        .timeout(const Duration(seconds: 15)));
    _decode(res);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Self-Onboarding («انضم إلى اطلبها») & Application Tracking
  // ═══════════════════════════════════════════════════════════════════════════

  Future<Map<String, dynamic>> fetchOnboardingConfig() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/config');
    final res = await _sendWithRetry(() => http.get(uri, headers: const {'Accept': 'application/json'}));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> createOnboardingDraft(Map<String, dynamic> payload) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/drafts');
    final res = await _sendWithRetry(
      () => http.post(
        uri,
        headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode(payload),
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> fetchOnboardingApplication({
    required String applicationNumber,
    required String secret,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/applications/${Uri.encodeComponent(applicationNumber)}',
    );
    final res = await _sendWithRetry(
      () => http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'X-Application-Secret': secret,
        },
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> updateOnboardingApplication({
    required String applicationNumber,
    required String secret,
    required Map<String, dynamic> payload,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/applications/${Uri.encodeComponent(applicationNumber)}',
    );
    final res = await _sendWithRetry(
      () => http.patch(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Application-Secret': secret,
        },
        body: jsonEncode(payload),
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> uploadOnboardingDocument({
    required String applicationNumber,
    required String secret,
    required String docType,
    required String docLabel,
    required String fileName,
    required String mimeType,
    required String fileData,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/applications/${Uri.encodeComponent(applicationNumber)}/documents',
    );
    final res = await _sendWithRetry(
      () => http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Application-Secret': secret,
        },
        body: jsonEncode({
          'doc_type': docType,
          'doc_label': docLabel,
          'file_name': fileName,
          'mime_type': mimeType,
          'file_data': fileData,
        }),
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<void> deleteOnboardingDocument({
    required String applicationNumber,
    required String secret,
    required String docId,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/applications/${Uri.encodeComponent(applicationNumber)}/documents/${Uri.encodeComponent(docId)}',
    );
    final res = await _sendWithRetry(
      () => http.delete(
        uri,
        headers: {
          'Accept': 'application/json',
          'X-Application-Secret': secret,
        },
      ),
    );
    _decode(res);
  }

  Future<Map<String, dynamic>> submitOnboardingApplication({
    required String applicationNumber,
    required String secret,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/applications/${Uri.encodeComponent(applicationNumber)}/submit',
    );
    final res = await _sendWithRetry(
      () => http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Application-Secret': secret,
        },
        body: jsonEncode({}),
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> checkOnboardingStatus({
    required String applicationNumber,
    required String contact,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant-onboarding/status');
    final res = await _sendWithRetry(
      () => http.post(
        uri,
        headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode({
          'application_number': applicationNumber.trim(),
          'contact': contact.trim(),
        }),
      ),
    );
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Activity-Tailored Workspace (Profile, Restaurant Menu, Staff RBAC)
  // ═══════════════════════════════════════════════════════════════════════════

  Future<Map<String, dynamic>> fetchWorkspaceProfile() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/workspace/profile');
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 15)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<List<Map<String, dynamic>>> fetchMenuItems() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/menu-items');
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20)));
    final data = _decode(res);
    if (data is Map && data['items'] is List) {
      return (data['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>> createMenuItem({
    required String nameAr,
    String? description,
    required double basePrice,
    double? salePrice,
    int prepTimeMinutes = 15,
    List<Map<String, dynamic>> sizes = const [],
    List<Map<String, dynamic>> addons = const [],
    bool isAvailable = true,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/menu-items');
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'name_ar': nameAr.trim(),
            if (description != null && description.trim().isNotEmpty) 'description': description.trim(),
            'base_price': basePrice,
            if (salePrice != null && salePrice > 0) 'sale_price': salePrice,
            'prep_time_minutes': prepTimeMinutes,
            'sizes': sizes,
            'addons': addons,
            'is_available': isAvailable,
          }),
        )
        .timeout(const Duration(seconds: 20)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<Map<String, dynamic>> updateMenuItem({
    required String itemId,
    String? nameAr,
    double? basePrice,
    int? prepTimeMinutes,
    bool? isAvailable,
    bool? isPaused,
    List<Map<String, dynamic>>? sizes,
    List<Map<String, dynamic>>? addons,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant/menu-items/${Uri.encodeComponent(itemId)}',
    );
    final payload = <String, dynamic>{};
    if (nameAr != null) payload['name_ar'] = nameAr.trim();
    if (basePrice != null) payload['base_price'] = basePrice;
    if (prepTimeMinutes != null) payload['prep_time_minutes'] = prepTimeMinutes;
    if (isAvailable != null) payload['is_available'] = isAvailable;
    if (isPaused != null) payload['is_paused'] = isPaused;
    if (sizes != null) payload['sizes'] = sizes;
    if (addons != null) payload['addons'] = addons;
    final res = await _authedRequest(() => http
        .patch(uri, headers: _headers(), body: jsonEncode(payload))
        .timeout(const Duration(seconds: 20)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<List<Map<String, dynamic>>> fetchStaffMembers() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/staff');
    final res = await _authedRequest(() => http.get(uri, headers: _headers()).timeout(const Duration(seconds: 15)));
    final data = _decode(res);
    if (data is Map && data['items'] is List) {
      return (data['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>> addStaffMember({
    required String fullName,
    String? phone,
    String? email,
    required String role,
  }) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/merchant/staff');
    final res = await _authedRequest(() => http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'full_name': fullName.trim(),
            if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
            if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
            'role': role,
          }),
        )
        .timeout(const Duration(seconds: 15)));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<void> updateStaffMember({
    required String staffId,
    String? role,
    bool? isActive,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant/staff/${Uri.encodeComponent(staffId)}',
    );
    final payload = <String, dynamic>{};
    if (role != null) payload['role'] = role;
    if (isActive != null) payload['is_active'] = isActive;
    final res = await _authedRequest(() => http
        .patch(uri, headers: _headers(), body: jsonEncode(payload))
        .timeout(const Duration(seconds: 15)));
    _decode(res);
  }

  Future<void> deleteStaffMember(String staffId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant/staff/${Uri.encodeComponent(staffId)}',
    );
    final res = await _authedRequest(() => http.delete(uri, headers: _headers()).timeout(const Duration(seconds: 15)));
    _decode(res);
  }
}

class MerchantProductsPageResult {
  final List<Map<String, dynamic>> items;
  final int total;
  final int page;
  final int limit;
  final int totalPages;
  final bool hasMore;
  final int totalAll;
  final int totalOffers;
  final int totalNoImage;
  final int totalUnavailable;

  const MerchantProductsPageResult({
    required this.items,
    required this.total,
    required this.page,
    required this.limit,
    required this.totalPages,
    required this.hasMore,
    required this.totalAll,
    required this.totalOffers,
    required this.totalNoImage,
    required this.totalUnavailable,
  });

  const MerchantProductsPageResult.empty()
      : items = const [],
        total = 0,
        page = 1,
        limit = 25,
        totalPages = 1,
        hasMore = false,
        totalAll = 0,
        totalOffers = 0,
        totalNoImage = 0,
        totalUnavailable = 0;
}
