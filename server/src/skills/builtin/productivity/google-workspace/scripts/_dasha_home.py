"""Resolve dasha_HOME for standalone skill scripts.

Skill scripts may run outside the dasha process (e.g. system Python,
nix env, CI) where ``dasha_constants`` is not importable.  This module
provides the same ``get_dasha_home()`` and ``display_dasha_home()``
contracts as ``dasha_constants`` without requiring it on ``sys.path``.

When ``dasha_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``dasha_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``dasha_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dasha_constants import display_dasha_home as display_dasha_home
    from dasha_constants import get_dasha_home as get_dasha_home
except (ModuleNotFoundError, ImportError):

    def get_dasha_home() -> Path:
        """Return the dasha home directory (default: ~/.dasha).

        Mirrors ``dasha_constants.get_dasha_home()``."""
        val = os.environ.get("dasha_HOME", "").strip()
        return Path(val) if val else Path.home() / ".dasha"

    def display_dasha_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``dasha_constants.display_dasha_home()``."""
        home = get_dasha_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
