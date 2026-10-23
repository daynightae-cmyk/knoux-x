import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Image as ImageIcon,
  RotateCw,
  Sliders,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';

type EditorState = 'EMPTY' | 'PICKING' | 'DECODING' | 'READY' | 'EDITING' | 'EXPORTING' | 'ERROR';
type ToolTab = 'adjust' | 'filters' | 'transform';

interface ImageAdjustments {
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  temperature: number; // -50 to 50
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  filter: string; // 'none' | 'vivid' | 'dramatic' | 'mono' | 'warm' | 'cool' | 'vintage' | 'cyber'
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
  filter: 'none',
};

const FILTERS = [
  { id: 'none', label: 'Original' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'dramatic', label: 'Dramatic' },
  { id: 'mono', label: 'Mono' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'cyber', label: 'Cyber' },
];

/* The photo editor is one of the few mobile screens that still shipped every
 * label in English (directive §16.1). Source strings stay English so thrown
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
  'Could not encode the edited canvas as JPEG.': 'تعذّر ترميز اللوحة المُعدَّلة بصيغة JPEG.',
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
};

function arabicLabel(text: string): string {
  if (COPY_AR[text]) return COPY_AR[text];
  const size = text.match(/^Export verification failed: expected (\d+)×(\d+), decoded (\d+)×(\d+)\.$/);
  if (size) return `فشل التحقق من التصدير: المتوقع ${size[1]}×${size[2]}، والفعلي ${size[3]}×${size[4]}.`;
  const drift = text.match(/^Export verification failed: decoded pixel probe drifted by ([\d.]+) levels\.$/);
  if (drift) return `فشل التحقق من التصدير: انحراف عيّنة البكسل بمقدار ${drift[1]} مستوى.`;
  return text;
}


const EXPORT_PROBE_SIZE = 8;
const MAX_JPEG_PROBE_ERROR = 34;

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
function readPhotoDraft(): { photo: ActivePhotoState; adjustments: ImageAdjustments } | null {
  try {
    const value = JSON.parse(localStorage.getItem(PHOTO_DRAFT_KEY) || 'null');
    if (!value?.photo?.sourceUri?.startsWith('content://') || !value.adjustments) return null;
    return value;
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
): Promise<void> {
  if (!await window.knouxAPI.file.exists(targetUri)) {
    throw new Error('The exported photo was not found after writing.');
  }

  const storedPayload = await window.knouxAPI.file.readFile(targetUri);
  const storedBytes = toPortableBytes(storedPayload);
  if (storedBytes.byteLength < 4) throw new Error('The exported photo is empty or truncated.');

  const decoded = await decodeStoredImage(storedBytes, 'image/jpeg');
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
    if (!Number.isFinite(error) || error > MAX_JPEG_PROBE_ERROR) {
      throw new Error(`Export verification failed: decoded pixel probe drifted by ${error.toFixed(1)} levels.`);
    }
  } finally {
    decoded.close();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the edited canvas as JPEG.'));
    }, 'image/jpeg', 0.92);
  });
}

export const MobileImageEditorView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const t = (text: string): string => (ar ? arabicLabel(text) : text);
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);

  const [editorState, setEditorState] = useState<EditorState>('EMPTY');
  const [activeTab, setActiveTab] = useState<ToolTab>('adjust');
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(() => readPhotoDraft()?.adjustments ?? DEFAULT_ADJUSTMENTS);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [draftWarning, setDraftWarning] = useState<string>('');
  const [photoInfo, setPhotoInfo] = useState<ActivePhotoState | null>(() => persistentPhotoState ?? readPhotoDraft()?.photo ?? null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImageRef.current;
    const container = containerRef.current;
    if (!canvas || !img || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width || container.clientWidth || 360;
    const containerHeight = rect.height || container.clientHeight || 480;

    if (containerWidth <= 0 || containerHeight <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, containerHeight);

    const isRotated90 = adjustments.rotation % 180 !== 0;
    const imgW = isRotated90 ? img.naturalHeight : img.naturalWidth;
    const imgH = isRotated90 ? img.naturalWidth : img.naturalHeight;

    if (imgW <= 0 || imgH <= 0) return;

    const scale = Math.min((containerWidth - 24) / imgW, (containerHeight - 24) / imgH, 1);
    const renderW = img.naturalWidth * scale;
    const renderH = img.naturalHeight * scale;
    const drawX = containerWidth / 2;
    const drawY = containerHeight / 2;

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate((adjustments.rotation * Math.PI) / 180);
    ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);

    const b = 100 + adjustments.brightness;
    const c = 100 + adjustments.contrast;
    const s = 100 + adjustments.saturation;

    let filterStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    if (adjustments.filter === 'mono') filterStr += ' grayscale(100%)';
    else if (adjustments.filter === 'vintage') filterStr += ' sepia(60%)';
    else if (adjustments.filter === 'vivid') filterStr += ' saturate(140%) contrast(110%)';
    else if (adjustments.filter === 'dramatic') filterStr += ' contrast(135%) brightness(90%)';
    else if (adjustments.filter === 'cyber') filterStr += ' hue-rotate(180deg) saturate(130%)';
    else if (adjustments.filter === 'warm') filterStr += ' sepia(25%) saturate(110%)';
    else if (adjustments.filter === 'cool') filterStr += ' hue-rotate(30deg) brightness(105%)';

    ctx.filter = filterStr;
    ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);
    ctx.restore();
  }, [adjustments]);

  // Decode Uint8Array / Blob bytes into HTMLImageElement
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
    /* A draft that the WebView refused must not be presented as a saved edit
     * session; the notice is rendered because ERROR is not reached here. */
    try {
      const payload = JSON.stringify({ photo: photoInfo, adjustments });
      window.localStorage.setItem(PHOTO_DRAFT_KEY, payload);
      if (window.localStorage.getItem(PHOTO_DRAFT_KEY) !== payload) {
        setDraftWarning('This photo is open, but the edit draft could not be saved on this device.');
      } else {
        setDraftWarning('');
      }
    } catch {
      setDraftWarning('This photo is open, but the edit draft could not be saved on this device.');
    }
  }, [adjustments, editorState, photoInfo]);

  // Use ResizeObserver for viewport layout
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (editorState === 'READY' || editorState === 'EDITING') {
        renderCanvas();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [editorState, renderCanvas]);

  useEffect(() => {
    if (editorState === 'READY' || editorState === 'EDITING') {
      renderCanvas();
    }
  }, [editorState, renderCanvas]);

  const pickImageFile = async () => {
    setEditorState('PICKING');
    try {
      const uri = await window.knouxAPI.file.openFile({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
      });

      if (uri) {
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
      const offscreen = document.createElement('canvas');
      const isRotated90 = adjustments.rotation % 180 !== 0;
      const fullW = isRotated90 ? img.naturalHeight : img.naturalWidth;
      const fullH = isRotated90 ? img.naturalWidth : img.naturalHeight;

      offscreen.width = fullW;
      offscreen.height = fullH;

      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not create the full-resolution photo renderer.');

      ctx.translate(fullW / 2, fullH / 2);
      ctx.rotate((adjustments.rotation * Math.PI) / 180);
      ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);

      const b = 100 + adjustments.brightness;
      const c = 100 + adjustments.contrast;
      const s = 100 + adjustments.saturation;

      let filterStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
      if (adjustments.filter === 'mono') filterStr += ' grayscale(100%)';
      else if (adjustments.filter === 'vintage') filterStr += ' sepia(60%)';
      else if (adjustments.filter === 'vivid') filterStr += ' saturate(140%) contrast(110%)';
      else if (adjustments.filter === 'dramatic') filterStr += ' contrast(135%) brightness(90%)';
      else if (adjustments.filter === 'cyber') filterStr += ' hue-rotate(180deg) saturate(130%)';
      else if (adjustments.filter === 'warm') filterStr += ' sepia(25%) saturate(110%)';
      else if (adjustments.filter === 'cool') filterStr += ' hue-rotate(30deg) brightness(105%)';

      ctx.filter = filterStr;
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

      const expectedProbe = canvasProbe(offscreen);
      const blob = await canvasToJpeg(offscreen);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const defaultPath = `KNOUX_Photo_${Date.now()}.jpg`;
      const targetUri = await window.knouxAPI.file.saveFile({
        defaultPath,
        filters: [{ name: 'JPEG Image', extensions: ['jpg'] }],
      });

      if (!targetUri) {
        setEditorState('READY');
        return;
      }

      await writePortableBytes(targetUri, bytes);
      await validateSavedImage(targetUri, fullW, fullH, expectedProbe);

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

  return (
    <section className="knoux-mobile-creative-surface kmc-photo-editor" data-component="MobileImageEditorView" data-state={editorState}>
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
            <button type="button" className="kmc-export-button" aria-label={t('Export Photo')} onClick={handleExport}>
              <Download size={17} /> {t('Export')}
            </button>
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
            <canvas ref={canvasRef} className="kmc-photo-canvas" />
            {photoInfo && (
              <span className="kmc-photo-badge">
                {photoInfo.naturalWidth} × {photoInfo.naturalHeight}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Mobile Tool Dock */}
      {(editorState === 'READY' || editorState === 'EDITING') && (
        <div className="kmc-photo-tool-dock">
          <div className="kmc-tool-tabs">
            <button
              type="button"
              className={activeTab === 'adjust' ? 'active' : ''}
              onClick={() => setActiveTab('adjust')}
            >
              <Sliders size={16} /> {t('Adjust')}
            </button>
            <button
              type="button"
              className={activeTab === 'filters' ? 'active' : ''}
              onClick={() => setActiveTab('filters')}
            >
              <Wand2 size={16} /> {t('Filters')}
            </button>
            <button
              type="button"
              className={activeTab === 'transform' ? 'active' : ''}
              onClick={() => setActiveTab('transform')}
            >
              <RotateCw size={16} /> {t('Transform')}
            </button>
          </div>

          <div className="kmc-tool-panel">
            {activeTab === 'adjust' && (
              <div className="kmc-adjust-sliders">
                <div className="kmc-slider-group">
                  <label>
                    <Sun size={14} /> {t('Brightness')} ({adjustments.brightness})
                  </label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.brightness}
                    onChange={(e) => {
                      setAdjustments({ ...adjustments, brightness: Number(e.target.value) });
                      setEditorState('EDITING');
                    }}
                  />
                </div>

                <div className="kmc-slider-group">
                  <label>
                    <Sparkles size={14} /> {t('Contrast')} ({adjustments.contrast})
                  </label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.contrast}
                    onChange={(e) => {
                      setAdjustments({ ...adjustments, contrast: Number(e.target.value) });
                      setEditorState('EDITING');
                    }}
                  />
                </div>

                <div className="kmc-slider-group">
                  <label>
                    <Wand2 size={14} /> {t('Saturation')} ({adjustments.saturation})
                  </label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={adjustments.saturation}
                    onChange={(e) => {
                      setAdjustments({ ...adjustments, saturation: Number(e.target.value) });
                      setEditorState('EDITING');
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'filters' && (
              <div className="kmc-filter-grid">
                {FILTERS.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={`kmc-filter-chip ${adjustments.filter === f.id ? 'active' : ''}`}
                    onClick={() => {
                      setAdjustments({ ...adjustments, filter: f.id });
                      setEditorState('EDITING');
                    }}
                  >
                    {t(f.label)} {adjustments.filter === f.id && <Check size={12} />}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'transform' && (
              <div className="kmc-transform-buttons">
                <button
                  type="button"
                  className="kmc-icon-action-btn"
                  onClick={() => {
                    setAdjustments({ ...adjustments, rotation: (adjustments.rotation + 90) % 360 });
                    setEditorState('EDITING');
                  }}
                >
                  <RotateCw size={18} /> {t('Rotate 90°')}
                </button>
                <button
                  type="button"
                  className={`kmc-icon-action-btn ${adjustments.flipH ? 'active' : ''}`}
                  onClick={() => {
                    setAdjustments({ ...adjustments, flipH: !adjustments.flipH });
                    setEditorState('EDITING');
                  }}
                >
                  <FlipHorizontal size={18} /> {t('Flip H')}
                </button>
                <button
                  type="button"
                  className={`kmc-icon-action-btn ${adjustments.flipV ? 'active' : ''}`}
                  onClick={() => {
                    setAdjustments({ ...adjustments, flipV: !adjustments.flipV });
                    setEditorState('EDITING');
                  }}
                >
                  <FlipVertical size={18} /> {t('Flip V')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
