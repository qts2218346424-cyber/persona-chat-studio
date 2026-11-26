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
import android.os.SystemClock;
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
 * - 开启系统「通知使用权」后，可毫秒级精准同步 QQ 音乐/网易云/酷狗的歌名、歌手、状态栏原生歌词与毫秒进度；
 * - 同步拦截美团、饿了么、京东秒送、淘宝闪购等外卖实况与通知进度，实时同步给大肥鱼；
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

    private static final Set<String> DELIVERY_PKGS = new HashSet<>(Arrays.asList(
            "com.sankuai.meituan",
            "com.sankuai.meituan.takeoutnew",
            "me.ele",
            "com.jingdong.app.mall",
            "com.jingdong.pdj",
            "com.taobao.taobao",
            "com.wudaokou.hippo",
            "com.yek.android.kfc.activitys",
            "com.mcdonalds.gma.cn"
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
        if (pkg == null) return;

        Notification n = sbn.getNotification();
        if (n == null) return;
        Bundle ex = n.extras;
        String title = ex != null ? safeStr(ex.getCharSequence(Notification.EXTRA_TITLE)) : "";
        String text = ex != null ? safeStr(ex.getCharSequence(Notification.EXTRA_TEXT)) : "";
        String subText = ex != null ? safeStr(ex.getCharSequence(Notification.EXTRA_SUB_TEXT)) : "";
        String bigText = ex != null ? safeStr(ex.getCharSequence(Notification.EXTRA_BIG_TEXT)) : "";
        String ticker = safeStr(n.tickerText);

        if (MUSIC_PKGS.contains(pkg)) {
            boolean hasMediaSession = (ex != null && ex.containsKey(Notification.EXTRA_MEDIA_SESSION))
                    || Notification.CATEGORY_TRANSPORT.equals(n.category);
            if (!hasMediaSession) {
                // 不带 MediaSession 的音乐通知多为系统状态栏滚动歌词/桌面歌词广播，绝不当成新歌名触发逐句搜索！
                String lyricCandidate = !text.isEmpty() ? text : (!ticker.isEmpty() ? ticker : title);
                if (!lyricCandidate.isEmpty()) {
                    FloatAgentService.onExternalNativeLyric(pkg, lyricCandidate, title);
                }
            } else {
                if (!title.isEmpty()) {
                    FloatAgentService.onExternalMusicNotification(pkg, title, text);
                }
                pollActiveMusicSession(this);
            }
            return;
        }

        // 外卖订单与实时配送状态同步
        String combined = (title + " " + text + " " + subText + " " + bigText).trim();
        if (DELIVERY_PKGS.contains(pkg) || isStrongDeliveryNotification(combined)) {
            if (!combined.isEmpty() && isStrongDeliveryNotification(combined)) {
                String detail = !bigText.isEmpty() ? bigText : (!text.isEmpty() ? text : subText);
                FloatAgentService.onExternalTakeoutUpdate(pkg, title, detail);
            }
        }
    }

    private static boolean isStrongDeliveryNotification(String s) {
        if (s == null || s.isEmpty()) return false;
        String[] kws = new String[]{
                "骑手", "外卖", "已接单", "备餐", "已出餐", "已取餐",
                "正在为您配送", "正在配送", "配送中", "距您", "距离您",
                "预计送达", "即将送达", "已送达", "放入外卖柜", "已放置", "商家已接单"
        };
        for (String kw : kws) {
            if (s.contains(kw)) return true;
        }
        return false;
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
            long positionMs = 0L;
            if (ps != null) {
                positionMs = Math.max(0L, ps.getPosition());
                if (playing) {
                    long updTime = ps.getLastPositionUpdateTime();
                    if (updTime > 0L) {
                        long elapsed = SystemClock.elapsedRealtime() - updTime;
                        if (elapsed > 0L && elapsed < 3600000L) {
                            float spd = ps.getPlaybackSpeed() > 0.05f ? ps.getPlaybackSpeed() : 1.0f;
                            positionMs += Math.round(elapsed * spd);
                        }
                    }
                }
            }

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
