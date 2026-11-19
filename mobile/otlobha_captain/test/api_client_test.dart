import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:otlobha_captain/core/api_client.dart';

void main() {
  group('OtlobhaCaptainApi safe response handling', () {
    test('normalizeBaseUrl strips trailing slash and trailing /api', () {
      expect(OtlobhaCaptainApi.normalizeBaseUrl('https://api.otlobha.com/'), 'https://api.otlobha.com');
      expect(OtlobhaCaptainApi.normalizeBaseUrl('https://api.otlobha.com/api'), 'https://api.otlobha.com');
      expect(OtlobhaCaptainApi.normalizeBaseUrl('https://api.otlobha.com/api/'), 'https://api.otlobha.com');
      expect(OtlobhaCaptainApi.normalizeBaseUrl('https://api.otlobha.com'), 'https://api.otlobha.com');
    });

    test('HTML 302 redirect response throws friendly ApiException instead of FormatException', () {
      final res = http.Response(
        '<html><head><title>302 Found</title></head><body><h1>302 Found</h1></body></html>',
        302,
        headers: {'content-type': 'text/html'},
      );
      expect(
        () => OtlobhaCaptainApi.parseJsonResponse(res, endpointHint: '/api/mobile/captain/login'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', isNot(contains('<html>')))),
      );
    });

    test('HTML 413 upload error returns clear Arabic error instead of FormatException', () {
      final res = http.Response(
        '<!DOCTYPE html><html><head><title>Error</title></head><body><pre>PayloadTooLargeError</pre></body></html>',
        413,
        headers: {'content-type': 'text/html'},
      );
      expect(
        () => OtlobhaCaptainApi.parseJsonResponse(res, endpointHint: '/api/mobile/captain/register'),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 413)),
      );
    });

    test('JSON error response preserves server error message and does not hide errors', () {
      final res = http.Response.bytes(
        utf8.encode(jsonEncode({'error': 'اسم المستخدم أو كلمة المرور غير صحيحة'})),
        401,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
      expect(
        () => OtlobhaCaptainApi.parseJsonResponse(res, endpointHint: '/api/mobile/captain/login'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', 'اسم المستخدم أو كلمة المرور غير صحيحة')),
      );
    });

    test('Valid JSON register response parses cleanly', () {
      final res = http.Response.bytes(
        utf8.encode(jsonEncode({'id': 'cap_123', 'verification_status': 'under_review'})),
        201,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
      final parsed = OtlobhaCaptainApi.parseJsonResponse(res, endpointHint: '/api/mobile/captain/register');
      expect(parsed, isA<Map<String, dynamic>>());
      expect((parsed as Map)['id'], 'cap_123');
    });
  });
}
