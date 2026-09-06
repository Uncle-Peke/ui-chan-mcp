// The client registry: everything that differs between MCP hosts, in one table.
//
// Adding support for a new agent (Hermes, another editor, …) should be adding
// one entry here — never a new install script. Every entry answers the same
// four questions: where is its config, how does an stdio server look in it, how
// do I put ui-chan in, how do I take it out.
//
// The server command itself is client-independent: an absolute path to
// `bin/ui-chan-node` (which finds a node even under launchd's minimal PATH)
// plus `dist/mcp-server.js`. That keeps GUI-launched clients working without
// each entry re-solving the PATH problem.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SERVER_NAME = 'ui-chan';

export function serverCommand(pkgRoot) {
  return {
    command: path.join(pkgRoot, 'bin', 'ui-chan-node'),
    args: [path.join(pkgRoot, 'dist', 'mcp-server.js')],
  };
}

const home = os.homedir();
const XDG = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');

function desktopConfigPath() {
  if (process.platform === 'darwin')
    return path.join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? home, 'Claude', 'claude_desktop_config.json');
  return path.join(XDG, 'Claude', 'claude_desktop_config.json');
}

function vscodeConfigPath() {
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? home, 'Code', 'User', 'mcp.json');
  return path.join(XDG, 'Code', 'User', 'mcp.json');
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} を読めません（JSONが壊れている可能性）: ${e.message}`);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** A host whose MCP servers live under one key of one JSON file.
 *  `extras` lets an entry carry more than the server registration — OpenCode
 *  also gets an EventCue plugin, in the same file and the same write. */
function jsonClient({ id, label, file, key, entry, seed, note, unverified, extras }) {
  return {
    id,
    label,
    note,
    unverified,
    configPath: () => file(),
    status() {
      const f = file();
      if (!fs.existsSync(f)) return { installed: false, detail: `未作成: ${f}` };
      const cur = readJson(f)[key]?.[SERVER_NAME];
      // `target` is which copy of ui-chan the entry points at. With an npm
      // install and a clone on the same machine, that is the only thing that
      // says which one actually runs.
      const cmd = Array.isArray(cur?.command) ? cur.command[0] : cur?.command;
      return { installed: Boolean(cur), detail: f, target: cmd ?? null };
    },
    snippet(cmd, pkgRoot) {
      const doc = { [key]: { [SERVER_NAME]: entry(cmd) } };
      return JSON.stringify(extras ? extras.snippet(doc, pkgRoot) : doc, null, 2);
    },
    install(cmd, pkgRoot) {
      const f = file();
      const data = { ...seed, ...readJson(f) };
      data[key] = { ...(data[key] ?? {}), [SERVER_NAME]: entry(cmd) };
      extras?.install(data, pkgRoot);
      writeJson(f, data);
      return f;
    },
    uninstall(_cmd, pkgRoot) {
      const f = file();
      if (!fs.existsSync(f)) return null;
      const data = readJson(f);
      const had = Boolean(data[key]?.[SERVER_NAME]);
      const removedExtra = extras?.uninstall(data, pkgRoot) ?? false;
      if (!had && !removedExtra) return null;
      if (had) delete data[key][SERVER_NAME];
      writeJson(f, data);
      return f;
    },
  };
}

/** OpenCode's `plugin` array, carrying the EventCue plugin (plugins/opencode/
 *  ui-chan.js) as a `file://` entry. This is what gives OpenCode the reactions
 *  the Claude Code plugin's hooks provide — the plugin only names the event,
 *  the app still owns every line. */
const opencodePlugin = {
  path: (pkgRoot) => `file://${path.join(pkgRoot, 'plugins', 'opencode', 'ui-chan.mjs')}`,
  snippet(doc, pkgRoot) {
    return { ...doc, plugin: [this.path(pkgRoot)] };
  },
  install(data, pkgRoot) {
    const p = this.path(pkgRoot);
    const list = (Array.isArray(data.plugin) ? data.plugin : []).filter(
      (x) => !String(x).includes('/plugins/opencode/ui-chan.mjs'),
    );
    data.plugin = [...list, p];
  },
  uninstall(data) {
    if (!Array.isArray(data.plugin)) return false;
    const next = data.plugin.filter((x) => !String(x).includes('/plugins/opencode/ui-chan.mjs'));
    const changed = next.length !== data.plugin.length;
    data.plugin = next;
    return changed;
  },
};

function hasClaudeCli() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Claude Code: driven through its own CLI so the registration lands wherever
 *  the current version keeps user-scoped servers, instead of us guessing a file. */
