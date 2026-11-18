#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

for APP in otlobha_customer otlobha_captain; do
  echo "=== Preparing & Building $APP ==="
  cd "$ROOT_DIR/$APP"
  cp android/app/src/main/AndroidManifest.xml "/tmp/${APP}_manifest.xml"
  cp ios/Runner/Info.plist "/tmp/${APP}_info.plist"
  flutter create . --platforms=android,ios
  cp "/tmp/${APP}_manifest.xml" android/app/src/main/AndroidManifest.xml
  cp "/tmp/${APP}_info.plist" ios/Runner/Info.plist
  flutter pub get
  dart run flutter_launcher_icons
  flutter analyze
  flutter build apk --release --dart-define=API_BASE_URL="$API_URL"
  echo "APK generated at: $ROOT_DIR/$APP/build/app/outputs/flutter-apk/app-release.apk"
done
