import 'package:flutter/material.dart';

class MerchantAppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app',
  );

  static String get normalizedBaseUrl => apiBaseUrl.endsWith('/')
      ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
      : apiBaseUrl;

  static String wsUrlForMerchant(String merchantId, String? accessToken) {
    final base = Uri.parse(normalizedBaseUrl);
    final wsScheme = base.scheme == 'https' ? 'wss' : 'ws';
    final params = <String, String>{
      'channel': 'merchant',
      'merchantId': merchantId,
    };
    if (accessToken != null && accessToken.isNotEmpty) {
      params['token'] = accessToken;
    }
    return Uri(
      scheme: wsScheme,
      host: base.host,
      port: base.hasPort ? base.port : null,
      path: '/ws/order-chat',
      queryParameters: params,
    ).toString();
  }

  static String get merchantPortalWebUrl => '$normalizedBaseUrl/?portal=merchant&standalone=1';

  static const Color brandRed = Color(0xFFA92224);
  static const Color brandTeal = Color(0xFF0F766E);
  static const Color brandSlate = Color(0xFF0F172A);
  static const Color surfaceBg = Color(0xFFF8FAFC);
}
