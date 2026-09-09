import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

describe('Windows real multitrack timeline export', () => {
  const shell = readSource('src/features/video-studio/DesktopVideoStudioView.tsx');
  const app = readSource('src/App.tsx');
  const contract = readSource('electron/ipc/contract.ts');

  test('keeps Android on its dedicated mobile editor and routes only Windows through the export shell', () => {
    expect(app).toContain("import('./features/video-studio/DesktopVideoStudioView')");
    expect(app).toContain("case 'editor': return android ? <MobileVideoStudioView /> : <VideoStudioView />;");
  });

  test('exports the current saved multitrack snapshot rather than a separately selected source', () => {
    expect(shell).toContain("new CustomEvent('knoux:command'");
    expect(shell).toContain("detail: { command: 'save', requestId }");
    expect(shell).toContain('window.knouxMultitrackAPI.openRecent(saved.filePath)');
    expect(shell).toContain('renderMultitrackProject(structuredClone(project)');
    expect(shell).toContain('width: project.settings.width');
    expect(shell).toContain('height: project.settings.height');
    expect(shell).toContain('fps: project.settings.fps');
  });

  test('writes a real encoded artifact and independently probes the final file', () => {
    expect(shell).toContain('window.knouxAPI.file.saveFile');
    expect(shell).toContain('window.knouxAPI.file.writeFile');
    expect(shell).toContain('window.knouxCreativeAPI.export.probe(destination)');
    expect(shell).toContain("stream.codec_type === 'video'");
    expect(shell).toContain("stream.codec_type === 'audio'");
  });

  test('reuses the production timeline renderer without adding another IPC export surface', () => {
    expect(shell).toContain("from '../export/mobileTimelineRenderer'");
    expect(contract).not.toContain('MULTITRACK_EXPORT');
    expect(contract).not.toContain('multitrack:export');
  });

  test('provides cancellation during the real timeline render', () => {
    expect(shell).toContain('cancelled: () => cancelRequestedRef.current');
    expect(shell).toContain('cancelRequestedRef.current = true');
  });
});
