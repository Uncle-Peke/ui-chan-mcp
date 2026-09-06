// `ui-chan update` — pull the latest ui-chan and rebuild it.
//
// The install is a git clone (that is the distribution model: the PSD and
// VoiSona can't be packaged, so there is no npm tarball to `npm update`), which
// makes updating exactly three steps: fast-forward, install, build. The value
// here is not the three commands — it's refusing to run them when they would
// destroy something:
//
//   - never on a dirty tree (a developer's work-in-progress is not ours to
//     stash), and never a merge or a rebase: `--ff-only` or nothing.
//   - never on a non-git install, where there is nothing to pull from.
//   - nothing is force-pushed, reset, or checked out over.
//
// Failing with a clear reason is a fine outcome. Silently discarding someone's
// edits is not.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function hasCmd(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

/** `owner/repo`, from the git remote if there is one, else package.json. */
export function repoSlug(pkgRoot) {
  try {
    const url = git(pkgRoot, ['remote', 'get-url', 'origin']);
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* no git, no remote — fall through */
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'));
    const m = String(pkg.repository?.url ?? '').match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* unreadable package.json */
  }
  return null;
}

/** For installs that aren't git clones, the only record of "which version is
 *  this" is the one we write ourselves after each gh-based update. */
const STAMP = '.ui-chan-install.json';

function readStamp(pkgRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgRoot, STAMP), 'utf-8'));
  } catch {
    return null;
  }
}

function writeStamp(pkgRoot, sha, branch) {
  try {
    fs.writeFileSync(
      path.join(pkgRoot, STAMP),
      `${JSON.stringify({ sha, branch, at: new Date().toISOString() }, null, 2)}\n`,
      'utf-8',
    );
  } catch {
    /* read-only install — the update still happened */
  }
}

function ghSha(slug, branch) {
  return execFileSync('gh', ['api', `repos/${slug}/commits/${branch}`, '--jq', '.sha'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  }).trim();
}

