#!/usr/bin/env node
// Notification hook: when Claude Code needs the user's attention (a permission
// prompt, or the prompt sitting idle waiting for input), let ういちゃん poke
// them from her speech bubble.
//
// The lines live in sequences/event/permission/ and sequences/event/idle_wait/,
// and ui-chan.config.json gives both no cooldown, because being
// ignored when she is trying to fetch the user is the one case where staying
// quiet is the wrong call.
const { readPayload, fireEvent } = require('./lib/mascot');

const message = String(readPayload().message || '').toLowerCase();
const waiting = message.includes('waiting') || message.includes('idle') || message.includes('input');

fireEvent(waiting ? 'idle_wait' : 'permission', 'notify-hook');
