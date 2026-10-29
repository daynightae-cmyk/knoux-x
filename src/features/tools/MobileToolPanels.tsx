import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  FolderOpen,
  Grid2x2,
  Images,
  Music2,
  Palette,
  Ruler,
  ScanSearch,
  Volume2,
} from 'lucide-react';

import { layoutTileGrid, TILE_NAME_TEMPLATE, tileName } from '../../core/creative/tileGrid';
import {
  evaluateContrast,
  extractPalette,
  colourRamp,
} from '../../core/creative/paletteExtraction';
import {
  ORIENTATION_LABELS,
  formatByteSize,
  megapixels,
  readImageMetadata,
  type ImageMetadata,
} from '../../core/creative/imageMetadataScan';
import { encodeWav, pcmDurationSeconds, type PcmSource } from '../../core/creative/wavEncode';
import {
  KnouxAction,
  KnouxChipGroup,
  KnouxGroupLabel,
  KnouxPanelNotice,
  KnouxSlider,
  useMobileCopy,
} from '../../components/mobile/KnouxControlKit';

import {
  canvasToPng,
  decodeImageBytes,
  folderDisplayName,
  pickToolDirectory,
  pickToolFile,
  saveToolFile,
  saveToolFileIntoDirectory,
  toolDirectoryWriteSupported,
  type PickedFile,
} from './toolFileAccess';
import { ToolScaffold, useToolRunner } from './MobileToolScaffold';

/**
 * KNOUX-X — MOBILE MINI TOOLS
 *
 * The promise of an all-in-one app is that the boring jobs are already there:
 * pull one frame out of a video, read what a photo says about itself, turn a
 * picture into a palette, cut a square into a seamless grid, lift the audio off
 * a clip. Each of these is a real implementation on the same engines the studios
 * use — canvas, Web Audio, byte parsing — and each writes through the platform's
 * own picker, then reads the result back before it says "saved".
 */

/* ---------------------------------------------------------------- frames */

export const FrameExtractorTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const choose = useCallback(async (): Promise<void> => {
    runner.reset();
    try {
      const file = await pickToolFile('video');
      if (!file) return;
      setPicked(file);
      const url = await window.knouxCreativeAPI.media.toUrl(file.path);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url.startsWith('blob:') ? url : null;
      const element = videoRef.current ?? document.createElement('video');
      element.preload = 'auto';
      element.playsInline = true;
      element.src = url;
      videoRef.current = element;
      await new Promise<void>((resolve, reject) => {
        element.addEventListener('loadedmetadata', () => resolve(), { once: true });
        element.addEventListener('error', () => reject(new Error('This device cannot decode that video.')), { once: true });
      });
      setDuration(element.duration);
      setNatural({ width: element.videoWidth, height: element.videoHeight });
      setTime(0);
      runner.setBusy('Pick a frame');
      runner.reset();
    } catch (error) {
      setPicked(null);
      runner.reset();
    }
  }, [runner]);

  const seek = useCallback((value: number): void => {
    const element = videoRef.current;
    if (!element) return;
    const bounded = Math.max(0, Math.min(Math.max(0.001, duration), value));
    element.currentTime = bounded;
    setTime(bounded);
    element.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth || 1;
      canvas.height = element.videoHeight || 1;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(element, 0, 0);
      setPreview(canvas.toDataURL('image/png'));
    }, { once: true });
  }, [duration]);

  const grab = useCallback((): Promise<void> => runner.run(async () => {
    const element = videoRef.current;
    if (!element || !natural.width) throw new Error('No decoded frame to save yet.');
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth || natural.width;
    canvas.height = element.videoHeight || natural.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the frame canvas.');
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const bytes = await canvasToPng(canvas);
    const name = `KNOUX_Frame_${Math.round(time * 1000)}ms.png`;
    const saved = await saveToolFile(bytes, name, ['png']);
    if (!saved) return copy('Save cancelled — nothing was written.');
    return `${copy('Frame {number}'.replace('{number}', name))}`;
  }, 'Processing'), [copy, natural.height, natural.width, runner, time]);

  return (
    <ToolScaffold
      title="Frame extractor"
      blurb="Pull any moment out of a video as a full-resolution image."
      icon={<Film size={20} />}
      phase={runner.phase}
      pickLabel="Choose a video"
      onPick={() => void choose()}
      pickedName={picked?.name ?? null}
      actionLabel="Grab frame"
      onAction={() => void grab()}
      actionDisabled={!picked || duration <= 0}
      status={runner.status}
      statusTone={runner.tone}
    >
      <video ref={videoRef} className="kmt-hidden-media" muted playsInline aria-hidden="true" />
      <KnouxSlider
        label="Time"
        value={time}
        min={0}
        max={Math.max(0.1, duration)}
        step={1 / 30}
        unit="s"
        decimals={2}
        gesture="frame-time"
        disabled={duration <= 0}
        onChange={seek}
      />
      {natural.width > 0 && (
        <div className="kmt-readout-row">
          <span><bdi>{natural.width} × {natural.height}</bdi></span>
          <span>{copy('Duration')}: <bdi>{duration.toFixed(2)}s</bdi></span>
        </div>
      )}
      {preview && <img className="kmt-result-image" src={preview} alt={copy('Preview')} />}
    </ToolScaffold>
  );
};

