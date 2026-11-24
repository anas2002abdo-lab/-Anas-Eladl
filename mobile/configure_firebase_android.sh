#!/usr/bin/env bash
set -euo pipefail

# Configures Android Gradle files for Firebase Cloud Messaging (google-services plugin)
# and Java 8+ core library desugaring (required by flutter_local_notifications v18+).
# Run from inside mobile/otlobha_customer or mobile/otlobha_captain after `flutter create`.
#
# Environment variables:
#   FIREBASE_GOOGLE_SERVICES_JSON_B64 : Base64-encoded contents of google-services.json
#   FIREBASE_SECRET_NAME              : Secret name for clear error reporting (never prints value)
#   EXPECTED_ANDROID_PACKAGE          : Optional expected Android package_name to prevent swapped configs
#   REQUIRE_GOOGLE_SERVICES           : "1" (default) to fail fast if secret/file is missing; "0" for optional local builds

APP_DIR="${1:-.}"
cd "$APP_DIR"

GS_TARGET="android/app/google-services.json"
SECRET_NAME="${FIREBASE_SECRET_NAME:-FIREBASE_GOOGLE_SERVICES_JSON_B64}"
REQUIRE_GS="${REQUIRE_GOOGLE_SERVICES:-1}"
EXPECTED_PKG="${EXPECTED_ANDROID_PACKAGE:-}"
BG_API_BASE_URL="${OTLOBHA_BG_API_BASE_URL:-https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app}"

export GS_TARGET SECRET_NAME REQUIRE_GS EXPECTED_PKG BG_API_BASE_URL

# 1. Decode base64 secret into android/app/google-services.json (never print secret values)
python3 - <<'PYEOF'
import base64
import binascii
import json
import os
import stat
import sys
from pathlib import Path

gs_target = Path(os.environ["GS_TARGET"])
secret_name = os.environ["SECRET_NAME"]
require_gs = os.environ["REQUIRE_GS"] == "1"
expected_pkg = os.environ.get("EXPECTED_PKG", "").strip()
raw_b64 = os.environ.get("FIREBASE_GOOGLE_SERVICES_JSON_B64", "")
compact_b64 = "".join(raw_b64.split())

