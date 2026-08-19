import { create } from 'zustand';

import type { ImageStudioDocument, ImageLayer } from '../../../core/image-studio/document/schema';

export interface ImageStudioLayerNode {
  layer: ImageLayer;
  children: ImageStudioLayerNode[];
}

export interface ImageStudioHistoryEntry {
  document: unknown;
  timestamp: string;
}

export interface RecoverySessionInfo {
  documentId: string;
  autosavePath: string;
  savedAt: string;
  reason: 'crash' | 'manual' | 'shutdown';
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  healthy: boolean;
  storageMode: string;
  keyMasked: string;
  wired?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  task: string;
  pricing: string;
  provider?: string;
}

export interface AiJobInfo {
  jobId: string;
  task: string;
  provider: string;
  modelId: string;
  prompt: string;
  status: string;
  progress: number;
  error?: string;
}

export interface ImageStudioState {
  currentDocument: ImageStudioDocument | null;
  documentPath: string | null;
  dirty: boolean;
  saved: boolean;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  layerTree: ImageStudioLayerNode[];
  history: ImageStudioHistoryEntry[];
  historyIndex: number;
  activeTool: string | null;
  selection: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
  panX: number;
  panY: number;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'failed' | null;
  autosavePath: string | null;
  recoverySessions: RecoverySessionInfo[];
  providerStatus: Record<string, ProviderInfo>;
  modelCatalog: ModelInfo[];
  aiJobs: AiJobInfo[];
  errors: string[];
  isLoading: boolean;
  loadingMessage: string;
}

interface ImageStudioActions {
  setCurrentDocument: (document: ImageStudioDocument | null) => void;
  setDocumentPath: (path: string | null) => void;
  setDirty: (dirty: boolean) => void;
  setSaved: (saved: boolean) => void;
  setActiveLayerId: (id: string | null) => void;
  setSelectedLayerIds: (ids: string[]) => void;
  setLayerTree: (tree: ImageStudioLayerNode[]) => void;
  pushHistory: (document: unknown) => void;
  setHistoryIndex: (index: number) => void;
  setActiveTool: (tool: string | null) => void;
  setSelection: (selection: { x: number; y: number; width: number; height: number } | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setAutosaveStatus: (status: 'idle' | 'saving' | 'saved' | 'failed' | null) => void;
  setAutosavePath: (path: string | null) => void;
  setRecoverySessions: (sessions: RecoverySessionInfo[]) => void;
  setProviderStatus: (status: Record<string, ProviderInfo>) => void;
  setModelCatalog: (models: ModelInfo[]) => void;
  setAiJobs: (jobs: AiJobInfo[]) => void;
  addError: (error: string) => void;
  clearErrors: () => void;
  setLoading: (loading: boolean) => void;
  setLoadingMessage: (message: string) => void;
  reset: () => void;
}

export const useImageStudioStore = create<ImageStudioState & ImageStudioActions>()((set) => ({
  currentDocument: null,
  documentPath: null,
  dirty: false,
  saved: true,
  activeLayerId: null,
  selectedLayerIds: [],
  layerTree: [],
  history: [],
  historyIndex: -1,
  activeTool: null,
  selection: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  autosaveStatus: null,
  autosavePath: null,
  recoverySessions: [],
  providerStatus: {},
  modelCatalog: [],
  aiJobs: [],
  errors: [],
  isLoading: false,
  loadingMessage: '',
  setCurrentDocument: (document) => set(() => ({
    currentDocument: document,
    dirty: false,
    saved: true,
    activeLayerId: null,
    selectedLayerIds: [],
    layerTree: [],
    history: [],
    historyIndex: -1,
    selection: null,
    errors: [],
  })),
  setDocumentPath: (path) => set(() => ({ documentPath: path })),
  setDirty: (dirty) => set(() => ({ dirty, saved: !dirty })),
  setSaved: (saved) => set(() => ({ saved, dirty: !saved })),
  setActiveLayerId: (id) => set(() => ({ activeLayerId: id })),
  setSelectedLayerIds: (ids) => set(() => ({ selectedLayerIds: ids })),
  setLayerTree: (tree) => set(() => ({ layerTree: tree })),
  pushHistory: (document) => set((state) => {
    const trimmed = state.history.slice(0, state.historyIndex + 1);
    trimmed.push({ document: structuredClone(document), timestamp: new Date().toISOString() });
    if (trimmed.length > 100) trimmed.shift();
    return {
      history: trimmed,
      historyIndex: trimmed.length - 1,
      dirty: true,
      saved: false,
    };
  }),
  setHistoryIndex: (index) => set(() => ({ historyIndex: index })),
  setActiveTool: (tool) => set(() => ({ activeTool: tool })),
  setSelection: (selection) => set(() => ({ selection })),
  setZoom: (zoom) => set(() => ({ zoom: Math.max(0.1, Math.min(20, zoom)) })),
  setPan: (x, y) => set(() => ({ panX: x, panY: y })),
  setAutosaveStatus: (status) => set(() => ({ autosaveStatus: status })),
  setAutosavePath: (path) => set(() => ({ autosavePath: path })),
  setRecoverySessions: (sessions) => set(() => ({ recoverySessions: sessions })),
  setProviderStatus: (status) => set(() => ({ providerStatus: status })),
  setModelCatalog: (models) => set(() => ({ modelCatalog: models })),
  setAiJobs: (jobs) => set(() => ({ aiJobs: jobs })),
  addError: (error) => set((state) => ({ errors: [...state.errors, error] })),
  clearErrors: () => set(() => ({ errors: [] })),
  setLoading: (loading) => set(() => ({ isLoading: loading })),
  setLoadingMessage: (message) => set(() => ({ loadingMessage: message })),
  reset: () => set(() => ({
    currentDocument: null,
    documentPath: null,
    dirty: false,
    saved: true,
    activeLayerId: null,
    selectedLayerIds: [],
    layerTree: [],
    history: [],
    historyIndex: -1,
    activeTool: null,
    selection: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    autosaveStatus: null,
    autosavePath: null,
    recoverySessions: [],
    providerStatus: {},
    modelCatalog: [],
    aiJobs: [],
    errors: [],
    isLoading: false,
    loadingMessage: '',
  })),
}));