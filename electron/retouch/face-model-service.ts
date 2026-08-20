import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import { FACE_ANALYSIS_MODEL_ID } from '../../src/features/image-editor/retouch/faceAnalysisContract';

import { findLocalRetouchModel } from './local-model-registry';

export interface LocalFaceModelPayload {
  status: 'ready' | 'model-unavailable';
  modelId: string;
  reason?: string;
  buffer?: Uint8Array;
}

function modelPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, 'assets', 'models', 'face_landmarker.task');
}

export async function readVerifiedFaceModel(): Promise<LocalFaceModelPayload> {
  const model = findLocalRetouchModel(FACE_ANALYSIS_MODEL_ID);
  if (!model || !model.sha256) {
    return { status: 'model-unavailable', modelId: FACE_ANALYSIS_MODEL_ID, reason: 'Face model has no approved manifest.' };
  }

  try {
    const buffer = await readFile(modelPath());
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== model.sha256) {
      return { status: 'model-unavailable', modelId: model.id, reason: 'Face model integrity check failed.' };
    }
    return { status: 'ready', modelId: model.id, buffer: new Uint8Array(buffer) };
  } catch (error) {
    return {
      status: 'model-unavailable',
      modelId: model.id,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
