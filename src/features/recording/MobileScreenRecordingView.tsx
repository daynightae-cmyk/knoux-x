import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Mic2,
  MonitorUp,
  Play,
  Square,
  Video,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { androidDocumentTitle } from '../../platform/androidSafBridge';
import { describeScreenCapture, readScreenCaptureStatus } from '../../platform/androidScreenCaptureStatus';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import { registerAndroidBackInterceptor } from '../../platform/androidBackButton';
import { withDeadline } from '../../platform/withDeadline';

import { prepareRecordingEditor } from './recordingEditorHandoff';

type Resolution = 'native' | '1080p' | '720p';

/** The visually distinct capture states this screen must never confuse. */
type CapturePhase = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'preparing';

type Evidence = {
  uri: string;
  /** 'session' was finalized by this screen; 'device' is a URI Android
   *  reported for a recording made before this screen was opened. */
  origin: 'session' | 'device';
  size: number | null;
  readable: boolean;
  checking: boolean;
};

const STATUS_POLL_MS = 2_000;
const PROBE_POLL_MS = 1_000;
const NATIVE_STATUS_DEADLINE_MS = 6_000;
const FILE_CHECK_DEADLINE_MS = 8_000;

/* The native plugin and the file layer answer in English; the mobile shell
 * must not show them raw to an Arabic reader. */
const ERROR_COPY_AR: Record<string, string> = {
  'Android did not confirm that recording started. Nothing is being captured.': 'لم يؤكد أندرويد بدء التسجيل. لا يتم التقاط أي شيء.',
  'Android MediaProjection could not start.': 'تعذّر تشغيل خدمة التقاط الشاشة في أندرويد.',
  'Screen recording permission was not granted.': 'لم يُمنح إذن تسجيل الشاشة.',
  'Android returned no finalized recording. The file was not saved.': 'لم يُرجع أندرويد تسجيلًا مكتملًا. لم يتم حفظ الملف.',
  'Android screen recording could not be finalized.': 'تعذّر إنهاء تسجيل الشاشة في أندرويد.',
  'Could not open the recording in the editor.': 'تعذّر فتح التسجيل في المحرّر.',
  'The device did not answer the file check in time.': 'لم يردّ الجهاز على فحص الملف في الوقت المحدد.',
  'The device did not report the file size in time.': 'لم يبلّغ الجهاز عن حجم الملف في الوقت المحدد.',
  'The device could not confirm the recorded file.': 'تعذّر على الجهاز تأكيد ملف التسجيل.',
  'The screen capture plugin did not answer in time.': 'لم تُجب إضافة التقاط الشاشة في الوقت المحدد.',
  'The screen capture plugin did not answer.': 'لم تُجب إضافة التقاط الشاشة.',
  'Stop and save the recording before leaving this screen.': 'أوقف التسجيل واحفظه قبل مغادرة هذه الشاشة.',
};

function errorLabel(message: string, ar: boolean): string {
  if (!ar) return message;
  return ERROR_COPY_AR[message] ?? message;
}