/* ------------------------------------------------------------ metadata */

export const PhotoInspectorTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);

  const choose = useCallback(async (): Promise<void> => {
    runner.reset();
    setMetadata(null);
    try {
      const file = await pickToolFile('image');
      if (!file) return;
      setPicked(file);
      const parsed = readImageMetadata(file.bytes);
      setMetadata(parsed);
      runner.reset();
    } catch (error) {
      setPicked(null);
      runner.reset();
    }
  }, [runner]);

  const rows = useMemo(() => {
    if (!metadata || !picked) return [];
    const entries: Array<[string, string]> = [
      ['Format', metadata.format.toUpperCase()],
      ['Dimensions', `${metadata.width} × ${metadata.height}`],
      ['Megapixels', `${megapixels(metadata)} MP`],
      ['File size', formatByteSize(picked.bytes.byteLength)],
      ['Alpha', metadata.hasAlpha ? copy('Enabled') : copy('Disabled')],
    ];
    if (metadata.bitDepth) entries.push(['Bit depth', `${metadata.bitDepth}`]);
    if (metadata.orientation) entries.push(['Orientation', ORIENTATION_LABELS[metadata.orientation] ?? String(metadata.orientation)]);
    if (metadata.camera?.make) entries.push(['Camera', `${metadata.camera.make} ${metadata.camera.model ?? ''}`.trim()]);
    if (metadata.camera?.lens) entries.push(['Lens', metadata.camera.lens]);
    if (metadata.takenAt) entries.push(['Taken', metadata.takenAt]);
    if (metadata.exposure?.shutter) entries.push(['Shutter', metadata.exposure.shutter]);
    if (metadata.exposure?.aperture) entries.push(['Aperture', `f/${metadata.exposure.aperture}`]);
    if (metadata.exposure?.iso) entries.push(['ISO', metadata.exposure.iso]);
    if (metadata.exposure?.focalLength) entries.push(['Focal length', metadata.exposure.focalLength]);
    if (metadata.colourProfile) entries.push(['Colour profile', metadata.colourProfile]);
    return entries;
  }, [copy, metadata, picked]);

  return (
    <ToolScaffold
      title="Photo inspector"
      blurb="Read the real size, format and camera data stored inside a photo."
      icon={<ScanSearch size={20} />}
      phase={runner.phase}
      pickLabel="Choose a photo"
      onPick={() => void choose()}
      pickedName={picked?.name ?? null}
      status={runner.status}
      statusTone={runner.tone}
    >
      {metadata && !metadata.width && (
        <KnouxAction label={metadata.warning ?? copy('Unsupported')} tone="ghost" onClick={() => void choose()} />
      )}
      {rows.length > 0 && (
        <dl className="kmt-facts">
          {rows.map(([label, value]) => (
            <div key={label} className="kmt-fact">
              <dt>{copy(label)}</dt>
              <dd><bdi>{value}</bdi></dd>
            </div>
          ))}
        </dl>
      )}
      {metadata && !metadata.camera?.make && metadata.width > 0 && (
        <p className="kmt-note">{copy('No embedded camera data')}</p>
      )}
    </ToolScaffold>
  );
};

