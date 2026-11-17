package dev.knoux.playerx;

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
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "KnouxSaf", permissions = {
    @com.getcapacitor.annotation.Permission(alias = "storage", strings = {"android.permission.READ_EXTERNAL_STORAGE"}),
    @com.getcapacitor.annotation.Permission(alias = "videos", strings = {"android.permission.READ_MEDIA_VIDEO"}),
    @com.getcapacitor.annotation.Permission(alias = "photos", strings = {"android.permission.READ_MEDIA_IMAGES"}),
    @com.getcapacitor.annotation.Permission(alias = "audio", strings = {"android.permission.READ_MEDIA_AUDIO"}),
    @com.getcapacitor.annotation.Permission(alias = "selected", strings = {"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"})
})
public class KnouxSafPlugin extends Plugin {
    // Generated into KnouxSafPlugin. No paths or write permissions are required.
    private final java.util.concurrent.ThreadPoolExecutor mediaWorkers = new java.util.concurrent.ThreadPoolExecutor(
        2, 2, 30L, java.util.concurrent.TimeUnit.SECONDS,
        new java.util.concurrent.ArrayBlockingQueue<Runnable>(32));
    private final java.util.concurrent.ConcurrentHashMap<String, android.os.CancellationSignal> mediaSignals = new java.util.concurrent.ConcurrentHashMap<>();
    private final android.os.Handler mediaHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable mediaChanged = () -> notifyListeners("mediaStoreChanged", new JSObject());
    private android.database.ContentObserver mediaObserver;

    private String mediaKind(PluginCall call) {
        String kind = call.getString("kind", "videos");
        if (!"videos".equals(kind) && !"photos".equals(kind) && !"audio".equals(kind)) throw new IllegalArgumentException("Invalid media kind");
        return kind;
    }

