import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/api_client.dart';
import 'core/config.dart';
import 'core/push_notification_service.dart';
import 'screens/merchant_home_screen.dart';
import 'screens/merchant_login_screen.dart';

class _OtlobhaHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    client.connectionTimeout = const Duration(seconds: 10);
    client.idleTimeout = const Duration(seconds: 8);
    client.maxConnectionsPerHost = 6;
    return client;
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = _OtlobhaHttpOverrides();
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp().timeout(const Duration(seconds: 3));
    }
    FirebaseMessaging.onBackgroundMessage(otlobhaMerchantBackgroundHandler);
  } catch (e) {
    debugPrint('[MerchantApp] Firebase init skipped (native background engine active): $e');
  }
  runApp(const OtlobhaMerchantApp());
}

class OtlobhaMerchantApp extends StatefulWidget {
  const OtlobhaMerchantApp({super.key});

  @override
  State<OtlobhaMerchantApp> createState() => _OtlobhaMerchantAppState();
}

class _OtlobhaMerchantAppState extends State<OtlobhaMerchantApp> with WidgetsBindingObserver {
  static const _tokenKey = 'otlobha_merchant_access_token';
  static const _refreshTokenKey = 'otlobha_merchant_refresh_token';
  static const _merchantKey = 'otlobha_merchant_profile';

  final MerchantApiClient _api = MerchantApiClient();
  Map<String, dynamic>? _merchant;
  bool _bootstrapping = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restoreSession();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      MerchantPushNotificationService.instance.scheduleNativeBackgroundSync(fastCheck: true);
    } else if (state == AppLifecycleState.resumed) {
      _api.resetConnectionPool();
      MerchantPushNotificationService.instance.refreshShownIdsFromStorage();
      MerchantPushNotificationService.instance.scheduleNativeBackgroundSync();
      final merchantId = _merchant?['id']?.toString() ?? '';
      if (merchantId.isNotEmpty) {
        unawaited(
          _api.reloadTokensFromStorage().then((_) {
            if (mounted) {
              unawaited(MerchantPushNotificationService.instance.syncTokenWithBackend(_api, merchantId));
            }
          }),
        );
      }
    }
  }

  Future<void> _initPushInBackground(String merchantId) async {
    try {
      await MerchantPushNotificationService.instance.init().timeout(const Duration(seconds: 8));
      await MerchantPushNotificationService.instance.requestPermissions().timeout(const Duration(seconds: 5));
      await MerchantPushNotificationService.instance
          .syncGuestTokenWithBackend(_api)
          .timeout(const Duration(seconds: 10));
      if (merchantId.isNotEmpty) {
        await MerchantPushNotificationService.instance
            .syncTokenWithBackend(_api, merchantId)
            .timeout(const Duration(seconds: 10));
      }
    } catch (_) {
      // Never block UI startup on Firebase/push registration
    }
  }

  Future<void> _restoreSession() async {
    String restoredMerchantId = '';
    try {
      final prefs = await SharedPreferences.getInstance().timeout(const Duration(seconds: 3));
      try {
        await prefs.reload().timeout(const Duration(seconds: 3));
      } catch (_) {}
      final token = prefs.getString(_tokenKey)?.trim();
      final refreshToken = prefs.getString(_refreshTokenKey)?.trim();
      final rawMerchant = prefs.getString(_merchantKey);
      final hasAnyToken = (token != null && token.isNotEmpty) || (refreshToken != null && refreshToken.isNotEmpty);
      if (hasAnyToken && rawMerchant != null && rawMerchant.isNotEmpty) {
        final decoded = jsonDecode(rawMerchant);
        if (decoded is Map) {
          _api.accessToken = (token != null && token.isNotEmpty) ? token : null;
          _api.refreshToken = (refreshToken != null && refreshToken.isNotEmpty) ? refreshToken : null;
          _merchant = Map<String, dynamic>.from(decoded);
          restoredMerchantId = _merchant?['id']?.toString() ?? '';
        }
      }
    } catch (_) {
      // ignore corrupted local storage or test environment plugin exceptions
    } finally {
      if (mounted) setState(() => _bootstrapping = false);
      unawaited(_initPushInBackground(restoredMerchantId));
    }
  }

  Future<void> _saveSession(Map<String, dynamic> merchant, String token, String? refreshToken) async {
    _api.accessToken = token;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _api.refreshToken = refreshToken;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await prefs.setString(_refreshTokenKey, refreshToken);
    }
    await prefs.setString(_merchantKey, jsonEncode(merchant));
    final merchantId = merchant['id']?.toString() ?? '';
    if (mounted) {
      setState(() {
        _merchant = merchant;
      });
    }
    if (merchantId.isNotEmpty) {
      unawaited(_initPushInBackground(merchantId));
    }
  }

  Future<void> _logout() async {
    await MerchantPushNotificationService.instance.unregisterFromBackend(_api);
    _api.accessToken = null;
    _api.refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_refreshTokenKey);
    await prefs.remove(_merchantKey);
    if (mounted) {
      setState(() {
        _merchant = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'اطلبها للتجار',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: MerchantAppConfig.brandRed,
          primary: MerchantAppConfig.brandRed,
          secondary: MerchantAppConfig.brandTeal,
        ),
        scaffoldBackgroundColor: MerchantAppConfig.surfaceBg,
      ),
      builder: (context, child) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: _bootstrapping
          ? const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            )
          : _merchant == null
              ? MerchantLoginScreen(
                  api: _api,
                  onLoginSuccess: (merchant, token, refreshToken) =>
                      _saveSession(merchant, token, refreshToken),
                )
              : MerchantHomeScreen(
                  api: _api,
                  merchant: _merchant!,
                  onLogout: _logout,
                  onMerchantUpdated: (updated) async {
                    final token = _api.accessToken ?? '';
                    await _saveSession(updated, token, _api.refreshToken);
                  },
                ),
    );
  }
}
