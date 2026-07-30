import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Monitor, Pause, Play, Square, Volume2 } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
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

function supportedMimeType(): string | null {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

export const RecordingView: React.FC = () => {
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'stopping'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef(0);
  const cancelRequestedRef = useRef(false);

  const loadSources = useCallback(async () => {
    setError(null);
    try {
      const next = await window.knouxCreativeAPI.capture.getDesktopSources();
      setSources(next);
      setSelectedSourceId((current) => current || next[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to enumerate capture sources.');
    }
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  useEffect(() => {
    if (status !== 'recording') return undefined;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  const cleanupStreams = useCallback(() => {
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

  const startRecording = useCallback(async () => {
    if (!selectedSourceId || status !== 'idle') return;
    const mimeType = supportedMimeType();
    if (!mimeType) {
      setError('This Chromium build does not provide a supported WebM MediaRecorder encoder.');
      return;
    }

    setStatus('starting');
    setError(null);
    cancelRequestedRef.current = false;
    try {
      const granted = await window.knouxCreativeAPI.recording.requestMediaPermission();
      if (!granted) throw new Error('Recording permission was not granted.');

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
        setError(mediaError.error?.message ?? 'MediaRecorder reported an error.');
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
            }
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Recording could not be finalized.');
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
      setError(reason instanceof Error ? reason.message : 'Recording could not start.');
    }
  }, [cleanupStreams, includeMicrophone, selectedSourceId, sources, status]);

  const pauseRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'recording') return;
    recorder.pause();
    await window.knouxCreativeAPI.recording.pause(sessionId);
    setStatus('paused');
  }, []);

  const resumeRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'paused') return;
    recorder.resume();
    await window.knouxCreativeAPI.recording.resume(sessionId);
    startedAtRef.current = Date.now() - elapsed * 1000;
    setStatus('recording');
  }, [elapsed]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const cancelRecording = useCallback(async () => {
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

  return (
    <section className="creative-view" aria-labelledby="recording-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">KNOUX Creative Suite</span>
          <h1 id="recording-title"><Circle size={30} /> Screen Recording</h1>
          <p>Select a display or window, record to a streamed WebM file, and keep a visible recording indicator at all times.</p>
        </div>
        <div className={`recording-indicator ${status === 'recording' ? 'active' : ''}`}>
          <span /> {status === 'recording' || status === 'paused' ? `${status.toUpperCase()} ${elapsed}s` : status.toUpperCase()}
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="recording-layout">
        <NeonPanel variant="dark" padding="lg">
          <div className="creative-form-grid">
            <label>
              <span>Capture source</span>
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
              <Volume2 size={16} /> Include microphone after an explicit permission request
            </label>
          </div>

          <div className="creative-actions">
            {status === 'idle' && (
              <NeonButton variant="primary" leftIcon={<Circle size={16} />} onClick={() => void startRecording()} disabled={!selectedSourceId}>
                Start recording
              </NeonButton>
            )}
            {status === 'recording' && (
              <>
                <NeonButton variant="secondary" leftIcon={<Pause size={16} />} onClick={() => void pauseRecording()}>Pause</NeonButton>
                <NeonButton variant="primary" leftIcon={<Square size={16} />} onClick={stopRecording}>Stop and save</NeonButton>
              </>
            )}
            {status === 'paused' && (
              <>
                <NeonButton variant="secondary" leftIcon={<Play size={16} />} onClick={() => void resumeRecording()}>Resume</NeonButton>
                <NeonButton variant="primary" leftIcon={<Square size={16} />} onClick={stopRecording}>Stop and save</NeonButton>
              </>
            )}
            {status !== 'idle' && status !== 'stopping' && (
              <NeonButton variant="ghost" onClick={() => void cancelRecording()}>Cancel and delete</NeonButton>
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
            >
              <img src={source.thumbnail} alt="" />
              <span><Monitor size={15} /> {source.name}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
