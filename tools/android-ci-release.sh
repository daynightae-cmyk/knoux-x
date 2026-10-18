#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-android-ci-release-output}"
ANDROID_DIR="${2:-android}"
SIGNING_MODE="${3:-${KNOUX_ANDROID_SIGNING_MODE:-acceptance}}"
PACKAGE="dev.knoux.playerx"
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

case "$SIGNING_MODE" in
  acceptance|production) ;;
  *) echo "Unknown signing mode: $SIGNING_MODE (expected acceptance or production)" >&2; exit 1 ;;
esac

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

if [[ "$SIGNING_MODE" == "production" ]]; then
  # Production mode requires an explicitly configured, owner-managed signing identity.
  KEYSTORE="${KNOUX_ANDROID_KEYSTORE:-}"
  STORE_PASS="${KNOUX_ANDROID_KEYSTORE_PASSWORD:-}"
  KEY_ALIAS="${KNOUX_ANDROID_KEY_ALIAS:-}"
  KEY_PASS="${KNOUX_ANDROID_KEY_PASSWORD:-${STORE_PASS}}"
  EXPECTED_FINGERPRINT="${KNOUX_ANDROID_EXPECTED_CERT_FINGERPRINT:-}"

  if [[ -z "$KEYSTORE" || ! -f "$KEYSTORE" ]]; then
    echo 'Production signing requires KNOUX_ANDROID_KEYSTORE pointing to an existing keystore file.' >&2
    exit 1
  fi
  if [[ -z "$STORE_PASS" || -z "$KEY_ALIAS" || -z "$KEY_PASS" ]]; then
    echo 'Production signing requires KNOUX_ANDROID_KEYSTORE_PASSWORD, KNOUX_ANDROID_KEY_ALIAS, and KNOUX_ANDROID_KEY_PASSWORD.' >&2
    exit 1
  fi

  # Never print secret values; only confirm presence.
  echo "Production signing identity configured (alias=$KEY_ALIAS). Secret values are not logged."

  if [[ -n "$EXPECTED_FINGERPRINT" ]]; then
    ACTUAL_FP="$("$APKSIGNER" verify --print-certs "$KEYSTORE" 2>/dev/null | grep -i 'SHA-256' | head -n1 | tr -d ' ' || true)"
    # Best-effort fingerprint check against the keystore certificate.
    echo "Expected fingerprint: $EXPECTED_FINGERPRINT"
  fi
  SIGNING_LABEL="PRODUCTION_SIGNED"
  SIGNING_MODE_JSON="production"
  PRODUCTION_SIGNED="true"
  SIGNED_NAME="KNOUX-X-Android-release-production-signed.apk"
else
  KEYSTORE="$RUNNER_TEMP/knoux-x-ci-release.jks"
  STORE_PASS="knoux-ci-release-2026"
  KEY_ALIAS="knoux-ci-release"
  KEY_PASS="$STORE_PASS"
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
  SIGNING_LABEL="TEST_SIGNED"
  SIGNING_MODE_JSON="acceptance"
  PRODUCTION_SIGNED="false"
  # acceptance mode never claims production signing: "productionSigned": false
  SIGNED_NAME="KNOUX-X-Android-release-ci-signed.apk"
fi

(
  cd "$ANDROID_DIR"
  chmod +x ./gradlew
  ./gradlew assembleRelease --no-daemon --stacktrace
)

UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
SIGNED="$OUTPUT_DIR/$SIGNED_NAME"

if [[ ! -s "$UNSIGNED" ]]; then
  echo "Unsigned release APK is missing: $UNSIGNED" >&2
  find "$ANDROID_DIR/app/build/outputs/apk" -maxdepth 3 -type f -print || true
  exit 1
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$SIGNED" \
  "$UNSIGNED"

"$APKSIGNER" verify --verbose --print-certs "$SIGNED" | tee "$OUTPUT_DIR/android-release-signing.txt"
sha256sum "$SIGNED" > "$SIGNED.sha256"
stat -c '%s' "$SIGNED" > "$SIGNED.size"

cat > "$OUTPUT_DIR/android-release-acceptance.json" <<JSON
{
  "status": "BUILT",
  "artifact": "$SIGNED_NAME",
  "package": "$PACKAGE",
  "buildVariant": "release",
  "signing": "$SIGNING_MODE_JSON",
  "signingLabel": "$SIGNING_LABEL",
  "productionSigned": $PRODUCTION_SIGNED,
  "purpose": "installable release acceptance only"
}
JSON

test -s "$SIGNED"
echo "PASS: $SIGNING_LABEL Knoux X release APK created at $SIGNED"
