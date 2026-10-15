package com.timbre.musicplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MediaPlaybackService extends Service {
    public static final String ACTION_UPDATE = "com.timbre.musicplayer.ACTION_UPDATE";
    public static final String ACTION_PLAY = "com.timbre.musicplayer.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.timbre.musicplayer.ACTION_PAUSE";
    public static final String ACTION_PLAY_PAUSE = "com.timbre.musicplayer.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.timbre.musicplayer.ACTION_NEXT";
    public static final String ACTION_PREV = "com.timbre.musicplayer.ACTION_PREV";
    public static final String ACTION_STOP = "com.timbre.musicplayer.ACTION_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_ARTIST = "extra_artist";
    public static final String EXTRA_ALBUM = "extra_album";
    public static final String EXTRA_ART_URL = "extra_art_url";
    public static final String EXTRA_IS_PLAYING = "extra_is_playing";
    public static final String EXTRA_DURATION = "extra_duration";
    public static final String EXTRA_POSITION = "extra_position";

    private static final String CHANNEL_ID = "timbre_playback_channel";
    private static final int NOTIFICATION_ID = 4040;

    public interface MediaActionListener {
        void onMediaAction(String action, long param);
    }

    private static MediaActionListener actionListener = null;

    public static void setMediaActionListener(MediaActionListener listener) {
        actionListener = listener;
    }

    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;

    private String currentTitle = "TimBre";
    private String currentArtist = "Hi-Fi Audio";
    private String currentAlbum = "Library";
    private String currentArtUrl = "";
    private boolean currentIsPlaying = false;
    private long currentDuration = 0;
    private long currentPosition = 0;
    private Bitmap currentArtBitmap = null;

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TimBre:AudioPlaybackWakeLock");
        }

        initMediaSession();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "TimBre Audio Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("System notification and lock screen controls for TimBre audio player");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "TimBreMediaSession");
        mediaSession.setActive(true);

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                dispatchAction("play", 0);
            }

            @Override
            public void onPause() {
                dispatchAction("pause", 0);
            }

            @Override
            public void onSkipToNext() {
                dispatchAction("next", 0);
            }

            @Override
            public void onSkipToPrevious() {
                dispatchAction("prev", 0);
            }

            @Override
            public void onSeekTo(long pos) {
                dispatchAction("seek", pos);
            }

            @Override
            public void onStop() {
                dispatchAction("pause", 0);
                stopForeground(true);
                stopSelf();
            }
        });
    }

    private void dispatchAction(String action, long param) {
        if (actionListener != null) {
            actionListener.onMediaAction(action, param);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_STICKY;
        }

        String action = intent.getAction();

        switch (action) {
            case ACTION_UPDATE:
                currentTitle = intent.getStringExtra(EXTRA_TITLE);
                if (currentTitle == null || currentTitle.isEmpty()) currentTitle = "TimBre";
                currentArtist = intent.getStringExtra(EXTRA_ARTIST);
                if (currentArtist == null || currentArtist.isEmpty()) currentArtist = "Hi-Fi Audio";
                currentAlbum = intent.getStringExtra(EXTRA_ALBUM);
                if (currentAlbum == null || currentAlbum.isEmpty()) currentAlbum = "Library";
                String newArtUrl = intent.getStringExtra(EXTRA_ART_URL);
                currentIsPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false);
                currentDuration = intent.getLongExtra(EXTRA_DURATION, 0);
                currentPosition = intent.getLongExtra(EXTRA_POSITION, 0);

                // Start foreground service immediately with current metadata to fulfill Android 5-second SLA
                updateNotificationAndSession();

                if (newArtUrl != null && !newArtUrl.isEmpty() && !newArtUrl.equals(currentArtUrl)) {
                    currentArtUrl = newArtUrl;
                    loadArtBitmapAsync(currentArtUrl);
                }
                break;

            case ACTION_PLAY_PAUSE:
                dispatchAction("play_pause", 0);
                break;

            case ACTION_PLAY:
                dispatchAction("play", 0);
                break;

            case ACTION_PAUSE:
                dispatchAction("pause", 0);
                break;

            case ACTION_NEXT:
                dispatchAction("next", 0);
                break;

            case ACTION_PREV:
                dispatchAction("prev", 0);
                break;

            case ACTION_STOP:
                dispatchAction("pause", 0);
                stopForeground(true);
                stopSelf();
                break;
        }

        return START_STICKY;
    }

    private void loadArtBitmapAsync(final String artUrl) {
        new Thread(() -> {
            Bitmap bitmap = null;
            try {
                if (artUrl.startsWith("data:image")) {
                    String base64 = artUrl.substring(artUrl.indexOf(",") + 1);
                    byte[] decoded = Base64.decode(base64, Base64.DEFAULT);
                    bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
                } else if (artUrl.startsWith("http://") || artUrl.startsWith("https://")) {
                    URL url = new URL(artUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setDoInput(true);
                    conn.connect();
                    InputStream is = conn.getInputStream();
                    bitmap = BitmapFactory.decodeStream(is);
                } else {
                    // Try loading from assets
                    String path = artUrl.replace("assets/", "");
                    try {
                        InputStream is = getAssets().open("public/assets/" + path);
                        bitmap = BitmapFactory.decodeStream(is);
                    } catch (Exception ex) {
                        try {
                            InputStream is2 = getAssets().open("public/" + path);
                            bitmap = BitmapFactory.decodeStream(is2);
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}

            if (bitmap == null) {
                try {
                    bitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
                } catch (Exception ignored) {}
            }

            currentArtBitmap = bitmap;
            updateNotificationAndSession();
        }).start();
    }

    private void updateNotificationAndSession() {
        // Acquire wakeLock during active playback to prevent Android sleep throttling
        if (currentIsPlaying) {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(10 * 60 * 1000L); // 10 minutes timeout per lock
            }
        } else {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }

        // 1. Update MediaSessionCompat metadata
        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration > 0 ? currentDuration : -1);

        if (currentArtBitmap != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtBitmap);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, currentArtBitmap);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, currentArtBitmap);
        }
        mediaSession.setMetadata(metaBuilder.build());

        // 2. Update MediaSessionCompat PlaybackState
        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE
                | PlaybackStateCompat.ACTION_SET_REPEAT_MODE
                | PlaybackStateCompat.ACTION_STOP;

        int state = currentIsPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, currentPosition, 1.0f, android.os.SystemClock.elapsedRealtime())
                .build();
        mediaSession.setPlaybackState(playbackState);

        // 3. Build OS Notification with MediaStyle
        Notification notification = buildMediaNotification();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (!currentIsPlaying) {
            stopForeground(false);
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private Notification buildMediaNotification() {
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this, 0, contentIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent prevIntent = new Intent(this, MediaPlaybackService.class).setAction(ACTION_PREV);
        PendingIntent prevPendingIntent = PendingIntent.getService(
                this, 1, prevIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent playPauseIntent = new Intent(this, MediaPlaybackService.class).setAction(ACTION_PLAY_PAUSE);
        PendingIntent playPausePendingIntent = PendingIntent.getService(
                this, 2, playPauseIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent nextIntent = new Intent(this, MediaPlaybackService.class).setAction(ACTION_NEXT);
        PendingIntent nextPendingIntent = PendingIntent.getService(
                this, 3, nextIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int playPauseIcon = currentIsPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseTitle = currentIsPlaying ? "Pause" : "Play";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum)
                .setContentIntent(contentPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(currentIsPlaying)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_previous, "Previous", prevPendingIntent)
                .addAction(playPauseIcon, playPauseTitle, playPausePendingIntent)
                .addAction(android.R.drawable.ic_media_next, "Next", nextPendingIntent)
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2)
                );

        if (currentArtBitmap != null) {
            builder.setLargeIcon(currentArtBitmap);
        }

        return builder.build();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void update(Context context, String title, String artist, String album, String artUrl, boolean isPlaying, long duration, long position) {
        Intent intent = new Intent(context, MediaPlaybackService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_ARTIST, artist);
        intent.putExtra(EXTRA_ALBUM, album);
        intent.putExtra(EXTRA_ART_URL, artUrl);
        intent.putExtra(EXTRA_IS_PLAYING, isPlaying);
        intent.putExtra(EXTRA_DURATION, duration);
        intent.putExtra(EXTRA_POSITION, position);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }
}
