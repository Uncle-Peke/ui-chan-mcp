#!/usr/bin/env node
// Reaction hook (PreToolUse:Task / PostToolUse / SubagentStop / Stop /
// PreCompact): report what is actually happening in the session, so ういちゃん
// can react to it instead of only speaking when the agent remembers to call
// set_cue.
//
// This file only decides *which event happened*. What she says about it — the
// lines, the weights, how often she bothers, the affinity gates — is the
// matching `eventCues.events` pool in ui-chan.config.json, and the app applies
// the cooldown. The one piece of judgement that has to live here is which tool
// results are worth reporting at all, because only the hook payload knows that.
const { readPayload, fireEvent } = require('./lib/mascot');

/** Tools where a failure is an event worth a face, not just a normal outcome
 *  (a grep that found nothing is not news). */
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

function chooseEvent(payload) {
  switch (payload.hook_event_name) {
    case 'PreToolUse':
      // Only the agent-spawning tool reaches here (see the matcher in hooks.json).
      return payload.tool_name === 'Task' ? 'agent_out' : null;
    case 'SubagentStop':
      return 'agent_back';
    case 'PostToolUse':
      return LOUD_TOOLS.has(payload.tool_name) && isFailure(payload) ? 'tool_failure' : null;
    case 'Stop':
      return 'turn_done';
    case 'PreCompact':
      return 'compact';
    default:
      return null;
  }
}

fireEvent(chooseEvent(readPayload()), 'reaction-hook');
