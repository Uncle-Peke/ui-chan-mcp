// Where ui-chan's files live — the one module that answers "package or user?".
//
// Everything ships twice: the package carries defaults (config, cues, persona,
// context) and the user may carry overrides in a **home directory**
// (`UI_CHAN_HOME`, default `~/.ui-chan`). The package half is read-only and
// replaced wholesale on every update; the home half is never touched by an
// update. That split is what makes `npm update` / a fresh install safe — before
// it, a user's PSD, `.env` and hand-authored cues sat inside the install
// directory and died with it (see the plugin-cache incident in the README).
//
// Resolution is per-resource, not all-or-nothing:
//   config   home/config.json deep-merged **over** the packaged defaults, so a
//            user file with three keys keeps inheriting everything added later.
//   cues     both dirs load, home wins on same name — add a cue without
//            copying the catalog.
//   context  same (filename-keyed).
//   persona  home file if present, else packaged.
//   assets   home first, then packaged (PSD is licensed, so usually home-only).
//   .env     home first, then package (env vars still win over both).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MascotConfig } from './types';

export interface UiChanPaths {
  /** Root of the installed package (or the git clone in dev). Read-only. */
  pkgRoot: string;
  /** User data dir. May not exist — every lookup degrades to the package. */
  home: string;
  homeExists: boolean;
  /** Config actually in effect (merged), plus where the override would go. */
  config: MascotConfig;
  configFile: string;
  /** Cue dirs in load order (later wins). */
  cueDirs: string[];
  /** Where a newly saved cue is written (the last existing dir above). */
  cueWriteDir: string;
  cueSchemaFile: string;
  /** Asset dirs in search order. */
  assetsDirs: string[];
  personaFile: string;
  contextDirs: string[];
}

export function uiChanHome(): string {
  return process.env.UI_CHAN_HOME ?? path.join(os.homedir(), '.ui-chan');
}

/** `.env` files, lowest precedence first. Loaded, never overwriting real env
 *  vars — `loadEnvFile` leaves already-set variables alone. */
export function loadEnvFiles(pkgRoot: string): string[] {
  const loaded: string[] = [];
  for (const file of [path.join(pkgRoot, '.env'), path.join(uiChanHome(), '.env')]) {
    try {
      process.loadEnvFile(file);
      loaded.push(file);
    } catch {
      /* absent or unreadable — credentials can still come from the environment */
    }
  }
  return loaded;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge for config only: objects merge key-wise, arrays and scalars are
 *  replaced outright (a user's `idlingCues` list means "this list", not "append
 *  to the packaged one"). */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function existingDirs(dirs: string[]): string[] {
  return dirs.filter((d) => fs.existsSync(d));
}

/**
 * Resolve every path ui-chan reads, given the package root.
 * `pkgRoot` is `dist/..` for the MCP server and `dist/../..` for the Electron
 * app — both callers pass their own, this module never guesses.
 */
export function resolvePaths(pkgRoot: string): UiChanPaths {
  const home = uiChanHome();
  const homeExists = fs.existsSync(home);

  const packaged = (readJson(path.join(pkgRoot, 'ui-chan.config.json')) ?? {}) as MascotConfig;
  const configFile = path.join(home, 'config.json');
  const override = homeExists ? readJson(configFile) : null;
  const config = override ? deepMerge(packaged, override) : packaged;

  const cueDirs = existingDirs([
    path.join(pkgRoot, config.cuesDir ?? 'cues'),
    path.join(home, 'cues'),
  ]);
  const homePersona = path.join(home, 'persona', 'ui-chan.md');

  return {
    pkgRoot,
    home,
    homeExists,
    config,
    configFile,
    cueDirs,
    // Last existing dir wins: with a home dir set up, edits land in the user's
    // data; in a bare git clone (no home), they land in the repo where the
    // author expects them.
    cueWriteDir: cueDirs[cueDirs.length - 1] ?? path.join(pkgRoot, config.cuesDir ?? 'cues'),
    cueSchemaFile: path.join(pkgRoot, 'cue.schema.json'),
    assetsDirs: existingDirs([
      path.join(home, config.assetsDir ?? 'assets'),
      path.join(pkgRoot, config.assetsDir ?? 'assets'),
    ]),
    personaFile: fs.existsSync(homePersona)
      ? homePersona
      : path.join(pkgRoot, config.personaFile ?? 'persona/ui-chan.md'),
    contextDirs: existingDirs([path.join(pkgRoot, 'context'), path.join(home, 'context')]),
  };
}
