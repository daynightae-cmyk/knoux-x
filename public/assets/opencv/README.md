# OpenCV.js runtime assets (Phase 5 — optional WASM accelerator)

Drop the official OpenCV.js **full build** here so the local retouch engine
can accelerate skin smoothing with `cv.ximgproc.guidedFilter`:

- `opencv.js` — the full build (includes embedded WASM; if your build emits a
  separate `opencv_js.wasm`, place it next to it — the worker resolves files
  through `locateFile` relative to this directory).

Download (official): https://docs.opencv.org/4.x/d2/d0f/tutorial_js_usage.html
or build from source: `python ./platforms/js/build_js.py build_js --build_wasm`

The engine **auto-detects** the file at worker configure time. If nothing is
placed here, the retouch engine falls back to the pure TypeScript pixel path —
everything keeps working, just slower on very large documents.