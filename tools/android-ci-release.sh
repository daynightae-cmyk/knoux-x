#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-android-ci-release-output}"
ANDROID_DIR="${2:-android}"
PACKAGE="dev.knoux.playerx"
KEYSTORE="$RUNNER_TEMP/knoux-x-ci-release.jks"
STORE_PASS="knoux-ci-release-2026"
KEY_ALIAS="knoux-ci-release"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
BUILD_TOOLS="$SDK_ROOT/build-tools/36.0.0"
APKSIGNER="$BUILD_TOOLS/apksigner"

if [[ -z "$SDK_ROOT" ]]; then
  echo 'ANDROID_HOME or ANDROID_SDK_ROOT is required.' >&2
  exit 1
fi
if [[ ! -x "$APKSIGNER" ]]; then
  echo "apksigner is missing: $APKSIGNER" >&2
  exit 1
fi
if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "Generated Android project is missing: $ANDROID_DIR" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
rm -f "$KEYSTORE"

keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -storepass "$STORE_PASS" \
  -keypass "$STORE_PASS" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 3072 \
  -validity 3650 \
  -dname 'CN=Knoux X CI Release Verification, OU=CI, O=Knoux X, L=Abu Dhabi, ST=Abu Dhabi, C=AE'

(
  cd "$ANDROID_DIR"
  chmod +x ./gradlew
  ./gradlew assembleRelease --no-daemon --stacktrace
)

UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
SIGNED="$OUTPUT_DIR/KNOUX-X-Android-release-ci-signed.apk"

if [[ ! -s "$UNSIGNED" ]]; then
  echo "Unsigned release APK is missing: $UNSIGNED" >&2
  find "$ANDROID_DIR/app/build/outputs/apk" -maxdepth 3 -type f -print || true
  exit 1
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASS" \
  --key-pass "pass:$STORE_PASS" \
  --out "$SIGNED" \
  "$UNSIGNED"

"$APKSIGNER" verify --verbose --print-certs "$SIGNED" | tee "$OUTPUT_DIR/android-release-signing.txt"
sha256sum "$SIGNED" > "$SIGNED.sha256"
stat -c '%s' "$SIGNED" > "$SIGNED.size"

cat > "$OUTPUT_DIR/android-release-acceptance.json" <<JSON
{
  "status": "BUILT",
  "artifact": "KNOUX-X-Android-release-ci-signed.apk",
  "package": "$PACKAGE",
  "buildVariant": "release",
  "signing": "ephemeral-ci-key",
  "productionSigned": false,
  "purpose": "installable release acceptance only"
}
JSON

test -s "$SIGNED"
echo "PASS: CI-signed Knoux X release APK created at $SIGNED"
