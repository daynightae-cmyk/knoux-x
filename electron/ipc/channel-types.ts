/**
 * Compile-time IPC schema. Every channel is intentionally listed: adding a
 * runtime constant without adding its tuple/result here is a type error.
 */
import type { AudioProcessRequest } from '../../src/core/creative/audioTools';
import type { ClipExtractionOptions } from '../../src/core/creative/clipExtraction';
import type { EditProject } from '../../src/core/creative/editProject';
import type { MultitrackProject } from '../../src/core/creative/multitrackProject';
import type { SlideshowRenderFormat } from '../../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../../src/core/creative/slideshowProject';
import type { ChatContext } from '../../src/core/services/ai/GeminiService';
import type { VideoCrop } from '../../src/core/services/video/VideoEngine';
import type { AIChatMessage, AIConfigureRequest } from '../creative/ai-service';
import type { AudioToolJobSnapshot } from '../creative/audio-tools-service';
import type { BurstFrameRequest, ContactSheetRequest, SaveFrameRequest } from '../creative/capture-service';
import type { ExportJobSnapshot, ExportRequest } from '../creative/export-service';
import type { FFmpegProgress } from '../creative/ffmpeg-service';
import type { NewProjectRequest, SaveProjectRequest } from '../creative/project-service';
import type { BeginRecordingRequest } from '../creative/recording-service';
import type { DesktopCaptureOperation, DesktopCaptureOperationResult, RegionAspectPreset } from '../creative/region-capture-service';
import type { SlideshowRenderSnapshot } from '../creative/slideshow-render-service';
import type { LibraryQuery, ScanProgress } from '../library/library-service';

export type StructuredValue =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | ArrayBuffer
  | StructuredValue[]
  | object;

export type StructuredObject = object;
export type OptionalObject = object | undefined;
export type VoidResult = void;

