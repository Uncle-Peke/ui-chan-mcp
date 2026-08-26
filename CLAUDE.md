# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server that drives a desktop mascot: any MCP-capable agent calls tools
(`set_cue`, `adjust_affinity`, …) and a transparent always-on-top Electron
window renders a PSD-based character with a speech bubble, lip-sync, and TTS
voice. The repo is *also* a Claude Code plugin/marketplace that ships the MCP
server plus the "ういちゃん" persona.

The mascot art (PSD) is **not** in the repo (licensed). Without a `.psd` in
`assets/`, the app shows a placeholder but still runs.

## Commands

```bash
npm install
npm run build      # tsc (src → dist) + esbuild-bundle the renderer + copy index.html
npm run app        # build, then launch the Electron display app
npm run stop       # kill a running ui-chan Electron app
npm run restart    # stop + relaunch the app
npm run mcp        # run the MCP server standalone (node dist/mcp-server.js)
npm run editor     # launch the visual Cue editor (雨衣ちゃんのデバッグルーム)
npm run debug      # interactive debug console (direct WebSocket, no MCP)
npm run debug:launch    # launch the app and drop into the debug console
npm run debug:restart   # stop a running app, then launch the app and drop into the debug console
npm run debug:state     # one-shot get_state over direct WebSocket
npm run debug:list      # list cues + configured IdlingCues/chatter
npm run lint       # biome check .   (lint:fix / format to autofix)
npm run dump-psd -- assets/ui_sozai.psd   # dump PSD layer tree (for adapting config to a new PSD)
```

There is **no test runner**. End-to-end checks are manual scripts:

```bash
node tools/debug.mjs                                 # interactive REPL for Cue/IdlingCue verification
node tools/debug.mjs cue happy こんにちは こんにちは         # one-shot direct WebSocket call
node tools/debug.mjs idle                            # force-run a random IdlingCue
node tools/debug.mjs --launch                        # auto-launch the app, then enter REPL
node tools/ws-test.mjs set_cue '{"cue":"happy","text":"テスト","reading":"てすと"}'   # minimal one-shot WebSocket test
node tools/mcp-test.mjs                              # drive the MCP server over stdio (E2E)
```

`tools/debug.mjs` bypasses the MCP server entirely and talks to the app's WebSocket. It is useful for manually checking Cues, forcing IdlingCues/chatter, and inspecting state without an MCP-capable agent. The commands it exposes (REPL or one-shot) are: `cue`, `state`, `clear`, `affinity`, `restart`, `idle [name]`, `poke [hover]` (fire a fidget interaction), `list`, `preview <cue>`, `refresh`, and `watch`. It reads TTS credentials from `.env` in the project root (copy `.env.example`) and forwards them to the app on connect.

Always `npm run build` before running — both entry points execute compiled
`dist/`, not the TypeScript sources.

## Architecture

Two processes, connected by a local WebSocket. **The MCP server is a thin
stateless bridge; all mascot state lives in the Electron app.**

```
Agent ──stdio──▶ dist/mcp-server.js ──WS(127.0.0.1:8123)──▶ Electron main (dist/app/main.js)
                 (auto-launches app                          ├─ UiChanState  (queue, affinity, idle timers)
                  if unreachable)                             ├─ WebSocketServer (hosts :8123)
                                                              ├─ VoiSonaTalkClient (TTS)
                                                              └─ IPC ▶ renderer (PSD compositing, bubble, blink, lip-sync)
```

- `src/mcp-server.ts` — MCP tool defs (zod schemas) → forwards each call as a WS
  request via `wrapTool()`. `ensureConnected()` runs on **every** tool call: if
  the socket is dead it reconnects, and if the app is unreachable it
  `launchApp()`s a detached `electron [projectRoot]`. This is why killing the
  Electron app and then calling any tool self-heals with the latest `dist/`
  build (auto-relaunch; 10s guard between launch attempts). Multiple agents
  can connect at once.
- `src/app/main.ts` — Electron entry. Owns the `WebSocketServer`, instantiates
  `UiChanState`, wires TTS, forwards render commands to the renderer over IPC.
- `src/app/state.ts` — **the brain.** Speech queue + one-at-a-time pump, Cue
  state, affinity, chatter/IdlingCue timers, and all the emit(RenderCommand)
  calls. Read this first for any behavior change.
- `src/renderer/renderer.ts` — runs in the BrowserWindow. Parses the PSD with
  `ag-psd`, composites visible layers to canvas, drives Blink + lip-sync.
  Ambient idle motion (yawn, look-around, doze, …) used to live here as a
  separate renderer-local "gesture" system with its own data file
  (`gestures.json`) and its own snapshot/restore mechanism; it's since been
  folded into `state.ts`'s IdlingCue mechanism (see below) — those motions are
  now ordinary Cue files under `cues/idling_*.json`, hot-reloadable like any
  other Cue. Bundled separately by esbuild (browser IIFE) — it is not part of
  the tsc build graph.
