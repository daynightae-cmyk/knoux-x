import React, { useCallback, useState } from 'react';
import { ArrowLeft, ImagePlus, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';

import { MobileBeautyCanvas } from './MobileBeautyCanvas';
import './mobileBeautyStudio.css';

interface RetouchAssetImport {
  assetRef: string;
  proxyRef: string;
  sourceHash: string;
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  mime: string;
}

const COPY_AR: Record<string, string> = {
  'Back to home': 'رجوع إلى الرئيسية',
  'BEAUTY STUDIO': 'استوديو الجمال',
  Opening: 'جارٍ الفتح',
  'Change Photo': 'تغيير الصورة',
  'Open Photo': 'فتح صورة',
  'Open a portrait': 'افتح صورة بورتريه',
  'Face analysis stays on this device. No portrait upload is required for local beauty tools.':
    'تحليل الوجه يتم على جهازك. لا يلزم رفع الصورة لأي من أدوات الجمال المحلية.',
  'Choose photo': 'اختر صورة',
  'Opening device…': 'جارٍ الفتح من الجهاز…',
  'LOCAL BEAUTY PROJECT': 'مشروع جمال محلي',
  'Local image': 'صورة محلية',
  'Beauty image preview': 'معاينة صورة الجمال',
  'Could not open photo': 'تعذّر فتح الصورة',
  'Open portrait': 'فتح صورة بورتريه',
  'Choose another JPG, PNG, WebP or BMP image and try again.':
    'اختر صورة أخرى بصيغة JPG أو PNG أو WebP أو BMP وحاول مجددًا.',
};

export const MobileBeautyRetouchView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const t = useCallback((text: string): string => (ar ? COPY_AR[text] ?? text : text), [ar]);
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const source = useImageEditorStore((state) => state.source);
  const setSource = useImageEditorStore((state) => state.setSource);
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const setBeautyBeforeSnapshot = useImageEditorStore((state) => state.setBeautyBeforeSnapshot);
  const setBeautyPreview = useImageEditorStore((state) => state.setBeautyPreview);
  const [opening, setOpening] = useState(false);

  const openPhoto = useCallback(async (): Promise<void> => {
    if (opening) return;
    setOpening(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('Open portrait'),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const asset = await window.knouxImageStudioAPI.importRetouchAsset(filePath) as RetouchAssetImport;
      const bytes = await window.knouxImageStudioAPI.readRetouchProxy(asset.proxyRef);
      if (!bytes) throw new Error('proxy-unavailable');
      const dataUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
      const previousObjectUrl = source?.dataUrl.startsWith('blob:') ? source.dataUrl : null;

      setRetouchProject(null);
      setBeautyBeforeSnapshot(null);
      setBeautyPreview(null);
      setSource({
        dataUrl,
        name: asset.sourceName,
        sourcePath: asset.sourcePath,
        assetRef: asset.assetRef,
        proxyRef: asset.proxyRef,
        sourceHash: asset.sourceHash,
        originalWidth: asset.width,
        originalHeight: asset.height,
      });

      if (previousObjectUrl && previousObjectUrl !== dataUrl) URL.revokeObjectURL(previousObjectUrl);
    } catch {
      addNotification({
        type: 'error',
        title: t('Could not open photo'),
        message: t('Choose another JPG, PNG, WebP or BMP image and try again.'),
        duration: 4200,
      });
    } finally {
      setOpening(false);
    }
  }, [addNotification, opening, setBeautyBeforeSnapshot, setBeautyPreview, setRetouchProject, setSource, source?.dataUrl, t]);

  return (
    <section className="knoux-mobile-creative-surface kmc-beauty-retouch kmc-beauty-studio" data-component="MobileBeautyRetouchView">
      <header className="kmc-topbar kmc-beauty-topbar">
        <button type="button" className="kmc-round-button kx-back" aria-label={t('Back to home')} onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>{t('BEAUTY STUDIO')}</small></div>
        </div>
        <button type="button" className="kmc-export-button" onClick={() => void openPhoto()} disabled={opening}>
          <ImagePlus size={17} /> {opening ? t('Opening') : source ? t('Change Photo') : t('Open Photo')}
        </button>
      </header>

      {!source && (
        <button type="button" className="kmc-beauty-picker" onClick={() => void openPhoto()} disabled={opening}>
          <span className="kmc-beauty-picker__icon"><Sparkles size={34} /></span>
          <strong>{t('Open a portrait')}</strong>
          <span>{t('Face analysis stays on this device. No portrait upload is required for local beauty tools.')}</span>
          <em>{opening ? t('Opening device…') : t('Choose photo')}</em>
        </button>
      )}

      {source && (
        <div className="kmc-beauty-document-bar">
          <div>
            <span>{t('LOCAL BEAUTY PROJECT')}</span>
            <strong>{source.name}</strong>
          </div>
          <small>{source.originalWidth && source.originalHeight ? `${source.originalWidth} × ${source.originalHeight}` : t('Local image')}</small>
        </div>
      )}

      <div className={source ? 'kmc-beauty-workspace has-document' : 'kmc-beauty-workspace'}>
        <div className="kmc-beauty-preview-engine" aria-label={t('Beauty image preview')}>
          <MobileBeautyCanvas />
        </div>
        <div id="knoux-mobile-beauty-host" className="kmc-beauty-controls-host" aria-live="polite" />
      </div>
    </section>
  );
};
