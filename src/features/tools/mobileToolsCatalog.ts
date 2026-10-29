import {
  Camera,
  Clapperboard,
  Columns2,
  Cpu,
  Crop,
  Download,
  Film,
  FolderLock,
  FolderOpen,
  Gauge,
  Grid2x2,
  Images,
  Library,
  ListMusic,
  Mic2,
  Music2,
  Palette,
  Play,
  Radar,
  Ruler,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

import type { ViewType } from '../../store/appStore';
import type { PlatformCapabilities, PlatformCapability } from '../../platform/platformCapabilities';

/**
 * KNOUX-X — TOOLS CATALOG
 *
 * The product claim is "everything a user searches for across five apps, in one".
 * A claim like that needs an index rather than a menu, so this file lists every
 * service, where it lives (an existing route, or a panel built here), and which
 * platform capability proves it can actually run on this device.
 *
 * Nothing here invents a feature: `route` entries are real views already wired in
 * App.tsx, `panel` entries are the components in MobileToolPanels.tsx, and the
 * contract test fails if an entry points at something that does not exist.
 */

export type ToolCategory = 'studios' | 'video' | 'photo' | 'audio' | 'files' | 'utilities';

/** Every capability the hub can ask about, minus the platform tag itself. */
export type ToolCapabilityKey = Exclude<keyof PlatformCapabilities, 'platform'>;

export type ToolPanelId =
  | 'frames'
  | 'metadata'
  | 'palette'
  | 'grid'
  | 'merge'
  | 'audioExtract'
  | 'resolution';

export type ToolAccent = 'violet' | 'cyan' | 'gold' | 'rose' | 'mint';

export interface ToolEntry {
  id: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  accent: ToolAccent;
  category: ToolCategory;
  target: { kind: 'route'; view: ViewType } | { kind: 'panel'; panel: ToolPanelId };
  /** Which platform capability decides whether this is usable right now. */
  capability?: ToolCapabilityKey;
  /** Search terms, both languages, so the hub filter never misses. */
  tags: string[];
  /** Feature cards get a hero treatment; plain list entries do not. */
  featured?: boolean;
}

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory; label: string; hint: string }> = [
  { id: 'studios', label: 'Creative studios', hint: 'Full workspaces' },
  { id: 'video', label: 'Video tools', hint: 'Cut, frame, extract' },
  { id: 'photo', label: 'Photo tools', hint: 'Retouch, crop, inspect' },
  { id: 'audio', label: 'Audio tools', hint: 'Trim, merge, normalise' },
  { id: 'files', label: 'Files & conversion', hint: 'Format and size' },
  { id: 'utilities', label: 'Utilities', hint: 'Quick answers' },
];

