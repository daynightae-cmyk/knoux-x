import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Gauge, Monitor, X } from 'lucide-react';

import type { ProbeResult } from '../../../electron/creative/ffmpeg-service';
import {
  classifyResolution,
  droppedFramePercentage,
  estimateDecodedFps,
  mediaCapabilitiesContentType,
  playbackHealthLabel,
} from '../../core/player/playbackDiagnostics';
import type { FrameRateSample } from '../../core/player/playbackDiagnostics';
import { useTranslation } from '../../i18n';
import { usePlayerStore } from '../../store/playerStore';

interface ExtendedVideoStream {
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  field_order?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
}

interface RuntimeMetrics {
  width: number;
  height: number;
  totalFrames: number;
  droppedFrames: number;
  droppedPercentage: number;
  decodedFps: number | null;
  readyState: number;
  bufferedSeconds: number;
}

interface CapabilityState {
  supported: boolean | null;
  smooth: boolean | null;
  powerEfficient: boolean | null;
}

type BuildInfo = Awaited<ReturnType<Window['knouxAPI']['system']['getBuildInfo']>>;
type IpcHealth = Awaited<ReturnType<Window['knouxAPI']['system']['getIpcHealth']>>;

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || numerator <= 0) return null;
  if (Number.isFinite(denominator) && denominator > 0) return numerator / denominator;
  return numerator;
}

