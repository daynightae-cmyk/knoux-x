import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('KNOUX X Android native media foundations', () => {
  const nativeBridge = read('src/platform/androidNativeMedia.ts');
  const session = read('src/features/player/UltimateMobilePlayerSession.tsx');
  const audio = read('src/features/player/PlayerAudioManager.ts');
  const generator = read('tools/prepare-android-native-media.cjs');
  const workflow = read('.github/workflows/android-apk.yml');

  test('generates a native Capacitor PiP plugin and a foreground media playback service', () => {
    expect(generator).toContain('@CapacitorPlugin(name = "KnouxMediaSession")');
    expect(generator).toContain('PictureInPictureParams.Builder()');
    expect(generator).toContain('class KnouxPlaybackService extends Service');
    expect(generator).toContain('new MediaSession(this, "KNOUX X")');
    expect(generator).toContain('startForeground(NOTIFICATION_ID, notification())');
    expect(generator).toContain('android:foregroundServiceType="mediaPlayback"');
    expect(generator).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
  });

  test('routes lock-screen and notification commands back into the real player', () => {
    expect(generator).toContain("sendCommand(\"play\", null)");
    expect(generator).toContain("sendCommand(\"pause\", null)");
    expect(generator).toContain("sendCommand(\"seek-forward\", null)");
    expect(generator).toContain("sendCommand(\"seek-back\", null)");
    expect(session).toContain("window.addEventListener('knoux:native-media-command'");
    expect(session).toContain("case 'play':");
    expect(session).toContain("case 'pause':");
  });

  test('uses the native plugin for PiP and media-session synchronization', () => {
    expect(nativeBridge).toContain('KnouxMediaSession');
    expect(nativeBridge).toContain('enterPictureInPicture');
    expect(nativeBridge).toContain('updatePlayback');
    expect(session).toContain('enterAndroidPictureInPicture');
    expect(session).toContain('syncAndroidMediaSession');
  });

  test('implements audio delay with a real Web Audio DelayNode', () => {
    expect(audio).toContain('private delayNode: DelayNode | null = null');
    expect(audio).toContain('this.audioContext.createDelay(2)');
    expect(audio).toContain('this.stereoPanner.connect(this.delayNode)');
    expect(audio).toContain('setDelay(delayMs: number)');
    expect(audio).toContain('delayTime.setTargetAtTime');
    expect(session).toContain('Audio Delay');
    expect(session).toContain('setActivePlayerAudioDelay');
  });

  test('installs and verifies the native media runtime before Gradle packaging', () => {
    expect(workflow).toContain('node tools/prepare-android-native-media.cjs');
    expect(workflow).toContain('registerPlugin(KnouxMediaSessionPlugin.class)');
    expect(workflow).toContain('KnouxPlaybackService.java');
  });
});
