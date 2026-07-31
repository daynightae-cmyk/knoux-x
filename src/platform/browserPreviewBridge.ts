const WEB_PREVIEW_MESSAGE = 'This desktop feature is available in the Windows edition of KNOUX Player X.';

const mediaUrls = new Map<string, string>();
const recentCaptures: string[] = [];

function noopSubscription(): () => void {
  return () => undefined;
}

function pickLocalFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function safeObjectUrl(file: File): string {
  const existing = mediaUrls.get(file.name);
  if (existing) URL.revokeObjectURL(existing);
  const url = URL.createObjectURL(file);
  mediaUrls.set(file.name, url);
  return url;
}

function downloadDataUrl(dataUrl: string, filename: string): string {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  recentCaptures.unshift(filename);
  recentCaptures.splice(20);
  return filename;
}

async function copyDataUrl(dataUrl: string): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard access is unavailable in this browser.');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

function readLocalSetting<T>(key: string, fallback?: T): T {
  try {
    const raw = window.localStorage.getItem(`knoux-web-setting:${key}`);
    return raw === null ? fallback as T : JSON.parse(raw) as T;
  } catch {
    return fallback as T;
  }
}

function writeLocalSetting<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`knoux-web-setting:${key}`, JSON.stringify(value));
  } catch {
    // Browsers with blocked storage still retain the in-memory app state.
  }
}

