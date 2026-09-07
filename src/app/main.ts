import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, powerMonitor, screen } from 'electron';
import { type WebSocket, WebSocketServer } from 'ws';
import { loadEnvFiles, resolvePaths } from '../shared/paths';
import { setCueArgsSchema } from '../shared/set-cue-schema';
import type {
  ConnectedAgent,
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

// TTS credentials live in .env / env vars (never in the config). The MCP bridge
// also forwards them on connect; this covers a manually launched `npm run app`.
loadEnvFiles(projectRoot);

// Packaged defaults + the user's ~/.ui-chan overrides (see shared/paths.ts).
const paths = resolvePaths(projectRoot);
const config: MascotConfig = paths.config;
const port = Number(process.env.UI_CHAN_PORT ?? config.port ?? 8123);
const cuesDir = paths.cueDirs;
const cueSchemaPath = paths.cueSchemaFile;

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
const agents = new Map<WebSocket, ConnectedAgent>();
const pendingCommands: RenderCommand[] = [];

function findPsd(): string | null {
  return findPsdIn(paths.assetsDirs);
}

function sendToRenderer(cmd: RenderCommand): void {
  if (win && rendererReady) {
    win.webContents.send('ui-chan:command', cmd);
  } else {
    pendingCommands.push(cmd);
  }
}

/** The agent ういちゃん last spoke for — "who is she talking to right now",
 *  which is the question the connections panel exists to answer. */
let activeAgent: number | null = null;
let nextAgentId = 1;

/** Is there a newer ui-chan upstream? Checked in a child process because it
 *  touches the network (git fetch) and must never stall the mascot. Silent on
 *  every failure — "can't tell" and "up to date" look the same on screen, and
 *  neither is worth a warning. */
function checkForUpdate(): void {
  // `process.execPath` は Electron 本体を指す（ここは Electron のメインプロセス）。
  // それで .mjs を起動すると Electron がアプリとして立ち上がろうとして、
  // 更新チェックは一度も成功しない。node を探すランチャ経由で起動する。
  const child = spawn(
    path.join(projectRoot, 'bin', 'ui-chan-node'),
    [path.join(projectRoot, 'tools', 'setup', 'update-check.mjs'), projectRoot],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let out = '';
  child.stdout?.on('data', (d: Buffer) => {
    out += d;
  });
  child.on('close', () => {
    try {
      const st = JSON.parse(out);
      sendToRenderer({
        type: 'update',
        available: Boolean(st.available),
        behind: st.behind,
        blocked: st.blocked ?? null,
      });
    } catch {
      /* not a git install, offline, or git missing — say nothing */
    }
  });
  child.on('error', () => {
    /* no node? impossible here, but never throw from a timer */
  });
}

/** Push the current connection list to the renderer. Called on connect,
 *  disconnect, and whenever she starts speaking for someone else — the panel
 *  never polls, so it cannot show a stale session. */
function sendConnections(): void {
  sendToRenderer({ type: 'connections', agents: [...agents.values()], active: activeAgent });
}

const tts = config.tts?.enabled ? new VoiSonaTalkClient(config.tts) : null;
/** Voice can be muted from the panel. This silences the *voice* only — the
 *  bubble still appears, because a mascot that goes completely blank looks
 *  broken rather than quiet. */
let muted = false;

const state = new UiChanState(
  config,
  cues,
  sendToRenderer,
  tts
    ? (text, cue, adlib) => (muted ? Promise.resolve(null) : tts.synthesize(text, cue, adlib))
    : undefined,
  // OS-wide "seconds since the user last touched keyboard or mouse" — what lets
  // Idling read the user's presence instead of only its own timers.
  () => powerMonitor.getSystemIdleTime(),
);

/** Setup-level problems the agent can't see from tool results alone (no PSD in
 *  assets/, TTS on but unusable) surface as warnings so they're diagnosable
 *  from a single get_state instead of by reading the app's stderr. */
function setupWarnings(psdFile: string | null): string[] {
  const out: string[] = [];
  if (!psdFile) {
    out.push(
      `立ち絵PSDが見つかりません: ${path.join(paths.home, 'assets')} に PSD を置いてください`,
    );
  }
  const t = tts?.status();
  if (t?.enabled && !t.hasCredentials) {
    out.push(
      `TTSの資格情報がありません: ${path.join(paths.home, '.env')}（または環境変数）に UI_CHAN_TTS_USERNAME / UI_CHAN_TTS_PASSWORD を設定してください`,
    );
  }
  if (t?.enabled && t.hasCredentials && t.engineUnreachable) {
    out.push(`VoiSona Talk に接続できません (${config.tts?.url}): 起動しているか確認してください`);
  }
  return out;
}

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
    warnings: [
      ...setupWarnings(psdFile),
      ...rendererWarnings,
      ...cueErrors,
      ...(cueWarning ? [cueWarning] : []),
    ],
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
  event_cue: (args) => state.fireEventCue(String(args.event), { force: args.force === true }),
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
      case 'list_event_cues': {
        return { id: req.id, ok: true, result: state.listEventCues() };
      }
      case 'trigger_event': {
        // force: the dev asked for this one, so skip cooldown/chance — but the
        // affinity and time gates still apply, so what you see could really play.
        const result = state.fireEventCue(action.event, { force: true });
        if (!result.ok) return { id: req.id, ok: false, error: result.error };
        return { id: req.id, ok: true, result };
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
      case 'panel': {
        return { id: req.id, ok: true, result: panelAction(action.kind, action.value) };
      }
      case 'fake_update': {
        sendToRenderer({
          type: 'update',
          available: action.available,
          behind: action.behind ?? 3,
          blocked: null,
        });
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
        agents.set(ws, {
          id: nextAgentId++,
          name: req.agent ?? 'unknown',
          connectedAt: new Date().toISOString(),
          ...(req.identity ?? {}),
        });
        sendConnections();
        if (exitTimer) {
          clearTimeout(exitTimer);
          exitTimer = null;
        }
        if (req.tts?.username && tts) {
          tts.setCredentials(req.tts.username, req.tts.password);
        }
        return { id: req.id, ok: true, result: { server: 'ui-chan-mcp' } };
      }
      case 'tool': {
        const handler = req.tool ? toolHandlers[req.tool] : undefined;
        if (!handler) return { id: req.id, ok: false, error: `unknown tool: ${req.tool}` };
        const caller = agents.get(ws)?.id ?? null;
        if (caller !== null && caller !== activeAgent) {
          activeAgent = caller;
          sendConnections();
        }
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

/** Ask the renderer to paint a backdrop and wait for it to have painted.
 *  Two frames is enough (one to apply, one to render) and is far more reliable
 *  than a fixed sleep. */
async function setBackdrop(style: string | null): Promise<void> {
  if (!win || !rendererReady) return;
  sendToRenderer({ type: 'backdrop', style });
  await new Promise((r) => setTimeout(r, 120));
}

async function handleScreenshot(req: WsRequest): Promise<WsResponse> {
  try {
    if (!win) return { id: req.id, ok: false, error: 'no window' };
    const requested = req.args?.path;
    // Installed globally the package dir is not a sane place to write, so
    // screenshots land in the user's home dir whenever there is one.
    const shotRoot = paths.homeExists ? paths.home : projectRoot;
    const out = path.resolve(
      shotRoot,
      typeof requested === 'string' && requested.length > 0 ? requested : 'ui-chan-shot.png',
    );
    // The WS server only binds 127.0.0.1, but a caller-supplied path could
    // still try to escape via `..` — keep screenshot writes inside the project.
    if (out !== shotRoot && !out.startsWith(shotRoot + path.sep)) {
      return { id: req.id, ok: false, error: `path must stay within ${shotRoot}` };
    }
    // `background` is any CSS background value ('#fff', a gradient, …) or the
    // named presets in the renderer.透過のままだと、白以外の場所に貼った
    // 瞬間に破綻するので、撮る間だけ背景を敷く。
    const background = typeof req.args?.background === 'string' ? req.args.background : null;
    if (background) await setBackdrop(background);
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(out, image.toPNG());
    } finally {
      if (background) await setBackdrop(null);
    }
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
    ws.on('close', () => {
      agents.delete(ws);
      sendConnections();
      scheduleExitIfIdle();
    });
  });
  wss.on('error', (err) => {
    console.error(`[ui-chan] WebSocket server error: ${err.message}`);
  });
}

/**
 * Quit once nothing is connected any more.
 *
 * The app is launched detached (by the MCP server or the SessionStart hook), so
 * without this it outlives every client and has to be killed by hand from the
 * repo. Agents are tracked per WebSocket, which makes "is anyone still there?"
 * exact across windows, apps and other MCP clients alike — and it needs no
 * cooperation from the client, so a session that dies without a goodbye still
 * releases her.
 *
 * The delay matters: restarting Claude Code drops the socket and reconnects a
 * few seconds later, and quitting on the gap would make every restart blink the
 * mascot out of existence. Any reconnection inside the window cancels it.
 */
let exitTimer: NodeJS.Timeout | null = null;

function scheduleExitIfIdle(): void {
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = null;
  }
  const sec = config.exitAfterLastAgentSec ?? 0;
  if (sec <= 0 || agents.size > 0) return;

  exitTimer = setTimeout(() => {
    exitTimer = null;
    if (agents.size > 0) return; // someone came back while we waited
    console.error(`[ui-chan] no agents connected for ${sec}s — quitting`);
    app.quit();
  }, sec * 1000);
}

/** 定位置＝主ディスプレイの作業領域の右下。起動時とリセット時の両方が
 *  ここを見るので、「起動し直さないと位置が戻らない」ということはない。 */
function homePosition(): { x: number; y: number } {
  const { width, height, margin } = config.window;
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - width - margin, y: wa.y + wa.height - height - margin };
}

