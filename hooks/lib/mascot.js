// Shared helper for the Claude Code hooks: speak one line through the running
// mascot and get out of the way.
//
// Every hook here runs inside Claude Code's critical path, so the rules are the
// same for all of them: never block, never throw, never print to stdout (the
// only hook that writes stdout is session-start.js, which returns context), and
// always exit 0 — a dead mascot must not be able to break the session.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, '..', '..');

function readPort() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'ui-chan.config.json'), 'utf-8'));
    if (typeof config.port === 'number') return config.port;
  } catch {
    /* fall through to the default */
  }
  return Number(process.env.UI_CHAN_PORT ?? 8123);
}

/** Read the hook payload Claude Code writes to stdin. Never throws. */
function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');
  } catch {
    return {};
  }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Send one set_cue to the mascot, then exit. Unlike the MCP bridge this does
 * NOT launch the app: a hook firing mid-session should stay silent when the
 * mascot isn't up, not pop a window open behind the user's work.
 */
function speak(line, agent) {
  if (!line) process.exit(0);

  let settled = false;
  let ws;
  const done = () => {
    if (settled) return;
    settled = true;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  // Hard cap: the hook can never hang Claude Code.
  setTimeout(done, 1500).unref?.();

  try {
    ws = new WebSocket(`ws://127.0.0.1:${readPort()}`);
  } catch {
    return done();
  }

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        id: 1,
        type: 'tool',
        agent,
        tool: 'set_cue',
        args: { cue: line.cue, text: line.text, reading: line.reading },
      }),
    );
    // Give the bridge a beat to process, then leave.
    setTimeout(done, 250);
  });
  ws.addEventListener('error', () => done());
}

module.exports = { readPayload, readPort, pick, speak, root };