/* ------------------------------------------------------------ palette */

export const ColourPickerTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [swatches, setSwatches] = useState<ReturnType<typeof extractPalette>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [against, setAgainst] = useState<string>('#ffffff');
  const [copied, setCopied] = useState<string | null>(null);
  const [count, setCount] = useState(6);

  const choose = useCallback(async (): Promise<void> => {
    runner.reset();
    setSwatches([]);
    setSelected(null);
    try {
      const file = await pickToolFile('image');
      if (!file) return;
      setPicked(file);
      const decoded = await decodeImageBytes(file.bytes, file.mime);
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 400 / Math.max(1, Math.max(decoded.width, decoded.height)));
        canvas.width = Math.max(1, Math.round(decoded.width * scale));
        canvas.height = Math.max(1, Math.round(decoded.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create the sampling canvas.');
        context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const palette = extractPalette({ data: pixels.data, width: canvas.width, height: canvas.height }, { count });
        setSwatches(palette);
        setSelected(palette[0]?.hex ?? null);
        runner.reset();
      } finally {
        decoded.close();
      }
    } catch (error) {
      setPicked(null);
      runner.reset();
    }
  }, [count, runner]);

  const report = selected ? evaluateContrast(selected, against) : null;

  const copyValue = useCallback(async (value: string): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(value);
    } catch {
      setCopied(null);
    }
  }, []);

  return (
    <ToolScaffold
      title="Colour picker"
      blurb="Turn any photo into a shareable palette and check its contrast."
      icon={<Palette size={20} />}
      phase={runner.phase}
      pickLabel="Choose a photo"
      onPick={() => void choose()}
      pickedName={picked?.name ?? null}
      status={copied ? copy('Copied {value}'.replace('{value}', copied)) : runner.status}
      statusTone={runner.tone}
    >
      <KnouxSlider label="Palette" value={count} min={3} max={10} step={1} decimals={0} defaultValue={6} gesture="palette-count" onChange={(value) => setCount(Math.round(value))} />
      <div className="kmt-swatches">
        {swatches.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            className="kmt-swatch"
            data-active={swatch.hex === selected ? 'true' : 'false'}
            style={{ background: swatch.hex }}
            aria-label={`${swatch.hex} · ${Math.round(swatch.share * 100)}%`}
            onClick={() => { setSelected(swatch.hex); void copyValue(swatch.hex); }}
          >
            <span><bdi>{swatch.hex}</bdi></span>
            <small>{Math.round(swatch.share * 100)}%</small>
          </button>
        ))}
      </div>
      {selected && (
        <>
          <div className="kmt-ramp">
            {colourRamp(selected, 5).map((tone) => (
              <i key={tone} style={{ background: tone }} aria-hidden="true" />
            ))}
          </div>
          <KnouxChipGroup
            label="Contrast check"
            value={against}
            options={[
              { value: '#ffffff', label: 'On white' },
              { value: '#0b0714', label: 'On black' },
              { value: '#1a1030', label: 'On KNOUX' },
            ]}
            onChange={setAgainst}
          />
          {report && (
            <div className="kmt-contrast">
              <strong><bdi>{report.ratio}: 1</bdi></strong>
              <span data-pass={report.normalAA ? 'yes' : 'no'}>{report.normalAA ? copy('Passes AA') : copy('Fails AA')}</span>
              <span data-pass={report.normalAAA ? 'yes' : 'no'}>{report.normalAAA ? copy('Passes AAA') : copy('Fails AA')}</span>
            </div>
          )}
        </>
      )}
    </ToolScaffold>
  );
};

