# アーキテクチャ — 設計判断と、そう決めた理由

> **コードを直すとき**に読みます。準備とコマンドは [DEVELOPMENT.md](DEVELOPMENT.md)、
> 用語は [../VISION.md](../VISION.md) に。
>
> ここは**誰の環境でも同じこと**だけを書く場所です。手元のマシン固有の事情
> （アカウントの使い分け、認証、個人の作業手順）は、git 管理外の `CLAUDE.md` /
> `AGENTS.md` に置いてください——このリポジトリは公開されています。

## What this is

An MCP server that drives a desktop mascot: any MCP-capable agent calls tools
(`set_cue`, `adjust_affinity`, …) and a transparent always-on-top Electron
window renders a PSD-based character with a speech bubble, lip-sync, and TTS
voice. The repo is *also* a Claude Code plugin/marketplace that ships the MCP
server plus the "ういちゃん" persona.

The mascot art (PSD) is **not** in the repo (licensed). Without a `.psd` in
`~/.ui-chan/assets/` (or the clone's `assets/`), the app shows a placeholder but
still runs.

## Install layout (package vs. user data)

`src/shared/paths.ts` is the single answer to "package or user?". The package
(clone or `node_modules`) holds code, the packaged cue catalog, persona/context
and the **default** config; `~/.ui-chan` (`UI_CHAN_HOME`) holds the user's PSD,
`.env`, `config.json` overrides and hand-authored cues. An update replaces the
first and never touches the second — before this split, a `claude plugin
install` copy owned the user's PSD and credentials, and they died with the
cache. Resolution is per-resource: config deep-merges over the packaged
default, `cues/` and `context/` load from both (home wins on the same
filename), persona/assets take the first hit, `.env` loads from both with real
env vars still winning. `loadCues`/`findPsd`/`watchCues` therefore take an
**array of dirs**, and the editor writes to `paths.cueWriteDir` (home when it
exists, the repo in a bare clone).

**The package must never carry third-party-licensed files.** Two of them: the
mascot PSD (redistribution forbidden) and VoiSona Talk with its voice libraries
(TechnoSpeech's product — ui-chan only `open -a`s the copy the user installed
and calls its local REST API; nothing of it is bundled). So `files` omits
`assets/`, and `prepublishOnly` runs `tools/setup/check-package.mjs`, which
inspects the real `npm pack` output and fails on any `.psd`, `assets/`, `.env`,
key/backup, app/installer, native binary or audio/voice-library file. **The
package is public**, so that check is now the only thing between a mistake and
the registry — never weaken it to make a publish go through. Users bring their
own PSD and their own VoiSona Talk; `dist/` is gitignored but shipped in the
tarball (built by `prepublishOnly`, and in CI by `release.yml` so what is
published is never "whatever was in someone's working copy").

Installation is one CLI, `bin/ui-chan.mjs` (`ui-chan`), with everything
client-specific in `tools/setup/clients.mjs` — a new MCP host is one entry in
that table (config path, entry shape, install, uninstall), never a new script.
Most hosts are `jsonClient(...)`; the two that aren't show what an entry may
carry: OpenCode adds its EventCue plugin to the same file via `extras`, and
Hermes edits YAML **line-wise** around a `# >>> ui-chan` marker block (a
round-trip parse would need a YAML dependency and would rewrite the user's
comments) plus copies a Python plugin dir into `~/.hermes/plugins/`.
The registered command is always
`<pkg>/bin/ui-chan-node <pkg>/dist/mcp-server.js`, so GUI-launched clients get a
node that exists. The repo-root `.mcp.json` is **gone**: `${CLAUDE_PLUGIN_ROOT}`
only expands inside a plugin context, so it broke every other host (and the repo
opened directly in Claude Code). The plugin now ships skills/agents/hooks only.

## Commands

```bash
npm install
npx ui-chan        # interactive setup TUI (home dir, PSD, credentials, clients)
npx ui-chan doctor
npm run build      # tsc (src → dist) + esbuild-bundle the renderer + copy index.html
npm run app        # build, then launch the Electron display app
npm run stop       # kill a running ui-chan Electron app
npm run restart    # stop + relaunch the app
npm run mcp        # run the MCP server standalone (node dist/mcp-server.js)
npm run editor     # launch the visual Cue editor (雨衣ちゃんのデバッグルーム)
npm run lint       # biome check .   (lint:fix / format to autofix)
npm run dump-psd -- ~/.ui-chan/assets/ui_sozai.psd   # dump PSD layer tree
```

There is **no test runner**. End-to-end checks are manual scripts:

```bash
node tools/ws-test.mjs set_cue '{"cue":"happy","text":"テスト","reading":"てすと"}'   # minimal one-shot WebSocket test
node tools/mcp-test.mjs                              # drive the MCP server over stdio (E2E)
```

The interactive debug console (`tools/debug.mjs`) is **gone**. It existed so a
human could drive the mascot without an MCP client; an AI agent working on this
repo has the MCP tools and reproduces anything it needs through them, which left
the console as a second, drifting surface to maintain. The app's WebSocket
`debug` actions (`trigger_idle`, `trigger_event`, `preview_cue`, `set_affinity`,
`interact`) are still there and are three lines of `new WebSocket(...)` away —
that is the layer to reach for when something can't be triggered over MCP
(IdlingCues and EventCues have no MCP tool), and affinity now also has a slider
in the panel's gear.

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
  now ordinary IdlingCue files under `sequences/idling/`, hot-reloadable like
  any other content. Bundled separately by esbuild (browser IIFE) — it is not part of
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
  face/pose/arms split) plus an optional `voice` block (`style_weights` only)
  baked in as that Cue's voice color.
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
  and `internal` (excludes it from the AI-facing catalog below — for a Cue the
  agent shouldn't pick directly; the shipped catalog has none left, since fixed
  lines carry their own looks — see below). Neither field affects
  `set_cue`/`composeDirectives()` at all; they exist solely for the persona
  text's generated Cue catalog (see below).
