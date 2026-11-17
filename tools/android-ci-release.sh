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
  # Production mode requires an explicitly configured, owner-managed signing
  # identity. Nothing here is optional: a production run that cannot prove which
  # certificate it used is not allowed to produce an artifact at all.
  KEYSTORE="${KNOUX_ANDROID_KEYSTORE:-}"
  KEY_ALIAS="${KNOUX_ANDROID_KEY_ALIAS:-}"
  KEYSTORE_TYPE="${KNOUX_ANDROID_KEYSTORE_TYPE:-PKCS12}"
  CERT_PIN="${KNOUX_ANDROID_CERT_SHA256:-}"

  if [[ -z "$KEYSTORE" || ! -f "$KEYSTORE" ]]; then
    echo 'Production signing requires KNOUX_ANDROID_KEYSTORE pointing to an existing keystore file.' >&2
    exit 1
  fi
  if [[ -z "${KNOUX_ANDROID_KEYSTORE_PASSWORD:-}" || -z "$KEY_ALIAS" || -z "${KNOUX_ANDROID_KEY_PASSWORD:-}" ]]; then
    echo 'Production signing requires KNOUX_ANDROID_KEYSTORE_PASSWORD, KNOUX_ANDROID_KEY_ALIAS, and KNOUX_ANDROID_KEY_PASSWORD.' >&2
    exit 1
  fi
  # The pin is what makes "a keystore was supplied" mean "the right keystore was
  # supplied". Requiring it here is the fix for the previous fail-open behaviour.
  if [[ -z "$CERT_PIN" ]]; then
    echo 'Production signing requires the pinned KNOUX_ANDROID_CERT_SHA256 certificate fingerprint.' >&2
    exit 1
  fi

  # Never print secret values; only confirm presence.
  echo "Production signing identity configured (alias=$KEY_ALIAS, storetype=$KEYSTORE_TYPE). Secret values are not logged."

  # Fail closed before Gradle runs, using the shared identity contract so the
  # acceptance and publishing lanes cannot drift apart.
  node tools/verify-production-signing-identity.cjs \
    --keystore "$KEYSTORE" \
    --storepass-env KNOUX_ANDROID_KEYSTORE_PASSWORD \
    --keypass-env KNOUX_ANDROID_KEY_PASSWORD \
    --alias "$KEY_ALIAS" \
    --storetype "$KEYSTORE_TYPE" \
    --pin-env KNOUX_ANDROID_CERT_SHA256 \
    --out "$OUTPUT_DIR/production-signing-identity.json"
  SIGNING_LABEL="PRODUCTION_SIGNED"
  SIGNING_MODE_JSON="production"
  PRODUCTION_SIGNED="true"
  SIGNED_NAME="KNOUX-X-Android-release-production-signed.apk"
  BUNDLE_NAME="KNOUX-X-Android-release-production-signed.aab"
  RELEASE_PURPOSE="publishable release artifact"
  KS_PASS_SPEC="env:KNOUX_ANDROID_KEYSTORE_PASSWORD"
  KEY_PASS_SPEC="env:KNOUX_ANDROID_KEY_PASSWORD"
  JARSIGNER_STORE_PASS_ENV="KNOUX_ANDROID_KEYSTORE_PASSWORD"
  JARSIGNER_KEY_PASS_ENV="KNOUX_ANDROID_KEY_PASSWORD"
else
  KEYSTORE="$RUNNER_TEMP/knoux-x-ci-release.jks"
  STORE_PASS="knoux-ci-release-2026"
  KEY_ALIAS="knoux-ci-release"
  KEY_PASS="$STORE_PASS"
  KEYSTORE_TYPE="JKS"
  export KNOUX_CI_RELEASE_STORE_PASS="$STORE_PASS"
  rm -f "$KEYSTORE"
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype JKS \
    -storepass:env KNOUX_CI_RELEASE_STORE_PASS \
    -keypass:env KNOUX_CI_RELEASE_STORE_PASS \
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
  BUNDLE_NAME="KNOUX-X-Android-release-ci-signed.aab"
  RELEASE_PURPOSE="installable release acceptance only"
  KS_PASS_SPEC="env:KNOUX_CI_RELEASE_STORE_PASS"
  KEY_PASS_SPEC="env:KNOUX_CI_RELEASE_STORE_PASS"
  JARSIGNER_STORE_PASS_ENV="KNOUX_CI_RELEASE_STORE_PASS"
  JARSIGNER_KEY_PASS_ENV="KNOUX_CI_RELEASE_STORE_PASS"
