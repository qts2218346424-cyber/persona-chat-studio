package com.deepseek.starwhisper.studio;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
     * 模拟单点长按操作 (用于唤起菜单或长按语音/收藏)
     */
    public boolean performLongClickCoordinate(int x, int y, int durationMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        int dur = Math.max(450, Math.min(durationMs, 2500));
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
        return dispatchGesture(builder.build(), null, null);
    }

    public String getScreenSizeJson() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return "{\"width\":" + dm.widthPixels + ",\"height\":" + dm.heightPixels + "}";
    }

    public String listInstalledAppsJson() {
        PackageManager pm = getPackageManager();
        Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
        mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(mainIntent, 0);
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        int count = 0;
        if (apps != null) {
            for (ResolveInfo info : apps) {
                if (count >= 100) break;
                String label = info.loadLabel(pm) != null ? info.loadLabel(pm).toString() : "";
                String pkg = info.activityInfo != null ? info.activityInfo.packageName : "";
                if (!label.isEmpty() && !pkg.isEmpty()) {
                    if (!first) sb.append(",");
                    sb.append("{\"name\":\"").append(escapeJson(label))
                      .append("\",\"package\":\"").append(escapeJson(pkg)).append("\"}");
                    first = false;
                    count++;
                }
            }
        }
        sb.append("]");
        return sb.toString();
    }

    public boolean launchAppByName(String appName) {
        if (appName == null || appName.trim().isEmpty()) return false;
        String clean = appName.trim().toLowerCase(Locale.ROOT);
        if ("设置".equals(clean) || "系统设置".equals(clean) || "settings".equals(clean)) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception ignored) {}
        }

        Map<String, String> aliasPkg = new HashMap<>();
        aliasPkg.put("微信", "com.tencent.mm");
        aliasPkg.put("wechat", "com.tencent.mm");
        aliasPkg.put("qq", "com.tencent.mobileqq");
        aliasPkg.put("支付宝", "com.eg.android.AlipayGphone");
        aliasPkg.put("alipay", "com.eg.android.AlipayGphone");
        aliasPkg.put("淘宝", "com.taobao.taobao");
        aliasPkg.put("京东", "com.jingdong.app.mall");
        aliasPkg.put("美团", "com.sankuai.meituan");
        aliasPkg.put("抖音", "com.ss.android.ugc.aweme");
        aliasPkg.put("快手", "com.smile.gifmaker");
        aliasPkg.put("小红书", "com.xingin.xhs");
        aliasPkg.put("b站", "tv.danmaku.bili");
        aliasPkg.put("哔哩哔哩", "tv.danmaku.bili");
        aliasPkg.put("bilibili", "tv.danmaku.bili");
        aliasPkg.put("高德", "com.autonavi.minimap");
        aliasPkg.put("高德地图", "com.autonavi.minimap");
        aliasPkg.put("百度地图", "com.baidu.BaiduMap");
        aliasPkg.put("网易云音乐", "com.netease.cloudmusic");
        aliasPkg.put("网易云", "com.netease.cloudmusic");
        aliasPkg.put("qq音乐", "com.tencent.qqmusic");
        aliasPkg.put("拼多多", "com.xunmeng.pinduoduo");
        aliasPkg.put("deepseek", "com.deepseek.chat");

        PackageManager pm = getPackageManager();
        for (Map.Entry<String, String> entry : aliasPkg.entrySet()) {
            if (clean.contains(entry.getKey())) {
                try {
                    Intent li = pm.getLaunchIntentForPackage(entry.getValue());
                    if (li != null) {
                        li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(li);
                        return true;
                    }
                } catch (Exception ignored) {}
            }
        }

        // 动态匹配手机里所有已安装桌面应用名称
        Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
        mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(mainIntent, 0);
        String matchedPkg = null;
        if (apps != null) {
            for (ResolveInfo info : apps) {
                String label = info.loadLabel(pm) != null ? info.loadLabel(pm).toString().toLowerCase(Locale.ROOT) : "";
                String pkg = info.activityInfo != null ? info.activityInfo.packageName : "";
                if (label.equals(clean)) {
                    matchedPkg = pkg;
                    break;
                }
                if (matchedPkg == null && (!label.isEmpty() && (label.contains(clean) || clean.contains(label)))) {
                    matchedPkg = pkg;
                }
            }
        }
        if (matchedPkg != null) {
            try {
                Intent li = pm.getLaunchIntentForPackage(matchedPkg);
                if (li != null) {
                    li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(li);
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return false;
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
     * 免 API 本地规则执行引擎：无需配置 API Key 即可直接操控手机（零 Emoji 输出）
     * 支持全局系统键、滑动手势、任意已安装应用唤起、文字搜索点击与输入框填入
     */
    public String executeLocalRule(String rawCmd) {
        if (rawCmd == null || rawCmd.trim().isEmpty()) {
            return "请输入命令";
        }
        String trimmedRaw = rawCmd.trim();
        String cmd = trimmedRaw.toLowerCase(Locale.ROOT);
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;

        // 1. 系统全局键
        if (cmd.contains("桌面") || cmd.contains("主屏") || cmd.equals("home")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_HOME);
            return ok ? "已返回手机桌面" : "返回桌面失败";
        }
        if (cmd.contains("返回") || cmd.contains("后退") || cmd.equals("back")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_BACK);
            return ok ? "已执行系统返回键" : "返回键执行失败";
        }
        if (cmd.contains("任务") || cmd.contains("后台") || cmd.contains("最近") || cmd.equals("recents")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_RECENTS);
            return ok ? "已呼出多任务后台" : "呼出后台失败";
        }
        if (cmd.contains("通知") || cmd.equals("notifications")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            return ok ? "已下拉通知栏" : "下拉通知栏失败";
        }

        // 2. 模拟滑动手势
        if (cmd.contains("下滑") || cmd.contains("向下") || cmd.contains("下翻") || cmd.contains("翻下") || cmd.contains("看下面")) {
            boolean ok = performSwipe(width / 2, (int) (height * 0.72), width / 2, (int) (height * 0.28), 350);
            return ok ? "已向下翻页浏览" : "向下滑动失败";
        }
        if (cmd.contains("上滑") || cmd.contains("向上") || cmd.contains("上翻") || cmd.contains("翻上") || cmd.contains("看上面")) {
            boolean ok = performSwipe(width / 2, (int) (height * 0.28), width / 2, (int) (height * 0.72), 350);
            return ok ? "已向上翻页浏览" : "向上滑动失败";
        }
        if (cmd.contains("左滑") || cmd.contains("向左")) {
            boolean ok = performSwipe((int) (width * 0.8), height / 2, (int) (width * 0.2), height / 2, 350);
            return ok ? "已向左滑动" : "向左滑动失败";
        }
        if (cmd.contains("右滑") || cmd.contains("向右")) {
            boolean ok = performSwipe((int) (width * 0.2), height / 2, (int) (width * 0.8), height / 2, 350);
            return ok ? "已向右滑动" : "向右滑动失败";
        }

        // 3. 动态打开任意已安装应用 ("打开 微信" / "启动 支付宝" / "打开设置")
        if (cmd.startsWith("打开") || cmd.startsWith("启动") || cmd.startsWith("进入") || cmd.startsWith("运行") || cmd.equals("微信") || cmd.equals("设置")) {
            String targetApp = trimmedRaw.replaceFirst("^(打开|启动|进入|运行)\\s*", "").trim();
            if (!targetApp.isEmpty() && launchAppByName(targetApp)) {
                return "已打开应用「" + targetApp + "」";
            }
        }

        // 4. 文字输入匹配: "输入 xxx" / "填入 xxx"
        if (cmd.startsWith("输入") || cmd.startsWith("填入") || cmd.startsWith("打字")) {
            String textToInput = trimmedRaw.replaceFirst("^(输入|填入|打字)\\s*", "").trim();
            boolean ok = performInputText(null, textToInput);
            return ok ? "已在输入框填入「" + textToInput + "」" : "UNMATCHED:当前屏幕未找到处于焦点或可编辑的输入框";
        }

        // 5. 点击文字匹配: "点击 xxx" / "点 xxx" / "按下 xxx"
        String targetText = trimmedRaw;
        if (targetText.startsWith("点击")) targetText = targetText.substring(2).trim();
        else if (targetText.startsWith("点")) targetText = targetText.substring(1).trim();
        else if (targetText.startsWith("按下")) targetText = targetText.substring(2).trim();

        if (!targetText.isEmpty() && (trimmedRaw.startsWith("点击") || trimmedRaw.startsWith("点") || trimmedRaw.startsWith("按下"))) {
            boolean clickOk = clickNodeByText(targetText);
            if (clickOk) {
                return "已定位并点击「" + targetText + "」";
            }
        }

        return "UNMATCHED:本地口令未匹配。支持：回桌面、返回、下滑、上滑、打开 [应用名]、点击 [文字]、输入 [内容]";
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
