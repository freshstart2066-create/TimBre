package com.timbre.musicplayer;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Size;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocalAudioServer {
    private static final String TAG = "LocalAudioServer";
    private final Context context;
    private ServerSocket serverSocket;
    private int port = -1;
    private boolean isRunning = false;
    private final ExecutorService threadPool = Executors.newCachedThreadPool();

    public LocalAudioServer(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized void start() {
        if (isRunning) return;

        try {
            // Bind to loopback interface on any ephemeral free port
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = serverSocket.getLocalPort();
            isRunning = true;
            Log.i(TAG, "LocalAudioServer started on port: " + port);

            new Thread(() -> {
                while (isRunning && serverSocket != null && !serverSocket.isClosed()) {
                    try {
                        Socket client = serverSocket.accept();
                        threadPool.execute(() -> handleClient(client));
                    } catch (IOException e) {
                        if (!isRunning) break;
                    }
                }
            }, "TimBre-LocalAudioServer-Acceptor").start();

        } catch (IOException e) {
            Log.e(TAG, "Failed to start LocalAudioServer", e);
        }
    }

    public synchronized void stop() {
        isRunning = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {}
            serverSocket = null;
        }
        threadPool.shutdownNow();
    }

    public int getPort() {
        return port;
    }

    private void handleClient(Socket socket) {
        try {
            socket.setSoTimeout(15000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                socket.close();
                return;
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }

            String method = parts[0];
            String path = parts[1];

            // Read HTTP headers
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    headers.put(line.substring(0, colonIdx).trim().toLowerCase(), line.substring(colonIdx + 1).trim());
                }
            }

            if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                sendError(socket.getOutputStream(), 405, "Method Not Allowed");
                socket.close();
                return;
            }

            if (path.startsWith("/audio/")) {
                handleAudioStream(socket, path, headers, "HEAD".equalsIgnoreCase(method));
            } else if (path.startsWith("/artwork/")) {
                handleArtwork(socket, path, "HEAD".equalsIgnoreCase(method));
            } else {
                sendError(socket.getOutputStream(), 404, "Not Found");
            }

        } catch (Exception e) {
            // Client disconnect or socket reset during streaming is normal when scrubbing
        } finally {
            try {
                if (!socket.isClosed()) socket.close();
            } catch (Exception ignored) {}
        }
    }

    private void handleAudioStream(Socket socket, String path, Map<String, String> headers, boolean isHeadOnly) {
        ParcelFileDescriptor pfd = null;
        FileInputStream fis = null;
        try {
            // Path is /audio/{trackId} or /audio/{trackId}?params
            String idStr = path.substring("/audio/".length());
            int qIdx = idStr.indexOf("?");
            if (qIdx > 0) idStr = idStr.substring(0, qIdx);
            long trackId = Long.parseLong(idStr);

            Uri trackUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, trackId);
            ContentResolver resolver = context.getContentResolver();
            pfd = resolver.openFileDescriptor(trackUri, "r");
            if (pfd == null) {
                sendError(socket.getOutputStream(), 404, "Audio Not Found");
                return;
            }

            long totalLength = pfd.getStatSize();
            FileDescriptor fd = pfd.getFileDescriptor();
            fis = new FileInputStream(fd);

            String mimeType = resolver.getType(trackUri);
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = "audio/mpeg";
            }

            long start = 0;
            long end = totalLength - 1;
            boolean isPartial = false;

            // Handle Range request for instant seek & scrub support
            String rangeHeader = headers.get("range");
            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                isPartial = true;
                String[] rangeSpecs = rangeHeader.substring(6).split("-");
                try {
                    start = Long.parseLong(rangeSpecs[0]);
                    if (rangeSpecs.length > 1 && !rangeSpecs[1].trim().isEmpty()) {
                        end = Long.parseLong(rangeSpecs[1]);
                    }
                } catch (Exception ignored) {}
            }

            if (end >= totalLength) end = totalLength - 1;
            if (start > end) start = 0;
            long contentLength = (end - start) + 1;

            OutputStream out = socket.getOutputStream();
            StringBuilder headerResponse = new StringBuilder();

            if (isPartial) {
                headerResponse.append("HTTP/1.1 206 Partial Content\r\n");
                headerResponse.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(totalLength).append("\r\n");
            } else {
                headerResponse.append("HTTP/1.1 200 OK\r\n");
            }

            headerResponse.append("Content-Type: ").append(mimeType).append("\r\n");
            headerResponse.append("Content-Length: ").append(contentLength).append("\r\n");
            headerResponse.append("Accept-Ranges: bytes\r\n");
            headerResponse.append("Access-Control-Allow-Origin: *\r\n");
            headerResponse.append("Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n");
            headerResponse.append("Access-Control-Allow-Headers: Range\r\n");
            headerResponse.append("Connection: close\r\n\r\n");

            out.write(headerResponse.toString().getBytes("UTF-8"));
            out.flush();

            if (isHeadOnly) return;

            // Skip to start offset
            long skipped = 0;
            while (skipped < start) {
                long s = fis.skip(start - skipped);
                if (s <= 0) break;
                skipped += s;
            }

            // Stream audio chunk by chunk
            byte[] buffer = new byte[65536]; // 64 KB chunks
            long bytesRemaining = contentLength;
            while (bytesRemaining > 0) {
                int readLimit = (int) Math.min(buffer.length, bytesRemaining);
                int bytesRead = fis.read(buffer, 0, readLimit);
                if (bytesRead == -1) break;

                out.write(buffer, 0, bytesRead);
                bytesRemaining -= bytesRead;
            }
            out.flush();

        } catch (Exception e) {
            // Client scrub/disconnect
        } finally {
            try {
                if (fis != null) fis.close();
            } catch (Exception ignored) {}
            try {
                if (pfd != null) pfd.close();
            } catch (Exception ignored) {}
        }
    }

    private void handleArtwork(Socket socket, String path, boolean isHeadOnly) {
        try {
            String idStr = path.substring("/artwork/".length());
            int qIdx = idStr.indexOf("?");
            if (qIdx > 0) idStr = idStr.substring(0, qIdx);
            long trackId = Long.parseLong(idStr);

            byte[] artBytes = null;
            Uri trackUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, trackId);

            // 1. Android 10+ (API 29+) loadThumbnail
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    Bitmap bm = context.getContentResolver().loadThumbnail(trackUri, new Size(500, 500), null);
                    if (bm != null) {
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        bm.compress(Bitmap.CompressFormat.JPEG, 85, baos);
                        artBytes = baos.toByteArray();
                    }
                } catch (Exception ignored) {}
            }

            // 2. Embedded picture via MediaMetadataRetriever
            if (artBytes == null) {
                MediaMetadataRetriever mmr = null;
                try {
                    mmr = new MediaMetadataRetriever();
                    mmr.setDataSource(context, trackUri);
                    artBytes = mmr.getEmbeddedPicture();
                } catch (Exception ignored) {
                } finally {
                    try {
                        if (mmr != null) mmr.release();
                    } catch (Exception ignored) {}
                }
            }

            if (artBytes != null && artBytes.length > 0) {
                OutputStream out = socket.getOutputStream();
                String response = "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: image/jpeg\r\n" +
                        "Content-Length: " + artBytes.length + "\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Cache-Control: public, max-age=86400\r\n" +
                        "Connection: close\r\n\r\n";
                out.write(response.getBytes("UTF-8"));
                if (!isHeadOnly) {
                    out.write(artBytes);
                }
                out.flush();
            } else {
                sendError(socket.getOutputStream(), 404, "No artwork");
            }
        } catch (Exception e) {
            try {
                sendError(socket.getOutputStream(), 404, "Not Found");
            } catch (Exception ignored) {}
        }
    }

    private void sendError(OutputStream out, int code, String msg) {
        try {
            String res = "HTTP/1.1 " + code + " " + msg + "\r\n" +
                    "Content-Length: " + msg.length() + "\r\n" +
                    "Connection: close\r\n\r\n" + msg;
            out.write(res.getBytes("UTF-8"));
            out.flush();
        } catch (Exception ignored) {}
    }
}
