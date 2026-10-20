import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Play,
  Trash2,
  X,
} from 'lucide-react';

import {
  IMAGE_INPUT_EXTENSIONS,
  IMAGE_LAB_QUEUE_LIMIT,
  clampMaxEdge,
  formatBytes,
  formatForFileName,
  type ImageLabService,
  type ImageLabServiceId,
  type ImageOutputFormat,
  type ImageWatermarkPlacement,
} from '../../core/creative/imageLab';
import {
  defaultImageProcessSettings,
  encodeAndSaveImage,
  toPortableBytes,
  type ImageLabExportResult,
  type ImageProcessSettings,
} from '../../core/creative/imageLabCanvas';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { androidDocumentTitle } from '../../platform/androidSafBridge';
import { useTranslation } from '../../i18n';

interface QueueItem {
  uri: string;
  name: string;
  size: number;
  preview: string | null;
}

interface SavedResult {
  status: 'saved';
  name: string;
  export: ImageLabExportResult;
}

interface FailedResult {
  status: 'failed';
  name: string;
  error: string;
}

type ExportResult = SavedResult | FailedResult;

const FORMAT_OPTIONS: Array<{ value: ImageOutputFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

const PLACEMENTS: Array<{ value: ImageWatermarkPlacement; en: string; ar: string }> = [
  { value: 'top-left', en: 'Top left', ar: 'أعلى اليسار' },
  { value: 'top-right', en: 'Top right', ar: 'أعلى اليمين' },
  { value: 'bottom-left', en: 'Bottom left', ar: 'أسفل اليسار' },
  { value: 'bottom-right', en: 'Bottom right', ar: 'أسفل اليمين' },
  { value: 'center', en: 'Centre', ar: 'المنتصف' },
];

function mimeForName(name: string): string {
  const format = formatForFileName(name);
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function fallbackName(uri: string): string {
  const segment = uri.split(/[\\/]/).filter(Boolean).pop() ?? 'image';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function initialSettings(service: ImageLabServiceId): ImageProcessSettings {
  const base = defaultImageProcessSettings('jpeg');
  switch (service) {
    case 'convert':
      return { ...base, format: 'png' };
    case 'resize':
      return { ...base, resize: true, maxEdge: 2048 };
    case 'compress':
      return { ...base, format: 'jpeg', quality: 0.72 };
    case 'rotate':
      return base;
    case 'watermark':
      return { ...base, watermarkPlacement: 'bottom-right', watermarkOpacity: 0.72 };
    case 'strip':
      return { ...base, quality: 0.92 };
    default:
      return base;
  }
}

function suffixFor(service: ImageLabServiceId, settings: ImageProcessSettings): string {
  if (service === 'resize') return `${clampMaxEdge(settings.maxEdge)}px`;
  if (service === 'watermark') return 'watermarked';
  if (service === 'strip') return 'clean';
  if (service === 'compress') return 'compressed';
  if (service === 'rotate') return 'rotated';
  return 'converted';
}

export function ImageLabWorkspace({
  service,
  onBack,
}: {
  service: ImageLabService;
  onBack: () => void;
}): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  const [items, setItems] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<ImageProcessSettings>(() => initialSettings(service.id));
  const [results, setResults] = useState<ExportResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const savedCount = useMemo(() => results.filter((result) => result.status === 'saved').length, [results]);
  const failedCount = useMemo(() => results.filter((result) => result.status === 'failed').length, [results]);
  const lossy = settings.format !== 'png';

  const patch = (values: Partial<ImageProcessSettings>) => {
    setSettings((current) => ({ ...current, ...values }));
  };

  const addImages = async () => {
    setError(null);
    setNotice(null);
    const api = window.knouxAPI?.file;
    if (!api?.openFiles) {
      setError(arabic ? 'منتقي الملفات غير متاح في هذه البيئة.' : 'The file picker is unavailable in this environment.');
      return;
    }
    try {
      const picked = await api.openFiles({
        title: arabic ? 'اختر الصور' : 'Select images',
        filters: [{ name: 'Images', extensions: [...IMAGE_INPUT_EXTENSIONS] }],
      });
      if (!picked.length) return;
      const additions: QueueItem[] = [];
      for (const uri of picked) {
        if (items.length + additions.length >= IMAGE_LAB_QUEUE_LIMIT) break;
        if (items.some((item) => item.uri === uri) || additions.some((item) => item.uri === uri)) continue;
        const name = await androidDocumentTitle(uri).catch(() => null) ?? fallbackName(uri);
        const stats = await api.getStats(uri).catch(() => null);
        const preview = window.Capacitor?.convertFileSrc?.(uri) ?? (uri.startsWith('content://') ? null : uri);
        additions.push({ uri, name, size: stats?.size ?? 0, preview });
      }
      if (additions.length) setItems((current) => [...current, ...additions]);
      if (items.length + additions.length >= IMAGE_LAB_QUEUE_LIMIT) {
        setNotice(
          arabic
            ? `الحد الأقصى ${IMAGE_LAB_QUEUE_LIMIT} صورة في الدفعة الواحدة.`
            : `The queue accepts up to ${IMAGE_LAB_QUEUE_LIMIT} images per batch.`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const processAll = async () => {
    if (!items.length || running) return;
    setRunning(true);
    setResults([]);
    setError(null);
    setNotice(null);
    cancelRef.current = false;
    const api = window.knouxAPI?.file;
    if (!api) {
      setError(arabic ? 'جسر الملفات غير متاح.' : 'The file bridge is unavailable.');
      setRunning(false);
      return;
    }
    const collected: ExportResult[] = [];
    const suffix = suffixFor(service.id, settings);
    for (let index = 0; index < items.length; index += 1) {
      if (cancelRef.current) break;
      const item = items[index];
      setProgress({ index: index + 1, total: items.length, name: item.name });
      try {
        const payload = await api.readFile(item.uri);
        const bytes = toPortableBytes(payload);
        const exported = await encodeAndSaveImage(bytes, mimeForName(item.name), item.name, suffix, settings);
        if (!exported) {
          setNotice(
            arabic
              ? 'أُلغيت نافذة الحفظ. لم تُكتب بقية الصور.'
              : 'The save dialog was dismissed. Remaining images were left untouched.',
          );
          break;
        }
        collected.push({ status: 'saved', name: item.name, export: exported });
      } catch (cause) {
        collected.push({
          status: 'failed',
          name: item.name,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
      setResults([...collected]);
    }
    setProgress(null);
    setRunning(false);
  };

  const removeItem = (uri: string) => {
    setItems((current) => current.filter((item) => item.uri !== uri));
  };

  return (
    <section className="image-lab-workspace" aria-labelledby="image-lab-workspace-title">
      <header className="image-workspace-head">
        <button type="button" className="image-workspace-back" onClick={onBack} aria-label={arabic ? 'رجوع إلى مختبر الصور' : 'Back to image lab'}>
          <ArrowLeft size={17} aria-hidden="true" />
          {arabic ? 'الخدمات' : 'Services'}
        </button>
        <div>
          <span className="image-workspace-kicker">{arabic ? 'معالجة محلية للبكسلات' : 'LOCAL PIXEL PIPELINE'}</span>
          <h2 id="image-lab-workspace-title">{arabic ? service.titleAr : service.titleEn}</h2>
          <p>{arabic ? service.descriptionAr : service.descriptionEn}</p>
        </div>
        <span className="image-lab-count">{items.length}/{IMAGE_LAB_QUEUE_LIMIT}</span>
      </header>

      <div className="image-workspace-grid">
        <div className="image-workspace-queue">
          <div className="image-panel-heading">
            <ImageIcon size={17} aria-hidden="true" />
            <h3>{arabic ? 'صور الدفعة' : 'Batch queue'}</h3>
            <button type="button" className="image-workspace-add" onClick={addImages} disabled={running || items.length >= IMAGE_LAB_QUEUE_LIMIT}>
              <FolderPlus size={16} aria-hidden="true" />
              {arabic ? 'إضافة صور' : 'Add images'}
            </button>
          </div>

          {items.length === 0 ? (
            <div className="image-lab-empty">
              <span className="image-lab-empty-icon"><ImageIcon size={26} aria-hidden="true" /></span>
              <strong>{arabic ? 'لم تُضف صور بعد' : 'No images queued yet'}</strong>
              <p>
                {arabic
                  ? 'اختر حتى 20 صورة من مستندات الجهاز. تبقى كل صورة على جهازك وتُعالج بالمحرك المحلي.'
                  : 'Pick up to 20 images from device documents. Every file stays on the device and is processed by the local engine.'}
              </p>
              <button type="button" className="image-lab-primary" onClick={addImages} disabled={running}>
                <FolderPlus size={17} aria-hidden="true" />
                {arabic ? 'اختيار الصور' : 'Choose images'}
              </button>
            </div>
          ) : (
            <ul className="image-queue-list">
              {items.map((item, index) => {
                const active = running && progress?.name === item.name && progress.index === index + 1;
                return (
                  <li key={item.uri} className={active ? 'is-processing' : undefined}>
                    <span className="image-queue-thumb">
                      {item.preview ? <img src={item.preview} alt="" loading="lazy" /> : <ImageIcon size={18} aria-hidden="true" />}
                    </span>
                    <span className="image-queue-copy">
                      <strong title={item.name}>{item.name}</strong>
                      <small>
                        {formatForFileName(item.name).toUpperCase()}
                        {item.size > 0 ? ` · ${formatBytes(item.size)}` : ''}
                      </small>
                    </span>
                    <span className="image-queue-index">{String(index + 1).padStart(2, '0')}</span>
                    <button type="button" onClick={() => removeItem(item.uri)} disabled={running} aria-label={arabic ? `إزالة ${item.name}` : `Remove ${item.name}`}>
                      {active ? <Loader2 className="image-spin" size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {notice ? <p className="image-lab-notice" role="status">{notice}</p> : null}
          {error ? <p className="image-lab-error" role="alert"><AlertTriangle size={15} aria-hidden="true" /> {error}</p> : null}
        </div>

        <aside className="image-workspace-controls">
          <div className="image-panel-heading">
            <Play size={16} aria-hidden="true" />
            <h3>{arabic ? 'الإعدادات' : 'Settings'}</h3>
          </div>

          <div className="image-control">
            <span>{arabic ? 'صيغة الإخراج' : 'Output format'}</span>
            <NeonSelect
              value={settings.format}
              onChange={(value) => patch({ format: value as ImageOutputFormat })}
              options={FORMAT_OPTIONS}
              disabled={running}
              aria-label={arabic ? 'صيغة الإخراج' : 'Output format'}
            />
          </div>

          {lossy ? (
            <label className="image-control">
              <span>{arabic ? 'الجودة' : 'Quality'} <strong>{Math.round(settings.quality * 100)}%</strong></span>
              <input
                type="range"
                min={10}
                max={100}
                step={1}
                value={Math.round(settings.quality * 100)}
                onChange={(event) => patch({ quality: Number(event.target.value) / 100 })}
                disabled={running}
              />
            </label>
          ) : (
            <p className="image-control-note">{arabic ? 'PNG يحفظ البكسلات دون فقدان.' : 'PNG keeps every pixel lossless.'}</p>
          )}

          {service.id === 'resize' ? (
            <>
              <label className="image-control">
                <span>{arabic ? 'الحافة الأطول' : 'Longest edge'} (px)</span>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  step={1}
                  value={settings.maxEdge}
                  onChange={(event) => patch({ maxEdge: Number(event.target.value) })}
                  disabled={running}
                />
              </label>
              <label className="image-toggle">
                <input
                  type="checkbox"
                  checked={settings.allowUpscale}
                  onChange={(event) => patch({ allowUpscale: event.target.checked })}
                  disabled={running}
                />
                <span>{arabic ? 'السماح بالتكبير' : 'Allow upscaling'}</span>
              </label>
            </>
          ) : null}

          {service.id === 'rotate' ? (
            <>
              <div className="image-control">
                <span>{arabic ? 'التدوير' : 'Rotation'}</span>
                <div className="image-segmented" role="group" aria-label={arabic ? 'زاوية التدوير' : 'Rotation angle'}>
                  {[0, 90, 180, 270].map((angle) => (
                    <button
                      type="button"
                      key={angle}
                      aria-pressed={settings.rotation === angle}
                      onClick={() => patch({ rotation: angle })}
                      disabled={running}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
              </div>
              <div className="image-segmented image-segmented-wide" role="group" aria-label={arabic ? 'الانعكاس' : 'Mirror'}>
                <button type="button" aria-pressed={settings.flipHorizontal} onClick={() => patch({ flipHorizontal: !settings.flipHorizontal })} disabled={running}>
                  {arabic ? 'قلب أفقي' : 'Mirror horizontally'}
                </button>
                <button type="button" aria-pressed={settings.flipVertical} onClick={() => patch({ flipVertical: !settings.flipVertical })} disabled={running}>
                  {arabic ? 'قلب رأسي' : 'Mirror vertically'}
                </button>
              </div>
            </>
          ) : null}

          {service.id === 'watermark' ? (
            <>
              <label className="image-control">
                <span>{arabic ? 'نص العلامة' : 'Watermark text'}</span>
                <input
                  type="text"
                  value={settings.watermarkText}
                  maxLength={80}
                  placeholder={arabic ? 'مثال: KNOUX' : 'e.g. KNOUX'}
                  onChange={(event) => patch({ watermarkText: event.target.value })}
                  disabled={running}
                />
              </label>
              <div className="image-control">
                <span>{arabic ? 'الموضع' : 'Placement'}</span>
                <NeonSelect
                  value={settings.watermarkPlacement}
                  onChange={(value) => patch({ watermarkPlacement: value as ImageWatermarkPlacement })}
                  options={PLACEMENTS.map((placement) => ({
                    value: placement.value,
                    label: arabic ? placement.ar : placement.en,
                  }))}
                  disabled={running}
                  aria-label={arabic ? 'الموضع' : 'Placement'}
                />
              </div>
              <label className="image-control">
                <span>{arabic ? 'الشفافية' : 'Opacity'} <strong>{Math.round(settings.watermarkOpacity * 100)}%</strong></span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={1}
                  value={Math.round(settings.watermarkOpacity * 100)}
                  onChange={(event) => patch({ watermarkOpacity: Number(event.target.value) / 100 })}
                  disabled={running}
                />
              </label>
            </>
          ) : null}

          <p className="image-lab-save-note">
            {arabic
              ? 'يُفتح منتقي الحفظ لكل صورة، ثم يُتحقق من البكسلات على الجهاز بعد الكتابة.'
              : 'Each image opens the system save picker, then its pixels are verified on device after writing.'}
          </p>

          <button type="button" className="image-lab-primary image-lab-process" onClick={processAll} disabled={!items.length || running}>
            {running ? <Loader2 className="image-spin" size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
            {running
              ? (arabic ? 'جارٍ المعالجة…' : 'Processing…')
              : (arabic ? `معالجة ${items.length || ''} صورة` : `Process ${items.length || ''} image${items.length === 1 ? '' : 's'}`)}
          </button>
          {running ? (
            <button type="button" className="image-lab-secondary" onClick={() => { cancelRef.current = true; }}>
              {arabic ? 'إيقاف بعد الصورة الحالية' : 'Stop after current image'}
            </button>
          ) : null}
          {running && progress ? (
            <p className="image-lab-progress" role="status" aria-live="polite">
              {progress.index}/{progress.total} · {progress.name}
            </p>
          ) : null}
        </aside>
      </div>

      {results.length ? (
        <section className="image-lab-results" aria-label={arabic ? 'نتائج التصدير' : 'Export results'}>
          <div className="image-panel-heading">
            <CheckCircle2 size={17} aria-hidden="true" />
            <h3>{arabic ? 'النتائج' : 'Results'}</h3>
            <span className="image-lab-count">{savedCount} ✓ · {failedCount} ✕</span>
          </div>
          <ul>
            {results.map((result) => (
              <li key={`${result.name}-${result.status}`} className={result.status === 'saved' ? 'is-saved' : 'is-failed'}>
                <span className="image-result-icon">
                  {result.status === 'saved'
                    ? <CheckCircle2 size={17} aria-hidden="true" />
                    : <AlertTriangle size={17} aria-hidden="true" />}
                </span>
                <span className="image-result-copy">
                  <strong>{result.name}</strong>
                  {result.status === 'saved' ? (
                    <>
                      <small>
                        {result.export.filename} · {result.export.width}×{result.export.height} · {formatBytes(result.export.bytes)}
                      </small>
                      <code>{result.export.uri}</code>
                    </>
                  ) : (
                    <small>{result.error}</small>
                  )}
                </span>
                {result.status === 'saved' ? (
                  <span className={`image-durable-badge ${result.export.durable ? 'is-durable' : 'is-temporary'}`}>
                    {result.export.durable ? (arabic ? 'دائم' : 'Durable') : (arabic ? 'مسار ملف' : 'File path')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {items.length && !running ? (
            <button type="button" className="image-lab-secondary" onClick={() => setResults([])}>
              <Trash2 size={15} aria-hidden="true" />
              {arabic ? 'مسح النتائج' : 'Clear results'}
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
