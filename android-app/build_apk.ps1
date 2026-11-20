$ErrorActionPreference = "Stop"

$SdkRoot = "E:\android_sdk_env\sdk"
$JdkRoot = "E:\android_sdk_env\jdk"
$env:JAVA_HOME = $JdkRoot
$env:PATH = "$JdkRoot\bin;$env:PATH"

$BuildTools = "$SdkRoot\build-tools\35.0.0"
$AndroidJar = "$SdkRoot\platforms\android-34\android.jar"
$Aapt2 = "$BuildTools\aapt2.exe"
$D8 = "$BuildTools\d8.bat"
$ZipAlign = "$BuildTools\zipalign.exe"
$ApkSigner = "$BuildTools\apksigner.bat"
$Javac = "$JdkRoot\bin\javac.exe"
$Keytool = "$JdkRoot\bin\keytool.exe"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $ProjectRoot
$BuildDir = "E:\android_sdk_env\apk_build_staging"

if (Test-Path $BuildDir) {
    Remove-Item $BuildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path "$BuildDir\compiled_res" | Out-Null
New-Item -ItemType Directory -Force -Path "$BuildDir\gen" | Out-Null
New-Item -ItemType Directory -Force -Path "$BuildDir\classes" | Out-Null
New-Item -ItemType Directory -Force -Path "$BuildDir\dex" | Out-Null
New-Item -ItemType Directory -Force -Path "$BuildDir\staging\assets\public" | Out-Null

# 1. 生成 1:1 官方大鲸鱼无损 Android VectorDrawable 与全尺寸高清抗锯齿桌面图标 (mdpi ~ xxxhdpi)
Write-Output "[0/6] Generating 1:1 DeepSeek Whale Adaptive Vector & Multi-DPI Launcher Icons..."
$FgXml = "$ProjectRoot\res\drawable\ic_launcher_foreground.xml"
$WhaleGenJs = "$ProjectRoot\whale_vector_gen.js"
$WhalePolyJson = & node $WhaleGenJs $FgXml
if ($LASTEXITCODE -ne 0) { throw "whale_vector_gen.js failed" }
$WhaleSubpaths = $WhalePolyJson | ConvertFrom-Json

Add-Type -AssemblyName System.Drawing

function Draw-DeepSeekWhaleIcon {
    param(
        [int]$Size,
        [bool]$IsRound,
        [string]$OutPath
    )
    # 4x 超采样渲染再高质量双三次下采样，确保边缘丝滑锐利媲美原生矢量
    $SS = $Size * 4
    $hiBmp = New-Object System.Drawing.Bitmap($SS, $SS)
    $hg = [System.Drawing.Graphics]::FromImage($hiBmp)
    $hg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $hg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $hg.Clear([System.Drawing.Color]::Transparent)

    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 15, 23, 42), [single]([Math]::Max(2.0, $SS * 0.012)))
    $pad = [single]($SS * 0.04)
    $box = [single]($SS - $pad * 2)

    if ($IsRound) {
        $hg.FillEllipse($whiteBrush, $pad, $pad, $box, $box)
        $hg.DrawEllipse($borderPen, $pad, $pad, $box, $box)
    } else {
        $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r = [single]($box * 0.225)
        $d = $r * 2
        $bgPath.AddArc($pad, $pad, $d, $d, 180, 90)
        $bgPath.AddArc($pad + $box - $d, $pad, $d, $d, 270, 90)
        $bgPath.AddArc($pad + $box - $d, $pad + $box - $d, $d, $d, 0, 90)
        $bgPath.AddArc($pad, $pad + $box - $d, $d, $d, 90, 90)
        $bgPath.CloseFigure()
        $hg.FillPath($whiteBrush, $bgPath)
        $hg.DrawPath($borderPen, $bgPath)
        $bgPath.Dispose()
    }

    # 绘制居中饱满的 #4D6BFE 官方大鲸鱼 (占图标宽度约 68%)
    $whalePath = New-Object System.Drawing.Drawing2D.GraphicsPath([System.Drawing.Drawing2D.FillMode]::Alternate)
    $targetW = $SS * 0.66
    $wScale = $targetW / 23.85
    $offX = ($SS - 23.90 * $wScale) / 2.0
    $offY = ($SS - 23.04 * $wScale) / 2.0

    foreach ($sp in $WhaleSubpaths) {
        $pts = New-Object 'System.Drawing.PointF[]' $sp.Count
        for ($k = 0; $k -lt $sp.Count; $k++) {
            $pts[$k] = New-Object System.Drawing.PointF(
                ([single]($sp[$k][0] * $wScale + $offX)),
                ([single]($sp[$k][1] * $wScale + $offY))
            )
        }
        if ($pts.Length -ge 3) {
            $whalePath.AddPolygon($pts)
        }
    }

    $whaleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 77, 107, 254))
    $hg.FillPath($whaleBrush, $whalePath)

    $outBmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $og = [System.Drawing.Graphics]::FromImage($outBmp)
    $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $og.DrawImage($hiBmp, 0, 0, $Size, $Size)
    $outBmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $og.Dispose()
    $outBmp.Dispose()
    $whaleBrush.Dispose()
    $whalePath.Dispose()
    $borderPen.Dispose()
    $whiteBrush.Dispose()
    $hg.Dispose()
    $hiBmp.Dispose()
}

$DpiConfigs = @(
    @{ Dir = "mipmap-mdpi";    Size = 48  },
    @{ Dir = "mipmap-hdpi";    Size = 72  },
    @{ Dir = "mipmap-xhdpi";   Size = 96  },
    @{ Dir = "mipmap-xxhdpi";  Size = 144 },
    @{ Dir = "mipmap-xxxhdpi"; Size = 192 }
)

