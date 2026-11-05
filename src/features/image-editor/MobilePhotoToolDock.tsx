import React, { useCallback, useMemo } from 'react';
import {
  Blend,
  Lightbulb,
  Contrast,
  Crop,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Layers,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  WandSparkles,
} from 'lucide-react';

import {
  PHOTO_CROP_ASPECTS,
  PHOTO_LONG_EDGE_PRESETS,
  PHOTO_LOOKS,
  cropToFitAspect,
  cssFilterChain,
  effectiveTone,
  photoOutputGeometry,
  type PhotoEditSpec,
  type PhotoFormat,
  type PhotoLook,
  type PhotoOutputSpec,
} from '../../core/creative/photoEditModel';
import {
  KnouxAction,
  KnouxChipGroup,
  KnouxGroupLabel,
  KnouxPanelNotice,
  KnouxSegmented,
  KnouxSlider,
  KnouxTabStrip,
  useMobileCopy,
  type TabItem,
} from '../../components/mobile/KnouxControlKit';

import './mobilePhotoDock.css';

/**
 * KNOUX-X — MOBILE PHOTO TOOL DOCK
 *
 * The viewport in `MobileImageEditorView` draws whatever this panel produces;
 * every dial here maps onto a field of `PhotoEditSpec`, which is the same object
 * the full-resolution export runs. There is no "preview-only" control on this
 * panel by construction.
 */

export type PhotoTab = 'adjust' | 'detail' | 'looks' | 'crop' | 'effects' | 'output';