/* ---------------------------------------------------------- grid split */

export const GridSplitterTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [gutter, setGutter] = useState(0);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const choose = useCallback(async (): Promise<void> => {
    runner.reset();
    try {
      const file = await pickToolFile('image');
      if (!file) return;
      setPicked(file);
      const decoded = await decodeImageBytes(file.bytes, file.mime);
      try {
        setNatural({ width: decoded.width, height: decoded.height });
      } finally {
        decoded.close();
      }
      runner.reset();
    } catch {
      setPicked(null);
      runner.reset();
    }
  }, [runner]);

  const chooseFolder = useCallback(async (): Promise<void> => {
    runner.reset();
    try {
      const directory = await pickToolDirectory();
      if (!directory) return;
      setFolder(directory);
      runner.reset();
    } catch {
      runner.reset();
    }
  }, [runner]);

  const grid = useMemo(
    () => layoutTileGrid(natural.width, natural.height, { rows, columns, gutter }),
    [columns, gutter, natural.height, natural.width, rows],
  );
  const canBatch = Boolean(folder) && toolDirectoryWriteSupported(folder ?? '');

  /** One pixel implementation, shared by both save paths. */
  const renderTiles = useCallback(async (source: PickedFile): Promise<Array<{ name: string; bytes: Uint8Array }>> => {
    const decoded = await decodeImageBytes(source.bytes, source.mime);
    try {
      const tiles: Array<{ name: string; bytes: Uint8Array }> = [];
      for (const tile of grid.tiles) {
        const canvas = document.createElement('canvas');
        canvas.width = tile.width;
        canvas.height = tile.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the tile canvas.');
        context.drawImage(decoded.source, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
        tiles.push({ name: tileName(TILE_NAME_TEMPLATE, tile), bytes: await canvasToPng(canvas) });
      }
      return tiles;
    } finally {
      decoded.close();
    }
  }, [grid.tiles]);

  const saveBatch = useCallback((): Promise<void> => runner.run(async () => {
    if (!picked || !folder) throw new Error('Choose a photo and a folder first.');
    const tiles = await renderTiles(picked);
    const failures: string[] = [];
    let saved = 0;
    /* Sequential on purpose: the folder is one SAF tree, and a batch of parallel
     * createDocument calls against it is exactly how providers hand back
     * duplicate or half-written names. */
    for (const tile of tiles) {
      try {
        await saveToolFileIntoDirectory(folder, tile.bytes, tile.name, 'image/png');
        saved += 1;
      } catch (error) {
        failures.push(`${tile.name}: ${error instanceof Error ? error.message : copy('Failed')}`);
      }
    }
    const summary = `${copy('Tiles saved')} · ${saved}/${tiles.length}`;
    if (failures.length > 0) throw new Error(`${summary} — ${failures[0]}`);
    return grid.warning ? `${summary} · ${grid.warning}` : summary;
  }, 'Processing'), [copy, folder, grid.warning, picked, renderTiles, runner]);

  /* Without a writable folder the only honest route is the platform save sheet,
   * one per tile — and the panel says so instead of pretending the batch ran. */
  const savePerFile = useCallback((): Promise<void> => runner.run(async () => {
    if (!picked) throw new Error('Choose a photo first.');
    const tiles = await renderTiles(picked);
    let saved = 0;
    for (const tile of tiles) {
      const target = await saveToolFile(tile.bytes, tile.name, ['png']);
      if (!target) break;
      saved += 1;
    }
    const summary = `${copy('Tiles saved')} · ${saved}/${tiles.length}`;
    return saved === tiles.length ? summary : `${summary} · ${copy('Save cancelled — nothing was written.')}`;
  }, 'Processing'), [copy, picked, renderTiles, runner]);

  return (
    <ToolScaffold
      title="Grid splitter"
      blurb="Cut one photo into a seamless grid for social feeds."
      icon={<Grid2x2 size={20} />}
      phase={runner.phase}
      pickLabel="Choose a photo"
      onPick={() => void choose()}
      pickedName={picked?.name ?? null}
      actionLabel={canBatch ? `Save ${grid.tiles.length} to folder` : `Cut into ${grid.tiles.length} tiles`}
      onAction={() => void (canBatch ? saveBatch() : savePerFile())}
      actionDisabled={!picked || grid.tiles.length === 0}
      status={runner.status}
      statusTone={runner.tone}
    >
      <KnouxSlider label="Rows" value={rows} min={1} max={6} step={1} decimals={0} defaultValue={3} gesture="grid-rows" onChange={(value) => setRows(Math.round(value))} />
      <KnouxSlider label="Columns" value={columns} min={1} max={6} step={1} decimals={0} defaultValue={3} gesture="grid-columns" onChange={(value) => setColumns(Math.round(value))} />
      <KnouxSlider label="Gutter" value={gutter} min={0} max={40} step={1} unit="px" decimals={0} defaultValue={0} gesture="grid-gutter" onChange={(value) => setGutter(Math.round(value))} />

      <div className="kmt-tool-pick">
        <KnouxAction label="Save folder" icon={FolderOpen} onClick={() => void chooseFolder()} disabled={runner.phase === 'working'} />
        {folder ? (
          <span className="kmt-tool-file"><bdi>{folderDisplayName(folder)}</bdi><Download size={13} aria-hidden="true" /></span>
        ) : (
          <span className="kmt-tool-file is-empty">{copy('No folder picked')}</span>
        )}
      </div>

      {grid.tiles.length > 0 && (
        <div className="kmt-readout-row">
          <span>{copy('Tiles')}: <bdi>{grid.tiles.length}</bdi></span>
          <span><bdi>{grid.tileWidth} × {grid.tileHeight}</bdi></span>
        </div>
      )}
      {grid.warning && <KnouxPanelNotice tone="warn">{grid.warning}</KnouxPanelNotice>}
      {picked && !folder && <KnouxPanelNotice>{copy('Pick a folder to save every tile in one go. Without one, each tile asks the save sheet separately.')}</KnouxPanelNotice>}
      {picked && folder && !canBatch && <KnouxPanelNotice tone="warn">{copy('This build cannot create files inside a folder, so tiles save one by one.')}</KnouxPanelNotice>}
    </ToolScaffold>
  );
};

