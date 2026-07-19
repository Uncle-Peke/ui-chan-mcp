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
npm run mcp        # run the MCP server standalone (node dist/mcp-server.js)
npm run lint       # biome check .   (lint:fix / format to autofix)
npm run dump-psd -- assets/ui_sozai.psd   # dump PSD layer tree (for adapting config to a new PSD)
```

There is **no test runner**. End-to-end checks are manual scripts:

```bash
node tools/ws-test.mjs set_cue '{"cue":"happy","text":"テスト","reading":"てすと"}'   # hit the app's WebSocket directly
node tools/mcp-test.mjs                            # drive the MCP server over stdio (E2E)
```

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
mechanism. `state.ts` implements this as one mechanism (`performIdlingCue()` /
`playIdlingCueStep()`) shared by two independently-scheduled pools in
`ui-chan.config.json`'s `idle` section:

- `idle.idlingCues` — fires often (default every 12–30s). Pool mixes silent
  ambient motion (`あくび`/`きょろきょろ`/`ぼんやり`/`うたた寝`/`くすくす`/`ため息`,
  each step wearing a `cues/idling_*.json` Cue, no `text`) with short speaking
  bits (`傘さし`, `のび`, …, each step a real Cue + line).
- `idle.chatter` — fires rarely (default every 180–360s). Same shape
  (`items: IdlingCue[]`), just its own slower cadence; every line now also
  specifies a `cue` (earlier versions left the Cue untouched during chatter).

Both pools are `IdlingCue[]` (`{name?, steps: [{cue?, text?, reading?,
holdMs?}]}`) — the *same* type `set_cue`'s idle.actions used before this was
unified with the old renderer-local "gesture" system (see the `renderer.ts`
bullet above). `source` (`'idling-cue'` / `'idle-chatter'`) tags which pool
triggered a given step, for `cue.agent` / speech `agent` bookkeeping.

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
- The `persona` MCP prompt handler also appends a generated Cue catalog
  (`buildCueCatalog()` in `mcp-server.ts`): every non-`internal` Cue's name +
  `description`, read fresh from `cues/*.json` each time the prompt runs. This
  is how the agent learns what Cues exist and what they're for — not a
  hand-maintained doc, so it can't go stale the way one would.

When installed as a plugin, the `hooks/session-start.js` SessionStart hook
auto-injects `persona/` + `context/*.md` each session (it does **not** run
`buildCueCatalog()` — that only happens via the MCP `persona` prompt itself,
so a plugin-only session gets the persona/context text but not the live Cue
catalog unless something also calls `/mcp__ui-chan__persona`). `agents/`
(ui-chan, ui-mode) and `skills/` (ui-beam, ui-chan, ui-mode) are the plugin's
subagents and slash commands. To retarget a different character, rewrite
`persona/` + `context/` and the PSD layer mappings in `ui-chan.config.json` +
`cues/`.

## Editing notes

- Renderer changes are **not** picked up by `tsc` alone — they need the esbuild
  step; just run `npm run build`.
- Behavior changes to state/queue/idle/affinity almost always mean `state.ts`.
- Affinity is session-only and resets to the config default on app restart.
