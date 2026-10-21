const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const appId = String(config.appId || '').trim();
if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(appId)) throw new Error(`Invalid Capacitor appId: ${appId}`);

const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', ...appId.split('.'));
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const mainActivityPath = path.join(javaDir, 'MainActivity.java');
if (!fs.existsSync(manifestPath) || !fs.existsSync(mainActivityPath)) {
  throw new Error('Run Capacitor sync and prepare-android-native-media.cjs before functional closure generation.');
}

let safPlugin = `package ${appId};

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "KnouxSaf")
public class KnouxSafPlugin extends Plugin {
    @PluginMethod
    public void pick(PluginCall call) {
        String mode = call.getString("mode", "file");
        Intent intent;
        if ("directory".equals(mode)) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        } else if ("save".equals(mode)) {
            intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(resolveMime(call));
            String suggested = call.getString("suggestedName", "KNOUX-export.bin");
            intent.putExtra(Intent.EXTRA_TITLE, suggested);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(resolveMime(call));
            String[] types = mimeArray(call);
            if (types.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
            if ("files".equals(mode)) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        }
        startActivityForResult(call, intent, "pickCallback");
    }

    private String resolveMime(PluginCall call) {
        String[] values = mimeArray(call);
        if (values.length == 1) return values[0];
        if (values.length > 1) {
            String prefix = values[0].split("/")[0];
            boolean same = true;
            for (String value : values) if (!value.startsWith(prefix + "/")) same = false;
            if (same) return prefix + "/*";
        }
        return "*/*";
    }

    private String[] mimeArray(PluginCall call) {
        JSArray array = call.getArray("mimeTypes");
        if (array == null || array.length() == 0) return new String[]{"*/*"};
        List<String> result = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            try {
                Object value = array.get(index);
                if (value instanceof String && !((String) value).trim().isEmpty()) result.add((String) value);
            } catch (Exception ignored) {}
        }
        return result.isEmpty() ? new String[]{"*/*"} : result.toArray(new String[0]);
    }

    @ActivityCallback
    private void pickCallback(PluginCall call, ActivityResult result) {
        android.util.Log.i("KnouxSafLifecycle", "picker-result code=" + result.getResultCode() + " pid=" + android.os.Process.myPid());
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("items", new JSArray()));
            return;
        }
        Intent data = result.getData();
        JSArray items = new JSArray();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int index = 0; index < clip.getItemCount(); index++) addUri(items, clip.getItemAt(index).getUri(), data.getFlags());
        } else if (data.getData() != null) {
            addUri(items, data.getData(), data.getFlags());
        }
        android.util.Log.i("KnouxSafLifecycle", "picker-resolved count=" + items.length());
        call.resolve(new JSObject().put("items", items));
    }

    private void addUri(JSArray items, Uri uri, int sourceFlags) {
        if (uri == null) return;
        persist(uri, sourceFlags);
        items.put(describe(uri));
    }

    private void persist(Uri uri, int sourceFlags) {
        int flags = sourceFlags & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) flags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (SecurityException ignored) {
            try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception ignoredAgain) {}
        }
    }

    private JSObject describe(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        String name = uri.getLastPathSegment() == null ? "Android document" : uri.getLastPathSegment();
        long size = 0L;
        String mime = resolver.getType(uri);
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex);
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex);
            }
        } catch (Exception ignored) {}
        if (DocumentsContract.isTreeUri(uri)) mime = "vnd.android.document/directory";
        if (mime == null) mime = "application/octet-stream";
        return new JSObject().put("uri", uri.toString()).put("name", name).put("mime", mime).put("size", size);
    }

    @PluginMethod
    public void readBytes(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Unable to open Android document for reading.");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            call.resolve(new JSObject().put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)));
        } catch (Exception error) { call.reject("Could not read the selected Android document.", error); }
    }

    @PluginMethod
    public void writeBytes(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        String encoded = call.getString("base64", "");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IllegalStateException("Unable to open Android document for writing.");
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            output.write(bytes);
            output.flush();
            call.resolve(new JSObject().put("written", bytes.length));
        } catch (Exception error) { call.reject("Could not write the Android document.", error); }
    }

    @PluginMethod
    public void exists(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        boolean exists = false;
        try (InputStream ignored = getContext().getContentResolver().openInputStream(uri)) { exists = ignored != null; }
        catch (Exception ignored) {}
        call.resolve(new JSObject().put("exists", exists));
    }

    @PluginMethod
    public void delete(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        boolean deleted = false;
        try { deleted = DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); }
        catch (Exception ignored) {}
        call.resolve(new JSObject().put("deleted", deleted));
    }

    @PluginMethod
    public void stat(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        call.resolve(describe(uri));
    }

    @PluginMethod
    public void metadata(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri", ""));
        JSObject output = describe(uri);
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            putLong(output, "duration", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION), 0.001);
            putLong(output, "width", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH), 1.0);
            putLong(output, "height", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT), 1.0);
            putLong(output, "rotation", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION), 1.0);
            putLong(output, "bitrate", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE), 1.0);
            if (android.os.Build.VERSION.SDK_INT >= 23) {
                String fps = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE);
                if (fps != null) try { output.put("frameRate", Double.parseDouble(fps)); } catch (NumberFormatException ignored) {}
            }
        } catch (Exception ignored) {
        } finally { try { retriever.release(); } catch (Exception ignored) {} }
        call.resolve(output);
    }

    private void putLong(JSObject output, String key, String value, double multiplier) {
        if (value == null) return;
        try { output.put(key, Double.parseDouble(value) * multiplier); } catch (NumberFormatException ignored) {}
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        Uri tree = Uri.parse(call.getString("uri", ""));
        JSArray items = new JSArray();
        try {
            String documentId = DocumentsContract.getTreeDocumentId(tree);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId);
            String[] projection = new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE};
            try (Cursor cursor = getContext().getContentResolver().query(children, projection, null, null, null)) {
                if (cursor != null) while (cursor.moveToNext()) {
                    String childId = cursor.getString(0);
                    Uri child = DocumentsContract.buildDocumentUriUsingTree(tree, childId);
                    String name = cursor.getString(1);
                    String mime = cursor.getString(2);
                    long size = cursor.isNull(3) ? 0 : cursor.getLong(3);
                    items.put(new JSObject().put("uri", child.toString()).put("name", name).put("mime", mime).put("size", size));
                }
            }
        } catch (Exception ignored) {}
        call.resolve(new JSObject().put("items", items));
    }
}
`;

