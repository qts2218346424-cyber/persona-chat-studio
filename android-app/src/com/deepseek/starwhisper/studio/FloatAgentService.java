package com.deepseek.starwhisper.studio;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Vibrator;
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
 * 手机端 AI 辅助助理常驻悬浮控制面板服务 (Float Agent Controller)
 * 1. 折叠态支持拖拽并自动贴边吸附；执行/连刷中轻触胶囊即可物理级一键急停；
 * 2. 展开态提供 4 分类多功能微型工作台：常用系统导航 / 刷视频连刷控制 / 智能打字与短语 / 热门应用与 AI 规划直达；
 * 3. 展开时不强弹软键盘遮挡画面，执行打字或控制前先收起并归还系统输入焦点。
 */
public class FloatAgentService extends Service {
    private static volatile FloatAgentService sInstance = null;
    public static volatile boolean sEmergencyStopRequested = false;
    public static volatile String sCurrentStatus = "idle"; // idle, thinking, executing, stopped

    private WindowManager windowManager;
    private FrameLayout floatRootView;
    private LinearLayout statusPillView;
    private View statusDotView;
    private TextView statusTextView;
    private LinearLayout expandPanel;

    private TextView a11yBadgeView;
    private EditText cmdEditText;
    private EditText typingEditText;
    private TextView feedbackTextView;
    private TextView autoSwipeToggleBtn;

    private final List<TextView> tabButtons = new ArrayList<>();
    private final List<LinearLayout> tabPages = new ArrayList<>();
    private int currentTabIndex = 0;

    // 刷视频连刷参数状态
    private int selectedSwipeIntervalSec = 8;
    private boolean randomLikeEnabled = false;
    private final List<TextView> intervalChipViews = new ArrayList<>();
    private TextView randomLikeChipView;

    private WindowManager.LayoutParams layoutParams;
    private boolean isExpanded = false;
    private int savedPillX = 24;
    private int savedPillY = 260;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private LinearLayout confirmBannerView = null;
    private WindowManager.LayoutParams confirmLayoutParams = null;

    public static boolean isRunning() {
        return sInstance != null;
    }

    public static void showConfirmPrompt(final String summary, final String actionDesc) {
        final FloatAgentService instance = sInstance;
        if (instance != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.displayConfirmBanner(summary, actionDesc);
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
        updateState("idle", "星语 AI");
        MainActivity.dispatchNormalStopToWebView();
    }

    public static void updateState(String state, String text) {
        sCurrentStatus = state;
        final FloatAgentService instance = sInstance;
        if (instance != null && instance.statusTextView != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.applyStatusStyle(state, text);
                    instance.refreshDynamicWidgets();
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
    }

    public static void resetStopFlag() {
        sEmergencyStopRequested = false;
        updateState("idle", "星语 AI");
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
        initFloatingView();
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        ));
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

    private void initFloatingView() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);

