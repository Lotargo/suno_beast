param([string]$IsccPath = '', [string]$Distro = 'Ubuntu')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $projectRoot '.cache\windows-installer'
$downloads = Join-Path $cache 'downloads'
$payload = Join-Path $projectRoot 'build\windows-installer\payload'
$output = Join-Path $projectRoot 'dist'
$ffmpegBuild = Join-Path $cache 'ffmpeg'
$pins = Get-Content -LiteralPath (Join-Path $projectRoot 'packaging\windows\dependencies.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
foreach ($directory in @($cache, $downloads, $payload, $output)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

function VerifiedDownload($Item) {
    $file = Join-Path $downloads $Item.file
    if (-not (Test-Path -LiteralPath $file)) { Invoke-WebRequest -Uri $Item.url -OutFile $file }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Item.sha256) { throw "SHA256 mismatch: $($Item.file)" }
    return $file
}
foreach ($name in @('node', 'ffmpeg', 'lame', 'zlib', 'toolchain')) { $null = VerifiedDownload $pins.$name }
if (-not $IsccPath) {
    $IsccPath = Join-Path $cache 'inno\ISCC.exe'
    if (-not (Test-Path -LiteralPath $IsccPath)) {
        $setup = VerifiedDownload $pins.inno
        $compilerDirectory = Join-Path $cache 'inno'
        $process = Start-Process -FilePath $setup -ArgumentList '/PORTABLE=1','/CURRENTUSER','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="' + $compilerDirectory + '"') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Inno Setup compiler bootstrap failed: $($process.ExitCode)" }
    }
}
if (-not (Test-Path -LiteralPath $IsccPath)) { throw 'Inno Setup compiler not found' }
$buildScript = Join-Path $projectRoot 'packaging\windows\build-ffmpeg.sh'
$buildKey = (Get-FileHash -LiteralPath $buildScript -Algorithm SHA256).Hash
$stamp = Join-Path $ffmpegBuild 'build-key.txt'
if (-not (Test-Path -LiteralPath $stamp) -or (Get-Content -LiteralPath $stamp -Raw).Trim() -ne $buildKey) {
    $scriptLinux = & wsl.exe -d $Distro -- wslpath -a $buildScript.Replace('\', '/')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the WSL build script path' }
    $downloadsLinux = & wsl.exe -d $Distro -- wslpath -a $downloads.Replace('\', '/')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the WSL downloads path' }
    $outputLinux = & wsl.exe -d $Distro -- wslpath -a $ffmpegBuild.Replace('\', '/')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the WSL output path' }
    & wsl.exe -d $Distro -- bash $scriptLinux.Trim() $downloadsLinux.Trim() $outputLinux.Trim()
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg cross compilation failed; see .cache/windows-installer/ffmpeg/*.log' }
    [IO.File]::WriteAllText($stamp, $buildKey)
}
# Rebuild the payload in a fresh directory so removed files cannot leak into setup.
$payload = Join-Path (Split-Path -Parent $payload) ('payload-' + [Guid]::NewGuid().ToString('N'))
foreach ($folder in @('extension', 'native', 'runtime', 'licenses\sources')) { New-Item -ItemType Directory -Path (Join-Path $payload $folder) -Force | Out-Null }
$extensionFiles = & git -C $projectRoot ls-files -- extension
if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate extension sources' }
foreach ($relative in $extensionFiles) {
    $destination = Join-Path $payload $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination $destination
}
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'native') -Filter '*.js' -File | Copy-Item -Destination (Join-Path $payload 'native')
foreach ($file in @('choose-path.ps1', 'install.ps1', 'uninstall.ps1')) { Copy-Item -LiteralPath (Join-Path $projectRoot "native\$file") -Destination (Join-Path $payload 'native') }
$nodeExtract = Join-Path $cache ('node-' + $pins.node.version)
if (-not (Test-Path -LiteralPath $nodeExtract)) { Expand-Archive -LiteralPath (Join-Path $downloads $pins.node.file) -DestinationPath $nodeExtract }
$nodeDirectory = Join-Path $nodeExtract ('node-v' + $pins.node.version + '-win-x64')
Copy-Item -LiteralPath (Join-Path $nodeDirectory 'node.exe') -Destination (Join-Path $payload 'runtime\node.exe')
if ((Get-FileHash -LiteralPath (Join-Path $payload 'runtime\node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pins.node.binarySha256) { throw 'Cached Node.js executable does not match the official binary checksum' }
Copy-Item -LiteralPath (Join-Path $nodeDirectory 'LICENSE') -Destination (Join-Path $payload 'licenses\NODE-LICENSE.txt')
foreach ($file in @('ffmpeg.exe', 'ffprobe.exe')) { Copy-Item -LiteralPath (Join-Path $ffmpegBuild "bin\$file") -Destination (Join-Path $payload 'runtime') }
Copy-Item -Path (Join-Path $ffmpegBuild 'licenses\*') -Destination (Join-Path $payload 'licenses') -Recurse
Copy-Item -Path (Join-Path $ffmpegBuild 'sources\*') -Destination (Join-Path $payload 'licenses\sources') -Recurse
$notices = Join-Path $cache 'toolchain-notices'
$toolchainFolder = 'llvm-mingw-20261006-ucrt-ubuntu-22.04-x86_64'
if (-not (Test-Path -LiteralPath (Join-Path $notices "$toolchainFolder\LICENSE.TXT"))) {
    New-Item -ItemType Directory -Path $notices -Force | Out-Null
    & tar.exe -xf (Join-Path $downloads $pins.toolchain.file) -C $notices "$toolchainFolder/LICENSE.TXT" "$toolchainFolder/x86_64-w64-mingw32/share/mingw32"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract MinGW runtime license notices' }
}
Copy-Item -LiteralPath (Join-Path $notices "$toolchainFolder\LICENSE.TXT") -Destination (Join-Path $payload 'licenses\LLVM-MINGW-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $notices "$toolchainFolder\x86_64-w64-mingw32\share\mingw32") -Destination (Join-Path $payload 'licenses\MINGW') -Recurse
Copy-Item -LiteralPath (Join-Path $ffmpegBuild 'ffmpeg-configure.log') -Destination (Join-Path $payload 'licenses\sources\ffmpeg-build-configuration.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'packaging\windows\dependencies.json') -Destination (Join-Path $payload 'licenses\sources')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $payload 'LICENSE')
$utf8 = [Text.UTF8Encoding]::new($false)
$noticeText = @'
Suno Beast bundles Node.js, FFmpeg, LAME and zlib, plus MinGW runtime code.
Their license texts are included in this directory. Suno Beast's own code is MIT licensed.
FFmpeg is built without GPL or nonfree components; its build reports LGPL 2.1 or later.
The exact unmodified FFmpeg, LAME and zlib source archives, configuration and build script
are included in sources/. Component versions, original URLs and SHA256 hashes are recorded
in sources/dependencies.json and ../runtime-info.json. Node.js notices cover its bundled libraries.
To rebuild the FFmpeg executables, follow packaging/windows/build-ffmpeg.sh from the project
or sources/build-ffmpeg.sh, using the pinned LLVM-MinGW toolchain and verified source archives.
'@
[IO.File]::WriteAllText((Join-Path $payload 'licenses\THIRD-PARTY-NOTICES.txt'), $noticeText, $utf8)
[IO.File]::WriteAllText((Join-Path $payload 'native\launch-host.cmd'), "@echo off`r`n`"%~dp0..\runtime\node.exe`" `"%~dp0host.js`" %*`r`n", [Text.Encoding]::ASCII)
# A UTF-16 BOM keeps Unicode registry paths intact through Windows INI APIs.
[IO.File]::WriteAllText((Join-Path $payload 'registration-empty.ini'), '', [Text.Encoding]::Unicode)
$runtimeInfo = @{ productVersion = $package.version; architecture = 'x64'; dependencies = $pins; binaries = @{} }
foreach ($file in @('node.exe', 'ffmpeg.exe', 'ffprobe.exe')) { $runtimeInfo.binaries[$file] = (Get-FileHash -LiteralPath (Join-Path $payload "runtime\$file") -Algorithm SHA256).Hash.ToLowerInvariant() }
[IO.File]::WriteAllText((Join-Path $payload 'runtime-info.json'), ($runtimeInfo | ConvertTo-Json -Depth 8), $utf8)
# Windows ICO supports the existing PNG assets; no image conversion dependency is needed.
$sizes = @(16, 32, 48, 128)
$images = @($sizes | ForEach-Object { ,([IO.File]::ReadAllBytes((Join-Path $payload "extension\assets\icon-$_.png"))) })
$iconStream = [IO.MemoryStream]::new()
$iconWriter = [IO.BinaryWriter]::new($iconStream)
$iconWriter.Write([UInt16]0); $iconWriter.Write([UInt16]1); $iconWriter.Write([UInt16]$sizes.Count)
$iconOffset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $iconWriter.Write([byte]$sizes[$i]); $iconWriter.Write([byte]$sizes[$i]); $iconWriter.Write([UInt16]0)
    $iconWriter.Write([UInt16]1); $iconWriter.Write([UInt16]32)
    $iconWriter.Write([UInt32]$images[$i].Length); $iconWriter.Write([UInt32]$iconOffset)
    $iconOffset += $images[$i].Length
}
foreach ($imageBytes in $images) { $iconWriter.Write([byte[]]$imageBytes) }
[IO.File]::WriteAllBytes((Join-Path $payload 'app.ico'), $iconStream.ToArray())
$iconWriter.Dispose(); $iconStream.Dispose()
$node = Join-Path $payload 'runtime\node.exe'
& $node (Join-Path $payload 'native\self-check.js')
if ($LASTEXITCODE -ne 0) { throw 'Bundle self-check failed' }
$extensionId = & $node (Join-Path $payload 'native\extension-id.js')
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine extension ID' }
& $IsccPath ('/DAppVersion=' + $package.version) ('/DSourceDir=' + $payload) ('/DOutputDir=' + $output) ('/DExtensionId=' + $extensionId) (Join-Path $projectRoot 'packaging\windows\setup.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
$installer = Join-Path $output ('Suno-Beast-v' + $package.version + '-Windows-x64-Setup.exe')
Get-FileHash -LiteralPath $installer -Algorithm SHA256
Write-Output "Installer: $installer"
Write-Output "Payload: $payload"
