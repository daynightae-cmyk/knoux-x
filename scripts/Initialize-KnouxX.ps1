#requires -Version 5.1
<#
.SYNOPSIS
Prepares KNOUX X from D:\Knoux-x.zip and stages it in GitHub before customization.
#>

[CmdletBinding()]
param(
  [string]$ZipPath = 'D:\Knoux-x.zip',
  [string]$RepositoryUrl = 'https://github.com/daynightae-cmyk/knoux-x.git',
  [string]$WorkspaceRoot = 'D:\Knoux-X-Bootstrap',
  [string]$DefaultBranch = 'main',
  [switch]$InstallDependencies,
  [switch]$SkipPush,
  [switch]$PlanOnly,
  [switch]$KeepStaging
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }

function Write-Text([string]$Path, [AllowEmptyString()][string]$Content) {
  $Parent = Split-Path -Parent $Path
  if ($Parent -and -not (Test-Path $Parent)) { New-Item -ItemType Directory $Parent -Force | Out-Null }
  [IO.File]::WriteAllText($Path, $Content, $Utf8)
}

function Write-Missing([string]$Path, [AllowEmptyString()][string]$Content) {
  if (-not (Test-Path $Path)) { Write-Text $Path $Content }
}

function Need([string]$Name, [switch]$Optional) {
  $Cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $Cmd) {
    if ($Optional) { Warn "$Name is not installed."; return $null }
    throw "Required command not found: $Name"
  }
  $Cmd.Source
}

function Run([string]$File, [string[]]$Args, [string]$At, [int[]]$Allowed = @(0), [switch]$Capture) {
  $Old = Get-Location
  try {
    if ($At) { Set-Location $At }
    if ($Capture) {
      $Out = & $File @Args 2>&1; $Code = $LASTEXITCODE
      if ($Allowed -notcontains $Code) { throw "Command failed ($Code): $File $($Args -join ' ')`n$($Out -join "`n")" }
      return ($Out -join "`n")
    }
    & $File @Args; $Code = $LASTEXITCODE
    if ($Allowed -notcontains $Code) { throw "Command failed ($Code): $File $($Args -join ' ')" }
  } finally { Set-Location $Old }
}

function Set-Prop([object]$Object, [string]$Name, $Value) {
  $Prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $Prop) { $Object | Add-Member NoteProperty $Name $Value } else { $Prop.Value = $Value }
}

function Remove-Prop([object]$Object, [string]$Name) {
  if ($null -ne $Object.PSObject.Properties[$Name]) { $Object.PSObject.Properties.Remove($Name) }
}

function Find-Project([string]$Root) {
  $Items = foreach ($Pkg in Get-ChildItem $Root -Filter package.json -File -Recurse) {
    $Dir = Split-Path -Parent $Pkg.FullName; $Score = 0
    if (Test-Path (Join-Path $Dir 'electron\main.ts')) { $Score += 50 }
    if (Test-Path (Join-Path $Dir 'electron\preload.ts')) { $Score += 30 }
    if (Test-Path (Join-Path $Dir 'src\App.tsx')) { $Score += 40 }
    if (Test-Path (Join-Path $Dir 'src\features\player\PlayerView.tsx')) { $Score += 35 }
    if (Test-Path (Join-Path $Dir 'vite.main.config.ts')) { $Score += 20 }
    if ((Split-Path -Leaf $Dir) -eq 'KNOUX') { $Score += 40 }
    [pscustomobject]@{ Root = $Dir; Score = $Score }
  }
  $Best = $Items | Sort-Object Score -Descending | Select-Object -First 1
  if ($null -eq $Best -or $Best.Score -lt 120) { throw 'Canonical KNOUX Electron project was not found.' }
  $Best
}

function Copy-Project([string]$Source, [string]$Target) {
  $Robo = Need robocopy
  $Args = @($Source,$Target,'/E','/COPY:DAT','/DCOPY:DAT','/R:2','/W:2','/XJ','/NFL','/NDL','/NP',
    '/XD','.git','node_modules','dist','out','.vite','.webpack','coverage','release','build',
    '/XF','*.log','*.tmp','*.bak','.DS_Store','Thumbs.db')
  Run $Robo $Args $null @(0,1,2,3,4,5,6,7)
}

