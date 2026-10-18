$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Get-Command ffmpeg.exe -ErrorAction Stop | Out-Null
$manifestPath = Join-Path $projectDir 'extension\manifest.json'
$extensionId = & $nodePath (Join-Path $projectDir 'scripts\extension-id.js')
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine extension ID' }
$hostDir = Join-Path $projectDir 'native'
$launcher = Join-Path $hostDir 'launch-host.cmd'
# Keep the launcher ASCII: node handles the Unicode source path from this directory.
$launcherBody = "@echo off`r`n`"$nodePath`" `"%~dp0host.js`" %*`r`n"
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
foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
    $registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.sunobeast.audio"
    if (Test-Path -LiteralPath $registryPath) {
        $existing = (Get-Item -LiteralPath $registryPath).GetValue('')
        if ($existing -and $existing -ne $hostManifest) { throw "A different host is already registered: $existing" }
    }
}
foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
    $registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.sunobeast.audio"
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $hostManifest
}
Write-Host "Local audio helper registered for Chrome and Edge."
Write-Host "Extension folder: $(Join-Path $projectDir 'extension')"
Write-Host "Extension ID: $extensionId"
Write-Host 'Load this folder using Load unpacked on chrome://extensions or edge://extensions.'
