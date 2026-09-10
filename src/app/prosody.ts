import type { LexiconEntry } from '../shared/types';

export type { LexiconEntry };

/**
 * セリフの中の記法を、VoiSona Talk が理解する形に翻訳する。
 *
 * 設計の前提は「**AI に数値パラメータを持たせない**」こと。強弱や間を引数で
 * 渡させると、1回の呼び出しで「何を言うか」とは別に「数値をいくつにするか」を
 * 考えることになり、実測で思考時間が跳ね上がる（`set_cue` の pitch/speed/
 * volume/intonation が正しく動くのにほぼ使われていないのが、その証拠）。
 *
 * なので演出は**文を書く行為の中に埋める**。Markdown が記法を発明せず「人が
 * すでに打っていた書き方」を意味に昇格させたのと同じやり方で、日本語の表記に
 * もとからあるものをそのまま使う。AI が新しく覚えるのは太字だけ。
 *
 * エンジンの実測（田中傘 2.0.1）に基づく分担：
 *
 * | 記法 | 実測 | ここでやること |
 * |---|---|---|
 * | `、` `…` `‥` | すでに `pau` が入る | **何もしない**（エンジンに任せる） |
 * | `ー`         | すでに長音として伸びる | **何もしない** |
 * | `〜`         | **完全に無視される**（発音も長さも変わらない） | 取り除き、直前の母音を音素長で伸ばす |
 * | `！`         | 無視（強調にならない） | 今は何もしない（TSML の強調は太字で明示） |
 * | `**語**`     | `＊` として読まれ、余計な `pau` まで入る | **必ず除去**し、TSML で強調に翻訳 |
 *
 * つまり TSML の往復（実測 +0.5 秒）が要るのは、**太字か、辞書に載っている語を
 * 含む行だけ**。それ以外は今までどおりの速い経路をそのまま通す。
 */

const EMPHASIS_RE = /\*\*([^*\n]{1,24})\*\*/g;

/** 吹き出しに出す形。記法の印だけを外し、書き手が選んだ表記（`〜` など）は
 *  そのまま残す——見た目は書いたとおりであってほしいので、正規化はしない。 */
export function forDisplay(s: string): string {
  return s.replace(EMPHASIS_RE, '$1');
}

/**
 * エンジンに渡す形。印と、エンジンが読み飛ばす `〜` を外す。
 *
 * `〜` を `ー` に置き換える手もあり、最初はそうしていた——が耳で落第した。
 * 長音は**独立した語**として解析され、しかも `hl="l"`（低）が付く。疑問の
 * 上げは最後のモーラで起きるので、足した長音がそれを潰してしまう
 * （「言ってるー？」が上がらなくなる）。伸ばすのは `stretchTarget()` の
 * 音素長でやり、解析結果には触らない。
 */
export function forSpeech(s: string): string {
  return forDisplay(s).replace(/[〜～]+/g, '');
}

/** この行が語尾を伸ばす指定（`〜`）を持っているか。 */
export function wantsStretch(s: string): boolean {
  return /[〜～]/.test(forDisplay(s));
}

/** 太字で囲まれた語。エンジンに渡す形と同じ正規化をかけてから返す
 *  （TSML の要素テキストと照合するため、綴りが一致していないと当たらない）。 */
export function emphasisTargets(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(EMPHASIS_RE)) {
    const t = m[1].replace(/[〜～]+/g, 'ー').trim();
    if (t) out.push(t);
  }
  return out;
}

/** この行に TSML の往復が要るか。要らなければ、今までどおり text を投げる
 *  だけの経路で済む（0.5 秒の差はここで決まる）。 */
/** 語末の促音（`えっ？` `あっ！` `ちょっ、`）。語中の促音（`やった`）は対象外
 *  ——詰まって聞こえるべきなのは「そこで語が切れる」場合だけなので、句読点か
 *  行末が続くものだけを拾う。 */
export function hasClippedWord(s: string): boolean {
  return /[っッ](?:[？！。、…‥\s]|$)/.test(forDisplay(s));
}

export function needsTsml(spoken: string, lexicon: LexiconEntry[]): boolean {
  if (wantsStretch(spoken) || hasClippedWord(spoken)) return true;
  if (EMPHASIS_RE.test(spoken)) {
    EMPHASIS_RE.lastIndex = 0; // /g な正規表現は lastIndex を持ち越す
    return true;
  }
  const plain = forSpeech(spoken);
  return lexicon.some((e) => e.word && plain.includes(e.word));
}

