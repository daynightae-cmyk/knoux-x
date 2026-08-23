/**
 * Subtitle async race behavioral tests
 * Verifies explicit media/revision guard for selectSubtitle and changeSubtitleDelay
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('subtitle async race - selectSubtitle', () => {
  class Harness {
    currentMedia: string | null = null;
    currentMediaRef: string | null = null;
    subtitle: any = null;
    requestId = 0;
    setCurrentMedia(m: string | null) {
      this.currentMedia = m;
      this.currentMediaRef = m;
      this.subtitle = null;
    }
    async selectSubtitle(api: () => Promise<any>) {
      const id = ++this.requestId;
      const mediaAtRequest = this.currentMediaRef;
      const loaded = await api();
      if (id !== this.requestId) return 'ignored-stale-id';
      if (mediaAtRequest !== this.currentMediaRef) return 'ignored-stale-media';
      if (loaded) this.subtitle = loaded;
      return 'applied';
    }
  }

  it('Media A request → switch to B → A resolves → ignored', async () => {
    const h = new Harness();
    h.setCurrentMedia('A.mp4');
    let resolveA!: (v: any) => void;
    const promiseA = new Promise<any>((res) => { resolveA = res; });
    const apiA = () => promiseA;
    const pending = h.selectSubtitle(apiA);
    h.setCurrentMedia('B.mp4');
    resolveA({ filePath: 'A.srt', webVtt: 'WEBVTT A', delaySeconds: 0 });
    const result = await pending;
    expect(result).toMatch(/ignored/);
    expect(h.subtitle).toBeNull();
    expect(h.currentMedia).toBe('B.mp4');
  });

  it('Media B request → B remains current → B resolves → applied', async () => {
    const h = new Harness();
    h.setCurrentMedia('B.mp4');
    const apiB = () => Promise.resolve({ filePath: 'B.srt', webVtt: 'WEBVTT B', delaySeconds: 0 });
    const result = await h.selectSubtitle(apiB);
    expect(result).toBe('applied');
    expect(h.subtitle?.filePath).toBe('B.srt');
  });

  it('normal subtitle selection still works', async () => {
    const h = new Harness();
    h.setCurrentMedia('A.mp4');
    const result = await h.selectSubtitle(() => Promise.resolve({ filePath: 'A.srt', webVtt: 'WEBVTT', delaySeconds: 0 }));
    expect(result).toBe('applied');
    expect(h.subtitle).not.toBeNull();
  });

  it('A → B → A remains safe (first A ignored, second A applied)', async () => {
    const h = new Harness();
    h.setCurrentMedia('A.mp4');
    let resolveA1!: (v: any) => void;
    const promiseA1 = new Promise<any>((res) => { resolveA1 = res; });
    const pendingA1 = h.selectSubtitle(() => promiseA1);
    h.setCurrentMedia('B.mp4');
    h.setCurrentMedia('A.mp4');
    let resolveA2!: (v: any) => void;
    const promiseA2 = new Promise<any>((res) => { resolveA2 = res; });
    const pendingA2 = h.selectSubtitle(() => promiseA2);
    resolveA1({ filePath: 'A1.srt', webVtt: 'WEBVTT A1', delaySeconds: 0 });
    const r1 = await pendingA1;
    expect(r1).toMatch(/ignored/);
    expect(h.subtitle).toBeNull(); // not yet applied, waiting for A2
    resolveA2({ filePath: 'A2.srt', webVtt: 'WEBVTT A2', delaySeconds: 0 });
    const r2 = await pendingA2;
    expect(r2).toBe('applied');
    expect(h.subtitle?.filePath).toBe('A2.srt');
  });
});

describe('subtitle async race - changeSubtitleDelay', () => {
  class Harness {
    currentMedia: string | null = null;
    currentMediaRef: string | null = null;
    subtitle: any = { filePath: 'A.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    delayRequestId = 0;
    setCurrentMedia(m: string | null) {
      this.currentMedia = m;
      this.currentMediaRef = m;
      this.subtitle = null;
    }
    async changeDelay(api: (p: string, d: number) => Promise<any>, delta: number) {
      if (!this.subtitle) return 'no-subtitle';
      const id = ++this.delayRequestId;
      const mediaAtRequest = this.currentMediaRef;
      const filePathAtRequest = this.subtitle.filePath;
      const delay = this.subtitle.delaySeconds + delta;
      const reloaded = await api(filePathAtRequest, delay);
      if (id !== this.delayRequestId) return 'ignored-stale-id';
      if (mediaAtRequest !== this.currentMediaRef) return 'ignored-stale-media';
      this.subtitle = reloaded;
      return 'applied';
    }
  }

  it('Media A delay request → switch to B → A resolves → ignored', async () => {
    const h = new Harness();
    h.currentMedia = 'A.mp4';
    h.currentMediaRef = 'A.mp4';
    h.subtitle = { filePath: 'A.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    let resolveA!: (v: any) => void;
    const promiseA = new Promise<any>((res) => { resolveA = res; });
    const api = () => promiseA;
    const pending = h.changeDelay(api as any, 0.5);
    h.setCurrentMedia('B.mp4');
    resolveA({ filePath: 'A.srt', delaySeconds: 0.5, webVtt: 'WEBVTT' });
    const result = await pending;
    expect(result).toMatch(/ignored/);
    expect(h.subtitle).toBeNull();
  });

  it('Media B delay request → B remains current → B resolves → applied', async () => {
    const h = new Harness();
    h.currentMedia = 'B.mp4';
    h.currentMediaRef = 'B.mp4';
    h.subtitle = { filePath: 'B.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    const result = await h.changeDelay(() => Promise.resolve({ filePath: 'B.srt', delaySeconds: 0.5, webVtt: 'WEBVTT' }), 0.5);
    expect(result).toBe('applied');
    expect(h.subtitle?.delaySeconds).toBe(0.5);
  });

  it('normal delay still works', async () => {
    const h = new Harness();
    h.currentMedia = 'A.mp4';
    h.currentMediaRef = 'A.mp4';
    h.subtitle = { filePath: 'A.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    const result = await h.changeDelay(() => Promise.resolve({ filePath: 'A.srt', delaySeconds: 1, webVtt: 'WEBVTT' }), 1);
    expect(result).toBe('applied');
    expect(h.subtitle.delaySeconds).toBe(1);
  });

  it('A → B → A remains safe for delay', async () => {
    const h = new Harness();
    h.currentMedia = 'A.mp4';
    h.currentMediaRef = 'A.mp4';
    h.subtitle = { filePath: 'A.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    let resolveA1!: (v: any) => void;
    const promiseA1 = new Promise<any>((res) => { resolveA1 = res; });
    const pendingA1 = h.changeDelay(() => promiseA1, 0.5);
    h.setCurrentMedia('B.mp4');
    // Simulate B has no subtitle, then back to A with new subtitle
    h.setCurrentMedia('A.mp4');
    h.subtitle = { filePath: 'A.srt', delaySeconds: 0, webVtt: 'WEBVTT' };
    let resolveA2!: (v: any) => void;
    const promiseA2 = new Promise<any>((res) => { resolveA2 = res; });
    const pendingA2 = h.changeDelay(() => promiseA2, 1);
    resolveA1({ filePath: 'A.srt', delaySeconds: 0.5, webVtt: 'WEBVTT' });
    const r1 = await pendingA1;
    expect(r1).toMatch(/ignored/);
    resolveA2({ filePath: 'A.srt', delaySeconds: 1, webVtt: 'WEBVTT' });
    const r2 = await pendingA2;
    expect(r2).toBe('applied');
    expect(h.subtitle.delaySeconds).toBe(1);
  });
});
