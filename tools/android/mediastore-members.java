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
            if (!"audio".equals(kind)) { columns.add("width"); columns.add("height"); columns.add("bucket_display_name"); columns.add("bucket_id"); }
            if (android.os.Build.VERSION.SDK_INT >= 29) columns.add("relative_path");
            String selection = android.os.Build.VERSION.SDK_INT >= 29 ? "is_pending=0" : "1=1";
            if (android.os.Build.VERSION.SDK_INT >= 30) selection += " AND is_trashed=0";
            if (!after.isEmpty()) selection += " AND _id < ?";
            String[] args = after.isEmpty() ? null : new String[]{after};
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
