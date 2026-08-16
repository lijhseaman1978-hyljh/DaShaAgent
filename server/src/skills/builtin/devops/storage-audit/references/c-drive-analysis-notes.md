# C: Drive Analysis Reference — 2026-05-18

## System
- Windows user: `your-user` (NOT `your-user` — that's the WSL username)
- Machine: MACAEX Azure Dragon 16Pro, RTX 5060 Laptop 8GB, i7-13620H, 32GB RAM
- OS: Windows 10 (build 26200.8246, Insider Preview)
- WSL: Ubuntu-24.04 with separate dasha Agent
- Chassis: 1TB NVMe SSD total, partitioned C: + D:

## Survey Results (this session)

### Root directory structure
- Windows: 47 GB
- Users\your-user: ~120-140 GB (largest)
- Program Files: 19.8 GB
- Program Files (x86): 12.8 GB
- ProgramData: 14.7 GB
- <WAMP_ROOT>: 2.1 GB
- Temp: 1.3 GB
- Python314: 158 MB
- $WinREAgent: 1.5 GB
- $WINDOWS.~BT: ~20 KB
- $Windows.~WS: ~112 KB
- pinokio: 102 KB
- ESD, inetpub, OneDriveTemp: empty

### System files
- pagefile.sys: 21.4 GB (32GB RAM, can shrink to 16GB)
- hiberfil.sys: 13.5 GB (can disable)
- swapfile.sys: 16 MB

### AppData\Local breakdown (66.5 GB total)
1. Docker: 20.5 GB — images/containers/volumes
2. wsl: 13.0 GB — WSL ext4.vhdx disk (HOLD — contains other dasha)
3. Programs: 7.9 GB — various tools
4. Google: 5.6 GB — Chrome data/cache
5. dasha: 2.2 GB — dasha runtime
6. Ollama: 2.0 GB — Ollama config
7. uv: 1.8 GB — Python package manager cache
8. Microsoft: 1.8 GB — Edge/Office
9. WorkBuddyExtension: 1.3 GB
10. GitHubDesktop: 1.1 GB
11. camelfox: 1.0 GB
12. npm-cache: 0.9 GB
13. ms-playwright: 0.7 GB
14. CapCut: 0.6 GB
15. Doubao: 0.6 GB
16. clawx-updater: 0.6 GB
17. easyclawcn-updater: 0.4 GB
18. EFetch: 0.3 GB
19. aipc-updater: 0.3 GB

### AppData\Roaming breakdown (18.3 GB total)
1. Python: 10.3 GB — venvs/packages
2. Tencent: 3.1 GB — QQ/WeChat data
3. WorkBuddy: 2.2 GB
4. npm: 1.1 GB
5. NVIDIA: 0.7 GB
6. ollama app.exe: 0.4 GB

### User profile other large dirs
- stable-diffusion-webui: 9.4 GB
- .cache: 7.6 GB
- Documents: 6.5 GB
- WorkBuddy: 4.7 GB
- .dasha: 3.7 GB
- openclaw: 1.7 GB
- .workbuddy: 1.1 GB
- .chromium-browser-snapshots: 0.7 GB
- .copaw: 0.7 GB
- Desktop: 0.4 GB
- android-sdk: 0.3 GB

### Program Files breakdown (19.8 GB)
- Python310: 5.3 GB
- Docker: 4.1 GB
- Winmail: 2.6 GB
- dotnet: 1.6 GB
- ClawX: 1.2 GB
- Google: 0.9 GB
- NVIDIA Corporation: 0.9 GB
- WSL: 0.8 GB
- Tencent: 0.8 GB
- Git: 0.4 GB
- 玩家战魂电竞控制台: 0.4 GB
- PowerShell: 0.3 GB
- Tesseract-OCR: 0.1 GB
- nodejs: 0.1 GB

### Program Files (x86) breakdown (12.8 GB)
- Microsoft: 4.6 GB
- Microsoft Visual Studio: 3.3 GB
- Windows Kits: 1.7 GB
- dotnet: 1.4 GB
- Google: 0.5 GB
- Freemake: 0.3 GB
- NVIDIA Corporation: 0.2 GB
- Java: 0.1 GB
- HP: 0.1 GB

### ProgramData breakdown (14.7 GB)
- NVIDIA Corporation: 9.3 GB (driver cache)
- Microsoft: 1.9 GB
- Package Cache: 1.7 GB
- Intel Package Cache: 0.5 GB
- chocolatey: 0.4 GB
- NVIDIA (non-Corp): 0.4 GB
- SogouInput: 0.1 GB

## Potential Reclaimable Space: ~55-65 GB
Key targets: pagefile shrink (5GB), disable hiberfil (13.5GB), Docker prune (10-15GB), NVIDIA old drivers (5-7GB), Package Cache (1.7GB), .cache (5-6GB), duplicate SD webui (5-9GB), Winmail (2.6GB)
