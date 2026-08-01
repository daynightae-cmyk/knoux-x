import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import { dialog, shell } from 'electron';
import Store from 'electron-store';

import {
  initialRecordingState,
  RecordingState,
  reduceRecordingState,
} from '../../src/core/creative/recordingState';
import { sanitizeWindowsFileStem } from '../../src/core/creative/capture';

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_RECORDING_HISTORY = 100;

export type RecordingSourceKind = 'player' | 'window' | 'display';

export interface BeginRecordingRequest {
  source: RecordingSourceKind;
  mimeType: string;
  suggestedName?: string;
  countdownSeconds?: number;
  preferredDirectory?: string;
}

export interface RecordingSessionSnapshot {
  id: string;
  encoderId: string;
  source: RecordingSourceKind;
  mimeType: string;
  state: RecordingState;
  outputPath: string;
  startedAt: string;
  completedAt?: string;
  bytesWritten: number;
  acceptedVideoFrames: number;
  droppedFrames: number;
  activeDurationMs: number;
  metersActive: boolean;
}

interface RecordingSession extends RecordingSessionSnapshot {
  partialPath: string;
  handle: fs.FileHandle;
  writeChain: Promise<void>;
  activeStartedAtMs: number | null;
  accumulatedActiveMs: number;
}

interface RecordingStoreSchema {
  history: RecordingSessionSnapshot[];
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('video/webm') || normalized.startsWith('audio/webm')) return 'webm';
  if (normalized.startsWith('audio/ogg')) return 'ogg';
  throw new TypeError('This KNOUX build records WebM or Ogg streams only.');
}

function validateCountdown(seconds: number | undefined): number {
  if (seconds === undefined) return 0;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 10) {
    throw new RangeError('Recording countdown must be an integer between 0 and 10 seconds.');
  }
  return seconds;
}

export class RecordingService {
  private readonly sessions = new Map<string, RecordingSession>();
  private readonly store = new Store<RecordingStoreSchema>({
    name: 'creative-recordings',
    defaults: { history: [] },
  });

  listSessions(): RecordingSessionSnapshot[] {
    const active = [...this.sessions.values()].map((session) => this.snapshot(session));
    return [...active, ...this.store.get('history')];
  }

