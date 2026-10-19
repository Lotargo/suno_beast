param([string]$RegistryRoot = 'HKCU:\Software')
$ErrorActionPreference = 'Stop'
# Opera, Opera GX and Yandex Browser use the Chrome registration on Windows.
$vendors = @('Google\Chrome', 'Microsoft\Edge')
$hostDir = $PSScriptRoot
$projectDir = Split-Path -Parent $hostDir
$runtimeDir = Join-Path $projectDir 'runtime'
$bundled = Test-Path -LiteralPath (Join-Path $runtimeDir 'node.exe')
if ($bundled) {
    $nodePath = Join-Path $runtimeDir 'node.exe'
    foreach ($tool in @('ffmpeg.exe', 'ffprobe.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir $tool))) { throw "Bundled tool is missing: $tool. Reinstall Suno Beast." }
    }
} else {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    Get-Command ffmpeg.exe -ErrorAction Stop | Out-Null
    Get-Command ffprobe.exe -ErrorAction Stop | Out-Null
}
$extensionId = & $nodePath (Join-Path $hostDir 'extension-id.js')
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine extension ID' }
$launcher = Join-Path $hostDir 'launch-host.cmd'
# Keep the launcher ASCII: node handles the Unicode source path from this directory.
$launcherNode = if ($bundled) { '%~dp0..\runtime\node.exe' } else { $nodePath }
$launcherBody = "@echo off`r`n`"$launcherNode`" `"%~dp0host.js`" %*`r`n"
[IO.File]::WriteAllText($launcher, $launcherBody, [Text.Encoding]::ASCII)
$hostManifest = Join-Path $hostDir 'com.sunobeast.audio.json'
$hostData = @{
    name = 'com.sunobeast.audio'
    description = 'Suno Beast local audio processing'
    path = $launcher
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($hostManifest, $hostData, [Text.UTF8Encoding]::new($false))
foreach ($vendor in $vendors) {
    $registryPath = "$RegistryRoot\$vendor\NativeMessagingHosts\com.sunobeast.audio"
    if (Test-Path -LiteralPath $registryPath) {
        $existing = (Get-Item -LiteralPath $registryPath).GetValue('')
        if ($existing -and $existing -ne $hostManifest) { throw "A different host is already registered: $existing" }
    }
}
foreach ($vendor in $vendors) {
    $registryPath = "$RegistryRoot\$vendor\NativeMessagingHosts\com.sunobeast.audio"
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $hostManifest
}
Write-Host "Local audio helper registered for Chrome, Edge, Opera, Opera GX and Yandex Browser."
Write-Host "Extension folder: $(Join-Path $projectDir 'extension')"
Write-Host "Extension ID: $extensionId"
Write-Host 'Load this folder using Load unpacked on chrome://extensions, edge://extensions, opera://extensions or browser://extensions.'
