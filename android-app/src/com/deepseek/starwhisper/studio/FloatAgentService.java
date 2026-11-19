package com.deepseek.starwhisper.studio;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 手机端 AI 辅助助理常驻悬浮控制球服务 (Float Agent Controller)
 * 参考 dsh-Go 设计：提供屏幕常驻交互指示与物理级一键急停（Emergency Stop）安全防护。
 */
public class FloatAgentService extends Service {
    private static volatile FloatAgentService sInstance = null;
    public static volatile boolean sEmergencyStopRequested = false;
    public static volatile String sCurrentStatus = "idle"; // idle, thinking, executing, stopped

    private WindowManager windowManager;
    private FrameLayout floatRootView;
    private TextView statusTextView;
    private WindowManager.LayoutParams layoutParams;

    public static boolean isRunning() {
        return sInstance != null;
    }

    public static void updateState(String state, String text) {
        sCurrentStatus = state;
        FloatAgentService instance = sInstance;
        if (instance != null && instance.statusTextView != null) {
            instance.statusTextView.post(new Runnable() {
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
        updateState("idle", "AI 待命");
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
        layoutParams.x = 30;
        layoutParams.y = 260;

        floatRootView = new FrameLayout(this);

        statusTextView = new TextView(this);
        statusTextView.setTextSize(12);
        statusTextView.setTextColor(Color.WHITE);
        statusTextView.setPadding(28, 18, 28, 18);
        applyStatusStyle("idle", "AI 待命");

        floatRootView.addView(statusTextView);

        floatRootView.setOnTouchListener(new View.OnTouchListener() {
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
                        } catch (Exception ignored) {
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        float diffX = Math.abs(event.getRawX() - initialTouchX);
                        float diffY = Math.abs(event.getRawY() - initialTouchY);

                        if (duration < 300 && diffX < 15 && diffY < 15) {
                            handleFloatingClick();
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

    private void handleFloatingClick() {
        if ("thinking".equals(sCurrentStatus) || "executing".equals(sCurrentStatus)) {
            // 如果正在执行自动化动作，点击直接触发物理急停！
            requestStop();
            Toast.makeText(this, "🛑 已触发安全急停：AI 自动化辅助已暂停！", Toast.LENGTH_SHORT).show();
        } else {
            // 如果处于待命状态，点击将主应用调回前台
            try {
                Intent intent = new Intent(this, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(this, "打开星语恋庭失败", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void applyStatusStyle(String state, String text) {
        if (statusTextView == null) return;
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(36);
        shape.setStroke(2, Color.argb(180, 255, 255, 255));

        switch (state) {
            case "thinking":
                shape.setColor(Color.parseColor("#3B82F6")); // 蓝色：思考中
                statusTextView.setText("💭 " + (text != null ? text : "AI 思考中... (点我急停)"));
                break;
            case "executing":
                shape.setColor(Color.parseColor("#F59E0B")); // 橙色：执行动作
                statusTextView.setText("⚡ " + (text != null ? text : "正在操作 (点我急停)"));
                break;
            case "stopped":
                shape.setColor(Color.parseColor("#EF4444")); // 红色：已急停
                statusTextView.setText("🛑 " + (text != null ? text : "已急停"));
                break;
            case "idle":
            default:
                shape.setColor(Color.parseColor("#4D6BFE")); // DeepSeek 品牌蓝紫
                statusTextView.setText("🐋 " + (text != null ? text : "星语 AI 待命"));
                break;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            statusTextView.setBackground(shape);
        } else {
            statusTextView.setBackgroundDrawable(shape);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (floatRootView != null && windowManager != null) {
            try {
                windowManager.removeView(floatRootView);
            } catch (Exception ignored) {
            }
        }
        if (sInstance == this) {
            sInstance = null;
        }
    }
}
