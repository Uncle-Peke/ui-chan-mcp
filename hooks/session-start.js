#!/usr/bin/env node
// SessionStart hook. Two jobs, both about being ready before the user types:
//   1. make sure the mascot app (the daemon) is running
//   2. hand the session the persona, for clients that don't read the MCP
//      server's handshake `instructions`
//
// The persona text itself is NOT built here — it comes from dist/app/persona.js,
// the same module the MCP server uses for `instructions` and the `persona`
// prompt. This file used to reimplement it, which is how the two could drift.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, '..');

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(root, 'ui-chan.config.json'), 'utf-8'));
} catch {
  /* use defaults */
}

/**
 * Start the display app if nothing is listening on its WebSocket port yet.
 *
 * The MCP server also does this (on connect, and on every tool call), so in a
 * plugin install this is belt-and-braces — but it is the only one of the two
 * that runs when the MCP server is not configured at all, and it costs a 700ms
 * probe. Fire-and-forget: the hook must not block the session, and a failure
 * here is never worth breaking persona injection over.
 */
function ensureAppRunning(port) {
  const probe = net.connect({ host: '127.0.0.1', port });
  probe.setTimeout(700);
  const launch = () => {
    probe.destroy();
    try {
      // In a plain Node process, require('electron') resolves to the binary path.
      const electronPath = require(path.join(root, 'node_modules', 'electron'));
      spawn(electronPath, [root], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* electron not installed (npm install not run yet) — nothing to launch */
    }
  };
  probe.on('connect', () => probe.destroy()); // already running
  probe.on('timeout', launch);
  probe.on('error', launch);
}

ensureAppRunning(Number(process.env.UI_CHAN_PORT ?? config.port ?? 8123));

// The persona also travels on the MCP handshake (the server's `instructions`),
// so in a client that reads those this injection is a second copy of the same
// ~13k characters. Set UI_CHAN_NO_PERSONA_HOOK=1 to keep only the app-launch
// half above.
if (process.env.UI_CHAN_NO_PERSONA_HOOK !== '1') {
  try {
    const { buildPersonaText } = require(path.join(root, 'dist', 'app', 'persona.js'));
    const text = buildPersonaText(root, config);
    if (text) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
        }),
      );
    }
  } catch {
    // dist/ not built yet — degrade silently, the same as any other missing
    // file here. `npm install` (or `npm run build`) fixes it.
  }
}
