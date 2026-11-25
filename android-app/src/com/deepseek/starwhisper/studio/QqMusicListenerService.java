package com.deepseek.starwhisper.studio;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 可选通知与媒体会话监听服务：
 * - 开启系统「通知使用权」后，可毫秒级精准同步 QQ 音乐/网易云/酷狗的歌名、歌手、播放暂停状态与精确毫秒进度；
 * - 未开启时也不影响主功能，由 AgentAccessibilityService + 媒体按键自动兜底联动。
 */
public class QqMusicListenerService extends NotificationListenerService {
    private static final Set<String> MUSIC_PKGS = new HashSet<>(Arrays.asList(
            "com.tencent.qqmusic",
            "com.netease.cloudmusic",
            "com.kugou.android",
            "com.luna.music",
            "cn.kuwo.player"
    ));

    private static volatile QqMusicListenerService sInstance = null;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        sInstance = this;
        pollActiveMusicSession(this);
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        if (sInstance == this) {
            sInstance = null;
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (!MUSIC_PKGS.contains(pkg)) return;

        Notification n = sbn.getNotification();
        if (n != null && n.extras != null) {
            Bundle ex = n.extras;
            String title = safeStr(ex.getCharSequence(Notification.EXTRA_TITLE));
            String text = safeStr(ex.getCharSequence(Notification.EXTRA_TEXT));
            if (!title.isEmpty()) {
                FloatAgentService.onExternalMusicNotification(pkg, title, text);
            }
        }
        pollActiveMusicSession(this);
    }

    public static boolean isNotificationAccessEnabled(Context ctx) {
        if (ctx == null) return false;
        try {
            String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
            if (TextUtils.isEmpty(flat)) return false;
            ComponentName cn = new ComponentName(ctx, QqMusicListenerService.class);
            return flat.contains(cn.flattenToString()) || flat.contains(cn.flattenToShortString());
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void openNotificationListenerSettings(Context ctx) {
        if (ctx == null) return;
        try {
            Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception ignored) {}
    }

    public static boolean pollActiveMusicSession(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false;
        try {
            if (!isNotificationAccessEnabled(ctx)) return false;
            MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm == null) return false;
            ComponentName cn = new ComponentName(ctx, QqMusicListenerService.class);
            List<MediaController> controllers = msm.getActiveSessions(cn);
            if (controllers == null || controllers.isEmpty()) return false;

            MediaController chosen = pickPreferredController(controllers);
            if (chosen == null) return false;

            MediaMetadata meta = chosen.getMetadata();
            PlaybackState ps = chosen.getPlaybackState();
            String title = meta != null ? safeStr(meta.getString(MediaMetadata.METADATA_KEY_TITLE)) : "";
            String artist = meta != null ? safeStr(meta.getString(MediaMetadata.METADATA_KEY_ARTIST)) : "";
            long durationMs = meta != null ? meta.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0L;
            boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
            long positionMs = ps != null ? Math.max(0L, ps.getPosition()) : 0L;

            if (!title.isEmpty()) {
                FloatAgentService.onMediaSessionSnapshot(
                        chosen.getPackageName(),
                        title,
                        artist,
                        playing,
                        positionMs,
                        durationMs
                );
                return true;
            }
        } catch (Throwable ignored) {}
        return false;
    }

    public static boolean controlActiveMusic(Context ctx, String action) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false;
        try {
            if (!isNotificationAccessEnabled(ctx)) return false;
            MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm == null) return false;
            ComponentName cn = new ComponentName(ctx, QqMusicListenerService.class);
            List<MediaController> controllers = msm.getActiveSessions(cn);
            if (controllers == null || controllers.isEmpty()) return false;

            MediaController chosen = pickPreferredController(controllers);
            if (chosen == null) return false;

            MediaController.TransportControls tc = chosen.getTransportControls();
            if ("next".equals(action)) {
                tc.skipToNext();
            } else if ("prev".equals(action)) {
                tc.skipToPrevious();
            } else if ("play".equals(action)) {
                tc.play();
            } else if ("pause".equals(action)) {
                tc.pause();
            } else {
                PlaybackState ps = chosen.getPlaybackState();
                boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
                if (playing) tc.pause();
                else tc.play();
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static MediaController pickPreferredController(List<MediaController> controllers) {
        MediaController qqCtrl = null;
        MediaController otherMusic = null;
        for (MediaController mc : controllers) {
            if (mc == null) continue;
            String pkg = mc.getPackageName();
            if ("com.tencent.qqmusic".equals(pkg)) {
                qqCtrl = mc;
                break;
            }
            if (MUSIC_PKGS.contains(pkg) && otherMusic == null) {
                otherMusic = mc;
            }
        }
        return qqCtrl != null ? qqCtrl : otherMusic;
    }

    private static String safeStr(CharSequence cs) {
        return cs != null ? cs.toString().trim() : "";
    }
}
