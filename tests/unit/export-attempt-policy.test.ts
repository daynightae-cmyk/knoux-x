import {
  MAX_RENDER_ATTEMPTS,
  isEarlyTruncation,
  isTransientEncoderFailure,
  numberedSibling,
  renderRetryDelayMs,
  retryAttemptLabel,
  shouldRetryRender,
} from '../../src/features/video-studio/exportAttemptPolicy';

// The desktop export UI feeds its own localized truncation label back into the
// policy, so both locales must be recognised or the retry never fires.
const EN_TRUNCATION = 'The exported file ended before the timeline finished and was not accepted. Export again to retry.';
const AR_TRUNCATION = 'ملف التصدير توقف قبل نهاية الخط الزمني ولم يُعتمد. أعد التصدير مرة أخرى.';

describe('desktop export attempt policy', () => {
  it('recognises the localized truncation labels', () => {
    expect(isEarlyTruncation(EN_TRUNCATION)).toBe(true);
    expect(isEarlyTruncation(AR_TRUNCATION)).toBe(true);
  });

  it('retrying an encoder that starved, and not retrying a real user conflict', () => {
    // Both starvation shapes were reproduced on the packaged app under CPU load.
    for (const message of [
      'The project encoder produced an empty file.',
      'The project encoder stopped unexpectedly.',
      'The rendered output contains no valid video stream.',
      'The rendered output could not be read completely.',
      EN_TRUNCATION,
      AR_TRUNCATION,
    ]) {
      expect(isTransientEncoderFailure(message)).toBe(true);
      expect(shouldRetryRender({ message, attempt: 1 })).toBe(true);
    }
    // A pre-existing destination is a user choice, not an encoder fault: retrying
    // it would silently write somewhere else without telling them.
    expect(isTransientEncoderFailure(
      'The selected output already exists. Choose a new filename to preserve the previous file.',
    )).toBe(false);
    expect(shouldRetryRender({
      message: 'The selected output already exists. Choose a new filename to preserve the previous file.',
      attempt: 1,
    })).toBe(false);
  });

  it('waits longer between later attempts so a busy machine can recover', () => {
    expect(renderRetryDelayMs(0)).toBe(0);
    expect(renderRetryDelayMs(1)).toBeLessThan(renderRetryDelayMs(2));
    expect(renderRetryDelayMs(2)).toBeLessThan(renderRetryDelayMs(3));
    expect(renderRetryDelayMs(Number.NaN)).toBe(0);
  });

  it('never treats an unrelated decode failure as retryable', () => {
    for (const message of [
      'A timeline media item could not be decoded.',
      'Project export cancelled.',
    ]) {
      expect(isTransientEncoderFailure(message)).toBe(false);
    }
  });

  it('bounds retries and stops immediately once attempts are exhausted', () => {
    expect(shouldRetryRender({ message: EN_TRUNCATION, attempt: 1 })).toBe(true);
    expect(shouldRetryRender({ message: EN_TRUNCATION, attempt: MAX_RENDER_ATTEMPTS - 1 })).toBe(true);
    expect(shouldRetryRender({ message: EN_TRUNCATION, attempt: MAX_RENDER_ATTEMPTS })).toBe(false);
    expect(shouldRetryRender({ message: EN_TRUNCATION, attempt: MAX_RENDER_ATTEMPTS + 4 })).toBe(false);
  });

  it('does not retry a cancelled or malformed run', () => {
    expect(shouldRetryRender({ message: AR_TRUNCATION, attempt: 1, cancelled: true })).toBe(false);
    expect(shouldRetryRender({ message: AR_TRUNCATION, attempt: 0 })).toBe(false);
    expect(shouldRetryRender({ message: AR_TRUNCATION, attempt: 1.5 })).toBe(false);
    expect(shouldRetryRender({ message: EN_TRUNCATION, attempt: 1, maxAttempts: 1 })).toBe(false);
  });

  it('states the attempt count and that no partial file was accepted', () => {
    expect(retryAttemptLabel(2)).toContain('Attempt 2 of 3');
    expect(retryAttemptLabel(2, MAX_RENDER_ATTEMPTS, true)).toContain('المحاولة 2 من 3');
    expect(retryAttemptLabel(99)).toContain(`of ${MAX_RENDER_ATTEMPTS}`);
  });

  it('keeps a retry on a fresh path so an existing file is never replaced', () => {
    expect(numberedSibling('C:\\out\\film-timeline.webm', 2)).toBe('C:\\out\\film-timeline (2).webm');
    expect(numberedSibling('C:\\videos.archive\\film.webm', 3)).toBe('C:\\videos.archive\\film (3).webm');
    expect(numberedSibling('C:\\out\\film', 2)).toBe('C:\\out\\film (2)');
    // A retry must never collapse onto the file it is meant to protect.
    expect(numberedSibling('C:\\out\\film.webm', 2)).not.toBe('C:\\out\\film.webm');
  });
});
