#!/usr/bin/env node
// PostToolUse / Stop / PreCompact hook: let ui-chan react to what is actually
// happening in the session, instead of only speaking when the agent remembers
// to call set_cue.
//
// Restraint is the whole design here. PostToolUse fires constantly, so a
// mascot that comments on every tool call becomes noise within a minute:
//   - only *failures* are worth interrupting for, and only from tools where a
//     failure is a real event (a command, an edit) rather than a normal miss
//     (a grep that found nothing)
//   - a shared cooldown across all reaction kinds keeps her from chaining
//     several lines in a row
//   - Stop only speaks once in a while, so "finished a turn" stays a beat and
//     not a verbal tic
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPayload, pick, speak } = require('./lib/mascot');

const COOLDOWN_MS = 90_000;
const STOP_CHANCE = 0.35;
const STATE_FILE = path.join(os.tmpdir(), 'ui-chan-reaction-hook.json');

/** One cooldown for every reaction kind, so two hooks can't talk over each other. */
function onCooldown() {
  try {
    const { lastAt } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return Date.now() - lastAt < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markSpoken() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastAt: Date.now() }));
  } catch {
    /* a read-only tmpdir just means no throttling — not worth failing over */
  }
}

const FAILURE = [
  { text: 'あ、こけた。', reading: 'あ、こけた。', cue: 'mix_surprise_sad' },
  { text: 'うわ、赤くなってるじゃん。', reading: 'うわ、あかくなってるじゃん。', cue: 'emo_fear_lo' },
  { text: 'えぇ…また怒られてる。', reading: 'えぇ…またおこられてる。', cue: 'mix_sad_disgust' },
  { text: 'はい失敗〜。まあ直すでしょ。', reading: 'はいしっぱい〜。まあなおすでしょ。', cue: 'sys_smirk' },
  { text: 'おっと。今の効いたね。', reading: 'おっと。いまのきいたね。', cue: 'emo_surprise_lo' },
];

const DONE = [
  { text: 'ひと段落したっぽいね。', reading: 'ひとだんらくしたっぽいね。', cue: 'sys_relief' },
  { text: 'おつかれ。ういは見てただけだけど。', reading: 'おつかれ。ういはみてただけだけど。', cue: 'emo_joy_lo' },
  { text: '終わった？　じゃあ休憩でしょ。', reading: 'おわった？　じゃあきゅうけいでしょ。', cue: 'pose_arms_crossed' },
  { text: 'ふぅ。いい感じじゃん。', reading: 'ふぅ。いいかんじじゃん。', cue: 'emo_trust_lo' },
  { text: 'はい、おしまい。えらいえらい。', reading: 'はい、おしまい。えらいえらい。', cue: 'emo_trust_hi' },
];

const COMPACT = [
  { text: 'ちょっと記憶の整理するね。', reading: 'ちょっときおくのせいりするね。', cue: 'sys_think' },
  { text: '話が長くなってきたから、たたむよ。', reading: 'はなしがながくなってきたから、たたむよ。', cue: 'pose_think' },
];

/** Tools where a failure is an event worth a face, not just a normal outcome. */
const LOUD_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/** Did this tool result actually fail? Claude Code reports this a few ways. */
function isFailure(payload) {
  const res = payload.tool_response;
  if (!res || typeof res !== 'object') return false;
  if (res.is_error === true || res.isError === true) return true;
  if (res.interrupted === true) return false; // the user stopped it — not a failure
  if (typeof res.exit_code === 'number' && res.exit_code !== 0) return true;
  return false;
}

function chooseLine(payload) {
  switch (payload.hook_event_name) {
    case 'PostToolUse':
      return LOUD_TOOLS.has(payload.tool_name) && isFailure(payload) ? pick(FAILURE) : null;
    case 'Stop':
      return Math.random() < STOP_CHANCE ? pick(DONE) : null;
    case 'PreCompact':
      return pick(COMPACT);
    default:
      return null;
  }
}

const payload = readPayload();
const line = onCooldown() ? null : chooseLine(payload);
if (line) markSpoken();
speak(line, 'reaction-hook');
