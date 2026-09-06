import type { CaptureUploadConsent, GoogleImageSearchProvider } from '../../electron/creative/capture-consent-store';
import type { RetainedCaptureSummary } from '../../electron/creative/retained-capture-store';
import type {
  DesktopCaptureOperationResult,
  DesktopCaptureRequest,
  DesktopCaptureResult,
  RegionAspectPreset,
} from '../../electron/creative/region-capture-service';

interface RetainedCapture {
  summary: RetainedCaptureSummary;
  dataUrl: string;
}

const retained = new Map<string, RetainedCapture>();
const consents = new Map<string, CaptureUploadConsent>();
let mediaShimInstalled = false;

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function dataUrlInfo(dataUrl: string): Promise<{ bytes: number; sha256: string }> {
  const blob = await (await fetch(dataUrl)).blob();
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    bytes: bytes.byteLength,
    sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
  };
}

function aspectRatio(preset: RegionAspectPreset | undefined): number | null {
  if (!preset || preset === 'free') return null;
  const [width, height] = preset.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;
}

function centerCrop(width: number, height: number, preset: RegionAspectPreset | undefined) {
  const ratio = aspectRatio(preset);
  if (!ratio) return { x: 0, y: 0, width, height };
  const sourceRatio = width / height;
  if (sourceRatio > ratio) {
    const cropWidth = Math.max(1, Math.round(height * ratio));
    return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.max(1, Math.round(width / ratio));
  return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

function mediaDevicesWithDisplay(): MediaDevices & {
  getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
} {
  if (!navigator.mediaDevices) throw new Error('Android media devices are unavailable in this WebView.');
  return navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  };
}

async function displayStream(includeAudio = false): Promise<MediaStream> {
  const devices = mediaDevicesWithDisplay();
  if (typeof devices.getDisplayMedia !== 'function') {
    throw new Error('Screen capture is not supported by the installed Android System WebView. Update Android System WebView and try again.');
  }
  return devices.getDisplayMedia({ video: true, audio: includeAudio });
}

async function frameFromDisplay(request: DesktopCaptureRequest): Promise<{
  dataUrl: string;
  imageSize: { width: number; height: number };
  selection: { x: number; y: number; width: number; height: number };
}> {
  if ((request.delaySeconds ?? 0) > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, (request.delaySeconds ?? 0) * 1000));
  }
  const stream = await displayStream(false);
  const video = document.createElement('video');
  try {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Android screen capture did not deliver a video frame.')), 5_000);
        video.addEventListener('loadedmetadata', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    const sourceWidth = Math.max(1, video.videoWidth);
    const sourceHeight = Math.max(1, video.videoHeight);
    const selection = request.mode === 'region'
      ? centerCrop(sourceWidth, sourceHeight, request.aspectPreset)
      : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    const canvas = document.createElement('canvas');
    canvas.width = selection.width;
    canvas.height = selection.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Android screen capture canvas is unavailable.');
    context.drawImage(
      video,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      selection.width,
      selection.height,
    );
    const mime = request.format === 'jpeg' ? 'image/jpeg' : request.format === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = canvas.toDataURL(mime, request.format === 'png' ? undefined : (request.jpegQuality ?? 92) / 100);
    if (!dataUrl.startsWith('data:image/')) throw new Error('Android screen capture encoding failed.');
    return { dataUrl, imageSize: { width: selection.width, height: selection.height }, selection };
  } finally {
    video.pause();
    video.srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
  }
}

function installLegacyDesktopMediaShim(): void {
  if (mediaShimInstalled || !navigator.mediaDevices) return;
  const devices = mediaDevicesWithDisplay();
  if (typeof devices.getDisplayMedia !== 'function' || typeof devices.getUserMedia !== 'function') return;
  const original = devices.getUserMedia.bind(devices);
  const replacement = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
    const video = constraints?.video;
    if (video && typeof video === 'object') {
      const mandatory = (video as unknown as { mandatory?: { chromeMediaSource?: string } }).mandatory;
      if (mandatory?.chromeMediaSource === 'desktop') {
        return displayStream(Boolean(constraints?.audio));
      }
    }
    return original(constraints);
  };
  try {
    Object.defineProperty(devices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: replacement,
    });
    mediaShimInstalled = true;
  } catch {
    // Capture remains available even if the WebView prevents monkey-patching getUserMedia.
  }
}