// ---- TSML の編集 --------------------------------------------------------
//
// 解析結果は <word> の並び。**属性を書き換えるだけ**で演出になるので、AI に
// TSML そのものを書かせる必要はない（`pos` や `phoneme` はエンジンが決める
// ことで、書かせれば必ず捏造する）。必ず「解析させてから差分を当てる」。

interface Word {
  raw: string;
  /** 要素テキスト＝画面に出る表層形。照合はこちらで行う。`original` 属性は
   *  **辞書形**が入る（「言っ」の original は "言う"）ので使ってはいけない。 */
  surface: string;
}

const WORD_RE = /<word\b[^>]*>([^<]*)<\/word>/g;

function words(tsml: string): Word[] {
  return [...tsml.matchAll(WORD_RE)].map((m) => ({ raw: m[0], surface: m[1] }));
}

function attr(w: string, name: string): string | undefined {
  return w.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function setAttr(w: string, name: string, value: string): string {
  return attr(w, name) !== undefined
    ? w.replace(new RegExp(`\\b${name}="[^"]*"`), `${name}="${value}"`)
    : w.replace(/^<word\b/, `<word ${name}="${value}"`);
}

/** 語は解析の都合で割れる（「言ってる」は `言っ`＋`てる`）。だから1語ではなく
 *  **連続する語の並び**として探す。 */
function findRun(ws: Word[], target: string): { start: number; end: number } | null {
  for (let i = 0; i < ws.length; i++) {
    let joined = '';
    for (let j = i; j < ws.length && joined.length < target.length + 8; j++) {
      joined += ws[j].surface;
      if (joined === target) return { start: i, end: j };
    }
  }
  return null;
}

/**
 * 強調。日本語の強調は音量ではなく「**アクセント句を切り直して、その手前に一拍
 * 置く**」ことで起きる。人が語を強調するときの実際の喋り方がそれで、句の頭で
 * ピッチがリセットされて山ができる。直後の語も `chain="0"` にして句を閉じる
 * ——閉じないと、強調が後ろに流れて溶ける。
 *
 * **`hl`（アクセント型）は絶対に書き換えない。** 一度そうしていて、耳で聞いて
 * 落第した：「本気」の自然な型は `lhh` で、これを頭高 `hll` にすると強調ではなく
 * **アクセントの違う別の語**に聞こえる（方言や読み間違いと同じ現象）。強調は
 * 型を変えることではなく、句の切り方で作るもの。
 */
export function emphasize(tsml: string, target: string): string {
  const ws = words(tsml);
  const run = findRun(ws, target);
  if (!run) return tsml; // 当たらなければ黙って何もしない（喋れないより無強調がまし）
  let out = tsml;
  const head = ws[run.start];
  const edited = setAttr(head.raw, 'chain', '0');
  // すでに句の先頭にいる語をもう一度割ると、空の acoustic_phrase ができる。
  const atPhraseHead = /<acoustic_phrase>\s*$/.test(out.slice(0, out.indexOf(head.raw)));
  out = out.replace(
    head.raw,
    atPhraseHead ? edited : `</acoustic_phrase><acoustic_phrase>${edited}`,
  );
  const after = ws[run.end + 1];
  if (after) out = out.replace(after.raw, setAttr(after.raw, 'chain', '0'));
  return out;
}

/**
 * 固有名詞などの読み・アクセントを常に上書きする。
 *
 * 型は文脈で変わる。日本語の**複合語アクセント**では前部要素のアクセントが消え、
 * 核が後部要素へ移る——「うい」は単独なら頭高だが、「ういビーム」では平らになって
 * 山は「ビーム」側にできる。耳で確かめても実際そう聞こえたので、直後が自立語の
 * 名詞なら `hlInCompound` に切り替える。
 *
 * `？` が続くときの型（`hlBeforeQuestion`）も同じ仕組み。感動詞は表記が同じでも
 * 読みが複数あり、「はあ」の既定は高→低＝溜め息なので、威嚇の「はぁ？」にならない。
 *
 * **接尾辞は複合語ではない。** 「ういちゃん」の「ちゃん」は `名詞:接尾` で、ここを
 * 複合語と見なすと「ういちゃん」まで平らになってしまう。`pos_group1="接尾"` は除外する。
 */
export function applyLexicon(tsml: string, lexicon: LexiconEntry[]): string {
  let out = tsml;
  for (const e of lexicon) {
    if (!e.word) continue;
    const ws = words(out);
    const run = findRun(ws, e.word);
    if (!run) continue;
    const next = ws[run.end + 1]?.raw;
    const beforeQuestion = !!next && /\bis_question="1"/.test(next);
    // 「文頭でない」＝前に実際に音を持つ語がある。記号だけ前にある場合は文頭扱い。
    const midSentence = ws.slice(0, run.start).some((w) => !!attr(w.raw, 'phoneme'));
    const inCompound =
      !!next &&
      attr(next, 'pos') === '名詞' &&
      attr(next, 'pos_group1') !== '接尾' &&
      !!attr(next, 'phoneme'); // 記号（読点など）は語ではない
    // 条件は具体的なものから順に見る：？が続く → 複合語 → 文中 → 既定。
    const hl =
      (beforeQuestion ? e.hlBeforeQuestion : undefined) ??
      (inCompound ? e.hlInCompound : undefined) ??
      (midSentence ? e.hlMidSentence : undefined) ??
      e.hl;
    // 語が割れている場合（「ういちゃん」＝ うい＋ちゃん）は、各語のモーラ数ぶんずつ
    // hl を切り分けて当てる。既存の hl の長さがそのままモーラ数なので、それを使う。
    let cursor = 0;
    for (let i = run.start; i <= run.end; i++) {
      const w = ws[i];
      let edited = w.raw;
      const morae = (attr(w.raw, 'hl') ?? '').length;
      if (e.pronunciation && run.start === run.end) {
        edited = setAttr(edited, 'pronunciation', e.pronunciation);
      }
      if (hl && morae > 0) {
        const slice = hl.slice(cursor, cursor + morae);
        if (slice.length === morae) edited = setAttr(edited, 'hl', slice);
      }
      cursor += morae;
      out = out.replace(w.raw, edited);
    }
  }
  return out;
}

// ---- 音素列の再現 -------------------------------------------------------
//
// `phoneme_durations` は「合成に使われる音素列と同じ並び」で渡す必要がある。
// 素直にやると、一度合成して `phonemes` を受け取ってから投げ直すことになり
// 往復がもう1回増える——が、**TSML から正確に再現できる**（9例で実測一致）。
// 規則は2つだけ：
//   1. 各 <word> の `phoneme` 属性を `|`（モーラ）と `,`（音素）で割って並べる
//   2. 句境界と読点類で `pau`。ただし**連続する `pau` は1つ**（読点が作る `pau` と
//      句境界の `pau` は同じものなので、二重に数えると全体が1つずれる）
// 前後に `sil`。

interface PhonemeMap {
  /** 合成に使われる音素列（`sil`/`pau` 込み）。 */
  seq: string[];
  /** 語ごとの、その語が占める `seq` 上の範囲と表層形。 */
  words: { surface: string; start: number; end: number }[];
}

export function phonemeMap(tsml: string): PhonemeMap {
  const seq = ['sil'];
  const words: PhonemeMap['words'] = [];
  const push = (p: string) => {
    if (p !== 'pau' || seq[seq.length - 1] !== 'pau') seq.push(p);
  };
  const phrases = tsml.split('<acoustic_phrase>').slice(1);
  phrases.forEach((phrase, i) => {
    if (i > 0) push('pau');
    for (const m of phrase.matchAll(/<word\b[^>]*phoneme="([^"]*)"[^>]*>([^<]*)<\/word>/g)) {
      const [, phonemes, surface] = m;
      if (!phonemes) {
        if (/[、…‥　 ]/.test(surface)) push('pau');
        continue;
      }
      const start = seq.length;
      for (const mora of phonemes.split('|')) for (const p of mora.split(',')) push(p);
      words.push({ surface, start, end: seq.length - 1 });
    }
  });
  seq.push('sil');
  return { seq, words };
}

