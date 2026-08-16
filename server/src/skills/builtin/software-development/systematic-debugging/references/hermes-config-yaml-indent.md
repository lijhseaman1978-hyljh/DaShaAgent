# YAML Config Indentation Traps

## Symptom Pattern
Custom providers disappear from the model list after config modifications. The config file is silently ignored and dasha falls back to defaults.

## Root Cause
YAML parsing fails when list items (`- plur`) have LESS indentation than their parent key (`enabled:`). This happens when PLUR setup converts `enabled: true` to `enabled:` + `- plur`, but the `- plur` at 2-space indent doesn't match the parent's 4-space indent.

## Diagnostic
```bash
dasha config show
# → Reports: "Failed to parse config.yaml: while parsing a block mapping"
# → line XXX, column Y: "expected <block end>, but found '-'"
```

## Common Locations (Windows, dasha_HOME)
Check these sections in `$dasha_HOME\config.yaml` after enabling PLUR:
- `bedrock.discovery.enabled`
- `display.runtime_footer.enabled`
- `curator.backup.enabled`
- `discord.voice_fx.enabled` / `.ambient_enabled` / `.ack_enabled`
- `security.website_blocklist.enabled`
- `tools.tool_search.enabled`
- `secrets.bitwarden.enabled`
- `mcp_servers.dasha-studio.enabled`
- `platforms.qqbot/email/whatsapp.enabled`

## Fix
Change `  - plur` → `    - plur` (match the parent `enabled:` indentation).

## Verification
```bash
$dasha_HOME/dasha status   # Model: agnes-2.0-flash, no YAML errors
```

## Installation Path Trap
When installing dasha plugins (`plur_dasha`), they may go to the system Python (Python310) instead of dasha' own venv (Python 3.11). Verify with:
```bash
.../venv/Scripts/python.exe -c "import plur_dasha"
```