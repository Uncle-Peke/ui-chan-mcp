import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { loadEnvFiles, resolvePaths } from '../shared/paths';
import type { Cue, EditorCueListItem, EditorWriteResult, MascotConfig } from '../shared/types';
import { DEFAULT_CUE_NAME } from '../shared/types';
import { findPsd } from './assets';
import { loadCues, validateCueObject } from './cues';
import { VoiSonaTalkClient } from './tts';

// Standalone Cue editor window. A separate Electron entry from the mascot app
// (main.ts): opaque + framed, self-renders the PSD for preview, reads/writes
// cues/*.json directly, and previews voice via its own TTS client. Runs
// independently of the mascot — saving a cue is picked up live by a running
// mascot through its watchCues() hot-reload.

const projectRoot = path.resolve(__dirname, '..', '..');

// TTS credentials for "試し喋り" live in .env / env vars (never in the config).
loadEnvFiles(projectRoot);

const paths = resolvePaths(projectRoot);
const config: MascotConfig = paths.config;
const assetsDirs = paths.assetsDirs;
const cueDirs = paths.cueDirs;
const cueSchemaPath = paths.cueSchemaFile;

const tts = config.tts?.enabled ? new VoiSonaTalkClient(config.tts) : null;

const CUE_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Resolve `<name>.json` inside one cue dir, rejecting bad names / escapes. */
function cueFileIn(dir: string, name: string): string | null {
  if (!CUE_NAME_RE.test(name) || name === DEFAULT_CUE_NAME) return null;
  const p = path.join(dir, `${name}.json`);
  if (p !== path.join(dir, path.basename(p)) || !p.startsWith(dir + path.sep)) return null;
  return p;
}

/** Where an edit is saved — the user's dir when there is one, so an update of
 *  the package never overwrites hand-authored cues (shared/paths.ts). */
function cueWritePath(name: string): string | null {
  return cueFileIn(paths.cueWriteDir, name);
}

/** The file a cue currently lives in, searched with the same precedence
 *  loadCues() uses (last dir wins). */
function cueExistingPath(name: string): string | null {
  for (const dir of [...cueDirs].reverse()) {
    const p = cueFileIn(dir, name);
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '雨衣ちゃんのデバッグルーム',
    webPreferences: {
      preload: path.join(__dirname, 'editor-preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(projectRoot, 'dist', 'renderer', 'editor.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('editor:get-init', () => ({
  psdAvailable: findPsd(assetsDirs) !== null,
  lipSync: config.lipSync ?? null,
}));

ipcMain.handle('editor:read-psd', (): Uint8Array | null => {
  const psd = findPsd(assetsDirs);
  return psd ? fs.readFileSync(psd) : null;
});

ipcMain.handle('editor:list-cues', (): EditorCueListItem[] => {
  const { cues } = loadCues(cueDirs, cueSchemaPath);
  return Object.entries(cues)
    .filter(([name]) => name !== DEFAULT_CUE_NAME)
    .map(([name, cue]) => ({
      name,
      label: cue.label,
      internal: cue.internal ?? false,
      description: cue.description,
    }))
    .sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name));
});

ipcMain.handle('editor:read-cue', (_ev, name: string): Cue | null => {
  const p = cueExistingPath(name);
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Cue;
  } catch {
    return null;
  }
});

ipcMain.handle('editor:read-default', (): Cue => {
  const p = [...cueDirs]
    .reverse()
    .map((d) => path.join(d, `${DEFAULT_CUE_NAME}.json`))
    .find((f) => fs.existsSync(f));
  if (!p) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Cue;
  } catch {
    return {};
  }
});

ipcMain.handle('editor:write-cue', (_ev, name: string, cue: Cue): EditorWriteResult => {
  const p = cueWritePath(name);
  if (!p) return { ok: false, error: `不正なCue名: "${name}"` };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const err = validateCueObject(cue, cueSchemaPath);
  if (err) return { ok: false, error: `スキーマ検証エラー: ${err}` };
  try {
    fs.writeFileSync(p, `${JSON.stringify(cue, null, 2)}\n`, 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('editor:delete-cue', (_ev, name: string): EditorWriteResult => {
  if (!CUE_NAME_RE.test(name) || name === DEFAULT_CUE_NAME)
    return { ok: false, error: `不正なCue名: "${name}"` };
  const p = cueExistingPath(name);
  if (!p) return { ok: false, error: `存在しません: ${name}` };
  try {
    fs.unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('editor:list-styles', () => (tts ? tts.listStyles() : null));

ipcMain.handle('editor:synthesize', (_ev, text: string, voice: Cue['voice']) =>
  tts ? tts.synthesize(text, voice) : null,
);