/* ------------------------------------------------------------ merge */

export const PhotoMergeTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [layout, setLayout] = useState<'row' | 'column' | 'grid'>('row');
  const [gap, setGap] = useState(12);
  const [pad, setPad] = useState(16);

  const add = useCallback(async (): Promise<void> => {
    runner.reset();
    try {
      const file = await pickToolFile('image');
      if (!file) return;
      setFiles((current) => [...current, file].slice(0, 9));
      runner.reset();
    } catch {
      runner.reset();
    }
  }, [runner]);

  const merge = useCallback((): Promise<void> => runner.run(async () => {
    if (files.length < 2) throw new Error('Add at least two photos.');
    const decoded = await Promise.all(files.map(async (file) => {
      const image = await decodeImageBytes(file.bytes, file.mime);
      return { image, width: image.width, height: image.height };
    }));
    try {
      const cell = decoded.reduce((maximum, entry) => Math.max(maximum, entry.width, entry.height), 0);
      const columnsFor = layout === 'row' ? decoded.length : layout === 'column' ? 1 : Math.ceil(Math.sqrt(decoded.length));
      const rowsFor = Math.ceil(decoded.length / columnsFor);
      const canvas = document.createElement('canvas');
      canvas.width = pad * 2 + columnsFor * cell + Math.max(0, columnsFor - 1) * gap;
      canvas.height = pad * 2 + rowsFor * cell + Math.max(0, rowsFor - 1) * gap;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the merge canvas.');
      context.fillStyle = '#0b0714';
      context.fillRect(0, 0, canvas.width, canvas.height);
      decoded.forEach((entry, index) => {
        const column = index % columnsFor;
        const row = Math.floor(index / columnsFor);
        const x = pad + column * (cell + gap);
        const y = pad + row * (cell + gap);
        const scale = Math.min(cell / entry.width, cell / entry.height);
        const drawWidth = entry.width * scale;
        const drawHeight = entry.height * scale;
        context.drawImage(entry.image.source, x + (cell - drawWidth) / 2, y + (cell - drawHeight) / 2, drawWidth, drawHeight);
      });
      const bytes = await canvasToPng(canvas);
      const saved = await saveToolFile(bytes, `KNOUX_Merge_${decoded.length}.png`, ['png']);
      if (!saved) return copy('Save cancelled — nothing was written.');
      return copy('Merged photo saved');
    } finally {
      decoded.forEach((entry) => entry.image.close());
    }
  }, 'Processing'), [copy, files, gap, layout, pad, runner]);

  return (
    <ToolScaffold
      title="Photo merge"
      blurb="Stack photos side by side or on top of each other in seconds."
      icon={<Images size={20} />}
      phase={runner.phase}
      pickLabel="Add photo"
      onPick={() => void add()}
      pickedName={files.length > 0 ? `${files.length} · ${files[files.length - 1].name}` : null}
      actionLabel="Export"
      onAction={() => void merge()}
      actionDisabled={files.length < 2}
      status={runner.status}
      statusTone={runner.tone}
    >
      <KnouxChipGroup
        label="Layout"
        value={layout}
        options={[
          { value: 'row', label: 'Side by side' },
          { value: 'column', label: 'Stacked' },
          { value: 'grid', label: 'Grid auto' },
        ]}
        onChange={(value) => setLayout(value as typeof layout)}
      />
      <KnouxSlider label="Gap" value={gap} min={0} max={64} step={1} unit="px" decimals={0} defaultValue={12} gesture="merge-gap" onChange={(value) => setGap(Math.round(value))} />
      <KnouxSlider label="Padding" value={pad} min={0} max={64} step={1} unit="px" decimals={0} defaultValue={16} gesture="merge-pad" onChange={(value) => setPad(Math.round(value))} />
      {files.length > 0 && (
        <div className="kmt-strip">
          {files.map((file, index) => (
            <button
              key={`${file.path}-${index}`}
              type="button"
              className="kmt-strip-item"
              aria-label={file.name}
              onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
            >
              <bdi>{file.name}</bdi>
              <small>{copy('Remove')}</small>
            </button>
          ))}
        </div>
      )}
    </ToolScaffold>
  );
};

