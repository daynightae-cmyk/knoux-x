export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

const SRT_TIME = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})/;
const VTT_TIME = /(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{3})/;

function parseClock(value: string): number {
  const normalized = value.trim();
  const srt = SRT_TIME.exec(normalized);
  if (srt) {
    return Number(srt[1]) * 3600 + Number(srt[2]) * 60 + Number(srt[3]) + Number(srt[4]) / 1000;
  }
  const vtt = VTT_TIME.exec(normalized);
  if (vtt) {
    return Number(vtt[1] ?? 0) * 3600 + Number(vtt[2]) * 60 + Number(vtt[3]) + Number(vtt[4]) / 1000;
  }
  throw new TypeError(`Invalid subtitle timestamp: ${value}`);
}

function formatVttTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const milliseconds = Math.round(clamped * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function parseSubtitleText(source: string): SubtitleCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const withoutHeader = normalized.startsWith('WEBVTT')
    ? normalized.replace(/^WEBVTT[^\n]*\n+/, '')
    : normalized;
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    if (lines.length < 2) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    if (timing.length !== 2) continue;
    try {
      const start = parseClock(timing[0]);
      const end = parseClock(timing[1]);
      if (end <= start) continue;
      const id = timingIndex > 0 && lines[0].trim() ? lines[0].trim() : String(cues.length + 1);
      const text = lines.slice(timingIndex + 1).join('\n').trim();
      if (!text) continue;
      cues.push({ id, start, end, text });
    } catch {
      // Skip malformed cue while preserving valid entries.
    }
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function offsetSubtitleCues(cues: SubtitleCue[], delaySeconds: number): SubtitleCue[] {
  if (!Number.isFinite(delaySeconds) || Math.abs(delaySeconds) > 3600) {
    throw new RangeError('Subtitle delay must be a finite value within one hour.');
  }
  return cues
    .map((cue) => ({ ...cue, start: cue.start + delaySeconds, end: cue.end + delaySeconds }))
    .filter((cue) => cue.end > 0)
    .map((cue) => ({ ...cue, start: Math.max(0, cue.start), end: Math.max(0.001, cue.end) }));
}

export function cuesToWebVtt(cues: SubtitleCue[]): string {
  const body = cues.map((cue, index) => (
    `${cue.id || index + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}`
  )).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function convertSubtitleToWebVtt(source: string, delaySeconds = 0): string {
  return cuesToWebVtt(offsetSubtitleCues(parseSubtitleText(source), delaySeconds));
}
