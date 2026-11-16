# Quick Launcher for Windows App Group Sidebar
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

$releaseExe = Join-Path $scriptDir "src-tauri\target\release\windows-app-group-sidebar.exe"
$debugExe = Join-Path $scriptDir "src-tauri\target\debug\windows-app-group-sidebar.exe"

if (Test-Path $releaseExe) {
    Write-Host "Launching Release build..." -ForegroundColor Green
    Start-Process -FilePath $releaseExe
} elseif (Test-Path $debugExe) {
    Write-Host "Launching Debug build..." -ForegroundColor Cyan
    Start-Process -FilePath $debugExe
} else {
    Write-Host "Binary not found. Building now..." -ForegroundColor Yellow
    Set-Location (Join-Path $scriptDir "src-tauri")
    cargo build --release
    Start-Process -FilePath $releaseExe
}