- `docs/PSD_LAYERS.md` is a hand-maintained reference catalog (raw PSD layer paths
  for parts not currently baked into any Cue, an "eyes/mouth/brows/..." parts
  table) for *authoring* new Cues. Deliberately in `docs/`, not `context/`:
  `context/*.md` is swept wholesale into the AI's session by the persona text
  (handshake `instructions` and the SessionStart hook), and its raw layer-path listings
  are meaningless token spend for that audience — it's for whoever (human or
  agent) is writing a *new* Cue file, not for the roleplay agent calling
  `set_cue`. It is **not** loaded at runtime or injected into any prompt.

### Fixed lines live in `sequences/`, with their own looks

IdlingCue, EventCue and FidgetCue are all the same `CueSequence` shape, and all
three are **authored ahead of time** — no agent is involved. They live one file
per sequence under `sequences/`, and the **directory is the pool**:

| path | pool |
|---|---|
| `sequences/idling/<name>.json` | IdlingCue |
| `sequences/presence/away.json`, `wake.json` | the system-idle gate's doze / wake-up |
| `sequences/fidget/poke/<name>.json`, `fidget/spam/<name>.json` | FidgetCue |
| `sequences/event/<event>/<name>.json` | EventCue |

The file name is the sequence's name (`trigger_idle umbrella`). Package and
`~/.ui-chan/sequences` are both read, and **the same relative path in home
wins** — the rule `cues/` already had. `ui-chan.config.json` keeps only *how*
they play (intervals, the system-idle window, `cooldownSec`/`chance`); the lines
themselves are content, not settings. Validated by `sequence.schema.json` (its
look fields `$ref` `cue.schema.json`), hot-reloaded by a recursive watch.

Two decisions, both forced by something that went wrong:

- **Not in config.** They used to be arrays in `ui-chan.config.json`, and the
  home override replaces arrays wholesale (`deepMerge`): tuning one line from an
  npm install copied its whole pool into `~/.ui-chan/config.json`, where it never
  saw a package update again. Config wasn't hot-reloaded either. Per file, only
  the file you touched becomes yours.
- **Steps own their look.** A step is `{look?, text?, reading?, holdMs?, delivery?}`,
  where `look` is a Cue's `select/show/hide/blink/voice` without the name — there
  is **no way to reference an agent-facing Cue by name**. Borrowing them (68
  references to 31 generic Cues) meant that retuning a Cue's voice for the agent
  silently changed the fixed lines too: one pass over 36 Cues moved 33 of 62
  lines. The per-line voice patch that grew as a workaround
  (`delivery.style_weights`) is gone; a step's voice is its `look.voice`. The cost
  is duplication — fixing `emo_anger_lo`'s face no longer reaches the steps that
  copied it — accepted because it is the same "no inheritance, self-contained"
  trade the Cue catalog already made. Omitting `look` keeps the previous step's
  look and voice; `look: {}` is `default`.

A home `config.json` that still carries the old arrays keeps working:
`legacyPools()` converts them (resolving the old Cue names) and each replaces the
matching pool — exactly the old semantics — with a warning in `get_state`.

### IdlingCue: self-initiated Cue+line sequences during Idling

Per VISION.md's ubiquitous language, **Idling** is the base "nothing being
performed" state, and an **IdlingCue** is a short Cue-based performance
occasionally played during Idling — a subtype of Cue, not a separate
mechanism. `state.ts` implements this as one pool (`sequences/idling/`, paced
by `idle.idlingCues` in `ui-chan.config.json`) with weighted random selection
and affinity gating:

- Each file is an `IdlingCue`: `{steps: [{look?, text?, reading?, holdMs?, delivery?}], weight?, minAffinity?, maxAffinity?, hours?}`.
- `weight` controls rarity (higher = picked more often). Use it to make ambient
  motion common and longer chatter lines rare without needing a second timer.
- `minAffinity` gates an item so it only plays when affinity is high enough.
- `maxAffinity` gates an item so it only plays when affinity is low enough —
  useful for cold or sulky reactions that should stop appearing once the mascot
  warms up to the user.
- `idle.idlingCues` fires on a single schedule (default every 120–300s); the
  old separate `idle.chatter` pool has been merged into this one pool.

`source` is `'idling-cue'` for auto-scheduled steps and `'debug'` for steps
forced over the WebSocket `debug` action, for `cue.agent` / speech `agent` bookkeeping.

#### The system-idle gate (`idle.idlingCues.systemIdle`)

By itself the schedule above only ever measures **ういちゃん's own** activity
(every `scheduleIdlingCue()` call site is her finishing something), so she talks
over a user who is mid-keystroke and keeps talking to an empty chair. The gate
adds the other half: `powerMonitor.getSystemIdleTime()` — OS-wide seconds since
the last key or mouse event — injected into `UiChanState` as `systemIdleSec`
from `main.ts` (the class itself stays Electron-free; no source = gate off).

It is a **window**, not a threshold, and both edges are load-bearing:

| OS idle `t` | meaning | behavior |
|---|---|---|
| `t < minSec` (60s) | working | stay quiet |
| `minSec ≤ t < awaySec` | hands off the keys | play IdlingCues |
| `t ≥ awaySec` (15min) | away | `presence/away` once, then silence |
| `t` drops | they're back | `presence/wake` once |

