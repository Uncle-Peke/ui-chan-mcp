import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket from 'ws';
import { z } from 'zod';
import { loadCues } from './app/cues';
import { setCueShape } from './shared/set-cue-schema';
import type { MascotConfig, WsResponse } from './shared/types';

const projectRoot = path.resolve(__dirname, '..');
const config: MascotConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'ui-chan.config.json'), 'utf-8'),
);
const port = Number(process.env.UI_CHAN_PORT ?? config.port ?? 8123);
const wsUrl = `ws://127.0.0.1:${port}`;

const log = (msg: string) => process.stderr.write(`[ui-chan-mcp] ${msg}\n`);

const server = new McpServer({ name: 'ui-chan-mcp', version: '0.1.0' });

// ---- WebSocket bridge to the Electron display app ----

let socket: WebSocket | null = null;
let nextId = 1;
let lastLaunchAt = 0;
const pending = new Map<number, { resolve: (r: WsResponse) => void; reject: (e: Error) => void }>();

function ttsCredentials(): { username: string; password: string } | undefined {
  const username = process.env.UI_CHAN_TTS_USERNAME;
  const password = process.env.UI_CHAN_TTS_PASSWORD;
  return username && password ? { username, password } : undefined;
}

/** Launch VoiSona Talk (macOS) if its REST API is not reachable yet. */
async function ensureVoiSonaRunning(): Promise<void> {
  const tts = config.tts;
  if (!tts?.enabled || process.platform !== 'darwin') return;
  try {
    await fetch(`${tts.url}/docs/talk_api.html`, { signal: AbortSignal.timeout(1500) });
  } catch {
    const appName = tts.app_name ?? 'VoiSona Talk';
    log(`TTS engine not reachable at ${tts.url} — launching "${appName}"`);
    spawn('open', ['-g', '-a', appName], { stdio: 'ignore' }).unref();
  }
}

function agentName(): string {
  return (
    process.env.UI_CHAN_AGENT_NAME ??
    server.server.getClientVersion()?.name ??
    `agent-${process.pid}`
  );
}

