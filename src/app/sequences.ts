import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Cue, CueSequence, Delivery, Look, SequenceStep } from '../shared/types';

/**
 * 固定セリフ（IdlingCue / EventCue / FidgetCue）の読み込み。
 *
 * 1ファイル=1シーケンスで、**ディレクトリがプールを決める**：
 *
 *   sequences/idling/<name>.json         IdlingCue
 *   sequences/presence/away.json         席を外したとき（systemIdle の awayCue）
 *   sequences/presence/wake.json         戻ってきたとき（wakeCue）
 *   sequences/fidget/poke/<name>.json    つつかれたとき
 *   sequences/fidget/spam/<name>.json    何度もつつかれたとき
 *   sequences/event/<event>/<name>.json  EventCue
 *
 * パッケージと home（~/.ui-chan/sequences）の両方から読み、**同じ相対パスなら
 * home が勝つ**——cues/ と同じ規則。以前は config.json の配列に入っていたが、
 * home 側の上書きは配列を丸ごと差し替えるので、1行いじっただけでその一群が
 * 以後パッケージの更新から切り離されていた。ファイル単位なら、いじった
 * ファイルだけが手元の版になる。
 */
export interface SequenceSet {
  idling: CueSequence[];
  away?: CueSequence;
  wake?: CueSequence;
  poke: CueSequence[];
  spam: CueSequence[];
  events: Record<string, CueSequence[]>;
  errors: string[];
  /** 旧形式（config の配列）から取ったプール。空でなければ移行を促す。 */
  legacyPools: string[];
}

type Place =
  | { pool: 'idling' | 'poke' | 'spam' | 'away' | 'wake' }
  | { pool: 'event'; event: string };

/** 相対パス（`/` 区切り）→ どのプールの、何という名前のシーケンスか。 */
function placeOf(rel: string): { place: Place; name: string } | null {
  const parts = rel.replace(/\.json$/, '').split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  if (dir === 'idling') return { place: { pool: 'idling' }, name };
  if (dir === 'presence' && (name === 'away' || name === 'wake'))
    return { place: { pool: name }, name };
  if (dir === 'fidget/poke') return { place: { pool: 'poke' }, name };
  if (dir === 'fidget/spam') return { place: { pool: 'spam' }, name };
  if (parts.length === 3 && parts[0] === 'event')
    return { place: { pool: 'event', event: parts[1] }, name };
  return null;
}

function listJson(root: string, rel = ''): string[] {
  const out: string[] = [];
  const entries = fs
    .readdirSync(path.join(root, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listJson(root, r));
    else if (ent.name.endsWith('.json')) out.push(r);
  }
  return out;
}

let validator: ValidateFunction | null = null;

function getValidator(schemaFile: string, cueSchemaFile: string): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    // 見た目の各項目は cue.schema.json を $ref で引く——定義を二重に持たない。
    ajv.addSchema(JSON.parse(fs.readFileSync(cueSchemaFile, 'utf-8')));
    validator = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf-8')));
  }
  return validator;
}

function describeErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

/** 1シーケンス分のオブジェクトを検証する（エディタが書き込む前に使う）。 */
export function validateSequenceObject(
  obj: unknown,
  schemaFile: string,
  cueSchemaFile: string,
): string | null {
  const validate = getValidator(schemaFile, cueSchemaFile);
  return validate(obj) ? null : describeErrors(validate);
}

export function emptySequenceSet(): SequenceSet {
  return { idling: [], poke: [], spam: [], events: {}, errors: [], legacyPools: [] };
}

function place(set: SequenceSet, where: Place, seq: CueSequence): void {
  if (where.pool === 'event') set.events[where.event] = [...(set.events[where.event] ?? []), seq];
  else if (where.pool === 'away' || where.pool === 'wake') set[where.pool] = seq;
  else set[where.pool].push(seq);
}