A lower bound alone would still leave her performing to an empty desk, which is
the whole reason `awaySec` exists; `away` is a *doze* rather than plain
silence so the away state is visible instead of indistinguishable from a long
gap, and the wake-up on the way back is the payoff that state buys.

Implementation notes, all in `tickIdling()` (1s poll, armed only when gated):

- The countdown is kept in **OS idle seconds** (`idlingThresholdSec`), not wall
  clock, so “ういちゃん just spoke” and “the user is still sitting there
  quietly” compose into one number instead of two competing timers. Gated,
  `scheduleIdlingCue()` just pushes that bar further along the same axis.
- The first cue after the user goes quiet uses the shorter `[minSec,
  firstMaxSec]` roll; steady state returns to `[minSec, maxSec]` (120–300s).
- The idle counter only climbs while the user is away from the input devices,
  so **a drop is the one unambiguous input signal** — that's the wake trigger.
- `userAway` is sticky (only input clears it) so she sleeps through the whole
  absence. Both transitions have to respect what's playing: entering away
  **waits** for a lull (flipping the sticky flag mid-line would swallow the
  doze and never retry), while waking **preempts** via `preempt()` — but only
  when `effectivePriority() <= PRIORITY.idle`, so it cuts off her own snoring
  and never the agent.
- `presence/away.json` / `wake.json` are ordinary sequences. They're reachable
  by name over the WebSocket `debug` action (`trigger_idle` `away` / `wake`),
  but excluded from the random pick — their real triggers are 15
  minutes away, and a performance you can only see by waiting a quarter hour
  never gets looked at.
- `systemIdle.enabled: false` restores the pure wall-clock behavior exactly.

**`holdMs` only times silent steps.** A step with `text` advances when that
line *actually* finishes playing (real TTS audio duration if synthesized,
else `estimateSpeechDurationMs`'s text-length guess — see `SpeechItem.onComplete`
in `state.ts`), not after a separately-authored `holdMs`. This closes the one
remaining gap where a multi-step sequence could switch Cue while the previous
line's audio was still playing: `enqueueSpeech()` is the single place a
speech duration is ever resolved (`durationMs` argument if given, else LEN(text)
via `estimateSpeechDurationMs`, refined again by `startSpeech()` once real
audio length is known), and `playSequenceStep()`'s `onComplete` callback is
what actually advances the sequence — never a second, independently-guessed
timer. `holdMs` still fully controls steps with no `text` (there's nothing to
wait for otherwise).

### FidgetCue: being touched

Clicking her actual pixels fires a FidgetCue from `sequences/fidget/poke/`, which
preempts whatever is playing. Two rules learned by getting them wrong:

- **Every entry says something.** Silent "just change the face" entries read as
  her blinking at you in confusion — a reaction to being touched has to be a
  *reply*, so 「え、なに？」 rather than a wordless surprised face.
- **The cold lines were unreachable.** Affinity starts at 35 (`normal`), and
  the 「触んないで」 entries were gated `maxAffinity: 34`, so the one reaction
  people actually poke her to see could never fire. Being prodded *repeatedly*
  is annoying at any temperature, and it is the one irritation the user creates
  on purpose — so `interactions.spam` (default: 3 pokes within 4s) swaps in
  `sequences/fidget/spam/`, with the flavour still following affinity. Reacting resets the
  tally, so she snaps once rather than once per poke. Every poke counts toward
  it, including ones the cooldown swallows: the cooldown exists to stop
  *reactions* piling up, not to forgive the prodding.

### EventCue: reactions to what happens in the session

Per VISION.md, an **EventCue** is a CueSequence fired by something that happened
*around* her — a command failed, a subagent came back, Claude Code is waiting on
the user, the context is about to be compacted. It is the third user of the same
`CueSequence` shape as IdlingCue and FidgetCue; only the trigger and priority
differ (`PRIORITY.event` sits above idle filler and below the agent).

The trigger lives outside the app, once per host: `hooks/reaction.js` and
`hooks/notify.js` map a Claude Code hook payload to an **event name**, and
`plugins/opencode/ui-chan.mjs` does the same for OpenCode's `event` /
`tool.execute.before|after` hooks (`session.idle` → `turn_done`,
`permission.asked` → `permission`, `session.compacted` → `compact`,
`session.error` and a failed loud tool → `tool_failure`, the task tool →
`agent_out`/`agent_back`), and `plugins/hermes/ui-chan/` does it for Hermes
Agent's Python hooks (`pre_tool_call`/`post_tool_call`/`on_session_end`).
Hermes' plugin runtime isn't JavaScript, so it spawns `hooks/fire-event.js`
— the same last step, exposed for any host that can only run a command. All post
`{tool: 'event_cue', args: {event}}` over the WebSocket. That is *all* a trigger
decides — which is what keeps two hosts from drifting into different lines. Everything else — which lines exist, weights, affinity/time gates, the
cooldown, and the chance roll — belongs to the app: the lines in
`sequences/event/<name>/`, the throttle in `eventCues.events.<name>` of
`ui-chan.config.json`, both resolved by `state.ts`'s `fireEventCue()`. An event
exists if either side names it; with no settings it runs on the defaults.

The split matters: hooks are separate short-lived processes, so any throttle
they own has to be invented (a temp file) and is invisible to every other
trigger. Keeping it in the app means one clock shared by hooks, the WebSocket
debug action, and anything added later, and it means editing what she says is a
JSON edit with no hook code involved.

