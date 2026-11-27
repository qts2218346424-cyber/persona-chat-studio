package com.deepseek.starwhisper.studio;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
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

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;

/**
 * DeepSeek 原生极简模式 × 星语恋庭双模 Android 原生宿主容器
 * 通过本地 HTTPS 安全源映射 (https://appassets.androidplatform.net) 承载全套内置离线资产与直连 API
 */
public class MainActivity extends Activity {
    public static final String EXTRA_PENDING_AGENT_TASK = "extra_pending_agent_task";
    public static final String EXTRA_REQUEST_AUDIO_PERM = "extra_request_audio_perm";
    public static final String EXTRA_OPEN_SONG_IMPORTER = "extra_open_song_importer";
    private static final String VIRTUAL_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + VIRTUAL_HOST + "/index.html";
    private static final int FILE_CHOOSER_REQ_CODE = 1001;
    private static final int AUDIO_PERM_REQ_CODE = 1002;
    private static final int SONG_IMPORTER_REQ_CODE = 1004;
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
    private final ExecutorService httpExecutor = Executors.newFixedThreadPool(4);
    private final Handler nativeTimerHandler = new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<String, Runnable> pendingSleepRunnables = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, HttpURLConnection> activeHttpConnections = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicBoolean> cancelledHttpReqs = new ConcurrentHashMap<>();

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

        boolean versionChanged = false;
        try {
            long curVerCode = AppUpdateManager.getInstalledVersionCode(this);
            SharedPreferences verSp = getSharedPreferences(PREF_AUTH, MODE_PRIVATE);
            long lastVerCode = verSp.getLong("last_launched_version_code", -1L);
            if (lastVerCode != curVerCode) {
                versionChanged = true;
                webView.clearCache(true);
                verSp.edit().putLong("last_launched_version_code", curVerCode).apply();
            }
        } catch (Exception ignored) {}