export interface InvokeArgumentMap {
  'ai-secure:cancel': [];
  'ai-secure:chat': [message: string, history?: AIChatMessage[]];
  'ai-secure:clear': [];
  'ai-secure:configure': [request: AIConfigureRequest];
  'ai-secure:settings': [];
  'ai-secure:test': [];
  'ai:analyze-media': [filePath: string];
  'ai:chat': [message: string, context?: ChatContext];
  'ai:generate-playlist': [mood: string, count?: number];
  'ai:recommendations': [basedOn: string[]];
  'audio-tools:analyze': [sourcePath: string];
  'audio-tools:cancel': [jobId: string];
  'audio-tools:jobs': [];
  'audio-tools:process': [request: AudioProcessRequest];
  'audio:balance': [balance: number];
  'audio:dsp': [enabled: boolean];
  'audio:effect': [effect: string, params: StructuredValue];
  'audio:equalizer': [bands: number[]];
  'audio:muted': [muted: boolean];
  'audio:settings': [];
  'audio:visualizer': [];
  'audio:volume': [volume: number];
  'capture:choose-default-directory': [];
  'capture:contact-sheet': [request: ContactSheetRequest];
  'capture:copy-frame': [dataUrl: string];
  'capture:desktop': [request: DesktopCaptureOperation];
  'capture:desktop-sources': [];
  'capture:get-default-directory': [];
  'capture:recent': [];
  'capture:save-burst': [frames: BurstFrameRequest[]];
  'capture:save-frame': [request: SaveFrameRequest];
  'capture:show-item': [filePath: string];
  'clip:cancel': [jobId: string];
  'clip:extract': [inputPath: string, options: ClipExtractionOptions];
  'clip:show-item': [outputPath: string];
  'creative:open-media': [];
  'creative:path-to-media-url': [filePath: string];
  'creative:request-media-permission': [];
  'editor:autosave': [project: EditProject];
  'editor:clear-recent-projects': [];
  'editor:new-project': [request: NewProjectRequest];
  'editor:open-project': [];
  'editor:open-recent': [filePath: string];
  'editor:recent-projects': [];
  'editor:recover-autosaves': [];
  'editor:save-project': [request: SaveProjectRequest];
  'export:cancel': [jobId: string];
  'export:capabilities': [];
  'export:jobs': [];
  'export:presets': [];
  'export:probe': [filePath: string];
  'export:select-source': [];
  'export:start': [request: ExportRequest];
  'file:authorize-dropped': [filePath: string];
  'file:delete': [filePath: string];
  'file:exists': [filePath: string];
  'file:media-info': [filePath: string];
  'file:open': [options?: object];
  'file:open-directory': [options?: object];
  'file:open-multiple': [options?: object];
  'file:read': [filePath: string];
  'file:save': [options?: object];
  'file:scan': [dirPath: string, recursive?: boolean];
  'file:stats': [filePath: string];
  'file:write': [filePath: string, data: string | Buffer];
  'library:add-history': [mediaPath: string, position: number];
  'library:cancel-scan': [jobId: string];
  'library:choose-folder': [];
  'library:create-playlist': [name: string, items?: string[]];
  'library:delete-playlist': [id: string];
  'library:folders': [];
  'library:get-favorites': [];
  'library:get-history': [limit?: number];
  'library:get-media': [filters?: object];
  'library:get-playlists': [];
  'library:open-item': [filePath: string];
  'library:query': [request: LibraryQuery];
  'library:remove-folder': [folderPath: string, removeIndexedMedia?: boolean];
  'library:scan': [folderPath: string];
  'library:search': [query: string];
  'library:set-favorite': [filePath: string, favorite: boolean];
  'library:statistics': [];
  'library:toggle-favorite': [mediaPath: string];
  'library:update-playback': [filePath: string, position: number, duration: number, completed?: boolean];
  'library:update-playlist': [id: string, updates: object];
  'multitrack:autosave': [project: MultitrackProject];
  'multitrack:clear-recent': [];
  'multitrack:create': [name: string];
  'multitrack:open': [];
  'multitrack:open-recent': [filePath: string];
  'multitrack:recent': [];
  'multitrack:recoveries': [];
  'multitrack:save': [project: MultitrackProject, filePath?: string, saveAs?: boolean];
  'player:load': [filePath: string];
  'player:loop': [loop: boolean];
  'player:muted': [muted: boolean];
  'player:next': [];
  'player:pause': [];
  'player:play': [];
  'player:previous': [];
  'player:rate': [rate: number];
  'player:seek': [time: number];
  'player:shuffle': [shuffle: boolean];
  'player:state': [];
  'player:stop': [];
  'player:volume': [volume: number];
  'recording-region:select': [sourceId: string, aspectPreset?: RegionAspectPreset];
  'recording:append': [sessionId: string, chunk: ArrayBuffer | Uint8Array];
  'recording:begin': [request: BeginRecordingRequest];
  'recording:cancel': [sessionId: string];
  'recording:finish': [sessionId: string];
  'recording:list': [];
  'recording:pause': [sessionId: string];
  'recording:resume': [sessionId: string];
  'recording:show-item': [filePath: string];
  'settings:export': [];
  'settings:get': [key: string, defaultValue?: StructuredValue];
  'settings:get-all': [];
  'settings:import': [data: string];
  'settings:reset': [key?: string];
  'settings:set': [key: string, value: StructuredValue];
  'slideshow:autosave': [project: SlideshowProject];
  'slideshow:cancel-render': [jobId: string];
  'slideshow:clear-recent': [];
  'slideshow:create': [name: string, template: SlideshowTemplate];
  'slideshow:open': [];
  'slideshow:open-recent': [filePath: string];
  'slideshow:recent': [];
  'slideshow:recoveries': [];
  'slideshow:render': [project: SlideshowProject, format: SlideshowRenderFormat];
  'slideshow:render-jobs': [];
  'slideshow:save': [project: SlideshowProject, filePath?: string, saveAs?: boolean];
  'subtitle:delay': [delay: number];
  'subtitle:download': [subtitleId: string];
  'subtitle:enabled': [enabled: boolean];
  'subtitle:load': [filePath: string];
  'subtitle:reload': [filePath: string, delaySeconds?: number];
  'subtitle:search': [query: string, language?: string];
  'subtitle:select': [delaySeconds?: number];
  'subtitle:settings': [];
  'subtitle:style': [style: object];
  'subtitle:sync-ai': [];
  'subtitle:translate-ai': [targetLanguage: string];
  'system:get-build-info': [];
  'system:get-ipc-health': [];
  'system:info': [];
  'system:memory': [];
  'system:open-external': [url: string];
  'system:show-item': [filePath: string];
  'video:brightness': [value: number];
  'video:contrast': [value: number];
  'video:crop': [crop: VideoCrop | null];
  'video:gamma': [value: number];
  'video:hue': [value: number];
  'video:saturation': [value: number];
  'video:screenshot': [];
  'video:settings': [];
  'video:zoom': [zoom: number];
  'window:always-on-top': [alwaysOnTop: boolean];
  'window:close': [];
  'window:fullscreen': [fullscreen: boolean];
  'window:is-fullscreen': [];
  'window:is-maximized': [];
  'window:maximize': [];
  'window:minimize': [];
}