const projectionPlugin = `package ${appId};

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KnouxScreenCapture")
public class KnouxScreenCapturePlugin extends Plugin {
    private PluginCall pendingStart;
    private PluginCall pendingStop;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final BroadcastReceiver completionReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (KnouxScreenCaptureService.ACTION_STARTED.equals(intent.getAction())) {
                if (pendingStart != null) { PluginCall call = pendingStart; pendingStart = null; call.resolve(new JSObject().put("recording", true)); }
                return;
            }
            if (!KnouxScreenCaptureService.ACTION_COMPLETE.equals(intent.getAction())) return;
            String output = intent.getStringExtra(KnouxScreenCaptureService.EXTRA_OUTPUT_URI);
            String error = intent.getStringExtra(KnouxScreenCaptureService.EXTRA_ERROR);
            PluginCall call = pendingStop != null ? pendingStop : pendingStart;
            pendingStart = null;
            pendingStop = null;
            if (call == null) return;
            call.setKeepAlive(false);
            if (error != null && !error.isEmpty()) call.reject(error);
            else call.resolve(new JSObject().put("recording", false).put("outputUri", output));
        }
    };

    @Override public void load() {
        super.load();
        IntentFilter filter = new IntentFilter(KnouxScreenCaptureService.ACTION_COMPLETE);
        filter.addAction(KnouxScreenCaptureService.ACTION_STARTED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) getContext().registerReceiver(completionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(completionReceiver, filter);
    }

    @Override protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(completionReceiver); } catch (Exception ignored) {}
        handler.removeCallbacksAndMessages(null);
        if (pendingStart != null) pendingStart.reject("Recording activity was destroyed; check recording status after reopening.");
        if (pendingStop != null) pendingStop.reject("Recording activity was destroyed; check saved recording after reopening.");
        pendingStart = null; pendingStop = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startScreenRecording(PluginCall call) {
        if (pendingStart != null || KnouxScreenCaptureService.isActive()) { call.reject("A screen recording is already starting or active."); return; }
        if (Boolean.TRUE.equals(call.getBoolean("microphone", false)) && getContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            call.reject("Microphone permission is not granted. Turn microphone off or grant it in Android settings."); return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("Android screen recording requires Android 5.0 or newer.");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) { call.reject("Android MediaProjection is unavailable."); return; }
        pendingStart = call;
        startActivityForResult(call, manager.createScreenCaptureIntent(), "projectionPermissionCallback");
    }

    @ActivityCallback
    private void projectionPermissionCallback(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            pendingStart = null;
            call.reject("Screen recording permission was not granted.");
            return;
        }
        Intent service = new Intent(getContext(), KnouxScreenCaptureService.class);
        service.setAction(KnouxScreenCaptureService.ACTION_START);
        service.putExtra(KnouxScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        service.putExtra(KnouxScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
        service.putExtra(KnouxScreenCaptureService.EXTRA_WIDTH, call.getInt("width", 0));
        service.putExtra(KnouxScreenCaptureService.EXTRA_HEIGHT, call.getInt("height", 0));
        service.putExtra(KnouxScreenCaptureService.EXTRA_FPS, Math.max(15, Math.min(60, call.getInt("fps", 30))));
        service.putExtra(KnouxScreenCaptureService.EXTRA_BITRATE, Math.max(2_000_000, Math.min(50_000_000, call.getInt("bitrate", 12_000_000))));
        service.putExtra(KnouxScreenCaptureService.EXTRA_MIC, Boolean.TRUE.equals(call.getBoolean("microphone", false)));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(service);
            else getContext().startService(service);
            handler.postDelayed(() -> {
                if (pendingStart == call) { pendingStart = null; call.reject("Screen encoder did not confirm startup within 15 seconds. Check recording status before retrying."); }
            }, 15000);
        } catch (Exception error) { pendingStart = null; call.reject("Screen recording service could not start: " + error.getMessage()); }
    }

    @PluginMethod
    public void stopScreenRecording(PluginCall call) {
        if (!KnouxScreenCaptureService.isActive()) {
            call.resolve(new JSObject().put("recording", false).put("outputUri", savedOutput()));
            return;
        }
        pendingStop = call;
        call.setKeepAlive(true);
        Intent service = new Intent(getContext(), KnouxScreenCaptureService.class);
        service.setAction(KnouxScreenCaptureService.ACTION_STOP);
        getContext().startService(service);
        handler.postDelayed(() -> {
            if (pendingStop == call) { pendingStop = null; call.setKeepAlive(false); call.reject("MP4 finalization timed out. Check saved recording status."); }
        }, 15000);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject().put("recording", KnouxScreenCaptureService.isActive()).put("outputUri", savedOutput()));
    }
    private String savedOutput() { return getContext().getSharedPreferences("knoux-capture", Context.MODE_PRIVATE).getString("lastOutputUri", null); }
}
`;