function git(pkgRoot, args, opts = {}) {
  return execFileSync('git', ['-C', pkgRoot, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

/**
 * What state is this install in? Never throws — every failure mode is a
 * `reason` the caller can show.
 *
 * `fetch: true` talks to the network (a few hundred ms, or a hang on a bad
 * connection, so callers on a timer should use a timeout).
 */
export function checkUpdate(pkgRoot, { fetch = false, branch } = {}) {
  const isRepo = fs.existsSync(path.join(pkgRoot, '.git'));
  if (!isRepo || !hasCmd('git')) return checkUpdateViaGh(pkgRoot, { isRepo, branch });
  try {
    if (fetch) git(pkgRoot, ['fetch', '--quiet'], { timeout: 20_000 });
    const branch = git(pkgRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    let upstream;
    try {
      upstream = git(pkgRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    } catch {
      return { ok: false, reason: `${branch} に追跡先がありません`, available: false, branch };
    }
    const [behind, ahead] = git(pkgRoot, [
      'rev-list',
      '--left-right',
      '--count',
      `${upstream}...HEAD`,
    ])
      .split(/\s+/)
      .map(Number);
    const dirty = git(pkgRoot, ['status', '--porcelain']).length > 0;
    return {
      ok: true,
      branch,
      upstream,
      behind,
      ahead,
      dirty,
      available: behind > 0,
      // Ahead or dirty means a fast-forward would either be impossible or would
      // run over local work: report, don't touch.
      blocked: dirty ? '変更が未コミットです' : ahead > 0 ? '未 push のコミットがあります' : null,
    };
  } catch (e) {
    return { ok: false, reason: e.message?.split('\n')[0] ?? String(e), available: false };
  }
}

/** The no-git path: ask GitHub what the newest commit is and compare it to the
 *  stamp we wrote last time. Without a stamp we cannot know, so we say so
 *  rather than claiming either answer. */
function checkUpdateViaGh(pkgRoot, { isRepo, branch }) {
  if (!hasCmd('gh')) {
    return {
      ok: false,
      available: false,
      reason: isRepo
        ? 'git が見つかりません（gh もありません）'
        : 'git のクローンでも gh もない環境です',
    };
  }
  const slug = repoSlug(pkgRoot);
  if (!slug) return { ok: false, available: false, reason: 'リポジトリの場所が分かりません' };
  const stampBefore = readStamp(pkgRoot);
  // Which branch: what was asked for, else the one this install came from, else
  // the repo's default. A git clone tracks whatever branch you're on, so the
  // gh path has to be able to follow a feature branch too — the only reason it
  // couldn't was that nothing remembered which branch that was.
  const ref = branch ?? stampBefore?.branch ?? 'HEAD';
  try {
    const remote = ghSha(slug, ref);
    const stamp = stampBefore;
    return {
      ok: true,
      via: 'gh',
      slug,
      branch: ref === 'HEAD' ? (stamp?.branch ?? null) : ref,
      ref,
      remoteSha: remote,
      installedSha: stamp?.sha ?? null,
      // No stamp = a hand-placed copy of unknown vintage. Offering the update
      // is the useful answer; it is idempotent anyway.
      // A branch switch is an update even when the commit is "older": the
      // install is no longer what was asked for.
      available: stamp?.sha !== remote || (branch != null && branch !== stamp?.branch),
      behind: stamp?.sha ? undefined : null,
      blocked: null,
    };
  } catch (e) {
    return { ok: false, available: false, reason: e.message?.split('\n')[0] ?? String(e) };
  }
}

/** The no-git update: download the branch tarball with gh and unpack it over
 *  the install. `tar --strip-components=1` overwrites tracked files and leaves
 *  everything else (node_modules, and anything the user added) alone — the
 *  user's real data lives in ~/.ui-chan and is nowhere near this. */
async function runUpdateViaGh(pkgRoot, log, branch) {
  const status = checkUpdateViaGh(pkgRoot, {
    isRepo: fs.existsSync(path.join(pkgRoot, '.git')),
    branch,
  });
  if (!status.ok) return { ok: false, reason: status.reason };
  if (!status.available) return { ok: true, updated: false, reason: '最新です' };
  if (!hasCmd('tar')) return { ok: false, reason: 'tar が見つかりません' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-chan-update-'));
  const tgz = path.join(tmp, 'src.tar.gz');
  try {
    log(`更新を取得: ${status.slug}${status.branch ? `#${status.branch}` : ''} (gh)`);
    const out = fs.openSync(tgz, 'w');
    const tarPath =
      status.ref === 'HEAD'
        ? `repos/${status.slug}/tarball`
        : `repos/${status.slug}/tarball/${status.ref}`;
    const res = spawnSync('gh', ['api', tarPath], {
      stdio: ['ignore', out, 'pipe'],
      timeout: 120_000,
    });
    fs.closeSync(out);
    if (res.status !== 0) {
      return { ok: false, reason: `ダウンロードに失敗しました: ${res.stderr?.toString().trim()}` };
    }
    log('展開中');
    await run('tar', ['-xzf', tgz, '--strip-components=1', '-C', pkgRoot], { timeout: 120_000 });
    log('依存を更新中 (npm install)');
    await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: pkgRoot, timeout: 600_000 });
    log('ビルド中 (npm run build)');
    await run('npm', ['run', 'build'], { cwd: pkgRoot, timeout: 600_000 });
    writeStamp(pkgRoot, status.remoteSha, status.branch ?? null);
    return {
      ok: true,
      updated: true,
      from: status.installedSha?.slice(0, 7) ?? '(不明)',
      to: status.remoteSha.slice(0, 7),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Fast-forward, install, build. `log` receives progress lines.
 * Returns { ok, updated, from, to, reason? }.
 */
export async function runUpdate(pkgRoot, { log = () => {}, branch } = {}) {
  // git if this is a clone and git exists; otherwise gh. Either one is enough.
  if (!fs.existsSync(path.join(pkgRoot, '.git')) || !hasCmd('git')) {
    return runUpdateViaGh(pkgRoot, log, branch);
  }
  // The git path never needed a branch argument: it fast-forwards whatever the
  // current branch tracks, so checking out a feature branch is how you follow
  // it. `--branch` on a clone would mean switching branches, which is a
  // checkout — the user's call, not an updater's.
  if (branch) {
    const current = git(pkgRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== current) {
      return {
        ok: false,
        reason: `いまは ${current} です。--branch は git クローンでは使えません（\`git switch ${branch}\` してから更新してください）`,
      };
    }
  }
  const status = checkUpdate(pkgRoot, { fetch: true });
  if (!status.ok) return { ok: false, reason: status.reason };
  if (status.blocked) return { ok: false, reason: status.blocked };
  if (!status.available) {
    return { ok: true, updated: false, from: null, to: null, reason: '最新です' };
  }

  const from = git(pkgRoot, ['rev-parse', '--short', 'HEAD']);
  log(`更新を取得: ${status.upstream} (${status.behind} コミット)`);
  await run('git', ['-C', pkgRoot, 'merge', '--ff-only', status.upstream], { timeout: 60_000 });
  const to = git(pkgRoot, ['rev-parse', '--short', 'HEAD']);

  log('依存を更新中 (npm install)');
  await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: pkgRoot, timeout: 600_000 });
  log('ビルド中 (npm run build)');
  await run('npm', ['run', 'build'], { cwd: pkgRoot, timeout: 600_000 });

  return { ok: true, updated: true, from, to };
}