fi

# Debugging is a controlled observability switch, never a production default:
# debug and acceptance builds enable it before the WebView is created; a
# production build removes it and is verified after signing.
node tools/configure-android-webview-debugging.cjs "$ANDROID_DIR" "$SIGNING_MODE"

# Privacy: the generated Capacitor manifest defaults to android:allowBackup="true",
# which would copy projects/settings off the device into cloud backup. Pin it false
# (and drop dead backup-rule references) before Gradle sees the manifest.
node tools/harden-android-manifest.cjs "$ANDROID_DIR"
if ! grep -q 'android:allowBackup="false"' "$ANDROID_DIR/app/src/main/AndroidManifest.xml"; then
  echo 'AndroidManifest.xml is not hardened: allowBackup must be false.' >&2
  exit 1
fi

# A release artifact must not carry readable sources. The web build defaults to
# sourcemap=false now; this stops a regression before the APK is signed.
if find "$ANDROID_DIR/app/src/main/assets/public" -name '*.map' -print -quit | grep -q .; then
  echo 'Release assets contain JavaScript source maps; refusing to package readable sources.' >&2
  find "$ANDROID_DIR/app/src/main/assets/public" -name '*.map' | head -20 >&2
  exit 1
fi
SOURCE_MAPS_IN_ASSETS="$(find "$ANDROID_DIR/app/src/main/assets/public" -name '*.map' | wc -l | tr -d ' ')"

(
  cd "$ANDROID_DIR"
  chmod +x ./gradlew
  # Both artifacts come from one Gradle invocation so the APK that is installed
  # for acceptance and the bundle that would go to Play cannot diverge.
  ./gradlew assembleRelease bundleRelease --no-daemon --stacktrace
)

UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
UNSIGNED_BUNDLE="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
SIGNED="$OUTPUT_DIR/$SIGNED_NAME"
BUNDLE="$OUTPUT_DIR/$BUNDLE_NAME"

if [[ ! -s "$UNSIGNED" ]]; then
  echo "Unsigned release APK is missing: $UNSIGNED" >&2
  find "$ANDROID_DIR/app/build/outputs/apk" -maxdepth 3 -type f -print || true
  exit 1
fi
if [[ ! -s "$UNSIGNED_BUNDLE" ]]; then
  echo "Unsigned release AAB is missing: $UNSIGNED_BUNDLE" >&2
  find "$ANDROID_DIR/app/build/outputs/bundle" -maxdepth 3 -type f -print || true
  exit 1
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-type "$KEYSTORE_TYPE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "$KS_PASS_SPEC" \
  --key-pass "$KEY_PASS_SPEC" \
  --out "$SIGNED" \
  "$UNSIGNED"

# An app bundle is not an APK: apksigner cannot sign it, so the upload artifact
# is signed as a JAR and its certificate is compared against the APK below.
jarsigner \
  -keystore "$KEYSTORE" \
  -storetype "$KEYSTORE_TYPE" \
  -storepass:env "$JARSIGNER_STORE_PASS_ENV" \
  -keypass:env "$JARSIGNER_KEY_PASS_ENV" \
  -signedjar "$BUNDLE" \
  "$UNSIGNED_BUNDLE" \
  "$KEY_ALIAS"

"$APKSIGNER" verify --verbose --print-certs "$SIGNED" | tee "$OUTPUT_DIR/android-release-signing.txt"
jarsigner -verify -certs "$BUNDLE" > "$OUTPUT_DIR/android-bundle-signing.txt" 2>&1
BUNDLE_CERT_DER="$(mktemp -t knoux-bundle-cert.XXXXXX)"
unzip -p "$BUNDLE" 'META-INF/*.RSA' > "$BUNDLE_CERT_DER" || true
BUNDLE_CERT_SHA=''
if [[ -s "$BUNDLE_CERT_DER" ]]; then
  BUNDLE_CERT_SHA="$(keytool -printcert -file "$BUNDLE_CERT_DER" 2>/dev/null \
    | awk -F': ' '/SHA256/ {print $2; exit}' | tr -d '[:space:]' | tr 'A-F' 'a-f')"
