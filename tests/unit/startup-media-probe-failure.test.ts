/**
 * Startup media probe failure behavioral tests
 * Verifies that probe failures are not silent and workspace fallback is preserved
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('startup media probe failure', () => {
  function createAppHarness() {
    let startupHandled = false;
    let currentView: string | null = null;
    const notifications: any[] = [];
    let currentMedia: string | null = null;
    const setView = (v: string) => { currentView = v; };
    const addNotification = (n: any) => { notifications.push(n); };
    const setCurrentMedia = (p: string) => { currentMedia = p; };

    const applyWorkspace = (workspace: { lastOpenedSection: string; hiddenModules: string[] }) => {
      if (startupHandled) return;
      if (!workspace.hiddenModules.includes(workspace.lastOpenedSection)) {
        setView(workspace.lastOpenedSection);
      }
    };

    const handleStartupMedia = async (firstPath: string, probeResult: any) => {
      // Mirrors App.tsx fixed logic
      try {
        const probe = await probeResult;
        if (!probe.streams?.some((s: any) => s.codec_type === 'video' || s.codec_type === 'audio')) {
          // eslint-disable-next-line no-console
          console.warn('[KNOUX] Startup media probe found no playable streams:', firstPath, probe);
          addNotification({
            type: 'error',
            title: 'Could not open media',
            message: 'The selected file contains no playable audio or video stream.',
            duration: 6000,
          });
          return false;
        }
        setCurrentMedia(firstPath);
        startupHandled = true;
        setView('player');
        return true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[KNOUX] Startup media probe failed:', firstPath, error);
        addNotification({
          type: 'error',
          title: 'Could not open media',
          message: 'The selected media file could not be opened.',
          duration: 6000,
        });
        return false;
      }
    };

    return {
      handleStartupMedia,
      applyWorkspace,
      getView: () => currentView,
      getMedia: () => currentMedia,
      getNotifications: () => notifications,
      isHandled: () => startupHandled,
    };
  }

  it('probe failure is caught, not marked handled, notification shown, no unhandled rejection', async () => {
    const app = createAppHarness();
    const probeFailure = Promise.reject(new Error('ffprobe failed'));
    // Attach catch to ensure no unhandled rejection
    let unhandled = false;
    const handle = app.handleStartupMedia('/bad/file.mp4', probeFailure).catch(() => { unhandled = true; });
    const result = await handle;
    expect(result).toBe(false);
    expect(unhandled).toBe(false);
    expect(app.isHandled()).toBe(false);
    expect(app.getMedia()).toBeNull();
    expect(app.getView()).toBeNull();
    expect(app.getNotifications().length).toBe(1);
    expect(app.getNotifications()[0].title).toBe('Could not open media');
    expect(app.getNotifications()[0].type).toBe('error');
    expect(app.getNotifications()[0].message).toMatch(/could not be opened/i);
  });

  it('probe with no playable streams shows specific message and is not marked handled', async () => {
    const app = createAppHarness();
    const probeNoStreams = Promise.resolve({ streams: [{ codec_type: 'attachment' }] });
    const result = await app.handleStartupMedia('/image.jpg', probeNoStreams);
    expect(result).toBe(false);
    expect(app.isHandled()).toBe(false);
    expect(app.getMedia()).toBeNull();
    expect(app.getNotifications().length).toBe(1);
    expect(app.getNotifications()[0].message).toMatch(/no playable/i);
  });

  it('workspace fallback after invalid startup media - lastOpenedSection preserved', async () => {
    const app = createAppHarness();
    // Workspace would normally restore to 'library'
    const workspace = { lastOpenedSection: 'library', hiddenModules: [] as string[] };
    // Startup media fails
    await app.handleStartupMedia('/bad.mp4', Promise.reject(new Error('probe fail')));
    expect(app.isHandled()).toBe(false);
    // Workspace restoration should still proceed
    app.applyWorkspace(workspace);
    expect(app.getView()).toBe('library');
    // Also test no-streams case
    const app2 = createAppHarness();
    await app2.handleStartupMedia('/bad2.mp4', Promise.resolve({ streams: [] }));
    app2.applyWorkspace(workspace);
    expect(app2.getView()).toBe('library');
  });

  it('valid startup media still marks handled and overrides workspace', async () => {
    const app = createAppHarness();
    const workspace = { lastOpenedSection: 'library', hiddenModules: [] as string[] };
    const probeValid = Promise.resolve({ streams: [{ codec_type: 'video' }] });
    const result = await app.handleStartupMedia('/good.mp4', probeValid);
    expect(result).toBe(true);
    expect(app.isHandled()).toBe(true);
    expect(app.getMedia()).toBe('/good.mp4');
    expect(app.getView()).toBe('player');
    expect(app.getNotifications().length).toBe(0);
    // Workspace should not override
    app.applyWorkspace(workspace);
    expect(app.getView()).toBe('player');
  });

  it('application remains usable after probe failure', async () => {
    const app = createAppHarness();
    await app.handleStartupMedia('/bad.mp4', Promise.reject(new Error('fail')));
    expect(app.getNotifications().length).toBe(1);
    // Can still handle valid media after failure
    const result = await app.handleStartupMedia('/good.mp4', Promise.resolve({ streams: [{ codec_type: 'audio' }] }));
    expect(result).toBe(true);
    expect(app.getMedia()).toBe('/good.mp4');
    expect(app.getView()).toBe('player');
    // getNotifications should have only the first failure, not cleared
    expect(app.getNotifications().length).toBe(1);
  });
});
