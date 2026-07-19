#!/usr/bin/env node
// Manual debugger for the ui-chan display app.
// Bypasses the MCP server and talks directly to the app's WebSocket.
//
// Usage:
//   node tools/debug.mjs                    # interactive REPL
//   node tools/debug.mjs set_cue happy      # one-shot command
//   node tools/debug.mjs --launch idle      # launch app if needed, then run idle
//
// TTS credentials are read from the environment (UI_CHAN_TTS_USERNAME/PASSWORD)
// or from a .env file in the project root, and forwarded to the app on connect.
//
// REPL commands:
//   set_cue <cue> [text] [reading]
//   set_cue_json <cue> '<json>'
//   state, clear
//   set_affinity <value> [reason]
//   restart          # stop and relaunch the display app
//   idle [name]      # trigger an IdlingCue (or random)
//   list             # list available cues + IdlingCues
//   preview <cue>    # show composed directives without wearing it
//   watch            # poll state every 500ms (Ctrl+C to stop)
//   help, exit

import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Load .env in the project root so TTS credentials can live in a file instead of the shell.
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch {
  /* no .env file — that's fine */
}

const port = Number(process.env.UI_CHAN_PORT ?? 8123);
const wsUrl = `ws://127.0.0.1:${port}`;

const args = process.argv.slice(2);
const launch = args.includes('--launch');
const commandLine = args
  .filter((a) => a !== '--launch')
  .join(' ')
  .trim();

function ttsCredentials() {
  const username = process.env.UI_CHAN_TTS_USERNAME;
  const password = process.env.UI_CHAN_TTS_PASSWORD;
  return username && password ? { username, password } : undefined;
}

let ws = null;
let nextId = 1;
const pending = new Map();
let watchTimer = null;

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on('open', () => {
      ws = socket;
      socket.on('message', (data) => {
        try {
          const res = JSON.parse(data.toString());
          const p = pending.get(res.id);
          if (p) {
            pending.delete(res.id);
            p.resolve(res);
          }
        } catch {
          /* ignore malformed frames */
        }
      });
      socket.on('close', () => {
        ws = null;
        for (const [id, p] of pending) {
          pending.delete(id);
          p.reject(new Error('connection to display app closed'));
        }
      });
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

function send(msg) {
  return new Promise((resolve, reject) => {
    if (!ws) {
      reject(new Error('not connected'));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('request to display app timed out'));
    }, 15_000);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id, ...msg }));
  });
}

function launchApp() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.error('[debug] electron not found; run `npm install` first');
    process.exit(1);
  }
  console.log(`[debug] launching display app: ${electronPath}`);
  spawn(electronPath, [projectRoot], { detached: true, stdio: 'ignore' }).unref();
}

function stopApp() {
  const commands = {
    darwin: 'pkill -f "ui-chan-mcp/node_modules/electron"',
    linux: 'pkill -f "ui-chan-mcp/node_modules/electron"',
    win32: 'taskkill /F /FI "IMAGENAME eq electron.exe" /FI "COMMANDLINE eq *ui-chan-mcp*"',
  };
  const cmd = commands[process.platform];
  if (!cmd) {
    console.error(`[debug] unsupported platform: ${process.platform}`);
    return;
  }
  try {
    execSync(cmd, { stdio: 'ignore' });
    console.log('[debug] stopped display app');
  } catch {
    console.log('[debug] no running display app found');
  }
}

