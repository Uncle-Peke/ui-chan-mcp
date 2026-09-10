// Cue とシーケンス（固定セリフ）をスキーマで検証する。CI とリリース前に走る。
// dist/ を読むので、build の後に実行すること。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePaths } = require('../dist/shared/paths');
const { loadCues } = require('../dist/app/cues');
const { resolveSequences } = require('../dist/app/sequences');

const p = resolvePaths(process.cwd());
const cues = loadCues(p.cueDirs, p.cueSchemaFile);
const sequences = resolveSequences({
  dirs: p.sequenceDirs,
  schemaFile: p.sequenceSchemaFile,
  cueSchemaFile: p.cueSchemaFile,
  config: p.config,
  cues: cues.cues,
});

const errors = [
  ...cues.errors.map((e) => `cue: ${e}`),
  ...sequences.errors.map((e) => `sequence: ${e}`),
];
if (sequences.legacyPools.length) {
  console.warn(`旧形式のセリフが config に残っています: ${sequences.legacyPools.join(', ')}`);
}
console.log(JSON.stringify(errors, null, 2));
process.exit(errors.length ? 1 : 0);