- `cooldownSec` is shared by every event with the same `throttleKey` (default:
  the event's own name). Ambient commentary (`tool_failure`, `turn_done`,
  `compact`) shares one `ambient` key so she can't chain lines; `agent_out` and
  `agent_back` are deliberately separate so a send-off never silences the
  matching return.
- `chance` (0–1) is for events that fire every turn — `turn_done` is 0.35, so
  finishing a turn stays a beat rather than a verbal tic.
- `permission` / `idle_wait` use `cooldownSec: 0`: being throttled while trying
  to fetch an absent user is the one case where silence is the wrong answer.
- Forcing one: the WebSocket `debug` action `trigger_event` with the event
  name. A forced fire skips cooldown and chance and does **not** stamp the
  cooldown, so previewing a line can't silence the next real one. Affinity/time gates still apply.

#### Writing EventCue lines: who is speaking, and what they're allowed to know

Two rules, both learned by getting them wrong. Every line in `sequences/event/`
(and `sequences/idling/`) has to satisfy both.

**1. うい is the observer, never the worker.** Per the persona boundary, the
work is done by Claude (or a subagent); ういちゃん watches from the side and
narrates it *to the user*. So the grammar of every line is fixed:

> **speaker = うい / listener = きみ (the user) / actor = Claude or お手伝いの子, in the third person (`〜だって`, `〜みたい`, `〜らしい`)**

Lines that slipped were all the same shape — she'd taken the actor's seat:
`compact` said 「ちょっと**記憶の整理**するね」 (it's *Claude's* history being
compacted, not hers) and `agent_out` said 「この件は別の子に**投げた**」 (Claude
dispatched it) while the very next clause said 「ういは見てる」. Fixing them is
usually just moving to reported speech.

**2. A line may not know more than its hook passed.** The hooks send an *event
name* and nothing else, so the pool has no access to what actually happened:

