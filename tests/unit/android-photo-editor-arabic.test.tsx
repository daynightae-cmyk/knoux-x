/** @jest-environment jsdom */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileBeautyRetouchView } from '../../src/features/image-studio/MobileBeautyRetouchView';
import { MobileImageEditorView } from '../../src/features/image-editor/MobileImageEditorView';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));

const appBox = { locale: 'en', setView: jest.fn(), addNotification: jest.fn() };
jest.mock('../../src/store/appStore', () => ({
  useAppStore: (select: (value: typeof appBox) => unknown) => select(appBox),
}));

const editorBox = {
  source: null as null | { dataUrl: string; name: string; originalWidth: number; originalHeight: number },
  setSource: jest.fn(),
  setRetouchProject: jest.fn(),
  setBeautyBeforeSnapshot: jest.fn(),
  setBeautyPreview: jest.fn(),
};
jest.mock('../../src/store/imageEditorStore', () => ({
  useImageEditorStore: (select: (value: typeof editorBox) => unknown) => select(editorBox),
}));

jest.mock('../../src/features/image-studio/MobileBeautyCanvas', () => ({
  MobileBeautyCanvas: () => null,
}));

const DRAFT_KEY = 'knoux:android:photo-draft:v1';
const ADJUSTMENTS = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0,
  rotation: 0, flipH: false, flipV: false, filter: 'none',
};

let root: Root;
let host: HTMLDivElement;

function text(): string {
  return host.textContent ?? '';
}

function labels(): string[] {
  return Array.from(host.querySelectorAll('button'))
    .map((button) => `${button.getAttribute('aria-label') ?? ''}|${(button.textContent ?? '').trim()}`);
}

function seedDraft(): void {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
    photo: {
      sourceUri: 'content://media/external/images/media/12',
      sourceName: 'portrait.jpg',
      mime: 'image/jpeg',
      naturalWidth: 4,
      naturalHeight: 4,
    },
    adjustments: ADJUSTMENTS,
  }));
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
  appBox.locale = 'en';
  appBox.setView.mockReset();
  appBox.addNotification.mockReset();
  editorBox.source = null;
  window.localStorage.clear();
  class ResizeObserverStub {
    observe(): void { /* layout is not measured in jsdom */ }
    unobserve(): void { /* layout is not measured in jsdom */ }
    disconnect(): void { /* layout is not measured in jsdom */ }
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverStub });
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    writable: true,
    value: {
      file: {
        readFile: async () => { throw new Error('Could not read file payload.'); },
        getMediaInfo: async () => ({ name: 'portrait.jpg', format: 'image/jpeg' }),
        openFile: async () => null,
      },
      system: { openExternal: jest.fn() },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

async function mount(node: ReactElement): Promise<void> {
  await act(async () => { root.render(node); });
}

describe('Mobile photo editor speaks the app language (directive §16.1)', () => {
  test('English keeps the shipped labels', async () => {
    await mount(<MobileImageEditorView />);
    expect(text()).toContain('Choose Photo');
    expect(text()).toContain('Select a Photo');
    expect(host.querySelector('.kx-back')).not.toBeNull();
    expect(host.querySelector('.kx-back')?.getAttribute('aria-label')).toBe('Back to home');
  });

  test('Arabic translates the empty state, the header and the accessible labels', async () => {
    appBox.locale = 'ar';
    await mount(<MobileImageEditorView />);
    expect(text()).toContain('اختر صورة');
    expect(text()).toContain('اختر أي صورة JPEG أو PNG أو WebP من جهازك لبدء التحرير.');
    expect(text()).toContain('محرّر الصور');
    expect(host.querySelector('.kx-back')?.getAttribute('aria-label')).toBe('رجوع إلى الرئيسية');
    expect(text()).not.toContain('Choose Photo');
  });

  test('a failed decode surfaces the error state in Arabic, including the reason', async () => {
    appBox.locale = 'ar';
    seedDraft();
    await mount(<MobileImageEditorView />);
    expect(host.querySelector('[data-component="MobileImageEditorView"]')?.getAttribute('data-state')).toBe('ERROR');
    expect(text()).toContain('خطأ في تحميل الصورة');
    expect(text()).toContain('تعذّر قراءة محتوى الملف.');
    expect(text()).toContain('حاول مجددًا');
    expect(text()).not.toContain('Try Again');
  });

  test('the same failure stays English for English users', async () => {
    seedDraft();
    await mount(<MobileImageEditorView />);
    expect(text()).toContain('Error Loading Photo');
    expect(text()).toContain('Could not read file payload.');
    expect(text()).toContain('Try Again');
  });

  test('every interactive photo-editor control carries a localized label', async () => {
    appBox.locale = 'ar';
    await mount(<MobileImageEditorView />);
    const unnamed = labels().filter((entry) => entry === '|');
    expect(unnamed).toEqual([]);
  });
});

describe('Beauty retouch shell speaks the app language (directive §16.1)', () => {
  test('English picker copy', async () => {
    await mount(<MobileBeautyRetouchView />);
    expect(text()).toContain('Open a portrait');
    expect(text()).toContain('Choose photo');
  });

  test('Arabic picker copy, header and back label', async () => {
    appBox.locale = 'ar';
    await mount(<MobileBeautyRetouchView />);
    expect(text()).toContain('استوديو الجمال');
    expect(text()).toContain('افتح صورة بورتريه');
    expect(text()).toContain('تحليل الوجه يتم على جهازك. لا يلزم رفع الصورة لأي من أدوات الجمال المحلية.');
    expect(host.querySelector('.kx-back')?.getAttribute('aria-label')).toBe('رجوع إلى الرئيسية');
    expect(text()).not.toContain('Open a portrait');
  });

  test('a failed photo import notifies in the active language', async () => {
    appBox.locale = 'ar';
    Object.defineProperty(window, 'knouxAPI', {
      configurable: true,
      writable: true,
      value: { file: { openFile: async () => { throw new Error('denied'); } }, system: { openExternal: jest.fn() } },
    });
    await mount(<MobileBeautyRetouchView />);
    const picker = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => (button.textContent ?? '').includes('اختر صورة') || (button.textContent ?? '').includes('فتح صورة'));
    expect(picker).toBeDefined();
    await act(async () => { picker?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(appBox.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'تعذّر فتح الصورة',
      message: 'اختر صورة أخرى بصيغة JPG أو PNG أو WebP أو BMP وحاول مجددًا.',
    }));
  });
});