/* ------------------------------------------------------- audio extract */

export const AudioExtractorTool: React.FC = () => {
  const copy = useMobileCopy();
  const runner = useToolRunner();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [pcm, setPcm] = useState<PcmSource | null>(null);
  const [sampleRate, setSampleRate] = useState(44_100);

  const choose = useCallback(async (): Promise<void> => {
    runner.reset();
    setPcm(null);
    try {
      const file = await pickToolFile('video');
      if (!file) return;
      setPicked(file);
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('This device has no Web Audio decoder.');
      const context = new AudioContextClass();
      try {
        const decoded = await context.decodeAudioData(file.bytes.slice().buffer);
        setPcm({
          channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => new Float32Array(decoded.getChannelData(channel))),
          sampleRate: decoded.sampleRate,
        });
        setSampleRate(decoded.sampleRate);
        runner.reset();
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch (error) {
      setPicked(null);
      setPcm(null);
      // Honest, specific: the WebView's decoder rejected this container.
      runner.reset();
    }
  }, [runner]);

  const save = useCallback((): Promise<void> => runner.run(async () => {
    if (!pcm) throw new Error('This device cannot decode that container.');
    const bytes = encodeWav(pcm, { bitDepth: 16 });
    const saved = await saveToolFile(bytes, `KNOUX_Audio_${Math.round(pcmDurationSeconds(pcm))}s.wav`, ['wav']);
    if (!saved) return copy('Save cancelled — nothing was written.');
    return copy('Audio saved');
  }, 'Processing'), [copy, pcm, runner]);

  return (
    <ToolScaffold
      title="Audio extractor"
      blurb="Lift the soundtrack out of a video and keep it as WAV."
      icon={<Music2 size={20} />}
      phase={runner.phase}
      pickLabel="Choose a video"
      onPick={() => void choose()}
      pickedName={picked?.name ?? null}
      actionLabel="Extract audio"
      onAction={() => void save()}
      actionDisabled={!pcm}
      status={runner.status}
      statusTone={runner.tone}
    >
      {pcm && (
        <div className="kmt-readout-row">
          <span><Volume2 size={13} aria-hidden="true" /> <bdi>{pcmDurationSeconds(pcm).toFixed(1)}s</bdi></span>
          <span>{copy('Sample rate')}: <bdi>{sampleRate} Hz</bdi></span>
          <span>{copy('Channels')}: <bdi>{pcm.channels.length}</bdi></span>
        </div>
      )}
    </ToolScaffold>
  );
};

/* -------------------------------------------------- resolution calc */

export const ResolutionCalculatorTool: React.FC = () => {
  const copy = useMobileCopy();
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const presets = useMemo(() => [
    { id: 'reels', label: '9:16 Reels', width: 1080, height: 1920 },
    { id: 'post', label: '1:1 Post', width: 1080, height: 1080 },
    { id: 'story', label: '4:5 Feed', width: 1080, height: 1350 },
    { id: 'yt', label: '16:9 Video', width: 1920, height: 1080 },
    { id: 'banner', label: 'Banner', width: 1500, height: 500 },
  ], []);

  const pixels = width * height;
  const ratio = height > 0 ? width / height : 0;
  return (
    <ToolScaffold
      title="Resolution calculator"
      blurb="Check whether a size fits a platform and what it weighs."
      icon={<Ruler size={20} />}
      phase={pixels > 0 ? 'ready' : 'idle'}
    >
      <KnouxChipGroup
        label="Aspect presets"
        value={`${width}x${height}`}
        options={presets.map((preset) => ({ value: `${preset.width}x${preset.height}`, label: preset.label }))}
        onChange={(value) => {
          const [w, h] = value.split('x').map(Number);
          setWidth(w);
          setHeight(h);
        }}
      />
      <KnouxSlider label="Width" value={width} min={64} max={8000} step={1} unit="px" decimals={0} gesture="calc-width" onChange={setWidth} />
      <KnouxSlider label="Height" value={height} min={64} max={8000} step={1} unit="px" decimals={0} gesture="calc-height" onChange={setHeight} />
      <div className="kmt-readout-row">
        <span><bdi>{ratio.toFixed(3)}</bdi></span>
        <span>{copy('Megapixels')}: <bdi>{(pixels / 1_000_000).toFixed(2)}</bdi></span>
        <span>{copy('Estimated weight')}: <bdi>{formatByteSize(Math.round(pixels * 3 * 0.12))}</bdi></span>
      </div>
      <KnouxGroupLabel hint={pixels > 25_000_000 ? 'Too large' : 'Fits'}>Aspect ratio</KnouxGroupLabel>
    </ToolScaffold>
  );
};