    private boolean mediaGranted(String permission) {
        return androidx.core.content.ContextCompat.checkSelfPermission(getContext(), permission) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private String mediaAccess(String kind) {
        int sdk = android.os.Build.VERSION.SDK_INT;
        if (sdk < 33) return mediaGranted("android.permission.READ_EXTERNAL_STORAGE") ? "full" : "denied";
        String permission = "audio".equals(kind) ? "android.permission.READ_MEDIA_AUDIO" : "photos".equals(kind) ? "android.permission.READ_MEDIA_IMAGES" : "android.permission.READ_MEDIA_VIDEO";
        if (mediaGranted(permission)) return "full";
        if (sdk >= 34 && !"audio".equals(kind) && mediaGranted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")) return "limited";
        return "denied";
    }

    @PluginMethod public void mediaPermissions(PluginCall call) {
        call.resolve(new JSObject().put("videos", mediaAccess("videos")).put("photos", mediaAccess("photos")).put("audio", mediaAccess("audio")));
    }

    @PluginMethod public void requestMediaAccess(PluginCall call) {
        try {
            String kind = mediaKind(call);
            String[] aliases = android.os.Build.VERSION.SDK_INT < 33 ? new String[]{"storage"}
                : android.os.Build.VERSION.SDK_INT >= 34 && !"audio".equals(kind) ? new String[]{kind, "selected"} : new String[]{kind};
            requestPermissionForAliases(aliases, call, "mediaPermissionResult");
        } catch (Exception error) { call.reject("Cannot request media access", error); }
    }

    @com.getcapacitor.annotation.PermissionCallback private void mediaPermissionResult(PluginCall call) {
        mediaPermissions(call);
    }

    @PluginMethod public void mediaSettings(PluginCall call) {
        getActivity().startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    private Uri mediaCollection(String kind) {
        if ("photos".equals(kind)) return android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        if ("audio".equals(kind)) return android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        return android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
    }

    private void mediaTask(PluginCall call, java.util.function.Consumer<android.os.CancellationSignal> task) {
        String id = call.getString("requestId", java.util.UUID.randomUUID().toString());
        android.os.CancellationSignal signal = new android.os.CancellationSignal();
        mediaSignals.put(id, signal);
        try {
            mediaWorkers.execute(() -> {
                try { signal.throwIfCanceled(); task.accept(signal); }
                catch (Exception error) { call.reject("Media access failed. Refresh access or retry.", error); }
                finally { mediaSignals.remove(id, signal); }
            });
        } catch (java.util.concurrent.RejectedExecutionException error) {
            mediaSignals.remove(id, signal);
            call.reject("Media workers are busy. Retry shortly.");
        }
    }

    @PluginMethod public void cancelMediaRequest(PluginCall call) {
        android.os.CancellationSignal signal = mediaSignals.get(call.getString("requestId", ""));
        if (signal != null) signal.cancel();
        call.resolve();
    }

    /* Device collections are real MediaStore filters, never a client side
     * guess. On API 29+ the relative path is authoritative; older releases fall
     * back to the bucket display name, which the media provider still exposes
     * for the video and image tables. */
    private String mediaCollectionFilter(String kind, String collection) {
        if (collection == null || collection.isEmpty() || "media".equals(collection)) return null;
        boolean api29 = android.os.Build.VERSION.SDK_INT >= 29;
        if (!api29 && "audio".equals(kind)) throw new IllegalArgumentException("Media collections need a device folder index");
        if ("downloads".equals(collection)) {
            return api29 ? "relative_path LIKE 'Download/%'" : "bucket_display_name IN ('Download','Downloads')";
        }
        if ("camera".equals(collection)) {
            return api29 ? "(relative_path LIKE 'DCIM/Camera%' OR relative_path LIKE 'Camera/%')" : "bucket_display_name IN ('Camera')";
        }
        if ("screen".equals(collection)) {
            return api29
                ? "(relative_path LIKE 'Movies/KNOUX X%' OR relative_path LIKE 'Movies/Screen recordings%' OR relative_path LIKE 'ScreenRecordings/%')"
                : "bucket_display_name IN ('KNOUX X','Screen recordings','Screen Recordings')";
        }
        throw new IllegalArgumentException("Invalid media collection");
    }

    @PluginMethod public void queryMedia(PluginCall call) {
        mediaTask(call, signal -> {
            String kind = mediaKind(call);
            String access = mediaAccess(kind);
            if ("denied".equals(access)) {
                call.resolve(new JSObject().put("items", new JSArray()).put("access", access).put("hasMore", false));
                return;
            }
            int limit = Math.max(1, Math.min(100, call.getInt("limit", 60)));
            String after = call.getString("after", "");
            if (!after.isEmpty() && !after.matches("[0-9]{1,19}")) throw new IllegalArgumentException("Invalid cursor");
            java.util.List<String> columns = new java.util.ArrayList<>(java.util.Arrays.asList("_id", "_display_name", "mime_type", "_size", "date_added", "date_modified"));
            if (!"photos".equals(kind)) columns.add("duration");
            if (!"audio".equals(kind)) { columns.add("width"); columns.add("height"); }
            if (!"audio".equals(kind)) { columns.add("bucket_display_name"); columns.add("bucket_id"); }
            if (android.os.Build.VERSION.SDK_INT >= 29) columns.add("relative_path");
            String selection = android.os.Build.VERSION.SDK_INT >= 29 ? "is_pending=0" : "1=1";
            if (android.os.Build.VERSION.SDK_INT >= 30) selection += " AND is_trashed=0";
            java.util.List<String> selectionArgs = new java.util.ArrayList<>();
            String collectionFilter = mediaCollectionFilter(kind, call.getString("collection", "media"));
            if (collectionFilter != null) selection += " AND " + collectionFilter;
            String bucket = call.getString("bucket", "");
            if (!bucket.isEmpty()) {
                selection += android.os.Build.VERSION.SDK_INT >= 29 ? " AND relative_path = ?" : " AND bucket_display_name = ?";
                selectionArgs.add(bucket);
            }
            if (!after.isEmpty()) { selection += " AND _id < ?"; selectionArgs.add(after); }
            String[] args = selectionArgs.isEmpty() ? null : selectionArgs.toArray(new String[0]);
            Uri collection = mediaCollection(kind);
            Cursor result;
            ContentResolver resolver = getContext().getContentResolver();
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                android.os.Bundle query = new android.os.Bundle();
                query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection);
                query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
                query.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "_id DESC");
                query.putInt(ContentResolver.QUERY_ARG_LIMIT, limit + 1);
                result = resolver.query(collection, columns.toArray(new String[0]), query, signal);
            } else result = resolver.query(collection, columns.toArray(new String[0]), selection, args, "_id DESC LIMIT " + (limit + 1), signal);
            JSArray items = new JSArray();
            String next = "";
            boolean more = false;
            try (Cursor cursor = result) {
                if (cursor == null) throw new IllegalStateException("Media provider returned no cursor");
                while (cursor.moveToNext()) {
                    signal.throwIfCanceled();
                    if (items.length() == limit) { more = true; break; }
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow("_id"));
                    next = Long.toString(id);
                    JSObject item = new JSObject().put("uri", android.content.ContentUris.withAppendedId(collection, id).toString()).put("kind", kind);
                    for (String column : columns) {
                        int index = cursor.getColumnIndex(column);
                        if (index < 0 || cursor.isNull(index)) continue;
                        String key = "_display_name".equals(column) ? "name" : "mime_type".equals(column) ? "mime" : "_size".equals(column) ? "size" : column;
                        if (cursor.getType(index) == Cursor.FIELD_TYPE_INTEGER) item.put(key, cursor.getLong(index));
                        else item.put(key, cursor.getString(index));
                    }
                    if (!"photos".equals(kind)) item.put("duration", item.optDouble("duration", 0) / 1000.0);
                    items.put(item);
                }
            }
            signal.throwIfCanceled();
            call.resolve(new JSObject().put("items", items).put("access", mediaAccess(kind)).put("after", next).put("hasMore", more));
        });
    }

    /* A real folder index of the device library: every MediaStore row is
     * reduced to its device folder and counted. The scan is bounded, and the
     * relative path is preferred because it is the authoritative folder on
     * API 29+. */
    @PluginMethod public void mediaFolders(PluginCall call) {
        mediaTask(call, signal -> {
            String kind = mediaKind(call);
            String access = mediaAccess(kind);
            if ("denied".equals(access)) {
                call.resolve(new JSObject().put("folders", new JSArray()).put("access", access));
                return;
            }
            boolean api29 = android.os.Build.VERSION.SDK_INT >= 29;
            java.util.List<String> columns = new java.util.ArrayList<>();
            if (!"audio".equals(kind)) columns.add("bucket_display_name");
            if (api29) columns.add("relative_path");
            JSArray folders = new JSArray();
            if (columns.isEmpty()) { call.resolve(new JSObject().put("folders", folders).put("access", access)); return; }
            String selection = api29 ? "is_pending=0" : "1=1";
            if (android.os.Build.VERSION.SDK_INT >= 30) selection += " AND is_trashed=0";
            Cursor result;
            ContentResolver resolver = getContext().getContentResolver();
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                android.os.Bundle query = new android.os.Bundle();
                query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection);
                query.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "_id DESC");
                query.putInt(ContentResolver.QUERY_ARG_LIMIT, 5000);
                result = resolver.query(mediaCollection(kind), columns.toArray(new String[0]), query, signal);
            } else result = resolver.query(mediaCollection(kind), columns.toArray(new String[0]), selection, null, "_id DESC LIMIT 5000", signal);
            java.util.Map<String, Integer> counts = new java.util.LinkedHashMap<>();
            java.util.Map<String, String> names = new java.util.HashMap<>();
            try (Cursor cursor = result) {
                if (cursor == null) throw new IllegalStateException("Media provider returned no cursor");
                int pathIndex = cursor.getColumnIndex("relative_path");
                int bucketIndex = cursor.getColumnIndex("bucket_display_name");
                while (cursor.moveToNext()) {
                    signal.throwIfCanceled();
                    String path = pathIndex >= 0 && !cursor.isNull(pathIndex) ? cursor.getString(pathIndex) : "";
                    String bucket = bucketIndex >= 0 && !cursor.isNull(bucketIndex) ? cursor.getString(bucketIndex) : "";
                    String key = path.isEmpty() ? bucket : path;
                    if (key.isEmpty()) continue;
                    counts.put(key, counts.containsKey(key) ? counts.get(key) + 1 : 1);
                    if (!names.containsKey(key)) names.put(key, bucket.isEmpty() ? key : bucket);
                }
            }
            signal.throwIfCanceled();
            java.util.List<String> keys = new java.util.ArrayList<>(counts.keySet());
            java.util.Collections.sort(keys, (left, right) -> {
                int byCount = counts.get(right) - counts.get(left);
                if (byCount != 0) return byCount;
                return String.valueOf(names.get(left)).compareToIgnoreCase(String.valueOf(names.get(right)));
            });
            for (String key : keys) {
                folders.put(new JSObject().put("name", names.get(key)).put("path", key).put("count", counts.get(key)).put("kind", kind));
            }
            call.resolve(new JSObject().put("folders", folders).put("access", access));
        });
    }

    @PluginMethod public void mediaThumbnail(PluginCall call) {
        mediaTask(call, signal -> {
            try {
                String kind = mediaKind(call);
                if ("denied".equals(mediaAccess(kind))) throw new SecurityException("Media permission revoked");
                Uri uri = Uri.parse(call.getString("uri", ""));
                String prefix = mediaCollection(kind).toString() + "/";
                if (!uri.toString().startsWith(prefix) || !uri.getLastPathSegment().matches("[0-9]+")) throw new SecurityException("Invalid media URI");
                android.graphics.Bitmap bitmap;
                ContentResolver resolver = getContext().getContentResolver();
                if (android.os.Build.VERSION.SDK_INT >= 29) bitmap = resolver.loadThumbnail(uri, new android.util.Size(320, 240), signal);
                else if ("videos".equals(kind)) bitmap = android.provider.MediaStore.Video.Thumbnails.getThumbnail(resolver, android.content.ContentUris.parseId(uri), android.provider.MediaStore.Video.Thumbnails.MINI_KIND, null);
                else if ("photos".equals(kind)) bitmap = android.provider.MediaStore.Images.Thumbnails.getThumbnail(resolver, android.content.ContentUris.parseId(uri), android.provider.MediaStore.Images.Thumbnails.MINI_KIND, null);
                else bitmap = null;
                String encoded = null;
                if (bitmap != null) {
                    int width = bitmap.getWidth(), height = bitmap.getHeight();
                    float scale = Math.min(1f, Math.min(320f / width, 240f / height));
                    android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), true);
                    try (ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 75, bytes);
                        encoded = "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
                    }
                    if (small != bitmap) small.recycle();
                    bitmap.recycle();
                }
                signal.throwIfCanceled();
                // Re-check before returning private visual data after a settings change.
                if ("denied".equals(mediaAccess(kind))) throw new SecurityException("Media permission revoked");
                call.resolve(new JSObject().put("dataUrl", encoded));
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
    }

    @Override public void load() { watchMedia(); }

    private void watchMedia() {
        if (mediaObserver == null) {
            mediaObserver = new android.database.ContentObserver(mediaHandler) {
                @Override public void onChange(boolean selfChange) {
                    mediaHandler.removeCallbacks(mediaChanged);
                    mediaHandler.postDelayed(mediaChanged, 350);
                }
            };
            for (String kind : new String[]{"videos", "photos", "audio"}) getContext().getContentResolver().registerContentObserver(mediaCollection(kind), true, mediaObserver);
        }
        mediaHandler.post(mediaChanged);
    }

    @Override protected void handleOnResume() { super.handleOnResume(); watchMedia(); }

    @Override protected void handleOnPause() {
        if (mediaObserver != null) getContext().getContentResolver().unregisterContentObserver(mediaObserver);
        mediaObserver = null;
        mediaHandler.removeCallbacks(mediaChanged);
        for (android.os.CancellationSignal signal : mediaSignals.values()) signal.cancel();
        super.handleOnPause();
    }

    @Override protected void handleOnDestroy() {
        handleOnPause();
        mediaWorkers.shutdownNow();
        super.handleOnDestroy();
    }

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

    /** Display names already present in a tree, so a batch never clobbers them. */
    private Set<String> childNames(Uri tree) {
        Set<String> names = new HashSet<>();
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            String[] projection = new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME};
            try (Cursor cursor = getContext().getContentResolver().query(children, projection, null, null, null)) {
                if (cursor != null) while (cursor.moveToNext()) {
                    String value = cursor.getString(0);
                    if (value != null) names.add(value);
                }
            }
        } catch (Exception ignored) {}
        return names;
    }

    /** "tile.png" -> "tile (2).png" without ever dropping the extension. */
    static String collisionSafeName(Set<String> taken, String desired) {
        if (taken == null || taken.isEmpty() || desired == null || !taken.contains(desired)) return desired;
        int dot = desired.lastIndexOf('.');
        String stem = dot > 0 ? desired.substring(0, dot) : desired;
        String extension = dot > 0 ? desired.substring(dot) : "";
        for (int index = 2; index < 1000; index += 1) {
            String candidate = stem + " (" + index + ")" + extension;
            if (!taken.contains(candidate)) return candidate;
        }
        return stem + "-" + System.currentTimeMillis() + extension;
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

    /*
     * writeBytes can only open a document that already exists, so a tool that
     * produces many files (a grid of tiles, a run of extracted frames) used to
     * need one save sheet per file. This creates the child document inside a
     * previously picked tree, which is what batch output actually requires.
     */
    @PluginMethod
    public void createChild(PluginCall call) {
        String parentValue = call.getString("uri", "");
        String desired = call.getString("name", "");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (desired == null || desired.trim().isEmpty()) {
            call.reject("A document name is required.");
            return;
        }
        Uri parent = Uri.parse(parentValue);
        try {
            if (!DocumentsContract.isTreeUri(parent)) {
                /* Already a concrete document URI: report it back so the caller
                 * writes to the same place instead of failing the batch. */
                call.resolve(describe(parent));
                return;
            }
            Uri parentDocument = DocumentsContract.buildDocumentUriUsingTree(parent, DocumentsContract.getTreeDocumentId(parent));
            String unique = collisionSafeName(childNames(parent), desired);
            Uri child = DocumentsContract.createDocument(getContext().getContentResolver(), parentDocument, mimeType, unique);
            if (child == null) throw new IllegalStateException("Android refused to create the document in the selected folder.");
            JSObject result = describe(child);
            result.put("created", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not create a document in the selected Android folder.", error);
        }
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
