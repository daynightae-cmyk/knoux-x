/**
 * KNOUX-X — DESKTOP EXPORT ATTEMPT POLICY
 *
 * The timeline renderer captures from a canvas stream in real time, so a busy
 * machine can starve the MediaRecorder encoder. Two failure shapes were observed
 * on the packaged app: a file that ends before the timeline does, and an encoder
 * that never produces any data at all. The coverage guard already refuses the
 * first and the renderer refuses the second; this policy decides only whether a
 * *fresh identical attempt* is allowed. It never downgrades quality, never accepts
 * a partial file, and never hides the reason from the user.
 */

export const MAX_RENDER_ATTEMPTS = 3;

/** Delay before the next automatic attempt, scaled by how many have already failed. */
export const RENDER_RETRY_BASE_DELAY_MS = 400;

export function renderRetryDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 0;
  return RENDER_RETRY_BASE_DELAY_MS * attempt;
}

/** True when the failure is "the render ended early", which can succeed on retry. */
export function isEarlyTruncation(message: string): boolean {
  return /ended before the timeline|before the timeline ended|truncated|قبل نهاية|لم يُعتمد|لم يتم اعتماد/i.test(message);
}

/**
 * True when the encoder was starved rather than genuinely broken: no bytes at all,
 * the recorder stopped mid-capture, no video stream landed in the container, or the
 * file ended early. Every one of these has been reproduced under machine load and
 * each can succeed on a fresh attempt, so the run is retried instead of failing the
 * user's export or shipping a bad file.
 */
export function isTransientEncoderFailure(message: string): boolean {
  if (isEarlyTruncation(message)) return true;
  return /produced an empty file|could not be read completely|encoder stopped unexpectedly|no valid video stream|ملف فارغ|لا يحتوي على مسار فيديو/i.test(message);
}

export function shouldRetryRender(options: {
  message: string;
  attempt: number;
  cancelled?: boolean;
  maxAttempts?: number;
}): boolean {
  const { message, attempt, cancelled = false, maxAttempts = MAX_RENDER_ATTEMPTS } = options;
  if (cancelled) return false;
  if (!Number.isInteger(attempt) || attempt < 1) return false;
  if (attempt >= maxAttempts) return false;
  return isTransientEncoderFailure(message);
}

export function retryAttemptLabel(attempt: number, maxAttempts = MAX_RENDER_ATTEMPTS, arabic = false): string {
  const safeAttempt = Math.max(1, Math.min(attempt, maxAttempts));
  return arabic
    ? `المحاولة ${safeAttempt} من ${maxAttempts} — تعطل المرمّز تحت ضغط الجهاز في المحاولة السابقة (ملف ناقص أو فارغ)، ولم يُقبل أي ملف غير مكتمل.`
    : `Attempt ${safeAttempt} of ${maxAttempts} — the encoder stalled under machine load last time (short or empty output); no partial file was accepted.`;
}

/**
 * A retry must never overwrite an existing file — including the rejected
 * partial file from the attempt before it, which Windows can keep locked for a
 * moment after deletion. Insert " (N)" before the extension so the automatic
 * attempt always lands on a fresh path.
 */
export function numberedSibling(path: string, attempt: number): string {
  const safeAttempt = Math.max(2, Math.trunc(Number.isFinite(attempt) ? attempt : 2));
  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(path);
  if (!extension) return `${path} (${safeAttempt})`;
  return `${path.slice(0, extension.index)} (${safeAttempt})${path.slice(extension.index)}`;
}
