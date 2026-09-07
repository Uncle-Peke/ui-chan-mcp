import { z } from 'zod';

/** Single source of truth for set_cue's argument shape. `mcp-server.ts` uses
 *  `setCueShape` directly as the MCP tool's inputSchema (a zod raw shape);
 *  `main.ts` parses the WS bridge payload with `setCueArgsSchema`; `state.ts`
 *  uses the inferred `SetCueArgs` type. Adding or renaming a knob is a
 *  one-file change instead of three hand-synced ones.
 *
 *  Kept out of `shared/types.ts` on purpose: that module is also imported
 *  (type-only) by the browser-bundled renderer, and this file pulls in the
 *  zod runtime, which the renderer has no use for. */
export const setCueShape = {
  cue: z.string().describe('Cue name (unknown names fall back to "default")'),
  text: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Optional line to speak in the bubble. Omit for a silent Cue change. Write it in ORDINARY ' +
        'Japanese orthography, exactly as it should appear on screen: Latin names stay in Latin ' +
        '(Linux, bash, k8s), digits stay as digits (バージョン 0.1, 3回), kanji stays kanji. The ' +
        "pronunciation is reading's job — never spell the sound out here (NOT リナックス, NOT 零点一). " +
        'DELIVERY comes from ordinary Japanese punctuation — just write the line the way it is ' +
        'actually said and it is read that way: 、 and … give a beat, ー / 〜 hold the vowel ' +
        '(「まじで〜」 really drags). The one added mark is **bold** for the ONE word that carries ' +
        'the line (「それ、**本気**で言ってる？」) — it is re-phrased into its own accent peak, the ' +
        'way a speaker stresses a word. Bold at most one or two words per line; bolding everything ' +
        'stresses nothing. The ** marks never appear in the bubble. Put them in reading too when ' +
        'reading is what gets spoken (i.e. when text has Latin letters or digits).',
    ),
  reading: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Hiragana reading of the WHOLE line (text stays in ordinary orthography; this is the sound ' +
        'of the same line) — drives lip sync, and is what the TTS engine actually ' +
        'speaks whenever text contains Latin letters or digits. Leave NO Latin letters, digits or ' +
        'symbols in it: write how a Japanese speaker actually says the line, judging each term from ' +
        'your own knowledge rather than transliterating its spelling (k8s → くーばねてぃす, ' +
        'bash → ばっしゅ, NPO → えぬぴーおー, 3回 → さんかい). Anything left in Latin is read out ' +
        'letter-by-letter in English. Provide whenever text is given.',
    ),
  duration_ms: z
    .number()
    .int()
    .min(500)
    .max(60_000)
    .optional()
    .describe(
      'With text: how long to display the bubble, ms (default derived from text length). ' +
        'Without text: how long to hold this Cue before easing back to default, ms ' +
        '(default: holds until the next set_cue).',
    ),
  // pitch / speed / volume / intonation は**意図的に無い**。数値の演技指示を
  // 渡せるようにしたことがあり、実測で AI の思考時間が跳ね上がった（1回の呼び
  // 出しで「何を言うか」とは別に「数値をいくつにするか」を考えることになる）。
  // 実際この4つは正しく動いていたのに、ほぼ一度も使われないまま残っていた。
  // 読み方はセリフの書き方から導出する（→ src/app/prosody.ts）：、と…で間、
  // 〜で語尾伸ばし、**語**で強調、？で語尾上げ。声色は Cue が持つ。
};

export const setCueArgsSchema = z.object(setCueShape);
export type SetCueArgs = z.infer<typeof setCueArgsSchema>;
