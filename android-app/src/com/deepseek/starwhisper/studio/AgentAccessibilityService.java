package com.deepseek.starwhisper.studio;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 星语恋庭 × DeepSeek 手机端 AI 辅助助理无障碍服务 (Phone Agent Service)
 * 参考 dsh-Go 架构：在用户明确授权与下达指令的前提下，负责屏幕感知与辅助模拟操作。
 */
public class AgentAccessibilityService extends AccessibilityService {
    private static final String TAG = "AgentAccessibility";
    private static volatile AgentAccessibilityService sInstance = null;
    private final AtomicInteger nodeCounter = new AtomicInteger(1);

    public static AgentAccessibilityService getInstance() {
        return sInstance;
    }

    public static boolean isRunning() {
        return sInstance != null;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        sInstance = this;
        Log.i(TAG, "AgentAccessibilityService 已成功连接并在前台就绪");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 保持事件流监听，必要时可用于捕捉窗口切换
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "AgentAccessibilityService 被系统中断");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (sInstance == this) {
            sInstance = null;
        }
        Log.i(TAG, "AgentAccessibilityService 已销毁");
    }

    /**
     * 抓取当前活动窗口的 UI 节点树并序列化为 JSON 字符串
     * @param clickableOnly 是否仅保留可交互/有文字的重要节点（大幅降低大模型 Token 消耗）
     */
    public String dumpScreenHierarchy(boolean clickableOnly) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return "{\"error\":\"无法获取当前屏幕根节点（请确认屏幕未锁定或当前应用允许无障碍读取）\",\"nodes\":[]}";
        }

        nodeCounter.set(1);
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        
        CharSequence pkgName = root.getPackageName();
        sb.append("\"packageName\":\"").append(escapeJson(pkgName != null ? pkgName.toString() : "")).append("\",");
        sb.append("\"nodes\":[");

        List<String> nodeJsonList = new ArrayList<>();
        traverseNode(root, clickableOnly, nodeJsonList);
        for (int i = 0; i < nodeJsonList.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(nodeJsonList.get(i));
        }

        sb.append("]}");
        root.recycle();
        return sb.toString();
    }

    private void traverseNode(AccessibilityNodeInfo node, boolean clickableOnly, List<String> result) {
        if (node == null) return;

        boolean isClickable = node.isClickable();
        boolean isEditable = node.isEditable();
        boolean isCheckable = node.isCheckable();
        boolean isScrollable = node.isScrollable();
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        String viewId = node.getViewIdResourceName();

        boolean hasContent = (text != null && text.length() > 0) || (desc != null && desc.length() > 0);
        boolean isInteractive = isClickable || isEditable || isCheckable || isScrollable;

        boolean shouldKeep = !clickableOnly || isInteractive || hasContent;

        if (shouldKeep) {
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);

            // 过滤完全位于屏幕外的异常节点
            if (bounds.width() > 0 && bounds.height() > 0) {
                int id = nodeCounter.getAndIncrement();
                int centerX = bounds.centerX();
                int centerY = bounds.centerY();

                StringBuilder nodeSb = new StringBuilder();
                nodeSb.append("{");
                nodeSb.append("\"id\":").append(id).append(",");
                nodeSb.append("\"text\":\"").append(escapeJson(text != null ? text.toString() : "")).append("\",");
                nodeSb.append("\"desc\":\"").append(escapeJson(desc != null ? desc.toString() : "")).append("\",");
                nodeSb.append("\"viewId\":\"").append(escapeJson(viewId != null ? viewId : "")).append("\",");
                CharSequence cls = node.getClassName();
                nodeSb.append("\"className\":\"").append(escapeJson(cls != null ? cls.toString() : "")).append("\",");
                nodeSb.append("\"bounds\":[").append(bounds.left).append(",").append(bounds.top).append(",").append(bounds.right).append(",").append(bounds.bottom).append("],");
                nodeSb.append("\"center\":[").append(centerX).append(",").append(centerY).append("],");
                nodeSb.append("\"clickable\":").append(isClickable).append(",");
                nodeSb.append("\"editable\":").append(isEditable).append(",");
                nodeSb.append("\"checkable\":").append(isCheckable).append(",");
                nodeSb.append("\"scrollable\":").append(isScrollable);
                nodeSb.append("}");

                result.add(nodeSb.toString());
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                traverseNode(child, clickableOnly, result);
                child.recycle();
            }
        }
    }

    /**
     * 模拟单点坐标触摸点击 (通过 Android 原生手势分发)
     */
    public boolean performClickCoordinate(int x, int y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 50));
        return dispatchGesture(builder.build(), null, null);
    }

    /**
     * 模拟线性滑动操作 (例如向下滚动、向上翻页)
     */
    public boolean performSwipe(int startX, int startY, int endX, int endY, int durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        int dur = Math.max(100, Math.min(durationMs, 2000));
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
        return dispatchGesture(builder.build(), null, null);
    }

    /**
     * 查找当前屏幕处于编辑状态或指定 ID 的控件并自动填充文本
     */
    public boolean performInputText(String viewId, String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        AccessibilityNodeInfo target = null;
        if (viewId != null && !viewId.trim().isEmpty()) {
            List<AccessibilityNodeInfo> list = root.findAccessibilityNodeInfosByViewId(viewId.trim());
            if (list != null && !list.isEmpty()) {
                target = list.get(0);
            }
        }

        if (target == null) {
            target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        }

        if (target != null) {
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text != null ? text : "");
            boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
            target.recycle();
            root.recycle();
            return ok;
        }

        root.recycle();
        return false;
    }

    /**
     * 执行系统级全局动作（返回、桌面、最近任务、通知栏）
     */
    public boolean performGlobal(String actionType) {
        if (actionType == null) return false;
        String act = actionType.trim().toLowerCase();
        switch (act) {
            case "back":
                return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home":
                return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents":
                return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notifications":
                return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            default:
                return false;
        }
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < ' ') {
                        String t = "000" + Integer.toHexString(c);
                        sb.append("\\u").append(t.substring(t.length() - 4));
                    } else {
                        sb.append(c);
                    }
                    break;
            }
        }
        return sb.toString();
    }
}
