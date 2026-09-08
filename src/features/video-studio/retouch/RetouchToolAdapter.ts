import type { TimelineItem } from '../../../core/creative/multitrackProject';
import {
  createTimelineVideoRetouchEffect,
  getTimelineVideoRetouch,
  normalizeTimelineVideoRetouch,
  type RetouchTimelineItem,
} from '../../../core/creative/videoRetouchEffect';
import type { EditingToolAdapter } from '../../editor/tools/EditingToolAdapter';
import { EditingToolError } from '../../editor/tools/EditingToolAdapter';
import { retouchTemplateRegistry } from '../../image-editor/retouch/RetouchModule/Templates/TemplateRegistry';
import type { RetouchTemplate } from '../../image-editor/retouch/RetouchModule/Templates/TemplateTypes';

import {
  addVideoRetouchLayer,
  createVideoRetouchState,
  ensureVideoRetouchState,
  resetVideoRetouch,
  type VideoRetouchApplyScope,
  type VideoRetouchCategory,
  type VideoRetouchClipState,
  type VideoRetouchLayerRange,
  type VideoRetouchRegion,
} from './videoRetouchProject';

export const RETOUCH_TOOL_OPEN_EVENT = 'knoux:retouch-tool-open';

export interface RetouchToolOpenDetail {
  mediaType: 'image' | 'video';
  assetId?: string;
  clipId?: string;
  timestamp?: number;
}

export interface ExistingRetouchAdapter {
  openForImage(assetId: string): void;
  openForVideoClip(clipId: string, timestamp: number): void;
  getLayerReferences(item?: TimelineItem): string[];
}

export interface VideoRetouchToolInput {
  item: TimelineItem;
  timestamp: number;
  templateId: string;
  strength?: number;
  faceId?: string | null;
  applyScope?: VideoRetouchApplyScope;
  range?: VideoRetouchLayerRange | null;
}

function categoryForTemplate(template: RetouchTemplate): VideoRetouchCategory {
  return template.category;
}

function regionForTemplate(template: RetouchTemplate): VideoRetouchRegion {
  return template.targetRegion as VideoRetouchRegion;
}

function dispatchOpen(detail: RetouchToolOpenDetail): void {
  window.dispatchEvent(new CustomEvent<RetouchToolOpenDetail>(RETOUCH_TOOL_OPEN_EVENT, { detail }));
}

function withTemporalState(item: TimelineItem, state: VideoRetouchClipState): TimelineItem {
  const effect = getTimelineVideoRetouch(item) ?? createTimelineVideoRetouchEffect();
  effect.temporal = state;
  effect.enabled = state.enabled;
  effect.selectedFaceId = state.selectedFaceId;
  effect.subjectMode = state.applyAllFaces ? 'all-faces' : state.selectedFaceId ? 'selected-face' : 'primary';
  effect.updatedAt = new Date().toISOString();
  const output: RetouchTimelineItem = { ...item, retouch: normalizeTimelineVideoRetouch(effect) };
  return output;
}

/**
 * Adapter over the existing Retouch system. It never duplicates detection,
 * templates or pixel engines; it maps stable template selections into the
 * canonical timeline Retouch payload and exposes the existing editor surface.
 */
export class RetouchToolAdapter implements EditingToolAdapter<VideoRetouchToolInput, TimelineItem>, ExistingRetouchAdapter {
  readonly id = 'retouch';

  canHandle(input: VideoRetouchToolInput): boolean {
    return input.item.kind === 'video' || input.item.kind === 'image';
  }

  async apply(input: VideoRetouchToolInput): Promise<TimelineItem> {
    if (!this.canHandle(input)) {
      throw new EditingToolError({
        toolId: this.id,
        code: 'unsupported-media',
        message: 'Retouch can only be applied to video or image timeline items.',
      });
    }

    const template = retouchTemplateRegistry.get(input.templateId);
    if (!template) {
      throw new EditingToolError({
        toolId: this.id,
        code: 'invalid-state',
        message: `Retouch template "${input.templateId}" is not registered.`,
      });
    }
    const mediaType = input.item.kind === 'video' ? 'video' : 'photo';
    if (!template.compatibleMedia.includes(mediaType)) {
      throw new EditingToolError({
        toolId: this.id,
        code: 'unsupported-media',
        message: `Retouch template "${template.id}" does not support ${mediaType}.`,
      });
    }

    let state = ensureVideoRetouchState(input.item);
    state.selectedFaceId = input.faceId ?? state.selectedFaceId;
    state = addVideoRetouchLayer(state, {
      templateId: template.id,
      category: categoryForTemplate(template),
      targetRegion: regionForTemplate(template),
      parameters: { ...template.parameters, ...(template.defaultColor ? { color: template.defaultColor } : {}) },
      strength: input.strength ?? template.defaultIntensity,
      trackingRequired: template.trackingRequired,
      faceId: input.faceId ?? state.selectedFaceId,
      applyScope: input.applyScope ?? 'clip',
      range: input.range ?? null,
      maskStrategy: template.maskStrategy,
      blendMode: template.blendMode,
    });
    return withTemporalState(input.item, state);
  }

  async reset(input: VideoRetouchToolInput): Promise<TimelineItem> {
    if (!this.canHandle(input)) return input.item;
    const current = getTimelineVideoRetouch(input.item)?.temporal;
    const state = current ? resetVideoRetouch(current) : createVideoRetouchState();
    return withTemporalState(input.item, state);
  }

  openForImage(assetId: string): void {
    dispatchOpen({ mediaType: 'image', assetId });
  }

  openForVideoClip(clipId: string, timestamp: number): void {
    dispatchOpen({ mediaType: 'video', clipId, timestamp: Math.max(0, Number.isFinite(timestamp) ? timestamp : 0) });
  }

  getLayerReferences(item?: TimelineItem): string[] {
    return item ? ensureVideoRetouchState(item).layers.map((layer) => layer.id) : [];
  }
}

export const retouchToolAdapter = new RetouchToolAdapter();
