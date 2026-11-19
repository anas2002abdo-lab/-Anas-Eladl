#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.vfs.watch=false"

if command -v java >/dev/null 2>&1; then
  JAVA_MAJOR="$(java -version 2>&1 | awk -F '[\".]' '/version/ {print $2; exit}')"
  if [ -n "${JAVA_MAJOR:-}" ] && [ "$JAVA_MAJOR" -lt 21 ]; then
    echo "WARNING: Detected Java $JAVA_MAJOR. Java 21 (JDK 21) is required for modern AGP/Android Lint (List.removeLast)."
  fi
fi

for APP in otlobha_customer otlobha_captain; do
  echo "=== Preparing & Building $APP ==="
  cd "$ROOT_DIR/$APP"
  if [ ! -f android/settings.gradle ] && [ ! -f android/settings.gradle.kts ]; then
    if [ -f android/app/src/main/AndroidManifest.xml ]; then cp android/app/src/main/AndroidManifest.xml "/tmp/${APP}_manifest.xml"; fi
    if [ -f ios/Runner/Info.plist ]; then cp ios/Runner/Info.plist "/tmp/${APP}_info.plist"; fi
    if [ -d test ]; then rm -rf "/tmp/${APP}_test" && cp -r test "/tmp/${APP}_test"; fi
    if [ -f analysis_options.yaml ]; then cp analysis_options.yaml "/tmp/${APP}_analysis_options.yaml"; fi

    flutter create . --project-name "$APP" --org com.otlobha --platforms=android,ios

    if [ -f "/tmp/${APP}_manifest.xml" ]; then cp "/tmp/${APP}_manifest.xml" android/app/src/main/AndroidManifest.xml; fi
    if [ -f "/tmp/${APP}_info.plist" ]; then cp "/tmp/${APP}_info.plist" ios/Runner/Info.plist; fi
    if [ -d "/tmp/${APP}_test" ]; then
      rm -rf test
      cp -r "/tmp/${APP}_test" test
    fi
    if [ -f "/tmp/${APP}_analysis_options.yaml" ]; then cp "/tmp/${APP}_analysis_options.yaml" analysis_options.yaml; fi
  fi

  if [ -f android/gradle.properties ] && ! grep -q '^org\.gradle\.vfs\.watch=' android/gradle.properties; then
    printf '\norg.gradle.vfs.watch=false\n' >> android/gradle.properties
  fi

  flutter pub get
  dart run flutter_launcher_icons
  flutter analyze --no-fatal-infos --no-fatal-warnings
  flutter test
  flutter build apk --release --dart-define=API_BASE_URL="$API_URL"
  test -s build/app/outputs/flutter-apk/app-release.apk
  echo "APK generated at: $ROOT_DIR/$APP/build/app/outputs/flutter-apk/app-release.apk"
  if [ -x android/gradlew ]; then (cd android && ./gradlew --stop) || true; fi
done
