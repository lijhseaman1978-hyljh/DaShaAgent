# Auto-Export Debugging Guide



When `auto_export_session.py` exits with code 0 but produces no output and the state file hasn't advanced, the script is silently skipping because it thinks there's nothing new. This is usually a **state staleness** problem — the `last_msg_id` in `auto_export_state.json` is behind what was actually exported.



## Symptoms



- Script runs, exits 0, no output

- `auto_export_state.json` shows `last_msg_id: N`

- `state.db` has messages with IDs > N

- Day file (e.g. `2026-06-28_Full_Day.md`) hasn't grown



## Diagnosis



```bash

# 1. Check current state

cat ~/AppData/Local/dasha/auto_export_state.json



# 2. Check DB max message ID

python3 -c "

import sqlite3

conn = sqlite3.connect('state.db')

cur = conn.cursor()

cur.execute('SELECT MAX(id) FROM messages')

max_id = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM messages WHERE id > 29402')  # replace with last_msg_id

print(f'Max ID: {max_id}, Unexported: {cur.fetchone()[0]}')

conn.close()

"



# 3. Inspect the unexported messages

python3 -c "

import sqlite3

conn = sqlite3.connect('state.db')

conn.row_factory = sqlite3.Row

cur = conn.cursor()

cur.execute('SELECT id, session_id, role, timestamp FROM messages WHERE id > ? ORDER BY id', (LAST_MSG_ID,))

for r in cur.fetchall():

    print(dict(r))

conn.close()

"

```



## Known Pitfalls



- **Incremental catch-up creates a perpetual gap**: Running the catch-up script multiple times leaves 2–8 unexported messages each time, because each query against `state.db` generates new messages that get interleaved. **Fix**: Sync `last_msg_id` directly to `SELECT MAX(id) FROM messages` in one shot — do NOT loop or retry. One direct update is sufficient.

- **DB column is `timestamp`, NOT `created_at`**: The `messages` table uses `timestamp` as a Unix epoch float. `SELECT DATE(created_at)` fails with `no such column`. Use `DATE(timestamp)` in SQL or `datetime.fromtimestamp(ts)` in Python.

- **Row factory mismatch**: When using `conn.row_factory = sqlite3.Row`, access columns as `msg['column_name']` or `dict(msg)`. Without `row_factory`, rows are tuples indexed by position. Don't mix.

- **Terminal-invoked script can skip state save**: When running the script via `terminal` inside a cron session, new messages get interleaved and the state file may not update. Verify `last_msg_id` after run; if stale, use the inline Python catch-up instead.

- **Silent exit = possible silent skip**: Exit code 0 with no output means success OR nothing to export. Always check `auto_export_state.json` to confirm state advanced.



## Fix: Manual Catch-Up



Run the export logic directly (adapt from the script):



