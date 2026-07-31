import { create } from 'zustand';

export interface ImageEditorSource {
  dataUrl: string;
  name: string;
  sourcePath?: string;
}

interface ImageEditorState {
  source: ImageEditorSource | null;
  setSource(source: ImageEditorSource): void;
  clearSource(): void;
}

export const useImageEditorStore = create<ImageEditorState>((set) => ({
  source: null,
  setSource: (source) => set({ source }),
  clearSource: () => set({ source: null }),
}));