const claudeCode = {
  id: 'claude-code',
  label: 'Claude Code (MCPサーバ)',
  configPath: () => 'claude mcp（user スコープ）',
  status() {
    if (!hasClaudeCli()) return { installed: false, detail: 'claude CLI が見つかりません' };
    try {
      const out = execFileSync('claude', ['mcp', 'get', SERVER_NAME], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(/Command:\s*(\S+)/);
      return { installed: out.includes(SERVER_NAME), detail: 'claude mcp', target: m?.[1] ?? null };
    } catch {
      return { installed: false, detail: 'claude mcp' };
    }
  },
  snippet(cmd) {
    return `claude mcp add ${SERVER_NAME} -s user -- ${cmd.command} ${cmd.args.join(' ')}`;
  },
  install(cmd) {
    if (!hasClaudeCli()) throw new Error('claude CLI が見つかりません');
    try {
      execFileSync('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user'], { stdio: 'ignore' });
    } catch {
      /* not registered yet */
    }
    execFileSync(
      'claude',
      ['mcp', 'add', SERVER_NAME, '-s', 'user', '--', cmd.command, ...cmd.args],
      { stdio: 'ignore' },
    );
    return 'claude mcp (user)';
  },
  uninstall() {
    if (!hasClaudeCli()) return null;
    try {
      execFileSync('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user'], { stdio: 'ignore' });
      return 'claude mcp (user)';
    } catch {
      return null;
    }
  },
};

/** Claude Code plugin: skills / subagents / EventCue hooks. Separate from the
 *  MCP registration above because they are genuinely separate features — the
 *  plugin without the connector still gives Desktop its skills, and the
 *  connector without the plugin still gives any client the tools + persona. */
const claudeCodePlugin = {
  id: 'claude-code-plugin',
  label: 'Claude Code プラグイン（/talk /mode などのスキル・フック）',
  configPath: () => '~/.claude/plugins',
  status() {
    const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    if (!fs.existsSync(file)) return { installed: false, detail: '未インストール' };
    const data = readJson(file);
    const entry = data.plugins?.['ui-chan@ui-chan']?.[0];
    let target = entry?.installPath ?? null;
    try {
      // The install path is a symlink to the copy that owns the plugin.
      if (target && fs.lstatSync(target).isSymbolicLink()) target = fs.realpathSync(target);
    } catch {
      /* stale entry */
    }
    return { installed: Boolean(entry), detail: file, target };
  },
  snippet(_cmd, pkgRoot) {
    return [
      `claude plugin marketplace add ${pkgRoot}`,
      'claude plugin install ui-chan@ui-chan',
    ].join('\n');
  },
  install(_cmd, pkgRoot) {
    if (!hasClaudeCli()) throw new Error('claude CLI が見つかりません');
    execFileSync('claude', ['plugin', 'marketplace', 'add', pkgRoot], { stdio: 'ignore' });
    execFileSync('claude', ['plugin', 'install', `${SERVER_NAME}@${SERVER_NAME}`], {
      stdio: 'ignore',
    });
    // `plugin install` copies the plugin into the cache; replace that copy with
    // a link to this install so an update here is an update there too.
    const cacheDir = path.join(home, '.claude', 'plugins', 'cache', SERVER_NAME, SERVER_NAME);
    try {
      for (const v of fs.readdirSync(cacheDir)) {
        const p = path.join(cacheDir, v);
        if (fs.lstatSync(p).isSymbolicLink()) continue;
        fs.rmSync(p, { recursive: true, force: true });
        fs.symlinkSync(pkgRoot, p);
      }
    } catch {
      /* cache layout changed — the copy still works, it just won't auto-update */
    }
    return '~/.claude/plugins';
  },
  uninstall() {
    if (!hasClaudeCli()) return null;
    let touched = null;
    for (const argv of [
      ['plugin', 'uninstall', `${SERVER_NAME}@${SERVER_NAME}`],
      ['plugin', 'marketplace', 'remove', SERVER_NAME],
    ]) {
      try {
        execFileSync('claude', argv, { stdio: 'ignore' });
        touched = '~/.claude/plugins';
      } catch {
        /* not installed */
      }
    }
    fs.rmSync(path.join(home, '.claude', 'plugins', 'cache', SERVER_NAME), {
      recursive: true,
      force: true,
    });
    return touched;
  },
};

/** Hermes Agent (Nous Research). Two differences from every other host:
 *  its config is YAML (`~/.hermes/config.yaml`, `mcp_servers:`), and its plugin
 *  surface is Python (`~/.hermes/plugins/<name>/`), so the EventCue plugin is
 *  installed as a directory rather than a config line.
 *
 *  The YAML is edited line-wise instead of parsed and re-serialised: a real
 *  round-trip would need a YAML dependency and would rewrite the user's
 *  comments and formatting. This touches only ui-chan's own block. */
function hermesHome() {
  return process.env.HERMES_HOME ?? path.join(home, '.hermes');
}

function hermesConfigFile() {
  return process.env.UI_CHAN_HERMES_CONFIG ?? path.join(hermesHome(), 'config.yaml');
}

