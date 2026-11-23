import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_client.dart';
import 'config.dart';

class MerchantPushChannels {
  static const String dispatch = 'otlobha_dispatch_channel';
  static const String orders = 'otlobha_orders_channel';
  static const String chat = 'otlobha_chat_channel';
  static const String admin = 'otlobha_admin_channel';
}

const String _kMerchantSoundPrefKey = 'otlobha_merchant_push_sound_v1';
const String _kMerchantVibrationPrefKey = 'otlobha_merchant_push_vibration_v1';
const String _kMerchantDeviceIdKey = 'otlobha_merchant_device_id_v1';
const String _kMerchantShownBgIdsKey = 'otlobha_bg_shown_ids_csv';
const String _kBgApiBaseKey = 'otlobha_bg_api_base_url';
const MethodChannel _kNativeBgPushChannel = MethodChannel('com.otlobha/background_push');

@pragma('vm:entry-point')
Future<void> otlobhaMerchantBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
  } catch (_) {}

  try {
    final title = (message.notification?.title ?? message.data['title_ar'] ?? '').toString().trim();
    final body = (message.notification?.body ?? message.data['body_ar'] ?? '').toString().trim();
    if (title.isEmpty && body.isEmpty) return;

    final notifId = (message.data['notification_id'] ?? message.messageId ?? '').toString().trim();
    if (notifId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final existing = (prefs.getString(_kMerchantShownBgIdsKey) ?? '')
            .split(',')
            .map((e) => e.trim())
            .where((e) => e.isNotEmpty)
            .toList();
        if (!existing.contains(notifId)) {
          existing.add(notifId);
          final trimmed = existing.length > 200 ? existing.sublist(existing.length - 200) : existing;
          await prefs.setString(_kMerchantShownBgIdsKey, trimmed.join(','));
        }
      } catch (_) {}
    }

    // If FCM already carried a `notification` block, Android renders it automatically when app is closed.
    if (message.notification != null) return;

    final local = FlutterLocalNotificationsPlugin();
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings();
    await local.initialize(const InitializationSettings(android: androidInit, iOS: iosInit));

    final channelId = (message.data['channel_id'] ?? MerchantPushChannels.dispatch).toString();
    final androidDetails = AndroidNotificationDetails(
      channelId,
      'طلبات جديدة لمتجرك',
      channelDescription: 'تنبيهات الطلبات الجديدة وتحديثات التجهيز في اطلبها للتجار',
      importance: Importance.max,
      priority: Priority.max,
      playSound: true,
      enableVibration: true,
      vibrationPattern: Int64List.fromList([0, 320, 140, 320, 140, 420]),
      visibility: NotificationVisibility.public,
      category: AndroidNotificationCategory.alarm,
      styleInformation: BigTextStyleInformation(body),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    await local.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title.isEmpty ? 'طلب جديد لمتجرك!' : title,
      body,
      NotificationDetails(android: androidDetails, iOS: iosDetails),
      payload: jsonEncode(message.data),
    );
  } catch (e) {
    debugPrint('[MerchantPush] Background handler error: $e');
  }
}

class MerchantPushNotificationService {
  MerchantPushNotificationService._();
  static final MerchantPushNotificationService instance = MerchantPushNotificationService._();

  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  bool _initialized = false;
  bool _firebaseAvailable = false;
  String? _currentToken;
  String? _deviceId;
  bool _soundEnabled = true;
  bool _vibrationEnabled = true;
  String? _lastSyncedToken;
  String? _lastSyncedUserId;
  bool _guestTokenSynced = false;
  final Set<String> _shownLocalIds = {};
  final Set<String> _shownServerNotifIds = {};

  void Function(Map<String, dynamic> payload)? onNotificationTap;
  void Function(String title, String body, Map<String, dynamic> data)? onForegroundMessage;

  bool get soundEnabled => _soundEnabled;
  bool get vibrationEnabled => _vibrationEnabled;
  bool get firebaseAvailable => _firebaseAvailable;
  String? get currentToken => _currentToken;

