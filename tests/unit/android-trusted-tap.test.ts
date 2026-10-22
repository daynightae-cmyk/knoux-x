import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Execute the actual harness function without starting an emulator session.
const harness = fs.readFileSync(path.resolve(__dirname, '../../tools/android-real-workflows.cjs'), 'utf8');
const start = harness.indexOf('async function trustedTap(');
const end = harness.indexOf('async function trustedTapUntil(', start);
const tapSource = harness.slice(start, end);

function scenario(change: 'move' | 'cover' | 'foreign') {
  let nativeChecks = 0;
  let samples = 0;
  const taps: string[][] = [];
  const records: object[] = [];
  const locator = {
    first: () => locator,
    evaluate: async () => {
      samples += 1;
      // Reproduce a keyboard resize during the blocking native hierarchy dump.
      const changed = nativeChecks > 0;
      return {
        cssX: 288, cssY: changed && change === 'move' ? 332 : 488,
        width: 80, height: 44, dpr: 2.625,
        insideViewport: true,
        hitSelf: !(change === 'cover' && changed && samples === 3),
      };
    },
  };
  const context = vm.createContext({
    Date, Math, Promise, String, Error, setTimeout, clearTimeout,
    SAMPLE_BUDGET_MS: 1000,
    PACKAGE: 'dev.knoux.playerx',
    webViewOrigin: { left: 0, top: 136 },
    delay: async () => undefined,
    foregroundSurface: () => {
      nativeChecks += 1;
      return { package: change === 'foreign' && nativeChecks === 1 ? 'com.android.documentsui' : 'dev.knoux.playerx' };
    },
    adb: (...args: string[]) => taps.push(args),
    recordTap: (record: object) => records.push(record),
  });
  const tap = vm.runInContext(`${tapSource}\ntrustedTap`, context) as (target: typeof locator) => Promise<unknown>;
  return { run: () => tap(locator), taps, records, checks: () => ({ nativeChecks, samples }) };
}

describe('trusted Android tap after native foreground verification', () => {
  test('discards the stale Create position when the keyboard moves the dialog', async () => {
    const test = scenario('move');
    await test.run();
    expect(test.checks().nativeChecks).toBe(2);
    expect(test.taps).toEqual([['shell', 'input', 'tap', '756', '1008']]);
    expect(test.records).toHaveLength(1);
  });

  test('retries when an overlay covers the sampled target during the native check', async () => {
    const test = scenario('cover');
    await test.run();
    expect(test.checks().nativeChecks).toBe(2);
    expect(test.taps).toHaveLength(1);
  });

  test('continues to refuse taps while a foreign native surface covers the app', async () => {
    const test = scenario('foreign');
    await test.run();
    expect(test.checks().nativeChecks).toBe(2);
    expect(test.taps).toHaveLength(1);
  });
});

describe('player resume prompt handling', () => {
  test('dismisses a saved-position layer through trusted input before control taps', () => {
    expect(harness).toContain('async function clearResumePrompt(page)');
    expect(harness).toContain("page.locator('.ump-resume-layer')");
    expect(harness).toContain('The resume prompt could not be dismissed');
    const playback = harness.slice(harness.indexOf('async function ensurePlayback('));
    expect(playback.slice(0, playback.indexOf('Image Lab SAF acceptance helpers'))).toContain('await clearResumePrompt(page)');
    expect((harness.match(/await clearResumePrompt\(page\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