  async begin(request: BeginRecordingRequest): Promise<RecordingSessionSnapshot | null> {
    const extension = extensionForMimeType(request.mimeType);
    validateCountdown(request.countdownSeconds);
    const name = sanitizeWindowsFileStem(request.suggestedName ?? `KNOUX-${request.source}-recording`);
    const preferredDirectory = typeof request.preferredDirectory === 'string' && request.preferredDirectory.length > 0
      ? path.resolve(request.preferredDirectory)
      : null;
    const result = await dialog.showSaveDialog({
      title: 'Save KNOUX recording',
      defaultPath: preferredDirectory
        ? path.join(preferredDirectory, `${name}.${extension}`)
        : `${name}.${extension}`,
      filters: [{ name: `${extension.toUpperCase()} Recording`, extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;

    const outputPath = path.extname(result.filePath).toLowerCase() === `.${extension}`
      ? path.resolve(result.filePath)
      : path.resolve(`${result.filePath}.${extension}`);
    const partialPath = `${outputPath}.${randomUUID()}.partial`;
    const handle = await fs.open(partialPath, 'wx');
    const id = randomUUID();
    let state = reduceRecordingState(initialRecordingState, { type: 'START_COUNTDOWN' });
    state = reduceRecordingState(state, { type: 'START' });

    const session: RecordingSession = {
      id,
      encoderId: randomUUID(),
      source: request.source,
      mimeType: request.mimeType,
      state,
      outputPath,
      partialPath,
      startedAt: new Date().toISOString(),
      bytesWritten: 0,
      acceptedVideoFrames: 0,
      droppedFrames: 0,
      activeDurationMs: 0,
      metersActive: true,
      handle,
      writeChain: Promise.resolve(),
      activeStartedAtMs: Date.now(),
      accumulatedActiveMs: 0,
    };
    this.sessions.set(id, session);
    return this.snapshot(session);
  }

  async append(sessionId: string, chunk: ArrayBuffer | Uint8Array): Promise<RecordingSessionSnapshot> {
    const session = this.requireSession(sessionId);
    if (session.state.status !== 'Recording') {
      throw new Error(`Cannot append recording data while ${session.state.status}.`);
    }
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_CHUNK_BYTES) {
      throw new RangeError(`Recording chunks must be between 1 byte and ${MAX_CHUNK_BYTES} bytes.`);
    }
    const copy = Buffer.from(bytes);
    session.writeChain = session.writeChain.then(async () => {
      await session.handle.write(copy);
      session.bytesWritten += copy.byteLength;
      session.acceptedVideoFrames += 1;
    });
    await session.writeChain;
    return this.snapshot(session);
  }

  pause(sessionId: string): RecordingSessionSnapshot {
    const session = this.requireSession(sessionId);
    session.state = reduceRecordingState(session.state, { type: 'PAUSE' });
    this.freezeActiveDuration(session);
    session.metersActive = false;
    return this.snapshot(session);
  }

  resume(sessionId: string): RecordingSessionSnapshot {
    const session = this.requireSession(sessionId);
    session.state = reduceRecordingState(session.state, { type: 'RESUME' });
    session.activeStartedAtMs = Date.now();
    session.metersActive = true;
    return this.snapshot(session);
  }

  async finish(sessionId: string): Promise<RecordingSessionSnapshot> {
    const session = this.requireSession(sessionId);
    session.state = reduceRecordingState(session.state, { type: 'STOP' });
    this.freezeActiveDuration(session);
    session.metersActive = false;
    try {
      await session.writeChain;
      await session.handle.sync();
      await session.handle.close();
      if (session.bytesWritten <= 0) throw new Error('Recording produced an empty output file.');
      await fs.rename(session.partialPath, session.outputPath);
      session.state = reduceRecordingState(session.state, { type: 'COMPLETE' });
      session.completedAt = new Date().toISOString();
      const snapshot = this.snapshot(session);
      this.remember(snapshot);
      this.sessions.delete(sessionId);
      return snapshot;
    } catch (error) {
      session.state = reduceRecordingState(session.state, {
        type: 'FAIL',
        code: error instanceof Error && /space|disk|ENOSPC/i.test(error.message) ? 'DISK_FULL' : 'ENCODER_FAILED',
        reason: error instanceof Error ? error.message : 'Recording could not be finalized.',
      });
      try { await session.handle.close(); } catch { /* already closed */ }
      await fs.rm(session.partialPath, { force: true });
      const snapshot = this.snapshot(session);
      this.sessions.delete(sessionId);
      throw new Error(snapshot.state.failure?.reason ?? 'Recording failed.');
    }
  }

  async cancel(sessionId: string): Promise<RecordingSessionSnapshot> {
    const session = this.requireSession(sessionId);
    session.state = reduceRecordingState(session.state, { type: 'CANCEL' });
    this.freezeActiveDuration(session);
    session.metersActive = false;
    try {
      await session.writeChain;
      await session.handle.close();
    } finally {
      await fs.rm(session.partialPath, { force: true });
      this.sessions.delete(sessionId);
    }
    return this.snapshot(session);
  }

  async showRecordingInFolder(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const stored = this.store.get('history').find((entry) => path.resolve(entry.outputPath) === resolved);
    if (!stored) throw new Error('Recording path is not in the KNOUX recording history.');
    await fs.access(resolved);
    shell.showItemInFolder(resolved);
  }

  async shutdown(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map(async (id) => {
      try { await this.cancel(id); } catch { /* best-effort cleanup */ }
    }));
  }

  private remember(snapshot: RecordingSessionSnapshot): void {
    const history = this.store.get('history').filter((entry) => entry.outputPath !== snapshot.outputPath);
    this.store.set('history', [snapshot, ...history].slice(0, MAX_RECORDING_HISTORY));
  }

  private requireSession(sessionId: string): RecordingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Recording session does not exist.');
    return session;
  }

  private snapshot(session: RecordingSession): RecordingSessionSnapshot {
    return {
      id: session.id,
      encoderId: session.encoderId,
      source: session.source,
      mimeType: session.mimeType,
      state: { ...session.state },
      outputPath: session.outputPath,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      bytesWritten: session.bytesWritten,
      acceptedVideoFrames: session.acceptedVideoFrames,
      droppedFrames: session.droppedFrames,
      activeDurationMs: session.accumulatedActiveMs + (session.activeStartedAtMs === null ? 0 : Date.now() - session.activeStartedAtMs),
      metersActive: session.metersActive,
    };
  }

  private freezeActiveDuration(session: RecordingSession): void {
    if (session.activeStartedAtMs === null) return;
    session.accumulatedActiveMs += Math.max(0, Date.now() - session.activeStartedAtMs);
    session.activeStartedAtMs = null;
    session.activeDurationMs = session.accumulatedActiveMs;
  }
}