export function installAndroidCaptureBridge(): void {
  if (window.knouxRuntime?.edition !== 'android') return;
  installLegacyDesktopMediaShim();
  const base = window.knouxCreativeAPI;
  const baseCapture = base.capture;

  const capture = {
    ...baseCapture,
    getDesktopSources: async () => [{
      id: 'screen:android',
      name: 'Android screen',
      displayId: 'android-display',
      thumbnail: '',
      appIcon: null,
    }],
    getDefaultDirectory: async () => 'Downloads',
    chooseDefaultDirectory: async () => 'Downloads',
    captureDesktop: async (request: DesktopCaptureRequest): Promise<DesktopCaptureResult | null> => {
      if (!request.save && !request.copyToClipboard) throw new Error('Choose Save or Copy before capturing.');
      const frame = await frameFromDisplay(request);
      const info = await dataUrlInfo(frame.dataUrl);
      let outputPath: string | null = null;
      if (request.save) {
        outputPath = await baseCapture.saveFrame({
          dataUrl: frame.dataUrl,
          mediaName: 'Android-screen',
          timestampSeconds: Date.now() / 1000,
          format: request.format,
        });
      }
      if (request.copyToClipboard) await baseCapture.copyFrame(frame.dataUrl);
      const now = Date.now();
      const summary: RetainedCaptureSummary = {
        id: randomId('capture'),
        sourceId: request.sourceId,
        sourceName: 'Android screen',
        displayId: 'android-display',
        format: request.format,
        width: frame.imageSize.width,
        height: frame.imageSize.height,
        outputPath,
        sha256: info.sha256,
        bytes: info.bytes,
        mimeType: request.format === 'jpeg' ? 'image/jpeg' : `image/${request.format}`,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
        pinned: false,
      };
      retained.set(summary.id, { summary, dataUrl: frame.dataUrl });
      return {
        retained: structuredClone(summary),
        sourceId: request.sourceId,
        sourceName: 'Android screen',
        displayId: 'android-display',
        mode: request.mode,
        format: request.format,
        dataUrl: frame.dataUrl,
        outputPath,
        selection: frame.selection,
        pixelSelection: frame.selection,
        imageSize: frame.imageSize,
        scale: { x: 1, y: 1 },
        openActionMenu: false,
      };
    },
    listRetained: async (): Promise<DesktopCaptureOperationResult> =>
      Array.from(retained.values(), (entry) => structuredClone(entry.summary)),
    retainedAction: async (retainedId: string, action: 'get' | 'copy' | 'pin' | 'unpin' | 'delete'): Promise<DesktopCaptureOperationResult> => {
      const entry = retained.get(retainedId);
      if (!entry) throw new Error('Retained Android capture was not found.');
      if (action === 'get') return { summary: structuredClone(entry.summary), dataUrl: entry.dataUrl };
      if (action === 'copy') {
        await baseCapture.copyFrame(entry.dataUrl);
        return structuredClone(entry.summary);
      }
      if (action === 'delete') {
        retained.delete(retainedId);
        for (const [id, consent] of consents) if (consent.retainedId === retainedId) consents.delete(id);
        return { deleted: true };
      }
      entry.summary.pinned = action === 'pin';
      entry.summary.expiresAt = new Date(Date.now() + (entry.summary.pinned ? 60 : 15) * 60 * 1000).toISOString();
      return structuredClone(entry.summary);
    },
    createUploadConsent: async (retainedId: string, provider: GoogleImageSearchProvider): Promise<DesktopCaptureOperationResult> => {
      const entry = retained.get(retainedId);
      if (!entry) throw new Error('Retained Android capture was not found.');
      const consent: CaptureUploadConsent = {
        id: randomId('consent'),
        nonce: randomId('nonce'),
        provider,
        retainedId,
        sha256: entry.summary.sha256,
        bytes: entry.summary.bytes,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      consents.set(consent.id, consent);
      return structuredClone(consent);
    },
    resolveUploadConsent: async (consentId: string, accepted: boolean): Promise<DesktopCaptureOperationResult> => {
      const consent = consents.get(consentId);
      if (!consent) throw new Error('Android image-search consent expired or was already used.');
      consents.delete(consentId);
      if (!accepted) return { declined: true };
      const url = 'https://lens.google.com/';
      await window.knouxAPI.system.openExternal(url);
      return { url } as DesktopCaptureOperationResult;
    },
  };

  window.knouxCreativeAPI = { ...base, capture } as Window['knouxCreativeAPI'];
}