export function phonemeSequence(tsml: string): string[] {
  return phonemeMap(tsml).seq;
}

const VOWELS = /^[aiueoAIUEO]$/;

/**
 * 同じ `〜` でも、伸びる長さは感情で違う。甘えた「ねえ〜」は長く伸び、怒った
 * 「なんで〜」は短く切れる。**数値を書く場所は増やさない**——Cue が既に持って
 * いる `style_weights` から重み付き平均で導く。
 *
 * スタイル名はボイスライブラリ依存（田中傘 2.0.1 は Normal/Happy/Bashful/
 * Angry/Sad）。表に無い名前は既定値に落ちるので、別のボイスに差し替えても
 * 壊れない。
 */
const STRETCH_BY_STYLE: Record<string, number> = {
  normal: 0.4,
  happy: 0.5, // 嬉しいと間延びする
  bashful: 0.55, // 甘え・照れがいちばん伸びる
  sad: 0.5, // 悲しみも引きずる
  angry: 0.25, // 怒りは短く切る
};
const STRETCH_DEFAULT = 0.4;

/**
 * 抑揚の振れ幅（`intonation`、0〜2）も感情から決まる。
 *
 * **テンションが高いか低いかで、抑揚の幅は全然ちがう。** 感情音声の研究でも、
 * 高覚醒（喜び・怒り）は F0 レンジが最も広く、低覚醒（悲しみ）が最も狭い、と
 * 同じ順に並ぶ。逆に言うと、全セリフに同じ倍率をかけるのは誤りで——実際、
 * 1.6 固定にしたら短い相槌（「ふーん。」）が大げさになって落第した。
 *
 * 全体に 1 より高めなのは、上手い読みと下手な読みの差が**際立たせ方の大きさ**
 * だという研究（郡史郎）に沿ったもの。ただし「悲しい」は例外で、抑揚を**狭める**
 * ことが表現になる。
 */
