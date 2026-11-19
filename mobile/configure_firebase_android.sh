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
PYEOF
