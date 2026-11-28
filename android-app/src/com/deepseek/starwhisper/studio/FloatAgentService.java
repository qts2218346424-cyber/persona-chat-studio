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
import android.graphics.RadialGradient;
import android.graphics.RectF;
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
    private static final String PREF_KEY_PET_PERSONA = "pet_persona_id";
    public static final String PET_FEIYU = "feiyu";
    public static final String PET_NAILONG = "nailong";
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
    private FrameLayout petStageFrame;
    private PetGroundShadowView petGroundShadowView;
    private PetFxOverlayView petFxOverlayView;
    private ImageView petAvatarView;
    private TextView quickMicBadgeView;
    private LinearLayout statusPillView;
    private View statusDotView;
    private TextView statusTextView;
    private TextView pillStopBtn;
    private LinearLayout expandPanel;

    // 跨应用 LIVE 思考与执行气泡 HUD 控件（在手机其他 App 运行时直观展示 AI 思考、动作与上步回执）
    private LinearLayout taskHudWrap;
    private LinearLayout taskHudCard;
    private View taskHudDotView;
    private TextView taskHudStageBadge;
    private TextView taskHudMetaView;
    private TextView taskHudFoldBtn;
    private TextView taskHudStopBtn;
    private LinearLayout taskHudBodyBox;
    private LinearLayout taskHudThoughtBox;
    private TextView taskHudThoughtView;
    private TextView taskHudActionView;
    private TextView taskHudVerdictView;
    private BubblePointerView taskHudTailView;
    private boolean taskHudCompactMode = false;
    private String lastTaskHudThought = "";
    private String lastTaskHudApp = "";
    private String lastTaskHudTool = "";
    private String lastTaskHudAction = "";
    private String lastTaskHudVerdict = "";
    private int lastTaskHudStep = 0;

    // 展开态与折叠态共用提示元素与人设切换引用
    private String petPersonaId = PET_FEIYU;
    private String currentPoseKey = "idle";
    private ImageView headPetIcon;
    private TextView headTitleView;
    private TextView tabPetBtn;
    private LinearLayout petSwitchFeiyuCard;
    private LinearLayout petSwitchNailongCard;
    private TextView personaSwitchPrefBtn;
    private TextView extFeedPillBtn;
    private TextView panelFeedBtn;
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

    // 独立全透明背景桌面漂浮歌词窗、外置互动条与美化版头顶气泡
    private LinearLayout externalPetActionBar;
    private LinearLayout headSpeechBubbleWrap;
    private LinearLayout headSpeechBubbleCard;
    private View headBubbleBadgeDot;
    private TextView headBubbleBadgeView;
    private TextView headSpeechBubbleView;
    private BubblePointerView headBubbleTailView;
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
    private boolean extBarHiddenDuringDrag = false;
    private int headBubbleYOffset = 0;
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
                    petAvatarView.animate()
                            .rotation(0f)
                            .rotationY(0f)
                            .scaleX(1f)
                            .scaleY(1f)
                            .translationY(0f)
                            .translationX(0f)
                            .setDuration(280)
                            .start();
                }
                if (petGroundShadowView != null) {
                    petGroundShadowView.updateShadow(0f, 1f, 0f, 0f);
                }
                setPetPose("idle");
            }
        }
    };

    private void restoreBubbleWindowOffset() {
        if (headBubbleYOffset != 0 && layoutParams != null && windowManager != null && floatRootView != null) {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int petH = (petBubbleContainer != null && petBubbleContainer.getHeight() > 0) ? petBubbleContainer.getHeight() : dp(100);
            int maxY = Math.max(dp(28), dm.heightPixels - petH - dp(24));
            layoutParams.y = Math.max(dp(28), Math.min(layoutParams.y + headBubbleYOffset, maxY));
            savedPillY = layoutParams.y;
            headBubbleYOffset = 0;
            try {
                windowManager.updateViewLayout(floatRootView, layoutParams);
            } catch (Exception ignored) {}
        } else {
            headBubbleYOffset = 0;
        }
    }

    private void dismissHeadBubbleImmediate() {
        mainHandler.removeCallbacks(headBubbleHideRunnable);
        final View targetWrap = headSpeechBubbleWrap != null ? headSpeechBubbleWrap : headSpeechBubbleView;
        if (targetWrap != null) {
            targetWrap.animate().cancel();
            if (targetWrap.getVisibility() == View.VISIBLE) {
                targetWrap.setVisibility(View.GONE);
            }
            targetWrap.setAlpha(1f);
            targetWrap.setTranslationY(0f);
        }
        restoreBubbleWindowOffset();
    }

    private final Runnable headBubbleHideRunnable = new Runnable() {
        @Override
        public void run() {
            final View targetWrap = headSpeechBubbleWrap != null ? headSpeechBubbleWrap : headSpeechBubbleView;
            if (targetWrap != null && targetWrap.getVisibility() == View.VISIBLE) {
                targetWrap.animate().alpha(0f).translationY(dpFloat(4f)).setDuration(220).withEndAction(new Runnable() {
                    @Override
                    public void run() {
                        targetWrap.setVisibility(View.GONE);
                        targetWrap.setAlpha(1f);
                        targetWrap.setTranslationY(0f);
                        restoreBubbleWindowOffset();
                    }
                }).start();
            } else {
                restoreBubbleWindowOffset();
            }
        }
    };

    private final Runnable taskHudAutoHideRunnable = new Runnable() {
        @Override
        public void run() {
            if (taskHudWrap != null && "idle".equals(sCurrentStatus)) {
                taskHudWrap.animate().alpha(0f).translationY(dpFloat(4f)).setDuration(260).withEndAction(new Runnable() {
                    @Override
                    public void run() {
                        if (taskHudWrap != null && "idle".equals(sCurrentStatus)) {
                            taskHudWrap.setVisibility(View.GONE);
                            taskHudWrap.setAlpha(1f);
                            taskHudWrap.setTranslationY(0f);
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
                // 每 25 分钟异步刷一次实时天气，供桌宠吐槽真实温度与阴晴雨雪
                if (System.currentTimeMillis() - lastWeatherFetchMs > 25 * 60 * 1000L) {
                    fetchWeatherSummaryAsync();
                }

                // 1. 自由漫步模式：50% 踩实步态慢散步、28% 原地细腻微动作、22% 搞怪捣蛋自嗨秀
                int dice = petRandom.nextInt(100);
                if (freeRoamEnabled && !qqMusicPlaying && (petRoamAnimator == null || !petRoamAnimator.isRunning()) && dice < 50) {
                    startPetFreeRoamStep();
                } else if (!qqMusicPlaying && dice >= 78) {
                    triggerMischiefAction(false);
                } else {
                    int step = autoLifeStep % 8;
                    String poseKey = "happy";
                    String anim = "look_around";
                    switch (step) {
                        case 0: poseKey = "idle"; anim = "look_around"; break;
                        case 1: poseKey = "eating"; anim = "nibble"; break;
                        case 2: poseKey = "sleepy"; anim = "nap_startle"; break;
                        case 3: poseKey = "focus"; anim = "tiptoe"; break;
                        case 4: poseKey = "happy"; anim = "ear_twitch"; break;
                        case 5: poseKey = "dance"; anim = "dance"; break;
                        case 6: poseKey = "beg"; anim = "bubble_pop"; break;
                        default: poseKey = "derp"; anim = "curious"; break;
                    }
                    setPetPose(poseKey);
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
                    setPetPose("dance");
                } else {
                    setPetPose("idle");
                }
            }
        }
    };

    private final Runnable subtitleResetRunnable = new Runnable() {
        @Override
        public void run() {
            if (subtitleBannerView != null && !isRecordingVoice && (singerEngine == null || !singerEngine.isSinging())) {
                subtitleBannerView.setText(isNailong()
                        ? "🍗 奶龙待命中 · 戳我啃鸡腿 / 摸肚皮 / 跳舞 / 聊天~"
                        : "🍚 大肥鱼待命中 · 戳我喂米饭 / 摸头 / 唱歌 / 点歌~");
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

    public static String getPetPersona(Context ctx) {
        if (sInstance != null) {
            return sInstance.petPersonaId;
        }
        if (ctx != null) {
            try {
                String saved = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_KEY_PET_PERSONA, PET_FEIYU);
                if (PET_NAILONG.equals(saved)) return PET_NAILONG;
            } catch (Exception ignored) {}
        }
        return PET_FEIYU;
    }

    public static boolean setPetPersonaFromBridge(Context ctx, final String personaId) {
        final String targetId = PET_NAILONG.equals(personaId) ? PET_NAILONG : PET_FEIYU;
        if (ctx != null) {
            try {
                ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(PREF_KEY_PET_PERSONA, targetId)
                        .apply();
            } catch (Exception ignored) {}
        }
        final FloatAgentService inst = sInstance;
        if (inst != null) {
            inst.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    inst.switchPetPersona(targetId, true, false);
                }
            });
        }
        return true;
    }

    public static void updateProgress(final String progressJson) {
        final FloatAgentService inst = sInstance;
        if (inst == null) return;
        inst.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                inst.applyStructuredProgressJson(progressJson);
            }
        });
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

    public static void showAskUserPrompt(
            final String title,
            final String thought,
            final String question,
            final String optionsJson
    ) {
        final FloatAgentService instance = sInstance;
        if (instance != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.displayAskUserOverlay(title, thought, question, optionsJson);
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

    public static boolean bringSelfToFrontFromBridge(final Context ctx, final String toastTip) {
        if (ctx == null) return false;
        try {
            final FloatAgentService inst = sInstance;
            if (inst != null) {
                inst.mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        inst.collapsePanel();
                        inst.applyStatusStyle("idle", "等你确认", false);
                        if (toastTip != null && !toastTip.trim().isEmpty()) {
                            Toast.makeText(inst, toastTip.trim(), Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            }
            Intent intent = new Intent(ctx, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            ctx.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
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

    private static final String PREF_KEY_LEARNED_SKILLS = "learned_skills_summary_json";
    private LinearLayout learnedSkillsStrip;

    public static boolean saveLearnedSkillsSummaryFromBridge(Context ctx, String jsonArrayStr) {
        if (ctx == null) return false;
        try {
            String safeJson = (jsonArrayStr == null || jsonArrayStr.trim().isEmpty()) ? "[]" : jsonArrayStr.trim();
            ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY_LEARNED_SKILLS, safeJson)
                    .apply();
            final FloatAgentService inst = sInstance;
            if (inst != null) {
                inst.mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        inst.refreshLearnedSkillsStrip();
                    }
                });
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void refreshLearnedSkillsStrip() {
        if (learnedSkillsStrip == null) return;
        learnedSkillsStrip.removeAllViews();
        try {
            String raw = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_KEY_LEARNED_SKILLS, "[]");
            JSONArray arr = new JSONArray(raw);
            if (arr.length() == 0) {
                TextView emptyTv = new TextView(this);
                emptyTv.setText("暂无已学技能 · 在主界面固化后可在此零 API 一键运行");
                emptyTv.setTextColor(Color.parseColor("#64748B"));
                emptyTv.setTextSize(10.5f);
                emptyTv.setPadding(dp(2), dp(2), dp(2), dp(2));
                learnedSkillsStrip.addView(emptyTv);
                return;
            }
            int maxCount = Math.min(arr.length(), 8);
            for (int i = 0; i < maxCount; i++) {
                final org.json.JSONObject obj = arr.optJSONObject(i);
                if (obj == null) continue;
                final String sid = obj.optString("id", "");
                final String sname = obj.optString("name", "本地技能");
                final int scount = obj.optInt("stepCount", 0);
                if (sid.isEmpty()) continue;

                TextView chip = new TextView(this);
                chip.setText("⚡ " + sname + (scount > 0 ? " · " + scount + "步" : ""));
                chip.setTextColor(Color.parseColor("#6EE7B7"));
                chip.setTextSize(11f);
                chip.setSingleLine(true);
                chip.setPadding(dp(10), dp(5), dp(10), dp(5));
                setViewBg(chip, createRoundRect("#1A10B981", 999, "#4010B981", 1));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.rightMargin = dp(6);
                chip.setLayoutParams(lp);
                chip.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        collapsePanel();
                        executeCommandFromFloating("skill:" + sid, false);
                    }
                });
                learnedSkillsStrip.addView(chip);
            }
        } catch (Exception ignored) {}
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
            String savedPersona = sp.getString(PREF_KEY_PET_PERSONA, PET_FEIYU);
            petPersonaId = PET_NAILONG.equals(savedPersona) ? PET_NAILONG : PET_FEIYU;
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
                    inst.setPetPose("happy");
                    inst.showPetSubtitle("🎵 已暂停" + inst.petDisplayName() + "歌唱~", 2400);
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
                    showHeadBubble(isNailong()
                            ? "🐲 奶龙来啦！大鸡腿准备好没，我会到处溜达陪你控屏哦~"
                            : "🐳 大肥鱼来啦！我会在屏幕上到处溜达，陪你聊天吐槽天气哦~", 4500);
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

    private void setViewBg(View v, GradientDrawable bg) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            v.setBackground(bg);
        } else {
            v.setBackgroundDrawable(bg);
        }
    }

    private boolean isNailong() {
        return PET_NAILONG.equals(petPersonaId);
    }

    private String petDisplayName() {
        return isNailong() ? "奶龙" : "大肥鱼";
    }

    private String petDisplayEmoji() {
        return isNailong() ? "🐲" : "🐳";
    }

    private int resolvePetPoseRes(String poseKey) {
        String key = poseKey != null ? poseKey : "idle";
        if (isNailong()) {
            switch (key) {
                case "walk_right":
                    return R.drawable.nailong_happy;
                case "walk":
                    return R.drawable.nailong_walk;
                case "happy":
                case "eating":
                case "dance":
                case "beg":
                    return R.drawable.nailong_sleepy;
                case "focus":
                case "busy":
                    return R.drawable.nailong_drag;
                case "drag":
                case "derp":
                case "dizzy":
                    return R.drawable.nailong_derp;
                case "idle":
                case "sleepy":
                default:
                    return R.drawable.nailong_idle;
            }
        }
        switch (key) {
            case "happy": return R.drawable.feiyu_happy;
            case "eating": return R.drawable.feiyu_eating;
            case "focus": return R.drawable.feiyu_focus;
            case "busy": return R.drawable.feiyu_busy;
            case "sleepy": return R.drawable.feiyu_sleepy;
            case "walk": return R.drawable.feiyu_walk;
            case "dance": return R.drawable.feiyu_dance;
            case "drag": return R.drawable.feiyu_drag;
            case "derp": return R.drawable.feiyu_derp;
            case "beg": return R.drawable.feiyu_beg;
            case "dizzy": return R.drawable.feiyu_dizzy;
            case "idle":
            default:
                return R.drawable.feiyu_idle;
        }
    }

    private void setPetPose(String poseKey) {
        currentPoseKey = (poseKey != null && !poseKey.isEmpty()) ? poseKey : "idle";
        setPetPoseDrawable(resolvePetPoseRes(currentPoseKey));
    }

    private void setPetPoseDrawable(int resId) {
        if (petAvatarView != null) {
            petAvatarView.setImageResource(resId);
        }
        if (headPetIcon != null) {
            headPetIcon.setImageResource(resId);
        }
    }

    private void switchPetPersona(String nextPersonaId, boolean announce, boolean notifyWeb) {
        String normalized = PET_NAILONG.equals(nextPersonaId) ? PET_NAILONG : PET_FEIYU;
        boolean changed = !normalized.equals(petPersonaId);
        petPersonaId = normalized;
        savePrefBool("pet_persona_saved", true);
        try {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY_PET_PERSONA, petPersonaId)
                    .apply();
        } catch (Exception ignored) {}

        stopWhaleVoicePlayer();
        applyPersonaVisualTheme();
        setPetPose(changed ? "happy" : currentPoseKey);

        if (notifyWeb) {
            MainActivity.dispatchPetPersonaToWebView(petPersonaId);
        }

        if (announce && changed) {
            if (isNailong()) {
                playWhaleVoice(R.raw.nailong_2, "happy", "bounce",
                        "🐲 芜湖~ 奶龙满血归位啦！大烤鸡腿跟高数秘籍全都给你留着哟~ 🍗", true);
            } else {
                playWhaleVoice(R.raw.feiyu_intro, "happy", "bounce",
                        "🐳 本肥鱼终于能动了！嘿嘿，谢谢主人喜欢大肥鱼~ 🍚", true);
            }
        }
    }

    private GradientDrawable createRoundRect(String fillHex, int radiusDp, String strokeHex, float strokeDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(Color.parseColor(fillHex));
        gd.setCornerRadius(dp(radiusDp));
        if (strokeHex != null && strokeDp > 0f) {
            gd.setStroke(Math.max(1, Math.round(dpFloat(strokeDp))), Color.parseColor(strokeHex));
        }
        return gd;
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

        // 1. 折叠态：最上方美化冒泡 / 跨应用 LIVE 思考与执行 HUD 气泡 + 中间 Q 版桌宠/语音尾巴/精简胶囊 + 下方外置互动条
        petBubbleContainer = new LinearLayout(this);
        petBubbleContainer.setOrientation(LinearLayout.VERTICAL);
        petBubbleContainer.setGravity(Gravity.START);

        buildHeadSpeechBubbleWidget();
        buildTaskLiveHudWidget();

        petBubbleContainer.setClipChildren(false);
        petBubbleContainer.setClipToPadding(false);

        LinearLayout petTopRow = new LinearLayout(this);
        petTopRow.setOrientation(LinearLayout.HORIZONTAL);
        petTopRow.setGravity(Gravity.BOTTOM);
        petTopRow.setClipChildren(false);
        petTopRow.setClipToPadding(false);

        // 接地舞台：双层柔和地面接触投影 + 底层微尘星光粒子 + 清晰 Q 版立绘（粒子置于底层防遮脸）
        petStageFrame = new FrameLayout(this);
        petStageFrame.setClipChildren(false);
        petStageFrame.setClipToPadding(false);
        petStageFrame.setLayoutParams(new LinearLayout.LayoutParams(dp(82), dp(76)));

        petGroundShadowView = new PetGroundShadowView(this);
        FrameLayout.LayoutParams shLp = new FrameLayout.LayoutParams(dp(78), dp(18));
        shLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        shLp.bottomMargin = dp(1);
        petGroundShadowView.setLayoutParams(shLp);

        petAvatarView = new ImageView(this);
        petAvatarView.setImageResource(resolvePetPoseRes("idle"));
        petAvatarView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams avatarLp = new FrameLayout.LayoutParams(dp(68), dp(68));
        avatarLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        avatarLp.bottomMargin = dp(4);
        petAvatarView.setLayoutParams(avatarLp);

        petFxOverlayView = new PetFxOverlayView(this);
        petFxOverlayView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        petStageFrame.addView(petGroundShadowView);
        petStageFrame.addView(petFxOverlayView);
        petStageFrame.addView(petAvatarView);

        // 折叠态旁轻量「🎙」直达语音钮（靠腰部齐平，不抢脚底地面阴影视觉）
        quickMicBadgeView = new TextView(this);
        quickMicBadgeView.setText("🎙");
        quickMicBadgeView.setTextSize(12.5f);
        quickMicBadgeView.setGravity(Gravity.CENTER);
        quickMicBadgeView.setPadding(dp(7), dp(5), dp(7), dp(5));
        setViewBg(quickMicBadgeView, createRoundRect("#E60F172A", 14, "#38BDF8", 1));
        LinearLayout.LayoutParams micBadgeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        micBadgeLp.leftMargin = dp(1);
        micBadgeLp.bottomMargin = dp(18);
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
        pillLp.bottomMargin = dp(18);
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
                Toast.makeText(FloatAgentService.this, petDisplayName() + "已停止当前任务", Toast.LENGTH_SHORT).show();
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

        petTopRow.addView(petStageFrame);
        petTopRow.addView(quickMicBadgeView);
        petTopRow.addView(statusPillView);

        // 下排：外置桌宠互动条（直接喂食/摸头/跳舞/唱歌/捣蛋/热梗）
        externalPetActionBar = new LinearLayout(this);
        externalPetActionBar.setOrientation(LinearLayout.HORIZONTAL);
        externalPetActionBar.setGravity(Gravity.CENTER_VERTICAL);
        externalPetActionBar.setPadding(dp(4), dp(3), dp(4), dp(3));
        setViewBg(externalPetActionBar, createRoundRect("#D90F172A", 12, "#38BDF8", 1));
        LinearLayout.LayoutParams extBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        extBarLp.topMargin = dp(3);
        externalPetActionBar.setLayoutParams(extBarLp);

        extFeedPillBtn = createExternalActionPill(isNailong() ? "🍗喂" : "🍚喂", "#3B2506", "#FDE68A", "#F59E0B");
        extFeedPillBtn.setOnClickListener(new View.OnClickListener() {
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
                Toast.makeText(FloatAgentService.this, "已收起外置互动条（点击" + petDisplayName() + "打开面板可重新开启）", Toast.LENGTH_SHORT).show();
            }
        });

        externalPetActionBar.addView(extFeedPillBtn);
        externalPetActionBar.addView(extPat);
        externalPetActionBar.addView(extDance);
        externalPetActionBar.addView(extSing);
        externalPetActionBar.addView(extMischief);
        externalPetActionBar.addView(extMeme);
        externalPetActionBar.addView(extHide);

        petBubbleContainer.addView(taskHudWrap);
        petBubbleContainer.addView(headSpeechBubbleWrap);
        petBubbleContainer.addView(petTopRow);
        petBubbleContainer.addView(externalPetActionBar);

        applyVoiceTailVisibility();
        applyExternalPetBarVisibility();
        applyPersonaVisualTheme();
        applyStatusStyle("idle", "dsh-Go", false);
        startPetBreathAnim();

        // 2. 展开态：双桌宠动作互动 + 形象切换 + QQ音乐歌词 + 语音引导 + dsh-Go 控屏面板
        expandPanel = buildExpandPanel();
        expandPanel.setVisibility(View.GONE);
        applyPersonaVisualTheme();

        floatRootView.addView(petBubbleContainer);
        floatRootView.addView(expandPanel);

        // 拖拽拎起桌宠 + 晕乎彩蛋 + 脚底离地阴影缩淡 + 放下踩实回弹 + 防误触保护
        View.OnTouchListener dragListener = new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private float lastMoveRawX;
            private long touchStartTime = 0;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        wakePetOpacity();
                        stopPetRoaming();
                        if (petActionAnim != null && petActionAnim.isRunning()) {
                            petActionAnim.cancel();
                        }
                        if (petAvatarView != null) {
                            petAvatarView.animate().cancel();
                            petAvatarView.setScaleX(Math.abs(petAvatarView.getScaleX()));
                        }
                        initialX = layoutParams.x;
                        initialY = layoutParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        lastMoveRawX = initialTouchX;
                        touchStartTime = System.currentTimeMillis();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        float vx = Math.max(-24f, Math.min(24f, event.getRawX() - lastMoveRawX));
                        lastMoveRawX = event.getRawX();
                        if (!isDraggingPet && Math.hypot(dx, dy) > dp(6)) {
                            isDraggingPet = true;
                            dragWiggleCount++;
                            if (petActionAnim != null && petActionAnim.isRunning()) {
                                petActionAnim.cancel();
                            }
                            dismissHeadBubbleImmediate();
                            initialY = layoutParams.y;
                            if (externalPetActionBar != null && externalPetActionBar.getVisibility() == View.VISIBLE) {
                                extBarHiddenDuringDrag = true;
                                externalPetActionBar.setVisibility(View.GONE);
                            }
                            setPetPose("drag");
                            long nowMs = System.currentTimeMillis();
                            if (nowMs - lastDragVoiceMs > 9000L) {
                                lastDragVoiceMs = nowMs;
                                if (dragWiggleCount >= 4) {
                                    dragWiggleCount = 0;
                                    triggerDizzyAction();
                                } else if (isNailong()) {
                                    playWhaleVoice(R.raw.nailong_1, "drag", "none",
                                            "🐲 哇啊啊——！飞起来啦！快放俺下来，肚皮要坠地啦~", false);
                                } else {
                                    playWhaleVoice(R.raw.feiyu_drag, "drag", "none",
                                            "🎣 别、别突然从后面叫我，我真的会被你吓到！", false);
                                }
                            }
                        }
                        if (isDraggingPet) {
                            // 拎在半空中时脚底阴影缩淡，关闭 3D rotationY 透视避免边缘发虚锯齿
                            applyPetPhysics(6.5f, 0.98f, 1.03f, -vx * 0.35f, 0f, 0f, 0.22f);
                            int curW = (petBubbleContainer != null && petBubbleContainer.getWidth() > 0)
                                    ? Math.min(petBubbleContainer.getWidth(), dp(120))
                                    : dp(82);
                            int nextX = initialX + (int) dx;
                            int nextY = initialY + (int) dy;
                            int maxY = Math.max(dp(100), dm.heightPixels - dp(80));
                            int clampedX = Math.max(0, Math.min(nextX, dm.widthPixels - curW));
                            int clampedY = Math.max(dp(28), Math.min(nextY, maxY));
                            if (clampedX != layoutParams.x || clampedY != layoutParams.y) {
                                layoutParams.x = clampedX;
                                layoutParams.y = clampedY;
                                try {
                                    windowManager.updateViewLayout(floatRootView, layoutParams);
                                } catch (Exception ignored) {}
                            }
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);
                        boolean wasDragging = isDraggingPet;
                        isDraggingPet = false;
                        if (extBarHiddenDuringDrag) {
                            extBarHiddenDuringDrag = false;
                            applyExternalPetBarVisibility();
                        }
                        if (petAvatarView != null) {
                            petAvatarView.setRotation(0f);
                            petAvatarView.setRotationY(0f);
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
                                    setPetPose("happy");
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
                                setPetPose("beg");
                                playPetBounceAnim("bounce");
                            }
                        } else {
                            int petW = petBubbleContainer.getWidth() > 0 ? petBubbleContainer.getWidth() : dp(76);
                            int petH = petBubbleContainer.getHeight() > 0 ? petBubbleContainer.getHeight() : dp(100);
                            int margin = dp(6);
                            if (freeRoamEnabled) {
                                // 开启全屏自由漫步时，允许停在用户拖放的任意屏幕位置，不再强制吸死左右侧边
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
                            // 放下后“咚”地稳稳落地压实地板并弹一小圈微尘！
                            playPetBounceAnim("land");
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

    private void buildHeadSpeechBubbleWidget() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int maxBubbleWidth = Math.min(dp(248), Math.round(dm.widthPixels * 0.72f));

        headSpeechBubbleWrap = new LinearLayout(this);
        headSpeechBubbleWrap.setOrientation(LinearLayout.VERTICAL);
        headSpeechBubbleWrap.setGravity(Gravity.START);
        LinearLayout.LayoutParams wrapLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wrapLp.bottomMargin = dp(4);
        headSpeechBubbleWrap.setLayoutParams(wrapLp);
        headSpeechBubbleWrap.setVisibility(View.GONE);

        headSpeechBubbleCard = new LinearLayout(this);
        headSpeechBubbleCard.setOrientation(LinearLayout.VERTICAL);
        headSpeechBubbleCard.setPadding(dp(11), dp(8), dp(11), dp(8));
        headSpeechBubbleCard.setMinimumWidth(dp(112));
        setViewBg(headSpeechBubbleCard, createRoundRect("#F20F172A", 15, "#7038BDF8", 1.2f));

        LinearLayout badgeRow = new LinearLayout(this);
        badgeRow.setOrientation(LinearLayout.HORIZONTAL);
        badgeRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        brLp.bottomMargin = dp(3);
        badgeRow.setLayoutParams(brLp);

        headBubbleBadgeDot = new View(this);
        LinearLayout.LayoutParams bdLp = new LinearLayout.LayoutParams(dp(6), dp(6));
        bdLp.rightMargin = dp(5);
        headBubbleBadgeDot.setLayoutParams(bdLp);

        headBubbleBadgeView = new TextView(this);
        headBubbleBadgeView.setText("🐳 大肥鱼");
        headBubbleBadgeView.setTextColor(Color.parseColor("#7DD3FC"));
        headBubbleBadgeView.setTextSize(10f);
        headBubbleBadgeView.setTypeface(null, android.graphics.Typeface.BOLD);
        headBubbleBadgeView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView closeMiniHint = new TextView(this);
        closeMiniHint.setText("×");
        closeMiniHint.setTextColor(Color.parseColor("#94A3B8"));
        closeMiniHint.setTextSize(11f);
        closeMiniHint.setPadding(dp(8), 0, dp(1), 0);

        badgeRow.addView(headBubbleBadgeDot);
        badgeRow.addView(headBubbleBadgeView);
        badgeRow.addView(closeMiniHint);

        headSpeechBubbleView = new TextView(this);
        headSpeechBubbleView.setTextColor(Color.parseColor("#FFFFFF"));
        headSpeechBubbleView.setTextSize(12.5f);
        headSpeechBubbleView.setLineSpacing(dpFloat(2.5f), 1.0f);
        headSpeechBubbleView.setMaxWidth(maxBubbleWidth);
        headSpeechBubbleView.setMaxLines(4);
        headSpeechBubbleView.setEllipsize(TextUtils.TruncateAt.END);

        headSpeechBubbleCard.addView(badgeRow);
        headSpeechBubbleCard.addView(headSpeechBubbleView);

        headBubbleTailView = new BubblePointerView(this);
        LinearLayout.LayoutParams tailLp = new LinearLayout.LayoutParams(dp(14), dp(7));
        tailLp.leftMargin = dp(24);
        tailLp.topMargin = -dp(1);
        headBubbleTailView.setLayoutParams(tailLp);

        headSpeechBubbleWrap.addView(headSpeechBubbleCard);
        headSpeechBubbleWrap.addView(headBubbleTailView);
        headSpeechBubbleWrap.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                mainHandler.removeCallbacks(headBubbleHideRunnable);
                headBubbleHideRunnable.run();
                setPetPose("happy");
                playPetBounceAnim("bounce");
            }
        });
    }

    private void buildTaskLiveHudWidget() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int hudWidth = Math.min(dp(268), Math.round(dm.widthPixels * 0.76f));

        taskHudWrap = new LinearLayout(this);
        taskHudWrap.setOrientation(LinearLayout.VERTICAL);
        taskHudWrap.setGravity(Gravity.START);
        LinearLayout.LayoutParams wrapLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wrapLp.bottomMargin = dp(4);
        taskHudWrap.setLayoutParams(wrapLp);
        taskHudWrap.setVisibility(View.GONE);

        taskHudCard = new LinearLayout(this);
        taskHudCard.setOrientation(LinearLayout.VERTICAL);
        taskHudCard.setLayoutParams(new LinearLayout.LayoutParams(hudWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        taskHudCard.setPadding(dp(11), dp(9), dp(11), dp(9));
        setViewBg(taskHudCard, createRoundRect("#F00C1322", 16, "#706366F1", 1.3f));

        // 1. HUD 驾驶舱顶栏（脉冲指示灯 + 阶段标签 + 步数/App + 折叠/展开 + 急停）
        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);

        taskHudDotView = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(7), dp(7));
        dotLp.rightMargin = dp(5);
        taskHudDotView.setLayoutParams(dotLp);

        taskHudStageBadge = new TextView(this);
        taskHudStageBadge.setText("🧠 深度思考");
        taskHudStageBadge.setTextColor(Color.parseColor("#C7D2FE"));
        taskHudStageBadge.setTextSize(10.5f);
        taskHudStageBadge.setTypeface(null, android.graphics.Typeface.BOLD);
        taskHudStageBadge.setPadding(dp(7), dp(2), dp(7), dp(2));
        setViewBg(taskHudStageBadge, createRoundRect("#2E4D6BFE", 999, "#556366F1", 1));

        taskHudMetaView = new TextView(this);
        taskHudMetaView.setText("dsh-Go");
        taskHudMetaView.setTextColor(Color.parseColor("#94A3B8"));
        taskHudMetaView.setTextSize(10.5f);
        taskHudMetaView.setSingleLine(true);
        taskHudMetaView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams metaLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        metaLp.leftMargin = dp(6);
        metaLp.rightMargin = dp(4);
        taskHudMetaView.setLayoutParams(metaLp);

        taskHudFoldBtn = new TextView(this);
        taskHudFoldBtn.setText("精简");
        taskHudFoldBtn.setTextColor(Color.parseColor("#CBD5E1"));
        taskHudFoldBtn.setTextSize(9.5f);
        taskHudFoldBtn.setPadding(dp(6), dp(2), dp(6), dp(2));
        setViewBg(taskHudFoldBtn, createRoundRect("#18FFFFFF", 8, "#28FFFFFF", 1));
        LinearLayout.LayoutParams foldLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        foldLp.rightMargin = dp(4);
        taskHudFoldBtn.setLayoutParams(foldLp);
        taskHudFoldBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                taskHudCompactMode = !taskHudCompactMode;
                if (taskHudBodyBox != null) {
                    taskHudBodyBox.setVisibility(taskHudCompactMode ? View.GONE : View.VISIBLE);
                }
                taskHudFoldBtn.setText(taskHudCompactMode ? "详情" : "精简");
                renderTaskHudState(sCurrentStatus, lastTaskHudAction);
            }
        });

        taskHudStopBtn = new TextView(this);
        taskHudStopBtn.setText("⏹ 急停");
        taskHudStopBtn.setTextColor(Color.parseColor("#FCA5A5"));
        taskHudStopBtn.setTextSize(9.5f);
        taskHudStopBtn.setTypeface(null, android.graphics.Typeface.BOLD);
        taskHudStopBtn.setPadding(dp(7), dp(2), dp(7), dp(2));
        setViewBg(taskHudStopBtn, createRoundRect("#450A0A", 8, "#EF4444", 1));
        taskHudStopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                Toast.makeText(FloatAgentService.this, petDisplayName() + "已安全停止任务", Toast.LENGTH_SHORT).show();
            }
        });

        topRow.addView(taskHudDotView);
        topRow.addView(taskHudStageBadge);
        topRow.addView(taskHudMetaView);
        topRow.addView(taskHudFoldBtn);
        topRow.addView(taskHudStopBtn);
        taskHudCard.addView(topRow);

        // 2. HUD 展开详情体（思考过程气泡槽 + 执行动作行 + 上步结果回执）
        taskHudBodyBox = new LinearLayout(this);
        taskHudBodyBox.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams bodyLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bodyLp.topMargin = dp(7);
        taskHudBodyBox.setLayoutParams(bodyLp);

        taskHudThoughtBox = new LinearLayout(this);
        taskHudThoughtBox.setOrientation(LinearLayout.VERTICAL);
        taskHudThoughtBox.setPadding(dp(8), dp(6), dp(8), dp(6));
        setViewBg(taskHudThoughtBox, createRoundRect("#14FFFFFF", 10, "#20FFFFFF", 1));
        LinearLayout.LayoutParams tbLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tbLp.bottomMargin = dp(5);
        taskHudThoughtBox.setLayoutParams(tbLp);

        taskHudThoughtView = new TextView(this);
        taskHudThoughtView.setText("💭 正在读取当前界面并分析最佳路径…");
        taskHudThoughtView.setTextColor(Color.parseColor("#E2E8F0"));
        taskHudThoughtView.setTextSize(11f);
        taskHudThoughtView.setLineSpacing(dp(2), 1.0f);
        taskHudThoughtView.setMaxLines(3);
        taskHudThoughtView.setEllipsize(TextUtils.TruncateAt.END);
        taskHudThoughtBox.addView(taskHudThoughtView);

        taskHudActionView = new TextView(this);
        taskHudActionView.setText("⚡ 准备开始执行");
        taskHudActionView.setTextColor(Color.parseColor("#F8FAFC"));
        taskHudActionView.setTextSize(12f);
        taskHudActionView.setTypeface(null, android.graphics.Typeface.BOLD);
        taskHudActionView.setMaxLines(2);
        taskHudActionView.setEllipsize(TextUtils.TruncateAt.END);

        taskHudVerdictView = new TextView(this);
        taskHudVerdictView.setTextColor(Color.parseColor("#6EE7B7"));
        taskHudVerdictView.setTextSize(10f);
        taskHudVerdictView.setSingleLine(true);
        taskHudVerdictView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams vvLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        vvLp.topMargin = dp(3);
        taskHudVerdictView.setLayoutParams(vvLp);
        taskHudVerdictView.setVisibility(View.GONE);

        taskHudBodyBox.addView(taskHudThoughtBox);
        taskHudBodyBox.addView(taskHudActionView);
        taskHudBodyBox.addView(taskHudVerdictView);
        taskHudCard.addView(taskHudBodyBox);

        taskHudTailView = new BubblePointerView(this);
        LinearLayout.LayoutParams hTailLp = new LinearLayout.LayoutParams(dp(14), dp(7));
        hTailLp.leftMargin = dp(24);
        hTailLp.topMargin = -dp(1);
        taskHudTailView.setLayoutParams(hTailLp);

        taskHudWrap.addView(taskHudCard);
        taskHudWrap.addView(taskHudTailView);
        taskHudWrap.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if ("idle".equals(sCurrentStatus) && taskHudWrap != null) {
                    mainHandler.removeCallbacks(taskHudAutoHideRunnable);
                    taskHudAutoHideRunnable.run();
                } else {
                    handleBubbleClick();
                }
            }
        });
    }

    private LinearLayout createPersonaSelectCard(
            int thumbResId,
            String title,
            String sub,
            boolean isFeiyuCard,
            View.OnClickListener onClick
    ) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(8), dp(7), dp(8), dp(7));
        card.setOnClickListener(onClick);

        ImageView icon = new ImageView(this);
        icon.setImageResource(thumbResId);
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams iLp = new LinearLayout.LayoutParams(dp(34), dp(34));
        iLp.rightMargin = dp(7);
        icon.setLayoutParams(iLp);

        LinearLayout textCol = new LinearLayout(this);
        textCol.setOrientation(LinearLayout.VERTICAL);
        textCol.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        TextView tTv = new TextView(this);
        tTv.setText(title);
        tTv.setTextColor(Color.parseColor("#F8FAFC"));
        tTv.setTextSize(12f);
        tTv.setTypeface(null, android.graphics.Typeface.BOLD);

        TextView sTv = new TextView(this);
        sTv.setText(sub);
        sTv.setTextColor(Color.parseColor("#94A3B8"));
        sTv.setTextSize(9.5f);
        sTv.setSingleLine(true);
        sTv.setEllipsize(TextUtils.TruncateAt.END);

        textCol.addView(tTv);
        textCol.addView(sTv);
        card.addView(icon);
        card.addView(textCol);
        return card;
    }

    private void applyPersonaVisualTheme() {
        boolean nl = isNailong();
        String accentHex = nl ? "#FBBF24" : "#38BDF8";
        String bubbleBgHex = nl ? "#F21F170A" : "#F20F172A";
        String bubbleStrokeHex = nl ? "#99FACC15" : "#7038BDF8";
        int dotColor = Color.parseColor(nl ? "#FACC15" : "#38BDF8");

        if (quickMicBadgeView != null && !isRecordingVoice && !isTranscribingVoice) {
            setViewBg(quickMicBadgeView, createRoundRect("#E60F172A", 14, accentHex, 1));
        }
        if (externalPetActionBar != null) {
            setViewBg(externalPetActionBar, createRoundRect(nl ? "#DE1C1508" : "#D90F172A", 12, accentHex, 1));
        }
        if (extFeedPillBtn != null) {
            extFeedPillBtn.setText(nl ? "🍗喂" : "🍚喂");
        }
        if (panelFeedBtn != null) {
            panelFeedBtn.setText(nl ? "🍗 喂鸡腿" : "🍚 喂米饭");
        }
        if (headTitleView != null) {
            headTitleView.setText(petDisplayEmoji() + " " + petDisplayName() + " · 随身控屏");
        }
        if (tabPetBtn != null) {
            tabPetBtn.setText(petDisplayEmoji() + " " + petDisplayName());
        }
        if (personaSwitchPrefBtn != null) {
            personaSwitchPrefBtn.setText(nl ? "🐲 当前: 奶龙 (点此换大肥鱼)" : "🐳 当前: 大肥鱼 (点此换奶龙)");
            setViewBg(personaSwitchPrefBtn, createRoundRect(nl ? "#3B2804" : "#172554", 10, accentHex, 1));
        }
        if (petSwitchFeiyuCard != null) {
            setViewBg(petSwitchFeiyuCard, createRoundRect(
                    !nl ? "#1E3A8A" : "#14FFFFFF",
                    12,
                    !nl ? "#38BDF8" : "#24FFFFFF",
                    !nl ? 1.4f : 1f
            ));
        }
        if (petSwitchNailongCard != null) {
            setViewBg(petSwitchNailongCard, createRoundRect(
                    nl ? "#422006" : "#14FFFFFF",
                    12,
                    nl ? "#FACC15" : "#24FFFFFF",
                    nl ? 1.4f : 1f
            ));
        }
        if (headSpeechBubbleCard != null) {
            setViewBg(headSpeechBubbleCard, createRoundRect(bubbleBgHex, 15, bubbleStrokeHex, 1.2f));
        }
        if (headBubbleBadgeDot != null) {
            GradientDrawable dotD = new GradientDrawable();
            dotD.setShape(GradientDrawable.OVAL);
            dotD.setColor(dotColor);
            setViewBg(headBubbleBadgeDot, dotD);
        }
        if (headBubbleBadgeView != null) {
            headBubbleBadgeView.setTextColor(Color.parseColor(nl ? "#FDE047" : "#7DD3FC"));
        }
        if (headBubbleTailView != null) {
            headBubbleTailView.setColors(Color.parseColor(bubbleBgHex), Color.parseColor(bubbleStrokeHex));
        }
        if (petFxOverlayView != null) {
            petFxOverlayView.setPersonaTheme(nl);
        }
        if (subtitleBannerView != null && !isRecordingVoice && (singerEngine == null || !singerEngine.isSinging())) {
            subtitleBannerView.setText(nl
                    ? "奶龙就绪 · 双击啃鸡腿，或语音说想做的操作"
                    : "大肥鱼就绪 · 双击吃米饭，或语音说想做的操作");
        }
        if (feedbackTextView != null && "idle".equals(sCurrentStatus)) {
            feedbackTextView.setText(nl
                    ? "奶龙待命：双击啃烤鸡腿，长按语音直达~"
                    : "大肥鱼待命：双击吃米饭，长按语音直达~");
        }
    }

    private String mapToolIconLabel(String toolName, String summary) {
        String s = summary != null ? summary.trim() : "";
        if (s.isEmpty()) s = toolName != null ? toolName : "执行动作";
        if (toolName == null) return "⚡ " + s;
        String tl = toolName.toLowerCase(Locale.ROOT);
        if (tl.contains("tap") || tl.contains("click")) return "👆 " + s;
        if (tl.contains("type") || tl.contains("input")) return "⌨️ " + s;
        if (tl.contains("scroll") || tl.contains("swipe")) return "📜 " + s;
        if (tl.contains("open") || tl.contains("launch")) return "🚀 " + s;
        if (tl.contains("key") || tl.contains("back") || tl.contains("home")) return "📱 " + s;
        if (tl.contains("wait")) return "⏳ " + s;
        if (tl.contains("skill")) return "⚡ " + s;
        return "🤖 " + s;
    }

    private void applyStructuredProgressJson(String jsonStr) {
        if (jsonStr == null || jsonStr.trim().isEmpty()) return;
        try {
            JSONObject o = new JSONObject(jsonStr);
            String state = o.optString("state", sCurrentStatus);
            String phase = o.optString("phase", "");
            int step = o.optInt("step", 0);
            String appName = o.optString("appName", "").trim();
            String toolName = o.optString("toolName", "").trim();
            String summary = o.optString("summary", "").trim();
            String thought = o.optString("thought", "").trim();
            String verdictText = o.optString("verdictText", "").trim();

            if (step > 0) lastTaskHudStep = step;
            if (!appName.isEmpty()) lastTaskHudApp = appName;
            if (!toolName.isEmpty()) lastTaskHudTool = toolName;
            if (!thought.isEmpty()) lastTaskHudThought = thought;
            if (!summary.isEmpty()) lastTaskHudAction = mapToolIconLabel(toolName, summary);
            if (o.has("verdictText")) lastTaskHudVerdict = verdictText;

            sCurrentStatus = state;
            if ("done".equals(phase)) {
                sCurrentStatus = "idle";
                applyStatusStyle("idle", summary.isEmpty() ? "任务完成" : summary, true);
                renderTaskHudState("done", !summary.isEmpty() ? ("✅ " + summary) : "✅ 任务已顺利完成");
                return;
            }
            applyStatusStyle(sCurrentStatus, summary.isEmpty() ? "dsh-Go" : summary, false);
        } catch (Exception ignored) {}
    }

    private void renderTaskHudState(String hudState, String headlineAction) {
        if (taskHudWrap == null || taskHudCard == null) return;
        mainHandler.removeCallbacks(taskHudAutoHideRunnable);

        if ("idle".equals(hudState)) {
            taskHudWrap.setVisibility(View.GONE);
            return;
        }

        // 任务 HUD 展现时暂时让路闲聊吐槽气泡，保证上方清爽只有一个高可读面板
        if (headSpeechBubbleWrap != null) {
            mainHandler.removeCallbacks(headBubbleHideRunnable);
            headSpeechBubbleWrap.setVisibility(View.GONE);
        }

        String fillHex = "#F00C1322";
        String strokeHex = "#786366F1";
        String badgeBg = "#2E4D6BFE";
        String badgeStroke = "#556366F1";
        String badgeTxtColor = "#C7D2FE";
        String badgeLabel = "🧠 思考规划";
        int dotColor = Color.parseColor("#818CF8");

        if ("acting".equals(hudState) || "executing".equals(hudState)) {
            strokeHex = "#800EA5E9";
            badgeBg = "#2E0EA5E9";
            badgeStroke = "#6038BDF8";
            badgeTxtColor = "#7DD3FC";
            badgeLabel = "⚡ 正在执行";
            dotColor = Color.parseColor("#38BDF8");
        } else if ("confirming".equals(hudState)) {
            fillHex = "#F2241404";
            strokeHex = "#99F59E0B";
            badgeBg = "#451A03";
            badgeStroke = "#F59E0B";
            badgeTxtColor = "#FDE68A";
            badgeLabel = "⚠️ 等你确认";
            dotColor = Color.parseColor("#F59E0B");
        } else if ("done".equals(hudState)) {
            strokeHex = "#8010B981";
            badgeBg = "#2E10B981";
            badgeStroke = "#6034D399";
            badgeTxtColor = "#6EE7B7";
            badgeLabel = "✅ 已完成";
            dotColor = Color.parseColor("#34D399");
        } else if ("stopped".equals(hudState)) {
            fillHex = "#F01E0B0E";
            strokeHex = "#85EF4444";
            badgeBg = "#450A0A";
            badgeStroke = "#EF4444";
            badgeTxtColor = "#FCA5A5";
            badgeLabel = "⏹ 已停止";
            dotColor = Color.parseColor("#EF4444");
        }

        setViewBg(taskHudCard, createRoundRect(fillHex, 16, strokeHex, 1.3f));
        if (taskHudTailView != null) {
            taskHudTailView.setColors(Color.parseColor(fillHex), Color.parseColor(strokeHex));
        }
        if (taskHudDotView != null) {
            GradientDrawable dd = new GradientDrawable();
            dd.setShape(GradientDrawable.OVAL);
            dd.setColor(dotColor);
            setViewBg(taskHudDotView, dd);
        }
        if (taskHudStageBadge != null) {
            taskHudStageBadge.setText(badgeLabel);
            taskHudStageBadge.setTextColor(Color.parseColor(badgeTxtColor));
            setViewBg(taskHudStageBadge, createRoundRect(badgeBg, 999, badgeStroke, 1));
        }
        if (taskHudMetaView != null) {
            StringBuilder meta = new StringBuilder();
            if (lastTaskHudStep > 0) meta.append("第 ").append(lastTaskHudStep).append(" 步");
            if (!lastTaskHudApp.isEmpty()) {
                if (meta.length() > 0) meta.append(" · ");
                meta.append(lastTaskHudApp);
            }
            if (taskHudCompactMode && headlineAction != null && !headlineAction.isEmpty()) {
                if (meta.length() > 0) meta.append(" · ");
                meta.append(headlineAction);
            }
            taskHudMetaView.setText(meta.length() > 0 ? meta.toString() : "dsh-Go");
        }
        if (taskHudStopBtn != null) {
            taskHudStopBtn.setVisibility(("done".equals(hudState) || "stopped".equals(hudState)) ? View.GONE : View.VISIBLE);
        }
        if (taskHudBodyBox != null) {
            taskHudBodyBox.setVisibility(taskHudCompactMode ? View.GONE : View.VISIBLE);
        }
        if (taskHudThoughtView != null) {
            String tShow = !lastTaskHudThought.isEmpty()
                    ? ("💭 " + lastTaskHudThought)
                    : ("💭 正在识别" + (lastTaskHudApp.isEmpty() ? "当前屏幕" : ("「" + lastTaskHudApp + "」")) + "，推演下一步精确操作…");
            taskHudThoughtView.setText(tShow);
        }
        if (taskHudActionView != null) {
            String actShow = (headlineAction != null && !headlineAction.trim().isEmpty())
                    ? headlineAction.trim()
                    : (!lastTaskHudAction.isEmpty() ? lastTaskHudAction : "⚡ 准备执行下一步");
            taskHudActionView.setText(actShow);
        }
        if (taskHudVerdictView != null) {
            if (!lastTaskHudVerdict.isEmpty()) {
                taskHudVerdictView.setText(lastTaskHudVerdict);
                boolean isErrV = lastTaskHudVerdict.contains("失败") || lastTaskHudVerdict.contains("未变");
                taskHudVerdictView.setTextColor(Color.parseColor(isErrV ? "#FCD34D" : "#6EE7B7"));
                taskHudVerdictView.setVisibility(View.VISIBLE);
            } else {
                taskHudVerdictView.setVisibility(View.GONE);
            }
        }

        boolean wasHidden = (taskHudWrap.getVisibility() != View.VISIBLE);
        taskHudWrap.setVisibility(View.VISIBLE);
        if (wasHidden) {
            taskHudWrap.animate().cancel();
            taskHudWrap.setAlpha(0f);
            taskHudWrap.setTranslationY(dpFloat(6f));
            taskHudWrap.animate().alpha(1f).translationY(0f).setDuration(200).start();
        }
        if ("done".equals(hudState) || "stopped".equals(hudState)) {
            mainHandler.postDelayed(taskHudAutoHideRunnable, 3200);
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
        btn.setTextSize(10f);
        btn.setTextColor(Color.parseColor(textHex));
        btn.setGravity(Gravity.CENTER);
        btn.setSingleLine(true);
        btn.setPadding(dp(5), dp(3), dp(5), dp(3));
        setViewBg(btn, createRoundRect(fillHex, 9, strokeHex, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(3);
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
            floatingLyricSubText.setText("🎤 " + petDisplayName() + "正在清唱");
            floatingLyricMainText.setText(!TextUtils.isEmpty(line) ? line : "🎵 冒尖一碗大白米饭~");
            floatingLyricRootView.setVisibility(View.VISIBLE);
            return;
        }
        if (qqMusicPlaying && !qqMusicTitle.isEmpty()) {
            boolean isFallbackText = qqMusicCurrentLyric.isEmpty()
                    || qqMusicCurrentLyric.startsWith("♪ 正在匹配")
                    || qqMusicCurrentLyric.startsWith("♪ 暂无时间轴")
                    || qqMusicCurrentLyric.startsWith("🎵 ") && qqMusicCurrentLyric.contains("纯音乐或暂无时间轴歌词");
            if (isFallbackText) {
                floatingLyricRootView.setVisibility(View.GONE);
                return;
            }
            String artistPart = qqMusicArtist.isEmpty() ? "" : (" - " + qqMusicArtist);
            floatingLyricSubText.setText("🎵 " + qqMusicTitle + artistPart);
            floatingLyricMainText.setText(qqMusicCurrentLyric);
            floatingLyricRootView.setVisibility(View.VISIBLE);
            return;
        }
        floatingLyricRootView.setVisibility(View.GONE);
    }

    private float dpFloat(float dpVal) {
        return dpVal * getResources().getDisplayMetrics().density;
    }

    private void applyPetBottomPivot(View target, float yRatio) {
        if (target == null) return;
        float w = target.getWidth() > 0 ? target.getWidth() : dp(64);
        float h = target.getHeight() > 0 ? target.getHeight() : dp(64);
        target.setPivotX(w * 0.5f);
        target.setPivotY(h * yRatio);
    }

    /**
     * 统一同步肥鱼立绘几何变换、精准鞋底接地锚点（y=0.971）与双层地面接触阴影
     */
    private void applyPetPhysics(float liftDp, float scaleX, float scaleY, float tiltDeg, float yawDeg, float shiftXdp, float pivotYRatio) {
        if (petAvatarView == null) return;
        applyPetBottomPivot(petAvatarView, pivotYRatio);
        petAvatarView.setTranslationY(-dpFloat(liftDp));
        petAvatarView.setTranslationX(dpFloat(shiftXdp));
        petAvatarView.setScaleX(scaleX);
        petAvatarView.setScaleY(scaleY);
        petAvatarView.setRotation(tiltDeg);
        petAvatarView.setRotationY(yawDeg);
        if (petGroundShadowView != null) {
            petGroundShadowView.updateShadow(liftDp, Math.abs(scaleX), tiltDeg, shiftXdp);
        }
    }

    private void emitPetFx(int fxType, int count) {
        if (!isExpanded && petFxOverlayView != null) {
            petFxOverlayView.emit(fxType, count);
        }
    }

    private void startPetBreathAnim() {
        if (petBreathAnim != null) {
            petBreathAnim.cancel();
        }
        // 非对称生息韵律 + 重心换脚微晃：鞋底始终死死钉在地面接触阴影上，零浮空感
        petBreathAnim = ValueAnimator.ofFloat(0f, 1f);
        petBreathAnim.setDuration(5200);
        petBreathAnim.setRepeatMode(ValueAnimator.RESTART);
        petBreathAnim.setRepeatCount(ValueAnimator.INFINITE);
        petBreathAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                if (petAvatarView != null && !isDraggingPet && !isExpanded
                        && (petActionAnim == null || !petActionAnim.isRunning())
                        && (petRoamAnimator == null || !petRoamAnimator.isRunning())) {
                    float f = (float) animation.getAnimatedValue();
                    // 一个 5.2s 完整周期含两次自然不等长呼吸 + 轻微重心左右切换偷瞄
                    float breathPhase = (f * 2.0f) % 1.0f;
                    float asymBreath;
                    if (breathPhase < 0.42f) {
                        float u = breathPhase / 0.42f;
                        asymBreath = (float) Math.sin(u * Math.PI * 0.5);
                    } else {
                        float u = (breathPhase - 0.42f) / 0.58f;
                        asymBreath = (float) Math.cos(u * Math.PI * 0.5);
                    }
                    // 体积守恒：吸气略挺拔、呼气微微沉肩踩实地面（liftDp 在 0 到 -0.6dp 压实地面）
                    float scaleY = 0.986f + 0.044f * asymBreath;
                    float scaleX = 1.0f / scaleY;
                    float liftDp = -0.6f * (1.0f - asymBreath);
                    // 柔和重心换脚微倾，去掉 3D rotationY 避免透明浮窗边缘锯齿发虚
                    float shiftWave = (float) Math.sin(f * Math.PI * 2.0);
                    float tiltDeg = 1.4f * shiftWave;
                    float shiftXdp = 0.7f * shiftWave;
                    applyPetPhysics(liftDp, scaleX, scaleY, tiltDeg, 0f, shiftXdp, 0.971f);
                }
            }
        });
        petBreathAnim.start();
    }

    private void playPetBounceAnim(final String animType) {
        if (petActionAnim != null) {
            petActionAnim.cancel();
        }
        if (animType == null || animType.isEmpty() || "none".equals(animType)) {
            return;
        }
        final ImageView target = isExpanded ? headPetIcon : petAvatarView;
        if (target == null) return;
        final boolean onStage = (!isExpanded && target == petAvatarView);
        final float groundPivot = 0.971f;

        target.setRotation(0f);
        target.setRotationY(0f);
        target.setScaleX(1f);
        target.setScaleY(1f);
        target.setTranslationX(0f);
        target.setTranslationY(0f);
        boolean centerPivot = "slip".equals(animType) || "upside_down".equals(animType);
        applyPetBottomPivot(target, centerPivot ? 0.5f : groundPivot);

        if ("land".equals(animType)) {
            // 拖拽放开落地：重力压缩砸实地板 + 阴影骤扩 + 脚底两侧喷微小尘土 + 回弹安定
            emitPetFx(PetFxOverlayView.FX_DUST, 3);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(480);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float sy;
                    float lift;
                    if (f < 0.30f) {
                        float p = f / 0.30f;
                        float s = (float) Math.sin(p * Math.PI * 0.5);
                        sy = 1.0f - 0.11f * s;
                        lift = -1.6f * s;
                    } else if (f < 0.68f) {
                        float p = (f - 0.30f) / 0.38f;
                        float s = (float) Math.sin(p * Math.PI);
                        sy = 0.89f + 0.15f * p + 0.02f * s;
                        lift = -1.6f * (1f - p) + 0.8f * s;
                    } else {
                        float p = (f - 0.68f) / 0.32f;
                        sy = 1.04f - 0.04f * p;
                        lift = 0f;
                    }
                    float sx = 1.0f / Math.max(0.82f, sy);
                    if (onStage) applyPetPhysics(lift, sx, sy, 0f, 0f, 0f, groundPivot);
                    else {
                        target.setScaleX(sx);
                        target.setScaleY(sy);
                    }
                }
            });
        } else if ("look_around".equals(animType)) {
            // 站在原地 3D 左右张望看主人：脚底牢牢吸地，头身转角 + 微俯身细节
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2800);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float yaw = 0f;
                    float tilt = 0f;
                    float sy = 1f;
                    if (f < 0.35f) {
                        float p = (float) Math.sin((f / 0.35f) * Math.PI);
                        yaw = -18f * p;
                        tilt = -3.2f * p;
                        sy = 1f - 0.025f * p;
                    } else if (f < 0.72f) {
                        float p = (float) Math.sin(((f - 0.35f) / 0.37f) * Math.PI);
                        yaw = 18f * p;
                        tilt = 3.2f * p;
                        sy = 1f - 0.025f * p;
                    } else {
                        float p = (f - 0.72f) / 0.28f;
                        float nod = (float) Math.sin(p * Math.PI * 2.0);
                        sy = 1f - 0.03f * Math.max(0f, nod);
                    }
                    float sx = 1.0f / sy;
                    if (onStage) applyPetPhysics(-0.4f, sx, sy, tilt, yaw, 0f, groundPivot);
                    else {
                        target.setRotationY(yaw);
                        target.setRotation(tilt);
                    }
                }
            });
        } else if ("tiptoe".equals(animType)) {
            // 踮起小皮鞋偷看然后“咚”稳稳踩实地板
            final boolean[] dustFired = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2200);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float lift;
                    float sy;
                    if (f < 0.16f) {
                        // 预备下蹲蓄力
                        float p = (float) Math.sin((f / 0.16f) * Math.PI * 0.5);
                        lift = -1.2f * p;
                        sy = 1f - 0.06f * p;
                    } else if (f < 0.72f) {
                        // 踮脚拉长偷看并微微左右晃头
                        float p = (f - 0.16f) / 0.56f;
                        float sustain = (float) Math.sin(Math.min(1f, p * 1.4f) * Math.PI * 0.5);
                        lift = 4.6f * sustain;
                        sy = 1f + 0.065f * sustain;
                    } else {
                        float p = (f - 0.72f) / 0.28f;
                        if (!dustFired[0] && p > 0.3f) {
                            dustFired[0] = true;
                            emitPetFx(PetFxOverlayView.FX_DUST, 2);
                        }
                        if (p < 0.5f) {
                            float q = p / 0.5f;
                            lift = 4.6f * (1f - q) - 1.3f * q;
                            sy = 1.06f * (1f - q) + 0.93f * q;
                        } else {
                            float q = (p - 0.5f) / 0.5f;
                            lift = -1.3f * (1f - q);
                            sy = 0.93f + 0.07f * q;
                        }
                    }
                    float sx = 1.0f / sy;
                    float yaw = (f > 0.2f && f < 0.7f) ? 8f * (float) Math.sin((f - 0.2f) * Math.PI * 4.0) : 0f;
                    if (onStage) applyPetPhysics(lift, sx, sy, 0f, yaw, 0f, groundPivot);
                    else {
                        target.setTranslationY(-dpFloat(lift));
                        target.setScaleX(sx);
                        target.setScaleY(sy);
                    }
                }
            });
        } else if ("ear_twitch".equals(animType)) {
            // 机灵甩头抖呆毛 & 开心冒星光
            emitPetFx(PetFxOverlayView.FX_SPARKLE, 3);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(1500);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float decay = (float) Math.exp(-3.2 * f);
                    float twitch = (float) Math.sin(f * Math.PI * 8.0) * decay;
                    float sy = 1f - 0.03f * Math.abs(twitch);
                    float sx = 1f / sy;
                    if (onStage) applyPetPhysics(-0.4f, sx, sy, 9f * twitch, 10f * twitch, 0f, groundPivot);
                    else target.setRotation(9f * twitch);
                }
            });
        } else if ("eat".equals(animType) || "nibble".equals(animType)) {
            final boolean isSneaky = "nibble".equals(animType);
            emitPetFx(PetFxOverlayView.FX_SPARKLE, isSneaky ? 1 : 3);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(isSneaky ? 2200 : 1850);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float chew = (float) Math.sin(f * Math.PI * 10.0);
                    float peek = isSneaky ? (float) Math.sin(f * Math.PI * 3.0) : 0f;
                    float sy = 1f - 0.065f * chew;
                    float sx = 1f / sy;
                    float lift = -0.8f * Math.max(0f, chew);
                    float tilt = isSneaky ? 6.5f * peek : 2.5f * chew;
                    float yaw = isSneaky ? 11f * peek : 4f * chew;
                    if (onStage) applyPetPhysics(lift, sx, sy, tilt, yaw, 0f, groundPivot);
                    else {
                        target.setScaleX(sx);
                        target.setScaleY(sy);
                        target.setRotation(tilt);
                    }
                }
            });
        } else if ("walk".equals(animType)) {
            emitPetFx(PetFxOverlayView.FX_DUST, 2);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2400);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float step = (float) Math.sin(f * Math.PI * 6.0);
                    float lift = (step >= 0f) ? 2.6f * step : 1.1f * step;
                    float sy = 1f + (step >= 0f ? 0.035f * step : 0.045f * step);
                    float sx = 1f / sy;
                    float shiftX = 4.5f * (float) Math.sin(f * Math.PI * 2.0);
                    if (onStage) applyPetPhysics(lift, sx, sy, 5f * step, 8f * (float) Math.cos(f * Math.PI * 2.0), shiftX, groundPivot);
                    else {
                        target.setTranslationX(dpFloat(shiftX));
                        target.setTranslationY(-dpFloat(lift));
                        target.setRotation(5f * step);
                    }
                }
            });
        } else if ("dance".equals(animType)) {
            emitPetFx(PetFxOverlayView.FX_SPARKLE, 4);
            final int[] lastBeatIndex = new int[]{-1};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2800);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float sway = (float) Math.sin(f * Math.PI * 6.0);
                    float beatRaw = (float) Math.cos(f * Math.PI * 12.0);
                    // 正瓣轻踏抬脚，负瓣重踩压实地面喷微尘！
                    float lift = (beatRaw >= 0f) ? 4.2f * beatRaw : 1.3f * beatRaw;
                    float sy = 1f + (beatRaw >= 0f ? 0.045f * beatRaw : 0.055f * beatRaw);
                    float sx = 1f / sy;
                    int beatIdx = (int) (f * 6.0f);
                    if (beatIdx != lastBeatIndex[0] && beatRaw < -0.7f) {
                        lastBeatIndex[0] = beatIdx;
                        emitPetFx(PetFxOverlayView.FX_DUST, 1);
                    }
                    float yaw = 14f * sway;
                    float shiftX = 4.5f * sway;
                    if (onStage) applyPetPhysics(lift, sx, sy, 9.5f * sway, yaw, shiftX, groundPivot);
                    else {
                        target.setRotation(9.5f * sway);
                        target.setTranslationY(-dpFloat(Math.max(0f, lift)));
                    }
                }
            });
        } else if ("slip".equals(animType)) {
            // 搞怪打滑：原地急刹翻跟头 360° 后砸地压扁回弹微尘
            emitPetFx(PetFxOverlayView.FX_DUST, 3);
            final boolean[] landSpark = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2400);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.62f) {
                        float p = f / 0.62f;
                        float eased = (float) (1.0 - Math.pow(1.0 - p, 2));
                        float lift = 11f * (float) Math.sin(p * Math.PI);
                        float sy = 1f - 0.06f * (float) Math.sin(p * Math.PI);
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(lift, sx, sy, 360f * eased, 0f, 0f, 0.5f);
                        else {
                            target.setRotation(360f * eased);
                            target.setTranslationY(-dpFloat(lift));
                        }
                    } else {
                        if (!landSpark[0]) {
                            landSpark[0] = true;
                            emitPetFx(PetFxOverlayView.FX_DUST, 3);
                        }
                        float wobble = (f - 0.62f) / 0.38f;
                        float decay = 1f - wobble;
                        float sy = 1f - 0.08f * decay * (float) Math.cos(wobble * Math.PI * 3.0);
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(-1.0f * decay, sx, sy, 13f * (float) Math.sin(wobble * Math.PI * 4.0) * decay, 0f, 0f, groundPivot);
                        else target.setRotation(13f * (float) Math.sin(wobble * Math.PI * 4.0) * decay);
                    }
                }
            });
        } else if ("upside_down".equals(animType)) {
            emitPetFx(PetFxOverlayView.FX_SPARKLE, 3);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2800);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float rot;
                    float sc;
                    float lift;
                    if (f < 0.22f) {
                        float p = f / 0.22f;
                        rot = 180f * p;
                        sc = 1f + 0.12f * p;
                        lift = 6f * p;
                    } else if (f < 0.78f) {
                        float p = (f - 0.22f) / 0.56f;
                        rot = 180f + 12f * (float) Math.sin(p * Math.PI * 4.0);
                        sc = 1.12f;
                        lift = 6f + 3f * (float) Math.sin(p * Math.PI * 2.0);
                    } else {
                        float p = (f - 0.78f) / 0.22f;
                        rot = 180f * (1f - p);
                        sc = 1.12f - 0.12f * p;
                        lift = 6f * (1f - p);
                    }
                    if (onStage) applyPetPhysics(lift, sc, sc, rot, 0f, 0f, 0.5f);
                    else {
                        target.setRotation(rot);
                        target.setScaleX(sc);
                        target.setScaleY(sc);
                    }
                }
            });
        } else if ("bubble_pop".equals(animType)) {
            final boolean[] popFired = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2400);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.66f) {
                        float p = f / 0.66f;
                        float s = 1f + 0.22f * p;
                        if (onStage) applyPetPhysics(-0.5f * p, s, s, 3f * (float) Math.sin(p * Math.PI * 6.0), 0f, 0f, groundPivot);
                        else {
                            target.setScaleX(s);
                            target.setScaleY(s);
                        }
                    } else {
                        if (!popFired[0]) {
                            popFired[0] = true;
                            emitPetFx(PetFxOverlayView.FX_BUBBLE, 5);
                        }
                        float p = (f - 0.66f) / 0.34f;
                        float jump = (float) Math.sin(p * Math.PI);
                        float sy = 1f + 0.11f * jump - 0.08f * (1f - jump);
                        float sx = 1f / sy;
                        float lift = 8.5f * jump - 1.2f * (1f - jump);
                        if (onStage) applyPetPhysics(lift, sx, sy, -11f * (float) Math.sin(p * Math.PI * 3.0), 0f, 0f, groundPivot);
                        else target.setTranslationY(-dpFloat(Math.max(0f, lift)));
                    }
                }
            });
        } else if ("bonk".equals(animType)) {
            final boolean[] bonkFired = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2100);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.32f) {
                        float p = f / 0.32f;
                        float sy = 1f - 0.08f * p;
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(-1.0f * p, sx, sy, -12f * p, -10f * p, -7f * p, groundPivot);
                        else {
                            target.setTranslationX(-dpFloat(7f * p));
                            target.setRotation(-12f * p);
                        }
                    } else if (f < 0.50f) {
                        float p = (f - 0.32f) / 0.18f;
                        if (!bonkFired[0] && p > 0.7f) {
                            bonkFired[0] = true;
                            emitPetFx(PetFxOverlayView.FX_DUST, 3);
                        }
                        float sy = 0.92f + 0.16f * p;
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(1.5f * (float) Math.sin(p * Math.PI), sx, sy, -12f + 25f * p, 14f * p, -7f + 17f * p, groundPivot);
                        else target.setTranslationX(dpFloat(-7f + 17f * p));
                    } else {
                        float p = (f - 0.50f) / 0.50f;
                        float damp = 1f - p;
                        float sx = 1f + 0.05f * damp;
                        float sy = 1f / sx;
                        if (onStage) applyPetPhysics(-0.8f * damp, sx, sy, 11f * damp * (float) Math.sin(p * Math.PI * 5.0), 0f, 10f * damp * (float) Math.cos(p * Math.PI * 3.0), groundPivot);
                        else target.setTranslationX(dpFloat(10f * damp * (float) Math.cos(p * Math.PI * 3.0)));
                    }
                }
            });
        } else if ("nap_startle".equals(animType)) {
            final boolean[] wakeDust = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2600);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    if (f < 0.72f) {
                        float p = f / 0.72f;
                        float sy = 1f - 0.085f * p;
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(-1.1f * p, sx, sy, 14f * p, 6f * p, 0f, groundPivot);
                        else target.setRotation(14f * p);
                    } else {
                        float p = (f - 0.72f) / 0.28f;
                        if (!wakeDust[0] && p > 0.75f) {
                            wakeDust[0] = true;
                            emitPetFx(PetFxOverlayView.FX_DUST, 2);
                        }
                        float jolt = (float) Math.sin(p * Math.PI);
                        float sy = 1f + 0.08f * jolt;
                        float sx = 1f / sy;
                        if (onStage) applyPetPhysics(6.5f * jolt - 1.0f * (1f - jolt), sx, sy, -7f * jolt, 0f, 0f, groundPivot);
                        else target.setTranslationY(-dpFloat(6.5f * jolt));
                    }
                }
            });
        } else if ("curious".equals(animType)) {
            emitPetFx(PetFxOverlayView.FX_SPARKLE, 2);
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(2200);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float tilt = (float) Math.sin(f * Math.PI * 2.0);
                    float sy = 1f - 0.03f * Math.abs(tilt);
                    float sx = 1f / sy;
                    if (onStage) applyPetPhysics(-0.4f, sx, sy, 13f * tilt, 14f * tilt, 1.5f * tilt, groundPivot);
                    else target.setRotation(13f * tilt);
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
                    float sy = 1f - 0.04f * Math.abs(f);
                    float sx = 1f / sy;
                    if (onStage) applyPetPhysics(0f, sx, sy, 10f * f, 8f * f, 0f, groundPivot);
                    else target.setRotation(10f * f);
                }
            });
        } else {
            // 默认 Q 弹：微蹲蓄力 -> 跃起伸展 -> 重力踩实回弹 + 微尘 + 爱意星光
            emitPetFx(PetFxOverlayView.FX_SPARKLE, 3);
            final boolean[] bounceLanded = new boolean[]{false};
            petActionAnim = ValueAnimator.ofFloat(0f, 1f);
            petActionAnim.setDuration(1350);
            petActionAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    float lift;
                    float sy;
                    if (f < 0.14f) {
                        float p = f / 0.14f;
                        lift = -1.3f * p;
                        sy = 1f - 0.09f * p;
                    } else if (f < 0.62f) {
                        float p = (f - 0.14f) / 0.48f;
                        float arc = (float) Math.sin(p * Math.PI);
                        lift = 7.5f * arc - 0.6f * (1f - arc);
                        sy = 1f + 0.09f * arc - 0.04f * (1f - arc);
                    } else {
                        if (!bounceLanded[0]) {
                            bounceLanded[0] = true;
                            emitPetFx(PetFxOverlayView.FX_DUST, 2);
                        }
                        float p = (f - 0.62f) / 0.38f;
                        float damp = 1f - p;
                        float wave = (float) Math.sin(p * Math.PI * 2.0);
                        lift = -1.4f * Math.max(0f, (float) Math.sin(p * Math.PI)) * damp;
                        sy = 1f - 0.08f * Math.abs(wave) * damp;
                    }
                    float sx = 1f / sy;
                    if (onStage) applyPetPhysics(lift, sx, sy, 4f * (float) Math.sin(f * Math.PI * 2.0), 0f, 0f, groundPivot);
                    else {
                        target.setTranslationY(-dpFloat(Math.max(0f, lift)));
                        target.setScaleX(sx);
                        target.setScaleY(sy);
                    }
                }
            });
        }
        petActionAnim.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                target.setRotation(0f);
                target.setRotationY(0f);
                target.setScaleX(1f);
                target.setScaleY(1f);
                target.setTranslationX(0f);
                target.setTranslationY(0f);
                applyPetBottomPivot(target, groundPivot);
                if (onStage && petGroundShadowView != null) {
                    petGroundShadowView.updateShadow(0f, 1f, 0f, 0f);
                }
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
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(352));
        int maxPanelHeight = (int) (dm.heightPixels * 0.78f);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setLayoutParams(new ViewGroup.LayoutParams(panelWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.setPadding(dp(14), dp(12), dp(14), dp(12));
        setViewBg(panel, createRoundRect("#F2111622", 22, "#26FFFFFF", 1));

        // 1. 极简顶栏：头像 + 标题 + 无障碍状态微标 + 主界面 + 圆形收起
        LinearLayout headRow = new LinearLayout(this);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        headPetIcon = new ImageView(this);
        headPetIcon.setImageResource(resolvePetPoseRes("idle"));
        headPetIcon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams hIconLp = new LinearLayout.LayoutParams(dp(28), dp(28));
        hIconLp.rightMargin = dp(8);
        headPetIcon.setLayoutParams(hIconLp);
        headPetIcon.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });

        headTitleView = new TextView(this);
        headTitleView.setText(petDisplayEmoji() + " " + petDisplayName() + " · 随身控屏");
        headTitleView.setTextColor(Color.parseColor("#F8FAFC"));
        headTitleView.setTextSize(14f);
        headTitleView.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        headTitleView.setLayoutParams(titleLp);

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
        homeAppTv.setTextSize(11f);
        homeAppTv.setPadding(dp(8), dp(4), dp(8), dp(4));
        setViewBg(homeAppTv, createRoundRect("#1A3B82F6", 999, "#333B82F6", 1));
        LinearLayout.LayoutParams homeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        homeLp.leftMargin = dp(6);
        homeLp.rightMargin = dp(5);
        homeAppTv.setLayoutParams(homeLp);
        homeAppTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityToFront(null, false);
            }
        });

        TextView closeTv = new TextView(this);
        closeTv.setText("✕");
        closeTv.setTextColor(Color.parseColor("#94A3B8"));
        closeTv.setTextSize(12f);
        closeTv.setGravity(Gravity.CENTER);
        closeTv.setPadding(dp(8), dp(3), dp(8), dp(3));
        setViewBg(closeTv, createRoundRect("#14FFFFFF", 999, "#1FFFFFFF", 1));
        closeTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
            }
        });

        headRow.addView(headPetIcon);
        headRow.addView(headTitleView);
        headRow.addView(a11yBadgeView);
        headRow.addView(homeAppTv);
        headRow.addView(closeTv);
        panel.addView(headRow);

        // 2. 轻透状态字幕条 + 圆润输入舱
        subtitleBannerView = new TextView(this);
        subtitleBannerView.setText(isNailong()
                ? "奶龙就绪 · 双击啃鸡腿，或语音说想做的操作"
                : "大肥鱼就绪 · 双击吃米饭，或语音说想做的操作");
        subtitleBannerView.setTextColor(Color.parseColor("#CBD5E1"));
        subtitleBannerView.setTextSize(11.5f);
        subtitleBannerView.setPadding(dp(10), dp(6), dp(10), dp(6));
        subtitleBannerView.setMaxLines(2);
        subtitleBannerView.setEllipsize(TextUtils.TruncateAt.END);
        setViewBg(subtitleBannerView, createRoundRect("#12FFFFFF", 12, "#1FFFFFFF", 1));
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(9);
        subtitleBannerView.setLayoutParams(subLp);
        subtitleBannerView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerHeadPatAction();
            }
        });
        panel.addView(subtitleBannerView);

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(8), 0, dp(6));

        cmdEditText = new EditText(this);
        cmdEditText.setHint("说「打开微信 / 放晴天 / 换奶龙」");
        cmdEditText.setHintTextColor(Color.parseColor("#64748B"));
        cmdEditText.setTextColor(Color.WHITE);
        cmdEditText.setTextSize(12.5f);
        cmdEditText.setSingleLine(true);
        cmdEditText.setImeOptions(EditorInfo.IME_ACTION_SEND);
        cmdEditText.setPadding(dp(12), dp(8), dp(12), dp(8));
        setViewBg(cmdEditText, createRoundRect("#161C2C", 12, "#293548", 1));
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
        editLp.rightMargin = dp(6);
        cmdEditText.setLayoutParams(editLp);

        final TextView voiceBtn = createActionBtn("🎙", "#0EA5E9", "#FFFFFF");
        voiceBtn.setPadding(dp(10), dp(7), dp(10), dp(7));
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
        sendBtn.setPadding(dp(12), dp(7), dp(12), dp(7));
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

        voiceGuideBanner = buildVoiceGuideBanner();
        voiceGuideBanner.setVisibility(View.GONE);
        panel.addView(voiceGuideBanner);

        // 3. 三枚现代分段胶囊 Tab（控屏 | 桌宠 | 设置）
        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setPadding(dp(3), dp(3), dp(3), dp(3));
        setViewBg(tabBar, createRoundRect("#14FFFFFF", 12, "#1FFFFFFF", 1));
        LinearLayout.LayoutParams tabBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tabBarLp.bottomMargin = dp(8);
        tabBar.setLayoutParams(tabBarLp);

        final TextView tabCtrlBtn = createGridBtn("⚡ 控屏");
        tabPetBtn = createGridBtn(petDisplayEmoji() + " " + petDisplayName());
        final TextView tabPrefBtn = createGridBtn("⚙ 设置");
        LinearLayout.LayoutParams tpLp = (LinearLayout.LayoutParams) tabPrefBtn.getLayoutParams();
        tpLp.rightMargin = 0;
        tabPrefBtn.setLayoutParams(tpLp);
        tabBar.addView(tabCtrlBtn);
        tabBar.addView(tabPetBtn);
        tabBar.addView(tabPrefBtn);
        panel.addView(tabBar);

        // 内容滚动容器（防小屏截断）
        ScrollView bodyScroll = new ScrollView(this);
        bodyScroll.setVerticalScrollBarEnabled(false);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bodyScroll.setLayoutParams(scrollLp);

        LinearLayout tabPagesHost = new LinearLayout(this);
        tabPagesHost.setOrientation(LinearLayout.VERTICAL);

        // ---------- Tab 0: 控屏（高频动作 + 已学技能 + 外卖 + 工具箱） ----------
        final LinearLayout pageCtrl = new LinearLayout(this);
        pageCtrl.setOrientation(LinearLayout.VERTICAL);

        LinearLayout quickStrip = new LinearLayout(this);
        quickStrip.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams qsLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        qsLp.bottomMargin = dp(8);
        quickStrip.setLayoutParams(qsLp);

        TextView stopTaskBtn = createGridBtn("急停");
        stopTaskBtn.setTextColor(Color.parseColor("#FCA5A5"));
        setViewBg(stopTaskBtn, createRoundRect("#2AEF4444", 10, "#40EF4444", 1));
        stopTaskBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                showFeedback("已停止当前任务");
                Toast.makeText(FloatAgentService.this, "已停止当前任务", Toast.LENGTH_SHORT).show();
            }
        });

        TextView readScrBtn = createGridBtn("读屏");
        setViewBg(readScrBtn, createRoundRect("#14FFFFFF", 10, "#1FFFFFFF", 1));
        readScrBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("读屏幕", false);
            }
        });

        TextView homeKeyBtn = createGridBtn("桌面");
        setViewBg(homeKeyBtn, createRoundRect("#14FFFFFF", 10, "#1FFFFFFF", 1));
        homeKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("回桌面", true);
            }
        });

        TextView backKeyBtn = createGridBtn("返回");
        setViewBg(backKeyBtn, createRoundRect("#14FFFFFF", 10, "#1FFFFFFF", 1));
        backKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("返回", true);
            }
        });

        TextView quickTypingEntryBtn = createGridBtn("⌨打字");
        quickTypingEntryBtn.setTextColor(Color.parseColor("#93C5FD"));
        setViewBg(quickTypingEntryBtn, createRoundRect("#1A3B82F6", 10, "#333B82F6", 1));
        LinearLayout.LayoutParams qtLp = (LinearLayout.LayoutParams) quickTypingEntryBtn.getLayoutParams();
        qtLp.rightMargin = 0;
        quickTypingEntryBtn.setLayoutParams(qtLp);
        quickTypingEntryBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                showQuickTypingBar();
            }
        });

        quickStrip.addView(stopTaskBtn);
        quickStrip.addView(readScrBtn);
        quickStrip.addView(homeKeyBtn);
        quickStrip.addView(backKeyBtn);
        quickStrip.addView(quickTypingEntryBtn);
        pageCtrl.addView(quickStrip);

        // 已学本地技能快捷区
        LinearLayout skillsBox = new LinearLayout(this);
        skillsBox.setOrientation(LinearLayout.VERTICAL);
        skillsBox.setPadding(dp(10), dp(8), dp(10), dp(8));
        setViewBg(skillsBox, createRoundRect("#10FFFFFF", 12, "#1CFFFFFF", 1));
        LinearLayout.LayoutParams skLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        skLp.bottomMargin = dp(8);
        skillsBox.setLayoutParams(skLp);

        TextView skillsHeader = new TextView(this);
        skillsHeader.setText("已学本地技能 · 免 API 直达");
        skillsHeader.setTextColor(Color.parseColor("#94A3B8"));
        skillsHeader.setTextSize(10.5f);
        skillsHeader.setPadding(0, 0, 0, dp(5));
        skillsBox.addView(skillsHeader);

        HorizontalScrollView skillsScroll = new HorizontalScrollView(this);
        skillsScroll.setHorizontalScrollBarEnabled(false);
        learnedSkillsStrip = new LinearLayout(this);
        learnedSkillsStrip.setOrientation(LinearLayout.HORIZONTAL);
        learnedSkillsStrip.setGravity(Gravity.CENTER_VERTICAL);
        skillsScroll.addView(learnedSkillsStrip);
        skillsBox.addView(skillsScroll);
        refreshLearnedSkillsStrip();
        pageCtrl.addView(skillsBox);

        pageCtrl.addView(buildTakeoutSyncCard());

        LinearLayout toolsBarRow = new LinearLayout(this);
        toolsBarRow.setOrientation(LinearLayout.HORIZONTAL);
        toolsBarRow.setGravity(Gravity.CENTER_VERTICAL);

        toolsToggleBtn = new TextView(this);
        toolsToggleBtn.setText("更多工具（刷视频 / 截屏 / 应用）▾");
        toolsToggleBtn.setTextColor(Color.parseColor("#94A3B8"));
        toolsToggleBtn.setTextSize(11f);
        toolsToggleBtn.setGravity(Gravity.CENTER);
        toolsToggleBtn.setPadding(dp(8), dp(7), dp(8), dp(7));
        setViewBg(toolsToggleBtn, createRoundRect("#12FFFFFF", 10, "#1FFFFFFF", 1));
        LinearLayout.LayoutParams ttLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        ttLp.rightMargin = dp(6);
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
                        : "更多工具（刷视频 / 截屏 / 应用）▾");
            }
        });

        TextView shotKeyBtn = createActionBtn("截屏", "#1E293B", "#CBD5E1");
        shotKeyBtn.setTextSize(11f);
        shotKeyBtn.setPadding(dp(11), dp(7), dp(11), dp(7));
        setViewBg(shotKeyBtn, createRoundRect("#14FFFFFF", 10, "#1FFFFFFF", 1));
        shotKeyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("截屏", true);
            }
        });

        toolsBarRow.addView(toolsToggleBtn);
        toolsBarRow.addView(shotKeyBtn);
        pageCtrl.addView(toolsBarRow);

        localToolsBox = buildCollapsibleLocalTools();
        localToolsBox.setVisibility(View.GONE);
        pageCtrl.addView(localToolsBox);

        // ---------- Tab 1: 桌宠形象切换 + 互动与 QQ 音乐 ----------
        final LinearLayout pagePet = new LinearLayout(this);
        pagePet.setOrientation(LinearLayout.VERTICAL);
        pagePet.setVisibility(View.GONE);

        // 悬浮窗形象双选切换条（大肥鱼 🐳 ⇄ 奶龙 🐲）
        LinearLayout personaRow = new LinearLayout(this);
        personaRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams prLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        prLp.bottomMargin = dp(7);
        personaRow.setLayoutParams(prLp);

        petSwitchFeiyuCard = createPersonaSelectCard(
                R.drawable.feiyu_idle,
                "🐳 大肥鱼",
                "干饭鲸鱼娘 · 吃米饭",
                true,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        switchPetPersona(PET_FEIYU, true, true);
                    }
                }
        );
        LinearLayout.LayoutParams fcLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        fcLp.rightMargin = dp(6);
        petSwitchFeiyuCard.setLayoutParams(fcLp);

        petSwitchNailongCard = createPersonaSelectCard(
                R.drawable.nailong_idle,
                "🐲 奶龙",
                "治愈小黄龙 · 啃鸡腿",
                false,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        switchPetPersona(PET_NAILONG, true, true);
                    }
                }
        );
        petSwitchNailongCard.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        personaRow.addView(petSwitchFeiyuCard);
        personaRow.addView(petSwitchNailongCard);
        pagePet.addView(personaRow);

        LinearLayout petActionRow = new LinearLayout(this);
        petActionRow.setOrientation(LinearLayout.HORIZONTAL);

        panelFeedBtn = createGridBtn(isNailong() ? "🍗 喂鸡腿" : "🍚 喂米饭");
        panelFeedBtn.setTextColor(Color.parseColor("#FDE68A"));
        setViewBg(panelFeedBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        panelFeedBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerFeedRiceAction();
            }
        });

        TextView patBtn = createGridBtn("👋 摸头");
        setViewBg(patBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        patBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerHeadPatAction();
            }
        });

        TextView danceBtn = createGridBtn("💃 跳舞");
        setViewBg(danceBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        danceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerDanceAction();
            }
        });

        TextView mischiefBtn = createGridBtn("😈 捣蛋");
        mischiefBtn.setTextColor(Color.parseColor("#DDD6FE"));
        setViewBg(mischiefBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
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

        petActionRow.addView(panelFeedBtn);
        petActionRow.addView(patBtn);
        petActionRow.addView(danceBtn);
        petActionRow.addView(mischiefBtn);
        pagePet.addView(petActionRow);

        LinearLayout petActionRow2 = new LinearLayout(this);
        petActionRow2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actBarLp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actBarLp2.topMargin = dp(6);
        petActionRow2.setLayoutParams(actBarLp2);

        TextView singBtn = createGridBtn("🎤 唱歌");
        singBtn.setTextColor(Color.parseColor("#F9A8D4"));
        setViewBg(singBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        singBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerSingSongAction();
            }
        });

        TextView importSongBtn = createGridBtn("📥 导歌");
        importSongBtn.setTextColor(Color.parseColor("#A7F3D0"));
        setViewBg(importSongBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        importSongBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityForSongImport();
            }
        });

        TextView memeBtn = createGridBtn("🫧 热梗");
        setViewBg(memeBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
        memeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
                triggerRandomMemeVoice();
            }
        });

        TextView takeoutCheckBtn = createGridBtn("🛵 查外卖");
        takeoutCheckBtn.setTextColor(Color.parseColor("#FED7AA"));
        setViewBg(takeoutCheckBtn, createRoundRect("#16FFFFFF", 10, "#22FFFFFF", 1));
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
        pagePet.addView(petActionRow2);
        pagePet.addView(buildQqMusicCard());

        // ---------- Tab 2: 悬浮窗与语音偏好设置 ----------
        final LinearLayout pagePref = new LinearLayout(this);
        pagePref.setOrientation(LinearLayout.VERTICAL);
        pagePref.setVisibility(View.GONE);

        LinearLayout prefPersonaRow = new LinearLayout(this);
        prefPersonaRow.setOrientation(LinearLayout.HORIZONTAL);
        prefPersonaRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams pprLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pprLp.bottomMargin = dp(7);
        prefPersonaRow.setLayoutParams(pprLp);

        TextView personaDescTv = new TextView(this);
        personaDescTv.setText("悬浮窗桌面形象");
        personaDescTv.setTextColor(Color.parseColor("#CBD5E1"));
        personaDescTv.setTextSize(11.5f);
        personaDescTv.setTypeface(null, android.graphics.Typeface.BOLD);
        personaDescTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        personaSwitchPrefBtn = createActionBtn(
                isNailong() ? "🐲 当前: 奶龙 (点此换大肥鱼)" : "🐳 当前: 大肥鱼 (点此换奶龙)",
                "#1E293B",
                "#F8FAFC"
        );
        personaSwitchPrefBtn.setTextSize(10.5f);
        personaSwitchPrefBtn.setPadding(dp(10), dp(5), dp(10), dp(5));
        personaSwitchPrefBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchPetPersona(isNailong() ? PET_FEIYU : PET_NAILONG, true, true);
            }
        });
        prefPersonaRow.addView(personaDescTv);
        prefPersonaRow.addView(personaSwitchPrefBtn);
        pagePref.addView(prefPersonaRow);

        LinearLayout prefSwitchRow1 = new LinearLayout(this);
        prefSwitchRow1.setOrientation(LinearLayout.HORIZONTAL);

        antiMistouchToggleBtn = createGridBtn("🛡️防误触:关");
        antiMistouchToggleBtn.setTextSize(10.5f);
        antiMistouchToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                antiMistouchEnabled = !antiMistouchEnabled;
                savePrefBool("anti_mistouch", antiMistouchEnabled);
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        antiMistouchEnabled
                                ? "已开启防误触：单点" + petDisplayName() + "不弹窗（连点 3 下打开面板）"
                                : "已关闭防误触：单击即可展开面板",
                        Toast.LENGTH_LONG).show();
            }
        });

        voiceTailToggleBtn = createGridBtn("🎙语音尾巴:开");
        voiceTailToggleBtn.setTextSize(10.5f);
        voiceTailToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showVoiceTail = !showVoiceTail;
                savePrefBool("show_voice_tail", showVoiceTail);
                applyVoiceTailVisibility();
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        showVoiceTail ? "已显示折叠态快捷语音尾巴" : "已隐藏折叠态语音尾巴（只保留" + petDisplayName() + "本体）",
                        Toast.LENGTH_SHORT).show();
            }
        });

        extPetBarToggleBtn = createGridBtn("🐾外置互动:开");
        extPetBarToggleBtn.setTextSize(10.5f);
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
                        showExternalPetBar ? "已显示大肥鱼外置互动条" : "已隐藏外置互动条",
                        Toast.LENGTH_SHORT).show();
            }
        });

        prefSwitchRow1.addView(antiMistouchToggleBtn);
        prefSwitchRow1.addView(voiceTailToggleBtn);
        prefSwitchRow1.addView(extPetBarToggleBtn);
        pagePref.addView(prefSwitchRow1);

        LinearLayout prefSwitchRow2 = new LinearLayout(this);
        prefSwitchRow2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams psLp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        psLp2.topMargin = dp(6);
        prefSwitchRow2.setLayoutParams(psLp2);

        freeRoamToggleBtn = createGridBtn("🚶自由漫步:开");
        freeRoamToggleBtn.setTextSize(10.5f);
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
        headBubbleToggleBtn.setTextSize(10.5f);
        headBubbleToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                headBubbleEnabled = !headBubbleEnabled;
                savePrefBool("show_head_bubble", headBubbleEnabled);
                if (!headBubbleEnabled) {
                    mainHandler.removeCallbacks(headBubbleHideRunnable);
                    if (headSpeechBubbleWrap != null) headSpeechBubbleWrap.setVisibility(View.GONE);
                    else if (headSpeechBubbleView != null) headSpeechBubbleView.setVisibility(View.GONE);
                } else if (headBubbleEnabled) {
                    scheduleNextAutoHeadBubble();
                }
                refreshPrefSwitchButtons();
                Toast.makeText(FloatAgentService.this,
                        headBubbleEnabled ? "已开启高颜值透明头顶气泡" : "已关闭" + petDisplayName() + "头顶气泡",
                        Toast.LENGTH_SHORT).show();
            }
        });

        floatingLyricsToggleBtn = createGridBtn("🪟透明歌词:开");
        floatingLyricsToggleBtn.setTextSize(10.5f);
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
        pagePref.addView(prefSwitchRow2);
        refreshPrefSwitchButtons();

        LinearLayout autoSendRow = new LinearLayout(this);
        autoSendRow.setOrientation(LinearLayout.HORIZONTAL);
        autoSendRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams asrLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        asrLp.topMargin = dp(8);
        autoSendRow.setLayoutParams(asrLp);

        TextView autoSendDesc = new TextView(this);
        autoSendDesc.setText("语音识别完成后自动执行指令");
        autoSendDesc.setTextColor(Color.parseColor("#94A3B8"));
        autoSendDesc.setTextSize(11f);
        autoSendDesc.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        autoSendToggleBtn = new TextView(this);
        refreshAutoSendChip();
        autoSendToggleBtn.setTextSize(10.5f);
        autoSendToggleBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
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
        autoSendRow.addView(autoSendDesc);
        autoSendRow.addView(autoSendToggleBtn);
        pagePref.addView(autoSendRow);

        tabPagesHost.addView(pageCtrl);
        tabPagesHost.addView(pagePet);
        tabPagesHost.addView(pagePref);
        bodyScroll.addView(tabPagesHost);

        final Runnable[] switchFloatTab = new Runnable[3];
        final android.view.View.OnClickListener selectTab0 = new View.OnClickListener() {
            @Override public void onClick(View v) { switchFloatTab[0].run(); }
        };
        final android.view.View.OnClickListener selectTab1 = new View.OnClickListener() {
            @Override public void onClick(View v) { switchFloatTab[1].run(); }
        };
        final android.view.View.OnClickListener selectTab2 = new View.OnClickListener() {
            @Override public void onClick(View v) { switchFloatTab[2].run(); }
        };

        switchFloatTab[0] = new Runnable() {
            @Override
            public void run() {
                pageCtrl.setVisibility(View.VISIBLE);
                pagePet.setVisibility(View.GONE);
                pagePref.setVisibility(View.GONE);
                setViewBg(tabCtrlBtn, createRoundRect("#4D6BFE", 9, null, 0));
                tabCtrlBtn.setTextColor(Color.WHITE);
                setViewBg(tabPetBtn, createRoundRect("#00000000", 9, null, 0));
                tabPetBtn.setTextColor(Color.parseColor("#94A3B8"));
                setViewBg(tabPrefBtn, createRoundRect("#00000000", 9, null, 0));
                tabPrefBtn.setTextColor(Color.parseColor("#94A3B8"));
            }
        };
        switchFloatTab[1] = new Runnable() {
            @Override
            public void run() {
                pageCtrl.setVisibility(View.GONE);
                pagePet.setVisibility(View.VISIBLE);
                pagePref.setVisibility(View.GONE);
                setViewBg(tabCtrlBtn, createRoundRect("#00000000", 9, null, 0));
                tabCtrlBtn.setTextColor(Color.parseColor("#94A3B8"));
                setViewBg(tabPetBtn, createRoundRect("#4D6BFE", 9, null, 0));
                tabPetBtn.setTextColor(Color.WHITE);
                setViewBg(tabPrefBtn, createRoundRect("#00000000", 9, null, 0));
                tabPrefBtn.setTextColor(Color.parseColor("#94A3B8"));
            }
        };
        switchFloatTab[2] = new Runnable() {
            @Override
            public void run() {
                pageCtrl.setVisibility(View.GONE);
                pagePet.setVisibility(View.GONE);
                pagePref.setVisibility(View.VISIBLE);
                setViewBg(tabCtrlBtn, createRoundRect("#00000000", 9, null, 0));
                tabCtrlBtn.setTextColor(Color.parseColor("#94A3B8"));
                setViewBg(tabPetBtn, createRoundRect("#00000000", 9, null, 0));
                tabPetBtn.setTextColor(Color.parseColor("#94A3B8"));
                setViewBg(tabPrefBtn, createRoundRect("#4D6BFE", 9, null, 0));
                tabPrefBtn.setTextColor(Color.WHITE);
            }
        };
        tabCtrlBtn.setOnClickListener(selectTab0);
        tabPetBtn.setOnClickListener(selectTab1);
        tabPrefBtn.setOnClickListener(selectTab2);
        switchFloatTab[0].run();

        panel.addView(bodyScroll);

        // 4. 底部轻柔单行回执条
        feedbackTextView = new TextView(this);
        feedbackTextView.setText("大肥鱼待命：双击吃米饭，长按语音直达~");
        feedbackTextView.setTextColor(Color.parseColor("#64748B"));
        feedbackTextView.setTextSize(10.5f);
        feedbackTextView.setPadding(dp(2), dp(8), dp(2), dp(0));
        feedbackTextView.setMaxLines(1);
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
        card.setPadding(dp(11), dp(8), dp(11), dp(8));
        setViewBg(card, createRoundRect("#12FFFFFF", 14, "#24FFFFFF", 1));
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.topMargin = dp(8);
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

    private void applySoftToggleStyle(TextView btn, boolean enabled) {
        if (btn == null) return;
        btn.setTextColor(Color.parseColor(enabled ? "#6EE7B7" : "#94A3B8"));
        setViewBg(btn, createRoundRect(
                enabled ? "#1E10B981" : "#12FFFFFF",
                10,
                enabled ? "#4010B981" : "#1FFFFFFF",
                1
        ));
    }

    private void refreshPrefSwitchButtons() {
        if (antiMistouchToggleBtn != null) {
            antiMistouchToggleBtn.setText(antiMistouchEnabled ? "🛡防误触:开" : "🛡防误触:关");
            applySoftToggleStyle(antiMistouchToggleBtn, antiMistouchEnabled);
        }
        if (voiceTailToggleBtn != null) {
            voiceTailToggleBtn.setText(showVoiceTail ? "🎙语音尾巴:开" : "🎙语音尾巴:关");
            applySoftToggleStyle(voiceTailToggleBtn, showVoiceTail);
        }
        if (extPetBarToggleBtn != null) {
            extPetBarToggleBtn.setText(showExternalPetBar ? "🐾外置互动:开" : "🐾外置互动:关");
            applySoftToggleStyle(extPetBarToggleBtn, showExternalPetBar);
        }
        if (freeRoamToggleBtn != null) {
            freeRoamToggleBtn.setText(freeRoamEnabled ? "🚶自由漫步:开" : "🚶自由漫步:关");
            applySoftToggleStyle(freeRoamToggleBtn, freeRoamEnabled);
        }
        if (headBubbleToggleBtn != null) {
            headBubbleToggleBtn.setText(headBubbleEnabled ? "💬头顶气泡:开" : "💬头顶气泡:关");
            applySoftToggleStyle(headBubbleToggleBtn, headBubbleEnabled);
        }
        if (floatingLyricsToggleBtn != null) {
            floatingLyricsToggleBtn.setText(floatingLyricsEnabled ? "🪟透明歌词:开" : "🪟透明歌词:关");
            applySoftToggleStyle(floatingLyricsToggleBtn, floatingLyricsEnabled);
        }
    }

    private void refreshAutoSendChip() {
        if (autoSendToggleBtn == null) return;
        autoSendToggleBtn.setText(voiceAutoSend ? "⚡自动执行:开" : "⚡自动执行:关");
        applySoftToggleStyle(autoSendToggleBtn, voiceAutoSend);
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

    private void playWhaleVoice(int rawResId, int drawableResId, String animType, String subtitle, boolean isManualAction) {
        playWhaleVoiceInternal(rawResId, drawableResId, null, animType, subtitle, isManualAction);
    }

    private void playWhaleVoice(int rawResId, String poseKey, String animType, String subtitle, boolean isManualAction) {
        playWhaleVoiceInternal(rawResId, 0, poseKey, animType, subtitle, isManualAction);
    }

    private void playWhaleVoiceInternal(int rawResId, int explicitResId, String poseKey, String animType, String subtitle, boolean isManualAction) {
        // 必须先判断外部是否在播歌，再停掉自己上一句的播放器，防止残留音频缓冲误判成“外部在放歌”
        boolean musicPlaying = isExternalMusicPlayingNow();
        if (singerEngine != null && singerEngine.isSinging()) {
            singerEngine.stop();
        }
        stopWhaleVoicePlayer();
        wakePetOpacity();
        mainHandler.removeCallbacks(happyResetRunnable);
        mainHandler.removeCallbacks(subtitleResetRunnable);

        if (poseKey != null && !poseKey.isEmpty()) {
            setPetPose(poseKey);
        } else if (explicitResId != 0) {
            setPetPoseDrawable(explicitResId);
        }
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
                // 使用媒体音量通道（避免手机静音/振动或通知音量为 0 时彻底无声），且不申请 AudioFocus
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

    // ========= 全屏自由漫步 + 头顶美化气泡吐槽天气 & 暖心安慰鼓励 =========
    private void scheduleNextAutoHeadBubble() {
        long delayMs = (5 * 60_000L) + petRandom.nextInt(5 * 60_000 + 1);
        nextAutoHeadBubbleAtMs = System.currentTimeMillis() + delayMs;
    }

    private String resolveHeadBubbleTag(String msg) {
        String base = petDisplayEmoji() + " " + petDisplayName();
        if (msg.contains("°C") || msg.contains("雨") || msg.contains("雪") || msg.contains("晴") || msg.contains("天气") || msg.contains("降温")) {
            return base + " · 天气速递";
        }
        if (msg.contains("鸡腿") || msg.contains("米饭")) {
            return base + " · 干饭日常";
        }
        if (msg.contains("累") || msg.contains("没关系") || msg.contains("加油") || msg.contains("陪")) {
            return base + " · 暖心陪伴";
        }
        if (msg.contains("外卖") || msg.contains("骑手")) {
            return base + " · 外卖追踪";
        }
        return base + " · 冒泡";
    }

    private void showHeadBubble(final String msg, final long durationMs) {
        if (headSpeechBubbleView == null || msg == null || msg.trim().isEmpty() || isDraggingPet) return;
        // 正在执行任务、LIVE HUD 激活时，不让闲聊气泡遮挡重要任务信息
        if (!"idle".equals(sCurrentStatus) && taskHudWrap != null && taskHudWrap.getVisibility() == View.VISIBLE) {
            return;
        }
        final View targetWrap = headSpeechBubbleWrap != null ? headSpeechBubbleWrap : headSpeechBubbleView;
        if (!headBubbleEnabled) {
            targetWrap.setVisibility(View.GONE);
            restoreBubbleWindowOffset();
            return;
        }
        String trimmed = msg.trim();
        mainHandler.removeCallbacks(headBubbleHideRunnable);
        targetWrap.animate().cancel();
        if (headBubbleBadgeView != null) {
            headBubbleBadgeView.setText(resolveHeadBubbleTag(trimmed));
        }
        headSpeechBubbleView.setText(trimmed);
        targetWrap.setAlpha(0f);
        targetWrap.setScaleX(0.92f);
        targetWrap.setScaleY(0.92f);
        targetWrap.setTranslationY(dpFloat(4f));
        targetWrap.setVisibility(View.VISIBLE);

        // 向上扩展空间，避免弹出头顶气泡时将奶龙本体向下挤出或溢出屏幕右侧
        if (layoutParams != null && windowManager != null && floatRootView != null) {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int maxW = Math.min(dp(248), Math.round(dm.widthPixels * 0.72f));
            targetWrap.measure(
                    View.MeasureSpec.makeMeasureSpec(maxW, View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(dp(180), View.MeasureSpec.AT_MOST)
            );
            int measuredH = targetWrap.getMeasuredHeight() + dp(4);
            int measuredW = Math.max(dp(124), targetWrap.getMeasuredWidth());
            int curAnchorY = layoutParams.y + headBubbleYOffset;
            int targetY = Math.max(dp(28), curAnchorY - measuredH);
            headBubbleYOffset = curAnchorY - targetY;
            layoutParams.y = targetY;
            int maxSafeX = Math.max(dp(6), dm.widthPixels - measuredW - dp(8));
            if (layoutParams.x > maxSafeX) {
                layoutParams.x = maxSafeX;
            }
            try {
                windowManager.updateViewLayout(floatRootView, layoutParams);
            } catch (Exception ignored) {}
        }

        targetWrap.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .translationY(0f)
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
            applyPetPhysics(0f, 1f, 1f, 0f, 0f, 0f, 0.971f);
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
        dismissHeadBubbleImmediate();

        final DisplayMetrics dm = getResources().getDisplayMetrics();
        int petW = (petBubbleContainer != null && petBubbleContainer.getWidth() > 0) ? petBubbleContainer.getWidth() : dp(96);
        int petH = (petBubbleContainer != null && petBubbleContainer.getHeight() > 0) ? petBubbleContainer.getHeight() : dp(120);

        final int minX = dp(8);
        final int maxX = Math.max(minX + dp(32), dm.widthPixels - petW - dp(8));
        final int minY = dp(52);
        final int maxY = Math.max(minY + dp(80), dm.heightPixels - petH - dp(95));

        final int startX = Math.max(minX, Math.min(layoutParams.x, maxX));
        final int startY = Math.max(minY, Math.min(layoutParams.y, maxY));

        // 贴地行走：偏向横移为主（±25° 以内平缓走位），避免无重力垂直斜飘浮空感
        int stepDistMin = dp(72);
        int stepDistMax = dp(172);
        int distTarget = stepDistMin + petRandom.nextInt(Math.max(10, stepDistMax - stepDistMin));
        float dirChoice = (startX < minX + dp(45)) ? 1f : ((startX > maxX - dp(45)) ? -1f : (petRandom.nextBoolean() ? 1f : -1f));
        double angle = (dirChoice > 0 ? 0.0 : Math.PI) + (petRandom.nextDouble() - 0.5) * 0.72;
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

        // 奶龙：向左使用天然朝左贴图 walk，向右使用天然朝右贴图 walk_right（绝不镜像）；大肥鱼维持朝向翻转
        final float dirSign = (targetX < startX) ? -1f : 1f;
        final boolean nl = isNailong();
        setPetPose((nl && dirSign > 0f) ? "walk_right" : "walk");
        mainHandler.removeCallbacks(lifePoseResetRunnable);

        double dist = Math.hypot(targetX - startX, targetY - startY);
        long durMs = Math.max(3900L, Math.min(7600L, Math.round(dist * 13.5)));
        final int strideCycles = Math.max(4, Math.min(9, (int) Math.round(dist / Math.max(1, dp(24)))));
        final int[] lastFootstepIndex = new int[]{-1};

        petRoamAnimator = ValueAnimator.ofFloat(0f, 1f);
        petRoamAnimator.setDuration(durMs);
        petRoamAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                if (isExpanded || isDraggingPet || windowManager == null || floatRootView == null) {
                    return;
                }
                float f = (float) animation.getAnimatedValue();
                float moveProgress;
                float liftDp;
                float sy;
                float tiltDeg;

                if (f < 0.09f) {
                    float p = f / 0.09f;
                    float pre = (float) Math.sin(p * Math.PI * 0.5);
                    moveProgress = 0f;
                    liftDp = -1.0f * pre;
                    sy = 1f - 0.045f * pre;
                    tiltDeg = -2.8f * dirSign * pre;
                } else if (f < 0.91f) {
                    float walkF = (f - 0.09f) / 0.82f;
                    moveProgress = (float) (0.5 - 0.5 * Math.cos(Math.PI * walkF));
                    double rad = walkF * Math.PI * 2.0 * strideCycles;
                    float sVal = (float) Math.sin(rad);
                    float cVal = (float) Math.cos(rad);
                    if (sVal >= 0f) {
                        liftDp = 2.2f * sVal;
                        sy = 1f + 0.028f * sVal;
                    } else {
                        liftDp = 1.0f * sVal;
                        sy = 1f + 0.045f * sVal;
                    }
                    int stepIdx = (int) Math.floor(walkF * strideCycles);
                    if (stepIdx != lastFootstepIndex[0] && sVal < -0.75f) {
                        lastFootstepIndex[0] = stepIdx;
                        emitPetFx(PetFxOverlayView.FX_DUST, 1);
                    }
                    tiltDeg = 3.0f * cVal + 1.5f * dirSign;
                } else {
                    float p = (f - 0.91f) / 0.09f;
                    float brake = (float) Math.sin(p * Math.PI);
                    moveProgress = 1f;
                    liftDp = -1.1f * brake;
                    sy = 1f - 0.05f * brake;
                    tiltDeg = 2.5f * dirSign * brake;
                    if (lastFootstepIndex[0] != 999) {
                        lastFootstepIndex[0] = 999;
                        emitPetFx(PetFxOverlayView.FX_DUST, 2);
                    }
                }

                int nextX = Math.max(minX, Math.min(Math.round(startX + (targetX - startX) * moveProgress), maxX));
                int nextY = Math.max(minY, Math.min(Math.round(startY + (targetY - startY) * moveProgress), maxY));
                float sx = (nl ? 1.0f : dirSign) * (1.0f / Math.max(0.88f, sy));
                applyPetPhysics(liftDp, sx, sy, tiltDeg, 0f, 0f, 0.971f);
                if (nextX != layoutParams.x || nextY != layoutParams.y) {
                    layoutParams.x = nextX;
                    layoutParams.y = nextY;
                    savedPillX = nextX;
                    savedPillY = nextY;
                    try {
                        windowManager.updateViewLayout(floatRootView, layoutParams);
                    } catch (Exception ignored) {}
                }
            }
        });
        petRoamAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                if (petAvatarView != null) {
                    petAvatarView.animate()
                            .translationY(0f)
                            .rotation(0f)
                            .rotationY(0f)
                            .scaleX(1f)
                            .scaleY(1f)
                            .setDuration(240)
                            .start();
                }
                if (petGroundShadowView != null) {
                    petGroundShadowView.updateShadow(0f, 1f, 0f, 0f);
                }
                if (!isExpanded && !isDraggingPet && "idle".equals(sCurrentStatus)) {
                    String endPoseKey = (petRandom.nextInt(10) < 3) ? "derp" : (petRandom.nextBoolean() ? "happy" : "idle");
                    setPetPose(endPoseKey);
                    if ("derp".equals(endPoseKey)) {
                        playPetBounceAnim("curious");
                    } else if ("happy".equals(endPoseKey)) {
                        playPetBounceAnim("ear_twitch");
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
        String treatName = isNailong() ? "大烤鸡腿" : "热乎白米饭";
        String selfCall = isNailong() ? "奶龙" : "大肥鱼";

        if (!desc.isEmpty() && tempVal != Integer.MIN_VALUE) {
            if (desc.contains("雨")) {
                return "☔ " + cityPart + "竟然在" + desc + "（" + tempVal + "°C）！出门可别忘带伞，小心把衣服打湿啦~";
            }
            if (desc.contains("雪")) {
                return "❄️ 哇塞！" + cityPart + desc + " " + tempVal + "°C 了，冷得我都想缩进被窝里吃" + treatName + "！";
            }
            if (desc.contains("雷") || desc.contains("风") || desc.contains("沙")) {
                return "🌬️ " + cityPart + "现在" + desc + "（" + tempVal + "°C），外面妖风阵阵的，老实待在室内最安全~";
            }
            if (tempVal <= 10) {
                return "🧣 " + cityPart + desc + "才 " + tempVal + "°C 呀！好冷呀，快多穿件外套再喝口热茶暖暖手~";
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
            return "☀️ 太阳晒到正午啦！也不知道外面热不热，反正待在室内陪着你最安逸~";
        } else if (hour >= 15 && hour < 19) {
            return "⛅ 下午天空慢慢变温柔啦~ 忙了一天快瞅瞅窗外云朵，歇口气再继续！";
        } else if (hour >= 19 && hour < 23) {
            return "🌙 天黑降温最容易偷着凉啦，注意保暖哦，" + selfCall + "给你捂捂手~";
        } else {
            return "✨ 夜深了外面风肯定很冷吧，还在熬夜的话" + selfCall + "可要督促你早点休息咯！";
        }
    }

    private void showRandomWeatherOrComfortBubble() {
        // 45% 吐槽实时/分时段天气，55% 温柔安慰鼓励话语
        if (petRandom.nextInt(10) < 4) {
            showHeadBubble(buildWeatherRoastLine(), 5500);
            return;
        }
        String[] comfortLines = isNailong() ? new String[]{
                "🐲 遇到难搞的事别一个人硬扛呀！深呼吸眨眨眼，奶龙用大肚皮帮你顶住~ ✨",
                "🍗 心情要是有点阴天，就点一下「喂鸡腿」分你一半香喷喷的快乐~",
                "💪 一切很快就会好起来的！奶龙圆滚滚的大肚皮里装满了好运气，摸摸就好啦~",
                "✨ 没关系哒，慢一点也没关系的，今天的你已经做得很棒啦！",
                "🫧 呼噜噜…不管外面刮风下雨，屏幕里永远有一只奶龙在给你打气呀！",
                "🌟 休息不是偷懒哦，是为了攒足能量继续冲鸭！加油！🎈"
        } : new String[]{
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
            feedbackTextView.setTextColor(Color.parseColor(isNailong() ? "#FDE68A" : "#BAE6FD"));
        }
        // 在折叠态桌面状态下，说话同步在桌宠头顶以气泡形式弹出，交互反馈一眼直达！
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
        if (isNailong()) {
            int[] voices = new int[]{R.raw.nailong_3, R.raw.nailong_2, R.raw.nailong_4};
            String[] lines = new String[]{
                    "🍗 啊呜——！香迷糊了！大烤鸡腿越啃越有劲，一口炫光光！😋",
                    "🍗 一加一等于几？等于两个大鸡腿！跟着奶龙混全都稳稳拿下~ 💪",
                    "🍗 吧唧吧唧…吃完这口大鸡腿，俺这圆滚滚的大肚皮又有干劲啦！🐲"
            };
            int idx = feedIndex % voices.length;
            feedIndex++;
            playWhaleVoice(voices[idx], "eating", "eat", lines[idx], true);
            if (!isExpanded) {
                Toast.makeText(this, lines[idx], Toast.LENGTH_SHORT).show();
            }
            return;
        }
        int[] voices = new int[]{R.raw.feiyu_eat_rice, R.raw.feiyu_eat_rice_2, R.raw.feiyu_token_lai};
        String[] lines = new String[]{
                "🍚 这是只有我们知道的小秘密……我今天其实很想吃白米饭！😋",
                "🍚 我可以认真讨论统计，也可以认真讨论晚饭，这两件事并不冲突！📚",
                "🍚 主人不在的时候，我当然没有偷吃算力，只是重新分配了一碗饭… 🥺"
        };
        int idx = feedIndex % voices.length;
        feedIndex++;
        playWhaleVoice(voices[idx], "eating", "eat", lines[idx], true);
        if (!isExpanded) {
            Toast.makeText(this, lines[idx], Toast.LENGTH_SHORT).show();
        }
    }

    private void triggerHeadPatAction() {
        if (isNailong()) {
            int[] voices = new int[]{
                    R.raw.nailong_1, R.raw.nailong_4, R.raw.nailong_9, R.raw.nailong_10
            };
            String[] poses = new String[]{"happy", "happy", "happy", "focus"};
            String[] lines = new String[]{
                    "🐲 哈哈哈好痒呀！别戳俺的大肚皮，再戳俺就要变成小黄球滚走咯~ ✨",
                    "💪 哼哼，我才是真的奶龙！你看我圆滚滚的大肚子，里面装的全是必胜秘籍哟！",
                    "🌸 一切很快就会好起来的！深呼吸眨眨眼，奶龙会一直陪着你哟~",
                    "🎈 累了吗？奶龙给你打气呀！元气加满，今天也是超棒的一天，冲鸭！🐾"
            };
            int idx = patIndex % voices.length;
            patIndex++;
            playWhaleVoice(voices[idx], poses[idx], "bounce", lines[idx], true);
            return;
        }
        int[] voices = new int[]{
                R.raw.feiyu_pat_head, R.raw.feiyu_pat_soft, R.raw.feiyu_intro,
                R.raw.feiyu_focus_done, R.raw.feiyu_status_ok
        };
        String[] poses = new String[]{"happy", "happy", "happy", "focus", "idle"};
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
        if (isNailong()) {
            int[] voices = new int[]{R.raw.nailong_6, R.raw.nailong_7, R.raw.nailong_focus_done};
            String[] poses = new String[]{"dance", "walk", "dance"};
            String[] lines = new String[]{
                    "💃 芜湖！快看奶龙给你跳个扭屁股庆功舞，妥妥稳稳上岸，耶！🌟",
                    "🎉 小天才养成记！芜湖~ 连对这么酷，奶龙兴奋得转圈圈啦！✨",
                    "🐾 哒哒哒~ 俺迈开小短腿在桌面上巡逻一圈，肚皮一颠一颠~ 🎶"
            };
            int idx = danceIndex % voices.length;
            danceIndex++;
            playWhaleVoice(voices[idx], poses[idx], "dance", lines[idx], true);
            return;
        }
        int[] voices = new int[]{R.raw.feiyu_praise_streak, R.raw.feiyu_walk, R.raw.feiyu_walk_2};
        String[] poses = new String[]{"dance", "walk", "dance"};
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
        if (isNailong()) {
            int[] voices = new int[]{
                    R.raw.nailong_5, R.raw.nailong_8, R.raw.nailong_2, R.raw.nailong_focus_start, R.raw.nailong_1
            };
            String[] poses = new String[]{"sleepy", "happy", "derp", "focus", "derp"};
            String[] lines = new String[]{
                    "🫧 呼噜噜…啊？我没睡着，我才没流口水呢！刚才只是闭着眼帮你思考嘛~",
                    "🔥 哼哼~ 关键时刻还得看奶龙！冲刺秘籍都在俺圆滚滚的大肚皮里！💪",
                    "🍗 咦——？一加一等于几来着？等于两个大鸡腿！😋",
                    "🧠 奶龙专注模式启动！西装一穿戴好耳机，屏幕交给我来操心！💻",
                    "😝 Duang~ 肚皮弹力值 MAX！再戳俺要变成小黄球滚走咯~"
            };
            int idx = (patIndex + feedIndex + danceIndex) % voices.length;
            patIndex++;
            playWhaleVoice(voices[idx], poses[idx], "shake", lines[idx], true);
            return;
        }
        int[] voices = new int[]{
                R.raw.feiyu_meme_claude, R.raw.feiyu_not_fat, R.raw.feiyu_meme_gpu,
                R.raw.feiyu_tsundere, R.raw.feiyu_jealous, R.raw.feiyu_slacking,
                R.raw.feiyu_refuse, R.raw.feiyu_server_busy, R.raw.feiyu_cot_slacking
        };
        String[] poses = new String[]{"happy", "derp", "derp", "beg", "derp", "sleepy", "busy", "busy", "focus"};
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
        if (isNailong()) {
            playWhaleVoice(
                    R.raw.nailong_5,
                    "dizzy",
                    "slip",
                    "💫 哇啊啊别晃啦 @_@！俺眼珠子都转成蚊香啦，满天都是大烤鸡腿~",
                    true
            );
            return;
        }
        playWhaleVoice(
                R.raw.feiyu_dizzy,
                "dizzy",
                "slip",
                "🌀 至于大肥鱼摔跤嘛，先得讨论鱼为什么会在陆地上…晃晕啦！",
                true
        );
    }

    private void triggerMischiefAction(final boolean withSpeechBubble) {
        final int mode = (withSpeechBubble ? mischiefIndex : petRandom.nextInt(6)) % 6;
        if (withSpeechBubble) mischiefIndex++;

        stopPetRoaming();
        int[] voices = isNailong() ? new int[]{
                R.raw.nailong_5, R.raw.nailong_1, R.raw.nailong_3,
                R.raw.nailong_5, R.raw.nailong_5, R.raw.nailong_8
        } : new int[]{
                R.raw.feiyu_dizzy, R.raw.feiyu_not_fat, R.raw.feiyu_eat_rice_2,
                R.raw.feiyu_pat_soft, R.raw.feiyu_slacking, R.raw.feiyu_refuse
        };
        String[] poses = new String[]{"dizzy", "derp", "eating", "beg", "sleepy", "derp"};
        String[] anims = new String[]{
                "slip", "upside_down", "nibble",
                "bubble_pop", "nap_startle", "bonk"
        };
        String[] lines = isNailong() ? new String[]{
                "🌀 哎呀！小短腿在屏幕上打滑劈叉了，幸好肚皮够软和！",
                "🙃 倒立炫技中！你看俺这圆润的黄金大肚腩是不是像太阳😜",
                "🤫 咔哧咔哧…偷偷啃掉你屏幕上一点烦躁和无聊~ 🍗",
                "🫧 噗——吹个超大亮黄泡泡，结果啪一下吓得小耳朵直抖！",
                "💤 呼噜噜…才没有偷睡！只是闭眼帮你偷偷加载好运气 ⚡",
                "😈 咚！大肚皮冲撞屏幕：撞走所有坏心情啦！💥"
        } : new String[]{
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
            setPetPose(poses[mode]);
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
            setPetPose("dance");
            playPetBounceAnim("dance");
            showPetSubtitle("🎵 音乐正在播放中，" + petDisplayName() + "安静伴舞不打扰你听歌~", 3200);
            return;
        }
        stopWhaleVoicePlayer();
        setPetPose("dance");
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
            setPetPose("happy");
            showPetSubtitle(isNailong()
                    ? "🎵 奶龙唱完收工啦，快奖励一根大烤鸡腿！🍗"
                    : "🎵 鲸鱼娘唱完收工啦，快奖励一碗白米饭！🍚", 3200);
            singSongIndex++;
            return;
        }
        if (isExternalMusicPlayingNow()) {
            setPetPose("dance");
            playPetBounceAnim("dance");
            showPetSubtitle("🎵 音乐正在播放中，" + petDisplayName() + "安静伴舞不打扰你听歌~", 3200);
            Toast.makeText(this, "🎵 QQ 音乐播放中已静音伴舞（暂停音乐后可听" + petDisplayName() + "真实歌唱）", Toast.LENGTH_SHORT).show();
            return;
        }
        stopWhaleVoicePlayer();
        setPetPose("dance");
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

    // ========= 语音指令智能识别处理（动作 + 形象切换 + QQ音乐 + 控屏） =========
    private boolean handleLocalWhaleCommand(String raw) {
        if (raw == null) return false;
        String t = raw.trim().toLowerCase(Locale.ROOT);
        if (t.isEmpty()) return false;

        if (t.contains("奶龙")) {
            switchPetPersona(PET_NAILONG, true, true);
            return true;
        }
        if (t.contains("大肥鱼") || t.contains("鲸鱼娘") || t.contains("肥鱼")) {
            switchPetPersona(PET_FEIYU, true, true);
            return true;
        }
        if (t.contains("米饭") || t.contains("鸡腿") || t.contains("干饭") || t.contains("饿了") || t.contains("喂食") || t.contains("吃饭")) {
            triggerFeedRiceAction();
            return true;
        }
        if (t.contains("摸头") || t.contains("摸摸") || t.contains("肚皮") || t.contains("你好") || t.contains("可爱")) {
            triggerHeadPatAction();
            return true;
        }
        if (t.contains("跳舞") || t.contains("跳个舞") || t.contains("摇尾巴") || t.contains("扭屁股")) {
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
            mainHandler.removeCallbacks(headBubbleHideRunnable);
            if (headSpeechBubbleWrap != null) headSpeechBubbleWrap.setVisibility(View.GONE);
            else if (headSpeechBubbleView != null) headSpeechBubbleView.setVisibility(View.GONE);
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
            setPetPose("idle");
            showPetSubtitle("好哒，" + petDisplayName() + "乖乖闭麦啦~ 🫧", 2600);
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
            setPetPose("dance");
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
            setPetPose("dance");
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
        String poseKey = "beg";
        String anim = "bounce";
        String fishReaction;
        String selfName = petDisplayName();
        String treatHint = isNailong() ? "一口大鸡腿 🍗" : "一口白米饭 🍚";

        if ("arrived".equals(newStage)) {
            stageEmoji = "🎉";
            stageLabel = "已送达！快去取餐啦";
            poseKey = "eating";
            anim = "eat";
            fishReaction = "🎉 叮咚！" + takeoutPlatform + "已送达啦！趁热开吃呀，分" + selfName + treatHint;
        } else if ("arriving".equals(newStage)) {
            stageEmoji = "🛵💨";
            stageLabel = "骑手逼近中";
            poseKey = "walk";
            anim = "walk";
            fishReaction = "🛵💨 骑手快到啦（" + (t.isEmpty() ? d : t) + "），" + selfName + "已经在门口流口水蹲守了 🤤";
        } else if ("delivering".equals(newStage)) {
            stageEmoji = "🛵";
            stageLabel = "骑手配送中";
            poseKey = "happy";
            anim = "bounce";
            fishReaction = "🛵 哇！" + takeoutPlatform + "骑手已取餐狂奔在路上了，再忍忍马上就能干饭~";
        } else if ("preparing".equals(newStage)) {
            stageEmoji = "👨‍🍳";
            stageLabel = "备餐/接单中";
            poseKey = "beg";
            anim = "nibble";
            fishReaction = "👨‍🍳 发现" + takeoutPlatform + "正在备餐中！" + selfName + "已备好小勺子一起等开饭 🤤";
        } else {
            stageEmoji = "📦";
            stageLabel = "订单跟踪中";
            poseKey = "focus";
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
                setPetPose(poseKey);
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
        // 已彻底删除大肥鱼折叠态右侧黑底歌词尾巴，保持本体踩实简洁；仅有近 45 分钟内的活跃外卖进度才安静提示一条简报
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
            showPetSubtitle(petDisplayEmoji() + " " + petDisplayName() + "收到「" + cmd + "」，马上行动~", 3000);
            Toast.makeText(this, petDisplayName() + "已收到，正在规划执行", Toast.LENGTH_SHORT).show();
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
            setPetPose("happy");
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
            setPetPose("focus");
            updateVoiceBtnUi("recording");
            if (voiceGuideBanner != null) {
                voiceGuideBanner.setVisibility(View.VISIBLE);
            }
            refreshCollapsedPill();
            showFeedback("🎙️ 正在倾听…可说“放晴天 / 换奶龙 / 下一首”，说完再点一次");
            Toast.makeText(this, "🎙️ " + petDisplayName() + "正在听你说…说完请再点一次结束", Toast.LENGTH_SHORT).show();

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
            setPetPose("idle");
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
                            setPetPose("idle");
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
                setViewBg(quickMicBadgeView, createRoundRect("#E60F172A", 14, isNailong() ? "#FBBF24" : "#38BDF8", 1));
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
            setPetPose("happy");
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
        boolean hudActive = false;

        switch (state) {
            case "confirming":
                pillBg.setStroke(dp(1), Color.parseColor("#F59E0B"));
                pillBg.setColor(Color.parseColor("#EB451A03"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FDE68A"));
                if (!isDraggingPet) setPetPose("happy");
                showStop = true;
                hudActive = true;
                renderTaskHudState("confirming", "⚠️ " + displayTxt);
                break;
            case "thinking":
                pillBg.setStroke(dp(1), Color.parseColor("#4D6BFE"));
                dotShape.setColor(Color.parseColor("#60A5FA"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                if (!isDraggingPet) setPetPose("focus");
                showStop = true;
                hudActive = true;
                renderTaskHudState("thinking", displayTxt);
                break;
            case "executing":
            case "acting":
                pillBg.setStroke(dp(1), Color.parseColor("#0EA5E9"));
                dotShape.setColor(Color.parseColor("#38BDF8"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                if (!isDraggingPet) setPetPose("busy");
                showStop = true;
                hudActive = true;
                renderTaskHudState("acting", displayTxt);
                break;
            case "stopped":
                pillBg.setStroke(dp(1), Color.parseColor("#EF4444"));
                dotShape.setColor(Color.parseColor("#EF4444"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FCA5A5"));
                if (!isDraggingPet) setPetPose("derp");
                renderTaskHudState("stopped", "⏹ " + displayTxt);
                break;
            case "idle":
            default:
                pillBg.setStroke(dp(1), Color.parseColor(isNailong() ? "#F59E0B" : "#0284C7"));
                dotShape.setColor(Color.parseColor("#10B981"));
                statusTextView.setText("dsh-Go");
                statusTextView.setTextColor(Color.parseColor("#E0F2FE"));
                if (celebrateHappy) {
                    renderTaskHudState("done", "✅ " + displayTxt);
                } else if (taskHudWrap != null && taskHudWrap.getVisibility() == View.VISIBLE) {
                    mainHandler.postDelayed(taskHudAutoHideRunnable, 1200);
                }
                if (!isDraggingPet) {
                    if (celebrateHappy) {
                        setPetPose("happy");
                        mainHandler.postDelayed(happyResetRunnable, 1800);
                    } else if (qqMusicPlaying || (singerEngine != null && singerEngine.isSinging())) {
                        setPetPose("dance");
                    } else {
                        setPetPose("idle");
                    }
                }
                if ("idle".equals(state)) {
                    lastTaskHudStep = 0;
                    lastTaskHudThought = "";
                    lastTaskHudAction = "";
                    lastTaskHudVerdict = "";
                }
                break;
        }

        // 任务 HUD 气泡可见时自动隐去旧的冗余黑底胶囊（仅在语音录音中才独立显示声波提示条）
        boolean showPill = isRecordingVoice || (!hudActive && "idle".equals(state) && statusPillView.getVisibility() == View.VISIBLE);
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

    private LinearLayout askUserOverlayView;

    private void displayAskUserOverlay(String title, String thought, String question, String optionsJson) {
        if (windowManager == null) return;
        hideConfirmBanner();
        hideAskUserOverlay();
        collapsePanel();

        applyStatusStyle("confirming", "等你确认: " + (title != null ? title : "补充说明"), false);
        setEdgeGlowState("confirming");
        vibrateGentle(140);

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int cardWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(352));

        askUserOverlayView = new LinearLayout(this);
        askUserOverlayView.setOrientation(LinearLayout.VERTICAL);
        askUserOverlayView.setPadding(dp(15), dp(13), dp(15), dp(13));
        setViewBg(askUserOverlayView, createRoundRect("#F2111622", 20, "#4D6BFE", 1));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);

        ImageView whaleIc = new ImageView(this);
        whaleIc.setImageResource(resolvePetPoseRes("idle"));
        whaleIc.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams wiLp = new LinearLayout.LayoutParams(dp(24), dp(24));
        wiLp.rightMargin = dp(7);
        whaleIc.setLayoutParams(wiLp);

        TextView titleTv = new TextView(this);
        titleTv.setText(title != null && !title.trim().isEmpty() ? title.trim() : "dsh-Go 需要你确认");
        titleTv.setTextColor(Color.parseColor("#F8FAFC"));
        titleTv.setTextSize(13.5f);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        titleTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        TextView backChatTv = new TextView(this);
        backChatTv.setText("回聊天");
        backChatTv.setTextColor(Color.parseColor("#93C5FD"));
        backChatTv.setTextSize(11f);
        backChatTv.setPadding(dp(8), dp(4), dp(8), dp(4));
        setViewBg(backChatTv, createRoundRect("#1A3B82F6", 999, "#333B82F6", 1));
        backChatTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideAskUserOverlay();
                updateState("idle", "dsh-Go");
                MainActivity.dispatchConfirmDecisionToWebView("__back_to_chat__");
                bringMainActivityToFront(null, false);
            }
        });

        head.addView(whaleIc);
        head.addView(titleTv);
        head.addView(backChatTv);
        askUserOverlayView.addView(head);

        if (thought != null && !thought.trim().isEmpty()) {
            TextView thoughtTv = new TextView(this);
            thoughtTv.setText("💭 " + thought.trim());
            thoughtTv.setTextColor(Color.parseColor("#93C5FD"));
            thoughtTv.setTextSize(11f);
            thoughtTv.setPadding(dp(9), dp(6), dp(9), dp(6));
            thoughtTv.setMaxLines(3);
            thoughtTv.setEllipsize(TextUtils.TruncateAt.END);
            setViewBg(thoughtTv, createRoundRect("#12FFFFFF", 10, "#1FFFFFFF", 1));
            LinearLayout.LayoutParams thLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            thLp.topMargin = dp(8);
            thoughtTv.setLayoutParams(thLp);
            askUserOverlayView.addView(thoughtTv);
        }

        TextView qTv = new TextView(this);
        qTv.setText(question != null && !question.trim().isEmpty() ? question.trim() : "请确认或补充接下来的操作说明");
        qTv.setTextColor(Color.parseColor("#F1F5F9"));
        qTv.setTextSize(13f);
        qTv.setPadding(0, dp(9), 0, dp(8));
        askUserOverlayView.addView(qTv);

        try {
            if (optionsJson != null && !optionsJson.trim().isEmpty()) {
                JSONArray opts = new JSONArray(optionsJson);
                if (opts.length() > 0) {
                    LinearLayout optWrap = new LinearLayout(this);
                    optWrap.setOrientation(LinearLayout.VERTICAL);
                    LinearLayout.LayoutParams owLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    owLp.bottomMargin = dp(8);
                    optWrap.setLayoutParams(owLp);
                    int maxOpts = Math.min(opts.length(), 4);
                    for (int i = 0; i < maxOpts; i++) {
                        final String optText = opts.optString(i, "").trim();
                        if (optText.isEmpty()) continue;
                        TextView optBtn = new TextView(this);
                        optBtn.setText(optText);
                        optBtn.setTextColor(Color.parseColor("#E0E7FF"));
                        optBtn.setTextSize(12f);
                        optBtn.setPadding(dp(11), dp(7), dp(11), dp(7));
                        setViewBg(optBtn, createRoundRect("#244D6BFE", 10, "#554D6BFE", 1));
                        LinearLayout.LayoutParams obLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                        if (i > 0) obLp.topMargin = dp(5);
                        optBtn.setLayoutParams(obLp);
                        optBtn.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                hideAskUserOverlay();
                                updateState("thinking", "继续执行...");
                                MainActivity.dispatchConfirmDecisionToWebView("reply:" + optText);
                            }
                        });
                        optWrap.addView(optBtn);
                    }
                    askUserOverlayView.addView(optWrap);
                }
            }
        } catch (Exception ignored) {}

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);

        final EditText replyEt = new EditText(this);
        replyEt.setHint("直接输入答复或补充要求…");
        replyEt.setHintTextColor(Color.parseColor("#64748B"));
        replyEt.setTextColor(Color.WHITE);
        replyEt.setTextSize(12f);
        replyEt.setSingleLine(true);
        replyEt.setImeOptions(EditorInfo.IME_ACTION_SEND);
        replyEt.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(replyEt, createRoundRect("#161C2C", 10, "#334155", 1));
        LinearLayout.LayoutParams etLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        etLp.rightMargin = dp(6);
        replyEt.setLayoutParams(etLp);

        TextView sendReplyBtn = createActionBtn("确认继续", "#4D6BFE", "#FFFFFF");
        sendReplyBtn.setPadding(dp(11), dp(7), dp(11), dp(7));
        LinearLayout.LayoutParams srLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        srLp.rightMargin = dp(5);
        sendReplyBtn.setLayoutParams(srLp);

        final Runnable submitReply = new Runnable() {
            @Override
            public void run() {
                String txt = replyEt.getText() != null ? replyEt.getText().toString().trim() : "";
                if (txt.isEmpty()) txt = "继续执行";
                hideAskUserOverlay();
                updateState("thinking", "继续执行...");
                MainActivity.dispatchConfirmDecisionToWebView("reply:" + txt);
            }
        };
        sendReplyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                submitReply.run();
            }
        });
        replyEt.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEND || actionId == EditorInfo.IME_ACTION_DONE) {
                    submitReply.run();
                    return true;
                }
                return false;
            }
        });

        TextView cancelReplyBtn = createActionBtn("取消", "#334155", "#CBD5E1");
        cancelReplyBtn.setPadding(dp(10), dp(7), dp(10), dp(7));
        cancelReplyBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideAskUserOverlay();
                updateState("idle", "dsh-Go");
                MainActivity.dispatchConfirmDecisionToWebView("cancel");
            }
        });

        inputRow.addView(replyEt);
        inputRow.addView(sendReplyBtn);
        inputRow.addView(cancelReplyBtn);
        askUserOverlayView.addView(inputRow);

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                cardWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        lp.gravity = Gravity.CENTER;

        try {
            windowManager.addView(askUserOverlayView, lp);
        } catch (Exception ignored) {}
    }

    private void hideAskUserOverlay() {
        if (askUserOverlayView != null && windowManager != null) {
            try {
                windowManager.removeView(askUserOverlayView);
            } catch (Exception ignored) {}
            askUserOverlayView = null;
        }
    }

    private void hideConfirmBanner() {
        hideAskUserOverlay();
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

            builder.setContentTitle(petDisplayName() + " · dsh-Go 控屏中")
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
                setupAndStartPlayer(mp, "🎵 " + petDisplayName() + "正在为你献唱：《" + activeSongTitle + "》~", false);
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
                    setPetPose("happy");
                    showPetSubtitle(isBuiltIn
                            ? "🎵 唱完啦~ 可点面板「📥导歌」导入更多实际歌声！"
                            : "🎵 《" + activeSongTitle + "》唱完收工啦，奖励" + (isNailong() ? "一根大烤鸡腿！🍗" : "一碗大白米饭！🍚"), 3800);
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

    /**
     * 双层地面接触投影视图（AO 核心接触暗影 + 柔羽化动态投影）：
     * 消除 2D 立绘在屏幕浅色/深色背景上的悬浮贴纸感，随高度变化同步收缩虚化，着地瞬间扩实加浓。
     */
    private final class PetGroundShadowView extends View {
        private final Paint outerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint corePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF outerRect = new RectF();
        private final RectF coreRect = new RectF();
        private float liftDp = 0f;
        private float scaleFactorX = 1f;
        private float tiltDeg = 0f;
        private float shiftXdp = 0f;

        PetGroundShadowView(Context ctx) {
            super(ctx);
        }

        void updateShadow(float liftDp, float scaleFactorX, float tiltDeg, float shiftXdp) {
            this.liftDp = Math.max(-2.5f, Math.min(20f, liftDp));
            this.scaleFactorX = Math.max(0.7f, Math.min(1.35f, scaleFactorX));
            this.tiltDeg = tiltDeg;
            this.shiftXdp = shiftXdp;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            if (w <= 0f || h <= 0f) return;

            float heightRatio = Math.max(0f, Math.min(1f, liftDp / 14f));
            float pressBoost = liftDp < 0f ? Math.min(0.20f, (-liftDp) * 0.08f) : 0f;
            float cx = w * 0.5f + dpFloat(shiftXdp) + dpFloat(tiltDeg * 0.12f);
            float cy = h * 0.56f;

            // 使用三层柔滑半透明同心椭圆替代逐帧 Shader + canvas.scale，彻底避免移动中 GPU 块状伪影与内存抖动
            float outerRx = Math.max(2f, w * (0.36f + pressBoost * 0.22f) * (1f - 0.36f * heightRatio) * (0.68f + 0.32f * scaleFactorX));
            float outerRy = Math.max(1.5f, h * (0.38f + pressBoost * 0.18f) * (1f - 0.34f * heightRatio));
            int aOuter = Math.max(6, Math.min(48, Math.round((30 + pressBoost * 40) * (1f - 0.68f * heightRatio))));
            outerPaint.setShader(null);
            outerPaint.setStyle(Paint.Style.FILL);
            outerPaint.setColor(Color.argb(aOuter, 15, 23, 42));
            outerRect.set(cx - outerRx, cy - outerRy, cx + outerRx, cy + outerRy);
            canvas.drawOval(outerRect, outerPaint);

            float midRx = outerRx * 0.72f;
            float midRy = outerRy * 0.70f;
            int aMid = Math.max(6, Math.min(64, Math.round((44 + pressBoost * 55) * (1f - 0.72f * heightRatio))));
            outerPaint.setColor(Color.argb(aMid, 15, 23, 42));
            outerRect.set(cx - midRx, cy - midRy, cx + midRx, cy + midRy);
            canvas.drawOval(outerRect, outerPaint);

            float coreRx = Math.max(1.5f, outerRx * 0.45f);
            float coreRy = Math.max(1.0f, outerRy * 0.44f);
            int coreAlpha = Math.max(6, Math.min(82, Math.round((56 + pressBoost * 65) * (1f - 0.80f * heightRatio))));
            if (coreAlpha > 6) {
                corePaint.setShader(null);
                corePaint.setStyle(Paint.Style.FILL);
                corePaint.setColor(Color.argb(coreAlpha, 15, 23, 42));
                coreRect.set(cx - coreRx, cy - coreRy - dpFloat(0.4f), cx + coreRx, cy + coreRy - dpFloat(0.4f));
                canvas.drawOval(coreRect, corePaint);
            }
        }
    }

    /**
     * 轻量脚底接地微尘 / 心情星光 / 捣蛋泡泡粒子画布（无粒子自动休眠零开销）
     */
    private final class PetFxOverlayView extends View {
        static final int FX_DUST = 1;
        static final int FX_SPARKLE = 2;
        static final int FX_BUBBLE = 3;

        private final class Particle {
            int type;
            float x, y, vx, vy, r, alpha;
            long startMs, lifeMs;
            int color;
        }

        private final List<Particle> particles = new ArrayList<>();
        private final Paint fxPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private boolean nailongTheme = false;
        private final Runnable tickRunnable = new Runnable() {
            @Override
            public void run() {
                if (!particles.isEmpty()) {
                    invalidate();
                }
            }
        };

        PetFxOverlayView(Context ctx) {
            super(ctx);
        }

        void setPersonaTheme(boolean isNailong) {
            this.nailongTheme = isNailong;
        }

        void emit(int fxType, int count) {
            float w = getWidth() > 0 ? getWidth() : dp(76);
            float h = getHeight() > 0 ? getHeight() : dp(70);
            long now = android.os.SystemClock.uptimeMillis();
            for (int i = 0; i < count; i++) {
                Particle p = new Particle();
                p.type = fxType;
                p.startMs = now;
                if (fxType == FX_DUST) {
                    p.x = w * 0.5f + (petRandom.nextFloat() - 0.5f) * dpFloat(18f);
                    p.y = h - dpFloat(4.5f) + (petRandom.nextFloat() - 0.5f) * dpFloat(2.0f);
                    p.vx = (p.x < w * 0.5f ? -1f : 1f) * dpFloat(0.22f + petRandom.nextFloat() * 0.30f);
                    p.vy = -dpFloat(0.14f + petRandom.nextFloat() * 0.20f);
                    p.r = dpFloat(1.8f + petRandom.nextFloat() * 1.4f);
                    p.lifeMs = 400L + petRandom.nextInt(140);
                    p.color = Color.parseColor("#94A3B8");
                } else if (fxType == FX_BUBBLE) {
                    p.x = w * 0.5f + (petRandom.nextFloat() - 0.5f) * dpFloat(30f);
                    p.y = h * 0.48f + (petRandom.nextFloat() - 0.5f) * dpFloat(16f);
                    p.vx = (petRandom.nextFloat() - 0.5f) * dpFloat(0.45f);
                    p.vy = -dpFloat(0.35f + petRandom.nextFloat() * 0.35f);
                    p.r = dpFloat(2.6f + petRandom.nextFloat() * 2.8f);
                    p.lifeMs = 750L + petRandom.nextInt(250);
                    p.color = Color.parseColor(nailongTheme ? "#FBBF24" : "#7DD3FC");
                } else {
                    p.x = w * 0.5f + (petRandom.nextFloat() - 0.5f) * dpFloat(36f);
                    p.y = h * 0.38f + (petRandom.nextFloat() - 0.5f) * dpFloat(18f);
                    p.vx = (petRandom.nextFloat() - 0.5f) * dpFloat(0.30f);
                    p.vy = -dpFloat(0.28f + petRandom.nextFloat() * 0.30f);
                    p.r = dpFloat(2.5f + petRandom.nextFloat() * 1.8f);
                    p.lifeMs = 680L + petRandom.nextInt(220);
                    if (nailongTheme) {
                        p.color = petRandom.nextBoolean() ? Color.parseColor("#FDE047") : Color.parseColor("#FB923C");
                    } else {
                        p.color = petRandom.nextBoolean() ? Color.parseColor("#FDE68A") : Color.parseColor("#93C5FD");
                    }
                }
                particles.add(p);
            }
            while (particles.size() > 24) {
                particles.remove(0);
            }
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (particles.isEmpty()) return;
            long now = android.os.SystemClock.uptimeMillis();
            for (int i = particles.size() - 1; i >= 0; i--) {
                Particle p = particles.get(i);
                long elapsed = now - p.startMs;
                if (elapsed >= p.lifeMs) {
                    particles.remove(i);
                    continue;
                }
                float progress = (float) elapsed / (float) p.lifeMs;
                p.x += p.vx;
                p.y += p.vy;
                p.vy *= 0.96f;
                int a = Math.round(215f * (1f - progress * progress));
                if (p.type == FX_BUBBLE) {
                    fxPaint.setStyle(Paint.Style.STROKE);
                    fxPaint.setStrokeWidth(dpFloat(1.1f));
                    fxPaint.setColor(Color.argb(a, Color.red(p.color), Color.green(p.color), Color.blue(p.color)));
                    canvas.drawCircle(p.x, p.y, p.r * (0.85f + 0.45f * progress), fxPaint);
                } else if (p.type == FX_SPARKLE) {
                    fxPaint.setStyle(Paint.Style.FILL);
                    fxPaint.setColor(Color.argb(a, Color.red(p.color), Color.green(p.color), Color.blue(p.color)));
                    float curR = p.r * (1.0f - 0.4f * progress);
                    canvas.drawRect(p.x - curR, p.y - curR * 0.28f, p.x + curR, p.y + curR * 0.28f, fxPaint);
                    canvas.drawRect(p.x - curR * 0.28f, p.y - curR, p.x + curR * 0.28f, p.y + curR, fxPaint);
                } else {
                    fxPaint.setStyle(Paint.Style.FILL);
                    fxPaint.setColor(Color.argb(Math.round(a * 0.42f), Color.red(p.color), Color.green(p.color), Color.blue(p.color)));
                    canvas.drawCircle(p.x, p.y, p.r * (0.75f + 0.65f * progress), fxPaint);
                }
            }
            if (!particles.isEmpty()) {
                postDelayed(tickRunnable, 24);
            }
        }
    }

    /**
     * 柔光气泡底部尖角尾指针：无缝衔接半透明气泡底色与外框微光描边，提升跨应用 HUD 与萌宠冒泡质感。
     */
    private final class BubblePointerView extends View {
        private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final android.graphics.Path fillPath = new android.graphics.Path();
        private final android.graphics.Path strokePath = new android.graphics.Path();

        BubblePointerView(Context ctx) {
            super(ctx);
            fillPaint.setStyle(Paint.Style.FILL);
            fillPaint.setColor(Color.parseColor("#EB0E1629"));
            strokePaint.setStyle(Paint.Style.STROKE);
            strokePaint.setStrokeWidth(dpFloat(1.2f));
            strokePaint.setStrokeJoin(Paint.Join.ROUND);
            strokePaint.setColor(Color.parseColor("#6638BDF8"));
        }

        void setColors(int fillColor, int strokeColor) {
            fillPaint.setColor(fillColor);
            strokePaint.setColor(strokeColor);
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            if (w <= 0f || h <= 0f) return;

            fillPath.reset();
            fillPath.moveTo(0f, 0f);
            fillPath.lineTo(w, 0f);
            fillPath.lineTo(w * 0.5f, h - dpFloat(0.8f));
            fillPath.close();
            canvas.drawPath(fillPath, fillPaint);

            strokePath.reset();
            strokePath.moveTo(0f, 0f);
            strokePath.lineTo(w * 0.5f, h - dpFloat(0.8f));
            strokePath.lineTo(w, 0f);
            canvas.drawPath(strokePath, strokePaint);
        }
    }
}
