import { create } from 'zustand';

import type {
  ImageStudioDocument,
  ImageLayer,
  RetouchDocumentState,
  RetouchMaskRecord,
  RetouchOperationRecord,
} from '../../../core/image-studio/document/schema';

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
  documentVersion: number;
  showOriginal: boolean;
  transactionActive: boolean;
  transactionSnapshot: unknown;
  renderError: string | null;
}

interface ImageStudioActions {
  setCurrentDocument: (document: ImageStudioDocument | null) => void;
  restoreDocumentForUndo: (document: ImageStudioDocument | null) => void;
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
  undo: () => void;
  redo: () => void;
  toggleShowOriginal: () => void;
  setRenderError: (error: string | null) => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  beginRetouchTransaction: () => void;
  cancelRetouchTransaction: () => void;
  commitRetouchTransaction: () => void;
  addRetouchOperation: (operation: Omit<RetouchOperationRecord, 'id' | 'createdAt'> & { id?: string }) => void;
  updateRetouchOperation: (id: string, patch: Partial<RetouchOperationRecord>) => void;
  removeRetouchOperation: (id: string) => void;
  toggleRetouchOperation: (id: string) => void;
  moveRetouchOperation: (id: string, toIndex: number) => void;
  reorderRetouchOperations: (orderedIds: string[]) => void;
  clearRetouchOperations: () => void;
  duplicateRetouchOperation: (id: string) => void;
  addRetouchMask: (mask: Omit<RetouchMaskRecord, 'id' | 'revision'> & { id?: string }) => void;
  removeRetouchMask: (id: string) => void;
}

function ensureLayerRetouch(layer: ImageLayer): RetouchDocumentState {
  const val = (layer as unknown as Record<string, unknown>).retouche;
  if (val && typeof val === 'object') return val as RetouchDocumentState;
  return { version: 1, operations: [], masks: [] };
}

function setLayerRetouch(layer: ImageLayer, retouche: RetouchDocumentState): ImageLayer {
  return { ...layer, retouche } as unknown as ImageLayer;
}

function buildLayerTree(layers: ImageLayer[]): ImageStudioLayerNode[] {
  const childrenByParent = new Map<string | null, ImageLayer[]>();
  for (const layer of layers) {
    const siblings = childrenByParent.get(layer.parentId) ?? [];
    siblings.push(layer);
    childrenByParent.set(layer.parentId, siblings);
  }
  const visit = (layer: ImageLayer, ancestors: Set<string>): ImageStudioLayerNode => {
    if (ancestors.has(layer.id)) return { layer, children: [] };
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(layer.id);
    return {
      layer,
      children: (childrenByParent.get(layer.id) ?? []).map((child) => visit(child, nextAncestors)),
    };
  };
  return (childrenByParent.get(null) ?? []).map((layer) => visit(layer, new Set()));
}

function isUninitializedManualRetouchOperation(operation: RetouchOperationRecord): boolean {
  return (operation.type === 'manual-healing' && !operation.source)
    || ((operation.type === 'manual-smooth' || operation.type === 'manual-dodge-burn') && !operation.center)
    || ((operation.type === 'geometry-warp' || operation.type === 'body-reshape')
      && (!Array.isArray(operation.strokes) || operation.strokes.length === 0));
}