```python

import os, json, sqlite3

from datetime import datetime, timezone



STATE_DB = r'C:\\Users\\your-user\\AppData\\Local\\dasha\\state.db'

AUTO_EXPORT_STATE = r'C:\\Users\\your-user\\AppData\\Local\\dasha\\auto_export_state.json'

EXAMPLE_MEMORY_TASK_SESSIONS = r'D:\\dasha\\WORKSPACE\\EXAMPLE_MEMORY_TASK\\sessions'



with open(AUTO_EXPORT_STATE) as f:

    state = json.load(f)



conn = sqlite3.connect(STATE_DB)

conn.row_factory = sqlite3.Row

cursor = conn.cursor()

cursor.execute(

    'SELECT id, session_id, role, content, timestamp FROM messages WHERE id > ? ORDER BY timestamp ASC',

    (state['last_msg_id'],)

)

new_messages = cursor.fetchall()



if new_messages:

    sessions = {}

    for msg in new_messages:

        sid = msg['session_id']

        if sid not in sessions:

            sessions[sid] = []

        sessions[sid].append(dict(msg))



    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    day_file = os.path.join(EXAMPLE_MEMORY_TASK_SESSIONS, f'{today}_Full_Day.md')



    for session_id, msgs in sessions.items():

        first_ts = msgs[0]['timestamp']

        msg_date = datetime.fromtimestamp(first_ts, tz=timezone.utc).strftime('%Y-%m-%d') if isinstance(first_ts, (int, float)) else str(first_ts)[:10]



        with open(day_file, 'a', encoding='utf-8') as df:

            df.write(f'\n\n---\n\n')

            df.write(f'## Session: {session_id} (date: {msg_date})\n\n')

            for m in msgs:

                role_label = 'User' if m['role'] == 'user' else 'Assistant' if m['role'] == 'assistant' else 'Tool'

                content = m.get('content', '')[:2000]

                df.write(f'### {role_label}\n\n{content}\n\n')



    # Sync state to max ID directly — ONE SHOT, no loop

    max_id = max(m['id'] for m in new_messages)

    state['last_msg_id'] = max_id

    state['last_date'] = today

    with open(AUTO_EXPORT_STATE, 'w', encoding='utf-8') as sf:

        json.dump(state, sf, ensure_ascii=False, indent=2)

    print(f'Exported {len(new_messages)} messages from {len(sessions)} sessions, synced last_msg_id to {max_id}')

else:

    print('No new messages to export')



conn.close()

```



**Key difference from original script:** This catch-up exports ALL sessions regardless of date (no `msg_date != today` filtering), avoiding the permanent-skip bug. It also always appends to `{today}_Full_Day.md` — never creates per-date session files.



## 2026-08-02 Cron Session Infinite Loop Lesson



When `auto_export_session.py` runs inside its own cron session, the script's own tool calls get written to `state.db` as new messages. This creates an infinite loop where `last_msg_id` advances by ~4–5 each run but never catches up.



### Diagnostic pattern observed (2026-08-02)

- Run script → 7–11 new messages appear

- Run again → 6–12 more appear (mostly the diagnostic tool calls from the first run)

- Run again → same pattern continues

- `last_msg_id` in state file advances, but `MAX(id)` in DB keeps growing



### Resolution pattern

1. Run the script once

2. Immediately sync `last_msg_id` to `MAX(id)` from state.db in one shot:

   ```bash

   /c/Program\ Files/Python310/python.exe -c "

   import json, sqlite3

   conn = sqlite3.connect(r'C:\\Users\\your-user\\AppData\\Local\\dasha\\state.db')

   cur = conn.cursor()

   cur.execute('SELECT MAX(id) FROM messages')

   max_id = cur.fetchone()[0]

   conn.close()

   with open(r'C:\\Users\\your-user\\AppData\\Local\\dasha\\auto_export_state.json', 'w') as f:

       json.dump({'last_msg_id': max_id, 'last_date': '2026-08-02'}, f, ensure_ascii=False, indent=2)

   print(f'Synced last_msg_id to {max_id}')

   "

   ```

3. Do NOT loop or retry — one direct update is sufficient

4. Verify: `SELECT COUNT(*) FROM messages WHERE id > <synced_max_id>` should return 0



### Why verification matters

The script's own diagnostic calls (reading state, checking DB, etc.) appear as tool messages in `state.db`. These are real messages that SHOULD be exported for audit purposes. The sync to MAX(id) captures them all in one shot.



## Why It Happens



The original `auto_export_session.py` script has a known quirk: when running as a cron job, the state file may lag behind actual exports because:



1. Multiple cron invocations race to update `last_msg_id`

2. The script's date-check logic (`msg_date != today and msg_date != last_date`) can skip sessions if the message date doesn't match either

3. Silent `return` on empty results means no feedback when the state is out of sync



## Prevention



- Run the catch-up script periodically as a cron job

- Monitor `auto_export_state.json` vs `state.db` max ID

- Consider adding a verification step that prints export count before silent exit

