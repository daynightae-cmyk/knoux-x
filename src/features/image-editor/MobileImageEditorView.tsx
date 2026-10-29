import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Columns2,
  Download,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Redo2,
  Undo2,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { mobileCopy } from '../../components/mobile/mobileCopyCatalog';
import { useAppStore } from '../../store/appStore';
import {
  DEFAULT_PHOTO_EDIT,
  DEFAULT_PHOTO_OUTPUT,
  applyPhotoEditToPixels,
  cssFilterChain,
  needsPixelPasses,
  normalizePhotoEdit,
  photoExportOptions,
  photoFormatExtension,
  photoFrameLayout,
  photoOutputGeometry,
  type PhotoEditSpec,
  type PhotoOutputSpec,
} from '../../core/creative/photoEditModel';

import { MobilePhotoToolDock, type PhotoTab } from './MobilePhotoToolDock';

/**
 * KNOUX-X — ANDROID PHOTO EDITOR
 *
 * Non-destructive by construction: the source bytes are decoded once, every
 * visible change is a number inside `PhotoEditSpec`, the viewport renders that
 * spec onto a proxy copy, and the export runs the identical pass list on the
 * full-resolution source, then reads the written file back, decodes it again and
 * pixel-probes it before anything is claimed. Originals are never overwritten.
 *
 * Drafts saved by the previous four-number build still open: `normalizePhotoEdit`
 * upgrades them — including the white-balance value the old editor stored,
 * exposed and then never applied.
 */

type EditorState = 'EMPTY' | 'PICKING' | 'DECODING' | 'READY' | 'EDITING' | 'EXPORTING' | 'ERROR';

const HISTORY_LIMIT = 40;
/** Past this, the blur-based passes need more memory than a budget phone has. */
const MAX_EXPORT_PIXELS = 12_000_000;

/* The photo editor ships English source strings (directive §16.1) so thrown
 * bridge messages remain greppable; Arabic is resolved at render time. */
const COPY_AR: Record<string, string> = {
  'Back to home': 'رجوع إلى الرئيسية',
  'PHOTO EDITOR': 'محرّر الصور',
  'Open Photo': 'فتح صورة',
  'Export Photo': 'تصدير الصورة',
  Export: 'تصدير',
  'Select a Photo': 'اختر صورة',
  'Choose any JPEG, PNG, or WebP photo from your device to begin editing.':
    'اختر أي صورة JPEG أو PNG أو WebP من جهازك لبدء التحرير.',
  'Choose Photo': 'اختر صورة',
  'Decoding Photo...': 'جارٍ فك ترميز الصورة…',
  'Error Loading Photo': 'خطأ في تحميل الصورة',
  'Try Again': 'حاول مجددًا',
  Adjust: 'ضبط',
  Filters: 'مرشحات',
  Transform: 'تحويل',
  Brightness: 'السطوع',
  Contrast: 'التباين',
  Saturation: 'التشبع',
  'Rotate 90°': 'تدوير ٩٠°',
  'Flip H': 'قلب أفقي',
  'Flip V': 'قلب رأسي',
  'Photo Exported': 'تم تصدير الصورة',
  'Export Failed': 'فشل التصدير',
  'Write or verification failed.': 'فشحت الكتابة أو التحقق.',
  'Failed to decode image bytes.': 'تعذّر فك ترميز بيانات الصورة.',
  'Could not read file payload.': 'تعذّر قراءة محتوى الملف.',
  'Could not read file from file input.': 'تعذّر قراءة الملف من مُدخِل الملفات.',
  'Could not create the export verification canvas.': 'تعذّر إنشاء لوحة التحقق من التصدير.',
  'The exported JPEG could not be decoded after saving.': 'تعذّر فك ترميز JPEG المُصدَّرة بعد الحفظ.',
  'The exported photo was not found after writing.': 'لم يُعثر على الصورة المُصدَّرة بعد الكتابة.',
  'The exported photo is empty or truncated.': 'الصورة المُصدَّرة فارغة أو مبتورة.',
  'Could not inspect the decoded export.': 'تعذّر فحص المُصدَّر بعد فك الترميز.',
  'Could not create the full-resolution photo renderer.': 'تعذّر إنشاء مُصيّر الصورة كامل الدقة.',
  'Unsupported binary file payload.': 'حمولة الملف الثنائية غير مدعومة.',
  'This photo is open, but the edit draft could not be saved on this device.':
    'هذه الصورة مفتوحة، لكن تعذّر حفظ مسودة التعديلات على هذا الجهاز.',
  'Original': 'أصلية',
  Vivid: 'حيوي',
  Dramatic: 'درامي',
  Mono: 'أحادي',
  Warm: 'دافئ',
  Cool: 'بارد',
  Vintage: 'عتيق',
  Cyber: 'سايبر',
  Undo: 'تراجع',
  Redo: 'إعادة',
  After: 'بعد',
  'Hold for original': 'اضغط مع الاستمرار للأصل',
};

