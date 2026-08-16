---

name: dasha-auto-export

description: "Debug and fix silent failures in dasha auto_export_session.py — state staleness, manual catch-up, cron job reliability."

version: 1.0.0

author: dasha Agent

license: MIT

platforms: [windows, linux, macos]

---



# dasha Auto-Export Debugging



The `auto_export_session.py` script silently exports completed dasha sessions to markdown files. When it fails silently (exit 0, no output, state file not advancing), follow this guide.



## Symptoms



- Script runs, exits 0, no output

- `auto_export_state.json` shows `last_msg_id: N`

- `state.db` has messages with IDs > N

- Day file (e.g. `2026-06-28_Full_Day.md`) hasn't grown



## Diagnosis



1. Check state: `cat ~/AppData/Local/dasha/auto_export_state.json`

2. Check DB: query `SELECT MAX(id), COUNT(*) FROM messages WHERE id > <last_msg_id>` in `state.db`

3. Compare — if DB has newer messages, the script is skipping them



## Known Causes



- **State staleness**: Multiple cron invocations race to update `last_msg_id`; the file lags behind actual exports

- **Date-check logic**: `msg_date != today and msg_date != last_date` skips sessions whose date doesn't match either

- **Silent exit = possible silent skip**: Exit code 0 with no output means success OR nothing to export. Always check `auto_export_state.json` to confirm state advanced.



- **Missing export directory**: The script does NOT create the target output directory (`D:\\dasha\\WORKSPACE\\EXAMPLE_MEMORY_TASK\\sessions` by default). If the directory doesn't exist, file writes fail silently—no error is raised, state advances, but no markdown files are produced. Verify with Python's `os.path.isdir()` if shell `ls` on `/mnt/d/...` shows nothing. This was confirmed as a silent-failure root cause on 2026-07-29 when first run after the directory was missing.



## Fix: Manual Catch-Up



See `references/auto-export-debugging.md` for the full diagnostic commands and the Python catch-up script template.



## Prevention



- Run the catch-up script periodically as a cron job

- Monitor `auto_export_state.json` vs `state.db` max ID

- Consider adding a verification step that prints export count before silent exit

- **Do NOT run the script multiple times in the same cron session** — each run creates new messages that extend the gap. Run once, then sync to MAX(id) if needed. See `references/2026-08-02-cron-session-verification.md` for the full pattern and verification protocol.



## MSYS2 Path Visibility Quirk



When using git-bash (MSYS2), files written via Python's Windows paths (e.g., `D:\dasha\...`) may not appear in `ls /mnt/d/...` due to mount cache or path translation mismatches. **Verification workaround:** Use Python's `os.listdir()` or `os.path.exists()` directly on the Windows path to confirm files exist:



```bash

/c/Program\ Files/Python310/python.exe -c "import os; print(os.listdir('D:/dasha/WORKSPACE/EXAMPLE_MEMORY_TASK/sessions'))"

```



If the Python check confirms existence but shell `ls` doesn't show files, it's a mount visibility issue—not a write failure.



## Known Pitfalls



- **Missing export directory**: The script does NOT create the target output directory. If the directory (`D:\\dasha\\WORKSPACE\\EXAMPLE_MEMORY_TASK\\sessions` by default) does not exist, file writes will fail silently—no error is raised, state advances, but no markdown files are produced. **Preventive measure:** Ensure the directory exists before running: `mkdir -p D:/dasha/WORKSPACE/EXAMPLE_MEMORY_TASK/sessions` (use full Python path on Windows). This was confirmed as a silent-failure root cause on 2026-07-29 when first run after the directory was missing.



- **Incremental catch-up creates a perpetual gap**: Running the catch-up script multiple times leaves 2–8 unexported messages each time, because each query against `state.db` generates new messages that get interleaved. **Fix**: Sync `last_msg_id` directly to `SELECT MAX(id) FROM messages` in one shot — do NOT loop or retry. One direct update is sufficient.

- **DB column is `timestamp`, NOT `created_at`**: The `messages` table uses `timestamp` as a Unix epoch float. `SELECT DATE(created_at)` fails with `no such column`. Use `DATE(timestamp)` in SQL or `datetime.fromtimestamp(ts)` in Python.

- **Row factory mismatch**: When using `conn.row_factory = sqlite3.Row`, access columns as `msg['column_name']` or `dict(msg)`. Without `row_factory`, rows are tuples indexed by position. Don't mix.

- **Terminal-invoked script can skip state save**: When running the script via `terminal` inside a cron session, new messages get interleaved and the state file may not update. Verify `last_msg_id` after run; if stale, use the inline Python catch-up instead.

- **Self-referential infinite loop in cron sessions**: When `auto_export_session.py` runs as a cron job inside its own dasha session, each diagnostic/tool call gets written to `state.db` as new messages. This creates a perpetual gap where `last_msg_id` advances but `MAX(id)` in the DB keeps growing. **Fix**: After a single script run, sync `last_msg_id` directly to `SELECT MAX(id) FROM messages` in one shot — do NOT loop or retry. One direct update is sufficient. See `references/auto-export-debugging.md` § 2026-08-02 Cron Session Infinite Loop Lesson for the full pattern.

- **Expected post-run lag (NORMAL)**: 1–3 pending messages after a run is expected when run outside its own cron session. Do NOT assume failure.

- **State unchanged = script silently skipped everything**: If `last_msg_id` hasn't moved at all after a run (not just lagged by a few IDs), the script hit an early return or exception. Common trigger: `last_date` already equals today, so the date-check condition `msg_date != today and msg_date != last_date` is always False, and the else-branch append logic may silently fail due to Windows path resolution. **Fix**: Always verify state after run; if `last_msg_id` is unchanged, use the inline Python catch-up script.

- **Script has dead code + date-skipping bug**: The original `auto_export_session.py` has two issues:

  1. Inner `if msg_date == today:` inside the outer `if msg_date != today and msg_date != last_date:` block is **unreachable** — you already know `msg_date != today`. This branch never executes.

  2. Sessions whose message date is older than both `today` AND `last_date` are **silently skipped forever**. They never get exported. This is by design (to avoid re-exporting old sessions) but means any missed cron runs for multi-day gaps will lose those sessions permanently.

  3. The `exported_count` increments in both branches, giving misleading counts.

  **Workaround**: Use the manual catch-up script below which handles all sessions regardless of date.

- **Windows Python path with spaces**: On Windows, `python3.10` may not be in PATH. The full path `/c/Program Files/Python310/python.exe` must be quoted. Use `MSYS2_NO_PATHCONV=1 "/c/Program Files/Python310/python.exe" script.py` in bash terminal calls.

