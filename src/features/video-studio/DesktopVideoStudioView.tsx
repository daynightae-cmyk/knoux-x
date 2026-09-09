import React, { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, LoaderCircle, X, XCircle } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import type { MultitrackProject } from '../../core/creative/multitrackProject';
import { useTranslation } from '../../i18n';
import { renderMultitrackProject } from '../export/mobileTimelineRenderer';

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
  const [verifiedOutput, setVerifiedOutput] = useState<VerifiedOutput | null>(null);
  const cancelRequestedRef = useRef(false);

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
  };

  const renderAndSave = useCallback(async (project: MultitrackProject): Promise<void> => {
    cancelRequestedRef.current = false;
    setError(null);
    setVerifiedOutput(null);
    setProgress(0);

    try {
      setPhase('rendering');
      const rendered = await renderMultitrackProject(structuredClone(project), {
        width: project.settings.width,
        height: project.settings.height,
        fps: project.settings.fps,
        videoBitsPerSecond: timelineBitrate(project),
        preferredMimeTypes: DESKTOP_TIMELINE_PREFERRED_MIME_TYPES,
        onProgress: setProgress,
        cancelled: () => cancelRequestedRef.current,
      });
      if (cancelRequestedRef.current) return;

      const extension = outputExtension(rendered.mimeType);
      setPhase('choosing-output');
      const destination = await window.knouxAPI.file.saveFile({
        title: ar ? 'حفظ تصدير KNOUX X' : 'Save KNOUX X timeline export',
        defaultPath: `${safeOutputName(project)}-timeline.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!destination || cancelRequestedRef.current) return;

      setPhase('writing');
      const bytes = new Uint8Array(await rendered.blob.arrayBuffer());
      await window.knouxAPI.file.writeFile(
        destination,
        bytes as unknown as Parameters<typeof window.knouxAPI.file.writeFile>[1],
      );

      setPhase('verifying');
      const probe = await window.knouxCreativeAPI.export.probe(destination);
      const video = probe.streams?.find((stream) => stream.codec_type === 'video');
      if (!video?.codec_name) throw new Error(labels.noVideo);
      const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
      setVerifiedOutput({
        path: destination,
        videoCodec: video.codec_name,
        audioCodec: audio?.codec_name ?? null,
      });
      setProgress(100);
    } catch (reason) {
      if ((reason as DOMException)?.name !== 'AbortError' && !cancelRequestedRef.current) {
        setError(reason instanceof Error ? reason.message : labels.exportFailed);
      }
    } finally {
      setPhase(null);
      cancelRequestedRef.current = false;
    }
  }, [ar, labels.exportFailed, labels.noVideo]);

  const exportCurrent = useCallback(async (): Promise<void> => {
    if (phase) return;
    setError(null);
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
          {verifiedOutput && (
            <div className="knoux-desktop-export-success" role="status">
              <CheckCircle2 size={16} />
              <strong>{labels.complete}</strong>
              <span dir="auto">{verifiedOutput.path}</span>
              <small>{verifiedOutput.videoCodec}{verifiedOutput.audioCodec ? ` + ${verifiedOutput.audioCodec}` : ''}</small>
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
