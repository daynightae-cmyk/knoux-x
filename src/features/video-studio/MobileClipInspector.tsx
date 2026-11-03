import React, { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  AlignLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  Blend,
  ChevronLeft,
  ChevronRight,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  Film,
  Grid2x2,
  Magnet,
  Move,
  Music2,
  Palette,
  Repeat,
  RotateCcw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SkipBack,
  SkipForward,
  SquareDashed,
  Type,
  Volume2,
  VolumeX,
  WandSparkles,
} from 'lucide-react';

import {
  transitionDuration as boundedTransitionDuration,
  upsertKeyframe,
  type EasingMode,
  type KeyframeProperty,
  type MultitrackProjectSettings,
  type TimelineItem,
  type TimelineTransition,
  type TransitionKind,
} from '../../core/creative/multitrackProject';
import {
  KEYFRAMED_TRANSFORM_PROPERTIES,
  resolveClipVisual,
} from '../../core/creative/timelineRenderState';
import {
  KnouxAction,
  KnouxChipGroup,
  KnouxColorField,
  KnouxField,
  KnouxGroupLabel,
  KnouxPanelNotice,
  KnouxSegmented,
  KnouxSlider,
  KnouxTabStrip,
  KnouxToggleRow,
  useMobileCopy,
  type TabItem,
} from '../../components/mobile/KnouxControlKit';

import { changeClipSpeed } from './mobileTimelineGestures';

/**
 * KNOUX-X — MOBILE CLIP INSPECTOR
 *
 * The multitrack model already carries position, scale, rotation, flip, blend,
 * four crop edges, a colour grade, pan, fades, keyframes, transitions and full
 * title typography. The Android inspector used to expose speed, opacity and
 * volume, which is why the phone editor felt thin next to the desktop one: the
 * engine was professional and the surface was not.
 *
 * This panel is the whole engine, arranged for a thumb. Every control writes a
 * real field, and every field is drawn by the shared render state, so preview and
 * export cannot disagree.
 */

type InspectorTab = 'clip' | 'transform' | 'crop' | 'grade' | 'audio' | 'motion' | 'transition' | 'text';

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const;

const TRANSITION_KINDS: Array<{ value: TransitionKind; label: string }> = [
  { value: 'cross-dissolve', label: 'Cross dissolve' },
  { value: 'fade-black', label: 'Fade to black' },
  { value: 'fade-white', label: 'Fade to white' },
  { value: 'dip-color', label: 'Dip to colour' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'slide', label: 'Slide' },
  { value: 'push', label: 'Push' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'blur', label: 'Blur' },
];

const EASING_MODES: Array<{ value: EasingMode; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in-out' },
];

const KEYFRAME_LABELS: Record<KeyframeProperty, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  scale: 'Scale',
  rotation: 'Rotation',
  opacity: 'Opacity',
  volume: 'Volume',
  cropLeft: 'Crop L',
  cropTop: 'Crop T',
  cropRight: 'Crop R',
  cropBottom: 'Crop B',
};

const CROP_ASPECTS: Array<{ value: string; label: string; ratio: number | null }> = [
  { value: 'source', label: 'Original', ratio: null },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '2.35:1', label: '2.35:1', ratio: 2.35 },
];

const COLOR_LOOKS: Array<{ value: string; label: string; color: { brightness: number; contrast: number; saturation: number; temperature: number } }> = [
  { value: 'neutral', label: 'Original', color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } },
  { value: 'warm', label: 'Warm', color: { brightness: 4, contrast: 6, saturation: 10, temperature: 38 } },
  { value: 'cool', label: 'Cool', color: { brightness: 2, contrast: 8, saturation: 6, temperature: -34 } },
  { value: 'noir', label: 'Noir', color: { brightness: -4, contrast: 28, saturation: -100, temperature: 0 } },
  { value: 'vivid', label: 'Vivid', color: { brightness: 6, contrast: 16, saturation: 34, temperature: 8 } },
  { value: 'faded', label: 'Faded', color: { brightness: 12, contrast: -16, saturation: -22, temperature: 6 } },
  { value: 'cinematic', label: 'Cinematic', color: { brightness: -6, contrast: 22, saturation: -12, temperature: 18 } },
];

