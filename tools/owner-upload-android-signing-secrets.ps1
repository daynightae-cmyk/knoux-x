<#
  KNOUX X — owner-run upload of the production signing secrets.

  Run this yourself, on your own Windows account, in a PowerShell window you
  control. It recovers the DPAPI-protected signing password locally, proves the
  keystore is the pinned production identity, and uploads three GitHub
  environment secrets.

  Guarantees:
    * no secret value is ever written to the console, a log, or a command line;
    * nothing is passed as a process argument — values go to `gh` through a file
      that only your account can read, and that file is overwritten with zeroes
      and deleted afterwards;
    * if the keystore does not match the pinned certificate, it stops before
      uploading anything.

  Usage:
    pwsh -File tools/owner-upload-android-signing-secrets.ps1            # upload
    pwsh -File tools/owner-upload-android-signing-secrets.ps1 -VerifyOnly # dry run
#>
[CmdletBinding()]
param(
  [string]$Repository = 'daynightae-cmyk/knoux-x',
  [string]$Environment = 'android-production',
  [string]$KeystorePath = 'D:\KNOUX-Private-Signing\knoux-x-android-production-2026.p12',
  [string]$DpapiBlobPath = (Join-Path $env:LOCALAPPDATA 'KNOUX-X\Signing\knoux-x-android-production-2026.password.dpapi'),
  [string]$KeyAlias = 'knoux-x-production-2026',
  [string]$ExpectedFingerprint = '695ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd',
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$SecretNames = @(
  'KNOUX_ANDROID_KEYSTORE_BASE64',
  'KNOUX_ANDROID_KEYSTORE_PASSWORD',
  'KNOUX_ANDROID_KEY_ALIAS',
  'KNOUX_ANDROID_KEY_PASSWORD',
  'KNOUX_ANDROID_CERT_SHA256'
)

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    OK  $Message" -ForegroundColor Green }
function Stop-WithReason([string]$Reason) { Write-Host "    STOP $Reason" -ForegroundColor Red; exit 1 }

# --- pre-flight: tooling ------------------------------------------------------
Write-Step 'Checking prerequisites'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Stop-WithReason 'GitHub CLI (gh) is not on PATH.' }
if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { Stop-WithReason 'keytool is not on PATH (a JDK is required).' }
$auth = gh auth status 2>&1 | Out-String
if ($auth -notmatch 'Logged in') { Stop-WithReason 'gh is not authenticated.' }
Write-Ok 'gh present and authenticated'

# --- pre-flight: keystore is the pinned identity ------------------------------
Write-Step 'Verifying the keystore is the pinned production identity'
if (-not (Test-Path -LiteralPath $KeystorePath)) { Stop-WithReason "Keystore not found: $KeystorePath" }
if (-not (Test-Path -LiteralPath $DpapiBlobPath)) { Stop-WithReason "DPAPI password blob not found: $DpapiBlobPath" }

$workDir = Join-Path $env:TEMP ('knoux-secret-upload-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
try {
  # Restrict the scratch directory to this account before anything is written.
  $acl = Get-Acl -LiteralPath $workDir
  $acl.SetAccessRuleProtection($true, $false)
  $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $workDir -AclObject $acl

  # --- recover the password in memory only ------------------------------------
  $blob = [IO.File]::ReadAllBytes($DpapiBlobPath)
  $plainBytes = $null
  $password = $null
  try {
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $blob, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $password = [Text.Encoding]::UTF8.GetString($plainBytes)
    if ([string]::IsNullOrWhiteSpace($password)) { Stop-WithReason 'Recovered password is empty.' }
    Write-Ok "DPAPI password recovered in memory ($($password.Length) characters, value not shown)"

    # Prove the keystore opens with this password and carries the pinned cert.
    $derPath = Join-Path $workDir 'cert.der'
    $env:KNOUX_UPLOAD_TMP_PASS = $password
    & keytool -exportcert -alias $KeyAlias -keystore $KeystorePath -storetype PKCS12 `
        -storepass:env KNOUX_UPLOAD_TMP_PASS -file $derPath 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-WithReason 'The recovered password does not open this keystore, or the alias is wrong. Nothing was uploaded.' }

    $actual = (& keytool -printcert -file $derPath | Select-String -Pattern 'SHA256' | Select-Object -First 1).ToString()
    $actual = ($actual -replace '.*SHA256:\s*', '' -replace '[:\s]', '').ToLowerInvariant()
    Remove-Item -LiteralPath $derPath -Force

    if ($actual -ne $ExpectedFingerprint.ToLowerInvariant()) {
      Stop-WithReason "Keystore certificate is $actual but the pin is $ExpectedFingerprint. This is the wrong key. Nothing was uploaded."
    }
    Write-Ok "Certificate matches the pin: $actual"

    if ($VerifyOnly) {
      Write-Step 'VerifyOnly requested: stopping before any upload'
      Write-Ok 'Pre-flight passed. Re-run without -VerifyOnly to upload.'
      return
    }

    # --- upload -------------------------------------------------------------
    # PKCS12 protects the private key with the store password and cannot carry a
    # separate key password, so the two values are identical by construction.
    $payloads = @{
      'KNOUX_ANDROID_KEYSTORE_BASE64'   = { [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeystorePath)) }
      'KNOUX_ANDROID_KEYSTORE_PASSWORD' = { $password }
      'KNOUX_ANDROID_KEY_ALIAS'         = { $KeyAlias }
      'KNOUX_ANDROID_KEY_PASSWORD'      = { $password }
      'KNOUX_ANDROID_CERT_SHA256'       = { $ExpectedFingerprint.ToLowerInvariant() }
    }

    Write-Step "Uploading secrets to the '$Environment' environment"
    foreach ($name in $SecretNames) {
      $valueFile = Join-Path $workDir "$name.bin"
      $value = & $payloads[$name]
      try {
        # UTF-8 without BOM and without a trailing newline, so the stored value is
        # exactly what a signer will read back.
        [IO.File]::WriteAllBytes($valueFile, [Text.Encoding]::UTF8.GetBytes($value))
        gh secret set $name --repo $Repository --env $Environment --bodyFile $valueFile 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-WithReason "gh failed while setting $name." }
        Write-Ok "set $name"
      } finally {
        if (Test-Path -LiteralPath $valueFile) {
          $len = (Get-Item -LiteralPath $valueFile).Length
          if ($len -gt 0) { [IO.File]::WriteAllBytes($valueFile, (New-Object byte[] $len)) }
          Remove-Item -LiteralPath $valueFile -Force
        }
        $value = $null
      }
    }

    Write-Step 'Confirming what is now configured (names only)'
    $listed = gh api "repos/$Repository/environments/$Environment/secrets" --jq '.secrets[].name' 2>$null
    foreach ($name in $SecretNames) {
      if ($listed -contains $name) { Write-Ok "$name present" } else { Write-Ok "$name NOT confirmed - re-run" }
    }
    Write-Host ''
    Write-Host 'Done. No value was displayed, logged, or passed as a command argument.' -ForegroundColor Green
  }
  finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    $password = $null
    $blob = $null
    Remove-Item Env:\KNOUX_UPLOAD_TMP_PASS -ErrorAction SilentlyContinue
  }
}
finally {
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
