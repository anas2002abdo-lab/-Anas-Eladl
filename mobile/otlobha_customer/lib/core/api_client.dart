import 'dart:convert';
import 'package:http/http.dart' as http;

class OtlobhaCustomerApi {
  /// Connected by default to the live Otlobha backend; override via --dart-define=API_BASE_URL=...
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app',
  );

  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshFuture;

  bool get hasTokens => (_accessToken ?? '').isNotEmpty;

  Map<String, String> get wsHeaders =>
      (_accessToken != null && _accessToken!.isNotEmpty)
          ? {'Authorization': 'Bearer $_accessToken'}
          : const {};

  void setTokens({String? accessToken, String? refreshToken}) {
    if (accessToken != null && accessToken.isNotEmpty) {
      _accessToken = accessToken;
    }
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _refreshToken = refreshToken;
    }
  }

  void clearTokens() {
    _accessToken = null;
    _refreshToken = null;
  }

  Map<String, String> _headers({bool json = false}) {
    return {
      if (json) 'Content-Type': 'application/json',
      if (_accessToken != null && _accessToken!.isNotEmpty) 'Authorization': 'Bearer $_accessToken',
    };
  }

  Future<bool> _refreshAccessToken() async {
    if (_refreshToken == null || _refreshToken!.isEmpty) return false;
    if (_refreshFuture != null) return _refreshFuture!;

    _refreshFuture = () async {
      try {
        final res = await http.post(
          Uri.parse('$baseUrl/api/auth/refresh'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'refresh_token': _refreshToken}),
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          final decoded = jsonDecode(res.body);
          if (decoded is Map<String, dynamic>) {
            final tokens = decoded['tokens'] is Map ? decoded['tokens'] as Map : decoded;
            final nextAccess = tokens['access_token']?.toString();
            final nextRefresh = tokens['refresh_token']?.toString();
            if (nextAccess != null && nextAccess.isNotEmpty) {
              _accessToken = nextAccess;
              if (nextRefresh != null && nextRefresh.isNotEmpty) {
                _refreshToken = nextRefresh;
              }
              return true;
            }
          }
        }
        clearTokens();
        return false;
      } catch (_) {
        return false;
      } finally {
        _refreshFuture = null;
      }
    }();

    return _refreshFuture!;
  }

  Future<http.Response> _sendWithAuth(
    Future<http.Response> Function(Map<String, String> headers) sender, {
    bool json = false,
    bool allowRefresh = true,
  }) async {
    var res = await sender(_headers(json: json));
    if (res.statusCode == 401 && allowRefresh && _refreshToken != null && _refreshToken!.isNotEmpty) {
      final ok = await _refreshAccessToken();
      if (ok) {
        res = await sender(_headers(json: json));
      }
    }
    return res;
  }

  Future<Map<String, dynamic>> bootstrap() async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/customer/bootstrap'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> updateProfile({
    String? fullName,
    String? phone,
    String? addressLandmark,
    String? defaultZoneId,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        Uri.parse('$baseUrl/api/mobile/customer/me'),
        headers: h,
        body: jsonEncode({
          if (fullName != null) 'full_name': fullName,
          if (phone != null) 'phone': phone,
          if (addressLandmark != null) 'address_landmark': addressLandmark,
          if (defaultZoneId != null && defaultZoneId.isNotEmpty) 'default_zone_id': defaultZoneId,
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> requestOtp(String email, {String role = 'customer'}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/auth/otp/request'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'role': role}),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> verifyOtp(
    String email,
    String code, {
    String role = 'customer',
    String? fullName,
    String? phone,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/auth/otp/verify'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'email': email,
        'code': code,
        'role': role,
        if (fullName != null && fullName.trim().isNotEmpty) 'full_name': fullName.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      }),
    );
    final data = _decode(res);
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<void> logout() async {
    try {
      await http.post(
        Uri.parse('$baseUrl/api/auth/logout'),
        headers: _headers(json: true),
        body: jsonEncode({
          if (_refreshToken != null && _refreshToken!.isNotEmpty) 'refresh_token': _refreshToken,
        }),
      );
    } catch (_) {
      // ignore
    } finally {
      clearTokens();
    }
  }

  Future<Map<String, dynamic>> simulatePrice(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/pricing/simulate'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> validateCoupon(String code, double subtotal, String serviceType) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/mobile/coupons/validate'),
        headers: h,
        body: jsonEncode({'code': code, 'subtotal': subtotal, 'service_type': serviceType}),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/orders'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> requestRide(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/mobile/rides'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> requestParcel(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/mobile/parcels'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> createMarketListing(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/market'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<List<dynamic>> getNotifications() async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/notifications?app=customer'), headers: h),
    );
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw Exception((data is Map ? data['error'] : null) ?? 'تعذر تحميل الإشعارات');
    }
    return data as List<dynamic>;
  }

  Future<void> markNotificationRead(String id) async {
    await _sendWithAuth(
      (h) => http.patch(Uri.parse('$baseUrl/api/mobile/notifications/$id/read'), headers: h),
    );
  }

  Uri orderChatWsUri(String orderId) {
    final wsBase = baseUrl.startsWith('https://')
        ? baseUrl.replaceFirst('https://', 'wss://')
        : baseUrl.replaceFirst('http://', 'ws://');
    return Uri.parse('$wsBase/ws/order-chat?orderId=${Uri.encodeComponent(orderId)}');
  }

  Uri tripChatWsUri(String tripId) {
    final wsBase = baseUrl.startsWith('https://')
        ? baseUrl.replaceFirst('https://', 'wss://')
        : baseUrl.replaceFirst('http://', 'ws://');
    return Uri.parse('$wsBase/ws/order-chat?tripId=${Uri.encodeComponent(tripId)}');
  }

  Uri customerChannelWsUri() {
    final wsBase = baseUrl.startsWith('https://')
        ? baseUrl.replaceFirst('https://', 'wss://')
        : baseUrl.replaceFirst('http://', 'ws://');
    return Uri.parse('$wsBase/ws/order-chat?channel=customer');
  }

  Future<List<dynamic>> getNearbyCaptains(double lat, double lng, {String? vehicleType}) async {
    final query = StringBuffer('lat=$lat&lng=$lng');
    if (vehicleType != null && vehicleType.isNotEmpty) {
      query.write('&vehicle_type=${Uri.encodeComponent(vehicleType)}');
    }
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/captains/nearby?$query'), headers: h),
    );
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw Exception((data is Map ? data['error'] : null) ?? 'تعذر تحميل أقرب الطيارين');
    }
    return data as List<dynamic>;
  }

  Future<Map<String, dynamic>> getOrderTracking(String orderId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/orders/$orderId/tracking'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getRideTracking(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/rides/$tripId/tracking'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getOrderChat(String orderId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/orders/$orderId/chat'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendOrderChatMessage(String orderId, Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/orders/$orderId/chat'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getRideChat(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/rides/$tripId/chat'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendRideChatMessage(String tripId, Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/rides/$tripId/chat'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> finishTrip(
    String tripId, {
    String actorRole = 'customer',
    String actorName = 'العميل',
    String? captainId,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/trips/$tripId/finish'),
        headers: h,
        body: jsonEncode({
          'actor_role': actorRole,
          'actor_name': actorName,
          if (captainId != null) 'captain_id': captainId,
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> cancelTrip(
    String tripId, {
    String actorRole = 'customer',
    String actorName = 'العميل',
    String? captainId,
    String? reason,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/trips/$tripId/cancel'),
        headers: h,
        body: jsonEncode({
          'actor_role': actorRole,
          'actor_name': actorName,
          if (captainId != null) 'captain_id': captainId,
          if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<List<dynamic>> getPendingRatings({String? customerName}) async {
    final q = (customerName != null && customerName.trim().isNotEmpty)
        ? '?customer_name=${Uri.encodeComponent(customerName.trim())}'
        : '';
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/ratings/pending$q'), headers: h),
    );
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw Exception((data is Map ? data['error'] : null) ?? 'تعذر تحميل التقييمات المعلقة');
    }
    return data as List<dynamic>;
  }

  Future<Map<String, dynamic>> submitRating({
    String? ratingId,
    String? captainId,
    String? customerName,
    String? customerPhone,
    String? refType,
    String? refId,
    String? refNumber,
    double? finalAmount,
    required int rating,
    String? comment,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/ratings'),
        headers: h,
        body: jsonEncode({
          if (ratingId != null) 'rating_id': ratingId,
          if (captainId != null) 'captain_id': captainId,
          if (customerName != null) 'customer_name': customerName,
          if (customerPhone != null) 'customer_phone': customerPhone,
          if (refType != null) 'ref_type': refType,
          if (refId != null) 'ref_id': refId,
          if (refNumber != null) 'ref_number': refNumber,
          if (finalAmount != null) 'final_amount': finalAmount,
          'rating': rating,
          if (comment != null) 'comment': comment,
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<List<dynamic>> getSupportTickets({String? customerEmail, String? customerId}) async {
    final params = <String, String>{};
    if (customerEmail != null && customerEmail.trim().isNotEmpty) {
      params['customer_email'] = customerEmail.trim();
    }
    if (customerId != null && customerId.trim().isNotEmpty) {
      params['customer_id'] = customerId.trim();
    }
    final uri = Uri.parse('$baseUrl/api/support/tickets').replace(queryParameters: params.isEmpty ? null : params);
    final res = await _sendWithAuth((h) => http.get(uri, headers: h));
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw Exception((data is Map ? data['error'] : null) ?? 'تعذر تحميل تذاكر الدعم');
    }
    return data as List<dynamic>;
  }

  Future<Map<String, dynamic>> createSupportTicket({
    String? customerId,
    required String customerName,
    String? customerPhone,
    String? customerEmail,
    required String subject,
    String category = 'general',
    required String messageText,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/support/tickets'),
        headers: h,
        body: jsonEncode({
          if (customerId != null) 'customer_id': customerId,
          'customer_name': customerName,
          if (customerPhone != null) 'customer_phone': customerPhone,
          if (customerEmail != null) 'customer_email': customerEmail,
          'subject': subject,
          'category': category,
          'message_text': messageText,
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getSupportMessages(String ticketId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/support/tickets/${Uri.encodeComponent(ticketId)}/messages'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendSupportMessage(
    String ticketId, {
    required String senderName,
    required String messageText,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/support/tickets/${Uri.encodeComponent(ticketId)}/messages'),
        headers: h,
        body: jsonEncode({
          'sender_role': 'customer',
          'sender_name': senderName,
          'message_text': messageText,
        }),
      ),
      json: true,
    );
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(data['error'] ?? 'حدث خطأ في الاتصال بالخادم');
    }
    return data;
  }
}
