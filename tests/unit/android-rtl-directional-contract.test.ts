/** @jest-environment jsdom */
import { readFileSync, readdirSync } from 'node:fs';

/* Directive §16.1 ("directional controls remain semantically correct") and
 * §18.4 ("use correct directional semantics in RTL"). A previous build mirrored
 * every svg inside a round mobile control, which flipped Settings, Refresh and
 * Open-Photo icons into nonsense while leaving the real back arrow alone. The
 * contract below is what that mistake is not allowed to come back as. */

const visualCss = readFileSync('src/styles/android-visual-system.css', 'utf8');

function mirrorRules(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => line.includes('scaleX(-1)') && !line.trim().startsWith('/*'))
    .map((line) => line.trim());
}

describe('Android RTL mirroring is directional-only', () => {
  const rules = mirrorRules(visualCss);

  test('the mobile visual system declares exactly one RTL mirror rule', () => {
    expect(rules).toHaveLength(1);
  });

  test('only back, forward and section chevrons are mirrored', () => {
  const rule = rules[0];
    expect(rule).toContain('.kx-back svg');
    expect(rule).toContain('.kx-forward svg');
    expect(rule).toMatch(/\[dir='rtl'\]/);
    expect(rule).toMatch(/data-platform='android'/);
  });

  test('generic round icon buttons are no longer mirrored wholesale', () => {
    const rule = rules[0];
    expect(rule).not.toContain('.kmc-round-button svg');
    expect(rule).not.toContain('.kml-round svg');
    expect(rule).not.toContain('.kme-round svg');
  });

  test('media transport glyphs never mirror in RTL', () => {
    const mirroringMedia = visualCss
      .split('\n')
      .filter((line) => /km[pv]-(play|pause|rewind|forward|skip|next|previous)/.test(line) && line.includes('scaleX(-1)'));
    expect(mirroringMedia).toEqual([]);
  });
});

describe('Every Android back control opts into the directional contract', () => {
  const featureRoot = 'src/features';

  function mobileViewFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) mobileViewFiles(path, acc);
      else if (/^Mobile.*\.tsx$/.test(entry.name)) acc.push(path);
    }
    return acc;
  }

  test.each(mobileViewFiles(featureRoot))('%s tags each ArrowLeft button with kx-back', (path) => {
    const source = readFileSync(path, 'utf8');
    const buttons = source
      .split(/(?=<button)/)
      .filter((chunk) => chunk.includes('<ArrowLeft'));
    for (const button of buttons) {
      expect(button.slice(0, button.indexOf('>'))).toContain('kx-back');
    }
  });

  test('the home dashboard marks every forward chevron as directional', () => {
    const home = readFileSync('src/features/home/MobileHomeDashboard.tsx', 'utf8');
    const chevrons = home.match(/<ChevronRight[^>]*\/>/g) ?? [];
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) expect(chevron).toContain('className="kx-forward"');
  });

  test('the RTL contract is documented where it is implemented', () => {
    expect(visualCss).toContain('RTL mirrors directional affordances only');
  });
});
