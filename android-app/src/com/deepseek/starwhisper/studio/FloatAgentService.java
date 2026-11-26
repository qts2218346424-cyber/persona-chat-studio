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
    private static final String PREF_KEY_CUSTOM_SONGS = "custom_songs_v1";
    private static final String ASR_ENDPOINT = "https://star.claudexxb.online/api/asr/transcribe";
    private static final String LYRICS_ENDPOINT = "https://star.claudexxb.online/api/music/lyrics";
    private static final String WEATHER_ENDPOINT = "https://star.claudexxb.online/api/weather/summary";

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

    // 外卖同步实时卡片控件
    private LinearLayout takeoutCardBox;
    private TextView takeoutTitleView;
    private TextView takeoutDetailView;

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
    private boolean showExternalPetBar = true;
    private boolean freeRoamEnabled = true;
    private boolean headBubbleEnabled = true;
    private boolean antiMistouchEnabled = false;
    private boolean floatingLyricsEnabled = true;
    private boolean lyricsDragMode = false;
    private int savedLyricsY = 180;
    private int tripleTapCount = 0;
    private long lastMistouchTapMs = 0L;
    private long lastMistouchToastMs = 0L;
    private int autoLifeStep = 0;
    private long nextAutoHeadBubbleAtMs = 0L;
    private ValueAnimator petRoamAnimator = null;
    private volatile String cachedWeatherCity = "";
    private volatile String cachedWeatherDesc = "";
    private volatile String cachedWeatherTempC = "";
    private volatile long lastWeatherFetchMs = 0L;
    private final java.util.Random petRandom = new java.util.Random();

    // 独立全透明背景桌面漂浮歌词窗、外置互动条与头顶气泡
    private LinearLayout externalPetActionBar;
    private TextView headSpeechBubbleView;
    private LinearLayout floatingLyricRootView;
    private WindowManager.LayoutParams floatingLyricParams;
    private TextView floatingLyricSubText;
    private TextView floatingLyricMainText;
    private TextView voiceTailToggleBtn;
    private TextView extPetBarToggleBtn;
    private TextView freeRoamToggleBtn;
    private TextView headBubbleToggleBtn;
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
    private final List<CustomSongItem> customSongs = new ArrayList<>();
    private static final class CustomSongItem {
        String id;
        String title;
        String filePath;
    }
    private boolean quickTypingDirectSend = true;
    private boolean quickTypingBarVisible = false;
    private LinearLayout quickTypingBarView;
    private WindowManager.LayoutParams quickTypingBarParams;
    private LinearLayout quickBarChipsWrap;
    private TextView quickBarModeBtn;

    // 原生 MediaPlayer 语音 + AudioTrack 唱歌引擎
    private MediaPlayer petVoicePlayer = null;
    private WhaleSingerEngine singerEngine = null;
    private volatile long lastWhaleAudioStopMs = 0L;
    private int feedIndex = 0;
    private int patIndex = 0;
    private int danceIndex = 0;
    private int singSongIndex = 0;
    private int mischiefIndex = 0;
    private long lastTapPetMs = 0L;

    // QQ 音乐与歌词同步状态
    private volatile String qqMusicPkg = "";
    private volatile String qqMusicTitle = "";
    private volatile String qqMusicArtist = "";
    private volatile boolean qqMusicPlaying = false;
    private volatile long qqMusicPosMs = 0L;
    private volatile long qqMusicDurationMs = 0L;
    private volatile long qqMusicLastSyncMs = 0L;
    private volatile long qqMusicLastNativeLyricMs = 0L;
    private volatile long lastExternalTitleSwitchMs = 0L;
    private int externalRapidSwitchCount = 0;
    private volatile String lastRawSessionArtist = "";
    private volatile long lastRawSessionDurationMs = 0L;
    private volatile String lastRawSessionTitle = "";
    private volatile String qqMusicCurrentLyric = "";
    private volatile String lastFetchedLyricsKey = "";
    private int inactiveMusicStreak = 0;
    private final List<LyricLine> qqMusicLyrics = Collections.synchronizedList(new ArrayList<LyricLine>());

    // 实时外卖同步状态
    private volatile String takeoutPlatform = "";
    private volatile String takeoutStage = "";
    private volatile String takeoutTitle = "";
    private volatile String takeoutDetail = "";
    private volatile long takeoutUpdatedMs = 0L;
    private volatile String lastAnnouncedTakeoutKey = "";

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
                if (petAvatarView != null) {
                    petAvatarView.animate().rotation(0f).scaleX(1f).scaleY(1f).translationY(0f).translationX(0f).setDuration(260).start();
                }
                setPetPoseDrawable(R.drawable.feiyu_idle);
            }
        }
    };

    private final Runnable headBubbleHideRunnable = new Runnable() {
        @Override
        public void run() {
            if (headSpeechBubbleView != null) {
                headSpeechBubbleView.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() {
                    @Override
                    public void run() {
                        if (headSpeechBubbleView != null) {
                            headSpeechBubbleView.setVisibility(View.GONE);
                            headSpeechBubbleView.setAlpha(1f);
                        }
                    }
                }).start();
            }
        }
    };

    private final Runnable autonomousLifeRunnable = new Runnable() {
        @Override
        public void run() {
            if (sInstance == null) return;
            if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus)
                    && !isRecordingVoice && (singerEngine == null || !singerEngine.isSinging())) {
                // 每 25 分钟异步刷一次实时天气，供大肥鱼吐槽真实温度与阴晴雨雪
                if (System.currentTimeMillis() - lastWeatherFetchMs > 25 * 60 * 1000L) {
                    fetchWeatherSummaryAsync();
                }

                // 1. 自由漫步模式：节奏更舒缓（55% 慢步散步、22% 原地细腻微动作、23% 搞怪捣蛋自嗨秀）
                int dice = petRandom.nextInt(100);
                if (freeRoamEnabled && !qqMusicPlaying && (petRoamAnimator == null || !petRoamAnimator.isRunning()) && dice < 55) {
                    startPetFreeRoamStep();
                } else if (!qqMusicPlaying && dice >= 77) {
                    // 自主随机表演一次静音小捣蛋，增加“活物灵魂感”而不刷屏打扰
                    triggerMischiefAction(false);
                } else {
                    int step = autoLifeStep % 6;
                    int pose = R.drawable.feiyu_eating;
                    String anim = "nibble";
                    switch (step) {
                        case 0: pose = R.drawable.feiyu_eating; anim = "nibble"; break;
                        case 1: pose = R.drawable.feiyu_sleepy; anim = "nap_startle"; break;
                        case 2: pose = R.drawable.feiyu_focus; anim = "bounce"; break;
                        case 3: pose = R.drawable.feiyu_dance; anim = "dance"; break;
                        case 4: pose = R.drawable.feiyu_beg; anim = "bubble_pop"; break;
                        default: pose = R.drawable.feiyu_derp; anim = "curious"; break;
                    }
                    setPetPoseDrawable(pose);
                    playPetBounceAnim(anim);
                    mainHandler.removeCallbacks(lifePoseResetRunnable);
                    mainHandler.postDelayed(lifePoseResetRunnable, 4600);
                }

                // 2. 开启头顶气泡时，严格每 5 分钟 ~ 10 分钟随机弹一条天气吐槽或暖心安慰（不频繁打扰）
                long nowMs = System.currentTimeMillis();
                if (headBubbleEnabled && nowMs >= nextAutoHeadBubbleAtMs) {
                    scheduleNextAutoHeadBubble();
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (sInstance != null && headBubbleEnabled && !isExpanded && !isDraggingPet
                                    && "idle".equals(sCurrentStatus) && !isRecordingVoice
                                    && (singerEngine == null || !singerEngine.isSinging())) {
                                showRandomWeatherOrComfortBubble();
                            }
                        }
                    }, 900);
                }
                autoLifeStep++;
            }
            mainHandler.postDelayed(this, 13500);
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
                // 过滤系统下载/缓存/广告杂项通知，防止误清空正在同步的歌曲与歌词
                if (t.contains("正在下载") || t.contains("下载完成") || t.contains("桌面歌词") || t.contains("已暂停") || s.contains("点击打开")) {
                    return;
                }
                boolean hasSessionPerm = QqMusicListenerService.isNotificationAccessEnabled(inst);
                if (!inst.qqMusicTitle.isEmpty()) {
                    String tLower = t.toLowerCase(Locale.ROOT);
                    String curLower = inst.qqMusicTitle.toLowerCase(Locale.ROOT);
                    boolean sameTrack = tLower.equals(curLower) || tLower.contains(curLower) || curLower.contains(tLower);
                    if (sameTrack && !s.isEmpty() && s.length() > 2 && !s.contains("正在播放")) {
                        inst.qqMusicPlaying = true;
                        // 仅当通知文本不是单纯“歌手”且没有时间轴 LRC 时，同步作为状态栏歌词；如果有明显“歌手 - 专辑”也不乱覆盖
                        if (inst.qqMusicLyrics.isEmpty() && !s.equalsIgnoreCase(inst.qqMusicArtist) && !s.contains(" - ")) {
                            inst.handleExternalNativeLyricLine(s);
                        }
                        return;
                    }
                    // 已开启通知监听时以官方 MediaSession 元数据为准，不让辅助歌词通知覆盖原歌名
                    if (hasSessionPerm && !s.contains(" - ")) {
                        return;
                    }
                }
                String artist = s;
                if (artist.contains(" - ")) {
                    artist = artist.split(" - ")[0].trim();
                }
                inst.handleMusicMetadataUpdate(pkg, t, artist, true, 0L, 0L, false);
            }
        });
    }

    public static void onExternalNativeLyric(final String pkg, final String rawPrimary, final String rawSecondary) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.handleExternalNativeLyricFromService(pkg, rawPrimary, rawSecondary);
            }
        });
    }

    public static void onExternalTakeoutUpdate(final String pkg, final String rawTitle, final String rawDetail) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.handleExternalTakeoutUpdate(pkg, rawTitle, rawDetail);
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
                    inst.handleMusicMetadataUpdate("com.tencent.qqmusic", clean, "", false, 0L, 0L, false);
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
            showExternalPetBar = sp.getBoolean("show_ext_pet_bar", true);
            freeRoamEnabled = sp.getBoolean("free_roam_enabled", true);
            headBubbleEnabled = sp.getBoolean("show_head_bubble", true);
            antiMistouchEnabled = sp.getBoolean("anti_mistouch", false);
            floatingLyricsEnabled = sp.getBoolean("floating_lyrics", true);
            savedLyricsY = sp.getInt("lyrics_y", dp(88));
            quickTypingDirectSend = sp.getBoolean(PREF_KEY_QUICK_DIRECT, true);
        } catch (Exception ignored) {}
        scheduleNextAutoHeadBubble();
        reloadQuickPhrases();
        reloadCustomSongs();
    }

    public static String getCustomSongsJsonFromPrefs(Context ctx) {
        if (ctx == null) return "[]";
        try {
            String raw = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_KEY_CUSTOM_SONGS, "[]");
            if (raw != null && raw.trim().startsWith("[")) {
                JSONArray src = new JSONArray(raw);
                JSONArray valid = new JSONArray();
                for (int i = 0; i < src.length(); i++) {
                    JSONObject o = src.optJSONObject(i);
                    if (o == null) continue;
                    String fp = o.optString("filePath", "");
                    if (!fp.isEmpty() && new File(fp).exists()) {
                        valid.put(o);
                    }
                }
                return valid.toString();
            }
        } catch (Exception ignored) {}
        return "[]";
    }

    public static int addImportedSongsFromMain(Context ctx, List<JSONObject> newlyImported) {
        if (ctx == null || newlyImported == null || newlyImported.isEmpty()) return 0;
        try {
            JSONArray cur = new JSONArray(getCustomSongsJsonFromPrefs(ctx));
            JSONArray next = new JSONArray();
            for (JSONObject item : newlyImported) {
                next.put(item);
            }
            for (int i = 0; i < cur.length() && next.length() < 60; i++) {
                JSONObject old = cur.optJSONObject(i);
                if (old != null) next.put(old);
            }
            ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY_CUSTOM_SONGS, next.toString())
                    .apply();
            final FloatAgentService inst = sInstance;
            if (inst != null) {
                inst.mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        inst.reloadCustomSongs();
                    }
                });
            }
            return newlyImported.size();
        } catch (Exception e) {
            return 0;
        }
    }

    public static boolean renameCustomSongFromBridge(Context ctx, String songId, String newTitle) {
        if (ctx == null || songId == null || newTitle == null || newTitle.trim().isEmpty()) return false;
        try {
            JSONArray cur = new JSONArray(getCustomSongsJsonFromPrefs(ctx));
            boolean changed = false;
            for (int i = 0; i < cur.length(); i++) {
                JSONObject o = cur.optJSONObject(i);
                if (o != null && songId.equals(o.optString("id", ""))) {
                    o.put("title", newTitle.trim());
                    changed = true;
                    break;
                }
            }
            if (changed) {
                ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(PREF_KEY_CUSTOM_SONGS, cur.toString())
                        .apply();
                final FloatAgentService inst = sInstance;
                if (inst != null) {
                    inst.mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            inst.reloadCustomSongs();
                        }
                    });
                }
            }
            return changed;
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean deleteCustomSongFromBridge(Context ctx, String songId) {
        if (ctx == null || songId == null) return false;
        try {
            JSONArray cur = new JSONArray(getCustomSongsJsonFromPrefs(ctx));
            JSONArray next = new JSONArray();
            boolean removed = false;
            for (int i = 0; i < cur.length(); i++) {
                JSONObject o = cur.optJSONObject(i);
                if (o == null) continue;
                if (songId.equals(o.optString("id", ""))) {
                    removed = true;
                    String fp = o.optString("filePath", "");
                    if (!fp.isEmpty()) {
                        try { new File(fp).delete(); } catch (Exception ignored) {}
                    }
                } else {
                    next.put(o);
                }
            }
            if (removed) {
                ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(PREF_KEY_CUSTOM_SONGS, next.toString())
                        .apply();
                final FloatAgentService inst = sInstance;
                if (inst != null) {
                    inst.mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            inst.reloadCustomSongs();
                        }
                    });
                }
            }
            return removed;
        } catch (Exception e) {
            return false;
        }
    }

    public static void playSongByIdFromBridge(final Context ctx, final String songId) {
        final FloatAgentService inst = sInstance;
        if (inst == null) {
            if (ctx != null) {
                Toast.makeText(ctx, "请先开启大肥鱼悬浮窗后再播放", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.playCustomSongById(songId);
            }
        });
    }

    public static void stopSongFromBridge() {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (inst.singerEngine != null && inst.singerEngine.isSinging()) {
                    inst.singerEngine.stop();
                    inst.setPetPoseDrawable(R.drawable.feiyu_happy);
                    inst.showPetSubtitle("🎵 已暂停大肥鱼歌唱~", 2400);
                }
            }
        });
    }

    private void reloadCustomSongs() {
        customSongs.clear();
        try {
            JSONArray arr = new JSONArray(getCustomSongsJsonFromPrefs(this));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                String title = o.optString("title", "未命名歌曲");
                String fp = o.optString("filePath", "");
                if (!id.isEmpty() && !fp.isEmpty() && new File(fp).exists()) {
                    CustomSongItem item = new CustomSongItem();
                    item.id = id;
                    item.title = title;
                    item.filePath = fp;
                    customSongs.add(item);
                }
            }
        } catch (Exception ignored) {}
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
        mainHandler.postDelayed(autonomousLifeRunnable, 4800);
        fetchWeatherSummaryAsync();
        // 开窗轻微打个招呼，直接在头顶冒泡
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (sInstance != null && isRunning()) {
                    showHeadBubble("🐟 大肥鱼来啦！我会在屏幕上到处溜达，陪你聊天吐槽天气哦~", 4500);
                }
            }
        }, 700);
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

        // 1. 折叠态：最上方头顶气泡 + 中间 Q 版鲸鱼娘/语音尾巴/状态胶囊 + 下方外置互动条
        petBubbleContainer = new LinearLayout(this);
        petBubbleContainer.setOrientation(LinearLayout.VERTICAL);
        petBubbleContainer.setGravity(Gravity.START);

        headSpeechBubbleView = new TextView(this);
        headSpeechBubbleView.setTextColor(Color.parseColor("#FFFFFF"));
        headSpeechBubbleView.setTypeface(null, android.graphics.Typeface.BOLD);
        headSpeechBubbleView.setTextSize(12f);
        headSpeechBubbleView.setLineSpacing(dp(2), 1.0f);
        headSpeechBubbleView.setMaxWidth(dp(220));
        headSpeechBubbleView.setMaxLines(3);
        headSpeechBubbleView.setEllipsize(TextUtils.TruncateAt.END);
        headSpeechBubbleView.setPadding(dp(4), dp(2), dp(4), dp(2));
        headSpeechBubbleView.setBackgroundColor(Color.TRANSPARENT);
        headSpeechBubbleView.setShadowLayer(dp(4), 0f, dp(1), Color.parseColor("#F0000000"));
        LinearLayout.LayoutParams hbLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hbLp.bottomMargin = dp(3);
        headSpeechBubbleView.setLayoutParams(hbLp);
        headSpeechBubbleView.setVisibility(View.GONE);
        headSpeechBubbleView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                mainHandler.removeCallbacks(headBubbleHideRunnable);
                headBubbleHideRunnable.run();
                setPetPoseDrawable(R.drawable.feiyu_happy);
                playPetBounceAnim("bounce");
            }
        });

        LinearLayout petTopRow = new LinearLayout(this);
        petTopRow.setOrientation(LinearLayout.HORIZONTAL);
        petTopRow.setGravity(Gravity.CENTER_VERTICAL);

        petAvatarView = new ImageView(this);
        petAvatarView.setImageResource(R.drawable.feiyu_idle);
        petAvatarView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams avatarLp = new LinearLayout.LayoutParams(dp(62), dp(62));
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

        petTopRow.addView(petAvatarView);
        petTopRow.addView(quickMicBadgeView);
        petTopRow.addView(statusPillView);

        // 下排：外置大肥鱼互动条（就在悬浮窗外面直接喂饭/摸头/跳舞/唱歌/讲热梗，实时看肥鱼反应）
        externalPetActionBar = new LinearLayout(this);
        externalPetActionBar.setOrientation(LinearLayout.HORIZONTAL);
        externalPetActionBar.setGravity(Gravity.CENTER_VERTICAL);
        externalPetActionBar.setPadding(dp(4), dp(3), dp(4), dp(3));
        setViewBg(externalPetActionBar, createRoundRect("#D90F172A", 12, "#38BDF8", 1));
        LinearLayout.LayoutParams extBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        extBarLp.topMargin = dp(3);
        externalPetActionBar.setLayoutParams(extBarLp);

        TextView extFeed = createExternalActionPill("🍚喂", "#3B2506", "#FDE68A", "#F59E0B");
        extFeed.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerFeedRiceAction();
            }
        });
        TextView extPat = createExternalActionPill("👋摸", "#1E293B", "#E2E8F0", "#475569");
        extPat.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });
        TextView extDance = createExternalActionPill("💃舞", "#1E293B", "#E2E8F0", "#475569");
        extDance.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerDanceAction();
            }
        });
        TextView extSing = createExternalActionPill("🎤唱", "#3B102E", "#F9A8D4", "#EC4899");
        extSing.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerSingSongAction();
            }
        });
        TextView extMischief = createExternalActionPill("😈闹", "#3B0764", "#E9D5FF", "#A855F7");
        extMischief.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerMischiefAction(true);
            }
        });
        TextView extMeme = createExternalActionPill("🫧梗", "#1E293B", "#BAE6FD", "#0EA5E9");
        extMeme.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerRandomMemeVoice();
            }
        });
        TextView extHide = createExternalActionPill("✕", "#1E293B", "#94A3B8", "#334155");
        LinearLayout.LayoutParams ehLp = (LinearLayout.LayoutParams) extHide.getLayoutParams();
        ehLp.rightMargin = 0;
        extHide.setLayoutParams(ehLp);
        extHide.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showExternalPetBar = false;
                savePrefBool("show_ext_pet_bar", false);
                applyExternalPetBarVisibility();
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this, "已收起外置互动条（点击大肥鱼打开面板可重新开启）", Toast.LENGTH_SHORT).show();
            }
        });

        externalPetActionBar.addView(extFeed);
        externalPetActionBar.addView(extPat);
        externalPetActionBar.addView(extDance);
        externalPetActionBar.addView(extSing);
        externalPetActionBar.addView(extMischief);
        externalPetActionBar.addView(extMeme);
        externalPetActionBar.addView(extHide);

        petBubbleContainer.addView(headSpeechBubbleView);
        petBubbleContainer.addView(petTopRow);
        petBubbleContainer.addView(externalPetActionBar);

        applyVoiceTailVisibility();
        applyExternalPetBarVisibility();
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
                        stopPetRoaming();
                        if (petAvatarView != null) {
                            petAvatarView.setScaleX(Math.abs(petAvatarView.getScaleX()));
                        }
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
                            int petH = petBubbleContainer.getHeight() > 0 ? petBubbleContainer.getHeight() : dp(100);
                            int margin = dp(6);
                            if (freeRoamEnabled) {
                                // 开启全屏自由漫步时，允许大肥鱼停在用户拖放的任意屏幕位置，不再强制吸死左右侧边
                                layoutParams.x = Math.max(margin, Math.min(layoutParams.x, dm.widthPixels - petW - margin));
                                layoutParams.y = Math.max(dp(34), Math.min(layoutParams.y, dm.heightPixels - petH - dp(24)));
                            } else {
                                int center = layoutParams.x + petW / 2;
                                layoutParams.x = (center < dm.widthPixels / 2)
                                        ? margin
                                        : Math.max(margin, dm.widthPixels - petW - margin);
                            }
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

    private void applyExternalPetBarVisibility() {
        if (externalPetActionBar != null) {
            externalPetActionBar.setVisibility(showExternalPetBar ? View.VISIBLE : View.GONE);
        }
    }

    private TextView createExternalActionPill(String label, String fillHex, String textHex, String strokeHex) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextSize(10.5f);
        btn.setTextColor(Color.parseColor(textHex));
        btn.setGravity(Gravity.CENTER);
        btn.setSingleLine(true);
        btn.setPadding(dp(7), dp(3), dp(7), dp(3));
        setViewBg(btn, createRoundRect(fillHex, 9, strokeHex, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(4);
        btn.setLayoutParams(lp);
        return btn;
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
            String lyr = !qqMusicCurrentLyric.isEmpty() ? qqMusicCurrentLyric : "♪ 纯音乐或暂无时间轴歌词";
            floatingLyricMainText.setText(lyr);
            floatingLyricRootView.setVisibility(View.VISIBLE);
            return;
        }
        floatingLyricRootView.setVisibility(View.GONE);
    }

    private void applyPetBottomPivot(View target, float yRatio) {
        if (target == null) return;
        float w = target.getWidth() > 0 ? target.getWidth() : dp(62);
        float h = target.getHeight() > 0 ? target.getHeight() : dp(62);
        target.setPivotX(w * 0.5f);
        target.setPivotY(h * yRatio);
    }

    private void startPetBreathAnim() {
        if (petBreathAnim != null) {
            petBreathAnim.cancel();
        }
        petBreathAnim = ValueAnimator.ofFloat(0f, 1f);
        petBreathAnim.setDuration(2200);
        petBreathAnim.setRepeatMode(ValueAnimator.REVERSE);
        petBreathAnim.setRepeatCount(ValueAnimator.INFINITE);
        petBreathAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                if (petAvatarView != null && !isDraggingPet && !isExpanded
                        && (petActionAnim == null || !petActionAnim.isRunning())
                        && (petRoamAnimator == null || !petRoamAnimator.isRunning())) {
                    applyPetBottomPivot(petAvatarView, 0.88f);
                    float f = (float) animation.getAnimatedValue();
                    float s = (float) (0.5 - 0.5 * Math.cos(Math.PI * f));
                    petAvatarView.setTranslationY(-dp(5) * 0.5f * s);
                    // Q 弹果冻呼吸：吸气略挺拔、呼气微鼓肚
                    petAvatarView.setScaleX(1.032f - 0.055f * s);
                    petAvatarView.setScaleY(0.968f + 0.068f * s);
                    petAvatarView.setRotation(-1.8f + 3.6f * s);
                }
            }
        });
        petBreathAnim.start();
    }

    private void playPetBounceAnim(final String animType) {
        if (petActionAnim != null) {
            petActionAnim.cancel();
        }
        final ImageView target = isExpanded ? headPetIcon : petAvatarView;
        if (target == null) return;
        target.setRotation(0f);
        target.setScaleX(1f);
        target.setScaleY(1f);
        target.setTranslationX(0f);
        target.setTranslationY(0f);
        boolean centerPivot = "slip".equals(animType) || "upside_down".equals(animType);
        applyPetBottomPivot(target, centerPivot ? 0.5f : 0.88f);

        if ("eat".equals(animType) || "nibble".equals(animType)) {
            final boolean isSneaky = "nibble".equals(animType);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(isSneaky ? 2200 : 1850);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float chew = (float) Math.sin(f * Math.PI * 10.0);
                    float peek = isSneaky ? (float) Math.sin(f * Math.PI * 3.0) : 0f;
                    target.setScaleX(1f + 0.075f * chew);
                    target.setScaleY(1f - 0.065f * chew);
                    target.setTranslationY(-dp(7) * 0.5f * Math.max(0f, -chew));
                    target.setRotation((isSneaky ? 7f * peek : 3f * chew));
                }
            });
        } else if ("walk".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2400);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float step = (float) Math.sin(f * Math.PI * 6.0);
                    float hop = Math.abs(step);
                    target.setTranslationX(dp(5) * (float) Math.sin(f * Math.PI * 2.0));
                    target.setTranslationY(-dp(4) * hop);
                    target.setRotation(5.5f * step);
                    target.setScaleY(0.95f + 0.08f * hop);
                    target.setScaleX(1.05f - 0.06f * hop);
                }
            });
        } else if ("dance".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2600);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float sway = (float) Math.sin(f * Math.PI * 6.0);
                    float beat = Math.abs((float) Math.cos(f * Math.PI * 6.0));
                    target.setRotation(11f * sway);
                    target.setTranslationY(-dp(7) * beat);
                    target.setTranslationX(dp(4) * sway);
                    target.setScaleX(1.06f - 0.08f * beat);
                    target.setScaleY(0.94f + 0.11f * beat);
                }
            });
        } else if ("slip".equals(animType)) {
            // 搞怪打滑：原地急刹翻跟头 360° 后轻微晃晕
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2300);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.62f) {
                        float p = f / 0.62f;
                        float eased = (float) (1.0 - Math.pow(1.0 - p, 2));
                        target.setRotation(360f * eased);
                        target.setTranslationY(-dp(12) * (float) Math.sin(p * Math.PI));
                        target.setScaleX(1f + 0.10f * (float) Math.sin(p * Math.PI));
                        target.setScaleY(1f - 0.08f * (float) Math.sin(p * Math.PI));
                    } else {
                        float wobble = (f - 0.62f) / 0.38f;
                        target.setRotation(14f * (float) Math.sin(wobble * Math.PI * 4.0) * (1f - wobble));
                        target.setTranslationY(0f);
                    }
                }
            });
        } else if ("upside_down".equals(animType)) {
            // 搞怪倒立吐舌头：翻成 180° 倒挂摇摆再翻回来
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2800);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.22f) {
                        float p = f / 0.22f;
                        target.setRotation(180f * p);
                        target.setScaleX(1f + 0.14f * p);
                        target.setScaleY(1f + 0.14f * p);
                    } else if (f < 0.78f) {
                        float p = (f - 0.22f) / 0.56f;
                        target.setRotation(180f + 12f * (float) Math.sin(p * Math.PI * 4.0));
                        target.setTranslationY(-dp(4) * (float) Math.sin(p * Math.PI * 2.0));
                        target.setScaleX(1.14f);
                        target.setScaleY(1.14f);
                    } else {
                        float p = (f - 0.78f) / 0.22f;
                        target.setRotation(180f * (1f - p));
                        target.setScaleX(1.14f - 0.14f * p);
                        target.setScaleY(1.14f - 0.14f * p);
                    }
                }
            });
        } else if ("bubble_pop".equals(animType)) {
            // 吹泡泡膨胀然后“啪！”瞬间炸弹回
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2400);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.66f) {
                        float p = f / 0.66f;
                        float s = 1f + 0.26f * p;
                        target.setScaleX(s);
                        target.setScaleY(s);
                        target.setRotation(3f * (float) Math.sin(p * Math.PI * 6.0));
                    } else {
                        float p = (f - 0.66f) / 0.34f;
                        float jump = (float) Math.sin(p * Math.PI);
                        target.setScaleX(0.86f + 0.14f * (1f - jump * 0.4f));
                        target.setScaleY(1.12f * jump + (1f - jump));
                        target.setTranslationY(-dp(11) * jump);
                        target.setRotation(-12f * (float) Math.sin(p * Math.PI * 3.0));
                    }
                }
            });
        } else if ("bonk".equals(animType)) {
            // 搞怪蓄力前冲撞屏幕再弹回来摇晃
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2100);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.32f) {
                        float p = f / 0.32f;
                        target.setTranslationX(-dp(8) * p);
                        target.setRotation(-13f * p);
                        target.setScaleX(1f - 0.10f * p);
                        target.setScaleY(1f + 0.08f * p);
                    } else if (f < 0.50f) {
                        float p = (f - 0.32f) / 0.18f;
                        target.setTranslationX(-dp(8) + dp(20) * p);
                        target.setRotation(-13f + 27f * p);
                        target.setScaleX(0.90f + 0.24f * p);
                        target.setScaleY(1.08f - 0.18f * p);
                    } else {
                        float p = (f - 0.50f) / 0.50f;
                        float damp = 1f - p;
                        target.setTranslationX(dp(12) * damp * (float) Math.cos(p * Math.PI * 3.0));
                        target.setRotation(12f * damp * (float) Math.sin(p * Math.PI * 5.0));
                        target.setScaleX(1f);
                        target.setScaleY(1f);
                    }
                }
            });
        } else if ("nap_startle".equals(animType)) {
            // 打瞌睡慢慢往下掉头，然后猛地一激灵惊醒
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2500);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.72f) {
                        float p = f / 0.72f;
                        target.setRotation(15f * p);
                        target.setTranslationY(dp(4) * p);
                        target.setScaleY(1f - 0.08f * p);
                        target.setScaleX(1f + 0.05f * p);
                    } else {
                        float p = (f - 0.72f) / 0.28f;
                        float jolt = (float) Math.sin(p * Math.PI);
                        target.setRotation(-8f * jolt);
                        target.setTranslationY(-dp(9) * jolt);
                        target.setScaleX(1f - 0.06f * jolt);
                        target.setScaleY(1f + 0.10f * jolt);
                    }
                }
            });
        } else if ("curious".equals(animType)) {
            // 歪头左右打量好奇宝宝
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2100);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float tilt = (float) Math.sin(f * Math.PI * 2.0);
                    target.setRotation(14f * tilt);
                    target.setScaleX(1f + 0.05f * Math.abs(tilt));
                    target.setScaleY(1f + 0.04f * (1f - Math.abs(tilt)));
                }
            });
        } else if ("shake".equals(animType)) {
            petActionAnim = ValueAnimator.ofFloat(-1f, 1f);
            petActionAnim.setDuration(150);
            petActionAnim.setRepeatCount(6);
            petActionAnim.setRepeatMode(ValueAnimator.REVERSE);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    target.setRotation(11f * f);
                    target.setScaleX(1f + 0.04f * Math.abs(f));
                    target.setScaleY(1f - 0.04f * Math.abs(f));
                }
            });
        } else {
            // 默认柔和 Q 弹落地回弹
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(1250);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float hop = Math.abs((float) Math.sin(f * Math.PI * 2.0));
                    target.setTranslationY(-dp(8) * hop);
                    target.setScaleX(1.06f - 0.10f * hop);
                    target.setScaleY(0.94f + 0.12f * hop);
                    target.setRotation(5f * (float) Math.sin(f * Math.PI * 2.0));
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
                applyPetBottomPivot(target, 0.88f);
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

        // 3. 鲸鱼娘互动动作两排（4×2，点击自动退到悬浮窗外面表演给你看！）
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
                collapsePanel();
                triggerFeedRiceAction();
            }
        });

        TextView patBtn = createGridBtn("👋摸头");
        patBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerHeadPatAction();
            }
        });

        TextView danceBtn = createGridBtn("💃跳舞");
        danceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerDanceAction();
            }
        });

        TextView mischiefBtn = createGridBtn("😈捣蛋");
        mischiefBtn.setTextColor(Color.parseColor("#E9D5FF"));
        setViewBg(mischiefBtn, createRoundRect("#3B0764", 8, "#A855F7", 1));
        LinearLayout.LayoutParams misLp = (LinearLayout.LayoutParams) mischiefBtn.getLayoutParams();
        misLp.rightMargin = 0;
        mischiefBtn.setLayoutParams(misLp);
        mischiefBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerMischiefAction(true);
            }
        });

        petActionRow.addView(feedBtn);
        petActionRow.addView(patBtn);
        petActionRow.addView(danceBtn);
        petActionRow.addView(mischiefBtn);
        panel.addView(petActionRow);

        LinearLayout petActionRow2 = new LinearLayout(this);
        petActionRow2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actBarLp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actBarLp2.topMargin = dp(5);
        petActionRow2.setLayoutParams(actBarLp2);

        TextView singBtn = createGridBtn("🎤唱歌");
        singBtn.setTextColor(Color.parseColor("#F9A8D4"));
        setViewBg(singBtn, createRoundRect("#3B102E", 8, "#EC4899", 1));
        singBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerSingSongAction();
            }
        });

        TextView importSongBtn = createGridBtn("📥导歌");
        importSongBtn.setTextColor(Color.parseColor("#A7F3D0"));
        setViewBg(importSongBtn, createRoundRect("#064E3B", 8, "#10B981", 1));
        importSongBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityForSongImport();
            }
        });

        TextView memeBtn = createGridBtn("🫧热梗");
        memeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerRandomMemeVoice();
            }
        });

        TextView takeoutCheckBtn = createGridBtn("🛵查外卖");
        takeoutCheckBtn.setTextColor(Color.parseColor("#FED7AA"));
        setViewBg(takeoutCheckBtn, createRoundRect("#431407", 8, "#F97316", 1));
        LinearLayout.LayoutParams tkBtnLp = (LinearLayout.LayoutParams) takeoutCheckBtn.getLayoutParams();
        tkBtnLp.rightMargin = 0;
        takeoutCheckBtn.setLayoutParams(tkBtnLp);
        takeoutCheckBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                checkTakeoutOnScreenManual();
            }
        });

        petActionRow2.addView(singBtn);
        petActionRow2.addView(importSongBtn);
        petActionRow2.addView(memeBtn);
        petActionRow2.addView(takeoutCheckBtn);
        panel.addView(petActionRow2);

        // 3b. 个性开关两行（3x2）：防误触 / 语音尾巴 / 外置互动 / 自由漫步 / 头顶气泡 / 透明歌词
        LinearLayout prefSwitchRow1 = new LinearLayout(this);
        prefSwitchRow1.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams psLp1 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        psLp1.topMargin = dp(6);
        prefSwitchRow1.setLayoutParams(psLp1);

        antiMistouchToggleBtn = createGridBtn("🛡️防误触:关");
        antiMistouchToggleBtn.setTextSize(10f);
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
        voiceTailToggleBtn.setTextSize(10f);
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

        extPetBarToggleBtn = createGridBtn("🐾外置互动:开");
        extPetBarToggleBtn.setTextSize(10f);
        LinearLayout.LayoutParams epbLp = (LinearLayout.LayoutParams) extPetBarToggleBtn.getLayoutParams();
        epbLp.rightMargin = 0;
        extPetBarToggleBtn.setLayoutParams(epbLp);
        extPetBarToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showExternalPetBar = !showExternalPetBar;
                savePrefBool("show_ext_pet_bar", showExternalPetBar);
                applyExternalPetBarVisibility();
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        showExternalPetBar ? "已显示大肥鱼外置互动条（就在外面直接点！）" : "已隐藏外置互动条",
                        Toast.LENGTH_SHORT).show();
            }
        });

        prefSwitchRow1.addView(antiMistouchToggleBtn);
        prefSwitchRow1.addView(voiceTailToggleBtn);
        prefSwitchRow1.addView(extPetBarToggleBtn);
        panel.addView(prefSwitchRow1);

        LinearLayout prefSwitchRow2 = new LinearLayout(this);
        prefSwitchRow2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams psLp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        psLp2.topMargin = dp(5);
        prefSwitchRow2.setLayoutParams(psLp2);

        freeRoamToggleBtn = createGridBtn("🚶自由漫步:开");
        freeRoamToggleBtn.setTextSize(10f);
        freeRoamToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                freeRoamEnabled = !freeRoamEnabled;
                savePrefBool("free_roam_enabled", freeRoamEnabled);
                if (!freeRoamEnabled) stopPetRoaming();
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        freeRoamEnabled ? "已开启：大肥鱼将在屏幕内自由散步~" : "已关闭自由漫步：停在角落不动",
                        Toast.LENGTH_SHORT).show();
            }
        });

        headBubbleToggleBtn = createGridBtn("💬头顶气泡:开");
        headBubbleToggleBtn.setTextSize(10f);
        headBubbleToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                headBubbleEnabled = !headBubbleEnabled;
                savePrefBool("show_head_bubble", headBubbleEnabled);
                if (!headBubbleEnabled && headSpeechBubbleView != null) {
                    mainHandler.removeCallbacks(headBubbleHideRunnable);
                    headSpeechBubbleView.setVisibility(View.GONE);
                } else if (headBubbleEnabled) {
                    scheduleNextAutoHeadBubble();
                }
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        headBubbleEnabled ? "已开启透明头顶气泡（约5~10分钟自动弹一条）" : "已关闭大肥鱼头顶气泡",
                        Toast.LENGTH_SHORT).show();
            }
        });

        floatingLyricsToggleBtn = createGridBtn("🪟透明歌词:开");
        floatingLyricsToggleBtn.setTextSize(10f);
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

        prefSwitchRow2.addView(freeRoamToggleBtn);
        prefSwitchRow2.addView(headBubbleToggleBtn);
        prefSwitchRow2.addView(floatingLyricsToggleBtn);
        panel.addView(prefSwitchRow2);
        refreshPrefSwitchButtons();

        // 4. QQ 音乐联动迷你卡片 + 外卖订单实时同步卡片
        panel.addView(buildQqMusicCard());
        panel.addView(buildTakeoutSyncCard());

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
        refreshTakeoutUi();
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
        musicPermHintView.setText("开通知同步歌词/外卖");
        musicPermHintView.setTextColor(Color.parseColor("#FDE68A"));
        musicPermHintView.setTextSize(10f);
        musicPermHintView.setPadding(dp(6), dp(2), dp(6), dp(2));
        setViewBg(musicPermHintView, createRoundRect("#451A03", 8, "#F59E0B", 1));
        musicPermHintView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Toast.makeText(FloatAgentService.this, "开启「DeepSeek·星语」通知使用权即可实时同步 QQ 音乐歌词与外卖进度", Toast.LENGTH_LONG).show();
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

    private LinearLayout buildTakeoutSyncCard() {
        takeoutCardBox = new LinearLayout(this);
        takeoutCardBox.setOrientation(LinearLayout.VERTICAL);
        takeoutCardBox.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(takeoutCardBox, createRoundRect("#2A1305", 12, "#F97316", 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        takeoutCardBox.setLayoutParams(lp);
        takeoutCardBox.setVisibility(View.GONE);

        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);

        takeoutTitleView = new TextView(this);
        takeoutTitleView.setText("🛵 外卖进度实时同步中");
        takeoutTitleView.setTextColor(Color.parseColor("#FED7AA"));
        takeoutTitleView.setTextSize(11.5f);
        takeoutTitleView.setTypeface(null, android.graphics.Typeface.BOLD);
        takeoutTitleView.setSingleLine(true);
        takeoutTitleView.setEllipsize(TextUtils.TruncateAt.END);
        takeoutTitleView.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        TextView clearBtn = new TextView(this);
        clearBtn.setText("✓已取餐");
        clearBtn.setTextColor(Color.parseColor("#FDE68A"));
        clearBtn.setTextSize(10f);
        clearBtn.setPadding(dp(6), dp(2), dp(6), dp(2));
        setViewBg(clearBtn, createRoundRect("#451A03", 8, "#FB923C", 1));
        clearBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                takeoutPlatform = "";
                takeoutStage = "";
                takeoutTitle = "";
                takeoutDetail = "";
                takeoutUpdatedMs = 0L;
                lastAnnouncedTakeoutKey = "";
                refreshTakeoutUi();
                refreshCollapsedPill();
                Toast.makeText(FloatAgentService.this, "已清理当前外卖卡片，祝主人在饭点吃得香~ 🍚", Toast.LENGTH_SHORT).show();
            }
        });

        topRow.addView(takeoutTitleView);
        topRow.addView(clearBtn);
        takeoutCardBox.addView(topRow);

        takeoutDetailView = new TextView(this);
        takeoutDetailView.setText("等待美团/饿了么/京东秒送订单推送…");
        takeoutDetailView.setTextColor(Color.parseColor("#FFEDD5"));
        takeoutDetailView.setTextSize(11f);
        takeoutDetailView.setMaxLines(2);
        takeoutDetailView.setEllipsize(TextUtils.TruncateAt.END);
        takeoutDetailView.setPadding(0, dp(3), 0, 0);
        takeoutCardBox.addView(takeoutDetailView);

        return takeoutCardBox;
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
        if (extPetBarToggleBtn != null) {
            extPetBarToggleBtn.setText(showExternalPetBar ? "🐾外置互动:开" : "🐾外置互动:关");
            extPetBarToggleBtn.setTextColor(Color.parseColor(showExternalPetBar ? "#C4B5FD" : "#94A3B8"));
            setViewBg(extPetBarToggleBtn, createRoundRect(
                    showExternalPetBar ? "#2E1065" : "#1E293B",
                    8,
                    showExternalPetBar ? "#8B5CF6" : "#334155",
                    1
            ));
        }
        if (freeRoamToggleBtn != null) {
            freeRoamToggleBtn.setText(freeRoamEnabled ? "🚶自由漫步:开" : "🚶自由漫步:关");
            freeRoamToggleBtn.setTextColor(Color.parseColor(freeRoamEnabled ? "#67E8F9" : "#94A3B8"));
            setViewBg(freeRoamToggleBtn, createRoundRect(
                    freeRoamEnabled ? "#164E63" : "#1E293B",
                    8,
                    freeRoamEnabled ? "#06B6D4" : "#334155",
                    1
            ));
        }
        if (headBubbleToggleBtn != null) {
            headBubbleToggleBtn.setText(headBubbleEnabled ? "💬头顶气泡:开" : "💬头顶气泡:关");
            headBubbleToggleBtn.setTextColor(Color.parseColor(headBubbleEnabled ? "#F9A8D4" : "#94A3B8"));
            setViewBg(headBubbleToggleBtn, createRoundRect(
                    headBubbleEnabled ? "#500724" : "#1E293B",
                    8,
                    headBubbleEnabled ? "#EC4899" : "#334155",
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
        boolean selfPlayingOrCooling = (System.currentTimeMillis() - lastWhaleAudioStopMs < 950L)
                || (singerEngine != null && singerEngine.isSinging());
        if (!selfPlayingOrCooling && petVoicePlayer != null) {
            try {
                if (petVoicePlayer.isPlaying()) selfPlayingOrCooling = true;
            } catch (Exception ignored) {}
        }

        if (qqMusicPlaying) {
            // 若用户未开通知读取且 qqMusicPlaying 滞留超过 3 秒，对照系统媒体活跃态做自愈校验
            if (!selfPlayingOrCooling && !QqMusicListenerService.isNotificationAccessEnabled(this)) {
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am != null && !am.isMusicActive()) {
                        return false;
                    }
                } catch (Throwable ignored) {}
            }
            return true;
        }

        // 自身刚发声或正在发声时的冷却期内，绝不把自身残余缓冲误判为外部音乐！
        if (selfPlayingOrCooling) {
            return false;
        }
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
        // 必须先判断外部是否在播歌，再停掉大肥鱼自己上一句的播放器，防止残留音频缓冲误判成“外部在放歌”
        boolean musicPlaying = isExternalMusicPlayingNow();
        if (singerEngine != null && singerEngine.isSinging()) {
            singerEngine.stop();
        }
        stopWhaleVoicePlayer();
        wakePetOpacity();
        mainHandler.removeCallbacks(happyResetRunnable);
        mainHandler.removeCallbacks(subtitleResetRunnable);

        setPetPoseDrawable(drawableResId);
        playPetBounceAnim(animType);

        // 音乐播放模式下默认保持安静，不主动出声打扰听歌
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
                // 使用媒体音量通道（避免手机静音/振动或通知音量为 0 时大肥鱼彻底无声），且不申请 AudioFocus
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                } else {
                    mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
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
                mp.setVolume(1.0f, 1.0f);
                petVoicePlayer = mp;
                petVoicePlayer.start();
            }
        } catch (Throwable ignored) {
            stopWhaleVoicePlayer();
        }
    }

    private void stopWhaleVoicePlayer() {
        if (petVoicePlayer != null) {
            lastWhaleAudioStopMs = System.currentTimeMillis();
            try {
                if (petVoicePlayer.isPlaying()) petVoicePlayer.stop();
            } catch (Exception ignored) {}
            try {
                petVoicePlayer.release();
            } catch (Exception ignored) {}
            petVoicePlayer = null;
        }
    }

    // ========= 全屏自由漫步 + 头顶气泡吐槽天气 & 暖心安慰鼓励 =========
    private void scheduleNextAutoHeadBubble() {
        long delayMs = (5 * 60_000L) + petRandom.nextInt(5 * 60_000 + 1);
        nextAutoHeadBubbleAtMs = System.currentTimeMillis() + delayMs;
    }

    private void showHeadBubble(final String msg, final long durationMs) {
        if (headSpeechBubbleView == null || msg == null || msg.trim().isEmpty()) return;
        if (!headBubbleEnabled) {
            headSpeechBubbleView.setVisibility(View.GONE);
            return;
        }
        mainHandler.removeCallbacks(headBubbleHideRunnable);
        headSpeechBubbleView.animate().cancel();
        headSpeechBubbleView.setText(msg.trim());
        headSpeechBubbleView.setAlpha(0f);
        headSpeechBubbleView.setScaleX(0.84f);
        headSpeechBubbleView.setScaleY(0.84f);
        headSpeechBubbleView.setVisibility(View.VISIBLE);
        headSpeechBubbleView.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(220)
                .start();
        if (durationMs > 0) {
            mainHandler.postDelayed(headBubbleHideRunnable, durationMs);
        }
    }

    private void stopPetRoaming() {
        if (petRoamAnimator != null) {
            petRoamAnimator.cancel();
            petRoamAnimator = null;
        }
        if (petAvatarView != null) {
            petAvatarView.setTranslationY(0f);
            petAvatarView.setTranslationX(0f);
            petAvatarView.setRotation(0f);
            petAvatarView.setScaleX(1f);
            petAvatarView.setScaleY(1f);
            applyPetBottomPivot(petAvatarView, 0.88f);
        }
    }

    private void startPetFreeRoamStep() {
        if (windowManager == null || floatRootView == null || layoutParams == null || isExpanded || isDraggingPet) {
            return;
        }
        stopPetRoaming();
        if (petActionAnim != null && petActionAnim.isRunning()) {
            petActionAnim.cancel();
        }

        final DisplayMetrics dm = getResources().getDisplayMetrics();
        int petW = (petBubbleContainer != null && petBubbleContainer.getWidth() > 0) ? petBubbleContainer.getWidth() : dp(96);
        int petH = (petBubbleContainer != null && petBubbleContainer.getHeight() > 0) ? petBubbleContainer.getHeight() : dp(120);

        final int minX = dp(8);
        final int maxX = Math.max(minX + dp(40), dm.widthPixels - Math.min(petW, dp(160)) - dp(8));
        final int minY = dp(52);
        final int maxY = Math.max(minY + dp(80), dm.heightPixels - petH - dp(95));

        final int startX = layoutParams.x;
        final int startY = layoutParams.y;

        // 舒缓自然漫步：每次选取中短优雅步幅（75dp ~ 185dp），在全屏安全区里悠闲踱步而非瞬移乱窜
        int stepDistMin = dp(75);
        int stepDistMax = dp(185);
        double angle = petRandom.nextDouble() * Math.PI * 2.0;
        int distTarget = stepDistMin + petRandom.nextInt(Math.max(10, stepDistMax - stepDistMin));
        int candX = Math.round((float) (startX + Math.cos(angle) * distTarget));
        int candY = Math.round((float) (startY + Math.sin(angle) * distTarget));
        if (candX < minX || candX > maxX) {
            candX = Math.round((float) (startX - Math.cos(angle) * distTarget));
        }
        if (candY < minY || candY > maxY) {
            candY = Math.round((float) (startY - Math.sin(angle) * distTarget));
        }

        final int targetX = Math.max(minX, Math.min(candX, maxX));
        final int targetY = Math.max(minY, Math.min(candY, maxY));

        // 依据走路方向自动转身（向左走面朝左，向右走面朝右）
        final float dirSign = (targetX < startX) ? -1f : 1f;
        final float arcLift = (petRandom.nextBoolean() ? 1f : -1f) * dp(10 + petRandom.nextInt(14));
        if (petAvatarView != null) {
            applyPetBottomPivot(petAvatarView, 0.88f);
            petAvatarView.setScaleX(dirSign);
        }
        setPetPoseDrawable(R.drawable.feiyu_walk);
        mainHandler.removeCallbacks(lifePoseResetRunnable);

        double dist = Math.hypot(targetX - startX, targetY - startY);
        // 慢速悠闲散步：约 dist * 13 ms（最低 3800ms，最高 7400ms），彻底告别赶路瞬移感
        long durMs = Math.max(3800L, Math.min(7400L, Math.round(dist * 13.0)));
        final int strideCycles = Math.max(4, Math.min(8, (int) Math.round(dist / Math.max(1, dp(26)))));

        petRoamAnimator = ValueAnimator.ofFloat(0f, 1f);
        petRoamAnimator.setDuration(durMs);
        petRoamAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                if (isExpanded || isDraggingPet || windowManager == null || floatRootView == null) {
                    return;
                }
                float f = (float) animation.getAnimatedValue();
                // 缓入缓出 + 轻微正弦弧线偏移（真实生命游走曲线而非直尺平移）
                float smooth = (float) (0.5 - 0.5 * Math.cos(Math.PI * f));
                float arcOffset = (float) Math.sin(Math.PI * f) * arcLift;
                int rawX = Math.round(startX + (targetX - startX) * smooth);
                int rawY = Math.round(startY + (targetY - startY) * smooth + arcOffset);
                layoutParams.x = Math.max(minX, Math.min(rawX, maxX));
                layoutParams.y = Math.max(minY, Math.min(rawY, maxY));
                savedPillX = layoutParams.x;
                savedPillY = layoutParams.y;
                if (petAvatarView != null) {
                    applyPetBottomPivot(petAvatarView, 0.88f);
                    float phase = (float) (f * Math.PI * strideCycles);
                    float hop = Math.abs((float) Math.sin(phase));
                    float sway = (float) Math.sin(phase);
                    petAvatarView.setTranslationY(-hop * dp(9) * 0.5f);
                    petAvatarView.setRotation(4.8f * sway);
                    petAvatarView.setScaleX(dirSign * (1.035f - 0.06f * hop));
                    petAvatarView.setScaleY(0.965f + 0.065f * hop);
                }
                try {
                    windowManager.updateViewLayout(floatRootView, layoutParams);
                } catch (Exception ignored) {}
            }
        });
        petRoamAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                if (petAvatarView != null) {
                    petAvatarView.animate()
                            .translationY(0f)
                            .rotation(0f)
                            .scaleX(1f)
                            .scaleY(1f)
                            .setDuration(260)
                            .start();
                }
                if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus)) {
                    int endPose = (petRandom.nextInt(10) < 3) ? R.drawable.feiyu_derp : (petRandom.nextBoolean() ? R.drawable.feiyu_happy : R.drawable.feiyu_idle);
                    setPetPoseDrawable(endPose);
                    if (endPose == R.drawable.feiyu_derp) {
                        playPetBounceAnim("curious");
                    }
                    mainHandler.postDelayed(lifePoseResetRunnable, 3400);
                }
            }
        });
        petRoamAnimator.start();
    }

    private void fetchWeatherSummaryAsync() {
        lastWeatherFetchMs = System.currentTimeMillis();
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(WEATHER_ENDPOINT).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(4500);
                    if (conn.getResponseCode() == 200) {
                        InputStream is = conn.getInputStream();
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[1024];
                        int n;
                        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                        JSONObject j = new JSONObject(new String(bos.toByteArray(), StandardCharsets.UTF_8));
                        if (j.optBoolean("ok", false)) {
                            cachedWeatherCity = j.optString("city", "").trim();
                            cachedWeatherDesc = j.optString("weatherDesc", "").trim();
                            cachedWeatherTempC = j.optString("tempC", "").trim();
                        }
                    }
                } catch (Throwable ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    private String buildWeatherRoastLine() {
        String cityPart = cachedWeatherCity.isEmpty() ? "外面" : (cachedWeatherCity + "这边");
        String desc = cachedWeatherDesc;
        int tempVal = Integer.MIN_VALUE;
        if (!cachedWeatherTempC.isEmpty()) {
            try { tempVal = Integer.parseInt(cachedWeatherTempC); } catch (Exception ignored) {}
        }

        if (!desc.isEmpty() && tempVal != Integer.MIN_VALUE) {
            if (desc.contains("雨")) {
                return "☔ " + cityPart + "竟然在" + desc + "（" + tempVal + "°C）！出门可别忘带伞，小心把衣服打湿啦~";
            }
            if (desc.contains("雪")) {
                return "❄️ 哇塞！" + cityPart + desc + " " + tempVal + "°C 了，冷得我都想缩进被窝里吃热乎白米饭！";
            }
            if (desc.contains("雷") || desc.contains("风") || desc.contains("沙")) {
                return "🌬️ " + cityPart + "现在" + desc + "（" + tempVal + "°C），外面妖风阵阵的，老实待在室内最安全~";
            }
            if (tempVal <= 10) {
                return "🧣 " + cityPart + desc + "才 " + tempVal + "°C 呀！好冻鱼，快多穿件外套再喝口热茶暖暖手~";
            }
            if (tempVal >= 29) {
                return "🥵 " + cityPart + desc + "都 " + tempVal + "°C 了，热得像蒸桑拿！记得多喝水别中暑呀~";
            }
            if (desc.contains("晴")) {
                return "☀️ " + cityPart + "今天" + desc + " " + tempVal + "°C，阳光超舒服的！适合伸个懒腰晒晒背~";
            }
            return "🌤️ 偷看了眼" + cityPart + "天气：" + desc + " " + tempVal + "°C，不冷不热的刚刚好呢~";
        }

        int hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        if (hour >= 6 && hour < 10) {
            return "🌅 早上风还有点凉凉的，出门记得多披一件小外套，顺便吃顿热腾腾的早饭呀~";
        } else if (hour >= 10 && hour < 15) {
            return "☀️ 太阳晒到正午啦！也不知道外面热不热，反正待在空调/室内陪着你最安逸~";
        } else if (hour >= 15 && hour < 19) {
            return "⛅ 下午天空慢慢变温柔啦~ 忙了一天快瞅瞅窗外云朵，歇口气再继续！";
        } else if (hour >= 19 && hour < 23) {
            return "🌙 天黑降温最容易偷着凉啦，注意保暖哦，大肥鱼给你捂捂手~";
        } else {
            return "✨ 夜深了外面风肯定很冷吧，还在熬夜的话本鱼可要生气督促你早点休息咯！";
        }
    }

    private void showRandomWeatherOrComfortBubble() {
        // 45% 吐槽实时/分时段天气，55% 温柔安慰鼓励话语
        if (petRandom.nextInt(10) < 4) {
            showHeadBubble(buildWeatherRoastLine(), 5500);
            return;
        }
        String[] comfortLines = new String[]{
                "💙 累了就歇两分钟吧，大肥鱼在这里陪你把烦恼一口一口吞掉~ 💪",
                "✨ 没关系哒，慢一点也没关系的，今天的你已经做得很棒啦！",
                "🍚 心情要是有点阴天，就点一下「喂饭」分你一半干饭好心情~",
                "🫧 不管外面刮风还是下雨，屏幕里永远有一只大肥鱼站在你这边！",
                "🫂 遇到难搞的事别一个人硬扛呀，深呼吸吐个泡泡，一切都会好起来的~",
                "🌟 休息不是偷懒哦，是为了攒足能量再接着往前冲呀！加把劲~",
                "💙 偷偷告诉你：只要每天都能看见你，大肥鱼的算力就会自动充满电！",
                "🍀 烦躁的时候就看看我到处乱溜达吧，把坏情绪全都甩在身后~",
                "🍰 忙完这一小段，记得去奖励自己一杯喜欢的奶茶或者好吃的哦！",
                "🐾 别紧张别焦虑，有我在旁边给你加油打气，你比自己想象中还要厉害！"
        };
        int idx = petRandom.nextInt(comfortLines.length);
        showHeadBubble(comfortLines[idx], 5400);
    }

    private void showPetSubtitle(String text, long durationMs) {
        if (subtitleBannerView != null && text != null) {
            subtitleBannerView.setText(text);
        }
        if (feedbackTextView != null && text != null) {
            feedbackTextView.setText(text);
            feedbackTextView.setTextColor(Color.parseColor("#BAE6FD"));
        }
        // 在折叠态桌面状态下，说话同步在肥鱼头顶以气泡形式弹出，交互反馈一眼直达！
        if (!isExpanded && text != null && !text.trim().isEmpty()
                && (singerEngine == null || !singerEngine.isSinging()) && !qqMusicPlaying) {
            showHeadBubble(text, Math.max(3600L, durationMs));
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
                "slip",
                "🌀 至于大肥鱼摔跤嘛，先得讨论鱼为什么会在陆地上…晃晕啦！",
                true
        );
    }

    private void triggerMischiefAction(final boolean withSpeechBubble) {
        final int mode = (withSpeechBubble ? mischiefIndex : petRandom.nextInt(6)) % 6;
        if (withSpeechBubble) mischiefIndex++;

        stopPetRoaming();
        int[] voices = new int[]{
                R.raw.feiyu_dizzy, R.raw.feiyu_not_fat, R.raw.feiyu_eat_rice_2,
                R.raw.feiyu_pat_soft, R.raw.feiyu_slacking, R.raw.feiyu_refuse
        };
        int[] poses = new int[]{
                R.drawable.feiyu_dizzy, R.drawable.feiyu_derp, R.drawable.feiyu_eating,
                R.drawable.feiyu_beg, R.drawable.feiyu_sleepy, R.drawable.feiyu_derp
        };
        String[] anims = new String[]{
                "slip", "upside_down", "nibble",
                "bubble_pop", "nap_startle", "bonk"
        };
        String[] lines = new String[]{
                "🌀 哎呀！谁把屏幕擦这么滑，鱼尾巴原地转圈劈叉了！",
                "🙃 倒立看世界！咦，你的黑眼圈好像变浅了一点点呢 😜",
                "🤫 咔哧咔哧…偷偷啃掉你屏幕上一点无聊和烦恼，不许说出去~",
                "🫧 噗——本来想吹个超级大泡泡，结果啪一下吓自己一跳！",
                "💤 呼……才没有偷睡！只是闭眼帮你偷偷加载快乐外挂 ⚡",
                "😈 咚！蓄力冲撞屏幕汇报：前方挺硬，但撞走所有坏心情啦 💥"
        };

        if (withSpeechBubble) {
            playWhaleVoice(voices[mode], poses[mode], anims[mode], lines[mode], true);
        } else {
            // 自主周期动作：悄悄做滑稽捣蛋表情和拟真动画，严守低频气泡规则不吵主人
            mainHandler.removeCallbacks(lifePoseResetRunnable);
            setPetPoseDrawable(poses[mode]);
            playPetBounceAnim(anims[mode]);
            mainHandler.postDelayed(lifePoseResetRunnable, 3600);
        }
    }

    private void playCustomSongById(String songId) {
        if (singerEngine == null) {
            singerEngine = new WhaleSingerEngine();
        }
        reloadCustomSongs();
        if (customSongs.isEmpty()) {
            Toast.makeText(this, "尚未导入本地实际歌声，先为你播放内置示例唱词~", Toast.LENGTH_SHORT).show();
            triggerSingSongAction();
            return;
        }
        CustomSongItem target = null;
        for (int i = 0; i < customSongs.size(); i++) {
            if (customSongs.get(i).id.equals(songId)) {
                target = customSongs.get(i);
                singSongIndex = i + 1;
                break;
            }
        }
        if (target == null) {
            target = customSongs.get(0);
        }
        if (isExternalMusicPlayingNow()) {
            setPetPoseDrawable(R.drawable.feiyu_dance);
            playPetBounceAnim("dance");
            showPetSubtitle("🎵 音乐正在播放中，大肥鱼安静伴舞不打扰你听歌~", 3200);
            return;
        }
        stopWhaleVoicePlayer();
        setPetPoseDrawable(R.drawable.feiyu_dance);
        playPetBounceAnim("dance");
        singerEngine.startCustomFile(target.title, target.filePath);
    }

    private void triggerSingSongAction() {
        if (singerEngine == null) {
            singerEngine = new WhaleSingerEngine();
        }
        reloadCustomSongs();
        final int totalTracks = !customSongs.isEmpty() ? customSongs.size() : 2;
        if (singerEngine.isSinging() && singSongIndex > 0 && (singSongIndex % (totalTracks + 1) == totalTracks)) {
            singerEngine.stop();
            setPetPoseDrawable(R.drawable.feiyu_happy);
            showPetSubtitle("🎵 鲸鱼娘唱完收工啦，快奖励一碗白米饭！🍚", 3200);
            singSongIndex++;
            return;
        }
        if (isExternalMusicPlayingNow()) {
            setPetPoseDrawable(R.drawable.feiyu_dance);
            playPetBounceAnim("dance");
            showPetSubtitle("🎵 音乐正在播放中，大肥鱼安静伴舞不打扰你听歌~", 3200);
            Toast.makeText(this, "🎵 QQ 音乐播放中已静音伴舞（暂停音乐后可听大肥鱼真实歌唱）", Toast.LENGTH_SHORT).show();
            return;
        }
        stopWhaleVoicePlayer();
        setPetPoseDrawable(R.drawable.feiyu_dance);
        playPetBounceAnim("dance");

        if (!customSongs.isEmpty()) {
            int idx = singSongIndex % customSongs.size();
            singSongIndex++;
            CustomSongItem item = customSongs.get(idx);
            singerEngine.startCustomFile(item.title, item.filePath);
        } else {
            int builtInIdx = singSongIndex % 2;
            singSongIndex++;
            singerEngine.startBuiltInVocal(builtInIdx);
        }
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
        if (t.contains("捣蛋") || t.contains("搞怪") || t.contains("卖萌") || t.contains("整活") || t.contains("翻跟头")) {
            collapsePanel();
            triggerMischiefAction(true);
            return true;
        }
        if (t.contains("查外卖") || t.contains("我的外卖") || t.contains("外卖到哪") || t.contains("同步外卖")) {
            checkTakeoutOnScreenManual();
            return true;
        }
        if (t.contains("开启漫步") || t.contains("打开漫步") || t.contains("到处走") || t.contains("自由走动")) {
            freeRoamEnabled = true;
            savePrefBool("free_roam_enabled", true);
            refreshPrefSwitchButtons();
            collapsePanel();
            startPetFreeRoamStep();
            return true;
        }
        if (t.contains("关闭漫步") || t.contains("停止漫步") || t.contains("别乱跑")) {
            freeRoamEnabled = false;
            savePrefBool("free_roam_enabled", false);
            stopPetRoaming();
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("关闭气泡") || t.contains("隐藏气泡") || t.contains("关掉气泡")) {
            headBubbleEnabled = false;
            savePrefBool("show_head_bubble", false);
            if (headSpeechBubbleView != null) {
                mainHandler.removeCallbacks(headBubbleHideRunnable);
                headSpeechBubbleView.setVisibility(View.GONE);
            }
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("开启气泡") || t.contains("打开气泡") || t.contains("显示气泡")) {
            headBubbleEnabled = true;
            savePrefBool("show_head_bubble", true);
            scheduleNextAutoHeadBubble();
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("天气") || t.contains("安慰") || t.contains("鼓励") || t.contains("抱抱") || t.contains("心情不好")) {
            collapsePanel();
            showRandomWeatherOrComfortBubble();
            return true;
        }
        if (t.contains("导入歌声") || t.contains("导入歌曲") || t.contains("导入声音") || t.contains("导入实际声音") || t.contains("传歌")) {
            bringMainActivityForSongImport();
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
        if (t.contains("关闭外置") || t.contains("隐藏外置")) {
            showExternalPetBar = false;
            savePrefBool("show_ext_pet_bar", false);
            applyExternalPetBarVisibility();
            refreshPrefSwitchButtons();
            return true;
        }
        if (t.contains("打开外置") || t.contains("开启外置") || t.contains("显示外置")) {
            showExternalPetBar = true;
            savePrefBool("show_ext_pet_bar", true);
            applyExternalPetBarVisibility();
            refreshPrefSwitchButtons();
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

    private static boolean isValidNativeLyricLine(String s) {
        if (s == null) return false;
        String t = s.trim();
        if (t.length() < 2 || t.length() > 75) return false;
        if (t.matches("^\\d{1,2}:\\d{2}.*$")) return false;
        if (t.contains("正在播放") || t.contains("点击打开") || t.contains("正在下载")
                || t.contains("下载完成") || t.contains("桌面歌词") || t.contains("QQ音乐")) {
            return false;
        }
        return true;
    }

    private void handleExternalNativeLyricFromService(String pkg, String rawPrimary, String rawSecondary) {
        String p = rawPrimary != null ? rawPrimary.trim() : "";
        String sec = rawSecondary != null ? rawSecondary.trim() : "";
        if (!isValidNativeLyricLine(p)) return;

        // 避免把歌手名原封不动当作歌词显示
        if (!qqMusicArtist.isEmpty() && p.equalsIgnoreCase(qqMusicArtist)) return;

        // 如果当前尚无歌名，且次级文本形如“歌名 - 歌手”，则先锁定曲目但不以高频歌词充当歌名
        if (qqMusicTitle.isEmpty() && sec.contains(" - ")) {
            String[] parts = sec.split(" - ", 2);
            String guessTitle = parts[0].trim();
            String guessArtist = parts.length > 1 ? parts[1].trim() : "";
            if (!guessTitle.isEmpty()) {
                handleMusicMetadataUpdate(pkg, guessTitle, guessArtist, true, 0L, 0L, false);
            }
        }
        handleExternalNativeLyricLine(p);
    }

    private void handleExternalNativeLyricLine(String lyricLine) {
        String clean = lyricLine != null ? lyricLine.replace('\n', ' ').trim() : "";
        if (!isValidNativeLyricLine(clean)) return;
        qqMusicPlaying = true;
        qqMusicLastNativeLyricMs = System.currentTimeMillis();
        if (!clean.equals(qqMusicCurrentLyric)) {
            qqMusicCurrentLyric = clean;
            alignLrcPositionByNativeLyric(clean);
            refreshMusicUi();
        }
    }

    private void alignLrcPositionByNativeLyric(String nativeLine) {
        if (nativeLine == null || nativeLine.isEmpty()) return;
        String normNative = nativeLine.toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{Punct}，。！？、~]+", "");
        if (normNative.length() < 2) return;
        synchronized (qqMusicLyrics) {
            if (qqMusicLyrics.isEmpty()) return;
            long bestTime = -1L;
            int bestScore = 0;
            for (int i = 0; i < qqMusicLyrics.size(); i++) {
                LyricLine item = qqMusicLyrics.get(i);
                String normItem = item.text.toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{Punct}，。！？、~]+", "");
                if (normItem.isEmpty()) continue;
                int score = 0;
                if (normItem.equals(normNative)) score = 100;
                else if (normItem.contains(normNative) || normNative.contains(normItem)) score = 70;
                if (score > bestScore) {
                    bestScore = score;
                    bestTime = item.timeMs;
                }
            }
            if (bestTime >= 0L && bestScore >= 70) {
                qqMusicPosMs = bestTime;
                qqMusicLastSyncMs = System.currentTimeMillis();
            }
        }
    }

    private static boolean looksLikeLyricSentenceInsteadOfTitle(String title, String artist) {
        if (title == null) return false;
        String t = title.trim();
        if (t.isEmpty()) return false;
        if (!artist.isEmpty()) return false;
        if (t.length() >= 18) return true;
        if (t.contains("，") || t.contains("。") || t.contains("！") || t.contains("？") || t.contains("~")) {
            return true;
        }
        return false;
    }

    /**
     * 识别开启“系统状态栏歌词/灵动岛歌词”后 QQ 音乐将“当前歌词”放到 title、将“歌名-歌手”拼到 artist 的反转元数据。
     * 返回 [真实歌名, 真实歌手]，未命中状态栏反转模式则返回 null。
     */
    private static String[] parseSwappedTrackArtistFromStatusLyric(String rawTitle, String rawArtist) {
        if (rawArtist == null) return null;
        String a = rawArtist.trim();
        if (a.isEmpty()) return null;

        String lowerA = a.toLowerCase(Locale.ROOT);
        if (lowerA.equals("a-lin") || lowerA.equals("t-ara") || lowerA.equals("g-eazy")
                || lowerA.equals("ne-yo") || lowerA.equals("jay-z") || lowerA.equals("x-japan")
                || lowerA.equals("g-dragon") || lowerA.equals("wu-tang")) {
            return null;
        }

        int splitIdx = a.indexOf(" - ");
        int sepLen = 3;
        if (splitIdx <= 0) {
            splitIdx = a.indexOf('-');
            sepLen = 1;
        }
        if (splitIdx <= 0 || splitIdx + sepLen >= a.length()) return null;

        String left = a.substring(0, splitIdx).trim();
        String right = a.substring(splitIdx + sepLen).trim();
        if (left.length() < 2 || right.length() < 2) return null;
        if (rawTitle != null && left.equalsIgnoreCase(rawTitle.trim())) return null;

        boolean strongSignal = (sepLen == 3)
                || left.contains(" ")
                || right.contains("/")
                || right.contains("、")
                || right.contains("&")
                || right.contains(" ")
                || (left.length() >= 4 && right.length() >= 4)
                || (left.matches(".*[\\u4e00-\\u9fa5].*") && right.matches(".*[\\u4e00-\\u9fa5].*"));
        if (!strongSignal) return null;

        return new String[]{left, right};
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
        String rawTitle = title != null ? title.trim() : "";
        String rawArtist = artist != null ? artist.trim() : "";
        if (rawTitle.isEmpty()) return;

        long nowSys = System.currentTimeMillis();
        String effectiveTitle = rawTitle;
        String effectiveArtist = rawArtist;
        String swappedLyricFromTitle = "";

        // 1. 首帧直接侦测 QQ 音乐状态栏歌词反转格式：title="歌词一句", artist="真实歌名-真实歌手"
        String[] swappedPair = parseSwappedTrackArtistFromStatusLyric(rawTitle, rawArtist);
        if (swappedPair != null) {
            effectiveTitle = swappedPair[0];
            effectiveArtist = swappedPair[1];
            swappedLyricFromTitle = rawTitle;
        } else if (exactSession
                && !qqMusicTitle.isEmpty()
                && !rawArtist.isEmpty()
                && rawArtist.equals(lastRawSessionArtist)
                && durMs > 0
                && durMs == lastRawSessionDurationMs
                && !rawTitle.equalsIgnoreCase(lastRawSessionTitle)
                && !rawTitle.equalsIgnoreCase(qqMusicTitle)) {
            // 2. 兜底侦测：同一个 MediaSession（同一原始歌手与同一总时长 ms）下，title 突然每几秒换一次 -> 必为状态栏实时滚动歌词！
            swappedLyricFromTitle = rawTitle;
            effectiveTitle = qqMusicTitle;
            effectiveArtist = qqMusicArtist;
        }

        lastRawSessionTitle = rawTitle;
        lastRawSessionArtist = rawArtist;
        if (durMs > 0) {
            lastRawSessionDurationMs = durMs;
        }

        // 3. 防“一句一搜索”硬护栏：非官方 MediaSession 来源时，如检测到歌词特征或短时高频换名，直接当原生同步歌词处理而不搜歌！
        if (!exactSession && swappedLyricFromTitle.isEmpty() && !qqMusicTitle.isEmpty()) {
            boolean titleDiffers = !effectiveTitle.equalsIgnoreCase(qqMusicTitle);
            if (titleDiffers) {
                if (nowSys - lastExternalTitleSwitchMs <= 6500L) {
                    externalRapidSwitchCount++;
                } else {
                    externalRapidSwitchCount = 1;
                }
                lastExternalTitleSwitchMs = nowSys;

                boolean hasRecentNativeLyric = (nowSys - qqMusicLastNativeLyricMs) < 16000L;
                boolean hasOfficialPerm = QqMusicListenerService.isNotificationAccessEnabled(this);
                if (hasRecentNativeLyric
                        || (hasOfficialPerm && effectiveArtist.isEmpty())
                        || externalRapidSwitchCount >= 2
                        || looksLikeLyricSentenceInsteadOfTitle(effectiveTitle, effectiveArtist)) {
                    handleExternalNativeLyricLine(effectiveTitle);
                    return;
                }
            }
        }

        boolean songChanged = !effectiveTitle.equalsIgnoreCase(qqMusicTitle)
                || (!effectiveArtist.isEmpty() && !effectiveArtist.equalsIgnoreCase(qqMusicArtist));

        qqMusicPkg = pkg != null ? pkg : "";
        qqMusicTitle = effectiveTitle;
        if (!effectiveArtist.isEmpty() || songChanged) {
            qqMusicArtist = effectiveArtist;
        }
        qqMusicPlaying = playing;
        if (songChanged) {
            qqMusicPosMs = Math.max(0L, posMs);
            qqMusicLastSyncMs = nowSys;
            qqMusicLastNativeLyricMs = 0L;
            externalRapidSwitchCount = 0;
        } else if (exactSession || posMs > 0) {
            long predicted = qqMusicPosMs;
            if (playing && qqMusicLastSyncMs > 0) {
                predicted += Math.max(0L, nowSys - qqMusicLastSyncMs);
            }
            // 若当前时间偏差超过 1200ms 或暂停状态校准，才直接跳跃对齐，避免 650ms 轮询微差导致歌词抖动或回退
            if (!playing || Math.abs(posMs - predicted) > 1200L) {
                qqMusicPosMs = Math.max(0L, posMs);
                qqMusicLastSyncMs = nowSys;
            }
        }
        if (durMs > 0) {
            qqMusicDurationMs = durMs;
        }

        if (!swappedLyricFromTitle.isEmpty()) {
            // 优先把刚从状态栏歌词反转中分离出来的当前句直接作为原生同步歌词展示，绝不被“同步歌词中…”覆盖！
            if (songChanged) {
                qqMusicLyrics.clear();
                fetchLyricsAsync(effectiveTitle, effectiveArtist);
            }
            handleExternalNativeLyricLine(swappedLyricFromTitle);
        } else if (songChanged) {
            qqMusicLyrics.clear();
            qqMusicCurrentLyric = "♪ 正在匹配《" + effectiveTitle + "》歌词…";
            fetchLyricsAsync(effectiveTitle, effectiveArtist);
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
                        boolean hasLiveNativeLyric = qqMusicLastNativeLyricMs > 0L
                                && (System.currentTimeMillis() - qqMusicLastNativeLyricMs) < 25000L
                                && !qqMusicCurrentLyric.isEmpty()
                                && !qqMusicCurrentLyric.startsWith("♪ 正在匹配");
                        if (parsed.isEmpty()) {
                            // 若 QQ 音乐当前已在实时同步原生歌词，绝不用“暂无时间轴歌词”将其冲掉！
                            if (!hasLiveNativeLyric) {
                                qqMusicCurrentLyric = "♪ 暂无时间轴歌词（可在 QQ 音乐开状态栏歌词直连同步）";
                            }
                        } else if (hasLiveNativeLyric) {
                            alignLrcPositionByNativeLyric(qqMusicCurrentLyric);
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
        if (lrc == null || lrc.trim().isEmpty()) return;
        Pattern tagPattern = Pattern.compile("\\[(\\d{1,3}):(\\d{2})(?:[\\.:](\\d{1,3}))?\\]");
        String[] lines = lrc.split("\\r?\\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            Matcher m = tagPattern.matcher(trimmed);
            List<Long> timestamps = new ArrayList<>();
            while (m.find()) {
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
                    timestamps.add(min * 60000L + sec * 1000L + ms);
                } catch (Exception ignored) {}
            }
            if (timestamps.isEmpty()) continue;
            // 移除行内所有 [mm:ss.xxx] 等时间或元标签，保留纯净歌词内容，确保如 [00:56][02:34]副歌 全部正确进入时间轴
            String cleanText = trimmed.replaceAll("\\[\\d{1,3}:\\d{2}(?:[\\.:]\\d{1,3})?\\]", "").trim();
            if (cleanText.isEmpty()) continue;
            for (Long ts : timestamps) {
                out.add(new LyricLine(ts, cleanText));
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
        // 若过去 4.5 秒内刚接收到 QQ 音乐状态栏/桌面原生推送的实时歌词，优先保持原句完全同频不被本地推算覆写！
        if (now - qqMusicLastNativeLyricMs < 4500L && !qqMusicCurrentLyric.isEmpty()) {
            return;
        }
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

    // ========= 外卖进度实时同步与大肥鱼催餐互动 =========
    private static String resolveTakeoutPlatform(String pkg, String text) {
        String s = text != null ? text : "";
        if ("com.sankuai.meituan".equals(pkg) || "com.sankuai.meituan.takeoutnew".equals(pkg) || s.contains("美团")) {
            return "美团外卖";
        }
        if ("me.ele".equals(pkg) || s.contains("饿了么")) {
            return "饿了么";
        }
        if ("com.jingdong.app.mall".equals(pkg) || "com.jingdong.pdj".equals(pkg) || s.contains("京东")) {
            return "京东秒送";
        }
        if ("com.taobao.taobao".equals(pkg) || "com.wudaokou.hippo".equals(pkg) || s.contains("淘宝") || s.contains("盒马")) {
            return "淘宝闪购/盒马";
        }
        return "外卖订单";
    }

    private static String classifyTakeoutStage(String combined) {
        String s = combined != null ? combined : "";
        if (s.contains("已送达") || s.contains("放入外卖柜") || s.contains("外卖柜") || s.contains("已签收") || s.contains("请及时取餐")) {
            return "arrived";
        }
        if (s.contains("即将送达") || s.contains("距您") || s.contains("距离您")) {
            return "arriving";
        }
        if (s.contains("正在为您配送") || s.contains("正在配送") || s.contains("配送中") || s.contains("骑手已取餐")) {
            return "delivering";
        }
        if (s.contains("骑手已接单") || s.contains("赶往商家") || s.contains("正在备餐") || s.contains("已出餐") || s.contains("商家已接单")) {
            return "preparing";
        }
        return "ordered";
    }

    private void handleExternalTakeoutUpdate(String pkg, String rawTitle, String rawDetail) {
        String t = rawTitle != null ? rawTitle.trim() : "";
        String d = rawDetail != null ? rawDetail.trim() : "";
        String combined = (t + " " + d).trim();
        if (combined.isEmpty()) return;

        takeoutPlatform = resolveTakeoutPlatform(pkg, combined);
        String newStage = classifyTakeoutStage(combined);
        String stageEmoji;
        String stageLabel;
        int pose = R.drawable.feiyu_beg;
        String anim = "bounce";
        String fishReaction;

        if ("arrived".equals(newStage)) {
            stageEmoji = "🎉";
            stageLabel = "已送达！快去取餐啦";
            pose = R.drawable.feiyu_eating;
            anim = "eat";
            fishReaction = "🎉 叮咚！" + takeoutPlatform + "已送达啦！趁热开吃呀，分大肥鱼一口白米饭嘛 🍚";
        } else if ("arriving".equals(newStage)) {
            stageEmoji = "🛵💨";
            stageLabel = "骑手逼近中";
            pose = R.drawable.feiyu_walk;
            anim = "walk";
            fishReaction = "🛵💨 骑手快到啦（" + (t.isEmpty() ? d : t) + "），大肥鱼已经在门口流口水蹲守了 🤤";
        } else if ("delivering".equals(newStage)) {
            stageEmoji = "🛵";
            stageLabel = "骑手配送中";
            pose = R.drawable.feiyu_happy;
            anim = "bounce";
            fishReaction = "🛵 哇！" + takeoutPlatform + "骑手已取餐狂奔在路上了，再忍忍马上就能干饭~ 🍚";
        } else if ("preparing".equals(newStage)) {
            stageEmoji = "👨‍🍳";
            stageLabel = "备餐/接单中";
            pose = R.drawable.feiyu_beg;
            anim = "nibble";
            fishReaction = "👨‍🍳 发现" + takeoutPlatform + "正在备餐中！大肥鱼已备好小勺子一起等开饭 🤤";
        } else {
            stageEmoji = "📦";
            stageLabel = "订单跟踪中";
            pose = R.drawable.feiyu_focus;
            anim = "curious";
            fishReaction = "📦 已帮你同步" + takeoutPlatform + "状态，我会帮你盯着送达进度哒~";
        }

        takeoutStage = newStage;
        takeoutTitle = stageEmoji + " " + takeoutPlatform + " · " + (t.isEmpty() ? stageLabel : t);
        takeoutDetail = !d.isEmpty() ? d : stageLabel;
        takeoutUpdatedMs = System.currentTimeMillis();

        refreshTakeoutUi();
        refreshCollapsedPill();

        // 仅在阶段跃迁时冒泡欢迎/播报，同一配送阶段位置微调绝不反复弹窗吵人
        String announceKey = takeoutPlatform + "::" + newStage;
        if (!announceKey.equals(lastAnnouncedTakeoutKey)) {
            lastAnnouncedTakeoutKey = announceKey;
            if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus) && !isExternalMusicPlayingNow()) {
                wakePetOpacity();
                setPetPoseDrawable(pose);
                playPetBounceAnim(anim);
                showPetSubtitle(fishReaction, 5200);
                mainHandler.removeCallbacks(lifePoseResetRunnable);
                mainHandler.postDelayed(lifePoseResetRunnable, 4200);
            }
        }
    }

    private void refreshTakeoutUi() {
        if (takeoutCardBox == null) return;
        boolean active = !takeoutTitle.isEmpty() && (System.currentTimeMillis() - takeoutUpdatedMs) < 3 * 3600 * 1000L;
        takeoutCardBox.setVisibility(active ? View.VISIBLE : View.GONE);
        if (active) {
            if (takeoutTitleView != null) takeoutTitleView.setText(takeoutTitle);
            if (takeoutDetailView != null) takeoutDetailView.setText(takeoutDetail);
        }
    }

    private void checkTakeoutOnScreenManual() {
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        boolean scanned = a11y != null && a11y.scanCurrentTakeoutScreenNow();
        if (scanned) {
            refreshTakeoutUi();
            Toast.makeText(this, "🛵 已同步当前页面外卖最新进度！", Toast.LENGTH_SHORT).show();
            return;
        }
        boolean hasActive = !takeoutTitle.isEmpty() && (System.currentTimeMillis() - takeoutUpdatedMs) < 3 * 3600 * 1000L;
        if (hasActive) {
            refreshTakeoutUi();
            Toast.makeText(this, "🛵 当前外卖进度：" + takeoutTitle + " - " + takeoutDetail, Toast.LENGTH_LONG).show();
        } else {
            boolean notifGranted = QqMusicListenerService.isNotificationAccessEnabled(this);
            if (!notifGranted) {
                Toast.makeText(this, "开启「通知使用权」后，美团/饿了么/京东发通知就会自动同步外卖；也可先打开订单页再点「🛵查外卖」~", Toast.LENGTH_LONG).show();
                QqMusicListenerService.openNotificationListenerSettings(this);
            } else {
                Toast.makeText(this, "🛵 暂未收到外卖通知：美团/饿了么有骑手或送达推送时将自动同步，或切到订单详情页后点此抓取！", Toast.LENGTH_LONG).show();
            }
        }
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
        // 若有近 45 分钟内的活跃外卖进度，在折叠态胶囊安静显示一条小巧外卖跟踪简报
        if (!takeoutTitle.isEmpty() && (System.currentTimeMillis() - takeoutUpdatedMs) < 45 * 60 * 1000L) {
            statusPillView.setVisibility(View.VISIBLE);
            statusTextView.setText(takeoutTitle);
            return;
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

    private void bringMainActivityForSongImport() {
        collapsePanel();
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra(MainActivity.EXTRA_OPEN_SONG_IMPORTER, true);
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
        stopPetRoaming();
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
        stopPetRoaming();
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

    // ========= 鲸鱼娘真实声音歌唱引擎（支持本地导入 MP3/M4A/WAV + 内置甜美真人唱词，彻底告别电子哼调） =========
    private final class WhaleSingerEngine {
        private volatile boolean singing = false;
        private volatile String currentLine = "";
        private MediaPlayer songPlayer = null;
        private final Runnable progressTickRunnable = new Runnable() {
            @Override
            public void run() {
                if (!singing || songPlayer == null) return;
                try {
                    if (songPlayer.isPlaying()) {
                        int pos = songPlayer.getCurrentPosition();
                        int dur = songPlayer.getDuration();
                        String titlePrefix = activeSongTitle.isEmpty() ? "大肥鱼歌唱中" : ("《" + activeSongTitle + "》");
                        if (dur > 0) {
                            currentLine = "🎵 " + titlePrefix + " (" + formatSec(pos / 1000) + "/" + formatSec(dur / 1000) + ")";
                        } else {
                            currentLine = "🎵 " + titlePrefix;
                        }
                        showPetSubtitle(currentLine, 3500);
                    }
                } catch (Exception ignored) {}
                if (singing) {
                    mainHandler.postDelayed(this, 600);
                }
            }
        };
        private String activeSongTitle = "";

        private String formatSec(int sec) {
            int m = Math.max(0, sec) / 60;
            int s = Math.max(0, sec) % 60;
            return String.format(Locale.ROOT, "%02d:%02d", m, s);
        }

        boolean isSinging() {
            return singing;
        }

        String getCurrentLine() {
            return currentLine;
        }

        void startBuiltInVocal(int builtInIdx) {
            stop();
            final int rawResId = (builtInIdx == 0) ? R.raw.feiyu_sing_rice : R.raw.feiyu_sing_bubble;
            activeSongTitle = (builtInIdx == 0)
                    ? "大白米饭之歌 (可点📥导歌导入实际声音)"
                    : "深海冒泡之歌 (可点📥导歌导入实际声音)";
            final String lyricText = (builtInIdx == 0)
                    ? "🎤 《大白米饭之歌》：冒尖一碗大白米饭香喷喷！可点「📥导歌」导入真实歌声音频~"
                    : "🎤 《深海冒泡之歌》：咕噜咕噜深海冒泡啦！可点「📥导歌」导入真实歌声音频~";
            try {
                AssetFileDescriptor afd = getResources().openRawResourceFd(rawResId);
                if (afd == null) return;
                MediaPlayer mp = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                } else {
                    mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
                }
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
                setupAndStartPlayer(mp, lyricText, true);
            } catch (Throwable ignored) {
                stop();
            }
        }

        void startCustomFile(final String title, final String filePath) {
            stop();
            if (filePath == null || !new File(filePath).exists()) {
                startBuiltInVocal(0);
                return;
            }
            activeSongTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "导入歌声";
            try {
                MediaPlayer mp = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                } else {
                    mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
                }
                mp.setDataSource(filePath);
                setupAndStartPlayer(mp, "🎵 大肥鱼正在为你献唱：《" + activeSongTitle + "》~", false);
            } catch (Throwable e) {
                stop();
                Toast.makeText(FloatAgentService.this, "音频格式暂不支持或文件损坏，已切换内置歌声", Toast.LENGTH_SHORT).show();
                startBuiltInVocal(0);
            }
        }

        private void setupAndStartPlayer(MediaPlayer mp, final String initialSub, final boolean isBuiltIn) throws Exception {
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer completedMp) {
                    stop();
                    setPetPoseDrawable(R.drawable.feiyu_happy);
                    showPetSubtitle(isBuiltIn
                            ? "🎵 唱完啦~ 可点面板「📥导歌」导入更多实际歌声！"
                            : "🎵 《" + activeSongTitle + "》唱完收工啦，奖励一碗大白米饭！🍚", 3800);
                    mainHandler.postDelayed(happyResetRunnable, 1800);
                }
            });
            mp.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer mpErr, int what, int extra) {
                    stop();
                    return true;
                }
            });
            mp.prepare();
            mp.setVolume(1.0f, 1.0f);
            songPlayer = mp;
            singing = true;
            currentLine = initialSub;
            showPetSubtitle(initialSub, 4500);
            mp.start();
            mainHandler.removeCallbacks(progressTickRunnable);
            mainHandler.postDelayed(progressTickRunnable, 700);
        }

        void stop() {
            if (singing) {
                lastWhaleAudioStopMs = System.currentTimeMillis();
            }
            singing = false;
            currentLine = "";
            mainHandler.removeCallbacks(progressTickRunnable);
            if (songPlayer != null) {
                try {
                    if (songPlayer.isPlaying()) songPlayer.stop();
                } catch (Exception ignored) {}
                try {
                    songPlayer.release();
                } catch (Exception ignored) {}
                songPlayer = null;
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
