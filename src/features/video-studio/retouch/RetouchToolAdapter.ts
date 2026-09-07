import type { TimelineItem } from '../../../core/creative/multitrackProject';
import type { EditingToolAdapter } from '../../editor/tools/EditingToolAdapter';
import { EditingToolError } from '../../editor/tools/EditingToolAdapter';
import { retouchTemplateRegistry } from '../../image-editor/retouch/RetouchModule/Templates/TemplateRegistry';
import type { RetouchTemplate } from '../../image-editor/retouch/RetouchModule/Templates/TemplateTypes';
import {
  addVideoRetouchLayer,
  cloneVideoRetouchState,
  createVideoRetouchState,
  resetVideoRetouch,
  type VideoRetouchApplyScope,
  type VideoRetouchCategory,
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
  const region = template.targetRegion as VideoRetouchRegion;
  return region;
}

function dispatchOpen(detail: RetouchToolOpenDetail): void {
  window.dispatchEvent(new CustomEvent<RetouchToolOpenDetail>(RETOUCH_TOOL_OPEN_EVENT, { detail }));
}

/**
 * Adapter over the existing Retouch template system. It does not duplicate
 * FaceDetector, BodyDetector, TemplateRegistry or any pixel-processing engine.
 * Its only responsibility is mapping accepted Retouch template choices onto
 * timeline clip state and exposing an event for the existing Retouch UI.
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

    let state = input.item.retouch ? cloneVideoRetouchState(input.item.retouch) : createVideoRetouchState();
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

    return { ...input.item, retouch: state };
  }

  async reset(input: VideoRetouchToolInput): Promise<TimelineItem> {
    if (!this.canHandle(input)) return input.item;
    const state = input.item.retouch ? resetVideoRetouch(input.item.retouch) : createVideoRetouchState();
    return { ...input.item, retouch: state };
  }

  openForImage(assetId: string): void {
    dispatchOpen({ mediaType: 'image', assetId });
  }

  openForVideoClip(clipId: string, timestamp: number): void {
    dispatchOpen({ mediaType: 'video', clipId, timestamp: Math.max(0, Number.isFinite(timestamp) ? timestamp : 0) });
  }

  getLayerReferences(item?: TimelineItem): string[] {
    return item?.retouch?.layers.map((layer) => layer.id) ?? [];
  }
}

export const retouchToolAdapter = new RetouchToolAdapter();
