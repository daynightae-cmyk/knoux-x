package dev.knoux.playerx;

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
    public static final String ACTION_UPDATE = "dev.knoux.playerx.media.UPDATE";
    private static final String ACTION_COMMAND = "dev.knoux.playerx.media.COMMAND";
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
