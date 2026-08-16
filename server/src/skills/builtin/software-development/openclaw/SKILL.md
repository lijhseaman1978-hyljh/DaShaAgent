---
name: openclaw
description: "Install, upgrade, configure, and troubleshoot OpenClaw — a CLI AI agent and chat platform. Covers npm vs offline-package install, bundled Node.js crypto issues, and source-only vs pre-built distribution model."
version: 1.0.0
author: system
platforms: [windows]
metadata:
  dasha:
    tags: [OpenClaw, AI-Agent, CLI, Windows, NodeJS]
prerequisites:
  windows_paths: [node.exe]
---

# OpenClaw

OpenClaw is a multi-channel AI gateway with agent CLI capabilities. On Windows, it's distributed as an **offline package** (self-contained with bundled Node.js + node_modules) and on npm as a **source-only package** (requires `pnpm install && pnpm build`).

## When To Load

- User asks to install, upgrade, or troubleshoot OpenClaw
- User reports `openclaw doctor`, `openclaw --help`, or other commands failing after upgrade
- Bundled `node.exe` crashes with `ncrypto::CSPRNG(nullptr, 0)`

## Version History / Package Sizes

| Version | Offline ZIP Size | Contents |
|---------|-----------------|----------|
| v2026.4.14 | ~532 MB | Large full package with bundled Node.js + all deps |
| v2026.5.20 | ~190 MB | Slimmed down — smaller bundled node_modules |

The size drop means some dependency packages moved to sub-modules. Always use the matching offline package for the target version — mixing versions causes missing-dist errors.

## Installation Methods

### Method A: Offline Package (Recommended for Windows)

The official distribution method. Self-contained ~532MB zip with bundled Node.js runtime and all dependencies.

```
Repository: github.com/StanleyChanH/openclaw-offline-package
Releases:   github.com/StanleyChanH/openclaw-offline-package/releases
```

1. Download the latest `.zip` release (~532 MB)
2. Extract to a directory like `C:\Users\<user>\openclaw\`
3. Run `01_首次配置.bat` to set up PATH and configuration
4. Run `02_启动服务.bat` to start the Gateway

### Method B: npm Install (Source-Only — Needs Build)

```cmd
cd C:\Users\<user>\openclaw
npm install openclaw@<version>
```

⚠️ **IMPORTANT**: The npm package is **SOURCE CODE ONLY**. It includes the `openclaw.mjs` entry point and shared chunk files, but **does NOT include** `dist/entry.js` or `dist/index.js`. Running it will produce:

```
Error: openclaw: missing dist/entry.(m)js (build output).
```

To make the npm package functional, you must supplement it with built output from the offline package.

## Upgrade Procedure

Upgrade requires **TWO components**: the npm registry package (for `openclaw.mjs` entry + shared chunks) and the offline package (for `dist/` + `entry.js` + `index.js` + full node_modules).

### Quick Method (Recommended): Use Full Offline Package

If the new version has a GitHub release with an offline package zip:

```powershell
# Step 1: Download the offline package zip
$url = "https://github.com/StanleyChanH/openclaw-offline-package/releases/download/v2026.5.20/openclaw-offline-package-v2026.5.20.zip"
$out = "D:\openclaw-offline-v2026.5.20.zip"
Invoke-WebRequest -Uri $url -TimeoutSec 900 -OutFile $out
```

Extract using PowerShell (not 7zip — we need the full tree):

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("D:\openclaw-offline-v2026.5.20.zip")
$dest = "D:\openclaw_v2026.5.20_staging\openclaw-offline-package"
[System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip, $dest)
$zip.Dispose()
```

Test run from staging first (uses bundled Node.js):

```bash
"/d/openclaw_v2026.5.20_staging/openclaw-offline-package/nodejs/node.exe" \
  "/d/openclaw_v2026.5.20_staging/openclaw-offline-package/node_modules/openclaw/openclaw.mjs" \
  --version
# Expected: OpenClaw 2026.5.20 (e510042)
```

Then copy into the target installation:

```bash
# Copy dist/ from offline package
rsync -a --delete \
  /d/openclaw_v2026.5.20_staging/openclaw-offline-package/node_modules/openclaw/dist/ \
  /c/Users/<user>/openclaw/node_modules/openclaw/dist/

# Copy root node_modules packages
# Check what's missing first:
diff <(ls /d/openclaw_v2026.5.20_staging/openclaw-offline-package/node_modules/ | sort) \
     <(ls /c/Users/<user>/openclaw/node_modules/ | sort) | grep "^<"

# Copy the missing ones (279+ packages in v2026.5.20):
cd /d/openclaw_v2026.5.20_staging/openclaw-offline-package/
tar cf - node_modules/ | tar xf - -C /c/Users/<user>/openclaw/
```

### Combined Method: npm + Offline Package Supplement

Use when the offline package is too large to download fully but the npm package is small enough.

#### Step 1: Check Current Version
- `node_modules/openclaw/package.json` — the npm package version
- `node_modules/openclaw/dist/build-info.json` — the built dist version

