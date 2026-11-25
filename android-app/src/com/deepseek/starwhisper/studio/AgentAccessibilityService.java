package com.deepseek.starwhisper.studio;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.Notification;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.graphics.Rect;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 星语恋庭 × DeepSeek 手机端 AI 辅助助理无障碍服务 (Phone Agent Service)
 * 参考 dsh-Go 架构：提供快照化屏幕感知、敏感字段脱敏、ref 精准控件操作与丰富本地辅助能力。
 */
public class AgentAccessibilityService extends AccessibilityService {
    private static final String TAG = "AgentAccessibility";
    private static final int MAX_SNAPSHOT_NODES = 160;
    private static volatile AgentAccessibilityService sInstance = null;
    private final AtomicInteger nodeCounter = new AtomicInteger(1);
    private final AtomicInteger snapshotSeq = new AtomicInteger(0);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();

    // 快照缓存（dsh-go ref 精准定位 + 过期保护）
    private volatile String currentSnapshotId = "";
    private final ConcurrentHashMap<String, SnapshotEntry> currentSnapshotNodes = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> appLabelCache = new ConcurrentHashMap<>();

    private static final class SnapshotEntry {
        String ref;
        String text;
        String desc;
        String viewId;
        String className;
        Rect bounds;
        int centerX;
        int centerY;
        boolean clickable;
        boolean editable;
        boolean checkable;
        boolean checked;
        boolean scrollable;
        boolean selected;
        boolean focused;
        boolean enabled;
        boolean password;
        int depth;
    }

    // 自动连刷视频任务状态
    private volatile boolean autoSwipeRunning = false;
    private int autoSwipeTotal = 0;
    private int autoSwipeDone = 0;
    private int autoSwipeIntervalMs = 8000;
    private boolean autoSwipeRandomLike = false;
    private Runnable autoSwipeRunnable = null;
    private Runnable autoSwipeLikeRunnable = null;

    // 离线多步宏队列状态
    private volatile boolean macroRunning = false;
    private final List<Runnable> pendingRunnables = new ArrayList<>();
    private volatile long lastMusicScanMs = 0L;
    private volatile int qqMusicOrderSeq = 0;

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
        if (event == null) return;
        try {
            CharSequence pkgCs = event.getPackageName();
            if (pkgCs == null) return;
            String pkg = pkgCs.toString();
            boolean isMusicApp = "com.tencent.qqmusic".equals(pkg)
                    || "com.netease.cloudmusic".equals(pkg)
                    || "com.kugou.android".equals(pkg)
                    || "com.luna.music".equals(pkg);
            if (!isMusicApp) return;

            int evType = event.getEventType();
            if (evType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
                if (event.getParcelableData() instanceof Notification) {
                    Notification n = (Notification) event.getParcelableData();
                    if (n.extras != null) {
                        CharSequence tCs = n.extras.getCharSequence(Notification.EXTRA_TITLE);
                        CharSequence sCs = n.extras.getCharSequence(Notification.EXTRA_TEXT);
                        String t = tCs != null ? tCs.toString().trim() : "";
                        String s = sCs != null ? sCs.toString().trim() : "";
                        if (!t.isEmpty()) {
                            FloatAgentService.onExternalMusicNotification(pkg, t, s);
                        }
                    }
                } else if (event.getText() != null && !event.getText().isEmpty()) {
                    String first = String.valueOf(event.getText().get(0)).trim();
                    if (!first.isEmpty() && first.length() <= 80) {
                        FloatAgentService.onExternalMusicNotification(pkg, first, "");
                    }
                }
            } else if ((evType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                    || evType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
                    && "com.tencent.qqmusic".equals(pkg)) {
                long now = System.currentTimeMillis();
                if (now - lastMusicScanMs >= 950L) {
                    lastMusicScanMs = now;
                    scanQqMusicPlayingUiHints();
                }
            }
        } catch (Throwable ignored) {}
    }

    private void scanQqMusicPlayingUiHints() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            List<String> lines = new ArrayList<>();
            collectShortTextNodes(root, lines, 0, 28);
            root.recycle();

