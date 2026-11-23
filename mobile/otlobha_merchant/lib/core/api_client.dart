import 'dart:convert';
import 'package:http/http.dart' as http;
import 'config.dart';

class MerchantApiException implements Exception {
  final String message;
  final int statusCode;

  MerchantApiException(this.message, [this.statusCode = 0]);

  @override
  String toString() => message;
}

class MerchantApiClient {
  String? accessToken;
  String? refreshToken;

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
    final res = await http
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
        .timeout(const Duration(seconds: 15));
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
    final res = await http
        .post(
          uri,
          headers: _headers(),
          body: jsonEncode({
            if (fcmToken != null) 'fcm_token': fcmToken,
            if (deviceId != null) 'device_id': deviceId,
          }),
        )
        .timeout(const Duration(seconds: 12));
    _decode(res);
  }

  Future<List<Map<String, dynamic>>> fetchNotifications() async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/notifications?app=merchant');
    final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 15));
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
    final res = await http.patch(uri, headers: _headers()).timeout(const Duration(seconds: 12));
    _decode(res);
  }

  Future<void> markAllNotificationsRead({List<String>? ids}) async {
    final uri = Uri.parse('${MerchantAppConfig.normalizedBaseUrl}/api/mobile/notifications/read-all');
    final res = await http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'app': 'merchant',
            if (ids != null && ids.isNotEmpty) 'ids': ids,
          }),
        )
        .timeout(const Duration(seconds: 12));
    _decode(res);
  }

  Future<List<Map<String, dynamic>>> fetchStoreOrders(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/orders?merchant_id=${Uri.encodeQueryComponent(merchantId)}&scope=merchant',
    );
    final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20));
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
    final res = await http
        .patch(uri, headers: _headers(), body: jsonEncode(body))
        .timeout(const Duration(seconds: 20));
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
    final res = await http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'action': 'reject_items',
            'merchant_id': merchantId,
            'rejected_items': rejectedItems,
          }),
        )
        .timeout(const Duration(seconds: 20));
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
    final res = await http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({
            'action': 'reject_invoice',
            'merchant_id': merchantId,
            'rejection_reason': reason.trim(),
          }),
        )
        .timeout(const Duration(seconds: 20));
    return Map<String, dynamic>.from(_decode(res) as Map);
  }

  Future<List<Map<String, dynamic>>> fetchStoreProducts(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/products?merchant_id=${Uri.encodeQueryComponent(merchantId)}',
    );
    final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<void> updateProduct({
    required String productId,
    bool? isAvailable,
    double? price,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/products/${Uri.encodeComponent(productId)}',
    );
    final payload = <String, dynamic>{};
    if (isAvailable != null) payload['is_available'] = isAvailable;
    if (price != null && price >= 0) payload['price'] = price;
    final res = await http
        .patch(uri, headers: _headers(), body: jsonEncode(payload))
        .timeout(const Duration(seconds: 20));
    _decode(res);
  }

  Future<List<Map<String, dynamic>>> fetchApprovalRequests(String merchantId) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchant/master-catalog/my-requests?merchant_id=${Uri.encodeQueryComponent(merchantId)}',
    );
    final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 20));
    final data = _decode(res);
    if (data is List) {
      return data.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return [];
  }

  Future<void> updateStoreOpenStatus({
    required String merchantId,
    required bool isOpen,
  }) async {
    final uri = Uri.parse(
      '${MerchantAppConfig.normalizedBaseUrl}/api/merchants/${Uri.encodeComponent(merchantId)}',
    );
    final res = await http
        .patch(
          uri,
          headers: _headers(),
          body: jsonEncode({'is_open': isOpen}),
        )
        .timeout(const Duration(seconds: 20));
    _decode(res);
  }
}
