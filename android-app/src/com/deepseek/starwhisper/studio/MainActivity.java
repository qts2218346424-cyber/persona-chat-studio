package com.deepseek.starwhisper.studio;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * DeepSeek 原生极简模式 × 星语恋庭双模 Android 原生宿主容器
 * 通过本地 HTTPS 安全源映射 (https://appassets.androidplatform.net) 承载全套内置离线资产与直连 API
 */
public class MainActivity extends Activity {
    public static final String EXTRA_PENDING_AGENT_TASK = "extra_pending_agent_task";
    public static final String EXTRA_REQUEST_AUDIO_PERM = "extra_request_audio_perm";
    private static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + VIRTUAL_HOST + "/index.html";
    private static final int FILE_CHOOSER_REQ_CODE = 1001;
    private static final int AUDIO_PERM_REQ_CODE = 1002;
    private static final String PREF_AUTH = "star_whisper_auth";
    private static final String PREF_KEY_TOKEN = "auth_token";
    private static final String PREF_KEY_USER_JSON = "auth_user_json";

    private static volatile MainActivity sInstance = null;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermissionRequest;
    private long lastBackPressMs = 0L;
    private String pendingAgentTaskFromFloat = null;
    private boolean webPageReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;

        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(Color.WHITE);
            window.setNavigationBarColor(Color.WHITE);
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        configureWebSettings(webView.getSettings());
        webView.addJavascriptInterface(new NativeBridge(), "AndroidAppBridge");

        webView.setWebViewClient(new LocalAssetWebViewClient());
        webView.setWebChromeClient(new FileUploadChromeClient());
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "请从浏览器打开链接下载", Toast.LENGTH_SHORT).show();
                }
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
        handleIncomingAgentIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingAgentIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webPageReady && webView != null) {
            webView.post(new Runnable() {
                @Override
                public void run() {
                    if (webView != null) {
                        webView.evaluateJavascript("if(window.__onNativeResume){window.__onNativeResume();}", null);
                    }
                }
            });
        }
    }

    private void handleIncomingAgentIntent(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(EXTRA_REQUEST_AUDIO_PERM, false)) {
            intent.removeExtra(EXTRA_REQUEST_AUDIO_PERM);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERM_REQ_CODE);
            }
        }
        String task = intent.getStringExtra(EXTRA_PENDING_AGENT_TASK);
        if (task != null && !task.trim().isEmpty()) {
            intent.removeExtra(EXTRA_PENDING_AGENT_TASK);
            pendingAgentTaskFromFloat = task.trim();
            if (webPageReady && webView != null) {
                final String readyTask = pendingAgentTaskFromFloat;
                pendingAgentTaskFromFloat = null;
                webView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        dispatchPendingTaskToWebView(readyTask);
                    }
                }, 250);
            }
        }
    }

    private void dispatchPendingTaskToWebView(final String task) {
        if (task == null || task.trim().isEmpty()) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String quoted = JSONObject.quote(task.trim());
                webView.evaluateJavascript(
                        "if(window.__receiveFloatAgentTask){window.__receiveFloatAgentTask(" + quoted + ");}",
                        null
                );
            }
        });
    }

    private final class LocalAssetWebViewClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (url != null && url.contains(VIRTUAL_HOST)) {
                webPageReady = true;
                try {
                    SharedPreferences sp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
                    String savedTok = sp.getString(PREF_KEY_TOKEN, "");
                    String savedUser = sp.getString(PREF_KEY_USER_JSON, "");
                    if (savedUser != null && !savedUser.trim().isEmpty()) {
                        String qTok = JSONObject.quote(savedTok != null ? savedTok : "");
                        String qUser = JSONObject.quote(savedUser.trim());
                        view.evaluateJavascript(
                            "if(window.__restoreNativeAuth){window.__restoreNativeAuth(" + qTok + "," + qUser + ");}",
                            null
                        );
                    }
                } catch (Exception ignored) {}

                if (pendingAgentTaskFromFloat != null && !pendingAgentTaskFromFloat.trim().isEmpty()) {
                    final String taskToSend = pendingAgentTaskFromFloat;
                    pendingAgentTaskFromFloat = null;
                    view.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            dispatchPendingTaskToWebView(taskToSend);
                        }
                    }, 600);
                }
            }
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url != null && VIRTUAL_HOST.equalsIgnoreCase(url.getHost())) {
                String rawPath = url.getPath();
                if (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)) {
                    rawPath = "/index.html";
                }
                String assetPath = "public" + rawPath;
                try {
                    InputStream stream = getAssets().open(assetPath);
                    String mime = guessMimeType(assetPath);
                    String encoding = isTextMime(mime) ? "UTF-8" : null;
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mime, encoding, 200, "OK", headers, stream);
                } catch (IOException ignored) {
                    return null;
                }
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri == null) return false;
            String host = uri.getHost();
            if (VIRTUAL_HOST.equalsIgnoreCase(host)) {
                return false;
            }
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                startActivity(intent);
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }
    }

    private final class FileUploadChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            if (request == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            try {
                                request.grant(request.getResources());
                            } catch (Exception ignored) {}
                        } else {
                            pendingWebPermissionRequest = request;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERM_REQ_CODE);
                        }
                    } else {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams fileChooserParams
        ) {
            if (filePathCallback != null) {
                try {
                    filePathCallback.onReceiveValue(null);
                } catch (Exception ignored) {
                }
                filePathCallback = null;
            }
            filePathCallback = callback;

            String[] acceptTypes = fileChooserParams != null ? fileChooserParams.getAcceptTypes() : null;
            boolean imageOnly = isImageOnlyRequest(acceptTypes);
            Intent contentIntent = new Intent(imageOnly ? Intent.ACTION_GET_CONTENT : Intent.ACTION_OPEN_DOCUMENT);
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            contentIntent.setType(imageOnly ? "image/*" : "*/*");
            if (fileChooserParams != null) {
                if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    contentIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                if (acceptTypes != null && acceptTypes.length > 0 && !imageOnly) {
                    List<String> validMimes = new ArrayList<>();
                    for (String t : acceptTypes) {
                        if (t != null) {
                            String trimmed = t.trim();
                            if (!trimmed.isEmpty() && !"*/*".equals(trimmed) && trimmed.contains("/")) {
                                validMimes.add(trimmed);
                            }
                        }
                    }
                    if (!validMimes.isEmpty() && !containsAllWildcard(acceptTypes)) {
                        contentIntent.putExtra(Intent.EXTRA_MIME_TYPES, validMimes.toArray(new String[0]));
                    }
                }
            }

            try {
                Intent chooser = Intent.createChooser(contentIntent, "选择要上传的文件");
                startActivityForResult(chooser, FILE_CHOOSER_REQ_CODE);
                return true;
            } catch (ActivityNotFoundException primaryEx) {
                if (fileChooserParams != null) {
                    try {
                        startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQ_CODE);
                        return true;
                    } catch (ActivityNotFoundException ignored) {
                    }
                }
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                Toast.makeText(MainActivity.this, "未找到可用的文件选择器", Toast.LENGTH_SHORT).show();
                return false;
            }
        }

        private boolean isImageOnlyRequest(String[] types) {
            if (types == null || types.length == 0) return false;
            boolean hasImg = false;
            for (String t : types) {
                if (t == null) continue;
                String s = t.trim().toLowerCase(Locale.ROOT);
                if (s.isEmpty()) continue;
                if (s.startsWith("image/")) {
                    hasImg = true;
                } else {
                    return false;
                }
            }
            return hasImg;
        }

        private boolean containsAllWildcard(String[] types) {
            for (String t : types) {
                if ("*/*".equals(t != null ? t.trim() : "")) {
                    return true;
                }
            }
            return false;
        }
    }

    private void configureWebSettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
    }

    private void dispatchJsUpdateCheckResult(final String resultJson) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String safe = resultJson != null ? resultJson : "{\"ok\":false,\"error\":\"返回空\"}";
                safe = safe.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
                webView.evaluateJavascript("if(window.__onNativeUpdateCheckResult){window.__onNativeUpdateCheckResult(" + safe + ");}", null);
            }
        });
    }

    private void dispatchJsUpdateProgress(final String progressJson) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String safe = progressJson != null ? progressJson : "{}";
                safe = safe.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
                webView.evaluateJavascript("if(window.__onNativeUpdateProgress){window.__onNativeUpdateProgress(" + safe + ");}", null);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERM_REQ_CODE) {
            PermissionRequest req = pendingWebPermissionRequest;
            pendingWebPermissionRequest = null;
            if (req != null) {
                try {
                    if (grantResults != null && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                        req.grant(req.getResources());
                    } else {
                        req.deny();
                        Toast.makeText(MainActivity.this, "需要允许麦克风权限才能使用语音输入", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == AppUpdateManager.INSTALL_PERM_REQ_CODE) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getPackageManager().canRequestPackageInstalls()) {
                String res = AppUpdateManager.triggerInstall(MainActivity.this);
                if ("STARTED".equals(res)) {
                    dispatchJsUpdateProgress("{\"stage\":\"installing\",\"percent\":100,\"message\":\"已授予安装权限，正在启动系统安装器...\"}");
                } else {
                    dispatchJsUpdateProgress("{\"stage\":\"error\",\"percent\":100,\"message\":\"授权后启动安装器失败: " + res + "\"}");
                }
            } else {
                dispatchJsUpdateProgress("{\"stage\":\"need_permission\",\"percent\":100,\"message\":\"尚未允许安装未知应用，请在系统设置开启后点击继续安装\"}");
            }
            return;
        }
        if (requestCode == FILE_CHOOSER_REQ_CODE) {
            ValueCallback<Uri[]> cb = filePathCallback;
            filePathCallback = null;
            if (cb != null) {
                Uri[] results = null;
                try {
                    if (resultCode == Activity.RESULT_OK && data != null) {
                        results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                        if ((results == null || results.length == 0)) {
                            List<Uri> uris = new ArrayList<>();
                            ClipData clip = data.getClipData();
                            if (clip != null) {
                                for (int i = 0; i < clip.getItemCount(); i++) {
                                    Uri u = clip.getItemAt(i).getUri();
                                    if (u != null) uris.add(u);
                                }
                            } else if (data.getData() != null) {
                                uris.add(data.getData());
                            }
                            if (!uris.isEmpty()) {
                                results = uris.toArray(new Uri[0]);
                            }
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    cb.onReceiveValue(results);
                }
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null) {
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPressMs > 1800L) {
                lastBackPressMs = now;
                Toast.makeText(this, "再按一次返回键退出 DeepSeek", Toast.LENGTH_SHORT).show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    private static boolean isTextMime(String mime) {
        return mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg");
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    public static void dispatchConfirmDecisionToWebView(final String decision) {
        final MainActivity act = sInstance;
        if (act != null && act.webView != null) {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (act.webView != null) {
                        String quoted = JSONObject.quote(decision != null ? decision : "cancel");
                        act.webView.evaluateJavascript(
                            "if(window.__onFloatConfirmDecision){window.__onFloatConfirmDecision(" + quoted + ");}",
                            null
                        );
                    }
                }
            });
        }
    }

    public static void dispatchNormalStopToWebView() {
        final MainActivity act = sInstance;
        if (act != null && act.webView != null) {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (act.webView != null) {
                        act.webView.evaluateJavascript(
                            "if(window.__onFloatNormalStop){window.__onFloatNormalStop();}",
                            null
                        );
                    }
                }
            });
        }
    }

    public static boolean dispatchFloatInterjectToWebView(final String task) {
        final MainActivity act = sInstance;
        if (act == null || act.webView == null || !act.webPageReady || task == null || task.trim().isEmpty()) {
            return false;
        }
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (act.webView != null) {
                    String quoted = JSONObject.quote(task.trim());
                    act.webView.evaluateJavascript(
                        "if(window.__onFloatInterjectTask){window.__onFloatInterjectTask(" + quoted + ");}else if(window.__receiveFloatAgentTask){window.__receiveFloatAgentTask(" + quoted + ");}",
                        null
                    );
                }
            }
        });
        return true;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (sInstance == this) {
            sInstance = null;
        }
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void saveAuthCredentials(String token, String userJson) {
            try {
                SharedPreferences sp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
                sp.edit()
                  .putString(PREF_KEY_TOKEN, token != null ? token : "")
                  .putString(PREF_KEY_USER_JSON, userJson != null ? userJson : "")
                  .apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getAuthToken() {
            try {
                SharedPreferences sp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
                return sp.getString(PREF_KEY_TOKEN, "");
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String getAuthUserJson() {
            try {
                SharedPreferences sp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
                return sp.getString(PREF_KEY_USER_JSON, "");
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearAuthCredentials() {
            try {
                SharedPreferences sp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
                sp.edit().clear().apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void requestUserConfirmation(final String summary, final String actionDesc) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    FloatAgentService.showConfirmPrompt(summary, actionDesc);
                }
            });
        }

        @JavascriptInterface
        public void dismissUserConfirmation() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    FloatAgentService.dismissConfirmPrompt();
                }
            });
        }

        @JavascriptInterface
        public void stopFloatAgentTask() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    FloatAgentService.requestNormalStop();
                }
            });
        }

        @JavascriptInterface
        public String getAppVersion() {
            return AppUpdateManager.getInstalledVersionName(MainActivity.this);
        }

        @JavascriptInterface
        public String getInstalledVersionInfo() {
            return AppUpdateManager.getInstalledVersionJson(MainActivity.this);
        }

        @JavascriptInterface
        public void checkAppUpdateNative() {
            AppUpdateManager.checkUpdateAsync(MainActivity.this, new AppUpdateManager.CheckCallback() {
                @Override
                public void onComplete(String resultJson) {
                    dispatchJsUpdateCheckResult(resultJson);
                }
            });
        }

        @JavascriptInterface
        public void startNativeApkUpdate(String url, String sha256, long expectedBytes) {
            AppUpdateManager.startDownloadAsync(MainActivity.this, url, sha256, expectedBytes, new AppUpdateManager.ProgressCallback() {
                @Override
                public void onProgress(String progressJson) {
                    dispatchJsUpdateProgress(progressJson);
                }
            });
        }

        @JavascriptInterface
        public void cancelNativeApkUpdate() {
            AppUpdateManager.cancelDownload();
        }

        @JavascriptInterface
        public String installDownloadedApk() {
            return AppUpdateManager.triggerInstall(MainActivity.this);
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (url == null || url.trim().isEmpty()) return;
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "打开外部链接失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean isNativeApk() {
            return true;
        }

        @JavascriptInterface
        public String getDeviceInfo() {
            return "{\"model\":\"" + Build.MODEL + "\",\"sdk\":" + Build.VERSION.SDK_INT + ",\"brand\":\"" + Build.BRAND + "\"}";
        }

        @JavascriptInterface
        public boolean isAccessibilityEnabled() {
            return AgentAccessibilityService.isRunning();
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        Toast.makeText(MainActivity.this, "请在无障碍列表中找到「DeepSeek · 星语」并开启服务", Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "打开无障碍设置失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean hasOverlayPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return Settings.canDrawOverlays(MainActivity.this);
            }
            return true;
        }

        @JavascriptInterface
        public void requestOverlayPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (!Settings.canDrawOverlays(MainActivity.this)) {
                            try {
                                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                        Uri.parse("package:" + getPackageName()));
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                Toast.makeText(MainActivity.this, "请授予「悬浮窗」权限以开启屏幕急停控制球", Toast.LENGTH_LONG).show();
                            } catch (Exception e) {
                                Toast.makeText(MainActivity.this, "打开悬浮窗设置失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                            }
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean startFloatAgent() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(MainActivity.this)) {
                requestOverlayPermission();
                return false;
            }
            try {
                Intent intent = new Intent(MainActivity.this, FloatAgentService.class);
                startService(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean stopFloatAgent() {
            try {
                Intent intent = new Intent(MainActivity.this, FloatAgentService.class);
                stopService(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean isFloatAgentRunning() {
            return FloatAgentService.isRunning();
        }

        @JavascriptInterface
        public void updateFloatState(String state, String text) {
            FloatAgentService.updateState(state, text);
        }

        @JavascriptInterface
        public boolean isEmergencyStopRequested() {
            return FloatAgentService.sEmergencyStopRequested;
        }

        @JavascriptInterface
        public void resetEmergencyStop() {
            FloatAgentService.resetStopFlag();
        }

        @JavascriptInterface
        public String dumpScreenHierarchy(boolean clickableOnly) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "{\"error\":\"AccessibilityService 未就绪，请先在系统设置中启用无障碍服务\",\"nodes\":[]}";
            }
            return service.dumpScreenHierarchy(clickableOnly);
        }

        @JavascriptInterface
        public boolean dispatchClick(int x, int y) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performClickCoordinate(x, y);
        }

        @JavascriptInterface
        public boolean dispatchLongClick(int x, int y, int durationMs) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performLongClickCoordinate(x, y, durationMs);
        }

        @JavascriptInterface
        public boolean clickByText(String targetText) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null || targetText == null) return false;
            return service.clickNodeByText(targetText);
        }

        @JavascriptInterface
        public String getScreenSize() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service != null) return service.getScreenSizeJson();
            DisplayMetrics dm = MainActivity.this.getResources().getDisplayMetrics();
            return "{\"width\":" + dm.widthPixels + ",\"height\":" + dm.heightPixels + "}";
        }

        @JavascriptInterface
        public String listInstalledApps() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service != null) return service.listInstalledAppsJson();
            PackageManager pm = MainActivity.this.getPackageManager();
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
                        sb.append("{\"name\":\"")
                          .append(label.replace("\\", "\\\\").replace("\"", "\\\""))
                          .append("\",\"package\":\"")
                          .append(pkg.replace("\\", "\\\\").replace("\"", "\\\""))
                          .append("\"}");
                        first = false;
                        count++;
                    }
                }
            }
            sb.append("]");
            return sb.toString();
        }

        @JavascriptInterface
        public boolean launchAppByName(String appName) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service != null) return service.launchAppByName(appName);
            if (appName == null || appName.trim().isEmpty()) return false;
            String clean = appName.trim().toLowerCase(Locale.ROOT);
            if ("设置".equals(clean) || "系统设置".equals(clean)) {
                try {
                    Intent i = new Intent(Settings.ACTION_SETTINGS);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    return true;
                } catch (Exception ignored) {}
            }
            PackageManager pm = MainActivity.this.getPackageManager();
            Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(mainIntent, 0);
            if (apps != null) {
                for (ResolveInfo info : apps) {
                    String label = info.loadLabel(pm) != null ? info.loadLabel(pm).toString().toLowerCase(Locale.ROOT) : "";
                    String pkg = info.activityInfo != null ? info.activityInfo.packageName : "";
                    if (!label.isEmpty() && (label.equals(clean) || label.contains(clean))) {
                        try {
                            Intent li = pm.getLaunchIntentForPackage(pkg);
                            if (li != null) {
                                li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(li);
                                return true;
                            }
                        } catch (Exception ignored) {}
                    }
                }
            }
            return false;
        }

        @JavascriptInterface
        public boolean dispatchSwipe(int x1, int y1, int x2, int y2, int duration) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performSwipe(x1, y1, x2, y2, duration);
        }

        @JavascriptInterface
        public boolean dispatchInputText(String viewId, String text) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performInputText(viewId, text);
        }

        @JavascriptInterface
        public boolean dispatchSmartInput(String text, boolean appendMode, boolean autoSubmit) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performSmartInputText(null, text, appendMode, autoSubmit);
        }

        @JavascriptInterface
        public boolean dispatchDoubleClick(int x, int y) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performDoubleClickCoordinate(x, y);
        }

        @JavascriptInterface
        public String startAutoSwipeVideos(int count, int intervalSec, boolean randomLike) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "无障碍服务未就绪，请先在系统设置中开启无障碍服务";
            }
            return service.startAutoSwipeVideos(count, intervalSec, randomLike);
        }

        @JavascriptInterface
        public String stopAutoSwipeVideos() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service != null) {
                service.stopAllBackgroundTasks("前端停止连刷");
            }
            FloatAgentService.updateState("idle", "星语 AI");
            return "已停止自动刷视频";
        }

        @JavascriptInterface
        public boolean isAutoSwipeRunning() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            return service != null && service.isAutoSwipeRunning();
        }

        @JavascriptInterface
        public String adjustMediaVolume(int direction) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "无障碍服务未就绪";
            return service.adjustMediaVolume(direction);
        }

        @JavascriptInterface
        public String dispatchMediaKey(String action) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "无障碍服务未就绪";
            return service.dispatchMediaKey(action);
        }

        @JavascriptInterface
        public String playQqMusic(String songQuery) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "无障碍服务未就绪，请先在系统设置中开启无障碍服务";
            return service.playSongInQqMusic(songQuery);
        }

        @JavascriptInterface
        public void triggerWhaleAction(String action) {
            FloatAgentService.triggerWhaleActionFromBridge(action);
        }

        @JavascriptInterface
        public boolean hasMusicNotificationPermission() {
            return QqMusicListenerService.isNotificationAccessEnabled(MainActivity.this);
        }

        @JavascriptInterface
        public void openMusicNotificationSettings() {
            QqMusicListenerService.openNotificationListenerSettings(MainActivity.this);
        }

        @JavascriptInterface
        public void openFloatPanel() {
            FloatAgentService.openPanelFromBridge();
        }

        @JavascriptInterface
        public String getQuickPhrasesJson() {
            return FloatAgentService.getQuickPhrasesJsonFromPrefs(MainActivity.this);
        }

        @JavascriptInterface
        public boolean saveQuickPhrasesJson(String jsonArrayStr) {
            return FloatAgentService.saveQuickPhrasesJsonFromBridge(MainActivity.this, jsonArrayStr);
        }

        @JavascriptInterface
        public void openQuickTypingMode() {
            FloatAgentService.openQuickTypingBarFromBridge(MainActivity.this);
        }

        @JavascriptInterface
        public boolean dispatchGlobalAction(String action) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performGlobal(action);
        }

        @JavascriptInterface
        public String executeLocalRule(String command) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "无障碍服务未就绪，请先在系统设置中开启无障碍服务";
            }
            return service.executeLocalRule(command);
        }

        @JavascriptInterface
        public void requestSafetyConfirmation(final String summary, final String actionDesc, final String riskLevel, final String targetApp, final boolean hardSensitive) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    FloatAgentService.showConfirmPrompt(summary, actionDesc, riskLevel, targetApp, hardSensitive);
                }
            });
        }

        @JavascriptInterface
        public void setEdgeGlowEnabled(boolean enabled) {
            FloatAgentService.setEdgeGlowEnabled(enabled);
        }

        @JavascriptInterface
        public void setEdgeGlowState(String state) {
            FloatAgentService.setEdgeGlowState(state);
        }

        @JavascriptInterface
        public void showTapIndicator(int x, int y) {
            FloatAgentService.showTapRipple(x, y);
        }

        @JavascriptInterface
        public void setAgentForegroundActive(boolean active, String statusText) {
            FloatAgentService.setForegroundKeepingAlive(active, statusText);
        }

        @JavascriptInterface
        public String dumpScreenSnapshot(boolean includeInvisible) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "{\"error\":\"AccessibilityService 未就绪，请先在系统设置中启用无障碍服务\",\"snapshotId\":\"\",\"nodes\":[]}";
            }
            return service.dumpScreenSnapshot(includeInvisible);
        }

        @JavascriptInterface
        public String getScreenMeta() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "{\"ok\":false,\"packageName\":\"\",\"appName\":\"\",\"signature\":\"\",\"hasSensitiveField\":false,\"nodeCount\":0}";
            }
            return service.getScreenMetaJson();
        }

        @JavascriptInterface
        public String clickByRef(String snapshotId, String refId) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "{\"ok\":false,\"message\":\"无障碍服务未就绪\"}";
            return service.clickByRef(snapshotId, refId);
        }

        @JavascriptInterface
        public String longClickByRef(String snapshotId, String refId, int durationMs) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "{\"ok\":false,\"message\":\"无障碍服务未就绪\"}";
            return service.longClickByRef(snapshotId, refId, durationMs);
        }

        @JavascriptInterface
        public boolean doubleTapAt(int x, int y) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.performDoubleClickCoordinate(x, y);
        }

        @JavascriptInterface
        public String inputByRef(String snapshotId, String refId, String text, boolean clearFirst, boolean autoSubmit) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "{\"ok\":false,\"message\":\"无障碍服务未就绪\"}";
            return service.inputByRef(snapshotId, refId, text, clearFirst, autoSubmit);
        }

        @JavascriptInterface
        public boolean scrollScreen(String direction, float ratio) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.scrollDirection(direction, ratio);
        }

        @JavascriptInterface
        public void showToast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