export const TOOL_ENTRIES: readonly ToolEntry[] = [
  /* ---------------------------------------------------------- studios */
  {
    id: 'video-studio',
    label: 'Video Editor',
    blurb: 'Multitrack timeline with crop, colour, keyframes and transitions.',
    icon: Clapperboard,
    accent: 'violet',
    category: 'studios',
    target: { kind: 'route', view: 'editor' },
    capability: 'videoEdit',
    tags: ['editor', 'timeline', 'multitrack', 'مونتاج', 'فيديو', 'استوديو'],
    featured: true,
  },
  {
    id: 'photo-editor',
    label: 'Photo Editor',
    blurb: 'Exposure, white balance, detail, crop and lossless export.',
    icon: SlidersHorizontal,
    accent: 'cyan',
    category: 'studios',
    target: { kind: 'route', view: 'image-editor' },
    capability: 'imageEdit',
    tags: ['photo', 'image', 'adjust', 'تحرير', 'صور'],
    featured: true,
  },
  {
    id: 'beauty',
    label: 'Beauty Retouch',
    blurb: 'Face-aware skin, eyes and makeup layers, on device.',
    icon: WandSparkles,
    accent: 'rose',
    category: 'studios',
    target: { kind: 'route', view: 'image-studio' },
    capability: 'beauty',
    tags: ['beauty', 'retouch', 'face', 'جمال', 'بورتريه'],
    featured: true,
  },
  {
    id: 'slideshow',
    label: 'Photos to Video',
    blurb: 'Turn a folder of memories into a scored video.',
    icon: Images,
    accent: 'gold',
    category: 'studios',
    target: { kind: 'route', view: 'slideshow' },
    capability: 'slideshow',
    tags: ['slideshow', 'photos', 'montage', 'شرائح', 'ذكريات'],
    featured: true,
  },
  {
    id: 'audio-lab',
    label: 'Audio tools',
    blurb: 'Trim, merge and normalise sound without leaving the app.',
    icon: ListMusic,
    accent: 'mint',
    category: 'studios',
    target: { kind: 'route', view: 'audio-tools' },
    capability: 'audioLab',
    tags: ['audio', 'merge', 'trim', 'صوت', 'موسيقى'],
    featured: true,
  },
  {
    id: 'image-lab',
    label: 'Image Lab',
    blurb: 'Batch convert, resize, compress, watermark and strip metadata.',
    icon: Crop,
    accent: 'cyan',
    category: 'files',
    target: { kind: 'route', view: 'image-tools' },
    capability: 'imageEdit',
    tags: ['batch', 'convert', 'resize', 'compress', 'watermark', 'تحويل', 'ضغط'],
    featured: true,
  },

  /* ------------------------------------------------------------ video */
  {
    id: 'frames',
    label: 'Frame extractor',
    blurb: 'Pull any moment out of a video as a full-resolution image.',
    icon: Film,
    accent: 'violet',
    category: 'video',
    target: { kind: 'panel', panel: 'frames' },
    tags: ['frame', 'still', 'thumbnail', 'لقطة', 'إطار'],
    featured: true,
  },
  {
    id: 'player',
    label: 'Player',
    blurb: 'Local-first playback with subtitles, queue and picture-in-picture.',
    icon: Play,
    accent: 'gold',
    category: 'video',
    target: { kind: 'route', view: 'player' },
    capability: 'player',
    tags: ['play', 'watch', 'video', 'مشغل', 'مشاهدة'],
  },
  {
    id: 'recording',
    label: 'Screen recorder',
    blurb: 'Native screen capture straight into the timeline.',
    icon: Camera,
    accent: 'rose',
    category: 'video',
    target: { kind: 'route', view: 'recording' },
    capability: 'screenRecording',
    tags: ['record', 'screen', 'capture', 'تسجيل', 'شاشة'],
  },
  {
    id: 'clip-export',
    label: 'Export centre',
    blurb: 'Every render job, its real progress and where it landed.',
    icon: Download,
    accent: 'mint',
    category: 'video',
    target: { kind: 'route', view: 'export' },
    tags: ['export', 'render', 'save', 'تصدير', 'حفظ'],
  },

  /* ------------------------------------------------------------ photo */
  {
    id: 'metadata',
    label: 'Photo inspector',
    blurb: 'Read the real size, format and camera data stored inside a photo.',
    icon: ScanSearch,
    accent: 'cyan',
    category: 'photo',
    target: { kind: 'panel', panel: 'metadata' },
    tags: ['exif', 'metadata', 'camera', 'بيانات', 'كاميرا'],
    featured: true,
  },
  {
    id: 'palette',
    label: 'Colour picker',
    blurb: 'Turn any photo into a shareable palette and check its contrast.',
    icon: Palette,
    accent: 'violet',
    category: 'photo',
    target: { kind: 'panel', panel: 'palette' },
    tags: ['colour', 'palette', 'contrast', 'wcag', 'ألوان', 'تباين'],
    featured: true,
  },
  {
    id: 'grid',
    label: 'Grid splitter',
    blurb: 'Cut one photo into a seamless grid for social feeds.',
    icon: Grid2x2,
    accent: 'gold',
    category: 'photo',
    target: { kind: 'panel', panel: 'grid' },
    tags: ['grid', 'split', 'instagram', 'شبكة', 'قص'],
  },
  {
    id: 'merge',
    label: 'Photo merge',
    blurb: 'Stack photos side by side or on top of each other in seconds.',
    icon: Columns2,
    accent: 'rose',
    category: 'photo',
    target: { kind: 'panel', panel: 'merge' },
    tags: ['merge', 'collage', 'combine', 'دمج', 'تجميع'],
  },
  {
    id: 'capture',
    label: 'Frame capture',
    blurb: 'Grab, burst and contact-sheet frames from anything you play.',
    icon: Sparkles,
    accent: 'mint',
    category: 'photo',
    target: { kind: 'route', view: 'capture' },
    capability: 'playerCapture',
    tags: ['capture', 'burst', 'screenshot', 'التقاط'],
  },

  /* ------------------------------------------------------------ audio */
  {
    id: 'audio-extract',
    label: 'Audio extractor',
    blurb: 'Lift the soundtrack out of a video and keep it as WAV.',
    icon: Music2,
    accent: 'violet',
    category: 'audio',
    target: { kind: 'panel', panel: 'audioExtract' },
    tags: ['audio', 'extract', 'wav', 'sound', 'استخراج', 'صوت'],
    featured: true,
  },
  {
    id: 'mic-tools',
    label: 'Voice tools',
    blurb: 'Record, trim and normalise a voice take on the device.',
    icon: Mic2,
    accent: 'rose',
    category: 'audio',
    target: { kind: 'route', view: 'audio-tools' },
    capability: 'audioLab',
    tags: ['voice', 'mic', 'record', 'صوت', 'تسجيل'],
  },

  /* ------------------------------------------------------------ files */
  {
    id: 'library',
    label: 'Media library',
    blurb: 'Organise what is on the phone: folders, favourites, playback.',
    icon: Library,
    accent: 'cyan',
    category: 'files',
    target: { kind: 'route', view: 'library' },
    capability: 'mediaLibrary',
    tags: ['library', 'files', 'organise', 'مكتبة', 'ملفات'],
  },
  {
    id: 'vault',
    label: 'Private vault',
    blurb: 'Encrypted, on-device storage for the media you keep to yourself.',
    icon: FolderLock,
    accent: 'gold',
    category: 'files',
    target: { kind: 'route', view: 'vault' },
    tags: ['vault', 'private', 'encrypt', 'خزنة', 'خاص'],
  },
  {
    id: 'queue',
    label: 'Playback queue',
    blurb: 'Line up what plays next and keep the order you chose.',
    icon: ListMusic,
    accent: 'mint',
    category: 'files',
    target: { kind: 'route', view: 'queue' },
    capability: 'queue',
    tags: ['queue', 'playlist', ' قائمة', 'ترتيب'],
  },

  /* -------------------------------------------------------- utilities */
  {
    id: 'resolution',
    label: 'Resolution calculator',
    blurb: 'Check whether a size fits a platform and what it weighs.',
    icon: Ruler,
    accent: 'violet',
    category: 'utilities',
    target: { kind: 'panel', panel: 'resolution' },
    tags: ['resolution', 'size', 'aspect', 'دقة', 'حجم'],
  },
  {
    id: 'settings',
    label: 'Settings',
    blurb: 'Theme, language, motion and storage — the app shaped to you.',
    icon: Gauge,
    accent: 'cyan',
    category: 'utilities',
    target: { kind: 'route', view: 'settings' },
    tags: ['settings', 'theme', 'language', 'إعدادات'],
  },
  {
    id: 'diagnostics',
    label: 'Bridge health',
    blurb: 'See which native capabilities installed, and what refused.',
    icon: Radar,
    accent: 'rose',
    category: 'utilities',
    target: { kind: 'route', view: 'settings' },
    tags: ['diagnostics', 'health', 'bridge', 'تشخيص'],
  },
  {
    id: 'cleanup',
    label: 'Storage sense',
    blurb: 'Find the exports and drafts that are eating the phone.',
    icon: Trash2,
    accent: 'mint',
    category: 'utilities',
    target: { kind: 'route', view: 'library' },
    tags: ['storage', 'cleanup', 'space', 'مساحة', 'تنظيف'],
  },
  {
    id: 'files-open',
    label: 'Open a file',
    blurb: 'Jump straight to any folder on the device.',
    icon: FolderOpen,
    accent: 'gold',
    category: 'utilities',
    target: { kind: 'route', view: 'library' },
    capability: 'saf',
    tags: ['open', 'file', 'browse', 'فتح', 'ملف'],
  },
  {
    id: 'chip',
    label: 'Device capability',
    blurb: 'What this phone can encode, decode and display, measured live.',
    icon: Cpu,
    accent: 'violet',
    category: 'utilities',
    target: { kind: 'route', view: 'settings' },
    tags: ['device', 'capability', 'codec', 'جهاز', 'إمكانيات'],
  },
];

export type CapabilityState = 'supported' | 'degraded' | 'permission' | 'off';

/**
 * Maps a capability record onto the four states a card can show. A card never
 * claims more than the bridge reported for this exact device.
 */
export function capabilityState(capability: PlatformCapability | undefined): { state: CapabilityState; reason?: string } {
  if (!capability) return { state: 'supported' };
  if (capability.status === 'supported') return { state: 'supported' };
  if (capability.status === 'degraded' || capability.status === 'unavailable') return { state: 'degraded', reason: capability.reason };
  if (capability.status === 'requires-permission') return { state: 'permission', reason: capability.reason };
  return { state: 'off', reason: capability.reason };
}

export function findTool(id: string): ToolEntry | undefined {
  return TOOL_ENTRIES.find((entry) => entry.id === id);
}
