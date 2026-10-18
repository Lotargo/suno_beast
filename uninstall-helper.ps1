$ErrorActionPreference = 'Stop'
$ownedManifest = Join-Path $PSScriptRoot 'native\com.sunobeast.audio.json'
foreach ($vendor in @('Google\Chrome', 'Microsoft\Edge')) {
    $registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.sunobeast.audio"
    if ((Test-Path -LiteralPath $registryPath) -and (Get-Item -LiteralPath $registryPath).GetValue('') -eq $ownedManifest) {
        Remove-Item -LiteralPath $registryPath -Force
    }
}
Write-Host 'Owned native host registrations removed. Recordings and browser profiles were preserved.'
