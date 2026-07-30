# Capture Implementation Report

## Implemented

The first production-safe capture foundation is implemented without exposing an unfinished UI control:

- Unicode NFC filename normalization.
- Windows-invalid character and reserved device-name protection.
- Exact millisecond timestamp formatting.
- Deterministic PNG/JPEG/WebP filename extension handling.
- Strict supported-image data URL validation and decoded-size calculation.
- Explicit recording state transitions with invalid transition rejection and cancellation.

## Remaining

Frame extraction already exists in the renderer video engine, but Save As, default-folder authorization, clipboard, capture gallery, burst/contact sheets, MediaRecorder adapters, and resource cleanup still require integration and packaged runtime evidence. Until those pass, TASK-16 remains `IN_PROGRESS` and no recording capability is advertised.
