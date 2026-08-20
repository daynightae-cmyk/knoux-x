import fs from 'node:fs';
import path from 'node:path';

describe('image editor browser import contract', () => {
  const viewPath = path.resolve(__dirname, '../../src/features/image-editor/ImageEditorView.tsx');
  const localePath = path.resolve(__dirname, '../../src/locales/imageEditor.ts');

  it('keeps a web-preview file input and drag-and-drop route independent of desktop IPC', () => {
    const source = fs.readFileSync(viewPath, 'utf8');

    expect(source).toContain('const browserImageInputRef = useRef<HTMLInputElement | null>(null);');
    expect(source).toContain("if (!file.type.startsWith('image/'))");
    expect(source).toContain('reader.readAsDataURL(file);');
    expect(source).toContain("if (!desktopRuntime) {\n      browserImageInputRef.current?.click();");
    expect(source).toContain('onDrop={handleImageDrop}');
    expect(source).toContain('className="image-editor-browser-file-input"');
    expect(source).toContain('disabled={busy}>{t(\'imageEditor.openImage\')}');
  });

  it('keeps original-result comparison and automatic natural retouch visible to the editor', () => {
    const source = fs.readFileSync(viewPath, 'utf8');
    const locales = fs.readFileSync(localePath, 'utf8');

    expect(source).toContain('const [showOriginal, setShowOriginal] = useState(false);');
    expect(source).toContain('className="image-editor-original-preview"');
    expect(source).toContain("handlePresetApply('natural-retouch')");
    expect(locales).toContain("dropImageHere: 'or drag and drop an image here'");
    expect(locales).toContain("beautyAutoNatural: 'Auto natural retouch'");
  });
});
