#!/usr/bin/env node
// Fire one EventCue by name, from anywhere:
//
//   bin/ui-chan-node hooks/fire-event.js tool_failure
//
// The Claude Code hooks read a payload from stdin and decide the event
// themselves; this is the same last step exposed for hosts whose plugin
// runtime isn't JavaScript (the Hermes plugin is Python and spawns this). It
// keeps the "a trigger only names the event" rule intact — the lines, weights,
// cooldowns and affinity gates stay in ui-chan.config.json, one copy for every
// host.
const { fireEvent } = require('./lib/mascot');

fireEvent(process.argv[2], process.argv[3] ?? 'external-hook');
