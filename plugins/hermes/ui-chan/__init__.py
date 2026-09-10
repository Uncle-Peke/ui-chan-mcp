"""EventCue for Hermes Agent — the same idea as hooks/reaction.js (Claude Code)
and plugins/opencode/ui-chan.mjs (OpenCode), in Hermes' plugin dialect.

Like both of those, this file decides exactly one thing: **which event
happened**. What ういちゃん says about it — the lines, weights, cooldowns and
affinity gates — lives in sequences/event/<name>/ and ``eventCues`` in ui-chan.config.json, and is resolved
by the app, so three different hosts can never drift into saying different
things, and editing her reactions stays a JSON edit with no plugin code.

Hermes plugins are Python while the mascot bridge is JavaScript, so instead of
re-implementing a WebSocket client here (and taking a dependency for it), each
event spawns the repo's own one-liner: ``bin/ui-chan-node hooks/fire-event.js
<event>``. It is detached and never waited on — a mascot must not be able to
slow down, or break, the agent it lives beside.
"""

import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Where ui-chan is installed. `ui-chan install hermes` writes this file with the
# path baked in; UI_CHAN_ROOT overrides it for a moved install.
UI_CHAN_ROOT = Path(os.environ.get("UI_CHAN_ROOT", "@@UI_CHAN_ROOT@@"))

# Tools where a failure is news, not a normal outcome (a search that found
# nothing is not news). Mirrors LOUD_TOOLS in hooks/reaction.js.
LOUD_TOOLS = {"bash", "shell", "run_command", "edit", "write", "write_file", "patch"}

# Tools that hand work to another agent — worth a send-off and a welcome back.
AGENT_TOOLS = {"task", "agent", "delegate", "spawn_agent", "subagent"}


def _fire(event: str) -> None:
    """Tell the mascot an event happened. Never raises, never blocks."""
    launcher = UI_CHAN_ROOT / "bin" / "ui-chan-node"
    script = UI_CHAN_ROOT / "hooks" / "fire-event.js"
    if not launcher.exists() or not script.exists():
        return
    try:
        subprocess.Popen(  # noqa: S603 — fixed argv, no shell
            [str(launcher), str(script), event, "hermes-plugin"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception:  # pragma: no cover - a dead mascot must never break Hermes
        logger.debug("ui-chan: could not report %s", event, exc_info=True)


def _is_failure(result) -> bool:
    """Did this tool call fail? The result shape is not contractual, so check
    the plausible ones and default to "no" — a missed beat is much better than
    ういちゃん announcing failures that never happened."""
    if result is None:
        return False
    if isinstance(result, dict):
        if result.get("is_error") or result.get("isError") or result.get("error"):
            return True
        for key in ("exit_code", "exitCode", "returncode"):
            code = result.get(key)
            if isinstance(code, int) and code != 0:
                return True
        return False
    if isinstance(result, str):
        return result.strip().lower().startswith(("error:", "traceback (most recent call last)"))
    return False


def _on_pre_tool_call(tool_name=None, args=None, task_id=None, **kwargs):
    if str(tool_name).lower() in AGENT_TOOLS:
        _fire("agent_out")


def _on_post_tool_call(tool_name=None, args=None, result=None, task_id=None, **kwargs):
    name = str(tool_name).lower()
    if name in AGENT_TOOLS:
        _fire("agent_back")
    elif name in LOUD_TOOLS and _is_failure(result):
        _fire("tool_failure")


def _on_session_end(*args, **kwargs):
    # Hermes has no per-turn hook in the plugin surface, so the end of a session
    # is the closest honest "the work is done" signal. `turn_done` deliberately
    # says nothing about whether it went well — nothing here knows that.
    _fire("turn_done")


def register(ctx):
    """Wire the hooks. No tools: ういちゃん's tools come from the MCP server
    registered in config.yaml, not from this plugin."""
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("on_session_end", _on_session_end)
