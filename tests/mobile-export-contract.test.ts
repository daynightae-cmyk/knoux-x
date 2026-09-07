import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('KNOUX X Android real mobile export contract', () => {
  const app = read('src/App.tsx');
  const mobileExport = read('src/features/export/MobileExportView.tsx');
  const css = read('src/styles/mobile-export.css');

  test('routes Android export away from the desktop FFmpeg screen', () => {
    expect(app).toContain("import('./features/export/MobileExportView')");
    expect(app).toContain("case 'export': return android ? <MobileExportView /> : <ExportView />");
    expect(app).toContain("import './styles/mobile-export.css'");
  });

  test('performs a real on-device video encode instead of presenting a mock progress screen', () => {
    expect(mobileExport).toContain('new MediaRecorder(outputStream');
    expect(mobileExport).toContain('canvas.captureStream(fps)');
    expect(mobileExport).toContain('createMediaElementSource(video)');
    expect(mobileExport).toContain('createMediaStreamDestination()');
    expect(mobileExport).toContain('videoBitsPerSecond');
    expect(mobileExport).toContain("recorder.addEventListener('dataavailable'");
  });

  test('offers real output quality, saving and Android share flows', () => {
    for (const token of ['720p', '1080p', '1440p', '4K', 'Save to Device', 'navigator.share', 'navigator.canShare']) {
      expect(mobileExport).toContain(token);
    }
    expect(mobileExport).toContain("'video/mp4'");
    expect(mobileExport).toContain("'video/webm'");
  });

  test('keeps the approved black glass and restrained violet mobile direction', () => {
    expect(css).toContain("background: linear-gradient(135deg, #7c2fe8, #9b4dff");
    expect(css).toContain('backdrop-filter: blur(22px)');
    expect(css).toContain('.kme-progress-track');
  });
});
