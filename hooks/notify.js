#!/usr/bin/env node
// Notification hook: when Claude Code needs the user's attention
// (permission prompt, or the prompt has been idle waiting for input),
// have ui-chan poke the user from her speech bubble.
//
// Reads the hook payload from stdin, sends set_cue to the running mascot over
// its WebSocket bridge, and always exits 0 fast — if the app is not running
// (or anything goes wrong) it stays silent and never blocks Claude Code.
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PLUGIN_ROOT
  ? process.env.CLAUDE_PLUGIN_ROOT
  : path.resolve(__dirname, '..');

function readPort() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'ui-chan.config.json'), 'utf-8'));
    if (typeof config.port === 'number') return config.port;
  } catch {
    /* fall through to default */
  }
  return 8123;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

// idle-waiting vs permission-request lines, in ui-chan's voice.
const PERMISSION = [
  { text: 'ねぇ、きみの許可待ちだって〜。ボタン押したげて', reading: 'ねぇ、きみのきょかまちだって〜。ぼたんおしたげて', cue: 'thinking' },
  { text: 'おーい、確認だってさ。まだ止まってるが？', reading: 'おーい、かくにんだってさ。まだとまってるが？', cue: 'jito' },
  { text: 'きみのターンだよ〜。ぽちっとして', reading: 'きみのたーんだよ〜。ぽちっとして', cue: 'happy' },
];
const IDLE = [
  { text: 'おーい、置いてけぼりなんだけど？', reading: 'おーい、おいてけぼりなんだけど？', cue: 'troubled' },
  { text: 'きみ、どこいったの〜。待ってるんだけど', reading: 'きみ、どこいったの〜。まってるんだけど', cue: 'jito' },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function chooseLine(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('waiting') || m.includes('idle') || m.includes('input')) return pick(IDLE);
  return pick(PERMISSION);
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    payload = {};
  }
  const line = chooseLine(payload.message);
  const port = readPort();

  let settled = false;
  const done = (code) => {
    if (settled) return;
    settled = true;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };

  // Hard cap so the hook can never hang Claude Code.
  const killer = setTimeout(() => done(0), 1500);
  killer.unref?.();

  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    return done(0);
  }

  const send = (obj) => ws.send(JSON.stringify(obj));

  ws.addEventListener('open', () => {
    send({
      id: 1,
      type: 'tool',
      agent: 'notify-hook',
      tool: 'set_cue',
      args: { cue: line.cue, text: line.text, reading: line.reading },
    });
    // give the bridge a beat to process, then leave.
    setTimeout(() => done(0), 250);
  });
  ws.addEventListener('error', () => done(0));
}

main();