function arabicLabel(text: string): string {
  if (COPY_AR[text]) return COPY_AR[text];
  const size = text.match(/^Export verification failed: expected (\d+)×(\d+), decoded (\d+)×(\d+)\.$/);
  if (size) return `فشل التحقق من التصدير: المتوقع ${size[1]}×${size[2]}، والفعلي ${size[3]}×${size[4]}.`;
  const drift = text.match(/^Export verification failed: decoded pixel probe drifted by ([\d.]+) levels\.$/);
  if (drift) return `فشل التحقق من التصدير: انحراف عيّنة البكسل بمقدار ${drift[1]} مستوى.`;
  const encode = text.match(/^Could not encode the edited canvas as ([\w/+.:-]+)\.$/);
  if (encode) return `تعذّر ترميز اللوحة المُعدَّلة بصيغة ${encode[1]}.`;
  return mobileCopy(text, 'ar');
}

const EXPORT_PROBE_SIZE = 8;
/** JPEG and WebP are lossy, so the probe tolerates codec noise... */
const MAX_JPEG_PROBE_ERROR = 34;
/** ...while PNG is exact, and a drift there means a real defect. */
const MAX_PNG_PROBE_ERROR = 6;

interface ActivePhotoState {
  sourceUri: string;
  sourceName: string;
  mime: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

let persistentPhotoState: ActivePhotoState | null = null;
const PHOTO_DRAFT_KEY = 'knoux:android:photo-draft:v1';

interface PhotoDraft {
  photo: ActivePhotoState;
  adjustments: PhotoEditSpec;
  output: PhotoOutputSpec;
}

function readPhotoDraft(): PhotoDraft | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(PHOTO_DRAFT_KEY) || 'null');
    if (!value?.photo?.sourceUri?.startsWith('content://') || !value.adjustments) return null;
    return {
      photo: value.photo,
      // A draft from the old flat shape is upgraded here rather than rejected.
      adjustments: normalizePhotoEdit(value.adjustments),
      output: { ...DEFAULT_PHOTO_OUTPUT, ...(value.output ?? {}) },
    };
  } catch { return null; }
}

function toPortableBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data && typeof data === 'object' && 'buffer' in data) {
    const value = (data as { buffer?: ArrayBufferLike }).buffer;
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  }
  throw new TypeError('Unsupported binary file payload.');
}

async function writePortableBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  const writeFile = window.knouxAPI.file.writeFile as unknown as (
    path: string,
    data: Uint8Array,
  ) => Promise<void>;
  await writeFile(filePath, bytes);
}

function canvasProbe(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const probe = document.createElement('canvas');
  probe.width = EXPORT_PROBE_SIZE;
  probe.height = EXPORT_PROBE_SIZE;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create the export verification canvas.');
  context.drawImage(canvas, 0, 0, EXPORT_PROBE_SIZE, EXPORT_PROBE_SIZE);
  return context.getImageData(0, 0, EXPORT_PROBE_SIZE, EXPORT_PROBE_SIZE).data;
}