fi
rm -f "$BUNDLE_CERT_DER"
echo "Bundle signer SHA-256: ${BUNDLE_CERT_SHA:-none}" | tee -a "$OUTPUT_DIR/android-bundle-signing.txt"

ACTUAL_CERT_SHA="$(awk -F': ' '/Signer #1 certificate SHA-256 digest/ {print $2; exit}' "$OUTPUT_DIR/android-release-signing.txt" | tr -d '[:space:]' | tr 'A-F' 'a-f')"

# The two artifacts a release channel could carry must be the same signer. If
# they differ, one of them is not what the other claims to be.
if [[ -z "$ACTUAL_CERT_SHA" ]]; then
  echo 'Could not read the APK signer certificate. Refusing to publish an unverified artifact.' >&2
  exit 1
fi
if [[ -z "$BUNDLE_CERT_SHA" ]]; then
  echo 'Could not read the AAB signer certificate. Refusing to publish an unverified artifact.' >&2
  exit 1
fi
if [[ "$ACTUAL_CERT_SHA" != "$BUNDLE_CERT_SHA" ]]; then
  echo "APK and AAB carry different signing identities: apk=$ACTUAL_CERT_SHA aab=$BUNDLE_CERT_SHA." >&2
  exit 1
fi

if [[ "$SIGNING_MODE" == "production" ]]; then
  # Re-check the shipped bytes, not just the keystore that was offered: the
  # publishable contract is that this artifact is signed by the pinned key.
  EXPECTED_CERT_SHA="$(printf '%s' "$CERT_PIN" | tr -d ':\n' | tr 'A-F' 'a-f')"
  if [[ "$ACTUAL_CERT_SHA" != "$EXPECTED_CERT_SHA" ]]; then
    echo "Production signing certificate mismatch: expected $EXPECTED_CERT_SHA, got $ACTUAL_CERT_SHA. Refusing to publish." >&2
    exit 1
  fi
  if [[ "$BUNDLE_CERT_SHA" != "$EXPECTED_CERT_SHA" ]]; then
    echo "Production bundle certificate mismatch: expected $EXPECTED_CERT_SHA, got $BUNDLE_CERT_SHA. Refusing to publish." >&2
    exit 1
  fi
  echo 'Production signing certificate matches the pinned fingerprint for both APK and AAB.'
else
  # Guard the inverse forgery too: an acceptance artifact can never be the
  # pinned production identity, whatever its filename claims.
  if [[ -n "${KNOUX_ANDROID_CERT_SHA256:-}" && "$ACTUAL_CERT_SHA" == "$(printf '%s' "$KNOUX_ANDROID_CERT_SHA256" | tr -d ':\n' | tr 'A-F' 'a-f')" ]]; then
    echo 'Acceptance signing produced an artifact carrying the pinned production certificate; the lanes are not isolated.' >&2
    exit 1
  fi
fi

sha256sum "$SIGNED" > "$SIGNED.sha256"
sha256sum "$BUNDLE" > "$BUNDLE.sha256"
stat -c '%s' "$SIGNED" > "$SIGNED.size"
stat -c '%s' "$BUNDLE" > "$BUNDLE.size"

PACKAGED_WEBVIEW_DEBUGGING="$(unzip -p "$SIGNED" assets/capacitor.config.json | node -e "const fs=require('fs');const config=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(config?.android?.webContentsDebuggingEnabled===true));")"
{
  echo "signingMode=$SIGNING_MODE"
  echo "packagedWebContentsDebuggingEnabled=$PACKAGED_WEBVIEW_DEBUGGING"
} > "$OUTPUT_DIR/android-webview-debugging.txt"

if [[ "$SIGNING_MODE" == "acceptance" ]]; then
  if [[ "$PACKAGED_WEBVIEW_DEBUGGING" != "true" ]]; then
    echo 'Acceptance release APK is missing android.webContentsDebuggingEnabled=true; installed WebView acceptance cannot attach.' >&2
    exit 1
  fi
