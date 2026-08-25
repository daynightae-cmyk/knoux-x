import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

import type { BodyAnalysisRequest, BodyAnalysisResult, BodyLandmarkName, BodyPoint, DetectedBody, DerivedBodyGeometry } from './bodyAnalysisContract';
import { BODY_ANALYSIS_MODEL_ID, bodyAnalysisUnavailable } from './bodyAnalysisContract';

interface ConfigureMessage { type: 'configure'; modelBuffer: ArrayBuffer; wasmRoot: string; }
interface AnalyzeMessage { type: 'analyze'; requestId: string; request: BodyAnalysisRequest; }

const NAMES: BodyLandmarkName[] = ['nose','leftEyeInner','leftEye','leftEyeOuter','rightEyeInner','rightEye','rightEyeOuter','leftEar','rightEar','mouthLeft','mouthRight','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftPinky','rightPinky','leftIndex','rightIndex','leftThumb','rightThumb','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle','leftHeel','rightHeel','leftFootIndex','rightFootIndex'];
let landmarker: PoseLandmarker | null = null;
let configurationError: string | null = 'The verified local pose model is not loaded.';

async function bitmapOf(url: string): Promise<ImageBitmap> {
  const source = await createImageBitmap(await (await fetch(url)).blob());
  const max = Math.max(source.width, source.height);
  if (max <= 1024) return source;
  const scale = 1024 / max;
  const canvas = new OffscreenCanvas(Math.round(source.width * scale), Math.round(source.height * scale));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.transferToImageBitmap();
}

function point(value: { x: number; y: number; z: number; visibility?: number; presence?: number }): BodyPoint {
  return { x: value.x, y: value.y, z: value.z, visibility: value.visibility ?? 1, presence: value.presence ?? 1 };
}
function midpoint(a: BodyPoint, b: BodyPoint): BodyPoint { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(a.visibility, b.visibility), presence: Math.min(a.presence, b.presence) }; }
function distance(a: BodyPoint, b: BodyPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function geometry(l: Record<BodyLandmarkName, BodyPoint>): DerivedBodyGeometry {
  const shoulderCenter = midpoint(l.leftShoulder, l.rightShoulder);
  const hipCenter = midpoint(l.leftHip, l.rightHip);
  const waistLeft = midpoint(l.leftShoulder, l.leftHip);
  const waistRight = midpoint(l.rightShoulder, l.rightHip);
  const waistCenter = midpoint(waistLeft, waistRight);
  const xs = Object.values(l).map((p) => p.x), ys = Object.values(l).map((p) => p.y);
  return {
    head: { center: midpoint(l.leftEar, l.rightEar), radius: Math.max(distance(l.leftEar, l.rightEar), distance(l.leftEye, l.rightEye)) },
    shoulders: { left: l.leftShoulder, right: l.rightShoulder, center: shoulderCenter, width: distance(l.leftShoulder, l.rightShoulder) },
    waist: { left: waistLeft, right: waistRight, center: waistCenter, width: distance(waistLeft, waistRight) },
    hips: { left: l.leftHip, right: l.rightHip, center: hipCenter, width: distance(l.leftHip, l.rightHip) },
    arms: { left: [l.leftShoulder, l.leftElbow, l.leftWrist], right: [l.rightShoulder, l.rightElbow, l.rightWrist] },
    legs: { left: [l.leftHip, l.leftKnee, l.leftAnkle], right: [l.rightHip, l.rightKnee, l.rightAnkle] },
    subjectBounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
  };
}
async function configure(message: ConfigureMessage): Promise<void> {
  try {
    const vision = await FilesetResolver.forVisionTasks(message.wasmRoot);
    landmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetBuffer: new Uint8Array(message.modelBuffer) }, runningMode: 'IMAGE', numPoses: 4, minPoseDetectionConfidence: 0.55, minPosePresenceConfidence: 0.55, minTrackingConfidence: 0.5, outputSegmentationMasks: true });
    configurationError = null; postMessage({ type: 'configured', modelId: BODY_ANALYSIS_MODEL_ID });
  } catch (error) { configurationError = error instanceof Error ? error.message : String(error); landmarker = null; postMessage({ type: 'configuration-error', reason: configurationError }); }
}
async function analyze(message: AnalyzeMessage): Promise<void> {
  if (!landmarker || configurationError) { postMessage({ type: 'result', requestId: message.requestId, result: bodyAnalysisUnavailable(configurationError ?? 'Local pose model is unavailable.') satisfies BodyAnalysisResult }); return; }
  const startedAt = performance.now();
  try {
    const bitmap = await bitmapOf(message.request.imageDataUrl);
    const output = landmarker.detect(bitmap);
    bitmap.close();
    const bodies: DetectedBody[] = output.landmarks.slice(0, Math.max(1, message.request.maxBodies)).map((raw, index) => {
      const landmarks = Object.fromEntries(NAMES.map((name, i) => [name, point(raw[i])])) as Record<BodyLandmarkName, BodyPoint>;
      return { id: `body-${index + 1}`, confidence: Math.min(...Object.values(landmarks).map((p) => p.visibility)), landmarks, geometry: geometry(landmarks) };
    });
    const nativeMask = output.segmentationMasks?.[0];
    let segmentationMask: { width: number; height: number; data: Uint8Array } | undefined;
    if (nativeMask) {
      const values = nativeMask.getAsFloat32Array();
      const data = new Uint8Array(nativeMask.width * nativeMask.height);
      for (let index = 0; index < data.length; index += 1) data[index] = values[index] >= 0.5 ? 255 : 0;
      segmentationMask = { width: nativeMask.width, height: nativeMask.height, data };
    }
    output.close();
    const result: BodyAnalysisResult = {
      status: 'ready',
      modelId: BODY_ANALYSIS_MODEL_ID,
      bodies,
      elapsedMs: Math.round(performance.now() - startedAt),
      segmentationAvailable: Boolean(segmentationMask),
      ...(segmentationMask ? { segmentationMask } : {}),
    };
    postMessage({ type: 'result', requestId: message.requestId, result });
  } catch (error) { postMessage({ type: 'result', requestId: message.requestId, result: { status: 'failed', modelId: BODY_ANALYSIS_MODEL_ID, reason: error instanceof Error ? error.message : String(error) } satisfies BodyAnalysisResult }); }
}
self.onmessage = (event: MessageEvent<ConfigureMessage | AnalyzeMessage>): void => { if (event.data.type === 'configure') void configure(event.data); else void analyze(event.data); };
