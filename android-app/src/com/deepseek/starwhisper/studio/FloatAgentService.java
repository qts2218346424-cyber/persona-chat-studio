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
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 手机端 AI 辅助助理常驻悬浮控制面板服务 (Float Agent Controller)
 * 支持：
 * 1. 屏幕边缘小巧悬浮胶囊与拖拽吸附；
 * 2. 物理级一键急停（Emergency Stop）安全防护；
 * 3. 展开式微型控制台：支持在悬浮窗上实时打字输入命令（回桌面、下滑、点搜索、打开微信…）；
 * 4. 内置免 API 本地规则执行引擎：无需配置任何 API Key 即可直接操控手机！
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
    private EditText cmdEditText;
    private WindowManager.LayoutParams layoutParams;
    private boolean isExpanded = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static boolean isRunning() {
        return sInstance != null;
    }

    public static void updateState(String state, String text) {
        sCurrentStatus = state;
        FloatAgentService instance = sInstance;
        if (instance != null && instance.statusTextView != null) {
            instance.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    instance.applyStatusStyle(state, text);
                }
            });
        }
    }

    public static void requestStop() {
        sEmergencyStopRequested = true;
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
        layoutParams.x = 24;
        layoutParams.y = 260;

        floatRootView = new FrameLayout(this);

        // 1. 折叠态：myui 深色磨砂悬浮胶囊 + 圆点状态灯 (零 Emoji)
        statusPillView = new LinearLayout(this);
        statusPillView.setOrientation(LinearLayout.HORIZONTAL);
        statusPillView.setGravity(Gravity.CENTER_VERTICAL);
        statusPillView.setPadding(24, 15, 26, 15);

        statusDotView = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(16, 16);
        dotLp.rightMargin = 14;
        statusDotView.setLayoutParams(dotLp);

        statusTextView = new TextView(this);
        statusTextView.setTextSize(12);
        statusTextView.setTextColor(Color.parseColor("#F8FAFC"));

        statusPillView.addView(statusDotView);
        statusPillView.addView(statusTextView);
        applyStatusStyle("idle", "星语 AI");

        // 2. 展开态：实时打字与快捷指令悬浮面板
        expandPanel = buildExpandPanel();
        expandPanel.setVisibility(View.GONE);

        floatRootView.addView(statusPillView);
        floatRootView.addView(expandPanel);

        // 绑定悬浮胶囊的拖拽与点击手势
        statusPillView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private long touchStartTime = 0;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = layoutParams.x;
                        initialY = layoutParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        touchStartTime = System.currentTimeMillis();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        layoutParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                        layoutParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                        try {
                            windowManager.updateViewLayout(floatRootView, layoutParams);
                        } catch (Exception ignored) {}
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        if (duration < 300 && diffX < 15 && diffY < 15) {
                            handleBubbleClick();
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
        int panelWidth = Math.min((int) (dm.widthPixels * 0.92f), 780);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setLayoutParams(new ViewGroup.LayoutParams(panelWidth, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.setPadding(24, 20, 24, 20);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#E60F172A")); // 半透明深色质感
        bg.setCornerRadius(28);
        bg.setStroke(2, Color.parseColor("#4D6BFE"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            panel.setBackground(bg);
        } else {
            panel.setBackgroundDrawable(bg);
        }

        // 顶部标题与收起行
        LinearLayout headRow = new LinearLayout(this);
        headRow.setOrientation(LinearLayout.HORIZONTAL);
        headRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView titleTv = new TextView(this);
        titleTv.setText("星语手机控制台 (AI / 本地)");
        titleTv.setTextColor(Color.parseColor("#93C5FD"));
        titleTv.setTextSize(13);
        titleTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f));

        TextView closeTv = new TextView(this);
        closeTv.setText("收起");
        closeTv.setTextColor(Color.parseColor("#94A3B8"));
        closeTv.setTextSize(12);
        closeTv.setPadding(16, 8, 8, 8);
        closeTv.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collapsePanel();
            }
        });

        headRow.addView(titleTv);
        headRow.addView(closeTv);
        panel.addView(headRow);

        // 中间实时打字输入行
        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, 16, 0, 12);

        cmdEditText = new EditText(this);
        cmdEditText.setHint("输入命令：回桌面/打开微信/下滑/点搜索...");
        cmdEditText.setHintTextColor(Color.parseColor("#64748B"));
        cmdEditText.setTextColor(Color.WHITE);
        cmdEditText.setTextSize(13);
        cmdEditText.setSingleLine(true);
        cmdEditText.setPadding(20, 16, 20, 16);

        GradientDrawable editBg = new GradientDrawable();
        editBg.setColor(Color.parseColor("#261E293B"));
        editBg.setCornerRadius(16);
        editBg.setStroke(1, Color.parseColor("#334155"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            cmdEditText.setBackground(editBg);
        } else {
            cmdEditText.setBackgroundDrawable(editBg);
        }

        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        editLp.rightMargin = 12;
        cmdEditText.setLayoutParams(editLp);

        TextView sendBtn = new TextView(this);
        sendBtn.setText("执行");
        sendBtn.setTextColor(Color.WHITE);
        sendBtn.setTextSize(13);
        sendBtn.setPadding(24, 16, 24, 16);
        GradientDrawable sendBg = new GradientDrawable();
        sendBg.setColor(Color.parseColor("#4D6BFE"));
        sendBg.setCornerRadius(16);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            sendBtn.setBackground(sendBg);
        } else {
            sendBtn.setBackgroundDrawable(sendBg);
        }
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String cmd = cmdEditText.getText() != null ? cmdEditText.getText().toString().trim() : "";
                if (!TextUtils.isEmpty(cmd)) {
                    executeCommandFromFloating(cmd);
                } else {
                    Toast.makeText(FloatAgentService.this, "请输入要执行的手机控制命令", Toast.LENGTH_SHORT).show();
                }
            }
        });

        TextView stopBtn = new TextView(this);
        stopBtn.setText("急停");
        stopBtn.setTextColor(Color.WHITE);
        stopBtn.setTextSize(13);
        stopBtn.setPadding(18, 16, 18, 16);
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopLp.leftMargin = 8;
        stopBtn.setLayoutParams(stopLp);
        GradientDrawable stopBg = new GradientDrawable();
        stopBg.setColor(Color.parseColor("#EF4444"));
        stopBg.setCornerRadius(16);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            stopBtn.setBackground(stopBg);
        } else {
            stopBtn.setBackgroundDrawable(stopBg);
        }
        stopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestStop();
                Toast.makeText(FloatAgentService.this, "已触发安全急停，后续操作已终止", Toast.LENGTH_SHORT).show();
            }
        });

        inputRow.addView(cmdEditText);
        inputRow.addView(sendBtn);
        inputRow.addView(stopBtn);
        panel.addView(inputRow);

        // 底部快捷手势/系统命令横滑栏（零 Emoji）
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);

        LinearLayout chipsRow = new LinearLayout(this);
        chipsRow.setOrientation(LinearLayout.HORIZONTAL);
        chipsRow.setGravity(Gravity.CENTER_VERTICAL);

        addQuickChip(chipsRow, "回星语 AI 规划", "回星语");
        addQuickChip(chipsRow, "回桌面", "回桌面");
        addQuickChip(chipsRow, "返回", "返回");
        addQuickChip(chipsRow, "下滑", "下滑");
        addQuickChip(chipsRow, "上滑", "上滑");
        addQuickChip(chipsRow, "最近任务", "最近任务");
        addQuickChip(chipsRow, "打开微信", "打开微信");
        addQuickChip(chipsRow, "系统设置", "打开设置");

        scroll.addView(chipsRow);
        panel.addView(scroll);

        return panel;
    }

    private void addQuickChip(LinearLayout parent, String label, final String cmd) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextColor(Color.parseColor("#E2E8F0"));
        chip.setTextSize(11);
        chip.setPadding(18, 10, 18, 10);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#331E293B"));
        bg.setCornerRadius(12);
        bg.setStroke(1, Color.parseColor("#475569"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            chip.setBackground(bg);
        } else {
            chip.setBackgroundDrawable(bg);
        }

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = 10;
        chip.setLayoutParams(lp);

        chip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeCommandFromFloating(cmd);
            }
        });
        parent.addView(chip);
    }

    private void handleBubbleClick() {
        if ("thinking".equals(sCurrentStatus) || "executing".equals(sCurrentStatus) || "acting".equals(sCurrentStatus)) {
            // 执行中轻触触发一键急停
            requestStop();
            Toast.makeText(this, "已触发急停，自动化辅助已暂停", Toast.LENGTH_SHORT).show();
        } else {
            // 空闲状态轻触展开打字面板
            expandPanel();
        }
    }

    private void expandPanel() {
        if (isExpanded) return;
        isExpanded = true;
        if (statusPillView != null) statusPillView.setVisibility(View.GONE);
        expandPanel.setVisibility(View.VISIBLE);

        // 允许聚焦以呼出软键盘打字
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        try {
            windowManager.updateViewLayout(floatRootView, layoutParams);
        } catch (Exception ignored) {}

        if (cmdEditText != null) {
            cmdEditText.requestFocus();
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (imm != null && cmdEditText != null) {
                        imm.showSoftInput(cmdEditText, InputMethodManager.SHOW_IMPLICIT);
                    }
                }
            }, 100);
        }
    }

    private void collapsePanel() {
        if (!isExpanded) return;
        isExpanded = false;

        // 收起系统软键盘
        if (cmdEditText != null) {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.hideSoftInputFromWindow(cmdEditText.getWindowToken(), 0);
            }
            cmdEditText.clearFocus();
        }

        expandPanel.setVisibility(View.GONE);
        if (statusPillView != null) statusPillView.setVisibility(View.VISIBLE);

        // 恢复不可聚焦状态，避免拦截底部应用触控
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        try {
            windowManager.updateViewLayout(floatRootView, layoutParams);
        } catch (Exception ignored) {}
    }

    private void executeCommandFromFloating(String cmd) {
        if ("回星语".equals(cmd) || "回星语 AI 规划".equals(cmd)) {
            collapsePanel();
            try {
                Intent intent = new Intent(this, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                startActivity(intent);
            } catch (Exception ignored) {}
            return;
        }

        AgentAccessibilityService a11y = AgentAccessibilityService.getInstance();
        if (a11y == null) {
            Toast.makeText(this, "无障碍服务未开启，请在系统设置中找到「DeepSeek · 星语」开启", Toast.LENGTH_LONG).show();
            collapsePanel();
            try {
                Intent intent = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {}
            return;
        }

        resetStopFlag();
        updateState("executing", "执行: " + cmd);
        collapsePanel(); // 执行时先收起面板以便用户看到屏幕变化

        final String finalCmd = cmd;
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                AgentAccessibilityService service = AgentAccessibilityService.getInstance();
                if (service != null) {
                    String result = service.executeLocalRule(finalCmd);
                    if (result != null && result.startsWith("UNMATCHED:")) {
                        Toast.makeText(FloatAgentService.this, "复杂指令请点「回星语 AI 规划」用大模型自动识屏分解执行", Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(FloatAgentService.this, result, Toast.LENGTH_SHORT).show();
                    }
                    updateState("idle", "星语 AI");
                }
            }
        }, 300);
    }

    private void applyStatusStyle(String state, String text) {
        if (statusTextView == null || statusPillView == null) return;
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(Color.parseColor("#E60F172A"));
        pillBg.setCornerRadius(40);

        GradientDrawable dotShape = new GradientDrawable();
        dotShape.setShape(GradientDrawable.OVAL);

        String displayTxt = (text != null && !text.trim().isEmpty()) ? text.trim() : "星语 AI";
        switch (state) {
            case "thinking":
                pillBg.setStroke(2, Color.parseColor("#4D6BFE"));
                dotShape.setColor(Color.parseColor("#60A5FA"));
                statusTextView.setText(displayTxt);
                break;
            case "executing":
            case "acting":
                pillBg.setStroke(2, Color.parseColor("#F59E0B"));
                dotShape.setColor(Color.parseColor("#F59E0B"));
                statusTextView.setText(displayTxt);
                break;
            case "stopped":
                pillBg.setStroke(2, Color.parseColor("#EF4444"));
                dotShape.setColor(Color.parseColor("#EF4444"));
                statusTextView.setText(displayTxt);
                break;
            case "idle":
            default:
                pillBg.setStroke(2, Color.parseColor("#334155"));
                dotShape.setColor(Color.parseColor("#10B981"));
                statusTextView.setText(displayTxt);
                break;
        }

        if (statusDotView != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                statusDotView.setBackground(dotShape);
            } else {
                statusDotView.setBackgroundDrawable(dotShape);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            statusPillView.setBackground(pillBg);
        } else {
            statusPillView.setBackgroundDrawable(pillBg);
        }
    }

    @Override
    public void onDestroy() {
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