function createCoreBridge(): Window['knouxAPI'] {
  const bridge = {
    file: {
      openFile: async () => null,
      openFiles: async () => [],
      openDirectory: async () => null,
      saveFile: async () => null,
      readFile: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      writeFile: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      deleteFile: async () => false,
      exists: async () => false,
      getStats: async () => ({ size: 0, created: new Date(0), modified: new Date(0), isDirectory: false }),
      scanDirectory: async () => [],
      getMediaInfo: async (filePath: string) => ({
        path: filePath,
        name: filePath.split(/[\\/]/).pop() ?? filePath,
        size: 0,
        format: filePath.split('.').pop() ?? '',
      }),
    },
    player: {
      load: async () => undefined,
      play: async () => undefined,
      pause: async () => undefined,
      stop: async () => undefined,
      seek: async () => undefined,
      setPlaybackRate: async () => undefined,
      setVolume: async () => undefined,
      setMuted: async () => undefined,
      setLoop: async () => undefined,
      setShuffle: async () => undefined,
      next: async () => undefined,
      previous: async () => undefined,
      getState: async () => ({
        playing: false,
        paused: true,
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
      }),
      onStateChange: noopSubscription,
      onTimeUpdate: noopSubscription,
      onEnded: noopSubscription,
      onError: noopSubscription,
    },
    audio: {
      getSettings: async () => ({ volume: 1, muted: false, balance: 0, equalizer: [], effects: {} }),
      setVolume: async () => undefined,
      setMuted: async () => undefined,
      setBalance: async () => undefined,
      setEqualizer: async () => undefined,
      setEffect: async () => undefined,
      enableDSP: async () => undefined,
      getVisualizerData: async () => new Uint8Array(),
      onVisualizerData: noopSubscription,
    },
    video: {
      getSettings: async () => ({ brightness: 1, contrast: 1, saturation: 1, hue: 0, gamma: 1 }),
      setBrightness: async () => undefined,
      setContrast: async () => undefined,
      setSaturation: async () => undefined,
      setHue: async () => undefined,
      setGamma: async () => undefined,
      takeScreenshot: async () => { throw new Error('Use the in-player capture controls in web preview.'); },
      setCrop: async () => undefined,
      setZoom: async () => undefined,
    },
    subtitle: {
      getSettings: async () => ({
        enabled: true,
        track: 0,
        delay: 0,
        fontSize: 24,
        fontColor: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.65)',
        position: 'bottom' as const,
      }),
      setEnabled: async () => undefined,
      loadSubtitle: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      searchSubtitles: async () => [],
      downloadSubtitle: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      syncWithAI: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      translateWithAI: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      setDelay: async () => undefined,
      setStyle: async () => undefined,
    },
    library: {
      scan: async () => undefined,
      getMedia: async () => [],
      getPlaylists: async () => [],
      createPlaylist: async () => `web-${Date.now()}`,
      updatePlaylist: async () => undefined,
      deletePlaylist: async () => undefined,
      addToHistory: async () => undefined,
      getHistory: async () => [],
      getFavorites: async () => [],
      toggleFavorite: async () => false,
      search: async () => [],
      getStatistics: async () => ({ totalMedia: 0, totalDuration: 0, mostPlayed: [], recentlyAdded: [] }),
    },
    settings: {
      get: async <T>(key: string, defaultValue?: T) => readLocalSetting(key, defaultValue),
      set: async <T>(key: string, value: T) => writeLocalSetting(key, value),
      getAll: async () => ({}),
      reset: async (key?: string) => {
        if (key) window.localStorage.removeItem(`knoux-web-setting:${key}`);
      },
      export: async () => JSON.stringify({ runtime: 'web-preview' }, null, 2),
      import: async () => undefined,
      onChange: noopSubscription,
    },
    window: {
      minimize: async () => undefined,
      maximize: async () => undefined,
      close: async () => undefined,
      isMaximized: async () => false,
      setFullscreen: async (fullscreen: boolean) => {
        if (fullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        if (!fullscreen && document.fullscreenElement) await document.exitFullscreen();
      },
      isFullscreen: async () => Boolean(document.fullscreenElement),
      setAlwaysOnTop: async () => undefined,
      onResize: (callback: (size: { width: number; height: number }) => void) => {
        const listener = () => callback({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', listener);
        return () => window.removeEventListener('resize', listener);
      },
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
        const listener = () => callback(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', listener);
        return () => document.removeEventListener('fullscreenchange', listener);
      },
    },
    system: {
      getInfo: async () => ({
        version: 'web-preview',
        platform: navigator.platform || 'web',
        arch: 'browser',
        electronVersion: 'not-applicable',
        chromeVersion: navigator.userAgent,
        nodeVersion: 'not-applicable',
      }),
      getMemoryUsage: async () => ({ used: 0, total: 0, percentage: 0 }),
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      showItemInFolder: async () => undefined,
      onSuspend: noopSubscription,
      onResume: noopSubscription,
    },
    app: {
      ready: () => undefined,
      onOpenMedia: noopSubscription,
    },
    ai: {
      chat: async () => { throw new Error('AI remains disabled in web preview.'); },
      analyzeMedia: async () => ({ summary: '', tags: [], mood: '', recommendations: [] }),
      generatePlaylist: async () => [],
      getRecommendations: async () => [],
      onStream: noopSubscription,
    },
  };
  return bridge as unknown as Window['knouxAPI'];
}

function createCreativeBridge(): Window['knouxCreativeAPI'] {
  const aiSettings = {
    provider: 'disabled' as const,
    model: 'gemini-3.6-flash',
    hasCredential: false,
    secureStorageAvailable: false,
  };
  const bridge = {
    media: {
      open: async () => {
        const file = await pickLocalFile('video/*,audio/*');
        if (!file) return null;
        return { filePath: file.name, mediaUrl: safeObjectUrl(file) };
      },
      toUrl: async (filePath: string) => {
        const url = mediaUrls.get(filePath);
        if (!url) throw new Error('Choose the media file again in this browser session.');
        return url;
      },
    },
    library: {
      chooseFolder: async () => null,
      folders: async () => [],
      query: async () => ({ items: [], total: 0 }),
      scan: async () => ({ jobId: 'web-preview', status: 'completed', scanned: 0, indexed: 0, errors: 0 }),
      cancelScan: async () => false,
      removeFolder: async () => undefined,
      openItem: async (filePath: string) => ({ filePath, mediaUrl: await bridge.media.toUrl(filePath) }),
      setFavorite: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      updatePlayback: async () => undefined,
      onScanProgress: noopSubscription,
    },
    capture: {
      saveFrame: async (request: { dataUrl: string; mediaName: string; timestampSeconds: number; format: string }) => {
        const extension = request.format === 'jpeg' ? 'jpg' : request.format;
        const safeName = request.mediaName.replace(/[^a-zA-Z0-9._-]+/g, '-');
        return downloadDataUrl(request.dataUrl, `${safeName}-${request.timestampSeconds.toFixed(3)}.${extension}`);
      },
      copyFrame: copyDataUrl,
      saveBurst: async (frames: Array<{ dataUrl: string; mediaName: string; timestampSeconds: number; format: string }>) =>
        frames.map((frame, index) => {
          const extension = frame.format === 'jpeg' ? 'jpg' : frame.format;
          return downloadDataUrl(frame.dataUrl, `knoux-burst-${String(index + 1).padStart(2, '0')}.${extension}`);
        }),
      createContactSheet: async () => null,
      getRecent: async () => [...recentCaptures],
      showItem: async () => undefined,
      getDefaultDirectory: async () => null,
      chooseDefaultDirectory: async () => null,
      getDesktopSources: async () => [],
    },
    recording: {
      begin: async () => null,
      append: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      pause: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      resume: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      finish: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      cancel: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      list: async () => [],
      showItem: async () => undefined,
      requestMediaPermission: async () => false,
    },
    subtitles: {
      select: async () => null,
      reload: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
    },
    editor: {
      createProject: async (name: string) => {
        const now = new Date().toISOString();
        return {
          version: 2 as const,
          id: `web-${window.crypto?.randomUUID?.() ?? Date.now()}`,
          name,
          createdAt: now,
          updatedAt: now,
          clips: [],
          markers: [],
          settings: { timelineZoom: 1 },
        };
      },
      openProject: async () => null,
      openRecent: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      saveProject: async () => null,
      autosave: async () => 'web-preview',
      recoverAutosaves: async () => [],
      recentProjects: async () => [],
      clearRecentProjects: async () => undefined,
    },
    export: {
      selectSource: async () => null,
      presets: async () => [],
      capabilities: async () => ({ available: false, ffmpegPath: null, ffprobePath: null, encoders: [], muxers: [] }),
      probe: async () => { throw new Error(WEB_PREVIEW_MESSAGE); },
      jobs: async () => [],
      start: async () => null,
      cancel: async () => false,
      onProgress: noopSubscription,
    },
    ai: {
      settings: async () => aiSettings,
      configure: async () => aiSettings,
      clear: async () => aiSettings,
      test: async () => ({ ok: false, latencyMs: 0, message: 'AI is disabled in web preview.' }),
      chat: async () => { throw new Error('AI is disabled in web preview.'); },
      cancel: async () => false,
    },
  };
  return bridge as unknown as Window['knouxCreativeAPI'];
}

export function installBrowserPreviewBridge(): void {
  if (typeof window === 'undefined') return;
  const hasCoreBridge = typeof window.knouxAPI === 'object' && window.knouxAPI !== null;
  const hasCreativeBridge = typeof window.knouxCreativeAPI === 'object' && window.knouxCreativeAPI !== null;
  if (hasCoreBridge && hasCreativeBridge) {
    document.documentElement.dataset.runtime = 'electron';
    return;
  }
  if (!hasCoreBridge) window.knouxAPI = createCoreBridge();
  if (!hasCreativeBridge) window.knouxCreativeAPI = createCreativeBridge();
  document.documentElement.dataset.runtime = 'web-preview';
}
