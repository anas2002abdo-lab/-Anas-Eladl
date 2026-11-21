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

class OtlobhaCustomerApi {
  /// Connected by default to the live Otlobha backend; override via --dart-define=API_BASE_URL=...
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app',
  );

  /// Dedicated isolated Customer Accounts Portal URL (e.g. https://otlobha-accounts-xxxx.europe-west2.run.app)
  /// completely separated from the Admin Dashboard. Override via --dart-define=CUSTOMER_PORTAL_URL=...
  static const String customerPortalBaseUrl = String.fromEnvironment(
    'CUSTOMER_PORTAL_URL',
    defaultValue: '',
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

  /// Normalizes API_BASE_URL by removing trailing slashes and accidental trailing '/api', '/admin', or '/dashboard'
  /// so endpoints never resolve to '/api/api/...' or '/admin/api/...'.
  static String normalizeBaseUrl(String raw) {
    var clean = raw.trim();
    while (clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    for (final suffix in const ['/api', '/admin', '/dashboard']) {
      if (clean.toLowerCase().endsWith(suffix)) {
        clean = clean.substring(0, clean.length - suffix.length);
        while (clean.endsWith('/')) {
          clean = clean.substring(0, clean.length - 1);
        }
      }
    }
    return clean;
  }

  static final RegExp _invisibleUnicodeRe = RegExp(r'[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]');
  static final RegExp _emailFormatRe = RegExp(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$",
  );
  static const Map<String, String> _arabicIndicDigits = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };

  /// Mirrors `src/shared/email.ts` identically so mobile & backend never disagree on valid emails.
  static String sanitizeEmailInput(String raw) {
    final buf = StringBuffer();
    for (final rune in raw.runes) {
      final ch = String.fromCharCode(rune);
      buf.write(_arabicIndicDigits[ch] ?? ch);
    }
    return buf
        .toString()
        .replaceAll(RegExp(r'[\uFF20＠]'), '@')
        .replaceAll(RegExp(r'[\uFF0E\u3002\uFF61．。｡]'), '.')
        .replaceAll(_invisibleUnicodeRe, '')
        .replaceAll(RegExp(r'[\s\u00A0]+'), '')
        .toLowerCase();
  }

  static String? normalizeEmail(String raw) {
    final clean = sanitizeEmailInput(raw);
    if (clean.isEmpty || clean.length > 254) return null;
    final atIdx = clean.indexOf('@');
    if (atIdx <= 0 || atIdx != clean.lastIndexOf('@')) return null;

    final local = clean.substring(0, atIdx);
    final domain = clean.substring(atIdx + 1);
    if (local.length > 64 || domain.length < 3 || domain.length > 253) return null;
    if (local.startsWith('.') || local.endsWith('.') || local.contains('..')) return null;
    if (domain.contains('..')) return null;

    final lastDot = domain.lastIndexOf('.');
    if (lastDot < 0) return null;
    final tld = domain.substring(lastDot + 1);
    if (tld.length < 2 || !RegExp(r'^[a-z0-9-]+$').hasMatch(tld)) return null;

    if (!_emailFormatRe.hasMatch(clean)) return null;
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

  static const String _prefAccessToken = 'otlobha_cust_access_token';
  static const String _prefRefreshToken = 'otlobha_cust_refresh_token';
  static const String _prefUserJson = 'otlobha_cust_user_json';

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
    _clearPersistedTokensAsync();
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

  Future<void> _clearPersistedTokensAsync() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefAccessToken);
      await prefs.remove(_prefRefreshToken);
      await prefs.remove(_prefUserJson);
    } catch (_) {}
  }

  Future<void> persistUserSnapshot(Map<String, dynamic> user) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefUserJson, jsonEncode(user));
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> restorePersistedSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedAccess = prefs.getString(_prefAccessToken);
      final savedRefresh = prefs.getString(_prefRefreshToken);
      final savedUserRaw = prefs.getString(_prefUserJson);
      if (savedAccess != null && savedAccess.isNotEmpty) {
        _accessToken = savedAccess;
      }
      if (savedRefresh != null && savedRefresh.isNotEmpty) {
        _refreshToken = savedRefresh;
      }
      if (!hasTokens && (_refreshToken == null || _refreshToken!.isEmpty)) {
        return null;
      }
      if (savedUserRaw != null && savedUserRaw.isNotEmpty) {
        final decoded = jsonDecode(savedUserRaw);
        if (decoded is Map) {
          return Map<String, dynamic>.from(decoded);
        }
      }
      return <String, dynamic>{};
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

  Future<Map<String, dynamic>> bootstrap({bool lite = false}) async {
    final uri = _apiUri(
      '/api/mobile/customer/bootstrap',
      queryParameters: lite ? const {'lite': '1'} : null,
    );
    final res = await _sendWithAuth((h) => http.get(uri, headers: h));
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

  Future<Map<String, dynamic>> getProductsPaginated({
    String? merchantId,
    String? categoryId,
    bool offersOnly = false,
    String? query,
    int page = 1,
    int limit = 40,
  }) async {
    final params = <String, String>{
      'paginated': '1',
      'approved_only': '1',
      'page': page.toString(),
      'limit': limit.toString(),
      if (merchantId != null && merchantId.isNotEmpty && merchantId != 'all') 'merchant_id': merchantId,
      if (categoryId != null && categoryId.isNotEmpty && categoryId != 'all' && categoryId != 'offers')
        'category_id': categoryId,
      if (offersOnly || categoryId == 'offers') 'offers_only': '1',
      if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
    };
    final uri = _apiUri('/api/products', queryParameters: params);
    final res = hasTokens
        ? await _sendWithAuth((h) => http.get(uri, headers: h))
        : await _execute(() => http.get(uri, headers: _headers(includeAuth: false)));
    return _decode(res, endpointHint: '/api/products');
  }

  Future<Map<String, dynamic>> updateProfile({
    String? fullName,
    int? age,
    String? country,
    String? city,
    String? phone,
    String? secondaryPhone,
    String? addressLandmark,
    String? defaultZoneId,
    double? lastLat,
    double? lastLng,
    bool? profileCompleted,
  }) async {
    final res = await _sendWithAuth(
      (h) => http.patch(
        _apiUri('/api/mobile/customer/me'),
        headers: h,
        body: jsonEncode({
          if (fullName != null) 'full_name': fullName,
          if (age != null) 'age': age,
          if (country != null) 'country': country,
          if (city != null) 'city': city,
          if (phone != null) 'phone': phone,
          if (secondaryPhone != null) 'secondary_phone': secondaryPhone,
          if (addressLandmark != null) 'address_landmark': addressLandmark,
          if (defaultZoneId != null && defaultZoneId.isNotEmpty) 'default_zone_id': defaultZoneId,
          if (lastLat != null) 'last_lat': lastLat,
          if (lastLng != null) 'last_lng': lastLng,
          if (profileCompleted != null) 'profile_completed': profileCompleted,
        }),
      ),
      json: true,
    );
    final data = _decode(res, endpointHint: '/api/mobile/customer/me');
    if (data['customer'] is Map) {
      await persistUserSnapshot(Map<String, dynamic>.from(data['customer'] as Map));
    }
    return data;
  }

  Future<Map<String, dynamic>> signInWithGoogle(String idToken) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/auth/google'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'id_token': idToken}),
      ),
    );
    final data = _decode(res, endpointHint: '/api/mobile/customer/auth/google');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    if (data['user'] is Map) {
      await persistUserSnapshot(Map<String, dynamic>.from(data['user'] as Map));
    }
    return data;
  }

  static Uri _portalUri(
    String dedicatedPath,
    String staticHtmlPath,
    String fallbackPath, {
    Map<String, String>? queryParameters,
  }) {
    final dedicatedBase = normalizeBaseUrl(customerPortalBaseUrl);
    final useDedicated = dedicatedBase.isNotEmpty;
    final base = useDedicated ? dedicatedBase : _resolvedBaseUrl;
    final isStaticHost = useDedicated && dedicatedBase.toLowerCase().contains('github.io');
    final path = useDedicated ? (isStaticHost ? staticHtmlPath : dedicatedPath) : fallbackPath;
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    final uri = Uri.parse('$base$normalizedPath');
    if (queryParameters == null || queryParameters.isEmpty) {
      return uri;
    }
    return uri.replace(queryParameters: queryParameters);
  }

  /// Verifies that an external portal URI is genuinely a dedicated Customer Portal page
  /// (never the Admin Dashboard!) before launching an external browser.
  Future<bool> isSafeExternalPortalUri(Uri uri) async {
    try {
      final res = await http
          .get(uri, headers: const {'Accept': 'text/html'})
          .timeout(const Duration(seconds: 4));
      if (res.statusCode != 200) return false;
      final body = utf8.decode(res.bodyBytes, allowMalformed: true);
      return body.contains('otlobha-customer-portal-marker');
    } catch (_) {
      return false;
    }
  }

  /// External browser page for entering the 6-digit email verification code and returning to app.
  /// Uses the dedicated isolated Customer Accounts Portal (CUSTOMER_PORTAL_URL — e.g. GitHub Pages) when configured.
  Uri verifyEmailExternalUri({String? email, bool autoSend = true}) {
    final cleanEmail = (email != null && email.trim().isNotEmpty)
        ? (normalizeEmail(email) ?? sanitizeEmailInput(email))
        : '';
    return _portalUri(
      '/verify-email',
      '/verify-email.html',
      '/portal/customer/verify-email',
      queryParameters: {
        if (cleanEmail.isNotEmpty) 'email': cleanEmail,
        if (autoSend) 'auto': '1',
      },
    );
  }

  /// External browser page for forgot password (email -> 6-digit code -> new password -> return to app).
  /// Uses the dedicated isolated Customer Accounts Portal (CUSTOMER_PORTAL_URL — e.g. GitHub Pages) when configured.
  Uri forgotPasswordExternalUri({String? email}) {
    final cleanEmail = (email != null && email.trim().isNotEmpty)
        ? (normalizeEmail(email) ?? sanitizeEmailInput(email))
        : '';
    return _portalUri(
      '/forgot-password',
      '/forgot-password.html',
      '/portal/customer/forgot-password',
      queryParameters: {
        if (cleanEmail.isNotEmpty) 'email': cleanEmail,
      },
    );
  }

  /// Requests a 6-digit email verification code (used by in-app fallback if external portal is unavailable).
  Future<Map<String, dynamic>> requestEmailVerifyCode(String email) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    var res = await _execute(
      () => http.post(
        _apiUri('/api/auth/customer/email-verify/request-code'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': cleanEmail}),
      ),
    );
    if (res.statusCode == 404) {
      res = await _execute(
        () => http.post(
          _apiUri('/api/auth/otp/request'),
          headers: _headers(json: true, includeAuth: false),
          body: jsonEncode({'email': cleanEmail, 'role': 'customer'}),
        ),
      );
      final fallback = _decode(res, endpointHint: '/api/auth/otp/request');
      return <String, dynamic>{...fallback, 'verify_flow': 'legacy_otp'};
    }
    return _decode(res, endpointHint: '/api/auth/customer/email-verify/request-code');
  }

  /// Confirms a 6-digit email verification code (used by in-app fallback if external portal is unavailable).
  Future<Map<String, dynamic>> confirmEmailVerifyCode({
    required String email,
    required String code,
    bool useLegacyOtpFlow = false,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    if (useLegacyOtpFlow) {
      return verifyOtp(cleanEmail, code.trim(), role: 'customer');
    }
    final res = await _execute(
      () => http.post(
        _apiUri('/api/auth/customer/email-verify/confirm-code'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': cleanEmail, 'code': code.trim()}),
      ),
    );
    if (res.statusCode == 404) {
      return verifyOtp(cleanEmail, code.trim(), role: 'customer');
    }
    return _decode(res, endpointHint: '/api/auth/customer/email-verify/confirm-code');
  }

  /// Direct account creation without prior email verification — enters the app immediately
  /// and triggers a post-login notification to verify the email via external code page.
  Future<Map<String, dynamic>> registerCustomerDirect({
    required String fullName,
    required String email,
    String? phone,
    required String password,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final payload = jsonEncode({
      'full_name': fullName.trim(),
      'email': cleanEmail,
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      'password': password,
    });
    var res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register-direct'),
        headers: _headers(json: true, includeAuth: false),
        body: payload,
      ),
    );
    if (res.statusCode == 404) {
      res = await _execute(
        () => http.post(
          _apiUri('/api/auth/customer/register-direct'),
          headers: _headers(json: true, includeAuth: false),
          body: payload,
        ),
      );
    }
    if (res.statusCode == 404) {
      throw const ApiException(
        'جاري التحويل تلقائيًا للتسجيل برمز التحقق...',
        statusCode: 404,
      );
    }
    final data = _decode(res, endpointHint: '/api/mobile/customer/register-direct');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    if (data['user'] is Map) {
      await persistUserSnapshot(Map<String, dynamic>.from(data['user'] as Map));
    }
    return data;
  }

  Future<Map<String, dynamic>> sendRegisterVerificationLink({
    required String fullName,
    required String email,
    String? phone,
    required String password,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register/send-verification-link'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'full_name': fullName.trim(),
          'email': cleanEmail,
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          'password': password,
        }),
      ),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/register/send-verification-link');
  }

  Future<Map<String, dynamic>> checkRegisterEmailVerified({
    required String email,
    required String password,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register/check-verified'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'email': cleanEmail,
          'password': password,
        }),
      ),
    );
    final data = _decode(res, endpointHint: '/api/mobile/customer/register/check-verified');
    final tokens = data['tokens'];
    if (tokens is Map) {
      setTokens(
        accessToken: tokens['access_token']?.toString(),
        refreshToken: tokens['refresh_token']?.toString(),
      );
    }
    if (data['user'] is Map) {
      await persistUserSnapshot(Map<String, dynamic>.from(data['user'] as Map));
    }
    return data;
  }

  Future<Map<String, dynamic>> sendPasswordResetLink(String email) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/forgot-password/send-link'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': cleanEmail}),
      ),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/forgot-password/send-link');
  }

  Future<Map<String, dynamic>> requestCustomerRegisterOtp({
    required String fullName,
    required String email,
    String? phone,
    required String password,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/register/request-otp'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'full_name': fullName.trim(),
          'email': cleanEmail,
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          'password': password,
        }),
      ),
    );
    if (res.statusCode == 404) {
      debugPrint(
        '[OtlobhaCustomerApi] /api/mobile/customer/register/request-otp returned 404; falling back to /api/auth/otp/request',
      );
      final fallback = await requestOtp(cleanEmail, role: 'customer');
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
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    if (useLegacyOtpFlow) {
      return verifyOtp(
        cleanEmail,
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
          'email': cleanEmail,
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
        cleanEmail,
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
    final rawIdent = identifier.trim();
    final cleanIdent = (rawIdent.contains('@') || rawIdent.contains('＠'))
        ? (normalizeEmail(rawIdent) ?? sanitizeEmailInput(rawIdent))
        : rawIdent;
    final payload = jsonEncode({
      'identifier': cleanIdent,
      'password': password,
    });
    var res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/login'),
        headers: _headers(json: true, includeAuth: false),
        body: payload,
      ),
    );
    if (res.statusCode == 404) {
      res = await _execute(
        () => http.post(
          _apiUri('/api/auth/customer/login'),
          headers: _headers(json: true, includeAuth: false),
          body: payload,
        ),
      );
    }
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
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/forgot-password/request'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': cleanEmail}),
      ),
    );
    return _decode(res, endpointHint: '/api/mobile/customer/forgot-password/request');
  }

  Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/mobile/customer/forgot-password/reset'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'email': cleanEmail,
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
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/auth/otp/request'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'email': cleanEmail, 'role': role}),
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
    final cleanEmail = normalizeEmail(email) ?? sanitizeEmailInput(email);
    final res = await _execute(
      () => http.post(
        _apiUri('/api/auth/otp/verify'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({
          'email': cleanEmail,
          'code': code.trim(),
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

  Future<Map<String, dynamic>> createBundleOrder(Map<String, dynamic> payload) async {
    final res = await _sendWithAuth(
      (h) => http.post(_apiUri('/api/orders/bundle'), headers: h, body: jsonEncode(payload)),
      json: true,
      timeout: _uploadTimeout,
    );
    return _decode(res, endpointHint: '/api/orders/bundle');
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

  static String resolveMediaUrl(dynamic raw) {
    final str = (raw ?? '').toString().trim();
    if (str.isEmpty) return '';
    if (str.startsWith('http://') || str.startsWith('https://')) return str;
    if (str.startsWith('/')) return '$_resolvedBaseUrl$str';
    return str;
  }

  Future<Map<String, dynamic>> getStorefrontHome({
    String? filter,
    String? categoryId,
    String? brand,
    String? merchantId,
    int page = 1,
    int limit = 24,
  }) async {
    final qp = <String, String>{
      'page': '$page',
      'limit': '$limit',
      if (filter != null && filter.isNotEmpty) 'filter': filter,
      if (categoryId != null && categoryId.isNotEmpty) 'category_id': categoryId,
      if (brand != null && brand.isNotEmpty) 'brand': brand,
      if (merchantId != null && merchantId.isNotEmpty) 'merchant_id': merchantId,
    };
    final res = await _execute(
      () => http.get(
        _apiUri('/api/storefront/home', queryParameters: qp),
        headers: _headers(includeAuth: false),
      ),
    );
    return _decode(res, endpointHint: '/api/storefront/home');
  }

  Future<Map<String, dynamic>> searchStorefront({
    String? q,
    String? categoryId,
    String? brand,
    String? merchantId,
    String? minPrice,
    String? maxPrice,
    String? sort,
    int limit = 30,
  }) async {
    final qp = <String, String>{
      'limit': '$limit',
      if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
      if (categoryId != null && categoryId.isNotEmpty) 'category_id': categoryId,
      if (brand != null && brand.isNotEmpty) 'brand': brand,
      if (merchantId != null && merchantId.isNotEmpty) 'merchant_id': merchantId,
      if (minPrice != null && minPrice.trim().isNotEmpty) 'min_price': minPrice.trim(),
      if (maxPrice != null && maxPrice.trim().isNotEmpty) 'max_price': maxPrice.trim(),
      if (sort != null && sort.isNotEmpty) 'sort': sort,
    };
    final res = await _execute(
      () => http.get(
        _apiUri('/api/storefront/search', queryParameters: qp),
        headers: _headers(includeAuth: false),
      ),
    );
    return _decode(res, endpointHint: '/api/storefront/search');
  }

  Future<Map<String, dynamic>> getStorefrontProductDetails(String productId) async {
    final encId = Uri.encodeComponent(productId);
    final res = await _execute(
      () => http.get(
        _apiUri('/api/storefront/products/$encId/details'),
        headers: _headers(includeAuth: false),
      ),
    );
    return _decode(res, endpointHint: '/api/storefront/products/$productId');
  }

  Future<Map<String, dynamic>> askStorefrontAssistant(String prompt) async {
    final res = await _execute(
      () => http.post(
        _apiUri('/api/storefront/assistant'),
        headers: _headers(json: true, includeAuth: false),
        body: jsonEncode({'prompt': prompt}),
      ),
    );
    return _decode(res, endpointHint: '/api/storefront/assistant');
  }
}
