#!/usr/bin/env node
// Notification hook: when Claude Code needs the user's attention
// (permission prompt, or the prompt has been idle waiting for input),
// have ui-chan poke the user from her speech bubble.
const { readPayload, pick, speak } = require('./lib/mascot');

// Idle-waiting vs permission-request lines, in ui-chan's voice.
const PERMISSION = [
  {
    text: 'ねぇ、きみの許可待ちだって〜。ボタン押したげて',
    reading: 'ねぇ、きみのきょかまちだって〜。ぼたんおしたげて',
    cue: 'sys_address',
  },
  {
    text: 'おーい、確認だってさ。まだ止まってるが？',
    reading: 'おーい、かくにんだってさ。まだとまってるが？',
    cue: 'mix_disgust_anger',
  },
  {
    text: 'きみのターンだよ〜。ぽちっとして',
    reading: 'きみのたーんだよ〜。ぽちっとして',
    cue: 'emo_joy_lo',
  },
];
const IDLE = [
  {
    text: 'おーい、置いてけぼりなんだけど？',
    reading: 'おーい、おいてけぼりなんだけど？',
    cue: 'sys_awkward',
  },
  {
    text: 'きみ、どこいったの〜。待ってるんだけど',
    reading: 'きみ、どこいったの〜。まってるんだけど',
    cue: 'emo_sad_lo',
  },
  {
    text: 'ひま。まだ？',
    reading: 'ひま。まだ？',
    cue: 'pose_arms_crossed',
  },
];

function chooseLine(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('waiting') || m.includes('idle') || m.includes('input')) return pick(IDLE);
  return pick(PERMISSION);
}

speak(chooseLine(readPayload().message), 'notify-hook');