if compact_b64:
    try:
        decoded = base64.b64decode(compact_b64, validate=True)
    except (binascii.Error, ValueError):
        print(
            f"::error::Secret {secret_name} is not valid Base64. "
            f"Re-encode google-services.json as Base64 and update the secret.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not decoded.strip():
        print(
            f"::error::Decoded content of {secret_name} is empty. Cannot write {gs_target}.",
            file=sys.stderr,
        )
        sys.exit(1)

    gs_target.parent.mkdir(parents=True, exist_ok=True)
    gs_target.write_bytes(decoded)
    try:
        os.chmod(gs_target, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    print(f"[FCM Android Setup] Wrote {gs_target} from secret {secret_name} (secret content hidden).")
elif not gs_target.is_file() or gs_target.stat().st_size == 0:
    if require_gs:
        print(
            f"::error::Missing Firebase Android configuration: secret {secret_name} is empty "
            f"and {gs_target} does not exist. Stopping build.",
            file=sys.stderr,
        )
        sys.exit(1)
    else:
        print(
            f"::warning::google-services.json not found at {gs_target} and {secret_name} is unset. "
            f"Proceeding because REQUIRE_GOOGLE_SERVICES=0."
        )
        sys.exit(0)

# Validate JSON structure and optional package_name match without printing secret contents
try:
    data = json.loads(gs_target.read_text(encoding="utf-8"))
except Exception:
    print(
        f"::error::{gs_target} is not valid JSON. Verify the source file encoded in {secret_name}.",
        file=sys.stderr,
    )
    sys.exit(1)

if not isinstance(data, dict):
    print(f"::error::{gs_target} must contain a JSON object.", file=sys.stderr)
    sys.exit(1)

project_info = data.get("project_info")
clients = data.get("client")
if not isinstance(project_info, dict) or not project_info.get("project_id") or not isinstance(clients, list) or not clients:
    print(
        f"::error::{gs_target} is missing required Firebase fields (project_info.project_id or client).",
        file=sys.stderr,
    )
    sys.exit(1)

found_packages = []
for entry in clients:
    if isinstance(entry, dict):
        pkg = (
            entry.get("client_info", {})
            .get("android_client_info", {})
            .get("package_name")
        )
        if isinstance(pkg, str) and pkg.strip():
            found_packages.append(pkg.strip())

if expected_pkg and expected_pkg not in found_packages:
    print(
        f"::error::Firebase configuration mismatch for {gs_target}: expected Android package "
        f"'{expected_pkg}', but {secret_name} does not contain a matching Android client entry. "
        f"Check that Customer and Captain Firebase secrets are not swapped.",
        file=sys.stderr,
    )
    sys.exit(1)

if expected_pkg:
    print(f"[FCM Android Setup] Verified valid {gs_target} for package '{expected_pkg}'.")
else:
    print(f"[FCM Android Setup] Verified valid {gs_target}.")
PYEOF

HAS_GOOGLE_SERVICES="0"
if [ -s "$GS_TARGET" ]; then
  HAS_GOOGLE_SERVICES="1"
  echo "[FCM Android Setup] Confirmed $GS_TARGET exists — enabling com.google.gms.google-services Gradle plugin."
elif [ "$REQUIRE_GS" = "1" ]; then
  echo "::error::Expected $GS_TARGET to exist and be non-empty before Gradle configuration."
  exit 1
fi

export HAS_GOOGLE_SERVICES

# 2. Patch Android Gradle files and verify Google Services plugin is active
python3 - <<'PYEOF'
import json
import os
import re
import sys
from pathlib import Path

has_gs = os.environ.get("HAS_GOOGLE_SERVICES") == "1"

# --- Patch android/settings.gradle.kts, android/settings.gradle, or legacy android/build.gradle ---
settings_kts = Path("android/settings.gradle.kts")
settings_groovy = Path("android/settings.gradle")
root_build_groovy = Path("android/build.gradle")
root_build_kts = Path("android/build.gradle.kts")

plugin_declared = False

if has_gs:
    if settings_kts.exists():
        text = settings_kts.read_text(encoding="utf-8")
        if "com.google.gms.google-services" not in text:
            new_text, count = re.subn(
                r"(^plugins\s*\{)",
                r'\1\n    id("com.google.gms.google-services") version "4.4.2" apply false',
                text,
                count=1,
                flags=re.MULTILINE,
            )
            if count == 0:
                new_text, count = re.subn(
                    r"(plugins\s*\{)",
                    r'\1\n    id("com.google.gms.google-services") version "4.4.2" apply false',
                    text,
                    count=1,
                )
            if count > 0:
                settings_kts.write_text(new_text, encoding="utf-8")
                text = new_text
                print("[FCM Android Setup] Patched android/settings.gradle.kts with google-services plugin.")
        if "com.google.gms.google-services" in text:
            plugin_declared = True
    elif settings_groovy.exists():
        text = settings_groovy.read_text(encoding="utf-8")
        if "com.google.gms.google-services" not in text:
            new_text, count = re.subn(
                r"(^plugins\s*\{)",
                r'\1\n    id "com.google.gms.google-services" version "4.4.2" apply false',
                text,
                count=1,
                flags=re.MULTILINE,
            )
            if count == 0:
                new_text, count = re.subn(
                    r"(plugins\s*\{)",
                    r'\1\n    id "com.google.gms.google-services" version "4.4.2" apply false',
                    text,
                    count=1,
                )
            if count > 0:
                settings_groovy.write_text(new_text, encoding="utf-8")
                text = new_text
                print("[FCM Android Setup] Patched android/settings.gradle with google-services plugin.")
        if "com.google.gms.google-services" in text:
            plugin_declared = True

    # Legacy Groovy/KTS fallback via root buildscript classpath if settings.gradle has no plugins {} block
    if not plugin_declared and root_build_groovy.exists():
        text = root_build_groovy.read_text(encoding="utf-8")
        if "com.google.gms:google-services" not in text:
            new_text, count = re.subn(
                r"(dependencies\s*\{)",
                r"\1\n        classpath 'com.google.gms:google-services:4.4.2'",
                text,
                count=1,
            )
            if count > 0:
                root_build_groovy.write_text(new_text, encoding="utf-8")
                text = new_text
                print("[FCM Android Setup] Patched android/build.gradle buildscript with google-services classpath.")
        if "com.google.gms:google-services" in text:
            plugin_declared = True
    elif not plugin_declared and root_build_kts.exists():
        text = root_build_kts.read_text(encoding="utf-8")
        if "com.google.gms:google-services" not in text:
            new_text, count = re.subn(
                r"(dependencies\s*\{)",
                r'\1\n        classpath("com.google.gms:google-services:4.4.2")',
                text,
                count=1,
            )
            if count > 0:
                root_build_kts.write_text(new_text, encoding="utf-8")
                text = new_text
                print("[FCM Android Setup] Patched android/build.gradle.kts buildscript with google-services classpath.")
        if "com.google.gms:google-services" in text:
            plugin_declared = True

    if not plugin_declared:
        print(
            "::error::Failed to declare com.google.gms.google-services plugin in "
            "android/settings.gradle(.kts) or android/build.gradle(.kts).",
            file=sys.stderr,
        )
        sys.exit(1)

# --- Patch android/app/build.gradle.kts or android/app/build.gradle ---
app_kts = Path("android/app/build.gradle.kts")
app_groovy = Path("android/app/build.gradle")
plugin_applied = False

if app_kts.exists():
    text = app_kts.read_text(encoding="utf-8")

    # Ensure google-services plugin applied when google-services.json exists
    if has_gs and "com.google.gms.google-services" not in text:
        new_text, count = re.subn(
            r"(^plugins\s*\{)",
            r'\1\n    id("com.google.gms.google-services")',
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            new_text, count = re.subn(
                r"(plugins\s*\{)",
                r'\1\n    id("com.google.gms.google-services")',
                text,
                count=1,
            )
        text = new_text

    # Ensure core library desugaring is enabled for flutter_local_notifications v18+
    if "isCoreLibraryDesugaringEnabled" not in text:
        text = re.sub(
            r"(compileOptions\s*\{)",
            r"\1\n        isCoreLibraryDesugaringEnabled = true",
            text,
            count=1,
        )

    # Ensure minSdk >= 23 for Firebase Messaging & modern Android push libraries
    text = re.sub(
        r"minSdk\s*=\s*flutter\.minSdkVersion",
        "minSdk = maxOf(flutter.minSdkVersion, 23)",
        text,
    )

    # Ensure desugar_jdk_libs dependency exists
    if "desugar_jdk_libs" not in text:
        if re.search(r"dependencies\s*\{", text):
            text = re.sub(
                r"(dependencies\s*\{)",
                r'\1\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")',
                text,
                count=1,
            )
        else:
            text += '\n\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")\n}\n'

    app_kts.write_text(text, encoding="utf-8")
    plugin_applied = "com.google.gms.google-services" in text
    print("[FCM Android Setup] Patched android/app/build.gradle.kts (desugaring + minSdk + google-services).")

elif app_groovy.exists():
    text = app_groovy.read_text(encoding="utf-8")

    if has_gs and "com.google.gms.google-services" not in text:
        new_text, count = re.subn(
            r"(^plugins\s*\{)",
            r'\1\n    id "com.google.gms.google-services"',
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            new_text, count = re.subn(
                r"(plugins\s*\{)",
                r'\1\n    id "com.google.gms.google-services"',
                text,
                count=1,
            )
        if count > 0:
            text = new_text
        else:
            text += "\napply plugin: 'com.google.gms.google-services'\n"

    if "coreLibraryDesugaringEnabled" not in text:
        text = re.sub(
            r"(compileOptions\s*\{)",
            r"\1\n        coreLibraryDesugaringEnabled true",
            text,
            count=1,
        )

    text = re.sub(
        r"minSdk\s*=\s*flutter\.minSdkVersion",
        "minSdk = Math.max(flutter.minSdkVersion, 23)",
        text,
    )
    text = re.sub(
        r"minSdkVersion\s+flutter\.minSdkVersion",
        "minSdkVersion Math.max(flutter.minSdkVersion, 23)",
        text,
    )

    if "desugar_jdk_libs" not in text:
        if re.search(r"dependencies\s*\{", text):
            text = re.sub(
                r"(dependencies\s*\{)",
                r"\1\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.4'",
                text,
                count=1,
            )
        else:
            text += "\n\ndependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.4'\n}\n"

    app_groovy.write_text(text, encoding="utf-8")
    plugin_applied = "com.google.gms.google-services" in text
    print("[FCM Android Setup] Patched android/app/build.gradle (desugaring + minSdk + google-services).")
else:
    print(
        "::error::Neither android/app/build.gradle.kts nor android/app/build.gradle was found.",
        file=sys.stderr,
    )
    sys.exit(1)

if has_gs and not plugin_applied:
    print(
        "::error::Failed to apply com.google.gms.google-services plugin in android/app/build.gradle(.kts).",
        file=sys.stderr,
    )
    sys.exit(1)

# --- Validate mobilesdk_app_id hex format in google-services.json ---
gs_path = Path("android/app/google-services.json")
if has_gs and gs_path.exists():
    try:
        gs_data = json.loads(gs_path.read_text(encoding="utf-8"))
        for entry in gs_data.get("client", []):
            app_id = entry.get("client_info", {}).get("mobilesdk_app_id", "")
            if app_id and not re.match(r"^\d+:\d+:android:[0-9a-fA-F]+$", str(app_id)):
                print(
                    f"::error::Invalid mobilesdk_app_id format in {gs_path} (contains non-hex characters). "
                    "Re-download google-services.json directly from Firebase Console.",
                    file=sys.stderr,
                )
                sys.exit(1)
    except SystemExit:
        raise
    except Exception:
        pass

# --- 3. Patch android/app/src/main/AndroidManifest.xml for reliable Background FCM Push ---
manifest_path = Path("android/app/src/main/AndroidManifest.xml")
if manifest_path.exists():
    m_text = manifest_path.read_text(encoding="utf-8")
    expected_pkg = os.environ.get("EXPECTED_PKG", "").strip().lower()
    cwd_name = Path.cwd().name.lower()
    is_captain_app = "captain" in expected_pkg or "captain" in cwd_name
    is_merchant_app = "merchant" in expected_pkg or "merchant" in cwd_name
    default_channel = "otlobha_dispatch_channel" if (is_captain_app or is_merchant_app) else "otlobha_orders_channel"

    required_permissions = [
        "android.permission.INTERNET",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE",
        "android.permission.WAKE_LOCK",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
        "android.permission.SCHEDULE_EXACT_ALARM",
    ]
    perm_lines = []
    for perm in required_permissions:
        if perm not in m_text:
            perm_lines.append(f'    <uses-permission android:name="{perm}"/>')
    if perm_lines:
        m_text, _ = re.subn(
            r"(<application\b)",
            "\n".join(perm_lines) + r"\n    \1",
            m_text,
            count=1,
        )

    meta_additions = []
    if "com.google.firebase.messaging.default_notification_channel_id" not in m_text:
        meta_additions.append(
            f'        <meta-data\n'
            f'            android:name="com.google.firebase.messaging.default_notification_channel_id"\n'
            f'            android:value="{default_channel}" />'
        )
    if "com.google.firebase.messaging.default_notification_icon" not in m_text:
        meta_additions.append(
            '        <meta-data\n'
            '            android:name="com.google.firebase.messaging.default_notification_icon"\n'
            '            android:resource="@mipmap/ic_launcher" />'
        )
    if meta_additions and "</application>" in m_text:
        m_text = m_text.replace("</application>", "\n" + "\n".join(meta_additions) + "\n    </application>", 1)

    if "FLUTTER_NOTIFICATION_CLICK" not in m_text and "</activity>" in m_text:
        click_filter = (
            '            <intent-filter>\n'
            '                <action android:name="FLUTTER_NOTIFICATION_CLICK" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '            </intent-filter>\n'
            '        </activity>'
        )
        m_text = m_text.replace("</activity>", click_filter, 1)

    if "</application>" in m_text:
        bg_components_xml = ""
        if "OtlobhaBgPushService" not in m_text:
            bg_components_xml += (
                '        <service\n'
                '            android:name=".OtlobhaBgPushService"\n'
                '            android:enabled="true"\n'
                '            android:exported="false"\n'
                '            android:stopWithTask="false"\n'
                '            android:foregroundServiceType="dataSync" />\n'
            )
        if "OtlobhaBgJobService" not in m_text:
            bg_components_xml += (
                '        <service\n'
                '            android:name=".OtlobhaBgJobService"\n'
                '            android:permission="android.permission.BIND_JOB_SERVICE"\n'
                '            android:exported="false" />\n'
            )
        if "OtlobhaBgAlarmReceiver" not in m_text:
            bg_components_xml += (
                '        <receiver\n'
                '            android:name=".OtlobhaBgAlarmReceiver"\n'
                '            android:enabled="true"\n'
                '            android:exported="false" />\n'
            )
        if "OtlobhaBootReceiver" not in m_text:
            bg_components_xml += (
                '        <receiver\n'
                '            android:name=".OtlobhaBootReceiver"\n'
                '            android:enabled="true"\n'
                '            android:exported="false">\n'
                '            <intent-filter>\n'
                '                <action android:name="android.intent.action.BOOT_COMPLETED" />\n'
                '                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />\n'
                '                <action android:name="android.intent.action.QUICKBOOT_POWERON" />\n'
                '            </intent-filter>\n'
                '        </receiver>\n'
            )
        if bg_components_xml:
            bg_components_xml += '    </application>'
            m_text = m_text.replace("</application>", bg_components_xml, 1)

    manifest_path.write_text(m_text, encoding="utf-8")
    print(f"[FCM Android Setup] Patched AndroidManifest.xml with ForegroundService (OtlobhaBgPushService), POST_NOTIFICATIONS, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, JobService, AlarmReceiver, BootReceiver, channel '{default_channel}', and FLUTTER_NOTIFICATION_CLICK.")

# --- 4. Generate Zero-Dependency Native Android Background Notification Engine (OS JobScheduler + BootReceiver + MainActivity Bridge) ---
expected_pkg_raw = os.environ.get("EXPECTED_PKG", "").strip()
cwd_name_lower = Path.cwd().name.lower()
is_captain = "captain" in expected_pkg_raw.lower() or "captain" in cwd_name_lower
is_merchant = "merchant" in expected_pkg_raw.lower() or "merchant" in cwd_name_lower
app_role = "captain" if is_captain else ("merchant" if is_merchant else "customer")
default_channel_bg = "otlobha_dispatch_channel" if (is_captain or is_merchant) else "otlobha_admin_channel"
access_token_key = (
    "flutter.otlobha_cap_access_token"
    if is_captain
    else ("flutter.otlobha_merchant_access_token" if is_merchant else "flutter.otlobha_cust_access_token")
)
refresh_token_key = (
    "flutter.otlobha_cap_refresh_token"
    if is_captain
    else ("flutter.otlobha_merchant_refresh_token" if is_merchant else "flutter.otlobha_cust_refresh_token")
)
sound_pref_key = (
    "flutter.otlobha_captain_push_sound_v1"
    if is_captain
    else ("flutter.otlobha_merchant_push_sound_v1" if is_merchant else "flutter.otlobha_customer_push_sound_v1")
)
vib_pref_key = (
    "flutter.otlobha_captain_push_vibration_v1"
    if is_captain
    else ("flutter.otlobha_merchant_push_vibration_v1" if is_merchant else "flutter.otlobha_customer_push_vibration_v1")
)
default_app_title = "اطلبها كابتن" if is_captain else ("اطلبها للتجار" if is_merchant else "اطلبها")
fallback_pkg = (
    "com.otlobha.otlobha_captain"
    if is_captain
    else ("com.otlobha.otlobha_merchant" if is_merchant else "com.otlobha.otlobha_customer")
)

kotlin_root = Path("android/app/src/main/kotlin")
existing_mains = list(kotlin_root.rglob("MainActivity.kt")) if kotlin_root.exists() else []
if existing_mains:
    main_kt_path = existing_mains[0]
    m_kt_text = main_kt_path.read_text(encoding="utf-8")
    pkg_match = re.search(r"^\s*package\s+([A-Za-z0-9_.]+)", m_kt_text, flags=re.MULTILINE)
    pkg_name = pkg_match.group(1) if pkg_match else (expected_pkg_raw or fallback_pkg)
    pkg_dir = main_kt_path.parent
else:
    pkg_name = expected_pkg_raw or fallback_pkg
    pkg_dir = kotlin_root / Path(*pkg_name.split("."))
    pkg_dir.mkdir(parents=True, exist_ok=True)
    main_kt_path = pkg_dir / "MainActivity.kt"

# Remove any legacy WorkManager worker file if present from previous builds
legacy_worker = pkg_dir / "OtlobhaBgNotificationWorker.kt"
if legacy_worker.exists():
    legacy_worker.unlink()

fallback_api_base = os.environ.get("BG_API_BASE_URL", "").strip().rstrip("/") or "https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app"

poll_engine_kt = f"""package {pkg_name}

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object OtlobhaBgPollEngine {{
    private const val TAG = "OtlobhaBgPush"
    const val PREFS_NAME = "FlutterSharedPreferences"
    const val KEY_API_BASE = "flutter.otlobha_bg_api_base_url"
    const val KEY_SHOWN_CSV = "flutter.otlobha_bg_shown_ids_csv"
    const val KEY_ACCESS_TOKEN = "{access_token_key}"
    const val KEY_REFRESH_TOKEN = "{refresh_token_key}"
    const val KEY_SOUND = "{sound_pref_key}"
    const val KEY_VIBRATION = "{vib_pref_key}"
    const val APP_ROLE = "{app_role}"
    const val DEFAULT_CHANNEL = "{default_channel_bg}"
    const val DEFAULT_TITLE = "{default_app_title}"
    const val EXTRA_PAYLOAD = "otlobha_bg_notification_payload"
    const val FALLBACK_API_BASE = "{fallback_api_base}"

    private data class HttpResp(val code: Int, val body: String?)

    fun runPollOnce(context: Context): Boolean {{
        return try {{
            val appCtx = context.applicationContext
            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val rawBase = prefs.getString(KEY_API_BASE, null)?.trim()
            val apiBase = if (!rawBase.isNullOrEmpty() && (rawBase.startsWith("https://") || rawBase.startsWith("http://"))) {{
                rawBase.trimEnd('/')
            }} else {{
                FALLBACK_API_BASE
            }}
            var accessToken = prefs.getString(KEY_ACCESS_TOKEN, null)?.trim() ?: ""
            val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)?.trim() ?: ""

            // 1. Primary endpoint: /api/mobile/notifications/background-poll (supports both logged-in and guest broadcasts)
            val ts = System.currentTimeMillis()
            var resp = httpGet("$apiBase/api/mobile/notifications/background-poll?app=$APP_ROLE&limit=12&_t=$ts", accessToken)
            val needsAuthRefresh = accessToken.isNotEmpty() && refreshToken.isNotEmpty() && (
                resp.code == 401 ||
                (resp.code in 200..299 && (resp.body?.contains("\\"authenticated\\":false") == true || resp.body?.contains("\\"authenticated\\": false") == true))
            )
            if (needsAuthRefresh) {{
                val refreshed = tryRefreshToken(apiBase, refreshToken, prefs)
                if (!refreshed.isNullOrEmpty()) {{
                    accessToken = refreshed
                    resp = httpGet("$apiBase/api/mobile/notifications/background-poll?app=$APP_ROLE&limit=12&_t=${{System.currentTimeMillis()}}", accessToken)
                }}
            }}

            // 2. Fallback endpoint: /api/mobile/notifications?app=... (works even on older backend versions)
            if ((resp.code !in 200..299 || resp.body.isNullOrEmpty()) && accessToken.isNotEmpty()) {{
                resp = httpGet("$apiBase/api/mobile/notifications?app=$APP_ROLE&_t=${{System.currentTimeMillis()}}", accessToken)
                if (resp.code == 401 && refreshToken.isNotEmpty()) {{
                    val refreshed = tryRefreshToken(apiBase, refreshToken, prefs)
                    if (!refreshed.isNullOrEmpty()) {{
                        accessToken = refreshed
                        resp = httpGet("$apiBase/api/mobile/notifications?app=$APP_ROLE&_t=${{System.currentTimeMillis()}}", accessToken)
                    }}
                }}
            }}

            // 3. Guest fallback if authenticated token failed on /background-poll
            if ((resp.code !in 200..299 || resp.body.isNullOrEmpty()) && accessToken.isNotEmpty()) {{
                resp = httpGet("$apiBase/api/mobile/notifications/background-poll?app=$APP_ROLE&limit=12&_t=${{System.currentTimeMillis()}}", "")
            }}

            val bodyText = resp.body
            if (resp.code in 200..299 && !bodyText.isNullOrEmpty()) {{
                processNotifications(appCtx, bodyText, prefs)
                true
            }} else {{
                Log.d(TAG, "Poll returned HTTP ${{resp.code}} for role=$APP_ROLE")
                false
            }}
        }} catch (e: Throwable) {{
            Log.d(TAG, "Poll exception: ${{e.message}}")
            false
        }}
    }}

    private fun httpGet(urlStr: String, accessToken: String): HttpResp {{
        var conn: HttpURLConnection? = null
        return try {{
            val url = URL(urlStr)
            val connection = (url.openConnection() as HttpURLConnection).apply {{
                requestMethod = "GET"
                instanceFollowRedirects = false
                connectTimeout = 8000
                readTimeout = 10000
                useCaches = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-cache")
                if (accessToken.isNotEmpty()) {{
                    setRequestProperty("Authorization", "Bearer $accessToken")
                }}
            }}
            conn = connection
            val code = connection.responseCode
            if (code in 200..299) {{
                val body = BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use {{ it.readText() }}
                HttpResp(code, body)
            }} else {{
                HttpResp(code, null)
            }}
        }} catch (e: Throwable) {{
            HttpResp(0, null)
        }} finally {{
            try {{
                conn?.disconnect()
            }} catch (e: Throwable) {{
            }}
        }}
    }}

    private fun tryRefreshToken(
        apiBase: String,
        refreshToken: String,
        prefs: SharedPreferences
    ): String? {{
        var conn: HttpURLConnection? = null
        return try {{
            val url = URL("$apiBase/api/auth/refresh")
            val connection = (url.openConnection() as HttpURLConnection).apply {{
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 8000
                readTimeout = 10000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
            }}
            conn = connection
            val body = JSONObject().put("refresh_token", refreshToken).toString()
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use {{ it.write(body) }}
            if (connection.responseCode in 200..299) {{
                val text = BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use {{ it.readText() }}
                val json = JSONObject(text)
                val tokens = json.optJSONObject("tokens")
                val nextAccess = tokens?.optString("access_token", "")?.trim() ?: ""
                val nextRefresh = tokens?.optString("refresh_token", "")?.trim() ?: ""
                if (nextAccess.isNotEmpty()) {{
                    val ed = prefs.edit().putString(KEY_ACCESS_TOKEN, nextAccess)
                    if (nextRefresh.isNotEmpty()) {{
                        ed.putString(KEY_REFRESH_TOKEN, nextRefresh)
                    }}
                    ed.commit()
                    nextAccess
                }} else null
            }} else null
        }} catch (e: Throwable) {{
            null
        }} finally {{
            try {{
                conn?.disconnect()
            }} catch (e: Throwable) {{
            }}
        }}
    }}

    private fun processNotifications(appCtx: Context, responseBody: String, prefs: SharedPreferences) {{
        val trimmed = responseBody.trim()
        if (!trimmed.startsWith("[") && !trimmed.startsWith("{{")) return
        val arr: JSONArray = if (trimmed.startsWith("[")) {{
            JSONArray(trimmed)
        }} else {{
            JSONObject(trimmed).optJSONArray("notifications") ?: return
        }}
        if (arr.length() == 0) return

        val existingCsv = prefs.getString(KEY_SHOWN_CSV, "") ?: ""
        val shownOrder = existingCsv.split(",").map {{ it.trim() }}.filter {{ it.isNotEmpty() }}.toMutableList()
        val shownSet = shownOrder.toMutableSet()

        val soundEnabled = prefs.getBoolean(KEY_SOUND, true)
        val vibEnabled = prefs.getBoolean(KEY_VIBRATION, true)

        val pending = mutableListOf<JSONObject>()
        for (i in 0 until arr.length()) {{
            val item = arr.optJSONObject(i) ?: continue
            val isReadBool = item.optBoolean("is_read", false)
            val isReadInt = item.optInt("is_read", 0)
            if (isReadBool || isReadInt == 1) continue
            val id = item.optString("id", "").trim()
            if (id.isNotEmpty() && shownSet.contains(id)) continue
            pending.add(item)
            if (pending.size >= 6) break
        }}

        if (pending.isEmpty()) return

        var changed = false
        for (item in pending.reversed()) {{
            val id = item.optString("id", "").trim()
            val title = item.optString("title_ar", "").trim().ifEmpty {{ DEFAULT_TITLE }}
            val body = item.optString("body_ar", "").trim()
            if (title.isEmpty() && body.isEmpty()) continue

            val deepLink = item.optString("deep_link", "notifications").trim().ifEmpty {{ "notifications" }}
            val category = item.optString("category", "operational").trim()
            val requestedChannel = item.optString("channel_id", "").trim()
            val channelId = if (!soundEnabled && !vibEnabled) {{
                "otlobha_silent_channel"
            }} else if (requestedChannel.isNotEmpty()) {{
                requestedChannel
            }} else {{
                DEFAULT_CHANNEL
            }}

            val payloadJson = JSONObject().apply {{
                put("notification_id", id)
                put("deep_link", deepLink)
                put("category", category)
                put("title_ar", title)
                put("body_ar", body)
                put("channel_id", channelId)
                val email = item.optString("email", "").trim()
                if (email.isNotEmpty()) put("email", email)
                val orderId = item.optString("order_id", "").trim()
                if (orderId.isNotEmpty()) put("order_id", orderId)
                val tripId = item.optString("trip_id", "").trim()
                if (tripId.isNotEmpty()) put("trip_id", tripId)
            }}

            val posted = postSystemNotification(appCtx, id, title, body, channelId, payloadJson.toString(), soundEnabled, vibEnabled)
            if (posted && id.isNotEmpty() && shownSet.add(id)) {{
                shownOrder.add(id)
                changed = true
                while (shownOrder.size > 200) {{
                    val removed = shownOrder.removeAt(0)
                    shownSet.remove(removed)
                }}
            }}
        }}

        if (changed) {{
            prefs.edit().putString(KEY_SHOWN_CSV, shownOrder.joinToString(",")).commit()
        }}
    }}

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun postSystemNotification(
        appCtx: Context,
        notifId: String,
        title: String,
        body: String,
        channelId: String,
        payloadJson: String,
        soundEnabled: Boolean,
        vibEnabled: Boolean
    ): Boolean {{
        return try {{
            if (Build.VERSION.SDK_INT >= 33) {{
                val perm = appCtx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                if (perm != PackageManager.PERMISSION_GRANTED) {{
                    return false
                }}
            }}
            val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                val isSilent = !soundEnabled && !vibEnabled
                val importance = if (isSilent) {{
                    NotificationManager.IMPORTANCE_DEFAULT
                }} else {{
                    NotificationManager.IMPORTANCE_HIGH
                }}
                val channelName = when (channelId) {{
                    "otlobha_dispatch_channel" -> "طلبات جديدة وتنبيهات فورية"
                    "otlobha_chat_channel" -> "رسائل الشات المباشر"
                    "otlobha_admin_channel" -> "تنبيهات الإدارة والحساب"
                    "otlobha_promos_channel" -> "العروض والتخفيضات"
                    "otlobha_silent_channel" -> "إشعارات صامتة"
                    else -> "تحديثات الطلبات والمشاوير"
                }}
                val channel = NotificationChannel(channelId, channelName, importance).apply {{
                    enableLights(true)
                    enableVibration(vibEnabled)
                    if (vibEnabled) {{
                        vibrationPattern = longArrayOf(0L, 320L, 140L, 320L, 140L, 420L)
                    }}
                    if (soundEnabled) {{
                        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                        val attrs = AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                        setSound(soundUri, attrs)
                    }} else {{
                        setSound(null, null)
                    }}
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                }}
                nm.createNotificationChannel(channel)
            }}

            val launchIntent = Intent(appCtx, MainActivity::class.java).apply {{
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_PAYLOAD, payloadJson)
            }}
            val intId = stableIntId(notifId.ifEmpty {{ "${{System.currentTimeMillis()}}" }})
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {{
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            }} else {{
                PendingIntent.FLAG_UPDATE_CURRENT
            }}
            val pendingIntent = PendingIntent.getActivity(appCtx, intId, launchIntent, pendingFlags)

            var defaults = Notification.DEFAULT_LIGHTS
            if (soundEnabled) defaults = defaults or Notification.DEFAULT_SOUND
            if (vibEnabled) defaults = defaults or Notification.DEFAULT_VIBRATE

            val appIcon = appCtx.applicationInfo.icon
            val smallIcon = if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                Notification.Builder(appCtx, channelId)
            }} else {{
                Notification.Builder(appCtx)
            }}
            builder
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .setContentIntent(pendingIntent)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(
                    if (channelId == "otlobha_dispatch_channel") Notification.CATEGORY_ALARM
                    else Notification.CATEGORY_MESSAGE
                )
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {{
                builder.setPriority(Notification.PRIORITY_MAX)
                builder.setDefaults(defaults)
            }}

            nm.notify(intId, builder.build())
            true
        }} catch (e: Throwable) {{
            Log.d(TAG, "postSystemNotification error: ${{e.message}}")
            false
        }}
    }}

    private fun stableIntId(key: String): Int {{
        var hash = 0
        for (ch in key) {{
            hash = ((hash * 31) + ch.code) and 0x7fffffff
        }}
        return if (hash == 0 || hash == 904201 || hash == 942100) 100000 + (hash % 800000) else hash
    }}
}}
"""

push_service_kt = f"""package {pkg_name}

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class OtlobhaBgPushService : Service() {{
    companion object {{
        private const val SERVICE_NOTIF_ID = 942100
        private const val SERVICE_CHANNEL_ID = "otlobha_bg_service_channel"
        @Volatile
        var isRunning = false
    }}

    @Volatile
    private var active = false
    private var pollThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {{
        super.onCreate()
        startForegroundSilently()
        startPollingLoop()
    }}

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {{
        startForegroundSilently()
        startPollingLoop()
        return START_STICKY
    }}

    override fun onTaskRemoved(rootIntent: Intent?) {{
        // Immediately schedule a 3-second self-healing alarm if the user swipes the app away from Recents
        try {{
            OtlobhaBgScheduler.scheduleFastAlarm(applicationContext, 1)
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
        }} catch (e: Throwable) {{
        }}
        super.onTaskRemoved(rootIntent)
    }}

    override fun onDestroy() {{
        active = false
        isRunning = false
        try {{
            pollThread?.interrupt()
        }} catch (e: Throwable) {{
        }}
        try {{
            OtlobhaBgScheduler.scheduleFastAlarm(applicationContext, 1)
        }} catch (e: Throwable) {{
        }}
        super.onDestroy()
    }}

    @SuppressLint("ForegroundServiceType", "NewApi", "MissingPermission")
    @Suppress("DEPRECATION")
    private fun startForegroundSilently() {{
        try {{
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                val channel = NotificationChannel(
                    SERVICE_CHANNEL_ID,
                    "استقبال إشعارات {default_app_title} في الخلفية",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {{
                    setSound(null, null)
                    enableVibration(false)
                    enableLights(false)
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_SECRET
                }}
                nm.createNotificationChannel(channel)
            }}

            val launchIntent = Intent(this, MainActivity::class.java).apply {{
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }}
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {{
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            }} else {{
                PendingIntent.FLAG_UPDATE_CURRENT
            }}
            val pi = PendingIntent.getActivity(this, SERVICE_NOTIF_ID, launchIntent, piFlags)

            val appIcon = applicationInfo.icon
            val smallIcon = if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                Notification.Builder(this, SERVICE_CHANNEL_ID)
            }} else {{
                Notification.Builder(this)
            }}
            val notif = builder
                .setSmallIcon(smallIcon)
                .setContentTitle("{default_app_title}")
                .setContentText("متصل لاستقبال الإشعارات الفورية")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .setVisibility(Notification.VISIBILITY_SECRET)
                .build()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {{
                startForeground(SERVICE_NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            }} else {{
                startForeground(SERVICE_NOTIF_ID, notif)
            }}
        }} catch (e: Throwable) {{
            // If Android 12+ blocks foreground start from background, stop safely and rely on AlarmReceiver/JobService
            try {{
                stopSelf()
            }} catch (ignored: Throwable) {{
            }}
        }}
    }}

    private fun startPollingLoop() {{
        if (active && pollThread?.isAlive == true) return
        active = true
        isRunning = true
        val appCtx = applicationContext
        val t = Thread {{
            var consecutiveFailures = 0
            while (active) {{
                try {{
                    val ok = OtlobhaBgPollEngine.runPollOnce(appCtx)
                    consecutiveFailures = if (ok) 0 else (consecutiveFailures + 1).coerceAtMost(6)
                }} catch (e: Throwable) {{
                    consecutiveFailures = (consecutiveFailures + 1).coerceAtMost(6)
                }}
                val sleepMs = when {{
                    consecutiveFailures == 0 -> 5500L
                    consecutiveFailures <= 2 -> 10000L
                    else -> 20000L
                }}
                try {{
                    Thread.sleep(sleepMs)
                }} catch (e: InterruptedException) {{
                    if (!active) break
                }}
            }}
            isRunning = false
        }}
        t.isDaemon = true
        pollThread = t
        t.start()
    }}
}}
"""

alarm_receiver_kt = f"""package {pkg_name}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager

class OtlobhaBgAlarmReceiver : BroadcastReceiver() {{
    override fun onReceive(context: Context, intent: Intent?) {{
        val pendingResult = goAsync()
        val appCtx = context.applicationContext
        val step = intent?.getIntExtra("step", 1) ?: 1
        val wakeLock = try {{
            val pm = appCtx.getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "otlobha:bg_push_poll")?.apply {{
                setReferenceCounted(false)
                acquire(20000L)
            }}
        }} catch (e: Throwable) {{
            null
        }}
        val worker = Thread {{
            try {{
                OtlobhaBgPollEngine.runPollOnce(appCtx)
                if (!OtlobhaBgPushService.isRunning) {{
                    OtlobhaBgScheduler.tryStartKeepAliveService(appCtx)
                }}
                val nextStep = if (step < 15) step + 1 else 15
                OtlobhaBgScheduler.scheduleFastAlarm(appCtx, nextStep)
            }} catch (e: Throwable) {{
                // Never crash background receiver
            }} finally {{
                try {{
                    if (wakeLock != null && wakeLock.isHeld) {{
                        wakeLock.release()
                    }}
                }} catch (e: Throwable) {{
                }}
                try {{
                    pendingResult.finish()
                }} catch (e: Throwable) {{
                }}
            }}
        }}
        worker.isDaemon = true
        worker.start()
    }}
}}
"""

job_service_kt = f"""package {pkg_name}

import android.app.job.JobParameters
import android.app.job.JobService

class OtlobhaBgJobService : JobService() {{

    @Volatile
    private var cancelled = false

    override fun onStartJob(params: JobParameters?): Boolean {{
        cancelled = false
        val jobParams = params ?: return false
        val appCtx = applicationContext
        val workerThread = Thread {{
            try {{
                if (!cancelled) {{
                    OtlobhaBgPollEngine.runPollOnce(appCtx)
                    if (!OtlobhaBgPushService.isRunning) {{
                        OtlobhaBgScheduler.tryStartKeepAliveService(appCtx)
                    }}
                    // Self-heal: revive continuous alarm chain if OEM cleared alarms
                    OtlobhaBgScheduler.scheduleFastAlarm(appCtx, 2)
                }}
            }} catch (e: Throwable) {{
                // Never crash background process
            }} finally {{
                try {{
                    jobFinished(jobParams, false)
                }} catch (e: Throwable) {{
                }}
            }}
        }}
        workerThread.isDaemon = true
        workerThread.start()
        return true
    }}

    override fun onStopJob(params: JobParameters?): Boolean {{
        cancelled = true
        return false
    }}
}}
"""

scheduler_kt = f"""package {pkg_name}

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

object OtlobhaBgScheduler {{
    private const val PERIODIC_JOB_ID = 942101
    private const val FAST_ALARM_REQ_CODE = 942109

    fun tryStartKeepAliveService(context: Context) {{
        try {{
            val appCtx = context.applicationContext
            val svcIntent = Intent(appCtx, OtlobhaBgPushService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                appCtx.startForegroundService(svcIntent)
            }} else {{
                appCtx.startService(svcIntent)
            }}
        }} catch (e: Throwable) {{
            // Android 12+ may restrict background FGS start when process was cold; AlarmReceiver & JobService still poll
        }}
    }}

    fun ensureScheduled(context: Context, fastCheck: Boolean = false) {{
        try {{
            val appCtx = context.applicationContext
            val scheduler = appCtx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler
            if (scheduler != null) {{
                val component = ComponentName(appCtx, OtlobhaBgJobService::class.java)
                val pendingJobs = scheduler.allPendingJobs ?: emptyList()
                val alreadyScheduled = pendingJobs.any {{ it.id == PERIODIC_JOB_ID }}
                if (!alreadyScheduled) {{
                    val periodic = JobInfo.Builder(PERIODIC_JOB_ID, component)
                        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                        .setPeriodic(15L * 60L * 1000L)
                        .setPersisted(true)
                        .build()
                    scheduler.schedule(periodic)
                }}
            }}

            if (fastCheck) {{
                scheduleFastAlarm(appCtx, 1)
            }}
        }} catch (e: Throwable) {{
            // Never crash app on OEM scheduler limits
        }}
    }}

    @SuppressLint("ScheduleExactAlarm", "MissingPermission")
    fun scheduleFastAlarm(context: Context, step: Int) {{
        try {{
            val appCtx = context.applicationContext
            val alarmManager = appCtx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val delayMs = when {{
                step <= 1 -> 5L * 1000L
                step == 2 -> 12L * 1000L
                step == 3 -> 20L * 1000L
                step <= 6 -> 30L * 1000L
                step <= 10 -> 45L * 1000L
                else -> 60L * 1000L
            }}
            val intent = Intent(appCtx, OtlobhaBgAlarmReceiver::class.java).apply {{
                putExtra("step", step)
            }}
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {{
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            }} else {{
                PendingIntent.FLAG_UPDATE_CURRENT
            }}
            val pi = PendingIntent.getBroadcast(appCtx, FAST_ALARM_REQ_CODE, intent, flags)
            val triggerAt = SystemClock.elapsedRealtime() + delayMs
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {{
                if (alarmManager.canScheduleExactAlarms()) {{
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                }} else {{
                    alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                }}
            }} else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {{
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            }} else {{
                alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            }}
        }} catch (e: Throwable) {{
            // Never crash app on OEM alarm limits
        }}
    }}
}}
"""

boot_receiver_kt = f"""package {pkg_name}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class OtlobhaBootReceiver : BroadcastReceiver() {{
    override fun onReceive(context: Context, intent: Intent?) {{
        try {{
            val action = intent?.action ?: return
            if (action == Intent.ACTION_BOOT_COMPLETED ||
                action == Intent.ACTION_MY_PACKAGE_REPLACED ||
                action == "android.intent.action.QUICKBOOT_POWERON"
            ) {{
                val appCtx = context.applicationContext
                OtlobhaBgScheduler.ensureScheduled(appCtx, fastCheck = true)
                OtlobhaBgScheduler.tryStartKeepAliveService(appCtx)
            }}
        }} catch (e: Throwable) {{
        }}
    }}
}}
"""

main_activity_kt = f"""package {pkg_name}

import android.content.Context
import android.content.Intent
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {{
    private val bgChannelName = "com.otlobha/background_push"
    private var bgChannel: MethodChannel? = null
    private var pendingBgPayload: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {{
        super.onCreate(savedInstanceState)
        try {{
            capturePayloadFromIntent(intent, notifyFlutter = false)
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
            OtlobhaBgScheduler.tryStartKeepAliveService(applicationContext)
        }} catch (e: Throwable) {{
        }}
    }}

    override fun onResume() {{
        super.onResume()
        try {{
            OtlobhaBgScheduler.tryStartKeepAliveService(applicationContext)
        }} catch (e: Throwable) {{
        }}
    }}

    override fun onNewIntent(intent: Intent) {{
        super.onNewIntent(intent)
        try {{
            setIntent(intent)
            capturePayloadFromIntent(intent, notifyFlutter = true)
        }} catch (e: Throwable) {{
        }}
    }}

    override fun onPause() {{
        super.onPause()
        try {{
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
            OtlobhaBgScheduler.tryStartKeepAliveService(applicationContext)
        }} catch (e: Throwable) {{
        }}
    }}

    override fun onStop() {{
        super.onStop()
        try {{
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
        }} catch (e: Throwable) {{
        }}
    }}

    override fun onDestroy() {{
        try {{
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
        }} catch (e: Throwable) {{
        }}
        super.onDestroy()
    }}

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {{
        super.configureFlutterEngine(flutterEngine)
        try {{
            bgChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, bgChannelName)
            bgChannel?.setMethodCallHandler {{ call, result ->
                try {{
                    when (call.method) {{
                        "consumeInitialNotification" -> {{
                            val payload = pendingBgPayload
                            pendingBgPayload = null
                            result.success(payload)
                        }}
                        "scheduleBackgroundSync" -> {{
                            val apiBase = call.argument<String>("api_base_url")?.trim()
                            if (!apiBase.isNullOrEmpty()) {{
                                val prefs = applicationContext.getSharedPreferences(
                                    OtlobhaBgPollEngine.PREFS_NAME,
                                    Context.MODE_PRIVATE
                                )
                                prefs.edit().putString(OtlobhaBgPollEngine.KEY_API_BASE, apiBase).commit()
                            }}
                            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
                            OtlobhaBgScheduler.tryStartKeepAliveService(applicationContext)
                            result.success(true)
                        }}
                        else -> result.notImplemented()
                    }}
                }} catch (e: Throwable) {{
                    result.success(null)
                }}
            }}
        }} catch (e: Throwable) {{
        }}
    }}

    private fun capturePayloadFromIntent(intent: Intent?, notifyFlutter: Boolean) {{
        try {{
            val safeIntent = intent ?: return
            val payload = safeIntent.getStringExtra(OtlobhaBgPollEngine.EXTRA_PAYLOAD)
            if (!payload.isNullOrEmpty()) {{
                safeIntent.removeExtra(OtlobhaBgPollEngine.EXTRA_PAYLOAD)
                if (notifyFlutter && bgChannel != null) {{
                    bgChannel?.invokeMethod("onBackgroundNotificationTap", payload)
                }} else {{
                    pendingBgPayload = payload
                }}
            }}
        }} catch (e: Throwable) {{
        }}
    }}
}}
"""

(pkg_dir / "OtlobhaBgPollEngine.kt").write_text(poll_engine_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBgPushService.kt").write_text(push_service_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBgAlarmReceiver.kt").write_text(alarm_receiver_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBgJobService.kt").write_text(job_service_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBgScheduler.kt").write_text(scheduler_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBootReceiver.kt").write_text(boot_receiver_kt, encoding="utf-8")
main_kt_path.write_text(main_activity_kt, encoding="utf-8")
print(f"[FCM Android Setup] Generated Triple-Layer ForegroundService + Exact-Alarm + JobScheduler Background Notification Engine in {pkg_dir} ({pkg_name}) targeting {fallback_api_base}.")
PYEOF
