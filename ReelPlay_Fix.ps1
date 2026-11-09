
# ReelPlay - Safe Project Repair & Build
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Report = Join-Path $Root "ReelPlay_Audit.txt"

Set-Location $Root

Write-Host "`n=== REELPLAY PROJECT REPAIR ===" -ForegroundColor Cyan
Write-Host "Project: $Root"

$Log = [System.Collections.Generic.List[string]]::new()

function Add-Log($Message) {
    $Log.Add("$Message")
    Write-Host $Message
}

try {
    # 1. Verify project files
    Add-Log "`n[1/5] Checking project files..."

    $Required = @(
        "package.json",
        "index.html",
        "vite.config.js",
        "src",
        "src-tauri"
    )

    foreach ($Item in $Required) {
        if (!(Test-Path (Join-Path $Root $Item))) {
            throw "Missing required project item: $Item"
        }
        Add-Log "FOUND: $Item"
    }

    # 2. Inspect package configuration
    Add-Log "`n[2/5] Checking package.json..."

    $Package = Get-Content ".\package.json" -Raw | ConvertFrom-Json

    Add-Log "Project: $($Package.name)"
    Add-Log "Version: $($Package.version)"

    if (!$Package.scripts.dev) {
        throw "Missing npm dev script."
    }

    if (!$Package.scripts.build) {
        throw "Missing npm build script."
    }

    Add-Log "Dev command: $($Package.scripts.dev)"
    Add-Log "Build command: $($Package.scripts.build)"

    # 3. Check Tauri configuration
    Add-Log "`n[3/5] Checking Tauri configuration..."

    $TauriConfig = Get-ChildItem ".\src-tauri" -File -Recurse |
        Where-Object {
            $_.Name -in @("tauri.conf.json", "tauri.conf.json5", "Tauri.toml")
        }

    foreach ($File in $TauriConfig) {
        Add-Log "FOUND TAURI CONFIG: $($File.FullName)"
        if ($File.Extension -eq ".json" -or $File.Extension -eq ".json5") {
            Get-Content $File.FullName -Raw | ConvertFrom-Json | Out-Null
            Add-Log "TAURI JSON VALID"
        }
    }

    if (!$TauriConfig) {
        Add-Log "WARNING: Tauri configuration not found."
    }

    # 4. Check installed dependencies
    Add-Log "`n[4/5] Checking dependencies..."

    if (!(Test-Path ".\node_modules")) {
        throw "node_modules is missing. No files were deleted."
    }

    if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is not installed or unavailable in PATH."
    }

    Add-Log "Node: $(node --version)"
    Add-Log "NPM: $(npm --version)"

    # 5. Build frontend
    Add-Log "`n[5/5] Building ReelPlay frontend..."

    npm run build 2>&1 | ForEach-Object {
        $Message = "$_"
        $Log.Add($Message)
        Write-Host $Message
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed. See report."
    }

    Add-Log "`nSUCCESS: Frontend build completed."

}
catch {
    Add-Log "`nERROR: $($_.Exception.Message)"
}

$Log | Set-Content -Path $Report -Encoding UTF8

Write-Host "`n==================================" -ForegroundColor Cyan
Write-Host "REPORT: $Report" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
