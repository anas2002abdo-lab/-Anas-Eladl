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

class CaptainPushChannels {
  static const String dispatch = 'otlobha_dispatch_channel';
  static const String orders = 'otlobha_orders_channel';
  static const String chat = 'otlobha_chat_channel';
  static const String admin = 'otlobha_admin_channel';
  static const String promos = 'otlobha_promos_channel';
  static const String silent = 'otlobha_silent_channel';

  static List<AndroidNotificationChannel> all() => [
        AndroidNotificationChannel(
          dispatch,
          'طلبات جديدة وإسناد الكباتن',
          description: 'تنبيهات عالية الأولوية عند إسناد طلبات أو مشاوير جديدة للطيار',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 450, 180, 450, 180, 450]),
        ),
        AndroidNotificationChannel(
          orders,
          'تحديثات الطلبات والمشاوير',
          description: 'تحديثات حالة الطلبات والمشاوير الجارية',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 250, 150, 250]),
        ),
        AndroidNotificationChannel(
          chat,
          'رسائل العملاء المباشرة',
          description: 'رسائل العملاء والإدارة داخل شات الطلبات والمشاوير',
          importance: Importance.high,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 200, 100, 200]),
        ),
        AndroidNotificationChannel(
          admin,
          'تنبيهات الإدارة والحساب (KYC)',
          description: 'اعتماد الحساب، المستندات، وحد الكاش والرسائل الإدارية',
          importance: Importance.high,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 300, 150, 300]),
        ),
        AndroidNotificationChannel(
          promos,
          'حملات الذروة والحوافز',
          description: 'إشعارات ذروة الطلبات وحوافز الكباتن في المنزلة',
          importance: Importance.defaultImportance,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 180]),
        ),
        const AndroidNotificationChannel(
          silent,
          'إشعارات صامتة',
          description: 'إشعارات تظهر في شريط الإشعارات بدون صوت أو اهتزاز عند كتم التنبيهات',
          importance: Importance.high,
          playSound: false,
          enableVibration: false,
        ),
      ];
}

/// Top-level background handler invoked by FCM when the captain app is in background or terminated.
@pragma('vm:entry-point')
Future<void> otlobhaCaptainBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
    final incomingId = (message.data['notification_id'] ?? message.data['id'] ?? '').toString().trim();
    if (incomingId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final existingCsv = prefs.getString('otlobha_bg_shown_ids_csv') ?? '';
        final parts = existingCsv.split(',').where((e) => e.trim().isNotEmpty).toList();
        if (!parts.contains(incomingId)) {
          parts.add(incomingId);
          while (parts.length > 150) {
            parts.removeAt(0);
          }
          await prefs.setString('otlobha_bg_shown_ids_csv', parts.join(','));
        }
      } catch (_) {}
    }

    if (message.notification == null && message.data.isNotEmpty) {
      final title = message.data['title_ar']?.toString() ?? message.data['title']?.toString() ?? '';
      final body = message.data['body_ar']?.toString() ?? message.data['body']?.toString() ?? '';
      if (title.isNotEmpty || body.isNotEmpty) {
        final localPlugin = FlutterLocalNotificationsPlugin();
        const initSettings = InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        );
        await localPlugin.initialize(initSettings);
        final androidPlugin = localPlugin
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
        if (androidPlugin != null) {
          for (final channel in CaptainPushChannels.all()) {
            await androidPlugin.createNotificationChannel(channel);
          }
        }
        final channelId = message.data['channel_id']?.toString() ?? CaptainPushChannels.dispatch;
        await localPlugin.show(
          DateTime.now().millisecondsSinceEpoch.remainder(1000000),
          title.isNotEmpty ? title : 'اطلبها كابتن',
          body,
          NotificationDetails(
            android: AndroidNotificationDetails(
              channelId,
              'تنبيهات اطلبها كابتن',
              importance: Importance.max,
              priority: Priority.max,
              playSound: true,
              enableVibration: true,
              icon: '@mipmap/ic_launcher',
              styleInformation: BigTextStyleInformation(body),
            ),
            iOS: const DarwinNotificationDetails(presentAlert: true, presentBadge: true, presentSound: true),
          ),
          payload: jsonEncode(message.data),
        );
      }
    }
  } catch (e) {
    debugPrint('[CaptainPush] Background handler skipped: $e');
  }
}