  Future<void> init({
    void Function(Map<String, dynamic> payload)? onTap,
    void Function(String title, String body, Map<String, dynamic> data)? onForeground,
  }) async {
    onNotificationTap = onTap;
    onForegroundMessage = onForeground;
    if (_initialized) return;
    _initialized = true;

    try {
      final prefs = await SharedPreferences.getInstance();
      _soundEnabled = prefs.getBool(_kMerchantSoundPrefKey) ?? true;
      _vibrationEnabled = prefs.getBool(_kMerchantVibrationPrefKey) ?? true;
      _deviceId = prefs.getString(_kMerchantDeviceIdKey);
      if (_deviceId == null || _deviceId!.isEmpty) {
        final rand = Random();
        _deviceId =
            'mer_${DateTime.now().millisecondsSinceEpoch}_${rand.nextInt(999999).toString().padLeft(6, '0')}';
        await prefs.setString(_kMerchantDeviceIdKey, _deviceId!);
      }
      final existingCsv = prefs.getString(_kMerchantShownBgIdsKey) ?? '';
      for (final id in existingCsv.split(',')) {
        final clean = id.trim();
        if (clean.isNotEmpty) _shownServerNotifIds.add(clean);
      }
      final normalizedBase = MerchantAppConfig.normalizedBaseUrl.trim();
      if (normalizedBase.isNotEmpty) {
        await prefs.setString(_kBgApiBaseKey, normalizedBase);
      }
    } catch (_) {
      // Ignore in test environments
    }

    await _initLocalNotifications();
    await _initFirebaseMessaging();
    await scheduleNativeBackgroundSync();
    await _checkNativeLaunchPayload();
  }

  Future<void> _persistShownId(String id) async {
    final clean = id.trim();
    if (clean.isEmpty) return;
    _shownServerNotifIds.add(clean);
    try {
      final prefs = await SharedPreferences.getInstance();
      final existing = (prefs.getString(_kMerchantShownBgIdsKey) ?? '')
          .split(',')
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
      if (!existing.contains(clean)) {
        existing.add(clean);
        final trimmed = existing.length > 200 ? existing.sublist(existing.length - 200) : existing;
        await prefs.setString(_kMerchantShownBgIdsKey, trimmed.join(','));
      }
    } catch (_) {}
  }

  Future<void> scheduleNativeBackgroundSync({bool fastCheck = false}) async {
    if (kIsWeb || !Platform.isAndroid) return;
    final normalizedBase = MerchantAppConfig.normalizedBaseUrl.trim();
    try {
      final prefs = await SharedPreferences.getInstance();
      if (normalizedBase.isNotEmpty) {
        await prefs.setString(_kBgApiBaseKey, normalizedBase);
      }
    } catch (_) {}
    try {
      await _kNativeBgPushChannel.invokeMethod('scheduleBackgroundSync', <String, dynamic>{
        'fast_check': fastCheck,
        'api_base_url': normalizedBase,
        'app': 'merchant',
      }).timeout(const Duration(seconds: 3));
    } catch (e) {
      debugPrint('[MerchantPush] Native background sync channel not ready: $e');
    }
  }

