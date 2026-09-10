import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Cue } from '../shared/types';
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
export function loadCues(dirs: string | string[], schemaPath: string): CueSet {
  const set: CueSet = { cues: {}, errors: [] };
  const validate = getValidator(schemaPath);
  // Several dirs may contribute (packaged cues + the user's `~/.ui-chan/cues`).
  // Later dirs win on a shared name, so a user override never has to fork the
  // whole catalog — see src/shared/paths.ts.
  const list = Array.isArray(dirs) ? dirs : [dirs];

  if (list.length === 0) set.errors.push('no cues directory configured');
  for (const dir of list) {
    if (!fs.existsSync(dir)) {
      set.errors.push(`cues directory not found: ${dir}`);
      continue;
    }
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
      `no "${DEFAULT_CUE_NAME}" cue found in ${list.join(', ')} — falling back to an empty default (no select/show/hide, blink off)`,
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
