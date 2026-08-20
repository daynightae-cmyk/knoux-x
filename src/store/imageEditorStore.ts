import { create } from 'zustand';

import type { RetouchProjectV2 } from '../features/image-editor/retouch/retouchProject';

export type BeautyTool =
  | 'skin-smoothing'
  | 'blemish-removal'
  | 'teeth-whitening'
  | 'red-eye'
  | 'skin-tone'
  | 'sharpen'
  | 'color-adjust'
  | 'eye-enhance'
  | 'lip-tint'
  | 'blush'
  | 'eyeshadow'
  | 'eyeliner'
  | 'portrait-glow'
  | 'body-sculpt'
  | 'liquify';

export interface ImageEditorSource {
  /** Display-ready URL. In desktop mode this is the bounded proxy, not the original. */
  dataUrl: string;
  name: string;
  sourcePath?: string;
  assetRef?: string;
  proxyRef?: string;
  sourceHash?: string;
  originalWidth?: number;
  originalHeight?: number;
}

export interface ImageEditorAiJob {
  jobId: string;
  task: string;
  provider: string;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  status: string;
  error: string | null;
  outputDataUrl: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  provenanceId: string | null;
}

export interface ImageEditorAiResult {
  jobId: string;
  provider: string;
  modelId: string;
  dataUrl: string;
  width: number;
  height: number;
  provenanceId: string | null;
}

interface ImageEditorState {
  source: ImageEditorSource | null;
  setSource(source: ImageEditorSource): void;
  clearSource(): void;
  aiActiveJob: ImageEditorAiJob | null;
  aiResult: ImageEditorAiResult | null;
  aiError: string | null;
  setAiJob(job: ImageEditorAiJob): void;
  setAiError(error: string): void;
  clearAiError(): void;
  clearAiResult(): void;

  // Beauty state
  beautyTool: BeautyTool | null;
  setBeautyTool(tool: BeautyTool | null): void;
  beautyStrength: number;
  setBeautyStrength(strength: number): void;
  beautyMask: ImageData | null;
  setBeautyMask(mask: ImageData | null): void;
  beautyBeforeSnapshot: string | null; // dataUrl of canvas before edit
  setBeautyBeforeSnapshot(dataUrl: string | null): void;
  beautyPreviewDataUrl: string | null;
  setBeautyPreview(dataUrl: string | null): void;
  beautyBusy: boolean;
  setBeautyBusy(busy: boolean): void;

  // Persistent non-destructive retouch recipe. Canvas state remains a render target only.
  retouchProject: RetouchProjectV2 | null;
  setRetouchProject(project: RetouchProjectV2 | null): void;
}

export const useImageEditorStore = create<ImageEditorState>((set) => ({
  source: null,
  setSource: (source) => set({ source }),
  clearSource: () => set({ source: null }),
  aiActiveJob: null,
  aiResult: null,
  aiError: null,
  setAiJob: (job) =>
    set((state) => {
      if (job.status === 'completed' && job.outputDataUrl) {
        return {
          aiActiveJob: job,
          aiResult: {
            jobId: job.jobId,
            provider: job.provider,
            modelId: job.modelId,
            dataUrl: job.outputDataUrl,
            width: job.width,
            height: job.height,
            provenanceId: job.provenanceId,
          },
          aiError: null,
        };
      }
      if (job.status === 'failed') {
        return { aiActiveJob: job, aiError: job.error ?? (state.aiError ?? 'AI job failed.') };
      }
      return { aiActiveJob: job, aiError: null };
    }),
  setAiError: (error) => set({ aiError: error }),
  clearAiError: () => set({ aiError: null }),
  clearAiResult: () => set({ aiResult: null }),

  // Beauty state defaults
  beautyTool: null,
  setBeautyTool: (tool) => set({ beautyTool: tool }),
  beautyStrength: 0.5,
  setBeautyStrength: (strength) => set({ beautyStrength: strength }),
  beautyMask: null,
  setBeautyMask: (mask) => set({ beautyMask: mask }),
  beautyBeforeSnapshot: null,
  setBeautyBeforeSnapshot: (dataUrl) => set({ beautyBeforeSnapshot: dataUrl }),
  beautyPreviewDataUrl: null,
  setBeautyPreview: (dataUrl) => set({ beautyPreviewDataUrl: dataUrl }),
  beautyBusy: false,
  setBeautyBusy: (busy) => set({ beautyBusy: busy }),
  retouchProject: null,
  setRetouchProject: (project) => set({ retouchProject: project }),
}));