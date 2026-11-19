#!/usr/bin/env bash
set -euo pipefail

# Configures persistent Android Release signing for Otlobha Customer APK ONLY.
# Uses the user's original keystore supplied via GitHub Secrets / environment variables.
# Never generates a new keystore, never falls back to debug signing, and never prints secrets.
#
# Required environment variables:
#   CUSTOMER_KEYSTORE_BASE64 : Base64-encoded original .jks/.keystore file
#   CUSTOMER_STORE_PASSWORD  : Keystore password (storePassword)
#   CUSTOMER_KEY_ALIAS       : Signing key alias (keyAlias)
#   CUSTOMER_KEY_PASSWORD    : Signing key password (keyPassword)
# Optional:
#   EXPECTED_ANDROID_PACKAGE : Defaults to com.otlobha.otlobha_customer
#   KEYSTORE_OUTPUT_PATH     : Defaults to ${RUNNER_TEMP:-/tmp}/otlobha-customer-release.jks

APP_DIR="${1:-.}"
cd "$APP_DIR"

EXPECTED_PKG="${EXPECTED_ANDROID_PACKAGE:-com.otlobha.otlobha_customer}"
KEYSTORE_PATH="${KEYSTORE_OUTPUT_PATH:-${RUNNER_TEMP:-/tmp}/otlobha-customer-release.jks}"

export EXPECTED_PKG KEYSTORE_PATH

python3 - <<'PYEOF'
import base64
import binascii
import os
import re
import stat
import sys
from pathlib import Path

raw_b64 = os.environ.get("CUSTOMER_KEYSTORE_BASE64") or os.environ.get("CUSTOMER_KEYSTORE_B64") or ""
store_password = os.environ.get("CUSTOMER_STORE_PASSWORD", "")
key_alias = os.environ.get("CUSTOMER_KEY_ALIAS", "").strip()
key_password = os.environ.get("CUSTOMER_KEY_PASSWORD", "")

missing = []
if not raw_b64.strip():
    missing.append("CUSTOMER_KEYSTORE_BASE64")
if not store_password.strip():
    missing.append("CUSTOMER_STORE_PASSWORD")
if not key_alias:
    missing.append("CUSTOMER_KEY_ALIAS")
if not key_password.strip():
    missing.append("CUSTOMER_KEY_PASSWORD")

if missing:
    print(
        f"::error::Missing required Customer release signing secrets: {', '.join(missing)}. "
        f"Refusing to fall back to debug keystore or generate a replacement keystore.",
        file=sys.stderr,
    )
    sys.exit(1)

compact_b64 = "".join(raw_b64.split())
try:
    keystore_bytes = base64.b64decode(compact_b64, validate=True)
except (binascii.Error, ValueError):
    print(
        "::error::Secret CUSTOMER_KEYSTORE_BASE64 is not valid Base64. "
        "Re-encode your original release keystore file as Base64 and update the secret.",
        file=sys.stderr,
    )
    sys.exit(1)

if len(keystore_bytes) < 64:
    print(
        "::error::Decoded CUSTOMER_KEYSTORE_BASE64 is unexpectedly small/empty. "
        "Verify your original keystore file.",
        file=sys.stderr,
    )
    sys.exit(1)

ks_path = Path(os.environ["KEYSTORE_PATH"]).resolve()
ks_path.parent.mkdir(parents=True, exist_ok=True)
ks_path.write_bytes(keystore_bytes)
try:
    os.chmod(ks_path, stat.S_IRUSR | stat.S_IWUSR)
except OSError:
    pass


def escape_java_properties_value(val: str) -> str:
    """Escape special characters for java.util.Properties.load()."""
    out = []
    for idx, ch in enumerate(val):
        if ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ch in ("=", ":", "#", "!"):
            out.append("\\" + ch)
        elif idx == 0 and ch == " ":
            out.append("\\ ")
        else:
            out.append(ch)
    return "".join(out)


expected_pkg = os.environ["EXPECTED_PKG"].strip()

