package dev.knoux.playerx;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.DisplayMetrics;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class KnouxScreenCaptureService extends Service {
    public static final String ACTION_START = "dev.knoux.playerx.screen.START";
    public static final String ACTION_STOP = "dev.knoux.playerx.screen.STOP";
    public static final String ACTION_COMPLETE = "dev.knoux.playerx.screen.COMPLETE";
    public static final String ACTION_STARTED = "dev.knoux.playerx.screen.STARTED";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_WIDTH = "width";
    public static final String EXTRA_HEIGHT = "height";
    public static final String EXTRA_FPS = "fps";
    public static final String EXTRA_BITRATE = "bitrate";
    public static final String EXTRA_MIC = "microphone";
    public static final String EXTRA_OUTPUT_URI = "outputUri";
    public static final String EXTRA_ERROR = "error";
    private static final String CHANNEL_ID = "knoux_screen_capture";
    private static final int NOTIFICATION_ID = 2412;
    private static volatile boolean active = false;
    private static volatile String lastOutputUri = null;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private MediaRecorder recorder;
    private ParcelFileDescriptor outputDescriptor;
    private Uri outputUri;
    private boolean finishing;
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override public void onStop() { if (!finishing) finishRecording(null); }
    };

    public static boolean isActive() { return active; }
    public static String getLastOutputUri() { return lastOutputUri; }

    @Override public void onCreate() { super.onCreate(); createChannel(); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) { finishRecording(null); return START_NOT_STICKY; }
        if (!ACTION_START.equals(intent.getAction()) || active) return START_STICKY;
        finishing = false;
        try { startProjectionForeground(); startRecording(intent); }
        catch (Exception error) { finishRecording(error.getMessage() == null ? "Android screen recording failed." : error.getMessage()); }
        return START_STICKY;
    }

    private void startProjectionForeground() {
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private Notification notification() {
        Intent stop = new Intent(this, KnouxScreenCaptureService.class).setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopIntent = PendingIntent.getService(this, 71, stop, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        return builder.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("KNOUX X Screen Recording").setContentText("Recording your screen locally").setOngoing(true).addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Stop", stopIntent).build()).build();
    }

    private void startRecording(Intent request) throws Exception {
        Intent projectionData = request.getParcelableExtra(EXTRA_RESULT_DATA);
        int resultCode = request.getIntExtra(EXTRA_RESULT_CODE, 0);
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null || projectionData == null) throw new IllegalStateException("MediaProjection permission data is unavailable.");
        projection = manager.getMediaProjection(resultCode, projectionData);
        if (projection == null) throw new IllegalStateException("MediaProjection could not be created.");
        projection.registerCallback(projectionCallback, new android.os.Handler(android.os.Looper.getMainLooper()));

        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int requestedWidth = request.getIntExtra(EXTRA_WIDTH, 0);
        int requestedHeight = request.getIntExtra(EXTRA_HEIGHT, 0);
        int width = requestedWidth > 0 ? requestedWidth : metrics.widthPixels;
        int height = requestedHeight > 0 ? requestedHeight : metrics.heightPixels;
        if ((width & 1) == 1) width -= 1;
        if ((height & 1) == 1) height -= 1;
        int fps = request.getIntExtra(EXTRA_FPS, 30);
        int bitrate = request.getIntExtra(EXTRA_BITRATE, 12_000_000);
        boolean microphone = request.getBooleanExtra(EXTRA_MIC, false) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;

        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, "KNOUX-screen-" + stamp + ".mp4");
        values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { values.put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/KNOUX X"); values.put(MediaStore.Video.Media.IS_PENDING, 1); }
        outputUri = getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        if (outputUri == null) throw new IllegalStateException("Could not create the recording output document.");
        outputDescriptor = getContentResolver().openFileDescriptor(outputUri, "w");
        if (outputDescriptor == null) throw new IllegalStateException("Could not open the recording output document.");

        recorder = new MediaRecorder();
        if (microphone) recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        recorder.setVideoSize(width, height);
        recorder.setVideoFrameRate(fps);
        recorder.setVideoEncodingBitRate(bitrate);
        if (microphone) { recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); recorder.setAudioSamplingRate(48_000); recorder.setAudioEncodingBitRate(192_000); }
        recorder.setOutputFile(outputDescriptor.getFileDescriptor());
        recorder.prepare();

        virtualDisplay = projection.createVirtualDisplay("KNOUX-X-Screen", width, height, metrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder.getSurface(), null, null);
        recorder.start();
        active = true;
        sendBroadcast(new Intent(ACTION_STARTED).setPackage(getPackageName()));
    }

    private void finishRecording(String failure) {
        if (finishing) return;
        finishing = true;
        String error = failure;
        try { if (recorder != null) recorder.stop(); } catch (Exception stopError) { if (error == null) error = "Recording stopped before a valid MP4 was produced."; }
        try { if (recorder != null) recorder.release(); } catch (Exception ignored) {}
        try { if (virtualDisplay != null) virtualDisplay.release(); } catch (Exception ignored) {}
        try { if (projection != null) { projection.unregisterCallback(projectionCallback); projection.stop(); } } catch (Exception ignored) {}
        try { if (outputDescriptor != null) outputDescriptor.close(); } catch (Exception ignored) {}
        if (error == null && outputUri != null) {
            android.media.MediaMetadataRetriever probe = new android.media.MediaMetadataRetriever();
            try {
                probe.setDataSource(this, outputUri);
                long duration = Long.parseLong(probe.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION));
                int width = Integer.parseInt(probe.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
                if (duration <= 0 || width <= 0) throw new IllegalStateException();
            } catch (Exception invalid) { error = "Recording output has no valid video duration. It was not published as a saved MP4."; }
            finally { try { probe.release(); } catch (Exception ignored) {} }
        } else if (error == null) error = "Recording output is unavailable.";
        if (error == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && outputUri != null) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.Video.Media.IS_PENDING, 0);
            try { getContentResolver().update(outputUri, done, null, null); } catch (Exception publishError) { error = "The MP4 could not be published to the media library."; }
        }
        if (error == null && outputUri != null) {
            lastOutputUri = outputUri.toString();
            getSharedPreferences("knoux-capture", MODE_PRIVATE).edit().putString("lastOutputUri", lastOutputUri).apply();
        }
        active = false;
        Intent complete = new Intent(ACTION_COMPLETE).setPackage(getPackageName());
        if (error == null && outputUri != null) complete.putExtra(EXTRA_OUTPUT_URI, outputUri.toString());
        if (error != null) complete.putExtra(EXTRA_ERROR, error);
        sendBroadcast(complete);
        recorder = null; virtualDisplay = null; projection = null; outputDescriptor = null; outputUri = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Screen recording", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("KNOUX X local MediaProjection recording");
        manager.createNotificationChannel(channel);
    }

    @Override public void onDestroy() { if (active) finishRecording("Screen recording service was interrupted."); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
