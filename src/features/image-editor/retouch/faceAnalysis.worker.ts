import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import type { DetectedFace, FaceAnalysisRequest, FaceAnalysisResult, FacePoint } from './faceAnalysisContract';
import { FACE_ANALYSIS_MODEL_ID, faceAnalysisUnavailable } from './faceAnalysisContract';
import { buildSemanticFaceRegions } from './faceSemanticRegions';

interface ConfigureMessage {
  type: 'configure';
  modelBuffer: ArrayBuffer;
  wasmRoot: string;
}

interface AnalyzeMessage {
  type: 'analyze';
  requestId: string;
  request: FaceAnalysisRequest;
}

let landmarker: FaceLandmarker | null = null;
let configurationError: string | null = 'The verified local face model is not loaded.';
const ANALYSIS_PROXY_MAX_EDGE = 1024;

async function createAnalysisBitmap(imageDataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(imageDataUrl);
  const source = await createImageBitmap(await response.blob());
  const longestEdge = Math.max(source.width, source.height);
  if (longestEdge <= ANALYSIS_PROXY_MAX_EDGE) return source;

  const scale = ANALYSIS_PROXY_MAX_EDGE / longestEdge;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const context = canvas.getContext('2d');
  if (!context) {
    source.close();
    throw new Error('Unable to create a local portrait analysis canvas.');
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.transferToImageBitmap();
}

function point(value: { x: number; y: number; z?: number }): FacePoint {
  return { x: value.x, y: value.y, z: value.z ?? 0 };
}

async function configure(message: ConfigureMessage): Promise<void> {
  try {
    const vision = await FilesetResolver.forVisionTasks(message.wasmRoot);
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: new Uint8Array(message.modelBuffer) },
      runningMode: 'IMAGE',
      numFaces: 8,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
      outputFacialTransformationMatrixes: true,
    });
    configurationError = null;
    postMessage({ type: 'configured', modelId: FACE_ANALYSIS_MODEL_ID });
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
    landmarker = null;
    postMessage({ type: 'configuration-error', reason: configurationError });
  }
}

async function analyze(message: AnalyzeMessage): Promise<void> {
  if (!landmarker || configurationError) {
    postMessage({ type: 'result', requestId: message.requestId, result: faceAnalysisUnavailable(configurationError ?? 'Local face model is unavailable.') satisfies FaceAnalysisResult });
    return;
  }

  const startedAt = performance.now();
  try {
    const bitmap = await createAnalysisBitmap(message.request.imageDataUrl);
    const output = landmarker.detect(bitmap);
    bitmap.close();
    const faces: DetectedFace[] = output.faceLandmarks.slice(0, Math.max(1, message.request.maxFaces)).map((rawLandmarks, index) => {
      const landmarks = rawLandmarks.map(point);
      const xs = landmarks.map((entry) => entry.x);
      const ys = landmarks.map((entry) => entry.y);
      const confidence = output.faceBlendshapes?.[index]?.categories[0]?.score ?? 1;
      return {
        id: `face-${index + 1}`,
        confidence,
        bounds: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
        landmarks,
        regions: buildSemanticFaceRegions(landmarks),
        headPose: null,
      };
    });
    postMessage({ type: 'result', requestId: message.requestId, result: { status: 'ready', modelId: FACE_ANALYSIS_MODEL_ID, faces, elapsedMs: Math.round(performance.now() - startedAt) } satisfies FaceAnalysisResult });
  } catch (error) {
    postMessage({ type: 'result', requestId: message.requestId, result: { status: 'failed', modelId: FACE_ANALYSIS_MODEL_ID, reason: error instanceof Error ? error.message : String(error) } satisfies FaceAnalysisResult });
  }
}

self.onmessage = (event: MessageEvent<ConfigureMessage | AnalyzeMessage>): void => {
  if (event.data.type === 'configure') void configure(event.data);
  if (event.data.type === 'analyze') void analyze(event.data);
};