key_props_path = Path("android/key.properties")
key_props_path.parent.mkdir(parents=True, exist_ok=True)
props_lines = [
    f"storeFile={escape_java_properties_value(str(ks_path))}",
    f"storePassword={escape_java_properties_value(store_password)}",
    f"keyAlias={escape_java_properties_value(key_alias)}",
    f"keyPassword={escape_java_properties_value(key_password)}",
    "",
]
key_props_path.write_text("\n".join(props_lines), encoding="utf-8")
try:
    os.chmod(key_props_path, stat.S_IRUSR | stat.S_IWUSR)
except OSError:
    pass

print("[Customer Signing] Decoded original keystore and wrote android/key.properties (secrets hidden).")

app_kts = Path("android/app/build.gradle.kts")
app_groovy = Path("android/app/build.gradle")

if app_kts.exists():
    text = app_kts.read_text(encoding="utf-8")

    if expected_pkg and expected_pkg not in text:
        print(
            f"::error::Expected applicationId '{expected_pkg}' not found in {app_kts}.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Fix Kotlin DSL "Unresolved reference 'util'" caused by unqualified java.util.Properties()
    # colliding with Gradle's JavaPluginExtension `java` accessor: always import at top of file.
    text = text.replace("java.util.Properties()", "Properties()")
    text = text.replace("java.io.FileInputStream(", "FileInputStream(")

    required_imports = [
        "import java.io.FileInputStream",
        "import java.util.Properties",
    ]
    missing_imports = [imp for imp in required_imports if imp not in text]
    if missing_imports:
        text = "\n".join(missing_imports) + "\n\n" + text.lstrip("\n")

    if "val keystoreProperties = Properties()" not in text:
        loader_block = (
            'val keystoreProperties = Properties()\n'
            'val keystorePropertiesFile = rootProject.file("key.properties")\n'
            'if (keystorePropertiesFile.exists()) {\n'
            '    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }\n'
            '}\n\n'
        )
        new_text, count = re.subn(
            r"(^android\s*\{)",
            loader_block + r"\1",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            print(f"::error::Could not locate 'android {{' block in {app_kts}.", file=sys.stderr)
            sys.exit(1)
        text = new_text

    if 'create("release")' not in text:
        signing_block = (
            '    signingConfigs {\n'
            '        create("release") {\n'
            '            val releaseStorePath = (\n'
            '                keystoreProperties.getProperty("storeFile")\n'
            '                    ?: System.getenv("CUSTOMER_KEYSTORE_PATH")\n'
            '                    ?: ""\n'
            '            ).trim()\n'
            '            val releaseStorePass =\n'
            '                keystoreProperties.getProperty("storePassword")\n'
            '                    ?: System.getenv("CUSTOMER_STORE_PASSWORD")\n'
            '                    ?: ""\n'
            '            val releaseAlias = (\n'
            '                keystoreProperties.getProperty("keyAlias")\n'
            '                    ?: System.getenv("CUSTOMER_KEY_ALIAS")\n'
            '                    ?: ""\n'
            '            ).trim()\n'
            '            val releaseKeyPass =\n'
            '                keystoreProperties.getProperty("keyPassword")\n'
            '                    ?: System.getenv("CUSTOMER_KEY_PASSWORD")\n'
            '                    ?: ""\n'
            '            if (releaseStorePath.isEmpty() || releaseStorePass.isEmpty() || releaseAlias.isEmpty() || releaseKeyPass.isEmpty()) {\n'
            '                error("Missing Android release signing configuration (storeFile/storePassword/keyAlias/keyPassword).")\n'
            '            }\n'
            '            val resolvedStoreFile = file(releaseStorePath)\n'
            '            if (!resolvedStoreFile.exists()) {\n'
            '                error("Android release keystore file does not exist at configured storeFile path.")\n'
            '            }\n'
            '            storeFile = resolvedStoreFile\n'
            '            storePassword = releaseStorePass\n'
            '            keyAlias = releaseAlias\n'
            '            keyPassword = releaseKeyPass\n'
            '        }\n'
            '    }\n\n'
        )
        new_text, count = re.subn(
            r"(^[ \t]*buildTypes\s*\{)",
            signing_block + r"\1",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            print(f"::error::Could not locate 'buildTypes {{' block in {app_kts}.", file=sys.stderr)
            sys.exit(1)
        text = new_text

    # Switch release buildType from debug signingConfig to release signingConfig
    text, rep_count = re.subn(
        r'signingConfig\s*=\s*signingConfigs\.getByName\(\s*"debug"\s*\)',
        'signingConfig = signingConfigs.getByName("release")',
        text,
    )
    if rep_count == 0 and 'signingConfigs.getByName("release")' not in text:
        print(
            f"::error::Failed to configure release buildType to use signingConfigs.getByName(\"release\") in {app_kts}.",
            file=sys.stderr,
        )
        sys.exit(1)

    if 'signingConfigs.getByName("debug")' in text:
        print(
            f"::error::Debug signingConfig reference still remains in {app_kts}; refusing to continue.",
            file=sys.stderr,
        )
        sys.exit(1)

    app_kts.write_text(text, encoding="utf-8")
    print(f"[Customer Signing] Configured Kotlin DSL release signing in {app_kts} (with explicit java.util.Properties import).")

elif app_groovy.exists():
    text = app_groovy.read_text(encoding="utf-8")

    if expected_pkg and expected_pkg not in text:
        print(
            f"::error::Expected applicationId '{expected_pkg}' not found in {app_groovy}.",
            file=sys.stderr,
        )
        sys.exit(1)

    if "def keystoreProperties = new Properties()" not in text:
        loader_block = (
            "def keystoreProperties = new Properties()\n"
            "def keystorePropertiesFile = rootProject.file('key.properties')\n"
            "if (keystorePropertiesFile.exists()) {\n"
            "    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }\n"
            "}\n\n"
        )
        new_text, count = re.subn(
            r"(^android\s*\{)",
            loader_block + r"\1",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            print(f"::error::Could not locate 'android {{' block in {app_groovy}.", file=sys.stderr)
            sys.exit(1)
        text = new_text

    if "signingConfigs {" not in text:
        signing_block = (
            "    signingConfigs {\n"
            "        release {\n"
            "            def releaseStorePath = (keystoreProperties['storeFile'] ?: System.getenv('CUSTOMER_KEYSTORE_PATH') ?: '').toString().trim()\n"
            "            def releaseStorePass = (keystoreProperties['storePassword'] ?: System.getenv('CUSTOMER_STORE_PASSWORD') ?: '').toString()\n"
            "            def releaseAlias = (keystoreProperties['keyAlias'] ?: System.getenv('CUSTOMER_KEY_ALIAS') ?: '').toString().trim()\n"
            "            def releaseKeyPass = (keystoreProperties['keyPassword'] ?: System.getenv('CUSTOMER_KEY_PASSWORD') ?: '').toString()\n"
            "            if (!releaseStorePath || !releaseStorePass || !releaseAlias || !releaseKeyPass) {\n"
            "                throw new GradleException('Missing Android release signing configuration.')\n"
            "            }\n"
            "            storeFile file(releaseStorePath)\n"
            "            storePassword releaseStorePass\n"
            "            keyAlias releaseAlias\n"
            "            keyPassword releaseKeyPass\n"
            "        }\n"
            "    }\n\n"
        )
        new_text, count = re.subn(
            r"(^[ \t]*buildTypes\s*\{)",
            signing_block + r"\1",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        if count == 0:
            print(f"::error::Could not locate 'buildTypes {{' block in {app_groovy}.", file=sys.stderr)
            sys.exit(1)
        text = new_text

    text, rep_count = re.subn(
        r"signingConfig\s*=?\s*signingConfigs\.debug",
        "signingConfig signingConfigs.release",
        text,
    )
    text, rep_count2 = re.subn(
        r"signingConfig\s*=?\s*signingConfigs\.getByName\(\s*['\"]debug['\"]\s*\)",
        "signingConfig signingConfigs.release",
        text,
    )
    if (rep_count + rep_count2) == 0 and "signingConfigs.release" not in text:
        print(
            f"::error::Failed to configure release signingConfig in {app_groovy}.",
            file=sys.stderr,
        )
        sys.exit(1)

    app_groovy.write_text(text, encoding="utf-8")
    print(f"[Customer Signing] Configured Groovy DSL release signing in {app_groovy}.")
else:
    print(
        "::error::Neither android/app/build.gradle.kts nor android/app/build.gradle was found.",
        file=sys.stderr,
    )
    sys.exit(1)
PYEOF
