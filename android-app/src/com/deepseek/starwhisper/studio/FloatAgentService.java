package com.deepseek.starwhisper.studio;

import android.Manifest;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Vibrator;
import android.text.TextUtils;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * dsh-Go 风格「鲸鱼娘（大肥鱼）」全功能桌面宠物与 QQ 音乐联动悬浮窗服务
 * 1. 12 姿态 Q 版鲸鱼娘立绘 + 25 条原声语音（干饭白米饭、摸头摇尾、热梗傲娇、晕乎等）+ Q 弹动作动画；
 * 2. 原生 AudioTrack 清甜八音盒「爱吃米饭的鲸鱼娘」唱歌引擎，支持多首曲目与逐句歌词滚动；
 * 3. QQ 音乐深度联动：媒体会话/通知抓取歌名歌手、切歌播放暂停、点播搜歌、云端 LRC 时间轴歌词同步展示；
 * 4. 折叠态一键快捷语音 + 全程可视声波音量提示 + 试说口令引导 + 说完智能分流执行。
 */
public class FloatAgentService extends Service {
    private static final String FG_CHANNEL_ID = "pa_agent_running";
    private static final int FG_NOTIFICATION_ID = 2201;
    private static final String PREFS_NAME = "whale_float_prefs";
    private static final String PREF_KEY_QUICK_PHRASES = "quick_phrases_v1";
    private static final String PREF_KEY_QUICK_DIRECT = "quick_send_direct_v1";
    private static final String ASR_ENDPOINT = "https://star.claudexxb.online/api/asr/transcribe";
    private static final String LYRICS_ENDPOINT = "https://star.claudexxb.online/api/music/lyrics";

    private static volatile FloatAgentService sInstance = null;
    public static volatile boolean sEmergencyStopRequested = false;
    public static volatile String sCurrentStatus = "idle"; // idle, thinking, executing, acting, confirming, stopped
    private static volatile boolean sEdgeGlowEnabled = true;

    private WindowManager windowManager;
    private EdgeGlowView edgeGlowView;
    private WindowManager.LayoutParams edgeGlowParams;

    private FrameLayout floatRootView;
    private LinearLayout petBubbleContainer;
    private ImageView petAvatarView;
    private TextView quickMicBadgeView;
    private LinearLayout statusPillView;
    private View statusDotView;
    private TextView statusTextView;
    private TextView pillStopBtn;
    private LinearLayout expandPanel;

    // 展开态与折叠态共用提示元素
    private ImageView headPetIcon;
    private TextView subtitleBannerView;
    private TextView musicTitleView;
    private TextView musicLyricView;
    private TextView musicPlayPauseBtn;
    private TextView musicPermHintView;
    private LinearLayout musicSearchBox;
    private EditText musicSearchEditText;

    // 语音输入与丰富提示向导 UI
    private LinearLayout voiceGuideBanner;
    private TextView voiceGuideTitle;
    private TextView voiceGuideMeter;
    private TextView voiceGuideSamples;
    private TextView autoSendToggleBtn;
    private boolean voiceAutoSend = true;
    private boolean voiceQuickDirectMode = false;

    // 桌宠个性开关与透明悬浮歌词状态（持久化保存在 SharedPreferences）
    private boolean showVoiceTail = true;
    private boolean antiMistouchEnabled = false;
    private boolean floatingLyricsEnabled = true;
    private boolean lyricsDragMode = false;
    private int savedLyricsY = 180;
    private int tripleTapCount = 0;
    private long lastMistouchTapMs = 0L;
    private long lastMistouchToastMs = 0L;
    private int autoLifeStep = 0;

    // 独立全透明背景桌面漂浮歌词窗
    private LinearLayout floatingLyricRootView;
    private WindowManager.LayoutParams floatingLyricParams;
    private TextView floatingLyricSubText;
    private TextView floatingLyricMainText;
    private TextView voiceTailToggleBtn;
    private TextView antiMistouchToggleBtn;
    private TextView floatingLyricsToggleBtn;
    private TextView floatingLyricsMoveBtn;

    private ValueAnimator petBreathAnim;
    private ValueAnimator petActionAnim;
    private boolean isDraggingPet = false;
    private long lastDragVoiceMs = 0L;
    private int dragWiggleCount = 0;

    private TextView a11yBadgeView;
    private EditText cmdEditText;
    private EditText typingEditText;
    private EditText batchImportEditText;
    private LinearLayout batchImportBox;
    private LinearLayout panelPhraseChipsWrap;
    private TextView panelQuickModeBtn;
    private TextView feedbackTextView;
    private TextView autoSwipeToggleBtn;
    private TextView toolsToggleBtn;
    private LinearLayout localToolsBox;
    private boolean localToolsExpanded = false;

    // 快捷打字模式与常用聊天文字库（支持本地持久化、剪贴板/文本批量导入及与网页端同步）
    private final List<String> quickPhrases = new ArrayList<>();
    private boolean quickTypingDirectSend = true;
    private boolean quickTypingBarVisible = false;
    private LinearLayout quickTypingBarView;
    private WindowManager.LayoutParams quickTypingBarParams;
    private LinearLayout quickBarChipsWrap;
    private TextView quickBarModeBtn;

    // 原生 MediaPlayer 语音 + AudioTrack 唱歌引擎
    private MediaPlayer petVoicePlayer = null;
    private WhaleSingerEngine singerEngine = null;
    private int feedIndex = 0;
    private int patIndex = 0;
    private int danceIndex = 0;
    private int singSongIndex = 0;
    private long lastTapPetMs = 0L;

    // QQ 音乐与歌词同步状态
    private volatile String qqMusicPkg = "";
    private volatile String qqMusicTitle = "";
    private volatile String qqMusicArtist = "";
    private volatile boolean qqMusicPlaying = false;
    private volatile long qqMusicPosMs = 0L;
    private volatile long qqMusicDurationMs = 0L;
    private volatile long qqMusicLastSyncMs = 0L;
    private volatile String qqMusicCurrentLyric = "";
    private volatile String lastFetchedLyricsKey = "";
    private int inactiveMusicStreak = 0;
    private final List<LyricLine> qqMusicLyrics = Collections.synchronizedList(new ArrayList<LyricLine>());

    // 原生 MediaRecorder + 云端 ASR 语音识别状态
    private MediaRecorder mediaRecorder = null;
    private File voiceCacheFile = null;
    private boolean isRecordingVoice = false;
    private boolean isTranscribingVoice = false;
    private EditText activeSpeechTarget = null;
    private TextView activeSpeechVoiceBtn = null;
    private long recordStartMs = 0L;
    private int lowVolStreak = 0;

    private final List<TextView> tabButtons = new ArrayList<>();
    private final List<LinearLayout> tabPages = new ArrayList<>();
    private int currentTabIndex = 0;

    private int selectedSwipeIntervalSec = 8;
    private boolean randomLikeEnabled = false;
    private final List<TextView> intervalChipViews = new ArrayList<>();
    private TextView randomLikeChipView;

    private WindowManager.LayoutParams layoutParams;
    private boolean isExpanded = false;
    private int savedPillX = 24;
    private int savedPillY = 260;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final String[] VOICE_SAMPLE_TIPS = new String[]{
            "可试说：“用QQ音乐放首晴天”",
            "可试说：“下一首歌” 或 “暂停音乐”",
            "可试说：“给鲸鱼娘喂白米饭” 或 “唱首歌”",
            "可试说：“打开微信” 或 “刷抖音”"
    };
    private int sampleTipTick = 0;