const FONT_FAMILIES = ['Segoe UI', 'Cairo', 'Noto Naskh Arabic', 'Arial Black', 'Georgia', 'monospace'];

export interface MobileClipInspectorProps {
  item: TimelineItem;
  settings: MultitrackProjectSettings;
  playhead: number;
  /** Duration of the clip that sits next to the requested transition edge. */
  neighbourDuration: { before: number | null; after: number | null };
  sourceDimensions: { width: number; height: number } | null;
  /** Grade reaches the encoder only when the WebView honours canvas filters. */
  canvasFiltersAvailable: boolean;
  onPatch(patcher: (item: TimelineItem) => TimelineItem, gesture?: string): void;
}

const TAB_ICONS = {
  clip: SlidersHorizontal,
  transform: Move,
  crop: Crop,
  grade: Palette,
  audio: Music2,
  motion: Activity,
  transition: Film,
  text: Type,
} as const;

const KIND_LABELS: Record<string, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Photo',
  text: 'Text',
  subtitle: 'Subtitle',
  overlay: 'Overlay',
  color: 'Grade',
};

export const MobileClipInspector: React.FC<MobileClipInspectorProps> = ({
  item,
  settings,
  playhead,
  neighbourDuration,
  sourceDimensions,
  canvasFiltersAvailable,
  onPatch,
}) => {
  const copy = useMobileCopy();
  const [tab, setTab] = useState<InspectorTab>('clip');
  const [motionProperty, setMotionProperty] = useState<KeyframeProperty>('positionX');
  const [recordMotion, setRecordMotion] = useState(false);

  const localTime = Math.max(0, Math.min(item.duration, playhead - item.timelineStart));
  const visual = useMemo(() => resolveClipVisual(item, localTime), [item, localTime]);
  const isTextClip = item.kind === 'text' || item.kind === 'subtitle';
  const hasAudio = item.kind === 'video' || item.kind === 'audio';
  const halfWidth = Math.round(settings.width / 2);
  const halfHeight = Math.round(settings.height / 2);

  /** One writer for base values; keyframe capture happens on the motion tab. */
  const writeValue = useCallback((field: 'transform' | 'audio' | 'color' | 'text' | 'scalar', key: string, value: number | string | boolean, gesture: string): void => {
    if (recordMotion && field === 'transform' && KEYFRAMED_TRANSFORM_PROPERTIES.includes(key as KeyframeProperty)) {
      const property = key as KeyframeProperty;
      onPatch((current) => upsertKeyframe(current, {
        id: `${property}-${localTime.toFixed(3)}`,
        property,
        time: localTime,
        value: Number(value),
        easing: 'linear',
      }), `${gesture}-key`);
      return;
    }
    onPatch((current) => {
      const next = { ...current };
      if (field === 'transform') next.transform = { ...current.transform, [key]: value };
      else if (field === 'audio') next.audio = { ...current.audio, [key]: value };
      else if (field === 'color') next.color = { ...(current.color ?? { brightness: 0, contrast: 0, saturation: 0, temperature: 0 }), [key]: value };
      else if (field === 'text') next.text = current.text ? { ...current.text, [key]: value } : current.text;
      else if (key === 'name') next.name = String(value);
      return next;
    }, gesture);
  }, [localTime, onPatch, recordMotion]);

  const setTransform = useCallback((key: string, value: number | string | boolean, gesture: string) => {
    writeValue('transform', key, value, gesture);
  }, [writeValue]);

  const transitionMax = useCallback((side: 'in' | 'out'): number => {
    const neighbour = side === 'in' ? neighbourDuration.before : neighbourDuration.after;
    const partner = neighbour ?? item.duration;
    return Math.max(0.04, Math.min(6, boundedTransitionDuration(6, item.duration, partner)));
  }, [item.duration, neighbourDuration.after, neighbourDuration.before]);

  const patchTransition = useCallback((side: 'in' | 'out', kind: TransitionKind | 'none', gesture: string): void => {
    onPatch((current) => {
      const key = side === 'in' ? 'transitionIn' : 'transitionOut';
      if (kind === 'none') return { ...current, [key]: null };
      const existing = current[key] as TimelineTransition | null;
      const maximum = Math.max(0.04, Math.min(6, boundedTransitionDuration(6, item.duration, (side === 'in' ? neighbourDuration.before : neighbourDuration.after) ?? item.duration)));
      const next: TimelineTransition = {
        id: existing?.id ?? `${current.id}-${side}-${kind}`,
        kind,
        duration: Math.min(existing?.duration ?? 0.5, maximum),
        direction: existing?.direction,
        color: existing?.color,
      };
      return { ...current, [key]: next };
    }, gesture);
  }, [item.duration, neighbourDuration.after, neighbourDuration.before, onPatch]);

  const tabs = useMemo(() => {
    const entries: Array<TabItem<InspectorTab>> = [
      { value: 'clip', label: 'Clip', icon: TAB_ICONS.clip },
      { value: 'transform', label: 'Transform', icon: TAB_ICONS.transform },
      { value: 'crop', label: 'Crop', icon: TAB_ICONS.crop },
      { value: 'grade', label: 'Grade', icon: TAB_ICONS.grade },
    ];
    if (hasAudio) entries.push({ value: 'audio', label: 'Audio', icon: TAB_ICONS.audio });
    entries.push({ value: 'motion', label: 'Motion', icon: TAB_ICONS.motion, badge: item.keyframes.length });
    entries.push({ value: 'transition', label: 'Transitions', icon: TAB_ICONS.transition });
    if (isTextClip) entries.push({ value: 'text', label: 'Text', icon: TAB_ICONS.text });
    return entries;
  }, [hasAudio, isTextClip, item.keyframes.length]);

  const keyframesForProperty = useMemo(
    () => item.keyframes.filter((keyframe) => keyframe.property === motionProperty).sort((left, right) => left.time - right.time),
    [item.keyframes, motionProperty],
  );

  const resetClip = useCallback((): void => {
    onPatch((current) => ({
      ...current,
      playbackRate: 1,
      transform: {
        positionX: 0, positionY: 0, scale: 1, rotation: 0, opacity: 1,
        cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
        flipHorizontal: false, flipVertical: false, blendMode: 'normal',
      },
      color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
      keyframes: [],
      transitionIn: null,
      transitionOut: null,
    }), 'reset-clip');
  }, [onPatch]);

  return (
    <div className="kmci-root" data-component="MobileClipInspector" data-clip-id={item.id} dir="auto">
      <div className="kmci-clip-head">
        <span className="kmci-clip-kind" data-kind={item.kind}>{copy(KIND_LABELS[item.kind] ?? item.kind)}</span>
        <strong><bdi>{item.name}</bdi></strong>
        <span className="kmci-clip-time"><bdi>{localTime.toFixed(2)}s</bdi> / <bdi>{item.duration.toFixed(2)}s</bdi></span>
      </div>

      <KnouxTabStrip<InspectorTab> tabs={tabs} value={tab} ariaLabel="Inspector section" onChange={setTab} />

      <div className="kmci-body" role="tabpanel">
        {tab === 'clip' && (
          <>
            <KnouxField label="Clip name" value={item.name} onChange={(value) => writeValue('scalar', 'name', value.slice(0, 240) || 'Clip', 'clip-name')} />
            <KnouxSlider
              label="Speed"
              icon={Gauge}
              value={item.playbackRate}
              min={0.25}
              max={4}
              step={0.05}
              unit="×"
              defaultValue={1}
              gesture="speed"
              /* Re-tempoing a clip also re-times it: the shared gesture rule keeps
               * the source span and the timeline duration in step. */
              onChange={(value) => onPatch((current) => changeClipSpeed(current, value), 'speed')}
            />
            <KnouxSlider
              label="Opacity"
              icon={Blend}
              value={item.transform.opacity}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              decimals={0}
              defaultValue={1}
              gesture="opacity"
              onChange={(value) => setTransform('opacity', value, 'opacity')}
            />
            <KnouxGroupLabel hint="Blend is composited the same way on the canvas export.">Blend mode</KnouxGroupLabel>
            <KnouxSegmented
              label="Blend mode"
              value={item.transform.blendMode}
              options={BLEND_MODES.map((mode) => ({ value: mode, label: mode === 'normal' ? 'Normal' : mode === 'multiply' ? 'Multiply' : mode === 'screen' ? 'Screen' : mode === 'overlay' ? 'Overlay' : mode === 'darken' ? 'Darken' : 'Lighten' }))}
              onChange={(value) => setTransform('blendMode', value, 'blend')}
            />
            <KnouxGroupLabel hint="Every number on this panel belongs to the clip, not to a picture of it.">Quick actions</KnouxGroupLabel>
            <div className="kmci-action-row">
              <KnouxAction label="Reset" icon={RotateCcw} tone="danger" onClick={resetClip} />
              <KnouxAction label="Centre crop" icon={SquareDashed} onClick={() => {
                setTransform('cropLeft', 0, 'crop');
                setTransform('cropRight', 0, 'crop');
                setTransform('cropTop', 0, 'crop');
                setTransform('cropBottom', 0, 'crop');
              }} />
            </div>
          </>
        )}

        {tab === 'transform' && (
          <>
            <KnouxSlider label="Position X" icon={Move} bipolar value={visual.positionX} min={-halfWidth} max={halfWidth} step={1} unit="px" decimals={0} defaultValue={0} gesture="pos-x" onChange={(value) => setTransform('positionX', value, 'pos-x')} />
            <KnouxSlider label="Position Y" icon={Move} bipolar value={visual.positionY} min={-halfHeight} max={halfHeight} step={1} unit="px" decimals={0} defaultValue={0} gesture="pos-y" onChange={(value) => setTransform('positionY', value, 'pos-y')} />
            <KnouxSlider label="Scale" icon={Grid2x2} value={visual.scale} min={0.05} max={4} step={0.01} unit="×" defaultValue={1} gesture="scale" onChange={(value) => setTransform('scale', value, 'scale')} />
            <KnouxSlider label="Rotation" icon={RotateCw} bipolar value={visual.rotation} min={-180} max={180} step={0.5} unit="°" decimals={1} defaultValue={0} gesture="rotation" onChange={(value) => setTransform('rotation', value, 'rotation')} />
            <KnouxGroupLabel>Quarter turns</KnouxGroupLabel>
            <div className="kmci-action-row">
              <KnouxAction label="-90°" icon={RotateCcw} onClick={() => setTransform('rotation', ((item.transform.rotation - 90 + 540) % 360) - 180, 'rotation')} />
              <KnouxAction label="+90°" icon={RotateCw} onClick={() => setTransform('rotation', ((item.transform.rotation + 90 + 540) % 360) - 180, 'rotation')} />
              <KnouxAction label="180°" icon={RotateCcw} onClick={() => setTransform('rotation', ((item.transform.rotation + 180 + 540) % 360) - 180, 'rotation')} />
            </div>
            <KnouxToggleRow label="Flip horizontal" icon={FlipHorizontal2} checked={item.transform.flipHorizontal} onChange={(checked) => setTransform('flipHorizontal', checked, 'flip-h')} />
            <KnouxToggleRow label="Flip vertical" icon={FlipVertical2} checked={item.transform.flipVertical} onChange={(checked) => setTransform('flipVertical', checked, 'flip-v')} />
            <KnouxPanelNotice>{copy('Drag the clip to move it')}</KnouxPanelNotice>
          </>
        )}

        {tab === 'crop' && (
          <>
            <KnouxChipGroup
              label="Aspect ratio"
              value="source"
              options={CROP_ASPECTS.map((entry) => ({ value: entry.value, label: entry.label }))}
              onChange={(value) => {
                const preset = CROP_ASPECTS.find((entry) => entry.value === value);
                if (!preset?.ratio || !sourceDimensions || sourceDimensions.width <= 0 || sourceDimensions.height <= 0) return;
                const sourceRatio = sourceDimensions.width / sourceDimensions.height;
                if (Math.abs(sourceRatio - preset.ratio) < 0.001) return;
                const keepHeight = sourceRatio > preset.ratio;
                const excess = keepHeight ? 1 - preset.ratio / sourceRatio : 1 - sourceRatio / preset.ratio;
                const half = Math.round(excess * 10_000) / 20_000;
                if (keepHeight) {
                  setTransform('cropLeft', half, 'crop-aspect');
                  setTransform('cropRight', half, 'crop-aspect');
                  setTransform('cropTop', 0, 'crop-aspect');
                  setTransform('cropBottom', 0, 'crop-aspect');
                } else {
                  setTransform('cropTop', half, 'crop-aspect');
                  setTransform('cropBottom', half, 'crop-aspect');
                  setTransform('cropLeft', 0, 'crop-aspect');
                  setTransform('cropRight', 0, 'crop-aspect');
                }
              }}
            />
            <KnouxSlider label="Crop left" icon={ChevronLeft} value={visual.crop.left} min={0} max={0.95} step={0.005} unit="%" decimals={1} defaultValue={0} gesture="crop-l" onChange={(value) => setTransform('cropLeft', value, 'crop-l')} />
            <KnouxSlider label="Crop right" icon={ChevronRight} value={visual.crop.right} min={0} max={0.95} step={0.005} unit="%" decimals={1} defaultValue={0} gesture="crop-r" onChange={(value) => setTransform('cropRight', value, 'crop-r')} />
            <KnouxSlider label="Crop top" value={visual.crop.top} min={0} max={0.95} step={0.005} unit="%" decimals={1} defaultValue={0} gesture="crop-t" onChange={(value) => setTransform('cropTop', value, 'crop-t')} />
            <KnouxSlider label="Crop bottom" value={visual.crop.bottom} min={0} max={0.95} step={0.005} unit="%" decimals={1} defaultValue={0} gesture="crop-b" onChange={(value) => setTransform('cropBottom', value, 'crop-b')} />
            <KnouxAction label="Full frame" icon={SquareDashed} tone="ghost" onClick={() => {
              setTransform('cropLeft', 0, 'crop-reset');
              setTransform('cropRight', 0, 'crop-reset');
              setTransform('cropTop', 0, 'crop-reset');
              setTransform('cropBottom', 0, 'crop-reset');
            }} />
            <KnouxPanelNotice>{copy('Crop is baked into the export')}</KnouxPanelNotice>
          </>
        )}

        {tab === 'grade' && (
          <>
            <KnouxGroupLabel hint={canvasFiltersAvailable ? 'Grade is applied to preview and export' : 'This WebView ignores canvas filters, so the grade is preview-only'}>Looks</KnouxGroupLabel>
            {!canvasFiltersAvailable && <KnouxPanelNotice tone="warn">{copy('This WebView ignores canvas filters, so the grade is preview-only')}</KnouxPanelNotice>}
            <KnouxChipGroup
              label="Looks"
              value={COLOR_LOOKS.find((look) => look.color.brightness === item.color?.brightness
                && look.color.contrast === item.color?.contrast
                && look.color.saturation === item.color?.saturation
                && look.color.temperature === item.color?.temperature)?.value ?? 'custom'}
              options={COLOR_LOOKS.map((look) => ({ value: look.value, label: look.label }))}
              onChange={(value) => {
                const look = COLOR_LOOKS.find((entry) => entry.value === value);
                if (!look) return;
                onPatch((current) => ({ ...current, color: { ...look.color } }), 'look');
              }}
            />
            <KnouxSlider label="Brightness" icon={SlidersHorizontal} bipolar value={item.color?.brightness ?? 0} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="brightness" onChange={(value) => writeValue('color', 'brightness', value, 'brightness')} />
            <KnouxSlider label="Contrast" icon={SlidersHorizontal} bipolar value={item.color?.contrast ?? 0} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="contrast" onChange={(value) => writeValue('color', 'contrast', value, 'contrast')} />
            <KnouxSlider label="Saturation" icon={Palette} bipolar value={item.color?.saturation ?? 0} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="saturation" onChange={(value) => writeValue('color', 'saturation', value, 'saturation')} />
            <KnouxSlider label="Temperature" icon={Sparkles} bipolar value={item.color?.temperature ?? 0} min={-100} max={100} step={1} unit="%" decimals={0} defaultValue={0} gesture="temperature" onChange={(value) => writeValue('color', 'temperature', value, 'temperature')} />
            <KnouxAction label="Reset" icon={RotateCcw} tone="ghost" onClick={() => onPatch((current) => ({ ...current, color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } }), 'grade-reset')} />
          </>
        )}

        {tab === 'audio' && hasAudio && (
          <>
            <KnouxSlider label="Volume" icon={Volume2} value={item.audio.volume} min={0} max={2} step={0.01} unit="%" decimals={0} defaultValue={1} gesture="volume" onChange={(value) => writeValue('audio', 'volume', value, 'volume')} />
            <KnouxSlider label="Pan" icon={Blend} bipolar value={item.audio.pan} min={-1} max={1} step={0.01} defaultValue={0} gesture="pan" onChange={(value) => writeValue('audio', 'pan', value, 'pan')} />
            <KnouxSlider label="Fade in" icon={ArrowLeftToLine} value={item.audio.fadeIn} min={0} max={Math.max(0.1, item.duration)} step={0.05} unit="s" defaultValue={0} gesture="fade-in" onChange={(value) => writeValue('audio', 'fadeIn', Math.min(value, item.duration), 'fade-in')} />
            <KnouxSlider label="Fade out" icon={ArrowRightToLine} value={item.audio.fadeOut} min={0} max={Math.max(0.1, item.duration)} step={0.05} unit="s" defaultValue={0} gesture="fade-out" onChange={(value) => writeValue('audio', 'fadeOut', Math.min(value, item.duration), 'fade-out')} />
            <KnouxToggleRow label="Mute" hint={copy('Silence')} icon={item.audio.muted ? VolumeX : Volume2} checked={item.audio.muted} onChange={(checked) => writeValue('audio', 'muted', checked, 'mute')} />
          </>
        )}

        {tab === 'motion' && (
          <>
            <KnouxSegmented<KeyframeProperty>
              label="Property"
              value={motionProperty}
              options={([
                ...KEYFRAMED_TRANSFORM_PROPERTIES,
                'volume',
              ] as KeyframeProperty[]).map((property) => ({ value: property, label: KEYFRAME_LABELS[property] }))}
              onChange={(value) => setMotionProperty(value)}
            />
            <KnouxToggleRow label="Record changes into keyframes" hint="Motion" checked={recordMotion} icon={Gauge} onChange={setRecordMotion} />
            <div className="kmci-action-row">
              <KnouxAction
                label="Add keyframe at playhead"
                icon={Magnet}
                tone="primary"
                onClick={() => {
                  const current = (motionProperty === 'volume' ? item.audio.volume : (item.transform as unknown as Record<string, number>)[motionProperty] ?? 0);
                  onPatch((clip) => upsertKeyframe(clip, {
                    id: `${motionProperty}-${localTime.toFixed(3)}`,
                    property: motionProperty,
                    time: localTime,
                    value: Number(current),
                    easing: 'linear',
                  }), 'keyframe-add');
                }}
              />
              <KnouxAction
                label="Remove"
                icon={Scissors}
                tone="danger"
                disabled={keyframesForProperty.length === 0}
                onClick={() => onPatch((clip) => ({ ...clip, keyframes: clip.keyframes.filter((entry) => entry.property !== motionProperty) }), 'keyframe-clear')}
              />
            </div>
            <KnouxSegmented<EasingMode>
              label="Easing"
              value={keyframesForProperty.find((entry) => Math.abs(entry.time - localTime) < 0.02)?.easing ?? 'linear'}
              options={EASING_MODES}
              onChange={(value) => onPatch((clip) => ({
                ...clip,
                keyframes: clip.keyframes.map((entry) => (entry.property === motionProperty && Math.abs(entry.time - localTime) < 0.02 ? { ...entry, easing: value } : entry)),
              }), 'keyframe-easing')}
            />
            {keyframesForProperty.length === 0 ? (
              <KnouxPanelNotice>{copy('One keyframe holds its value to the end of the clip')}</KnouxPanelNotice>
            ) : (
              <div className="kmci-keyframe-list" role="list">
                {keyframesForProperty.map((entry) => (
                  <button key={entry.id} type="button" role="listitem" className="kmci-keyframe" onClick={() => setMotionProperty(entry.property)}>
                    <ChevronRight size={13} aria-hidden="true" />
                    <strong>{copy(KEYFRAME_LABELS[entry.property])}</strong>
                    <span>{entry.time.toFixed(2)}s · {entry.value.toFixed(2)}</span>
                    <em>{copy(entry.easing === 'linear' ? 'Linear' : entry.easing === 'ease-in' ? 'Ease in' : entry.easing === 'ease-out' ? 'Ease out' : 'Ease in-out')}</em>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'transition' && (
          <>
            {(['in', 'out'] as const).map((side) => {
              const transition = side === 'in' ? item.transitionIn : item.transitionOut;
              return (
                <div key={side} className="kmci-transition">
                  <KnouxGroupLabel>{side === 'in' ? 'Transition in' : 'Transition out'}</KnouxGroupLabel>
                  <KnouxSegmented<'none' | TransitionKind>
                    label={side === 'in' ? 'Transition in' : 'Transition out'}
                    value={transition?.kind ?? 'none'}
                    options={[{ value: 'none', label: 'None' }, ...TRANSITION_KINDS]}
                    onChange={(value) => patchTransition(side, value, `transition-${side}`)}
                  />
                  {transition && (
                    <>
                      <KnouxSlider
                        label="Duration"
                        value={transition.duration}
                        min={0.04}
                        max={transitionMax(side)}
                        step={0.02}
                        unit="s"
                        defaultValue={0.5}
                        onReset={() => onPatch((clip) => ({ ...clip, [side === 'in' ? 'transitionIn' : 'transitionOut']: null }), `transition-${side}-reset`)}
                        onChange={(value) => onPatch((clip) => ({
                          ...clip,
                          [side === 'in' ? 'transitionIn' : 'transitionOut']: { ...transition, duration: Math.min(value, transitionMax(side)) },
                        }), `transition-${side}-duration`)}
                      />
                      {(transition.kind === 'wipe' || transition.kind === 'slide' || transition.kind === 'push') && (
                        <KnouxSegmented<'left' | 'right' | 'up' | 'down'>
                          label="Direction"
                          value={transition.direction ?? 'left'}
                          options={[
                            { value: 'left', label: 'Left', icon: ChevronLeft },
                            { value: 'right', label: 'Right', icon: ChevronRight },
                            { value: 'up', label: 'Up', icon: ArrowLeftToLine },
                            { value: 'down', label: 'Down', icon: ArrowRightToLine },
                          ]}
                          onChange={(value) => onPatch((clip) => ({
                            ...clip,
                            [side === 'in' ? 'transitionIn' : 'transitionOut']: { ...transition, direction: value },
                          }), `transition-${side}-direction`)}
                        />
                      )}
                      {transition.kind === 'dip-color' && (
                        <KnouxColorField
                          label="Transition colour"
                          value={transition.color ?? '#000000'}
                          swatches={['#000000', '#ffffff', '#7828e8', '#55dff5', '#f36983']}
                          onChange={(value) => onPatch((clip) => ({
                            ...clip,
                            [side === 'in' ? 'transitionIn' : 'transitionOut']: { ...transition, color: value },
                          }), `transition-${side}-color`)}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <KnouxPanelNotice>{copy('Transitions fade the clip itself; the encoder bakes them')}</KnouxPanelNotice>
          </>
        )}

        {tab === 'text' && isTextClip && item.text && (
          <>
            <KnouxField label="Title text" value={item.text.text} onChange={(value) => writeValue('text', 'text', value.slice(0, 240), 'text-value')} />
            <KnouxChipGroup
              label="Font"
              value={item.text.fontFamily}
              options={FONT_FAMILIES.map((family) => ({ value: family, label: family }))}
              onChange={(value) => writeValue('text', 'fontFamily', value, 'text-font')}
            />
            <KnouxSlider label="Font size" icon={Type} value={item.text.fontSize} min={12} max={settings.height * 0.6} step={1} unit="px" decimals={0} defaultValue={64} gesture="text-size" onChange={(value) => writeValue('text', 'fontSize', value, 'text-size')} />
            <KnouxSlider label="Weight" icon={SlidersHorizontal} value={item.text.fontWeight} min={100} max={900} step={100} decimals={0} defaultValue={600} gesture="text-weight" onChange={(value) => writeValue('text', 'fontWeight', value, 'text-weight')} />
            <KnouxColorField label="Colour" value={item.text.color} onChange={(value) => writeValue('text', 'color', value, 'text-color')} />
            <KnouxColorField label="Outline colour" value={item.text.strokeColor} onChange={(value) => writeValue('text', 'strokeColor', value, 'text-stroke-color')} />
            <KnouxSlider label="Outline width" icon={WandSparkles} value={item.text.strokeWidth} min={0} max={24} step={0.5} unit="px" defaultValue={0} gesture="text-stroke" onChange={(value) => writeValue('text', 'strokeWidth', value, 'text-stroke')} />
            <KnouxColorField label="Background" value={item.text.backgroundColor} swatches={['transparent', '#000000', '#ffffff', 'rgba(11,7,20,0.72)', '#7828e8']} onChange={(value) => writeValue('text', 'backgroundColor', value, 'text-bg')} />
            <KnouxSegmented<'start' | 'center' | 'end'>
              label="Align"
              value={item.text.align}
              options={[
                { value: 'start', label: 'Start', icon: AlignLeft },
                { value: 'center', label: 'Centre' },
                { value: 'end', label: 'End' },
              ]}
              onChange={(value) => writeValue('text', 'align', value, 'text-align')}
            />
            <KnouxSegmented<'auto' | 'ltr' | 'rtl'>
              label="Writing direction"
              value={item.text.direction}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'ltr', label: 'Left-to-right' },
                { value: 'rtl', label: 'Right-to-left' },
              ]}
              onChange={(value) => writeValue('text', 'direction', value, 'text-direction')}
            />
          </>
        )}
      </div>
    </div>
  );
};

/** Transport keys the editor shell reuses so both surfaces stay in sync. */
export const INSPECTOR_TRANSPORT_KEYS = {
  split: Scissors,
  previous: SkipBack,
  next: SkipForward,
  loop: Repeat,
} as const;

export default MobileClipInspector;
