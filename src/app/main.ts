import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { type WebSocket, WebSocketServer } from 'ws';
import { setCueArgsSchema } from '../shared/set-cue-schema';
import type {
  Cue,
  MascotConfig,
  MascotStateSnapshot,
  RenderCommand,
  WsRequest,
  WsResponse,
} from '../shared/types';
import { findPsd as findPsdIn } from './assets';
import { extractCueVoice, loadCues, watchCues } from './cues';
import { UiChanState } from './state';
import { VoiSonaTalkClient } from './tts';

const projectRoot = path.resolve(__dirname, '..', '..');
const configPath = path.join(projectRoot, 'ui-chan.config.json');
const config: MascotConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const port = Number(process.env.UI_CHAN_PORT ?? config.port ?? 8123);
const cuesDir = path.join(projectRoot, config.cuesDir ?? 'cues');
const cueSchemaPath = path.join(projectRoot, 'cue.schema.json');

let cueErrors: string[] = [];
function loadCurrentCues(): Record<string, Cue> {
  const set = loadCues(cuesDir, cueSchemaPath);
  cueErrors = set.errors;
  if (config.tts) config.tts.cueVoice = extractCueVoice(set);
  for (const err of set.errors) console.error(`[ui-chan] cue error: ${err}`);
  return set.cues;
}
let cues = loadCurrentCues();

let win: BrowserWindow | null = null;
let rendererReady = false;
let rendererWarnings: string[] = [];
const agents = new Map<WebSocket, { name: string; connectedAt: string }>();
const pendingCommands: RenderCommand[] = [];

function findPsd(): string | null {
  return findPsdIn(path.join(projectRoot, config.assetsDir));
}

function sendToRenderer(cmd: RenderCommand): void {
  if (win && rendererReady) {
    win.webContents.send('ui-chan:command', cmd);
  } else {
    pendingCommands.push(cmd);
  }
}

const tts = config.tts?.enabled ? new VoiSonaTalkClient(config.tts) : null;
const state = new UiChanState(
  config,
  cues,
  sendToRenderer,
  tts ? (text, cue, adlib) => tts.synthesize(text, cue, adlib) : undefined,
);

function buildSnapshot(): MascotStateSnapshot {
  const psdFile = findPsd();
  const { cueWarning, ...rest } = state.snapshot();
  return {
    psdLoaded: psdFile !== null && rendererReady,
    psdFile: psdFile ? path.basename(psdFile) : null,
    ...rest,
    connectedAgents: [...agents.values()],
    availableCues: state.listCues(),
    tts: tts ? tts.status() : { enabled: false },
    warnings: [...rendererWarnings, ...cueErrors, ...(cueWarning ? [cueWarning] : [])],
    affinity: state.affinitySnapshot(),
  };
}

// Keyed by the WsRequest['tool'] union, so adding a tool without a handler
// (or vice versa) is a compile error instead of a silent `unknown tool` at
// runtime.
type ToolName = NonNullable<WsRequest['tool']>;

const toolHandlers: Record<ToolName, (args: Record<string, unknown>, agent: string) => unknown> = {
  set_cue: (args, agent) => state.setCue(setCueArgsSchema.parse(args), agent),
  get_state: () => buildSnapshot(),
  clear: () => state.clear(),
  adjust_affinity: (args) => state.adjustAffinity(String(args.direction), String(args.magnitude)),
};

function handleDebug(_ws: WebSocket, req: WsRequest): WsResponse {
  const action = req.debug;
  if (!action) {
    return { id: req.id, ok: false, error: 'missing debug action' };
  }
  try {
    switch (action.type) {
      case 'trigger_idle': {
        const result = state.triggerIdleAction(action.name);
        if (!result.ok) {
          return { id: req.id, ok: false, error: result.error };
        }
        return { id: req.id, ok: true, result };
      }
      case 'list_idle': {
        return { id: req.id, ok: true, result: state.listIdle() };
      }
      case 'preview_cue': {
        return { id: req.id, ok: true, result: state.previewCue(action.cue) };
      }
      case 'set_affinity': {
        const result = state.setAffinity(action.value);
        if (!result.ok) {
          return { id: req.id, ok: false, error: result.error };
        }
        return { id: req.id, ok: true, result };
      }
      case 'interact': {
        state.onInteraction(action.kind ?? 'poke');
        return { id: req.id, ok: true, result: { ok: true } };
      }
      default: {
        return { id: req.id, ok: false, error: `unknown debug action` };
      }
    }
  } catch (e) {
    return { id: req.id, ok: false, error: String(e) };
  }
}

