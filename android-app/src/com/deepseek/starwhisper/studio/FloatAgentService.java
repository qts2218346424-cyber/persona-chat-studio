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
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;
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
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * dsh-Go 风格手机控屏悬浮层与后台保活服务 (ControlOverlay)
 * 1. 屏幕边缘柔和呼吸光带（EdgeGlowView）：不拦截任何触摸，提示 AI 控屏状态；
 * 2. 触控落点涟漪（TapRippleView）：点击/滑动前展示柔和落点光圈；
 * 3. 贴边极简胶囊（闲置 5s 自动靠边半透明休眠）+ 运行中独立右侧停止微按钮；
 * 4. 双层极简控屏面板：主任务/插话输入框 + 高频快控条 + 默认折叠的本地快捷工具箱；
 * 5. 三档 SafetyGate 悬浮确认卡 + Android 14 ForegroundService 保活通知。
 */
public class FloatAgentService extends Service {
    private static final String FG_CHANNEL_ID = "pa_agent_running";
    private static final int FG_NOTIFICATION_ID = 2201;

    private static volatile FloatAgentService sInstance = null;
    public static volatile boolean sEmergencyStopRequested = false;
    public static volatile String sCurrentStatus = "idle"; // idle, thinking, executing, acting, confirming, stopped
    private static volatile boolean sEdgeGlowEnabled = true;

    private WindowManager windowManager;
    private EdgeGlowView edgeGlowView;
    private WindowManager.LayoutParams edgeGlowParams;

    private FrameLayout floatRootView;
    private LinearLayout statusPillView;
    private View statusDotView;
    private TextView statusTextView;
    private TextView pillStopBtn;
    private LinearLayout expandPanel;

    private TextView a11yBadgeView;
    private EditText cmdEditText;
    private EditText typingEditText;
    private TextView feedbackTextView;
    private TextView autoSwipeToggleBtn;
    private TextView toolsToggleBtn;
    private LinearLayout localToolsBox;
    private boolean localToolsExpanded = false;