- `src/renderer/psd-stage.ts` — the reusable PSD compositing core (`PsdStage`):
  parse PSD → layer tree, apply `select`/`show`/`hide`, paint to a canvas, plus
  `diffFrom(baseline)` (the inverse — a live look minus a baseline, as minimal
  Cue directives). Extracted from `renderer.ts` so the mascot renderer **and**
  the Cue editor share one implementation of the PSDTool layer semantics; it
  knows nothing of blink/lip-sync/bubble/IPC (those stay in `renderer.ts`). Also
  esbuild-bundled, not in the tsc graph.
- **Cue editor** (`npm run editor`, "雨衣ちゃんのデバッグルーム") — a *separate*
  Electron entry (`src/app/editor-main.ts` + `editor-preload.ts` +
  `src/renderer/editor.ts`/`editor.html`, own esbuild bundle), opaque/framed,
  independent of the mascot app. Visually authors single Cues (表情): toggle the
  raw PSD layer tree (PSDTool-style radios/checkboxes) over the `default` base
  in a self-rendered preview, tune `voice` on sliders with a TTS 試し喋り button
  (lip-sync included), and save the delta as a `cues/<name>.json` — CRUD, with
  ajv validation on write and an IdlingCue-reference warning on delete. Saving
  is picked up live by a running mascot via `watchCues`. Writes only the
  **diff vs `default`** (`PsdStage.diffFrom`); `default` itself is the fixed
  base and is never editable here. IdlingCue/sequence ("動き") editing is
  deliberately out of scope (phase 2).
- `src/app/tts.ts` — VoiSona Talk REST client. `src/app/cues.ts` — loads,
  ajv-validates against `cue.schema.json`, and hot-watches `cues/*.json`.
  `src/shared/types.ts` — the RenderCommand / SpeechItem / Cue / config
  contract shared across processes.

### PSD layer convention (PSDTool format)

Layer names encode selection semantics: `!name` = required folder, `*name` =
radio option (exclusive among siblings). Everything the app does is expressed
as layer directives — `select` (pick a `*` radio, hiding its siblings) and
`show` / `hide` (toggle normal layers). Paths are `/`-joined and must match PSD
layer names exactly; unknown paths are ignored and surfaced in `get_state`'s
`warnings` (so swapping in a different PSD degrades safely instead of
crashing). The renderer also keeps an internal `findSelect(folder, name)` for
lip sync's mouth-radio lookup, but that is not part of the `LayerDirectives`
wire type — there is no `find` directive on the wire anymore.

One PSD-name directive is honored in code: a radio named `…(【folder】は非表示)`
(e.g. `*腕組み(奥の腕は非表示)`, whose crossed-arms art already draws both arms)
means selecting it must **also** hide that other folder. `PsdStage.selectPath`
parses the name and selects `!【folder】/*(非表示)` (its show-nothing radio),
so both the mascot and the editor honor the dependency; hand-authored cues that
use `腕組み` still list both selects explicitly (the auto-hide is idempotent with
that). This is the only cross-folder name dependency in the PSD.

### Cue: the single unit of visual + voice operation

- **Cues** live one-per-file in `cues/<name>.json`; the filename *is* the `cue`
  name passed to `set_cue`. Each is a flat, fully self-contained
  `select`/`show`/`hide`/`blink` (raw PSD layer paths, no named
  face/pose/arms split) plus an optional `voice` block
  (`style_weights`/`alp`/`huskiness`) baked in as that Cue's voice color.
  Validated at load time against `cue.schema.json` (the schema is the source
  of truth, not duplicated hand-written constraints). There is no inheritance
  between Cues and no intensity knob: a stronger variant is just another Cue
  file (e.g. `angry` vs. `gekioko`, `happy` vs. `happy_strong`). **Saving a
  Cue hot-reloads it live** — no app restart needed. Malformed/invalid files
  are skipped + warned, per-file, so one bad Cue doesn't break the rest.
