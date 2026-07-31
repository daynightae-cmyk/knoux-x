[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [string]$EvidencePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'installer/windows/KnouxVisualInstaller.cs'
$iconPath = Join-Path $root 'assets/icons/app-icon.ico'
$slidesRoot = Join-Path $root 'assets/installer/slides'

function Resolve-ExistingFile {
  param([string]$PathValue, [string]$Label)
  $resolved = [System.IO.Path]::GetFullPath($PathValue)
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "$Label is missing: $resolved"
  }
  if ((Get-Item -LiteralPath $resolved).Length -le 0) {
    throw "$Label is empty: $resolved"
  }
  return $resolved
}

function Find-CSharpCompiler {
  $candidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  $command = Get-Command csc.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'A .NET Framework C# compiler (csc.exe) was not found.'
}

$setup = Resolve-ExistingFile -PathValue $SetupPath -Label 'Squirrel setup payload'
$source = Resolve-ExistingFile -PathValue $sourcePath -Label 'Visual installer source'
$icon = Resolve-ExistingFile -PathValue $iconPath -Label 'KNOUX installer icon'
$output = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $output
if (-not $outputDirectory) { throw 'Visual installer output directory is invalid.' }
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if (-not $EvidencePath) {
  $EvidencePath = Join-Path $outputDirectory 'visual-installer-self-test.json'
}
$evidence = [System.IO.Path]::GetFullPath($EvidencePath)
New-Item -ItemType Directory -Path (Split-Path -Parent $evidence) -Force | Out-Null

$slideResources = @()
for ($index = 1; $index -le 9; $index++) {
  $number = $index.ToString('00')
  $slide = Resolve-ExistingFile -PathValue (Join-Path $slidesRoot "$number.png") -Label "Official installer slide $number"
  $slideResources += [pscustomobject]@{
    Path = $slide
    Name = "Knoux.Slide.$number.png"
  }
}

$compiler = Find-CSharpCompiler
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("knoux-visual-installer-build-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
$tempSource = Join-Path $tempDirectory 'KnouxVisualInstaller.cs'

try {
  $sourceText = [System.IO.File]::ReadAllText($source, [System.Text.UTF8Encoding]::new($false))
  $sourceText = $sourceText.Replace(
    'private readonly Timer carouselTimer = new Timer();',
    'private readonly System.Windows.Forms.Timer carouselTimer = new System.Windows.Forms.Timer();'
  )
  [System.IO.File]::WriteAllText($tempSource, $sourceText, [System.Text.UTF8Encoding]::new($false))

  $references = @(
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/System.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/System.Core.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/System.Drawing.dll'),
    (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/System.Windows.Forms.dll')
  )
  if (-not (Test-Path -LiteralPath $references[0])) {
    $references = $references | ForEach-Object { $_.Replace('Framework64', 'Framework') }
  }
  foreach ($reference in $references) {
    Resolve-ExistingFile -PathValue $reference -Label 'Framework reference' | Out-Null
  }

  $compilerArguments = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    '/checked+',
    '/warn:4',
    '/codepage:65001',
    "/out:$output",
    "/win32icon:$icon",
    "/resource:$setup,Knoux.Payload.Setup.exe"
  )
  foreach ($reference in $references) {
    $compilerArguments += "/reference:$reference"
  }
  foreach ($slideResource in $slideResources) {
    $compilerArguments += "/resource:$($slideResource.Path),$($slideResource.Name)"
  }
  $compilerArguments += $tempSource

  Write-Host "[>] Compiling KNOUX visual installer with $compiler"
  & $compiler @compilerArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Visual installer compilation failed with exit code $LASTEXITCODE."
  }

  $compiled = Resolve-ExistingFile -PathValue $output -Label 'Compiled visual installer'
  if ((Get-Item -LiteralPath $compiled).Length -le (Get-Item -LiteralPath $setup).Length) {
    throw 'Compiled visual installer is not larger than its embedded Squirrel payload.'
  }

  Remove-Item -LiteralPath $evidence -Force -ErrorAction SilentlyContinue
  Write-Host '[>] Running embedded payload and nine-slide self-test'
  $selfTest = Start-Process -FilePath $compiled -ArgumentList @('--self-test', "--evidence=$evidence") -Wait -PassThru
  if ($selfTest.ExitCode -ne 0) {
    throw "Visual installer self-test failed with exit code $($selfTest.ExitCode)."
  }
  Resolve-ExistingFile -PathValue $evidence -Label 'Visual installer self-test evidence' | Out-Null
  $evidenceDocument = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
  if ($evidenceDocument.success -ne $true) { throw 'Visual installer self-test evidence did not report success.' }
  if ($evidenceDocument.mode -ne 'self-test') { throw 'Visual installer self-test evidence mode is invalid.' }
  if (@($evidenceDocument.details | Where-Object { $_ -eq 'slides=9' }).Count -ne 1) {
    throw 'Visual installer did not verify all nine official slides.'
  }

  Write-Host "[PASS] KNOUX visual installer compiled: $compiled"
  Write-Host "[PASS] Self-test evidence: $evidence"
} finally {
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
