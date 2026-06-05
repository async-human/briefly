# Package extension for Chrome Web Store upload
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$zip = Join-Path $root "briefly-extension-store.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

$files = @(
  "manifest.json",
  "background.js",
  "config.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons"
)

Push-Location $root
try {
  Compress-Archive -Path $files -DestinationPath $zip -Force
  Write-Host "Created $zip"
} finally {
  Pop-Location
}