const projectionService = `package ${appId};

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
    public static final String ACTION_START = "${appId}.screen.START";
    public static final String ACTION_STOP = "${appId}.screen.STOP";
    public static final String ACTION_COMPLETE = "${appId}.screen.COMPLETE";
    public static final String ACTION_STARTED = "${appId}.screen.STARTED";
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
`;

// Extend the existing document bridge; discovery and SAF use the same resolver.
const mediaStoreMembers = fs.readFileSync(path.join(__dirname, 'android', 'mediastore-members.java'), 'utf8');
safPlugin = safPlugin.replace('@CapacitorPlugin(name = "KnouxSaf")', `@CapacitorPlugin(name = "KnouxSaf", permissions = {
    @com.getcapacitor.annotation.Permission(alias = "storage", strings = {"android.permission.READ_EXTERNAL_STORAGE"}),
    @com.getcapacitor.annotation.Permission(alias = "videos", strings = {"android.permission.READ_MEDIA_VIDEO"}),
    @com.getcapacitor.annotation.Permission(alias = "photos", strings = {"android.permission.READ_MEDIA_IMAGES"}),
    @com.getcapacitor.annotation.Permission(alias = "audio", strings = {"android.permission.READ_MEDIA_AUDIO"}),
    @com.getcapacitor.annotation.Permission(alias = "selected", strings = {"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})`).replace('public class KnouxSafPlugin extends Plugin {', `public class KnouxSafPlugin extends Plugin {\n${mediaStoreMembers}`);

fs.mkdirSync(javaDir, { recursive: true });
fs.writeFileSync(path.join(javaDir, 'KnouxSafPlugin.java'), safPlugin, 'utf8');
fs.writeFileSync(path.join(javaDir, 'KnouxScreenCapturePlugin.java'), projectionPlugin, 'utf8');
fs.writeFileSync(path.join(javaDir, 'KnouxScreenCaptureService.java'), projectionService, 'utf8');

