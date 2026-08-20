import type { BeautyTool } from '../../../store/imageEditorStore';

export type RetouchBlendMode = 'normal' | 'soft-light' | 'color' | 'luminosity';
export type RetouchMaskType = 'brush' | 'selection' | 'focus' | 'face-region' | 'subject' | 'composite';
export type RetouchMaskSource = 'manual' | 'selection' | 'derived' | 'local-analysis';

export interface RetouchMaskDescriptor {
  id: string;
  type: RetouchMaskType;
  source: RetouchMaskSource;
  width: number;
  height: number;
  /** Portable data URL for the current P0 project format. */
  alphaDataUrl: string | null;
  featherPx: number;
  inverted: boolean;
  protectedRegions: Array<'eyes' | 'brows' | 'lips' | 'hairline'>;
  revision: number;
}

export interface RetouchOperation {
  id: string;
  tool: BeautyTool;
  name: string;
  enabled: boolean;
  opacity: number;
  blendMode: RetouchBlendMode;
  maskId: string | null;
  params: Record<string, number | string | boolean>;
  engine: 'canvas-local';
  createdAt: string;
  updatedAt: string;
}

export interface RetouchProjectV2 {
  version: 2;
  type: 'knoux-retouch-project';
  source: {
    name: string;
    width: number;
    height: number;
    dataUrl: string;
  };
  operations: RetouchOperation[];
  masks: RetouchMaskDescriptor[];
  updatedAt: string;
}

function stableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createRetouchProject(input: RetouchProjectV2['source']): RetouchProjectV2 {
  return {
    version: 2,
    type: 'knoux-retouch-project',
    source: input,
    operations: [],
    masks: [],
    updatedAt: now(),
  };
}

export function createRetouchMask(input: Omit<RetouchMaskDescriptor, 'id' | 'revision'>): RetouchMaskDescriptor {
  return { ...input, id: stableId('mask'), revision: 1 };
}

export function createRetouchOperation(input: Omit<RetouchOperation, 'id' | 'createdAt' | 'updatedAt'>): RetouchOperation {
  const timestamp = now();
  return { ...input, id: stableId('retouch'), createdAt: timestamp, updatedAt: timestamp };
}

export function addRetouchOperation(project: RetouchProjectV2, operation: RetouchOperation): RetouchProjectV2 {
  return { ...project, operations: [...project.operations, operation], updatedAt: now() };
}

export function updateRetouchOperation(
  project: RetouchProjectV2,
  operationId: string,
  changes: Partial<Pick<RetouchOperation, 'enabled' | 'opacity' | 'blendMode' | 'maskId' | 'name' | 'params'>>,
): RetouchProjectV2 {
  return {
    ...project,
    operations: project.operations.map((operation) => operation.id === operationId
      ? { ...operation, ...changes, updatedAt: now() }
      : operation),
    updatedAt: now(),
  };
}

export function removeRetouchOperation(project: RetouchProjectV2, operationId: string): RetouchProjectV2 {
  return { ...project, operations: project.operations.filter((operation) => operation.id !== operationId), updatedAt: now() };
}

export function reorderRetouchOperations(project: RetouchProjectV2, operationIds: string[]): RetouchProjectV2 {
  const byId = new Map(project.operations.map((operation) => [operation.id, operation]));
  const ordered = operationIds.map((id) => byId.get(id)).filter((operation): operation is RetouchOperation => Boolean(operation));
  const remaining = project.operations.filter((operation) => !operationIds.includes(operation.id));
  return { ...project, operations: [...ordered, ...remaining], updatedAt: now() };
}

export function addRetouchMask(project: RetouchProjectV2, mask: RetouchMaskDescriptor): RetouchProjectV2 {
  return { ...project, masks: [...project.masks, mask], updatedAt: now() };
}
