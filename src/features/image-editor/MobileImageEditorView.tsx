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

let globalActivePhotoUri: string | null = null;

export const MobileImageEditorView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);

  const [editorState, setEditorState] = useState<EditorState>('EMPTY');
  const [activeTab, setActiveTab] = useState<ToolTab>('adjust');
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [imageDetails, setImageDetails] = useState<{ name: string; width: number; height: number } | null>(null);

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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const containerWidth = container.clientWidth || 360;
    const containerHeight = container.clientHeight || 480;

    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, containerHeight);

    const isRotated90 = adjustments.rotation % 180 !== 0;
    const imgW = isRotated90 ? img.naturalHeight : img.naturalWidth;
    const imgH = isRotated90 ? img.naturalWidth : img.naturalHeight;

    const scale = Math.min((containerWidth - 24) / imgW, (containerHeight - 24) / imgH, 1);
    const renderW = img.naturalWidth * scale;
    const renderH = img.naturalHeight * scale;
    const drawX = containerWidth / 2;
    const drawY = containerHeight / 2;

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate((adjustments.rotation * Math.PI) / 180);
    ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);

    // CSS filter pipeline on canvas context
    const b = 100 + adjustments.brightness;
    const c = 100 + adjustments.contrast;
    const s = 100 + adjustments.saturation;

    let filterStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    if (adjustments.filter === 'mono') filterStr += ' grayscale(100%)';
    else if (adjustments.filter === 'sepia' || adjustments.filter === 'vintage') filterStr += ' sepia(60%)';
    else if (adjustments.filter === 'vivid') filterStr += ' saturate(140%) contrast(110%)';
    else if (adjustments.filter === 'dramatic') filterStr += ' contrast(135%) brightness(90%)';
    else if (adjustments.filter === 'cyber') filterStr += ' hue-rotate(180deg) saturate(130%)';
    else if (adjustments.filter === 'warm') filterStr += ' sepia(25%) saturate(110%)';
    else if (adjustments.filter === 'cool') filterStr += ' hue-rotate(30deg) brightness(105%)';

    ctx.filter = filterStr;
    ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);
    ctx.restore();
  }, [adjustments]);

  const loadPhotoFromSource = useCallback((src: string, filename: string) => {
    setEditorState('DECODING');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadedImageRef.current = img;
      globalActivePhotoUri = src;
      setImageDetails({ name: filename, width: img.naturalWidth, height: img.naturalHeight });
      setEditorState('READY');
    };
    img.onerror = () => {
      setErrorMessage('Could not decode selected image file.');
      setEditorState('ERROR');
    };
    img.src = src;
  }, []);

  useEffect(() => {
    if (globalActivePhotoUri && editorState === 'EMPTY') {
      loadPhotoFromSource(globalActivePhotoUri, 'Active Photo');
    }
  }, [editorState, loadPhotoFromSource]);

  useEffect(() => {
    if (editorState === 'READY' || editorState === 'EDITING') {
      renderCanvas();
    }
  }, [editorState, renderCanvas]);

  useEffect(() => {
    const handleResize = () => {
      if (editorState === 'READY' || editorState === 'EDITING') {
        renderCanvas();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [editorState, renderCanvas]);

  const pickImageFile = async () => {
    setEditorState('PICKING');
    try {
      const selection = await window.knouxCreativeAPI.media.open({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
      });
      if (selection?.filePath) {
        let src = selection.filePath;
        if (!src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('http')) {
          if (window.knouxRuntime?.edition === 'android') {
            src = window.knouxNativeBridge?.saf?.androidImageAsset?.(src) ?? `file://${src}`;
          }
        }
        loadPhotoFromSource(src, selection.filePath.split(/[/\\]/).pop() || 'photo.jpg');
        return;
      }
    } catch {
      // Fall back to input element
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      if (editorState === 'PICKING') setEditorState(loadedImageRef.current ? 'READY' : 'EMPTY');
      return;
    }

    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
    }
    const blobUrl = URL.createObjectURL(file);
    activeBlobUrlRef.current = blobUrl;
    loadPhotoFromSource(blobUrl, file.name);
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

      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.translate(fullW / 2, fullH / 2);
        ctx.rotate((adjustments.rotation * Math.PI) / 180);
        ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);

        const b = 100 + adjustments.brightness;
        const c = 100 + adjustments.contrast;
        const s = 100 + adjustments.saturation;

        let filterStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
        if (adjustments.filter === 'mono') filterStr += ' grayscale(100%)';
        else if (adjustments.filter === 'sepia' || adjustments.filter === 'vintage') filterStr += ' sepia(60%)';
        else if (adjustments.filter === 'vivid') filterStr += ' saturate(140%) contrast(110%)';
        else if (adjustments.filter === 'dramatic') filterStr += ' contrast(135%) brightness(90%)';
        else if (adjustments.filter === 'cyber') filterStr += ' hue-rotate(180deg) saturate(130%)';
        else if (adjustments.filter === 'warm') filterStr += ' sepia(25%) saturate(110%)';
        else if (adjustments.filter === 'cool') filterStr += ' hue-rotate(30deg) brightness(105%)';

        ctx.filter = filterStr;
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      }

      const dataUrl = offscreen.toDataURL('image/jpeg', 0.92);
      const defaultFilename = `KNOUX_Photo_${Date.now()}.jpg`;

      const result = await window.knouxCreativeAPI.export.save({
        defaultPath: defaultFilename,
        filters: [{ name: 'JPEG Image', extensions: ['jpg'] }],
        dataUrl,
      });

      addNotification({
        type: 'success',
        title: 'Photo Exported',
        message: result ? `Saved to ${result.filePath}` : 'Edited photo saved successfully.',
        duration: 5000,
      });
      setEditorState('READY');
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Export Failed',
        message: err instanceof Error ? err.message : 'Could not export photo.',
        duration: 5000,
      });
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
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>

        <div className="kmc-brand-lockup">
          <BrandMark size={32} />
          <div>
            <strong>KNOUX <span>X</span></strong>
            <small>{imageDetails ? imageDetails.name : 'PHOTO EDITOR'}</small>
          </div>
        </div>

        <div className="kmc-topbar-actions">
          <button type="button" className="kmc-round-button" aria-label="Open Photo" onClick={pickImageFile}>
            <FolderOpen size={19} />
          </button>

          {(editorState === 'READY' || editorState === 'EDITING') && (
            <button type="button" className="kmc-export-button" aria-label="Export Photo" onClick={handleExport}>
              <Download size={17} /> Export
            </button>
          )}
        </div>
      </header>

      {/* Main Canvas Viewport Area */}
      <div className="kmc-photo-canvas-container" ref={containerRef}>
        {editorState === 'EMPTY' && (
          <div className="kmc-photo-empty-state">
            <div className="kmc-empty-icon-ring">
              <ImageIcon size={48} />
            </div>
            <h3>Select a Photo</h3>
            <p>Choose any JPEG, PNG, or WebP photo from your device to begin editing.</p>
            <button type="button" className="kmc-primary-action-btn" onClick={pickImageFile}>
              <FolderOpen size={18} /> Choose Photo
            </button>
          </div>
        )}

        {editorState === 'DECODING' && (
          <div className="kmc-photo-loading-state">
            <div className="kmc-spinner" />
            <span>Decoding Photo...</span>
          </div>
        )}

        {editorState === 'ERROR' && (
          <div className="kmc-photo-empty-state">
            <h3>Error Loading Photo</h3>
            <p>{errorMessage}</p>
            <button type="button" className="kmc-primary-action-btn" onClick={pickImageFile}>
              Try Again
            </button>
          </div>
        )}

        {(editorState === 'READY' || editorState === 'EDITING' || editorState === 'EXPORTING') && (
          <div className="kmc-photo-viewport">
            <canvas ref={canvasRef} className="kmc-photo-canvas" />
            {imageDetails && (
              <span className="kmc-photo-badge">
                {imageDetails.width} × {imageDetails.height}
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
              <Sliders size={16} /> Adjust
            </button>
            <button
              type="button"
              className={activeTab === 'filters' ? 'active' : ''}
              onClick={() => setActiveTab('filters')}
            >
              <Wand2 size={16} /> Filters
            </button>
            <button
              type="button"
              className={activeTab === 'transform' ? 'active' : ''}
              onClick={() => setActiveTab('transform')}
            >
              <RotateCw size={16} /> Transform
            </button>
          </div>

          <div className="kmc-tool-panel">
            {activeTab === 'adjust' && (
              <div className="kmc-adjust-sliders">
                <div className="kmc-slider-group">
                  <label>
                    <Sun size={14} /> Brightness ({adjustments.brightness})
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
                    <Sparkles size={14} /> Contrast ({adjustments.contrast})
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
                    <Wand2 size={14} /> Saturation ({adjustments.saturation})
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
                    {f.label} {adjustments.filter === f.id && <Check size={12} />}
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
                  <RotateCw size={18} /> Rotate 90°
                </button>
                <button
                  type="button"
                  className={`kmc-icon-action-btn ${adjustments.flipH ? 'active' : ''}`}
                  onClick={() => {
                    setAdjustments({ ...adjustments, flipH: !adjustments.flipH });
                    setEditorState('EDITING');
                  }}
                >
                  <FlipHorizontal size={18} /> Flip H
                </button>
                <button
                  type="button"
                  className={`kmc-icon-action-btn ${adjustments.flipV ? 'active' : ''}`}
                  onClick={() => {
                    setAdjustments({ ...adjustments, flipV: !adjustments.flipV });
                    setEditorState('EDITING');
                  }}
                >
                  <FlipVertical size={18} /> Flip V
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
