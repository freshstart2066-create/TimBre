package com.timbre.musicplayer;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Size;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQ_CODE = 2001;

    private LocalAudioServer localAudioServer;
    private String cachedAudioJson = "[]";

    public class NativeAudioBridge {
        @JavascriptInterface
        public void updateTrack(String title, String artist, String album, String artUrl, boolean isPlaying, long durationMs, long positionMs) {
            runOnUiThread(() -> {
                MediaPlaybackService.update(MainActivity.this, title, artist, album, artUrl, isPlaying, durationMs, positionMs);
            });
        }

        @JavascriptInterface
        public String getDeviceAudioTracks() {
            if ("[]".equals(cachedAudioJson) || cachedAudioJson.length() < 5) {
                cachedAudioJson = queryDeviceAudio();
            }
            return cachedAudioJson;
        }

        @JavascriptInterface
        public void scanDeviceAudio() {
            scanDeviceAudioAsync();
        }

        @JavascriptInterface
        public int getAudioServerPort() {
            return (localAudioServer != null) ? localAudioServer.getPort() : -1;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Start Local Audio Streaming Server as secondary fallback
        localAudioServer = new LocalAudioServer(this);
        localAudioServer.start();

        // ⚠️ Do NOT call setShowWhenLocked or setTurnScreenOn so the lock screen is never hijacked
        applyImmersiveFullscreen();
        initMediaBridge();
        checkAndRequestPermissions();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (localAudioServer != null) {
            localAudioServer.stop();
        }
    }

    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> needed = new ArrayList<>();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.POST_NOTIFICATIONS);
                }
                if (checkSelfPermission(Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.READ_MEDIA_AUDIO);
                }
            } else {
                if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            }

            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), PERMISSION_REQ_CODE);
            } else {
                scanDeviceAudioAsync();
            }
        } else {
            scanDeviceAudioAsync();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            boolean hasStorage = true;
            for (int i = 0; i < permissions.length; i++) {
                String p = permissions[i];
                if (Manifest.permission.READ_MEDIA_AUDIO.equals(p) || Manifest.permission.READ_EXTERNAL_STORAGE.equals(p)) {
                    if (grantResults[i] != PackageManager.PERMISSION_GRANTED) {
                        hasStorage = false;
                    }
                }
            }
            if (hasStorage) {
                Log.i(TAG, "Audio permission granted, scanning phone audio...");
                scanDeviceAudioAsync();
            }
        }
    }

    private void scanDeviceAudioAsync() {
        new Thread(() -> {
            cachedAudioJson = queryDeviceAudio();
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String js = "if (window.onDeviceAudioLoaded) { window.onDeviceAudioLoaded(" + cachedAudioJson + "); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            });
        }, "TimBre-DeviceAudioScanner").start();
    }

    public String queryDeviceAudio() {
        JSONArray tracksArray = new JSONArray();
        ContentResolver resolver = getContentResolver();
        Uri uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        String sortOrder = MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC";

        int serverPort = (localAudioServer != null) ? localAudioServer.getPort() : -1;

        String[] projection = new String[] {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.SIZE
        };

        try (Cursor cursor = resolver.query(uri, projection, selection, null, sortOrder)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int dataCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA);
                int albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                int displayNameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);

                do {
                    long id = cursor.getLong(idCol);
                    String title = cursor.getString(titleCol);
                    String artist = cursor.getString(artistCol);
                    String album = cursor.getString(albumCol);
                    long durationMs = cursor.getLong(durationCol);
                    String data = cursor.getString(dataCol);
                    long albumId = cursor.getLong(albumIdCol);
                    String displayName = cursor.getString(displayNameCol);
                    long fileSize = cursor.getLong(sizeCol);

                    if (durationMs > 0 && durationMs < 5000) continue;
                    if (fileSize > 0 && fileSize < 50000) continue;

                    if (title == null || title.trim().isEmpty()) {
                        title = (displayName != null) ? displayName.replaceFirst("[.][^.]+$", "") : "Track " + id;
                    }
                    if (artist == null || artist.trim().isEmpty() || artist.equalsIgnoreCase("<unknown>")) {
                        artist = "Unknown Artist";
                    }
                    if (album == null || album.trim().isEmpty() || album.equalsIgnoreCase("<unknown>")) {
                        album = "Unknown Album";
                    }

                    JSONObject track = new JSONObject();
                    track.put("id", id);
                    track.put("title", title);
                    track.put("artist", artist);
                    track.put("album", album);
                    track.put("durationMs", durationMs);
                    track.put("duration", formatDuration(durationMs));
                    track.put("path", data != null ? data : "");
                    track.put("contentUri", "content://media/external/audio/media/" + id);

                    // 1. Same-Origin HTTPS Intercept URL (100% immune to CORS and Mixed-Content muting)
                    track.put("src", "https://localhost/_timbre_audio_/" + id);
                    track.put("art", "https://localhost/_timbre_artwork_/" + id);

                    // 2. Loopback HTTP streaming fallback
                    if (serverPort > 0) {
                        track.put("httpSrc", "http://127.0.0.1:" + serverPort + "/audio/" + id);
                    }

                    track.put("albumId", albumId);
                    track.put("isLocal", true);

                    tracksArray.put(track);
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error querying device audio", e);
        }

        Log.i(TAG, "Total local audio tracks fetched from phone: " + tracksArray.length());
        return tracksArray.toString();
    }

    private String formatDuration(long ms) {
        long totalSec = Math.max(0, ms / 1000);
        long min = totalSec / 60;
        long sec = totalSec % 60;
        return String.format("%d:%02d", min, sec);
    }

    private void initMediaBridge() {
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.addJavascriptInterface(new NativeAudioBridge(), "TimbreNativeBridge");

            WebSettings settings = webView.getSettings();
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Custom WebViewClient intercepting audio streams on the same origin (https://localhost)
            webView.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri reqUri = request.getUrl();
                    if (reqUri != null && reqUri.getPath() != null) {
                        String path = reqUri.getPath();
                        if (path.startsWith("/_timbre_audio_/")) {
                            return handleAudioStreamRequest(request);
                        } else if (path.startsWith("/_timbre_artwork_/")) {
                            return handleArtworkRequest(request);
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }
            });
        }

        MediaPlaybackService.setMediaActionListener((action, param) -> {
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                            "if (window.handleNativeMediaAction) { window.handleNativeMediaAction('" + action + "', " + param + "); }",
                            null
                    );
                }
            });
        });
    }

    private WebResourceResponse handleAudioStreamRequest(WebResourceRequest request) {
        try {
            Uri reqUri = request.getUrl();
            String path = reqUri.getPath();
            if (path == null) return null;
            String idStr = path.replace("/_timbre_audio_/", "");
            int qIdx = idStr.indexOf("?");
            if (qIdx > 0) idStr = idStr.substring(0, qIdx);
            long trackId = Long.parseLong(idStr);

            Uri trackUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, trackId);
            ContentResolver resolver = getContentResolver();
            ParcelFileDescriptor pfd = resolver.openFileDescriptor(trackUri, "r");
            if (pfd == null) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
            }

            long totalLength = pfd.getStatSize();
            String mimeType = resolver.getType(trackUri);
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = "audio/mpeg";
            }

            Map<String, String> reqHeaders = request.getRequestHeaders();
            String rangeHeader = null;
            if (reqHeaders != null) {
                for (Map.Entry<String, String> entry : reqHeaders.entrySet()) {
                    if ("range".equalsIgnoreCase(entry.getKey())) {
                        rangeHeader = entry.getValue();
                        break;
                    }
                }
            }

            long start = 0;
            long end = totalLength - 1;
            boolean isPartial = false;

            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                isPartial = true;
                String[] specs = rangeHeader.substring(6).split("-");
                try {
                    start = Long.parseLong(specs[0]);
                    if (specs.length > 1 && !specs[1].trim().isEmpty()) {
                        end = Long.parseLong(specs[1]);
                    }
                } catch (Exception ignored) {}
            }

            if (end >= totalLength) end = totalLength - 1;
            if (start > end) start = 0;
            long contentLength = (end - start) + 1;

            Map<String, String> respHeaders = new HashMap<>();
            respHeaders.put("Accept-Ranges", "bytes");
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            respHeaders.put("Access-Control-Allow-Headers", "Range");
            respHeaders.put("Content-Length", String.valueOf(contentLength));

            FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
            if (start > 0) {
                long skipped = 0;
                while (skipped < start) {
                    long s = fis.skip(start - skipped);
                    if (s <= 0) break;
                    skipped += s;
                }
            }

            InputStream boundedStream = new BoundedInputStream(fis, pfd, contentLength);

            if (isPartial) {
                respHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + totalLength);
                return new WebResourceResponse(mimeType, "UTF-8", 206, "Partial Content", respHeaders, boundedStream);
            } else {
                return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", respHeaders, boundedStream);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error intercepting audio request", e);
            return null;
        }
    }

    private WebResourceResponse handleArtworkRequest(WebResourceRequest request) {
        try {
            Uri reqUri = request.getUrl();
            String path = reqUri.getPath();
            if (path == null) return null;
            String idStr = path.replace("/_timbre_artwork_/", "");
            int qIdx = idStr.indexOf("?");
            if (qIdx > 0) idStr = idStr.substring(0, qIdx);
            long trackId = Long.parseLong(idStr);

            Uri trackUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, trackId);
            byte[] artBytes = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    Bitmap bm = getContentResolver().loadThumbnail(trackUri, new Size(500, 500), null);
                    if (bm != null) {
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        bm.compress(Bitmap.CompressFormat.JPEG, 85, baos);
                        artBytes = baos.toByteArray();
                    }
                } catch (Exception ignored) {}
            }

            if (artBytes == null) {
                MediaMetadataRetriever mmr = null;
                try {
                    mmr = new MediaMetadataRetriever();
                    mmr.setDataSource(this, trackUri);
                    artBytes = mmr.getEmbeddedPicture();
                } catch (Exception ignored) {
                } finally {
                    try { if (mmr != null) mmr.release(); } catch (Exception ignored) {}
                }
            }

            if (artBytes != null && artBytes.length > 0) {
                Map<String, String> respHeaders = new HashMap<>();
                respHeaders.put("Access-Control-Allow-Origin", "*");
                respHeaders.put("Cache-Control", "public, max-age=86400");
                respHeaders.put("Content-Length", String.valueOf(artBytes.length));
                return new WebResourceResponse("image/jpeg", "UTF-8", 200, "OK", respHeaders, new ByteArrayInputStream(artBytes));
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static class BoundedInputStream extends InputStream {
        private final InputStream in;
        private final ParcelFileDescriptor pfd;
        private long remaining;

        public BoundedInputStream(InputStream in, ParcelFileDescriptor pfd, long length) {
            this.in = in;
            this.pfd = pfd;
            this.remaining = length;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read();
            if (b != -1) remaining--;
            return b;
        }

        @Override
        public int read(@NonNull byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int toRead = (int) Math.min(len, remaining);
            int read = in.read(b, off, toRead);
            if (read != -1) remaining -= read;
            return read;
        }

        @Override
        public void close() throws IOException {
            try { in.close(); } catch (Exception ignored) {}
            try { if (pfd != null) pfd.close(); } catch (Exception ignored) {}
        }
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        applyImmersiveFullscreen();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersiveFullscreen();
        if ("[]".equals(cachedAudioJson) || cachedAudioJson.length() < 5) {
            scanDeviceAudioAsync();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveFullscreen();
        }
    }

    private void applyImmersiveFullscreen() {
        Window window = getWindow();
        if (window == null) return;

        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        WindowCompat.setDecorFitsSystemWindows(window, false);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }
    }
}