    private SpeechRecognizer speechRecognizer = null;
    private boolean isListeningSpeech = false;
    private EditText activeSpeechTarget = null;
    private TextView activeSpeechVoiceBtn = null;

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
    private final Runnable idleDimRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isExpanded && "idle".equals(sCurrentStatus) && statusPillView != null) {
                statusPillView.animate().alpha(0.62f).setDuration(260).start();
            }
        }
    };

    private LinearLayout confirmBannerView = null;
    private WindowManager.LayoutParams confirmLayoutParams = null;
    private boolean foregroundActive = false;

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
                        if (!enabled) {
                            inst.edgeGlowView.setState("idle");
                        } else {
                            inst.edgeGlowView.setState(sCurrentStatus);
                        }
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
        sCurrentStatus = state != null ? state : "idle";
        final FloatAgentService instance = sInstance;
        if (instance != null && instance.statusTextView != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.applyStatusStyle(sCurrentStatus, text);
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

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
        sEmergencyStopRequested = false;
        initEdgeGlowOverlay();
        initFloatingView();
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
        savedPillY = dp(148);
        layoutParams.x = savedPillX;
        layoutParams.y = savedPillY;

        floatRootView = new FrameLayout(this);

        // 1. 折叠态：dsh-go 极简深炭磨砂胶囊 + 状态点 + 运行态独立停止微按钮
        statusPillView = new LinearLayout(this);
        statusPillView.setOrientation(LinearLayout.HORIZONTAL);
        statusPillView.setGravity(Gravity.CENTER_VERTICAL);
        statusPillView.setPadding(dp(11), dp(7), dp(10), dp(7));

        statusDotView = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(8), dp(8));
        dotLp.rightMargin = dp(7);
        statusDotView.setLayoutParams(dotLp);

        statusTextView = new TextView(this);
        statusTextView.setTextSize(12);
        statusTextView.setMaxWidth(dp(156));
        statusTextView.setSingleLine(true);
        statusTextView.setEllipsize(TextUtils.TruncateAt.END);
        statusTextView.setTextColor(Color.parseColor("#F8FAFC"));

        pillStopBtn = new TextView(this);
        pillStopBtn.setText("⏹");
        pillStopBtn.setTextSize(11);
        pillStopBtn.setTextColor(Color.parseColor("#FCA5A5"));
        pillStopBtn.setPadding(dp(7), dp(2), dp(5), dp(2));
        LinearLayout.LayoutParams stopBtnLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopBtnLp.leftMargin = dp(6);
        pillStopBtn.setLayoutParams(stopBtnLp);
        setViewBg(pillStopBtn, createRoundRect("#450A0A", 10, "#EF4444", 1));
        pillStopBtn.setVisibility(View.GONE);
        pillStopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                Toast.makeText(FloatAgentService.this, "已停止当前控屏任务", Toast.LENGTH_SHORT).show();
            }
        });

        statusPillView.addView(statusDotView);
        statusPillView.addView(statusTextView);
        statusPillView.addView(pillStopBtn);
        applyStatusStyle("idle", "dsh-Go");

        // 2. 展开态：dsh-go 风格控屏浮窗（默认极简，本地快捷工具可折叠）
        expandPanel = buildExpandPanel();
        expandPanel.setVisibility(View.GONE);

        floatRootView.addView(statusPillView);
        floatRootView.addView(expandPanel);

        statusPillView.setOnTouchListener(new View.OnTouchListener() {
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
                        wakePillOpacity();
                        initialX = layoutParams.x;
                        initialY = layoutParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        touchStartTime = System.currentTimeMillis();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        int nextX = initialX + (int) (event.getRawX() - initialTouchX);
                        int nextY = initialY + (int) (event.getRawY() - initialTouchY);
                        int maxY = Math.max(dp(100), dm.heightPixels - dp(80));
                        layoutParams.x = Math.max(0, Math.min(nextX, dm.widthPixels - dp(60)));
                        layoutParams.y = Math.max(dp(28), Math.min(nextY, maxY));
                        try {
                            windowManager.updateViewLayout(floatRootView, layoutParams);
                        } catch (Exception ignored) {}
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        if (duration < 280 && diffX < dp(8) && diffY < dp(8)) {
                            handleBubbleClick();
                        } else {
                            int pillW = statusPillView.getWidth() > 0 ? statusPillView.getWidth() : dp(96);
                            int center = layoutParams.x + pillW / 2;
                            int margin = dp(8);
                            layoutParams.x = (center < dm.widthPixels / 2)
                                    ? margin
                                    : Math.max(margin, dm.widthPixels - pillW - margin);
                            savedPillX = layoutParams.x;
                            savedPillY = layoutParams.y;
                            try {
                                windowManager.updateViewLayout(floatRootView, layoutParams);
                            } catch (Exception ignored) {}
                            scheduleIdleDim();
                        }
                        return true;
                }
                return false;
            }
        });

        try {
            windowManager.addView(floatRootView, layoutParams);
            scheduleIdleDim();
        } catch (Exception e) {
            Toast.makeText(this, "悬浮窗初始化失败，请检查系统悬浮窗权限", Toast.LENGTH_SHORT).show();
        }
    }

    private void wakePillOpacity() {
        mainHandler.removeCallbacks(idleDimRunnable);
        if (statusPillView != null) {
            statusPillView.animate().alpha(1.0f).setDuration(140).start();
        }
    }

    private void scheduleIdleDim() {
        mainHandler.removeCallbacks(idleDimRunnable);
        if (!isExpanded && "idle".equals(sCurrentStatus)) {
            mainHandler.postDelayed(idleDimRunnable, 5000);
        }
    }

    private LinearLayout buildExpandPanel() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(356));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setLayoutParams(new ViewGroup.LayoutParams(panelWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.setPadding(dp(14), dp(12), dp(14), dp(12));
        setViewBg(panel, createRoundRect("#F2111827", 18, "#334155", 1));

        // 1. 顶栏：圆点 + dsh-Go 控屏 + 无障碍状态微标 + 回主界面 + 收起
        LinearLayout headRow = new LinearLayout(this);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        View brandDot = new View(this);
        LinearLayout.LayoutParams bDotLp = new LinearLayout.LayoutParams(dp(8), dp(8));
        bDotLp.rightMargin = dp(7);
        brandDot.setLayoutParams(bDotLp);
        GradientDrawable bDotShape = new GradientDrawable();
        bDotShape.setShape(GradientDrawable.OVAL);
        bDotShape.setColor(Color.parseColor("#4D6BFE"));
        setViewBg(brandDot, bDotShape);

        TextView titleTv = new TextView(this);
        titleTv.setText("dsh-Go 控屏");
        titleTv.setTextColor(Color.parseColor("#F8FAFC"));
        titleTv.setTextSize(13.5f);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        titleTv.setLayoutParams(titleLp);

        a11yBadgeView = new TextView(this);
        a11yBadgeView.setTextSize(10.5f);
        a11yBadgeView.setPadding(dp(8), dp(3), dp(8), dp(3));
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
        homeAppTv.setPadding(dp(8), dp(4), dp(6), dp(4));
        LinearLayout.LayoutParams homeLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        homeLp.leftMargin = dp(4);
        homeAppTv.setLayoutParams(homeLp);
        homeAppTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityToFront(null);
            }
        });

        TextView closeTv = new TextView(this);
        closeTv.setText("收起");
        closeTv.setTextColor(Color.parseColor("#94A3B8"));
        closeTv.setTextSize(11.5f);
        closeTv.setPadding(dp(6), dp(4), dp(2), dp(4));
        closeTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
            }
        });

        headRow.addView(brandDot);
        headRow.addView(titleTv);
        headRow.addView(a11yBadgeView);
        headRow.addView(homeAppTv);
        headRow.addView(closeTv);
        panel.addView(headRow);

        // 2. 主任务/插话输入舱（运行中发送自动作为插话指令注入，不强行跳转切屏）
        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(10), 0, dp(8));

        cmdEditText = new EditText(this);
        cmdEditText.setHint("说句话让 AI 操控，或运行中插话纠偏…");
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
        editLp.rightMargin = dp(6);
        cmdEditText.setLayoutParams(editLp);

        final TextView voiceBtn = createActionBtn("语音", "#0EA5E9", "#FFFFFF");
        LinearLayout.LayoutParams voiceLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        voiceLp.rightMargin = dp(5);
        voiceBtn.setLayoutParams(voiceLp);
        voiceBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleSpeechRecognitionFor(cmdEditText, voiceBtn);
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

        // 3. 高频单行快控条
        LinearLayout quickStrip = new LinearLayout(this);
        quickStrip.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams qsLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        qsLp.bottomMargin = dp(8);
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

        // 4. 可折叠本地快捷工具切换条（默认收起保持轻盈）
        toolsToggleBtn = new TextView(this);
        toolsToggleBtn.setText("展开本地快捷工具（刷视频 / 代打字 / 常用App） ▾");
        toolsToggleBtn.setTextColor(Color.parseColor("#94A3B8"));
        toolsToggleBtn.setTextSize(11);
        toolsToggleBtn.setGravity(Gravity.CENTER);
        toolsToggleBtn.setPadding(dp(8), dp(6), dp(8), dp(6));
        setViewBg(toolsToggleBtn, createRoundRect("#1E293B", 8, "#334155", 1));
        toolsToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                localToolsExpanded = !localToolsExpanded;
                if (localToolsBox != null) {
                    localToolsBox.setVisibility(localToolsExpanded ? View.VISIBLE : View.GONE);
                }
                toolsToggleBtn.setText(localToolsExpanded
                        ? "收起本地快捷工具 ▴"
                        : "展开本地快捷工具（刷视频 / 代打字 / 常用App） ▾");
            }
        });
        panel.addView(toolsToggleBtn);

        localToolsBox = buildCollapsibleLocalTools();
        localToolsBox.setVisibility(View.GONE);
        panel.addView(localToolsBox);

        // 5. 底部状态回执条
        feedbackTextView = new TextView(this);
        feedbackTextView.setText("dsh-Go 控屏就绪，支持中途插话与安全确认");
        feedbackTextView.setTextColor(Color.parseColor("#94A3B8"));
        feedbackTextView.setTextSize(10.5f);
        feedbackTextView.setPadding(dp(2), dp(7), dp(2), dp(0));
        feedbackTextView.setMaxLines(2);
        feedbackTextView.setEllipsize(TextUtils.TruncateAt.END);
        panel.addView(feedbackTextView);

        refreshDynamicWidgets();
        return panel;
    }

    private void dispatchTaskOrInterjectFromInput() {
        String cmd = cmdEditText != null && cmdEditText.getText() != null
                ? cmdEditText.getText().toString().trim()
                : "";
        if (TextUtils.isEmpty(cmd)) {
            Toast.makeText(this, "请输入任务指令或插话内容", Toast.LENGTH_SHORT).show();
            return;
        }
        cmdEditText.setText("");
        collapsePanel();
        boolean dispatched = MainActivity.dispatchFloatInterjectToWebView(cmd);
        if (!dispatched) {
            bringMainActivityToFront(cmd);
        } else {
            Toast.makeText(this, "已发送给 dsh-Go 智能体执行", Toast.LENGTH_SHORT).show();
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
        typingEditText.setHint("填入底层输入框的文字");
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
                toggleSpeechRecognitionFor(typingEditText, typingVoiceBtn);
            }
        });
        typingInputRow.addView(typingEditText);
        typingInputRow.addView(typingVoiceBtn);
        page.addView(typingInputRow);

        LinearLayout actRow = new LinearLayout(this);
        actRow.setOrientation(LinearLayout.HORIZONTAL);
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
        return page;
    }

    private LinearLayout buildAppsTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(buildGridRow(
                new String[]{"微信", "抖音", "快手", "小红书"},
                new String[]{"打开微信", "打开抖音", "打开快手", "打开小红书"},
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
        btn.setTextSize(11);
        btn.setGravity(Gravity.CENTER);
        btn.setSingleLine(true);
        btn.setPadding(dp(4), dp(7), dp(4), dp(7));
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
        }, 420);
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

    private void bringMainActivityToFront(String pendingTask) {
        collapsePanel();
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (pendingTask != null && !pendingTask.trim().isEmpty()) {
                intent.putExtra(MainActivity.EXTRA_PENDING_AGENT_TASK, pendingTask.trim());
            }
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void toggleSpeechRecognitionFor(final EditText targetEditText, final TextView voiceBtn) {
        if (targetEditText == null) return;
        if (isListeningSpeech) {
            stopSpeechRecognition();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "语音输入需要麦克风权限", Toast.LENGTH_LONG).show();
                bringMainActivityToFront("");
                return;
            }
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Toast.makeText(this, "当前设备未安装系统语音识别服务", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            if (speechRecognizer != null) {
                try { speechRecognizer.destroy(); } catch (Exception ignored) {}
                speechRecognizer = null;
            }
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            activeSpeechTarget = targetEditText;
            activeSpeechVoiceBtn = voiceBtn;
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    isListeningSpeech = true;
                    updateVoiceBtnUi(true);
                    showFeedback("正在倾听，请说话…");
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { showFeedback("正在识别语音…"); }
                @Override public void onError(int error) {
                    isListeningSpeech = false;
                    updateVoiceBtnUi(false);
                    showFeedback("语音识别已结束");
                }
                @Override public void onResults(Bundle results) {
                    isListeningSpeech = false;
                    updateVoiceBtnUi(false);
                    if (results != null) {
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty() && activeSpeechTarget != null) {
                            String recognized = matches.get(0).trim();
                            String old = activeSpeechTarget.getText() != null ? activeSpeechTarget.getText().toString() : "";
                            String sep = old.isEmpty() || old.endsWith(" ") ? "" : " ";
                            activeSpeechTarget.setText(old + sep + recognized);
                            activeSpeechTarget.setSelection(activeSpeechTarget.getText().length());
                            showFeedback("已听写: " + recognized);
                        }
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            isListeningSpeech = false;
            updateVoiceBtnUi(false);
            Toast.makeText(this, "启动语音识别失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void stopSpeechRecognition() {
        if (speechRecognizer != null) {
            try { speechRecognizer.stopListening(); } catch (Exception ignored) {}
        }
        isListeningSpeech = false;
        updateVoiceBtnUi(false);
    }

    private void updateVoiceBtnUi(boolean listening) {
        if (activeSpeechVoiceBtn != null) {
            activeSpeechVoiceBtn.setText(listening ? "停止" : "语音");
            setViewBg(activeSpeechVoiceBtn, createRoundRect(listening ? "#EF4444" : "#0EA5E9", 9, null, 0));
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
    }

    private void expandPanel() {
        if (isExpanded) return;
        isExpanded = true;
        wakePillOpacity();
        savedPillX = layoutParams.x;
        savedPillY = layoutParams.y;

        if (statusPillView != null) statusPillView.setVisibility(View.GONE);
        expandPanel.setVisibility(View.VISIBLE);
        refreshDynamicWidgets();

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(356));
        layoutParams.x = Math.max(dp(8), (dm.widthPixels - panelWidth) / 2);
        layoutParams.y = Math.max(dp(48), Math.min(savedPillY, dm.heightPixels / 3));
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

        expandPanel.setVisibility(View.GONE);
        if (statusPillView != null) statusPillView.setVisibility(View.VISIBLE);

        layoutParams.x = savedPillX;
        layoutParams.y = savedPillY;
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        try {
            windowManager.updateViewLayout(floatRootView, layoutParams);
        } catch (Exception ignored) {}
        scheduleIdleDim();
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
        int delayMs = shouldCollapse ? (needsFocusReturn ? 420 : 280) : 60;

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

    private void applyStatusStyle(String state, String text) {
        if (statusTextView == null || statusPillView == null) return;
        wakePillOpacity();
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(Color.parseColor("#EB111827"));
        pillBg.setCornerRadius(dp(22));

        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);

        String displayTxt = (text != null && !text.trim().isEmpty()) ? text.trim() : "dsh-Go";
        boolean showStop = false;
        switch (state) {
            case "confirming":
                pillBg.setStroke(dp(1), Color.parseColor("#F59E0B"));
                pillBg.setColor(Color.parseColor("#EB451A03"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FDE68A"));
                showStop = true;
                break;
            case "thinking":
                pillBg.setStroke(dp(1), Color.parseColor("#4D6BFE"));
                dotShape.setColor(Color.parseColor("#60A5FA"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                showStop = true;
                break;
            case "executing":
            case "acting":
                pillBg.setStroke(dp(1), Color.parseColor("#0EA5E9"));
                dotShape.setColor(Color.parseColor("#38BDF8"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                showStop = true;
                break;
            case "stopped":
                pillBg.setStroke(dp(1), Color.parseColor("#EF4444"));
                dotShape.setColor(Color.parseColor("#EF4444"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FCA5A5"));
                break;
            case "idle":
            default:
                pillBg.setStroke(dp(1), Color.parseColor("#334155"));
                dotShape.setColor(Color.parseColor("#10B981"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                break;
        }

        if (pillStopBtn != null) {
            pillStopBtn.setVisibility(showStop ? View.VISIBLE : View.GONE);
        }
        if (statusDotView != null) {
            setViewBg(statusDotView, dotShape);
        }
        setViewBg(statusPillView, pillBg);
        scheduleIdleDim();
    }

    private void displayConfirmBanner(String summary, String actionDesc, String riskLevel, String targetApp, boolean hardSensitive) {
        if (windowManager == null) return;
        hideConfirmBanner();

        applyStatusStyle("confirming", "待确认: " + (summary != null ? summary : "敏感操作"));
        setEdgeGlowState("confirming");

        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(180);
            }
        } catch (Exception ignored) {}

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

        confirmLayoutParams = new WindowManager.LayoutParams(
                bannerWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );
        confirmLayoutParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        confirmLayoutParams.y = dp(64);

        try {
            windowManager.addView(confirmBannerView, confirmLayoutParams);
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
                        "dsh-Go 手机控屏保活",
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

            builder.setContentTitle("dsh-Go 手机控屏运行中")
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
        stopSpeechRecognition();
        hideConfirmBanner();
        updateForegroundNotification(false, "");
        if (edgeGlowView != null && windowManager != null) {
            try { windowManager.removeView(edgeGlowView); } catch (Exception ignored) {}
            edgeGlowView = null;
        }
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

    /**
     * 屏幕边缘柔和呼吸光带视图（完全不拦截触摸事件）
     */
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

    /**
     * 触控落点柔和扩散光圈视图
     */
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
