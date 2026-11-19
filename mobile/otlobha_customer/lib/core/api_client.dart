import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final String? contentType;

  const ApiException(this.message, {this.statusCode, this.contentType});

  @override
  String toString() => message;
}

class OtlobhaCustomerApi {
  /// Connected by default to the live Otlobha backend; override via --dart-define=API_BASE_URL=...
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app',
  );

  static const Duration _defaultTimeout = Duration(seconds: 30);
  static const Duration _uploadTimeout = Duration(seconds: 60);

  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshFuture;

  bool get hasTokens => (_accessToken ?? '').isNotEmpty;

  Map<String, String> get wsHeaders =>
      (_accessToken != null && _accessToken!.isNotEmpty)
          ? {'Authorization': 'Bearer $_accessToken'}
          : const {};

  /// Normalizes API_BASE_URL by removing trailing slashes and accidental trailing '/api'
  /// so endpoints never resolve to '/api/api/...'.
  static String normalizeBaseUrl(String raw) {
    var clean = raw.trim();
    while (clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    if (clean.toLowerCase().endsWith('/api')) {
      clean = clean.substring(0, clean.length - 4);
      while (clean.endsWith('/')) {
        clean = clean.substring(0, clean.length - 1);
      }
    }
    return clean;
  }

  static String get _resolvedBaseUrl => normalizeBaseUrl(baseUrl);

  static Uri _apiUri(String path, {Map<String, String>? queryParameters}) {
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    final uri = Uri.parse('$_resolvedBaseUrl$normalizedPath');
    if (queryParameters == null || queryParameters.isEmpty) {
      return uri;
    }
    return uri.replace(queryParameters: queryParameters);
  }

  static String get _wsBaseUrl {
    final clean = _resolvedBaseUrl;
    if (clean.startsWith('https://')) {
      return clean.replaceFirst('https://', 'wss://');
    }
    if (clean.startsWith('http://')) {
      return clean.replaceFirst('http://', 'ws://');
    }
    return clean;
  }

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

  Map<String, String> _headers({bool json = false, bool includeAuth = true}) {
    return {
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json; charset=utf-8',
      if (includeAuth && _accessToken != null && _accessToken!.isNotEmpty)
        'Authorization': 'Bearer $_accessToken',
    };
  }

  Future<http.Response> _execute(
    Future<http.Response> Function() requestFn, {
    Duration timeout = _defaultTimeout,
  }) async {
    try {
      return await requestFn().timeout(timeout);
    } on TimeoutException {
      throw const ApiException('انتهت مهلة الاتصال بالخادم، يرجى المحاولة مرة أخرى');
    } on ApiException {
      rethrow;
    } on http.ClientException catch (e) {
      debugPrint('[OtlobhaCustomerApi] ClientException: ${e.message}');
      throw const ApiException('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى');
    } catch (e) {
      debugPrint('[OtlobhaCustomerApi] Network error: ${e.runtimeType}');
      throw const ApiException('تعذر الاتصال بالخادم حاليًا، يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
    }
  }

  Future<bool> _refreshAccessToken() async {
    if (_refreshToken == null || _refreshToken!.isEmpty) return false;
    if (_refreshFuture != null) return _refreshFuture!;

    _refreshFuture = () async {
      try {
        final res = await _execute(
          () => http.post(
            _apiUri('/api/auth/refresh'),
            headers: _headers(json: true, includeAuth: false),
            body: jsonEncode({'refresh_token': _refreshToken}),
          ),
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          final decoded = parseJsonResponse(res, endpointHint: '/api/auth/refresh');
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
    Duration timeout = _defaultTimeout,
  }) async {
    var res = await _execute(() => sender(_headers(json: json)), timeout: timeout);
    if (res.statusCode == 401 && allowRefresh && _refreshToken != null && _refreshToken!.isNotEmpty) {
      final ok = await _refreshAccessToken();
      if (ok) {
        res = await _execute(() => sender(_headers(json: json)), timeout: timeout);
      }
    }
    return res;
  }

  Future<Map<String, dynamic>> bootstrap() async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/customer/bootstrap'), headers: h),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/bootstrap');
  }

  Future<Map<String, dynamic>> guestBootstrap() async {
    final res = await _execute(
      () => http.get(
        _apiUri('/api/mobile/customer/guest-bootstrap'),
        headers: _headers(includeAuth: false),
      ),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/guest-bootstrap');
  }

  Future<Map<String, dynamic>> updateProfile({
    String? fullName,
    String? phone,
    String? addressLandmark,
    String? defaultZoneId,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/customer/me'),
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
    return _decode(res, endpointHint: '/api/mobile/customer/me');
  }

  Future<Map<String, dynamic>> requestCustomerRegisterOtp({
    required String fullName,
    required String email,
    String? phone,
    required String password,
  }) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register/request-otp'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'full_name': fullName.trim(),
          'email': email.trim(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          'password': password,
        }),
      ),
    );
    if (res.statusCode == 404) {
      debugPrint(
        '[OtlobhaCustomerApi] /api/mobile/customer/register/request-otp returned 404; falling back to /api/auth/otp/request',
      );
      final fallback = await requestOtp(email.trim(), role: 'customer');
      return <String, dynamic>{
        ...fallback,
        'auth_flow': 'legacy_otp',
      };
    }
    final data = _decode(res, endpointHint: '/api/mobile/customer/register/request-otp');
    return <String, dynamic>{
      ...data,
      'auth_flow': 'register_otp',
    };
  }

  Future<Map<String, dynamic>> registerCustomer({
    required String fullName,
    required String email,
    String? phone,
    required String password,
    required String code,
    String? addressLandmark,
    String? defaultZoneId,
    bool useLegacyOtpFlow = false,
  }) async {
    if (useLegacyOtpFlow) {
      return verifyOtp(
        email.trim(),
        code.trim(),
        role: 'customer',
        fullName: fullName.trim(),
        phone: phone?.trim(),
        password: password,
      );
    }

    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'full_name': fullName.trim(),
          'email': email.trim(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          'password': password,
          'code': code.trim(),
          if (addressLandmark != null && addressLandmark.trim().isNotEmpty)
            'address_landmark': addressLandmark.trim(),
          if (defaultZoneId != null && defaultZoneId.trim().isNotEmpty)
            'default_zone_id': defaultZoneId.trim(),
        }),
      ),
    );
    if (res.statusCode == 404) {
      debugPrint(
        '[OtlobhaCustomerApi] /api/mobile/customer/register returned 404; falling back to /api/auth/otp/verify',
      );
      return verifyOtp(
        email.trim(),
        code.trim(),
        role: 'customer',
        fullName: fullName.trim(),
        phone: phone?.trim(),
        password: password,
      );
    }
    final data = _decode(res, endpointHint: '/api/mobile/customer/register');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> loginCustomer({
    required String identifier,
    required String password,
  }) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/login'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'identifier': identifier.trim(),
          'password': password,
        }),
      ),
    );
    final data = _decode(res, endpointHint: '/api/mobile/customer/login');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> requestPasswordReset(String email) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/forgot-password/request'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': email.trim()}),
      ),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/forgot-password/request');
  }

  Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/forgot-password/reset'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'email': email.trim(),
          'code': code.trim(),
          'new_password': newPassword,
        }),
      ),
    );
    final data = _decode(res, endpointHint: '/api/mobile/customer/forgot-password/reset');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> requestOtp(String email, {String role = 'customer'}) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/auth/otp/request'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': email, 'role': role}),
      ),
    );
    return _decode(res, endpointHint: '/api/auth/otp/request');
  }

  Future<Map<String, dynamic>> verifyOtp(
    String email,
    String code, {
    String role = 'customer',
    String? fullName,
    String? phone,
    String? password,
  }) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/auth/otp/verify'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'email': email,
          'code': code,
          'role': role,
          if (fullName != null && fullName.trim().isNotEmpty) 'full_name': fullName.trim(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          if (password != null && password.length >= 6) 'password': password,
        }),
      ),
    );
    final data = _decode(res, endpointHint: '/api/auth/otp/verify');
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
      await _execute(
        () => http.post(
          _apiUri('/api/auth/logout'),
          headers: _headers(json: true),
          body: jsonEncode({
            if (_refreshToken != null && _refreshToken!.isNotEmpty) 'refresh_token': _refreshToken,
          }),
        ),
        timeout: const Duration(seconds: 10),
      );
    } catch (_) {
      // ignore logout transport errors; always clear local tokens
    } finally {
      clearTokens();
    }
  }

  Future<Map<String, dynamic>> simulatePrice(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/pricing/simulate'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res, endpointHint: '/api/pricing/simulate');
  }

  Future<Map<String, dynamic>> validateCoupon(String code, double subtotal, String serviceType) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/mobile/coupons/validate'),
        headers: h,
        body: jsonEncode({'code': code, 'subtotal': subtotal, 'service_type': serviceType}),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/coupons/validate');
  }

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/orders'), headers: h, body: jsonEncode(payload)),
      json: true,
      timeout: _uploadTimeout,
    );
    return _decode(res, endpointHint: '/api/orders');
  }

  Future<Map<String, dynamic>> requestRide(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/mobile/rides'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/rides');
  }

  Future<Map<String, dynamic>> requestParcel(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/mobile/parcels'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/parcels');
  }

  Future<Map<String, dynamic>> createMarketListing(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/market'), headers: h, body: jsonEncode(payload)),
      json: true,
      timeout: _uploadTimeout,
    );
    return _decode(res, endpointHint: '/api/market');
  }

  Future<List<dynamic>> getNotifications() async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/notifications', queryParameters: {'app': 'customer'}), headers: h),
    );
    return _decodeList(res, endpointHint: '/api/mobile/notifications', fallbackError: 'تعذر تحميل الإشعارات');
  }

  Future<void> markNotificationRead(String id) async {
    final res = await _sendWithAuth(
      (h) => http.patch(_apiUri('/api/mobile/notifications/${Uri.encodeComponent(id)}/read'), headers: h),
    );
    _ensureSuccess(res, endpointHint: '/api/mobile/notifications/$id/read');
  }

  Uri orderChatWsUri(String orderId) {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?orderId=${Uri.encodeComponent(orderId)}');
  }

  Uri tripChatWsUri(String tripId) {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?tripId=${Uri.encodeComponent(tripId)}');
  }

  Uri customerChannelWsUri() {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?channel=customer');
  }

  Future<List<dynamic>> getNearbyCaptains(double lat, double lng, {String? vehicleType}) async {
    final params = <String, String>{
      'lat': lat.toString(),
      'lng': lng.toString(),
      if (vehicleType != null && vehicleType.isNotEmpty) 'vehicle_type': vehicleType,
    };
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/captains/nearby', queryParameters: params), headers: h),
    );
    return _decodeList(res, endpointHint: '/api/mobile/captains/nearby', fallbackError: 'تعذر تحميل أقرب الطيارين');
  }

  Future<Map<String, dynamic>> getOrderTracking(String orderId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/orders/${Uri.encodeComponent(orderId)}/tracking'), headers: h),
    );
    return _decode(res, endpointHint: '/api/orders/$orderId/tracking');
  }

  Future<Map<String, dynamic>> getRideTracking(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/rides/${Uri.encodeComponent(tripId)}/tracking'), headers: h),
    );
    return _decode(res, endpointHint: '/api/mobile/rides/$tripId/tracking');
  }

  Future<Map<String, dynamic>> getOrderChat(String orderId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/orders/${Uri.encodeComponent(orderId)}/chat'), headers: h),
    );
    return _decode(res, endpointHint: '/api/orders/$orderId/chat');
  }

  Future<Map<String, dynamic>> sendOrderChatMessage(String orderId, Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/orders/${Uri.encodeComponent(orderId)}/chat'), headers: h, body: jsonEncode(payload)),
      json: true,
      timeout: _uploadTimeout,
    );
    return _decode(res, endpointHint: '/api/orders/$orderId/chat');
  }

  Future<Map<String, dynamic>> getRideChat(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/rides/${Uri.encodeComponent(tripId)}/chat'), headers: h),
    );
    return _decode(res, endpointHint: '/api/rides/$tripId/chat');
  }

  Future<Map<String, dynamic>> sendRideChatMessage(String tripId, Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/rides/${Uri.encodeComponent(tripId)}/chat'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res, endpointHint: '/api/rides/$tripId/chat');
  }

  Future<Map<String, dynamic>> finishTrip(
    String tripId, {
    String actorRole = 'customer',
    String actorName = 'العميل',
    String? captainId,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/trips/${Uri.encodeComponent(tripId)}/finish'),
        headers: h,
        body: jsonEncode({
          'actor_role': actorRole,
          'actor_name': actorName,
          if (captainId != null) 'captain_id': captainId,
        }),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/trips/$tripId/finish');
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
        _apiUri('/api/trips/${Uri.encodeComponent(tripId)}/cancel'),
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
    return _decode(res, endpointHint: '/api/trips/$tripId/cancel');
  }

  Future<List<dynamic>> getPendingRatings({String? customerName}) async {
    final params = <String, String>{
      if (customerName != null && customerName.trim().isNotEmpty) 'customer_name': customerName.trim(),
    };
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/ratings/pending', queryParameters: params), headers: h),
    );
    return _decodeList(res, endpointHint: '/api/mobile/ratings/pending', fallbackError: 'تعذر تحميل التقييمات المعلقة');
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
        _apiUri('/api/ratings'),
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
    return _decode(res, endpointHint: '/api/ratings');
  }

  Future<List<dynamic>> getSupportTickets({String? customerEmail, String? customerId}) async {
    final params = <String, String>{};
    if (customerEmail != null && customerEmail.trim().isNotEmpty) {
      params['customer_email'] = customerEmail.trim();
    }
    if (customerId != null && customerId.trim().isNotEmpty) {
      params['customer_id'] = customerId.trim();
    }
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/support/tickets', queryParameters: params), headers: h),
    );
    return _decodeList(res, endpointHint: '/api/support/tickets', fallbackError: 'تعذر تحميل تذاكر الدعم');
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
        _apiUri('/api/support/tickets'),
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
    return _decode(res, endpointHint: '/api/support/tickets');
  }

  Future<Map<String, dynamic>> getSupportMessages(String ticketId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/support/tickets/${Uri.encodeComponent(ticketId)}/messages'), headers: h),
    );
    return _decode(res, endpointHint: '/api/support/tickets/$ticketId/messages');
  }

  Future<Map<String, dynamic>> sendSupportMessage(
    String ticketId, {
    required String senderName,
    required String messageText,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/support/tickets/${Uri.encodeComponent(ticketId)}/messages'),
        headers: h,
        body: jsonEncode({
          'sender_role': 'customer',
          'sender_name': senderName,
          'message_text': messageText,
        }),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/support/tickets/$ticketId/messages');
  }

  static String _safeBodySnippet(String body) {
    final singleLine = body.replaceAll(RegExp(r'\s+'), ' ').trim();
    final clipped = singleLine.length > 140 ? '${singleLine.substring(0, 140)}...' : singleLine;
    return clipped.replaceAll(RegExp(r'(token|password|secret|cookie|authorization)[^,\s}&]*', caseSensitive: false), '[REDACTED]');
  }

  static bool _looksLikeHtml(String trimmedBody, String contentType) {
    final lowerCt = contentType.toLowerCase();
    if (lowerCt.contains('text/html') || lowerCt.contains('application/xhtml')) {
      return true;
    }
    final lowerStart = trimmedBody.length > 32 ? trimmedBody.substring(0, 32).toLowerCase() : trimmedBody.toLowerCase();
    return lowerStart.startsWith('<!doctype') ||
        lowerStart.startsWith('<html') ||
        lowerStart.startsWith('<head') ||
        lowerStart.startsWith('<body') ||
        lowerStart.startsWith('<?xml');
  }

  static String _friendlyStatusError(int statusCode, {String? fallbackError}) {
    if (statusCode == 400) return fallbackError ?? 'البيانات المدخلة غير مكتملة أو غير صالحة';
    if (statusCode == 401) return 'انتهت الجلسة أو بيانات الدخول غير صحيحة، يرجى تسجيل الدخول مرة أخرى';
    if (statusCode == 403) return 'غير مصرح لك بتنفيذ هذا الإجراء';
    if (statusCode == 404) return 'الخدمة المطلوبة غير متوفرة حاليًا على الخادم';
    if (statusCode == 413) return 'حجم الصور أو البيانات المرفوعة كبير جدًا، يرجى تقليل حجم الصور والمحاولة مرة أخرى';
    if (statusCode == 429) return 'تم إرسال طلبات كثيرة، يرجى الانتظار قليلًا ثم المحاولة مرة أخرى';
    if (statusCode >= 500) return 'حدث خطأ مؤقت في الخادم، يرجى المحاولة مرة أخرى بعد قليل';
    return fallbackError ?? 'حدث خطأ في الاتصال بالخادم';
  }

  static String _friendlyNonJsonError(int statusCode, String trimmedBody, String contentType, {String? fallbackError}) {
    final lowerBody = trimmedBody.toLowerCase();
    if (statusCode == 301 ||
        statusCode == 302 ||
        statusCode == 303 ||
        statusCode == 307 ||
        statusCode == 308 ||
        lowerBody.contains('__cookie_check') ||
        lowerBody.contains('302 found') ||
        lowerBody.contains('accounts.google.com')) {
      return 'تعذر الاتصال بخادم التطبيق لأن رابط الخادم الحالي محمي ببوابة تحقق متصفح وليس رابط API عام. يرجى تحديث عنوان الخادم وإعادة المحاولة.';
    }
    if (statusCode == 413) {
      return 'حجم الصور أو البيانات المرفوعة كبير جدًا، يرجى تقليل حجم الصور والمحاولة مرة أخرى';
    }
    if (statusCode == 404) {
      return 'تعذر العثور على الخدمة المطلوبة على الخادم، يرجى التأكد من تحديث التطبيق وعنوان الخادم';
    }
    if (statusCode == 502 || statusCode == 503 || statusCode == 504) {
      return 'الخادم غير متاح مؤقتًا، يرجى المحاولة مرة أخرى بعد قليل';
    }
    if (statusCode >= 400) {
      return _friendlyStatusError(statusCode, fallbackError: fallbackError);
    }
    return fallbackError ?? 'تعذر قراءة استجابة الخادم (الاستجابة ليست بصيغة بيانات صالحة). يرجى التأكد من عنوان الخادم والمحاولة مرة أخرى.';
  }

  /// Safely validates status code, Content-Type, and response body before decoding JSON.
  /// Never calls jsonDecode on HTML responses and never exposes internal server details.
  static dynamic parseJsonResponse(
    http.Response res, {
    String? endpointHint,
    String? fallbackError,
  }) {
    final statusCode = res.statusCode;
    final contentType = res.headers['content-type'] ?? '';
    final rawBody = utf8.decode(res.bodyBytes, allowMalformed: true);
    final trimmed = rawBody.trimLeft();
    final endpoint = endpointHint ?? res.request?.url.path ?? 'unknown';

    if (trimmed.isEmpty) {
      if (statusCode >= 200 && statusCode < 300) {
        return <String, dynamic>{};
      }
      debugPrint('[OtlobhaCustomerApi] Empty error response: $endpoint status=$statusCode contentType=$contentType');
      throw ApiException(_friendlyStatusError(statusCode, fallbackError: fallbackError), statusCode: statusCode, contentType: contentType);
    }

    final isHtml = _looksLikeHtml(trimmed, contentType);
    final isJsonHeader = contentType.toLowerCase().contains('application/json') || contentType.toLowerCase().contains('+json');
    final looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    if (isHtml || (!isJsonHeader && !looksLikeJson)) {
      debugPrint(
        '[OtlobhaCustomerApi] Non-JSON response: $endpoint status=$statusCode contentType="$contentType" preview="${_safeBodySnippet(trimmed)}"',
      );
      throw ApiException(
        _friendlyNonJsonError(statusCode, trimmed, contentType, fallbackError: fallbackError),
        statusCode: statusCode,
        contentType: contentType,
      );
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(trimmed);
    } on FormatException {
      debugPrint(
        '[OtlobhaCustomerApi] Malformed JSON: $endpoint status=$statusCode contentType="$contentType" preview="${_safeBodySnippet(trimmed)}"',
      );
      throw ApiException(
        _friendlyNonJsonError(statusCode, trimmed, contentType, fallbackError: fallbackError),
        statusCode: statusCode,
        contentType: contentType,
      );
    }

    if (statusCode < 200 || statusCode >= 300) {
      String? serverMsg;
      if (decoded is Map) {
        final rawErr = decoded['error'] ?? decoded['message'];
        if (rawErr != null && rawErr.toString().trim().isNotEmpty) {
          serverMsg = rawErr.toString().trim();
        }
      }
      debugPrint('[OtlobhaCustomerApi] API error: $endpoint status=$statusCode contentType="$contentType"');
      throw ApiException(
        serverMsg ?? _friendlyStatusError(statusCode, fallbackError: fallbackError),
        statusCode: statusCode,
        contentType: contentType,
      );
    }

    return decoded;
  }

  Map<String, dynamic> _decode(http.Response res, {String? endpointHint, String? fallbackError}) {
    final data = parseJsonResponse(res, endpointHint: endpointHint, fallbackError: fallbackError);
    if (data is Map<String, dynamic>) {
      return data;
    }
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    debugPrint('[OtlobhaCustomerApi] Expected JSON object on ${endpointHint ?? res.request?.url.path} status=${res.statusCode}');
    throw ApiException(fallbackError ?? 'استجابة غير متوقعة من الخادم، يرجى المحاولة مرة أخرى', statusCode: res.statusCode);
  }

  List<dynamic> _decodeList(http.Response res, {String? endpointHint, String? fallbackError}) {
    final data = parseJsonResponse(res, endpointHint: endpointHint, fallbackError: fallbackError);
    if (data is List<dynamic>) {
      return data;
    }
    debugPrint('[OtlobhaCustomerApi] Expected JSON list on ${endpointHint ?? res.request?.url.path} status=${res.statusCode}');
    throw ApiException(fallbackError ?? 'استجابة غير متوقعة من الخادم، يرجى المحاولة مرة أخرى', statusCode: res.statusCode);
  }

  void _ensureSuccess(http.Response res, {String? endpointHint, String? fallbackError}) {
    parseJsonResponse(res, endpointHint: endpointHint, fallbackError: fallbackError);
  }
}
