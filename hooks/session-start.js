#!/usr/bin/env node
// SessionStart hook: injects the ui-chan persona (persona/ + context/*.md)
// plus a live Cue catalog into the session as additional context.
//
// This is a second, independent implementation of the same "persona +
// generated Cue catalog" injection the MCP `persona` prompt handler does
// (src/mcp-server.ts) — a pre-existing duplication (see REBUILD_BRIEF §6,
// out of scope for this rebuild) that now also covers the Cue catalog: the
// SessionStart hook is what actually fires automatically for a plugin
// install, so if it doesn't also generate the catalog, an agent that never
// manually calls `/mcp__ui-chan__persona` would never learn what Cues exist.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(root, 'ui-chan.config.json'), 'utf-8'));
} catch {
  /* use defaults */
}
const personaFile = config.personaFile ?? 'persona/ui-chan.md';

const parts = [];
const persona = readIfExists(path.join(root, personaFile));
if (persona) parts.push(persona);

const contextDir = path.join(root, 'context');
if (fs.existsSync(contextDir)) {
  for (const file of fs.readdirSync(contextDir).filter((f) => f.endsWith('.md')).sort()) {
    const text = readIfExists(path.join(contextDir, file));
    if (text) parts.push(text);
  }
}

// Same logic as mcp-server.ts's buildCueCatalog(): reuse the compiled loader
// (so schema validation stays the single implementation) rather than
// re-parsing cues/*.json by hand here.
try {
  const { loadCues } = require(path.join(root, 'dist', 'app', 'cues.js'));
  const cuesDir = path.join(root, config.cuesDir ?? 'cues');
  const cueSchemaPath = path.join(root, 'cue.schema.json');
  const { cues, errors } = loadCues(cuesDir, cueSchemaPath);
  const lines = Object.entries(cues)
    .filter(([, cue]) => !cue.internal)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cue]) => `- \`${name}\`${cue.description ? ` — ${cue.description}` : ''}`);
  const warning = errors.length > 0 ? `\n\n(cue読み込みエラー: ${errors.join('; ')})` : '';
  parts.push(
    `## 利用可能なCue一覧（set_cueのcue引数。起動時点のcues/の内容から自動生成）\n\n${lines.join('\n')}${warning}`,
  );
} catch {
  // dist/ not built yet, or cues/ missing — degrade silently, same as any
  // other missing-file case in this hook. `npm run build` fixes it.
}

if (parts.length > 0) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: parts.join('\n\n---\n\n'),
      },
    }),
  );
}
