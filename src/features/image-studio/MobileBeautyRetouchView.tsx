import React, { useCallback, useState } from 'react';
import { ArrowLeft, ImagePlus, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { ImageEditorView } from '../image-editor/ImageEditorView';
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

export const MobileBeautyRetouchView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const source = useImageEditorStore((state) => state.source);
  const setSource = useImageEditorStore((state) => state.setSource);
  const [opening, setOpening] = useState(false);

  const openPhoto = useCallback(async (): Promise<void> => {
    if (opening) return;
    setOpening(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: 'Open portrait',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const asset = await window.knouxImageStudioAPI.importRetouchAsset(filePath) as RetouchAssetImport;
      const bytes = await window.knouxImageStudioAPI.readRetouchProxy(asset.proxyRef);
      if (!bytes) throw new Error('proxy-unavailable');
      const dataUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
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
    } catch {
      addNotification({
        type: 'error',
        title: 'Could not open photo',
        message: 'Choose another JPG, PNG, WebP or BMP image and try again.',
        duration: 4200,
      });
    } finally {
      setOpening(false);
    }
  }, [addNotification, opening, setSource]);

  return (
    <section className="knoux-mobile-creative-surface kmc-beauty-retouch kmc-beauty-studio" data-component="MobileBeautyRetouchView">
      <header className="kmc-topbar kmc-beauty-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>BEAUTY STUDIO</small></div>
        </div>
        <button type="button" className="kmc-export-button" onClick={() => void openPhoto()} disabled={opening}>
          <ImagePlus size={17} /> {opening ? 'Opening' : source ? 'Change' : 'Photo'}
        </button>
      </header>

      {!source && (
        <button type="button" className="kmc-beauty-picker" onClick={() => void openPhoto()} disabled={opening}>
          <span className="kmc-beauty-picker__icon"><Sparkles size={34} /></span>
          <strong>Open a portrait</strong>
          <span>Face analysis stays on this device. No portrait upload is required for local beauty tools.</span>
          <em>{opening ? 'Opening device…' : 'Choose photo'}</em>
        </button>
      )}

      {source && (
        <div className="kmc-beauty-document-bar">
          <div>
            <span>LOCAL BEAUTY PROJECT</span>
            <strong>{source.name}</strong>
          </div>
          <small>{source.originalWidth && source.originalHeight ? `${source.originalWidth} × ${source.originalHeight}` : 'Local image'}</small>
        </div>
      )}

      <div className={source ? 'kmc-beauty-workspace has-document' : 'kmc-beauty-workspace'}>
        <div className="kmc-beauty-preview-engine" aria-label="Beauty image preview">
          <ImageEditorView />
        </div>
        <div id="knoux-mobile-beauty-host" className="kmc-beauty-controls-host" aria-live="polite" />
      </div>
    </section>
  );
};
