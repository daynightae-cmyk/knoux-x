import React, { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, LoaderCircle, X, XCircle } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import type { MultitrackProject } from '../../core/creative/multitrackProject';
import { useTranslation } from '../../i18n';
import { renderMultitrackProject } from '../export/mobileTimelineRenderer';
import { measureTimelineOutputCoverage, timelineOutputCoversDuration } from '../export/timelineOutputCoverage';

import { writeBlobInChunks } from './chunkedBlobWriter';
import {
  MAX_RENDER_ATTEMPTS,
  attemptCountSuffix,
  isTransientEncoderFailure,
  numberedSibling,
  renderRetryDelayMs,
  retryAttemptLabel,
  shouldRetryRender,
} from './exportAttemptPolicy';
import { VideoStudioView } from './VideoStudioView';

import '../../styles/desktop-timeline-export.css';

type ExportPhase = 'saving' | 'rendering' | 'choosing-output' | 'writing' | 'verifying';

type SaveCommandResult = {
  command?: string;
  requestId?: string;
  ok?: boolean;
  filePath?: string;
  projectId?: string;
  error?: string;
};

type VerifiedOutput = {
  path: string;
  videoCodec: string;
  audioCodec: string | null;
};

const SAVE_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function waitForCurrentProjectSave(): Promise<SaveCommandResult | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    let timer = 0;

    const finish = (result: SaveCommandResult | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('knoux:command-result', handleResult as EventListener);
      resolve(result);
    };

    const handleResult = (event: Event): void => {
      const detail = (event as CustomEvent<SaveCommandResult>).detail;
      if (detail?.requestId !== requestId || detail.command !== 'save') return;
      finish(detail);
    };

    window.addEventListener('knoux:command-result', handleResult as EventListener);
    timer = window.setTimeout(() => finish(null), SAVE_COMMAND_TIMEOUT_MS);
    window.dispatchEvent(new CustomEvent('knoux:command', {
      detail: { command: 'save', requestId },
    }));
  });
}

function safeOutputName(project: MultitrackProject): string {
  const printableName = [...project.name]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('');
  const normalized = printableName
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'KNOUX-timeline';
}

function timelineBitrate(project: MultitrackProject): number {
  const estimated = project.settings.width * project.settings.height * project.settings.fps * 0.09;
  return Math.max(8_000_000, Math.min(45_000_000, Math.round(estimated)));
}

/**
 * Desktop timeline output prefers Chrome's bundled software VP8 encoder.
 * Platform H.264 behind MediaRecorder is machine-dependent and has produced
 * reference-undecodable slice headers on some Windows runners, while VP9's
 * software first-frame latency is too high for realtime capture under load
 * (near-empty output). VP8 encodes deterministically everywhere with low
 * first-frame latency. Mobile keeps the historical mp4-first order via the
 * renderer's default.
 */
const DESKTOP_TIMELINE_PREFERRED_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