foreach ($cfg in $DpiConfigs) {
    $dirPath = "$ProjectRoot\res\$($cfg.Dir)"
    New-Item -ItemType Directory -Force -Path $dirPath | Out-Null
    Draw-DeepSeekWhaleIcon -Size $cfg.Size -IsRound $false -OutPath "$dirPath\ic_launcher.png"
    Draw-DeepSeekWhaleIcon -Size $cfg.Size -IsRound $true  -OutPath "$dirPath\ic_launcher_round.png"
}
Draw-DeepSeekWhaleIcon -Size 512 -IsRound $false -OutPath "$WorkspaceRoot\public\assets\apk-icon-preview.png"

# 2. 同步最新 Web 前端资产至 staging/assets/public (排除 downloads 目录防止循环套娃)
Write-Output "[1/6] Syncing web assets..."
Get-ChildItem -Path "$WorkspaceRoot\public" | Where-Object { $_.Name -ne "downloads" } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$BuildDir\staging\assets\public" -Recurse -Force
}

New-Item -ItemType Directory -Force -Path "$BuildDir\proj" | Out-Null
Copy-Item -Path "$ProjectRoot\res" -Destination "$BuildDir\proj\res" -Recurse -Force
Copy-Item -Path "$ProjectRoot\src" -Destination "$BuildDir\proj\src" -Recurse -Force
Copy-Item -Path "$ProjectRoot\AndroidManifest.xml" -Destination "$BuildDir\proj\AndroidManifest.xml" -Force

# 3. 编译并链接 Android 资源与 Manifest (在纯英文暂存路径执行以避开 aapt2 ANSI 路径限制)
Write-Output "[2/6] Compiling Android resources with aapt2..."
& $Aapt2 compile --dir "$BuildDir\proj\res" -o "$BuildDir\compiled_res\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $Aapt2 link `
    -I $AndroidJar `
    --manifest "$BuildDir\proj\AndroidManifest.xml" `
    --java "$BuildDir\gen" `
    -o "$BuildDir\unaligned_base.apk" `
    --auto-add-overlay `
    "$BuildDir\compiled_res\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

# 4. 编译 Java 源码与生成的 R.java (使用 -source 8 -target 8 -bootclasspath 对齐 Android 字节码规范)
Write-Output "[3/6] Compiling Java sources with OpenJDK 21..."
$JavaFiles = Get-ChildItem -Path "$BuildDir\proj\src","$BuildDir\gen" -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }
& $Javac -encoding UTF-8 -source 8 -target 8 -bootclasspath $AndroidJar -d "$BuildDir\classes" $JavaFiles
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

# 5. 使用 jar 归档后交由 d8 转换为 Android Dalvik 字节码 classes.dex
Write-Output "[4/6] Dexing bytecode with d8..."
$JarTool = "$JdkRoot\bin\jar.exe"
$ClassesJar = "$BuildDir\classes.jar"
& $JarTool cf $ClassesJar -C "$BuildDir\classes" .
if ($LASTEXITCODE -ne 0) { throw "jar failed" }
& $D8 --lib $AndroidJar --min-api 24 --output "$BuildDir\dex" $ClassesJar
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

# 6. 将 classes.dex 与 assets/public 注入 APK 归档
Write-Output "[5/6] Packaging assets and classes.dex into APK..."
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$apkZipPath = "$BuildDir\unaligned_full.apk"
Copy-Item "$BuildDir\unaligned_base.apk" $apkZipPath -Force

$zip = [System.IO.Compression.ZipFile]::Open($apkZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip,
        "$BuildDir\dex\classes.dex",
        "classes.dex",
        [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null

    $assetRoot = "$BuildDir\staging"
    Get-ChildItem -Path "$assetRoot\assets" -File -Recurse | ForEach-Object {
        $relPath = $_.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $_.FullName,
            $relPath,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $zip.Dispose()
}

# 7. zipalign 4字节对齐 + apksigner V1/V2/V3 正式签名校验
Write-Output "[6/6] Aligning and signing APK..."
$AlignedApk = "$BuildDir\aligned.apk"
& $ZipAlign -p -f 4 $apkZipPath $AlignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$KeystorePath = "E:\android_sdk_env\release_signing.jks"
if (-not (Test-Path $KeystorePath)) {
    & $Keytool -genkeypair `
        -v `
        -keystore $KeystorePath `
        -alias deepseek_studio `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -storepass "deepseek2026" `
        -keypass "deepseek2026" `
        -dname "CN=DeepSeek StarWhisper Studio, OU=Mobile, O=StarWhisper, L=Shanghai, ST=Shanghai, C=CN"
}

New-Item -ItemType Directory -Force -Path "$WorkspaceRoot\public\downloads" | Out-Null
$OutApkWeb = "$WorkspaceRoot\public\downloads\deepseek-studio.apk"
$OutApkRoot = "$WorkspaceRoot\DeepSeek_星语随身版.apk"

$SignedStagingApk = "$BuildDir\signed_release.apk"

& $ApkSigner sign `
    --ks $KeystorePath `
    --ks-key-alias deepseek_studio `
    --ks-pass pass:deepseek2026 `
    --key-pass pass:deepseek2026 `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v3-signing-enabled true `
    --out $SignedStagingApk `
    $AlignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

& $ApkSigner verify --verbose $SignedStagingApk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

Copy-Item -Path $SignedStagingApk -Destination $OutApkRoot -Force
Copy-Item -Path $SignedStagingApk -Destination $OutApkWeb -Force
Copy-Item -Path $SignedStagingApk -Destination "$WorkspaceRoot\public\downloads\DeepSeek_星语随身版.apk" -Force

$apkInfo = Get-Item $OutApkRoot
Write-Output "APK_BUILD_SUCCESS: $($apkInfo.FullName) ($($apkInfo.Length) bytes)"
