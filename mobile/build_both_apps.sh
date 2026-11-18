#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

for APP in otlobha_customer otlobha_captain; do
  echo "=== Preparing & Building $APP ==="
  cd "$ROOT_DIR/$APP"
  cp android/app/src/main/AndroidManifest.xml "/tmp/${APP}_manifest.xml"
  cp ios/Runner/Info.plist "/tmp/${APP}_info.plist"
  cp test/widget_test.dart "/tmp/${APP}_widget_test.dart"
  cp analysis_options.yaml "/tmp/${APP}_analysis_options.yaml"
  flutter create . --project-name "$APP" --org com.otlobha --platforms=android,ios
  cp "/tmp/${APP}_manifest.xml" android/app/src/main/AndroidManifest.xml
  cp "/tmp/${APP}_info.plist" ios/Runner/Info.plist
  mkdir -p test
  cp "/tmp/${APP}_widget_test.dart" test/widget_test.dart
  cp "/tmp/${APP}_analysis_options.yaml" analysis_options.yaml
  flutter pub get
  dart run flutter_launcher_icons
  flutter analyze --no-fatal-infos --no-fatal-warnings
  flutter test
  flutter build apk --release --dart-define=API_BASE_URL="$API_URL"
  echo "APK generated at: $ROOT_DIR/$APP/build/app/outputs/flutter-apk/app-release.apk"
done
