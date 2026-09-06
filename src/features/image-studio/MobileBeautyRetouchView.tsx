import React, { useCallback, useState } from 'react';
import { ArrowLeft, ImagePlus, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { ImageEditorView } from '../image-editor/ImageEditorView';

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
  const setSource = useImageEditorStore((state) => state.setSource);
  const [opening, setOpening] = useState(false);

  const openPhoto = useCallback(async (): Promise<void> => {
    if (opening) return;
    setOpening(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: 'Open photo',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const asset = await window.knouxImageStudioAPI.importRetouchAsset(filePath) as RetouchAssetImport;
      const bytes = await window.knouxImageStudioAPI.readRetouchProxy(asset.proxyRef);
      if (!bytes) throw new Error('The selected photo could not be prepared for local editing.');
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
    } catch (reason) {
      addNotification({
        type: 'error',
        title: 'Could not open photo',
        message: reason instanceof Error ? reason.message : 'Choose another image and try again.',
        duration: 4200,
      });
    } finally {
      setOpening(false);
    }
  }, [addNotification, opening, setSource]);

  return (
    <section className="knoux-mobile-creative-surface kmc-beauty-retouch" data-component="MobileBeautyRetouchView">
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>BEAUTY RETOUCH</small></div>
        </div>
        <button type="button" className="kmc-export-button" onClick={() => void openPhoto()} disabled={opening}>
          <ImagePlus size={17} /> {opening ? 'Opening' : 'Open Photo'}
        </button>
      </header>

      <div className="kmc-intro-card kmc-beauty-intro">
        <div><span>NATURAL BEAUTY · LOCAL FIRST</span><h1>Retouch <em>naturally</em></h1><p>Skin, face, eyes, makeup and liquify stay connected to the existing KNOUX retouch engine and local face analysis.</p></div>
        <span className="kmc-intro-icon"><Sparkles size={30} /></span>
      </div>

      <div className="kmc-engine kmc-image-editor-engine kmc-beauty-engine">
        <ImageEditorView />
      </div>
    </section>
  );
};