            String timeFound = "";
            for (String item : lines) {
                if (item.matches("^\\d{1,2}:\\d{2}$")) {
                    timeFound = item;
                    break;
                }
            }
            if (!timeFound.isEmpty()) {
                FloatAgentService.onExternalMusicTimeHint(timeFound);
            }
        } catch (Throwable ignored) {}
    }

    private void collectShortTextNodes(AccessibilityNodeInfo node, List<String> out, int depth, int limit) {
        if (node == null || depth > 8 || out.size() >= limit) return;
        CharSequence t = node.getText();
        if (t != null) {
            String s = t.toString().trim();
            if (!s.isEmpty() && s.length() <= 60) {
                out.add(s);
            }
        }
        int cnt = node.getChildCount();
        for (int i = 0; i < cnt && out.size() < limit; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectShortTextNodes(child, out, depth + 1, limit);
                child.recycle();
            }
        }
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "AgentAccessibilityService 被系统中断");
    }

    @Override
    public void onDestroy() {
        stopAllBackgroundTasks("无障碍服务关闭");
        super.onDestroy();
        if (sInstance == this) {
            sInstance = null;
        }
        Log.i(TAG, "AgentAccessibilityService 已销毁");
    }

    /**
     * 解析包名对应的应用显示名（带缓存）
     */
    private String resolveAppLabel(String pkgName) {
        if (pkgName == null || pkgName.isEmpty()) return "";
        String cached = appLabelCache.get(pkgName);
        if (cached != null) return cached;
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkgName, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            String res = label != null ? label.toString() : pkgName;
            appLabelCache.put(pkgName, res);
            return res;
        } catch (Exception ignored) {
            return pkgName;
        }
    }

    private static boolean isSensitiveKeywordMatch(String text) {
        if (text == null || text.isEmpty()) return false;
        return text.contains("支付密码") || text.contains("输入密码") || text.contains("指纹支付")
                || text.contains("人脸支付") || text.contains("刷脸支付") || text.contains("免密支付")
                || text.contains("收银台") || text.contains("银行卡") || text.contains("验证码")
                || text.contains("转账确认") || text.contains("确认付款") || text.contains("立即支付")
                || text.contains("交易密码") || text.contains("安全密码");
    }

    private static boolean isSensitivePackage(String pkg) {
        if (pkg == null) return false;
        String low = pkg.toLowerCase(Locale.ROOT);
        return low.contains("bank") || low.contains("wallet") || low.contains("unionpay")
                || low.contains("cmb") || low.contains("icbc") || low.contains("ccb")
                || low.contains("abchina") || low.contains("boc");
    }

    /**
     * dsh-go 风格快照化屏幕采集：
     * - 自动分配 snapshotId 与 ref (e1, e2, ...)
     * - 自动脱敏 password 字段为 [PROTECTED_PASSWORD]
     * - 检测支付/密码/银行/验证码等敏感场景
     * - 按屏幕从上到下、从左到右视觉顺序排序并裁剪高价值节点
     */
    public String dumpScreenSnapshot(boolean includeInvisible) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return "{\"error\":\"无法获取当前屏幕根节点（请确认屏幕未锁定或当前应用允许无障碍读取）\",\"snapshotId\":\"\",\"nodes\":[]}";
        }

        DisplayMetrics dm = getResources().getDisplayMetrics();
        int screenW = dm.widthPixels;
        int screenH = dm.heightPixels;
        CharSequence pkgCs = root.getPackageName();
        String pkgName = pkgCs != null ? pkgCs.toString() : "";
        String appName = resolveAppLabel(pkgName);

        List<SnapshotEntry> collected = new ArrayList<>();
        boolean[] sensitiveFlag = new boolean[]{ isSensitivePackage(pkgName) };
        StringBuilder sensitiveReason = new StringBuilder();
        if (sensitiveFlag[0]) {
            sensitiveReason.append("检测到金融/银行/钱包类应用界面");
        }

        collectSnapshotEntries(root, 0, includeInvisible, screenW, screenH, collected, sensitiveFlag, sensitiveReason);
        root.recycle();

        // 按视觉位置从上到下（24px 行容差）、从左到右稳定排序
        Collections.sort(collected, new Comparator<SnapshotEntry>() {
            @Override
            public int compare(SnapshotEntry a, SnapshotEntry b) {
                int rowDiff = a.centerY - b.centerY;
                if (Math.abs(rowDiff) > 24) {
                    return rowDiff;
                }
                int colDiff = a.centerX - b.centerX;
                if (colDiff != 0) return colDiff;
                return a.depth - b.depth;
            }
        });

        if (collected.size() > MAX_SNAPSHOT_NODES) {
            collected = new ArrayList<>(collected.subList(0, MAX_SNAPSHOT_NODES));
        }

        String snapId = "snap_" + snapshotSeq.incrementAndGet();
        currentSnapshotNodes.clear();
        StringBuilder sigSb = new StringBuilder(pkgName).append("|");

        for (int i = 0; i < collected.size(); i++) {
            SnapshotEntry entry = collected.get(i);
            entry.ref = "e" + (i + 1);
            currentSnapshotNodes.put(entry.ref, entry);
            if (i < 24) {
                sigSb.append(entry.text).append(':').append(entry.centerX).append(',').append(entry.centerY).append(';');
            }
        }
        currentSnapshotId = snapId;
        String signature = Integer.toHexString(sigSb.toString().hashCode());

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"snapshotId\":\"").append(escapeJson(snapId)).append("\",");
        sb.append("\"packageName\":\"").append(escapeJson(pkgName)).append("\",");
        sb.append("\"appName\":\"").append(escapeJson(appName)).append("\",");
        sb.append("\"width\":").append(screenW).append(",");
        sb.append("\"height\":").append(screenH).append(",");
        sb.append("\"timestamp\":").append(System.currentTimeMillis()).append(",");
        sb.append("\"signature\":\"").append(escapeJson(signature)).append("\",");
        sb.append("\"hasSensitiveField\":").append(sensitiveFlag[0]).append(",");
        sb.append("\"sensitiveReason\":\"").append(escapeJson(sensitiveReason.toString())).append("\",");
        sb.append("\"nodes\":[");

        for (int i = 0; i < collected.size(); i++) {
            SnapshotEntry e = collected.get(i);
            if (i > 0) sb.append(",");
            sb.append("{");
            sb.append("\"ref\":\"").append(e.ref).append("\",");
            sb.append("\"text\":\"").append(escapeJson(e.text)).append("\",");
            sb.append("\"desc\":\"").append(escapeJson(e.desc)).append("\",");
            sb.append("\"viewId\":\"").append(escapeJson(e.viewId)).append("\",");
            sb.append("\"cls\":\"").append(escapeJson(e.className)).append("\",");
            sb.append("\"bounds\":[").append(e.bounds.left).append(",").append(e.bounds.top).append(",").append(e.bounds.right).append(",").append(e.bounds.bottom).append("],");
            sb.append("\"center\":[").append(e.centerX).append(",").append(e.centerY).append("],");
            sb.append("\"clickable\":").append(e.clickable).append(",");
            sb.append("\"editable\":").append(e.editable).append(",");
            sb.append("\"checkable\":").append(e.checkable).append(",");
            sb.append("\"checked\":").append(e.checked).append(",");
            sb.append("\"scrollable\":").append(e.scrollable).append(",");
            sb.append("\"selected\":").append(e.selected).append(",");
            sb.append("\"focused\":").append(e.focused).append(",");
            sb.append("\"enabled\":").append(e.enabled).append(",");
            sb.append("\"password\":").append(e.password);
            sb.append("}");
        }
        sb.append("]}");
        return sb.toString();
    }

    /**
     * 轻量屏幕元数据接口（供 ScreenVerdict 高频轮询判断页面变化与敏感态）
     */
    public String getScreenMetaJson() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return "{\"ok\":false,\"packageName\":\"\",\"appName\":\"\",\"signature\":\"\",\"hasSensitiveField\":false,\"sensitiveReason\":\"\",\"nodeCount\":0,\"timestamp\":" + System.currentTimeMillis() + "}";
        }
        DisplayMetrics dm = getResources().getDisplayMetrics();
        CharSequence pkgCs = root.getPackageName();
        String pkgName = pkgCs != null ? pkgCs.toString() : "";
        String appName = resolveAppLabel(pkgName);

        List<SnapshotEntry> collected = new ArrayList<>();
        boolean[] sensitiveFlag = new boolean[]{ isSensitivePackage(pkgName) };
        StringBuilder sensitiveReason = new StringBuilder();
        if (sensitiveFlag[0]) {
            sensitiveReason.append("检测到金融/银行/钱包类应用界面");
        }
        collectSnapshotEntries(root, 0, false, dm.widthPixels, dm.heightPixels, collected, sensitiveFlag, sensitiveReason);
        root.recycle();

        StringBuilder sigSb = new StringBuilder(pkgName).append("|");
        int limit = Math.min(24, collected.size());
        for (int i = 0; i < limit; i++) {
            SnapshotEntry entry = collected.get(i);
            sigSb.append(entry.text).append(':').append(entry.centerX).append(',').append(entry.centerY).append(';');
        }
        String signature = Integer.toHexString(sigSb.toString().hashCode());

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"ok\":true,");
        sb.append("\"packageName\":\"").append(escapeJson(pkgName)).append("\",");
        sb.append("\"appName\":\"").append(escapeJson(appName)).append("\",");
        sb.append("\"signature\":\"").append(escapeJson(signature)).append("\",");
        sb.append("\"hasSensitiveField\":").append(sensitiveFlag[0]).append(",");
        sb.append("\"sensitiveReason\":\"").append(escapeJson(sensitiveReason.toString())).append("\",");
        sb.append("\"nodeCount\":").append(collected.size()).append(",");
        sb.append("\"timestamp\":").append(System.currentTimeMillis());
        sb.append("}");
        return sb.toString();
    }

    private void collectSnapshotEntries(
            AccessibilityNodeInfo node,
            int depth,
            boolean includeInvisible,
            int screenW,
            int screenH,
            List<SnapshotEntry> out,
            boolean[] sensitiveFlag,
            StringBuilder sensitiveReason
    ) {
        if (node == null || out.size() >= MAX_SNAPSHOT_NODES * 2) return;

        boolean visible = node.isVisibleToUser();
        boolean isPassword = node.isPassword();
        CharSequence rawText = node.getText();
        CharSequence rawDesc = node.getContentDescription();
        String textStr = isPassword ? "[PROTECTED_PASSWORD]" : (rawText != null ? rawText.toString().trim() : "");
        String descStr = isPassword ? "" : (rawDesc != null ? rawDesc.toString().trim() : "");

        if (isPassword && visible) {
            sensitiveFlag[0] = true;
            if (sensitiveReason.length() == 0) sensitiveReason.append("当前屏幕包含密码输入框");
        } else if (visible && (isSensitiveKeywordMatch(textStr) || isSensitiveKeywordMatch(descStr))) {
            sensitiveFlag[0] = true;
            if (sensitiveReason.length() == 0) sensitiveReason.append("当前屏幕出现支付/密码/验证码等敏感操作");
        }

        boolean clickable = node.isClickable();
        boolean editable = node.isEditable();
        boolean checkable = node.isCheckable();
        boolean scrollable = node.isScrollable();
        boolean hasText = !textStr.isEmpty() || !descStr.isEmpty();
        boolean isInteractive = clickable || editable || checkable;

        if ((visible || includeInvisible) && (isInteractive || hasText)) {
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);
            if (bounds.width() > 2 && bounds.height() > 2
                    && bounds.right > 0 && bounds.bottom > 0
                    && bounds.left < screenW && bounds.top < screenH) {
                int cx = Math.max(1, Math.min(screenW - 1, bounds.centerX()));
                int cy = Math.max(1, Math.min(screenH - 1, bounds.centerY()));

                SnapshotEntry entry = new SnapshotEntry();
                entry.text = textStr.length() > 120 ? textStr.substring(0, 120) : textStr;
                entry.desc = descStr.length() > 120 ? descStr.substring(0, 120) : descStr;
                String vid = node.getViewIdResourceName();
                entry.viewId = vid != null ? vid : "";
                CharSequence cls = node.getClassName();
                String clsStr = cls != null ? cls.toString() : "";
                int lastDot = clsStr.lastIndexOf('.');
                entry.className = lastDot >= 0 ? clsStr.substring(lastDot + 1) : clsStr;
                entry.bounds = bounds;
                entry.centerX = cx;
                entry.centerY = cy;
                entry.clickable = clickable;
                entry.editable = editable;
                entry.checkable = checkable;
                entry.checked = node.isChecked();
                entry.scrollable = scrollable;
                entry.selected = node.isSelected();
                entry.focused = node.isFocused();
                entry.enabled = node.isEnabled();
                entry.password = isPassword;
                entry.depth = depth;
                out.add(entry);
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount && out.size() < MAX_SNAPSHOT_NODES * 2; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectSnapshotEntries(child, depth + 1, includeInvisible, screenW, screenH, out, sensitiveFlag, sensitiveReason);
                child.recycle();
            }
        }
    }

    /**
     * 通过快照 ref 点击目标控件（优先节点 ACTION_CLICK，回退坐标手势并触发光圈反馈）
     */
    public String clickByRef(String snapshotId, String refId) {
        if (snapshotId != null && !snapshotId.trim().isEmpty()
                && !currentSnapshotId.isEmpty()
                && !snapshotId.trim().equals(currentSnapshotId)) {
            return "{\"ok\":false,\"stale\":true,\"message\":\"屏幕快照已过期，请重新采集当前屏幕后再点击\"}";
        }
        SnapshotEntry entry = refId != null ? currentSnapshotNodes.get(refId.trim()) : null;
        if (entry == null) {
            return "{\"ok\":false,\"message\":\"未在当前快照中找到控件 " + escapeJson(refId) + "\"}";
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null) {
            AccessibilityNodeInfo matched = findNodeMatchingSnapshot(root, entry);
            if (matched != null) {
                boolean nodeClicked = false;
                AccessibilityNodeInfo cur = matched;
                while (cur != null) {
                    if (cur.isClickable()) {
                        nodeClicked = cur.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        if (nodeClicked) break;
                    }
                    AccessibilityNodeInfo parent = cur.getParent();
                    if (cur != matched) cur.recycle();
                    cur = parent;
                }
                if (cur != null && cur != matched) cur.recycle();
                matched.recycle();
                if (nodeClicked) {
                    root.recycle();
                    FloatAgentService.showTapRipple(entry.centerX, entry.centerY);
                    return "{\"ok\":true,\"x\":" + entry.centerX + ",\"y\":" + entry.centerY + ",\"message\":\"已点击控件 " + escapeJson(entry.ref) + "\"}";
                }
            }
            root.recycle();
        }

        boolean gestureOk = performClickCoordinate(entry.centerX, entry.centerY);
        return "{\"ok\":" + gestureOk + ",\"x\":" + entry.centerX + ",\"y\":" + entry.centerY + ",\"message\":\"" + (gestureOk ? "已按坐标点击控件 " + escapeJson(entry.ref) : "控件点击派发失败") + "\"}";
    }

    /**
     * 通过快照 ref 长按目标控件
     */
    public String longClickByRef(String snapshotId, String refId, int durationMs) {
        if (snapshotId != null && !snapshotId.trim().isEmpty()
                && !currentSnapshotId.isEmpty()
                && !snapshotId.trim().equals(currentSnapshotId)) {
            return "{\"ok\":false,\"stale\":true,\"message\":\"屏幕快照已过期\"}";
        }
        SnapshotEntry entry = refId != null ? currentSnapshotNodes.get(refId.trim()) : null;
        if (entry == null) {
            return "{\"ok\":false,\"message\":\"未在当前快照中找到控件 " + escapeJson(refId) + "\"}";
        }

        int dur = Math.max(500, Math.min(durationMs > 0 ? durationMs : 700, 2500));
        boolean ok = performLongClickCoordinate(entry.centerX, entry.centerY, dur);
        return "{\"ok\":" + ok + ",\"x\":" + entry.centerX + ",\"y\":" + entry.centerY + ",\"message\":\"" + (ok ? "已长按控件 " + escapeJson(entry.ref) : "长按派发失败") + "\"}";
    }

    /**
     * 通过快照 ref 向目标输入框输入文字（支持清空、剪贴板兜底与自动提交）
     */
    public String inputByRef(String snapshotId, String refId, String text, boolean clearFirst, boolean autoSubmit) {
        if (refId == null || refId.trim().isEmpty()) {
            boolean ok = performSmartInputText(null, text, !clearFirst, autoSubmit);
            return "{\"ok\":" + ok + ",\"message\":\"" + (ok ? "已向当前输入框填入文字" : "未找到可编辑输入框") + "\"}";
        }
        if (snapshotId != null && !snapshotId.trim().isEmpty()
                && !currentSnapshotId.isEmpty()
                && !snapshotId.trim().equals(currentSnapshotId)) {
            return "{\"ok\":false,\"stale\":true,\"message\":\"屏幕快照已过期\"}";
        }
        SnapshotEntry entry = currentSnapshotNodes.get(refId.trim());
        if (entry == null) {
            boolean ok = performSmartInputText(null, text, !clearFirst, autoSubmit);
            return "{\"ok\":" + ok + ",\"message\":\"" + (ok ? "已智能定位输入框并填入文字" : "未找到控件 " + escapeJson(refId)) + "\"}";
        }

        FloatAgentService.showTapRipple(entry.centerX, entry.centerY);

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return "{\"ok\":false,\"message\":\"无法获取活动窗口\"}";
        }

        AccessibilityNodeInfo target = findNodeMatchingSnapshot(root, entry);
        if (target == null || !target.isEditable()) {
            if (target != null) target.recycle();
            // 先点击该位置唤醒输入框，再回退 smartInput
            performClickCoordinate(entry.centerX, entry.centerY);
            root.recycle();
            boolean ok = performSmartInputText(entry.viewId, text, !clearFirst, autoSubmit);
            return "{\"ok\":" + ok + ",\"message\":\"" + (ok ? "已定位输入框并填入文字" : "目标控件不可编辑") + "\"}";
        }

        if (!target.isFocused()) {
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }

        Rect inputBounds = new Rect();
        target.getBoundsInScreen(inputBounds);
        String rawInput = text != null ? text : "";
        String finalText = rawInput;
        if (!clearFirst) {
            CharSequence existing = target.getText();
            CharSequence hint = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ? target.getHintText() : null;
            String existingStr = existing != null ? existing.toString() : "";
            String hintStr = hint != null ? hint.toString() : "";
            if (!existingStr.isEmpty() && !existingStr.equals(hintStr)) {
                finalText = existingStr + rawInput;
            }
        }

        Bundle arguments = new Bundle();
        arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, finalText);
        boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
        if (!ok && !finalText.isEmpty()) {
            ok = pasteTextViaClipboard(target, finalText, clearFirst);
        }

        target.recycle();
        root.recycle();

        if (ok && autoSubmit) {
            final Rect finalBounds = inputBounds;
            int[] delays = new int[]{ 260, 580 };
            for (int d : delays) {
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (!FloatAgentService.sEmergencyStopRequested) {
                            performSmartSubmitAction(finalBounds);
                        }
                    }
                }, d);
            }
        }

        return "{\"ok\":" + ok + ",\"message\":\"" + (ok ? "已向 " + escapeJson(entry.ref) + " 填入文字" : "文本输入失败") + "\"}";
    }

    /**
     * 安全区比例滚动（避开系统顶部状态栏与底部导航栏）
     */
    public boolean scrollDirection(String direction, float ratio) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = dm.widthPixels;
        int h = dm.heightPixels;
        float r = Math.max(0.25f, Math.min(ratio > 0 ? ratio : 0.65f, 0.85f));
        String dir = direction != null ? direction.trim().toLowerCase(Locale.ROOT) : "down";
        int spanY = (int) (h * 0.56f * r);
        int midY = (int) (h * 0.52f);
        int spanX = (int) (w * 0.68f * r);
        int midX = w / 2;

        if ("down".equals(dir)) {
            return performSwipe(midX, midY + spanY / 2, midX, midY - spanY / 2, 340);
        } else if ("up".equals(dir)) {
            return performSwipe(midX, midY - spanY / 2, midX, midY + spanY / 2, 340);
        } else if ("left".equals(dir)) {
            return performSwipe(midX + spanX / 2, midY, midX - spanX / 2, midY, 320);
        } else if ("right".equals(dir)) {
            return performSwipe(midX - spanX / 2, midY, midX + spanX / 2, midY, 320);
        }
        return false;
    }

    private AccessibilityNodeInfo findNodeMatchingSnapshot(AccessibilityNodeInfo root, SnapshotEntry entry) {
        if (root == null || entry == null) return null;
        if (entry.viewId != null && !entry.viewId.isEmpty()) {
            List<AccessibilityNodeInfo> byId = root.findAccessibilityNodeInfosByViewId(entry.viewId);
            if (byId != null && !byId.isEmpty()) {
                AccessibilityNodeInfo best = null;
                int bestDist = Integer.MAX_VALUE;
                for (AccessibilityNodeInfo cand : byId) {
                    Rect b = new Rect();
                    cand.getBoundsInScreen(b);
                    int dist = Math.abs(b.centerX() - entry.centerX) + Math.abs(b.centerY() - entry.centerY);
                    if (dist < bestDist) {
                        bestDist = dist;
                        if (best != null) best.recycle();
                        best = cand;
                    } else {
                        cand.recycle();
                    }
                }
                if (best != null && bestDist < 80) {
                    return best;
                }
                if (best != null) best.recycle();
            }
        }
        return findNodeByBoundsAndText(root, entry);
    }

    private AccessibilityNodeInfo findNodeByBoundsAndText(AccessibilityNodeInfo node, SnapshotEntry entry) {
        if (node == null) return null;
        if (node.isVisibleToUser()) {
            Rect b = new Rect();
            node.getBoundsInScreen(b);
            int dist = Math.abs(b.centerX() - entry.centerX) + Math.abs(b.centerY() - entry.centerY);
            if (dist <= 28) {
                CharSequence t = node.getText();
                CharSequence d = node.getContentDescription();
                String ts = t != null ? t.toString().trim() : "";
                String ds = d != null ? d.toString().trim() : "";
                if (entry.password && node.isPassword()) {
                    return AccessibilityNodeInfo.obtain(node);
                }
                if ((!entry.text.isEmpty() && entry.text.equals(ts))
                        || (!entry.desc.isEmpty() && entry.desc.equals(ds))
                        || (entry.text.isEmpty() && entry.desc.isEmpty() && b.equals(entry.bounds))) {
                    return AccessibilityNodeInfo.obtain(node);
                }
            }
        }
        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo hit = findNodeByBoundsAndText(child, entry);
                child.recycle();
                if (hit != null) return hit;
            }
        }
        return null;
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
        FloatAgentService.showTapRipple(x, y);
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
        FloatAgentService.showTapRipple(x, y);
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        int dur = Math.max(450, Math.min(durationMs, 2500));
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
        return dispatchGesture(builder.build(), null, null);
    }

    /**
     * 模拟双指/连续双击坐标 (用于短视频双击点赞或放大)
     */
    public boolean performDoubleClickCoordinate(final int x, final int y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        FloatAgentService.showTapRipple(x, y);
        boolean firstOk = performQuickTap(x, y, 40);
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                performQuickTap(x, y, 40);
            }
        }, 95);
        return firstOk;
    }

    private boolean performQuickTap(int x, int y, int durMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, Math.max(25, durMs)));
        return dispatchGesture(builder.build(), null, null);
    }

    /**
     * 短视频屏幕中心双击点赞
     */
    public boolean performDoubleClickCenter() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int x = dm.widthPixels / 2 + (random.nextInt(32) - 16);
        int y = (int) (dm.heightPixels * 0.48) + (random.nextInt(40) - 20);
        return performDoubleClickCoordinate(x, y);
    }

    /**
     * 屏幕中心轻点（暂停 / 播放视频）
     */
    public boolean performTapCenter() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int x = dm.widthPixels / 2;
        int y = (int) (dm.heightPixels * 0.46);
        return performClickCoordinate(x, y);
    }

    /**
     * 短视频下一个（向上快速滑动，贴近真人拇指轨迹）
     */
    public boolean performVideoSwipeNext() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = dm.widthPixels;
        int h = dm.heightPixels;
        int jitterX = random.nextInt(28) - 14;
        return performSwipe(
                (int) (w * 0.52) + jitterX,
                (int) (h * 0.78),
                (int) (w * 0.48) + jitterX,
                (int) (h * 0.22),
                260
        );
    }

    /**
     * 短视频上一个（向下滑动）
     */
    public boolean performVideoSwipePrev() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = dm.widthPixels;
        int h = dm.heightPixels;
        return performSwipe(
                (int) (w * 0.50),
                (int) (h * 0.25),
                (int) (w * 0.50),
                (int) (h * 0.78),
                280
        );
    }

    /**
     * 连续多次定向滑动（支持“下滑3次”或“回顶部/滑到底部”）
     */
    public boolean performMultiSwipe(final String dir, int times) {
        final int safeTimes = Math.max(1, Math.min(times, 8));
        final DisplayMetrics dm = getResources().getDisplayMetrics();
        final int w = dm.widthPixels;
        final int h = dm.heightPixels;
        boolean firstOk = executeSingleDirectionalSwipe(dir, w, h);
        for (int i = 1; i < safeTimes; i++) {
            final int delay = i * 480;
            Runnable stepTask = new Runnable() {
                @Override
                public void run() {
                    if (FloatAgentService.sEmergencyStopRequested) return;
                    executeSingleDirectionalSwipe(dir, w, h);
                }
            };
            pendingRunnables.add(stepTask);
            mainHandler.postDelayed(stepTask, delay);
        }
        return firstOk;
    }

    private boolean executeSingleDirectionalSwipe(String dir, int w, int h) {
        if ("down".equals(dir)) {
            return performSwipe(w / 2, (int) (h * 0.74), w / 2, (int) (h * 0.26), 340);
        } else if ("up".equals(dir)) {
            return performSwipe(w / 2, (int) (h * 0.26), w / 2, (int) (h * 0.74), 340);
        } else if ("left".equals(dir)) {
            return performSwipe((int) (w * 0.82), h / 2, (int) (w * 0.18), h / 2, 320);
        } else if ("right".equals(dir)) {
            return performSwipe((int) (w * 0.18), h / 2, (int) (w * 0.82), h / 2, 320);
        }
        return false;
    }

    public boolean isAutoSwipeRunning() {
        return autoSwipeRunning;
    }

    public String getAutoSwipeSummary() {
        if (!autoSwipeRunning) return "未运行";
        return "连刷中 (" + autoSwipeDone + "/" + autoSwipeTotal + ")";
    }

    /**
     * 启动自动连刷短视频任务（支持指定条数、间隔秒数及随机点赞）
     */
    public String startAutoSwipeVideos(int count, int intervalSec, boolean randomLike) {
        stopAutoSwipeInternal(false);
        FloatAgentService.sEmergencyStopRequested = false;

        this.autoSwipeTotal = (count <= 0) ? 20 : Math.min(count, 200);
        this.autoSwipeDone = 0;
        int safeSec = (intervalSec <= 0) ? 8 : Math.max(2, Math.min(intervalSec, 60));
        this.autoSwipeIntervalMs = safeSec * 1000;
        this.autoSwipeRandomLike = randomLike;
        this.autoSwipeRunning = true;

        FloatAgentService.updateState("executing", "连刷 0/" + autoSwipeTotal);
        scheduleNextAutoSwipeStep(650);

        String likeNote = randomLike ? "（含随机点赞）" : "";
        return "已启动自动刷视频：共 " + autoSwipeTotal + " 条，每 " + safeSec + " 秒切换" + likeNote;
    }

    private void scheduleNextAutoSwipeStep(long delayMs) {
        if (autoSwipeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeRunnable);
        }
        if (autoSwipeLikeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeLikeRunnable);
        }
        autoSwipeRunnable = new Runnable() {
            @Override
            public void run() {
                if (!autoSwipeRunning || FloatAgentService.sEmergencyStopRequested) {
                    stopAutoSwipeInternal(true);
                    return;
                }
                if (autoSwipeDone >= autoSwipeTotal) {
                    stopAutoSwipeInternal(true);
                    return;
                }

                performVideoSwipeNext();
                autoSwipeDone++;
                FloatAgentService.updateState("executing", "连刷 " + autoSwipeDone + "/" + autoSwipeTotal);

                if (autoSwipeDone >= autoSwipeTotal) {
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            stopAutoSwipeInternal(true);
                        }
                    }, 900);
                    return;
                }

                // 若开启随机点赞，则在视频停留中段约 35% 概率触发双击点赞
                if (autoSwipeRandomLike && random.nextInt(100) < 35) {
                    int likeDelay = Math.max(1200, (int) (autoSwipeIntervalMs * 0.45f));
                    autoSwipeLikeRunnable = new Runnable() {
                        @Override
                        public void run() {
                            if (autoSwipeRunning && !FloatAgentService.sEmergencyStopRequested) {
                                performDoubleClickCenter();
                            }
                        }
                    };
                    mainHandler.postDelayed(autoSwipeLikeRunnable, likeDelay);
                }

                // 自然节奏抖动 [-600ms, +900ms]
                int jitter = random.nextInt(1501) - 600;
                long nextDelay = Math.max(1800L, autoSwipeIntervalMs + jitter);
                scheduleNextAutoSwipeStep(nextDelay);
            }
        };
        mainHandler.postDelayed(autoSwipeRunnable, delayMs);
    }

    private void stopAutoSwipeInternal(boolean resetFloatUi) {
        autoSwipeRunning = false;
        if (autoSwipeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeRunnable);
            autoSwipeRunnable = null;
        }
        if (autoSwipeLikeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeLikeRunnable);
            autoSwipeLikeRunnable = null;
        }
        if (resetFloatUi && !FloatAgentService.sEmergencyStopRequested) {
            FloatAgentService.updateState("idle", "星语 AI");
        }
    }

    /**
     * 急停或关闭所有后台自动任务（连刷视频、组合宏等）
     */
    public void stopAllBackgroundTasks(String reason) {
        autoSwipeRunning = false;
        macroRunning = false;
        qqMusicOrderSeq++;
        if (autoSwipeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeRunnable);
            autoSwipeRunnable = null;
        }
        if (autoSwipeLikeRunnable != null) {
            mainHandler.removeCallbacks(autoSwipeLikeRunnable);
            autoSwipeLikeRunnable = null;
        }
        for (Runnable r : pendingRunnables) {
            mainHandler.removeCallbacks(r);
        }
        pendingRunnables.clear();
        Log.i(TAG, "已停止后台自动任务: " + reason);
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
                if (count >= 120) break;
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
        aliasPkg.put("企业微信", "com.tencent.wework");
        aliasPkg.put("qq", "com.tencent.mobileqq");
        aliasPkg.put("钉钉", "com.alibaba.android.rimet");
        aliasPkg.put("飞书", "com.ss.android.lark");
        aliasPkg.put("支付宝", "com.eg.android.AlipayGphone");
        aliasPkg.put("alipay", "com.eg.android.AlipayGphone");
        aliasPkg.put("云闪付", "com.unionpay");
        aliasPkg.put("淘宝", "com.taobao.taobao");
        aliasPkg.put("天猫", "com.tmall.wireless");
        aliasPkg.put("闲鱼", "com.taobao.idlefish");
        aliasPkg.put("京东", "com.jingdong.app.mall");
        aliasPkg.put("拼多多", "com.xunmeng.pinduoduo");
        aliasPkg.put("美团", "com.sankuai.meituan");
        aliasPkg.put("饿了么", "me.ele");
        aliasPkg.put("大众点评", "com.dianping.v1");
        aliasPkg.put("滴滴", "com.sdu.didi.psnger");
        aliasPkg.put("滴滴出行", "com.sdu.didi.psnger");
        aliasPkg.put("12306", "com.MobileTicket");
        aliasPkg.put("携程", "ctrip.android.view");
        aliasPkg.put("抖音极速版", "com.ss.android.ugc.aweme.lite");
        aliasPkg.put("抖音", "com.ss.android.ugc.aweme");
        aliasPkg.put("快手极速版", "com.kuaishou.nebula");
        aliasPkg.put("快手", "com.smile.gifmaker");
        aliasPkg.put("小红书", "com.xingin.xhs");
        aliasPkg.put("b站", "tv.danmaku.bili");
        aliasPkg.put("哔哩哔哩", "tv.danmaku.bili");
        aliasPkg.put("bilibili", "tv.danmaku.bili");
        aliasPkg.put("微博", "com.sina.weibo");
        aliasPkg.put("知乎", "com.zhihu.android");
        aliasPkg.put("今日头条", "com.ss.android.article.news");
        aliasPkg.put("头条", "com.ss.android.article.news");
        aliasPkg.put("高德", "com.autonavi.minimap");
        aliasPkg.put("高德地图", "com.autonavi.minimap");
        aliasPkg.put("百度地图", "com.baidu.BaiduMap");
        aliasPkg.put("网易云音乐", "com.netease.cloudmusic");
        aliasPkg.put("网易云", "com.netease.cloudmusic");
        aliasPkg.put("qq音乐", "com.tencent.qqmusic");
        aliasPkg.put("酷狗", "com.kugou.android");
        aliasPkg.put("酷狗音乐", "com.kugou.android");
        aliasPkg.put("喜马拉雅", "com.ximalaya.ting.android");
        aliasPkg.put("汽水音乐", "com.luna.music");
        aliasPkg.put("腾讯视频", "com.tencent.qqlive");
        aliasPkg.put("爱奇艺", "com.qiyi.video");
        aliasPkg.put("优酷", "com.youku.phone");
        aliasPkg.put("wps", "cn.wps.moffice_eng");
        aliasPkg.put("豆包", "com.larus.nova");
        aliasPkg.put("kimi", "com.moonshot.kimichat");
        aliasPkg.put("deepseek", "com.deepseek.chat");

        PackageManager pm = getPackageManager();
        // 优先精确命中别名表（避免「抖音」抢先命中「抖音极速版」或反过来）
        String directPkg = aliasPkg.get(clean);
        if (directPkg != null) {
            try {
                Intent li = pm.getLaunchIntentForPackage(directPkg);
                if (li != null) {
                    li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(li);
                    return true;
                }
            } catch (Exception ignored) {}
        }

        // 次优按别名长度倒序包含匹配
        String bestAliasKey = null;
        String bestAliasPkg = null;
        for (Map.Entry<String, String> entry : aliasPkg.entrySet()) {
            String key = entry.getKey();
            if (clean.contains(key) && (bestAliasKey == null || key.length() > bestAliasKey.length())) {
                bestAliasKey = key;
                bestAliasPkg = entry.getValue();
            }
        }
        if (bestAliasPkg != null) {
            try {
                Intent li = pm.getLaunchIntentForPackage(bestAliasPkg);
                if (li != null) {
                    li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(li);
                    return true;
                }
            } catch (Exception ignored) {}
        }

        // 动态匹配手机里所有已安装桌面应用名称（含系统相册、相机、时钟、计算器、日历、浏览器、备忘录、电话、短信）
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
        FloatAgentService.showTapRipple(startX, startY);
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        int dur = Math.max(100, Math.min(durationMs, 2000));
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
        return dispatchGesture(builder.build(), null, null);
    }

    /**
     * 兼容旧签名的单文本输入方法
     */
    public boolean performInputText(String viewId, String text) {
        return performSmartInputText(viewId, text, false, false);
    }

    /**
     * 智能打字引擎：
     * 1. 多路径查找可见可编辑输入框（指定 viewId > 当前输入焦点 > 递归扫描屏幕 EditText）
     * 2. 自动聚焦并支持清空/覆盖/追加写入，ACTION_SET_TEXT 失败时自动回退系统剪贴板 + ACTION_PASTE
     * 3. 可选自动点击发送/搜索/评论/发布按钮
     */
    public boolean performSmartInputText(String viewId, String text, boolean appendMode, boolean autoSubmit) {
        return performSmartInputTextWithRetry(viewId, text, appendMode, autoSubmit, 2);
    }

    private boolean performSmartInputTextWithRetry(final String viewId, final String text, final boolean appendMode, final boolean autoSubmit, final int retriesLeft) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        String selfPkg = getPackageName();
        boolean windowStillSelf = false;
        if (root != null) {
            CharSequence rPkg = root.getPackageName();
            if (selfPkg != null && rPkg != null && selfPkg.equals(rPkg.toString())) {
                windowStillSelf = true;
            }
        }

        AccessibilityNodeInfo target = (root != null) ? findEditableTarget(root, viewId) : null;
        if (target == null) {
            if (root != null) root.recycle();
            if (retriesLeft > 0) {
                Runnable retryTask = new Runnable() {
                    @Override
                    public void run() {
                        if (!FloatAgentService.sEmergencyStopRequested) {
                            performSmartInputTextWithRetry(viewId, text, appendMode, autoSubmit, retriesLeft - 1);
                        }
                    }
                };
                pendingRunnables.add(retryTask);
                mainHandler.postDelayed(retryTask, windowStillSelf ? 320 : 260);
                return true;
            }
            return false;
        }

        final Rect inputBounds = new Rect();
        target.getBoundsInScreen(inputBounds);
        if (!target.isFocused()) {
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            if (inputBounds.width() > 20 && inputBounds.height() > 12) {
                performClickCoordinate(inputBounds.centerX(), inputBounds.centerY());
            }
        }

        String rawInput = text != null ? text : "";
        String finalText = rawInput;
        if (appendMode) {
            CharSequence existing = target.getText();
            CharSequence hint = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ? target.getHintText() : null;
            String existingStr = existing != null ? existing.toString() : "";
            String hintStr = hint != null ? hint.toString() : "";
            if (!existingStr.isEmpty() && !existingStr.equals(hintStr)) {
                finalText = existingStr + rawInput;
            }
        }

        Bundle arguments = new Bundle();
        arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, finalText);
        boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);

        if (!ok && !finalText.isEmpty()) {
            ok = pasteTextViaClipboard(target, finalText, !appendMode);
        }

        target.recycle();
        root.recycle();

        if (ok && autoSubmit) {
            final int[] retryDelays = new int[]{ 300, 680 };
            for (int delay : retryDelays) {
                Runnable subTask = new Runnable() {
                    @Override
                    public void run() {
                        if (!FloatAgentService.sEmergencyStopRequested) {
                            performSmartSubmitAction(inputBounds);
                        }
                    }
                };
                pendingRunnables.add(subTask);
                mainHandler.postDelayed(subTask, delay);
            }
        }
        return ok;
    }

    /**
     * 智能发送/提交触发器：严禁误点输入框自身及「清空×/语音/表情/更多」按钮，综合精确文案匹配、最右侧提交按钮与 IME 动作确保发送成功
     */
    public boolean performSmartSubmitAction(final Rect inputBounds) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        String[] submitKeywords = new String[]{"发送", "搜索", "发布", "评论", "确认", "完成", "前往", "Send", "Search"};

        // 策略 1：排除 EditText 与清空/辅助图标后，按提交优先级评分寻找最优触发按钮
        List<AccessibilityNodeInfo> candidates = new ArrayList<>();
        collectSubmitCandidates(root, candidates, submitKeywords);
        if (!candidates.isEmpty()) {
            AccessibilityNodeInfo bestNode = pickBestSubmitCandidate(candidates, inputBounds);
            if (bestNode != null) {
                Rect bounds = new Rect();
                bestNode.getBoundsInScreen(bounds);

                boolean clicked = false;
                AccessibilityNodeInfo clickTarget = bestNode;
                while (clickTarget != null) {
                    if (clickTarget.isClickable()) {
                        clicked = clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        if (clicked) break;
                    }
                    clickTarget = clickTarget.getParent();
                }

                if (bounds.width() > 0 && bounds.height() > 0) {
                    performClickCoordinate(bounds.centerX(), bounds.centerY());
                    clicked = true;
                }

                for (AccessibilityNodeInfo n : candidates) {
                    if (n != null) n.recycle();
                }
                root.recycle();
                return clicked;
            }
            for (AccessibilityNodeInfo n : candidates) {
                if (n != null) n.recycle();
            }
        }

        // 策略 2：同行最右侧非清除/非功能按钮探测（典型如微信/QQ输入框最右侧发送按钮）
        if (inputBounds != null && inputBounds.width() > 0) {
            AccessibilityNodeInfo rightNeighbor = findRightNeighborButton(root, inputBounds);
            if (rightNeighbor != null) {
                Rect bounds = new Rect();
                rightNeighbor.getBoundsInScreen(bounds);
                boolean clicked = rightNeighbor.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                if (bounds.width() > 0 && bounds.height() > 0) {
                    performClickCoordinate(bounds.centerX(), bounds.centerY());
                    clicked = true;
                }
                rightNeighbor.recycle();
                root.recycle();
                return clicked;
            }
        }

        // 策略 3：派发软键盘 IME_ACTION（搜索 / 发送 / 回车）
        boolean imeOk = dispatchImeEnterOnFocused(root);
        root.recycle();
        return imeOk;
    }

    private boolean dispatchImeEnterOnFocused(AccessibilityNodeInfo root) {
        if (root == null) return false;
        AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focused == null) {
            focused = findEditableTarget(root, null);
        }
        if (focused == null) return false;
        boolean imeOk = false;
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                imeOk = focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
            }
        } catch (Throwable ignored) {}
        if (!imeOk) {
            try {
                imeOk = focused.performAction(16908372);
            } catch (Throwable ignored) {}
        }
        focused.recycle();
        return imeOk;
    }

    private boolean isExcludedActionNode(AccessibilityNodeInfo node, String tStr, String dStr, String idStr) {
        if (node == null) return true;
        if (node.isEditable()) return true;
        CharSequence cls = node.getClassName();
        if (cls != null && cls.toString().contains("EditText")) return true;

        String combined = (tStr + " " + dStr + " " + idStr).toLowerCase(Locale.ROOT);
        String[] badWords = new String[]{
                "清空", "清除", "删除", "取消", "关闭", "语音", "表情", "更多", "拍照", "相册", "大家都在搜", "热搜",
                "clear", "delete", "close", "cancel", "voice", "mic", "emoji", "face", "plus", "more", "camera"
        };
        for (String bad : badWords) {
            if (combined.contains(bad)) {
                return true;
            }
        }
        return false;
    }

    private AccessibilityNodeInfo pickBestSubmitCandidate(List<AccessibilityNodeInfo> candidates, Rect inputBounds) {
        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo cand : candidates) {
            if (cand == null) continue;
            Rect r = new Rect();
            cand.getBoundsInScreen(r);
            String tStr = cand.getText() != null ? cand.getText().toString().trim() : "";
            String dStr = cand.getContentDescription() != null ? cand.getContentDescription().toString().trim() : "";
            String idStr = cand.getViewIdResourceName() != null ? cand.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";

            int score = 0;
            if ("发送".equals(tStr) || "搜索".equals(tStr) || "Send".equalsIgnoreCase(tStr) || "Search".equalsIgnoreCase(tStr)
                    || "发送".equals(dStr) || "搜索".equals(dStr)) {
                score += 500;
            } else if ("发布".equals(tStr) || "评论".equals(tStr) || "确认".equals(tStr)) {
                score += 420;
            } else if (idStr.contains("send") || idStr.contains("submit") || idStr.contains("btn_send") || idStr.contains("search_btn")) {
                score += 360;
            } else {
                score += 120;
            }

            if (cand.isClickable()) score += 220;
            if (tStr.length() > 8) score -= 260;

            if (inputBounds != null && inputBounds.width() > 0) {
                if (r.centerX() >= inputBounds.right - 25 && Math.abs(r.centerY() - inputBounds.centerY()) <= Math.max(inputBounds.height(), 90)) {
                    score += 380;
                } else if (r.centerX() >= inputBounds.left && r.centerX() <= inputBounds.right && r.centerY() >= inputBounds.top && r.centerY() <= inputBounds.bottom) {
                    // 处于输入框内部（很可能是左侧放大镜或内部清空图标），大幅降权
                    score -= 600;
                }
            }
            // 同等条件下，右侧提交按钮优先于左侧
            score += Math.min(200, r.centerX() / 6);

            if (score > bestScore) {
                bestScore = score;
                best = cand;
            }
        }
        return bestScore > 0 ? best : null;
    }

    private void collectSubmitCandidates(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out, String[] keywords) {
        if (node == null || out.size() >= 12) return;
        if (node.isVisibleToUser()) {
            CharSequence text = node.getText();
            CharSequence desc = node.getContentDescription();
            String viewId = node.getViewIdResourceName();
            String tStr = text != null ? text.toString().trim() : "";
            String dStr = desc != null ? desc.toString().trim() : "";
            String idStr = viewId != null ? viewId.toLowerCase(Locale.ROOT) : "";

            if (!isExcludedActionNode(node, tStr, dStr, idStr)) {
                boolean match = false;
                for (String kw : keywords) {
                    if (tStr.equals(kw) || dStr.equals(kw) || (tStr.length() <= 6 && tStr.contains(kw)) || (dStr.length() <= 6 && dStr.contains(kw))) {
                        match = true;
                        break;
                    }
                }
                if (!match && (!idStr.isEmpty() && (idStr.contains("send") || idStr.contains("submit") || idStr.contains("btn_send") || idStr.contains("search_btn") || idStr.contains("btn_search")))) {
                    match = true;
                }

                if (match) {
                    Rect r = new Rect();
                    node.getBoundsInScreen(r);
                    if (r.width() > 10 && r.height() > 10) {
                        out.add(AccessibilityNodeInfo.obtain(node));
                    }
                }
            }
        }

        int count = node.getChildCount();
        for (int i = 0; i < count && out.size() < 12; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectSubmitCandidates(child, out, keywords);
                child.recycle();
            }
        }
    }

    private AccessibilityNodeInfo findRightNeighborButton(AccessibilityNodeInfo root, Rect inputBounds) {
        List<AccessibilityNodeInfo> cands = new ArrayList<>();
        collectClickableNodes(root, cands);
        if (cands.isEmpty()) return null;

        AccessibilityNodeInfo best = null;
        int bestX = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo cand : cands) {
            String tStr = cand.getText() != null ? cand.getText().toString().trim() : "";
            String dStr = cand.getContentDescription() != null ? cand.getContentDescription().toString().trim() : "";
            String idStr = cand.getViewIdResourceName() != null ? cand.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            if (isExcludedActionNode(cand, tStr, dStr, idStr)) {
                cand.recycle();
                continue;
            }
            Rect r = new Rect();
            cand.getBoundsInScreen(r);
            boolean horizontallyRight = r.left >= (inputBounds.right - 20);
            boolean verticallyAligned = Math.abs(r.centerY() - inputBounds.centerY()) <= Math.max(inputBounds.height(), 90);
            if (horizontallyRight && verticallyAligned && r.width() >= 20 && r.height() >= 20) {
                // 优先取输入行最右侧真正提交按钮（避开紧贴输入框右缘的功能小图标）
                if (r.centerX() > bestX) {
                    bestX = r.centerX();
                    if (best != null) best.recycle();
                    best = cand;
                    continue;
                }
            }
            cand.recycle();
        }
        return best;
    }

    private void collectClickableNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null || out.size() >= 48) return;
        String cls = String.valueOf(node.getClassName());
        if (node.isVisibleToUser() && !node.isEditable() && !cls.contains("EditText")
                && (node.isClickable() || cls.contains("Button") || cls.contains("TextView") || cls.contains("ImageView"))) {
            out.add(AccessibilityNodeInfo.obtain(node));
        }
        int count = node.getChildCount();
        for (int i = 0; i < count && out.size() < 48; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectClickableNodes(child, out);
                child.recycle();
            }
        }
    }

    /**
     * 将剪贴板现有内容粘贴到当前屏幕可编辑输入框
     */
    public boolean pasteFromClipboard() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = findEditableTarget(root, null);
        if (target == null) {
            root.recycle();
            return false;
        }
        if (!target.isFocused()) {
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        target.recycle();
        root.recycle();
        return ok;
    }

    private boolean pasteTextViaClipboard(AccessibilityNodeInfo target, String value, boolean selectAllBeforePaste) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return false;
            cm.setPrimaryClip(ClipData.newPlainText("starwhisper_input", value));
            if (selectAllBeforePaste) {
                CharSequence existing = target.getText();
                if (existing != null && existing.length() > 0) {
                    Bundle selArgs = new Bundle();
                    selArgs.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0);
                    selArgs.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, existing.length());
                    target.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, selArgs);
                }
            }
            return target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        } catch (Exception e) {
            return false;
        }
    }

    private AccessibilityNodeInfo findEditableTarget(AccessibilityNodeInfo root, String viewId) {
        if (root == null) return null;

        if (viewId != null && !viewId.trim().isEmpty()) {
            List<AccessibilityNodeInfo> byId = root.findAccessibilityNodeInfosByViewId(viewId.trim());
            if (byId != null && !byId.isEmpty()) {
                AccessibilityNodeInfo hit = byId.get(0);
                for (int i = 1; i < byId.size(); i++) {
                    if (byId.get(i) != null) byId.get(i).recycle();
                }
                return hit;
            }
        }

        AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focused != null) {
            if (focused.isEditable()) {
                return focused;
            }
            focused.recycle();
        }

        List<AccessibilityNodeInfo> candidates = new ArrayList<>();
        collectEditableNodes(root, candidates);
        if (candidates.isEmpty()) return null;

        AccessibilityNodeInfo best = null;
        int bestScore = Integer.MIN_VALUE;
        String selfPkg = getPackageName();
        for (AccessibilityNodeInfo cand : candidates) {
            Rect r = new Rect();
            cand.getBoundsInScreen(r);
            int score = r.bottom; // 同屏下优先最靠下的主聊天/评论输入框
            CharSequence candPkg = cand.getPackageName();
            if (selfPkg != null && candPkg != null && selfPkg.equals(candPkg.toString())) {
                score -= 50000;
            }
            if (cand.isFocused()) score += 2000;
            if (score > bestScore) {
                bestScore = score;
                best = cand;
            }
        }

        for (AccessibilityNodeInfo cand : candidates) {
            if (cand != best) cand.recycle();
        }
        return best;
    }

    private void collectEditableNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        CharSequence cls = node.getClassName();
        boolean looksEditable = node.isEditable() || (cls != null && cls.toString().contains("EditText"));
        if (looksEditable && node.isVisibleToUser()) {
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);
            if (bounds.width() > 20 && bounds.height() > 16) {
                out.add(AccessibilityNodeInfo.obtain(node));
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectEditableNodes(child, out);
                child.recycle();
            }
        }
    }

    private boolean clickAnyMatchingButton(String[] labels) {
        for (String label : labels) {
            if (clickNodeByText(label)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 调整媒体音量（1: 音量加 / -1: 音量减 / 0: 静音）
     */
    public String adjustMediaVolume(int direction) {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "无法访问系统音量服务";
            if (direction > 0) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                return "已调高媒体音量";
            } else if (direction < 0) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                return "已调低媒体音量";
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI);
                } else {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_SHOW_UI);
                }
                return "已切换媒体静音状态";
            }
        } catch (Exception e) {
            return "调节音量失败";
        }
    }

    /**
     * 发送系统媒体控制按键（优先通过 QqMusicListenerService 直连控制 QQ 音乐，未授权则自动回落全局媒体键）
     */
    public String dispatchMediaKey(String action) {
        try {
            if (QqMusicListenerService.controlActiveMusic(this, action)) {
                QqMusicListenerService.pollActiveMusicSession(this);
                String label = "next".equals(action) ? "下一首"
                        : ("prev".equals(action) ? "上一首"
                        : ("play".equals(action) ? "播放音乐"
                        : ("pause".equals(action) ? "暂停音乐" : "播放/暂停")));
                return "已控歌：" + label;
            }
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "无法访问媒体控制服务";
            int keyCode = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            String label = "暂停/播放";
            if ("next".equals(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_NEXT;
                label = "下一首";
            } else if ("prev".equals(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS;
                label = "上一首";
            } else if ("play".equals(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_PLAY;
                label = "播放音乐";
            } else if ("pause".equals(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_PAUSE;
                label = "暂停音乐";
            }
            am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
            am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
            return "已发送媒体控制：" + label;
        } catch (Exception e) {
            return "媒体控制发送失败";
        }
    }

    /**
     * 在 QQ 音乐中自动拉起、进入搜索页、输入歌名、精准点击「搜索」并轮询点击结果单曲播放
     */
    public String playSongInQqMusic(final String rawQuery) {
        final String songQuery = rawQuery == null ? "" : rawQuery.trim();
        if (songQuery.isEmpty()) {
            boolean ok = launchAppByName("qq音乐");
            if (ok) {
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        dispatchMediaKey("play");
                    }
                }, 1000);
                return "已打开 QQ 音乐准备播放";
            }
            return "UNMATCHED:手机上未检测到 QQ 音乐";
        }

        final int seq = ++qqMusicOrderSeq;
        FloatAgentService.onExpectedMusicTrack(songQuery);
        boolean launched = launchAppByName("qq音乐");
        if (!launched) {
            return "UNMATCHED:未在手机上找到 QQ 音乐，请确认已安装";
        }

        // Phase 1：轮询等待 QQ 音乐打开并进入包含搜索输入框的界面
        scheduleQqMusicPhase1EnterSearch(seq, songQuery, 0);
        return "正在 QQ 音乐为你点播《" + songQuery + "》并自动搜歌播放…";
    }

    private void scheduleQqMusicPhase1EnterSearch(final int seq, final String songQuery, final int attempt) {
        Runnable task = new Runnable() {
            @Override
            public void run() {
                if (FloatAgentService.sEmergencyStopRequested || seq != qqMusicOrderSeq) return;
                DisplayMetrics dm = getResources().getDisplayMetrics();
                AccessibilityNodeInfo root = getRootInActiveWindow();
                AccessibilityNodeInfo topEdit = findTopSearchEditText(root, dm.heightPixels);
                if (topEdit != null) {
                    Rect edBounds = new Rect();
                    topEdit.getBoundsInScreen(edBounds);
                    topEdit.recycle();
                    if (root != null) root.recycle();
                    performQqMusicPhase2InputAndSearch(seq, songQuery, edBounds);
                    return;
                }
                if (root != null) root.recycle();

                // 尝试点击顶部搜索入口（排除底部导航及不可见区域）
                boolean clickedEntry = clickQqMusicTopSearchEntry(dm.widthPixels, dm.heightPixels);
                if (!clickedEntry && attempt >= 2) {
                    // 兜底点击顶部搜索栏中心位置
                    performClickCoordinate(Math.round(dm.widthPixels * 0.45f), Math.round(dm.heightPixels * 0.10f));
                }

                if (attempt < 6) {
                    scheduleQqMusicPhase1EnterSearch(seq, songQuery, attempt + 1);
                }
            }
        };
        pendingRunnables.add(task);
        mainHandler.postDelayed(task, attempt == 0 ? 1150 : 480);
    }

    private void performQqMusicPhase2InputAndSearch(final int seq, final String songQuery, final Rect edBounds) {
        if (FloatAgentService.sEmergencyStopRequested || seq != qqMusicOrderSeq) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        DisplayMetrics dm = getResources().getDisplayMetrics();
        AccessibilityNodeInfo editNode = findTopSearchEditText(root, dm.heightPixels);
        if (editNode == null) {
            root.recycle();
            return;
        }
        editNode.getBoundsInScreen(edBounds);

        // 先聚焦并点击搜索框确保可激活输入态
        editNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        editNode.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        if (edBounds.width() > 20 && edBounds.height() > 12) {
            performClickCoordinate(edBounds.centerX(), edBounds.centerY());
        }

        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, songQuery);
        boolean setOk = editNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (!setOk) {
            pasteTextViaClipboard(editNode, songQuery, true);
        }
        editNode.recycle();
        root.recycle();

        // 等待 280ms 让 QQ 音乐右上角「取消」按钮刷新成「搜索」按钮并弹出联想列表，再触发搜索提交
        Runnable triggerSearchTask = new Runnable() {
            @Override
            public void run() {
                if (FloatAgentService.sEmergencyStopRequested || seq != qqMusicOrderSeq) return;
                triggerQqMusicSearchSubmit(edBounds, songQuery);
                scheduleQqMusicPhase3WaitResultsAndPlay(seq, songQuery, edBounds, 0);
            }
        };
        pendingRunnables.add(triggerSearchTask);
        mainHandler.postDelayed(triggerSearchTask, 300);
    }

    private void triggerQqMusicSearchSubmit(Rect inputBounds, String songQuery) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        DisplayMetrics dm = getResources().getDisplayMetrics();

        // 1. 精准查找顶部栏右侧的「搜索」提交按钮（严格跳过 EditText 与清空×/取消按钮）
        Rect searchBtnBounds = findQqMusicRightSearchButton(root, inputBounds, dm.widthPixels, dm.heightPixels);
        boolean clickedSearchBtn = false;
        if (searchBtnBounds != null) {
            clickedSearchBtn = performClickCoordinate(searchBtnBounds.centerX(), searchBtnBounds.centerY());
        }

        // 2. 同步派发软键盘搜索动作（IME_ENTER / IME_ACTION），双保险防止单独按钮被拦截
        dispatchImeEnterOnFocused(root);

        // 3. 若未找到顶部「搜索」文字按钮，尝试点击搜索框正下方第一条「搜索“xxx”」联想条
        if (!clickedSearchBtn) {
            Rect suggestBounds = findNodeBoundsInVerticalRange(root, "搜索",
                    inputBounds.bottom + 4, Math.round(dm.heightPixels * 0.42f), false);
            if (suggestBounds != null) {
                performClickCoordinate(suggestBounds.centerX(), suggestBounds.centerY());
            } else {
                // 常见 QQ 音乐右上角「搜索」纯文本区域兜底坐标（避开输入框内清空×）
                performClickCoordinate(Math.round(dm.widthPixels * 0.90f), Math.max(inputBounds.centerY(), Math.round(dm.heightPixels * 0.09f)));
            }
        }
        root.recycle();
    }

    private void scheduleQqMusicPhase3WaitResultsAndPlay(final int seq, final String songQuery, final Rect inputBounds, final int attempt) {
        Runnable task = new Runnable() {
            @Override
            public void run() {
                if (FloatAgentService.sEmergencyStopRequested || seq != qqMusicOrderSeq) return;
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null) return;
                DisplayMetrics dm = getResources().getDisplayMetrics();

                boolean hasResultsTab = hasAnyVisibleTextInRegion(root,
                        new String[]{"综合", "歌曲", "歌单", "单曲", "播放全部", "专辑", "歌手"},
                        Math.round(dm.heightPixels * 0.10f), Math.round(dm.heightPixels * 0.55f));
                int minResultY = Math.max(inputBounds.bottom + 90, Math.round(dm.heightPixels * 0.23f));

                if (hasResultsTab) {
                    // 1. 先检查「综合」页是否存在「单曲」分段标题（其上方常有歌手卡、歌单卡，必须跳过并点到下面的单曲区！）
                    Rect singleSectionHdr = findNodeBoundsInVerticalRange(root, "单曲",
                            Math.round(dm.heightPixels * 0.24f), Math.round(dm.heightPixels * 0.68f), true);
                    int songMinY = minResultY;
                    if (singleSectionHdr != null) {
                        songMinY = Math.max(minResultY, singleSectionHdr.bottom + 14);
                    } else {
                        // 无「单曲」分段且当前还处于「综合」页（有歌手/歌单干扰卡）时，优先切换到「歌曲」Tab 列表更纯净
                        Rect songsTab = findNodeBoundsInVerticalRange(root, "歌曲",
                                Math.round(dm.heightPixels * 0.10f), Math.round(dm.heightPixels * 0.24f), true);
                        boolean hasTopCards = hasAnyVisibleTextInRegion(root,
                                new String[]{"歌单", "歌手"},
                                Math.round(dm.heightPixels * 0.16f), Math.round(dm.heightPixels * 0.44f));
                        if (songsTab != null && hasTopCards && attempt <= 2) {
                            performClickCoordinate(songsTab.centerX(), songsTab.centerY());
                            root.recycle();
                            scheduleQqMusicPhase3WaitResultsAndPlay(seq, songQuery, inputBounds, attempt + 1);
                            return;
                        }
                    }

                    // 2. 在单曲区块下方精准匹配目标歌曲名（避开上方歌手/歌单卡与底部 mini 播放条）
                    int songMaxY = Math.round(dm.heightPixels * 0.85f);
                    Rect songRowBounds = findQqMusicSongResultRow(root, songQuery, songMinY, songMaxY);
                    if (songRowBounds != null) {
                        performClickCoordinate(songRowBounds.centerX(), songRowBounds.centerY());
                        root.recycle();
                        scheduleQqMusicPhase4VerifyPlay(seq, songQuery, songMinY, 0);
                        return;
                    }

                    // 3. 若能定位到「单曲」分段标题但找不到歌名节点，点「单曲」右侧整区播放按钮或标题正下方第一首行
                    if (singleSectionHdr != null) {
                        performClickCoordinate(Math.round(dm.widthPixels * 0.36f),
                                Math.min(songMaxY - 30, singleSectionHdr.bottom + Math.round(dm.heightPixels * 0.055f)));
                        root.recycle();
                        scheduleQqMusicPhase4VerifyPlay(seq, songQuery, songMinY, 0);
                        return;
                    }

                    Rect playAllBounds = findNodeBoundsInVerticalRange(root, "播放全部", songMinY, songMaxY, false);
                    if (playAllBounds != null) {
                        performClickCoordinate(playAllBounds.centerX(), playAllBounds.centerY());
                        root.recycle();
                        scheduleQqMusicPhase4VerifyPlay(seq, songQuery, songMinY, 0);
                        return;
                    }
                } else if (attempt == 1 || attempt == 3) {
                    // 停留在联想输入页未跳转时补点一次搜索
                    root.recycle();
                    triggerQqMusicSearchSubmit(inputBounds, songQuery);
                    scheduleQqMusicPhase3WaitResultsAndPlay(seq, songQuery, inputBounds, attempt + 1);
                    return;
                }

                root.recycle();
                if (attempt < 7) {
                    scheduleQqMusicPhase3WaitResultsAndPlay(seq, songQuery, inputBounds, attempt + 1);
                } else {
                    // 最后兜底：点到下面单曲区域（约 y=0.50h，避开上面歌手/歌单推荐卡）
                    performClickCoordinate(Math.round(dm.widthPixels * 0.36f), Math.round(dm.heightPixels * 0.50f));
                    scheduleQqMusicPhase4VerifyPlay(seq, songQuery, Math.round(dm.heightPixels * 0.42f), 1);
                }
            }
        };
        pendingRunnables.add(task);
        mainHandler.postDelayed(task, attempt == 0 ? 780 : 620);
    }

    private void scheduleQqMusicPhase4VerifyPlay(final int seq, final String songQuery, final int minResultY, final int retry) {
        Runnable verifyTask = new Runnable() {
            @Override
            public void run() {
                if (FloatAgentService.sEmergencyStopRequested || seq != qqMusicOrderSeq) return;
                QqMusicListenerService.pollActiveMusicSession(AgentAccessibilityService.this);
                boolean playing = false;
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    playing = (am != null && am.isMusicActive());
                } catch (Exception ignored) {}

                if (playing) {
                    return;
                }

                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    DisplayMetrics dm = getResources().getDisplayMetrics();
                    Rect singleSectionHdr = findNodeBoundsInVerticalRange(root, "单曲",
                            Math.round(dm.heightPixels * 0.24f), Math.round(dm.heightPixels * 0.68f), true);
                    int effectiveMinY = (singleSectionHdr != null)
                            ? Math.max(minResultY, singleSectionHdr.bottom + 14)
                            : minResultY;
                    int maxResultY = Math.round(dm.heightPixels * 0.85f);

                    Rect playBtn = findNodeBoundsInVerticalRange(root, "播放全部", effectiveMinY, maxResultY, false);
                    if (playBtn == null) {
                        playBtn = findNodeBoundsInVerticalRange(root, "播放", effectiveMinY, maxResultY, true);
                    }
                    if (playBtn != null) {
                        performClickCoordinate(playBtn.centerX(), playBtn.centerY());
                    } else if (retry == 0) {
                        Rect songRow = findQqMusicSongResultRow(root, songQuery, effectiveMinY, maxResultY);
                        if (songRow != null) {
                            performClickCoordinate(songRow.centerX(), songRow.centerY());
                        } else if (singleSectionHdr != null) {
                            performClickCoordinate(Math.round(dm.widthPixels * 0.36f),
                                    Math.min(maxResultY - 30, singleSectionHdr.bottom + Math.round(dm.heightPixels * 0.055f)));
                        } else {
                            performClickCoordinate(Math.round(dm.widthPixels * 0.36f), Math.round(dm.heightPixels * 0.50f));
                        }
                    }
                    root.recycle();
                }

                if (retry < 1) {
                    scheduleQqMusicPhase4VerifyPlay(seq, songQuery, minResultY, retry + 1);
                }
            }
        };
        pendingRunnables.add(verifyTask);
        mainHandler.postDelayed(verifyTask, 1100);
    }

    private AccessibilityNodeInfo findTopSearchEditText(AccessibilityNodeInfo root, int screenHeight) {
        if (root == null) return null;
        List<AccessibilityNodeInfo> edits = new ArrayList<>();
        collectEditableNodes(root, edits);
        AccessibilityNodeInfo best = null;
        int bestY = Integer.MAX_VALUE;
        String selfPkg = getPackageName();
        for (AccessibilityNodeInfo ed : edits) {
            CharSequence pkg = ed.getPackageName();
            if (selfPkg != null && pkg != null && selfPkg.equals(pkg.toString())) continue;
            Rect r = new Rect();
            ed.getBoundsInScreen(r);
            if (r.top >= 0 && r.centerY() < Math.round(screenHeight * 0.28f) && r.centerY() < bestY) {
                bestY = r.centerY();
                best = ed;
            }
        }
        for (AccessibilityNodeInfo ed : edits) {
            if (ed != best) ed.recycle();
        }
        return best;
    }

    private boolean clickQqMusicTopSearchEntry(int screenWidth, int screenHeight) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        int maxTopY = Math.round(screenHeight * 0.24f);
        Rect entry = findNodeBoundsInVerticalRange(root, "大家都在搜", 0, maxTopY, false);
        if (entry == null) entry = findNodeBoundsInVerticalRange(root, "搜索", 0, maxTopY, false);
        if (entry == null) entry = findNodeBoundsInVerticalRange(root, "搜一搜", 0, maxTopY, false);
        if (entry == null) entry = findNodeBoundsInVerticalRange(root, "Search", 0, maxTopY, false);
        root.recycle();
        if (entry != null && entry.centerX() <= Math.round(screenWidth * 0.96f)) {
            return performClickCoordinate(entry.centerX(), entry.centerY());
        }
        return false;
    }

    private Rect findQqMusicRightSearchButton(AccessibilityNodeInfo node, Rect inputBounds, int screenWidth, int screenHeight) {
        if (node == null) return null;
        List<AccessibilityNodeInfo> hits = new ArrayList<>();
        collectQqSearchBtnNodes(node, hits, inputBounds, screenWidth, screenHeight);
        Rect bestBounds = null;
        int bestScore = Integer.MIN_VALUE;
        for (AccessibilityNodeInfo cand : hits) {
            Rect r = new Rect();
            cand.getBoundsInScreen(r);
            String t = cand.getText() != null ? cand.getText().toString().trim() : "";
            String d = cand.getContentDescription() != null ? cand.getContentDescription().toString().trim() : "";
            String id = cand.getViewIdResourceName() != null ? cand.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            int score = 0;
            if ("搜索".equals(t) || "Search".equalsIgnoreCase(t) || "搜索".equals(d)) score += 600;
            else if (id.contains("search")) score += 350;
            if (r.centerX() > Math.round(screenWidth * 0.72f)) score += 350;
            if (r.left >= inputBounds.right - 20) score += 300;
            if (cand.isClickable()) score += 150;
            if (score > bestScore) {
                bestScore = score;
                bestBounds = r;
            }
            cand.recycle();
        }
        return bestBounds;
    }

    private void collectQqSearchBtnNodes(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out, Rect inputBounds, int screenWidth, int screenHeight) {
        if (node == null || out.size() >= 10) return;
        if (node.isVisibleToUser()) {
            String t = node.getText() != null ? node.getText().toString().trim() : "";
            String d = node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "";
            String id = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            if (!isExcludedActionNode(node, t, d, id)) {
                Rect r = new Rect();
                node.getBoundsInScreen(r);
                int maxTopY = Math.max(inputBounds.bottom + 70, Math.round(screenHeight * 0.24f));
                boolean inTopRightBar = r.centerY() >= 0 && r.centerY() <= maxTopY && r.centerX() >= Math.round(screenWidth * 0.62f);
                boolean looksLikeSearch = "搜索".equals(t) || "Search".equalsIgnoreCase(t)
                        || "搜索".equals(d) || "Search".equalsIgnoreCase(d)
                        || (id.contains("search") && !id.contains("edit") && !id.contains("input") && !id.contains("bar"));
                if (inTopRightBar && looksLikeSearch && r.width() > 16 && r.height() > 16) {
                    out.add(AccessibilityNodeInfo.obtain(node));
                }
            }
        }
        int c = node.getChildCount();
        for (int i = 0; i < c && out.size() < 10; i++) {
            AccessibilityNodeInfo ch = node.getChild(i);
            if (ch != null) {
                collectQqSearchBtnNodes(ch, out, inputBounds, screenWidth, screenHeight);
                ch.recycle();
            }
        }
    }

    private boolean hasAnyVisibleTextInRegion(AccessibilityNodeInfo node, String[] targets, int minY, int maxY) {
        if (node == null) return false;
        if (node.isVisibleToUser() && !node.isEditable()) {
            String t = node.getText() != null ? node.getText().toString().trim() : "";
            String d = node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "";
            Rect r = new Rect();
            node.getBoundsInScreen(r);
            if (r.centerY() >= minY && r.centerY() <= maxY) {
                for (String kw : targets) {
                    if (t.equals(kw) || d.equals(kw) || t.contains(kw)) {
                        return true;
                    }
                }
            }
        }
        int c = node.getChildCount();
        for (int i = 0; i < c; i++) {
            AccessibilityNodeInfo ch = node.getChild(i);
            if (ch != null) {
                boolean hit = hasAnyVisibleTextInRegion(ch, targets, minY, maxY);
                ch.recycle();
                if (hit) return true;
            }
        }
        return false;
    }

    private Rect findNodeBoundsInVerticalRange(AccessibilityNodeInfo node, String query, int minY, int maxY, boolean exactFirst) {
        if (node == null || query == null || query.isEmpty()) return null;
        if (node.isVisibleToUser() && !node.isEditable()) {
            String t = node.getText() != null ? node.getText().toString().trim() : "";
            String d = node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "";
            String id = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            if (!isExcludedActionNode(node, t, d, id)) {
                boolean match = exactFirst ? (t.equals(query) || d.equals(query))
                        : (t.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT))
                        || d.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT)));
                if (match) {
                    Rect r = new Rect();
                    node.getBoundsInScreen(r);
                    if (r.width() > 14 && r.height() > 14 && r.centerY() >= minY && r.centerY() <= maxY) {
                        return r;
                    }
                }
            }
        }
        int c = node.getChildCount();
        for (int i = 0; i < c; i++) {
            AccessibilityNodeInfo ch = node.getChild(i);
            if (ch != null) {
                Rect r = findNodeBoundsInVerticalRange(ch, query, minY, maxY, exactFirst);
                ch.recycle();
                if (r != null) return r;
            }
        }
        return null;
    }

    private Rect findQqMusicSongResultRow(AccessibilityNodeInfo root, String songQuery, int minY, int maxY) {
        String[] parts = songQuery.trim().split("\\s+");
        String coreTitle = parts.length > 1 ? parts[parts.length - 1] : songQuery.trim();
        Rect hit = findSongCardBoundsRec(root, songQuery.trim().toLowerCase(Locale.ROOT), coreTitle.toLowerCase(Locale.ROOT), minY, maxY);
        return hit;
    }

    private Rect findSongCardBoundsRec(AccessibilityNodeInfo node, String fullLower, String coreLower, int minY, int maxY) {
        if (node == null) return null;
        if (node.isVisibleToUser() && !node.isEditable()) {
            String t = node.getText() != null ? node.getText().toString().trim() : "";
            String d = node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "";
            String tl = t.toLowerCase(Locale.ROOT);
            String dl = d.toLowerCase(Locale.ROOT);
            boolean matched = (!tl.isEmpty() && (tl.contains(fullLower) || tl.contains(coreLower)))
                    || (!dl.isEmpty() && (dl.contains(fullLower) || dl.contains(coreLower)));
            if (matched && !t.startsWith("搜索")) {
                Rect r = new Rect();
                node.getBoundsInScreen(r);
                if (r.width() > 24 && r.height() > 16 && r.centerY() >= minY && r.centerY() <= maxY) {
                    return r;
                }
            }
        }
        int c = node.getChildCount();
        for (int i = 0; i < c; i++) {
            AccessibilityNodeInfo ch = node.getChild(i);
            if (ch != null) {
                Rect r = findSongCardBoundsRec(ch, fullLower, coreLower, minY, maxY);
                ch.recycle();
                if (r != null) return r;
            }
        }
        return null;
    }

    /**
     * 丰富免 API 本地规则执行引擎：无需配置任何 API Key 即可完成日常控制、智能打字、刷视频与组合宏
     */
    public String executeLocalRule(String rawCmd) {
        if (rawCmd == null || rawCmd.trim().isEmpty()) {
            return "请输入命令";
        }
        String trimmedRaw = rawCmd.trim();
        String cmd = trimmedRaw.toLowerCase(Locale.ROOT);
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;

        // 0. 多步离线组合宏（仅当拆出的每一步都可被本地离线规则独立处理时才整组执行，否则交还 AI 大模型）
        if (trimmedRaw.contains("然后") || trimmedRaw.contains("接着")
                || trimmedRaw.contains("之后") || trimmedRaw.contains("并且")
                || trimmedRaw.contains(";") || trimmedRaw.contains("；")) {
            String[] parts = trimmedRaw.split("(?:然后|接着|之后|并且|[;；])+");
            List<String> validSteps = new ArrayList<>();
            for (String p : parts) {
                String cleanPart = p != null ? p.trim() : "";
                if (!cleanPart.isEmpty()) {
                    validSteps.add(cleanPart);
                }
            }
            if (validSteps.size() >= 2 && validSteps.size() <= 6) {
                for (String stepItem : validSteps) {
                    if (!canHandleAtomicLocalStep(stepItem)) {
                        return "UNMATCHED:步骤「" + stepItem + "」包含复杂动态语义，需交由大模型识屏规划执行";
                    }
                }
                return executeLocalMacroSteps(validSteps);
            }
        }

        // 1. 停止自动任务 & 刷视频控制族
        if (cmd.contains("停止刷") || cmd.contains("别刷") || cmd.contains("停刷")
                || cmd.contains("停止连刷") || cmd.contains("停止自动") || cmd.equals("停止")) {
            stopAllBackgroundTasks("口令停止");
            FloatAgentService.updateState("idle", "星语 AI");
            return "已停止自动刷视频及后台手势任务";
        }

        if (isAutoVideoSwipeCommand(cmd)) {
            int count = extractNumberByRegex(trimmedRaw, "(\\d+)\\s*(?:个|条|次)", 20);
            int intervalSec = extractNumberByRegex(trimmedRaw, "(?:每|间隔)\\s*(\\d+)\\s*秒", 8);
            boolean randomLike = cmd.contains("点赞") || cmd.contains("赞");

            String appToLaunch = null;
            if (cmd.contains("抖音极速版")) appToLaunch = "抖音极速版";
            else if (cmd.contains("抖音")) appToLaunch = "抖音";
            else if (cmd.contains("快手极速版")) appToLaunch = "快手极速版";
            else if (cmd.contains("快手")) appToLaunch = "快手";
            else if (cmd.contains("小红书")) appToLaunch = "小红书";
            else if (cmd.contains("b站") || cmd.contains("哔哩哔哩")) appToLaunch = "B站";

            if (appToLaunch != null) {
                boolean launched = launchAppByName(appToLaunch);
                if (!launched) {
                    return "未找到或无法打开「" + appToLaunch + "」";
                }
                final int fCount = count;
                final int fSec = intervalSec;
                final boolean fLike = randomLike;
                Runnable startTask = new Runnable() {
                    @Override
                    public void run() {
                        if (!FloatAgentService.sEmergencyStopRequested) {
                            startAutoSwipeVideos(fCount, fSec, fLike);
                        }
                    }
                };
                pendingRunnables.add(startTask);
                mainHandler.postDelayed(startTask, 2400);
                return "已打开「" + appToLaunch + "」，将在 2.4 秒后自动连刷 " + fCount + " 条视频（每 " + fSec + " 秒）";
            }
            return startAutoSwipeVideos(count, intervalSec, randomLike);
        }

        // 单步短视频手势
        if (cmd.equals("下一个视频") || cmd.equals("刷下一个") || cmd.equals("换一个") || cmd.equals("下一个") || cmd.equals("下个视频")) {
            boolean ok = performVideoSwipeNext();
            return ok ? "已切到下一个视频" : "切换下一个视频失败";
        }
        if (cmd.equals("上一个视频") || cmd.equals("回看上一个") || cmd.equals("上一个") || cmd.equals("上个视频")) {
            boolean ok = performVideoSwipePrev();
            return ok ? "已切回上一个视频" : "切换上一个视频失败";
        }
        if (cmd.equals("双击点赞") || cmd.equals("点赞") || cmd.equals("点红心") || cmd.equals("点个赞") || cmd.equals("喜欢")) {
            boolean ok = performDoubleClickCenter();
            return ok ? "已在屏幕中心双击点赞" : "双击点赞失败";
        }
        if (cmd.equals("暂停视频") || cmd.equals("播放视频") || cmd.equals("暂停播放") || cmd.equals("暂停/播")) {
            boolean ok = performTapCenter();
            return ok ? "已切换视频播放/暂停" : "切换播放状态失败";
        }
        if (cmd.equals("看评论") || cmd.equals("打开评论") || cmd.equals("评论区")) {
            boolean ok = clickAnyMatchingButton(new String[]{"评论", "抢首评", "写评论"});
            return ok ? "已尝试打开评论区" : "当前屏幕未找到评论按钮";
        }
        if (cmd.equals("点收藏") || cmd.equals("收藏视频") || cmd.equals("收藏")) {
            boolean ok = clickAnyMatchingButton(new String[]{"收藏"});
            return ok ? "已点击收藏" : "当前屏幕未找到收藏按钮";
        }
        if (cmd.equals("点关注") || cmd.equals("关注作者")) {
            boolean ok = clickAnyMatchingButton(new String[]{"关注", "+ 关注"});
            return ok ? "已点击关注" : "当前屏幕未找到关注按钮";
        }
        if (cmd.equals("分享视频") || cmd.equals("转发视频") || cmd.equals("转发")) {
            boolean ok = clickAnyMatchingButton(new String[]{"分享", "转发"});
            return ok ? "已点击分享/转发" : "当前屏幕未找到分享按钮";
        }

        // 2. 系统全局、截屏锁屏、媒体与音量控制
        if (cmd.contains("桌面") || cmd.contains("主屏") || cmd.equals("home")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_HOME);
            return ok ? "已返回手机桌面" : "返回桌面失败";
        }
        if (cmd.equals("返回") || cmd.equals("后退") || cmd.equals("上一页") || cmd.equals("back")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_BACK);
            return ok ? "已执行系统返回键" : "返回键执行失败";
        }
        if (cmd.contains("切回上个") || cmd.contains("上个应用") || cmd.contains("切上个app") || cmd.contains("切换应用")) {
            boolean ok = performGlobal("switch_last_app");
            return ok ? "已切换到上一个应用" : "切换上个应用失败";
        }
        if (cmd.contains("任务") || cmd.contains("后台") || cmd.contains("最近") || cmd.equals("recents")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_RECENTS);
            return ok ? "已呼出多任务后台" : "呼出后台失败";
        }
        if (cmd.contains("控制中心") || cmd.contains("快捷开关") || cmd.contains("快捷设置")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            return ok ? "已下拉系统控制中心" : "下拉控制中心失败";
        }
        if (cmd.contains("通知") || cmd.equals("notifications")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            return ok ? "已下拉通知栏" : "下拉通知栏失败";
        }
        if (cmd.equals("截屏") || cmd.equals("截图") || cmd.equals("屏幕截图") || cmd.equals("截一张图")) {
            boolean ok = performGlobal("screenshot");
            return ok ? "已触发系统截屏" : "系统截屏需要 Android 9.0 及以上系统支持";
        }
        if (cmd.equals("锁屏") || cmd.equals("息屏") || cmd.equals("锁定屏幕")) {
            boolean ok = performGlobal("lock_screen");
            return ok ? "已锁定屏幕" : "锁屏需要 Android 9.0 及以上系统支持";
        }
        if (cmd.equals("电源菜单") || cmd.equals("关机菜单")) {
            boolean ok = performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
            return ok ? "已呼出系统电源菜单" : "呼出电源菜单失败";
        }
        if (cmd.contains("音量+") || cmd.contains("音量加") || cmd.contains("大声") || cmd.contains("增大音量") || cmd.contains("调大音量")) {
            return adjustMediaVolume(1);
        }
        if (cmd.contains("音量-") || cmd.contains("音量减") || cmd.contains("小声") || cmd.contains("降低音量") || cmd.contains("调小音量")) {
            return adjustMediaVolume(-1);
        }
        if (cmd.equals("静音") || cmd.equals("取消静音") || cmd.equals("切换静音")) {
            return adjustMediaVolume(0);
        }
        if (cmd.equals("下一首") || cmd.equals("下一首歌") || cmd.equals("切歌") || cmd.equals("换首歌") || cmd.equals("换一首歌")) {
            return dispatchMediaKey("next");
        }
        if (cmd.equals("上一首") || cmd.equals("上一首歌")) {
            return dispatchMediaKey("prev");
        }
        if (cmd.equals("暂停音乐") || cmd.equals("停一下音乐") || cmd.equals("停止放歌")) {
            return dispatchMediaKey("pause");
        }
        if (cmd.equals("播放音乐") || cmd.equals("继续播放") || cmd.equals("继续放歌") || cmd.equals("音乐暂停")) {
            return dispatchMediaKey("toggle");
        }
        if (cmd.matches("^(?:用qq音乐|在qq音乐|qq音乐)?\\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)\\s*.+$")
                && !cmd.contains("视频")) {
            String songKw = trimmedRaw
                    .replaceFirst("^(?:用[qQ]{2}音乐|在[qQ]{2}音乐|[qQ]{2}音乐)?\\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)(?:音乐|歌曲|歌)?\\s*(?:的)?\\s*", "")
                    .trim();
            if (!songKw.isEmpty() && !songKw.equals("歌") && !songKw.equals("一首歌") && !songKw.equals("首歌") && !songKw.equals("音乐")) {
                return playSongInQqMusic(songKw);
            }
        }
        if (cmd.equals("读屏幕") || cmd.equals("读取屏幕") || cmd.equals("查看屏幕")) {
            return summarizeCurrentScreen();
        }

        // 3. 智能打字、输入并发送、追加、清空、粘贴、搜索
        if (cmd.startsWith("输入并发送") || cmd.startsWith("打字并发送") || cmd.startsWith("发送消息")
                || cmd.startsWith("发消息") || cmd.startsWith("发送文字") || cmd.startsWith("回复 ") || cmd.startsWith("评论 ")) {
            final String content = trimmedRaw.replaceFirst("^(输入并发送|打字并发送|发送消息|发消息|发送文字|回复|评论)\\s*", "").trim();
            if (content.isEmpty()) {
                return "UNMATCHED:请在口令后加上要发送的内容，例如「打字并发送 我马上到」";
            }
            boolean ok = performSmartInputText(null, content, false, true);
            return ok ? "已输入并尝试发送「" + content + "」" : "UNMATCHED:当前屏幕未找到可输入的文本框";
        }

        if (cmd.startsWith("追加输入") || cmd.startsWith("接着打字") || cmd.startsWith("接着输入") || cmd.startsWith("追加 ")) {
            final String content = trimmedRaw.replaceFirst("^(追加输入|接着打字|接着输入|追加)\\s*", "").trim();
            if (content.isEmpty()) {
                return "UNMATCHED:请在「追加输入」后加上文字内容";
            }
            boolean ok = performSmartInputText(null, content, true, false);
            return ok ? "已在原有内容后追加「" + content + "」" : "UNMATCHED:当前屏幕未找到可输入的文本框";
        }

        if (cmd.equals("清空输入框") || cmd.equals("清空输入") || cmd.equals("清空文字") || cmd.equals("清除输入") || cmd.equals("删掉输入")) {
            boolean ok = performSmartInputText(null, "", false, false);
            return ok ? "已清空当前输入框内容" : "UNMATCHED:当前屏幕未找到可清空的输入框";
        }

        if (cmd.equals("粘贴") || cmd.equals("粘贴剪贴板") || cmd.equals("粘贴文字")) {
            boolean ok = pasteFromClipboard();
            return ok ? "已将剪贴板内容粘贴到输入框" : "粘贴失败，请确认输入框可编辑且剪贴板有内容";
        }

        if (cmd.startsWith("搜一下") || cmd.startsWith("搜索") || cmd.startsWith("查一下") || cmd.startsWith("查找")) {
            final String kw = trimmedRaw.replaceFirst("^(搜一下|搜索|查一下|查找)\\s*", "").trim();
            if (kw.isEmpty()) {
                boolean ok = clickAnyMatchingButton(new String[]{"搜索", "查找", "搜"});
                return ok ? "已点击搜索入口" : "当前屏幕未找到搜索按钮";
            }
            // 若当前已有可见输入框直接填入提交；否则先点“搜索”图标再填入
            AccessibilityNodeInfo root = getRootInActiveWindow();
            AccessibilityNodeInfo existingEdit = root != null ? findEditableTarget(root, null) : null;
            boolean hasEdit = existingEdit != null;
            if (existingEdit != null) existingEdit.recycle();
            if (root != null) root.recycle();

            if (hasEdit) {
                boolean ok = performSmartInputText(null, kw, false, true);
                return ok ? "已填入搜索词「" + kw + "」并尝试搜索" : "搜索填入失败";
            } else if (clickAnyMatchingButton(new String[]{"搜索", "查找", "搜"})) {
                Runnable searchTask = new Runnable() {
                    @Override
                    public void run() {
                        if (!FloatAgentService.sEmergencyStopRequested) {
                            performSmartInputText(null, kw, false, true);
                        }
                    }
                };
                pendingRunnables.add(searchTask);
                mainHandler.postDelayed(searchTask, 620);
                return "已打开搜索栏，正在输入并搜索「" + kw + "」";
            }
            return "UNMATCHED:未找到搜索栏或输入框";
        }

        if (cmd.startsWith("帮我打字") || cmd.startsWith("输入") || cmd.startsWith("填入") || cmd.startsWith("打字") || cmd.startsWith("写字")) {
            final String textToInput = trimmedRaw.replaceFirst("^(帮我打字|输入|填入|打字|写字)\\s*", "").trim();
            if (textToInput.isEmpty()) {
                return "UNMATCHED:请在「打字」后加上要输入的文字，例如「打字 今天天气真好」";
            }
            boolean ok = performSmartInputText(null, textToInput, false, false);
            return ok ? "已在输入框打字填入「" + textToInput + "」" : "UNMATCHED:当前屏幕未找到处于焦点或可编辑的输入框";
        }

        // 4. 滑动手势与多次滚动
        if (cmd.equals("回到顶部") || cmd.equals("滚到顶部") || cmd.equals("回顶部") || cmd.equals("最上面")) {
            boolean ok = performMultiSwipe("up", 3);
            return ok ? "已连续上滑回到页面顶部" : "回到顶部失败";
        }
        if (cmd.equals("滑到底部") || cmd.equals("滚到底部") || cmd.equals("最下面")) {
            boolean ok = performMultiSwipe("down", 3);
            return ok ? "已连续下滑浏览底部" : "滑到底部失败";
        }
        if (cmd.contains("下滑") || cmd.contains("向下") || cmd.contains("下翻") || cmd.contains("翻下") || cmd.contains("看下面")) {
            int times = extractNumberByRegex(trimmedRaw, "(\\d+)\\s*次", 1);
            boolean ok = performMultiSwipe("down", times);
            return ok ? (times > 1 ? "已连续向下翻页 " + times + " 次" : "已向下翻页浏览") : "向下滑动失败";
        }
        if (cmd.contains("上滑") || cmd.contains("向上") || cmd.contains("上翻") || cmd.contains("翻上") || cmd.contains("看上面")) {
            int times = extractNumberByRegex(trimmedRaw, "(\\d+)\\s*次", 1);
            boolean ok = performMultiSwipe("up", times);
            return ok ? (times > 1 ? "已连续向上翻页 " + times + " 次" : "已向上翻页浏览") : "向上滑动失败";
        }
        if (cmd.contains("左滑") || cmd.contains("向左")) {
            int times = extractNumberByRegex(trimmedRaw, "(\\d+)\\s*次", 1);
            boolean ok = performMultiSwipe("left", times);
            return ok ? "已向左滑动" : "向左滑动失败";
        }
        if (cmd.contains("右滑") || cmd.contains("向右")) {
            int times = extractNumberByRegex(trimmedRaw, "(\\d+)\\s*次", 1);
            boolean ok = performMultiSwipe("right", times);
            return ok ? "已向右滑动" : "向右滑动失败";
        }

        // 5. 动态打开任意已安装应用（前缀匹配 + 热门直呼；若包含复杂后续目标语义则跳过，交还大模型处理）
        if (cmd.startsWith("打开") || cmd.startsWith("启动") || cmd.startsWith("进入") || cmd.startsWith("运行")
                || isDirectAppShortcut(cmd)) {
            String targetApp = trimmedRaw.replaceFirst("^(打开|启动|进入|运行)\\s*", "").trim();
            if (isPureTargetAppName(targetApp) && launchAppByName(targetApp)) {
                return "已打开应用「" + targetApp + "」";
            }
        }

        // 6. 点击 / 长按 / 双击屏幕控件或中心
        if (cmd.equals("点中间") || cmd.equals("点击中间")) {
            boolean ok = performClickCoordinate(width / 2, height / 2);
            return ok ? "已点击屏幕中心" : "点击屏幕中心失败";
        }
        if (trimmedRaw.startsWith("长按")) {
            String targetText = trimmedRaw.substring(2).trim();
            if (!targetText.isEmpty() && longClickNodeByText(targetText)) {
                return "已定位并长按「" + targetText + "」";
            }
        }
        if (trimmedRaw.startsWith("双击")) {
            String targetText = trimmedRaw.substring(2).trim();
            if (!targetText.isEmpty() && doubleClickNodeByText(targetText)) {
                return "已定位并双击「" + targetText + "」";
            }
        }

        String targetText = trimmedRaw;
        if (targetText.startsWith("点一下")) targetText = targetText.substring(3).trim();
        else if (targetText.startsWith("点击")) targetText = targetText.substring(2).trim();
        else if (targetText.startsWith("按下")) targetText = targetText.substring(2).trim();
        else if (targetText.startsWith("点")) targetText = targetText.substring(1).trim();

        if (!targetText.isEmpty() && (trimmedRaw.startsWith("点一下") || trimmedRaw.startsWith("点击")
                || trimmedRaw.startsWith("点") || trimmedRaw.startsWith("按下"))) {
            boolean clickOk = clickNodeByText(targetText);
            if (clickOk) {
                return "已定位并点击「" + targetText + "」";
            }
        }

        return "UNMATCHED:离线未匹配。可试：打字 [内容]、输入并发送 [内容]、自动刷视频、下一个视频、双击点赞、搜索 [词]、打开 [App]、截屏、下滑3次";
    }

    private String executeLocalMacroSteps(final List<String> steps) {
        macroRunning = true;
        FloatAgentService.sEmergencyStopRequested = false;
        long offsetMs = 0L;
        for (int i = 0; i < steps.size(); i++) {
            final String stepCmd = steps.get(i);
            final int idx = i + 1;
            final int total = steps.size();
            Runnable task = new Runnable() {
                @Override
                public void run() {
                    if (!macroRunning || FloatAgentService.sEmergencyStopRequested) return;
                    FloatAgentService.updateState("executing", "宏 " + idx + "/" + total + ": " + stepCmd);
                    executeLocalRule(stepCmd);
                    if (idx == total && !autoSwipeRunning && !FloatAgentService.sEmergencyStopRequested) {
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                if (!autoSwipeRunning && !FloatAgentService.sEmergencyStopRequested) {
                                    FloatAgentService.updateState("idle", "星语 AI");
                                }
                            }
                        }, 600);
                    }
                }
            };
            pendingRunnables.add(task);
            mainHandler.postDelayed(task, offsetMs);
            String lower = stepCmd.toLowerCase(Locale.ROOT);
            if (lower.startsWith("打开") || lower.startsWith("启动") || lower.startsWith("进入")) {
                offsetMs += 1900L;
            } else if (lower.startsWith("搜索") || lower.startsWith("搜一下") || lower.startsWith("输入") || lower.startsWith("打字")) {
                offsetMs += 1000L;
            } else {
                offsetMs += 700L;
            }
        }
        return "已启动 " + steps.size() + " 步离线组合指令：" + String.join(" → ", steps);
    }

    private boolean isAutoVideoSwipeCommand(String cmd) {
        if (cmd.contains("自动刷") || cmd.contains("连刷") || cmd.contains("连续刷")
                || cmd.contains("定时刷") || cmd.contains("挂机刷")) {
            return true;
        }
        if (cmd.matches(".*刷\\s*\\d+\\s*(?:个|条).*视频.*")) return true;
        if (cmd.equals("刷视频") || cmd.equals("刷抖音") || cmd.equals("刷快手")
                || cmd.equals("刷小红书") || cmd.equals("刷b站") || cmd.equals("刷哔哩哔哩")
                || cmd.equals("开始刷视频") || cmd.equals("帮我刷视频") || cmd.equals("帮我刷抖音")) {
            return true;
        }
        return false;
    }

    private boolean isPureTargetAppName(String targetApp) {
        if (targetApp == null) return false;
        String clean = targetApp.trim();
        if (clean.isEmpty() || clean.length() > 16) return false;
        if (clean.contains(" ") || clean.contains("，") || clean.contains(",") || clean.contains("。")) {
            return false;
        }
        String[] complexMarkers = new String[]{"帮我", "发给", "发送给", "回复", "查找", "查一下", "搜索", "看看", "点外卖", "下订单", "挑选", "对比"};
        for (String marker : complexMarkers) {
            if (clean.contains(marker)) return false;
        }
        return true;
    }

    public boolean canHandleAtomicLocalStep(String rawStep) {
        if (rawStep == null) return false;
        String trimmed = rawStep.trim();
        if (trimmed.isEmpty() || trimmed.length() > 36) return false;
        String cmd = trimmed.toLowerCase(Locale.ROOT);
        if (cmd.contains("帮我") || cmd.contains("发给") || cmd.contains("发送给") || cmd.contains("点外卖")
                || cmd.contains("下订单") || cmd.contains("看看") || cmd.contains("对比") || cmd.contains("挑选")) {
            return false;
        }
        if (isAutoVideoSwipeCommand(cmd) || isDirectAppShortcut(cmd)) return true;
        if (cmd.contains("停止刷") || cmd.contains("别刷") || cmd.contains("停刷") || cmd.contains("停止连刷") || cmd.contains("停止自动")) {
            return true;
        }
        if (cmd.equals("下一个视频") || cmd.equals("刷下一个") || cmd.equals("换一个") || cmd.equals("下一个") || cmd.equals("下个视频")
                || cmd.equals("上一个视频") || cmd.equals("回看上一个") || cmd.equals("上一个") || cmd.equals("上个视频")
                || cmd.equals("双击点赞") || cmd.equals("点赞") || cmd.equals("点红心") || cmd.equals("点个赞") || cmd.equals("喜欢")
                || cmd.equals("暂停视频") || cmd.equals("播放视频") || cmd.equals("暂停播放") || cmd.equals("暂停/播")
                || cmd.equals("看评论") || cmd.equals("打开评论") || cmd.equals("评论区")
                || cmd.equals("点收藏") || cmd.equals("收藏视频") || cmd.equals("收藏")
                || cmd.equals("点关注") || cmd.equals("关注作者") || cmd.equals("分享视频") || cmd.equals("转发视频") || cmd.equals("转发")) {
            return true;
        }
        if (cmd.equals("回桌面") || cmd.equals("桌面") || cmd.equals("主页") || cmd.equals("home")
                || cmd.equals("返回") || cmd.equals("后退") || cmd.equals("上一页") || cmd.equals("back")
                || cmd.equals("最近任务") || cmd.equals("多任务") || cmd.equals("后台")
                || cmd.equals("截屏") || cmd.equals("截图") || cmd.equals("屏幕截图")
                || cmd.equals("锁屏") || cmd.equals("息屏") || cmd.equals("音量+") || cmd.equals("音量-")
                || cmd.equals("音量加") || cmd.equals("音量减") || cmd.equals("调大音量") || cmd.equals("调小音量")
                || cmd.equals("静音") || cmd.equals("取消静音") || cmd.equals("下一首") || cmd.equals("下一首歌")
                || cmd.equals("切歌") || cmd.equals("换首歌") || cmd.equals("换一首歌") || cmd.equals("上一首") || cmd.equals("上一首歌")
                || cmd.equals("暂停音乐") || cmd.equals("播放音乐") || cmd.equals("继续播放") || cmd.equals("继续放歌")
                || cmd.equals("点中间") || cmd.equals("点击中间")) {
            return true;
        }
        if (cmd.matches("^(?:用qq音乐|在qq音乐|qq音乐)?\\s*(?:播放|放一首|放首|点播|我想听|来一首|听一下|听一首)\\s*.+$")
                && !cmd.contains("视频")) {
            return true;
        }
        if (cmd.equals("回到顶部") || cmd.equals("滚到顶部") || cmd.equals("回顶部") || cmd.equals("最上面")
                || cmd.equals("滑到底部") || cmd.equals("滚到底部") || cmd.equals("最下面")
                || cmd.matches("^(?:连续)?(?:下滑|向下|下翻|上滑|向上|上翻|左滑|向左|右滑|向右)(?:\\s*\\d+\\s*次)?$")) {
            return true;
        }
        if (cmd.startsWith("打字并发送") || cmd.startsWith("输入并发送") || cmd.startsWith("追加输入")
                || cmd.startsWith("接着打字") || cmd.startsWith("帮我打字") || cmd.startsWith("打字")
                || cmd.startsWith("输入") || cmd.startsWith("填入") || cmd.startsWith("写字")
                || cmd.startsWith("清空输入框") || cmd.startsWith("清空输入") || cmd.startsWith("粘贴")
                || cmd.startsWith("搜索") || cmd.startsWith("搜一下")) {
            return true;
        }
        if ((cmd.startsWith("发送消息") || cmd.startsWith("发消息") || cmd.startsWith("回复") || cmd.startsWith("评论"))
                && !cmd.matches("^(?:发送消息|发消息|回复)\\s*(?:给|到|询问).*")) {
            return true;
        }
        if (cmd.startsWith("打开") || cmd.startsWith("启动") || cmd.startsWith("进入") || cmd.startsWith("运行")) {
            String targetApp = trimmed.replaceFirst("^(打开|启动|进入|运行)\\s*", "").trim();
            return isPureTargetAppName(targetApp);
        }
        if ((trimmed.startsWith("点击") || trimmed.startsWith("点一下") || trimmed.startsWith("按下")
                || trimmed.startsWith("点") || trimmed.startsWith("长按") || trimmed.startsWith("双击"))
                && trimmed.length() <= 14) {
            return true;
        }
        return false;
    }

    private boolean isDirectAppShortcut(String cmd) {
        return "微信".equals(cmd) || "设置".equals(cmd) || "抖音".equals(cmd)
                || "快手".equals(cmd) || "小红书".equals(cmd) || "b站".equals(cmd)
                || "淘宝".equals(cmd) || "支付宝".equals(cmd) || "高德地图".equals(cmd)
                || "网易云".equals(cmd) || "qq".equals(cmd) || "美团".equals(cmd);
    }

    private int extractNumberByRegex(String text, String patternStr, int fallback) {
        try {
            Matcher m = Pattern.compile(patternStr).matcher(text);
            if (m.find()) {
                return Integer.parseInt(m.group(1));
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    private String summarizeCurrentScreen() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "暂无法读取当前屏幕（可能锁屏或受系统保护）";
        CharSequence pkg = root.getPackageName();
        List<String> samples = new ArrayList<>();
        collectVisibleTexts(root, samples, 8);
        root.recycle();
        String joined = samples.isEmpty() ? "未检测到可见文本控件" : String.join("、", samples);
        return "当前窗口(" + (pkg != null ? pkg : "未知") + ")：" + joined;
    }

    private void collectVisibleTexts(AccessibilityNodeInfo node, List<String> out, int limit) {
        if (node == null || out.size() >= limit) return;
        CharSequence txt = node.getText();
        CharSequence desc = node.getContentDescription();
        String v = txt != null && txt.length() > 0 ? txt.toString().trim()
                : (desc != null && desc.length() > 0 ? desc.toString().trim() : "");
        if (!v.isEmpty() && v.length() <= 18 && !out.contains(v)) {
            out.add(v);
        }
        int c = node.getChildCount();
        for (int i = 0; i < c && out.size() < limit; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectVisibleTexts(child, out, limit);
                child.recycle();
            }
        }
    }

    private Rect findNodeBoundsByText(String targetText) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;

        List<AccessibilityNodeInfo> list = root.findAccessibilityNodeInfosByText(targetText);
        if (list != null && !list.isEmpty()) {
            for (AccessibilityNodeInfo node : list) {
                if (node != null) {
                    Rect bounds = new Rect();
                    node.getBoundsInScreen(bounds);
                    node.recycle();
                    if (bounds.width() > 0 && bounds.height() > 0) {
                        root.recycle();
                        return bounds;
                    }
                }
            }
        }

        AccessibilityNodeInfo fuzzyNode = findFuzzyNode(root, targetText.toLowerCase(Locale.ROOT));
        if (fuzzyNode != null) {
            Rect bounds = new Rect();
            fuzzyNode.getBoundsInScreen(bounds);
            fuzzyNode.recycle();
            root.recycle();
            if (bounds.width() > 0 && bounds.height() > 0) {
                return bounds;
            }
            return null;
        }

        root.recycle();
        return null;
    }

    public boolean clickNodeByText(String targetText) {
        Rect bounds = findNodeBoundsByText(targetText);
        if (bounds == null) return false;
        return performClickCoordinate(bounds.centerX(), bounds.centerY());
    }

    public boolean longClickNodeByText(String targetText) {
        Rect bounds = findNodeBoundsByText(targetText);
        if (bounds == null) return false;
        return performLongClickCoordinate(bounds.centerX(), bounds.centerY(), 800);
    }

    public boolean doubleClickNodeByText(String targetText) {
        Rect bounds = findNodeBoundsByText(targetText);
        if (bounds == null) return false;
        return performDoubleClickCoordinate(bounds.centerX(), bounds.centerY());
    }

    private AccessibilityNodeInfo findFuzzyNode(AccessibilityNodeInfo node, String query) {
        if (node == null) return null;
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        if (text != null && text.toString().toLowerCase(Locale.ROOT).contains(query)) {
            return AccessibilityNodeInfo.obtain(node);
        }
        if (desc != null && desc.toString().toLowerCase(Locale.ROOT).contains(query)) {
            return AccessibilityNodeInfo.obtain(node);
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo match = findFuzzyNode(child, query);
                child.recycle();
                if (match != null) {
                    return match;
                }
            }
        }
        return null;
    }

    /**
     * 执行系统级全局动作（返回、桌面、最近任务、通知栏、控制中心、截屏、锁屏、电源菜单、切回上个App）
     */
    public boolean performGlobal(String actionType) {
        if (actionType == null) return false;
        String act = actionType.trim().toLowerCase(Locale.ROOT);
        switch (act) {
            case "back":
                return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home":
                return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents":
                return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notifications":
                return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quick_settings":
                return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            case "enter":
                return performSmartSubmitAction(null);
            case "power_dialog":
                return performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
            case "screenshot":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT);
                }
                return false;
            case "lock_screen":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
                }
                return false;
            case "switch_last_app":
                boolean firstOk = performGlobalAction(GLOBAL_ACTION_RECENTS);
                if (firstOk) {
                    Runnable secondSwitch = new Runnable() {
                        @Override
                        public void run() {
                            performGlobalAction(GLOBAL_ACTION_RECENTS);
                        }
                    };
                    pendingRunnables.add(secondSwitch);
                    mainHandler.postDelayed(secondSwitch, 220);
                }
                return firstOk;
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
