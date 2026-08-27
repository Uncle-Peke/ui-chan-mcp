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
    .describe('Optional line to speak in the bubble. Omit for a silent Cue change.'),
  reading: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Hiragana reading of the WHOLE line — drives lip sync, and is what the TTS engine actually ' +
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
  pitch: z
    .number()
    .min(-600)
    .max(600)
    .optional()
    .describe('Ad-lib pitch shift for this line only, in cents (-600..600, default 0)'),
  speed: z
    .number()
    .min(0.2)
    .max(5)
    .optional()
    .describe('Ad-lib speech speed for this line only (0.2..5, default 1)'),
  volume: z
    .number()
    .min(-8)
    .max(8)
    .optional()
    .describe('Ad-lib volume for this line only, in dB (-8..8, default 0)'),
  intonation: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe('Ad-lib intonation strength for this line only (0..2, default 1)'),
};

export const setCueArgsSchema = z.object(setCueShape);
export type SetCueArgs = z.infer<typeof setCueArgsSchema>;