```python
import json
src = r"C:\Users\<user>\openclaw\node_modules\openclaw\package.json"
with open(src) as f:
    print(json.load(f)["version"])
```

#### Step 2: Download the npm Package (to get new `openclaw.mjs` + shared chunks)

Use PowerShell (native Windows DNS, NOT WSL/bash — WSL DNS often fails):

```powershell
Invoke-WebRequest -Uri "https://registry.npmjs.org/openclaw/-/openclaw-2026.5.20.tgz" -OutFile "D:\openclaw-2026.5.20.tgz"
```

Then extract with `tar -xzf` (WSL tar works).

### Step 3: Replace the new dist/ with Offline Package dist/

The npm package's dist/ has only 2,500+ shared chunks but is **missing the entry files**. The offline package has 23,784 files including `entry.js` and `index.js`.

**Best approach**: Extract the ENTIRE `dist/` from the old offline package:

```python
import zipfile, os, time

old_zip = r"C:\Users\<user>\openclaw-offline-package-v2026.4.14 (1).zip"
target_dist = r"C:\Users\<user>\openclaw\node_modules\openclaw\dist"
prefix = "openclaw-offline-package/node_modules/openclaw/dist/"

# Delete current dist first (to avoid stale npm versions of files)
shutil.rmtree(target_dist)
os.makedirs(target_dist)

with zipfile.ZipFile(old_zip) as z:
    for name in z.namelist():
        if name.startswith(prefix) and not name.endswith('/'):
            rel_path = name.replace(prefix, "")
            target_path = os.path.join(target_dist, rel_path)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            source = z.read(name)
            with open(target_path, 'wb') as f:
                f.write(source)
```

### Step 4: Install Missing Dependencies

The old dist references packages from the offline package's bundled `node_modules/openclaw/node_modules/` (779+ packages). After step 3, some module errors may remain:

```cmd
cd C:\Users\<user>\openclaw
npm install @sinclair/typebox
```

For deeper module errors, extract the `node_modules/` from the offline package's root level to supplement:

```powershell
# Extract non-openclaw packages from old offline package
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zip.Entries | Where-Object { $_.FullName -match '^openclaw-offline-package/node_modules/(?!openclaw/)' -and -not $_.FullName.EndsWith('/') }
foreach ($entry in $entries) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true) }
```

## Verify Installation

```bash
"C:\Program Files\nodejs\node.exe" "C:\Users\<user>\openclaw\node_modules\openclaw\openclaw.mjs" --version
# Expected: OpenClaw 2026.5.20 (xxxxxxx)
```

## Common Pitfalls

### Pitfall 1: Bundled Node.js crypto crash (`ncrypto::CSPRNG(nullptr, 0)`)

The bundled `nodejs/node.exe` may crash on some Windows configurations. **Fix**: Use system Node.js instead (from `C:\Program Files\nodejs\node.exe`), or replace the bundled `node.exe` with the system one.

### Pitfall 2: npm package is source-only

The npm registry package `openclaw` is the **source code**, not the pre-built binary. It lacks `dist/entry.js`. Always supplement with the offline package's `dist/`.

### Pitfall 3: WSL/bash DNS failures

```bash
# This will FAIL from WSL/git-bash:
curl https://registry.npmjs.org/openclaw/latest
# Error: getaddrinfo() thread failed to start
```

**Fix**: Use Windows-native tools (PowerShell, cmd.exe) for network downloads — they use Windows DNS which works.

### Pitfall 4: `doctor` command fails after upgrade

`openclaw doctor` tries to load ALL plugins and providers, which triggers missing optional dependency errors. This is **normal** for a partial install. The basic CLI commands (`--version`, `--help`, `list --help`) will work even if `doctor` fails.

### Pitfall 5: Offline package download sizes vary by version

| Version | Size | Notes |
|---------|------|-------|
| v2026.4.14 | ~532 MB | Full bundled, all deps |
| v2026.5.20 | ~190 MB | Slimmed down, some deps in sub-modules |

Download can take 10-30 minutes depending on connection speed. Use background download with `-TimeoutSec 900`.

### Pitfall 6: `--help` works but deeper commands fail (missing dependencies)

After replacing only `dist/` without copying root `node_modules`, `openclaw --help` and `--version` will work, but commands like `doctor`, `status`, `configure` may fail with `Error: Cannot find module 'xxx'`.

**Fix**: Copy the full root `node_modules/` from the offline package staging directory:

```bash
cd /d/openclaw_v2026.5.20_staging/openclaw-offline-package/
tar cf - node_modules/ | tar xf - -C /c/Users/<user>/openclaw/
```

This copies all 279+ dependency packages. Without this step, the CLI is a partial install.

## Architecture Notes

- **Entry chain**: `openclaw.mjs` → `tryImport("./dist/entry.js")` → imports hash-named shared chunks
- **Build system**: pnpm monorepo (see `pnpm-workspace.yaml` in the source)
- **Config**: `~/.openclaw/openclaw.json` holds agent config, auth profiles, model selections
- **Package distribution**: The npm package ships source; the offline package ships pre-built
