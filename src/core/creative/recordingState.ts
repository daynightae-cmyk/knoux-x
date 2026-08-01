export const RECORDING_CAPABILITY_STATES = ['Available', 'Unavailable', 'Permission Required', 'Device Missing'] as const;
export type RecordingCapabilityState = typeof RECORDING_CAPABILITY_STATES[number];

export const RECORDING_SESSION_STATES = ['Idle', 'Countdown', 'Recording', 'Paused', 'Stopping', 'Completed', 'Cancelled', 'Failed'] as const;
export type RecordingSessionState = typeof RECORDING_SESSION_STATES[number];

export const RECORDING_FAILURE_CODES = [
  'SOURCE_LOST', 'ENCODER_FAILED', 'DISK_FULL', 'PERMISSION_REVOKED', 'DEVICE_REMOVED', 'OUTPUT_INVALID', 'UNKNOWN',
] as const;
export type RecordingFailureCode = typeof RECORDING_FAILURE_CODES[number];

export interface RecordingFailure {
  code: RecordingFailureCode;
  reason: string;
}

export interface RecordingCapability {
  id: 'display' | 'window' | 'region' | 'player' | 'camera' | 'microphone' | 'system-audio' | 'encoder';
  state: RecordingCapabilityState;
  reason: string | null;
  deviceId: string | null;
}

export interface RecordingTelemetry {
  sessionId: string | null;
  encoderId: string | null;
  acceptedBytes: number;
  acceptedVideoFrames: number;
  droppedFrames: number;
  activeDurationMs: number;
  sampledAt: string;
  metersActive: boolean;
  microphoneLevel: number;
  systemAudioLevel: number;
}

export interface RecordingState {
  status: RecordingSessionState;
  failure: RecordingFailure | null;
}

export type RecordingEvent =
  | { type: 'START_COUNTDOWN' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; code: RecordingFailureCode; reason: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export const RECORDING_TRANSITIONS: Readonly<Record<RecordingSessionState, readonly RecordingEvent['type'][]>> = {
  Idle: ['START_COUNTDOWN'],
  Countdown: ['START', 'CANCEL', 'FAIL'],
  Recording: ['PAUSE', 'STOP', 'CANCEL', 'FAIL'],
  Paused: ['RESUME', 'STOP', 'CANCEL', 'FAIL'],
  Stopping: ['COMPLETE', 'FAIL'],
  Completed: ['RESET'],
  Cancelled: ['RESET'],
  Failed: ['RESET'],
};

export const initialRecordingState: RecordingState = { status: 'Idle', failure: null };

function failureReason(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1000 || normalized.includes('\u0000')) throw new TypeError('Recording failure reason is invalid.');
  return normalized;
}

export function reduceRecordingState(state: RecordingState, event: RecordingEvent): RecordingState {
  if (!RECORDING_TRANSITIONS[state.status].includes(event.type)) {
    throw new Error(`Recording event ${event.type} is invalid while ${state.status}.`);
  }
  switch (event.type) {
    case 'START_COUNTDOWN': return { status: 'Countdown', failure: null };
    case 'START':
    case 'RESUME': return { status: 'Recording', failure: null };
    case 'PAUSE': return { status: 'Paused', failure: null };
    case 'STOP': return { status: 'Stopping', failure: null };
    case 'COMPLETE': return { status: 'Completed', failure: null };
    case 'FAIL': return { status: 'Failed', failure: { code: event.code, reason: failureReason(event.reason) } };
    case 'CANCEL': return { status: 'Cancelled', failure: null };
    case 'RESET': return initialRecordingState;
  }
}

export function createInitialRecordingTelemetry(now = new Date()): RecordingTelemetry {
  return {
    sessionId: null,
    encoderId: null,
    acceptedBytes: 0,
    acceptedVideoFrames: 0,
    droppedFrames: 0,
    activeDurationMs: 0,
    sampledAt: now.toISOString(),
    metersActive: false,
    microphoneLevel: 0,
    systemAudioLevel: 0,
  };
}

export function validateRecordingCapability(value: unknown): RecordingCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Recording capability must be an object.');
  const source = value as Record<string, unknown>;
  const ids: RecordingCapability['id'][] = ['display', 'window', 'region', 'player', 'camera', 'microphone', 'system-audio', 'encoder'];
  if (!ids.includes(source.id as RecordingCapability['id'])) throw new TypeError('Recording capability id is invalid.');
  if (!RECORDING_CAPABILITY_STATES.includes(source.state as RecordingCapabilityState)) throw new TypeError('Recording capability state is invalid.');
  for (const key of ['reason', 'deviceId'] as const) {
    if (source[key] !== null && typeof source[key] !== 'string') throw new TypeError(`Recording capability ${key} is invalid.`);
  }
  return source as unknown as RecordingCapability;
}