function New-Scaffold([string]$Repo) {
  Step 'Creating pre-customization scaffold'
  $Dirs = @('assets\icons','assets\animations','docs','src\config','src\types','src\hooks','src\utils',
    'src\features\subtitles','src\features\playlists','src\features\diagnostics','src\features\plugins',
    'src\features\updater','src\core\services\media','src\core\services\storage',
    'tests\unit','tests\integration','tests\e2e','.github\workflows')
  foreach ($Dir in $Dirs) { New-Item -ItemType Directory (Join-Path $Repo $Dir) -Force | Out-Null }
  foreach ($Dir in ($Dirs | Where-Object { $_ -match '^(src|tests)' })) { Write-Missing (Join-Path $Repo "$Dir\.gitkeep") '' }

  Write-Missing (Join-Path $Repo '.nvmrc') "20`n"
  Write-Missing (Join-Path $Repo '.env.example') "VITE_APP_ENV=development`nVITE_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`n# Store private keys with Electron safeStorage.`n"
  Write-Missing (Join-Path $Repo 'src\types\vite-env.d.ts') "/// <reference types=`"vite/client`" />`ndeclare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;`ndeclare const MAIN_WINDOW_VITE_NAME: string;`n"
  Write-Missing (Join-Path $Repo 'src\config\app.config.ts') "export const appConfig = { id: 'dev.knoux.player-x', productName: 'KNOUX Player X', supportedLocales: ['en','ar'] } as const;`n"
  Write-Missing (Join-Path $Repo 'src\config\env.ts') "export const publicEnvironment = { mode: import.meta.env.MODE, isDevelopment: import.meta.env.DEV } as const;`n"
  Write-Missing (Join-Path $Repo 'assets\icons\README.md') "# Icons`nAdd valid app-icon.ico, app-icon.png, app-icon.icns and favicon.png. Never create zero-byte binary icons.`n"
  Write-Missing (Join-Path $Repo 'assets\animations\README.md') "# Installer artwork`nAdd installer.gif after final branding approval.`n"
  Write-Missing (Join-Path $Repo 'docs\CUSTOMIZATION-CHECKLIST.md') "# Customization gates`n- [ ] npm ci`n- [ ] npm run typecheck`n- [ ] npm run lint`n- [ ] real tests`n- [ ] npm run package`n- [ ] npm run make`n- [ ] one media engine`n- [ ] secure IPC and safeStorage`n- [ ] final icons and signed installer`n"

  $Ignore = Join-Path $Repo '.gitignore'
  $Current = if (Test-Path $Ignore) { @(Get-Content $Ignore) } else { @() }
  $Required = @('node_modules/','.vite/','.webpack/','dist/','out/','release/','coverage/','*.log','.env','.env.*','!.env.example','*.pfx','*.pem','*.key')
  $Add = @($Required | Where-Object { $Current -notcontains $_ })
  if ($Add.Count) { Write-Text $Ignore ((($Current + '' + '# Bootstrap exclusions' + $Add) -join "`n").Trim() + "`n") }
  Ok 'Scaffold created.'
}

function Repair-Package([string]$Repo) {
  $Path = Join-Path $Repo 'package.json'
  $Pkg = Get-Content $Path -Raw | ConvertFrom-Json
  Set-Prop $Pkg 'name' 'knoux-player-x'; Set-Prop $Pkg 'main' '.vite/build/main.js'; Set-Prop $Pkg 'private' $true
  Set-Prop $Pkg.scripts 'start' 'electron-forge start'; Set-Prop $Pkg.scripts 'package' 'electron-forge package'
  Set-Prop $Pkg.scripts 'make' 'electron-forge make'; Set-Prop $Pkg.scripts 'build' 'electron-forge package'
  Set-Prop $Pkg.scripts 'check' 'npm run typecheck && npm run lint'; Remove-Prop $Pkg.scripts 'build:renderer'; Remove-Prop $Pkg.scripts 'build:main'
  foreach ($P in ([ordered]@{'@google/generative-ai'='^0.24.1';events='^3.3.0';'lucide-react'='^0.563.0'}).GetEnumerator()) { Set-Prop $Pkg.dependencies $P.Key $P.Value }
  foreach ($P in ([ordered]@{'@electron-forge/plugin-vite'='^7.2.0';'@electron-forge/plugin-fuses'='^7.2.0';'@electron/fuses'='^1.8.0';'@vitejs/plugin-react'='^4.3.4';vite='^5.4.21'}).GetEnumerator()) { Set-Prop $Pkg.devDependencies $P.Key $P.Value }
  Set-Prop $Pkg 'repository' ([pscustomobject]@{type='git';url=$RepositoryUrl})
  Write-Text $Path (($Pkg | ConvertTo-Json -Depth 100) + "`n")
}