        int layoutFlag;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutFlag = WindowManager.LayoutParams.TYPE_PHONE;
        }

        layoutParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutFlag,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );

        layoutParams.gravity = Gravity.TOP | Gravity.START;
        savedPillX = dp(8);
        savedPillY = dp(140);
        layoutParams.x = savedPillX;
        layoutParams.y = savedPillY;

        floatRootView = new FrameLayout(this);

        // 1. 折叠态：深色玻璃悬浮胶囊 + 状态指示灯
        statusPillView = new LinearLayout(this);
        statusPillView.setOrientation(LinearLayout.HORIZONTAL);
        statusPillView.setGravity(Gravity.CENTER_VERTICAL);
        statusPillView.setPadding(dp(11), dp(7), dp(12), dp(7));

        statusDotView = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(8), dp(8));
        dotLp.rightMargin = dp(7);
        statusDotView.setLayoutParams(dotLp);

        statusTextView = new TextView(this);
        statusTextView.setTextSize(12);
        statusTextView.setTextColor(Color.parseColor("#F8FAFC"));

        statusPillView.addView(statusDotView);
        statusPillView.addView(statusTextView);
        applyStatusStyle("idle", "星语 AI");

        // 2. 展开态：4 分类多功能悬浮控制台
        expandPanel = buildExpandPanel();
        expandPanel.setVisibility(View.GONE);

        floatRootView.addView(statusPillView);
        floatRootView.addView(expandPanel);

        // 折叠胶囊拖拽 + 自动贴边 + 轻触控制
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
                            // 拖拽松手后自动左右贴边吸附
                            int pillW = statusPillView.getWidth() > 0 ? statusPillView.getWidth() : dp(90);
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
                        }
                        return true;
                }
                return false;
            }
        });

        try {
            windowManager.addView(floatRootView, layoutParams);
        } catch (Exception e) {
            Toast.makeText(this, "悬浮窗初始化失败，请检查系统悬浮窗权限", Toast.LENGTH_SHORT).show();
        }
    }

    private LinearLayout buildExpandPanel() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(356));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setLayoutParams(new ViewGroup.LayoutParams(panelWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.setPadding(dp(12), dp(10), dp(12), dp(10));
        setViewBg(panel, createRoundRect("#F00F172A", 16, "#4D6BFE", 1));

        // 1. 顶栏：标题 + 无障碍状态微标签 + 回星语 + 收起
        LinearLayout headRow = new LinearLayout(this);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView titleTv = new TextView(this);
        titleTv.setText("星语控制台");
        titleTv.setTextColor(Color.parseColor("#F8FAFC"));
        titleTv.setTextSize(13);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        titleTv.setLayoutParams(titleLp);

        a11yBadgeView = new TextView(this);
        a11yBadgeView.setTextSize(10.5f);
        a11yBadgeView.setPadding(dp(7), dp(3), dp(7), dp(3));
        a11yBadgeView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openAccessibilitySettingsFromFloat();
            }
        });

        TextView homeAppTv = new TextView(this);
        homeAppTv.setText("回星语");
        homeAppTv.setTextColor(Color.parseColor("#93C5FD"));
        homeAppTv.setTextSize(11.5f);
        homeAppTv.setPadding(dp(8), dp(4), dp(8), dp(4));
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
        closeTv.setPadding(dp(8), dp(4), dp(2), dp(4));
        closeTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
            }
        });

        headRow.addView(titleTv);
        headRow.addView(a11yBadgeView);
        headRow.addView(homeAppTv);
        headRow.addView(closeTv);
        panel.addView(headRow);

        // 2. 指令输入框 + 执行 + 急停
        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(8), 0, dp(8));

        cmdEditText = new EditText(this);
        cmdEditText.setHint("口令：打字你好 / 自动刷视频 / 打开微信");
        cmdEditText.setHintTextColor(Color.parseColor("#64748B"));
        cmdEditText.setTextColor(Color.WHITE);
        cmdEditText.setTextSize(12);
        cmdEditText.setSingleLine(true);
        cmdEditText.setImeOptions(EditorInfo.IME_ACTION_GO);
        cmdEditText.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(cmdEditText, createRoundRect("#331E293B", 10, "#334155", 1));
        cmdEditText.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                    String cmd = cmdEditText.getText() != null ? cmdEditText.getText().toString().trim() : "";
                    if (!TextUtils.isEmpty(cmd)) {
                        executeCommandFromFloating(cmd, true);
                    }
                    return true;
                }
                return false;
            }
        });

        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        editLp.rightMargin = dp(6);
        cmdEditText.setLayoutParams(editLp);

        TextView sendBtn = createActionBtn("执行", "#4D6BFE", "#FFFFFF");
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String cmd = cmdEditText.getText() != null ? cmdEditText.getText().toString().trim() : "";
                if (!TextUtils.isEmpty(cmd)) {
                    executeCommandFromFloating(cmd, true);
                } else {
                    Toast.makeText(FloatAgentService.this, "请输入口令或直接点下方快捷功能", Toast.LENGTH_SHORT).show();
                }
            }
        });

        TextView normalStopBtn = createActionBtn("停止", "#334155", "#E2E8F0");
        LinearLayout.LayoutParams normalStopLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        normalStopLp.leftMargin = dp(4);
        normalStopBtn.setLayoutParams(normalStopLp);
        normalStopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestNormalStop();
                showFeedback("已停止当前任务，恢复待命");
                Toast.makeText(FloatAgentService.this, "已停止当前任务，恢复待命", Toast.LENGTH_SHORT).show();
            }
        });

        TextView stopBtn = createActionBtn("急停", "#EF4444", "#FFFFFF");
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopLp.leftMargin = dp(4);
        stopBtn.setLayoutParams(stopLp);
        stopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestStop();
                showFeedback("已急停，所有自动任务已暂停");
                Toast.makeText(FloatAgentService.this, "已触发安全急停", Toast.LENGTH_SHORT).show();
            }
        });

        inputRow.addView(cmdEditText);
        inputRow.addView(sendBtn);
        inputRow.addView(normalStopBtn);
        inputRow.addView(stopBtn);
        panel.addView(inputRow);

        // 3. 4 分类 Tab 分段栏
        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setPadding(dp(3), dp(3), dp(3), dp(3));
        setViewBg(tabBar, createRoundRect("#801E293B", 10, "#334155", 1));
        LinearLayout.LayoutParams tabBarLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tabBarLp.bottomMargin = dp(8);
        tabBar.setLayoutParams(tabBarLp);

        tabButtons.clear();
        tabPages.clear();
        String[] tabNames = new String[]{"常用", "刷视频", "打字", "应用"};
        for (int i = 0; i < tabNames.length; i++) {
            final int idx = i;
            TextView tb = new TextView(this);
            tb.setText(tabNames[i]);
            tb.setGravity(Gravity.CENTER);
            tb.setTextSize(11.5f);
            tb.setPadding(0, dp(6), 0, dp(6));
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
        panel.addView(tabBar);

        // 4. 四个分类内容页
        LinearLayout pageCommon = buildCommonTabPage();
        LinearLayout pageVideo = buildVideoTabPage();
        LinearLayout pageTyping = buildTypingTabPage();
        LinearLayout pageApps = buildAppsTabPage();

        tabPages.add(pageCommon);
        tabPages.add(pageVideo);
        tabPages.add(pageTyping);
        tabPages.add(pageApps);

        panel.addView(pageCommon);
        panel.addView(pageVideo);
        panel.addView(pageTyping);
        panel.addView(pageApps);

        switchTab(0);

        // 5. 底部执行回执条
        feedbackTextView = new TextView(this);
        feedbackTextView.setText("点击上方分栏可直控手机、连刷视频或智能代打字");
        feedbackTextView.setTextColor(Color.parseColor("#94A3B8"));
        feedbackTextView.setTextSize(10.5f);
        feedbackTextView.setPadding(dp(4), dp(6), dp(4), dp(0));
        feedbackTextView.setMaxLines(2);
        feedbackTextView.setEllipsize(TextUtils.TruncateAt.END);
        panel.addView(feedbackTextView);

        refreshDynamicWidgets();
        return panel;
    }

    private LinearLayout buildCommonTabPage() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);

        page.addView(buildGridRow(
                new String[]{"回桌面", "返回", "最近任务", "切上个App"},
                new String[]{"回桌面", "返回", "最近任务", "切回上个应用"},
                true
        ));
        page.addView(buildGridRow(
                new String[]{"截屏", "通知栏", "控制中心", "锁屏"},
                new String[]{"截屏", "通知", "控制中心", "锁屏"},
                true
        ));

        // 滑动手势与音量控制横滑条
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout strip = new LinearLayout(this);
        strip.setOrientation(LinearLayout.HORIZONTAL);
        strip.setPadding(0, dp(2), 0, dp(2));

        String[][] extras = new String[][]{
                {"下滑", "下滑"},
                {"上滑", "上滑"},
                {"回顶部", "回到顶部"},
                {"滑到底", "滑到底部"},
                {"音量+", "音量加"},
                {"音量-", "音量减"},
                {"静音", "静音"},
                {"读屏幕", "读屏幕"}
        };
        for (final String[] item : extras) {
            TextView chip = createChip(item[0]);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    boolean keepPanel = "音量+".equals(item[0]) || "音量-".equals(item[0]) || "静音".equals(item[0]) || "读屏幕".equals(item[0]);
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

        // 单步视频手势 2x3
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

        // 连刷间隔与随机点赞参数条
        LinearLayout cfgRow = new LinearLayout(this);
        cfgRow.setOrientation(LinearLayout.HORIZONTAL);
        cfgRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams cfgLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cfgLp.topMargin = dp(2);
        cfgLp.bottomMargin = dp(6);
        cfgRow.setLayoutParams(cfgLp);

        TextView lbl = new TextView(this);
        lbl.setText("连刷间隔:");
        lbl.setTextColor(Color.parseColor("#94A3B8"));
        lbl.setTextSize(10.5f);
        lbl.setPadding(0, 0, dp(5), 0);
        cfgRow.addView(lbl);

        intervalChipViews.clear();
        final int[] secs = new int[]{5, 8, 12, 20};
        for (final int s : secs) {
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
        randomLikeChipView.setText("随机点赞");
        randomLikeChipView.setTextSize(10.5f);
        randomLikeChipView.setPadding(dp(8), dp(4), dp(8), dp(4));
        LinearLayout.LayoutParams rlLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rlLp.leftMargin = dp(4);
        randomLikeChipView.setLayoutParams(rlLp);
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

        // 主控条：开始/停止自动刷 + 刷抖音 + 刷快手
        LinearLayout ctrlRow = new LinearLayout(this);
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        ctrlRow.setGravity(Gravity.CENTER_VERTICAL);

        autoSwipeToggleBtn = createActionBtn("开始自动刷", "#4D6BFE", "#FFFFFF");
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
                    updateState("idle", "星语 AI");
                    showFeedback("已停止自动刷视频");
                    Toast.makeText(FloatAgentService.this, "已停止自动刷视频", Toast.LENGTH_SHORT).show();
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
                String cmd = "打开抖音自动刷25个视频每" + selectedSwipeIntervalSec + "秒" + (randomLikeEnabled ? "并点赞" : "");
                executeCommandFromFloating(cmd, true);
            }
        });

        TextView ksBtn = createActionBtn("刷快手", "#1E293B", "#E2E8F0");
        ksBtn.setGravity(Gravity.CENTER);
        ksBtn.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.85f));
        ksBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String cmd = "打开快手自动刷25个视频每" + selectedSwipeIntervalSec + "秒" + (randomLikeEnabled ? "并点赞" : "");
                executeCommandFromFloating(cmd, true);
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

        typingEditText = new EditText(this);
        typingEditText.setHint("输入要填入底层输入框的文字（点按钮即自动填字）");
        typingEditText.setHintTextColor(Color.parseColor("#64748B"));
        typingEditText.setTextColor(Color.WHITE);
        typingEditText.setTextSize(12);
        typingEditText.setSingleLine(true);
        typingEditText.setImeOptions(EditorInfo.IME_ACTION_SEND);
        typingEditText.setPadding(dp(10), dp(7), dp(10), dp(7));
        setViewBg(typingEditText, createRoundRect("#331E293B", 10, "#334155", 1));
        LinearLayout.LayoutParams edLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        edLp.bottomMargin = dp(6);
        typingEditText.setLayoutParams(edLp);
        typingEditText.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEND || actionId == EditorInfo.IME_ACTION_DONE) {
                    triggerSmartTypingFromPanel(false, true);
                    return true;
                }
                return false;
            }
        });
        page.addView(typingEditText);

        // 5 个打字操作按钮
        LinearLayout actRow = new LinearLayout(this);
        actRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actLp.bottomMargin = dp(6);
        actRow.setLayoutParams(actLp);

        TextView fillBtn = createGridBtn("直接输入");
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

        TextView appendBtn = createGridBtn("追加");
        appendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerSmartTypingFromPanel(true, false);
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
        pasteBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating("粘贴", true);
            }
        });

        actRow.addView(fillBtn);
        actRow.addView(sendBtn);
        actRow.addView(appendBtn);
        actRow.addView(clearBtn);
        actRow.addView(pasteBtn);
        page.addView(actRow);

        // 常用快捷短语流
        HorizontalScrollView phraseScroll = new HorizontalScrollView(this);
        phraseScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout phraseRow = new LinearLayout(this);
        phraseRow.setOrientation(LinearLayout.HORIZONTAL);

        final String[] phrases = new String[]{
                "好的，收到！",
                "稍等一下，马上回复",
                "哈哈哈哈太有意思了",
                "赞一个！",
                "在忙，晚点联系",
                "谢谢！"
        };
        for (final String p : phrases) {
            TextView chip = createChip(p);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    executeCommandFromFloating("输入 " + p, true);
                }
            });
            phraseRow.addView(chip);
        }
        phraseScroll.addView(phraseRow);
        page.addView(phraseScroll);
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
                new String[]{"B站", "淘宝", "支付宝", "高德地图"},
                new String[]{"打开B站", "打开淘宝", "打开支付宝", "打开高德地图"},
                true
        ));
        page.addView(buildGridRow(
                new String[]{"网易云", "QQ", "美团", "系统设置"},
                new String[]{"打开网易云", "打开QQ", "打开美团", "打开设置"},
                true
        ));

        TextView aiPlanBtn = createActionBtn("将输入框复杂任务交给星语 AI 规划执行", "#1E3A8A", "#BFDBFE");
        aiPlanBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams aiLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        aiLp.topMargin = dp(2);
        aiPlanBtn.setLayoutParams(aiLp);
        aiPlanBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String task = cmdEditText != null && cmdEditText.getText() != null
                        ? cmdEditText.getText().toString().trim()
                        : "";
                bringMainActivityToFront(task);
            }
        });
        page.addView(aiPlanBtn);
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
        setViewBg(btn, createRoundRect("#331E293B", 8, "#334155", 1));
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
        setViewBg(chip, createRoundRect("#331E293B", 12, "#475569", 1));
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
            setViewBg(iv, createRoundRect(active ? "#4D6BFE" : "#331E293B", 8, active ? "#4D6BFE" : "#475569", 1));
        }
        if (randomLikeChipView != null) {
            randomLikeChipView.setTextColor(Color.parseColor(randomLikeEnabled ? "#FDE68A" : "#94A3B8"));
            setViewBg(randomLikeChipView, createRoundRect(
                    randomLikeEnabled ? "#451A03" : "#331E293B",
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
            autoSwipeToggleBtn.setText(swiping ? "停止自动刷" : "开始自动刷");
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

        // 延迟 420ms 等待悬浮软键盘彻底退出、底层应用输入框重新拿到窗口焦点
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
                    updateState("idle", "星语 AI");
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

    private void handleBubbleClick() {
        if ("confirming".equals(sCurrentStatus)) {
            if (confirmBannerView == null) {
                displayConfirmBanner("即将执行高风险操作，请确认", null);
            }
            return;
        }
        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        boolean swiping = (a11y != null && a11y.isAutoSwipeRunning());
        if (swiping || "thinking".equals(sCurrentStatus) || "executing".equals(sCurrentStatus) || "acting".equals(sCurrentStatus)) {
            requestNormalStop();
            Toast.makeText(this, "已停止当前任务，恢复待命", Toast.LENGTH_SHORT).show();
        } else {
            expandPanel();
        }
    }

    private void expandPanel() {
        if (isExpanded) return;
        isExpanded = true;
        savedPillX = layoutParams.x;
        savedPillY = layoutParams.y;

        if (statusPillView != null) statusPillView.setVisibility(View.GONE);
        expandPanel.setVisibility(View.VISIBLE);
        refreshDynamicWidgets();

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), dp(356));
        layoutParams.x = Math.max(dp(8), (dm.widthPixels - panelWidth) / 2);
        layoutParams.y = Math.max(dp(48), Math.min(savedPillY, dm.heightPixels / 3));
        // 允许按需点击输入框时呼出软键盘，但展开瞬间不主动弹出以免挡屏
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
        if ("回星语".equals(cmd) || "回星语 AI 规划".equals(cmd)) {
            bringMainActivityToFront(null);
            return;
        }

        AgentAccessibilityService a11y = ensureA11yReady();
        if (a11y == null) return;

        resetStopFlag();
        updateState("executing", "执行: " + cmd);
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
                    if (result != null && result.startsWith("UNMATCHED:")) {
                        showFeedback(result);
                        Toast.makeText(FloatAgentService.this, "复杂口令可点「应用 → 交给星语 AI 规划」执行", Toast.LENGTH_LONG).show();
                    } else {
                        showFeedback(result);
                        Toast.makeText(FloatAgentService.this, result, Toast.LENGTH_SHORT).show();
                    }
                    if (!service.isAutoSwipeRunning()) {
                        updateState("idle", "星语 AI");
                    } else {
                        refreshDynamicWidgets();
                    }
                }
            }
        }, delayMs);
    }

    private void applyStatusStyle(String state, String text) {
        if (statusTextView == null || statusPillView == null) return;
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(Color.parseColor("#E60F172A"));
        pillBg.setCornerRadius(dp(20));

        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);

        String displayTxt = (text != null && !text.trim().isEmpty()) ? text.trim() : "星语 AI";
        switch (state) {
            case "confirming":
                pillBg.setStroke(dp(2), Color.parseColor("#F59E0B"));
                pillBg.setColor(Color.parseColor("#E6451A03"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#FDE68A"));
                break;
            case "thinking":
                pillBg.setStroke(dp(1), Color.parseColor("#4D6BFE"));
                dotShape.setColor(Color.parseColor("#60A5FA"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                break;
            case "executing":
            case "acting":
                pillBg.setStroke(dp(1), Color.parseColor("#F59E0B"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                break;
            case "stopped":
                pillBg.setStroke(dp(1), Color.parseColor("#EF4444"));
                dotShape.setColor(Color.parseColor("#EF4444"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                break;
            case "idle":
            default:
                pillBg.setStroke(dp(1), Color.parseColor("#334155"));
                dotShape.setColor(Color.parseColor("#10B981"));
                statusTextView.setText(displayTxt);
                statusTextView.setTextColor(Color.parseColor("#F8FAFC"));
                break;
        }

        if (statusDotView != null) {
            setViewBg(statusDotView, dotShape);
        }
        setViewBg(statusPillView, pillBg);
    }

    private void displayConfirmBanner(String summary, String actionDesc) {
        if (windowManager == null) return;
        hideConfirmBanner();

        applyStatusStyle("confirming", "⚠️ 需确认: " + (summary != null ? summary : "高风险操作"));

        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(220);
            }
        } catch (Exception ignored) {}

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int bannerWidth = Math.min((int) (dm.widthPixels * 0.94f), dp(360));

        confirmBannerView = new LinearLayout(this);
        confirmBannerView.setOrientation(LinearLayout.VERTICAL);
        confirmBannerView.setPadding(dp(14), dp(12), dp(14), dp(12));
        setViewBg(confirmBannerView, createRoundRect("#F20F172A", 16, "#F59E0B", 2));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView iconTv = new TextView(this);
        iconTv.setText("⚠️");
        iconTv.setTextSize(14);
        iconTv.setPadding(0, 0, dp(6), 0);

        TextView titleTv = new TextView(this);
        titleTv.setText("星语手机辅助 · 安全执行确认");
        titleTv.setTextColor(Color.parseColor("#FDE68A"));
        titleTv.setTextSize(13);
        titleTv.setTypeface(null, android.graphics.Typeface.BOLD);

        titleRow.addView(iconTv);
        titleRow.addView(titleTv);
        confirmBannerView.addView(titleRow);

        TextView sumTv = new TextView(this);
        sumTv.setText(summary != null ? summary : "执行下一步操作");
        sumTv.setTextColor(Color.WHITE);
        sumTv.setTextSize(12.5f);
        sumTv.setPadding(0, dp(6), 0, dp(2));
        confirmBannerView.addView(sumTv);

        if (actionDesc != null && !actionDesc.trim().isEmpty()) {
            TextView codeTv = new TextView(this);
            codeTv.setText("指令: " + actionDesc.trim());
            codeTv.setTextColor(Color.parseColor("#94A3B8"));
            codeTv.setTextSize(11);
            codeTv.setPadding(0, 0, 0, dp(8));
            confirmBannerView.addView(codeTv);
        }

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView allowBtn = createActionBtn("允许本次", "#10B981", "#FFFFFF");
        allowBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams allowLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.2f);
        allowLp.rightMargin = dp(6);
        allowBtn.setLayoutParams(allowLp);
        allowBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideConfirmBanner();
                updateState("executing", "已确认执行...");
                MainActivity.dispatchConfirmDecisionToWebView("allow");
            }
        });

        TextView cancelBtn = createActionBtn("取消", "#334155", "#E2E8F0");
        cancelBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams cancelLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.9f);
        cancelLp.rightMargin = dp(6);
        cancelBtn.setLayoutParams(cancelLp);
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideConfirmBanner();
                updateState("idle", "星语 AI");
                MainActivity.dispatchConfirmDecisionToWebView("cancel");
            }
        });

        TextView backAppBtn = createActionBtn("回星语", "#1E293B", "#93C5FD");
        backAppBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.9f);
        backAppBtn.setLayoutParams(backLp);
        backAppBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bringMainActivityToFront(null);
            }
        });

        btnRow.addView(allowBtn);
        btnRow.addView(cancelBtn);
        btnRow.addView(backAppBtn);
        confirmBannerView.addView(btnRow);

        int layoutFlag;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutFlag = WindowManager.LayoutParams.TYPE_PHONE;
        }
        confirmLayoutParams = new WindowManager.LayoutParams(
                bannerWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutFlag,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );
        confirmLayoutParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        confirmLayoutParams.y = dp(75);

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

    @Override
    public void onDestroy() {
        hideConfirmBanner();
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
}