  Future<void> refreshShownIdsFromStorage() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final existingCsv = prefs.getString(_kMerchantShownBgIdsKey) ?? '';
      for (final id in existingCsv.split(',')) {
        final clean = id.trim();
        if (clean.isNotEmpty) {
          _shownServerNotifIds.add(clean);
          _shownLocalIds.add(clean);
        }
      }
    } catch (_) {}
  }

  Future<void> _checkNativeLaunchPayload() async {
    if (kIsWeb || !Platform.isAndroid) return;
    try {
      _kNativeBgPushChannel.setMethodCallHandler((MethodCall call) async {
        if (call.method == 'onBackgroundNotificationTap') {
          final raw = call.arguments?.toString() ?? '';
          if (raw.trim().isNotEmpty) {
            try {
              final decoded = jsonDecode(raw);
              if (decoded is Map) {
                onNotificationTap?.call(Map<String, dynamic>.from(decoded));
              }
            } catch (_) {}
          }
        }
      });
      final raw = await _kNativeBgPushChannel
          .invokeMethod<String>('consumeInitialNotification')
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      if (raw != null && raw.trim().isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          onNotificationTap?.call(Map<String, dynamic>.from(decoded));
        }
      }
    } catch (_) {}
  }

  Future<void> _initLocalNotifications() async {
    try {
      const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosInit = DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );
      await _local.initialize(
        const InitializationSettings(android: androidInit, iOS: iosInit),
        onDidReceiveNotificationResponse: (NotificationResponse resp) {
          if (resp.payload != null && resp.payload!.isNotEmpty) {
            try {
              final decoded = jsonDecode(resp.payload!);
              if (decoded is Map<String, dynamic>) {
                onNotificationTap?.call(decoded);
              }
            } catch (_) {}
          }
        },
      );

      final androidPlugin = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        await androidPlugin.createNotificationChannel(
          AndroidNotificationChannel(
            MerchantPushChannels.dispatch,
            'طلبات جديدة لمتجرك',
            description: 'إشعارات فورية مع صوت واهتزاز عند وصول طلب جديد للمتجر',
            importance: Importance.max,
            playSound: true,
            enableVibration: true,
            vibrationPattern: Int64List.fromList([0, 320, 140, 320, 140, 420]),
          ),
        );
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            MerchantPushChannels.orders,
            'تحديثات الطلبات',
            description: 'إشعارات حالة التجهيز واستلام الطيار',
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            MerchantPushChannels.chat,
            'رسائل العملاء والطيارين',
            description: 'تنبيهات المحادثات المباشرة حول الطلبات',
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            MerchantPushChannels.admin,
            'إشعارات إدارة اطلبها',
            description: 'اعتماد المنتجات وتنبيهات المنصة للتجار',
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
      }

      final launchDetails = await _local.getNotificationAppLaunchDetails();
      if (launchDetails != null &&
          launchDetails.didNotificationLaunchApp &&
          launchDetails.notificationResponse?.payload != null) {
        try {
          final decoded = jsonDecode(launchDetails.notificationResponse!.payload!);
          if (decoded is Map<String, dynamic>) {
            onNotificationTap?.call(decoded);
          }
        } catch (_) {}
      }
    } catch (e) {
      debugPrint('[MerchantPush] Local notification init skipped: $e');
    }
  }

  Future<void> _initFirebaseMessaging() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      _firebaseAvailable = true;
    } catch (e) {
      _firebaseAvailable = false;
      debugPrint('[MerchantPush] Firebase not configured; native Android background engine active: $e');
      return;
    }

    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
        final title = (message.notification?.title ?? message.data['title_ar'] ?? '').toString().trim();
        final body = (message.notification?.body ?? message.data['body_ar'] ?? '').toString().trim();
        final notifId = (message.data['notification_id'] ?? message.messageId ?? '').toString().trim();
        if (notifId.isNotEmpty) {
          await _persistShownId(notifId);
        }
        if (title.isEmpty && body.isEmpty) return;

        final channelId = _resolveChannel(message.data);
        await showSystemNotification(
          title: title.isEmpty ? 'طلب جديد لمتجرك!' : title,
          body: body,
          channelId: channelId,
          payload: message.data,
          dedupeKey: notifId.isEmpty ? '${title}_$body' : notifId,
        );
        onForegroundMessage?.call(
          title.isEmpty ? 'طلب جديد لمتجرك!' : title,
          body,
          Map<String, dynamic>.from(message.data),
        );
      });

      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        onNotificationTap?.call(Map<String, dynamic>.from(message.data));
      });

      final initialMsg = await messaging.getInitialMessage();
      if (initialMsg != null) {
        onNotificationTap?.call(Map<String, dynamic>.from(initialMsg.data));
      }

      try {
        await messaging.subscribeToTopic('otlobha_merchant_all');
        await messaging.subscribeToTopic('otlobha_all');
      } catch (e) {
        debugPrint('[MerchantPush] Topic subscribe warning: $e');
      }

      _currentToken = await messaging.getToken();
      messaging.onTokenRefresh.listen((newToken) {
        _currentToken = newToken;
        _lastSyncedToken = null;
      });
    } catch (e) {
      debugPrint('[MerchantPush] FirebaseMessaging setup error: $e');
    }
  }

  String _resolveChannel(Map<String, dynamic> data) {
    final explicit = (data['channel_id'] ?? '').toString().trim();
    if (explicit.isNotEmpty) return explicit;
    final dl = (data['deep_link'] ?? '').toString().toLowerCase();
    final cat = (data['category'] ?? '').toString().toLowerCase();
    if (dl.contains('chat')) return MerchantPushChannels.chat;
    if (cat == 'operational' || dl == 'order' || dl == 'orders') return MerchantPushChannels.dispatch;
    if (cat == 'compliance' || cat == 'alert' || cat == 'promo') return MerchantPushChannels.admin;
    return MerchantPushChannels.dispatch;
  }

  Future<bool> requestPermissions() async {
    bool granted = true;
    try {
      if (!kIsWeb && Platform.isAndroid) {
        final androidPlugin =
            _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
        final androidGranted = await androidPlugin?.requestNotificationsPermission();
        if (androidGranted != null) granted = androidGranted;
      } else if (!kIsWeb && Platform.isIOS) {
        final iosPlugin = _local.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
        final iosGranted = await iosPlugin?.requestPermissions(alert: true, badge: true, sound: true);
        if (iosGranted != null) granted = iosGranted;
      }
    } catch (_) {}

    if (_firebaseAvailable) {
      try {
        final settings = await FirebaseMessaging.instance.requestPermission(
          alert: true,
          badge: true,
          sound: true,
          announcement: false,
          provisional: false,
        );
        granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
            settings.authorizationStatus == AuthorizationStatus.provisional;
        _currentToken ??= await FirebaseMessaging.instance.getToken();
      } catch (e) {
        debugPrint('[MerchantPush] Permission request error: $e');
      }
    }
    return granted;
  }

  Future<void> setPreferences({bool? sound, bool? vibration}) async {
    final prefs = await SharedPreferences.getInstance();
    if (sound != null) {
      _soundEnabled = sound;
      await prefs.setBool(_kMerchantSoundPrefKey, sound);
    }
    if (vibration != null) {
      _vibrationEnabled = vibration;
      await prefs.setBool(_kMerchantVibrationPrefKey, vibration);
    }
  }

  Future<void> syncGuestTokenWithBackend(MerchantApiClient api) async {
    if (!_firebaseAvailable || _guestTokenSynced) return;
    try {
      _currentToken ??= await FirebaseMessaging.instance.getToken();
      final token = _currentToken?.trim() ?? '';
      if (token.length < 20) return;
      final platform = kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'android');
      await api.registerGuestPushToken(
        fcmToken: token,
        deviceId: _deviceId ?? 'mer_unknown',
        platform: platform,
        appVersion: '1.0.0',
        deviceLabel: Platform.isIOS ? 'iOS Merchant App' : 'Android Merchant App',
      );
      _guestTokenSynced = true;
    } catch (e) {
      debugPrint('[MerchantPush] Guest token sync failed: $e');
    }
  }

  Future<void> syncTokenWithBackend(MerchantApiClient api, String merchantId) async {
    await scheduleNativeBackgroundSync();
    if (!_firebaseAvailable) return;
    try {
      _currentToken ??= await FirebaseMessaging.instance.getToken();
      final token = _currentToken?.trim() ?? '';
      if (token.length < 20) return;
      if (_lastSyncedToken == token && _lastSyncedUserId == merchantId) return;

      final platform = kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'android');
      await api.registerPushToken(
        fcmToken: token,
        deviceId: _deviceId,
        platform: platform,
        appVersion: '1.0.0',
        deviceLabel: Platform.isIOS ? 'iOS Merchant App' : 'Android Merchant App',
      );
      _lastSyncedToken = token;
      _lastSyncedUserId = merchantId;
    } catch (e) {
      debugPrint('[MerchantPush] Token sync with backend failed: $e');
    }
  }

  Future<void> unregisterFromBackend(MerchantApiClient api) async {
    try {
      if ((_currentToken != null && _currentToken!.isNotEmpty) || (_deviceId != null && _deviceId!.isNotEmpty)) {
        await api.unregisterPushToken(fcmToken: _currentToken, deviceId: _deviceId);
      }
    } catch (e) {
      debugPrint('[MerchantPush] Unregister token failed: $e');
    } finally {
      _lastSyncedToken = null;
      _lastSyncedUserId = null;
    }
  }

  Future<void> syncUnreadNotificationsToStatusBar(
    List<Map<String, dynamic>> notifications, {
    bool isInitialLoad = false,
  }) async {
    if (notifications.isEmpty) return;

    if (isInitialLoad) {
      final prefs = await SharedPreferences.getInstance();
      final existingCsv = prefs.getString(_kMerchantShownBgIdsKey) ?? '';
      for (final id in existingCsv.split(',')) {
        final clean = id.trim();
        if (clean.isNotEmpty) _shownServerNotifIds.add(clean);
      }

      int shownNow = 0;
      for (final n in notifications) {
        final id = (n['id'] ?? '').toString().trim();
        if (id.isEmpty) continue;
        final isRead = n['is_read'] == true || n['is_read'] == 1;
        if (isRead || _shownServerNotifIds.contains(id)) {
          _shownServerNotifIds.add(id);
          continue;
        }
        final createdAtRaw = (n['created_at'] ?? '').toString().trim();
        final createdAt = DateTime.tryParse(
          createdAtRaw.contains('T') ? createdAtRaw : '${createdAtRaw.replaceFirst(' ', 'T')}Z',
        );
        final isRecent =
            createdAt == null || DateTime.now().toUtc().difference(createdAt.toUtc()).inHours <= 24;
        await _persistShownId(id);
        if (isRecent && shownNow < 2) {
          shownNow++;
          final title = (n['title_ar'] ?? 'طلب جديد لمتجرك').toString().trim();
          final body = (n['body_ar'] ?? '').toString().trim();
          await showSystemNotification(
            title: title,
            body: body,
            channelId: _resolveChannel(n),
            payload: {
              'notification_id': id,
              'deep_link': (n['deep_link'] ?? 'order').toString(),
              'category': (n['category'] ?? 'operational').toString(),
            },
            dedupeKey: id,
          );
        }
      }
      return;
    }

    for (final n in notifications.take(5)) {
      final id = (n['id'] ?? '').toString().trim();
      if (id.isEmpty || _shownServerNotifIds.contains(id)) continue;
      final isRead = n['is_read'] == true || n['is_read'] == 1;
      await _persistShownId(id);
      if (isRead) continue;

      final title = (n['title_ar'] ?? 'طلب جديد لمتجرك').toString().trim();
      final body = (n['body_ar'] ?? '').toString().trim();
      await showSystemNotification(
        title: title,
        body: body,
        channelId: _resolveChannel(n),
        payload: {
          'notification_id': id,
          'deep_link': (n['deep_link'] ?? 'order').toString(),
          'category': (n['category'] ?? 'operational').toString(),
        },
        dedupeKey: id,
      );
    }
  }

  Future<void> showSystemNotification({
    required String title,
    required String body,
    String channelId = MerchantPushChannels.dispatch,
    Map<String, dynamic>? payload,
    String? dedupeKey,
  }) async {
    if (dedupeKey != null && dedupeKey.isNotEmpty) {
      if (_shownLocalIds.contains(dedupeKey)) return;
      _shownLocalIds.add(dedupeKey);
      if (_shownLocalIds.length > 100) {
        _shownLocalIds.remove(_shownLocalIds.first);
      }
    }

    try {
      final androidDetails = AndroidNotificationDetails(
        channelId,
        channelId == MerchantPushChannels.chat
            ? 'رسائل العملاء والطيارين'
            : channelId == MerchantPushChannels.admin
                ? 'إشعارات إدارة اطلبها'
                : 'طلبات جديدة لمتجرك',
        importance: Importance.max,
        priority: Priority.max,
        playSound: _soundEnabled,
        enableVibration: _vibrationEnabled,
        vibrationPattern: _vibrationEnabled
            ? Int64List.fromList([0, 320, 140, 320, 140, 420])
            : null,
        visibility: NotificationVisibility.public,
        category: AndroidNotificationCategory.alarm,
        styleInformation: BigTextStyleInformation(body),
      );
      final iosDetails = DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: _soundEnabled,
      );

      final notifNumericId = (DateTime.now().millisecondsSinceEpoch & 0x7fffffff);
      await _local.show(
        notifNumericId,
        title,
        body,
        NotificationDetails(android: androidDetails, iOS: iosDetails),
        payload: payload != null ? jsonEncode(payload) : null,
      );
    } catch (e) {
      debugPrint('[MerchantPush] Local display error: $e');
    }
  }
}