function outputExtension(mimeType: string): 'mp4' | 'webm' {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export const DesktopVideoStudioView: React.FC = () => {
  const { locale } = useTranslation();
  const ar = locale === 'ar';
  const [phase, setPhase] = useState<ExportPhase | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [verifiedOutput, setVerifiedOutput] = useState<VerifiedOutput | null>(null);
  const cancelRequestedRef = useRef(false);
  const progressReporterRef = useRef({ lastUpdateAt: 0, value: -1 });

  const reportProgress = useCallback((percentage: number): void => {
    const rounded = Math.max(0, Math.min(100, Math.round(percentage)));
    const now = performance.now();
    const reporter = progressReporterRef.current;
    if (rounded !== 100 && now - reporter.lastUpdateAt < 250) return;
    reporter.lastUpdateAt = now;
    reporter.value = rounded;
    setProgress(rounded);
  }, []);

  const labels = ar ? {
    eyebrow: 'إخراج الخط الزمني على Windows',
    description: 'يصدّر مشروع Video Studio متعدد المسارات الحقيقي — وليس ملف فيديو منفصل.',
    current: 'تصدير المشروع الحالي',
    saved: 'تصدير مشروع محفوظ',
    saving: 'حفظ لقطة المشروع الحالية…',
    rendering: 'تصيير الخط الزمني الحقيقي',
    choosing: 'اختر مكان حفظ الفيديو…',
    writing: 'كتابة ملف الفيديو…',
    verifying: 'فحص الفيديو النهائي عبر FFprobe…',
    cancel: 'إلغاء التصيير',
    complete: 'تم التصدير والتحقق',
    noProject: 'لا يوجد مشروع حالي قابل للحفظ. افتح أو أنشئ مشروعًا أولًا.',
    saveFailed: 'تعذر حفظ المشروع الحالي قبل التصدير.',
    exportFailed: 'فشل تصدير مشروع الخط الزمني.',
    noVideo: 'الملف الناتج لا يحتوي على مسار فيديو صالح.',
    truncatedOutput: 'ملف التصدير توقف قبل نهاية الخط الزمني ولم يُعتمد. أعد التصدير مرة أخرى.',
    existingOutput: 'الملف المختار موجود بالفعل. اختر اسمًا جديدًا لحماية الملف السابق من الاستبدال.',
  } : {
    eyebrow: 'Windows Timeline Output',
    description: 'Exports the real multitrack Video Studio project — not a separately selected source file.',
    current: 'Export Current Project',
    saved: 'Export Saved Project',
    saving: 'Saving the current project snapshot…',
    rendering: 'Rendering the real timeline',
    choosing: 'Choose where to save the video…',
    writing: 'Writing the video file…',
    verifying: 'Verifying final media with FFprobe…',
    cancel: 'Cancel render',
    complete: 'Export verified',
    noProject: 'There is no current project to save. Create or open a project first.',
    saveFailed: 'The current project could not be saved before export.',
    exportFailed: 'Timeline project export failed.',
    noVideo: 'The rendered output contains no valid video stream.',
    truncatedOutput: 'The exported file ended before the timeline finished and was not accepted. Export again to retry.',
    existingOutput: 'The selected output already exists. Choose a new filename to preserve the previous file.',
  };

  const renderAndSave = useCallback(async (project: MultitrackProject): Promise<void> => {
    cancelRequestedRef.current = false;
    setError(null);
    setRetryNote(null);
    setAttemptsUsed(0);
    setVerifiedOutput(null);
    progressReporterRef.current = { lastUpdateAt: performance.now(), value: 0 };
    setProgress(0);
    let destination: string | null = null;
    let destinationWritten = false;

    try {
      let destinationChosen = false;
      let attempt = 0;
      for (;;) {
        attempt += 1;
        let wroteFileThisAttempt = false;
        try {
          setPhase('rendering');
          const rendered = await renderMultitrackProject(structuredClone(project), {
            width: project.settings.width,
            height: project.settings.height,
            fps: project.settings.fps,
            videoBitsPerSecond: timelineBitrate(project),
            preferredMimeTypes: DESKTOP_TIMELINE_PREFERRED_MIME_TYPES,
            onProgress: reportProgress,
            cancelled: () => cancelRequestedRef.current,
          });
          if (cancelRequestedRef.current) return;

          const extension = outputExtension(rendered.mimeType);
          if (!destinationChosen) {
            setPhase('choosing-output');
            destination = await window.knouxAPI.file.saveFile({
              title: ar ? 'حفظ تصدير KNOUX X' : 'Save KNOUX X timeline export',
              defaultPath: `${safeOutputName(project)}-timeline.${extension}`,
              filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
            });
            destinationChosen = Boolean(destination);
          }
          if (!destination || cancelRequestedRef.current) return;

          setPhase('writing');
          // Never overwrite a pre-existing file, even when the save dialog allows it.
          // The IPC handler enforces this atomically with O_EXCL as well.
          if (await window.knouxAPI.file.exists(destination)) throw new Error(labels.existingOutput);
          // Stream bounded chunks instead of materialising the whole render in
          // memory. The first chunk creates the file exclusively; every later
          // chunk is offset-checked against the destination size in the main
          // process, so a lost or duplicated chunk can never pass silently.
          const writtenBytes = await writeBlobInChunks(rendered.blob, {
            writeFirst: (data) => window.knouxAPI.file.writeFile(
              destination as string,
              data as unknown as Parameters<typeof window.knouxAPI.file.writeFile>[1],
              { exclusive: true },
            ),
            append: (data, offset) => window.knouxAPI.file.appendFile(destination as string, data, offset),
          });
          wroteFileThisAttempt = true;
          destinationWritten = true;
          if (writtenBytes !== rendered.blob.size) throw new Error(labels.truncatedOutput);

          setPhase('verifying');
          const probe = await window.knouxCreativeAPI.export.probe(destination, { verifyVideoPacketExtent: true });
          const video = probe.streams?.find((stream) => stream.codec_type === 'video');
          if (!video?.codec_name) throw new Error(labels.noVideo);
          const coverage = measureTimelineOutputCoverage(probe);
          if (!timelineOutputCoversDuration(coverage, rendered.duration)) throw new Error(labels.truncatedOutput);
          const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
          setRetryNote(null);
          setAttemptsUsed(attempt);
          setVerifiedOutput({
            path: destination,
            videoCodec: video.codec_name,
            audioCodec: audio?.codec_name ?? null,
          });
          setProgress(100);
          break;
        } catch (failure) {
          // A starved realtime encoder is transient: drop whatever it produced —
          // always, so a short or empty file never survives as a fake export — and
          // re-encode the identical timeline a bounded number of times.
          if (wroteFileThisAttempt && destination) {
            await window.knouxAPI.file.deleteFile(destination).catch(() => undefined);
            destinationWritten = false;
          }
          const message = failure instanceof Error ? failure.message : String(failure);
          if (cancelRequestedRef.current) throw failure;
          if (!shouldRetryRender({ message, attempt })) {
            // Say how many automatic attempts the machine already got, so the user
            // can tell "the encoder is saturated here" from "this project cannot export".
            if (isTransientEncoderFailure(message) && attempt >= MAX_RENDER_ATTEMPTS) {
              throw new Error(ar
                ? `${message} — بعد ${attempt} محاولات تلقائية`
                : `${message} — after ${attempt} automatic attempts`);
            }
            throw failure;
          }
          // If the rejected file could not be removed, the retry moves to a numbered
          // sibling instead of touching a path that still holds the rejected bytes.
          if (destination && await window.knouxAPI.file.exists(destination)) destination = numberedSibling(destination, attempt + 1);
          setRetryNote(retryAttemptLabel(attempt + 1, MAX_RENDER_ATTEMPTS, ar));
          progressReporterRef.current = { lastUpdateAt: performance.now(), value: 0 };
          setProgress(0);
          await new Promise((resolve) => setTimeout(resolve, renderRetryDelayMs(attempt)));
        }
      }
    } catch (reason) {
      // A failed or cancelled write must not leave a half-file that looks
      // like a real export. Only the destination this run created is removed.
      if (destinationWritten && destination) {
        await window.knouxAPI.file.deleteFile(destination).catch(() => undefined);
      }
      if ((reason as DOMException)?.name !== 'AbortError' && !cancelRequestedRef.current) {
        setError(reason instanceof Error ? reason.message : labels.exportFailed);
      }
    } finally {
      setPhase(null);
      cancelRequestedRef.current = false;
    }
  }, [ar, labels.existingOutput, labels.exportFailed, labels.noVideo, labels.truncatedOutput, reportProgress]);

  const exportCurrent = useCallback(async (): Promise<void> => {
    if (phase) return;
    setError(null);
    setRetryNote(null);
    setAttemptsUsed(0);
    setVerifiedOutput(null);
    setPhase('saving');
    try {
      const saved = await waitForCurrentProjectSave();
      if (!saved) {
        setError(labels.noProject);
        return;
      }
      if (!saved.ok || !saved.filePath) {
        setError(saved.error || labels.saveFailed);
        return;
      }
      const opened = await window.knouxMultitrackAPI.openRecent(saved.filePath);
      setPhase(null);
      await renderAndSave(opened.project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.exportFailed);
    } finally {
      setPhase((current) => current === 'saving' ? null : current);
    }
  }, [labels.exportFailed, labels.noProject, labels.saveFailed, phase, renderAndSave]);

  const exportSaved = useCallback(async (): Promise<void> => {
    if (phase) return;
    setError(null);
    setRetryNote(null);
    setAttemptsUsed(0);
    setVerifiedOutput(null);
    try {
      const opened = await window.knouxMultitrackAPI.open();
      if (!opened) return;
      await renderAndSave(opened.project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.exportFailed);
      setPhase(null);
    }
  }, [labels.exportFailed, phase, renderAndSave]);

  const phaseLabel = phase === 'saving'
    ? labels.saving
    : phase === 'rendering'
      ? `${labels.rendering} · ${Math.round(progress)}%`
      : phase === 'choosing-output'
        ? labels.choosing
        : phase === 'writing'
          ? labels.writing
          : phase === 'verifying'
            ? labels.verifying
            : null;

  return (
    <div className="knoux-desktop-video-studio-shell" data-component="DesktopVideoStudioView">
      <section className="knoux-desktop-timeline-export" aria-label={labels.eyebrow}>
        <div className="knoux-desktop-timeline-export-copy">
          <span>{labels.eyebrow}</span>
          <p>{phaseLabel || labels.description}</p>
          {phase === 'rendering' && <progress max="100" value={progress} aria-label={phaseLabel ?? labels.rendering} />}
          {retryNote && (
            <div className="knoux-desktop-export-retry" role="status">
              <LoaderCircle className="spin" size={14} />
              <span>{retryNote}</span>
            </div>
          )}
          {verifiedOutput && (
            <div className="knoux-desktop-export-success" role="status">
              <CheckCircle2 size={16} />
              <strong>{labels.complete}</strong>
              <span dir="auto">{verifiedOutput.path}</span>
              <small>{verifiedOutput.videoCodec}{verifiedOutput.audioCodec ? ` + ${verifiedOutput.audioCodec}` : ''}</small>
              {attemptsUsed > 1 && (
                <span className="knoux-desktop-export-attempts">{attemptCountSuffix(attemptsUsed, ar)}</span>
              )}
            </div>
          )}
          {error && <div className="knoux-desktop-export-error" role="alert"><XCircle size={16} /> {error}</div>}
        </div>
        <div className="knoux-desktop-timeline-export-actions">
          {phase === 'rendering' ? (
            <NeonButton variant="secondary" size="sm" leftIcon={<X size={15} />} onClick={() => { cancelRequestedRef.current = true; }}>
              {labels.cancel}
            </NeonButton>
          ) : (
            <>
              <NeonButton variant="primary" size="sm" leftIcon={phase ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} onClick={() => void exportCurrent()} disabled={Boolean(phase)}>
                {labels.current}
              </NeonButton>
              <NeonButton variant="ghost" size="sm" leftIcon={<FolderOpen size={15} />} onClick={() => void exportSaved()} disabled={Boolean(phase)}>
                {labels.saved}
              </NeonButton>
            </>
          )}
        </div>
      </section>
      <VideoStudioView />
    </div>
  );
};
