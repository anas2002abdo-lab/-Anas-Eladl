import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_client.dart';

class OtlobhaPushChannels {
  static const String orders = 'otlobha_orders_channel';
  static const String dispatch = 'otlobha_dispatch_channel';
  static const String chat = 'otlobha_chat_channel';
  static const String admin = 'otlobha_admin_channel';
  static const String promos = 'otlobha_promos_channel';
  static const String silent = 'otlobha_silent_channel';

  static List<AndroidNotificationChannel> all() => [
        AndroidNotificationChannel(
          orders,
          'تحديثات الطلبات والمشاوير',
          description: 'إشعارات قبول وتجهيز الطلبات ووصول الطيار وتحديثات المشاوير',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 250, 150, 250]),
        ),
        AndroidNotificationChannel(
          dispatch,
          'إسناد الطلبات العاجل',
          description: 'تنبيهات فورية عند إسناد الطلبات والمشاوير الجديدة',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 400, 180, 400]),
        ),
        AndroidNotificationChannel(
          chat,
          'رسائل الشات المباشر',
          description: 'رسائل الطيار والدعم المباشر داخل الطلبات والمشاوير',
          importance: Importance.high,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 180, 100, 180]),
        ),
        AndroidNotificationChannel(
          admin,
          'تنبيهات الإدارة والحساب',
          description: 'إشعارات التوثيق والحملات والرسائل الإدارية المهمة',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 250, 150, 250]),
        ),
        AndroidNotificationChannel(
          promos,
          'العروض والتخفيضات',
          description: 'أحدث عروض وخصومات المتاجر والمطاعم في المنزلة',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 200, 120, 200]),
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