class CaptainPushNotificationService {
  CaptainPushNotificationService._();
  static final CaptainPushNotificationService instance = CaptainPushNotificationService._();

  static const String _prefDeviceIdKey = 'otlobha_captain_push_device_id_v1';
  static const String _prefSoundKey = 'otlobha_captain_push_sound_v1';
  static const String _prefVibrationKey = 'otlobha_captain_push_vibration_v1';
  static const String _prefShownIdsKey = 'otlobha_captain_shown_local_notif_ids_v1';
  static const String _prefBgShownIdsCsvKey = 'otlobha_bg_shown_ids_csv';
  static const String _prefBgApiBaseUrlKey = 'otlobha_bg_api_base_url';
  static const MethodChannel _bgChannel = MethodChannel('com.otlobha/background_push');

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  final List<String> _shownNotificationIdsOrder = <String>[];
  final Set<String> _shownNotificationIds = <String>{};
  bool _initialized = false;
  bool _firebaseReady = false;
  bool _permissionGranted = false;
  bool _tokenSyncedToBackend = false;
  bool _soundEnabled = true;
  bool _vibrationEnabled = true;
  String? _currentToken;
  String? _deviceId;
  OtlobhaCaptainApi? _boundApi;
  void Function(Map<String, dynamic> data)? _onNotificationTap;
  VoidCallback? _onForegroundNotification;
  Map<String, dynamic>? _pendingTapData;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onMessageOpenedSub;
  StreamSubscription<String>? _onTokenRefreshSub;
  Future<bool>? _permissionRequestFuture;

  bool get isFirebaseReady => _firebaseReady;
  bool get isPermissionGranted => _permissionGranted;
  bool get isTokenSynced => _tokenSyncedToBackend;
  bool get soundEnabled => _soundEnabled;
  bool get vibrationEnabled => _vibrationEnabled;
  String? get currentToken => _currentToken;
  String? get deviceId => _deviceId;

  Future<void> initialize({
    void Function(Map<String, dynamic> data)? onNotificationTap,
    VoidCallback? onForegroundNotification,
  }) async {
    _onNotificationTap = onNotificationTap;
    _onForegroundNotification = onForegroundNotification;

    if (_initialized) {
      _flushPendingTap();
      return;
    }
    _initialized = true;

    try {
      await _loadPreferences();
    } catch (_) {}
    try {
      await _initNativeBackgroundBridge();
    } catch (_) {}
    try {
      await _initLocalNotifications();
    } catch (_) {}
    try {
      await _initFirebaseMessaging();
    } catch (_) {}
    unawaited(scheduleNativeBackgroundSync(fastCheck: false));
    _flushPendingTap();
  }

