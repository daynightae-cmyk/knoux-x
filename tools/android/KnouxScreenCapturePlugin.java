package dev.knoux.playerx;

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
