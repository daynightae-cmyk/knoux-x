export type CapabilityStatus = 'supported' | 'unsupported' | 'degraded' | 'requires-permission' | 'unavailable';
export type CapabilityProvider = 'android-native' | 'android-webview' | 'electron' | 'ffmpeg' | 'browser';
export type PlatformKind = 'android' | 'windows' | 'web';

export interface CapabilityLimits {
  inputFormats?: readonly string[];
  outputFormats?: readonly string[];
  encoders?: readonly string[];
  decoders?: readonly string[];
  maxSafeResolution?: string;
  pip?: boolean;
  mediaSession?: boolean;
  subtitles?: boolean;
  screenCapture?: boolean;
  microphone?: boolean;
  systemAudio?: boolean;
  saf?: boolean;
  wakeLock?: boolean;
  sharing?: boolean;
  ai?: boolean;
  network?: boolean;
  gpu?: boolean;
  modelAvailability?: 'local' | 'optional' | 'none';
}

export interface PlatformCapability {
  status: CapabilityStatus;
  provider: CapabilityProvider;
  limits: CapabilityLimits;
  reason?: string;
}

export interface PlatformCapabilities {
  platform: PlatformKind;
  player: PlatformCapability;
  mediaLibrary: PlatformCapability;
  queue: PlatformCapability;
  imageEdit: PlatformCapability;
  beauty: PlatformCapability;
  videoEdit: PlatformCapability;
  slideshow: PlatformCapability;
  audioLab: PlatformCapability;
  screenRecording: PlatformCapability;
  playerCapture: PlatformCapability;
  wakeLock: PlatformCapability;
  pictureInPicture: PlatformCapability;
  mediaSession: PlatformCapability;
  saf: PlatformCapability;
  gifExport: PlatformCapability;
  ai: PlatformCapability;
}

export interface CapabilityEnvironment {
  platform?: PlatformKind;
  screenWakeLock?: boolean;
  online?: boolean;
  aiConfigured?: boolean;
  faceModelAvailable?: boolean;
}

const VIDEO_INPUTS = ['mp4', 'm4v', 'webm', 'mov', 'mkv'] as const;
const AUDIO_INPUTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] as const;
const IMAGE_INPUTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const;

export function detectPlatformKind(): PlatformKind {
  if (typeof window !== 'undefined' && window.knouxRuntime?.edition === 'android') return 'android';
  if (typeof window !== 'undefined' && typeof window.knouxAPI === 'object' && document.documentElement.dataset.runtime !== 'web-preview') return 'windows';
  return 'web';
}

function supported(provider: CapabilityProvider, limits: CapabilityLimits = {}): PlatformCapability {
  return { status: 'supported', provider, limits };
}

function degraded(provider: CapabilityProvider, reason: string, limits: CapabilityLimits = {}): PlatformCapability {
  return { status: 'degraded', provider, reason, limits };
}

function permission(provider: CapabilityProvider, limits: CapabilityLimits = {}): PlatformCapability {
  return { status: 'requires-permission', provider, limits };
}

function unsupported(provider: CapabilityProvider, reason: string, limits: CapabilityLimits = {}): PlatformCapability {
  return { status: 'unsupported', provider, reason, limits };
}

function unavailable(provider: CapabilityProvider, reason: string, limits: CapabilityLimits = {}): PlatformCapability {
  return { status: 'unavailable', provider, reason, limits };
}

