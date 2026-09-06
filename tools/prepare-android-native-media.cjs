const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const appId = String(config.appId || '').trim();
if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(appId)) throw new Error(`Invalid Capacitor appId: ${appId}`);

const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', ...appId.split('.'));
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) throw new Error('Android project must be generated before native media preparation.');
fs.mkdirSync(javaDir, { recursive: true });

const mainActivity = `package ${appId};

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    public static final String ACTION_MEDIA_COMMAND = "${appId}.MEDIA_COMMAND";
    public static final String EXTRA_COMMAND = "command";
    public static final String EXTRA_POSITION = "position";

    private final BroadcastReceiver mediaCommandReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ACTION_MEDIA_COMMAND.equals(intent.getAction())) return;
            final String command = intent.getStringExtra(EXTRA_COMMAND);
            if (command == null || command.isEmpty()) return;
            final boolean hasPosition = intent.hasExtra(EXTRA_POSITION);
            final double position = intent.getDoubleExtra(EXTRA_POSITION, 0.0);
            dispatchMediaCommand(command, hasPosition ? position : null);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KnouxMediaSessionPlugin.class);
        super.onCreate(savedInstanceState);
        IntentFilter filter = new IntentFilter(ACTION_MEDIA_COMMAND);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaCommandReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaCommandReceiver, filter);
        }
    }

    private void dispatchMediaCommand(String command, Double position) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String detail = "{\\\"command\\\":" + JSONObject.quote(command);
        if (position != null && Double.isFinite(position)) detail += ",\\\"position\\\":" + position;
        detail += "}";
        String script = "window.dispatchEvent(new CustomEvent('knoux:native-media-command',{detail:" + detail + "}));";
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onStop() {
        super.onStop();
        if (!KnouxPlaybackService.isActive() || getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(mediaCommandReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.onDestroy();
    }
}
`;

const plugin = `package ${appId};

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KnouxMediaSession")
public class KnouxMediaSessionPlugin extends Plugin {
    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.resolve(result("entered", false));
            return;
        }
        int width = Math.max(1, call.getInt("width", 16));
        int height = Math.max(1, call.getInt("height", 9));
        double ratio = (double) width / (double) height;
        if (ratio > 2.39) { width = 239; height = 100; }
        if (ratio < (1.0 / 2.39)) { width = 100; height = 239; }
        boolean entered = true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(width, height))
                    .build();
                entered = activity.enterPictureInPictureMode(params);
            } else {
                activity.enterPictureInPictureMode();
            }
        } catch (RuntimeException error) {
            entered = false;
        }
        call.resolve(result("entered", entered));
    }

    @PluginMethod
    public void updatePlayback(PluginCall call) {
        String title = call.getString("title", "KNOUX X");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        double position = Math.max(0.0, call.getDouble("position", 0.0));
        double duration = Math.max(0.0, call.getDouble("duration", 0.0));

        Intent intent = new Intent(getContext(), KnouxPlaybackService.class);
        intent.setAction(KnouxPlaybackService.ACTION_UPDATE);
        intent.putExtra(KnouxPlaybackService.EXTRA_TITLE, title);
        intent.putExtra(KnouxPlaybackService.EXTRA_PLAYING, playing);
        intent.putExtra(KnouxPlaybackService.EXTRA_POSITION, position);
        intent.putExtra(KnouxPlaybackService.EXTRA_DURATION, duration);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
        else getContext().startService(intent);
        call.resolve(result("active", true));
    }

    @PluginMethod
    public void stopPlayback(PluginCall call) {
        getContext().stopService(new Intent(getContext(), KnouxPlaybackService.class));
        call.resolve(result("active", false));
    }

    private JSObject result(String key, boolean value) {
        JSObject result = new JSObject();
        result.put(key, value);
        return result;
    }
}
`;

