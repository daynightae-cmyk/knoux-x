import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import { BODY_ANALYSIS_MODEL_ID } from '../../src/features/image-editor/retouch/bodyAnalysisContract';

import { findLocalRetouchModel } from './local-model-registry';

export interface LocalPoseModelPayload {
  status: 'ready' | 'model-unavailable';
  modelId: string;
  reason?: string;
  buffer?: Uint8Array;
}

function modelPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, 'assets', 'models', 'pose_landmarker_full.task');
}

export async function readVerifiedPoseModel(): Promise<LocalPoseModelPayload> {
  const model = findLocalRetouchModel(BODY_ANALYSIS_MODEL_ID);
  if (!model || !model.sha256) {
    return {
      status: 'model-unavailable',
      modelId: BODY_ANALYSIS_MODEL_ID,
      reason: 'Pose model has no approved manifest.',
    };
  }

  try {
    const buffer = await readFile(modelPath());
    if (buffer.byteLength !== model.sizeBytes) {
      return {
        status: 'model-unavailable',
        modelId: model.id,
        reason: 'Pose model size check failed.',
      };
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== model.sha256) {
      return {
        status: 'model-unavailable',
        modelId: model.id,
        reason: 'Pose model integrity check failed.',
      };
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
