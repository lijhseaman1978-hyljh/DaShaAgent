#!/bin/bash

# Auto-export sessions from state.db to EXAMPLE_MEMORY_TASK

# Runs silently: no output on success, only on error

# Called by cron job 010b01513d07 (every 2h, no_agent=true)



cd /c/Users/your-user/AppData/Local/dasha

MSYS2_NO_PATHCONV=1 /c/Program\ Files/Python310/python.exe scripts/auto_export_session.py

exit 0

