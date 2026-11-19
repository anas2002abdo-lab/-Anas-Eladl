import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PickedImageResult {
  final Uint8List bytes;
  final String dataUrl;
  final String? targetKey;
  final String filePath;

  const PickedImageResult({
    required this.bytes,
    required this.dataUrl,
    required this.filePath,
    this.targetKey,
  });
}

/// Safe wrapper around ImagePicker that prevents first-time Android camera capture
/// crashes/state-loss by:
/// 1. Disabling EXIF metadata parsing (`requestFullMetadata: false`) & capping size.
/// 2. Persisting the active capture target key before opening Android's Camera Activity.
/// 3. Recovering lost camera data via `retrieveLostData()` if Android kills & recreates MainActivity.
class SafeCameraPicker {
  static final ImagePicker _picker = ImagePicker();
  static const String _pendingKeyPref = 'otlobha_customer_pending_camera_target';

  static Future<PickedImageResult?> pickImage({
    required ImageSource source,
    String? targetKey,
    double maxWidth = 1024,
    double maxHeight = 1024,
    int imageQuality = 75,
  }) async {
    SharedPreferences? prefs;
    try {
      prefs = await SharedPreferences.getInstance();
      if (targetKey != null && targetKey.isNotEmpty) {
        await prefs.setString(_pendingKeyPref, targetKey);
      }
    } catch (_) {}

    try {
      final XFile? file = await _picker.pickImage(
        source: source,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        imageQuality: imageQuality,
        requestFullMetadata: false,
      );
      try {
        await prefs?.remove(_pendingKeyPref);
      } catch (_) {}
      if (file == null) return null;
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty) return null;
      return PickedImageResult(
        bytes: bytes,
        dataUrl: 'data:image/jpeg;base64,${base64Encode(bytes)}',
        filePath: file.path,
        targetKey: targetKey,
      );
    } catch (e) {
      debugPrint('[SafeCameraPicker] pickImage error: $e');
      rethrow;
    }
  }

  /// Recovers an image taken right before Android OS killed MainActivity on first camera grant.
  static Future<PickedImageResult?> recoverLostImage({String? expectedTargetKey}) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      final LostDataResponse response = await _picker.retrieveLostData();
      if (response.isEmpty || response.file == null) return null;

      String? pendingTarget;
      try {
        final prefs = await SharedPreferences.getInstance();
        pendingTarget = prefs.getString(_pendingKeyPref);
        if (expectedTargetKey != null &&
            pendingTarget != null &&
            pendingTarget != expectedTargetKey) {
          return null;
        }
        await prefs.remove(_pendingKeyPref);
      } catch (_) {}

      final file = response.file!;
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty) return null;
      return PickedImageResult(
        bytes: bytes,
        dataUrl: 'data:image/jpeg;base64,${base64Encode(bytes)}',
        filePath: file.path,
        targetKey: pendingTarget ?? expectedTargetKey,
      );
    } catch (e) {
      debugPrint('[SafeCameraPicker] recoverLostImage error: $e');
      return null;
    }
  }
}