export interface InvokeResultMap {
  'ai-secure:cancel': boolean; 'ai-secure:chat': string; 'ai-secure:clear': object; 'ai-secure:configure': object; 'ai-secure:settings': object; 'ai-secure:test': object;
  'ai:analyze-media': object; 'ai:chat': string; 'ai:generate-playlist': string[]; 'ai:recommendations': object[];
  'audio-tools:analyze': object; 'audio-tools:cancel': boolean; 'audio-tools:jobs': object[]; 'audio-tools:process': object | null;
  'audio:balance': VoidResult; 'audio:dsp': VoidResult; 'audio:effect': VoidResult; 'audio:equalizer': VoidResult; 'audio:muted': VoidResult; 'audio:settings': object; 'audio:visualizer': Uint8Array; 'audio:volume': VoidResult;
  'capture:choose-default-directory': string | null; 'capture:contact-sheet': string | null; 'capture:copy-frame': VoidResult; 'capture:desktop': DesktopCaptureOperationResult; 'capture:desktop-sources': object[]; 'capture:get-default-directory': string | null; 'capture:recent': string[]; 'capture:save-burst': string[]; 'capture:save-frame': string | null; 'capture:show-item': VoidResult;
  'clip:cancel': boolean; 'clip:extract': object | null; 'clip:show-item': VoidResult;
  'creative:open-media': object | null; 'creative:path-to-media-url': string; 'creative:request-media-permission': boolean;
  'editor:autosave': string; 'editor:clear-recent-projects': VoidResult; 'editor:new-project': object; 'editor:open-project': object | null; 'editor:open-recent': object; 'editor:recent-projects': string[]; 'editor:recover-autosaves': object[]; 'editor:save-project': string | null;
  'export:cancel': boolean; 'export:capabilities': object; 'export:jobs': object[]; 'export:presets': object[]; 'export:probe': object; 'export:select-source': string | null; 'export:start': object | null;
  'file:authorize-dropped': string; 'file:delete': boolean; 'file:exists': boolean; 'file:media-info': object; 'file:open': string | null; 'file:open-directory': string | null; 'file:open-multiple': string[]; 'file:read': Uint8Array; 'file:save': string | null; 'file:scan': string[]; 'file:stats': object; 'file:write': VoidResult;
  'library:add-history': VoidResult; 'library:cancel-scan': boolean; 'library:choose-folder': object | null; 'library:create-playlist': string; 'library:delete-playlist': VoidResult; 'library:folders': object[]; 'library:get-favorites': object[]; 'library:get-history': object[]; 'library:get-media': object[]; 'library:get-playlists': object[]; 'library:open-item': object; 'library:query': object; 'library:remove-folder': VoidResult; 'library:scan': object | VoidResult; 'library:search': object[]; 'library:set-favorite': object; 'library:statistics': object; 'library:toggle-favorite': boolean; 'library:update-playback': VoidResult; 'library:update-playlist': VoidResult;
  'multitrack:autosave': string; 'multitrack:clear-recent': VoidResult; 'multitrack:create': object; 'multitrack:open': object | null; 'multitrack:open-recent': object; 'multitrack:recent': string[]; 'multitrack:recoveries': object[]; 'multitrack:save': string | null;
  'player:load': VoidResult; 'player:loop': VoidResult; 'player:muted': VoidResult; 'player:next': VoidResult; 'player:pause': VoidResult; 'player:play': VoidResult; 'player:previous': VoidResult; 'player:rate': VoidResult; 'player:seek': VoidResult; 'player:shuffle': VoidResult; 'player:state': object; 'player:stop': VoidResult; 'player:volume': VoidResult;
  'recording-region:select': object | null; 'recording:append': object; 'recording:begin': object | null; 'recording:cancel': object; 'recording:finish': object; 'recording:list': object[]; 'recording:pause': object; 'recording:resume': object; 'recording:show-item': VoidResult;
  'settings:export': string; 'settings:get': StructuredValue | undefined; 'settings:get-all': object; 'settings:import': VoidResult; 'settings:reset': VoidResult; 'settings:set': VoidResult;
  'slideshow:autosave': string; 'slideshow:cancel-render': boolean; 'slideshow:clear-recent': VoidResult; 'slideshow:create': object; 'slideshow:open': object | null; 'slideshow:open-recent': object; 'slideshow:recent': string[]; 'slideshow:recoveries': object[]; 'slideshow:render': object | null; 'slideshow:render-jobs': object[]; 'slideshow:save': string | null;
  'subtitle:delay': VoidResult; 'subtitle:download': string; 'subtitle:enabled': VoidResult; 'subtitle:load': VoidResult; 'subtitle:reload': object; 'subtitle:search': object[]; 'subtitle:select': object | null; 'subtitle:settings': object; 'subtitle:style': VoidResult; 'subtitle:sync-ai': VoidResult; 'subtitle:translate-ai': VoidResult;
  'system:get-build-info': object; 'system:get-ipc-health': object; 'system:info': object; 'system:memory': object; 'system:open-external': VoidResult; 'system:show-item': VoidResult;
  'video:brightness': VoidResult; 'video:contrast': VoidResult; 'video:crop': VoidResult; 'video:gamma': VoidResult; 'video:hue': VoidResult; 'video:saturation': VoidResult; 'video:screenshot': string; 'video:settings': object; 'video:zoom': VoidResult;
  'window:always-on-top': VoidResult; 'window:close': VoidResult; 'window:fullscreen': VoidResult; 'window:is-fullscreen': boolean; 'window:is-maximized': boolean; 'window:maximize': VoidResult; 'window:minimize': VoidResult;
}