export function getPlatformCapabilities(environment: CapabilityEnvironment = {}): PlatformCapabilities {
  const platform = environment.platform ?? detectPlatformKind();
  const online = environment.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  const screenWakeLock = environment.screenWakeLock ?? (
    typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean((navigator as Navigator & { wakeLock?: unknown }).wakeLock)
  );

  if (platform === 'android') {
    return {
      platform,
      player: supported('android-webview', {
        inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS],
        pip: true,
        mediaSession: true,
        subtitles: true,
        maxSafeResolution: 'device-dependent',
      }),
      mediaLibrary: permission('android-native', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS, ...IMAGE_INPUTS], saf: true }),
      queue: supported('android-webview'),
      imageEdit: supported('android-webview', { inputFormats: IMAGE_INPUTS, outputFormats: ['png', 'jpeg'], modelAvailability: 'local' }),
      beauty: environment.faceModelAvailable === false
        ? degraded('android-webview', 'Local face model is unavailable; manual image tools remain available.', { modelAvailability: 'none' })
        : supported('android-webview', { inputFormats: IMAGE_INPUTS, outputFormats: ['png', 'jpeg'], modelAvailability: 'local' }),
      videoEdit: supported('android-webview', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS, ...IMAGE_INPUTS], maxSafeResolution: 'device-dependent' }),
      slideshow: supported('android-webview', { inputFormats: IMAGE_INPUTS, maxSafeResolution: 'device-dependent' }),
      audioLab: supported('android-webview', {
        inputFormats: AUDIO_INPUTS,
        outputFormats: ['wav'],
        encoders: ['pcm_s16le'],
        decoders: ['web-audio-supported'],
      }),
      screenRecording: permission('android-native', { screenCapture: true, microphone: true, systemAudio: false }),
      playerCapture: supported('android-webview', { outputFormats: ['png', 'jpeg', 'webp'] }),
      wakeLock: screenWakeLock
        ? supported('android-webview', { wakeLock: true })
        : degraded('android-webview', 'This Android WebView does not expose the Screen Wake Lock API.', { wakeLock: false }),
      pictureInPicture: supported('android-native', { pip: true }),
      mediaSession: supported('android-native', { mediaSession: true }),
      saf: permission('android-native', { saf: true }),
      gifExport: unsupported('android-webview', 'Animated GIF export is not implemented by the Android local renderer.', { outputFormats: [] }),
      ai: !online
        ? unavailable('browser', 'AI provider is offline.', { ai: false, network: false })
        : environment.aiConfigured
          ? supported('browser', { ai: true, network: true })
          : unavailable('browser', 'AI provider is not configured.', { ai: false, network: true }),
    };
  }

  if (platform === 'windows') {
    return {
      platform,
      player: supported('electron', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS], pip: true, mediaSession: true, subtitles: true }),
      mediaLibrary: supported('electron', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS, ...IMAGE_INPUTS] }),
      queue: supported('electron'),
      imageEdit: supported('electron', { inputFormats: IMAGE_INPUTS, outputFormats: ['png', 'jpeg', 'webp'], modelAvailability: 'local' }),
      beauty: supported('electron', { inputFormats: IMAGE_INPUTS, outputFormats: ['png', 'jpeg', 'webp'], modelAvailability: 'local', gpu: true }),
      videoEdit: supported('ffmpeg', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS, ...IMAGE_INPUTS], outputFormats: ['mp4', 'webm', 'mov'] }),
      slideshow: supported('ffmpeg', { inputFormats: IMAGE_INPUTS, outputFormats: ['mp4', 'webm'] }),
      audioLab: supported('ffmpeg', { inputFormats: AUDIO_INPUTS, outputFormats: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] }),
      screenRecording: permission('electron', { screenCapture: true, microphone: true, systemAudio: true }),
      playerCapture: supported('electron', { outputFormats: ['png', 'jpeg', 'webp'] }),
      wakeLock: supported('electron', { wakeLock: true }),
      pictureInPicture: supported('electron', { pip: true }),
      mediaSession: supported('electron', { mediaSession: true }),
      saf: unsupported('electron', 'Android Storage Access Framework is not applicable on Windows.', { saf: false }),
      gifExport: degraded('ffmpeg', 'GIF availability depends on the active export surface and encoder contract.', { outputFormats: ['gif'] }),
      ai: !online
        ? unavailable('browser', 'AI provider is offline.', { ai: false, network: false })
        : environment.aiConfigured
          ? supported('browser', { ai: true, network: true })
          : unavailable('browser', 'AI provider is not configured.', { ai: false, network: true }),
    };
  }

  return {
    platform,
    player: degraded('browser', 'Browser preview has a constrained local-media bridge.', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS] }),
    mediaLibrary: degraded('browser', 'Persistent filesystem access is browser-dependent.', { inputFormats: [...VIDEO_INPUTS, ...AUDIO_INPUTS, ...IMAGE_INPUTS] }),
    queue: supported('browser'),
    imageEdit: degraded('browser', 'Browser preview export is constrained.', { inputFormats: IMAGE_INPUTS }),
    beauty: degraded('browser', 'Local model availability depends on preview assets.', { modelAvailability: 'optional' }),
    videoEdit: unavailable('browser', 'Packaged renderer is required.'),
    slideshow: unavailable('browser', 'Packaged renderer is required.'),
    audioLab: unavailable('browser', 'Packaged audio renderer is required.'),
    screenRecording: unavailable('browser', 'Native screen recording is unavailable in preview.'),
    playerCapture: degraded('browser', 'Frame capture depends on browser media-origin restrictions.'),
    wakeLock: screenWakeLock ? supported('browser', { wakeLock: true }) : unavailable('browser', 'Screen Wake Lock API is unavailable.', { wakeLock: false }),
    pictureInPicture: degraded('browser', 'PiP depends on browser support.', { pip: true }),
    mediaSession: degraded('browser', 'MediaSession depends on browser support.', { mediaSession: true }),
    saf: unsupported('browser', 'Android Storage Access Framework is unavailable.', { saf: false }),
    gifExport: unsupported('browser', 'GIF export is not exposed in preview.'),
    ai: !online ? unavailable('browser', 'AI provider is offline.', { ai: false, network: false }) : unavailable('browser', 'AI provider is not configured.', { ai: false, network: true }),
  };
}

export function supportedAudioOutputFormats(environment: CapabilityEnvironment = {}): readonly string[] {
  return getPlatformCapabilities(environment).audioLab.limits.outputFormats ?? [];
}

export function canExposeCapability(capability: PlatformCapability): boolean {
  return capability.status === 'supported' || capability.status === 'degraded' || capability.status === 'requires-permission';
}
