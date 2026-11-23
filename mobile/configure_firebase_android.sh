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

export GS_TARGET SECRET_NAME REQUIRE_GS EXPECTED_PKG

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
    default_channel = "otlobha_dispatch_channel" if is_captain_app else "otlobha_orders_channel"

    required_permissions = [
        "android.permission.INTERNET",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE",
        "android.permission.WAKE_LOCK",
        "android.permission.RECEIVE_BOOT_COMPLETED",
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

    if "OtlobhaBgJobService" not in m_text and "</application>" in m_text:
        bg_components_xml = (
            '        <service\n'
            '            android:name=".OtlobhaBgJobService"\n'
            '            android:permission="android.permission.BIND_JOB_SERVICE"\n'
            '            android:exported="false" />\n'
            '        <receiver\n'
            '            android:name=".OtlobhaBootReceiver"\n'
            '            android:enabled="true"\n'
            '            android:exported="false">\n'
            '            <intent-filter>\n'
            '                <action android:name="android.intent.action.BOOT_COMPLETED" />\n'
            '                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />\n'
            '            </intent-filter>\n'
            '        </receiver>\n'
            '    </application>'
        )
        m_text = m_text.replace("</application>", bg_components_xml, 1)

    manifest_path.write_text(m_text, encoding="utf-8")
    print(f"[FCM Android Setup] Patched AndroidManifest.xml with POST_NOTIFICATIONS, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, JobService, BootReceiver, channel '{default_channel}', and FLUTTER_NOTIFICATION_CLICK.")

# --- 4. Generate Zero-Dependency Native Android Background Notification Engine (OS JobScheduler + BootReceiver + MainActivity Bridge) ---
expected_pkg_raw = os.environ.get("EXPECTED_PKG", "").strip()
cwd_name_lower = Path.cwd().name.lower()
is_captain = "captain" in expected_pkg_raw.lower() or "captain" in cwd_name_lower
app_role = "captain" if is_captain else "customer"
default_channel_bg = "otlobha_dispatch_channel" if is_captain else "otlobha_admin_channel"
access_token_key = "flutter.otlobha_cap_access_token" if is_captain else "flutter.otlobha_cust_access_token"
refresh_token_key = "flutter.otlobha_cap_refresh_token" if is_captain else "flutter.otlobha_cust_refresh_token"
sound_pref_key = "flutter.otlobha_captain_push_sound_v1" if is_captain else "flutter.otlobha_customer_push_sound_v1"
vib_pref_key = "flutter.otlobha_captain_push_vibration_v1" if is_captain else "flutter.otlobha_customer_push_vibration_v1"
default_app_title = "اطلبها كابتن" if is_captain else "اطلبها"

kotlin_root = Path("android/app/src/main/kotlin")
existing_mains = list(kotlin_root.rglob("MainActivity.kt")) if kotlin_root.exists() else []
if existing_mains:
    main_kt_path = existing_mains[0]
    m_kt_text = main_kt_path.read_text(encoding="utf-8")
    pkg_match = re.search(r"^\s*package\s+([A-Za-z0-9_.]+)", m_kt_text, flags=re.MULTILINE)
    pkg_name = pkg_match.group(1) if pkg_match else (expected_pkg_raw or ("com.otlobha.otlobha_captain" if is_captain else "com.otlobha.otlobha_customer"))
    pkg_dir = main_kt_path.parent
else:
    pkg_name = expected_pkg_raw or ("com.otlobha.otlobha_captain" if is_captain else "com.otlobha.otlobha_customer")
    pkg_dir = kotlin_root / Path(*pkg_name.split("."))
    pkg_dir.mkdir(parents=True, exist_ok=True)
    main_kt_path = pkg_dir / "MainActivity.kt"

# Remove any legacy WorkManager worker file if present from previous builds
legacy_worker = pkg_dir / "OtlobhaBgNotificationWorker.kt"
if legacy_worker.exists():
    legacy_worker.unlink()

job_service_kt = f"""package {pkg_name}

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class OtlobhaBgJobService : JobService() {{

    companion object {{
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
        const val FALLBACK_API_BASE = "https://ais-dev-xcfo2sxsvz6eimo6tdzhrg-565346403151.europe-west2.run.app"
    }}

    @Volatile
    private var cancelled = false

    override fun onStartJob(params: JobParameters?): Boolean {{
        cancelled = false
        val jobParams = params ?: return false
        val workerThread = Thread {{
            try {{
                if (!cancelled) {{
                    runPollOnce()
                }}
                val step = jobParams.extras.getInt("step", 0)
                if (!cancelled && step in 1..8) {{
                    OtlobhaBgScheduler.scheduleNextFastCheck(applicationContext, step + 1)
                }}
            }} catch (_: Throwable) {{
                // Never crash background process
            }} finally {{
                try {{
                    jobFinished(jobParams, false)
                }} catch (_: Throwable) {{
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

    private fun runPollOnce() {{
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val rawBase = prefs.getString(KEY_API_BASE, null)?.trim()
        val apiBase = if (!rawBase.isNullOrEmpty()) rawBase.trimEnd('/') else FALLBACK_API_BASE
        var accessToken = prefs.getString(KEY_ACCESS_TOKEN, null)?.trim() ?: ""
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)?.trim() ?: ""

        var responseBody = fetchPoll(apiBase, accessToken)
        if (responseBody == null && refreshToken.isNotEmpty()) {{
            val refreshed = tryRefreshToken(apiBase, refreshToken, prefs)
            if (!refreshed.isNullOrEmpty()) {{
                accessToken = refreshed
                responseBody = fetchPoll(apiBase, accessToken)
            }}
        }}
        if (responseBody == null && accessToken.isNotEmpty()) {{
            responseBody = fetchPoll(apiBase, "")
        }}
        if (!responseBody.isNullOrEmpty()) {{
            processNotifications(responseBody, prefs)
        }}
    }}

    private fun fetchPoll(apiBase: String, accessToken: String): String? {{
        var conn: HttpURLConnection? = null
        return try {{
            val url = URL("$apiBase/api/mobile/notifications/background-poll?app=$APP_ROLE&limit=10")
            conn = (url.openConnection() as HttpURLConnection).apply {{
                requestMethod = "GET"
                connectTimeout = 10000
                readTimeout = 12000
                setRequestProperty("Accept", "application/json")
                if (accessToken.isNotEmpty()) {{
                    setRequestProperty("Authorization", "Bearer $accessToken")
                }}
            }}
            if (conn.responseCode in 200..299) {{
                BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use {{ it.readText() }}
            }} else {{
                null
            }}
        }} catch (_: Throwable) {{
            null
        }} finally {{
            try {{
                conn?.disconnect()
            }} catch (_: Throwable) {{
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
            conn = (url.openConnection() as HttpURLConnection).apply {{
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 10000
                readTimeout = 12000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
            }}
            val body = JSONObject().put("refresh_token", refreshToken).toString()
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {{ it.write(body) }}
            if (conn.responseCode in 200..299) {{
                val text = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use {{ it.readText() }}
                val json = JSONObject(text)
                val tokens = json.optJSONObject("tokens")
                val nextAccess = tokens?.optString("access_token")?.trim() ?: ""
                val nextRefresh = tokens?.optString("refresh_token")?.trim() ?: ""
                if (nextAccess.isNotEmpty()) {{
                    val ed = prefs.edit().putString(KEY_ACCESS_TOKEN, nextAccess)
                    if (nextRefresh.isNotEmpty()) {{
                        ed.putString(KEY_REFRESH_TOKEN, nextRefresh)
                    }}
                    ed.apply()
                    nextAccess
                }} else null
            }} else null
        }} catch (_: Throwable) {{
            null
        }} finally {{
            try {{
                conn?.disconnect()
            }} catch (_: Throwable) {{
            }}
        }}
    }}

    private fun processNotifications(responseBody: String, prefs: SharedPreferences) {{
        val root = JSONObject(responseBody)
        val arr = root.optJSONArray("notifications") ?: return
        if (arr.length() == 0) return

        val existingCsv = prefs.getString(KEY_SHOWN_CSV, "") ?: ""
        val shownOrder = existingCsv.split(",").map {{ it.trim() }}.filter {{ it.isNotEmpty() }}.toMutableList()
        val shownSet = shownOrder.toMutableSet()

        val soundEnabled = prefs.getBoolean(KEY_SOUND, true)
        val vibEnabled = prefs.getBoolean(KEY_VIBRATION, true)

        val pending = mutableListOf<JSONObject>()
        for (i in 0 until arr.length()) {{
            val item = arr.optJSONObject(i) ?: continue
            val id = item.optString("id", "").trim()
            if (id.isNotEmpty() && shownSet.contains(id)) continue
            pending.add(item)
            if (pending.size >= 6) break
        }}

        if (pending.isEmpty()) return

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
            }}

            val posted = postSystemNotification(id, title, body, channelId, payloadJson.toString(), soundEnabled, vibEnabled)
            if (posted && id.isNotEmpty() && shownSet.add(id)) {{
                shownOrder.add(id)
                while (shownOrder.size > 150) {{
                    val removed = shownOrder.removeAt(0)
                    shownSet.remove(removed)
                }}
            }}
        }}

        prefs.edit().putString(KEY_SHOWN_CSV, shownOrder.joinToString(",")).apply()
    }}

    @Suppress("DEPRECATION")
    private fun postSystemNotification(
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
                val perm = applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                if (perm != PackageManager.PERMISSION_GRANTED) {{
                    return false
                }}
            }}
            val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                val importance = if (!soundEnabled && !vibEnabled) {{
                    NotificationManager.IMPORTANCE_DEFAULT
                }} else {{
                    NotificationManager.IMPORTANCE_HIGH
                }}
                val channelName = when (channelId) {{
                    "otlobha_dispatch_channel" -> "طلبات جديدة وإسناد الكباتن"
                    "otlobha_chat_channel" -> "رسائل الشات المباشر"
                    "otlobha_admin_channel" -> "تنبيهات الإدارة والحساب"
                    "otlobha_promos_channel" -> "العروض والتخفيضات"
                    "otlobha_silent_channel" -> "إشعارات صامتة"
                    else -> "تحديثات الطلبات والمشاوير"
                }}
                val channel = NotificationChannel(channelId, channelName, importance).apply {{
                    enableVibration(vibEnabled)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }}
                nm.createNotificationChannel(channel)
            }}

            val launchIntent = Intent(applicationContext, MainActivity::class.java).apply {{
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_PAYLOAD, payloadJson)
            }}
            val intId = stableIntId(notifId.ifEmpty {{ "${{System.currentTimeMillis()}}" }})
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {{
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            }} else {{
                PendingIntent.FLAG_UPDATE_CURRENT
            }}
            val pendingIntent = PendingIntent.getActivity(applicationContext, intId, launchIntent, pendingFlags)

            var defaults = Notification.DEFAULT_LIGHTS
            if (soundEnabled) defaults = defaults or Notification.DEFAULT_SOUND
            if (vibEnabled) defaults = defaults or Notification.DEFAULT_VIBRATE

            val appIcon = applicationContext.applicationInfo.icon
            val smallIcon = if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
                Notification.Builder(applicationContext, channelId)
            }} else {{
                Notification.Builder(applicationContext)
            }}
            builder
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {{
                builder.setPriority(Notification.PRIORITY_MAX)
                builder.setDefaults(defaults)
            }}

            nm.notify(intId, builder.build())
            true
        }} catch (_: Throwable) {{
            false
        }}
    }}

    private fun stableIntId(key: String): Int {{
        var hash = 0
        for (ch in key) {{
            hash = ((hash * 31) + ch.code) and 0x7fffffff
        }}
        return if (hash == 0 || hash == 904201) 100000 + (hash % 800000) else hash
    }}
}}
"""

scheduler_kt = f"""package {pkg_name}

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle

object OtlobhaBgScheduler {{
    private const val PERIODIC_JOB_ID = 942101
    private const val FAST_JOB_ID = 942102

    fun ensureScheduled(context: Context, fastCheck: Boolean = false) {{
        try {{
            val appCtx = context.applicationContext
            val scheduler = appCtx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return
            val component = ComponentName(appCtx, OtlobhaBgJobService::class.java)

            val alreadyScheduled = scheduler.allPendingJobs?.any {{ it.id == PERIODIC_JOB_ID }} == true
            if (!alreadyScheduled) {{
                val periodic = JobInfo.Builder(PERIODIC_JOB_ID, component)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(15L * 60L * 1000L)
                    .setPersisted(true)
                    .build()
                scheduler.schedule(periodic)
            }}

            if (fastCheck) {{
                val extras = PersistableBundle().apply {{
                    putInt("step", 1)
                }}
                val fastJob = JobInfo.Builder(FAST_JOB_ID, component)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(45L * 1000L)
                    .setOverrideDeadline(90L * 1000L)
                    .setExtras(extras)
                    .build()
                scheduler.schedule(fastJob)
            }}
        }} catch (_: Throwable) {{
            // Never crash app on OEM job scheduler limits
        }}
    }}

    fun scheduleNextFastCheck(context: Context, nextStep: Int) {{
        try {{
            val appCtx = context.applicationContext
            val scheduler = appCtx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler ?: return
            val component = ComponentName(appCtx, OtlobhaBgJobService::class.java)
            val extras = PersistableBundle().apply {{
                putInt("step", nextStep)
            }}
            val job = JobInfo.Builder(FAST_JOB_ID, component)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(75L * 1000L)
                .setOverrideDeadline(150L * 1000L)
                .setExtras(extras)
                .build()
            scheduler.schedule(job)
        }} catch (_: Throwable) {{
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
            if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {{
                OtlobhaBgScheduler.ensureScheduled(context.applicationContext, fastCheck = false)
            }}
        }} catch (_: Throwable) {{
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
        }} catch (_: Throwable) {{
        }}
    }}

    override fun onNewIntent(intent: Intent) {{
        super.onNewIntent(intent)
        try {{
            setIntent(intent)
            capturePayloadFromIntent(intent, notifyFlutter = true)
        }} catch (_: Throwable) {{
        }}
    }}

    override fun onStop() {{
        super.onStop()
        try {{
            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = true)
        }} catch (_: Throwable) {{
        }}
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
                            val fastCheck = call.argument<Boolean>("fast_check") ?: false
                            val apiBase = call.argument<String>("api_base_url")?.trim()
                            if (!apiBase.isNullOrEmpty()) {{
                                val prefs = applicationContext.getSharedPreferences(
                                    OtlobhaBgJobService.PREFS_NAME,
                                    Context.MODE_PRIVATE
                                )
                                prefs.edit().putString(OtlobhaBgJobService.KEY_API_BASE, apiBase).apply()
                            }}
                            OtlobhaBgScheduler.ensureScheduled(applicationContext, fastCheck = fastCheck)
                            result.success(true)
                        }}
                        else -> result.notImplemented()
                    }}
                }} catch (_: Throwable) {{
                    result.success(null)
                }}
            }}
        }} catch (_: Throwable) {{
        }}
    }}

    private fun capturePayloadFromIntent(intent: Intent?, notifyFlutter: Boolean) {{
        try {{
            val payload = intent?.getStringExtra(OtlobhaBgJobService.EXTRA_PAYLOAD)
            if (!payload.isNullOrEmpty()) {{
                intent.removeExtra(OtlobhaBgJobService.EXTRA_PAYLOAD)
                if (notifyFlutter && bgChannel != null) {{
                    bgChannel?.invokeMethod("onBackgroundNotificationTap", payload)
                }} else {{
                    pendingBgPayload = payload
                }}
            }}
        }} catch (_: Throwable) {{
        }}
    }}
}}
"""

(pkg_dir / "OtlobhaBgJobService.kt").write_text(job_service_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBgScheduler.kt").write_text(scheduler_kt, encoding="utf-8")
(pkg_dir / "OtlobhaBootReceiver.kt").write_text(boot_receiver_kt, encoding="utf-8")
main_kt_path.write_text(main_activity_kt, encoding="utf-8")
print(f"[FCM Android Setup] Generated Zero-Dependency OS JobScheduler Notification Engine & MainActivity bridge in {pkg_dir} ({pkg_name}).")
PYEOF
