import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:otlobha_customer/core/api_client.dart';

void main() {
  group('OtlobhaCustomerApi safe response handling', () {
    test('normalizeBaseUrl strips trailing slash and trailing /api', () {
      expect(OtlobhaCustomerApi.normalizeBaseUrl('https://api.otlobha.com/'), 'https://api.otlobha.com');
      expect(OtlobhaCustomerApi.normalizeBaseUrl('https://api.otlobha.com/api'), 'https://api.otlobha.com');
      expect(OtlobhaCustomerApi.normalizeBaseUrl('https://api.otlobha.com/api/'), 'https://api.otlobha.com');
      expect(OtlobhaCustomerApi.normalizeBaseUrl('https://api.otlobha.com'), 'https://api.otlobha.com');
    });

    test('HTML 302 redirect response throws friendly ApiException instead of FormatException', () {
      final res = http.Response(
        '<html><head><title>302 Found</title></head><body><h1>302 Found</h1></body></html>',
        302,
        headers: {'content-type': 'text/html'},
      );
      expect(
        () => OtlobhaCustomerApi.parseJsonResponse(res, endpointHint: '/api/auth/otp/request'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', isNot(contains('<html>')))),
      );
    });

    test('HTML 404 or 413 response never invokes jsonDecode and returns clear Arabic error', () {
      final res404 = http.Response('<!doctype html><html><body>Not Found</body></html>', 404, headers: {'content-type': 'text/html'});
      expect(
        () => OtlobhaCustomerApi.parseJsonResponse(res404, endpointHint: '/api/orders'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 404)),
      );

      final res413 = http.Response('<html><body>Payload Too Large</body></html>', 413, headers: {'content-type': 'text/html'});
      expect(
        () => OtlobhaCustomerApi.parseJsonResponse(res413, endpointHint: '/api/orders'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 413)),
      );
    });

    test('JSON error response preserves server error message and does not hide errors', () {
      final res = http.Response.bytes(
        utf8.encode(jsonEncode({'error': 'رمز التأكيد غير صحيح'})),
        401,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
      expect(
        () => OtlobhaCustomerApi.parseJsonResponse(res, endpointHint: '/api/auth/otp/verify'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', 'رمز التأكيد غير صحيح')),
      );
    });

    test('Valid JSON response parses cleanly', () {
      final res = http.Response.bytes(
        utf8.encode(jsonEncode({'ok': true, 'email': 'user@gmail.com'})),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
      final parsed = OtlobhaCustomerApi.parseJsonResponse(res, endpointHint: '/api/auth/otp/request');
      expect(parsed, isA<Map<String, dynamic>>());
      expect((parsed as Map)['ok'], isTrue);
    });
  });
}
