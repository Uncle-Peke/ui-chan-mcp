#!/usr/bin/env node
// SessionStart hook: injects the ui-chan persona (persona/ + context/*.md)
// into the session as additional context.
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

let personaFile = 'persona/ui-chan.md';
try {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'ui-chan.config.json'), 'utf-8'));
  if (config.personaFile) personaFile = config.personaFile;
} catch {
  /* use default */
}

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
