import {
  convertSubtitleToWebVtt,
  offsetSubtitleCues,
  parseSubtitleText,
} from '../../src/core/subtitles/subtitle';
import { localeCoverage, translate } from '../../src/i18n';

describe('subtitle parsing and localization', () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,250\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nمرحبا بالعالم`;

  test('parses valid SRT cues and preserves Unicode text', () => {
    const cues = parseSubtitleText(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.25, text: 'Hello world' });
    expect(cues[1].text).toBe('مرحبا بالعالم');
  });

  test('skips malformed cues without losing valid cues', () => {
    const cues = parseSubtitleText(`${srt}\n\nBAD\nnot-a-time --> never\nIgnored`);
    expect(cues).toHaveLength(2);
  });

  test('applies positive and negative subtitle delay safely', () => {
    const cues = parseSubtitleText(srt);
    expect(offsetSubtitleCues(cues, 0.5)[0].start).toBe(1.5);
    expect(offsetSubtitleCues(cues, -1.5)[0].start).toBe(0);
    expect(() => offsetSubtitleCues(cues, 3601)).toThrow(RangeError);
  });

  test('converts SRT to standards-compliant WebVTT', () => {
    const vtt = convertSubtitleToWebVtt(srt, 0.25);
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:01.250 --> 00:00:03.500');
    expect(vtt).toContain('مرحبا بالعالم');
  });

  test('Arabic and English locale coverage remains complete', () => {
    const coverage = localeCoverage();
    expect(coverage.en.percentage).toBe(100);
    expect(coverage.ar.percentage).toBe(100);
    expect(translate('ar', 'nav.player')).toBe('المشغل');
    expect(translate('en', 'nav.player')).toBe('Player');
  });

  test('missing translations fall back to the key without crashing', () => {
    expect(translate('ar', 'not.a.real.key')).toBe('not.a.real.key');
  });
});
