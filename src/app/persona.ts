// The single implementation of "what the character is", as text an AI can read:
// persona/ui-chan.md + context/*.md + a Cue catalog generated from cues/.
//
// It lives here, in compiled code, because three different callers need exactly
// the same bytes and used to build them separately:
//   - the MCP server, which ships it as the handshake `instructions` (so any
//     client — Claude Desktop included — gets the character with the tools) and
//     as the `persona` prompt (manual reload after editing the files)
//   - the SessionStart hook, for clients that don't use `instructions`
//   - anything added later that has to hand the character to a model
//
// Keeping one copy is what makes "edit the Markdown, restart, done" true: a
// second implementation drifts, and the drift is invisible until the mascot
// behaves differently depending on which door the persona came through.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Cue, MascotConfig } from '../shared/types';
import { DEFAULT_CUE_NAME } from '../shared/types';
import { loadCues } from './cues';

/** Order the taxonomy sections so the catalog reads as layers, not a flat list. */
const CUE_GROUP_ORDER = ['emo', 'mix', 'self', 'sys', 'pose'];
const CUE_GROUP_TITLE: Record<string, string> = {
  emo: '基本感情 `emo_<系統>_<lo|無印|hi>`（喜/信頼/恐/驚/悲/嫌悪/怒/期待 × 強度）',
  mix: 'ブレンド `mix_<感情A>_<感情B>`（隣接2感情の混合。名前が構成を表す）',
  self: '自己意識 `self_<感情>`（照れ/恥/罪悪感/誇り）',
  sys: 'システム `sys_<機能>`（状態・進行・特殊）',
  pose: 'ポーズ `pose_<型>`（感情に腕ポーズを重ねた変種）',
};

/** The AI-facing Cue catalog, generated fresh from `cues/` on every call — so
 *  adding a Cue file can never leave a hand-written list out of date. Cues
 *  marked `internal: true` are excluded: they're IdlingCue building blocks
 *  (state.ts), not expressions to pick with set_cue. */
export function buildCueCatalog(projectRoot: string, config: MascotConfig): string {
  const cuesDir = path.join(projectRoot, config.cuesDir ?? 'cues');
  const cueSchemaPath = path.join(projectRoot, 'cue.schema.json');
  const { cues, errors } = loadCues(cuesDir, cueSchemaPath);

  const groups = new Map<string, [string, Cue][]>();
  for (const [name, cue] of Object.entries(cues)) {
    if (cue.internal || name === DEFAULT_CUE_NAME) continue;
    const g = name.split('_')[0];
    const list = groups.get(g) ?? [];
    list.push([name, cue]);
    groups.set(g, list);
  }
  const keys = [
    ...CUE_GROUP_ORDER.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !CUE_GROUP_ORDER.includes(k)).sort(),
  ];
  const sections = keys.map((k) => {
    const lines = (groups.get(k) ?? [])
      .sort(([a], [b]) => a.localeCompare(b)) // by name, not the label-suffixed line
      .map(
        ([name, cue]) =>
          `- \`${name}\`${cue.label ? `（${cue.label}）` : ''}${cue.description ? ` — ${cue.description}` : ''}`,
      );
    return `### ${CUE_GROUP_TITLE[k] ?? k}\n${lines.join('\n')}`;
  });
  const warning = errors.length > 0 ? `\n\n(cue読み込みエラー: ${errors.join('; ')})` : '';
  return (
    '## 利用可能なCue一覧（set_cueのcue引数。cues/から自動生成）\n\n' +
    'Cue名は構造的：接頭辞が層（emo=基本感情 / mix=ブレンド / self=自己意識 / sys=システム / pose=ポーズ）、' +
    '強度は `_lo`(弱)/無印/`_hi`(強)。系統から辿って選ぶ。\n\n' +
    `${sections.join('\n\n')}${warning}`
  );
}

/** persona file + every `context/*.md` in filename order + the Cue catalog.
 *  Missing pieces degrade to a note rather than throwing: a half-formed persona
 *  is far better than a mascot that refuses to start. */
export function buildPersonaText(projectRoot: string, config: MascotConfig): string {
  const parts: string[] = [];

  const personaPath = path.join(projectRoot, config.personaFile ?? 'persona/ui-chan.md');
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
    /* no context dir — persona file alone still works */
  }

  try {
    parts.push(buildCueCatalog(projectRoot, config));
  } catch (e) {
    parts.push(`Cue一覧の生成に失敗しました: ${e instanceof Error ? e.message : e}`);
  }

  return parts.join('\n\n---\n\n');
}
