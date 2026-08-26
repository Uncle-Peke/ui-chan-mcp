#!/usr/bin/env node
// Reaction hook (PreToolUse:Task / PostToolUse / SubagentStop / Stop /
// PreCompact): let ui-chan react to what is actually happening in the session,
// instead of only speaking when the agent remembers to call set_cue.
//
// Restraint is the whole design here. PostToolUse fires constantly, so a
// mascot that comments on every tool call becomes noise within a minute:
//   - only *failures* are worth interrupting for, and only from tools where a
//     failure is a real event (a command, an edit) rather than a normal miss
//     (a grep that found nothing)
//   - cooldown buckets keep her from chaining several lines in a row
//   - Stop only speaks once in a while, so "finished a turn" stays a beat and
//     not a verbal tic
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPayload, pick, speak } = require('./lib/mascot');

const STOP_CHANCE = 0.35;
const STATE_FILE = path.join(os.tmpdir(), 'ui-chan-reaction-hook.json');

// Throttle buckets, one per *kind* of line. Ambient commentary (a failure, the
// end of a turn) is interchangeable, so one line every 90s is plenty. Sending
// work off and getting it back is a pair, and the halves must not silence each
// other — a subagent that returns in 10s would otherwise lose its "welcome
// back", which is the half that carries the news. Same-kind repeats are still
// throttled, so fanning out five subagents at once gets one line, not five.
const COOLDOWNS = { general: 90_000, agent_out: 30_000, agent_back: 30_000 };

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function onCooldown(bucket) {
  const lastAt = readState()[bucket];
  return typeof lastAt === 'number' && Date.now() - lastAt < COOLDOWNS[bucket];
}

function markSpoken(bucket) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), [bucket]: Date.now() }));
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

const AGENT_OUT = [
  { text: 'はい、この件は別の子に投げた。', reading: 'はい、このけんはべつのこになげた。', cue: 'pose_smug_hips' },
  { text: 'お手伝い呼んだよ。ういは見てる。', reading: 'おてつだいよんだよ。ういはみてる。', cue: 'pose_arms_crossed' },
  { text: '誰かに行ってもらった。待ちだね。', reading: 'だれかにいってもらった。まちだね。', cue: 'emo_antic_lo' },
];

const AGENT_BACK = [
  { text: 'お、帰ってきた。', reading: 'お、かえってきた。', cue: 'emo_surprise_lo' },
  { text: 'ただいまだって。おつかれさま。', reading: 'ただいまだって。おつかれさま。', cue: 'emo_trust_lo' },
  { text: '仕事終わったみたいよ。', reading: 'しごとおわったみたいよ。', cue: 'sys_relief' },
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

/** @returns {[line, bucket] | [null, null]} */
function choose(payload) {
  switch (payload.hook_event_name) {
    case 'PreToolUse':
      // Only the agent-spawning tool reaches here (see the matcher in hooks.json).
      return payload.tool_name === 'Task' ? [pick(AGENT_OUT), 'agent_out'] : [null, null];
    case 'SubagentStop':
      return [pick(AGENT_BACK), 'agent_back'];
    case 'PostToolUse':
      return LOUD_TOOLS.has(payload.tool_name) && isFailure(payload)
        ? [pick(FAILURE), 'general']
        : [null, null];
    case 'Stop':
      return Math.random() < STOP_CHANCE ? [pick(DONE), 'general'] : [null, null];
    case 'PreCompact':
      return [pick(COMPACT), 'general'];
    default:
      return [null, null];
  }
}

const [line, bucket] = choose(readPayload());
const speaking = line && !onCooldown(bucket);
if (speaking) markSpoken(bucket);
speak(speaking ? line : null, 'reaction-hook');
