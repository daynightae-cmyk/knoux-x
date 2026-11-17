package dev.knoux.playerx;

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
    public static final String ACTION_MEDIA_COMMAND = "dev.knoux.playerx.MEDIA_COMMAND";
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
        registerPlugin(KnouxVaultPlugin.class);
        registerPlugin(KnouxScreenCapturePlugin.class);
        registerPlugin(KnouxSafPlugin.class);
        super.onCreate(savedInstanceState);
        logLifecycle("create");
        getBridge().addWebViewListener(new com.getcapacitor.WebViewListener() {
            @Override public void onPageStarted(WebView view) { logLifecycle("page-started"); }
            @Override public void onPageLoaded(WebView view) { logLifecycle("page-loaded"); }
            @Override public void onReceivedError(WebView view) { logLifecycle("page-error"); }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                android.util.Log.e("KnouxLifecycle", "renderer-gone crashed=" + detail.didCrash() + " priority=" + detail.rendererPriorityAtExit());
                // Observation only. Preserve Capacitor's unhandled failure behavior.
                return false;
            }
        });
        IntentFilter filter = new IntentFilter(ACTION_MEDIA_COMMAND);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaCommandReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaCommandReceiver, filter);
        }
    }

    private void logLifecycle(String phase) {
        android.util.Log.i("KnouxLifecycle", "phase=" + phase + " pid=" + android.os.Process.myPid() + " elapsedMs=" + android.os.SystemClock.elapsedRealtime());
    }

    @Override public void onResume() { super.onResume(); logLifecycle("resume"); }
    @Override public void onPause() { logLifecycle("pause"); super.onPause(); }
    @Override public void onTrimMemory(int level) { android.util.Log.w("KnouxLifecycle", "trim-memory level=" + level); super.onTrimMemory(level); }
    @Override public void onLowMemory() { logLifecycle("low-memory"); super.onLowMemory(); }

    private void dispatchMediaCommand(String command, Double position) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String detail = "{\"command\":" + JSONObject.quote(command);
        if (position != null && Double.isFinite(position)) detail += ",\"position\":" + position;
        detail += "}";
        String script = "window.dispatchEvent(new CustomEvent('knoux:native-media-command',{detail:" + detail + "}));";
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onStop() {
        logLifecycle("stop");
        super.onStop();
        if (!KnouxPlaybackService.isActive() || getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    public void onDestroy() {
        logLifecycle("destroy");
        try {
            unregisterReceiver(mediaCommandReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.onDestroy();
    }
}
