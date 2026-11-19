package com.deepseek.starwhisper.studio;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
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
     * 免 API 本地规则执行引擎：无需配置 API Key 即可直接操控手机
     * 支持全局系统键（回桌面/返回/最近任务/通知栏）、滑动手势、文字搜索点击、应用唤起与文字填入
     */
    public String executeLocalRule(String rawCmd) {
        if (rawCmd == null || rawCmd.trim().isEmpty()) {
            return "请输入命令";
        }
        String cmd = rawCmd.trim().toLowerCase();
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;

        // 1. 系统全局键
        if (cmd.contains("桌面") || cmd.contains("主屏") || cmd.equals("home")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_HOME);
            return ok ? "✅ 已返回桌面" : "❌ 返回桌面失败";
        }
        if (cmd.contains("返回") || cmd.contains("后退") || cmd.equals("back")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_BACK);
            return ok ? "✅ 已执行返回键" : "❌ 返回键执行失败";
        }
        if (cmd.contains("任务") || cmd.contains("后台") || cmd.contains("最近") || cmd.equals("recents")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_RECENTS);
            return ok ? "✅ 已呼出多任务后台" : "❌ 呼出后台失败";
        }
        if (cmd.contains("通知") || cmd.equals("notifications")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            return ok ? "✅ 已下拉通知栏" : "❌ 下拉通知栏失败";
        }

        // 2. 模拟滑动手势
        if (cmd.contains("下滑") || cmd.contains("向下") || cmd.contains("下翻") || cmd.contains("翻下") || cmd.contains("看下面")) {
            boolean ok = performSwipe(width / 2, (int) (height * 0.72), width / 2, (int) (height * 0.28), 350);
            return ok ? "✅ 已向下翻页" : "❌ 滑动失败";
        }
        if (cmd.contains("上滑") || cmd.contains("向上") || cmd.contains("上翻") || cmd.contains("翻上") || cmd.contains("看上面")) {
            boolean ok = performSwipe(width / 2, (int) (height * 0.28), width / 2, (int) (height * 0.72), 350);
            return ok ? "✅ 已向上翻页" : "❌ 滑动失败";
        }
        if (cmd.contains("左滑") || cmd.contains("向左")) {
            boolean ok = performSwipe((int) (width * 0.8), height / 2, (int) (width * 0.2), height / 2, 350);
            return ok ? "✅ 已向左滑动" : "❌ 滑动失败";
        }
        if (cmd.contains("右滑") || cmd.contains("向右")) {
            boolean ok = performSwipe((int) (width * 0.2), height / 2, (int) (width * 0.8), height / 2, 350);
            return ok ? "✅ 已向右滑动" : "❌ 滑动失败";
        }

        // 3. 打开应用
        if (cmd.contains("微信")) {
            try {
                Intent launchIntent = getPackageManager().getLaunchIntentForPackage("com.tencent.mm");
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launchIntent);
                    return "✅ 已唤起微信";
                }
            } catch (Exception ignored) {}
        }
        if (cmd.contains("设置")) {
            try {
                Intent intent = new Intent(android.provider.Settings.ACTION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return "✅ 已打开系统设置";
            } catch (Exception ignored) {}
        }

        // 4. 文字输入匹配: "输入 xxx" / "填入 xxx"
        if (cmd.startsWith("输入") || cmd.startsWith("填入") || cmd.startsWith("打字")) {
            String textToInput = rawCmd.replaceFirst("^(输入|填入|打字)\\s*", "").trim();
            boolean ok = performInputText(null, textToInput);
            return ok ? "✅ 已在输入框填入「" + textToInput + "」" : "⚠️ 当前屏幕未找到处于焦点或可编辑的输入框";
        }

        // 5. 点击文字匹配: "点击 xxx" / "点 xxx" / "按下 xxx"
        String targetText = rawCmd;
        if (targetText.startsWith("点击")) targetText = targetText.substring(2).trim();
        else if (targetText.startsWith("点")) targetText = targetText.substring(1).trim();
        else if (targetText.startsWith("按下")) targetText = targetText.substring(2).trim();

        if (!targetText.isEmpty()) {
            boolean clickOk = clickNodeByText(targetText);
            if (clickOk) {
                return "✅ 已成功定位并点击屏幕文字「" + targetText + "」";
            }
        }

        return "⚠️ 本地规则未匹配到动作。支持命令：回桌面、返回、下滑、上滑、打开微信、打开设置、点击[文字]、输入[文字]";
    }

    public boolean clickNodeByText(String targetText) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        List<AccessibilityNodeInfo> list = root.findAccessibilityNodeInfosByText(targetText);
        if (list != null && !list.isEmpty()) {
            for (AccessibilityNodeInfo node : list) {
                if (node != null) {
                    Rect bounds = new Rect();
                    node.getBoundsInScreen(bounds);
                    if (bounds.width() > 0 && bounds.height() > 0) {
                        int cx = bounds.centerX();
                        int cy = bounds.centerY();
                        boolean ok = performClickCoordinate(cx, cy);
                        node.recycle();
                        root.recycle();
                        return ok;
                    }
                    node.recycle();
                }
            }
        }

        AccessibilityNodeInfo fuzzyNode = findFuzzyNode(root, targetText.toLowerCase());
        if (fuzzyNode != null) {
            Rect bounds = new Rect();
            fuzzyNode.getBoundsInScreen(bounds);
            int cx = bounds.centerX();
            int cy = bounds.centerY();
            boolean ok = performClickCoordinate(cx, cy);
            fuzzyNode.recycle();
            root.recycle();
            return ok;
        }

        root.recycle();
        return false;
    }

    private AccessibilityNodeInfo findFuzzyNode(AccessibilityNodeInfo node, String query) {
        if (node == null) return null;
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        if (text != null && text.toString().toLowerCase().contains(query)) {
            return node;
        }
        if (desc != null && desc.toString().toLowerCase().contains(query)) {
            return node;
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            AccessibilityNodeInfo match = findFuzzyNode(child, query);
            if (match != null) {
                return match;
            }
            if (child != null) child.recycle();
        }
        return null;
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