/** パネルのボタンの実体。IPC からも、デバッグ用の WS アクションからも同じ
 *  ものを呼ぶ——押した結果を確かめる方法が無いと、今回のように
 *  「押したのに何も起きない」不具合を見つけられない。 */
function panelAction(kind: string, value?: number): unknown {
  switch (kind) {
    case 'affinity':
      // The panel is the only place a human can move affinity directly; the
      // agent's own adjust_affinity stays direction+magnitude, so this can't
      // be used to sneak past the asymmetric curve on her behalf.
      if (typeof value === 'number') state.setAffinity(value);
      return state.affinitySnapshot();
    case 'affinity:get':
      return state.affinitySnapshot();
    case 'mute':
      muted = true;
      return { muted };
    case 'unmute':
      muted = false;
      return { muted };
    case 'clear':
      state.clear();
      return { ok: true };
    case 'restart':
      app.relaunch();
      app.quit();
      return { ok: true };
    case 'update': {
      // 更新はこのプロセスが読んでいるファイルそのものを書き換えるので、
      // 自分より長生きする子プロセスにやらせる（取得 → npm install →
      // build → 起動しなおし）。
      //
      // ただし **投げっぱなしにはしない**。更新が無かった場合や失敗した
      // 場合、子は何もせず終わるので、「着替えてくる」と言ったまま彼女が
      // 戻ってこないように見える。結果を受け取って必ず言い直す。
      const child = spawn(
        path.join(projectRoot, 'bin', 'ui-chan-node'),
        [path.join(projectRoot, 'bin', 'ui-chan.mjs'), 'update'],
        { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout?.on('data', (d: Buffer) => {
        out += d;
      });
      child.stderr?.on('data', (d: Buffer) => {
        out += d;
      });
      child.on('close', (code) => {
        // 更新できた場合、子が stop → start するのでこの行には来ない
        // （来たとしても、そのときは何も起きていない）。
        // 理由は言わない。git が汚れているとか追跡先が無いとかは、使う人には
        // 意味の無い話で、npm で入れた人には git の概念すら無い。**結果だけ**
        // 言い、詳細は stderr へ落とす。
        if (code === 0) {
          state.setCue(
            {
              cue: 'emo_joy_lo',
              text: '更新するものなかったよ。',
              reading: 'こうしんするものなかったよ。',
            },
            'panel',
          );
        } else {
          console.error(`[ui-chan] update failed:\n${out}`);
          state.setCue(
            {
              cue: 'sys_awkward',
              text: 'うまく更新できなかった。',
              reading: 'うまくこうしんできなかった。',
            },
            'panel',
          );
        }
      });
      child.unref();
      state.setCue(
        {
          cue: 'sys_think',
          text: '着替えてくる。ちょっと待ってて。',
          reading: 'きがえてくる。ちょっとまってて。',
        },
        'panel',
      );
      return { ok: true };
    }
    case 'quit':
      // Nothing to coordinate: a bridge only launches the app at its own
      // startup, so quitting stays quit until a person starts her again.
      app.quit();
      return { ok: true };
    default:
      return { ok: false };
  }
}

function createWindow(): void {
  const { width, height } = config.window;
  const home = homePosition();
  win = new BrowserWindow({
    width,
    height,
    x: home.x,
    y: home.y,
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
  // 既定はクリック透過。窓は420x680の矩形で、ういちゃんが占めるのはその一部
  // なので、素通しにしないと「彼女の周りの何もないところ」が後ろのウィンドウ
  // へのクリックを全部飲んでしまう。forward:true にすると透過中も mousemove
  // だけは届くので、レンダラ側がカーソルの下を見て、実ピクセルとパネルの上に
  // 来た瞬間だけ透過を解く（renderer.ts の updateClickThrough）。
  win.setIgnoreMouseEvents(true, { forward: true });
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
    // Once at startup, then every 6 hours: rare enough to be invisible, often
    // enough that a long-running mascot notices a release.
    setTimeout(checkForUpdate, 8_000);
    setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
    watchCues(cuesDir, () => {
      cues = loadCurrentCues();
      state.setCues(cues);
      console.error('[ui-chan] cues reloaded');
    });
  });

  app.on('window-all-closed', () => app.quit());

  /** The panel's buttons. Deliberately few and all reversible-or-obvious:
   *  anything destructive belongs in the CLI, not in a window that pops open
   *  on its own. */
  ipcMain.handle('ui-chan:panel-action', (_ev, kind: string, value?: number) =>
    panelAction(kind, value),
  );

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
    // The panel is otherwise only fed by *changes*, so a renderer that starts
    // (or reloads) while nobody is connected would sit there showing neither
    // rows nor the empty state. Send the current list once it can receive it.
    sendConnections();
  });

  ipcMain.on('ui-chan:interaction', (_ev, kind: string) => {
    state.onInteraction(kind);
  });

  // カーソルの下が「押せるもの」かどうかはレンダラにしか分からない（アルファ
  // 判定もパネルのDOMもあちら側）。ここはその判定を窓に反映するだけ。
  ipcMain.on('ui-chan:click-through', (_ev, on: boolean) => {
    win?.setIgnoreMouseEvents(on, { forward: true });
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