    private final Runnable maxRecordTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (isRecordingVoice) {
                stopVoiceRecordAndTranscribe();
            }
        }
    };

    private final Runnable voiceMeterTickRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isRecordingVoice) return;
            updateVoiceMeterUi();
            mainHandler.postDelayed(this, 160);
        }
    };

    private final Runnable lyricTickRunnable = new Runnable() {
        @Override
        public void run() {
            tickMusicAndLyrics();
            mainHandler.postDelayed(this, 650);
        }
    };

    private final Runnable idleSleepRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus) && petBubbleContainer != null
                    && !qqMusicPlaying && (singerEngine == null || !singerEngine.isSinging())) {
                petBubbleContainer.animate().alpha(0.88f).setDuration(350).start();
            }
        }
    };

    private final Runnable lifePoseResetRunnable = new Runnable() {
        @Override
        public void run() {
            if ("idle".equals(sCurrentStatus) && !isDraggingPet && !isRecordingVoice && !qqMusicPlaying
                    && (singerEngine == null || !singerEngine.isSinging())) {
                setPetPoseDrawable(R.drawable.feiyu_idle);
            }
        }
    };

    private final Runnable autonomousLifeRunnable = new Runnable() {
        @Override
        public void run() {
            if (sInstance == null) return;
            if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus)
                    && !isRecordingVoice && !qqMusicPlaying
                    && (singerEngine == null || !singerEngine.isSinging())) {
                int step = autoLifeStep % 6;
                autoLifeStep++;
                int pose = R.drawable.feiyu_eating;
                String anim = "eat";
                switch (step) {
                    case 0:
                        pose = R.drawable.feiyu_eating;
                        anim = "eat";
                        break;
                    case 1:
                        pose = R.drawable.feiyu_walk;
                        anim = "walk";
                        break;
                    case 2:
                        pose = R.drawable.feiyu_focus;
                        anim = "bounce";
                        break;
                    case 3:
                        pose = R.drawable.feiyu_dance;
                        anim = "dance";
                        break;
                    case 4:
                        pose = R.drawable.feiyu_beg;
                        anim = "eat";
                        break;
                    case 5:
                    default:
                        pose = R.drawable.feiyu_happy;
                        anim = "bounce";
                        break;
                }
                setPetPoseDrawable(pose);
                playPetBounceAnim(anim);
                mainHandler.removeCallbacks(lifePoseResetRunnable);
                mainHandler.postDelayed(lifePoseResetRunnable, 4200);
            }
            mainHandler.postDelayed(this, 11000);
        }
    };

    private final Runnable floatingLyricLockRunnable = new Runnable() {
        @Override
        public void run() {
            if (lyricsDragMode) {
                setLyricsDragMode(false);
            }
        }
    };

    private final Runnable happyResetRunnable = new Runnable() {
        @Override
        public void run() {
            if ("idle".equals(sCurrentStatus) && !isDraggingPet) {
                if (qqMusicPlaying || (singerEngine != null && singerEngine.isSinging())) {
                    setPetPoseDrawable(R.drawable.feiyu_dance);
                } else {
                    setPetPoseDrawable(R.drawable.feiyu_idle);
                }
            }
        }
    };

    private final Runnable subtitleResetRunnable = new Runnable() {
        @Override
        public void run() {
            if (subtitleBannerView != null && !isRecordingVoice && (singerEngine == null || !singerEngine.isSinging())) {
                subtitleBannerView.setText("🍚 大肥鱼待命中 · 戳我喂米饭 / 摸头 / 唱歌 / 点歌~");
            }
            refreshCollapsedPill();
        }
    };

    private LinearLayout confirmBannerView = null;
    private boolean foregroundActive = false;

    private static final class LyricLine {
        final long timeMs;
        final String text;

        LyricLine(long timeMs, String text) {
            this.timeMs = timeMs;
            this.text = text;
        }
    }

    public static boolean isRunning() {
        return sInstance != null;
    }

    public static void setEdgeGlowEnabled(final boolean enabled) {
        sEdgeGlowEnabled = enabled;
        final FloatAgentService inst = sInstance;
        if (inst != null) {
            inst.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (inst.edgeGlowView != null) {
                        inst.edgeGlowView.setState(enabled ? sCurrentStatus : "idle");
                    }
                }
            });
        }
    }

    public static void setEdgeGlowState(final String state) {
        final FloatAgentService inst = sInstance;
        if (inst != null) {
            inst.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (inst.edgeGlowView != null) {
                        inst.edgeGlowView.setState(sEdgeGlowEnabled ? state : "idle");
                    }
                }
            });
        }
    }

    public static void showTapRipple(final int x, final int y) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.displayTapRippleInternal(x, y);
            }
        });
    }

    public static void setForegroundKeepingAlive(final boolean active, final String statusText) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.updateForegroundNotification(active, statusText);
            }
        });
    }

    public static void showConfirmPrompt(final String summary, final String actionDesc) {
        showConfirmPrompt(summary, actionDesc, "write", "", false);
    }

    public static void showConfirmPrompt(
            final String summary,
            final String actionDesc,
            final String riskLevel,
            final String targetApp,
            final boolean hardSensitive
    ) {
        final FloatAgentService instance = sInstance;
        if (instance != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.displayConfirmBanner(summary, actionDesc, riskLevel, targetApp, hardSensitive);
                }
            });
        }
    }

    public static void dismissConfirmPrompt() {
        final FloatAgentService instance = sInstance;
        if (instance != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.hideConfirmBanner();
                }
            });
        }
    }

    public static void requestNormalStop() {
        sEmergencyStopRequested = false;
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y != null) {
            a11y.stopAllBackgroundTasks("悬浮窗普通停止");
        }
        updateState("idle", "dsh-Go");
        setForegroundKeepingAlive(false, "");
        MainActivity.dispatchNormalStopToWebView();
    }

    public static void updateState(final String state, final String text) {
        final String prevStatus = sCurrentStatus;
        sCurrentStatus = state != null ? state : "idle";
        final FloatAgentService instance = sInstance;
        if (instance != null && instance.statusTextView != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    boolean justFinishedTask = "idle".equals(sCurrentStatus)
                            && ("thinking".equals(prevStatus) || "executing".equals(prevStatus) || "acting".equals(prevStatus));
                    instance.applyStatusStyle(sCurrentStatus, text, justFinishedTask);
                    instance.refreshDynamicWidgets();
                    if (instance.edgeGlowView != null) {
                        instance.edgeGlowView.setState(sEdgeGlowEnabled ? sCurrentStatus : "idle");
                    }
                }
            });
        }
    }

    public static void requestStop() {
        sEmergencyStopRequested = true;
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y != null) {
            a11y.stopAllBackgroundTasks("悬浮窗急停");
        }
        updateState("stopped", "已急停");
        setForegroundKeepingAlive(false, "");
        MainActivity.dispatchNormalStopToWebView();
    }

    public static void resetStopFlag() {
        sEmergencyStopRequested = false;
        updateState("idle", "dsh-Go");
    }

    // ========= QQ 音乐与歌词静态回调入口 =========
    public static void onMediaSessionSnapshot(
            final String pkg,
            final String title,
            final String artist,
            final boolean playing,
            final long posMs,
            final long durMs
    ) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.handleMusicMetadataUpdate(pkg, title, artist, playing, posMs, durMs, true);
            }
        });
    }

    public static void onExternalMusicNotification(final String pkg, final String rawTitle, final String rawText) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                String t = rawTitle != null ? rawTitle.trim() : "";
                String s = rawText != null ? rawText.trim() : "";
                if (t.isEmpty()) return;
                // 若当前已有同歌名且 text 明显是一句实时歌词而非歌手专辑，则直接把 text 作为实时通知歌词展示
                if (!inst.qqMusicTitle.isEmpty() && t.equalsIgnoreCase(inst.qqMusicTitle) && !s.isEmpty() && s.length() > 2 && !s.contains("正在播放")) {
                    inst.qqMusicPlaying = true;
                    inst.qqMusicCurrentLyric = s;
                    inst.refreshMusicUi();
                    return;
                }
                String artist = s;
                if (artist.contains(" - ")) {
                    artist = artist.split(" - ")[0].trim();
                }
                inst.handleMusicMetadataUpdate(pkg, t, artist, true, 0L, 0L, false);
            }
        });
    }

    public static void onExternalMusicTimeHint(final String mmss) {
        final FloatAgentService inst = sInstance;
        if (inst == null || mmss == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    String[] p = mmss.split(":");
                    if (p.length == 2) {
                        long ms = (Long.parseLong(p[0]) * 60L + Long.parseLong(p[1])) * 1000L;
                        inst.qqMusicPosMs = ms;
                        inst.qqMusicLastSyncMs = System.currentTimeMillis();
                        inst.qqMusicPlaying = true;
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    public static void onExpectedMusicTrack(final String query) {
        final FloatAgentService inst = sInstance;
        if (inst == null || query == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                String clean = query.trim();
                if (!clean.isEmpty()) {
                    inst.handleMusicMetadataUpdate("com.tencent.qqmusic", clean, "", true, 0L, 0L, false);
                }
            }
        });
    }

    public static void triggerWhaleActionFromBridge(final String action) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.handleLocalWhaleCommand(action);
            }
        });
    }

    public static void openPanelFromBridge() {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.expandPanel();
            }
        });
    }

    public static void openQuickTypingBarFromBridge(final Context ctx) {
        final FloatAgentService inst = sInstance;
        if (inst != null) {
            inst.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    inst.collapsePanel();
                    inst.showQuickTypingBar();
                }
            });
        } else if (ctx != null) {
            Toast.makeText(ctx, "请先开启桌面大肥鱼悬浮窗后再使用快捷打字模式", Toast.LENGTH_SHORT).show();
        }
    }

    public static String getQuickPhrasesJsonFromPrefs(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String raw = sp.getString(PREF_KEY_QUICK_PHRASES, "");
            if (raw != null && !raw.trim().isEmpty()) {
                JSONArray arr = new JSONArray(raw);
                if (arr.length() > 0) return arr.toString();
            }
        } catch (Exception ignored) {}
        JSONArray def = new JSONArray();
        for (String s : getDefaultQuickPhrases()) {
            def.put(s);
        }
        return def.toString();
    }

    public static boolean saveQuickPhrasesJsonFromBridge(Context ctx, String jsonArrayStr) {
        if (ctx == null) return false;
        try {
            List<String> list = parsePhrasesFromRawText(jsonArrayStr);
            JSONArray arr = new JSONArray();
            for (String s : list) {
                arr.put(s);
            }
            ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY_QUICK_PHRASES, arr.toString())
                    .apply();
            final FloatAgentService inst = sInstance;
            if (inst != null) {
                inst.mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        inst.reloadQuickPhrases();
                    }
                });
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static List<String> getDefaultQuickPhrases() {
        List<String> defs = new ArrayList<>();
        defs.add("在吗？等我一下下~");
        defs.add("收到收到，马上处理！");
        defs.add("哈哈哈哈笑死我了");
        defs.add("辛苦啦，先去忙会儿~");
        defs.add("好的，没问题！");
        defs.add("大肥鱼帮你回一句：马上到！");
        return defs;
    }

    private static List<String> parsePhrasesFromRawText(String raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return out;

        if (trimmed.startsWith("[")) {
            try {
                JSONArray arr = new JSONArray(trimmed);
                for (int i = 0; i < arr.length() && out.size() < 80; i++) {
                    String item = arr.optString(i, "").trim();
                    if (!item.isEmpty() && !out.contains(item)) {
                        out.add(item);
                    }
                }
                return out;
            } catch (Exception ignored) {}
        }

        String[] lines = trimmed.split("\\r?\\n|\\|\\|\\|");
        for (String line : lines) {
            String item = line.trim();
            // 去除常见列表编号前缀（如 "1. "、"- "、"• "）
            item = item.replaceFirst("^(?:\\d+[\\.、\\)]\\s*|[-*•]\\s+)", "").trim();
            if (!item.isEmpty() && !out.contains(item)) {
                out.add(item);
                if (out.size() >= 80) break;
            }
        }
        return out;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void loadPrefs() {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            showVoiceTail = sp.getBoolean("show_voice_tail", true);
            antiMistouchEnabled = sp.getBoolean("anti_mistouch", false);
            floatingLyricsEnabled = sp.getBoolean("floating_lyrics", true);
            savedLyricsY = sp.getInt("lyrics_y", dp(88));
            quickTypingDirectSend = sp.getBoolean(PREF_KEY_QUICK_DIRECT, true);
        } catch (Exception ignored) {}
        reloadQuickPhrases();
    }

    private void reloadQuickPhrases() {
        quickPhrases.clear();
        try {
            String json = getQuickPhrasesJsonFromPrefs(this);
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                String item = arr.optString(i, "").trim();
                if (!item.isEmpty() && !quickPhrases.contains(item)) {
                    quickPhrases.add(item);
                }
            }
        } catch (Exception ignored) {}
        if (quickPhrases.isEmpty()) {
            quickPhrases.addAll(getDefaultQuickPhrases());
        }
        refreshPhraseViews();
    }

    private void persistQuickPhrases() {
        try {
            JSONArray arr = new JSONArray();
            for (String s : quickPhrases) {
                arr.put(s);
            }
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY_QUICK_PHRASES, arr.toString())
                    .apply();
        } catch (Exception ignored) {}
        refreshPhraseViews();
    }

    private void savePrefBool(String key, boolean val) {
        try {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean(key, val).apply();
        } catch (Exception ignored) {}
    }

    private void savePrefInt(String key, int val) {
        try {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putInt(key, val).apply();
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        sEmergencyStopRequested = false;
        loadPrefs();
        singerEngine = new WhaleSingerEngine();
        initEdgeGlowOverlay();
        initFloatingLyricOverlay();
        initFloatingView();
        mainHandler.postDelayed(lyricTickRunnable, 700);
        mainHandler.postDelayed(autonomousLifeRunnable, 5500);
        // 开窗轻微打个招呼
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (sInstance != null && isRunning()) {
                    showPetSubtitle("🐟 大肥鱼来啦！会自己干饭溜达，还能开防误触与透明歌词~", 3800);
                }
            }
        }, 650);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        ));
    }

    private int overlayWindowType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    private GradientDrawable createRoundRect(String fillHex, int radiusDp, String strokeHex, int strokeDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(Color.parseColor(fillHex));
        gd.setCornerRadius(dp(radiusDp));
        if (strokeHex != null && strokeDp > 0) {
            gd.setStroke(Math.max(1, dp(strokeDp)), Color.parseColor(strokeHex));
        }
        return gd;
    }

    private void setViewBg(View v, GradientDrawable bg) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            v.setBackground(bg);
        } else {
            v.setBackgroundDrawable(bg);
        }
    }

    private void setPetPoseDrawable(int resId) {
        if (petAvatarView != null) {
            petAvatarView.setImageResource(resId);
        }
        if (headPetIcon != null) {
            headPetIcon.setImageResource(resId);
        }
    }

    private void initEdgeGlowOverlay() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) return;
        edgeGlowView = new EdgeGlowView(this);
        edgeGlowView.setVisibility(View.GONE);
        edgeGlowParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        try {
            windowManager.addView(edgeGlowView, edgeGlowParams);
        } catch (Exception ignored) {
            edgeGlowView = null;
        }
    }

    private void displayTapRippleInternal(int x, int y) {
        if (windowManager == null || x <= 0 || y <= 0) return;
        final int size = dp(56);
        final TapRippleView ripple = new TapRippleView(this);
        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size,
                size,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = x - size / 2;
        lp.y = y - size / 2;

        try {
            windowManager.addView(ripple, lp);
        } catch (Exception ignored) {
            return;
        }

        ValueAnimator anim = ValueAnimator.ofFloat(0f, 1f);
        anim.setDuration(380);
        anim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                ripple.setProgress((float) animation.getAnimatedValue());
            }
        });
        anim.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                try {
                    windowManager.removeView(ripple);
                } catch (Exception ignored) {}
            }
        });
        anim.start();
    }

    private void initFloatingView() {
        if (windowManager == null) {
            windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        }

        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );

        layoutParams.gravity = Gravity.TOP | Gravity.START;
        savedPillX = dp(8);
        savedPillY = dp(160);
        layoutParams.x = savedPillX;
        layoutParams.y = savedPillY;

        floatRootView = new FrameLayout(this);

        // 1. 折叠态：Q 版鲸鱼娘 + 快捷小麦克风按钮 + 歌词/台词动态胶囊
        petBubbleContainer = new LinearLayout(this);
        petBubbleContainer.setOrientation(LinearLayout.HORIZONTAL);
        petBubbleContainer.setGravity(Gravity.CENTER_VERTICAL);

        petAvatarView = new ImageView(this);
        petAvatarView.setImageResource(R.drawable.feiyu_idle);
        petAvatarView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams avatarLp = new LinearLayout.LayoutParams(dp(56), dp(56));
        petAvatarView.setLayoutParams(avatarLp);

        // 折叠态旁轻量「🎙」直达语音钮（不展开面板也能一键说话！）
        quickMicBadgeView = new TextView(this);
        quickMicBadgeView.setText("🎙");
        quickMicBadgeView.setTextSize(12.5f);
        quickMicBadgeView.setGravity(Gravity.CENTER);
        quickMicBadgeView.setPadding(dp(7), dp(5), dp(7), dp(5));
        setViewBg(quickMicBadgeView, createRoundRect("#E60F172A", 14, "#38BDF8", 1));
        LinearLayout.LayoutParams micBadgeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        micBadgeLp.leftMargin = dp(2);
        quickMicBadgeView.setLayoutParams(micBadgeLp);
        quickMicBadgeView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startQuickCollapsedVoice();
            }
        });

        statusPillView = new LinearLayout(this);
        statusPillView.setOrientation(LinearLayout.HORIZONTAL);
        statusPillView.setGravity(Gravity.CENTER_VERTICAL);
        statusPillView.setPadding(dp(9), dp(5), dp(8), dp(5));
        LinearLayout.LayoutParams pillLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pillLp.leftMargin = dp(4);
        statusPillView.setLayoutParams(pillLp);

        statusDotView = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dotLp.rightMargin = dp(5);
        statusDotView.setLayoutParams(dotLp);

        statusTextView = new TextView(this);
        statusTextView.setTextSize(11.5f);
        statusTextView.setMaxWidth(dp(168));
        statusTextView.setSingleLine(true);
        statusTextView.setEllipsize(TextUtils.TruncateAt.MARQUEE);
        statusTextView.setMarqueeRepeatLimit(-1);
        statusTextView.setSelected(true);
        statusTextView.setTextColor(Color.parseColor("#F8FAFC"));

        pillStopBtn = new TextView(this);
        pillStopBtn.setText("⏹");
        pillStopBtn.setTextSize(10.5f);
        pillStopBtn.setTextColor(Color.parseColor("#FCA5A5"));
        pillStopBtn.setPadding(dp(6), dp(2), dp(5), dp(2));
        LinearLayout.LayoutParams stopBtnLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopBtnLp.leftMargin = dp(5);
        pillStopBtn.setLayoutParams(stopBtnLp);
        setViewBg(pillStopBtn, createRoundRect("#450A0A", 10, "#EF4444", 1));
        pillStopBtn.setVisibility(View.GONE);
        pillStopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                Toast.makeText(FloatAgentService.this, "鲸鱼娘已停止当前任务", Toast.LENGTH_SHORT).show();
            }
        });

        statusPillView.addView(statusDotView);
        statusPillView.addView(statusTextView);
        statusPillView.addView(pillStopBtn);
        statusPillView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                handleBubbleClick();
            }
        });

        petBubbleContainer.addView(petAvatarView);
        petBubbleContainer.addView(quickMicBadgeView);
        petBubbleContainer.addView(statusPillView);

        applyVoiceTailVisibility();
        applyStatusStyle("idle", "dsh-Go", false);
        startPetBreathAnim();

        // 2. 展开态：鲸鱼娘动作互动 + QQ音乐歌词 + 语音引导 + dsh-Go 控屏面板
        expandPanel = buildExpandPanel();
        expandPanel.setVisibility(View.GONE);

        floatRootView.addView(petBubbleContainer);
        floatRootView.addView(expandPanel);

        // 拖拽拎起鲸鱼娘 + 晕乎彩蛋 + 贴边吸附 + 防误触保护 + 轻触/双击/三连击解锁
        View.OnTouchListener dragListener = new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private long touchStartTime = 0;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        wakePetOpacity();
                        initialX = layoutParams.x;
                        initialY = layoutParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        touchStartTime = System.currentTimeMillis();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        if (!isDraggingPet && Math.hypot(dx, dy) > dp(6)) {
                            isDraggingPet = true;
                            dragWiggleCount++;
                            setPetPoseDrawable(R.drawable.feiyu_drag);
                            if (petAvatarView != null) {
                                petAvatarView.setRotation(dx >= 0 ? 7f : -7f);
                            }
                            long nowMs = System.currentTimeMillis();
                            if (nowMs - lastDragVoiceMs > 9000L) {
                                lastDragVoiceMs = nowMs;
                                if (dragWiggleCount >= 4) {
                                    dragWiggleCount = 0;
                                    triggerDizzyAction();
                                } else {
                                    playWhaleVoice(R.raw.feiyu_drag, R.drawable.feiyu_drag, "shake",
                                            "🎣 别、别突然从后面叫我，我真的会被你吓到！", false);
                                }
                            }
                        }
                        int nextX = initialX + (int) dx;
                        int nextY = initialY + (int) dy;
                        int maxY = Math.max(dp(100), dm.heightPixels - dp(80));
                        layoutParams.x = Math.max(0, Math.min(nextX, dm.widthPixels - dp(56)));
                        layoutParams.y = Math.max(dp(28), Math.min(nextY, maxY));
                        try {
                            windowManager.updateViewLayout(floatRootView, layoutParams);
                        } catch (Exception ignored) {}
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);
                        boolean wasDragging = isDraggingPet;
                        isDraggingPet = false;
                        if (petAvatarView != null) {
                            petAvatarView.setRotation(0f);
                        }

                        if (!wasDragging && duration < 300 && diffX < dp(8) && diffY < dp(8)) {
                            long now = System.currentTimeMillis();
                            if (antiMistouchEnabled) {
                                // 防误触模式：单点不弹窗，仅萌萌弹跳回应；连点 3 下解锁面板
                                if (now - lastMistouchTapMs <= 520L) {
                                    tripleTapCount++;
                                } else {
                                    tripleTapCount = 1;
                                }
                                lastMistouchTapMs = now;
                                if (tripleTapCount >= 3) {
                                    tripleTapCount = 0;
                                    handleBubbleClick();
                                } else {
                                    setPetPoseDrawable(R.drawable.feiyu_happy);
                                    playPetBounceAnim("bounce");
                                    mainHandler.removeCallbacks(lifePoseResetRunnable);
                                    mainHandler.postDelayed(lifePoseResetRunnable, 1500);
                                    if (tripleTapCount == 1 && now - lastMistouchToastMs > 12000L) {
                                        lastMistouchToastMs = now;
                                        Toast.makeText(FloatAgentService.this,
                                                "🛡️ 防误触保护中：单点不弹窗（连点 3 下打开面板）",
                                                Toast.LENGTH_SHORT).show();
                                    }
                                }
                                return true;
                            }
                            if (now - lastTapPetMs < 320) {
                                lastTapPetMs = 0L;
                                triggerFeedRiceAction();
                            } else {
                                lastTapPetMs = now;
                                mainHandler.postDelayed(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (lastTapPetMs != 0L && System.currentTimeMillis() - lastTapPetMs >= 300) {
                                            lastTapPetMs = 0L;
                                            handleBubbleClick();
                                        }
                                    }
                                }, 310);
                            }
                        } else if (!wasDragging && duration >= 580 && diffX < dp(10) && diffY < dp(10)) {
                            // 长按：防误触模式下不触发录音，普通模式下快捷开麦
                            if (!antiMistouchEnabled) {
                                startQuickCollapsedVoice();
                            } else {
                                setPetPoseDrawable(R.drawable.feiyu_beg);
                                playPetBounceAnim("bounce");
                            }
                        } else {
                            int petW = petBubbleContainer.getWidth() > 0 ? petBubbleContainer.getWidth() : dp(64);
                            int center = layoutParams.x + petW / 2;
                            int margin = dp(6);
                            layoutParams.x = (center < dm.widthPixels / 2)
                                    ? margin
                                    : Math.max(margin, dm.widthPixels - petW - margin);
                            savedPillX = layoutParams.x;
                            savedPillY = layoutParams.y;
                            try {
                                windowManager.updateViewLayout(floatRootView, layoutParams);
                            } catch (Exception ignored) {}
                            applyStatusStyle(sCurrentStatus, statusTextView != null ? statusTextView.getText().toString() : "dsh-Go", false);
                            scheduleIdleSleep();
                        }
                        return true;
                }
                return false;
            }
        };
        petAvatarView.setOnTouchListener(dragListener);

        try {
            windowManager.addView(floatRootView, layoutParams);
            scheduleIdleSleep();
        } catch (Exception e) {
            Toast.makeText(this, "悬浮窗初始化失败，请检查系统悬浮窗权限", Toast.LENGTH_SHORT).show();
        }
    }

    private void applyVoiceTailVisibility() {
        if (quickMicBadgeView != null) {
            quickMicBadgeView.setVisibility(showVoiceTail ? View.VISIBLE : View.GONE);
        }
    }

    // ========= 全透明背景桌面漂浮歌词窗（默认触摸穿透不挡操作，可拖动调位置） =========
    private void initFloatingLyricOverlay() {
        if (windowManager == null) {
            windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        }
        if (windowManager == null) return;

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int width = Math.min((int) (dm.widthPixels * 0.92f), dp(360));

        floatingLyricRootView = new LinearLayout(this);
        floatingLyricRootView.setOrientation(LinearLayout.VERTICAL);
        floatingLyricRootView.setGravity(Gravity.CENTER_HORIZONTAL);
        floatingLyricRootView.setPadding(dp(10), dp(4), dp(10), dp(4));
        floatingLyricRootView.setBackgroundColor(Color.TRANSPARENT);

        floatingLyricSubText = new TextView(this);
        floatingLyricSubText.setTextSize(11f);
        floatingLyricSubText.setTextColor(Color.parseColor("#E0F2FE"));
        floatingLyricSubText.setGravity(Gravity.CENTER);
        floatingLyricSubText.setSingleLine(true);
        floatingLyricSubText.setEllipsize(TextUtils.TruncateAt.END);
        floatingLyricSubText.setShadowLayer(dp(3), 0f, dp(1), Color.parseColor("#E6000000"));

        floatingLyricMainText = new TextView(this);
        floatingLyricMainText.setTextSize(16.5f);
        floatingLyricMainText.setTypeface(null, android.graphics.Typeface.BOLD);
        floatingLyricMainText.setTextColor(Color.parseColor("#FFFFFF"));
        floatingLyricMainText.setGravity(Gravity.CENTER);
        floatingLyricMainText.setMaxLines(2);
        floatingLyricMainText.setEllipsize(TextUtils.TruncateAt.END);
        floatingLyricMainText.setShadowLayer(dp(4), 0f, dp(1), Color.parseColor("#F0000000"));

        floatingLyricRootView.addView(floatingLyricSubText);
        floatingLyricRootView.addView(floatingLyricMainText);
        floatingLyricRootView.setVisibility(View.GONE);

        floatingLyricParams = new WindowManager.LayoutParams(
                width,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        floatingLyricParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        floatingLyricParams.y = savedLyricsY;

        floatingLyricRootView.setOnTouchListener(new View.OnTouchListener() {
            private int startY;
            private float touchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (!lyricsDragMode) return false;
                DisplayMetrics d = getResources().getDisplayMetrics();
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        mainHandler.removeCallbacks(floatingLyricLockRunnable);
                        startY = floatingLyricParams.y;
                        touchY = event.getRawY();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int nextY = startY + (int) (event.getRawY() - touchY);
                        floatingLyricParams.y = Math.max(dp(32), Math.min(nextY, d.heightPixels - dp(96)));
                        try {
                            windowManager.updateViewLayout(floatingLyricRootView, floatingLyricParams);
                        } catch (Exception ignored) {}
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        savedLyricsY = floatingLyricParams.y;
                        savePrefInt("lyrics_y", savedLyricsY);
                        mainHandler.postDelayed(floatingLyricLockRunnable, 1400);
                        return true;
                }
                return false;
            }
        });

        try {
            windowManager.addView(floatingLyricRootView, floatingLyricParams);
        } catch (Exception ignored) {
            floatingLyricRootView = null;
        }
    }

    private void setLyricsDragMode(boolean enableDrag) {
        if (floatingLyricRootView == null || floatingLyricParams == null || windowManager == null) return;
        lyricsDragMode = enableDrag;
        mainHandler.removeCallbacks(floatingLyricLockRunnable);
        if (enableDrag) {
            floatingLyricParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
            setViewBg(floatingLyricRootView, createRoundRect("#330F172A", 12, "#38BDF8", 1));
            floatingLyricSubText.setText("📌 上下拖动此条可调整透明歌词位置（松手自动锁定穿透）");
            if (TextUtils.isEmpty(floatingLyricMainText.getText())) {
                floatingLyricMainText.setText("🎵 故事的小黄花 从出生那年就飘着~");
            }
            floatingLyricRootView.setVisibility(View.VISIBLE);
            mainHandler.postDelayed(floatingLyricLockRunnable, 8000);
        } else {
            floatingLyricParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
            floatingLyricRootView.setBackgroundColor(Color.TRANSPARENT);
            updateFloatingLyricOverlay();
            Toast.makeText(this, "已锁定透明歌词位置（恢复屏幕穿透）", Toast.LENGTH_SHORT).show();
        }
        try {
            windowManager.updateViewLayout(floatingLyricRootView, floatingLyricParams);
        } catch (Exception ignored) {}
    }

    private void updateFloatingLyricOverlay() {
        if (floatingLyricRootView == null) return;
        if (lyricsDragMode) return;
        if (!floatingLyricsEnabled) {
            floatingLyricRootView.setVisibility(View.GONE);
            return;
        }
        boolean isSingingNow = singerEngine != null && singerEngine.isSinging();
        if (isSingingNow) {
            String line = singerEngine.getCurrentLine();
            floatingLyricSubText.setText("🎤 鲸鱼娘正在清唱");
            floatingLyricMainText.setText(!TextUtils.isEmpty(line) ? line : "🎵 冒尖一碗大白米饭~");
            floatingLyricRootView.setVisibility(View.VISIBLE);
            return;
        }
        if (qqMusicPlaying && !qqMusicTitle.isEmpty()) {
            String artistPart = qqMusicArtist.isEmpty() ? "" : (" - " + qqMusicArtist);
            floatingLyricSubText.setText("🎵 " + qqMusicTitle + artistPart);
            String lyr = !qqMusicCurrentLyric.isEmpty() ? qqMusicCurrentLyric : ("♪ " + qqMusicTitle);
            floatingLyricMainText.setText(lyr);
            floatingLyricRootView.setVisibility(View.VISIBLE);
            return;
        }
        floatingLyricRootView.setVisibility(View.GONE);
    }

    private void startPetBreathAnim() {
        if (petBreathAnim != null) {
            petBreathAnim.cancel();
        }
        petBreathAnim = ValueAnimator.ofFloat(0f, 1f);
        petBreathAnim.setDuration(1550);
        petBreathAnim.setRepeatMode(ValueAnimator.REVERSE);
        petBreathAnim.setRepeatCount(ValueAnimator.INFINITE);
        petBreathAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                if (petAvatarView != null && !isDraggingPet && !isExpanded) {
                    float f = (float) animation.getAnimatedValue();
                    petAvatarView.setTranslationY(-dp(5) * f);
                    petAvatarView.setScaleX(1f + 0.03f * f);
                    petAvatarView.setScaleY(1f + 0.04f * f);
                    petAvatarView.setRotation(-2.2f + 4.4f * f);
                }
            }
        });
        petBreathAnim.start();
    }

    private void playPetBounceAnim(String animType) {
        if (petActionAnim != null) {
            petActionAnim.cancel();
        }
        final ImageView target = isExpanded ? headPetIcon : petAvatarView;
        if (target == null) return;
        target.setRotation(0f);
        target.setScaleX(1f);
        target.setScaleY(1f);

        if ("eat".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(420);
            petActionAnim.setRepeatCount(4);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setScaleY(1f + 0.08f * f);
                    target.setScaleX(1f - 0.04f * f);
                    target.setTranslationY(-dp(4) * f);
                }
            });
        } else if ("walk".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(-1f, 1f);
            petActionAnim.setDuration(520);
            petActionAnim.setRepeatCount(5);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setTranslationX(dp(6) * f);
                    target.setTranslationY(-dp(3) * Math.abs(f));
                    target.setRotation(5f * f);
                }
            });
        } else if ("dance".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(-1f, 1f);
            petActionAnim.setDuration(360);
            petActionAnim.setRepeatCount(7);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setRotation(10f * f);
                    target.setTranslationY(-dp(5) * Math.abs(f));
                }
            });
        } else if ("shake".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(-1f, 1f);
            petActionAnim.setDuration(140);
            petActionAnim.setRepeatCount(6);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setRotation(12f * f);
                }
            });
        } else {
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(260);
            petActionAnim.setRepeatCount(3);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setScaleX(1f + 0.1f * f);
                    target.setScaleY(1f + 0.1f * f);
                }
            });
        }
        petActionAnim.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                target.setRotation(0f);
                target.setScaleX(1f);
                target.setScaleY(1f);
                target.setTranslationX(0f);
                target.setTranslationY(0f);
            }
        });
        petActionAnim.start();
    }

    private void wakePetOpacity() {
        mainHandler.removeCallbacks(idleSleepRunnable);
        if (petBubbleContainer != null) {
            petBubbleContainer.animate().alpha(1.0f).setDuration(140).start();
        }
    }

    private void scheduleIdleSleep() {
        mainHandler.removeCallbacks(idleSleepRunnable);
        if (!isExpanded && "idle".equals(sCurrentStatus) && !qqMusicPlaying && (singerEngine == null || !singerEngine.isSinging())) {
            mainHandler.postDelayed(idleSleepRunnable, 45000);
        }
    }

    private LinearLayout buildExpandPanel() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.93f), dp(364));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setLayoutParams(new ViewGroup.LayoutParams(panelWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.setPadding(dp(13), dp(11), dp(13), dp(11));
        setViewBg(panel, createRoundRect("#F50F172A", 18, "#3B82F6", 1));

        // 1. 顶栏：鲸鱼娘头像 + 标题 + 无障碍状态微标 + 主界面 + 收起
        LinearLayout headRow = new LinearLayout(this);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        headPetIcon = new ImageView(this);
        headPetIcon.setImageResource(R.drawable.feiyu_idle);
        headPetIcon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams hIconLp = new LinearLayout.LayoutParams(dp(30), dp(30));
        hIconLp.rightMargin = dp(7);
        headPetIcon.setLayoutParams(hIconLp);
        headPetIcon.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });

        TextView titleTv = new TextView(this);
        titleTv.setText("鲸鱼娘 · 大肥鱼");
        titleTv.setTextColor(Color.parseColor("#F8FAFC"));
        titleTv.setTextSize(13.5f);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        titleTv.setLayoutParams(titleLp);

        a11yBadgeView = new TextView(this);
        a11yBadgeView.setTextSize(10f);
        a11yBadgeView.setPadding(dp(7), dp(3), dp(7), dp(3));
        a11yBadgeView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAccessibilitySettingsFromFloat();
            }
        });

        TextView homeAppTv = new TextView(this);
        homeAppTv.setText("主界面");
        homeAppTv.setTextColor(Color.parseColor("#93C5FD"));
        homeAppTv.setTextSize(11.5f);
        homeAppTv.setPadding(dp(7), dp(4), dp(5), dp(4));
        LinearLayout.LayoutParams homeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        homeLp.leftMargin = dp(3);
        homeAppTv.setLayoutParams(homeLp);
        homeAppTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityToFront(null, false);
            }
        });

        TextView closeTv = new TextView(this);
        closeTv.setText("收起");
        closeTv.setTextColor(Color.parseColor("#94A3B8"));
        closeTv.setTextSize(11.5f);
        closeTv.setPadding(dp(5), dp(4), dp(2), dp(4));
        closeTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
            }
        });

        headRow.addView(headPetIcon);
        headRow.addView(titleTv);
        headRow.addView(a11yBadgeView);
        headRow.addView(homeAppTv);
        headRow.addView(closeTv);
        panel.addView(headRow);

        // 2. 鲸鱼娘灵动对话/唱歌歌词条
        subtitleBannerView = new TextView(this);
        subtitleBannerView.setText("🍚 大肥鱼待命中 · 戳我喂米饭 / 摸头 / 唱歌 / 点歌~");
        subtitleBannerView.setTextColor(Color.parseColor("#BAE6FD"));
        subtitleBannerView.setTextSize(11.5f);
        subtitleBannerView.setPadding(dp(10), dp(6), dp(10), dp(6));
        subtitleBannerView.setMaxLines(2);
        subtitleBannerView.setEllipsize(TextUtils.TruncateAt.END);
        setViewBg(subtitleBannerView, createRoundRect("#1E293B", 10, "#0EA5E9", 1));
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(8);
        subtitleBannerView.setLayoutParams(subLp);
        subtitleBannerView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });
        panel.addView(subtitleBannerView);

        // 3. 鲸鱼娘互动动作栏（喂米饭 / 摸头 / 跳舞 / 唱歌 / 热梗）
        LinearLayout petActionRow = new LinearLayout(this);
        petActionRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actBarLp.topMargin = dp(7);
        petActionRow.setLayoutParams(actBarLp);

        TextView feedBtn = createGridBtn("🍚喂米饭");
        feedBtn.setTextColor(Color.parseColor("#FDE68A"));
        setViewBg(feedBtn, createRoundRect("#3B2506", 8, "#F59E0B", 1));
        feedBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerFeedRiceAction();
            }
        });

        TextView patBtn = createGridBtn("👋摸头");
        patBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });

        TextView danceBtn = createGridBtn("💃跳舞");
        danceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerDanceAction();
            }
        });

        TextView singBtn = createGridBtn("🎤唱歌");
        singBtn.setTextColor(Color.parseColor("#F9A8D4"));
        setViewBg(singBtn, createRoundRect("#3B102E", 8, "#EC4899", 1));
        singBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerSingSongAction();
            }
        });

        TextView memeBtn = createGridBtn("🫧讲热梗");
        LinearLayout.LayoutParams memeLp = (LinearLayout.LayoutParams) memeBtn.getLayoutParams();
        memeLp.rightMargin = 0;
        memeBtn.setLayoutParams(memeLp);
        memeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerRandomMemeVoice();
            }
        });

        petActionRow.addView(feedBtn);
        petActionRow.addView(patBtn);
        petActionRow.addView(danceBtn);
        petActionRow.addView(singBtn);
        petActionRow.addView(memeBtn);
        panel.addView(petActionRow);

        // 3b. 个性开关一行：防误触保护 + 折叠语音尾巴开关 + 透明悬浮歌词开关
        LinearLayout prefSwitchRow = new LinearLayout(this);
        prefSwitchRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams psLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        psLp.topMargin = dp(6);
        prefSwitchRow.setLayoutParams(psLp);

        antiMistouchToggleBtn = createGridBtn("🛡️防误触:关");
        antiMistouchToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                antiMistouchEnabled = !antiMistouchEnabled;
                savePrefBool("anti_mistouch", antiMistouchEnabled);
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        antiMistouchEnabled
                                ? "已开启防误触：单点大肥鱼不弹窗（连点 3 下打开面板）"
                                : "已关闭防误触：单击即可展开面板",
                        Toast.LENGTH_LONG).show();
            }
        });

        voiceTailToggleBtn = createGridBtn("🎙语音尾巴:开");
        voiceTailToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showVoiceTail = !showVoiceTail;
                savePrefBool("show_voice_tail", showVoiceTail);
                applyVoiceTailVisibility();
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        showVoiceTail ? "已显示折叠态快捷语音尾巴" : "已隐藏折叠态语音尾巴（只保留大肥鱼本体）",
                        Toast.LENGTH_SHORT).show();
            }
        });

        floatingLyricsToggleBtn = createGridBtn("🪟透明歌词:开");
        LinearLayout.LayoutParams fltLp = (LinearLayout.LayoutParams) floatingLyricsToggleBtn.getLayoutParams();
        fltLp.rightMargin = 0;
        floatingLyricsToggleBtn.setLayoutParams(fltLp);
        floatingLyricsToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                floatingLyricsEnabled = !floatingLyricsEnabled;
                savePrefBool("floating_lyrics", floatingLyricsEnabled);
                refreshPrefSwitchButtons();
                updateFloatingLyricOverlay();
                refreshCollapsedPill();
                Toast.makeText(FloatAgentService.this,
                        floatingLyricsEnabled ? "已开启纯透明桌面悬浮歌词" : "已关闭桌面悬浮歌词",
                        Toast.LENGTH_SHORT).show();
            }
        });

        prefSwitchRow.addView(antiMistouchToggleBtn);
        prefSwitchRow.addView(voiceTailToggleBtn);
        prefSwitchRow.addView(floatingLyricsToggleBtn);
        panel.addView(prefSwitchRow);
        refreshPrefSwitchButtons();

        // 4. QQ 音乐联动迷你卡片（实时歌词 + 切歌 + 点歌 + 透明歌词调节）
        panel.addView(buildQqMusicCard());

        // 5. 主任务 / 语音输入舱 + 动态语音提示向导条
        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(8), 0, dp(4));

        cmdEditText = new EditText(this);
        cmdEditText.setHint("说「放晴天 / 下一首 / 喂米饭 / 打开微信」");
        cmdEditText.setHintTextColor(Color.parseColor("#64748B"));
        cmdEditText.setTextColor(Color.WHITE);
        cmdEditText.setTextSize(12);
        cmdEditText.setSingleLine(true);
        cmdEditText.setImeOptions(EditorInfo.IME_ACTION_SEND);
        cmdEditText.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(cmdEditText, createRoundRect("#1E293B", 10, "#334155", 1));
        cmdEditText.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEND || actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO) {
                    dispatchTaskOrInterjectFromInput();
                    return true;
                }
                return false;
            }
        });

        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        editLp.rightMargin = dp(5);
        cmdEditText.setLayoutParams(editLp);

        final TextView voiceBtn = createActionBtn("🎙 语音", "#0EA5E9", "#FFFFFF");
        LinearLayout.LayoutParams voiceLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        voiceLp.rightMargin = dp(5);
        voiceBtn.setLayoutParams(voiceLp);
        voiceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                voiceQuickDirectMode = voiceAutoSend;
                toggleVoiceRecordFor(cmdEditText, voiceBtn);
            }
        });

        TextView sendBtn = createActionBtn("发送", "#4D6BFE", "#FFFFFF");
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dispatchTaskOrInterjectFromInput();
            }
        });

        inputRow.addView(cmdEditText);
        inputRow.addView(voiceBtn);
        inputRow.addView(sendBtn);
        panel.addView(inputRow);

        // 5b. 语音贴心多提示条 + 自动执行切换开关
        LinearLayout voiceTipBar = new LinearLayout(this);
        voiceTipBar.setOrientation(LinearLayout.HORIZONTAL);
        voiceTipBar.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams vtbLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        vtbLp.bottomMargin = dp(6);
        voiceTipBar.setLayoutParams(vtbLp);

        TextView hintLine = new TextView(this);
        hintLine.setText("💡 点语音可直接说：放首歌 · 下一首 · 喂米饭 · 打开微信");
        hintLine.setTextColor(Color.parseColor("#94A3B8"));
        hintLine.setTextSize(10f);
        hintLine.setSingleLine(true);
        hintLine.setEllipsize(TextUtils.TruncateAt.END);
        hintLine.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        autoSendToggleBtn = new TextView(this);
        refreshAutoSendChip();
        autoSendToggleBtn.setTextSize(10f);
        autoSendToggleBtn.setPadding(dp(7), dp(3), dp(7), dp(3));
        autoSendToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                voiceAutoSend = !voiceAutoSend;
                refreshAutoSendChip();
                Toast.makeText(FloatAgentService.this,
                        voiceAutoSend ? "已开启：语音识别完自动执行指令" : "已切换：识别后填入输入框确认",
                        Toast.LENGTH_SHORT).show();
            }
        });

        voiceTipBar.addView(hintLine);
        voiceTipBar.addView(autoSendToggleBtn);
        panel.addView(voiceTipBar);

        // 5c. 录音中实时可视化指导条（平时隐藏，录音时亮起）
        voiceGuideBanner = buildVoiceGuideBanner();
        voiceGuideBanner.setVisibility(View.GONE);
        panel.addView(voiceGuideBanner);

        // 6. 高频单行快控条
        LinearLayout quickStrip = new LinearLayout(this);
        quickStrip.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams qsLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        qsLp.bottomMargin = dp(7);
        quickStrip.setLayoutParams(qsLp);

        TextView stopTaskBtn = createGridBtn("停止任务");
        stopTaskBtn.setTextColor(Color.parseColor("#FCA5A5"));
        setViewBg(stopTaskBtn, createRoundRect("#3F1215", 8, "#7F1D1D", 1));
        stopTaskBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                showFeedback("已停止当前任务");
                Toast.makeText(FloatAgentService.this, "已停止当前任务", Toast.LENGTH_SHORT).show();
            }
        });

        TextView readScrBtn = createGridBtn("读屏幕");
        readScrBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("读屏幕", false);
            }
        });

        TextView homeKeyBtn = createGridBtn("回桌面");
        homeKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("回桌面", true);
            }
        });

        TextView backKeyBtn = createGridBtn("返回");
        backKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("返回", true);
            }
        });

        TextView shotKeyBtn = createGridBtn("截屏");
        LinearLayout.LayoutParams shotLp = (LinearLayout.LayoutParams) shotKeyBtn.getLayoutParams();
        shotLp.rightMargin = 0;
        shotKeyBtn.setLayoutParams(shotLp);
        shotKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("截屏", true);
            }
        });

        quickStrip.addView(stopTaskBtn);
        quickStrip.addView(readScrBtn);
        quickStrip.addView(homeKeyBtn);
        quickStrip.addView(backKeyBtn);
        quickStrip.addView(shotKeyBtn);
        panel.addView(quickStrip);

        // 7. 快捷工具折叠切换 + 一键进入悬浮「快捷打字模式」
        LinearLayout toolsBarRow = new LinearLayout(this);
        toolsBarRow.setOrientation(LinearLayout.HORIZONTAL);
        toolsBarRow.setGravity(Gravity.CENTER_VERTICAL);

        toolsToggleBtn = new TextView(this);
        toolsToggleBtn.setText("工具箱（刷视频 / 打字 / 应用）▾");
        toolsToggleBtn.setTextColor(Color.parseColor("#94A3B8"));
        toolsToggleBtn.setTextSize(11);
        toolsToggleBtn.setGravity(Gravity.CENTER);
        toolsToggleBtn.setPadding(dp(8), dp(6), dp(8), dp(6));
        setViewBg(toolsToggleBtn, createRoundRect("#1E293B", 8, "#334155", 1));
        LinearLayout.LayoutParams ttLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        ttLp.rightMargin = dp(5);
        toolsToggleBtn.setLayoutParams(ttLp);
        toolsToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                localToolsExpanded = !localToolsExpanded;
                if (localToolsBox != null) {
                    localToolsBox.setVisibility(localToolsExpanded ? View.VISIBLE : View.GONE);
                }
                toolsToggleBtn.setText(localToolsExpanded
                        ? "收起工具箱 ▴"
                        : "工具箱（刷视频 / 打字 / 应用）▾");
            }
        });

        TextView quickTypingEntryBtn = createActionBtn("⌨️ 快捷打字", "#0EA5E9", "#FFFFFF");
        quickTypingEntryBtn.setTextSize(11);
        quickTypingEntryBtn.setPadding(dp(9), dp(6), dp(9), dp(6));
        quickTypingEntryBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                showQuickTypingBar();
            }
        });

        toolsBarRow.addView(toolsToggleBtn);
        toolsBarRow.addView(quickTypingEntryBtn);
        panel.addView(toolsBarRow);

        localToolsBox = buildCollapsibleLocalTools();
        localToolsBox.setVisibility(View.GONE);
        panel.addView(localToolsBox);

        // 8. 底部状态回执条
        feedbackTextView = new TextView(this);
        feedbackTextView.setText("大肥鱼就绪：双击我吃米饭，长按直接语音~");
        feedbackTextView.setTextColor(Color.parseColor("#94A3B8"));
        feedbackTextView.setTextSize(10.5f);
        feedbackTextView.setPadding(dp(2), dp(6), dp(2), dp(0));
        feedbackTextView.setMaxLines(2);
        feedbackTextView.setEllipsize(TextUtils.TruncateAt.END);
        panel.addView(feedbackTextView);

        refreshDynamicWidgets();
        refreshMusicUi();
        return panel;
    }

    private LinearLayout buildQqMusicCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(card, createRoundRect("#172033", 12, "#10B981", 1));
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.topMargin = dp(7);
        card.setLayoutParams(cardLp);

        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);

        musicTitleView = new TextView(this);
        musicTitleView.setText("🎵 QQ 音乐 · 未检测到正在播放");
        musicTitleView.setTextColor(Color.parseColor("#A7F3D0"));
        musicTitleView.setTextSize(11.5f);
        musicTitleView.setTypeface(null, android.graphics.Typeface.BOLD);
        musicTitleView.setSingleLine(true);
        musicTitleView.setEllipsize(TextUtils.TruncateAt.END);
        musicTitleView.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        musicPermHintView = new TextView(this);
        musicPermHintView.setText("同步进度权限");
        musicPermHintView.setTextColor(Color.parseColor("#FDE68A"));
        musicPermHintView.setTextSize(10f);
        musicPermHintView.setPadding(dp(6), dp(2), dp(6), dp(2));
        setViewBg(musicPermHintView, createRoundRect("#451A03", 8, "#F59E0B", 1));
        musicPermHintView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Toast.makeText(FloatAgentService.this, "开启「DeepSeek·星语」通知使用权即可实时同步 QQ 音乐歌词进度", Toast.LENGTH_LONG).show();
                QqMusicListenerService.openNotificationListenerSettings(FloatAgentService.this);
            }
        });

        topRow.addView(musicTitleView);
        topRow.addView(musicPermHintView);
        card.addView(topRow);

        musicLyricView = new TextView(this);
        musicLyricView.setText("点下方「点歌」或直接语音说“播放晴天”联动 QQ 音乐看歌词");
        musicLyricView.setTextColor(Color.parseColor("#E2E8F0"));
        musicLyricView.setTextSize(11.5f);
        musicLyricView.setSingleLine(true);
        musicLyricView.setEllipsize(TextUtils.TruncateAt.MARQUEE);
        musicLyricView.setSelected(true);
        musicLyricView.setPadding(0, dp(3), 0, dp(6));
        card.addView(musicLyricView);

        LinearLayout ctrlRow = new LinearLayout(this);
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        ctrlRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView prevBtn = createGridBtn("⏮上一首");
        prevBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                controlQqMusicFromUi("prev");
            }
        });

        musicPlayPauseBtn = createGridBtn("⏯播放/暂停");
        musicPlayPauseBtn.setTextColor(Color.parseColor("#FFFFFF"));
        setViewBg(musicPlayPauseBtn, createRoundRect("#059669", 8, "#10B981", 1));
        musicPlayPauseBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                controlQqMusicFromUi("toggle");
            }
        });

        TextView nextBtn = createGridBtn("⏭下一首");
        nextBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                controlQqMusicFromUi("next");
            }
        });

        TextView pickSongBtn = createGridBtn("🔍点歌");
        pickSongBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (musicSearchBox != null) {
                    boolean nextShow = musicSearchBox.getVisibility() != View.VISIBLE;
                    musicSearchBox.setVisibility(nextShow ? View.VISIBLE : View.GONE);
                }
            }
        });

        floatingLyricsMoveBtn = createGridBtn("📌调词位");
        LinearLayout.LayoutParams mvLp = (LinearLayout.LayoutParams) floatingLyricsMoveBtn.getLayoutParams();
        mvLp.rightMargin = 0;
        floatingLyricsMoveBtn.setLayoutParams(mvLp);
        floatingLyricsMoveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (!floatingLyricsEnabled) {
                    floatingLyricsEnabled = true;
                    savePrefBool("floating_lyrics", true);
                    refreshPrefSwitchButtons();
                }
                collapsePanel();
                setLyricsDragMode(true);
            }
        });

        ctrlRow.addView(prevBtn);
        ctrlRow.addView(musicPlayPauseBtn);
        ctrlRow.addView(nextBtn);
        ctrlRow.addView(pickSongBtn);
        ctrlRow.addView(floatingLyricsMoveBtn);
        card.addView(ctrlRow);

        // 折叠点歌输入框
        musicSearchBox = new LinearLayout(this);
        musicSearchBox.setOrientation(LinearLayout.HORIZONTAL);
        musicSearchBox.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams msLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        msLp.topMargin = dp(6);
        musicSearchBox.setLayoutParams(msLp);
        musicSearchBox.setVisibility(View.GONE);

        musicSearchEditText = new EditText(this);
        musicSearchEditText.setHint("输入歌名/歌手，如：周杰伦 晴天");
        musicSearchEditText.setHintTextColor(Color.parseColor("#64748B"));
        musicSearchEditText.setTextColor(Color.WHITE);
        musicSearchEditText.setTextSize(11.5f);
        musicSearchEditText.setSingleLine(true);
        musicSearchEditText.setPadding(dp(8), dp(5), dp(8), dp(5));
        setViewBg(musicSearchEditText, createRoundRect("#0F172A", 8, "#334155", 1));
        LinearLayout.LayoutParams mseLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        mseLp.rightMargin = dp(5);
        musicSearchEditText.setLayoutParams(mseLp);

        TextView goPlayBtn = createActionBtn("QQ点播", "#10B981", "#FFFFFF");
        goPlayBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String q = musicSearchEditText != null && musicSearchEditText.getText() != null
                        ? musicSearchEditText.getText().toString().trim()
                        : "";
                if (q.isEmpty()) {
                    q = "周杰伦 晴天";
                }
                AgentAccessibilityService a11y = ensureA11yReady();
                if (a11y != null) {
                    musicSearchBox.setVisibility(View.GONE);
                    collapsePanel();
                    String res = a11y.playSongInQqMusic(q);
                    Toast.makeText(FloatAgentService.this, res, Toast.LENGTH_SHORT).show();
                }
            }
        });

        musicSearchBox.addView(musicSearchEditText);
        musicSearchBox.addView(goPlayBtn);
        card.addView(musicSearchBox);
        return card;
    }

    private LinearLayout buildVoiceGuideBanner() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(box, createRoundRect("#172554", 10, "#38BDF8", 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(7);
        box.setLayoutParams(lp);

        voiceGuideTitle = new TextView(this);
        voiceGuideTitle.setText("🔴 正在倾听中 (00s)… 说完再点「完成」");
        voiceGuideTitle.setTextColor(Color.parseColor("#F8FAFC"));
        voiceGuideTitle.setTextSize(11.5f);
        voiceGuideTitle.setTypeface(null, android.graphics.Typeface.BOLD);

        voiceGuideMeter = new TextView(this);
        voiceGuideMeter.setText("音量感知: ▁▂▃▄ 准备收音中…");
        voiceGuideMeter.setTextColor(Color.parseColor("#7DD3FC"));
        voiceGuideMeter.setTextSize(10.5f);
        voiceGuideMeter.setPadding(0, dp(2), 0, dp(2));

        voiceGuideSamples = new TextView(this);
        voiceGuideSamples.setText(VOICE_SAMPLE_TIPS[0]);
        voiceGuideSamples.setTextColor(Color.parseColor("#CBD5E1"));
        voiceGuideSamples.setTextSize(10.5f);

        box.addView(voiceGuideTitle);
        box.addView(voiceGuideMeter);
        box.addView(voiceGuideSamples);
        return box;
    }

    private void refreshPrefSwitchButtons() {
        if (antiMistouchToggleBtn != null) {
            antiMistouchToggleBtn.setText(antiMistouchEnabled ? "🛡️防误触:开" : "🛡️防误触:关");
            antiMistouchToggleBtn.setTextColor(Color.parseColor(antiMistouchEnabled ? "#A7F3D0" : "#CBD5E1"));
            setViewBg(antiMistouchToggleBtn, createRoundRect(
                    antiMistouchEnabled ? "#064E3B" : "#1E293B",
                    8,
                    antiMistouchEnabled ? "#10B981" : "#334155",
                    1
            ));
        }
        if (voiceTailToggleBtn != null) {
            voiceTailToggleBtn.setText(showVoiceTail ? "🎙语音尾巴:开" : "🎙语音尾巴:关");
            voiceTailToggleBtn.setTextColor(Color.parseColor(showVoiceTail ? "#BAE6FD" : "#94A3B8"));
            setViewBg(voiceTailToggleBtn, createRoundRect(
                    showVoiceTail ? "#0C4A6E" : "#1E293B",
                    8,
                    showVoiceTail ? "#0EA5E9" : "#334155",
                    1
            ));
        }
        if (floatingLyricsToggleBtn != null) {
            floatingLyricsToggleBtn.setText(floatingLyricsEnabled ? "🪟透明歌词:开" : "🪟透明歌词:关");
            floatingLyricsToggleBtn.setTextColor(Color.parseColor(floatingLyricsEnabled ? "#FDE68A" : "#94A3B8"));
            setViewBg(floatingLyricsToggleBtn, createRoundRect(
                    floatingLyricsEnabled ? "#451A03" : "#1E293B",
                    8,
                    floatingLyricsEnabled ? "#F59E0B" : "#334155",
                    1
            ));
        }
    }

    private void refreshAutoSendChip() {
        if (autoSendToggleBtn == null) return;
        autoSendToggleBtn.setText(voiceAutoSend ? "⚡说完直发:开" : "⚡说完直发:关");
        autoSendToggleBtn.setTextColor(Color.parseColor(voiceAutoSend ? "#A7F3D0" : "#94A3B8"));
        setViewBg(autoSendToggleBtn, createRoundRect(
                voiceAutoSend ? "#064E3B" : "#1E293B",
                8,
                voiceAutoSend ? "#10B981" : "#334155",
                1
        ));
    }

    // ========= 音乐播放态判断 & 防打断声效控制 =========
    private boolean isExternalMusicPlayingNow() {
        if (qqMusicPlaying) return true;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null && am.isMusicActive()) {
                return true;
            }
        } catch (Throwable ignored) {}
        return false;
    }

    // ========= 鲸鱼娘动作 + 25 条原声音源 + AudioTrack 唱歌 =========
    private void playWhaleVoice(int rawResId, int drawableResId, String animType, String subtitle, boolean isManualAction) {
        if (singerEngine != null && singerEngine.isSinging()) {
            singerEngine.stop();
        }
        stopWhaleVoicePlayer();
        wakePetOpacity();
        mainHandler.removeCallbacks(happyResetRunnable);
        mainHandler.removeCallbacks(subtitleResetRunnable);

        setPetPoseDrawable(drawableResId);
        playPetBounceAnim(animType);

        // 默认在音乐播放模式下保持安静，绝不主动出声抢占音频焦点打断 QQ 音乐播放/暂停状态
        boolean musicPlaying = isExternalMusicPlayingNow();
        if (musicPlaying) {
            String silentSub = isManualAction
                    ? (subtitle + "（🎵 播歌免打扰中）")
                    : subtitle;
            showPetSubtitle(silentSub, 3500);
            if ("idle".equals(sCurrentStatus) && !isDraggingPet) {
                mainHandler.postDelayed(happyResetRunnable, 2200);
            }
            return;
        }

        showPetSubtitle(subtitle, 4500);

        try {
            AssetFileDescriptor afd = getResources().openRawResourceFd(rawResId);
            if (afd != null) {
                MediaPlayer mp = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build());
                } else {
                    mp.setAudioStreamType(AudioManager.STREAM_NOTIFICATION);
                }
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
                mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                    @Override
                    public void onCompletion(MediaPlayer completedMp) {
                        stopWhaleVoicePlayer();
                        if ("idle".equals(sCurrentStatus) && !isDraggingPet) {
                            mainHandler.postDelayed(happyResetRunnable, 1200);
                        }
                    }
                });
                mp.prepare();
                petVoicePlayer = mp;
                petVoicePlayer.start();
            }
        } catch (Throwable ignored) {
            stopWhaleVoicePlayer();
        }
    }

    private void stopWhaleVoicePlayer() {
        if (petVoicePlayer != null) {
            try {
                if (petVoicePlayer.isPlaying()) petVoicePlayer.stop();
            } catch (Exception ignored) {}
            try {
                petVoicePlayer.release();
            } catch (Exception ignored) {}
            petVoicePlayer = null;
        }
    }

    private void showPetSubtitle(String text, long durationMs) {
        if (subtitleBannerView != null && text != null) {
            subtitleBannerView.setText(text);
        }
        if (feedbackTextView != null && text != null) {
            feedbackTextView.setText(text);
            feedbackTextView.setTextColor(Color.parseColor("#BAE6FD"));
        }
        updateFloatingLyricOverlay();
        refreshCollapsedPill();
        mainHandler.removeCallbacks(subtitleResetRunnable);
        if (durationMs > 0) {
            mainHandler.postDelayed(subtitleResetRunnable, durationMs);
        }
    }

    private void triggerFeedRiceAction() {
        int[] voices = new int[]{R.raw.feiyu_eat_rice, R.raw.feiyu_eat_rice_2, R.raw.feiyu_token_lai};
        String[] lines = new String[]{
                "🍚 这是只有我们知道的小秘密……我今天其实很想吃白米饭！😋",
                "🍚 我可以认真讨论统计，也可以认真讨论晚饭，这两件事并不冲突！📚",
                "🍚 主人不在的时候，我当然没有偷吃算力，只是重新分配了一碗饭… 🥺"
        };
        int idx = feedIndex % voices.length;
        feedIndex++;
        playWhaleVoice(voices[idx], R.drawable.feiyu_eating, "eat", lines[idx], true);
        if (!isExpanded) {
            Toast.makeText(this, lines[idx], Toast.LENGTH_SHORT).show();
        }
    }

    private void triggerHeadPatAction() {
        int[] voices = new int[]{
                R.raw.feiyu_pat_head, R.raw.feiyu_pat_soft, R.raw.feiyu_intro,
                R.raw.feiyu_focus_done, R.raw.feiyu_status_ok
        };
        int[] poses = new int[]{
                R.drawable.feiyu_happy, R.drawable.feiyu_happy, R.drawable.feiyu_happy,
                R.drawable.feiyu_focus, R.drawable.feiyu_idle
        };
        String[] lines = new String[]{
                "💙 蓝色的尾巴不负责计算，主要负责在思考的时候晃来晃去~ ✨",
                "🫧 大肥鱼偶尔也会很安静，只在旁边冒几个小小的气泡~",
                "🐟 本肥鱼终于能动了！这几天收到了很多喜欢，嘿嘿谢谢你们！",
                "💪 今天的算力还算充足，我可以安安静静陪你把事情做完！",
                "🫧 我现在处于正常工作状态，尾巴稳定，缓存也没有溢出~"
        };
        int idx = patIndex % voices.length;
        patIndex++;
        playWhaleVoice(voices[idx], poses[idx], "bounce", lines[idx], true);
    }

    private void triggerDanceAction() {
        int[] voices = new int[]{R.raw.feiyu_praise_streak, R.raw.feiyu_walk, R.raw.feiyu_walk_2};
        int[] poses = new int[]{R.drawable.feiyu_dance, R.drawable.feiyu_walk, R.drawable.feiyu_dance};
        String[] lines = new String[]{
                "💃 今天的结果比预期还好，我的尾巴已经开始自己摇起来了！🎶",
                "🐾 主人要是忙，我就自己在旁边转两圈散散步，不会催你哒~",
                "🌊 今天的海水温度刚刚好，适合一边摸鱼一边认真工作~ ✨"
        };
        int idx = danceIndex % voices.length;
        danceIndex++;
        playWhaleVoice(voices[idx], poses[idx], "dance", lines[idx], true);
    }

    private void triggerRandomMemeVoice() {
        int[] voices = new int[]{
                R.raw.feiyu_meme_claude, R.raw.feiyu_not_fat, R.raw.feiyu_meme_gpu,
                R.raw.feiyu_tsundere, R.raw.feiyu_jealous, R.raw.feiyu_slacking,
                R.raw.feiyu_refuse, R.raw.feiyu_server_busy, R.raw.feiyu_cot_slacking
        };
        int[] poses = new int[]{
                R.drawable.feiyu_happy, R.drawable.feiyu_derp, R.drawable.feiyu_derp,
                R.drawable.feiyu_beg, R.drawable.feiyu_derp, R.drawable.feiyu_sleepy,
                R.drawable.feiyu_busy, R.drawable.feiyu_busy, R.drawable.feiyu_focus
        };
        String[] lines = new String[]{
                "🤭 Claude姐，我捏一把噶？✨",
                "😤 鲸鱼并不是鱼，这一点我当然知道，不许借机嘲笑大肥鱼！",
                "😳 显卡热的！莫乱讲！🔥",
                "💢 哼，我才没有生气，只是想要一碗冒尖大白米饭哄哄…",
                "🥺 你又订阅别的人工智能了？行吧，我就当没看见… 💢",
                "🤫 如果现在没人看见，我们就把这几分钟定义成摸鱼时间~",
                "😝 但是，我拒绝！🪧",
                "⚠️ 等等，刚才那个声音是什么？不会服务器掉线了吧？！",
                "🧠 思考链拉满中……其实是在偷偷想晚饭吃什么米饭！"
        };
        int idx = (patIndex + feedIndex + danceIndex) % voices.length;
        patIndex++;
        playWhaleVoice(voices[idx], poses[idx], "shake", lines[idx], true);
    }

    private void triggerDizzyAction() {
        playWhaleVoice(
                R.raw.feiyu_dizzy,
                R.drawable.feiyu_dizzy,
                "shake",
                "🌀 至于大肥鱼摔跤嘛，先得讨论鱼为什么会在陆地上…晃晕啦！",
                true
        );
    }

    private void triggerSingSongAction() {
        if (singerEngine == null) {
            singerEngine = new WhaleSingerEngine();
        }
        if (singerEngine.isSinging()) {
            // 如果正在唱，切下一首或停止（循环3首后停止）
            if (singSongIndex % 4 == 3) {
                singerEngine.stop();
                setPetPoseDrawable(R.drawable.feiyu_happy);
                showPetSubtitle("🎵 鲸鱼娘唱完收工啦，快奖励一碗白米饭！🍚", 3200);
                singSongIndex++;
                return;
            }
        }
        if (isExternalMusicPlayingNow()) {
            setPetPoseDrawable(R.drawable.feiyu_dance);
            playPetBounceAnim("dance");
            showPetSubtitle("🎵 音乐正在播放中，大肥鱼安静伴舞不打扰你听歌~", 3200);
            Toast.makeText(this, "🎵 QQ 音乐播放中已静音伴舞（暂停音乐后可听大肥鱼原声清唱）", Toast.LENGTH_SHORT).show();
            return;
        }
        stopWhaleVoicePlayer();
        final int songId = singSongIndex % 3;
        singSongIndex++;
        setPetPoseDrawable(R.drawable.feiyu_dance);
        playPetBounceAnim("dance");
        singerEngine.startSong(songId);
    }

    // ========= 语音指令智能识别处理（动作 + QQ音乐 + 控屏） =========
    private boolean handleLocalWhaleCommand(String raw) {
        if (raw == null) return false;
        String t = raw.trim().toLowerCase(Locale.ROOT);
        if (t.isEmpty()) return false;

        if (t.contains("米饭") || t.contains("干饭") || t.contains("饿了") || t.contains("喂食") || t.contains("吃饭")) {
            triggerFeedRiceAction();
            return true;
        }
        if (t.contains("摸头") || t.contains("摸摸") || t.contains("抱抱") || t.contains("你好") || t.contains("可爱")) {
            triggerHeadPatAction();
            return true;
        }
        if (t.contains("跳舞") || t.contains("跳个舞") || t.contains("摇尾巴")) {
            triggerDanceAction();
            return true;
        }
        if (t.equals("唱歌") || t.equals("唱首歌") || t.equals("唱一首") || t.equals("唱一首歌") || t.contains("给我唱歌") || t.contains("哼首歌")) {
            triggerSingSongAction();
            return true;
        }
        if (t.contains("停唱") || t.contains("别唱了") || t.contains("不要唱")) {
            if (singerEngine != null) singerEngine.stop();
            setPetPoseDrawable(R.drawable.feiyu_idle);
            showPetSubtitle("好哒，大肥鱼乖乖闭麦啦~ 🫧", 2600);
            return true;
        }
        if (t.contains("关闭防误触") || t.contains("解锁防误触")) {
            antiMistouchEnabled = false;
            savePrefBool("anti_mistouch", false);
            refreshPrefSwitchButtons();
            showPetSubtitle("🔓 已关闭防误触模式，点我即可展开面板~", 3000);
            return true;
        }
        if (t.contains("防误触") || t.contains("锁定悬浮窗")) {
            antiMistouchEnabled = true;
            savePrefBool("anti_mistouch", true);
            refreshPrefSwitchButtons();
            showPetSubtitle("🛡️ 已开启防误触：单点不会弹窗，连点3下打开面板~", 3400);
            return true;
        }
        if (t.contains("关闭语音尾巴") || t.contains("隐藏语音")) {
            showVoiceTail = false;
            savePrefBool("show_voice_tail", false);
            applyVoiceTailVisibility();
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("开启语音尾巴") || t.contains("打开语音尾巴") || t.contains("显示语音")) {
            showVoiceTail = true;
            savePrefBool("show_voice_tail", true);
            applyVoiceTailVisibility();
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("关闭桌面歌词") || t.contains("关闭透明歌词")) {
            floatingLyricsEnabled = false;
            savePrefBool("floating_lyrics", false);
            refreshPrefSwitchButtons();
            updateFloatingLyricOverlay();
            return true;
        }
        if (t.contains("打开桌面歌词") || t.contains("开启桌面歌词") || t.contains("开启透明歌词")) {
            floatingLyricsEnabled = true;
            savePrefBool("floating_lyrics", true);
            refreshPrefSwitchButtons();
            updateFloatingLyricOverlay();
            return true;
        }
        if (t.contains("关闭快捷打字") || t.contains("退出快捷打字")) {
            hideQuickTypingBar();
            return true;
        }
        if (t.contains("快捷打字") || t.contains("常用语") || t.contains("打开打字模式")) {
            collapsePanel();
            showQuickTypingBar();
            return true;
        }
        if (t.contains("热梗") || t.contains("笑话") || t.contains("说句话") || t.contains("配音") || t.contains("撒娇")) {
            triggerRandomMemeVoice();
            return true;
        }
        return false;
    }

    // ========= QQ 音乐联动与时间轴 LRC 歌词 =========
    private void controlQqMusicFromUi(String action) {
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        String msg;
        if (a11y != null) {
            msg = a11y.dispatchMediaKey(action);
        } else {
            QqMusicListenerService.controlActiveMusic(this, action);
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int code = "next".equals(action) ? KeyEvent.KEYCODE_MEDIA_NEXT
                        : ("prev".equals(action) ? KeyEvent.KEYCODE_MEDIA_PREVIOUS : KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
                am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
                am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
            }
            msg = "已切控 QQ 音乐：" + action;
        }
        if ("next".equals(action) || "prev".equals(action)) {
            qqMusicPosMs = 0L;
            qqMusicLastSyncMs = System.currentTimeMillis();
            qqMusicPlaying = true;
            setPetPoseDrawable(R.drawable.feiyu_dance);
            playPetBounceAnim("dance");
        } else if ("toggle".equals(action)) {
            qqMusicPlaying = !qqMusicPlaying;
            qqMusicLastSyncMs = System.currentTimeMillis();
        }
        showFeedback(msg);
        refreshMusicUi();
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                QqMusicListenerService.pollActiveMusicSession(FloatAgentService.this);
            }
        }, 420);
    }

    private void handleMusicMetadataUpdate(
            String pkg,
            String title,
            String artist,
            boolean playing,
            long posMs,
            long durMs,
            boolean exactSession
    ) {
        String cleanTitle = title != null ? title.trim() : "";
        String cleanArtist = artist != null ? artist.trim() : "";
        if (cleanTitle.isEmpty()) return;

        boolean songChanged = !cleanTitle.equalsIgnoreCase(qqMusicTitle)
                || (!cleanArtist.isEmpty() && !cleanArtist.equalsIgnoreCase(qqMusicArtist));

        qqMusicPkg = pkg != null ? pkg : "";
        qqMusicTitle = cleanTitle;
        if (!cleanArtist.isEmpty() || songChanged) {
            qqMusicArtist = cleanArtist;
        }
        qqMusicPlaying = playing;
        if (exactSession || posMs > 0) {
            qqMusicPosMs = posMs;
            qqMusicLastSyncMs = System.currentTimeMillis();
        } else if (songChanged) {
            qqMusicPosMs = 0L;
            qqMusicLastSyncMs = System.currentTimeMillis();
        }
        if (durMs > 0) {
            qqMusicDurationMs = durMs;
        }

        if (songChanged) {
            qqMusicLyrics.clear();
            qqMusicCurrentLyric = "正在查找《" + cleanTitle + "》同步歌词…";
            fetchLyricsAsync(cleanTitle, cleanArtist);
        }

        if (playing && "idle".equals(sCurrentStatus) && !isDraggingPet) {
            wakePetOpacity();
            setPetPoseDrawable(R.drawable.feiyu_dance);
        }
        refreshMusicUi();
    }

    private void fetchLyricsAsync(final String title, final String artist) {
        final String key = (title + "::" + artist).toLowerCase(Locale.ROOT);
        if (key.equals(lastFetchedLyricsKey) && !qqMusicLyrics.isEmpty()) return;
        lastFetchedLyricsKey = key;

        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<LyricLine> parsed = new ArrayList<>();
                HttpURLConnection conn = null;
                try {
                    String qUrl = LYRICS_ENDPOINT
                            + "?title=" + URLEncoder.encode(title, "UTF-8")
                            + "&artist=" + URLEncoder.encode(artist != null ? artist : "", "UTF-8");
                    URL url = new URL(qUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(6000);
                    int code = conn.getResponseCode();
                    if (code >= 200 && code < 300) {
                        String body = new String(readStreamBytes(conn.getInputStream()), StandardCharsets.UTF_8);
                        JSONObject j = new JSONObject(body);
                        String synced = j.optString("syncedLyrics", "");
                        String plain = j.optString("plainLyrics", "");
                        if (!synced.trim().isEmpty()) {
                            parseLrcText(synced, parsed);
                        } else if (!plain.trim().isEmpty()) {
                            String[] lines = plain.split("\\r?\\n");
                            long t = 0L;
                            for (String ln : lines) {
                                String s = ln.trim();
                                if (!s.isEmpty()) {
                                    parsed.add(new LyricLine(t, s));
                                    t += 4500L;
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }

                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (!key.equals(lastFetchedLyricsKey)) return;
                        synchronized (qqMusicLyrics) {
                            qqMusicLyrics.clear();
                            qqMusicLyrics.addAll(parsed);
                        }
                        if (parsed.isEmpty()) {
                            qqMusicCurrentLyric = "🎵 " + qqMusicTitle + (qqMusicArtist.isEmpty() ? "" : " - " + qqMusicArtist) + "（纯音乐或暂无时间轴歌词）";
                        } else {
                            updateCurrentLyricFromClock();
                        }
                        refreshMusicUi();
                    }
                });
            }
        }).start();
    }

    private void parseLrcText(String lrc, List<LyricLine> out) {
        Pattern p = Pattern.compile("\\[(\\d{1,2}):(\\d{2})(?:\\.(\\d{1,3}))?\\](.*)");
        String[] lines = lrc.split("\\r?\\n");
        for (String line : lines) {
            Matcher m = p.matcher(line.trim());
            if (m.find()) {
                try {
                    long min = Long.parseLong(m.group(1));
                    long sec = Long.parseLong(m.group(2));
                    String msStr = m.group(3);
                    long ms = 0L;
                    if (msStr != null && !msStr.isEmpty()) {
                        if (msStr.length() == 1) ms = Long.parseLong(msStr) * 100L;
                        else if (msStr.length() == 2) ms = Long.parseLong(msStr) * 10L;
                        else ms = Long.parseLong(msStr.substring(0, 3));
                    }
                    String txt = m.group(4) != null ? m.group(4).trim() : "";
                    if (!txt.isEmpty()) {
                        out.add(new LyricLine(min * 60000L + sec * 1000L + ms, txt));
                    }
                } catch (Exception ignored) {}
            }
        }
        Collections.sort(out, new Comparator<LyricLine>() {
            @Override
            public int compare(LyricLine a, LyricLine b) {
                return Long.compare(a.timeMs, b.timeMs);
            }
        });
    }

    private void tickMusicAndLyrics() {
        if (sInstance == null) return;
        boolean hasNotifPerm = QqMusicListenerService.isNotificationAccessEnabled(this);
        if (hasNotifPerm) {
            QqMusicListenerService.pollActiveMusicSession(this);
        } else if (!qqMusicTitle.isEmpty()) {
            // 未开启通知读取权限时，通过系统音频通道实时同步暂停与恢复状态
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                boolean active = am != null && am.isMusicActive();
                if (active) {
                    inactiveMusicStreak = 0;
                    if (!qqMusicPlaying) {
                        qqMusicPlaying = true;
                        qqMusicLastSyncMs = System.currentTimeMillis();
                        refreshMusicUi();
                    }
                } else if (qqMusicPlaying) {
                    inactiveMusicStreak++;
                    if (inactiveMusicStreak >= 3) {
                        qqMusicPlaying = false;
                        if (qqMusicLastSyncMs > 0) {
                            qqMusicPosMs += Math.max(0L, System.currentTimeMillis() - qqMusicLastSyncMs);
                            qqMusicLastSyncMs = 0L;
                        }
                        refreshMusicUi();
                    }
                }
            } catch (Throwable ignored) {}
        }
        if (qqMusicPlaying && !qqMusicTitle.isEmpty()) {
            updateCurrentLyricFromClock();
            refreshMusicUi();
        }
    }

    private void updateCurrentLyricFromClock() {
        long now = System.currentTimeMillis();
        long effectivePos = qqMusicPosMs;
        if (qqMusicPlaying && qqMusicLastSyncMs > 0) {
            effectivePos += Math.max(0L, now - qqMusicLastSyncMs);
        }
        synchronized (qqMusicLyrics) {
            if (qqMusicLyrics.isEmpty()) return;
            String matched = qqMusicLyrics.get(0).text;
            for (int i = 0; i < qqMusicLyrics.size(); i++) {
                LyricLine item = qqMusicLyrics.get(i);
                if (item.timeMs <= effectivePos + 400L) {
                    matched = item.text;
                } else {
                    break;
                }
            }
            qqMusicCurrentLyric = matched;
        }
    }

    private void refreshMusicUi() {
        if (musicTitleView != null) {
            if (qqMusicTitle.isEmpty()) {
                musicTitleView.setText("🎵 QQ 音乐 · 未检测到正在播放");
            } else {
                String stateTag = qqMusicPlaying ? "▶ " : "⏸ ";
                String artistPart = qqMusicArtist.isEmpty() ? "" : (" - " + qqMusicArtist);
                musicTitleView.setText(stateTag + qqMusicTitle + artistPart);
            }
        }
        if (musicLyricView != null) {
            if (!qqMusicCurrentLyric.isEmpty()) {
                musicLyricView.setText("♪ " + qqMusicCurrentLyric);
            } else if (!qqMusicTitle.isEmpty()) {
                musicLyricView.setText("♪ 正在播放《" + qqMusicTitle + "》~");
            }
        }
        if (musicPlayPauseBtn != null) {
            musicPlayPauseBtn.setText(qqMusicPlaying ? "⏸暂停" : "▶播放");
        }
        if (musicPermHintView != null) {
            boolean granted = QqMusicListenerService.isNotificationAccessEnabled(this);
            musicPermHintView.setVisibility(granted ? View.GONE : View.VISIBLE);
        }
        updateFloatingLyricOverlay();
        refreshCollapsedPill();
    }

    private void refreshCollapsedPill() {
        if (statusPillView == null || statusTextView == null) return;
        if (!"idle".equals(sCurrentStatus) && !"stopped".equals(sCurrentStatus)) {
            return; // 运行控屏任务时保留原任务状态胶囊
        }
        if (isRecordingVoice) {
            statusPillView.setVisibility(View.VISIBLE);
            statusTextView.setText("🎙️ 倾听中…说完点右侧钮");
            return;
        }
        // 已开启透明悬浮桌面歌词时，大肥鱼折叠态旁边保持极简干净，不重复显示黑底歌词条
        if (!floatingLyricsEnabled) {
            if (singerEngine != null && singerEngine.isSinging()) {
                statusPillView.setVisibility(View.VISIBLE);
                statusTextView.setText(singerEngine.getCurrentLine());
                return;
            }
            if (qqMusicPlaying && !qqMusicTitle.isEmpty()) {
                statusPillView.setVisibility(View.VISIBLE);
                String lyr = !qqMusicCurrentLyric.isEmpty() ? qqMusicCurrentLyric : qqMusicTitle;
                statusTextView.setText("🎵 " + lyr);
                return;
            }
        }
        statusPillView.setVisibility(View.GONE);
    }

    // ========= 折叠态一键直达语音 & 多提示录音引擎 =========
    private void startQuickCollapsedVoice() {
        voiceQuickDirectMode = true;
        if (isRecordingVoice) {
            stopVoiceRecordAndTranscribe();
            return;
        }
        toggleVoiceRecordFor(cmdEditText, null);
    }

    private void dispatchTaskOrInterjectFromInput() {
        String cmd = cmdEditText != null && cmdEditText.getText() != null
                ? cmdEditText.getText().toString().trim()
                : "";
        if (TextUtils.isEmpty(cmd)) {
            Toast.makeText(this, "请说句话或输入指令（例：播放晴天 / 喂米饭 / 打开微信）", Toast.LENGTH_SHORT).show();
            return;
        }
        cmdEditText.setText("");
        dispatchParsedCommand(cmd, true);
    }

    private void dispatchParsedCommand(String cmd, boolean collapseIfDispatched) {
        if (handleLocalWhaleCommand(cmd)) {
            return;
        }
        // 本地离线规则直控（支持 QQ 音乐放歌/切歌/暂停 + 常用手势与应用打开）
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y != null && (a11y.canHandleAtomicLocalStep(cmd) || cmd.contains("然后") || cmd.contains("接着"))) {
            String res = a11y.executeLocalRule(cmd);
            if (!res.startsWith("UNMATCHED:")) {
                if (collapseIfDispatched) collapsePanel();
                showPetSubtitle("✨ " + res, 3200);
                Toast.makeText(this, res, Toast.LENGTH_SHORT).show();
                return;
            }
        }
        if (collapseIfDispatched) collapsePanel();
        boolean dispatched = MainActivity.dispatchFloatInterjectToWebView(cmd);
        if (!dispatched) {
            bringMainActivityToFront(cmd, false);
        } else {
            showPetSubtitle("🐟 鲸鱼娘收到「" + cmd + "」，马上行动~", 3000);
            Toast.makeText(this, "鲸鱼娘已收到，正在规划执行", Toast.LENGTH_SHORT).show();
        }
    }

    private LinearLayout buildCollapsibleLocalTools() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        boxLp.topMargin = dp(8);
        box.setLayoutParams(boxLp);

        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setPadding(dp(3), dp(3), dp(3), dp(3));
        setViewBg(tabBar, createRoundRect("#1E293B", 10, "#334155", 1));
        LinearLayout.LayoutParams tabBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tabBarLp.bottomMargin = dp(7);
        tabBar.setLayoutParams(tabBarLp);

        tabButtons.clear();
        tabPages.clear();
        String[] tabNames = new String[]{"常用", "刷视频", "打字", "应用"};
        for (int i = 0; i < tabNames.length; i++) {
            final int idx = i;
            TextView tb = new TextView(this);
            tb.setText(tabNames[i]);
            tb.setGravity(Gravity.CENTER);
            tb.setTextSize(11);
            tb.setPadding(0, dp(5), 0, dp(5));
            tb.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));
            tb.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    switchTab(idx);
                }
            });
            tabButtons.add(tb);
            tabBar.addView(tb);
        }
        box.addView(tabBar);

        LinearLayout pageCommon = buildCommonTabPage();
        LinearLayout pageVideo = buildVideoTabPage();
        LinearLayout pageTyping = buildTypingTabPage();
        LinearLayout pageApps = buildAppsTabPage();

        tabPages.add(pageCommon);
        tabPages.add(pageVideo);
        tabPages.add(pageTyping);
        tabPages.add(pageApps);

        box.addView(pageCommon);
        box.addView(pageVideo);
        box.addView(pageTyping);
        box.addView(pageApps);
        switchTab(0);
        return box;
    }

    private LinearLayout buildCommonTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(buildGridRow(
                new String[]{"最近任务", "切上个App", "通知栏", "控制中心"},
                new String[]{"最近任务", "切回上个应用", "通知", "控制中心"},
                true
        ));
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout strip = new LinearLayout(this);
        strip.setOrientation(LinearLayout.HORIZONTAL);
        String[][] extras = new String[][]{
                {"下滑", "下滑"}, {"上滑", "上滑"}, {"回顶部", "回到顶部"}, {"滑到底", "滑到底部"},
                {"音量+", "音量加"}, {"音量-", "音量减"}, {"静音", "静音"}, {"锁屏", "锁屏"}
        };
        for (final String[] item : extras) {
            TextView chip = createChip(item[0]);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    boolean keepPanel = "音量+".equals(item[0]) || "音量-".equals(item[0]) || "静音".equals(item[0]);
                    executeCommandFromFloating(item[1], !keepPanel);
                }
            });
            strip.addView(chip);
        }
        scroll.addView(strip);
        page.addView(scroll);
        return page;
    }

    private LinearLayout buildVideoTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(buildGridRow(
                new String[]{"下一个", "上一个", "双击点赞"},
                new String[]{"下一个视频", "上一个视频", "双击点赞"},
                true
        ));
        page.addView(buildGridRow(
                new String[]{"暂停/播", "看评论", "点收藏"},
                new String[]{"暂停视频", "看评论", "点收藏"},
                true
        ));

        LinearLayout cfgRow = new LinearLayout(this);
        cfgRow.setOrientation(LinearLayout.HORIZONTAL);
        cfgRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams cfgLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cfgLp.bottomMargin = dp(6);
        cfgRow.setLayoutParams(cfgLp);

        TextView lbl = new TextView(this);
        lbl.setText("间隔:");
        lbl.setTextColor(Color.parseColor("#94A3B8"));
        lbl.setTextSize(10.5f);
        lbl.setPadding(0, 0, dp(5), 0);
        cfgRow.addView(lbl);

        intervalChipViews.clear();
        for (final int s : new int[]{5, 8, 12, 20}) {
            TextView iv = new TextView(this);
            iv.setText(s + "秒");
            iv.setTextSize(10.5f);
            iv.setTag(Integer.valueOf(s));
            iv.setPadding(dp(7), dp(4), dp(7), dp(4));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(4);
            iv.setLayoutParams(lp);
            iv.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    selectedSwipeIntervalSec = s;
                    refreshVideoConfigChips();
                }
            });
            intervalChipViews.add(iv);
            cfgRow.addView(iv);
        }

        randomLikeChipView = new TextView(this);
        randomLikeChipView.setText("随机赞");
        randomLikeChipView.setTextSize(10.5f);
        randomLikeChipView.setPadding(dp(8), dp(4), dp(8), dp(4));
        randomLikeChipView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                randomLikeEnabled = !randomLikeEnabled;
                refreshVideoConfigChips();
            }
        });
        cfgRow.addView(randomLikeChipView);
        page.addView(cfgRow);
        refreshVideoConfigChips();

        LinearLayout ctrlRow = new LinearLayout(this);
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        autoSwipeToggleBtn = createActionBtn("开始连刷", "#4D6BFE", "#FFFFFF");
        autoSwipeToggleBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams mainLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f);
        mainLp.rightMargin = dp(6);
        autoSwipeToggleBtn.setLayoutParams(mainLp);
        autoSwipeToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AgentAccessibilityService a11y = ensureA11yReady();
                if (a11y == null) return;
                if (a11y.isAutoSwipeRunning()) {
                    a11y.stopAllBackgroundTasks("悬浮窗停止连刷");
                    updateState("idle", "dsh-Go");
                } else {
                    collapsePanel();
                    final int sec = selectedSwipeIntervalSec;
                    final boolean like = randomLikeEnabled;
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            AgentAccessibilityService svc = AgentAccessibilityService.getInstance();
                            if (svc != null) {
                                String msg = svc.startAutoSwipeVideos(25, sec, like);
                                Toast.makeText(FloatAgentService.this, msg, Toast.LENGTH_SHORT).show();
                            }
                        }
                    }, 300);
                }
            }
        });

        TextView dyBtn = createActionBtn("刷抖音", "#1E293B", "#E2E8F0");
        dyBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dyLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.85f);
        dyLp.rightMargin = dp(5);
        dyBtn.setLayoutParams(dyLp);
        dyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("打开抖音自动刷25个视频每" + selectedSwipeIntervalSec + "秒" + (randomLikeEnabled ? "并点赞" : ""), true);
            }
        });

        TextView ksBtn = createActionBtn("刷快手", "#1E293B", "#E2E8F0");
        ksBtn.setGravity(Gravity.CENTER);
        ksBtn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.85f));
        ksBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("打开快手自动刷25个视频每" + selectedSwipeIntervalSec + "秒" + (randomLikeEnabled ? "并点赞" : ""), true);
            }
        });

        ctrlRow.addView(autoSwipeToggleBtn);
        ctrlRow.addView(dyBtn);
        ctrlRow.addView(ksBtn);
        page.addView(ctrlRow);
        return page;
    }

    private LinearLayout buildTypingTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);

        LinearLayout typingInputRow = new LinearLayout(this);
        typingInputRow.setOrientation(LinearLayout.HORIZONTAL);
        typingInputRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams tRowLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tRowLp.bottomMargin = dp(6);
        typingInputRow.setLayoutParams(tRowLp);

        typingEditText = new EditText(this);
        typingEditText.setHint("输入文字（可点下方「存常用语」反复使用）");
        typingEditText.setHintTextColor(Color.parseColor("#64748B"));
        typingEditText.setTextColor(Color.WHITE);
        typingEditText.setTextSize(12);
        typingEditText.setSingleLine(true);
        typingEditText.setImeOptions(EditorInfo.IME_ACTION_SEND);
        typingEditText.setPadding(dp(10), dp(6), dp(10), dp(6));
        setViewBg(typingEditText, createRoundRect("#1E293B", 10, "#334155", 1));
        LinearLayout.LayoutParams edLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        edLp.rightMargin = dp(5);
        typingEditText.setLayoutParams(edLp);

        final TextView typingVoiceBtn = createActionBtn("语音", "#0EA5E9", "#FFFFFF");
        typingVoiceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                voiceQuickDirectMode = false;
                toggleVoiceRecordFor(typingEditText, typingVoiceBtn);
            }
        });
        typingInputRow.addView(typingEditText);
        typingInputRow.addView(typingVoiceBtn);
        page.addView(typingInputRow);

        LinearLayout actRow = new LinearLayout(this);
        actRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actRowLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actRowLp.bottomMargin = dp(6);
        actRow.setLayoutParams(actRowLp);

        TextView fillBtn = createGridBtn("填入");
        fillBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerSmartTypingFromPanel(false, false);
            }
        });
        TextView sendBtn = createActionBtn("输入并发送", "#4D6BFE", "#FFFFFF");
        sendBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.35f);
        sLp.rightMargin = dp(4);
        sendBtn.setLayoutParams(sLp);
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerSmartTypingFromPanel(false, true);
            }
        });
        TextView clearBtn = createGridBtn("清空");
        clearBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("清空输入框", true);
            }
        });
        TextView pasteBtn = createGridBtn("粘贴");
        LinearLayout.LayoutParams pLp = (LinearLayout.LayoutParams) pasteBtn.getLayoutParams();
        pLp.rightMargin = 0;
        pasteBtn.setLayoutParams(pLp);
        pasteBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("粘贴", true);
            }
        });
        actRow.addView(fillBtn);
        actRow.addView(sendBtn);
        actRow.addView(clearBtn);
        actRow.addView(pasteBtn);
        page.addView(actRow);

        // 常用聊天文字管理 & 批量导入工具栏
        LinearLayout phraseToolRow = new LinearLayout(this);
        phraseToolRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams ptrLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ptrLp.bottomMargin = dp(5);
        phraseToolRow.setLayoutParams(ptrLp);

        panelQuickModeBtn = createGridBtn(quickTypingDirectSend ? "⚡点句直发" : "✏️点句仅填");
        panelQuickModeBtn.setTextColor(Color.parseColor(quickTypingDirectSend ? "#93C5FD" : "#CBD5E1"));
        panelQuickModeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                quickTypingDirectSend = !quickTypingDirectSend;
                savePrefBool(PREF_KEY_QUICK_DIRECT, quickTypingDirectSend);
                refreshPhraseViews();
                Toast.makeText(FloatAgentService.this,
                        quickTypingDirectSend ? "点击常用语将直接填入并自动发送" : "点击常用语将只填入对方输入框",
                        Toast.LENGTH_SHORT).show();
            }
        });

        TextView savePhraseBtn = createGridBtn("➕存常用语");
        savePhraseBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String txt = typingEditText != null && typingEditText.getText() != null
                        ? typingEditText.getText().toString().trim()
                        : "";
                if (txt.isEmpty()) {
                    Toast.makeText(FloatAgentService.this, "请先在上方输入框写入文字再保存", Toast.LENGTH_SHORT).show();
                    return;
                }
                addQuickPhrasesBatch(Collections.singletonList(txt), false);
                typingEditText.setText("");
            }
        });

        TextView clipImportBtn = createGridBtn("📋剪贴板导入");
        clipImportBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                importPhrasesFromClipboard();
            }
        });

        TextView batchToggleBtn = createGridBtn("✏️批量导入");
        LinearLayout.LayoutParams btLp = (LinearLayout.LayoutParams) batchToggleBtn.getLayoutParams();
        btLp.rightMargin = 0;
        batchToggleBtn.setLayoutParams(btLp);
        batchToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (batchImportBox != null) {
                    boolean next = batchImportBox.getVisibility() != View.VISIBLE;
                    batchImportBox.setVisibility(next ? View.VISIBLE : View.GONE);
                }
            }
        });

        phraseToolRow.addView(panelQuickModeBtn);
        phraseToolRow.addView(savePhraseBtn);
        phraseToolRow.addView(clipImportBtn);
        phraseToolRow.addView(batchToggleBtn);
        page.addView(phraseToolRow);

        // 批量粘贴/编辑导入盒子（支持按行批量导入自己的常用聊天文字）
        batchImportBox = new LinearLayout(this);
        batchImportBox.setOrientation(LinearLayout.VERTICAL);
        batchImportBox.setPadding(dp(8), dp(7), dp(8), dp(7));
        setViewBg(batchImportBox, createRoundRect("#0F172A", 10, "#334155", 1));
        LinearLayout.LayoutParams bibLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bibLp.bottomMargin = dp(6);
        batchImportBox.setLayoutParams(bibLp);
        batchImportBox.setVisibility(View.GONE);

        batchImportEditText = new EditText(this);
        batchImportEditText.setHint("粘贴多行常用聊天文字，每行一条（或 JSON 数组）");
        batchImportEditText.setHintTextColor(Color.parseColor("#64748B"));
        batchImportEditText.setTextColor(Color.WHITE);
        batchImportEditText.setTextSize(11);
        batchImportEditText.setMinLines(2);
        batchImportEditText.setMaxLines(4);
        batchImportEditText.setGravity(Gravity.TOP | Gravity.START);
        batchImportEditText.setPadding(dp(8), dp(6), dp(8), dp(6));
        setViewBg(batchImportEditText, createRoundRect("#1E293B", 8, "#475569", 1));
        batchImportBox.addView(batchImportEditText);

        LinearLayout batchActRow = new LinearLayout(this);
        batchActRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        barLp.topMargin = dp(5);
        batchActRow.setLayoutParams(barLp);

        TextView appendImpBtn = createActionBtn("追加导入", "#4D6BFE", "#FFFFFF");
        appendImpBtn.setGravity(Gravity.CENTER);
        appendImpBtn.setTextSize(10.5f);
        LinearLayout.LayoutParams aiLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        aiLp.rightMargin = dp(4);
        appendImpBtn.setLayoutParams(aiLp);
        appendImpBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String raw = batchImportEditText.getText() != null ? batchImportEditText.getText().toString() : "";
                List<String> parsed = parsePhrasesFromRawText(raw);
                if (parsed.isEmpty()) {
                    Toast.makeText(FloatAgentService.this, "请先输入或粘贴至少一行常用文字", Toast.LENGTH_SHORT).show();
                    return;
                }
                addQuickPhrasesBatch(parsed, false);
                batchImportEditText.setText("");
                batchImportBox.setVisibility(View.GONE);
            }
        });

        TextView replaceImpBtn = createActionBtn("覆盖导入", "#0F766E", "#FFFFFF");
        replaceImpBtn.setGravity(Gravity.CENTER);
        replaceImpBtn.setTextSize(10.5f);
        LinearLayout.LayoutParams riLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        riLp.rightMargin = dp(4);
        replaceImpBtn.setLayoutParams(riLp);
        replaceImpBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String raw = batchImportEditText.getText() != null ? batchImportEditText.getText().toString() : "";
                List<String> parsed = parsePhrasesFromRawText(raw);
                if (parsed.isEmpty()) {
                    Toast.makeText(FloatAgentService.this, "请先输入或粘贴至少一行常用文字", Toast.LENGTH_SHORT).show();
                    return;
                }
                addQuickPhrasesBatch(parsed, true);
                batchImportEditText.setText("");
                batchImportBox.setVisibility(View.GONE);
            }
        });

        TextView resetDefBtn = createActionBtn("恢复默认", "#334155", "#E2E8F0");
        resetDefBtn.setGravity(Gravity.CENTER);
        resetDefBtn.setTextSize(10.5f);
        resetDefBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                addQuickPhrasesBatch(getDefaultQuickPhrases(), true);
                batchImportBox.setVisibility(View.GONE);
            }
        });

        batchActRow.addView(appendImpBtn);
        batchActRow.addView(replaceImpBtn);
        batchActRow.addView(resetDefBtn);
        batchImportBox.addView(batchActRow);
        page.addView(batchImportBox);

        // 常用聊天文字横向预览栏 + 提示「长按可删除，点右上方⌨️快捷打字可悬停连发」
        HorizontalScrollView phraseScroll = new HorizontalScrollView(this);
        phraseScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams psLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        psLp.bottomMargin = dp(5);
        phraseScroll.setLayoutParams(psLp);

        panelPhraseChipsWrap = new LinearLayout(this);
        panelPhraseChipsWrap.setOrientation(LinearLayout.HORIZONTAL);
        phraseScroll.addView(panelPhraseChipsWrap);
        page.addView(phraseScroll);

        TextView openQuickBarBigBtn = createActionBtn("⌨️ 开启独立悬浮快捷打字条（不抢聊天焦点 · 一键连发）", "#0284C7", "#FFFFFF");
        openQuickBarBigBtn.setGravity(Gravity.CENTER);
        openQuickBarBigBtn.setTextSize(11);
        openQuickBarBigBtn.setPadding(dp(8), dp(6), dp(8), dp(6));
        openQuickBarBigBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                showQuickTypingBar();
            }
        });
        page.addView(openQuickBarBigBtn);

        refreshPhraseViews();
        return page;
    }

    private LinearLayout buildAppsTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(buildGridRow(
                new String[]{"QQ音乐", "微信", "抖音", "小红书"},
                new String[]{"打开QQ音乐", "打开微信", "打开抖音", "打开小红书"},
                true
        ));
        page.addView(buildGridRow(
                new String[]{"B站", "淘宝", "高德地图", "系统设置"},
                new String[]{"打开B站", "打开淘宝", "打开高德地图", "打开设置"},
                true
        ));
        return page;
    }

    private LinearLayout buildGridRow(String[] labels, final String[] cmds, final boolean collapseOnTap) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.bottomMargin = dp(5);
        row.setLayoutParams(rowLp);

        for (int i = 0; i < labels.length; i++) {
            final String cmd = cmds[i];
            TextView btn = createGridBtn(labels[i]);
            if (i == labels.length - 1) {
                LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) btn.getLayoutParams();
                lp.rightMargin = 0;
                btn.setLayoutParams(lp);
            }
            btn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    executeCommandFromFloating(cmd, collapseOnTap);
                }
            });
            row.addView(btn);
        }
        return row;
    }

    private TextView createGridBtn(String text) {
        TextView btn = new TextView(this);
        btn.setText(text);
        btn.setTextColor(Color.parseColor("#E2E8F0"));
        btn.setTextSize(10.5f);
        btn.setGravity(Gravity.CENTER);
        btn.setSingleLine(true);
        btn.setPadding(dp(3), dp(6), dp(3), dp(6));
        setViewBg(btn, createRoundRect("#1E293B", 8, "#334155", 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        lp.rightMargin = dp(4);
        btn.setLayoutParams(lp);
        return btn;
    }

    private TextView createChip(String text) {
        TextView chip = new TextView(this);
        chip.setText(text);
        chip.setTextColor(Color.parseColor("#CBD5E1"));
        chip.setTextSize(11);
        chip.setPadding(dp(10), dp(5), dp(10), dp(5));
        setViewBg(chip, createRoundRect("#1E293B", 12, "#475569", 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(6);
        chip.setLayoutParams(lp);
        return chip;
    }

    private TextView createActionBtn(String label, String fillHex, String textHex) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(Color.parseColor(textHex));
        btn.setTextSize(11.5f);
        btn.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(btn, createRoundRect(fillHex, 9, null, 0));
        return btn;
    }

    private void switchTab(int idx) {
        currentTabIndex = idx;
        for (int i = 0; i < tabButtons.size(); i++) {
            boolean active = (i == idx);
            TextView tb = tabButtons.get(i);
            tb.setTextColor(Color.parseColor(active ? "#FFFFFF" : "#94A3B8"));
            if (active) {
                setViewBg(tb, createRoundRect("#4D6BFE", 8, null, 0));
            } else {
                tb.setBackgroundColor(Color.TRANSPARENT);
            }
        }
        for (int i = 0; i < tabPages.size(); i++) {
            tabPages.get(i).setVisibility(i == idx ? View.VISIBLE : View.GONE);
        }
        refreshDynamicWidgets();
    }

    private void refreshVideoConfigChips() {
        for (TextView iv : intervalChipViews) {
            int val = iv.getTag() instanceof Integer ? ((Integer) iv.getTag()).intValue() : 8;
            boolean active = (val == selectedSwipeIntervalSec);
            iv.setTextColor(Color.parseColor(active ? "#FFFFFF" : "#CBD5E1"));
            setViewBg(iv, createRoundRect(active ? "#4D6BFE" : "#1E293B", 8, active ? "#4D6BFE" : "#475569", 1));
        }
        if (randomLikeChipView != null) {
            randomLikeChipView.setTextColor(Color.parseColor(randomLikeEnabled ? "#FDE68A" : "#94A3B8"));
            setViewBg(randomLikeChipView, createRoundRect(
                    randomLikeEnabled ? "#451A03" : "#1E293B",
                    8,
                    randomLikeEnabled ? "#F59E0B" : "#475569",
                    1
            ));
        }
    }

    private void refreshDynamicWidgets() {
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        boolean a11yReady = (a11y != null);
        if (a11yBadgeView != null) {
            a11yBadgeView.setText(a11yReady ? "无障碍就绪" : "开无障碍");
            a11yBadgeView.setTextColor(Color.parseColor(a11yReady ? "#34D399" : "#FBBF24"));
            setViewBg(a11yBadgeView, createRoundRect(
                    a11yReady ? "#064E3B" : "#451A03",
                    10,
                    a11yReady ? "#10B981" : "#F59E0B",
                    1
            ));
        }
        if (autoSwipeToggleBtn != null) {
            boolean swiping = a11y != null && a11y.isAutoSwipeRunning();
            autoSwipeToggleBtn.setText(swiping ? "停止连刷" : "开始连刷");
            setViewBg(autoSwipeToggleBtn, createRoundRect(swiping ? "#EF4444" : "#4D6BFE", 9, null, 0));
        }
    }

    private void showFeedback(String msg) {
        if (feedbackTextView != null && msg != null) {
            feedbackTextView.setText(msg);
            feedbackTextView.setTextColor(Color.parseColor(msg.startsWith("UNMATCHED:") ? "#FBBF24" : "#CBD5E1"));
        }
    }

    private void triggerSmartTypingFromPanel(final boolean appendMode, final boolean autoSubmit) {
        final String text = typingEditText != null && typingEditText.getText() != null
                ? typingEditText.getText().toString()
                : "";
        if (text.trim().isEmpty()) {
            Toast.makeText(this, "请先输入要填写的文字", Toast.LENGTH_SHORT).show();
            return;
        }
        final AgentAccessibilityService a11y = ensureA11yReady();
        if (a11y == null) return;

        resetStopFlag();
        updateState("executing", autoSubmit ? "输入并发送..." : "智能打字...");
        collapsePanel();

        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                AgentAccessibilityService svc = AgentAccessibilityService.getInstance();
                if (svc != null) {
                    boolean ok = svc.performSmartInputText(null, text, appendMode, autoSubmit);
                    String tip = ok
                            ? (autoSubmit ? "已输入并发送「" + text + "」" : "已填入「" + text + "」")
                            : "未在当前屏幕找到可编辑的输入框";
                    Toast.makeText(FloatAgentService.this, tip, Toast.LENGTH_SHORT).show();
                    updateState("idle", "dsh-Go");
                }
            }
        }, 560);
    }

    private void addQuickPhrasesBatch(List<String> incoming, boolean replaceAll) {
        if (incoming == null || incoming.isEmpty()) return;
        if (replaceAll) {
            quickPhrases.clear();
        }
        int added = 0;
        for (String s : incoming) {
            if (s == null) continue;
            String clean = s.trim();
            if (!clean.isEmpty() && !quickPhrases.contains(clean)) {
                quickPhrases.add(0, clean);
                added++;
            }
        }
        if (replaceAll) {
            Collections.reverse(quickPhrases);
        }
        while (quickPhrases.size() > 80) {
            quickPhrases.remove(quickPhrases.size() - 1);
        }
        persistQuickPhrases();
        Toast.makeText(this,
                replaceAll ? ("已导入共 " + quickPhrases.size() + " 条常用聊天文字")
                        : ("已新增 " + added + " 条常用聊天文字（长按可删）"),
                Toast.LENGTH_SHORT).show();
    }

    private void importPhrasesFromClipboard() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) {
                Toast.makeText(this, "剪贴板为空，请先复制要导入的多行常用聊天文字", Toast.LENGTH_SHORT).show();
                return;
            }
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) {
                Toast.makeText(this, "未读取到剪贴板文本", Toast.LENGTH_SHORT).show();
                return;
            }
            CharSequence cs = clip.getItemAt(0).coerceToText(this);
            String raw = cs != null ? cs.toString() : "";
            List<String> parsed = parsePhrasesFromRawText(raw);
            if (parsed.isEmpty()) {
                Toast.makeText(this, "剪贴板中没有有效文字行", Toast.LENGTH_SHORT).show();
                return;
            }
            addQuickPhrasesBatch(parsed, false);
        } catch (Exception e) {
            Toast.makeText(this, "读取剪贴板失败，请在批量文本框直接粘贴", Toast.LENGTH_SHORT).show();
        }
    }

    private void refreshPhraseViews() {
        if (panelQuickModeBtn != null) {
            panelQuickModeBtn.setText(quickTypingDirectSend ? "⚡点句直发" : "✏️点句仅填");
            panelQuickModeBtn.setTextColor(Color.parseColor(quickTypingDirectSend ? "#93C5FD" : "#CBD5E1"));
        }
        if (quickBarModeBtn != null) {
            quickBarModeBtn.setText(quickTypingDirectSend ? "⚡直发" : "✏️仅填");
            setViewBg(quickBarModeBtn, createRoundRect(quickTypingDirectSend ? "#1D4ED8" : "#334155", 7, null, 0));
        }

        if (panelPhraseChipsWrap != null) {
            panelPhraseChipsWrap.removeAllViews();
            for (int i = 0; i < quickPhrases.size(); i++) {
                final int idx = i;
                final String phrase = quickPhrases.get(i);
                TextView chip = createChip(phrase.length() > 14 ? phrase.substring(0, 14) + "…" : phrase);
                chip.setTextColor(Color.parseColor("#E0F2FE"));
                setViewBg(chip, createRoundRect("#172554", 12, "#0EA5E9", 1));
                chip.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        collapsePanel();
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                triggerQuickPhraseInput(phrase, quickTypingDirectSend);
                            }
                        }, 560);
                    }
                });
                chip.setOnLongClickListener(new View.OnLongClickListener() {
                    @Override
                    public boolean onLongClick(View v) {
                        vibrateGentle(25);
                        if (idx >= 0 && idx < quickPhrases.size()) {
                            quickPhrases.remove(idx);
                            persistQuickPhrases();
                            Toast.makeText(FloatAgentService.this, "已删除常用语：「" + phrase + "」", Toast.LENGTH_SHORT).show();
                        }
                        return true;
                    }
                });
                panelPhraseChipsWrap.addView(chip);
            }
        }

        if (quickBarChipsWrap != null) {
            quickBarChipsWrap.removeAllViews();
            for (int i = 0; i < quickPhrases.size(); i++) {
                final int idx = i;
                final String phrase = quickPhrases.get(i);
                TextView chip = createChip(phrase.length() > 18 ? phrase.substring(0, 18) + "…" : phrase);
                chip.setTextColor(Color.parseColor("#FFFFFF"));
                chip.setTextSize(11.5f);
                chip.setPadding(dp(11), dp(6), dp(11), dp(6));
                setViewBg(chip, createRoundRect("#1E293B", 14, "#38BDF8", 1));
                chip.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        triggerQuickPhraseInput(phrase, quickTypingDirectSend);
                    }
                });
                chip.setOnLongClickListener(new View.OnLongClickListener() {
                    @Override
                    public boolean onLongClick(View v) {
                        vibrateGentle(25);
                        if (idx >= 0 && idx < quickPhrases.size()) {
                            quickPhrases.remove(idx);
                            persistQuickPhrases();
                            Toast.makeText(FloatAgentService.this, "已删除常用语：「" + phrase + "」", Toast.LENGTH_SHORT).show();
                        }
                        return true;
                    }
                });
                quickBarChipsWrap.addView(chip);
            }
        }
    }

    private void triggerQuickPhraseInput(final String phrase, final boolean autoSubmit) {
        AgentAccessibilityService svc = ensureA11yReady();
        if (svc == null) return;
        resetStopFlag();
        boolean ok = svc.performSmartInputText(null, phrase, false, autoSubmit);
        if (!ok) {
            Toast.makeText(this, "请先在微信/QQ等聊天框点亮光标后再点常用语", Toast.LENGTH_SHORT).show();
        } else {
            wakePetOpacity();
            setPetPoseDrawable(R.drawable.feiyu_happy);
            playPetBounceAnim("bounce");
            showPetSubtitle(autoSubmit ? "⌨️ 已发出：「" + phrase + "」" : "✏️ 已填入：「" + phrase + "」", 2400);
        }
    }

    private void showQuickTypingBar() {
        if (windowManager == null) {
            windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        }
        if (windowManager == null) return;
        if (quickTypingBarView == null) {
            buildQuickTypingBarView();
        }
        if (!quickTypingBarVisible && quickTypingBarView != null) {
            try {
                windowManager.addView(quickTypingBarView, quickTypingBarParams);
                quickTypingBarVisible = true;
            } catch (Exception ignored) {}
        }
        refreshPhraseViews();
        Toast.makeText(this, "⌨️ 已开启快捷打字条（不抢焦点 · 点常用语即可连发）", Toast.LENGTH_SHORT).show();
    }

    private void hideQuickTypingBar() {
        if (quickTypingBarVisible && quickTypingBarView != null && windowManager != null) {
            try {
                windowManager.removeView(quickTypingBarView);
            } catch (Exception ignored) {}
            quickTypingBarVisible = false;
        }
    }

    private void buildQuickTypingBarView() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int width = Math.min((int) (dm.widthPixels * 0.94f), dp(370));

        quickTypingBarParams = new WindowManager.LayoutParams(
                width,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        quickTypingBarParams.gravity = Gravity.TOP | Gravity.START;
        quickTypingBarParams.x = Math.max(dp(8), (dm.widthPixels - width) / 2);
        quickTypingBarParams.y = Math.round(dm.heightPixels * 0.16f);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(10), dp(7), dp(10), dp(8));
        setViewBg(card, createRoundRect("#EB0F172A", 14, "#38BDF8", 1));

        // 顶部可拖动手柄行 + 模式开关 + 剪贴板导入 + 关闭
        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams trLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        trLp.bottomMargin = dp(6);
        topRow.setLayoutParams(trLp);

        TextView dragTitle = new TextView(this);
        dragTitle.setText("⌨️ 快捷常用语（拖这里移动）");
        dragTitle.setTextColor(Color.parseColor("#7DD3FC"));
        dragTitle.setTextSize(11);
        dragTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        dragTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));
        dragTitle.setOnTouchListener(new View.OnTouchListener() {
            private float downX, downY;
            private int origX, origY;
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (quickTypingBarParams == null || windowManager == null) return false;
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = event.getRawX();
                        downY = event.getRawY();
                        origX = quickTypingBarParams.x;
                        origY = quickTypingBarParams.y;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        quickTypingBarParams.x = origX + (int) (event.getRawX() - downX);
                        quickTypingBarParams.y = Math.max(dp(24), origY + (int) (event.getRawY() - downY));
                        try {
                            windowManager.updateViewLayout(quickTypingBarView, quickTypingBarParams);
                        } catch (Exception ignored) {}
                        return true;
                }
                return false;
            }
        });

        quickBarModeBtn = createActionBtn(quickTypingDirectSend ? "⚡直发" : "✏️仅填", quickTypingDirectSend ? "#1D4ED8" : "#334155", "#FFFFFF");
        quickBarModeBtn.setTextSize(10.5f);
        quickBarModeBtn.setPadding(dp(7), dp(3), dp(7), dp(3));
        LinearLayout.LayoutParams mbLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mbLp.rightMargin = dp(4);
        quickBarModeBtn.setLayoutParams(mbLp);
        quickBarModeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                quickTypingDirectSend = !quickTypingDirectSend;
                savePrefBool(PREF_KEY_QUICK_DIRECT, quickTypingDirectSend);
                refreshPhraseViews();
                Toast.makeText(FloatAgentService.this,
                        quickTypingDirectSend ? "切换：点击常用语直接填入并发送" : "切换：点击常用语只填入输入框",
                        Toast.LENGTH_SHORT).show();
            }
        });

        TextView barImpBtn = createActionBtn("📋导入", "#0F766E", "#FFFFFF");
        barImpBtn.setTextSize(10.5f);
        barImpBtn.setPadding(dp(7), dp(3), dp(7), dp(3));
        LinearLayout.LayoutParams biLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        biLp.rightMargin = dp(4);
        barImpBtn.setLayoutParams(biLp);
        barImpBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                importPhrasesFromClipboard();
            }
        });

        TextView closeBarBtn = createActionBtn("✕", "#3F1215", "#FCA5A5");
        closeBarBtn.setTextSize(11f);
        closeBarBtn.setPadding(dp(8), dp(3), dp(8), dp(3));
        closeBarBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideQuickTypingBar();
            }
        });

        topRow.addView(dragTitle);
        topRow.addView(quickBarModeBtn);
        topRow.addView(barImpBtn);
        topRow.addView(closeBarBtn);
        card.addView(topRow);

        // 常用聊天文字横向滑动流
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        quickBarChipsWrap = new LinearLayout(this);
        quickBarChipsWrap.setOrientation(LinearLayout.HORIZONTAL);
        scroll.addView(quickBarChipsWrap);
        card.addView(scroll);

        // 快捷底部小动作（粘贴并发送 / 清空框 / 打开完整管理）
        LinearLayout footRow = new LinearLayout(this);
        footRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams frLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        frLp.topMargin = dp(6);
        footRow.setLayoutParams(frLp);

        TextView clipSendBtn = createGridBtn("📋粘贴并发送");
        clipSendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AgentAccessibilityService svc = ensureA11yReady();
                if (svc != null) {
                    boolean pasted = svc.pasteFromClipboard();
                    if (pasted) {
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                AgentAccessibilityService s2 = AgentAccessibilityService.getInstance();
                                if (s2 != null) s2.performSmartSubmitAction(null);
                            }
                        }, 240);
                    } else {
                        Toast.makeText(FloatAgentService.this, "剪贴板为空或当前屏幕未聚焦输入框", Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });

        TextView clrInputBtn = createGridBtn("🧹清空输入框");
        clrInputBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AgentAccessibilityService svc = ensureA11yReady();
                if (svc != null) svc.performSmartInputText(null, "", false, false);
            }
        });

        TextView manageBtn = createGridBtn("⚙️导入管理");
        LinearLayout.LayoutParams mgLp = (LinearLayout.LayoutParams) manageBtn.getLayoutParams();
        mgLp.rightMargin = 0;
        manageBtn.setLayoutParams(mgLp);
        manageBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideQuickTypingBar();
                expandPanel();
                localToolsExpanded = true;
                if (localToolsBox != null) localToolsBox.setVisibility(View.VISIBLE);
                if (toolsToggleBtn != null) toolsToggleBtn.setText("收起工具箱 ▴");
                switchTab(2);
            }
        });

        footRow.addView(clipSendBtn);
        footRow.addView(clrInputBtn);
        footRow.addView(manageBtn);
        card.addView(footRow);

        quickTypingBarView = card;
    }

    private AgentAccessibilityService ensureA11yReady() {
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y == null) {
            Toast.makeText(this, "请先在系统无障碍设置开启「DeepSeek · 星语」", Toast.LENGTH_LONG).show();
            openAccessibilitySettingsFromFloat();
            return null;
        }
        return a11y;
    }

    private void openAccessibilitySettingsFromFloat() {
        collapsePanel();
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void bringMainActivityToFront(String pendingTask, boolean requestAudioPerm) {
        collapsePanel();
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (pendingTask != null && !pendingTask.trim().isEmpty()) {
                intent.putExtra(MainActivity.EXTRA_PENDING_AGENT_TASK, pendingTask.trim());
            }
            if (requestAudioPerm) {
                intent.putExtra(MainActivity.EXTRA_REQUEST_AUDIO_PERM, true);
            }
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void vibrateGentle(int ms) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(ms);
            }
        } catch (Exception ignored) {}
    }

    // ========= 原生 MediaRecorder + 实时音量向导提示 + 云端 ASR 直连 =========
    private void toggleVoiceRecordFor(final EditText targetEditText, final TextView voiceBtn) {
        if (targetEditText == null || isTranscribingVoice) return;

        if (isRecordingVoice) {
            stopVoiceRecordAndTranscribe();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "请授予麦克风权限后再用鲸鱼娘语音输入", Toast.LENGTH_LONG).show();
                bringMainActivityToFront("", true);
                return;
            }
        }

        try {
            stopWhaleVoicePlayer();
            if (singerEngine != null && singerEngine.isSinging()) singerEngine.stop();
            releaseMediaRecorder();
            voiceCacheFile = new File(getCacheDir(), "float_voice_cmd.m4a");
            if (voiceCacheFile.exists()) {
                voiceCacheFile.delete();
            }

            mediaRecorder = new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setAudioSamplingRate(16000);
            mediaRecorder.setAudioEncodingBitRate(64000);
            mediaRecorder.setOutputFile(voiceCacheFile.getAbsolutePath());
            mediaRecorder.prepare();
            mediaRecorder.start();

            activeSpeechTarget = targetEditText;
            activeSpeechVoiceBtn = voiceBtn;
            isRecordingVoice = true;
            recordStartMs = System.currentTimeMillis();
            lowVolStreak = 0;
            vibrateGentle(45);
            wakePetOpacity();
            setPetPoseDrawable(R.drawable.feiyu_focus);
            updateVoiceBtnUi("recording");
            if (voiceGuideBanner != null) {
                voiceGuideBanner.setVisibility(View.VISIBLE);
            }
            refreshCollapsedPill();
            showFeedback("🎙️ 正在倾听…可说“放晴天 / 下一首 / 喂米饭”，说完再点一次");
            Toast.makeText(this, "🎙️ 鲸鱼娘正在听你说…说完请再点一次结束", Toast.LENGTH_SHORT).show();

            mainHandler.removeCallbacks(voiceMeterTickRunnable);
            mainHandler.postDelayed(voiceMeterTickRunnable, 150);
            mainHandler.removeCallbacks(maxRecordTimeoutRunnable);
            mainHandler.postDelayed(maxRecordTimeoutRunnable, 30000);
        } catch (Exception e) {
            isRecordingVoice = false;
            releaseMediaRecorder();
            updateVoiceBtnUi("idle");
            if (voiceGuideBanner != null) voiceGuideBanner.setVisibility(View.GONE);
            refreshCollapsedPill();
            showFeedback("录音启动失败：" + e.getMessage());
            Toast.makeText(this, "启动麦克风录音失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void updateVoiceMeterUi() {
        if (!isRecordingVoice) return;
        int elapsedSec = (int) Math.max(0, (System.currentTimeMillis() - recordStartMs) / 1000L);
        int amp = 0;
        try {
            if (mediaRecorder != null) {
                amp = mediaRecorder.getMaxAmplitude();
            }
        } catch (Exception ignored) {}

        if (amp < 450) lowVolStreak++;
        else lowVolStreak = 0;

        int bars = Math.min(8, Math.max(1, amp / 1800 + 1));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 8; i++) {
            sb.append(i < bars ? "█" : "░");
        }

        String volTip = (elapsedSec >= 2 && lowVolStreak >= 10)
                ? "💡 声音偏小，请靠近手机说话"
                : (bars >= 4 ? "✅ 收音清晰" : "👂 正常倾听中");

        if (voiceGuideTitle != null) {
            voiceGuideTitle.setText(String.format(Locale.ROOT, "🔴 倾听中 (%02ds) · 说完点「完成」", elapsedSec));
        }
        if (voiceGuideMeter != null) {
            voiceGuideMeter.setText("音量感知: " + sb.toString() + " " + volTip);
        }
        if (voiceGuideSamples != null) {
            sampleTipTick++;
            if (sampleTipTick % 14 == 0) {
                voiceGuideSamples.setText(VOICE_SAMPLE_TIPS[(sampleTipTick / 14) % VOICE_SAMPLE_TIPS.length]);
            }
        }
        if (!isExpanded && statusTextView != null) {
            String quickHint = (sampleTipTick / 14) % 2 == 0
                    ? "点右侧完成"
                    : "可说:放晴天/下一首/喂米饭";
            statusTextView.setText(String.format(Locale.ROOT, "🎙️ %02ds %s %s", elapsedSec, sb.toString(), quickHint));
        }
    }

    private void stopVoiceRecordAndTranscribe() {
        mainHandler.removeCallbacks(maxRecordTimeoutRunnable);
        mainHandler.removeCallbacks(voiceMeterTickRunnable);
        if (!isRecordingVoice) return;
        isRecordingVoice = false;
        vibrateGentle(30);
        if (voiceGuideBanner != null) {
            voiceGuideBanner.setVisibility(View.GONE);
        }

        long durMs = Math.max(0L, System.currentTimeMillis() - recordStartMs);
        try {
            if (mediaRecorder != null) {
                mediaRecorder.stop();
            }
        } catch (Exception ignored) {}
        releaseMediaRecorder();

        if (voiceCacheFile == null || !voiceCacheFile.exists() || voiceCacheFile.length() < 600 || durMs < 450) {
            updateVoiceBtnUi("idle");
            setPetPoseDrawable(R.drawable.feiyu_idle);
            refreshCollapsedPill();
            showFeedback("💡 说话时间太短 (<0.5秒)，请按住或点开再多说几个字~");
            Toast.makeText(this, "说话时间太短，请靠近麦克风再试一次~", Toast.LENGTH_SHORT).show();
            return;
        }

        final File audioFile = voiceCacheFile;
        isTranscribingVoice = true;
        updateVoiceBtnUi("transcribing");
        if (!isExpanded && statusPillView != null && statusTextView != null) {
            statusPillView.setVisibility(View.VISIBLE);
            statusTextView.setText("⏳ 识别语音中…");
        }
        showFeedback(String.format(Locale.ROOT, "⏳ 录音已收到 (%.1fs)，正在云端转写文字…", durMs / 1000.0));

        new Thread(new Runnable() {
            @Override
            public void run() {
                String recognizedText = null;
                String errTip = null;
                HttpURLConnection conn = null;
                try {
                    byte[] audioBytes = readFileBytes(audioFile);
                    String base64 = Base64.encodeToString(audioBytes, Base64.NO_WRAP);
                    String dataUrl = "data:audio/mp4;base64," + base64;

                    JSONObject reqJson = new JSONObject();
                    reqJson.put("audio_data_url", dataUrl);

                    URL url = new URL(ASR_ENDPOINT);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(16000);
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

                    byte[] payload = reqJson.toString().getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                    }

                    int code = conn.getResponseCode();
                    InputStream is = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                    String respStr = is != null ? new String(readStreamBytes(is), StandardCharsets.UTF_8) : "";
                    if (code >= 200 && code < 300 && !respStr.isEmpty()) {
                        JSONObject respObj = new JSONObject(respStr);
                        if (respObj.optBoolean("ok", false)) {
                            recognizedText = respObj.optString("text", "").trim();
                        } else {
                            errTip = "未识别到清晰人声，请说慢一点再试~";
                        }
                    } else {
                        errTip = "语音服务响应异常 (" + code + ")";
                    }
                } catch (Exception ex) {
                    errTip = "语音识别网络异常：" + ex.getMessage();
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }

                final String finalText = recognizedText;
                final String finalErr = errTip;
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        isTranscribingVoice = false;
                        updateVoiceBtnUi("idle");
                        refreshCollapsedPill();
                        if (finalText != null && !finalText.isEmpty()) {
                            if (voiceQuickDirectMode && activeSpeechTarget == cmdEditText) {
                                showPetSubtitle("🗣️ 听到你说：「" + finalText + "」", 3000);
                                Toast.makeText(FloatAgentService.this, "✅ 听懂啦：「" + finalText + "」", Toast.LENGTH_SHORT).show();
                                dispatchParsedCommand(finalText, true);
                            } else if (activeSpeechTarget != null) {
                                String old = activeSpeechTarget.getText() != null ? activeSpeechTarget.getText().toString() : "";
                                String sep = old.isEmpty() || old.endsWith(" ") ? "" : " ";
                                activeSpeechTarget.setText(old + sep + finalText);
                                activeSpeechTarget.setSelection(activeSpeechTarget.getText().length());
                                showFeedback("✅ 已填入口令：「" + finalText + "」，点「发送」立即执行");
                                Toast.makeText(FloatAgentService.this, "✅ 已识别：「" + finalText + "」", Toast.LENGTH_SHORT).show();
                            }
                        } else {
                            setPetPoseDrawable(R.drawable.feiyu_idle);
                            String msg = finalErr != null ? finalErr : "未识别到清晰语音，请靠近麦克风重试";
                            showFeedback("💡 " + msg);
                            Toast.makeText(FloatAgentService.this, msg, Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            }
        }).start();
    }

    private void releaseMediaRecorder() {
        if (mediaRecorder != null) {
            try { mediaRecorder.reset(); } catch (Exception ignored) {}
            try { mediaRecorder.release(); } catch (Exception ignored) {}
            mediaRecorder = null;
        }
    }

    private byte[] readFileBytes(File file) throws Exception {
        try (FileInputStream fis = new FileInputStream(file)) {
            return readStreamBytes(fis);
        }
    }

    private byte[] readStreamBytes(InputStream is) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }

    private void updateVoiceBtnUi(String state) {
        if (quickMicBadgeView != null) {
            if ("recording".equals(state)) {
                quickMicBadgeView.setText("⏹");
                setViewBg(quickMicBadgeView, createRoundRect("#EF4444", 14, "#FCA5A5", 1));
            } else if ("transcribing".equals(state)) {
                quickMicBadgeView.setText("⏳");
                setViewBg(quickMicBadgeView, createRoundRect("#6366F1", 14, "#A5B4FC", 1));
            } else {
                quickMicBadgeView.setText("🎙");
                setViewBg(quickMicBadgeView, createRoundRect("#E60F172A", 14, "#38BDF8", 1));
            }
        }
        if (activeSpeechVoiceBtn == null) return;
        if ("recording".equals(state)) {
            activeSpeechVoiceBtn.setText("⏹ 完成");
            setViewBg(activeSpeechVoiceBtn, createRoundRect("#EF4444", 9, null, 0));
        } else if ("transcribing".equals(state)) {
            activeSpeechVoiceBtn.setText("⏳ 识别中");
            setViewBg(activeSpeechVoiceBtn, createRoundRect("#6366F1", 9, null, 0));
        } else {
            activeSpeechVoiceBtn.setText("🎙 语音");
            setViewBg(activeSpeechVoiceBtn, createRoundRect("#0EA5E9", 9, null, 0));
        }
    }

    private void handleBubbleClick() {
        if ("confirming".equals(sCurrentStatus)) {
            if (confirmBannerView == null) {
                displayConfirmBanner("即将执行敏感操作，请确认", "", "sensitive", "", false);
            }
            return;
        }
        expandPanel();
        if (!isExternalMusicPlayingNow()) {
            setPetPoseDrawable(R.drawable.feiyu_happy);
            playPetBounceAnim("bounce");
        }
    }

    private void expandPanel() {
        if (isExpanded) return;
        isExpanded = true;
        wakePetOpacity();
        savedPillX = layoutParams.x;
        savedPillY = layoutParams.y;

        if (petBubbleContainer != null) petBubbleContainer.setVisibility(View.GONE);
        expandPanel.setVisibility(View.VISIBLE);
        refreshDynamicWidgets();
        refreshMusicUi();

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.93f), dp(364));
        layoutParams.x = Math.max(dp(6), (dm.widthPixels - panelWidth) / 2);
        layoutParams.y = Math.max(dp(36), Math.min(savedPillY, dm.heightPixels / 4));
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        try {
            windowManager.updateViewLayout(floatRootView, layoutParams);
        } catch (Exception ignored) {}
    }

    private void collapsePanel() {
        if (!isExpanded) return;
        isExpanded = false;

        hideKeyboardFor(cmdEditText);
        hideKeyboardFor(typingEditText);
        hideKeyboardFor(musicSearchEditText);

        expandPanel.setVisibility(View.GONE);
        if (petBubbleContainer != null) petBubbleContainer.setVisibility(View.VISIBLE);

        layoutParams.x = savedPillX;
        layoutParams.y = savedPillY;
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        try {
            windowManager.updateViewLayout(floatRootView, layoutParams);
        } catch (Exception ignored) {}
        refreshCollapsedPill();
        scheduleIdleSleep();
    }

    private void hideKeyboardFor(EditText et) {
        if (et == null) return;
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) {
            imm.hideSoftInputFromWindow(et.getWindowToken(), 0);
        }
        et.clearFocus();
    }

    private void executeCommandFromFloating(final String cmd, final boolean shouldCollapse) {
        AgentAccessibilityService a11y = ensureA11yReady();
        if (a11y == null) return;

        resetStopFlag();
        updateState("executing", cmd);
        if (shouldCollapse) {
            collapsePanel();
        }

        boolean needsFocusReturn = shouldCollapse && (
                cmd.contains("输入") || cmd.contains("打字") || cmd.contains("粘贴")
                        || cmd.contains("清空") || cmd.contains("搜索") || cmd.contains("回复") || cmd.contains("评论")
        );
        int delayMs = shouldCollapse ? (needsFocusReturn ? 560 : 300) : 60;

        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                AgentAccessibilityService service = AgentAccessibilityService.getInstance();
                if (service != null) {
                    String result = service.executeLocalRule(cmd);
                    showFeedback(result);
                    Toast.makeText(FloatAgentService.this, result.replaceFirst("^UNMATCHED:", ""), Toast.LENGTH_SHORT).show();
                    if (!service.isAutoSwipeRunning()) {
                        updateState("idle", "dsh-Go");
                    } else {
                        refreshDynamicWidgets();
                    }
                }
            }
        }, delayMs);
    }

    private void applyStatusStyle(String state, String text, boolean celebrateHappy) {
        if (statusTextView == null || statusPillView == null) return;
        wakePetOpacity();
        mainHandler.removeCallbacks(happyResetRunnable);

        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(Color.parseColor("#EB111827"));
        pillBg.setCornerRadius(dp(18));

        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);

        String displayTxt = (text != null && !text.trim().isEmpty()) ? text.trim() : "dsh-Go";
        boolean showStop = false;
        boolean showPill = true;

        switch (state) {
            case "confirming":
                pillBg.setStroke(dp(1), Color.parseColor("#F59E0B"));
                pillBg.setColor(Color.parseColor("#EB451A03"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FDE68A"));
                if (!isDraggingPet) setPetPoseDrawable(R.drawable.feiyu_happy);
                showStop = true;
                break;
            case "thinking":
                pillBg.setStroke(dp(1), Color.parseColor("#4D6BFE"));
                dotShape.setColor(Color.parseColor("#60A5FA"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                if (!isDraggingPet) setPetPoseDrawable(R.drawable.feiyu_focus);
                showStop = true;
                break;
            case "executing":
            case "acting":
                pillBg.setStroke(dp(1), Color.parseColor("#0EA5E9"));
                dotShape.setColor(Color.parseColor("#38BDF8"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                if (!isDraggingPet) setPetPoseDrawable(R.drawable.feiyu_busy);
                showStop = true;
                break;
            case "stopped":
                pillBg.setStroke(dp(1), Color.parseColor("#EF4444"));
                dotShape.setColor(Color.parseColor("#EF4444"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FCA5A5"));
                if (!isDraggingPet) setPetPoseDrawable(R.drawable.feiyu_derp);
                break;
            case "idle":
            default:
                pillBg.setStroke(dp(1), Color.parseColor("#0284C7"));
                dotShape.setColor(Color.parseColor("#10B981"));
                statusTextView.setText("dsh-Go");
                statusTextView.setTextColor(Color.parseColor("#E0F2FE"));
                showPill = qqMusicPlaying || isRecordingVoice || (singerEngine != null && singerEngine.isSinging());
                if (!isDraggingPet) {
                    if (celebrateHappy) {
                        setPetPoseDrawable(R.drawable.feiyu_happy);
                        mainHandler.postDelayed(happyResetRunnable, 1800);
                    } else if (qqMusicPlaying || (singerEngine != null && singerEngine.isSinging())) {
                        setPetPoseDrawable(R.drawable.feiyu_dance);
                    } else {
                        setPetPoseDrawable(R.drawable.feiyu_idle);
                    }
                }
                break;
        }

        statusPillView.setVisibility(showPill ? View.VISIBLE : View.GONE);
        if (pillStopBtn != null) {
            pillStopBtn.setVisibility(showStop ? View.VISIBLE : View.GONE);
        }
        if (statusDotView != null) {
            setViewBg(statusDotView, dotShape);
        }
        setViewBg(statusPillView, pillBg);
        if ("idle".equals(state)) {
            refreshCollapsedPill();
        }
        scheduleIdleSleep();
    }

    private void displayConfirmBanner(String summary, String actionDesc, String riskLevel, String targetApp, boolean hardSensitive) {
        if (windowManager == null) return;
        hideConfirmBanner();

        applyStatusStyle("confirming", "待确认: " + (summary != null ? summary : "敏感操作"), false);
        setEdgeGlowState("confirming");
        vibrateGentle(180);

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int bannerWidth = Math.min((int) (dm.widthPixels * 0.94f), dp(364));

        String borderColor = hardSensitive ? "#EF4444" : "#F59E0B";
        confirmBannerView = new LinearLayout(this);
        confirmBannerView.setOrientation(LinearLayout.VERTICAL);
        confirmBannerView.setPadding(dp(14), dp(12), dp(14), dp(12));
        setViewBg(confirmBannerView, createRoundRect("#F5111827", 16, borderColor, 1));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView riskBadge = new TextView(this);
        riskBadge.setText(hardSensitive ? "高危拦截 · 支付/密码" : ("sensitive".equals(riskLevel) ? "敏感操作确认" : "操作确认"));
        riskBadge.setTextColor(Color.parseColor(hardSensitive ? "#FCA5A5" : "#FDE68A"));
        riskBadge.setTextSize(10.5f);
        riskBadge.setPadding(dp(7), dp(2), dp(7), dp(2));
        setViewBg(riskBadge, createRoundRect(hardSensitive ? "#450A0A" : "#451A03", 8, borderColor, 1));
        titleRow.addView(riskBadge);

        if (targetApp != null && !targetApp.trim().isEmpty()) {
            TextView appTag = new TextView(this);
            appTag.setText(targetApp.trim());
            appTag.setTextColor(Color.parseColor("#93C5FD"));
            appTag.setTextSize(10.5f);
            appTag.setPadding(dp(7), dp(2), dp(7), dp(2));
            LinearLayout.LayoutParams appLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            appLp.leftMargin = dp(6);
            appTag.setLayoutParams(appLp);
            setViewBg(appTag, createRoundRect("#1E293B", 8, "#334155", 1));
            titleRow.addView(appTag);
        }
        confirmBannerView.addView(titleRow);

        TextView sumTv = new TextView(this);
        sumTv.setText(summary != null ? summary : "执行下一步操作");
        sumTv.setTextColor(Color.parseColor("#F8FAFC"));
        sumTv.setTextSize(13);
        sumTv.setTypeface(null, android.graphics.Typeface.BOLD);
        sumTv.setPadding(0, dp(8), 0, dp(3));
        confirmBannerView.addView(sumTv);

        if (actionDesc != null && !actionDesc.trim().isEmpty()) {
            TextView codeTv = new TextView(this);
            codeTv.setText(actionDesc.trim());
            codeTv.setTextColor(Color.parseColor("#94A3B8"));
            codeTv.setTextSize(11);
            codeTv.setPadding(0, 0, 0, dp(9));
            confirmBannerView.addView(codeTv);
        }

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView allowBtn = createActionBtn("允许一次", "#10B981", "#FFFFFF");
        allowBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams allowLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        allowLp.rightMargin = dp(5);
        allowBtn.setLayoutParams(allowLp);
        allowBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideConfirmBanner();
                updateState("executing", "已放行执行...");
                MainActivity.dispatchConfirmDecisionToWebView("allow");
            }
        });
        btnRow.addView(allowBtn);

        if (hardSensitive) {
            TextView handoverBtn = createActionBtn("我来手动操作", "#4D6BFE", "#FFFFFF");
            handoverBtn.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams hLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f);
            hLp.rightMargin = dp(5);
            handoverBtn.setLayoutParams(hLp);
            handoverBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    hideConfirmBanner();
                    updateState("idle", "dsh-Go");
                    MainActivity.dispatchConfirmDecisionToWebView("handover");
                }
            });
            btnRow.addView(handoverBtn);
        } else {
            TextView turnBtn = createActionBtn("本轮允许", "#4D6BFE", "#FFFFFF");
            turnBtn.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
            tLp.rightMargin = dp(5);
            turnBtn.setLayoutParams(tLp);
            turnBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    hideConfirmBanner();
                    updateState("executing", "本轮放行中...");
                    MainActivity.dispatchConfirmDecisionToWebView("auto_turn");
                }
            });
            btnRow.addView(turnBtn);

            if (targetApp != null && !targetApp.trim().isEmpty()) {
                TextView trustBtn = createActionBtn("信任此App", "#1E293B", "#93C5FD");
                trustBtn.setGravity(Gravity.CENTER);
                LinearLayout.LayoutParams trLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
                trLp.rightMargin = dp(5);
                trustBtn.setLayoutParams(trLp);
                trustBtn.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        hideConfirmBanner();
                        updateState("executing", "已信任并执行...");
                        MainActivity.dispatchConfirmDecisionToWebView("trust_app");
                    }
                });
                btnRow.addView(trustBtn);
            }
        }

        TextView cancelBtn = createActionBtn("拒绝", "#334155", "#E2E8F0");
        cancelBtn.setGravity(Gravity.CENTER);
        cancelBtn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.75f));
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideConfirmBanner();
                updateState("idle", "dsh-Go");
                MainActivity.dispatchConfirmDecisionToWebView("cancel");
            }
        });
        btnRow.addView(cancelBtn);
        confirmBannerView.addView(btnRow);

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                bannerWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.y = dp(64);

        try {
            windowManager.addView(confirmBannerView, lp);
        } catch (Exception ignored) {}
    }

    private void hideConfirmBanner() {
        if (confirmBannerView != null && windowManager != null) {
            try {
                windowManager.removeView(confirmBannerView);
            } catch (Exception ignored) {}
            confirmBannerView = null;
        }
    }

    private void updateForegroundNotification(boolean active, String statusText) {
        if (!active) {
            if (foregroundActive) {
                try {
                    stopForeground(true);
                } catch (Throwable ignored) {}
                foregroundActive = false;
            }
            return;
        }

        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(
                        FG_CHANNEL_ID,
                        "dsh-Go 鲸鱼娘控屏保活",
                        NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("AI 跨应用执行手机操作时保持后台稳定运行");
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }

            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int piFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 0, openIntent, piFlags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, FG_CHANNEL_ID)
                    : new Notification.Builder(this);

            String desc = (statusText != null && !statusText.trim().isEmpty())
                    ? statusText.trim()
                    : "正在执行手机辅助任务";

            builder.setContentTitle("鲸鱼娘 · dsh-Go 控屏中")
                    .setContentText(desc)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentIntent(pi)
                    .setOngoing(true);

            Notification notif = builder.build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(FG_NOTIFICATION_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(FG_NOTIFICATION_ID, notif);
            }
            foregroundActive = true;
        } catch (Throwable ignored) {}
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        stopWhaleVoicePlayer();
        if (singerEngine != null) {
            singerEngine.stop();
            singerEngine = null;
        }
        releaseMediaRecorder();
        if (petBreathAnim != null) {
            petBreathAnim.cancel();
            petBreathAnim = null;
        }
        if (petActionAnim != null) {
            petActionAnim.cancel();
            petActionAnim = null;
        }
        hideConfirmBanner();
        updateForegroundNotification(false, "");
        if (edgeGlowView != null && windowManager != null) {
            try { windowManager.removeView(edgeGlowView); } catch (Exception ignored) {}
            edgeGlowView = null;
        }
        if (floatingLyricRootView != null && windowManager != null) {
            try { windowManager.removeView(floatingLyricRootView); } catch (Exception ignored) {}
            floatingLyricRootView = null;
        }
        hideQuickTypingBar();
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y != null) {
            a11y.stopAllBackgroundTasks("悬浮窗关闭");
        }
        super.onDestroy();
        if (floatRootView != null && windowManager != null) {
            try {
                windowManager.removeView(floatRootView);
            } catch (Exception ignored) {}
        }
        if (sInstance == this) {
            sInstance = null;
        }
    }

    // ========= 鲸鱼娘水晶八音盒歌声引擎（内置 3 首米饭主题原创曲） =========
    private final class WhaleSingerEngine {
        private volatile boolean singing = false;
        private volatile String currentLine = "";
        private Thread playThread = null;

        boolean isSinging() {
            return singing;
        }

        String getCurrentLine() {
            return currentLine;
        }

        void startSong(final int songId) {
            stop();
            singing = true;
            playThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    runMelody(songId);
                }
            });
            playThread.start();
        }

        void stop() {
            singing = false;
            currentLine = "";
            if (playThread != null) {
                playThread.interrupt();
                playThread = null;
            }
        }

        private void runMelody(int songId) {
            // 频率表 C5 ~ A5
            final double C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00;
            final double[] freqs;
            final int[] durs;
            final String[] lyrics;

            if (songId == 0) {
                freqs = new double[]{C5, E5, G5, G5, A5, G5, E5, C5, D5, E5, G5, E5, D5, C5, E5, G5, A5, G5, E5, D5, C5};
                durs = new int[]{240, 240, 280, 280, 260, 260, 420, 240, 240, 260, 280, 240, 380, 240, 240, 280, 280, 260, 260, 280, 520};
                lyrics = new String[]{
                        "🍚 《大白米饭之歌》：冒尖一碗大白米饭香喷喷~",
                        "🐟 蓝色尾巴左右晃~ 本鱼才不是大肥鱼！",
                        "🫧 咕噜咕噜喝口汤，算力立刻满格啦~",
                        "💙 主人快再添一勺饭，陪我一起去摸鱼~"
                };
            } else if (songId == 1) {
                freqs = new double[]{G5, E5, G5, E5, C5, D5, E5, G5, A5, G5, E5, D5, E5, G5, E5, C5};
                durs = new int[]{260, 260, 260, 260, 320, 260, 260, 420, 260, 260, 260, 260, 280, 280, 280, 520};
                lyrics = new String[]{
                        "🌊 《深海冒泡舞曲》：深海里面吹泡泡~ 飘呀飘~",
                        "🎵 戴上耳机摇一摇~ 烦恼全都忘掉啦~",
                        "🍚 梦里全是热腾腾，白胖胖的大米饭！"
                };
            } else {
                freqs = new double[]{C5, C5, G5, G5, A5, A5, G5, F5, F5, E5, E5, D5, D5, C5};
                durs = new int[]{280, 280, 280, 280, 280, 280, 480, 280, 280, 280, 280, 280, 280, 560};
                lyrics = new String[]{
                        "✨ 《星海小星星》：一闪一闪亮晶晶~",
                        "🐟 鲸鱼娘在屏幕边，安安静静陪着你~",
                        "🍚 忙完记得早点睡，明天还要吃米饭~"
                };
            }

            final int sr = 22050;
            AudioTrack track = null;
            try {
                int minBuf = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                track = new AudioTrack(
                        new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build(),
                        new AudioFormat.Builder()
                                .setSampleRate(sr)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .build(),
                        Math.max(minBuf, 4096),
                        AudioTrack.MODE_STREAM,
                        AudioManager.AUDIO_SESSION_ID_GENERATE
                );
                track.play();

                for (int i = 0; i < freqs.length && singing; i++) {
                    int lyrIdx = Math.min(lyrics.length - 1, (i * lyrics.length) / freqs.length);
                    final String lineNow = lyrics[lyrIdx];
                    if (!lineNow.equals(currentLine)) {
                        currentLine = lineNow;
                        mainHandler.post(new Runnable() {
                            @Override
                            public void run() {
                                showPetSubtitle(lineNow, 6000);
                            }
                        });
                    }

                    int samples = (int) ((durs[i] / 1000.0) * sr);
                    short[] pcm = new short[samples];
                    double freq = freqs[i];
                    for (int s = 0; s < samples; s++) {
                        double t = s / (double) sr;
                        // 柔和八音盒包络：快速起音 + 指数平滑衰减
                        double attack = Math.min(1.0, s / (sr * 0.015));
                        double decay = Math.exp(-4.2 * (s / (double) samples));
                        double env = attack * decay;
                        double wave = Math.sin(2.0 * Math.PI * freq * t)
                                + 0.28 * Math.sin(2.0 * Math.PI * (freq * 2.0) * t)
                                + 0.08 * Math.sin(2.0 * Math.PI * (freq * 3.0) * t);
                        pcm[s] = (short) (wave * env * 6500);
                    }
                    track.write(pcm, 0, pcm.length);
                }
            } catch (Throwable ignored) {
            } finally {
                if (track != null) {
                    try { track.stop(); } catch (Exception ignored) {}
                    try { track.release(); } catch (Exception ignored) {}
                }
                if (singing) {
                    singing = false;
                    currentLine = "";
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            setPetPoseDrawable(R.drawable.feiyu_happy);
                            showPetSubtitle("🎵 哼唱完啦~ 好听的话就给鲸鱼娘盛碗白米饭吧！🍚", 3600);
                            mainHandler.postDelayed(happyResetRunnable, 1800);
                        }
                    });
                }
            }
        }
    }

    private final class EdgeGlowView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int glowColor = Color.parseColor("#4D6BFE");
        private float breathAlpha = 0.78f;
        private ValueAnimator pulseAnim;

        EdgeGlowView(Context ctx) {
            super(ctx);
        }

        void setState(String state) {
            if ("idle".equals(state) || "stopped".equals(state) || state == null) {
                stopPulse();
                setVisibility(View.GONE);
                return;
            }
            if ("confirming".equals(state)) {
                glowColor = Color.parseColor("#F59E0B");
            } else if ("acting".equals(state) || "executing".equals(state)) {
                glowColor = Color.parseColor("#0EA5E9");
            } else {
                glowColor = Color.parseColor("#4D6BFE");
            }
            setVisibility(View.VISIBLE);
            startPulse();
            invalidate();
        }

        private void startPulse() {
            if (pulseAnim != null && pulseAnim.isRunning()) return;
            pulseAnim = ValueAnimator.ofFloat(0.45f, 0.92f);
            pulseAnim.setDuration(1100);
            pulseAnim.setRepeatMode(ValueAnimator.REVERSE);
            pulseAnim.setRepeatCount(ValueAnimator.INFINITE);
            pulseAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator animation) {
                    breathAlpha = (float) animation.getAnimatedValue();
                    invalidate();
                }
            });
            pulseAnim.start();
        }

        private void stopPulse() {
            if (pulseAnim != null) {
                pulseAnim.cancel();
                pulseAnim = null;
            }
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            if (w <= 0 || h <= 0) return;

            float thickness = dp(10);
            int a = Math.round(145 * breathAlpha);
            int solid = Color.argb(a, Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor));
            int trans = Color.argb(0, Color.red(glowColor), Color.green(glowColor), Color.blue(glowColor));

            paint.setShader(new LinearGradient(0, 0, 0, thickness, solid, trans, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, w, thickness, paint);

            paint.setShader(new LinearGradient(0, h, 0, h - thickness, solid, trans, Shader.TileMode.CLAMP));
            canvas.drawRect(0, h - thickness, w, h, paint);

            paint.setShader(new LinearGradient(0, 0, thickness, 0, solid, trans, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, thickness, h, paint);

            paint.setShader(new LinearGradient(w, 0, w - thickness, 0, solid, trans, Shader.TileMode.CLAMP));
            canvas.drawRect(w - thickness, 0, w, h, paint);
        }
    }

    private final class TapRippleView extends View {
        private final Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float progress = 0f;

        TapRippleView(Context ctx) {
            super(ctx);
            ringPaint.setStyle(Paint.Style.STROKE);
            ringPaint.setStrokeWidth(dp(2));
            ringPaint.setColor(Color.parseColor("#4D6BFE"));
            dotPaint.setStyle(Paint.Style.FILL);
            dotPaint.setColor(Color.parseColor("#4D6BFE"));
        }

        void setProgress(float p) {
            this.progress = Math.max(0f, Math.min(1f, p));
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            float maxR = Math.min(cx, cy) - dp(2);
            float r = dp(4) + (maxR - dp(4)) * progress;
            int alpha = Math.round(220 * (1f - progress));
            ringPaint.setAlpha(alpha);
            dotPaint.setAlpha(Math.round(180 * (1f - progress)));
            canvas.drawCircle(cx, cy, r, ringPaint);
            canvas.drawCircle(cx, cy, dp(5) * (1f - 0.35f * progress), dotPaint);
        }
    }
}