function dimensionsFor(resolution: Resolution): { width: number; height: number } {
  const portrait = window.innerHeight >= window.innerWidth;
  if (resolution === 'native') return { width: 0, height: 0 };
  const landscape = resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  return portrait ? { width: landscape.height, height: landscape.width } : landscape;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export const MobileScreenRecordingView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const copy = (en: string, arabic: string): string => ar ? arabic : en;
  const setView = useAppStore((state) => state.setView);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setMediaTitle = usePlayerStore((state) => state.setMediaTitle);
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [fps, setFps] = useState<30 | 60>(30);
  const [bitrateMbps, setBitrateMbps] = useState<8 | 12 | 20>(12);
  const [microphone, setMicrophone] = useState(false);
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  /* Capacitor injects window.Capacitor after the first paint on some devices,
   * so availability is re-probed until the plugin appears instead of being
   * decided once at mount. */
  const [probe, setProbe] = useState(readScreenCaptureStatus);
  const checkedUriRef = useRef<string | null>(null);
  const phaseRef = useRef<CapturePhase>('idle');
  phaseRef.current = phase;

  const busy = phase === 'requesting' || phase === 'finalizing' || phase === 'preparing';

  useEffect(() => {
    if (probe.available) return undefined;
    const timer = window.setInterval(() => setProbe(readScreenCaptureStatus()), PROBE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [probe.available]);

  const check = useCallback(async (uri: string, origin: Evidence['origin']): Promise<void> => {
    checkedUriRef.current = uri;
    setEvidence({ uri, origin, size: null, readable: false, checking: true });
    try {
      const readable = await withDeadline(
        window.knouxAPI.file.exists(uri),
        FILE_CHECK_DEADLINE_MS,
        'The device did not answer the file check in time.',
      );
      const stats = readable
        ? await withDeadline(
          window.knouxAPI.file.getStats(uri),
          FILE_CHECK_DEADLINE_MS,
          'The device did not report the file size in time.',
        ).catch(() => null)
        : null;
      const size = stats && Number.isFinite(stats.size) ? stats.size : null;
      setEvidence({ uri, origin, size, readable: readable === true && size !== null && size > 0, checking: false });
    } catch (reason) {
      setEvidence({ uri, origin, size: null, readable: false, checking: false });
      setError(reason instanceof Error ? reason.message : 'The device could not confirm the recorded file.');
    }
  }, []);

  useEffect(() => {
    const native = describeScreenCapture();
    if (!native) return undefined;
    let active = true;
    const refresh = (): void => {
      void withDeadline(native.status(), NATIVE_STATUS_DEADLINE_MS, 'The screen capture plugin did not answer in time.')
        .then((status) => {
          if (!active) return;
          if (status.recording === true) {
            setPhase((current) => (current === 'idle' ? 'recording' : current));
            return;
          }
          setPhase((current) => (current === 'recording' ? 'idle' : current));
          /* Android keeps the last output URI in SharedPreferences. A URI this
           * screen never finalized belongs to an earlier session and is only
           * ever shown as such. */
          if (status.outputUri && checkedUriRef.current !== status.outputUri && phaseRef.current === 'idle') {
            void check(status.outputUri, 'device');
          }
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : 'The screen capture plugin did not answer.');
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, STATUS_POLL_MS);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [check, probe]);

  useEffect(() => registerAndroidBackInterceptor(() => {
    if (phase === 'idle') return false;
    setError('Stop and save the recording before leaving this screen.');
    return true;
  }), [phase]);

  const start = useCallback(async (): Promise<void> => {
    const native = describeScreenCapture();
    if (!native || busy || phase === 'recording') return;
    setError(null);
    setPhase('requesting');
    try {
      const dimensions = dimensionsFor(resolution);
      const result = await native.startScreenRecording({
        ...dimensions,
        fps,
        bitrate: bitrateMbps * 1_000_000,
        microphone,
      });
      if (result.recording === true) {
        setPhase('recording');
        return;
      }
      /* Android only answers recording:true after MediaProjection consent, so
       * any other answer leaves the screen idle with nothing captured. */
      checkedUriRef.current = null;
      setEvidence(null);
      setPhase('idle');
      setError('Android did not confirm that recording started. Nothing is being captured.');
    } catch (reason) {
      setPhase('idle');
      setError(reason instanceof Error ? reason.message : 'Android MediaProjection could not start.');
    }
  }, [bitrateMbps, busy, fps, microphone, phase, resolution]);

  const stop = useCallback(async (): Promise<void> => {
    const native = describeScreenCapture();
    if (!native || busy || phase !== 'recording') return;
    setError(null);
    setPhase('finalizing');
    try {
      const result = await native.stopScreenRecording();
      const uri = typeof result.outputUri === 'string' && result.outputUri.length > 0 ? result.outputUri : null;
      if (!uri) {
        setPhase(result.recording === true ? 'recording' : 'idle');
        setError('Android returned no finalized recording. The file was not saved.');
        return;
      }
      setPhase('idle');
      await check(uri, 'session');
    } catch (reason) {
      setPhase('recording');
      setError(reason instanceof Error ? reason.message : 'Android screen recording could not be finalized.');
    }
  }, [busy, check, phase]);

  const openRecording = useCallback(async (): Promise<void> => {
    if (!evidence || !evidence.readable) return;
    const title = await androidDocumentTitle(evidence.uri);
    setMediaTitle(evidence.uri, title ?? 'KNOUX screen recording');
    setCurrentMedia(evidence.uri);
    setView('player');
  }, [evidence, setCurrentMedia, setMediaTitle, setView]);

  const editRecording = useCallback(async (): Promise<void> => {
    if (!evidence || !evidence.readable || evidence.checking || busy) return;
    setError(null);
    setPhase('preparing');
    try {
      await prepareRecordingEditor(evidence.uri);
      setView('editor');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open the recording in the editor.');
      setPhase('idle');
    }
  }, [busy, evidence, setView]);

  const phaseLabel = phase === 'requesting'
    ? copy('Waiting for Android permission…', 'بانتظار إذن أندرويد…')
    : phase === 'finalizing'
      ? copy('Finalizing MP4…', 'جارٍ إنهاء ملف MP4…')
      : phase === 'preparing'
        ? copy('Preparing the editor…', 'جارٍ تجهيز المحرّر…')
        : phase === 'recording'
          ? copy('Recording', 'جارٍ التسجيل')
          : copy('Ready', 'جاهز');

  return (
    <section className="knoux-mobile-recording" data-component="MobileScreenRecordingView" data-capture-phase={phase} data-capture-availability={probe.source}>
      <header className="kmr-topbar">
        <button type="button" className="kx-back" aria-label={copy('Back', 'رجوع')} onClick={() => setView('home')} disabled={phase !== 'idle'}><ArrowLeft size={21} /></button>
        <div><BrandMark size={38} /><span><strong>KNOUX <em>X</em></strong><small>{copy('SCREEN RECORDING', 'تسجيل الشاشة')}</small></span></div>
        <span className={phase === 'recording' ? 'live' : ''}>{phase === 'recording' ? 'REC' : 'LOCAL'}</span>
      </header>

      <div className="kmr-hero">
        <div className="kmr-orb"><MonitorUp size={46} /></div>
        <span>{copy('CAPTURE YOUR NEXT IDEA', 'التقط فكرتك القادمة')}</span>
        <h1>{copy('Capture moments.', 'التقط اللحظات.')}<em>{copy(' Create without limits.', ' وابدع بلا حدود.')}</em></h1>
        <p>{copy(
          'Record tutorials, gameplay and ideas. Android will ask for permission before you start. Find saved videos in Movies/KNOUX X.',
          'سجّل الشروحات واللعب والأفكار. سيطلب أندرويد الإذن قبل البدء. ستجد الفيديوهات المحفوظة في Movies/KNOUX X.',
        )}</p>
      </div>

      {!probe.available && (
        <div className="kmr-unavailable" role="alert">
          <AlertTriangle size={18} />
          <span>{probe.source === 'non-android'
            ? copy('Screen recording belongs to the KNOUX Android app.', 'تسجيل الشاشة متاح في تطبيق KNOUX لأندرويد.')
            : copy('The KNOUX screen capture plugin did not start in this build. No recording is possible and no file was created.', 'لم تبدأ إضافة التقاط الشاشة الخاصة بـ KNOUX في هذا البناء. لا يمكن التسجيل ولم يُنشأ أي ملف.')}</span>
        </div>
      )}

      <p className="kmr-status" role="status" aria-live="polite">{copy('Capture state', 'حالة الالتقاط')}: {phaseLabel}</p>

      {error && <div className="kmr-error" role="alert">{errorLabel(error, ar)}</div>}

      <section className="kmr-panel">
        <div className="kmr-field">
          <span>{copy('Resolution', 'الدقة')}</span>
          <div>{(['native', '1080p', '720p'] as Resolution[]).map((value) => <button type="button" key={value} className={resolution === value ? 'active' : ''} onClick={() => setResolution(value)} disabled={phase !== 'idle'}>{value === 'native' ? copy('Device', 'الجهاز') : value}</button>)}</div>
        </div>
        <div className="kmr-field">
          <span>{copy('Frame rate', 'معدل الإطارات')}</span>
          <div>{([30, 60] as const).map((value) => <button type="button" key={value} className={fps === value ? 'active' : ''} onClick={() => setFps(value)} disabled={phase !== 'idle'}>{value} FPS</button>)}</div>
        </div>
        <div className="kmr-field">
          <span>{copy('Video bitrate', 'معدل البت')}</span>
          <div>{([8, 12, 20] as const).map((value) => <button type="button" key={value} className={bitrateMbps === value ? 'active' : ''} onClick={() => setBitrateMbps(value)} disabled={phase !== 'idle'}>{value} Mbps</button>)}</div>
        </div>
        <label className="kmr-toggle"><span><Mic2 size={18} /><b>{copy('Microphone', 'الميكروفون')}</b><small>{copy('Record microphone if Android permission is granted.', 'يسجَّل الميكروفون إذا منح أندرويد الإذن.')}</small></span><input type="checkbox" checked={microphone} onChange={(event) => setMicrophone(event.currentTarget.checked)} disabled={phase !== 'idle'} /></label>
      </section>

      {phase === 'recording' || phase === 'finalizing' ? (
        <button
          type="button"
          className={`kmr-primary kmr-stop${phase === 'finalizing' ? ' kmr-finalizing' : ''}`}
          onClick={() => void stop()}
          disabled={busy}
        >
          <Square size={19} fill="currentColor" /> {phase === 'finalizing' ? copy('Finalizing MP4…', 'جارٍ إنهاء ملف MP4…') : copy('Stop & save MP4', 'أوقف وسجّل MP4')}
        </button>
      ) : (
        <button
          type="button"
          className={`kmr-primary kmr-start${phase === 'requesting' ? ' kmr-requesting' : ''}`}
          onClick={() => void start()}
          disabled={!probe.available || busy}
        >
          <Play size={20} fill="currentColor" /> {phase === 'requesting' ? phaseLabel : copy('Start screen recording', 'ابدأ تسجيل الشاشة')}
        </button>
      )}

      {evidence && (
        <div className="kmr-output-stack">
          {evidence.checking ? (
            <div className="kmr-output kmr-checking" role="status"><span className="kmr-pulse" /><span><strong>{copy('Checking the recording…', 'جارٍ فحص التسجيل…')}</strong><small dir="ltr">{evidence.uri}</small></span></div>
          ) : evidence.readable ? (
            <button type="button" className="kmr-output" onClick={() => void openRecording()}>
              <CheckCircle2 size={22} />
              <span>
                <strong>{evidence.origin === 'session' ? copy('Recording saved', 'تم حفظ التسجيل') : copy('Recording already on this device', 'تسجيل موجود مسبقًا على هذا الجهاز')}</strong>
                <small>{copy('Verified on the device', 'تم التحقق منه على الجهاز')} · <bdi>{evidence.size !== null ? formatBytes(evidence.size) : copy('size unknown', 'الحجم غير معروف')}</bdi>{evidence.origin === 'device' ? ` · ${copy('from an earlier session', 'من جلسة سابقة')}` : ''}</small>
              </span>
              <Video size={20} />
            </button>
          ) : (
            <div className="kmr-unverified" role="alert">
              <AlertTriangle size={20} />
              <span>
                <strong>{copy('The recorded file could not be read', 'تعذّرت قراءة ملف التسجيل')}</strong>
                <small>{copy('Android returned a location, but no readable file with content was found there. Nothing was saved.', 'أرجع أندرويد موقعًا، لكن لم يُعثر على ملف قابل للقراءة يحتوي بيانات. لم يتم حفظ شيء.')}</small>
                <button type="button" onClick={() => void check(evidence.uri, evidence.origin)}>{copy('Check again', 'افحص مرة أخرى')}</button>
              </span>
            </div>
          )}
          {evidence.readable && !evidence.checking && (
            <>
              <button type="button" className="kmr-primary kmr-edit" disabled={busy} onClick={() => void editRecording()}>{phase === 'preparing' ? phaseLabel : copy('Open in Video Editor', 'افتح في محرّر الفيديو')}</button>
              <button type="button" className="kmr-output kmr-library" onClick={() => setView('library')}>{copy('Browse saved recordings in Library', 'تصفّح التسجيلات المحفوظة في المكتبة')}</button>
            </>
          )}
        </div>
      )}
    </section>
  );
};
