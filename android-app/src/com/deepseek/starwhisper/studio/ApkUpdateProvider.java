package com.deepseek.starwhisper.studio;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 专用只读 APK 更新包 ContentProvider：
 * 严格限定仅开放应用私有目录 files/updates/starwhisper_update.apk 的只读句柄给系统包安装程序。
 */
public class ApkUpdateProvider extends ContentProvider {
    public static final String AUTHORITY = "com.deepseek.starwhisper.studio.updateprovider";
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String RELATIVE_PATH = "apk/starwhisper_update.apk";
    private static final String FILE_NAME = "starwhisper_update.apk";

    public static File getUpdateDir(Context context) {
        return new File(context.getFilesDir(), "updates");
    }

    public static File getUpdateApkFile(Context context) {
        return new File(getUpdateDir(context), FILE_NAME);
    }

    public static Uri getUpdateApkUri(Context context) {
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath("apk")
                .appendPath(FILE_NAME)
                .build();
    }

    private boolean isValidApkUri(Uri uri) {
        if (uri == null) return false;
        String path = uri.getPath();
        return ("/" + RELATIVE_PATH).equals(path);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        if (!isValidApkUri(uri) || getContext() == null) {
            return null;
        }
        File file = getUpdateApkFile(getContext());
        String[] cols = projection != null
                ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};

        String[] outCols = new String[cols.length];
        Object[] values = new Object[cols.length];
        int i = 0;
        for (String col : cols) {
            if (OpenableColumns.DISPLAY_NAME.equals(col)) {
                outCols[i] = OpenableColumns.DISPLAY_NAME;
                values[i++] = "DeepSeek_StarWhisper_update.apk";
            } else if (OpenableColumns.SIZE.equals(col)) {
                outCols[i] = OpenableColumns.SIZE;
                values[i++] = file.exists() ? file.length() : 0L;
            }
        }
        String[] trimmedCols = new String[i];
        Object[] trimmedVals = new Object[i];
        System.arraycopy(outCols, 0, trimmedCols, 0, i);
        System.arraycopy(values, 0, trimmedVals, 0, i);

        MatrixCursor cursor = new MatrixCursor(trimmedCols, 1);
        cursor.addRow(trimmedVals);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        return isValidApkUri(uri) ? APK_MIME_TYPE : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!isValidApkUri(uri)) {
            throw new SecurityException("禁止访问非授权路径: " + uri);
        }
        if (mode == null || !"r".equals(mode.toLowerCase())) {
            throw new SecurityException("仅允许只读模式打开更新包");
        }
        Context ctx = getContext();
        if (ctx == null) {
            throw new FileNotFoundException("Context 不可用");
        }
        File file = getUpdateApkFile(ctx);
        if (!file.exists() || !file.isFile()) {
            throw new FileNotFoundException("更新安装包文件不存在");
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("只读更新源不支持写入");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("只读更新源不支持删除");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("只读更新源不支持修改");
    }
}