else
  if [[ "$PACKAGED_WEBVIEW_DEBUGGING" != "false" ]]; then
    echo 'Production-signed APK must not expose WebView debugging.' >&2
    exit 1
  fi
fi

# 16 KB memory pages only constrain packaged native code. Rather than adding
# alignment tooling that has nothing to align, measure what the artifact
# actually carries and gate on that.
APK_NATIVE_LIBS="$(unzip -l "$SIGNED" | awk '$4 ~ /^lib\/.+\.so$/ {n++} END {print n+0}')"
BUNDLE_NATIVE_LIBS="$(unzip -l "$BUNDLE" | awk '$4 ~ /^(base|feature.*|.*\/lib)\/.+\.so$/ {n++} END {print n+0}')"
NATIVE_PAGE_ALIGNMENT='not-applicable'
if [[ "$APK_NATIVE_LIBS" -gt 0 || "$BUNDLE_NATIVE_LIBS" -gt 0 ]]; then
  ZIPALIGN="$BUILD_TOOLS/zipalign"
  if [[ ! -x "$ZIPALIGN" ]]; then
    echo "Native libraries are packaged but zipalign is missing: $ZIPALIGN" >&2
    exit 1
  fi
  "$ZIPALIGN" -c -P 16 -v 4 "$SIGNED" > "$OUTPUT_DIR/android-zipalign-16k.txt" 2>&1
  NATIVE_PAGE_ALIGNMENT="$("$ZIPALIGN" -c -P 16 -v 4 "$SIGNED" >/dev/null 2>&1 && echo aligned || echo misaligned)"
  if [[ "$NATIVE_PAGE_ALIGNMENT" != "aligned" ]]; then
    echo 'Packaged native libraries are not 16 KB page aligned.' >&2
    cat "$OUTPUT_DIR/android-zipalign-16k.txt" >&2
    exit 1
  fi
fi

RELEASE_IDENTITY="$(node tools/knoux-release-version.cjs)"
RELEASE_VERSION="$(printf '%s\n' "$RELEASE_IDENTITY" | awk -F= '$1=="version" {print $2}')"
RELEASE_VERSION_CODE="$(printf '%s\n' "$RELEASE_IDENTITY" | awk -F= '$1=="versionCode" {print $2}')"
SOURCE_SHA="$(git rev-parse HEAD)"
APK_SHA256="$(cut -d' ' -f1 "$SIGNED.sha256")"
BUNDLE_SHA256="$(cut -d' ' -f1 "$BUNDLE.sha256")"

cat > "$OUTPUT_DIR/android-release-acceptance.json" <<JSON
{
  "status": "BUILT",
  "artifact": "$SIGNED_NAME",
  "bundleArtifact": "$BUNDLE_NAME",
  "package": "$PACKAGE",
  "versionName": "$RELEASE_VERSION",
  "versionCode": $RELEASE_VERSION_CODE,
  "sourceSha": "$SOURCE_SHA",
  "buildVariant": "release",
  "signing": "$SIGNING_MODE_JSON",
  "signingLabel": "$SIGNING_LABEL",
  "productionSigned": $PRODUCTION_SIGNED,
  "certificateSha256": "$ACTUAL_CERT_SHA",
  "bundleCertificateSha256": "$BUNDLE_CERT_SHA",
  "keystoreType": "$KEYSTORE_TYPE",
  "apkSha256": "$APK_SHA256",
  "aabSha256": "$BUNDLE_SHA256",
  "apkBytes": $(stat -c '%s' "$SIGNED"),
  "aabBytes": $(stat -c '%s' "$BUNDLE"),
  "webContentsDebuggingEnabled": $PACKAGED_WEBVIEW_DEBUGGING,
  "allowBackup": false,
  "sourceMapsInAssets": $SOURCE_MAPS_IN_ASSETS,
  "apkNativeLibraries": $APK_NATIVE_LIBS,
  "aabNativeLibraries": $BUNDLE_NATIVE_LIBS,
  "nativePageAlignment": "$NATIVE_PAGE_ALIGNMENT",
  "purpose": "$RELEASE_PURPOSE"
}
JSON

test -s "$SIGNED"
test -s "$BUNDLE"
echo "PASS: $SIGNING_LABEL Knoux X release APK and AAB created in $OUTPUT_DIR"
