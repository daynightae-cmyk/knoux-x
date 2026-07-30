export type RecordingStatus = 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping' | 'completed' | 'failed' | 'canceled';
export type RecordingEvent =
  | { type: 'START_COUNTDOWN' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; message: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export interface RecordingState {
  status: RecordingStatus;
  error: string | null;
}

const transitions: Record<RecordingStatus, readonly RecordingEvent['type'][]> = {
  idle: ['START_COUNTDOWN', 'START'],
  countdown: ['START', 'CANCEL'],
  recording: ['PAUSE', 'STOP', 'CANCEL', 'FAIL'],
  paused: ['RESUME', 'STOP', 'CANCEL', 'FAIL'],
  stopping: ['COMPLETE', 'FAIL', 'CANCEL'],
  completed: ['RESET'],
  failed: ['RESET'],
  canceled: ['RESET'],
};

export const initialRecordingState: RecordingState = { status: 'idle', error: null };

export function reduceRecordingState(state: RecordingState, event: RecordingEvent): RecordingState {
  if (!transitions[state.status].includes(event.type)) {
    throw new Error(`Recording event ${event.type} is invalid while ${state.status}.`);
  }
  switch (event.type) {
    case 'START_COUNTDOWN': return { status: 'countdown', error: null };
    case 'START':
    case 'RESUME': return { status: 'recording', error: null };
    case 'PAUSE': return { status: 'paused', error: null };
    case 'STOP': return { status: 'stopping', error: null };
    case 'COMPLETE': return { status: 'completed', error: null };
    case 'FAIL': return { status: 'failed', error: event.message };
    case 'CANCEL': return { status: 'canceled', error: null };
    case 'RESET': return initialRecordingState;
  }
}
