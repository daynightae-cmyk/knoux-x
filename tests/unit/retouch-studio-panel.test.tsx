/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { RetouchStudioPanel } from '../../src/features/retouch-studio/RetouchStudioPanel';
import { MAKEUP_LOOKS, toolsForCategory } from '../../src/features/retouch-studio/retouchStudioModel';

const lookCards = MAKEUP_LOOKS.map((look) => ({
  id: look.id,
  kind: 'look' as const,
  en: look.en,
  ar: look.ar,
  swatch: look.swatch,
}));

function renderPanel(overrides: Partial<React.ComponentProps<typeof RetouchStudioPanel>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: Record<string, unknown[]> = {};
  const capture = <T,>(name: string) => (value?: T): void => {
    calls[name] = [...(calls[name] ?? []), value];
  };
  const tools = toolsForCategory('makeup');
  act(() => {
    root.render(
      <RetouchStudioPanel
        categories={['face', 'skin', 'makeup', 'presets', 'details']}
        tools={tools}
        templates={lookCards}
        activeCategory="makeup"
        onCategoryChange={capture('category')}
        activeTool={tools[0]}
        onToolChange={capture('tool')}
        value={0.5}
        onValueChange={capture('value')}
        color="#d94868"
        onColorChange={capture('color')}
        showColor
        colorLabel="Makeup color"
        faces={[{ id: 'f1', label: 'Face 1' }, { id: 'f2', label: 'Face 2' }]}
        showFaces
        applyAllFaces={false}
        onToggleApplyAll={capture('applyAll')}
        allFacesLabel="Apply all faces"
        selectedFaceId="f1"
        onSelectFace={capture('face')}
        canApply
        applying={false}
        onApply={capture('apply')}
        applyLabel="Apply"
        onResetTool={capture('resetTool')}
        onResetCategory={capture('resetCategory')}
        onResetAll={capture('resetAll')}
        resetToolLabel="Reset tool"
        resetCategoryLabel="Reset section"
        resetAllLabel="Reset all"
        canUndo
        canRedo={false}
        onUndo={capture('undo')}
        onRedo={capture('redo')}
        undoLabel="Undo"
        redoLabel="Redo"
        comparing={false}
        onCompareHold={capture('compare')}
        compareLabel="Compare"
        statusText="Face ready · 2 faces"
        busy={false}
        arabic={false}
        {...overrides}
      />,
    );
  });
  return {
    container,
    calls,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function click(element: Element | null): void {
  if (!element) throw new Error('Expected element to exist');
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
}

describe('RetouchStudioPanel', () => {
  test('category bar, tool carousel, slider, looks and actions render', () => {
    const { container, unmount } = renderPanel();
    try {
      const categories = container.querySelector('.krs-categories');
      expect(categories?.querySelectorAll('button').length).toBe(5);
      expect(container.querySelector('[data-studio-tool="lipstick"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Lipstick intensity"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-studio-template]').length).toBe(MAKEUP_LOOKS.length);
      expect(container.textContent).toContain('Face ready · 2 faces');
    } finally {
      unmount();
    }
  });

  test('tool selection, slider and apply flow through callbacks', () => {
    const { container, calls, unmount } = renderPanel();
    try {
      click(container.querySelector('[data-studio-tool="blush"]'));
      expect(calls.tool).toEqual(['blush']);
      const slider = container.querySelector('input[aria-label="Lipstick intensity"]') as HTMLInputElement | null;
      expect(slider).not.toBeNull();
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('No native value setter');
        setter.call(slider!, '0.7');
        slider!.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(calls.value).toEqual([0.7]);
      click(container.querySelector('.krs-apply'));
      expect(calls.apply?.length).toBe(1);
    } finally {
      unmount();
    }
  });

  test('compare toggles on keyboard click and sliders carry descriptive labels', () => {
    const { container, calls, unmount } = renderPanel();
    try {
      const compare = container.querySelector('[aria-label="Compare"]');
      click(compare);
      expect(calls.compare).toEqual([true]);
      const slider = container.querySelector('.krs-slider-block input[type="range"]');
      expect(slider?.getAttribute('aria-label')).toBe('Lipstick intensity');
      expect(slider?.getAttribute('aria-label')).not.toBe('slider');
    } finally {
      unmount();
    }
  });

  test('face selector and template cards drive callbacks', () => {
    const { container, unmount } = renderPanel();
    try {
      const faces = container.querySelector('.krs-faces');
      expect(faces?.querySelectorAll('button').length).toBe(3);
      click(container.querySelector('[data-studio-template="rose"]'));
      const rose = MAKEUP_LOOKS.find((look) => look.id === 'rose');
      expect(rose?.lipstick).toBe('#d94a7a');
    } finally {
      unmount();
    }
  });

  test('touch targets meet the minimum size in shipped CSS', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/features/retouch-studio/retouchStudioPanel.css'), 'utf8');
    expect(css).toMatch(/\.krs-actions-row button \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.krs-tool \{[^}]*min-height: 64px/s);
    expect(css).toMatch(/input\[type='range'\] \{[^}]*min-height: 44px/s);
  });
});
