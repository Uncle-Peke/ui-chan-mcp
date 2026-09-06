// The user-data half of an install: `~/.ui-chan` (or `$UI_CHAN_HOME`).
//
// Everything here survives updates and uninstalls of the package, which is the
// whole point — PSD (licensed, never in the package), TTS credentials, and any
// cue / persona / context override the user has authored.
//
//   ~/.ui-chan/
//     .env         TTS credentials
//     config.json  overrides, deep-merged over the packaged ui-chan.config.json
//     assets/      the mascot PSD
//     cues/        extra or overriding cues (same filename = override)
//     persona/, context/   optional persona overrides
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function homeDir() {
  return process.env.UI_CHAN_HOME ?? path.join(os.homedir(), '.ui-chan');
}

export const SUBDIRS = ['assets', 'cues', 'persona', 'context'];

export function ensureHome() {
  const home = homeDir();
  const created = !fs.existsSync(home);
  for (const d of ['', ...SUBDIRS]) fs.mkdirSync(path.join(home, d), { recursive: true });

  const envFile = path.join(home, '.env');
  if (!fs.existsSync(envFile)) {
    fs.writeFileSync(
      envFile,
      [
        '# VoiSona Talk の資格情報。ここに書いた値は ui-chan の全クライアントで共有されます。',
        '# （環境変数が設定されていればそちらが優先されます）',
        'UI_CHAN_TTS_USERNAME=',
        'UI_CHAN_TTS_PASSWORD=',
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  const configFile = path.join(home, 'config.json');
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      `${JSON.stringify(
        {
          _comment:
            'パッケージ同梱の ui-chan.config.json に深いマージで上書きされます。変えたいキーだけ書いてください。',
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
  }
  return { home, created };
}

export function hasPsd() {
  const dir = path.join(homeDir(), 'assets');
  try {
    return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.psd'));
  } catch {
    return false;
  }
}

/** Copy a PSD into the home assets dir (the file the user bought stays put). */
export function importPsd(src) {
  const file = path.resolve(src.replace(/^~(?=$|\/)/, os.homedir()).trim());
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  if (!file.toLowerCase().endsWith('.psd')) throw new Error('PSD ファイルを指定してください');
  const dest = path.join(homeDir(), 'assets', path.basename(file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  return dest;
}

export function readEnvFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(homeDir(), '.env'), 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* no .env yet */
  }
  return out;
}

export function writeCredentials(username, password) {
  const file = path.join(homeDir(), '.env');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n') : [];
  const set = (key, value) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  };
  set('UI_CHAN_TTS_USERNAME', username);
  set('UI_CHAN_TTS_PASSWORD', password);
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  return file;
}

/** Migrate a pre-0.4 layout (credentials and PSD inside the install dir) into
 *  the home dir. Returns what it moved, so the CLI can say so out loud. */
export function migrateFrom(pkgRoot) {
  const moved = [];
  const home = homeDir();
  const legacyEnv = path.join(pkgRoot, '.env');
  if (fs.existsSync(legacyEnv) && !readEnvFile().UI_CHAN_TTS_USERNAME) {
    fs.copyFileSync(legacyEnv, path.join(home, '.env'));
    moved.push('.env');
  }
  const legacyAssets = path.join(pkgRoot, 'assets');
  if (!hasPsd() && fs.existsSync(legacyAssets)) {
    for (const f of fs.readdirSync(legacyAssets).filter((f) => f.toLowerCase().endsWith('.psd'))) {
      fs.copyFileSync(path.join(legacyAssets, f), path.join(home, 'assets', f));
      moved.push(`assets/${f}`);
    }
  }
  return moved;
}
