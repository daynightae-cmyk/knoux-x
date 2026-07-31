import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Circle,
  FileVideo,
  FolderOpen,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Square,
  Volume2,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { useTranslation } from '../../i18n';
import type { RecordingSessionSnapshot } from '../../../electron/creative/recording-service';
import type { DesktopCaptureSource } from '../../../electron/preload-creative';

interface LegacyDesktopTrackConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxWidth?: number;
    maxHeight?: number;
    maxFrameRate?: number;
  };
}

type RecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

function supportedMimeType(): string | null {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

function statusKey(status: RecordingStatus): string {
  const keys: Record<RecordingStatus, string> = {
    idle: 'recording.statusIdle',
    starting: 'recording.statusStarting',
    recording: 'recording.statusRecording',
    paused: 'recording.statusPaused',
    stopping: 'recording.statusStopping',
  };
  return keys[status];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const RecordingView: React.FC = () => {
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [recordings, setRecordings] = useState<RecordingSessionSnapshot[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef(0);
  const cancelRequestedRef = useRef(false);
  const { locale, t } = useTranslation();

  const loadSources = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const next = await window.knouxCreativeAPI.capture.getDesktopSources();
      setSources(next);
      setSelectedSourceId((current) => current || next[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('recording.loadSourcesFailed'));
    }
  }, [t]);

  const loadRecordings = useCallback(async (): Promise<void> => {
    try {
      const next = await window.knouxCreativeAPI.recording.list();
      setRecordings(next.filter((entry) => entry.state.status === 'completed'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('recording.historyFailed'));
    }
  }, [t]);

  useEffect(() => {
    void loadSources();
    void loadRecordings();
  }, [loadRecordings, loadSources]);

  useEffect(() => {
    if (status !== 'recording') return undefined;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  const cleanupStreams = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    sessionIdRef.current = null;
  }, []);

  useEffect(() => () => {
    cancelRequestedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanupStreams();
  }, [cleanupStreams]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!selectedSourceId || status !== 'idle') return;
    const mimeType = supportedMimeType();
    if (!mimeType) {
      setError(t('recording.unsupported'));
      return;
    }

    setStatus('starting');
    setError(null);
    cancelRequestedRef.current = false;
    try {
      const granted = await window.knouxCreativeAPI.recording.requestMediaPermission();
      if (!granted) throw new Error(t('recording.permissionDenied'));

      const desktopVideo = {
        mandatory: {
          chromeMediaSource: 'desktop' as const,
          chromeMediaSourceId: selectedSourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60,
        },
      } satisfies LegacyDesktopTrackConstraints;
      const desktopAudio = {
        mandatory: {
          chromeMediaSource: 'desktop' as const,
          chromeMediaSourceId: selectedSourceId,
        },
      } satisfies LegacyDesktopTrackConstraints;
      const desktopStream = await navigator.mediaDevices.getUserMedia({
        video: desktopVideo as unknown as MediaTrackConstraints,
        audio: desktopAudio as unknown as MediaTrackConstraints,
      });

      let combinedStream = desktopStream;
      if (includeMicrophone) {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        combinedStream = new MediaStream([
          ...desktopStream.getVideoTracks(),
          ...desktopStream.getAudioTracks(),
          ...microphone.getAudioTracks(),
        ]);
      }

      const source = sources.find((entry) => entry.id === selectedSourceId);
      const session = await window.knouxCreativeAPI.recording.begin({
        source: selectedSourceId.startsWith('screen:') ? 'display' : 'window',
        mimeType,
        suggestedName: source?.name ?? 'KNOUX recording',
        countdownSeconds: 0,
      });
      if (!session) {
        combinedStream.getTracks().forEach((track) => track.stop());
        setStatus('idle');
        return;
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      });
      sessionIdRef.current = session.id;
      streamRef.current = combinedStream;
      recorderRef.current = recorder;
      writeChainRef.current = Promise.resolve();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0 || !sessionIdRef.current || cancelRequestedRef.current) return;
        const sessionId = sessionIdRef.current;
        writeChainRef.current = writeChainRef.current.then(async () => {
          const chunk = await event.data.arrayBuffer();
          await window.knouxCreativeAPI.recording.append(sessionId, chunk);
        });
      });
      recorder.addEventListener('error', (event) => {
        const mediaError = event as Event & { error?: DOMException };
        setError(mediaError.error?.message ?? t('recording.mediaRecorderFailed'));
      });
      combinedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      });
      recorder.addEventListener('stop', () => {
        void (async () => {
          setStatus('stopping');
          const sessionId = sessionIdRef.current;
          try {
            await writeChainRef.current;
            if (sessionId && !cancelRequestedRef.current) {
              await window.knouxCreativeAPI.recording.finish(sessionId);
              await loadRecordings();
            }
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : t('recording.finalizeFailed'));
          } finally {
            cleanupStreams();
            setStatus('idle');
          }
        })();
      });

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setStatus('recording');
    } catch (reason) {
      cleanupStreams();
      setStatus('idle');
      setError(reason instanceof Error ? reason.message : t('recording.startFailed'));
    }
  }, [cleanupStreams, includeMicrophone, loadRecordings, selectedSourceId, sources, status, t]);

  const pauseRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'recording') return;
    recorder.pause();
    await window.knouxCreativeAPI.recording.pause(sessionId);
    setStatus('paused');
  }, []);

  const resumeRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'paused') return;
    recorder.resume();
    await window.knouxCreativeAPI.recording.resume(sessionId);
    startedAtRef.current = Date.now() - elapsed * 1000;
    setStatus('recording');
  }, [elapsed]);

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    cancelRequestedRef.current = true;
    const sessionId = sessionIdRef.current;
    const recorder = recorderRef.current;
    if (sessionId) {
      try {
        await window.knouxCreativeAPI.recording.cancel(sessionId);
      } catch {
        // A session already entering finalization is cleaned by the main process.
      }
    }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanupStreams();
    setStatus('idle');
  }, [cleanupStreams]);

  const statusLabel = t(statusKey(status));

  return (
    <section className="creative-view" aria-labelledby="recording-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('recording.eyebrow')}</span>
          <h1 id="recording-title"><Circle size={30} /> {t('recording.title')}</h1>
          <p>{t('recording.description')}</p>
        </div>
        <div className={`recording-indicator ${status === 'recording' ? 'active' : ''}`} role="status">
          <span /> {status === 'recording' || status === 'paused' ? `${statusLabel} ${elapsed}s` : statusLabel}
        </div>
      </header>

      <RuntimeModeNotice feature="Native desktop recording" featureAr="ميزة التسجيل الأصلية لسطح المكتب" />

      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="recording-layout">
        <NeonPanel variant="dark" padding="lg">
          <div className="creative-form-grid">
            <label>
              <span>{t('recording.source')}</span>
              <select value={selectedSourceId} onChange={(event) => setSelectedSourceId(event.target.value)} disabled={status !== 'idle'}>
                {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            </label>
            <label className="creative-check">
              <input
                type="checkbox"
                checked={includeMicrophone}
                onChange={(event) => setIncludeMicrophone(event.target.checked)}
                disabled={status !== 'idle'}
              />
              <Volume2 size={16} /> {t('recording.microphone')}
            </label>
          </div>

          <div className="creative-actions">
            {status === 'idle' && (
              <NeonButton variant="primary" leftIcon={<Circle size={16} />} onClick={() => void startRecording()} disabled={!selectedSourceId}>
                {t('recording.start')}
              </NeonButton>
            )}
            {status === 'recording' && (
              <>
                <NeonButton variant="secondary" leftIcon={<Pause size={16} />} onClick={() => void pauseRecording()}>{t('recording.pause')}</NeonButton>
                <NeonButton variant="primary" leftIcon={<Square size={16} />} onClick={stopRecording}>{t('recording.stop')}</NeonButton>
              </>
            )}
            {status === 'paused' && (
              <>
                <NeonButton variant="secondary" leftIcon={<Play size={16} />} onClick={() => void resumeRecording()}>{t('recording.resume')}</NeonButton>
                <NeonButton variant="primary" leftIcon={<Square size={16} />} onClick={stopRecording}>{t('recording.stop')}</NeonButton>
              </>
            )}
            {status !== 'idle' && status !== 'stopping' && (
              <NeonButton variant="ghost" onClick={() => void cancelRecording()}>{t('recording.cancelDelete')}</NeonButton>
            )}
          </div>
        </NeonPanel>

        <div className="source-grid">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className={`source-card ${selectedSourceId === source.id ? 'selected' : ''}`}
              onClick={() => status === 'idle' && setSelectedSourceId(source.id)}
              aria-pressed={selectedSourceId === source.id}
            >
              <img src={source.thumbnail} alt="" />
              <span><Monitor size={15} /> {source.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="creative-section-heading">
        <h2><FileVideo size={20} /> {t('recording.recent')}</h2>
        <NeonButton variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void loadRecordings()}>
          {t('common.refresh')}
        </NeonButton>
      </div>

      {recordings.length === 0 ? (
        <div className="creative-empty">{t('recording.historyEmpty')}</div>
      ) : (
        <div className="capture-grid">
          {recordings.map((entry) => (
            <NeonPanel key={entry.id} variant="dark" padding="sm">
              <div className="capture-card">
                <div>
                  <strong dir="auto">{entry.outputPath.split(/[\\/]/).pop()}</strong>
                  <div className="capture-path" dir="ltr">{formatBytes(entry.bytesWritten)}</div>
                  <small>
                    {entry.completedAt
                      ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.completedAt))
                      : ''}
                  </small>
                </div>
                <NeonButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<FolderOpen size={14} />}
                  onClick={() => void window.knouxCreativeAPI.recording.showItem(entry.outputPath)}
                >
                  {t('capture.showFolder')}
                </NeonButton>
              </div>
            </NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