        if (savedInstanceState != null && !versionChanged) {
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
        if (intent.getBooleanExtra(EXTRA_OPEN_SONG_IMPORTER, false)) {
            intent.removeExtra(EXTRA_OPEN_SONG_IMPORTER);
            if (webView != null) {
                webView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        launchSongAudioPicker();
                    }
                }, 220);
            } else {
                launchSongAudioPicker();
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
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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
        if (requestCode == SONG_IMPORTER_REQ_CODE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                final List<Uri> pickedUris = new ArrayList<>();
                try {
                    ClipData clip = data.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            Uri u = clip.getItemAt(i).getUri();
                            if (u != null) pickedUris.add(u);
                        }
                    } else if (data.getData() != null) {
                        pickedUris.add(data.getData());
                    }
                } catch (Exception ignored) {}
                if (!pickedUris.isEmpty()) {
                    Toast.makeText(this, "正在导入 " + pickedUris.size() + " 首实际歌声音频…", Toast.LENGTH_SHORT).show();
                    importPickedSongUrisAsync(pickedUris);
                }
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

    private void launchSongAudioPicker() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("audio/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(Intent.createChooser(intent, "选择大肥鱼要唱的实际声音/歌曲 (支持多选)"), SONG_IMPORTER_REQ_CODE);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "无法打开音频文件选择器: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private String resolveDisplayName(Uri uri) {
        String name = "";
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    name = cursor.getString(idx);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                try { cursor.close(); } catch (Exception ignored) {}
            }
        }
        if (name == null || name.trim().isEmpty()) {
            String path = uri.getLastPathSegment();
            name = (path != null && !path.trim().isEmpty()) ? path : ("导入歌声_" + System.currentTimeMillis());
        }
        int slash = name.lastIndexOf('/');
        if (slash >= 0 && slash < name.length() - 1) {
            name = name.substring(slash + 1);
        }
        return name.trim();
    }

    private void importPickedSongUrisAsync(final List<Uri> uris) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                File dir = new File(getFilesDir(), "whale_songs");
                if (!dir.exists()) dir.mkdirs();
                final List<JSONObject> imported = new ArrayList<>();
                long seq = System.currentTimeMillis();

                for (Uri uri : uris) {
                    if (uri == null) continue;
                    String origName = resolveDisplayName(uri);
                    String ext = ".mp3";
                    int dot = origName.lastIndexOf('.');
                    String title = origName;
                    if (dot > 0 && dot < origName.length() - 1) {
                        String candExt = origName.substring(dot).toLowerCase(Locale.ROOT);
                        if (candExt.length() <= 6) ext = candExt;
                        title = origName.substring(0, dot).trim();
                    }
                    if (title.isEmpty()) title = "自定义歌曲_" + seq;

                    String id = "song_" + seq + "_" + imported.size();
                    File dest = new File(dir, id + ext);
                    InputStream in = null;
                    FileOutputStream out = null;
                    boolean copied = false;
                    try {
                        in = getContentResolver().openInputStream(uri);
                        if (in != null) {
                            out = new FileOutputStream(dest);
                            byte[] buf = new byte[16384];
                            int len;
                            long total = 0L;
                            while ((len = in.read(buf)) > 0) {
                                out.write(buf, 0, len);
                                total += len;
                            }
                            out.flush();
                            copied = total > 256;
                        }
                    } catch (Exception ignored) {
                    } finally {
                        try { if (in != null) in.close(); } catch (Exception ignored) {}
                        try { if (out != null) out.close(); } catch (Exception ignored) {}
                    }

                    if (copied && dest.exists()) {
                        try {
                            JSONObject item = new JSONObject();
                            item.put("id", id);
                            item.put("title", title);
                            item.put("filePath", dest.getAbsolutePath());
                            item.put("addedAt", System.currentTimeMillis());
                            imported.add(item);
                        } catch (Exception ignored) {}
                    } else if (dest.exists()) {
                        dest.delete();
                    }
                    seq++;
                }

                if (!imported.isEmpty()) {
                    final int count = FloatAgentService.addImportedSongsFromMain(MainActivity.this, imported);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this,
                                    "🎵 已为大肥鱼导入 " + count + " 首实际歌声！点「🎤唱歌」立刻开唱",
                                    Toast.LENGTH_LONG).show();
                            if (webView != null) {
                                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('pa-songs-updated'));", null);
                            }
                        }
                    });
                } else {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "导入失败：无法读取选中的音频文件", Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
        }).start();
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
        try {
            nativeTimerHandler.removeCallbacksAndMessages(null);
            pendingSleepRunnables.clear();
            for (AtomicBoolean flag : cancelledHttpReqs.values()) {
                flag.set(true);
            }
            for (HttpURLConnection conn : activeHttpConnections.values()) {
                try { conn.disconnect(); } catch (Exception ignored) {}
            }
            activeHttpConnections.clear();
            cancelledHttpReqs.clear();
            httpExecutor.shutdownNow();
        } catch (Exception ignored) {}
        if (sInstance == this) {
            sInstance = null;
        }
    }

    private void dispatchNativeJsCallback(final String fnName, final String reqId, final String payloadJson) {
        if (webView == null) return;
        final String qId = JSONObject.quote(reqId != null ? reqId : "");
        final String qPayload = JSONObject.quote(payloadJson != null ? payloadJson : "{}")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029");
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "if(window." + fnName + "){window." + fnName + "(" + qId + "," + qPayload + ");}",
                            null
                    );
                }
            }
        });
    }

    private void executeNativeHttpPost(
            final String reqId,
            final String urlStr,
            final String headersJson,
            final String bodyStr,
            final int timeoutMs
    ) {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        cancelledHttpReqs.put(reqId, cancelled);
        httpExecutor.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    if (cancelled.get()) return;
                    URL url = new URL(urlStr);
                    conn = (HttpURLConnection) url.openConnection();
                    activeHttpConnections.put(reqId, conn);

                    int safeTimeout = Math.max(3000, Math.min(timeoutMs > 0 ? timeoutMs : 12000, 30000));
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(Math.min(safeTimeout, 8000));
                    conn.setReadTimeout(safeTimeout);
                    conn.setDoInput(true);
                    conn.setDoOutput(true);
                    conn.setUseCaches(false);
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setRequestProperty("Accept-Encoding", "gzip");
                    conn.setRequestProperty("Connection", "keep-alive");
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

                    if (headersJson != null && !headersJson.trim().isEmpty()) {
                        try {
                            JSONObject hdrObj = new JSONObject(headersJson);
                            Iterator<String> keys = hdrObj.keys();
                            while (keys.hasNext()) {
                                String k = keys.next();
                                String v = hdrObj.optString(k, "");
                                if (k != null && !k.isEmpty() && v != null) {
                                    conn.setRequestProperty(k, v);
                                }
                            }
                        } catch (Exception ignored) {}
                    }

                    byte[] payloadBytes = (bodyStr != null ? bodyStr : "{}").getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(payloadBytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payloadBytes);
                        os.flush();
                    }

                    if (cancelled.get()) return;
                    int status = conn.getResponseCode();
                    InputStream rawStream = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                    StringBuilder sb = new StringBuilder();
                    if (rawStream != null) {
                        String encoding = conn.getContentEncoding();
                        InputStream decodedStream = (encoding != null && encoding.toLowerCase(Locale.ROOT).contains("gzip"))
                                ? new GZIPInputStream(rawStream)
                                : rawStream;
                        try (BufferedReader br = new BufferedReader(new InputStreamReader(decodedStream, StandardCharsets.UTF_8))) {
                            char[] buf = new char[4096];
                            int len;
                            while ((len = br.read(buf)) != -1) {
                                if (cancelled.get()) return;
                                sb.append(buf, 0, len);
                            }
                        }
                    }

                    if (cancelled.get()) return;
                    JSONObject out = new JSONObject();
                    out.put("ok", status >= 200 && status < 300);
                    out.put("status", status);
                    out.put("body", sb.toString());
                    dispatchNativeJsCallback("__onNativeHttpResult", reqId, out.toString());
                } catch (Throwable err) {
                    if (!cancelled.get()) {
                        try {
                            JSONObject out = new JSONObject();
                            out.put("ok", false);
                            out.put("status", 0);
                            out.put("body", "");
                            out.put("error", err.getMessage() != null ? err.getMessage() : err.getClass().getSimpleName());
                            dispatchNativeJsCallback("__onNativeHttpResult", reqId, out.toString());
                        } catch (Exception ignored) {}
                    }
                } finally {
                    activeHttpConnections.remove(reqId);
                    cancelledHttpReqs.remove(reqId);
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                }
            }
        });
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
        public boolean bringSelfToFront(String reason) {
            return FloatAgentService.bringSelfToFrontFromBridge(MainActivity.this, reason);
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
        public boolean saveLearnedSkillsSummary(String jsonArrayStr) {
            return FloatAgentService.saveLearnedSkillsSummaryFromBridge(MainActivity.this, jsonArrayStr);
        }

        @JavascriptInterface
        public void openQuickTypingMode() {
            FloatAgentService.openQuickTypingBarFromBridge(MainActivity.this);
        }

        @JavascriptInterface
        public void openSongImporter() {
            launchSongAudioPicker();
        }

        @JavascriptInterface
        public String getCustomSongsJson() {
            return FloatAgentService.getCustomSongsJsonFromPrefs(MainActivity.this);
        }

        @JavascriptInterface
        public boolean renameCustomSong(String songId, String newTitle) {
            boolean ok = FloatAgentService.renameCustomSongFromBridge(MainActivity.this, songId, newTitle);
            if (ok && webView != null) {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('pa-songs-updated'));", null);
                    }
                });
            }
            return ok;
        }

        @JavascriptInterface
        public boolean deleteCustomSong(String songId) {
            boolean ok = FloatAgentService.deleteCustomSongFromBridge(MainActivity.this, songId);
            if (ok && webView != null) {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('pa-songs-updated'));", null);
                    }
                });
            }
            return ok;
        }

        @JavascriptInterface
        public void playCustomSongNow(String songId) {
            FloatAgentService.playSongByIdFromBridge(MainActivity.this, songId);
        }

        @JavascriptInterface
        public void stopCustomSongNow() {
            FloatAgentService.stopSongFromBridge();
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
        public void requestAskUserOverlay(final String title, final String thought, final String question, final String optionsJson) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    FloatAgentService.showAskUserPrompt(title, thought, question, optionsJson);
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
        public String getScreenEventSeq() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "{\"seq\":0,\"pkg\":\"\",\"ts\":0}";
            }
            return service.getScreenEventSeqJson();
        }

        @JavascriptInterface
        public String getLastExternalApp() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                return "{\"packageName\":\"\",\"appName\":\"\"}";
            }
            return service.getLastExternalAppJson();
        }

        @JavascriptInterface
        public boolean returnToLastExternalApp() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return false;
            return service.returnToLastExternalApp();
        }

        @JavascriptInterface
        public String clickByRef(String snapshotId, String refId) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "{\"ok\":false,\"message\":\"无障碍服务未就绪\"}";
            return service.clickByRef(snapshotId, refId);
        }

        @JavascriptInterface
        public String clickByRefGesture(String snapshotId, String refId) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "{\"ok\":false,\"message\":\"无障碍服务未就绪\"}";
            return service.clickByRef(snapshotId, refId, true);
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
        public String getTopPackageFast() {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) return "";
            return service.getCurrentPackageFast();
        }

        @JavascriptInterface
        public void waitForScreenVerdictAsync(
                final String reqId,
                final String beforePkg,
                final String beforeSig,
                final int beforeSeq,
                final String toolName,
                final int maxWaitMs
        ) {
            if (reqId == null || reqId.isEmpty()) return;
            final AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service == null) {
                dispatchNativeJsCallback(
                        "__onNativeVerdictResult",
                        reqId,
                        "{\"changed\":true,\"fromApp\":\"\",\"toApp\":\"\",\"elapsedMs\":0,\"prefetchedSnapshot\":null}"
                );
                return;
            }
            service.waitForScreenChangeAndSnapshotAsync(
                    reqId,
                    beforePkg,
                    beforeSig,
                    beforeSeq,
                    toolName,
                    maxWaitMs,
                    new AgentAccessibilityService.VerdictCallback() {
                        @Override
                        public void onComplete(String resultJson) {
                            dispatchNativeJsCallback("__onNativeVerdictResult", reqId, resultJson);
                        }
                    }
            );
        }

        @JavascriptInterface
        public void cancelWaitForScreenVerdict(String reqId) {
            AgentAccessibilityService service = AgentAccessibilityService.getInstance();
            if (service != null) {
                service.cancelWaitForScreenChange(reqId);
            }
        }

        @JavascriptInterface
        public void nativeSleepAsync(final String reqId, int delayMs) {
            if (reqId == null || reqId.isEmpty()) return;
            final int safeMs = Math.max(0, Math.min(delayMs, 30000));
            Runnable old = pendingSleepRunnables.remove(reqId);
            if (old != null) {
                nativeTimerHandler.removeCallbacks(old);
            }
            Runnable task = new Runnable() {
                @Override
                public void run() {
                    pendingSleepRunnables.remove(reqId);
                    dispatchNativeJsCallback("__onNativeSleepDone", reqId, "{\"ok\":true}");
                }
            };
            pendingSleepRunnables.put(reqId, task);
            nativeTimerHandler.postDelayed(task, safeMs);
        }

        @JavascriptInterface
        public void cancelNativeSleep(String reqId) {
            if (reqId == null || reqId.isEmpty()) return;
            Runnable task = pendingSleepRunnables.remove(reqId);
            if (task != null) {
                nativeTimerHandler.removeCallbacks(task);
            }
        }

        @JavascriptInterface
        public void nativeHttpPostAsync(
                String reqId,
                String urlStr,
                String headersJson,
                String bodyStr,
                int timeoutMs
        ) {
            if (reqId == null || reqId.isEmpty() || urlStr == null || urlStr.trim().isEmpty()) {
                if (reqId != null && !reqId.isEmpty()) {
                    dispatchNativeJsCallback(
                            "__onNativeHttpResult",
                            reqId,
                            "{\"ok\":false,\"status\":0,\"body\":\"\",\"error\":\"无效的请求参数\"}"
                    );
                }
                return;
            }
            executeNativeHttpPost(reqId, urlStr.trim(), headersJson, bodyStr, timeoutMs);
        }

        @JavascriptInterface
        public void cancelNativeHttp(String reqId) {
            if (reqId == null || reqId.isEmpty()) return;
            AtomicBoolean flag = cancelledHttpReqs.get(reqId);
            if (flag != null) {
                flag.set(true);
            }
            final HttpURLConnection conn = activeHttpConnections.remove(reqId);
            if (conn != null) {
                httpExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                });
            }
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
