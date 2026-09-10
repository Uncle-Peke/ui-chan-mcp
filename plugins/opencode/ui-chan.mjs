// EventCue for OpenCode — the same idea as hooks/reaction.js, in OpenCode's
// plugin dialect.
//
// Like the Claude Code hooks, this file decides exactly one thing: **which
// event happened**. What ういちゃん says about it (the lines, weights,
// cooldowns, affinity gates) stays in
// sequences/event/<name>/ and ui-chan.config.json's `eventCues`, resolved by the app — so the two hosts can never drift
// into saying different things, and editing her reactions is still a JSON edit
// with no plugin code involved.
//
// Registered by `ui-chan install opencode`, which adds a `file://` entry for
// this path to opencode.json's `plugin` array.
//
// Rules, same as the Claude Code side: never block the agent, never throw, and
// stay silent when the mascot isn't running (a hook must not pop a window open
// behind the user's work).

const PORT = Number(process.env.UI_CHAN_PORT ?? 8123);

function fire(event) {
  if (!event) return;
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const close = () => {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(close, 1500);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          type: 'tool',
          agent: 'opencode-plugin',
          tool: 'event_cue',
          args: { event },
        }),
      );
      setTimeout(() => {
        clearTimeout(timer);
        close();
      }, 250);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      close();
    });
  } catch {
    /* no mascot running — nothing to report to */
  }
}

/** OpenCode's subagent tool. Only this one is worth a send-off / welcome-back. */
const AGENT_TOOLS = new Set(['task', 'Task', 'agent']);

/** Tools where a failure is news, not a normal outcome (a grep that found
 *  nothing is not news). Mirrors LOUD_TOOLS in hooks/reaction.js. */
const LOUD_TOOLS = new Set(['bash', 'edit', 'write', 'patch', 'multiedit']);

/** Did this tool result fail? The payload shape isn't contractual, so this
 *  checks the plausible shapes and defaults to "no" — a false quiet beat is far
 *  better than ういちゃん announcing failures that didn't happen. */
function isFailure(output) {
  if (!output || typeof output !== 'object') return false;
  const r = output.result ?? output.output ?? output;
  if (r?.is_error === true || r?.isError === true || r?.error) return true;
  if (typeof r?.exit_code === 'number' && r.exit_code !== 0) return true;
  if (typeof r?.exitCode === 'number' && r.exitCode !== 0) return true;
  return false;
}

export const UiChanPlugin = async () => ({
  event: async ({ event }) => {
    switch (event?.type) {
      case 'session.idle':
        // The turn ended. Deliberately says nothing about whether it went well
        // — the event doesn't know, and neither may her line.
        return fire('turn_done');
      case 'permission.asked':
        return fire('permission');
      case 'session.compacted':
        // Claude Code fires its equivalent *before* compacting and OpenCode
        // after, so the shared lines stay in reported speech either way.
        return fire('compact');
      case 'session.error':
        return fire('tool_failure');
      default:
        return;
    }
  },

  'tool.execute.before': async (input) => {
    if (AGENT_TOOLS.has(input?.tool)) fire('agent_out');
  },

  'tool.execute.after': async (input, output) => {
    if (AGENT_TOOLS.has(input?.tool)) return fire('agent_back');
    if (LOUD_TOOLS.has(String(input?.tool).toLowerCase()) && isFailure(output)) fire('tool_failure');
  },
});

export default UiChanPlugin;