async function ensureConnected() {
  if (ws) return ws;
  if (launch) launchApp();
  const deadline = Date.now() + (launch ? 15_000 : 5_000);
  for (;;) {
    try {
      const socket = await connect();
      await send({ type: 'hello', agent: 'debug', tts: ttsCredentials() });
      return socket;
    } catch (_e) {
      if (Date.now() > deadline) {
        throw new Error(
          `could not reach display app at ${wsUrl}. ` +
            (launch
              ? 'Launch requested but it did not start in time.'
              : 'Run `npm run app` first or use --launch.'),
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function callTool(tool, args = {}) {
  await ensureConnected();
  const res = await send({ type: 'tool', tool, args });
  if (!res.ok) throw new Error(res.error ?? 'unknown error');
  return res.result;
}

async function callDebug(action) {
  await ensureConnected();
  const res = await send({ type: 'debug', debug: action });
  if (!res.ok) throw new Error(res.error ?? 'unknown error');
  return res.result;
}

const completionCache = {
  commands: [
    'help',
    'set_cue',
    'set_cue_json',
    'state',
    'clear',
    'set_affinity',
    'restart',
    'idle',
    'list',
    'preview',
    'watch',
    'refresh',
    'exit',
  ],
  cues: [],
  idlingCues: [],
};

async function loadCompletions() {
  try {
    const [state, idle] = await Promise.all([
      callTool('get_state'),
      callDebug({ type: 'list_idle' }),
    ]);
    completionCache.cues = state.availableCues ?? [];
    completionCache.idlingCues = (idle?.idlingCues ?? []).map((a) => a.name).filter(Boolean);
  } catch (e) {
    console.error(`[debug] completion cache failed: ${e.message}`);
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

const helpText = `
Commands:
  set_cue <cue> [text] [reading]        set a Cue and optionally speak a line
  set_cue_json <cue> '<json>'           pass raw JSON for options
  state                                 show current state
  clear                                 clear speech/queue and revert to default
  set_affinity <value> [reason]         set affinity to an absolute value
  restart                               stop and relaunch the display app
  idle [name]                           trigger an IdlingCue (random if no name)
  list                                  list available cues and IdlingCues
  preview <cue>                         show directives a Cue would produce
  watch                                 poll state every 500ms (Ctrl+C to stop)
  refresh                               reload cue/idlingCue names for Tab completion
  help                                  show this help
  exit                                  quit
`;

const commands = {
  help: async () => console.log(helpText.trim()),

  set_cue: async (tokens) => {
    const cue = tokens[1];
    if (!cue) throw new Error('usage: set_cue <cue> [text] [reading]');
    const args = { cue };
    if (tokens[2]) args.text = tokens[2];
    if (tokens[3]) args.reading = tokens[3];
    const result = await callTool('set_cue', args);
    printJson(result);
  },

  set_cue_json: async (tokens) => {
    const cue = tokens[1];
    const json = tokens.slice(2).join(' ');
    if (!cue || !json) throw new Error("usage: set_cue_json <cue> '<json>'");
    const parsed = JSON.parse(json);
    const result = await callTool('set_cue', { cue, ...parsed });
    printJson(result);
  },

  state: async () => printJson(await callTool('get_state')),

  clear: async () => printJson(await callTool('clear')),

  set_affinity: async (tokens) => {
    const value = Number(tokens[1]);
    if (Number.isNaN(value)) throw new Error('usage: set_affinity <value> [reason]');
    const reason = tokens.slice(2).join(' ') || undefined;
    printJson(await callDebug({ type: 'set_affinity', value, reason }));
  },

  restart: async () => {
    if (ws) {
      ws.close();
      ws = null;
    }
    stopApp();
    console.log('[debug] waiting for app to exit...');
    await new Promise((r) => setTimeout(r, 3000));
    launchApp();
    console.log('[debug] waiting for app to start...');
    await new Promise((r) => setTimeout(r, 2000));
    await loadCompletions();
    console.log('[debug] app restarted');
  },

  idle: async (tokens) => {
    const name = tokens[1];
    const result = await callDebug({ type: 'trigger_idle', ...(name ? { name } : {}) });
    printJson(result);
  },

  list: async () => {
    const [state, idle] = await Promise.all([
      callTool('get_state'),
      callDebug({ type: 'list_idle' }),
    ]);
    printJson({
      availableCues: state.availableCues,
      idlingCues: idle.idlingCues,
    });
  },

  preview: async (tokens) => {
    const cue = tokens[1];
    if (!cue) throw new Error('usage: preview <cue>');
    printJson(await callDebug({ type: 'preview_cue', cue }));
  },

  refresh: async () => {
    await loadCompletions();
    console.log(
      `[debug] completions loaded: ${completionCache.cues.length} cues, ${completionCache.idlingCues.length} idlingCues`,
    );
  },

  watch: async () => {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
      console.log('[debug] watch stopped');
      return;
    }
    console.log('[debug] watching state (run `watch` again to stop)');
    watchTimer = setInterval(async () => {
      try {
        const s = await callTool('get_state');
        // Print a compact one-line summary instead of full JSON.
        const speech = s.currentSpeech ? `"${s.currentSpeech.text}"` : '-';
        const queue = s.speechQueue.length;
        console.log(
          `[${new Date().toLocaleTimeString()}] cue=${s.cue.cue} agent=${s.cue.agent ?? '-'} speech=${speech} queue=${queue} affinity=${s.affinity.value}`,
        );
      } catch (e) {
        console.error(`[debug] watch error: ${e.message}`);
      }
    }, 500);
  },
};

async function runLine(line) {
  line = line.trim();
  if (!line) return;
  const tokens = line.split(/\s+/);
  const cmd = tokens[0];
  if (cmd === 'exit' || cmd === 'quit') {
    process.exit(0);
  }
  const handler = commands[cmd];
  if (!handler) {
    console.error(`[debug] unknown command: ${cmd}. Type 'help' for commands.`);
    return;
  }
  await handler(tokens);
}

function completer(line) {
  const trimmed = line.trimStart();
  const endsWithSpace = /\s$/.test(line);
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return [completionCache.commands, ''];
  }

  if (tokens.length === 1 && !endsWithSpace) {
    const prefix = tokens[0];
    return [completionCache.commands.filter((c) => c.startsWith(prefix)), prefix];
  }

  const cmd = tokens[0];
  const prefix = endsWithSpace ? '' : tokens[tokens.length - 1];
  let candidates = [];
  if (cmd === 'set_cue' || cmd === 'preview') {
    candidates = completionCache.cues;
  } else if (cmd === 'idle') {
    candidates = completionCache.idlingCues;
  }
  const hits = candidates.filter((c) => c.startsWith(prefix));
  return [hits, prefix];
}

async function main() {
  if (commandLine) {
    await runLine(commandLine);
    process.exit(0);
  }

  console.log('[debug] ui-chan debug console. Type "help" for commands.');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'debug> ',
    completer,
  });
  void loadCompletions();
  rl.prompt();
  rl.on('line', async (line) => {
    try {
      await runLine(line);
    } catch (e) {
      console.error(`[debug] error: ${e.message}`);
    }
    rl.prompt();
  });
  rl.on('close', () => {
    if (watchTimer) clearInterval(watchTimer);
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`[debug] fatal: ${e.message}`);
  process.exit(1);
});
