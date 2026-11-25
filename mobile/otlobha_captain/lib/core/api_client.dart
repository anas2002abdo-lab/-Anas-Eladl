import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final String? contentType;

  const ApiException(this.message, {this.statusCode, this.contentType});

  @override
  String toString() => message;
}

class OtlobhaCaptainApi {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app',
  );

  static const Duration _defaultTimeout = Duration(seconds: 30);
  static const Duration _uploadTimeout = Duration(seconds: 60);

  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshFuture;

  bool get hasTokens => (_accessToken ?? '').isNotEmpty || (_refreshToken ?? '').isNotEmpty;

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

  static const String _prefAccessToken = 'otlobha_cap_access_token';
  static const String _prefRefreshToken = 'otlobha_cap_refresh_token';
  static const String _prefCaptainId = 'otlobha_cap_active_id';

  void setTokens({String? accessToken, String? refreshToken}) {
    if (accessToken != null && accessToken.isNotEmpty) {
      _accessToken = accessToken;
    }
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _refreshToken = refreshToken;
    }
    _persistTokensAsync();
  }

  void clearTokens() {
    _accessToken = null;
    _refreshToken = null;
    _clearPersistedSessionAsync();
  }

  Future<void> _persistTokensAsync() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_accessToken != null && _accessToken!.isNotEmpty) {
        await prefs.setString(_prefAccessToken, _accessToken!);
      }
      if (_refreshToken != null && _refreshToken!.isNotEmpty) {
        await prefs.setString(_prefRefreshToken, _refreshToken!);
      }
    } catch (_) {}
  }

  Future<void> _clearPersistedSessionAsync() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefAccessToken);
      await prefs.remove(_prefRefreshToken);
      await prefs.remove(_prefCaptainId);
    } catch (_) {}
  }

  Future<void> persistActiveCaptainId(String captainId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefCaptainId, captainId);
    } catch (_) {}
  }

  Future<void> reloadTokensFromStorage() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      try {
        await prefs.reload();
      } catch (_) {}
      final savedAccess = prefs.getString(_prefAccessToken)?.trim();
      final savedRefresh = prefs.getString(_prefRefreshToken)?.trim();
      if (savedAccess != null && savedAccess.isNotEmpty) {
        _accessToken = savedAccess;
      }
      if (savedRefresh != null && savedRefresh.isNotEmpty) {
        _refreshToken = savedRefresh;
      }
    } catch (_) {}
  }

  Future<String?> restorePersistedSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      try {
        await prefs.reload();
      } catch (_) {}
      final savedAccess = prefs.getString(_prefAccessToken)?.trim();
      final savedRefresh = prefs.getString(_prefRefreshToken)?.trim();
      final savedId = prefs.getString(_prefCaptainId)?.trim();
      if (savedAccess != null && savedAccess.isNotEmpty) {
        _accessToken = savedAccess;
      }
      if (savedRefresh != null && savedRefresh.isNotEmpty) {
        _refreshToken = savedRefresh;
      }
      if (!hasTokens || savedId == null || savedId.isEmpty) {
        return null;
      }
      return savedId;
    } catch (_) {
      return null;
    }
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
      debugPrint('[OtlobhaCaptainApi] ClientException: ${e.message}');
      throw const ApiException('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى');
    } catch (e) {
      debugPrint('[OtlobhaCaptainApi] Network error: ${e.runtimeType}');
      throw const ApiException('تعذر الاتصال بالخادم حاليًا، يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
    }
  }

  bool _isExplicitAuthInvalidation(http.Response res) {
    if (res.statusCode != 401 && res.statusCode != 403) return false;
    final ct = (res.headers['content-type'] ?? '').toLowerCase();
    if (!ct.contains('application/json')) return false;
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is! Map) return false;
      final code = (decoded['code'] ?? '').toString().trim().toUpperCase();
      if (code == 'SESSION_NOT_FOUND' ||
          code == 'SESSION_REVOKED' ||
          code == 'SESSION_EXPIRED' ||
          code == 'ACCOUNT_INACTIVE') {
        return true;
      }
      return decoded['error'] != null && res.statusCode == 401;
    } catch (_) {
      return false;
    }
  }

  Future<bool> _refreshAccessToken() async {
    await reloadTokensFromStorage();
    final activeRefresh = (_refreshToken ?? '').trim();
    if (activeRefresh.isEmpty) return false;
    if (_refreshFuture != null) return _refreshFuture!;

    _refreshFuture = () async {
      try {
        final res = await _execute(
          () => http.post(
            _apiUri('/api/auth/refresh'),
            headers: _headers(json: true, includeAuth: false),
            body: jsonEncode({'refresh_token': activeRefresh}),
          ),
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          final decoded = parseJsonResponse(res, endpointHint: '/api/auth/refresh');
          if (decoded is Map<String, dynamic>) {
            final tokens = decoded['tokens'] is Map ? decoded['tokens'] as Map : decoded;
            final nextAccess = tokens['access_token']?.toString().trim();
            final nextRefresh = tokens['refresh_token']?.toString().trim();
            if (nextAccess != null && nextAccess.isNotEmpty) {
              _accessToken = nextAccess;
              if (nextRefresh != null && nextRefresh.isNotEmpty) {
                _refreshToken = nextRefresh;
              }
              await _persistTokensAsync();
              return true;
            }
          }
          return false;
        }
        // Only clear persisted session on an explicit JSON 401/403 revocation from our auth server.
        // Never log out the captain on 5xx, 429, cold-start 503, or transient network errors.
        if (_isExplicitAuthInvalidation(res)) {
          clearTokens();
        }
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
    if ((_accessToken == null || _accessToken!.isEmpty) &&
        allowRefresh &&
        (_refreshToken?.trim().isNotEmpty ?? false)) {
      await _refreshAccessToken();
    }
    final sentAccess = _accessToken;
    var res = await _execute(() => sender(_headers(json: json)), timeout: timeout);
    if (res.statusCode == 401 && allowRefresh) {
      await reloadTokensFromStorage();
      if (_accessToken != null && _accessToken!.isNotEmpty && _accessToken != sentAccess) {
        res = await _execute(() => sender(_headers(json: json)), timeout: timeout);
        if (res.statusCode != 401) return res;
      }
      if ((_refreshToken ?? '').trim().isNotEmpty) {
        final ok = await _refreshAccessToken();
        if (ok) {
          res = await _execute(() => sender(_headers(json: json)), timeout: timeout);
        }
      }
    }
    return res;
  }

  Future<Map<String, dynamic>> getMe() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/auth/me'), headers: h));
    return _decode(res, endpointHint: '/api/auth/me');
  }

  Future<List<dynamic>> getOrders() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/orders'), headers: h));
    return _decodeList(res, endpointHint: '/api/orders');
  }

  Future<List<dynamic>> getParcels() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/mobile/parcels'), headers: h));
    return _decodeList(res, endpointHint: '/api/mobile/parcels');
  }

  Future<List<dynamic>> getTrips() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/trips'), headers: h));
    return _decodeList(res, endpointHint: '/api/trips');
  }

  Future<Map<String, dynamic>> getSettlements(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/settlements'), headers: h),
    );
    return _decode(res, endpointHint: '/api/mobile/captain/$captainId/settlements');
  }

  Future<Map<String, dynamic>> registerCaptain(Map<String, dynamic> payload) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/captain/register'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode(payload),
      ),
      timeout: _uploadTimeout,
    );
    final data = _decode(res, endpointHint: '/api/mobile/captain/register');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> loginCaptain(String username, String password) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/captain/login'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'username': username, 'password': password}),
      ),
    );
    final data = _decode(res, endpointHint: '/api/mobile/captain/login');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    return data;
  }

  Future<void> logout({String? fcmToken, String? deviceId}) async {
    try {
      await _execute(
        () => http.post(
          _apiUri('/api/auth/logout'),
          headers: _headers(json: true),
          body: jsonEncode({
            if (_refreshToken != null && _refreshToken!.isNotEmpty) 'refresh_token': _refreshToken,
            if (fcmToken != null && fcmToken.isNotEmpty) 'fcm_token': fcmToken,
            if (deviceId != null && deviceId.isNotEmpty) 'device_id': deviceId,
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

  Future<Map<String, dynamic>> registerPushToken({
    required String fcmToken,
    String? deviceId,
    String platform = 'android',
    String? appVersion,
    String? deviceLabel,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/mobile/push/register'),
        headers: h,
        body: jsonEncode({
          'fcm_token': fcmToken,
          if (deviceId != null && deviceId.isNotEmpty) 'device_id': deviceId,
          'platform': platform,
          if (appVersion != null && appVersion.isNotEmpty) 'app_version': appVersion,
          if (deviceLabel != null && deviceLabel.isNotEmpty) 'device_label': deviceLabel,
        }),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/push/register');
  }

  static Future<void> registerGuestPushToken({
    required String fcmToken,
    required String deviceId,
    String platform = 'android',
    String? appVersion,
    String? deviceLabel,
  }) async {
    try {
      await http
          .post(
            _apiUri('/api/mobile/push/register-guest'),
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'fcm_token': fcmToken,
              'device_id': deviceId,
              'platform': platform,
              'app': 'captain',
              if (appVersion != null && appVersion.isNotEmpty) 'app_version': appVersion,
              if (deviceLabel != null && deviceLabel.isNotEmpty) 'device_label': deviceLabel,
            }),
          )
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      // Best-effort pre-login device registration
    }
  }

  Future<void> unregisterPushToken({String? fcmToken, String? deviceId}) async {
    if (!hasTokens) return;
    try {
      await _sendWithAuth(
        (h) => http.post(
          _apiUri('/api/mobile/push/unregister'),
          headers: h,
          body: jsonEncode({
            if (fcmToken != null && fcmToken.isNotEmpty) 'fcm_token': fcmToken,
            if (deviceId != null && deviceId.isNotEmpty) 'device_id': deviceId,
          }),
        ),
        json: true,
        timeout: const Duration(seconds: 10),
      );
    } catch (_) {
      // Best-effort unregister on logout
    }
  }

  Future<void> setAvailability(String captainId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/availability'),
        headers: h,
        body: jsonEncode({'availability_status': status}),
      ),
      json: true,
    );
    _decode(res, endpointHint: '/api/mobile/captain/$captainId/availability');
  }

  Future<void> updateOrderStatus(String captainId, String orderId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/order-status'),
        headers: h,
        body: jsonEncode({'order_id': orderId, 'status': status}),
      ),
      json: true,
    );
    _decode(res, endpointHint: '/api/mobile/captain/$captainId/order-status');
  }

  Future<Map<String, dynamic>> updateCaptainLocation(String captainId, double lat, double lng) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/location'),
        headers: h,
        body: jsonEncode({'lat': lat, 'lng': lng}),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/captain/$captainId/location');
  }

  Future<Map<String, dynamic>> updateTripStatus(String captainId, String tripId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/trip-status'),
        headers: h,
        body: jsonEncode({'trip_id': tripId, 'status': status}),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/captain/$captainId/trip-status');
  }

  Future<Map<String, dynamic>> completeParcelWithOtp(String captainId, String deliveryId, String otp) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/complete-parcel'),
        headers: h,
        body: jsonEncode({'delivery_id': deliveryId, 'otp': otp}),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/captain/$captainId/complete-parcel');
  }

  Future<Map<String, dynamic>> requestSettlement(String captainId, double amount, String method) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        _apiUri('/api/mobile/captain/${Uri.encodeComponent(captainId)}/settlement-request'),
        headers: h,
        body: jsonEncode({'amount': amount, 'payout_method': method}),
      ),
      json: true,
    );
    return _decode(res, endpointHint: '/api/mobile/captain/$captainId/settlement-request');
  }

  Future<List<dynamic>> getNotifications(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(
        _apiUri('/api/mobile/notifications', queryParameters: {'app': 'captain', 'recipient_id': captainId}),
        headers: h,
      ),
    );
    return _decodeList(res, endpointHint: '/api/mobile/notifications');
  }

  Future<void> markNotificationRead(String id) async {
    final res = await _sendWithAuth(
      (h) => http.patch(_apiUri('/api/mobile/notifications/${Uri.encodeComponent(id)}/read'), headers: h),
    );
    _ensureSuccess(res, endpointHint: '/api/mobile/notifications/$id/read');
  }

  Future<void> markAllNotificationsRead({List<String>? ids, String? recipientId}) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/notifications/read-all'),
        headers: h,
        body: jsonEncode({
          'app': 'captain',
          if (recipientId != null && recipientId.isNotEmpty) 'recipient_id': recipientId,
          if (ids != null && ids.isNotEmpty) 'ids': ids,
        }),
      ),
      json: true,
    );
    _ensureSuccess(res, endpointHint: '/api/mobile/notifications/read-all');
  }

  Uri orderChatWsUri(String orderId) {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?orderId=${Uri.encodeComponent(orderId)}');
  }

  Uri tripChatWsUri(String tripId) {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?tripId=${Uri.encodeComponent(tripId)}');
  }

  Uri ridesChannelWsUri() {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?channel=rides');
  }

  Uri captainChannelWsUri(String captainId) {
    return Uri.parse('$_wsBaseUrl/ws/order-chat?channel=captain&captainId=${Uri.encodeComponent(captainId)}');
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

  Future<Map<String, dynamic>> getRideTracking(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/mobile/rides/${Uri.encodeComponent(tripId)}/tracking'), headers: h),
    );
    return _decode(res, endpointHint: '/api/mobile/rides/$tripId/tracking');
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
    String actorRole = 'captain',
    String actorName = 'الكابتن',
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
    String actorRole = 'captain',
    String actorName = 'الكابتن',
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

  Future<List<dynamic>> getProducts() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/products'), headers: h));
    return _decodeList(res, endpointHint: '/api/products');
  }

  Future<List<dynamic>> getCategories() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/categories'), headers: h));
    return _decodeList(res, endpointHint: '/api/categories');
  }

  Future<Map<String, dynamic>> getInvoiceDesign() async {
    final res = await _sendWithAuth((h) => http.get(_apiUri('/api/invoice-design'), headers: h));
    return _decode(res, endpointHint: '/api/invoice-design');
  }

  Future<List<dynamic>> getPosInvoices(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(_apiUri('/api/pos/invoices', queryParameters: {'captain_id': captainId}), headers: h),
    );
    return _decodeList(res, endpointHint: '/api/pos/invoices');
  }

  Future<Map<String, dynamic>> createPosInvoice(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/pos/invoices'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res, endpointHint: '/api/pos/invoices');
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
    if (statusCode == 413) return 'حجم الصور أو المستندات المرفوعة كبير جدًا، يرجى تقليل حجم الصور والمحاولة مرة أخرى';
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
      return 'حجم الصور أو المستندات المرفوعة كبير جدًا، يرجى تقليل حجم الصور والمحاولة مرة أخرى';
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
      debugPrint('[OtlobhaCaptainApi] Empty error response: $endpoint status=$statusCode contentType=$contentType');
      throw ApiException(_friendlyStatusError(statusCode, fallbackError: fallbackError), statusCode: statusCode, contentType: contentType);
    }

    final isHtml = _looksLikeHtml(trimmed, contentType);
    final isJsonHeader = contentType.toLowerCase().contains('application/json') || contentType.toLowerCase().contains('+json');
    final looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    if (isHtml || (!isJsonHeader && !looksLikeJson)) {
      debugPrint(
        '[OtlobhaCaptainApi] Non-JSON response: $endpoint status=$statusCode contentType="$contentType" preview="${_safeBodySnippet(trimmed)}"',
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
        '[OtlobhaCaptainApi] Malformed JSON: $endpoint status=$statusCode contentType="$contentType" preview="${_safeBodySnippet(trimmed)}"',
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
      debugPrint('[OtlobhaCaptainApi] API error: $endpoint status=$statusCode contentType="$contentType"');
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
    debugPrint('[OtlobhaCaptainApi] Expected JSON object on ${endpointHint ?? res.request?.url.path} status=${res.statusCode}');
    throw ApiException(fallbackError ?? 'استجابة غير متوقعة من الخادم، يرجى المحاولة مرة أخرى', statusCode: res.statusCode);
  }

  List<dynamic> _decodeList(http.Response res, {String? endpointHint, String? fallbackError}) {
    final data = parseJsonResponse(res, endpointHint: endpointHint, fallbackError: fallbackError);
    if (data is List<dynamic>) {
      return data;
    }
    debugPrint('[OtlobhaCaptainApi] Expected JSON list on ${endpointHint ?? res.request?.url.path} status=${res.statusCode}');
    throw ApiException(fallbackError ?? 'استجابة غير متوقعة من الخادم، يرجى المحاولة مرة أخرى', statusCode: res.statusCode);
  }

  void _ensureSuccess(http.Response res, {String? endpointHint, String? fallbackError}) {
    parseJsonResponse(res, endpointHint: endpointHint, fallbackError: fallbackError);
  }
}
