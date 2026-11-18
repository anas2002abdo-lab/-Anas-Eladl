import 'dart:convert';
import 'package:http/http.dart' as http;

class OtlobhaCaptainApi {
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

  Future<Map<String, dynamic>> getMe() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/auth/me'), headers: h));
    return _decode(res);
  }

  Future<List<dynamic>> getOrders() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/orders'), headers: h));
    return _decodeList(res);
  }

  Future<List<dynamic>> getParcels() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/mobile/parcels'), headers: h));
    return _decodeList(res);
  }

  Future<List<dynamic>> getTrips() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/trips'), headers: h));
    return _decodeList(res);
  }

  Future<Map<String, dynamic>> getSettlements(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/captain/$captainId/settlements'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> registerCaptain(Map<String, dynamic> payload) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/mobile/captain/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
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

  Future<Map<String, dynamic>> loginCaptain(String username, String password) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/mobile/captain/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
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

  Future<void> setAvailability(String captainId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/availability'),
        headers: h,
        body: jsonEncode({'availability_status': status}),
      ),
      json: true,
    );
    _decode(res);
  }

  Future<void> updateOrderStatus(String captainId, String orderId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/order-status'),
        headers: h,
        body: jsonEncode({'order_id': orderId, 'status': status}),
      ),
      json: true,
    );
    _decode(res);
  }

  Future<Map<String, dynamic>> updateCaptainLocation(String captainId, double lat, double lng) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/location'),
        headers: h,
        body: jsonEncode({'lat': lat, 'lng': lng}),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> updateTripStatus(String captainId, String tripId, String status) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/trip-status'),
        headers: h,
        body: jsonEncode({'trip_id': tripId, 'status': status}),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> completeParcelWithOtp(String captainId, String deliveryId, String otp) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/complete-parcel'),
        headers: h,
        body: jsonEncode({'delivery_id': deliveryId, 'otp': otp}),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> requestSettlement(String captainId, double amount, String method) async {
    final res = await _sendWithAuth(
      (h) => http.post(
        Uri.parse('$baseUrl/api/mobile/captain/$captainId/settlement-request'),
        headers: h,
        body: jsonEncode({'amount': amount, 'payout_method': method}),
      ),
      json: true,
    );
    return _decode(res);
  }

  Future<List<dynamic>> getNotifications(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/notifications?app=captain&recipient_id=$captainId'), headers: h),
    );
    return _decodeList(res);
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

  Uri ridesChannelWsUri() {
    final wsBase = baseUrl.startsWith('https://')
        ? baseUrl.replaceFirst('https://', 'wss://')
        : baseUrl.replaceFirst('http://', 'ws://');
    return Uri.parse('$wsBase/ws/order-chat?channel=rides');
  }

  Uri captainChannelWsUri(String captainId) {
    final wsBase = baseUrl.startsWith('https://')
        ? baseUrl.replaceFirst('https://', 'wss://')
        : baseUrl.replaceFirst('http://', 'ws://');
    return Uri.parse('$wsBase/ws/order-chat?channel=captain&captainId=${Uri.encodeComponent(captainId)}');
  }

  Future<Map<String, dynamic>> getOrderChat(String orderId) async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/orders/$orderId/chat'), headers: h));
    return _decode(res);
  }

  Future<Map<String, dynamic>> sendOrderChatMessage(String orderId, Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/orders/$orderId/chat'), headers: h, body: jsonEncode(payload)),
      json: true,
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getRideTracking(String tripId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/mobile/rides/$tripId/tracking'), headers: h),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> getRideChat(String tripId) async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/rides/$tripId/chat'), headers: h));
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
    String actorRole = 'captain',
    String actorName = 'الكابتن',
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
    String actorRole = 'captain',
    String actorName = 'الكابتن',
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

  Future<List<dynamic>> getProducts() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/products'), headers: h));
    return _decodeList(res);
  }

  Future<List<dynamic>> getCategories() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/categories'), headers: h));
    return _decodeList(res);
  }

  Future<Map<String, dynamic>> getInvoiceDesign() async {
    final res = await _sendWithAuth((h) => http.get(Uri.parse('$baseUrl/api/invoice-design'), headers: h));
    return _decode(res);
  }

  Future<List<dynamic>> getPosInvoices(String captainId) async {
    final res = await _sendWithAuth(
      (h) => http.get(Uri.parse('$baseUrl/api/pos/invoices?captain_id=$captainId'), headers: h),
    );
    return _decodeList(res);
  }

  Future<Map<String, dynamic>> createPosInvoice(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(Uri.parse('$baseUrl/api/pos/invoices'), headers: h, body: jsonEncode(payload)),
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

  List<dynamic> _decodeList(http.Response res) {
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw Exception((data is Map ? data['error'] : null) ?? 'حدث خطأ في الاتصال بالخادم');
    }
    return data as List<dynamic>;
  }
}
