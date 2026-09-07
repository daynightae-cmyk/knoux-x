import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Mic2, MonitorUp, Play, Square, Video } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';

type CapturePlugin = {
  startScreenRecording(options: { width: number; height: number; fps: number; bitrate: number; microphone: boolean }): Promise<{ recording?: boolean }>;
  stopScreenRecording(): Promise<{ recording?: boolean; outputUri?: string | null }>;
  status(): Promise<{ recording?: boolean; outputUri?: string | null }>;
};

type Resolution = 'native' | '1080p' | '720p';

function plugin(): CapturePlugin | null {
  if (window.knouxRuntime?.edition !== 'android') return null;
  return window.Capacitor?.Plugins?.KnouxScreenCapture ?? null;
}

function dimensionsFor(resolution: Resolution): { width: number; height: number } {
  const portrait = window.innerHeight >= window.innerWidth;
  if (resolution === 'native') return { width: 0, height: 0 };
  const landscape = resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  return portrait ? { width: landscape.height, height: landscape.width } : landscape;
}

export const MobileScreenRecordingView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [fps, setFps] = useState<30 | 60>(30);
  const [bitrateMbps, setBitrateMbps] = useState<8 | 12 | 20>(12);
  const [microphone, setMicrophone] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputUri, setOutputUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capture = useMemo(plugin, []);

  const start = useCallback(async (): Promise<void> => {
    if (!capture || busy || recording) return;
    setBusy(true);
    setError(null);
    setOutputUri(null);
    try {
      const dimensions = dimensionsFor(resolution);
      const result = await capture.startScreenRecording({
        ...dimensions,
        fps,
        bitrate: bitrateMbps * 1_000_000,
        microphone,
      });
      setRecording(result.recording === true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Android MediaProjection could not start.');
    } finally {
      setBusy(false);
    }
  }, [bitrateMbps, busy, capture, fps, microphone, recording, resolution]);

  const stop = useCallback(async (): Promise<void> => {
    if (!capture || busy || !recording) return;
    setBusy(true);
    setError(null);
    try {
      const result = await capture.stopScreenRecording();
      setRecording(false);
      setOutputUri(result.outputUri ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Android screen recording could not be finalized.');
    } finally {
      setBusy(false);
    }
  }, [busy, capture, recording]);

  const openRecording = useCallback((): void => {
    if (!outputUri) return;
    setCurrentMedia(outputUri);
    setView('player');
  }, [outputUri, setCurrentMedia, setView]);

  return (
    <section className="knoux-mobile-recording" data-component="MobileScreenRecordingView">
      <header className="kmr-topbar">
        <button type="button" aria-label="Back" onClick={() => setView('home')} disabled={recording || busy}><ArrowLeft size={21} /></button>
        <div><BrandMark size={38} /><span><strong>KNOUX <em>X</em></strong><small>SCREEN RECORDING</small></span></div>
        <span className={recording ? 'live' : ''}>{recording ? 'REC' : 'LOCAL'}</span>
      </header>

      <div className="kmr-hero">
        <div className="kmr-orb"><MonitorUp size={46} /></div>
        <span>NATIVE MEDIAPROJECTION</span>
        <h1>Record the screen <em>without WebView capture hacks.</em></h1>
        <p>Android owns the capture permission, H.264 encoding and MP4 output. The recording is written into Movies/KNOUX X.</p>
      </div>

      {error && <div className="kmr-error" role="alert">{error}</div>}

      <section className="kmr-panel">
        <div className="kmr-field">
          <span>Resolution</span>
          <div>{(['native', '1080p', '720p'] as Resolution[]).map((value) => <button type="button" key={value} className={resolution === value ? 'active' : ''} onClick={() => setResolution(value)} disabled={recording || busy}>{value === 'native' ? 'Device' : value}</button>)}</div>
        </div>
        <div className="kmr-field">
          <span>Frame rate</span>
          <div>{([30, 60] as const).map((value) => <button type="button" key={value} className={fps === value ? 'active' : ''} onClick={() => setFps(value)} disabled={recording || busy}>{value} FPS</button>)}</div>
        </div>
        <div className="kmr-field">
          <span>Video bitrate</span>
          <div>{([8, 12, 20] as const).map((value) => <button type="button" key={value} className={bitrateMbps === value ? 'active' : ''} onClick={() => setBitrateMbps(value)} disabled={recording || busy}>{value} Mbps</button>)}</div>
        </div>
        <label className="kmr-toggle"><span><Mic2 size={18} /><b>Microphone</b><small>Record microphone if Android permission is granted.</small></span><input type="checkbox" checked={microphone} onChange={(event) => setMicrophone(event.currentTarget.checked)} disabled={recording || busy} /></label>
      </section>

      {!recording ? (
        <button type="button" className="kmr-primary" onClick={() => void start()} disabled={!capture || busy}><Play size={20} fill="currentColor" /> {busy ? 'Requesting permission…' : 'Start screen recording'}</button>
      ) : (
        <button type="button" className="kmr-primary kmr-stop" onClick={() => void stop()} disabled={busy}><Square size={19} fill="currentColor" /> {busy ? 'Finalizing MP4…' : 'Stop & save MP4'}</button>
      )}

      {outputUri && (
        <button type="button" className="kmr-output" onClick={openRecording}>
          <CheckCircle2 size={22} /><span><strong>Recording saved</strong><small>Tap to open it in KNOUX Player.</small></span><Video size={20} />
        </button>
      )}
    </section>
  );
};
