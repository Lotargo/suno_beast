param([ValidateSet('folder', 'file')][string]$Kind = 'folder', [string]$Initial = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
if ($Kind -eq 'file') {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Suno Beast - select existing file for the current Suno track'
    $dialog.Filter = 'Audio files (*.mp3;*.wav)|*.mp3;*.wav'
    $dialog.CheckFileExists = $true
    if ($Initial -and (Test-Path -LiteralPath $Initial -PathType Container)) { $dialog.InitialDirectory = $Initial }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
} else {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Suno Beast - choose the recordings folder'
    if ($Initial -and (Test-Path -LiteralPath $Initial -PathType Container)) { $dialog.SelectedPath = $Initial }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }
}
$dialog.Dispose()
