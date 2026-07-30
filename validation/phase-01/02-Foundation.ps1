function Invoke-KnxPhase01Foundation {
    param([Parameter(Mandatory = $true)]$Context)

    Write-KnxMessage 'Applying KNOUX identity and customization foundation' 'STEP'
    $repo = $Context.RepositoryPath
    $brand = $Context.Config.brand

    $packagePath = Join-Path $repo 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    Set-KnxObjectProperty -Object $package -Name 'description' -Value 'KNOUX Player X Ultimate — premium next-generation desktop media experience with AI-assisted playback.'
    Set-KnxObjectProperty -Object $package -Name 'author' -Value $brand.developer
    Set-KnxObjectProperty -Object $package -Name 'homepage' -Value $brand.website
    Set-KnxObjectProperty -Object $package -Name 'repository' -Value ([pscustomobject]@{ type = 'git'; url = $brand.repository })
    Set-KnxObjectProperty -Object $package -Name 'bugs' -Value ([pscustomobject]@{ url = 'https://github.com/daynightae-cmyk/knoux-x/issues' })
    if ($null -eq $package.scripts) { Set-KnxObjectProperty -Object $package -Name 'scripts' -Value ([pscustomobject]@{}) }
    Set-KnxObjectProperty -Object $package.scripts -Name 'doctor' -Value 'node tools/doctor.cjs'
    Set-KnxObjectProperty -Object $package.scripts -Name 'phase1:verify' -Value 'npm run doctor && npm run typecheck && npm run lint && npm run package'
    Write-KnxUtf8File -Path $packagePath -Content (($package | ConvertTo-Json -Depth 100) + [Environment]::NewLine)

    $brandTs = @"
export const KNOUX_BRAND = Object.freeze({
  productName: '$($brand.productName)',
  shortName: '$($brand.shortName)',
  developer: '$($brand.developer)',
  website: '$($brand.website)',
  repository: '$($brand.repository)',
  themeName: '$($brand.themeName)',
  supportEmail: 'support@knoux.store',
} as const);

export type KnouxBrand = typeof KNOUX_BRAND;
"@
    Write-KnxUtf8File -Path (Join-Path $repo 'src\config\brand.ts') -Content $brandTs

    $tokens = @'
:root {
  --knoux-bg-0: #07040f;
  --knoux-bg-1: #0d0718;
  --knoux-bg-2: #151026;
  --knoux-surface: rgba(24, 16, 45, 0.76);
  --knoux-surface-strong: rgba(32, 20, 60, 0.94);
  --knoux-border: rgba(167, 103, 255, 0.28);
  --knoux-border-strong: rgba(190, 133, 255, 0.55);
  --knoux-primary: #9d4edd;
  --knoux-primary-bright: #c77dff;
  --knoux-accent: #7b2cff;
  --knoux-cyan: #55e6ff;
  --knoux-text: #f7f2ff;
  --knoux-text-muted: #b9aecb;
  --knoux-success: #48e5a5;
  --knoux-warning: #ffc857;
  --knoux-danger: #ff5f87;
  --knoux-shadow-soft: 0 18px 48px rgba(0, 0, 0, 0.28);
  --knoux-glow-primary: 0 0 26px rgba(157, 78, 221, 0.32);
  --knoux-radius-sm: 10px;
  --knoux-radius-md: 16px;
  --knoux-radius-lg: 24px;
  --knoux-space-1: 4px;
  --knoux-space-2: 8px;
  --knoux-space-3: 12px;
  --knoux-space-4: 16px;
  --knoux-space-5: 24px;
  --knoux-space-6: 32px;
  --knoux-duration-fast: 120ms;
  --knoux-duration-normal: 220ms;
  --knoux-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --knoux-duration-fast: 1ms;
    --knoux-duration-normal: 1ms;
  }
}
'@
    Write-KnxUtf8File -Path (Join-Path $repo 'src\styles\knoux-tokens.css') -Content $tokens

    $globalPath = Join-Path $repo 'src\styles\global.css'
    $global = Get-Content -LiteralPath $globalPath -Raw
    $importLine = "@import './knoux-tokens.css';"
    if ($global -notmatch [regex]::Escape($importLine)) {
        Write-KnxUtf8File -Path $globalPath -Content ($importLine + [Environment]::NewLine + $global)
    }

    $doctor = @'
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'forge.config.js',
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.renderer.config.ts',
  'electron/main.ts',
  'electron/preload.ts',
  'src/main.tsx',
  'src/App.tsx',
  'src/config/brand.ts',
  'src/styles/knoux-tokens.css',
];

const missing = required.filter((item) => !fs.existsSync(path.join(root, item)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nodeMajor = Number(process.versions.node.split('.')[0]);
const result = {
  product: pkg.description,
  node: process.versions.node,
  electron: pkg.devDependencies?.electron || pkg.dependencies?.electron || null,
  requiredFiles: required.length,
  missing,
  gitBranch: (() => {
    try { return cp.execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { return null; }
  })(),
};

console.log(JSON.stringify(result, null, 2));
if (nodeMajor !== 20) console.warn('[WARN] Node 20 is recommended by .nvmrc.');
if (missing.length) process.exit(1);
console.log('[PASS] KNOUX Phase 01 doctor checks passed.');
'@
    Write-KnxUtf8File -Path (Join-Path $repo 'tools\doctor.cjs') -Content $doctor

    $attributes = @'
* text=auto
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.cjs text eol=lf
*.json text eol=lf
*.css text eol=lf
*.md text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
*.png binary
*.jpg binary
*.jpeg binary
*.ico binary
'@
    Write-KnxUtf8File -Path (Join-Path $repo '.gitattributes') -Content $attributes

    $foundationDoc = @"
# PHASE 01 — KNOUX Foundation & First Build

This phase begins the real product customization while protecting the existing codebase.

## Applied foundation

- Central brand contract in `src/config/brand.ts`.
- KNOUX Neon Core tokens in `src/styles/knoux-tokens.css`.
- Global token import without replacing the existing interface.
- Product metadata normalized in `package.json`.
- Repository doctor command: `npm run doctor`.
- Complete verification command: `npm run phase1:verify`.
- Deterministic line-ending rules in `.gitattributes`.

## Brand baseline

- Product: $($brand.productName)
- Short name: $($brand.shortName)
- Developer: $($brand.developer)
- Website: $($brand.website)
- Theme: $($brand.themeName)

## Safety

All work is performed on a dedicated `customization/phase-01-foundation-*` branch. Do not merge until every build gate is PASS.
"@
    Write-KnxUtf8File -Path (Join-Path $repo 'docs\customization\PHASE-01-FOUNDATION.md') -Content $foundationDoc

    Write-KnxMessage 'KNOUX identity foundation applied.' 'OK'
}