function tryConnect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once('open', () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

function launchApp(): void {
  const now = Date.now();
  if (now - lastLaunchAt < 10_000) return;
  lastLaunchAt = now;
  // In a plain Node process, require('electron') resolves to the binary path.
  const electronPath = require('electron') as unknown as string;
  log(`launching display app: ${electronPath}`);
  spawn(electronPath, [projectRoot], { detached: true, stdio: 'ignore' }).unref();
}

// Concurrent tool calls arriving while disconnected must share one connection
// attempt — otherwise each call races its own tryConnect(), and only the
// last one ends up in `socket` while the others leak an open, never-closed
// WebSocket.
let connectingPromise: Promise<WebSocket> | null = null;

function ensureConnected(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (!connectingPromise) {
    connectingPromise = doConnect().finally(() => {
      connectingPromise = null;
    });
  }
  return connectingPromise;
}

async function doConnect(): Promise<WebSocket> {
  socket = null;

  let launched = false;
  const deadline = Date.now() + 25_000;
  for (;;) {
    let ws: WebSocket | null = null;
    try {
      ws = await tryConnect();
      ws.on('message', (data) => {
        try {
          const res: WsResponse = JSON.parse(data.toString());
          const p = pending.get(res.id);
          if (p) {
            pending.delete(res.id);
            p.resolve(res);
          }
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on('close', () => {
        if (socket === ws) socket = null;
        for (const [id, p] of pending) {
          pending.delete(id);
          p.reject(new Error('connection to display app closed'));
        }
      });
      socket = ws;
      await sendRequest({ type: 'hello', agent: agentName(), tts: ttsCredentials() });
      return ws;
    } catch {
      // A hello timeout/failure leaves `ws` open (only a real socket-level
      // close nulls it via the handler above) — close it ourselves so a
      // retry doesn't pile up abandoned sockets.
      if (ws && socket === ws) socket = null;
      if (ws && ws.readyState !== ws.CLOSED && ws.readyState !== ws.CLOSING) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      if (!launched) {
        try {
          launchApp();
        } catch (e) {
          log(`failed to launch display app: ${e instanceof Error ? e.message : e}`);
        }
        launched = true;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `could not reach the ui-chan display app at ${wsUrl}. ` +
            `Start it manually with \`npm run app\` in ${projectRoot}`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

function sendRequest(msg: {
  type: 'hello' | 'tool';
  agent?: string;
  tool?: string;
  args?: unknown;
  tts?: { username: string; password: string };
}): Promise<WsResponse> {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
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
    socket.send(JSON.stringify({ id, ...msg }));
  });
}

async function callTool(tool: string, args: Record<string, unknown>) {
  await ensureConnected();
  const res = await sendRequest({ type: 'tool', tool, args, agent: agentName() });
  if (!res.ok) throw new Error(res.error ?? 'unknown error');
  return res.result;
}

function toolResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] };
}

function toolError(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : e}` }],
    isError: true,
  };
}

/** Every tool handler here does the same "forward to the display app, wrap
 *  the result/error for MCP" — this is the one place that pattern lives. */
function wrapTool<A>(
  toolName: string,
  toArgs: (a: A) => Record<string, unknown> = (a) => a as Record<string, unknown>,
) {
  return async (a: A) => {
    try {
      return toolResult(await callTool(toolName, toArgs(a)));
    } catch (e) {
      return toolError(e);
    }
  };
}

// ---- Tool definitions ----

server.registerTool(
  'set_cue',
  {
    description:
      "Switch the mascot's Cue — a complete look (face + pose + voice color, baked together as " +
      'one self-contained unit) — and optionally speak a line at the same time. Cue and line are ' +
      'confirmed together in a single call, so the face and the voice never disagree about which ' +
      'Cue is "current". Pick the cue name from the Cue catalog in this persona\'s context. ' +
      'Unknown cue names fall back to "default" ' +
      "(see the returned note, or get_state's warnings). " +
      'text is optional: omit it to change the look silently (e.g. a wordless reaction while you ' +
      'keep working). When text is given, ALWAYS also pass reading (its full hiragana reading) so ' +
      'the mouth lip-syncs to the vowels — kanji cannot be lip-synced without it. ' +
      'pitch/speed/volume/intonation are one-line ad-lib performance knobs layered on top of this ' +
      "Cue's baked voice.style_weights/alp/huskiness; leave them unset to just use the Cue's voice as-is.",
    inputSchema: setCueShape,
  },
  wrapTool('set_cue'),
);

server.registerTool(
  'get_state',
  {
    description:
      'Get the current mascot state: active Cue, speech queue, connected agents, available cues, ' +
      'and affinity (value, band, and beamReady — whether ういビーム will fire).',
    inputSchema: {},
  },
  wrapTool('get_state', () => ({})),
);

server.registerTool(
  'adjust_affinity',
  {
    description:
      "Nudge うい's affinity toward you up or down by a relative amount (session-only, resets when the app restarts). " +
      'Raise it (+) when the user is warm, praises her, or shows her something she likes (cute VTubers/JKs, rain); ' +
      'lower it (−) for 旦那面/彼氏面, 塩鮭案件, or insults. Typical steps ±2〜8; big moments up to ±15. ' +
      'Affinity gates behavior: low = つれない/塩対応寄り, high = デレ, and ういビーム only fires above the beam threshold. ' +
      'Returns the new value, band, and beamReady. Check get_state for current affinity before deciding.',
    inputSchema: {
      delta: z.number().describe('Relative change, e.g. +5 or -3'),
      reason: z.string().optional().describe('Short why, for the log (e.g. "褒められた")'),
    },
  },
  wrapTool('adjust_affinity'),
);

server.registerTool(
  'clear',
  {
    description: 'Reset the mascot: clear the speech bubble and queue, restore the default Cue.',
    inputSchema: {},
  },
  wrapTool('clear', () => ({})),
);

/** The Cue catalog (name + optional description) is generated fresh from
 *  whatever is actually in cues/ every time the persona prompt is read —
 *  never from a hand-maintained doc, so it can't silently drift out of sync
 *  the way docs/CUES.md's old "早見表" table could. Cues flagged
 *  `internal: true` are excluded: they're building blocks for the IdlingCue
 *  system (state.ts), not meant to be picked directly via set_cue. */
function buildCueCatalog(): string {
  const cuesDir = path.join(projectRoot, config.cuesDir ?? 'cues');
  const cueSchemaPath = path.join(projectRoot, 'cue.schema.json');
  const { cues, errors } = loadCues(cuesDir, cueSchemaPath);
  const lines = Object.entries(cues)
    .filter(([, cue]) => !cue.internal)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cue]) => `- \`${name}\`${cue.description ? ` — ${cue.description}` : ''}`);
  const warning = errors.length > 0 ? `\n\n(cue読み込みエラー: ${errors.join('; ')})` : '';
  return (
    '## 利用可能なCue一覧（set_cueのcue引数。起動時点のcues/の内容から自動生成）\n\n' +
    `${lines.join('\n')}${warning}`
  );
}

server.registerPrompt(
  'persona',
  {
    title: 'ういちゃんペルソナ',
    description:
      "Load the mascot's persona (personality, tone, and tool-usage policy) into the conversation. " +
      'Defined in persona/ui-chan.md — edit that file to change the character.',
  },
  () => {
    const personaPath = path.join(projectRoot, config.personaFile ?? 'persona/ui-chan.md');
    const parts: string[] = [];
    try {
      parts.push(fs.readFileSync(personaPath, 'utf-8'));
    } catch {
      parts.push(
        `ペルソナファイルが見つかりません: ${personaPath}\nこのパスに人格定義のMarkdownを作成してください。`,
      );
    }
    const contextDir = path.join(projectRoot, 'context');
    try {
      for (const file of fs
        .readdirSync(contextDir)
        .filter((f) => f.endsWith('.md'))
        .sort()) {
        parts.push(fs.readFileSync(path.join(contextDir, file), 'utf-8'));
      }
    } catch {
      /* no context dir */
    }
    try {
      parts.push(buildCueCatalog());
    } catch (e) {
      parts.push(`Cue一覧の生成に失敗しました: ${e instanceof Error ? e.message : e}`);
    }
    return {
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: parts.join('\n\n---\n\n') },
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  void ensureVoiSonaRunning();
  log(`ready (display app expected at ${wsUrl})`);
}

main().catch((e) => {
  log(`fatal: ${e}`);
  process.exit(1);
});
