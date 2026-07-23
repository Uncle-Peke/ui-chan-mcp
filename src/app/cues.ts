import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Cue, CueVoice } from '../shared/types';
import { DEFAULT_CUE_NAME } from '../shared/types';

export interface CueSet {
  cues: Record<string, Cue>;
  errors: string[];
}

let validateCue: ValidateFunction | null = null;

function getValidator(schemaPath: string): ValidateFunction {
  if (!validateCue) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validateCue = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf-8')));
  }
  return validateCue;
}

/** One `<name>.json` = one Cue: a flat select/show/hide/blink/voice file,
 *  fully self-contained and validated against cue.schema.json — the schema
 *  file itself is the source of truth, not a hand-duplicated set of TS
 *  constraints. No inheritance, no bundling. */
export function loadCues(dir: string, schemaPath: string): CueSet {
  const set: CueSet = { cues: {}, errors: [] };
  const validate = getValidator(schemaPath);

  if (!fs.existsSync(dir)) {
    set.errors.push(`cues directory not found: ${dir}`);
  } else {
    for (const file of fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      const name = path.basename(file, '.json');
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (!validate(raw)) {
          const detail = (validate.errors ?? [])
            .map((e) => `${e.instancePath || '/'} ${e.message}`)
            .join('; ');
          set.errors.push(`${file}: ${detail}`);
          continue;
        }
        set.cues[name] = raw as Cue;
      } catch (e) {
        set.errors.push(`${file}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (!set.cues[DEFAULT_CUE_NAME]) {
    set.errors.push(
      `no "${DEFAULT_CUE_NAME}" cue found in ${dir} — falling back to an empty default (no select/show/hide, blink off)`,
    );
    set.cues[DEFAULT_CUE_NAME] = {};
  }

  return set;
}

/** Validate one Cue object against cue.schema.json (used by the editor before
 *  writing a file). Returns null on success or a joined error string. */
export function validateCueObject(obj: unknown, schemaPath: string): string | null {
  const validate = getValidator(schemaPath);
  if (validate(obj)) return null;
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

export function watchCues(dir: string, onChange: () => void): void {
  if (!fs.existsSync(dir)) return;
  let timer: NodeJS.Timeout | null = null;
  fs.watch(dir, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 300);
  });
}

export function extractCueVoice(set: CueSet): Record<string, CueVoice> {
  const out: Record<string, CueVoice> = {};
  for (const [name, cue] of Object.entries(set.cues)) {
    if (cue.voice) out[name] = cue.voice;
  }
  return out;
}
