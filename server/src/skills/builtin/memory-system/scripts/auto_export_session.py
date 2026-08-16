#!/usr/bin/env python3

# -*- coding: utf-8 -*-

"""

Auto-export sessions from state.db to EXAMPLE_MEMORY_TASK/sessions/

Reads new messages since last export and appends to YYYY-MM-DD_Full_Day.md.



Usage: python auto_export_session.py

Runs silently on success. State tracked in auto_export_state.json.



Called by cron job 010b01513d07 (every 2h, no_agent=true) via auto_export.sh.



Key design decisions:

- Reads from state.db (the real session DB with 983 sessions), NOT sessions.db (stale, only May data)

- Appends to day files rather than per-session files to keep files manageable

- Silent exit on success (no output = cron delivers nothing = no spam)

- last_msg_id tracking prevents re-processing old messages

"""



import os

import sys

import json

import sqlite3

from datetime import datetime, timezone



# Paths

dasha_HOME = os.environ.get('dasha_HOME', r'C:\Users\your-user\AppData\Local\dasha')

STATE_DB = os.path.join(dasha_HOME, 'state.db')

AUTO_EXPORT_STATE = os.path.join(dasha_HOME, 'auto_export_state.json')

EXAMPLE_MEMORY_TASK_SESSIONS = r'D:\dasha\WORKSPACE\EXAMPLE_MEMORY_TASK\sessions'





def load_state():

    if os.path.exists(AUTO_EXPORT_STATE):

        try:

            with open(AUTO_EXPORT_STATE) as f:

                return json.load(f)

        except:

            pass

    return {'last_msg_id': 0, 'last_date': None}





def save_state(state):

    with open(AUTO_EXPORT_STATE, 'w', encoding='utf-8') as f:

        json.dump(state, f, ensure_ascii=False, indent=2)





def export_session(session_id, messages, output_path):

    lines = []

    lines.append(f"# Session: {session_id}")

    lines.append(f"")

    lines.append(f"> Exported: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")

    lines.append(f"> Source: {messages[0].get('source', 'unknown') if messages else 'unknown'}")

    lines.append(f"> Messages: {len(messages)}")

    lines.append(f"")

    lines.append(f"---")

    lines.append(f"")



    for m in messages:

        role_label = 'User' if m['role'] == 'user' else 'Assistant' if m['role'] == 'assistant' else 'Tool'

        content = m.get('content', '')

        if len(content) > 3000:

            content = content[:3000] + '\n... (truncated)'

        lines.append(f"### {role_label}")

        lines.append(f"")

        lines.append(f"{content}")

        lines.append(f"")



    with open(output_path, 'w', encoding='utf-8') as f:

        f.write('\n'.join(lines))



    return len(messages)





def main():

    if not os.path.exists(STATE_DB):

        return



    state = load_state()

    last_msg_id = state.get('last_msg_id', 0)



    conn = sqlite3.connect(STATE_DB)

    conn.row_factory = sqlite3.Row

    cursor = conn.cursor()



    cursor.execute(

        "SELECT id, session_id, role, content, timestamp FROM messages "

        "WHERE id > ? ORDER BY timestamp ASC",

        (last_msg_id,)

    )

    new_messages = cursor.fetchall()



    if not new_messages:

        conn.close()

        return



    sessions = {}

    for msg in new_messages:

        sid = msg['session_id']

        if sid not in sessions:

            sessions[sid] = []

        sessions[sid].append(dict(msg))



    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')



    for session_id, msgs in sessions.items():

        first_ts = msgs[0]['timestamp']

        if isinstance(first_ts, (int, float)):

            msg_date = datetime.fromtimestamp(first_ts, tz=timezone.utc).strftime('%Y-%m-%d')

        else:

            msg_date = str(first_ts)[:10]



        day_file = os.path.join(EXAMPLE_MEMORY_TASK_SESSIONS, f"{today}_Full_Day.md")

        if os.path.exists(day_file):

            with open(day_file, 'a', encoding='utf-8') as df:

                df.write(f"\n\n---\n\n")

                df.write(f"## Session: {session_id}\n\n")

                for m in msgs:

                    role_label = 'User' if m['role'] == 'user' else 'Assistant' if m['role'] == 'assistant' else 'Tool'

                    content = m.get('content', '')[:2000]

                    df.write(f"### {role_label}\n\n{content}\n\n")

        else:

            with open(day_file, 'w', encoding='utf-8') as df:

                df.write(f"# Full Day Summary: {today}\n\n")

                for m in msgs:

                    role_label = 'User' if m['role'] == 'user' else 'Assistant' if m['role'] == 'assistant' else 'Tool'

                    content = m.get('content', '')[:2000]

                    df.write(f"## Session: {session_id}\n\n### {role_label}\n\n{content}\n\n")



    max_msg_id = max(m['id'] for m in new_messages)

    state['last_msg_id'] = max_msg_id

    state['last_date'] = today

    save_state(state)



    conn.close()





if __name__ == '__main__':

    main()

