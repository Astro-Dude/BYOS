"""Agent permission modes.

Its own module, importing nothing, because both the agent loop and the request
schemas need it: `schemas` → `rag` → `tools` → `agent` is a real import chain, so
defining `Mode` in `agent` and importing it from `schemas` closes a cycle.
"""

from __future__ import annotations

from enum import StrEnum


class Mode(StrEnum):
    """How much the model is allowed to do on its own in one turn.

    The gradient is deliberate: everything is confirmed by default, and each step
    up hands over a specific, nameable amount of trust. `AUTO` is the useful
    middle — bulk tidying stops being a chore, while the changes you can't walk
    back still need a click.
    """

    #: Read tools only. Writes aren't offered, so nothing can be proposed.
    READ_ONLY = "read_only"
    #: Every change is queued for confirmation. The default.
    ASK = "ask"
    #: Reversible changes (move/rename/tag/star/folders) run immediately;
    #: destructive or public ones (delete/share/alias) are still queued.
    AUTO = "auto"
    #: Every change runs immediately, including deletes and public links.
    FULL = "full"


def runs_now(mode: Mode, danger: bool) -> bool:
    """Whether a write executes during the turn instead of being queued."""
    if mode is Mode.FULL:
        return True
    if mode is Mode.AUTO:
        return not danger
    return False
