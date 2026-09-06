# KNOUX Player X — Android packaging lane

This repository is primarily an Electron desktop application. Electron main/preload code and native Node modules such as `better-sqlite3`, FFmpeg binaries, Sharp native bindings and ONNX Node runtimes cannot be embedded directly in an Android WebView.

The Android lane therefore packages the existing browser-safe Vite renderer with Capacitor while leaving the Electron desktop build untouched.

## Build architecture

- Web source: the existing React renderer.
- Web output: `dist/`, using `vite.renderer.config.ts`.
- Native container: Capacitor 8.5.0.
- Android application id: `dev.knoux.playerx`.
- Android SDK: API 36.
- CI runtime: Node.js 22 and Java 21.
- Output: installable debug APK plus SHA-256 checksum as a GitHub Actions artifact.

## CI build

The workflow `.github/workflows/android-apk.yml` runs on relevant pushes to `main` and can also be launched manually from GitHub Actions. It intentionally generates the `android/` project during CI so the repository does not duplicate generated Gradle boilerplate.

The workflow performs these gates in order:

1. `npm ci --ignore-scripts` from the committed lockfile.
2. Install exactly Capacitor 8.5.0 build packages without saving or changing `package-lock.json`.
3. Build the existing browser-safe Vite renderer to `dist/`.
4. Generate and synchronize the Capacitor Android shell.
5. Run Gradle `assembleDebug`.
6. Verify the APK is non-empty, calculate SHA-256, and upload both files.

## Runtime scope

The APK uses the existing constrained browser bridge. UI and browser-compatible media flows remain available. Desktop-only capabilities that require Electron IPC or native Node modules remain intentionally unavailable until they receive Android-native adapters. This prevents fake success states and protects the proven Windows runtime from mobile-specific regressions.

Examples of desktop-only capabilities include direct SQLite desktop-library access, bundled FFmpeg/ffprobe export, Node ONNX execution, unrestricted desktop filesystem scanning, and Electron window/process APIs.

## Feature-parity direction

Future Android parity should be implemented behind platform adapters, using Android/Capacitor APIs for storage and media access and mobile-compatible inference/export engines where technically appropriate. Do not import Electron main/preload or Node-native modules into the Android renderer.
