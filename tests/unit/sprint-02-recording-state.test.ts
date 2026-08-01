import {
  RECORDING_CAPABILITY_STATES,
  RECORDING_FAILURE_CODES,
  RECORDING_SESSION_STATES,
  RECORDING_TRANSITIONS,
  initialRecordingState,
  reduceRecordingState,
  validateRecordingCapability,
} from '../../src/core/creative/recordingState';

describe('Sprint 02 recorder state contract', () => {
  test('keeps capability, session, and failure vocabularies orthogonal and exact', () => {
    expect(RECORDING_CAPABILITY_STATES).toEqual(['Available', 'Unavailable', 'Permission Required', 'Device Missing']);
    expect(RECORDING_SESSION_STATES).toEqual(['Idle', 'Countdown', 'Recording', 'Paused', 'Stopping', 'Completed', 'Cancelled', 'Failed']);
    expect(RECORDING_FAILURE_CODES).toEqual(expect.arrayContaining(['SOURCE_LOST', 'ENCODER_FAILED', 'DISK_FULL', 'PERMISSION_REVOKED', 'DEVICE_REMOVED']));
    expect(validateRecordingCapability({ id: 'microphone', state: 'Device Missing', reason: 'No microphone enumerated.', deviceId: null }).state).toBe('Device Missing');
  });

  test('enforces the binding transition table and structured failure', () => {
    const countdown = reduceRecordingState(initialRecordingState, { type: 'START_COUNTDOWN' });
    const recording = reduceRecordingState(countdown, { type: 'START' });
    const paused = reduceRecordingState(recording, { type: 'PAUSE' });
    expect(reduceRecordingState(paused, { type: 'FAIL', code: 'SOURCE_LOST', reason: 'Display was disconnected.' })).toEqual({
      status: 'Failed', failure: { code: 'SOURCE_LOST', reason: 'Display was disconnected.' },
    });
    expect(RECORDING_TRANSITIONS.Idle).toEqual(['START_COUNTDOWN']);
    expect(() => reduceRecordingState(initialRecordingState, { type: 'START' })).toThrow('invalid while Idle');
  });
});
