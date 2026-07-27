import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
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
try {
  process.loadEnvFile(path.join(projectRoot, '.env'));
} catch {
  /* no .env — 試し喋り just stays disabled */
}

const configPath = path.join(projectRoot, 'ui-chan.config.json');
const config: MascotConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const assetsDir = path.join(projectRoot, config.assetsDir);
const cuesDir = path.join(projectRoot, config.cuesDir ?? 'cues');
const cueSchemaPath = path.join(projectRoot, 'cue.schema.json');

const tts = config.tts?.enabled ? new VoiSonaTalkClient(config.tts) : null;

const CUE_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** Resolve `<name>.json` inside cuesDir, rejecting bad names / path escapes. */
function cueFilePath(name: string): string | null {
  if (!CUE_NAME_RE.test(name) || name === DEFAULT_CUE_NAME) return null;
  const p = path.join(cuesDir, `${name}.json`);
  if (p !== path.join(cuesDir, path.basename(p)) || !p.startsWith(cuesDir + path.sep)) return null;
  return p;
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
  psdAvailable: findPsd(assetsDir) !== null,
  lipSync: config.lipSync ?? null,
}));

ipcMain.handle('editor:read-psd', (): Uint8Array | null => {
  const psd = findPsd(assetsDir);
  return psd ? fs.readFileSync(psd) : null;
});

ipcMain.handle('editor:list-cues', (): EditorCueListItem[] => {
  const { cues } = loadCues(cuesDir, cueSchemaPath);
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
  const p = cueFilePath(name);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Cue;
  } catch {
    return null;
  }
});

ipcMain.handle('editor:read-default', (): Cue => {
  const p = path.join(cuesDir, `${DEFAULT_CUE_NAME}.json`);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Cue;
  } catch {
    return {};
  }
});

ipcMain.handle('editor:write-cue', (_ev, name: string, cue: Cue): EditorWriteResult => {
  const p = cueFilePath(name);
  if (!p) return { ok: false, error: `不正なCue名: "${name}"` };
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
  const p = cueFilePath(name);
  if (!p) return { ok: false, error: `不正なCue名: "${name}"` };
  if (!fs.existsSync(p)) return { ok: false, error: `存在しません: ${name}` };
  try {
    fs.unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// CueSequence names (IdlingCues + FidgetCues) whose steps reference this
// cue — a delete-safety warning so removing a cue used by a sequence doesn't
// silently break it.
ipcMain.handle('editor:cue-refs', (_ev, name: string): string[] => {
  const pools: { label: string; items?: { name?: string; steps?: { cue?: string }[] }[] }[] = [
    { label: 'idling', items: config.idle?.idlingCues?.items },
    { label: 'poke', items: config.interactions?.poke },
  ];
  const refs: string[] = [];
  for (const { label, items } of pools) {
    (items ?? []).forEach((item, i) => {
      if ((item.steps ?? []).some((s) => s.cue === name)) {
        refs.push(`${label}:${item.name ?? `#${i}`}`);
      }
    });
  }
  return refs;
});

ipcMain.handle('editor:list-styles', () => (tts ? tts.listStyles() : null));

ipcMain.handle('editor:synthesize', (_ev, text: string, voice: Cue['voice']) =>
  tts ? tts.synthesizeWithVoice(text, voice) : null,
);
