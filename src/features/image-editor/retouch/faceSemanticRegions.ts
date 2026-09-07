import type { FacePoint, FaceRegionMask, FaceSemanticRegion } from './faceAnalysisContract';

function points(landmarks: FacePoint[], indexes: number[]): FacePoint[] {
  return indexes.map((index) => landmarks[index]).filter((value): value is FacePoint => Boolean(value));
}

function region(name: FaceSemanticRegion, landmarks: FacePoint[], indexes: number[]): FaceRegionMask {
  return { region: name, polygon: points(landmarks, indexes) };
}

/**
 * Maps MediaPipe Face Landmarker indexes into reusable geometry-only semantic
 * regions. No identity, demographic, health or personality inference occurs.
 * Missing optional landmarks (for example iris points on a reduced model) are
 * represented by an empty/partial polygon rather than fabricated geometry.
 */
export function buildSemanticFaceRegions(landmarks: FacePoint[]): FaceRegionMask[] {
  const leftEye = [33, 160, 158, 133, 153, 144];
  const rightEye = [362, 385, 387, 263, 373, 380];
  const upperEyelids = [33, 160, 158, 133, 362, 385, 387, 263];
  const lowerEyelids = [33, 144, 153, 133, 362, 380, 373, 263];
  const leftBrow = [70, 63, 105, 66, 107];
  const rightBrow = [336, 296, 334, 293, 300];
  const upperLip = [61, 185, 40, 39, 0, 267, 269, 291];
  const lowerLip = [291, 375, 321, 405, 17, 181, 91, 146, 61];
  const outerLips = [61, 185, 40, 39, 0, 267, 269, 291, 375, 321, 405, 17, 181, 91, 146];
  const teeth = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 14, 87];
  const leftCheek = [116, 123, 147, 213, 192, 214];
  const rightCheek = [345, 352, 376, 433, 416, 434];
  const jaw = [234, 93, 132, 58, 172, 152, 397, 288, 361, 454];
  const chin = [172, 136, 150, 149, 176, 148, 152, 377, 400, 379, 365, 397];
  const forehead = [10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109];
  const temples = [127, 162, 21, 251, 389, 356];
  const hairline = [109, 67, 103, 10, 338, 297, 332];
  const nose = [168, 6, 197, 195, 5, 4, 1, 2, 98, 97, 326, 327];
  const noseBridge = [168, 6, 197, 195, 5];
  const noseTip = [1, 2, 98, 327];
  const skin = [10, 338, 297, 332, 284, 251, 389, 356, 365, 379, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const iris = [468, 469, 470, 471, 472, 473, 474, 475, 476, 477];

  return [
    region('eyes', landmarks, [...leftEye, ...rightEye]),
    region('leftEye', landmarks, leftEye),
    region('rightEye', landmarks, rightEye),
    region('upperEyelids', landmarks, upperEyelids),
    region('lowerEyelids', landmarks, lowerEyelids),
    region('irisArea', landmarks, iris),
    region('lips', landmarks, outerLips),
    region('upperLip', landmarks, upperLip),
    region('lowerLip', landmarks, lowerLip),
    region('mouth', landmarks, outerLips),
    region('teeth', landmarks, teeth),
    region('brows', landmarks, [...leftBrow, ...rightBrow]),
    region('leftEyebrow', landmarks, leftBrow),
    region('rightEyebrow', landmarks, rightBrow),
    region('cheeks', landmarks, [...leftCheek, ...rightCheek]),
    region('leftCheek', landmarks, leftCheek),
    region('rightCheek', landmarks, rightCheek),
    region('jaw', landmarks, jaw),
    region('chin', landmarks, chin),
    region('forehead', landmarks, forehead),
    region('temples', landmarks, temples),
    region('hairline', landmarks, hairline),
    region('nose', landmarks, nose),
    region('noseBridge', landmarks, noseBridge),
    region('noseTip', landmarks, noseTip),
    region('skin', landmarks, skin),
  ];
}