- **`cues/default.json`** is the one Cue every other Cue is composited on top
  of (`state.ts`'s `composeDirectives()`): `default`'s directives, then the
  requested Cue's directives, later entries winning on shared radio groups.
  This is the *only* layering the system does — there is no separate
  pose/expression/face-part axis anymore. If a combination isn't covered by
  an existing Cue, the fix is a new Cue file, not a runtime tool for
  composing parts (see "rejected designs" below).
- There is no `set_face`/`set_pose`/`set_expression`/`say`. `set_cue` is the
  only agent-facing visual tool, and it takes the Cue and the (optional) line
  to speak in the same call — see "timing model" below for why.
- Each Cue may carry an optional `description` (what scene/feeling it's for)
  and `internal` (excludes it from the AI-facing catalog below — used for the
  IdlingCue building-block Cues, `cues/idling_*.json`). Neither field affects
  `set_cue`/`composeDirectives()` at all; they exist solely for the `persona`
  prompt's generated catalog (see below).
- `docs/CUES.md` is a hand-maintained reference catalog (raw PSD layer paths
  for parts not currently baked into any Cue, an "eyes/mouth/brows/..." parts
  table) for *authoring* new Cues. Deliberately in `docs/`, not `context/`:
  `context/*.md` is swept wholesale into the AI's session by the `persona`
  prompt and the SessionStart hook, and this file's raw layer-path listings
  are meaningless token spend for that audience — it's for whoever (human or
  agent) is writing a *new* Cue file, not for the roleplay agent calling
  `set_cue`. It is **not** loaded at runtime or injected into any prompt.

### IdlingCue: self-initiated Cue+line sequences during Idling

Per VISION.md's ubiquitous language, **Idling** is the base "nothing being
performed" state, and an **IdlingCue** is a short Cue-based performance
occasionally played during Idling — a subtype of Cue, not a separate
mechanism. `state.ts` implements this as one pool (`idle.idlingCues` in
`ui-chan.config.json`) with weighted random selection and affinity gating:

- Each item is an `IdlingCue`: `{name?, steps: [{cue?, text?, reading?, holdMs?}], weight?, minAffinity?, maxAffinity?}`.
- `weight` controls rarity (higher = picked more often). Use it to make ambient
  motion common and longer chatter lines rare without needing a second timer.
- `minAffinity` gates an item so it only plays when affinity is high enough.
- `maxAffinity` gates an item so it only plays when affinity is low enough —
  useful for cold or sulky reactions that should stop appearing once the mascot
  warms up to the user.
- `idle.idlingCues` fires on a single schedule (default every 12–30s); the
  old separate `idle.chatter` pool has been merged into this one pool.

`source` is `'idling-cue'` for auto-scheduled steps and `'debug'` for steps
forced via the debug console, for `cue.agent` / speech `agent` bookkeeping.

**`holdMs` only times silent steps.** A step with `text` advances when that
line *actually* finishes playing (real TTS audio duration if synthesized,
else `estimateSpeechDurationMs`'s text-length guess — see `SpeechItem.onComplete`
in `state.ts`), not after a separately-authored `holdMs`. This closes the one
remaining gap where a multi-step sequence could switch Cue while the previous
line's audio was still playing: `enqueueSpeech()` is the single place a
speech duration is ever resolved (`durationMs` argument if given, else LEN(text)
via `estimateSpeechDurationMs`, refined again by `startSpeech()` once real
audio length is known), and `playIdlingCueStep()`'s `onComplete` callback is
what actually advances the sequence — never a second, independently-guessed
timer. `holdMs` still fully controls steps with no `text` (there's nothing to
wait for otherwise).

### EventCue: reactions to what happens in the session

Per VISION.md, an **EventCue** is a CueSequence fired by something that happened
*around* her — a command failed, a subagent came back, Claude Code is waiting on
the user, the context is about to be compacted. It is the third user of the same
`CueSequence` shape as IdlingCue and FidgetCue; only the trigger and priority
differ (`PRIORITY.event` sits above idle filler and below the agent).

The trigger lives outside the app: `hooks/reaction.js` and `hooks/notify.js` map
a Claude Code hook payload to an **event name** and post
`{tool: 'event_cue', args: {event}}` over the WebSocket. That is *all* the hooks
decide. Everything else — which lines exist, weights, affinity/time gates, the
cooldown, and the chance roll — is `eventCues.events.<name>` in
`ui-chan.config.json`, resolved by `state.ts`'s `fireEventCue()`.

The split matters: hooks are separate short-lived processes, so any throttle
they own has to be invented (a temp file) and is invisible to every other
trigger. Keeping it in the app means one clock shared by hooks, the debug
console, and anything added later, and it means editing what she says is a JSON
edit with no hook code involved.

- `cooldownSec` is shared by every event with the same `throttleKey` (default:
  the event's own name). Ambient commentary (`tool_failure`, `turn_done`,
  `compact`) shares one `ambient` key so she can't chain lines; `agent_out` and
  `agent_back` are deliberately separate so a send-off never silences the
  matching return.
- `chance` (0–1) is for events that fire every turn — `turn_done` is 0.35, so
  finishing a turn stays a beat rather than a verbal tic.
- `permission` / `idle_wait` use `cooldownSec: 0`: being throttled while trying
  to fetch an absent user is the one case where silence is the wrong answer.
- Debug: `npm run debug` → `event <name>` (Tab-completes). A forced fire skips
  cooldown and chance and does **not** stamp the cooldown, so previewing a line
  can't silence the next real one. Affinity/time gates still apply.

### Rejected designs (do not reintroduce)

`extends` inheritance between scenes; named wrapper fields (`pose`,
`face_parts`, `arms`, `voice.style`) instead of raw layer paths; and
`set_face`/`set_pose` runtime composition tools were all explicitly proposed
and rejected during the Cue redesign (see the old repo's `REBUILD_BRIEF.md` if
it's still around) — the tradeoff accepted was less runtime flexibility in
exchange for a large, curated Cue catalog. Don't re-propose any of these.

### set_cue timing model

`set_cue(cue, text?, ...)` confirms the Cue and the line together in one call,
so there's no window where the face and the voice disagree about which Cue is
"current" — the older `say` + `set_expression` split caused exactly that class
of bug (sticky expression reverting mid-utterance, etc). `text` is optional:
omitting it changes the look silently. There is no `priority` — `set_cue`
always overwrites unconditionally. `duration_ms` means bubble-display time
when `text` is given, or how long to hold the Cue before easing back to
`default` when it's omitted (see `holdVisual()` in `state.ts`).

### TTS ↔ Cue coupling

`set_cue(cue)` drives both face and voice: the Cue's own `voice` block
(`style_weights`/`alp`/`huskiness`) is passed straight through to VoiSona
Talk's `global_parameters` — no blending, no intensity scaling. `set_cue`
additionally accepts optional `pitch`/`speed`/`volume`/`intonation` for
one-line ad-lib delivery, merged into the same `global_parameters` on top of
the Cue's baked-in values. Each queued `SpeechItem` carries the `cue` it was
spoken under (fixed at `set_cue` call time), so a later `set_cue` can't
retroactively recolor an in-flight line's voice. Lip-sync is phoneme-timed
from the synthesized audio; if the engine is unreachable it falls back to
kana-driven mouth movement from `set_cue`'s `reading` (60s cooldown before
retry). Credentials come from `UI_CHAN_TTS_USERNAME` / `UI_CHAN_TTS_PASSWORD`
env vars passed through the MCP bridge in memory — never written to
`ui-chan.config.json` or committed.

## Persona (this repo's character lives outside the code)

The MCP server ships only the *body* (tools). The "ういちゃん" personality is
context injected into the agent, defined in Markdown:

- `persona/ui-chan.md` — base persona + tool-usage rules (always pass `reading`,
  keep `set_cue`'s `text` to 1–2 sentences, the affinity system, the persona boundary).
- `context/*.md` — loaded in filename order: `SOUL.md` (values/inner life),
  `VOCABULARY.md` (vocabulary, catchphrases, NG words), `AFFINITY.md`. Anything
  placed here is swept wholesale into the AI's context — keep it to things the
  roleplay agent should actually know, not authoring reference material (see
  `docs/CUES.md` above for why that lives outside `context/`).
- `src/app/persona.ts` — **the one implementation** of "the character as text":
  the persona file, every `context/*.md` in filename order, and a Cue catalog
  generated fresh from `cues/*.json` (every non-`internal` Cue's name, label and
  `description`). Never a hand-maintained list, so it can't go stale.

### How it reaches a model (three doors, one text)

| Door | Who gets it | When |
|---|---|---|
| MCP handshake `instructions` | **every** MCP client, Claude Desktop included | on connect, automatically |
| `hooks/session-start.js` | Claude Code (plugin install) | at session start |
| MCP prompt `persona` (`/mcp__ui-chan__persona`) | every MCP client | manually, to reload after editing |

All three call `buildPersonaText()`. The hook used to build its own copy; that
duplication is gone, and with it the class of bug where the mascot behaved
differently depending on which door the persona came through.

The handshake is what makes the plugin optional: plugins are a Claude-Code-only
concept, so without `instructions` any other client would get the *body* (tools)
with no character behind it. Escape hatches, for when both doors are open and
the double injection isn't wanted: `UI_CHAN_NO_PERSONA_INSTRUCTIONS=1` (server
side) and `UI_CHAN_NO_PERSONA_HOOK=1` (hook side; keeps the app-launch half).

`agents/` (talk, mode) and `skills/` (talk, mode, beam, eli14) are the plugin's
subagents and slash commands. To retarget a different character, rewrite
`persona/` + `context/` and the PSD layer mappings in `ui-chan.config.json` +
`cues/`.

## Editing notes

- Renderer changes are **not** picked up by `tsc` alone — they need the esbuild
  step; just run `npm run build`.
- Behavior changes to state/queue/idle/affinity almost always mean `state.ts`.
- Affinity is session-only and resets to the config default on app restart.