const INTONATION_BY_STYLE: Record<string, number> = {
  normal: 1.15,
  happy: 1.7, // レンジ最大
  angry: 1.6, // F0 の変動が最も大きい
  bashful: 1.3,
  // 悲しみを 0.9 に狭めていた時期がある。研究の「悲しみは F0 レンジが最も狭い」を
  // そのまま当てたのだが、耳で落第した——**平坦なだけで、落ち込んで聞こえない**。
  // あれは自然な悲しい発話を*測った*結果であって、すでに Sad スタイルで悲しくなって
  // いる声に*重ねて*かける操作ではなかった。二重適用で感情の signal ごと潰していた。
  // 悲しみは抑揚ではなく、下の速度と高さで作る。
  sad: 1.15,
};

/**
 * 話速。低覚醒（悲しみ）は遅く、高覚醒は速い——のが研究の一般則だが、**耳で
 * 確かめたのは悲しみだけ**。未検証の値を入れるのは今日ずっと避けてきた「隠れた
 * 補正」そのものなので、残りは中立（1.0）のまま置いてある。喜び・怒りを振るなら、
 * 先に聞いて決めること。
 */
const SPEED_BY_STYLE: Record<string, number> = {
  sad: 0.88, // 検証ずみ
  happy: 1.07, // 検証ずみ
  // 怒りは 1.0 / 1.08 / 1.18 を聞き比べて**差が分からなかった**ので入れない。
  // Angry スタイル自体が既にやっているぶんに、上から速度を重ねても効かない。
  // 怒りを強めるなら速度ではなく別の軸（句を短く切る等）を探すこと。
};

/** 声の高さ（cent）。**いまは全部中立。** 悲しみを −80 にした版も聞いたが、
 *  速度だけ落とした版のほうが良いという判断だった（暗くなりすぎる）。表だけ
 *  残してあるのは、今後の検証で必要になったときの置き場所として。 */
const PITCH_BY_STYLE: Record<string, number> = {};

/** スタイルの重みで表を混ぜる。伸ばし長さと抑揚で同じ計算をする。 */
function blendByStyle(
  table: Record<string, number>,
  fallback: number,
  styleWeights?: Record<string, number>,
): number {
  if (!styleWeights) return fallback;
  let sum = 0;
  let weighted = 0;
  for (const [name, w] of Object.entries(styleWeights)) {
    if (!(w > 0)) continue;
    sum += w;
    weighted += w * (table[name.toLowerCase()] ?? fallback);
  }
  return sum > 0 ? weighted / sum : fallback;
}