function meanProbeError(expected: Uint8ClampedArray, actual: Uint8ClampedArray): number {
  if (expected.length !== actual.length || expected.length === 0) return Number.POSITIVE_INFINITY;
  let error = 0;
  let channels = 0;
  for (let index = 0; index < expected.length; index += 4) {
    error += Math.abs(expected[index] - actual[index]);
    error += Math.abs(expected[index + 1] - actual[index + 1]);
    error += Math.abs(expected[index + 2] - actual[index + 2]);
    channels += 3;
  }
  return channels > 0 ? error / channels : Number.POSITIVE_INFINITY;
}

async function decodeStoredImage(bytes: Uint8Array, mime: string): Promise<DecodedImageSource> {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error('The exported JPEG could not be decoded after saving.'));
      candidate.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function validateSavedImage(
  targetUri: string,
  expectedWidth: number,
  expectedHeight: number,
  expectedProbe: Uint8ClampedArray,
  mime: string,
  tolerance: number,
): Promise<void> {
  if (!await window.knouxAPI.file.exists(targetUri)) {
    throw new Error('The exported photo was not found after writing.');
  }

  const storedPayload = await window.knouxAPI.file.readFile(targetUri);
  const storedBytes = toPortableBytes(storedPayload);
  if (storedBytes.byteLength < 4) throw new Error('The exported photo is empty or truncated.');

  const decoded = await decodeStoredImage(storedBytes, mime);
  try {
    if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
      throw new Error(
        `Export verification failed: expected ${expectedWidth}×${expectedHeight}, decoded ${decoded.width}×${decoded.height}.`,
      );
    }

    const probe = document.createElement('canvas');
    probe.width = EXPORT_PROBE_SIZE;
    probe.height = EXPORT_PROBE_SIZE;
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not inspect the decoded export.');
    context.drawImage(decoded.source, 0, 0, EXPORT_PROBE_SIZE, EXPORT_PROBE_SIZE);
    const actualProbe = context.getImageData(0, 0, EXPORT_PROBE_SIZE, EXPORT_PROBE_SIZE).data;
    const error = meanProbeError(expectedProbe, actualProbe);
    if (!Number.isFinite(error) || error > tolerance) {
      throw new Error(`Export verification failed: decoded pixel probe drifted by ${error.toFixed(1)} levels.`);
    }
  } finally {
    decoded.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number | undefined): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Could not encode the edited canvas as ${mimeType}.`));
    }, mimeType, quality);
  });
}

/** Geometry used while the compare button is held: the untouched frame. */
const PRISTINE_GEOMETRY = {
  rotation: 0,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  flipHorizontal: false,
  flipVertical: false,
};

export const MobileImageEditorView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const t = useCallback((text: string): string => (ar ? arabicLabel(text) : text), [ar]);
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);

  const draft = useMemo(() => readPhotoDraft(), []);
  const [editorState, setEditorState] = useState<EditorState>('EMPTY');
  const [activeTab, setActiveTab] = useState<PhotoTab>('adjust');
  const [spec, setSpec] = useState<PhotoEditSpec>(() => draft?.adjustments ?? DEFAULT_PHOTO_EDIT);
  const [output, setOutput] = useState<PhotoOutputSpec>(() => draft?.output ?? DEFAULT_PHOTO_OUTPUT);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [draftWarning, setDraftWarning] = useState<string>('');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const [photoInfo, setPhotoInfo] = useState<ActivePhotoState | null>(() => persistentPhotoState ?? draft?.photo ?? null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const undoRef = useRef<PhotoEditSpec[]>([]);
  const redoRef = useRef<PhotoEditSpec[]>([]);
  const gestureRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const frameRef = useRef<number | null>(null);

  const renderCanvas = useCallback((options?: { original?: boolean }) => {
    const canvas = canvasRef.current;
    const img = loadedImageRef.current;
    const container = containerRef.current;
    if (!canvas || !img || !container) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width || container.clientWidth || 360;
    const containerHeight = rect.height || container.clientHeight || 480;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    const showOriginal = options?.original === true;
    const layout = photoFrameLayout(
      img.naturalWidth,
      img.naturalHeight,
      showOriginal ? { ...spec.geometry, ...PRISTINE_GEOMETRY } : spec.geometry,
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fitScale = Math.min((containerWidth - 24) / layout.rotatedWidth, (containerHeight - 24) / layout.rotatedHeight, 1);
    const proxyWidth = Math.max(1, Math.round(layout.rotatedWidth * fitScale));
    const proxyHeight = Math.max(1, Math.round(layout.rotatedHeight * fitScale));

    canvas.width = Math.max(1, Math.round(proxyWidth * dpr));
    canvas.height = Math.max(1, Math.round(proxyHeight * dpr));
    canvas.style.width = `${proxyWidth}px`;
    canvas.style.height = `${proxyHeight}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, proxyWidth, proxyHeight);
    context.save();
    context.translate(proxyWidth / 2, proxyHeight / 2);
    context.rotate((layout.angle * Math.PI) / 180);
    context.scale(
      (showOriginal ? 1 : spec.geometry.flipHorizontal ? -1 : 1) * fitScale,
      (showOriginal ? 1 : spec.geometry.flipVertical ? -1 : 1) * fitScale,
    );
    // The CSS half of the grade — the same string the exporter sets.
    context.filter = showOriginal ? 'none' : cssFilterChain(spec);
    context.drawImage(img, layout.sx, layout.sy, layout.sw, layout.sh, -layout.sw / 2, -layout.sh / 2, layout.sw, layout.sh);
    context.restore();
    context.filter = 'none';

    // The pixel half runs on this proxy; export repeats it at full resolution.
    if (!showOriginal && needsPixelPasses(spec)) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      applyPhotoEditToPixels({ data: pixels.data, width: canvas.width, height: canvas.height }, spec, 1);
      context.putImageData(pixels, 0, 0);
    }
  }, [spec]);

  /* Latest-wins scheduling: a thumb fires dozens of events per second and only
   * the last one is worth rasterising on a phone. */
  const scheduleRender = useCallback((options?: { original?: boolean }) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      renderCanvas(options);
    });
  }, [renderCanvas]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // Decode Uint8Array / Blob bytes into an HTMLImageElement.
  const decodeAndRenderBytes = useCallback(
    (bytes: Uint8Array, mime: string, sourceUri: string, name: string) => {
      setEditorState('DECODING');

      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }

      const blob = new Blob([bytes.slice().buffer], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrlRef.current = blobUrl;

      const img = new Image();
      img.onload = () => {
        loadedImageRef.current = img;
        const info: ActivePhotoState = {
          sourceUri,
          sourceName: name,
          mime,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        };
        persistentPhotoState = info;
        setPhotoInfo(info);
        setEditorState('READY');
      };
      img.onerror = () => {
        setErrorMessage('Failed to decode image bytes.');
        setEditorState('ERROR');
      };
      img.src = blobUrl;
    },
    []
  );

  const loadPhotoFromUri = useCallback(
    async (uri: string) => {
      setEditorState('DECODING');
      try {
        const rawData = await window.knouxAPI.file.readFile(uri);
        const bytes = toPortableBytes(rawData);

        const info = uri.startsWith('content://') ? await window.knouxAPI.file.getMediaInfo(uri) : null;
        const ext = (info?.name || uri).split('.').pop()?.toLowerCase() || 'jpg';
        let mime = 'image/jpeg';
        if (ext === 'png') mime = 'image/png';
        else if (ext === 'webp') mime = 'image/webp';
        else if (ext === 'gif') mime = 'image/gif';
        else if (ext === 'bmp') mime = 'image/bmp';

        if (info?.format?.startsWith('image/')) mime = info.format;
        const name = info?.name || uri.split(/[/\\]/).pop() || 'photo.jpg';
        decodeAndRenderBytes(bytes, mime, uri, name);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not read file payload.');
        setEditorState('ERROR');
      }
    },
    [decodeAndRenderBytes]
  );

  useEffect(() => {
    const previous = persistentPhotoState ?? readPhotoDraft()?.photo;
    if (previous && editorState === 'EMPTY') {
      void loadPhotoFromUri(previous.sourceUri);
    }
  }, [editorState, loadPhotoFromUri]);

  useEffect(() => {
    if (!photoInfo?.sourceUri.startsWith('content://') || !['READY', 'EDITING'].includes(editorState)) return;
    /* A draft the WebView refused must not be presented as a saved edit session;
     * the notice renders without reaching the ERROR state. */
    try {
      const payload = JSON.stringify({ photo: photoInfo, adjustments: spec, output });
      window.localStorage.setItem(PHOTO_DRAFT_KEY, payload);
      if (window.localStorage.getItem(PHOTO_DRAFT_KEY) !== payload) {
        setDraftWarning('This photo is open, but the edit draft could not be saved on this device.');
      } else {
        setDraftWarning('');
      }
    } catch {
      setDraftWarning('This photo is open, but the edit draft could not be saved on this device.');
    }
  }, [editorState, output, photoInfo, spec]);

  // Use ResizeObserver for viewport layout
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(() => {
      if (editorState === 'READY' || editorState === 'EDITING') {
        scheduleRender({ original: compareOriginal });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [compareOriginal, editorState, scheduleRender]);

  useEffect(() => {
    if (editorState === 'READY' || editorState === 'EDITING') {
      scheduleRender({ original: compareOriginal });
    }
  }, [compareOriginal, editorState, scheduleRender, spec]);

  /**
   * One edit is one undo step, however many events a drag fires. The gesture key
   * names the control; repeats inside the window collapse into that single step.
   */
  const applySpec = useCallback((next: PhotoEditSpec, gesture?: string): void => {
    const now = Date.now();
    const sameGesture = Boolean(gesture) && gestureRef.current.key === gesture && now - gestureRef.current.at < 600;
    gestureRef.current = { key: gesture ?? '', at: now };
    setSpec((current) => {
      if (!sameGesture) {
        undoRef.current.push(current);
        if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
        redoRef.current = [];
      }
      return next;
    });
    setEditorState((state) => (state === 'READY' ? 'EDITING' : state));
    setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const syncDepth = (): void => setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });

  const undo = useCallback((): void => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    setSpec((current) => {
      redoRef.current.push(current);
      if (redoRef.current.length > HISTORY_LIMIT) redoRef.current.shift();
      return previous;
    });
    syncDepth();
  }, []);

  const redo = useCallback((): void => {
    const next = redoRef.current.pop();
    if (!next) return;
    setSpec((current) => {
      undoRef.current.push(current);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      return next;
    });
    syncDepth();
  }, []);

  const resetAll = useCallback((): void => {
    applySpec({
      tone: { ...DEFAULT_PHOTO_EDIT.tone },
      detail: { ...DEFAULT_PHOTO_EDIT.detail },
      effects: { ...DEFAULT_PHOTO_EDIT.effects },
      geometry: { ...DEFAULT_PHOTO_EDIT.geometry, crop: { ...DEFAULT_PHOTO_EDIT.geometry.crop } },
      look: 'none',
      lookStrength: DEFAULT_PHOTO_EDIT.lookStrength,
    }, 'reset-all');
  }, [applySpec]);

  const autoPolish = useCallback((): void => {
    applySpec({
      ...spec,
      tone: { ...spec.tone, exposure: 8, contrast: 10, saturation: 4, vibrance: 18, highlights: -10, shadows: 8, whites: 4, blacks: -4 },
      detail: { ...spec.detail, sharpen: 22, clarity: 12 },
    }, 'auto-polish');
  }, [applySpec, spec]);

  const pickImageFile = async () => {
    setEditorState('PICKING');
    try {
      const uri = await window.knouxAPI.file.openFile({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
      });

      if (uri) {
        undoRef.current = [];
        redoRef.current = [];
        syncDepth();
        await loadPhotoFromUri(uri);
        return;
      }
      setEditorState(loadedImageRef.current ? 'READY' : 'EMPTY');
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      if (editorState === 'PICKING') setEditorState(loadedImageRef.current ? 'READY' : 'EMPTY');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      decodeAndRenderBytes(bytes, file.type || 'image/jpeg', file.name, file.name);
    } catch {
      setErrorMessage('Could not read file from file input.');
      setEditorState('ERROR');
    }
  };

  const handleExport = async () => {
    const img = loadedImageRef.current;
    if (!img) return;

    setEditorState('EXPORTING');
    try {
      const layout = photoFrameLayout(img.naturalWidth, img.naturalHeight, spec.geometry);
      const sourcePixels = layout.rotatedWidth * layout.rotatedHeight;
      /* A budget phone cannot hold the blur buffers for a 50MP frame, so the
       * export is capped — and the badge already shows the size that results. */
      const capped: PhotoOutputSpec = sourcePixels > MAX_EXPORT_PIXELS && (!output.longEdge || output.longEdge ** 2 > MAX_EXPORT_PIXELS)
        ? { ...output, longEdge: Math.round(Math.sqrt(MAX_EXPORT_PIXELS)) }
        : output;
      const geometry = photoOutputGeometry(layout, capped);
      const contentScale = geometry.width / layout.rotatedWidth;

      const stage = document.createElement('canvas');
      stage.width = geometry.width;
      stage.height = geometry.height;
      const context = stage.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create the full-resolution photo renderer.');

      context.fillStyle = '#000000';
      context.fillRect(0, 0, stage.width, stage.height);
      context.save();
      context.translate(stage.width / 2, stage.height / 2);
      context.rotate((layout.angle * Math.PI) / 180);
      context.scale(
        (spec.geometry.flipHorizontal ? -1 : 1) * contentScale,
        (spec.geometry.flipVertical ? -1 : 1) * contentScale,
      );
      context.filter = cssFilterChain(spec);
      context.drawImage(img, layout.sx, layout.sy, layout.sw, layout.sh, -layout.sw / 2, -layout.sh / 2, layout.sw, layout.sh);
      context.restore();
      context.filter = 'none';

      if (needsPixelPasses(spec)) {
        const pixels = context.getImageData(0, 0, stage.width, stage.height);
        applyPhotoEditToPixels({ data: pixels.data, width: stage.width, height: stage.height }, spec, 1);
        context.putImageData(pixels, 0, 0);
      }

      const expectedProbe = canvasProbe(stage);
      const { mimeType, quality } = photoExportOptions(capped);
      const blob = await canvasToBlob(stage, mimeType, quality);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const defaultPath = `KNOUX_Photo_${Date.now()}.${photoFormatExtension(capped.format)}`;
      const targetUri = await window.knouxAPI.file.saveFile({
        defaultPath,
        filters: [{ name: mimeType, extensions: [photoFormatExtension(capped.format)] }],
      });

      if (!targetUri) {
        setEditorState('READY');
        return;
      }

      await writePortableBytes(targetUri, bytes);
      await validateSavedImage(
        targetUri,
        geometry.width,
        geometry.height,
        expectedProbe,
        mimeType,
        mimeType === 'image/png' ? MAX_PNG_PROBE_ERROR : MAX_JPEG_PROBE_ERROR,
      );

      addNotification({
        type: 'success',
        title: t('Photo Exported'),
        message: ar
          ? `حُفظت الصورة وأُعيد فتحها وفُكّ ترميزها وتحقّق منها في ${targetUri}`
          : `Saved, reopened, decoded & verified at ${targetUri}`,
        duration: 5000,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: t('Export Failed'),
        message: t(err instanceof Error ? err.message : 'Write or verification failed.'),
        duration: 5000,
      });
    } finally {
      setEditorState('READY');
    }
  };

  const graded = cssFilterChain(spec) !== 'none' || needsPixelPasses(spec);
  const outputGeometry = useMemo(() => {
    if (!photoInfo) return null;
    return photoOutputGeometry(photoFrameLayout(photoInfo.naturalWidth, photoInfo.naturalHeight, spec.geometry), output);
  }, [output, photoInfo, spec.geometry]);

  return (
    <section className="knoux-mobile-creative-surface kmc-photo-editor" data-component="MobileImageEditorView" data-state={editorState} dir={ar ? 'rtl' : 'ltr'}>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button kx-back" aria-label={t('Back to home')} onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>

        <div className="kmc-brand-lockup">
          <BrandMark size={32} />
          <div>
            <strong>KNOUX <span>X</span></strong>
            <small>{photoInfo ? photoInfo.sourceName : t('PHOTO EDITOR')}</small>
          </div>
        </div>

        <div className="kmc-topbar-actions">
          <button type="button" className="kmc-round-button" aria-label={t('Open Photo')} onClick={pickImageFile}>
            <FolderOpen size={19} />
          </button>

          {(editorState === 'READY' || editorState === 'EDITING') && (
            <>
              <button
                type="button"
                className="kmc-round-button"
                aria-label={t('Undo')}
                onClick={undo}
                disabled={historyDepth.undo === 0}
                data-undo-depth={historyDepth.undo}
              >
                <Undo2 size={18} />
              </button>
              <button
                type="button"
                className="kmc-round-button"
                aria-label={t('Redo')}
                onClick={redo}
                disabled={historyDepth.redo === 0}
                data-redo-depth={historyDepth.redo}
              >
                <Redo2 size={18} />
              </button>
              <button
                type="button"
                className="kmc-round-button"
                aria-label={t('Hold for original')}
                aria-pressed={compareOriginal}
                onPointerDown={() => setCompareOriginal(true)}
                onPointerUp={() => setCompareOriginal(false)}
                onPointerLeave={() => setCompareOriginal(false)}
                onPointerCancel={() => setCompareOriginal(false)}
              >
                <Columns2 size={18} />
              </button>
              <button type="button" className="kmc-export-button" aria-label={t('Export Photo')} onClick={handleExport}>
                <Download size={17} /> {t('Export')}
              </button>
            </>
          )}
        </div>
      </header>

      {draftWarning && (
        <div className="kmc-photo-notice" role="alert">{t(draftWarning)}</div>
      )}

      {/* Main Canvas Viewport Area */}
      <div className="kmc-photo-canvas-container" ref={containerRef}>
        {editorState === 'EMPTY' && (
          <div className="kmc-photo-empty-state">
            <div className="kmc-empty-icon-ring">
              <ImageIcon size={48} />
            </div>
            <h3>{t('Select a Photo')}</h3>
            <p>{t('Choose any JPEG, PNG, or WebP photo from your device to begin editing.')}</p>
            <button type="button" className="kmc-primary-action-btn" onClick={pickImageFile}>
              <FolderOpen size={18} /> {t('Choose Photo')}
            </button>
          </div>
        )}

        {editorState === 'DECODING' && (
          <div className="kmc-photo-loading-state">
            <div className="kmc-spinner" />
            <span>{t('Decoding Photo...')}</span>
          </div>
        )}

        {editorState === 'ERROR' && (
          <div className="kmc-photo-empty-state" role="alert">
            <h3>{t('Error Loading Photo')}</h3>
            <p>{t(errorMessage)}</p>
            <button type="button" className="kmc-primary-action-btn" onClick={pickImageFile}>
              {t('Try Again')}
            </button>
          </div>
        )}

        {(editorState === 'READY' || editorState === 'EDITING' || editorState === 'EXPORTING') && (
          <div className="kmc-photo-viewport">
            <canvas ref={canvasRef} className="kmc-photo-canvas" data-compare={compareOriginal ? 'original' : 'edited'} />
            {photoInfo && (
              <span className="kmc-photo-badge">
                <bdi>{outputGeometry ? `${outputGeometry.width} × ${outputGeometry.height}` : `${photoInfo.naturalWidth} × ${photoInfo.naturalHeight}`}</bdi>
                {graded && !compareOriginal ? <em><Eye size={11} aria-hidden="true" /> {t('After')}</em> : null}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Mobile Tool Dock */}
      {(editorState === 'READY' || editorState === 'EDITING') && (
        <div className="kmc-photo-tool-dock">
          <MobilePhotoToolDock
            spec={spec}
            output={output}
            sourceWidth={photoInfo?.naturalWidth ?? 0}
            sourceHeight={photoInfo?.naturalHeight ?? 0}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSpecChange={applySpec}
            onOutputChange={setOutput}
            onAutoPolish={autoPolish}
            onResetAll={resetAll}
          />
        </div>
      )}
    </section>
  );
};