const HERMES_BEGIN = '  # >>> ui-chan (managed by `ui-chan install hermes`)';
const HERMES_END = '  # <<< ui-chan';

function hermesBlock(cmd) {
  return [
    HERMES_BEGIN,
    `  ${SERVER_NAME}:`,
    `    command: "${cmd.command}"`,
    `    args: [${cmd.args.map((a) => `"${a}"`).join(', ')}]`,
    HERMES_END,
  ].join('\n');
}

/** Strip a previously written block, so install is idempotent and uninstall is
 *  exact. Returns [remaining lines, whether anything was removed]. */
function stripHermesBlock(text) {
  const lines = text.split('\n');
  const start = lines.indexOf(HERMES_BEGIN);
  if (start < 0) return [lines, false];
  const end = lines.indexOf(HERMES_END, start);
  if (end < 0) return [lines, false];
  lines.splice(start, end - start + 1);
  return [lines, true];
}

const hermesPluginDir = () => path.join(hermesHome(), 'plugins', SERVER_NAME);

const hermes = {
  id: 'hermes',
  label: 'Hermes Agent',
  note: '設定は ~/.hermes/config.yaml（HERMES_HOME / UI_CHAN_HERMES_CONFIG で変更可）。EventCue プラグインも同時に置きます。',
  configPath: () => hermesConfigFile(),
  status() {
    const f = hermesConfigFile();
    if (!fs.existsSync(f)) return { installed: false, detail: `未作成: ${f}` };
    const text = fs.readFileSync(f, 'utf-8');
    const installed = text.includes(`  ${SERVER_NAME}:`);
    const m = text.match(/^\s*command:\s*"?([^"\n]+)"?/m);
    return { installed, detail: f, target: installed ? (m?.[1] ?? null) : null };
  },
  snippet(cmd) {
    return `# ${hermesConfigFile()}\nmcp_servers:\n${hermesBlock(cmd)}`;
  },
  install(cmd, pkgRoot) {
    const f = hermesConfigFile();
    const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
    const [lines] = stripHermesBlock(text);
    const at = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
    if (at >= 0) {
      lines.splice(at + 1, 0, hermesBlock(cmd));
    } else {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
      lines.push('mcp_servers:', hermesBlock(cmd), '');
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak`);
    fs.writeFileSync(f, lines.join('\n'), 'utf-8');

    // The Python plugin needs to know where ui-chan lives; bake the path in.
    const src = path.join(pkgRoot, 'plugins', 'hermes', SERVER_NAME);
    const dest = hermesPluginDir();
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const body = fs
        .readFileSync(path.join(src, name), 'utf-8')
        .replaceAll('@@UI_CHAN_ROOT@@', pkgRoot);
      fs.writeFileSync(path.join(dest, name), body, 'utf-8');
    }
    return `${f} + ${dest}`;
  },
  uninstall() {
    const f = hermesConfigFile();
    let touched = null;
    if (fs.existsSync(f)) {
      const [lines, removed] = stripHermesBlock(fs.readFileSync(f, 'utf-8'));
      if (removed) {
        fs.copyFileSync(f, `${f}.bak`);
        fs.writeFileSync(f, lines.join('\n'), 'utf-8');
        touched = f;
      }
    }
    const dir = hermesPluginDir();
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      touched = touched ? `${touched} + ${dir}` : dir;
    }
    return touched;
  },
};

export const CLIENTS = [
  claudeCode,
  claudeCodePlugin,
  jsonClient({
    id: 'claude-desktop',
    label: 'Claude Desktop',
    file: desktopConfigPath,
    key: 'mcpServers',
    entry: (c) => ({ command: c.command, args: c.args }),
    note: '登録後は ⌘Q で完全終了してから再起動してください。',
  }),
  jsonClient({
    id: 'opencode',
    label: 'OpenCode',
    file: () => process.env.UI_CHAN_OPENCODE_CONFIG ?? path.join(XDG, 'opencode', 'opencode.json'),
    key: 'mcp',
    seed: { $schema: 'https://opencode.ai/config.json' },
    entry: (c) => ({ type: 'local', command: [c.command, ...c.args], enabled: true }),
    extras: opencodePlugin,
    note: 'EventCue プラグイン（作業への自動リアクション）も同時に登録されます。',
  }),
  jsonClient({
    id: 'cursor',
    label: 'Cursor',
    file: () => path.join(home, '.cursor', 'mcp.json'),
    key: 'mcpServers',
    entry: (c) => ({ command: c.command, args: c.args }),
  }),
  jsonClient({
    id: 'vscode',
    label: 'VS Code (Copilot Chat)',
    file: vscodeConfigPath,
    key: 'servers',
    entry: (c) => ({ type: 'stdio', command: c.command, args: c.args }),
  }),
  hermes,
];

export function findClient(id) {
  return CLIENTS.find((c) => c.id === id) ?? null;
}