export function loadSequences(
  dirs: string[],
  schemaFile: string,
  cueSchemaFile: string,
): SequenceSet {
  const set = emptySequenceSet();
  const validate = getValidator(schemaFile, cueSchemaFile);
  // 相対パス → 実ファイル。後のディレクトリが勝つ。
  const winners = new Map<string, string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rel of listJson(dir)) winners.set(rel, path.join(dir, rel));
  }
  for (const [rel, file] of [...winners].sort(([a], [b]) => a.localeCompare(b))) {
    const where = placeOf(rel);
    if (!where) {
      set.errors.push(`${rel}: 置き場所が不明（sequences/ の構成は src/app/sequences.ts を参照）`);
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!validate(raw)) {
        set.errors.push(`${rel}: ${describeErrors(validate)}`);
        continue;
      }
      place(set, where.place, { ...(raw as Omit<CueSequence, 'name'>), name: where.name });
    } catch (e) {
      set.errors.push(`${rel}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return set;
}

// ---- 旧形式（config の配列）からの変換 ----
//
// 以前のセリフは ui-chan.config.json に入っていて、各ステップは汎用 Cue を名前で
// 参照していた。変換は2か所で使う：一回限りの移行（tools/migrate-sequences.mjs）
// と、home の config.json に旧形式が残っている人のための読み込み時の読み替え。
// 一つの実装なので、移行した結果と読み替えた結果が食い違うことはない。

type LegacyDelivery = Delivery & { style_weights?: Record<string, number> };
interface LegacyStep {
  cue?: string;
  text?: string;
  reading?: string;
  holdMs?: number;
  delivery?: LegacyDelivery;
  [comment: `$comment${string}`]: unknown;
}
interface LegacySequence extends Omit<CueSequence, 'steps'> {
  steps: LegacyStep[];
}
interface LegacyConfig {
  idle?: {
    idlingCues?: {
      items?: LegacySequence[];
      systemIdle?: { awayCue?: LegacySequence; wakeCue?: LegacySequence };
    };
  };
  interactions?: { poke?: LegacySequence[]; spam?: { pool?: LegacySequence[] } };
  eventCues?: { events?: Record<string, { items?: LegacySequence[] }> };
}

/** Cue から見た目と声だけを取り出す（名前・カタログ情報は持ち込まない）。 */
export function lookFromCue(cue: Cue): Look {
  const look: Look = {};
  if (cue.select !== undefined) look.select = cue.select;
  if (cue.show !== undefined) look.show = cue.show;
  if (cue.hide !== undefined) look.hide = cue.hide;
  if (cue.blink !== undefined) look.blink = cue.blink;
  if (cue.voice !== undefined) look.voice = cue.voice;
  return look;
}

/** 汎用 Cue を参照していた旧形式のシーケンスを、見た目を自前で持つ形に直す。
 *  行ごとの声色（delivery.style_weights）はステップ自身の声（look.voice）へ移す
 *  ——そのステップの声がその行の声、が新しい形なので。 */
export function convertLegacySequence(
  seq: LegacySequence,
  cues: Record<string, Cue>,
  errors: string[],
): CueSequence {
  let prev: Look | undefined;
  const steps = seq.steps.map((legacy) => {
    const { cue, text, reading, holdMs, delivery, ...comments } = legacy;
    let look: Look | undefined;
    if (cue !== undefined) {
      const found = cues[cue];
      if (found) look = lookFromCue(found);
      else errors.push(`${seq.name ?? '?'}: 存在しない Cue "${cue}"（直前の見た目のまま）`);
    }
    let rest: Delivery | undefined;
    if (delivery) {
      const { style_weights, ...d } = delivery;
      // 見た目を持たないステップの声だけ差し替える場合は、直前の見た目を引き継ぐ
      // （look を置くと、置いた内容で見た目が決まり直すため）。
      if (style_weights) look = { ...(look ?? prev ?? {}), voice: { style_weights } };
      if (Object.keys(d).length) rest = d;
    }
    if (look) prev = look;
    const step: SequenceStep & Record<string, unknown> = {};
    if (look) step.look = look;
    if (text !== undefined) step.text = text;
    if (reading !== undefined) step.reading = reading;
    if (holdMs !== undefined) step.holdMs = holdMs;
    if (rest) step.delivery = rest;
    Object.assign(step, comments);
    return step;
  });
  const { steps: _, ...meta } = seq;
  return { ...meta, steps };
}

/** config に旧形式のプールがあれば、変換して返す。無いプールは含めない。 */
export function legacyPools(
  config: unknown,
  cues: Record<string, Cue>,
): {
  set: Partial<Omit<SequenceSet, 'errors' | 'legacyPools'>>;
  names: string[];
  errors: string[];
} {
  const c = (config ?? {}) as LegacyConfig;
  const errors: string[] = [];
  const conv = (s: LegacySequence) => convertLegacySequence(s, cues, errors);
  const set: Partial<Omit<SequenceSet, 'errors' | 'legacyPools'>> = {};
  const names: string[] = [];
  const idle = c.idle?.idlingCues;
  if (idle?.items) {
    set.idling = idle.items.map(conv);
    names.push('idle.idlingCues.items');
  }
  if (idle?.systemIdle?.awayCue) {
    set.away = conv({ name: 'away', ...idle.systemIdle.awayCue });
    names.push('idle.idlingCues.systemIdle.awayCue');
  }
  if (idle?.systemIdle?.wakeCue) {
    set.wake = conv({ name: 'wake', ...idle.systemIdle.wakeCue });
    names.push('idle.idlingCues.systemIdle.wakeCue');
  }
  if (c.interactions?.poke) {
    set.poke = c.interactions.poke.map(conv);
    names.push('interactions.poke');
  }
  if (c.interactions?.spam?.pool) {
    set.spam = c.interactions.spam.pool.map(conv);
    names.push('interactions.spam.pool');
  }
  for (const [event, group] of Object.entries(c.eventCues?.events ?? {})) {
    if (!group.items) continue;
    set.events = { ...(set.events ?? {}), [event]: group.items.map(conv) };
    names.push(`eventCues.events.${event}.items`);
  }
  return { set, names, errors };
}

/** ファイルから読んだ集合に、config に残っている旧形式のプールを重ねる。
 *  旧形式の配列は「この一覧」という意味だったので（paths.ts の deepMerge）、
 *  見つかったプールは丸ごと置き換える——移行前と同じ結果になる。 */
export function resolveSequences(opts: {
  dirs: string[];
  schemaFile: string;
  cueSchemaFile: string;
  config: unknown;
  cues: Record<string, Cue>;
}): SequenceSet {
  const set = loadSequences(opts.dirs, opts.schemaFile, opts.cueSchemaFile);
  const legacy = legacyPools(opts.config, opts.cues);
  const { events, ...pools } = legacy.set;
  Object.assign(set, pools);
  if (events) set.events = { ...set.events, ...events };
  set.errors.push(...legacy.errors);
  set.legacyPools = legacy.names;
  return set;
}