function Repair-Build([string]$Repo) {
  Step 'Repairing Electron Forge + Vite baseline'
  Repair-Package $Repo
  Write-Text (Join-Path $Repo 'forge.config.js') @'
const fs=require('node:fs');const path=require('node:path');
const {FusesPlugin}=require('@electron-forge/plugin-fuses');
const {FuseV1Options,FuseVersion}=require('@electron/fuses');
const icon=path.resolve(__dirname,'assets/icons/app-icon');
const squirrel={name:'KNOUX_Player_X',authors:'SADEK ELGAZAR (KNOUX)',description:'KNOUX Player X'};
if(fs.existsSync(`${icon}.ico`))squirrel.setupIcon=`${icon}.ico`;
module.exports={
 packagerConfig:{asar:true,name:'KNOUX Player X',executableName:'knoux-player-x',appBundleId:'dev.knoux.player-x',...(fs.existsSync(`${icon}.ico`)?{icon}:{})},
 makers:[{name:'@electron-forge/maker-squirrel',platforms:['win32'],config:squirrel},{name:'@electron-forge/maker-zip',platforms:['darwin','linux'],config:{}}],
 plugins:[{name:'@electron-forge/plugin-vite',config:{build:[{entry:'electron/main.ts',config:'vite.main.config.ts'},{entry:'electron/preload.ts',config:'vite.preload.config.ts'}],renderer:[{name:'main_window',config:'vite.renderer.config.ts'}]}},{name:'@electron-forge/plugin-auto-unpack-natives',config:{}},new FusesPlugin({version:FuseVersion.V1,[FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableCookieEncryption]:true,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,[FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:true,[FuseV1Options.OnlyLoadAppFromAsar]:true})]
};
'@
  Write-Text (Join-Path $Repo 'vite.main.config.ts') "import { defineConfig } from 'vite';`nexport default defineConfig({build:{sourcemap:true,rollupOptions:{external:['electron','electron-squirrel-startup','electron-log','better-sqlite3','sharp','onnxruntime-node','@tensorflow/tfjs-node']}}});`n"
  Write-Text (Join-Path $Repo 'vite.preload.config.ts') "import { defineConfig } from 'vite';`nexport default defineConfig({build:{sourcemap:true,rollupOptions:{external:['electron']}}});`n"
  Write-Text (Join-Path $Repo 'vite.renderer.config.ts') @'
import path from 'node:path';import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';
export default defineConfig({base:'./',plugins:[react()],build:{sourcemap:true,rollupOptions:{input:{index:path.resolve(__dirname,'index.html'),splash:path.resolve(__dirname,'splash.html')}}},resolve:{alias:{'@':path.resolve(__dirname,'src'),'@core':path.resolve(__dirname,'src/core'),'@components':path.resolve(__dirname,'src/components'),'@features':path.resolve(__dirname,'src/features'),'@store':path.resolve(__dirname,'src/store'),'@styles':path.resolve(__dirname,'src/styles'),'@assets':path.resolve(__dirname,'assets')}}});
'@
  $MainPath = Join-Path $Repo 'electron\main.ts'
  if (Test-Path $MainPath) {
    $Main = Get-Content $MainPath -Raw
    $Main = $Main.Replace("path.join(__dirname, '../renderer/splash.html')",'path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/splash.html`)')
    $Main = $Main.Replace("path.join(__dirname, '../renderer/index.html')",'path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)')
    Write-Text $MainPath $Main
  }
  Ok 'Build baseline repaired.'
}

function Write-Report([string]$Repo,[object]$Selected,[string]$Hash,[string]$Branch) {
  $Data=[ordered]@{generatedAt=(Get-Date).ToString('o');phase='pre-customization';zip=$ZipPath;sha256=$Hash;selectedRoot=$Selected.Root;score=$Selected.Score;repository=$RepositoryUrl;branch=$Branch}
  Write-Text (Join-Path $Repo 'docs\bootstrap-manifest.json') (($Data|ConvertTo-Json -Depth 10)+"`n")
  Write-Text (Join-Path $Repo 'docs\BOOTSTRAP-REPORT.md') "# Bootstrap report`n`nCanonical root: ``$($Selected.Root)```nScore: **$($Selected.Score)**`nSHA-256: ``$Hash```nBranch: ``$Branch```n`nNext: npm ci, typecheck, lint, tests, package, then customization.`n"
}

$TranscriptStarted=$false;$Staging=$null
try {
  Write-Host '=== KNOUX X PRE-CUSTOMIZATION BOOTSTRAP ===' -ForegroundColor Cyan
  if ($env:OS -ne 'Windows_NT') { throw 'Windows is required.' }
  if (-not (Test-Path $ZipPath -PathType Leaf)) { throw "ZIP not found: $ZipPath" }
  $Git=Need git;$Node=Need node -Optional;$Npm=Need npm -Optional
  if ($InstallDependencies -and ($null -eq $Node -or $null -eq $Npm)) { throw 'Node.js and npm are required.' }

  New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
  $Logs=Join-Path $WorkspaceRoot 'logs';$Backups=Join-Path $WorkspaceRoot 'backups'
  New-Item -ItemType Directory -Path @($Logs,$Backups) -Force | Out-Null
  $Log=Join-Path $Logs "bootstrap-$Stamp.log";Start-Transcript -Path $Log -Force | Out-Null;$TranscriptStarted=$true

  Step 'Hashing and extracting source';$Hash=(Get-FileHash $ZipPath -Algorithm SHA256).Hash;Ok $Hash
  $Staging=Join-Path $WorkspaceRoot "staging-$Stamp";$Repo=Join-Path $WorkspaceRoot 'repository'
  if(Test-Path $Repo){Move-Item $Repo (Join-Path $Backups "repository-$Stamp") -Force}
  New-Item -ItemType Directory -Path $Staging -Force | Out-Null;Expand-Archive $ZipPath $Staging -Force
  $Selected=Find-Project $Staging;Ok "Selected $($Selected.Root)"
  $Heads=Run $Git @('ls-remote','--heads',$RepositoryUrl) $null @(0) -Capture;$HasRemote = -not [string]::IsNullOrWhiteSpace($Heads)
  if($PlanOnly){Write-Host "Plan only. Remote initialized: $HasRemote";return}

  Step 'Cloning repository';Run $Git @('clone',$RepositoryUrl,$Repo) $null
  if($HasRemote){Run $Git @('checkout',$DefaultBranch) $Repo;Run $Git @('pull','--ff-only','origin',$DefaultBranch) $Repo;$Branch="bootstrap/pre-customization-$Stamp";Run $Git @('checkout','-b',$Branch) $Repo}
  else{Run $Git @('symbolic-ref','HEAD',"refs/heads/$DefaultBranch") $Repo;$Branch=$DefaultBranch}

  Copy-Project $Selected.Root $Repo;New-Scaffold $Repo;Repair-Build $Repo
  if($InstallDependencies){Step 'Installing dependencies';try{Run $Npm @('install') $Repo;Ok 'npm install completed'}catch{Warn $_.Exception.Message}}
  Write-Report $Repo $Selected $Hash $Branch

  Step 'Committing';$Name=Run $Git @('config','--get','user.name') $Repo @(0,1) -Capture;$Mail=Run $Git @('config','--get','user.email') $Repo @(0,1) -Capture
  if([string]::IsNullOrWhiteSpace($Name)){Run $Git @('config','user.name','KNOUX Bootstrap') $Repo}
  if([string]::IsNullOrWhiteSpace($Mail)){Run $Git @('config','user.email','bootstrap@knoux.local') $Repo}
  Run $Git @('add','-A') $Repo;$Status=Run $Git @('status','--porcelain') $Repo @(0) -Capture
  if (-not [string]::IsNullOrWhiteSpace($Status)){Run $Git @('commit','-m','chore: bootstrap KNOUX X before customization') $Repo;if (-not $SkipPush){Run $Git @('push','-u','origin',$Branch) $Repo;Ok "Pushed $Branch"}}
  else{Warn 'No changes to commit.'}
  Write-Host "Completed. Workspace: $Repo`nReport: $(Join-Path $Repo 'docs\BOOTSTRAP-REPORT.md')" -ForegroundColor Green
}catch{Write-Host "[FATAL] $($_.Exception.Message)" -ForegroundColor Red;exit 1}
finally{if($TranscriptStarted){try{Stop-Transcript | Out-Null}catch{}};if ($Staging -and (Test-Path $Staging) -and -not $KeepStaging){try{Remove-Item $Staging -Recurse -Force}catch{}}}