function applyDocMutation(
  state: { currentDocument: ImageStudioDocument | null; history: ImageStudioHistoryEntry[]; historyIndex: number; documentVersion: number; transactionActive: boolean; transactionSnapshot: unknown },
  nextDoc: ImageStudioDocument
): Partial<ImageStudioState> {
  if (state.transactionActive) {
    return {
      currentDocument: nextDoc,
      layerTree: buildLayerTree(nextDoc.layers),
      documentVersion: state.documentVersion + 1,
    };
  }
  const trimmed = state.history.slice(0, state.historyIndex + 1);
  trimmed.push({ document: structuredClone(nextDoc), timestamp: new Date().toISOString() });
  if (trimmed.length > 100) trimmed.shift();
  return {
    currentDocument: nextDoc,
    layerTree: buildLayerTree(nextDoc.layers),
    history: trimmed,
    historyIndex: trimmed.length - 1,
    documentVersion: state.documentVersion + 1,
    dirty: true,
    saved: false,
  };
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
  documentVersion: 0,
  showOriginal: false,
  transactionActive: false,
  transactionSnapshot: null,
  renderError: null,

  setCurrentDocument: (document) => set(() => ({
    currentDocument: document,
    dirty: false,
    saved: true,
    activeLayerId: document?.activeLayerId ?? null,
    selectedLayerIds: [],
    layerTree: document ? buildLayerTree(document.layers) : [],
    history: document ? [{ document: structuredClone(document), timestamp: new Date().toISOString() }] : [],
    historyIndex: document ? 0 : -1,
    selection: null,
    errors: [],
    documentVersion: 0,
    showOriginal: false,
    transactionActive: false,
    transactionSnapshot: null,
    renderError: null,
  })),

  restoreDocumentForUndo: (document) => set((state) => ({
    currentDocument: document,
    layerTree: document ? buildLayerTree(document.layers) : [],
    dirty: true,
    saved: false,
    documentVersion: state.documentVersion + 1,
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
  toggleShowOriginal: () => set((state) => ({ showOriginal: !state.showOriginal })),

  setLayerVisibility: (layerId, visible) => set((state) => {
    const document = state.currentDocument;
    if (!document) return {};
    const index = document.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0 || document.layers[index].visible === visible) return {};
    const layers = [...document.layers];
    layers[index] = { ...layers[index], visible, updatedAt: new Date().toISOString() };
    return applyDocMutation(state, { ...document, layers, updatedAt: new Date().toISOString() });
  }),

  undo: () => set((state) => {
    const prevIndex = state.historyIndex - 1;
    if (prevIndex < 0 || prevIndex >= state.history.length) return {};
    const entry = state.history[prevIndex];
    if (!entry) return {};
    return {
      currentDocument: structuredClone(entry.document as ImageStudioDocument),
      layerTree: buildLayerTree((entry.document as ImageStudioDocument).layers),
      historyIndex: prevIndex,
      documentVersion: state.documentVersion + 1,
      dirty: true,
      saved: false,
    };
  }),

  redo: () => set((state) => {
    const nextIndex = state.historyIndex + 1;
    if (nextIndex < 0 || nextIndex >= state.history.length) return {};
    const entry = state.history[nextIndex];
    if (!entry) return {};
    return {
      currentDocument: structuredClone(entry.document as ImageStudioDocument),
      layerTree: buildLayerTree((entry.document as ImageStudioDocument).layers),
      historyIndex: nextIndex,
      documentVersion: state.documentVersion + 1,
      dirty: true,
      saved: false,
    };
  }),
  setRenderError: (error) => set(() => ({ renderError: error })),

  beginRetouchTransaction: () => set((state) => {
    if (state.transactionActive) return {};
    return {
      transactionActive: true,
      transactionSnapshot: structuredClone(state.currentDocument),
    };
  }),

  cancelRetouchTransaction: () => set((state) => {
    if (!state.transactionActive || !state.transactionSnapshot) {
      return { transactionActive: false, transactionSnapshot: null };
    }
    const restored = structuredClone(state.transactionSnapshot as ImageStudioDocument);
    return {
      currentDocument: restored,
      layerTree: buildLayerTree(restored.layers),
      transactionActive: false,
      transactionSnapshot: null,
      documentVersion: state.documentVersion + 1,
    };
  }),

  commitRetouchTransaction: () => set((state) => {
    if (!state.transactionActive || !state.transactionSnapshot) {
      return { transactionActive: false, transactionSnapshot: null };
    }
    const trimmed = state.history.slice(0, state.historyIndex + 1);
    trimmed.push({ document: structuredClone(state.currentDocument), timestamp: new Date().toISOString() });
    if (trimmed.length > 100) trimmed.shift();
    return {
      transactionActive: false,
      transactionSnapshot: null,
      history: trimmed,
      historyIndex: trimmed.length - 1,
      dirty: true,
      saved: false,
    };
  }),

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
    documentVersion: 0,
    showOriginal: false,
    transactionActive: false,
    transactionSnapshot: null,
    renderError: null,
  })),

  addRetouchOperation: (operation) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    const layerId = state.activeLayerId;
    if (!layerId) return {};
    const layerIdx = doc.layers.findIndex((l) => l.id === layerId);
    if (layerIdx === -1) return {};
    const layer = doc.layers[layerIdx];
    const retouch = ensureLayerRetouch(layer);
    const id = operation.id ?? `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (retouch.operations.some((op) => op.id === id)) return {};
    const newOp: RetouchOperationRecord = {
      ...operation,
      id,
      createdAt: Date.now(),
    } as RetouchOperationRecord;
    const newRetouch: RetouchDocumentState = {
      ...retouch,
      operations: [...retouch.operations, newOp],
    };
    const newLayers = [...doc.layers];
    newLayers[layerIdx] = setLayerRetouch(layer, newRetouch);
    const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
    // Arming a manual brush must remain pixel-neutral and must not create a
    // standalone undo step. The first pointer gesture starts its transaction
    // and commits the operation together with its initialized geometry.
    if (isUninitializedManualRetouchOperation(newOp)) {
      return {
        currentDocument: nextDoc,
        layerTree: buildLayerTree(nextDoc.layers),
        documentVersion: state.documentVersion + 1,
      };
    }
    return applyDocMutation(state, nextDoc);
  }),

  updateRetouchOperation: (id, patch) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      const idx = retouch.operations.findIndex((op) => op.id === id);
      if (idx === -1) continue;
      const updated: RetouchOperationRecord = { ...retouch.operations[idx], ...patch };
      const newOps = [...retouch.operations];
      newOps[idx] = updated;
      const newRetouch: RetouchDocumentState = { ...retouch, operations: newOps };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  removeRetouchOperation: (id) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      if (!retouch.operations.some((op) => op.id === id)) continue;
      const newRetouch: RetouchDocumentState = {
        ...retouch,
        operations: retouch.operations.filter((op) => op.id !== id),
      };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  toggleRetouchOperation: (id) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      const idx = retouch.operations.findIndex((op) => op.id === id);
      if (idx === -1) continue;
      const updated: RetouchOperationRecord = {
        ...retouch.operations[idx],
        enabled: !retouch.operations[idx].enabled,
      };
      const newOps = [...retouch.operations];
      newOps[idx] = updated;
      const newRetouch: RetouchDocumentState = { ...retouch, operations: newOps };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  moveRetouchOperation: (id, toIndex) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      const fromIndex = retouch.operations.findIndex((op) => op.id === id);
      if (fromIndex === -1) continue;
      const clampedTo = Math.max(0, Math.min(retouch.operations.length - 1, toIndex));
      if (fromIndex === clampedTo) return {};
      const newOps = [...retouch.operations];
      const [moved] = newOps.splice(fromIndex, 1);
      newOps.splice(clampedTo, 0, moved);
      const newRetouch: RetouchDocumentState = { ...retouch, operations: newOps };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  reorderRetouchOperations: (orderedIds) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      const byId = new Map(retouch.operations.map((op) => [op.id, op]));
      const ordered = orderedIds.map((oid) => byId.get(oid)).filter((op): op is RetouchOperationRecord => Boolean(op));
      const remaining = retouch.operations.filter((op) => !orderedIds.includes(op.id));
      if (ordered.length === 0 && remaining.length === retouch.operations.length) continue;
      const newRetouch: RetouchDocumentState = {
        ...retouch,
        operations: [...ordered, ...remaining],
      };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  clearRetouchOperations: () => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    const layerId = state.activeLayerId;
    if (!layerId) return {};
    const layerIdx = doc.layers.findIndex((l) => l.id === layerId);
    if (layerIdx === -1) return {};
    const layer = doc.layers[layerIdx];
    const retouch = ensureLayerRetouch(layer);
    if (retouch.operations.length === 0) return {};
    const newRetouch: RetouchDocumentState = { ...retouch, operations: [] };
    const newLayers = [...doc.layers];
    newLayers[layerIdx] = setLayerRetouch(layer, newRetouch);
    const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
    return applyDocMutation(state, nextDoc);
  }),

  duplicateRetouchOperation: (id) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    for (let li = 0; li < doc.layers.length; li++) {
      const layer = doc.layers[li];
      const retouch = ensureLayerRetouch(layer);
      const source = retouch.operations.find((op) => op.id === id);
      if (!source) continue;
      const newId = `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const duplicate: RetouchOperationRecord = {
        ...structuredClone(source),
        id: newId,
        createdAt: Date.now(),
      };
      const newRetouch: RetouchDocumentState = {
        ...retouch,
        operations: [...retouch.operations, duplicate],
      };
      const newLayers = [...doc.layers];
      newLayers[li] = setLayerRetouch(layer, newRetouch);
      const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
      return applyDocMutation(state, nextDoc);
    }
    return {};
  }),

  addRetouchMask: (mask) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    const layerId = state.activeLayerId;
    if (!layerId) return {};
    const layerIdx = doc.layers.findIndex((l) => l.id === layerId);
    if (layerIdx === -1) return {};
    const layer = doc.layers[layerIdx];
    const retouch = ensureLayerRetouch(layer);
    const id = mask.id ?? `mask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (retouch.masks.some((m) => m.id === id)) return {};
    const newMask: RetouchMaskRecord = { ...mask, id, revision: 1 } as RetouchMaskRecord;
    const newRetouch: RetouchDocumentState = {
      ...retouch,
      masks: [...retouch.masks, newMask],
    };
    const newLayers = [...doc.layers];
    newLayers[layerIdx] = setLayerRetouch(layer, newRetouch);
    const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
    return applyDocMutation(state, nextDoc);
  }),

  removeRetouchMask: (id) => set((state) => {
    const doc = state.currentDocument;
    if (!doc) return {};
    const layerId = state.activeLayerId;
    if (!layerId) return {};
    const layerIdx = doc.layers.findIndex((l) => l.id === layerId);
    if (layerIdx === -1) return {};
    const layer = doc.layers[layerIdx];
    const retouch = ensureLayerRetouch(layer);
    if (!retouch.masks.some((m) => m.id === id)) return {};
    const newRetouch: RetouchDocumentState = {
      ...retouch,
      masks: retouch.masks.filter((m) => m.id !== id),
      operations: retouch.operations.map((op) =>
        op.maskId === id ? { ...op, maskId: null } : op
      ),
    };
    const newLayers = [...doc.layers];
    newLayers[layerIdx] = setLayerRetouch(layer, newRetouch);
    const nextDoc: ImageStudioDocument = { ...doc, layers: newLayers, updatedAt: new Date().toISOString() };
    return applyDocMutation(state, nextDoc);
  }),
}));
