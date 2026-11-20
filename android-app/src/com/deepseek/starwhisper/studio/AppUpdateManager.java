package com.deepseek.starwhisper.studio;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 原生应用可靠自更新管理器：
 * 1. 从系统 PackageManager 实时读取当前安装包的 versionName、versionCode 与签名证书 SHA-256；
 * 2. 在后台线程直连生产源服务器检查最新版本，彻底绕开 WebView 离线静态适配器的本地截获；
 * 3. 支持签名票据流式下载、实时百分比与网速回调、ZIP 头 + 字节大小 + SHA-256 完整性三重校验；
 * 4. 校验通过后通过 ApkUpdateProvider 自动拉起 Android 系统安装器覆盖升级。
 */
public class AppUpdateManager {
    public static final int INSTALL_PERM_REQ_CODE = 1002;
    private static final String PRIMARY_BASE = "https://star.claudexxb.online";
    private static final String BACKUP_BASE = "https://rp.claudexxb.online";

    private static final AtomicBoolean sDownloading = new AtomicBoolean(false);
    private static final AtomicBoolean sCancelRequested = new AtomicBoolean(false);

    public interface CheckCallback {
        void onComplete(String resultJson);
    }

    public interface ProgressCallback {
        void onProgress(String progressJson);
    }

    public static String getInstalledVersionName(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (pi != null && pi.versionName != null && !pi.versionName.trim().isEmpty()) {
                return pi.versionName.trim();
            }
        } catch (Exception ignored) {}
        return "1.9.2";
    }

    @SuppressWarnings("deprecation")
    public static long getInstalledVersionCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (pi != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return pi.getLongVersionCode();
                }
                return pi.versionCode;
            }
        } catch (Exception ignored) {}
        return 122L;
    }

    @SuppressWarnings("deprecation")
    public static String getApkCertSha256(Context ctx) {
        try {
            PackageManager pm = ctx.getPackageManager();
            Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo pi = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (pi != null && pi.signingInfo != null) {
                    sigs = pi.signingInfo.hasMultipleSigners()
                            ? pi.signingInfo.getApkContentsSigners()
                            : pi.signingInfo.getSigningCertificateHistory();
                }
            } else {
                PackageInfo pi = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES);
                if (pi != null) sigs = pi.signatures;
            }
            if (sigs != null && sigs.length > 0 && sigs[0] != null) {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] digest = md.digest(sigs[0].toByteArray());
                return bytesToHex(digest);
            }
        } catch (Exception ignored) {}
        return "";
    }

    public static String getInstalledVersionJson(Context ctx) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("versionName", getInstalledVersionName(ctx));
            obj.put("versionCode", getInstalledVersionCode(ctx));
            obj.put("certSha256", getApkCertSha256(ctx));
            obj.put("packageName", ctx.getPackageName());
            return obj.toString();
        } catch (Exception e) {
            return "{\"versionName\":\"1.9.2\",\"versionCode\":122}";
        }
    }

    public static void checkUpdateAsync(final Context ctx, final CheckCallback callback) {
        final Context appCtx = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                String localVer = getInstalledVersionName(appCtx);
                long localCode = getInstalledVersionCode(appCtx);
                String certSig = getApkCertSha256(appCtx);

                String query = "";
                try {
                    query = "/api/app-version?client=android_apk"
                            + "&curCode=" + localCode
                            + "&curVer=" + URLEncoder.encode(localVer, "UTF-8")
                            + "&sig=" + URLEncoder.encode(certSig, "UTF-8")
                            + "&t=" + System.currentTimeMillis();
                } catch (Exception e) {
                    query = "/api/app-version?client=android_apk&curCode=" + localCode + "&sig=" + certSig + "&t=" + System.currentTimeMillis();
                }

                String[] endpoints = new String[]{PRIMARY_BASE + query, BACKUP_BASE + query};
                String lastErr = "无法连接到更新服务器";
                String userAgent = "StarWhisper-Android/" + localVer + " (Android " + Build.VERSION.RELEASE + "; API " + Build.VERSION.SDK_INT + ")";

                for (String ep : endpoints) {
                    try {
                        HttpURLConnection conn = openWithRedirects(ep, userAgent, 10000, 12000);
                        int code = conn.getResponseCode();
                        if (code >= 200 && code < 300) {
                            String raw = readAllText(conn.getInputStream());
                            conn.disconnect();
                            JSONObject remote = new JSONObject(raw);
                            if (!remote.has("latestVersion")) {
                                lastErr = "服务端返回版本格式异常";
                                continue;
                            }
                            String remoteVer = remote.optString("latestVersion", localVer);
                            long remoteCode = remote.optLong("versionCode", 0L);
                            boolean hasUpdate = (remoteCode > localCode) || (compareSemver(remoteVer, localVer) > 0);

                            String expectedSha = remote.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
                            long expectedBytes = remote.optLong("fileSizeBytes", 0L);
                            boolean alreadyDownloaded = isLocalUpdateReady(appCtx, expectedSha, expectedBytes);

                            JSONObject out = new JSONObject();
                            out.put("ok", true);
                            out.put("hasUpdate", hasUpdate);
                            out.put("alreadyDownloaded", alreadyDownloaded);
                            out.put("localVersion", localVer);
                            out.put("localVersionCode", localCode);
                            out.put("latestVersion", remoteVer);
                            out.put("versionCode", remoteCode);
                            out.put("fileSize", remote.optString("fileSize", ""));
                            out.put("fileSizeBytes", expectedBytes);
                            out.put("sha256", expectedSha);
                            out.put("apkFileName", remote.optString("apkFileName", "DeepSeek_StarWhisper.apk"));
                            out.put("nativeUpdateUrl", remote.optString("nativeUpdateUrl", ""));
                            out.put("downloadUrl", remote.optString("downloadUrl", "/api/download/apk"));
                            out.put("fallbackDownloadUrl", remote.optString("fallbackDownloadUrl", PRIMARY_BASE + "/api/download/apk"));
                            out.put("githubReleasesUrl", remote.optString("githubReleasesUrl", ""));
                            out.put("releaseDate", remote.optString("releaseDate", ""));
                            JSONArray cl = remote.optJSONArray("changelog");
                            out.put("changelog", cl != null ? cl : new JSONArray());
                            out.put("checkedAt", System.currentTimeMillis());

                            callback.onComplete(out.toString());
                            return;
                        } else {
                            lastErr = "更新服务响应异常 (HTTP " + code + ")";
                            conn.disconnect();
                        }
                    } catch (Exception ex) {
                        lastErr = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
                    }
                }

                try {
                    JSONObject errObj = new JSONObject();
                    errObj.put("ok", false);
                    errObj.put("localVersion", localVer);
                    errObj.put("localVersionCode", localCode);
                    errObj.put("error", lastErr);
                    callback.onComplete(errObj.toString());
                } catch (Exception ignored) {
                    callback.onComplete("{\"ok\":false,\"error\":\"检查更新失败\"}");
                }
            }
        }).start();
    }

    public static void startDownloadAsync(
            final Activity activity,
            final String rawDownloadUrl,
            final String expectedSha256,
            final long expectedBytes,
            final ProgressCallback callback
    ) {
        if (!sDownloading.compareAndSet(false, true)) {
            emitProgress(callback, "downloading", 0, 0, expectedBytes, 0, "已有更新任务正在下载中");
            return;
        }
        sCancelRequested.set(false);
        final Context appCtx = activity.getApplicationContext();

        new Thread(new Runnable() {
            @Override
            public void run() {
                File dir = ApkUpdateProvider.getUpdateDir(appCtx);
                if (!dir.exists()) dir.mkdirs();
                File finalFile = ApkUpdateProvider.getUpdateApkFile(appCtx);
                File partFile = new File(dir, "starwhisper_update.apk.part");

                String cleanExpectedSha = expectedSha256 != null ? expectedSha256.trim().toLowerCase(Locale.ROOT) : "";

                // 若本地已完整保留符合校验的新版安装包，直接走快捷安装分支
                if (isLocalUpdateReady(appCtx, cleanExpectedSha, expectedBytes)) {
                    sDownloading.set(false);
                    emitProgress(callback, "ready", 100, finalFile.length(), finalFile.length(), 0, "检测到已下载完成的校验安装包，正准备安装");
                    String installStatus = triggerInstall(activity);
                    handleInstallResultProgress(installStatus, finalFile.length(), callback);
                    return;
                }

                if (partFile.exists()) {
                    partFile.delete();
                }

                String urlStr = rawDownloadUrl != null ? rawDownloadUrl.trim() : "";
                if (urlStr.startsWith("/")) {
                    urlStr = PRIMARY_BASE + urlStr;
                }
                if (urlStr.isEmpty()) {
                    sDownloading.set(false);
                    emitProgress(callback, "error", 0, 0, expectedBytes, 0, "缺少有效的下载地址，请点击检查更新重试");
                    return;
                }

                String localVer = getInstalledVersionName(appCtx);
                String userAgent = "StarWhisper-Android/" + localVer + " (Android " + Build.VERSION.RELEASE + "; API " + Build.VERSION.SDK_INT + ")";
                HttpURLConnection conn = null;
                BufferedInputStream bis = null;
                FileOutputStream fos = null;

                try {
                    emitProgress(callback, "downloading", 0, 0, expectedBytes, 0, "正在建立安全下载连接...");
                    conn = openWithRedirects(urlStr, userAgent, 15000, 30000);
                    int httpCode = conn.getResponseCode();
                    if (httpCode < 200 || httpCode >= 300) {
                        throw new Exception("下载请求被拒绝或失效 (HTTP " + httpCode + ")，请重新检查更新");
                    }

                    long contentLen = conn.getContentLengthLong();
                    long totalBytes = contentLen > 0 ? contentLen : expectedBytes;

                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    bis = new BufferedInputStream(conn.getInputStream());
                    fos = new FileOutputStream(partFile);

                    byte[] buf = new byte[8192];
                    long downloaded = 0L;
                    long lastTickMs = System.currentTimeMillis();
                    long lastTickBytes = 0L;
                    int firstByte = -1;
                    int secondByte = -1;

                    int read;
                    while ((read = bis.read(buf)) != -1) {
                        if (sCancelRequested.get()) {
                            closeQuietly(fos);
                            closeQuietly(bis);
                            partFile.delete();
                            sDownloading.set(false);
                            emitProgress(callback, "cancelled", 0, downloaded, totalBytes, 0, "已取消安装包下载");
                            return;
                        }
                        if (downloaded == 0 && read >= 1) firstByte = buf[0] & 0xFF;
                        if (downloaded == 0 && read >= 2) secondByte = buf[1] & 0xFF;
                        else if (downloaded == 1 && read >= 1) secondByte = buf[0] & 0xFF;

                        fos.write(buf, 0, read);
                        md.update(buf, 0, read);
                        downloaded += read;

                        long now = System.currentTimeMillis();
                        long elapsed = now - lastTickMs;
                        if (elapsed >= 150L) {
                            long speedBps = (long) (((downloaded - lastTickBytes) * 1000.0) / Math.max(1L, elapsed));
                            int pct = totalBytes > 0 ? (int) Math.min(99L, (downloaded * 100L) / totalBytes) : 0;
                            emitProgress(callback, "downloading", pct, downloaded, totalBytes, speedBps, "正在下载最新版安装包...");
                            lastTickMs = now;
                            lastTickBytes = downloaded;
                        }
                    }

                    fos.getFD().sync();
                    closeQuietly(fos);
                    fos = null;
                    closeQuietly(bis);
                    bis = null;
                    conn.disconnect();
                    conn = null;

                    if (downloaded <= 1024 || firstByte != 0x50 || secondByte != 0x4B) {
                        partFile.delete();
                        throw new Exception("下载内容不是有效的 APK 安装包，可能受到网络代理拦截，请尝试浏览器下载");
                    }

                    if (expectedBytes > 0 && downloaded != expectedBytes) {
                        partFile.delete();
                        throw new Exception("安装包体积不匹配 (实得 " + downloaded + " 字节，期望 " + expectedBytes + " 字节)");
                    }

                    String actualSha = bytesToHex(md.digest());
                    if (!cleanExpectedSha.isEmpty() && !cleanExpectedSha.equals(actualSha)) {
                        partFile.delete();
                        throw new Exception("安装包 SHA-256 完整性校验未通过，为保障安全已自动丢弃");
                    }

                    if (finalFile.exists()) {
                        finalFile.delete();
                    }
                    if (!partFile.renameTo(finalFile)) {
                        throw new Exception("保存安装包至内部更新区失败");
                    }

                    sDownloading.set(false);
                    emitProgress(callback, "ready", 100, downloaded, downloaded, 0, "校验通过，正在调起系统安装器...");
                    String installStatus = triggerInstall(activity);
                    handleInstallResultProgress(installStatus, downloaded, callback);
                } catch (Exception e) {
                    closeQuietly(fos);
                    closeQuietly(bis);
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Exception ignored) {}
                    }
                    if (partFile.exists()) partFile.delete();
                    sDownloading.set(false);
                    String msg = e.getMessage() != null ? e.getMessage() : "更新下载出现异常";
                    emitProgress(callback, "error", 0, 0, expectedBytes, 0, msg);
                }
            }
        }).start();
    }

    public static void cancelDownload() {
        sCancelRequested.set(true);
    }

    public static String triggerInstall(final Activity activity) {
        if (activity == null) return "ACTIVITY_UNAVAILABLE";
        final File apkFile = ApkUpdateProvider.getUpdateApkFile(activity);
        if (!apkFile.exists() || !apkFile.isFile() || apkFile.length() <= 1024) {
            return "NO_FILE";
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                Intent permIntent = new Intent(
                                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:" + activity.getPackageName())
                                );
                                activity.startActivityForResult(permIntent, INSTALL_PERM_REQ_CODE);
                            } catch (Exception ignored) {}
                        }
                    });
                    return "NEED_INSTALL_PERMISSION";
                }
            }

            final Uri contentUri = ApkUpdateProvider.getUpdateApkUri(activity);
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(intent);
                    } catch (Exception e) {
                        android.widget.Toast.makeText(activity, "拉起系统安装器失败: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            });
            return "STARTED";
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "安装启动异常");
        }
    }

    private static void handleInstallResultProgress(String installStatus, long fileSize, ProgressCallback cb) {
        if ("NEED_INSTALL_PERMISSION".equals(installStatus)) {
            emitProgress(cb, "need_permission", 100, fileSize, fileSize, 0, "请先在系统设置开启「允许安装未知应用」后返回继续");
        } else if ("STARTED".equals(installStatus)) {
            emitProgress(cb, "installing", 100, fileSize, fileSize, 0, "已调起系统安装器，请确认安装以完成升级");
        } else {
            emitProgress(cb, "error", 100, fileSize, fileSize, 0, "启动安装器失败：" + installStatus);
        }
    }

    private static boolean isLocalUpdateReady(Context ctx, String expectedSha256, long expectedBytes) {
        File file = ApkUpdateProvider.getUpdateApkFile(ctx);
        if (!file.exists() || !file.isFile() || file.length() <= 1024) return false;
        if (expectedBytes > 0 && file.length() != expectedBytes) return false;
        if (expectedSha256 != null && !expectedSha256.isEmpty()) {
            String actual = sha256File(file);
            return expectedSha256.equalsIgnoreCase(actual);
        }
        return false;
    }

    private static String sha256File(File file) {
        FileInputStream fis = null;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            fis = new FileInputStream(file);
            byte[] buf = new byte[8192];
            int r;
            while ((r = fis.read(buf)) != -1) {
                md.update(buf, 0, r);
            }
            return bytesToHex(md.digest());
        } catch (Exception e) {
            return "";
        } finally {
            closeQuietly(fis);
        }
    }

    private static HttpURLConnection openWithRedirects(String urlStr, String ua, int connectMs, int readMs) throws Exception {
        String current = urlStr;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(connectMs);
            conn.setReadTimeout(readMs);
            conn.setRequestProperty("User-Agent", ua);
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Cache-Control", "no-cache");
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.trim().isEmpty()) {
                    throw new Exception("重定向地址为空");
                }
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            return conn;
        }
        throw new Exception("下载链接重定向次数过多");
    }

    private static String readAllText(InputStream is) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        char[] buf = new char[2048];
        int n;
        while ((n = br.read(buf)) != -1) {
            sb.append(buf, 0, n);
        }
        br.close();
        return sb.toString();
    }

    private static int compareSemver(String a, String b) {
        String[] pa = String.valueOf(a).replaceFirst("^[vV]", "").split("[\\-+]", 2)[0].split("\\.");
        String[] pb = String.valueOf(b).replaceFirst("^[vV]", "").split("[\\-+]", 2)[0].split("\\.");
        int len = Math.max(pa.length, pb.length);
        for (int i = 0; i < len; i++) {
            int va = 0;
            int vb = 0;
            try { if (i < pa.length) va = Integer.parseInt(pa[i].replaceAll("[^0-9]", "")); } catch (Exception ignored) {}
            try { if (i < pb.length) vb = Integer.parseInt(pb[i].replaceAll("[^0-9]", "")); } catch (Exception ignored) {}
            if (va > vb) return 1;
            if (va < vb) return -1;
        }
        return 0;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            int v = b & 0xFF;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v));
        }
        return sb.toString();
    }

    private static void emitProgress(ProgressCallback cb, String stage, int percent, long downloaded, long total, long speedBps, String message) {
        if (cb == null) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("stage", stage);
            obj.put("percent", percent);
            obj.put("downloadedBytes", downloaded);
            obj.put("totalBytes", total);
            obj.put("speedBps", speedBps);
            obj.put("message", message != null ? message : "");
            cb.onProgress(obj.toString());
        } catch (Exception ignored) {}
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c != null) {
            try { c.close(); } catch (Exception ignored) {}
        }
    }
}