const service = `package ${appId};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

public class KnouxPlaybackService extends Service {
    public static final String ACTION_UPDATE = "${appId}.media.UPDATE";
    private static final String ACTION_COMMAND = "${appId}.media.COMMAND";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_DURATION = "duration";
    private static final String CHANNEL_ID = "knoux_media_playback";
    private static final int NOTIFICATION_ID = 2408;
    private static volatile boolean active = false;

    private MediaSession mediaSession;
    private String title = "KNOUX X";
    private boolean playing = false;
    private double positionSeconds = 0.0;
    private double durationSeconds = 0.0;

    public static boolean isActive() {
        return active;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        active = true;
        createNotificationChannel();
        mediaSession = new MediaSession(this, "KNOUX X");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { sendCommand("play", null); }
            @Override public void onPause() { sendCommand("pause", null); }
            @Override public void onSkipToNext() { sendCommand("seek-forward", null); }
            @Override public void onSkipToPrevious() { sendCommand("seek-back", null); }
            @Override public void onSeekTo(long pos) { sendCommand("seek", pos / 1000.0); }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_COMMAND.equals(intent.getAction())) {
            sendCommand(intent.getStringExtra(MainActivity.EXTRA_COMMAND), null);
            return START_STICKY;
        }
        if (intent != null && ACTION_UPDATE.equals(intent.getAction())) {
            title = safeTitle(intent.getStringExtra(EXTRA_TITLE));
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
            positionSeconds = Math.max(0.0, intent.getDoubleExtra(EXTRA_POSITION, 0.0));
            durationSeconds = Math.max(0.0, intent.getDoubleExtra(EXTRA_DURATION, 0.0));
        }
        publishSession();
        startForeground(NOTIFICATION_ID, notification());
        return START_STICKY;
    }

    private String safeTitle(String value) {
        if (value == null || value.trim().isEmpty()) return "KNOUX X";
        String normalized = value.trim();
        return normalized.length() > 240 ? normalized.substring(0, 240) : normalized;
    }

    private void publishSession() {
        long durationMs = (long) (durationSeconds * 1000.0);
        long positionMs = (long) (positionSeconds * 1000.0);
        MediaMetadata metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "KNOUX X")
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
            .build();
        mediaSession.setMetadata(metadata);

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO |
            PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        PlaybackState state = new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, positionMs, playing ? 1.0f : 0.0f)
            .build();
        mediaSession.setPlaybackState(state);
    }

    private Notification notification() {
        PendingIntent rewind = commandIntent("seek-back", 31);
        PendingIntent toggle = commandIntent(playing ? "pause" : "play", 32);
        PendingIntent forward = commandIntent("seek-forward", 33);
        Notification.Action rewindAction = new Notification.Action.Builder(android.R.drawable.ic_media_rew, "-10", rewind).build();
        Notification.Action toggleAction = new Notification.Action.Builder(
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pause" : "Play",
            toggle
        ).build();
        Notification.Action forwardAction = new Notification.Action.Builder(android.R.drawable.ic_media_ff, "+10", forward).build();

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(playing ? "Playing in KNOUX X" : "Paused in KNOUX X")
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(rewindAction)
            .addAction(toggleAction)
            .addAction(forwardAction)
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private PendingIntent commandIntent(String command, int requestCode) {
        Intent intent = new Intent(this, KnouxPlaybackService.class);
        intent.setAction(ACTION_COMMAND);
        intent.putExtra(MainActivity.EXTRA_COMMAND, command);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, requestCode, intent, flags);
    }

    private void sendCommand(String command, Double position) {
        if (command == null || command.isEmpty()) return;
        Intent broadcast = new Intent(MainActivity.ACTION_MEDIA_COMMAND);
        broadcast.setPackage(getPackageName());
        broadcast.putExtra(MainActivity.EXTRA_COMMAND, command);
        if (position != null && Double.isFinite(position)) broadcast.putExtra(MainActivity.EXTRA_POSITION, position);
        sendBroadcast(broadcast);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Media playback", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("KNOUX X background media controls");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        active = false;
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
`;

fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivity, 'utf8');
fs.writeFileSync(path.join(javaDir, 'KnouxMediaSessionPlugin.java'), plugin, 'utf8');
fs.writeFileSync(path.join(javaDir, 'KnouxPlaybackService.java'), service, 'utf8');

let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissionMarker = '    <application';
const permissions = [
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
];
for (const permission of permissions) {
  const name = permission.match(/android:name="([^"]+)"/)?.[1];
  if (name && !manifest.includes(name)) manifest = manifest.replace(permissionMarker, `${permission}\n${permissionMarker}`);
}

manifest = manifest.replace(/<activity\b([^>]*android:name="\.MainActivity"[^>]*)>/, (full, attrs) => {
  let next = attrs;
  if (!/android:supportsPictureInPicture=/.test(next)) next += '\n            android:supportsPictureInPicture="true"';
  if (!/android:resizeableActivity=/.test(next)) next += '\n            android:resizeableActivity="true"';
  return `<activity${next}>`;
});

if (!manifest.includes('android:name=".KnouxPlaybackService"')) {
  const serviceNode = `        <service\n            android:name=".KnouxPlaybackService"\n            android:exported="false"\n            android:foregroundServiceType="mediaPlayback" />\n`;
  manifest = manifest.replace('    </application>', `${serviceNode}    </application>`);
}
fs.writeFileSync(manifestPath, manifest, 'utf8');

const required = [
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android:supportsPictureInPicture="true"',
  'android:name=".KnouxPlaybackService"',
  'android:foregroundServiceType="mediaPlayback"',
];
for (const token of required) {
  if (!manifest.includes(token)) throw new Error(`Android native media manifest token missing: ${token}`);
}
for (const file of ['MainActivity.java', 'KnouxMediaSessionPlugin.java', 'KnouxPlaybackService.java']) {
  if (!fs.statSync(path.join(javaDir, file)).size) throw new Error(`Generated native media file is empty: ${file}`);
}
console.log(`[PASS] KNOUX Android native media installed for ${appId}: PiP + MediaSession + foreground playback service.`);