export function stretchSeconds(styleWeights?: Record<string, number>): number {
  return blendByStyle(STRETCH_BY_STYLE, STRETCH_DEFAULT, styleWeights);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `fallback` は「感情を宣言していない Cue」の値（config の `tts.intonation`）。
 *  無感情の相槌がここに落ちるので、控えめな値にしておくのが正しい。 */
export function intonationFor(fallback: number, styleWeights?: Record<string, number>): number {
  return round2(blendByStyle(INTONATION_BY_STYLE, fallback, styleWeights));
}

export function speedFor(styleWeights?: Record<string, number>): number {
  return round2(blendByStyle(SPEED_BY_STYLE, 1, styleWeights));
}

export function pitchFor(styleWeights?: Record<string, number>): number {
  return Math.round(blendByStyle(PITCH_BY_STYLE, 0, styleWeights));
}

/** 促音（`っ`）で終わる語の母音の長さ。実測で決めた値。
 *
 *  エンジンの既定は逆方向を向いている——「え？」の母音は 0.255 秒、促音を足した
 *  「えっ？」は **0.285 秒と、むしろ長くなる**。人の感覚は逆で、「えっ」は詰まって
 *  短い。0.15 秒まで詰めると「虚をつかれた」に、0.20 秒だと「聞き直した」に
 *  聞こえる、というところまで耳で確かめてある。 */
const CLIP_SEC = 0.15;

/** 表層形が `っ` で終わるか（＝詰まる音）。 */
const endsWithSokuon = (surface: string) => /[っッ]$/.test(surface);

/**
 * `phoneme_durations` を組み立てる。`-1` は「自動」なので、**触る音素だけ**を
 * 実数にして残りはエンジンに任せる。
 *
 * 手を入れるのは2種類だけで、どちらも**日本語の表記そのもの**が指示になっている：
 *   - `〜` … 行末の母音を伸ばす（長さは Cue の感情から決まる）
 *   - `っ` … その語の母音を詰める（`CLIP_SEC`）
 */
export function buildDurations(
  tsml: string,
  opts: { stretchSec?: number; clipSec?: number },
): number[] | null {
  const { seq, words } = phonemeMap(tsml);
  const out = seq.map(() => -1);
  let touched = false;

  for (const w of words) {
    if (!endsWithSokuon(w.surface)) continue;
    for (let i = w.end; i >= w.start; i--) {
      if (VOWELS.test(seq[i])) {
        out[i] = opts.clipSec ?? CLIP_SEC;
        touched = true;
        break;
      }
    }
  }

  if (opts.stretchSec !== undefined) {
    for (let i = seq.length - 1; i >= 0; i--) {
      if (VOWELS.test(seq[i])) {
        out[i] = opts.stretchSec;
        touched = true;
        break;
      }
    }
  }
  return touched ? out : null;
}

/**
 * 語尾の扱いを差し替える。
 *
 * `flat` は `is_question` を外す——`？` が付いていても上げない読みで、呆れ・詰問・
 * 断定・独り言がこれ。`rise` は逆に、`？` が無い行の最後の語に付けて上げさせる
 * （甘え・確認）。どちらも「完了か継続か」を語尾で伝えるための操作で、
 * エンジンは表記からしかそれを判断できない。
 */
export function applyEnding(tsml: string, ending: 'flat' | 'rise'): string {
  if (ending === 'flat') return tsml.replace(/\s*is_question="1"/g, '');
  if (/\bis_question="1"/.test(tsml)) return tsml; // すでに上がる
  const ws = words(tsml);
  // 記号ではなく、音を持つ最後の語に付ける。
  for (let i = ws.length - 1; i >= 0; i--) {
    if (attr(ws[i].raw, 'phoneme')) {
      return tsml.replace(ws[i].raw, setAttr(ws[i].raw, 'is_question', '1'));
    }
  }
  return tsml;
}

/** 抑揚の既定値。感情を宣言していない声（style_weights なし）に使う。config の
 *  `tts.intonation` が無いときの値。 */
export const INTONATION_FALLBACK = 1.1;

/** 行ごとの演技指定（delivery）を書かなかったときに使われる値。 */
export interface DerivedDelivery {
  intonation: number;
  speed: number;
  pitch: number;
  volume: number;
  stretchSec: number;
  clipSec: number;
}

/**
 * 声色（style_weights）から導いた、演技の既定値の一式。合成（tts.ts）と
 * エディタの表示が**同じこの関数**を見るので、エディタに出る「自動」の値と
 * 実際に鳴る値はずれない。伸ばし・詰めは、その行に `〜`／語末の `っ` が
 * あるときだけ効く。
 */
export function derivedDelivery(
  styleWeights?: Record<string, number>,
  intonationFallback = INTONATION_FALLBACK,
): DerivedDelivery {
  return {
    intonation: intonationFor(intonationFallback, styleWeights),
    speed: speedFor(styleWeights),
    pitch: pitchFor(styleWeights),
    volume: 0,
    stretchSec: stretchSeconds(styleWeights),
    clipSec: CLIP_SEC,
  };
}

/** What the TTS engine should actually be handed for this line.
 *
 *  VoiSona reads Latin letters as English spelling — `zsh` comes out
 *  "ゼッドエスエイチ", `npm` as "エヌピーエム". The agent already supplies
 *  `reading` (full hiragana) for lip-sync, so that is the correct pronunciation
 *  to speak. We do NOT always prefer it, though: hiragana-only input costs the
 *  engine its kanji-based accent estimation, and most lines are pure Japanese
 *  where `text` reads better. So the swap is scoped to exactly the broken case
 *  — the line contains Latin letters (or digits, same problem) and a reading
 *  was given. The bubble still shows `text` either way. */
export function ttsTextFor(text: string, reading?: string): string {
  const yomi = reading?.trim();
  if (!yomi) return text;
  return /[A-Za-z0-9]/.test(text) ? yomi : text;
}