const TABS: ReadonlyArray<TabItem<PhotoTab>> = [
  { value: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { value: 'detail', label: 'Detail', icon: Lightbulb },
  { value: 'looks', label: 'Filters', icon: WandSparkles },
  { value: 'crop', label: 'Crop & rotate', icon: Crop },
  { value: 'effects', label: 'Effects', icon: Sparkles },
  { value: 'output', label: 'Export', icon: Download },
];

const FORMATS: ReadonlyArray<{ value: PhotoFormat; label: string }> = [
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG' },
];

export interface MobilePhotoToolDockProps {
  spec: PhotoEditSpec;
  output: PhotoOutputSpec;
  sourceWidth: number;
  sourceHeight: number;
  activeTab: PhotoTab;
  onTabChange(tab: PhotoTab): void;
  onSpecChange(next: PhotoEditSpec, gesture: string): void;
  onOutputChange(next: PhotoOutputSpec): void;
  onAutoPolish(): void;
  onResetAll(): void;
}

export const MobilePhotoToolDock: React.FC<MobilePhotoToolDockProps> = ({
  spec,
  output,
  sourceWidth,
  sourceHeight,
  activeTab,
  onTabChange,
  onSpecChange,
  onOutputChange,
  onAutoPolish,
  onResetAll,
}) => {
  const copy = useMobileCopy();
  const tone = spec.tone;
  const applied = useMemo(() => effectiveTone(spec), [spec]);

  const setTone = useCallback((key: keyof typeof tone, value: number, gesture: string) => {
    onSpecChange({ ...spec, tone: { ...spec.tone, [key]: value } }, gesture);
  }, [onSpecChange, spec]);

  const setDetail = useCallback((key: keyof typeof spec.detail, value: number, gesture: string) => {
    onSpecChange({ ...spec, detail: { ...spec.detail, [key]: value } }, gesture);
  }, [onSpecChange, spec]);

  const setEffect = useCallback((key: keyof typeof spec.effects, value: number, gesture: string) => {
    onSpecChange({ ...spec, effects: { ...spec.effects, [key]: value } }, gesture);
  }, [onSpecChange, spec]);

  const setGeometry = useCallback((patch: Partial<typeof spec.geometry>, gesture: string) => {
    onSpecChange({ ...spec, geometry: { ...spec.geometry, ...patch } }, gesture);
  }, [onSpecChange, spec]);

  const preview = photoOutputGeometry(
    { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, rotatedWidth: sourceWidth, rotatedHeight: sourceHeight, angle: 0 },
    output,
  );

  return (
    <div className="kmc-photo-dock" data-component="MobilePhotoToolDock">
      <KnouxTabStrip<PhotoTab> tabs={TABS} value={activeTab} ariaLabel="Photo tools" onChange={onTabChange} />

      <div className="kmc-photo-dock-body" role="tabpanel">
        {activeTab === 'adjust' && (
          <>
            <div className="kmc-photo-quick">
              <KnouxAction label="Auto polish" icon={WandSparkles} tone="primary" onClick={onAutoPolish} />
              <KnouxAction label="Reset" icon={RotateCcw} tone="ghost" onClick={onResetAll} />
            </div>
            <KnouxSlider label="Exposure" icon={Sun} bipolar value={tone.exposure} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="exposure" onChange={(value) => setTone('exposure', value, 'exposure')} />
            <KnouxSlider label="Brightness" icon={Lightbulb} bipolar value={tone.brightness} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="brightness" onChange={(value) => setTone('brightness', value, 'brightness')} />
            <KnouxSlider label="Contrast" icon={Contrast} bipolar value={tone.contrast} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="contrast" onChange={(value) => setTone('contrast', value, 'contrast')} />
            <KnouxSlider label="Saturation" icon={Blend} bipolar value={tone.saturation} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="saturation" onChange={(value) => setTone('saturation', value, 'saturation')} />
            <KnouxSlider label="Vibrance" icon={Sparkles} bipolar value={tone.vibrance} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="vibrance" onChange={(value) => setTone('vibrance', value, 'vibrance')} />
            <KnouxGroupLabel hint="White balance is measured in the pixels, not faked with a colour cast.">Temperature</KnouxGroupLabel>
            <KnouxSlider label="Temperature" icon={Sun} bipolar value={tone.temperature} min={-100} max={100} step={1} unit="" decimals={0} defaultValue={0} gesture="temperature" onChange={(value) => setTone('temperature', value, 'temperature')} />
            <KnouxSlider label="Tint" icon={Blend} bipolar value={tone.tint} min={-100} max={100} step={1} unit="" decimals={0} defaultValue={0} gesture="tint" onChange={(value) => setTone('tint', value, 'tint')} />
          </>
        )}

        {activeTab === 'detail' && (
          <>
            <KnouxSlider label="Highlights" icon={Sun} bipolar value={tone.highlights} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="highlights" onChange={(value) => setTone('highlights', value, 'highlights')} />
            <KnouxSlider label="Shadows" icon={Layers} bipolar value={tone.shadows} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="shadows" onChange={(value) => setTone('shadows', value, 'shadows')} />
            <KnouxSlider label="Whites" icon={Lightbulb} bipolar value={tone.whites} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="whites" onChange={(value) => setTone('whites', value, 'whites')} />
            <KnouxSlider label="Blacks" icon={Contrast} bipolar value={tone.blacks} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="blacks" onChange={(value) => setTone('blacks', value, 'blacks')} />
            <KnouxSlider label="Sharpen" icon={Sparkles} value={spec.detail.sharpen} min={0} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="sharpen" onChange={(value) => setDetail('sharpen', value, 'sharpen')} />
            <KnouxSlider label="Soften" icon={WandSparkles} value={spec.detail.soften} min={0} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="soften" onChange={(value) => setDetail('soften', value, 'soften')} />
            <KnouxSlider label="Clarity" icon={SlidersHorizontal} bipolar value={spec.detail.clarity} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="clarity" onChange={(value) => setDetail('clarity', value, 'clarity')} />
            <KnouxPanelNotice>
              {cssFilterChain(spec) === 'none' ? copy('Nothing to preview yet') : `${copy('Preview')}: ${cssFilterChain(spec)}`}
            </KnouxPanelNotice>
          </>
        )}

        {activeTab === 'looks' && (
          <>
            <KnouxChipGroup
              label="Filters"
              value={spec.look}
              options={PHOTO_LOOKS.map((look) => ({ value: look.id as PhotoLook, label: look.label }))}
              onChange={(value) => onSpecChange({ ...spec, look: value as PhotoLook }, 'look')}
            />
            <KnouxSlider label="Strength" icon={WandSparkles} value={spec.lookStrength} min={0} max={100} step={1} unit="%" decimals={0} defaultValue={100} gesture="look-strength" onChange={(value) => onSpecChange({ ...spec, lookStrength: value }, 'look-strength')} />
            <KnouxGroupLabel hint="Shows what the look adds on top of your own numbers.">Applied</KnouxGroupLabel>
            <div className="kmc-photo-look-readout">
              <span>{copy('Exposure')} {applied.exposure > 0 ? '+' : ''}{applied.exposure.toFixed(0)}</span>
              <span>{copy('Contrast')} {applied.contrast > 0 ? '+' : ''}{applied.contrast.toFixed(0)}</span>
              <span>{copy('Saturation')} {applied.saturation > 0 ? '+' : ''}{applied.saturation.toFixed(0)}</span>
              <span>{copy('Temperature')} {applied.temperature > 0 ? '+' : ''}{applied.temperature.toFixed(0)}</span>
            </div>
          </>
        )}

        {activeTab === 'crop' && (
          <>
            <KnouxChipGroup
              label="Aspect ratio"
              value="free"
              options={PHOTO_CROP_ASPECTS.map((aspect) => ({ value: aspect.id, label: aspect.label }))}
              onChange={(value) => {
                const aspect = PHOTO_CROP_ASPECTS.find((entry) => entry.id === value);
                if (!aspect?.ratio) return;
                const crop = cropToFitAspect(sourceWidth, sourceHeight, aspect.ratio);
                if (crop) setGeometry({ crop }, 'crop-aspect');
              }}
            />
            <KnouxSlider label="Crop left" value={spec.geometry.crop.left * 100} min={0} max={90} step={0.5} unit="%" decimals={1} defaultValue={0} gesture="crop-l" onChange={(value) => setGeometry({ crop: { ...spec.geometry.crop, left: value / 100 } }, 'crop-l')} />
            <KnouxSlider label="Crop right" value={spec.geometry.crop.right * 100} min={0} max={90} step={0.5} unit="%" decimals={1} defaultValue={0} gesture="crop-r" onChange={(value) => setGeometry({ crop: { ...spec.geometry.crop, right: value / 100 } }, 'crop-r')} />
            <KnouxSlider label="Crop top" value={spec.geometry.crop.top * 100} min={0} max={90} step={0.5} unit="%" decimals={1} defaultValue={0} gesture="crop-t" onChange={(value) => setGeometry({ crop: { ...spec.geometry.crop, top: value / 100 } }, 'crop-t')} />
            <KnouxSlider label="Crop bottom" value={spec.geometry.crop.bottom * 100} min={0} max={90} step={0.5} unit="%" decimals={1} defaultValue={0} gesture="crop-b" onChange={(value) => setGeometry({ crop: { ...spec.geometry.crop, bottom: value / 100 } }, 'crop-b')} />
            <KnouxGroupLabel>Straighten</KnouxGroupLabel>
            <KnouxSlider label="Rotation" icon={RotateCw} bipolar value={spec.geometry.rotation} min={-180} max={180} step={0.5} unit="°" decimals={1} defaultValue={0} gesture="rotation" onChange={(value) => setGeometry({ rotation: value }, 'rotation')} />
            <div className="kmc-photo-quick">
              <KnouxAction label="-90°" icon={RotateCcw} onClick={() => setGeometry({ rotation: spec.geometry.rotation - 90 }, 'rotation')} />
              <KnouxAction label="+90°" icon={RotateCw} onClick={() => setGeometry({ rotation: spec.geometry.rotation + 90 }, 'rotation')} />
              <KnouxAction label="Flip H" icon={FlipHorizontal2} pressed={spec.geometry.flipHorizontal} onClick={() => setGeometry({ flipHorizontal: !spec.geometry.flipHorizontal }, 'flip-h')} />
              <KnouxAction label="Flip V" icon={FlipVertical2} pressed={spec.geometry.flipVertical} onClick={() => setGeometry({ flipVertical: !spec.geometry.flipVertical }, 'flip-v')} />
            </div>
          </>
        )}

        {activeTab === 'effects' && (
          <>
            <KnouxSlider label="Vignette" icon={Contrast} bipolar value={spec.effects.vignette} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="vignette" onChange={(value) => setEffect('vignette', value, 'vignette')} />
            <KnouxSlider label="Grain" icon={Sparkles} value={spec.effects.grain} min={0} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="grain" onChange={(value) => setEffect('grain', value, 'grain')} />
            <KnouxSlider label="Bloom" icon={Lightbulb} value={spec.effects.bloom} min={0} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="bloom" onChange={(value) => setEffect('bloom', value, 'bloom')} />
            <KnouxPanelNotice tone="info">{copy('Grain runs last, so sharpening never amplifies the noise.')}</KnouxPanelNotice>
          </>
        )}

        {activeTab === 'output' && (
          <>
            <KnouxSegmented<PhotoFormat>
              label="Format"
              value={output.format}
              options={FORMATS.map((format) => ({ value: format.value, label: format.label }))}
              onChange={(value) => onOutputChange({ ...output, format: value })}
            />
            {output.format !== 'image/png' && (
              <KnouxSlider label="Quality" icon={Sparkles} value={output.quality} min={40} max={100} step={1} unit="%" decimals={0} defaultValue={92} gesture="quality" onChange={(value) => onOutputChange({ ...output, quality: value })} />
            )}
            <KnouxChipGroup
              label="Long edge"
              value={String(output.longEdge ?? 'full')}
              options={PHOTO_LONG_EDGE_PRESETS.map((preset) => ({ value: String(preset.value ?? 'full'), label: preset.value === null ? 'Original' : String(preset.value) }))}
              onChange={(value) => onOutputChange({ ...output, longEdge: value === 'full' ? null : Number(value) })}
            />
            <div className="kmc-photo-output-readout">
              <strong><bdi>{preview.width} × {preview.height}</bdi></strong>
              <small>{output.format === 'image/png' ? 'PNG' : output.format === 'image/webp' ? 'WebP' : 'JPG'} · {output.quality}</small>
            </div>
            <KnouxPanelNotice tone="warn">
              {copy('Re-encoding through the canvas drops camera metadata. Originals are never overwritten.')}
            </KnouxPanelNotice>
          </>
        )}
      </div>
    </div>
  );
};

export default MobilePhotoToolDock;