  Future<void> _initNativeBackgroundBridge() async {
    if (kIsWeb || !Platform.isAndroid) return;
    try {
      _bgChannel.setMethodCallHandler((MethodCall call) async {
        if (call.method == 'onBackgroundNotificationTap') {
          final raw = call.arguments?.toString() ?? '';
          if (raw.isNotEmpty) {
            try {
              final decoded = jsonDecode(raw);
              if (decoded is Map) {
                _dispatchTap(Map<String, dynamic>.from(decoded));
              }
            } catch (_) {}
          }
        }
      });

      final initialPayload = await _bgChannel
          .invokeMethod<String>('consumeInitialNotification')
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      if (initialPayload != null && initialPayload.trim().isNotEmpty) {
        try {
          final decoded = jsonDecode(initialPayload);
          if (decoded is Map) {
            _pendingTapData = Map<String, dynamic>.from(decoded);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  Future<void> scheduleNativeBackgroundSync({bool fastCheck = false}) async {
    if (kIsWeb || !Platform.isAndroid) return;
    try {
      await _bgChannel.invokeMethod<void>('scheduleBackgroundSync', <String, dynamic>{
        'fast_check': fastCheck,
        'api_base_url': OtlobhaCaptainApi.normalizeBaseUrl(OtlobhaCaptainApi.baseUrl),
        'app': 'captain',
      }).timeout(const Duration(seconds: 3));
    } catch (_) {}
  }

  Future<void> refreshShownIdsFromStorage() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final bgCsv = prefs.getString(_prefBgShownIdsCsvKey) ?? '';
      for (final rawId in bgCsv.split(',')) {
        final cleanId = rawId.trim();
        if (cleanId.isNotEmpty && _shownNotificationIds.add(cleanId)) {
          _shownNotificationIdsOrder.add(cleanId);
        }
      }
      while (_shownNotificationIdsOrder.length > 150) {
        final removed = _shownNotificationIdsOrder.removeAt(0);
        _shownNotificationIds.remove(removed);
      }
    } catch (_) {}
  }

  Future<void> _loadPreferences() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _prefBgApiBaseUrlKey,
        OtlobhaCaptainApi.normalizeBaseUrl(OtlobhaCaptainApi.baseUrl),
      );
      _soundEnabled = prefs.getBool(_prefSoundKey) ?? true;
      _vibrationEnabled = prefs.getBool(_prefVibrationKey) ?? true;
      var savedId = prefs.getString(_prefDeviceIdKey);
      if (savedId == null || savedId.isEmpty) {
        final rand = Random.secure().nextInt(999999).toString().padLeft(6, '0');
        final prefix = kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'and');
        savedId = 'cap_${prefix}_${DateTime.now().millisecondsSinceEpoch}_$rand';
        await prefs.setString(_prefDeviceIdKey, savedId);
      }
      _deviceId = savedId;
      final savedShown = prefs.getStringList(_prefShownIdsKey) ?? const <String>[];
      final bgCsv = prefs.getString(_prefBgShownIdsCsvKey) ?? '';
      final merged = <String>[];
      final seen = <String>{};
      for (final id in [...savedShown, ...bgCsv.split(',')]) {
        final clean = id.trim();
        if (clean.isNotEmpty && seen.add(clean)) {
          merged.add(clean);
        }
      }
      while (merged.length > 150) {
        merged.removeAt(0);
      }
      _shownNotificationIdsOrder
        ..clear()
        ..addAll(merged);
      _shownNotificationIds
        ..clear()
        ..addAll(merged);
      if (merged.isNotEmpty) {
        await prefs.setString(_prefBgShownIdsCsvKey, merged.join(','));
      }
    } catch (e) {
      debugPrint('[CaptainPush] Preferences unavailable: $e');
    }
  }

  Future<void> _markNotificationIdShown(String notifId) async {
    final cleanId = notifId.trim();
    if (cleanId.isEmpty) return;
    if (_shownNotificationIds.add(cleanId)) {
      _shownNotificationIdsOrder.add(cleanId);
      while (_shownNotificationIdsOrder.length > 150) {
        final removed = _shownNotificationIdsOrder.removeAt(0);
        _shownNotificationIds.remove(removed);
      }
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setStringList(_prefShownIdsKey, _shownNotificationIdsOrder);
        await prefs.setString(_prefBgShownIdsCsvKey, _shownNotificationIdsOrder.join(','));
      } catch (_) {}
    }
  }

  int _stableNotificationIntId(String key) {
    var hash = 0;
    for (final codeUnit in key.codeUnits) {
      hash = ((hash * 31) + codeUnit) & 0x7fffffff;
    }
    if (hash == 0) return 200001;
    return hash;
  }

  Future<void> setSoundEnabled(bool enabled) async {
    _soundEnabled = enabled;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_prefSoundKey, enabled);
    } catch (_) {}
  }

  Future<void> setVibrationEnabled(bool enabled) async {
    _vibrationEnabled = enabled;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_prefVibrationKey, enabled);
    } catch (_) {}
  }

  Future<void> _initLocalNotifications() async {
    if (!kIsWeb && !Platform.isAndroid && !Platform.isIOS) return;
    try {
      const initSettings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      );

      await _localNotifications.initialize(
        initSettings,
        onDidReceiveNotificationResponse: (NotificationResponse response) {
          final payloadStr = response.payload;
          if (payloadStr != null && payloadStr.isNotEmpty) {
            try {
              final decoded = jsonDecode(payloadStr);
              if (decoded is Map) {
                _dispatchTap(Map<String, dynamic>.from(decoded));
              }
            } catch (_) {}
          }
        },
      );

      final androidPlugin = _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        for (final channel in CaptainPushChannels.all()) {
          await androidPlugin.createNotificationChannel(channel);
        }
      }

      final launchDetails = await _localNotifications.getNotificationAppLaunchDetails();
      if (launchDetails != null &&
          launchDetails.didNotificationLaunchApp &&
          launchDetails.notificationResponse?.payload != null) {
        try {
          final decoded = jsonDecode(launchDetails.notificationResponse!.payload!);
          if (decoded is Map) {
            _pendingTapData = Map<String, dynamic>.from(decoded);
          }
        } catch (_) {}
      }
    } catch (e) {
      debugPrint('[CaptainPush] Local notifications init skipped: $e');
    }
  }

  Future<void> _initFirebaseMessaging() async {
    if (!kIsWeb && !Platform.isAndroid && !Platform.isIOS) return;
    try {
      if (Firebase.apps.isEmpty) {
        // Initialize from native Android google-services.json / iOS GoogleService-Info.plist
        await Firebase.initializeApp().timeout(const Duration(seconds: 3));
      }
      _firebaseReady = Firebase.apps.isNotEmpty;
    } catch (e) {
      if (Firebase.apps.isNotEmpty) {
        _firebaseReady = true;
      } else {
        _firebaseReady = false;
        debugPrint('[CaptainPush] Firebase init error (verify google-services.json): $e');
        return;
      }
    }

    if (!_firebaseReady) return;

    try {
      FirebaseMessaging.onBackgroundMessage(otlobhaCaptainBackgroundHandler);
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(
            alert: true,
            badge: true,
            sound: true,
          )
          .timeout(const Duration(seconds: 3));

      final initialMsg = await FirebaseMessaging.instance
          .getInitialMessage()
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      if (initialMsg != null) {
        _pendingTapData = _extractMessageData(initialMsg);
      }

      _onMessageSub?.cancel();
      _onMessageSub = FirebaseMessaging.onMessage.listen((RemoteMessage msg) async {
        await showForegroundSystemNotification(msg);
        _onForegroundNotification?.call();
      });

      _onMessageOpenedSub?.cancel();
      _onMessageOpenedSub = FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage msg) {
        _dispatchTap(_extractMessageData(msg));
      });

      _onTokenRefreshSub?.cancel();
      _onTokenRefreshSub = FirebaseMessaging.instance.onTokenRefresh.listen((String newToken) async {
        _currentToken = newToken;
        _tokenSyncedToBackend = false;
        if (_boundApi != null && _boundApi!.hasTokens) {
          await _syncTokenToBackend(_boundApi!, newToken);
        }
      });

      unawaited(_subscribeDefaultTopics());
      unawaited(_registerGuestTokenIfNeeded());
    } catch (e) {
      debugPrint('[CaptainPush] Messaging listeners error: $e');
    }
  }

  Future<void> _registerGuestTokenIfNeeded() async {
    if (!_firebaseReady || kIsWeb) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) {
        _currentToken = token;
        if (_boundApi != null && _boundApi!.hasTokens) {
          await _syncTokenToBackend(_boundApi!, token);
        } else if (_deviceId != null && _deviceId!.isNotEmpty) {
          await OtlobhaCaptainApi.registerGuestPushToken(
            fcmToken: token,
            deviceId: _deviceId!,
            platform: Platform.isIOS ? 'ios' : 'android',
            appVersion: '1.0.0',
            deviceLabel: Platform.operatingSystem,
          );
        }
      }
    } catch (e) {
      debugPrint('[CaptainPush] Startup token registration skipped: $e');
    }
  }

  Future<void> _subscribeDefaultTopics() async {
    if (!_firebaseReady || kIsWeb) return;
    try {
      await FirebaseMessaging.instance.subscribeToTopic('otlobha_all');
      await FirebaseMessaging.instance.subscribeToTopic('otlobha_captain_all');
    } catch (e) {
      debugPrint('[CaptainPush] Topic subscription skipped: $e');
    }
  }

  Future<bool> requestPermission() {
    final existing = _permissionRequestFuture;
    if (existing != null) return existing;
    final future = _requestPermissionInternal();
    _permissionRequestFuture = future;
    future.whenComplete(() {
      if (identical(_permissionRequestFuture, future)) {
        _permissionRequestFuture = null;
      }
    });
    return future;
  }

  Future<bool> _requestPermissionInternal() async {
    bool granted = false;
    bool handledOnAndroid = false;
    if (!kIsWeb && Platform.isAndroid) {
      try {
        final androidPlugin = _localNotifications
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
        if (androidPlugin != null) {
          handledOnAndroid = true;
          final androidGranted = await androidPlugin.requestNotificationsPermission();
          if (androidGranted != null) granted = androidGranted;
        }
      } catch (e) {
        debugPrint('[CaptainPush] Android permission request error: $e');
      }
    }

    if (_firebaseReady && !handledOnAndroid) {
      try {
        final settings = await FirebaseMessaging.instance.requestPermission(
          alert: true,
          badge: true,
          sound: true,
          provisional: false,
        );
        granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
            settings.authorizationStatus == AuthorizationStatus.provisional ||
            granted;
      } catch (e) {
        debugPrint('[CaptainPush] FCM permission request error: $e');
      }
    }

    _permissionGranted = granted;
    return granted;
  }

  Future<void> registerForAuthenticatedCaptain(OtlobhaCaptainApi api) async {
    _boundApi = api;
    await requestPermission();
    if (!_firebaseReady) {
      await _initFirebaseMessaging();
    }
    if (!_firebaseReady || !api.hasTokens) return;

    unawaited(_subscribeDefaultTopics());

    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final token = await FirebaseMessaging.instance.getToken();
        if (token != null && token.isNotEmpty) {
          _currentToken = token;
          await _syncTokenToBackend(api, token);
          if (_tokenSyncedToBackend) return;
        }
      } catch (e) {
        debugPrint('[CaptainPush] Token fetch/register attempt ${attempt + 1} failed: $e');
      }
      if (attempt < 2) {
        await Future<void>.delayed(Duration(seconds: (attempt + 1) * 2));
      }
    }
  }

  Future<void> _syncTokenToBackend(OtlobhaCaptainApi api, String token) async {
    try {
      await api.registerPushToken(
        fcmToken: token,
        deviceId: _deviceId,
        platform: kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'android'),
        appVersion: '1.0.0',
        deviceLabel: kIsWeb ? 'Web' : Platform.operatingSystem,
      );
      _tokenSyncedToBackend = true;
    } catch (e) {
      _tokenSyncedToBackend = false;
      debugPrint('[CaptainPush] Backend token sync failed: $e');
    }
  }

  Future<void> unregisterOnLogout(OtlobhaCaptainApi api) async {
    try {
      await api.unregisterPushToken(fcmToken: _currentToken, deviceId: _deviceId);
    } catch (_) {}
    _tokenSyncedToBackend = false;
    _boundApi = null;
  }

  Future<void> showForegroundSystemNotification(RemoteMessage message) async {
    final data = _extractMessageData(message);
    final title = message.notification?.title ?? data['title_ar']?.toString() ?? 'اطلبها كابتن';
    final body = message.notification?.body ?? data['body_ar']?.toString() ?? '';
    if (title.isEmpty && body.isEmpty) return;

    final notifId = (data['notification_id'] ?? data['id'] ?? '').toString().trim();
    if (notifId.isNotEmpty) {
      await _markNotificationIdShown(notifId);
    }

    final requestedChannel = data['channel_id']?.toString() ?? CaptainPushChannels.dispatch;
    final useSilent = !_soundEnabled && !_vibrationEnabled;
    final effectiveChannel = useSilent ? CaptainPushChannels.silent : requestedChannel;

    try {
      await _localNotifications.show(
        notifId.isNotEmpty
            ? _stableNotificationIntId(notifId)
            : DateTime.now().millisecondsSinceEpoch.remainder(1000000),
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            effectiveChannel,
            _channelDisplayName(effectiveChannel),
            importance: Importance.max,
            priority: Priority.max,
            playSound: _soundEnabled,
            enableVibration: _vibrationEnabled,
            vibrationPattern: _vibrationEnabled ? Int64List.fromList([0, 400, 180, 400]) : null,
            icon: '@mipmap/ic_launcher',
            styleInformation: BigTextStyleInformation(body),
          ),
          iOS: DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: _soundEnabled,
          ),
        ),
        payload: jsonEncode(data),
      );
    } catch (e) {
      debugPrint('[CaptainPush] Foreground local show failed: $e');
    }
  }

  /// Displays a real Android heads-up alert from a live WebSocket or backend notification record.
  Future<void> showSystemNotificationFromRecord(Map<String, dynamic> record) async {
    final id = (record['id'] ?? record['notification_id'] ?? '').toString().trim();
    if (id.isNotEmpty && _shownNotificationIds.contains(id)) return;

    final title = (record['title_ar'] ?? record['title'] ?? 'اطلبها كابتن').toString().trim();
    final body = (record['body_ar'] ?? record['body'] ?? '').toString().trim();
    if (title.isEmpty && body.isEmpty) return;

    if (id.isNotEmpty) {
      await _markNotificationIdShown(id);
    }

    final deepLink = (record['deep_link'] ?? 'orders').toString();
    final requestedChannel = (record['channel_id'] ?? '').toString().isNotEmpty
        ? record['channel_id'].toString()
        : (deepLink.contains('chat') ? CaptainPushChannels.chat : CaptainPushChannels.dispatch);
    final useSilent = !_soundEnabled && !_vibrationEnabled;
    final effectiveChannel = useSilent ? CaptainPushChannels.silent : requestedChannel;

    try {
      await _localNotifications.show(
        id.isNotEmpty
            ? _stableNotificationIntId(id)
            : DateTime.now().millisecondsSinceEpoch.remainder(1000000),
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            effectiveChannel,
            _channelDisplayName(effectiveChannel),
            importance: Importance.max,
            priority: Priority.max,
            playSound: _soundEnabled,
            enableVibration: _vibrationEnabled,
            vibrationPattern: _vibrationEnabled ? Int64List.fromList([0, 400, 180, 400]) : null,
            icon: '@mipmap/ic_launcher',
            styleInformation: BigTextStyleInformation(body),
          ),
          iOS: DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: _soundEnabled,
          ),
        ),
        payload: jsonEncode(<String, dynamic>{
          'notification_id': id,
          'deep_link': deepLink,
          'order_id': record['order_id']?.toString() ?? '',
          'trip_id': record['trip_id']?.toString() ?? '',
          'title_ar': title,
          'body_ar': body,
        }),
      );
    } catch (e) {
      debugPrint('[CaptainPush] Local notification record show failed: $e');
    }
  }

  Future<void> syncUnreadNotificationsToStatusBar(List<dynamic> notifications) async {
    await refreshShownIdsFromStorage();
    final unread = notifications
        .whereType<Map>()
        .map((n) => Map<String, dynamic>.from(n))
        .where((n) => n['is_read'] != true && n['is_read'] != 1)
        .take(5)
        .toList();
    for (final item in unread) {
      await showSystemNotificationFromRecord(item);
    }
  }

  String _channelDisplayName(String channelId) {
    switch (channelId) {
      case CaptainPushChannels.orders:
        return 'تحديثات الطلبات والمشاوير';
      case CaptainPushChannels.chat:
        return 'رسائل العملاء المباشرة';
      case CaptainPushChannels.admin:
        return 'تنبيهات الإدارة والحساب (KYC)';
      case CaptainPushChannels.promos:
        return 'حملات الذروة والحوافز';
      case CaptainPushChannels.silent:
        return 'إشعارات صامتة';
      default:
        return 'طلبات جديدة وإسناد الكباتن';
    }
  }

  Map<String, dynamic> _extractMessageData(RemoteMessage msg) {
    final map = Map<String, dynamic>.from(msg.data);
    if (msg.notification?.title != null && !map.containsKey('title_ar')) {
      map['title_ar'] = msg.notification!.title;
    }
    if (msg.notification?.body != null && !map.containsKey('body_ar')) {
      map['body_ar'] = msg.notification!.body;
    }
    return map;
  }

  void _dispatchTap(Map<String, dynamic> data) {
    if (_onNotificationTap != null) {
      _onNotificationTap!(data);
    } else {
      _pendingTapData = data;
    }
  }

  void _flushPendingTap() {
    if (_pendingTapData != null && _onNotificationTap != null) {
      final pending = _pendingTapData!;
      _pendingTapData = null;
      _onNotificationTap!(pending);
    }
  }
}