function handleRequest(ws: WebSocket, req: WsRequest): WsResponse {
  const agent = agents.get(ws)?.name ?? req.agent ?? 'unknown';
  try {
    switch (req.type) {
      case 'hello': {
        agents.set(ws, { name: req.agent ?? 'unknown', connectedAt: new Date().toISOString() });
        if (req.tts?.username && tts) {
          tts.setCredentials(req.tts.username, req.tts.password);
        }
        return { id: req.id, ok: true, result: { server: 'ui-chan-mcp' } };
      }
      case 'tool': {
        const handler = req.tool ? toolHandlers[req.tool] : undefined;
        if (!handler) return { id: req.id, ok: false, error: `unknown tool: ${req.tool}` };
        return { id: req.id, ok: true, result: handler(req.args ?? {}, agent) };
      }
      case 'debug': {
        return handleDebug(ws, req);
      }
      default:
        return { id: req.id, ok: false, error: `unknown request type` };
    }
  } catch (e) {
    return { id: req.id, ok: false, error: String(e) };
  }
}

async function handleScreenshot(req: WsRequest): Promise<WsResponse> {
  try {
    if (!win) return { id: req.id, ok: false, error: 'no window' };
    const requested = req.args?.path;
    const out = path.resolve(
      projectRoot,
      typeof requested === 'string' && requested.length > 0 ? requested : 'ui-chan-shot.png',
    );
    // The WS server only binds 127.0.0.1, but a caller-supplied path could
    // still try to escape via `..` — keep screenshot writes inside the project.
    if (out !== projectRoot && !out.startsWith(projectRoot + path.sep)) {
      return { id: req.id, ok: false, error: `path must stay within ${projectRoot}` };
    }
    const image = await win.webContents.capturePage();
    fs.writeFileSync(out, image.toPNG());
    return { id: req.id, ok: true, result: { path: out } };
  } catch (e) {
    return { id: req.id, ok: false, error: String(e) };
  }
}

function startWsServer(): void {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let req: WsRequest;
      try {
        req = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (req.type === 'screenshot') {
        handleScreenshot(req).then((res) => ws.send(JSON.stringify(res)));
        return;
      }
      ws.send(JSON.stringify(handleRequest(ws, req)));
    });
    ws.on('close', () => agents.delete(ws));
  });
  wss.on('error', (err) => {
    console.error(`[ui-chan] WebSocket server error: ${err.message}`);
  });
}

function createWindow(): void {
  const { width, height, margin } = config.window;
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width,
    height,
    x: wa.x + wa.width - width - margin,
    y: wa.y + wa.height - height - margin,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(projectRoot, 'dist', 'renderer', 'index.html'));
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    startWsServer();
    createWindow();
    watchCues(cuesDir, () => {
      cues = loadCurrentCues();
      state.setCues(cues);
      console.error('[ui-chan] cues reloaded');
    });
  });

  app.on('window-all-closed', () => app.quit());

  ipcMain.handle('ui-chan:get-init', () => {
    const psdFile = findPsd();
    return { config, psdAvailable: psdFile !== null, psdFile };
  });

  ipcMain.handle('ui-chan:read-psd', (): Uint8Array | null => {
    const psdFile = findPsd();
    if (!psdFile) return null;
    return fs.readFileSync(psdFile);
  });

  ipcMain.on('ui-chan:ready', () => {
    rendererReady = true;
    state.applyVisual();
    for (const cmd of pendingCommands.splice(0)) {
      win?.webContents.send('ui-chan:command', cmd);
    }
  });

  ipcMain.on('ui-chan:interaction', (_ev, kind: string) => {
    state.onInteraction(kind);
  });

  // Manual window drag (we dropped -webkit-app-region:drag so JS can own the
  // fidget input). While the button is held over her body, the window follows
  // the cursor at a fixed grab offset.
  let dragTimer: NodeJS.Timeout | null = null;
  ipcMain.on('ui-chan:drag-start', () => {
    if (!win) return;
    const start = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const offX = start.x - wx;
    const offY = start.y - wy;
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!win) return;
      const p = screen.getCursorScreenPoint();
      win.setPosition(p.x - offX, p.y - offY);
    }, 16);
  });
  ipcMain.on('ui-chan:drag-end', () => {
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
  });

  ipcMain.on('ui-chan:warnings', (_ev, warnings: string[]) => {
    // The renderer reports its full warning set on every applyDirectives()
    // call (i.e. on every set_cue), which is normally the same set repeated —
    // only log when it actually changed, or a stuck missing-layer-path
    // warning would spam stderr on every single tool call.
    const changed = JSON.stringify(warnings) !== JSON.stringify(rendererWarnings);
    rendererWarnings = warnings;
    if (changed && warnings.length > 0) {
      console.error(`[ui-chan] layer warnings:\n  ${warnings.join('\n  ')}`);
    }
  });
}
