import { create } from 'zustand';

export interface ImageEditorSource {
  dataUrl: string;
  name: string;
  sourcePath?: string;
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
}));