// The private vault is a separate plugin: it owns the Keystore key, the PIN
// wrapping and the encrypted media, and it must not share a surface with the
// document bridge.
const vaultTemplate = fs.readFileSync(path.join(__dirname, 'android', 'knoux-vault-plugin.java'), 'utf8');
fs.writeFileSync(path.join(javaDir, 'KnouxVaultPlugin.java'), vaultTemplate.replace(/APP_PACKAGE/g, appId), 'utf8');

const resXmlDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml');
fs.mkdirSync(resXmlDir, { recursive: true });
fs.writeFileSync(path.join(resXmlDir, 'knoux_vault_paths.xml'), `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="knoux-vault" path="vault-play/" />
</paths>
`, 'utf8');

// The vault serves its decrypted playback copy through the scoped
// FileProvider, so the support library has to be on the compile classpath.
const buildGradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(buildGradlePath)) {
  let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
  if (!buildGradle.includes("androidx.core:core:")) {
    buildGradle = buildGradle.replace(
      /dependencies\s*\{/,
      (match) => `${match}\n    implementation 'androidx.core:core:1.13.1'`,
    );
    fs.writeFileSync(buildGradlePath, buildGradle, 'utf8');
  }
}

let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
for (const pluginName of ['KnouxSafPlugin', 'KnouxScreenCapturePlugin', 'KnouxVaultPlugin']) {
  const registration = `        registerPlugin(${pluginName}.class);`;
  if (!mainActivity.includes(registration)) mainActivity = mainActivity.replace('        registerPlugin(KnouxMediaSessionPlugin.class);', `        registerPlugin(KnouxMediaSessionPlugin.class);\n${registration}`);
}
fs.writeFileSync(mainActivityPath, mainActivity, 'utf8');

let manifest = fs.readFileSync(manifestPath, 'utf8');
const marker = '    <application';
for (const permission of [
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
]) {
  if (!manifest.includes(permission)) manifest = manifest.replace(marker, `    <uses-permission android:name="${permission}" />\n${marker}`);
}
if (!manifest.includes('android.permission.READ_EXTERNAL_STORAGE')) {
  manifest = manifest.replace(marker, `    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n${marker}`);
}
if (!manifest.includes('android:name=".KnouxScreenCaptureService"')) {
  const service = `        <service\n            android:name=".KnouxScreenCaptureService"\n            android:exported="false"\n            android:foregroundServiceType="mediaProjection" />\n`;
  manifest = manifest.replace('    </application>', `${service}    </application>`);
}
if (!manifest.includes('.vaultprovider')) {
  const provider = `        <provider\n            android:name="androidx.core.content.FileProvider"\n            android:authorities="\${applicationId}.vaultprovider"\n            android:exported="false"\n            android:grantUriPermissions="true">\n            <meta-data\n                android:name="android.support.FILE_PROVIDER_PATHS"\n                android:resource="@xml/knoux_vault_paths" />\n        </provider>\n`;
  manifest = manifest.replace('    </application>', `${provider}    </application>`);
}
fs.writeFileSync(manifestPath, manifest, 'utf8');

const checks = [
  ['MainActivity.java', 'registerPlugin(KnouxSafPlugin.class)'],
  ['MainActivity.java', 'registerPlugin(KnouxScreenCapturePlugin.class)'],
  ['MainActivity.java', 'registerPlugin(KnouxVaultPlugin.class)'],
  ['KnouxSafPlugin.java', '@CapacitorPlugin(name = "KnouxSaf", permissions = {'],
  ['KnouxScreenCapturePlugin.java', '@CapacitorPlugin(name = "KnouxScreenCapture")'],
  ['KnouxScreenCaptureService.java', 'MediaProjection'],
  ['KnouxVaultPlugin.java', '@CapacitorPlugin(name = "KnouxVault")'],
  ['KnouxVaultPlugin.java', 'AndroidKeyStore'],
  ['KnouxVaultPlugin.java', 'AES/GCM/NoPadding'],
  ['KnouxVaultPlugin.java', 'PBKDF2withHmacSHA256'],
  ['KnouxVaultPlugin.java', 'PBKDF2withHmacSHA1'],
];
for (const [file, token] of checks) {
  const source = fs.readFileSync(path.join(javaDir, file), 'utf8');
  if (!source.includes(token)) throw new Error(`Android functional closure token missing in ${file}: ${token}`);
}
if (!manifest.includes('android:foregroundServiceType="mediaProjection"')) throw new Error('MediaProjection service declaration missing.');
if (!manifest.includes('.vaultprovider')) throw new Error('The vault playback provider declaration is missing.');
console.log(`[PASS] KNOUX Android functional closure installed for ${appId}: persisted SAF + native MediaProjection + encrypted vault.`);