function formatBitrate(value: string | undefined): string {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0) return '—';
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bits / 1000)} kbps`;
}

function qualityFor(video: HTMLVideoElement): { total: number; dropped: number } {
  if (typeof video.getVideoPlaybackQuality === 'function') {
    const quality = video.getVideoPlaybackQuality();
    return { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
  }
  const legacy = video as HTMLVideoElement & {
    webkitDecodedFrameCount?: number;
    webkitDroppedFrameCount?: number;
  };
  return {
    total: legacy.webkitDecodedFrameCount ?? 0,
    dropped: legacy.webkitDroppedFrameCount ?? 0,
  };
}

export interface PlayerDiagnosticsPanelProps {
  onClose(): void;
}

export const PlayerDiagnosticsPanel: React.FC<PlayerDiagnosticsPanelProps> = ({ onClose }) => {
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RuntimeMetrics | null>(null);
  const [capability, setCapability] = useState<CapabilityState>({ supported: null, smooth: null, powerEfficient: null });
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [ipcHealth, setIpcHealth] = useState<IpcHealth | null>(null);
  const previousFrameRef = useRef<FrameRateSample | null>(null);
  const { t } = useTranslation();

  const videoStream = useMemo(() => (
    probe?.streams?.find((stream) => stream.codec_type === 'video') as ExtendedVideoStream | undefined
  ), [probe]);
  const audioStream = useMemo(() => probe?.streams?.find((stream) => stream.codec_type === 'audio'), [probe]);
  const width = metrics?.width || videoStream?.width || 0;
  const height = metrics?.height || videoStream?.height || 0;
  const resolutionClass = classifyResolution(width, height);
  const sourceFrameRate = parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate);
  const health = playbackHealthLabel(metrics?.droppedPercentage ?? 0);

  useEffect(() => {
    let active = true;
    void Promise.all([window.knouxAPI.system.getBuildInfo(), window.knouxAPI.system.getIpcHealth()])
      .then(([identity, ipc]) => {
        if (active) {
          setBuildInfo(identity);
          setIpcHealth(ipc);
        }
      })
      .catch(() => {
        if (active) {
          setBuildInfo(null);
          setIpcHealth(null);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setProbe(null);
    setProbeError(null);
    if (!currentMedia) return;
    let active = true;
    void window.knouxCreativeAPI.export.probe(currentMedia)
      .then((result) => { if (active) setProbe(result); })
      .catch((reason) => {
        if (active) setProbeError(reason instanceof Error ? reason.message : t('diagnostics.probeFailed'));
      });
    return () => { active = false; };
  }, [currentMedia, t]);

  useEffect(() => {
    const collect = (): void => {
      const video = document.querySelector('video.video-element');
      if (!(video instanceof HTMLVideoElement)) {
        setMetrics(null);
        previousFrameRef.current = null;
        return;
      }
      const frameQuality = qualityFor(video);
      const now: FrameRateSample = { totalVideoFrames: frameQuality.total, timestampMs: performance.now() };
      const decodedFps = estimateDecodedFps(previousFrameRef.current, now);
      previousFrameRef.current = now;
      const bufferedSeconds = video.buffered.length > 0
        ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
        : 0;
      setMetrics({
        width: video.videoWidth,
        height: video.videoHeight,
        totalFrames: frameQuality.total,
        droppedFrames: frameQuality.dropped,
        droppedPercentage: droppedFramePercentage({
          totalVideoFrames: frameQuality.total,
          droppedVideoFrames: frameQuality.dropped,
        }),
        decodedFps,
        readyState: video.readyState,
        bufferedSeconds,
      });
    };
    collect();
    const timer = window.setInterval(collect, 1000);
    return () => window.clearInterval(timer);
  }, [currentMedia]);

  useEffect(() => {
    const codecType = mediaCapabilitiesContentType(videoStream?.codec_name);
    if (!codecType || width <= 0 || height <= 0 || !navigator.mediaCapabilities?.decodingInfo) {
      setCapability({ supported: null, smooth: null, powerEfficient: null });
      return;
    }
    let active = true;
    void navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: {
        contentType: codecType,
        width,
        height,
        bitrate: Number(videoStream?.bit_rate ?? probe?.format?.bit_rate ?? 8_000_000),
        framerate: sourceFrameRate ?? 30,
      },
    }).then((result) => {
      if (active) setCapability({ supported: result.supported, smooth: result.smooth, powerEfficient: result.powerEfficient });
    }).catch(() => {
      if (active) setCapability({ supported: null, smooth: null, powerEfficient: null });
    });
    return () => { active = false; };
  }, [height, probe?.format?.bit_rate, sourceFrameRate, videoStream?.bit_rate, videoStream?.codec_name, width]);

  return (
    <aside className="player-diagnostics-panel" aria-label={t('diagnostics.title')}>
      <header>
        <div><Activity size={18} /><strong>{t('diagnostics.title')}</strong></div>
        <button type="button" onClick={onClose} aria-label={t('common.cancel')}><X size={17} /></button>
      </header>

      <section className="player-diagnostics-foundation" aria-label="Developer foundation">
        <h3><Cpu size={15} /> Developer foundation</h3>
        <dl>
          <div><dt>Build</dt><dd>{buildInfo ? `${buildInfo.version} · ${buildInfo.sha.slice(0, 12)}` : '—'}</dd></div>
          <div><dt>Branch</dt><dd>{buildInfo?.branch ?? '—'}</dd></div>
          <div><dt>Runtime</dt><dd>{buildInfo ? `${buildInfo.packaged ? 'Packaged' : 'Development'} · Electron ${buildInfo.electronVersion}` : '—'}</dd></div>
          <div><dt>Built</dt><dd>{buildInfo?.builtAt ?? '—'}</dd></div>
          <div><dt>IPC health</dt><dd data-health={ipcHealth?.status}>{ipcHealth ? `${ipcHealth.status} · ${ipcHealth.missing.length} missing · ${ipcHealth.duplicates.length} duplicates` : '—'}</dd></div>
          <div><dt>Preload</dt><dd title={ipcHealth?.preloadPath}>{ipcHealth?.preloadPath ?? '—'}</dd></div>
        </dl>
      </section>

      {!currentMedia ? (
        <div className="player-diagnostics-empty">{t('diagnostics.noMedia')}</div>
      ) : (
        <div className="player-diagnostics-content">
          <section>
            <h3><Monitor size={15} /> {t('diagnostics.video')}</h3>
            <dl>
              <div><dt>{t('diagnostics.resolution')}</dt><dd dir="ltr">{width && height ? `${width}×${height} · ${resolutionClass}` : '—'}</dd></div>
              <div><dt>{t('diagnostics.codec')}</dt><dd>{videoStream?.codec_name?.toUpperCase() ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.profile')}</dt><dd>{videoStream?.profile ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.pixelFormat')}</dt><dd>{videoStream?.pix_fmt ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.color')}</dt><dd>{[videoStream?.color_space, videoStream?.color_primaries, videoStream?.color_transfer].filter(Boolean).join(' · ') || '—'}</dd></div>
              <div><dt>{t('diagnostics.hdrMetadata')}</dt><dd>{videoStream?.side_data_list?.length ? t('common.yes') : t('common.no')}</dd></div>
              <div><dt>{t('diagnostics.sourceFps')}</dt><dd>{sourceFrameRate?.toFixed(2) ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.bitrate')}</dt><dd>{formatBitrate(videoStream?.bit_rate ?? probe?.format?.bit_rate)}</dd></div>
            </dl>
          </section>

          <section>
            <h3><Gauge size={15} /> {t('diagnostics.runtime')}</h3>
            <dl>
              <div><dt>{t('diagnostics.decodedFps')}</dt><dd>{metrics?.decodedFps?.toFixed(1) ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.totalFrames')}</dt><dd>{metrics?.totalFrames ?? 0}</dd></div>
              <div><dt>{t('diagnostics.droppedFrames')}</dt><dd>{metrics ? `${metrics.droppedFrames} · ${metrics.droppedPercentage.toFixed(2)}%` : '—'}</dd></div>
              <div><dt>{t('diagnostics.health')}</dt><dd data-health={health}>{t(`diagnostics.health_${health}`)}</dd></div>
              <div><dt>{t('diagnostics.buffered')}</dt><dd>{metrics ? `${metrics.bufferedSeconds.toFixed(1)}s` : '—'}</dd></div>
              <div><dt>{t('diagnostics.readyState')}</dt><dd>{metrics?.readyState ?? '—'}</dd></div>
            </dl>
          </section>

          <section>
            <h3><Cpu size={15} /> {t('diagnostics.decoderCapability')}</h3>
            <dl>
              <div><dt>{t('diagnostics.supported')}</dt><dd>{capability.supported === null ? '—' : capability.supported ? t('common.yes') : t('common.no')}</dd></div>
              <div><dt>{t('diagnostics.smooth')}</dt><dd>{capability.smooth === null ? '—' : capability.smooth ? t('common.yes') : t('common.no')}</dd></div>
              <div><dt>{t('diagnostics.powerEfficient')}</dt><dd>{capability.powerEfficient === null ? '—' : capability.powerEfficient ? t('common.yes') : t('common.no')}</dd></div>
            </dl>
            <p>{t('diagnostics.powerEfficientNote')}</p>
          </section>

          <section>
            <h3>{t('diagnostics.audio')}</h3>
            <dl>
              <div><dt>{t('diagnostics.codec')}</dt><dd>{audioStream?.codec_name?.toUpperCase() ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.channels')}</dt><dd>{audioStream?.channels ?? '—'}</dd></div>
              <div><dt>{t('diagnostics.sampleRate')}</dt><dd>{audioStream?.sample_rate ? `${audioStream.sample_rate} Hz` : '—'}</dd></div>
            </dl>
          </section>

          {probeError && <div className="player-diagnostics-warning">{probeError}</div>}
        </div>
      )}
    </aside>
  );
};