/// Top-level background handler invoked by FCM when the app is in background or terminated.
@pragma('vm:entry-point')
Future<void> otlobhaCustomerBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
    // When message.notification != null, Android FCM SDK automatically displays the system tray notification
    // using android.notification.channel_id. For data-only messages, display it via local notifications.
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
          for (final channel in OtlobhaPushChannels.all()) {
            await androidPlugin.createNotificationChannel(channel);
          }
        }
        final channelId = message.data['channel_id']?.toString() ?? OtlobhaPushChannels.orders;
        await localPlugin.show(
          DateTime.now().millisecondsSinceEpoch.remainder(1000000),
          title.isNotEmpty ? title : 'اطلبها',
          body,
          NotificationDetails(
            android: AndroidNotificationDetails(
              channelId,
              'تحديثات اطلبها',
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
    debugPrint('[CustomerPush] Background handler skipped: $e');
  }
}

class CustomerPushNotificationService {
  CustomerPushNotificationService._();
  static final CustomerPushNotificationService instance = CustomerPushNotificationService._();

  static const String _prefDeviceIdKey = 'otlobha_customer_push_device_id_v1';
  static const String _prefSoundKey = 'otlobha_customer_push_sound_v1';
  static const String _prefVibrationKey = 'otlobha_customer_push_vibration_v1';
  static const String _prefShownIdsKey = 'otlobha_customer_shown_local_notif_ids_v1';

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
  OtlobhaCustomerApi? _boundApi;
  void Function(Map<String, dynamic> data)? _onNotificationTap;
  VoidCallback? _onForegroundNotification;
  Map<String, dynamic>? _pendingTapData;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onMessageOpenedSub;
  StreamSubscription<String>? _onTokenRefreshSub;

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

    await _loadPreferences();
    await _initLocalNotifications();
    await _initFirebaseMessaging();
    _flushPendingTap();
  }

  void setHandlers({
    void Function(Map<String, dynamic> data)? onNotificationTap,
    VoidCallback? onForegroundNotification,
  }) {
    _onNotificationTap = onNotificationTap;
    _onForegroundNotification = onForegroundNotification;
    _flushPendingTap();
  }

  Future<void> _loadPreferences() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _soundEnabled = prefs.getBool(_prefSoundKey) ?? true;
      _vibrationEnabled = prefs.getBool(_prefVibrationKey) ?? true;
      var savedId = prefs.getString(_prefDeviceIdKey);
      if (savedId == null || savedId.isEmpty) {
        final rand = Random.secure().nextInt(999999).toString().padLeft(6, '0');
        final prefix = kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'and');
        savedId = 'cust_${prefix}_${DateTime.now().millisecondsSinceEpoch}_$rand';
        await prefs.setString(_prefDeviceIdKey, savedId);
      }
      _deviceId = savedId;
      final savedShown = prefs.getStringList(_prefShownIdsKey) ?? const <String>[];
      _shownNotificationIdsOrder
        ..clear()
        ..addAll(savedShown);
      _shownNotificationIds
        ..clear()
        ..addAll(savedShown);
    } catch (e) {
      debugPrint('[CustomerPush] Preferences unavailable: $e');
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
      } catch (_) {}
    }
  }

  int _stableNotificationIntId(String key) {
    var hash = 0;
    for (final codeUnit in key.codeUnits) {
      hash = ((hash * 31) + codeUnit) & 0x7fffffff;
    }
    if (hash == 0 || hash == 904201) {
      return 100000 + (hash % 800000);
    }
    return hash;
  }

  String _resolveTopBarChannel(String? requestedChannel, String? category, String? deepLink) {
    final useSilent = !_soundEnabled && !_vibrationEnabled;
    if (useSilent) return OtlobhaPushChannels.silent;
    final dl = (deepLink ?? '').toLowerCase();
    if (dl.contains('chat') || requestedChannel == OtlobhaPushChannels.chat) {
      return OtlobhaPushChannels.chat;
    }
    if (dl == 'order' || dl == 'orders' || dl == 'trip' || requestedChannel == OtlobhaPushChannels.orders) {
      return OtlobhaPushChannels.orders;
    }
    // Route admin broadcasts, promos, and verify_email through the high-priority verification/admin channel
    // so they always pop up in the phone's top notification bar even on existing Android installs.
    return OtlobhaPushChannels.admin;
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
        for (final channel in OtlobhaPushChannels.all()) {
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
      debugPrint('[CustomerPush] Local notifications init skipped: $e');
    }
  }

  Future<void> _initFirebaseMessaging() async {
    try {
      if (Firebase.apps.isEmpty) {
        // Initialize from native Android google-services.json / iOS GoogleService-Info.plist
        await Firebase.initializeApp();
      }
      _firebaseReady = Firebase.apps.isNotEmpty;
    } catch (e) {
      if (Firebase.apps.isNotEmpty) {
        _firebaseReady = true;
      } else {
        _firebaseReady = false;
        debugPrint('[CustomerPush] Firebase init error (verify google-services.json): $e');
        return;
      }
    }

    if (!_firebaseReady) return;

    try {
      FirebaseMessaging.onBackgroundMessage(otlobhaCustomerBackgroundHandler);
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      final initialMsg = await FirebaseMessaging.instance.getInitialMessage();
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

      // Subscribe to customer broadcast topics so background pushes arrive even on fresh installs
      unawaited(_subscribeDefaultTopics());
    } catch (e) {
      debugPrint('[CustomerPush] Messaging listeners error: $e');
    }
  }

  Future<void> _subscribeDefaultTopics() async {
    if (!_firebaseReady || kIsWeb) return;
    try {
      await FirebaseMessaging.instance.subscribeToTopic('otlobha_all');
      await FirebaseMessaging.instance.subscribeToTopic('otlobha_customer_all');
    } catch (e) {
      debugPrint('[CustomerPush] Topic subscription skipped: $e');
    }
  }

  /// Requests Android 13+ POST_NOTIFICATIONS and iOS notification permissions.
  Future<bool> requestPermission() async {
    bool granted = false;
    try {
      final androidPlugin = _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        final androidGranted = await androidPlugin.requestNotificationsPermission();
        if (androidGranted != null) granted = androidGranted;
      }
    } catch (e) {
      debugPrint('[CustomerPush] Android permission request error: $e');
    }

    if (_firebaseReady) {
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
        debugPrint('[CustomerPush] FCM permission request error: $e');
      }
    }

    _permissionGranted = granted;
    return granted;
  }

  /// Registers the current device's FCM token with the Otlobha backend for the authenticated customer.
  Future<void> registerForAuthenticatedUser(OtlobhaCustomerApi api) async {
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
        debugPrint('[CustomerPush] Token fetch/register attempt ${attempt + 1} failed: $e');
      }
      if (attempt < 2) {
        await Future<void>.delayed(Duration(seconds: (attempt + 1) * 2));
      }
    }
  }

  Future<void> _syncTokenToBackend(OtlobhaCustomerApi api, String token) async {
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
      debugPrint('[CustomerPush] Backend token sync failed: $e');
    }
  }

  /// Unregisters this device's FCM token before logout so notifications stop reaching logged-out devices.
  Future<void> unregisterOnLogout(OtlobhaCustomerApi api) async {
    try {
      await api.unregisterPushToken(fcmToken: _currentToken, deviceId: _deviceId);
    } catch (_) {}
    _tokenSyncedToBackend = false;
    _boundApi = null;
  }

  /// Displays a real native Android heads-up notification even while the app is open in the foreground.
  Future<void> showForegroundSystemNotification(RemoteMessage message) async {
    final data = _extractMessageData(message);
    final title = message.notification?.title ?? data['title_ar']?.toString() ?? 'اطلبها';
    final body = message.notification?.body ?? data['body_ar']?.toString() ?? '';
    if (title.isEmpty && body.isEmpty) return;

    final notifId = (data['notification_id'] ?? data['id'] ?? '').toString().trim();
    if (notifId.isNotEmpty) {
      await _markNotificationIdShown(notifId);
    }

    final effectiveChannel = _resolveTopBarChannel(
      data['channel_id']?.toString(),
      data['category']?.toString(),
      data['deep_link']?.toString(),
    );

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
            priority: Priority.high,
            playSound: _soundEnabled,
            enableVibration: _vibrationEnabled,
            vibrationPattern: _vibrationEnabled ? Int64List.fromList([0, 250, 150, 250]) : null,
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
      debugPrint('[CustomerPush] Foreground local show failed: $e');
    }
  }

  /// Displays ANY backend notification record (admin campaign, verify_email, promo, order update, etc.)
  /// in the phone's top status bar — identical to the email verification notification — with deduplication.
  Future<bool> showSystemNotificationFromRecord(
    Map<String, dynamic> record, {
    String? fallbackEmail,
  }) async {
    final notifId = (record['id'] ?? record['notification_id'] ?? '').toString().trim();
    if (notifId.isNotEmpty && _shownNotificationIds.contains(notifId)) {
      return false;
    }

    final title = (record['title_ar'] ?? record['title'] ?? '').toString().trim();
    final body = (record['body_ar'] ?? record['body'] ?? '').toString().trim();
    if (title.isEmpty && body.isEmpty) return false;

    final deepLink = (record['deep_link'] ?? 'notifications').toString().trim();
    final category = (record['category'] ?? '').toString().trim();
    final effectiveChannel = _resolveTopBarChannel(
      record['channel_id']?.toString(),
      category,
      deepLink,
    );

    final email = (record['email']?.toString().trim().isNotEmpty == true)
        ? record['email'].toString().trim()
        : (fallbackEmail?.trim() ?? '');

    final data = <String, dynamic>{
      'notification_id': notifId,
      'deep_link': deepLink,
      'category': category,
      'title_ar': title.isNotEmpty ? title : 'اطلبها',
      'body_ar': body,
      'channel_id': effectiveChannel,
      if (email.isNotEmpty) 'email': email,
      if ((record['order_id'] ?? '').toString().trim().isNotEmpty) 'order_id': record['order_id'].toString().trim(),
      if ((record['trip_id'] ?? '').toString().trim().isNotEmpty) 'trip_id': record['trip_id'].toString().trim(),
      if ((record['parcel_id'] ?? '').toString().trim().isNotEmpty) 'parcel_id': record['parcel_id'].toString().trim(),
    };

    try {
      final intId = notifId.isNotEmpty
          ? _stableNotificationIntId(notifId)
          : DateTime.now().millisecondsSinceEpoch.remainder(1000000);
      await _localNotifications.show(
        intId,
        title.isNotEmpty ? title : 'اطلبها',
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            effectiveChannel,
            _channelDisplayName(effectiveChannel),
            importance: Importance.max,
            priority: Priority.high,
            playSound: _soundEnabled,
            enableVibration: _vibrationEnabled,
            vibrationPattern: _vibrationEnabled ? Int64List.fromList([0, 250, 150, 250]) : null,
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
      if (notifId.isNotEmpty) {
        await _markNotificationIdShown(notifId);
      }
      return true;
    } catch (e) {
      debugPrint('[CustomerPush] Local notification from record failed: $e');
      return false;
    }
  }

  /// Syncs unread notifications fetched from bootstrap/inbox into the phone's top notification bar
  /// so ALL notifications appear in the status bar even when FCM server credentials are not configured.
  Future<bool> syncUnreadNotificationsToStatusBar(
    List<dynamic> records, {
    String? customerEmail,
    bool isEmailVerified = false,
  }) async {
    var showedVerifyEmail = false;
    final unread = <Map<String, dynamic>>[];
    for (final item in records) {
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final isRead = map['is_read'] == true || map['is_read'] == 1;
      if (isRead) continue;
      final dl = (map['deep_link'] ?? '').toString().toLowerCase().trim();
      if (dl == 'verify_email' && isEmailVerified) continue;
      final id = (map['id'] ?? '').toString().trim();
      if (id.isNotEmpty && _shownNotificationIds.contains(id)) {
        if (dl == 'verify_email') showedVerifyEmail = true;
        continue;
      }
      unread.add(map);
    }

    // Show newest unread notifications (oldest-first among the latest 8 so top of tray has newest)
    final batch = unread.take(8).toList().reversed;
    for (final rec in batch) {
      final shown = await showSystemNotificationFromRecord(rec, fallbackEmail: customerEmail);
      final dl = (rec['deep_link'] ?? '').toString().toLowerCase().trim();
      if (shown && dl == 'verify_email') {
        showedVerifyEmail = true;
      }
    }
    return showedVerifyEmail;
  }

  /// Displays a tappable native notification prompting the customer to verify their email on the external code page.
  Future<void> showEmailVerificationLocalNotification({required String email}) async {
    if (email.trim().isEmpty) return;
    final useSilent = !_soundEnabled && !_vibrationEnabled;
    final effectiveChannel = useSilent ? OtlobhaPushChannels.silent : OtlobhaPushChannels.admin;
    const title = 'وثّق بريدك الإلكتروني الآن';
    const body = 'اضغط هنا لفتح صفحة التوثيق وإدخال رمز التحقق لتأمين حسابك في اطلبها.';
    final data = <String, dynamic>{
      'deep_link': 'verify_email',
      'email': email.trim(),
      'title_ar': title,
      'body_ar': body,
      'channel_id': effectiveChannel,
    };
    try {
      await _localNotifications.show(
        904201,
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            effectiveChannel,
            _channelDisplayName(effectiveChannel),
            importance: Importance.max,
            priority: Priority.high,
            playSound: _soundEnabled,
            enableVibration: _vibrationEnabled,
            vibrationPattern: _vibrationEnabled ? Int64List.fromList([0, 250, 150, 250]) : null,
            icon: '@mipmap/ic_launcher',
            styleInformation: const BigTextStyleInformation(body),
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
      debugPrint('[CustomerPush] Email verification local notification failed: $e');
    }
  }

  String _channelDisplayName(String channelId) {
    switch (channelId) {
      case OtlobhaPushChannels.chat:
        return 'رسائل الشات المباشر';
      case OtlobhaPushChannels.admin:
        return 'تنبيهات الإدارة والحساب';
      case OtlobhaPushChannels.promos:
        return 'العروض والتخفيضات';
      case OtlobhaPushChannels.silent:
        return 'إشعارات صامتة';
      default:
        return 'تحديثات الطلبات والمشاوير';
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

  void consumePendingTapIfAny() {
    _flushPendingTap();
  }
}
