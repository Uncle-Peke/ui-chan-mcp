import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { loadEnvFiles, resolvePaths } from '../shared/paths';
import type {
  Cue,
  CueSequence,
  Delivery,
  EditorCueListItem,
  EditorSequenceListItem,
  EditorWriteResult,
  EventCueGroup,
  MascotConfig,
} from '../shared/types';
import { DEFAULT_CUE_NAME } from '../shared/types';
import { findPsd } from './assets';
import { loadCues, validateCueObject } from './cues';
import { ttsTextFor } from './prosody';
import {
  isSafeSequenceRel,
  listSequenceFiles,
  sequencePlace,
  validateSequenceObject,
} from './sequences';
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

// 本番（state.ts）と同じ規則で読む：英字・数字を含む行は reading を喋らせる。
ipcMain.handle(
  'editor:synthesize',
  (_ev, text: string, voice: Cue['voice'], delivery?: Delivery, reading?: string) =>
    tts ? tts.synthesize(ttsTextFor(text, reading), voice, delivery) : null,
);

// ---- 固定セリフ（sequences/） ----
//
// 識別子は sequences/ からの相対パス（`event/turn_done/done_ask.json`）。名前
// だけだとイベントをまたいで重複しうるし、置き場所そのものがプールを決めるので。

/** 探す順（後が勝つ）。起動時に固定せず呼ぶたびに作る——エディタで初めて
 *  保存したときに作られた ~/.ui-chan/sequences も、次の一覧から拾えるように。 */
function sequenceRoots(): string[] {
  return [path.join(paths.pkgRoot, 'sequences'), path.join(paths.home, 'sequences')];
}

/** 保存先の実パス。プールを指さない相対パスや、外へ抜けるものは拒否する。 */
function sequenceWritePath(rel: string): string | null {
  return isSafeSequenceRel(rel) ? path.join(paths.sequenceWriteDir, rel) : null;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

ipcMain.handle('editor:list-sequences', (): EditorSequenceListItem[] => {
  const homeDir = path.join(paths.home, 'sequences') + path.sep;
  const out: EditorSequenceListItem[] = [];
  for (const [rel, file] of listSequenceFiles(sequenceRoots())) {
    const where = sequencePlace(rel);
    if (!where) continue;
    // 壊れたファイルも一覧には出す（開いて直せるように）。
    const seq = readJsonFile<Partial<CueSequence>>(file) ?? {};
    const steps = Array.isArray(seq.steps) ? seq.steps : [];
    out.push({
      rel,
      ...where.place,
      name: where.name,
      fromHome: file.startsWith(homeDir),
      weight: seq.weight,
      minAffinity: seq.minAffinity,
      maxAffinity: seq.maxAffinity,
      hours: seq.hours,
      steps: steps.length,
      firstText: steps.find((s) => s.text)?.text,
    });
  }
  return out;
});

ipcMain.handle('editor:read-sequence', (_ev, rel: string): CueSequence | null => {
  if (!isSafeSequenceRel(rel)) return null;
  const file = listSequenceFiles(sequenceRoots()).get(rel);
  return file ? readJsonFile<CueSequence>(file) : null;
});

ipcMain.handle('editor:write-sequence', (_ev, rel: string, seq: unknown): EditorWriteResult => {
  const p = sequenceWritePath(rel);
  if (!p) return { ok: false, error: `不正な置き場所: "${rel}"` };
  const err = validateSequenceObject(seq, paths.sequenceSchemaFile, cueSchemaPath);
  if (err) return { ok: false, error: `スキーマ検証エラー: ${err}` };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(seq, null, 2)}\n`, 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// 消せるのは保存先にある版だけ。npm 版でパッケージ同梱の行を消そうとした
// ときは、パッケージの中には書けないので断る（手元の版を消せば同梱の版に戻る）。
ipcMain.handle('editor:delete-sequence', (_ev, rel: string): EditorWriteResult => {
  const p = sequenceWritePath(rel);
  if (!p) return { ok: false, error: `不正な置き場所: "${rel}"` };
  if (!fs.existsSync(p)) {
    const exists = listSequenceFiles(sequenceRoots()).has(rel);
    return {
      ok: false,
      error: exists ? `${rel} は同梱の版しか無いので消せません` : `存在しません: ${rel}`,
    };
  }
  try {
    fs.unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

/** EventCue の出し方の設定（cooldown・chance）。エディタでは表示だけ。 */
ipcMain.handle(
  'editor:event-settings',
  (): Record<string, EventCueGroup> => config.eventCues?.events ?? {},
);