export interface InboundPayloadMap {
  'app:renderer-ready': [];
  'capture:selector-cancel': [token: string];
  'capture:selector-complete': [selection: { token: string; x: number; y: number; width: number; height: number; activation?: 'capture' | 'action-menu' }];
  'recording:selector-cancel': [token: string];
  'recording:selector-complete': [selection: { token: string; x: number; y: number; width: number; height: number }];
}

export interface OutboundPayloadMap {
  'ai:stream': [chunk: string];
  'app:open-media': [paths: string[]];
  'audio-tools:progress': [snapshot: AudioToolJobSnapshot];
  'audio:visualizer-data': [data: Uint8Array];
  'clip:progress': [progress: FFmpegProgress];
  'export:progress': [job: ExportJobSnapshot];
  'library:scan-progress': [progress: ScanProgress];
  'player:ended': [];
  'player:error': [message: string];
  'player:state-change': [state: object];
  'player:time-update': [time: number];
  'settings:change': [key: string, value: StructuredValue | undefined, oldValue: StructuredValue | undefined];
  'slideshow:render-progress': [snapshot: SlideshowRenderSnapshot];
  'system:resume': [];
  'system:suspend': [];
  'window:fullscreen-change': [fullscreen: boolean];
  'window:resize': [size: { width: number; height: number }];
}
