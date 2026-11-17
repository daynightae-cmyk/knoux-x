package dev.knoux.playerx;

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