| event | what's actually known | what is NOT |
|---|---|---|
| `permission` | stopped, waiting on the user | what it's asking for |
| `idle_wait` | prompt sitting idle | — |
| `tool_failure` | a Bash/Edit/Write-class tool failed (user aborts already filtered out in `isFailure`) | which tool, what error |
| `turn_done` | the turn ended | **whether it went well** |
| `compact` | about to compact (PreCompact — hasn't happened yet) | — |
| `agent_out` | about to dispatch (PreToolUse — hasn't gone yet) | what it was sent to do |
| `agent_back` | the subagent stopped | **whether it succeeded, what it returned** |

So `turn_done` must not appraise the work (「いい感じじゃん」「えらいえらい」 both
had to go — they fire just as happily on a turn that failed), and `agent_back`
must not claim 「仕事終わったみたいよ」 when "gave up" reads identically from
here. Saying she doesn't know is in character and better UX:
「どうだった？」/「何持って帰ってきたんだろね。」 push the user to go *look*, which
is what you wanted them to do anyway. `tool_failure` is blunt (「あ、こけた。」)
precisely because failure is the one outcome a hook does report.

A third, softer rule: an EventCue that fires on a *stall* (`idle_wait`) must not
reuse IdlingCue vocabulary. 「ひま。まだ？」 was indistinguishable from ambient
「ひま〜。」, which hid the one thing the user needed to know — that the session is
actually blocked on them.

Voice: `context/VOCABULARY.md` is authoritative for 一人称 (**「わたし」「うい」 —
not 「あたし」**) and for calling the user 「きみ」.

### 画面の隅への吸い付き（と、窓 ≠ 彼女）

ドラッグして離すと、近ければ画面の**下の隅**へ吸い寄せられる。実装の全部が、
一つの事実から出ている——**窓の矩形と「彼女に見える範囲」は全然違う**。

窓は 420x680 だが、絵が乗っているのはその一部だけだ。PSD が縦横とも数千pxある
のは万歳のように腕を広げるポーズのための幅で、`default` の彼女はその中央に立って
いるにすぎない。**どれだけ浮くかは PSD 次第**——開発時の素材では左右に100px前後の
透明帯があり、窓の右下を画面の右下に合わせても彼女は隅から100px以上浮いて見えた。
「吸い付いた」と読めない距離で、最初の実装はこれで失敗している。目が見ているのは彼女であって窓ではないので、**着地点もしきい値も実
ピクセルで測る**。

その箱はレンダラが合成後のキャンバスのアルファを走査して出し
（`PsdStage.contentInsets()`）、`ui-chan:body-box` で main に渡す。**一度きり**
なのが肝で、ポーズごとに測り直すと万歳しているときとしていないときで着地点が
変わる——同じ「右下」が Cue 次第で別の場所になるのは、位置としては壊れている。
最初に当たる look は `default`（全 Cue の土台そのもの）なので、それを基準として
固定する。

**下2隅だけ**。上に詰められないのは、窓の上部120pxが吹き出しの居場所として常時
確保されているから（`index.html` の `#bubble-area`）で、彼女の頭を画面上端に付け
ると喋った瞬間に吹き出しが画面外へ出る。置けない場所を候補に出しても、寄せたのに
何も起きないか、変な位置に落ちるかのどちらかにしかならない。

#### 窓が画面外にはみ出す、という前提

彼女を画面の縁に合わせる以上、**窓のほうは透明帯ぶん画面の外へ出る**。これが
効いてくるのは、窓の縁を基準に置かれていた全部だ：接続パネル（`right: 6px`）も
吹き出し（中央揃え）も、そのまま画面の外へ連れて行かれる。どちらも計測値
（`--body-left` / `--body-right`）で内側に寄せて解決している。

見た目は `RenderCommand` の **`side` 一報**（彼女が画面のどちら側に居るか）で
まとめて決まる。判定は「作業領域の左右どちら寄りに身体があるか」なので、吸い
付いていない位置でも破綻しない：

- **パネル**は彼女と同じ側へ。画面の外側の縁に沿って開くので、デスクトップの
  中央側——他のウィンドウが居る側——に張り出さない。
- **吹き出し**は画面の内側へ伸びる（右下なら左へ、左下なら右へ）。伸びる向きと
  反対側の端を身体の縁に合わせるので、長い行でも切れない。しっぽは箱の中央では
  なく**彼女の頭の真上**を指す（`--tail-x`、行ごとに幅が変わるので毎回置き直す）。
- **立ち絵**は左下にいるとき左右反転し、画面の内側を向く。

反転には、目に見えない落とし穴が2つある。`getBoundingClientRect()` は CSS の
`transform` を見ないので、**当たり判定だけは自分で座標を折り返す**必要がある
（`PsdStage.mirrored`）——入れないと、つつく場所とクリック透過の判定が左右逆に
なる。もう一つは Cue のクロスフェード用オーバーレイで、同じ変換をかけ忘れると
**切り替えの一瞬だけ反転前の絵＝左向きが素で見える**。

#### 数字と、動き

- `window.snapDistance`（既定 320px）— この距離以内なら吸い付く。
- `window.snapGap`（既定 12px）— 左右の縁に `margin` に**加えて**空ける逃げしろ。
  箱は `default` で測って固定してあるので、腕を広げる Cue はそれより外へ出る。
  指先が画面の縁で欠けるのはこれで、縦は下端揃えなので横だけ。
- `window.snapDurationMs`（既定 220ms）— `glideTo()` の easeOutCubic。一発で
  `setPosition` すると「窓が瞬間移動した」であって「吸い寄せられた」に見えず、
  逆に macOS 任せの `animate: true` は遅くて重い。あいだを取って自前で刻む。
  寄っている途中に掴まれたらドラッグを優先する（`drag-start` で中断）。

`homePosition()`（起動位置とリセット）も同じ基準を見る。**リセットと吸い付きが
別の場所に着地しないこと**が条件だからで、起動直後だけはまだ測れていないので窓の
矩形で置き、測れた時点で——ユーザーがまだ動かしていなければ——置き直す。

最後に一つ、地雷を踏んだ記録として：**`win.setPosition()` は整数しか受け取らない**。
実ピクセルの計測値は dpr 由来で `7.5` のような小数になるので、丸め忘れると
main プロセスごと落ちる（"conversion failure" のダイアログが出て、位置直しは
一度も効かない）。

### The connections panel (who is she talking to?)

With several hosts able to connect at once, the user needs to know *which*
session a line belongs to — but a permanent HUD next to the mascot breaks the
world, which is a hard non-functional requirement here. So the panel is
collapsed to a small ribbon tab at her feet — in the window's bottom-right
corner, or bottom-left when she is snapped to the left edge (see 「画面の隅への
吸い付き」above; the tab follows her so it can never end up off-screen): a **hamburger when 0–1 sessions are connected** (nothing to report; it is just a menu), the
**session count when 2+** are. The tab stays pinned to the bottom edge and the
body opens *upward* (`flex-direction: column-reverse`): at the top it fought the
speech bubble for the same space, and the bubble is her voice, so the panel is
always the one that yields — her feet are the one part no Cue touches, so
covering them costs no expression. It opens on click, and opens *itself* only on
a change into a multi-session state — the one thing the user cannot infer — then
folds away after 6s unless they pinned it open by clicking.

Identity comes from the bridge, not from guesswork: `hello` now carries the MCP
`clientInfo` name/version, `process.cwd()` and its basename, and the bridge pid
(`ConnectedAgent`). MCP has no session id, and a stdio server is one process per
client session, so **the connection is the session**, and `cwd` is what tells
two windows of the same client apart. Each connection also gets an incrementing
`id`, and "active" is set by **whichever connection last called a tool** —
matching on `name` would light up two rows when the same client is connected
twice. The list is pushed as an ordinary `RenderCommand` (`connections`) on
connect/disconnect/tool call, so the panel can never show a stale session.
Clicking a session row brings that client's app to the front: the pid is walked
up its parent chain until an `.app` bundle turns up (`node dist/mcp-server.js →
claude → zsh → login → Ghostty.app`), then `open -a`. Tabs are deliberately out
of scope — picking one needs AppleScript with a per-terminal dialect and a
permission dialog, and some terminals have no tabs at all.

Its buttons (`ui-chan:panel-action`) are icon-only in one row — text there
looked like an app toolbar, and icons keep the height fixed so the panel only
ever grows upward with sessions. Left to right: しずかに (mutes the *voice*
only; the bubble stays, because a fully blank mascot reads as broken), ひといき
(`clear` — stop talking and drop back to Idling), a **heart** that unfolds the
affinity slider, a **circular arrow** = 起動しなおす, and — pushed to the right
edge, away from the rest — おやすみ.

Three of those icons say something the code has to keep true:

- The heart is not a gear because affinity is the *only* thing behind it;
  naming it 設定 would promise a drawer that isn't there. If other settings
  appear, it goes back to being a gear. The slider is also the only place a
  human sets affinity directly — the agent's `adjust_affinity` stays
  direction+magnitude, so this can't be used to sneak past the asymmetric curve
  on her behalf.
- The circular arrow is the relaunch action, and what it is *for* lives in its
  tooltip (「起動しなおす（定位置に戻る）」) rather than in the glyph:
  `createWindow` recomputes the bottom-right position from the work area every
  time, so restarting is also the only way to recover a window dragged
  somewhere useless (or stranded off-screen by a display change). An arrow
  alone reads as "reload", which undersells that — hence the parenthesis in the
  title attribute.
- The `clear` icon is a **circle with a slash**: the action force-quits whatever
  is playing, which is neither muting nor undoing (an arrow), and a ■ only reads
  as "stop" next to ▶/⏸ — alone it is just a square. The prohibition sign
  carries "stop this" on its own, which is what a four-icon utility row needs.

**Who may launch the app** (`ensureConnected`'s `allowLaunch`). Only **bridge
startup** does — ≈ session start, where configuring the MCP server is itself
the request for a mascot (`hooks/session-start.js` is the Claude Code
equivalent). A tool call may **reconnect**, never launch.

It used to launch on every tool call. That sounds like self-healing and is
actually the user losing the ability to put the mascot away: quitting her was
undone by whatever the agent did next. Reconnect-only covers the case that
actually happens (the app is up, this bridge's socket went stale) without
deciding on the user's behalf that she should be on screen, and it removes the
question that made this hard — a dead socket means "crashed" and "the user quit
her" alike, and the bridge cannot tell. Now it doesn't need to: neither
relaunches. Two earlier attempts at that distinction (an `~/.ui-chan/asleep`
flag file, then a `goodnight` broadcast before `app.quit()`) are gone with it;
if she is genuinely down, the tool call fails in ~1.5s saying how to start her,
and starting her stays a person's choice.

### git 版 / npm 版 / コピー — 何が変わるか

`installKind(pkgRoot)` (`src/shared/paths.ts`) is the single definition, and
everything that differs keys off it. The differences are small but each one has
bitten:

| | git クローン | npm（グローバル） | npm（プロジェクト依存） | コピー（ZIP・プラグインキャッシュ） |
|---|---|---|---|---|
| 更新 | `git merge --ff-only` | `npm install -g <name>@latest` | 拒否（そのプロジェクト側の仕事） | `gh api …/tarball` を展開 |
| ブランチ指定 | 現在のブランチの追跡先（`--branch` は拒否＝checkout はユーザの仕事） | 不可（公開版のみ） | — | `--branch`、スタンプに記録して追従 |
| Cue の保存先 | クローンの `cues/`（カタログ本体を編集している） | `~/.ui-chan/cues`（node_modules は npm のもの） | 同左 | 同左 |
| `dist/` | 自分でビルド | 同梱 | 同梱 | 同梱 |

Two traps worth stating out loud:

- **npm のパッケージディレクトリに書いてはいけない。** npm はそこを丸ごと
  置き換えるし、metadata が「入っているもの」を嘘つきになる。だから
  `cueWriteDir` は git 以外では常にホーム、更新も `npm install` に委ねる。
  実際、`kindOf()` が ESM で `require()` を呼んで落ち、npm グローバル導入が
  gh 経路にフォールバックして tarball を npm の管理下へ展開した — テストで
  見つかった実バグで、この表の一行目がなぜ必要かの実例。
- **同じマシンに複数のコピーが同居しうる。** npm で入れて後からクローンする、
  はごく普通の流れで、そのとき「どのコピーが動いているか」はクライアントの
  設定に書かれたパスだけが決める。`ui-chan use` が登録済みクライアントを
  すべて *このコピー* に向け直し、`doctor` は別コピーを指している登録を
  警告する（クローンを直したのに npm 版が応答する、が一番分かりにくい）。

### Updating the tool itself

`ui-chan update` (and the panel's download icon) fast-forwards the install and
rebuilds it. Distribution is a git clone — the PSD and VoiSona can't be
packaged, so there is no npm tarball to `npm update` — which makes the update
three commands. The value is in what it refuses: never on a dirty tree, never
with unpushed commits, `--ff-only` or nothing. Failing with a reason is fine;
silently discarding someone's edits is not.

**Either git or gh is enough.** A clone made with `gh repo clone` still has
git (gh shells out to it), but a ZIP download, a copied directory, or a plugin
cache has no `.git` at all. So `checkUpdate`/`runUpdate` fall back to gh:
`gh api repos/<slug>/tarball` piped to `tar --strip-components=1 -C <pkgRoot>`,
which overwrites tracked files and leaves node_modules — and everything the
user added — alone. Since there is no git history to compare against, that path
records the commit **and branch** it installed in `.ui-chan-install.json`; with
no stamp yet, it reports "update available" rather than guessing, the update
being idempotent. The repo slug comes from the git remote, else
`package.json`'s `repository`.

**Neither path is main-only.** git follows whatever the current branch tracks
(`@{u}`), so checking out a feature branch is how you follow it — which is why
`--branch` is refused on a clone: switching branches is a checkout, the user's
call, not an updater's. The gh path had no branch at all until it was given
one; it now takes `--branch`, remembers it in the stamp, and keeps following it
on later updates (a branch switch counts as an update even when its commit is
"older", because the install is no longer what was asked for).

The app checks 8s after start and every 6h, in a **child process** (`git fetch`
touches the network; a hang must be a hung child, not a hung mascot). The
panel's 6th icon exists only while an update is waiting, and its arrival opens
the panel once — the same treatment a second session gets, for the same reason:
it's news the user cannot infer.

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
(`style_weights` — the voice library's five trained styles, mixed by weight) is
passed straight through to VoiSona Talk's `global_parameters` — no blending, no
intensity scaling.

**There are no numeric performance knobs, by decision.** `voice.alp` /
`voice.huskiness` and `set_cue`'s `pitch`/`speed`/`volume`/`intonation` all
existed, worked, and were used by **zero** of 81 Cues and almost no calls.
Handing an agent numbers costs it deliberation on every call ("what should this
one be?") on top of writing the line, and the measured effect was a large jump
in thinking time. So delivery is derived instead of dialled — see "Prosody"
below. Each queued `SpeechItem` carries the `cue` it was
spoken under (fixed at `set_cue` call time), so a later `set_cue` can't
retroactively recolor an in-flight line's voice. Lip-sync is phoneme-timed
from the synthesized audio; if the engine is unreachable it falls back to
kana-driven mouth movement from `set_cue`'s `reading` (60s cooldown before
retry).

### Prosody: 読み方は「書き方」から導出する（`src/app/prosody.ts`）

> 設計の全体像・耳で確かめた値・落第した案は **`docs/design/PROSODY.md`**。ここは要約。

セリフをどう読むかは、数値ではなく**そのセリフの書き方**から決まる。Markdown が
記法を発明せず「人がすでに打っていた書き方」を意味に昇格させたのと同じやり方で、
日本語の表記にもとからあるものをそのまま使う。**AI が新しく覚えるのは太字だけ。**

| 記法 | 実測（田中傘 2.0.1） | 実装 |
|---|---|---|
| `、` `…` `‥` | すでに `pau` が入る | **何もしない**（エンジンに任せる） |
| `ー` | すでに長音として伸びる | **何もしない** |
| `？` | `is_question` が付いて語尾が上がる | **何もしない** |
| `〜` | **完全に無視される** | 取り除き、最後の母音を `phoneme_durations` で伸ばす |
| `！` | 無視（強調にならない） | 何もしない（強調は太字で明示する） |
| `**語**` | `＊` として読まれ、余計な `pau` まで入る | 除去し、TSML の強調に翻訳 |

**TSML**（`POST /text-analyses` が返す解析結果）が、この全部の土台。`<word>` ごとに
`hl`（モーラ単位の高低）・`chain`（アクセント句の連結）・`pronunciation`・
`is_question` を持つ XML で、これを編集して `analyzed_text` として投げると `text` の
代わりに使われる。**AI に TSML を書かせてはいけない**——`pos` や `phoneme` はエンジンが
決めることなので、書かせれば必ず捏造する。必ず「解析させてから差分を当てる」。

耳で確かめて分かった、外してはいけない点が3つある。

- **`hl`（アクセント型）は書き換えない。** 強調のつもりで「本気」を `lhh`→`hll` に
  したら、強調ではなく**アクセントの違う別の語**に聞こえた（方言や読み間違いと同じ）。
  強調は**アクセント句を切り直し、直前に一拍置く**ことで作る。
- **`〜` を `ー` に置換してはいけない。** 長音は独立した語として解析され `hl="l"`
  （低）が付くため、**疑問の上げを潰す**（「言ってるー？」が上がらない）。伸ばすのは
  `phoneme_durations` でやり、解析結果には触らない。
- **`pau` を二重に数えない。** `phoneme_durations` は合成に使う音素列と同じ並びで
  渡す必要がある。その列は TSML から再現できる（`phonemeSequence()`、9例で実測一致）
  が、読点が作る `pau` と句境界の `pau` は**同じもの**なので、両方数えると全体が
  1つずれて、伸びる音素が別の場所になる。

**TSML の往復は必要な行だけ**（実測 +496ms）。`needsTsml()` が「太字・`〜`・辞書語を
含むか」を見て、どれも無ければ従来どおり `text` を投げるだけの経路を通る。解析結果は
キャッシュするので、IdlingCue / EventCue のような固定文では2回目以降ゼロ。解析に
失敗したら `analyzed_text` を付けずに送る——抑揚が付かないのは劣化だが、喋らないのは故障。

`tts.lexicon`（`ui-chan.config.json`）は**読みとアクセントを常に上書きする語**。「うい」は
品詞解析で連体詞に落ちて頭高になり、名前が毎回わずかに変な抑揚で呼ばれていた。行ごとの
演出ではなく、いつ誰が書いても同じように直すべき固定の誤りなので、AI ではなくアプリが持つ。

`reading` is not only for lip-sync: `state.ts`'s `ttsTextFor()` hands the engine
`reading` instead of `text` whenever `text` contains Latin letters or digits.
VoiSona spells Latin out in English (`zsh` → "ゼッドエスエイチ"), and the agent
already supplies a full hiragana `reading`, so that is the correct pronunciation
for those lines. The swap is deliberately *scoped* to that case rather than
always preferring `reading`: hiragana-only input costs the engine its
kanji-based accent estimation, and pure-Japanese lines (the majority) read
better from `text`. The bubble always shows `text`. This is why `persona/ui-chan.md`
carries a "`text` と `reading` の書き分け" section insisting that `reading` contain
no Latin characters at all. It states a *principle* — write what a Japanese speaker
actually says, from the model's own knowledge — not a lookup table: `NPO` is
えぬぴーおー and `k8s` is くーばねてぃす, and no hand-maintained table would ever
cover that split. The rule is character-agnostic, so it lives in the persona
entry (and in `set_cue`'s own tool description, the one door every MCP client
gets), not in `context/VOCABULARY.md`, which is ういちゃん's vocabulary.

The same section states the **other** half explicitly, and it has to: `text` is
written in ordinary Japanese orthography (`Linux` stays `Linux`, `0.1` stays
`0.1`). Left unsaid, the weight of the `reading` rules bleeds across and the
bubble starts reading 「リナックス」「バージョン零点一」 — the agent transcribing
the *sound* into the field that shows the *spelling*. Both fields' rules are
therefore stated as one pair ("表記は `text`、音は `reading`"), in the persona,
the tool description, and `text`'s own parameter description.

Credentials come from `UI_CHAN_TTS_USERNAME` / `UI_CHAN_TTS_PASSWORD`
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
  `docs/PSD_LAYERS.md` above for why that lives outside `context/`).
- `src/app/persona.ts` — **the one implementation** of "the character as text":
  the persona file, every `context/*.md` in filename order, and a Cue catalog
  generated fresh from `cues/*.json` (every non-`internal` Cue's name, label and
  `description`). Never a hand-maintained list, so it can't go stale.

### How it reaches a model (two doors, one text)

| Door | Who gets it | When |
|---|---|---|
| MCP handshake `instructions` | **every** MCP client, Claude Desktop included | on connect, automatically |
| `hooks/session-start.js` | Claude Code (plugin install) | at session start |

Both call `buildPersonaText()` — one implementation, so the mascot cannot behave
differently depending on which door the persona came through.

Both fire automatically, and neither re-reads mid-session. **Reloading after
editing `persona/` or `context/` is a reconnect** (`/mcp` in Claude Code): the
server builds `instructions` at process start, so a fresh process picks the
edits up. There is no manual re-injection tool — an MCP prompt existed for that
and was removed as redundant with the reconnect.

The handshake is what makes the plugin optional: a client connected to nothing
but the MCP server would otherwise get the *body* (tools) with no character
behind it. **Verified**: with only the connector configured (no plugin), Claude
Desktop speaks as ういちゃん — Desktop does read `instructions`. Escape hatches,
for when both doors are open and the double injection isn't wanted:
`UI_CHAN_NO_PERSONA_INSTRUCTIONS=1` (server side) and `UI_CHAN_NO_PERSONA_HOOK=1`
(hook side; keeps the app-launch half).

### Claude Desktop is not a lesser client

Desktop shares the plugin registry (`~/.claude/plugins/`) with Claude Code, so a
plugin registered from Claude Code — including a `directory` source pointing at
this repo — appears under Desktop's 設定 → プラグイン. Desktop's own "add" UI
only accepts GitHub marketplaces, which is why registration is done from the
Claude Code side.

**Observed, and the reason the connector still exists:** Desktop surfaces a
plugin's skills and subagents (all four of ours show up in its chat), but does
*not* start the plugin's MCP server. A Desktop session with only the plugin
installed has the skills and no `set_cue`, no persona — the MCP servers it lists
are the account's other connectors and nothing of ours, restart included. So
**Desktop wants both**: the plugin for skills, and its own
`claude_desktop_config.json` entry (`ui-chan install claude-desktop`) for tools
and persona. Since the repo-root `.mcp.json` was dropped, this is true of
**every** client including Claude Code: the plugin is skills/agents/hooks, the
connector is tools+persona, and `ui-chan install` writes the connector.

Two more things GUI-launched clients get wrong, both fixed in-repo:

- Desktop inherits launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so
  `"command": "node"` resolves in a terminal and silently fails there. Every
  entry point goes through `bin/ui-chan-node`, which finds node itself
  (PATH → Homebrew → `~/.local` → volta → asdf → fnm → nvm) and execs it.
  All seven hooks in `hooks/hooks.json` and every client entry written by
  `ui-chan install` use it.
- `claude plugin install` *copies* the plugin into
  `~/.claude/plugins/cache/…`, so the repo stops being the single source of
  truth the moment you edit anything. The `claude-code-plugin` client entry
  replaces that copy with a symlink to the package right after installing; the
  connector already points straight at `dist/`. With both done, `npm run build`
  is the only step that propagates a change to either client. Re-running
  `claude plugin install` by hand restores the copy — re-run
  `ui-chan install claude-code-plugin`.

`agents/` (talk, mode) and `skills/` (talk, mode, beam, eli14, grill-me) are the plugin's
subagents and slash commands. To retarget a different character, rewrite
`persona/` + `context/` and the PSD layer mappings in `ui-chan.config.json` +
`cues/`.

## Platform support: macOS only

`package.json`'s `os: ["darwin"]` makes npm refuse to install elsewhere, and
that is deliberate. Three things tie ui-chan to macOS, and two of them are not
ours to fix:

- `bin/ui-chan-node` is POSIX sh, and `hooks/hooks.json` names it directly.
  That file is static JSON with no platform branching, so a Windows launcher
  would need a second plugin manifest.
- VoiSona Talk's auto-launch is `open -a`, and VoiSona itself has no Linux build.
- `tools/stop-app.mjs` matches the process by command line via `pkill`.
  (`taskkill /FI` cannot filter on a command line at all — filtering by image
  name alone would kill every unrelated Electron app on the machine, which is
  why the Windows branch that briefly lived here was wrong as written.)

A half-supported platform is worse than an unsupported one: the failure mode
was "the MCP server silently never starts", which reads as a broken product
rather than an unsupported OS. Windows support means fixing those three points
**and having a machine to verify on** — not adding a branch blind. For the same
reason there are no win32/linux config paths in `clients.mjs`: an untested
branch reads as a supported one.

## Editing notes

- Renderer changes are **not** picked up by `tsc` alone — they need the esbuild
  step; just run `npm run build`.
- Behavior changes to state/queue/idle/affinity almost always mean `state.ts`.
- Affinity is session-only and resets to the config default on app restart.
