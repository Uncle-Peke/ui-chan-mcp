import type { AmbientConfig, LipSyncConfig, RenderCommand, TtsAudio } from '../shared/types';
import { PsdStage } from './psd-stage';

interface UiChanApi {
  getInit(): Promise<{
    config: {
      assetsDir: string;
      window: { width: number; height: number };
      lipSync?: LipSyncConfig;
      ambient?: AmbientConfig;
    };
    psdAvailable: boolean;
    psdFile: string | null;
  }>;
  readPsd(): Promise<Uint8Array | null>;
  ready(): void;
  reportWarnings(warnings: string[]): void;
  onCommand(cb: (cmd: RenderCommand) => void): void;
  interaction(kind: string): void;
  panelAction(kind: string, value?: number): Promise<unknown>;
  setClickThrough(on: boolean): void;
  dragStart(): void;
  dragEnd(): void;
  reportBodyBox(insets: { left: number; top: number; right: number; bottom: number }): void;
}

declare global {
  interface Window {
    uiChan: UiChanApi;
  }
}

const EYE_CLOSE_PATH = '!目/*閉じ';
// The mouth folder used by lip sync's findSelect() lookups. Not configurable
// via a "slots" catalog anymore (that catalog was set_face-only and is gone);
// this is the one fixed PSD convention the renderer still needs to know.
const LIP_MOUTH_FOLDER = '!口';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const bubble = document.getElementById('bubble')!;
const placeholder = document.getElementById('placeholder')!;

// The shared PSD compositing core. Blink / lip-sync / bubble stay in this file.
const stage = new PsdStage(canvas);
function draw(): void {
  stage.draw();
}
function reportWarnings(): void {
  window.uiChan.reportWarnings(stage.getWarnings());
}

// ---- 「彼女に見える範囲」を一度だけ測って main に渡す ----
// 隅への吸い付き（main.ts の snapToCorner）が使う。窓の矩形ではなく実ピクセルの
// 位置で合わせないと、画面の隅に寄せたつもりが100px浮く（→ contentInsets の説明）。
//
// **一度きり**なのが肝。ポーズごとに測り直すと、万歳しているときとしていない
// ときで着地点が変わる——同じ「右下」が Cue 次第で別の場所になるのは、位置と
// しては壊れている。最初に当たる look は `default`（state.ts が起動時に置く、
// 全 Cue の土台そのもの）なので、それを彼女の定位置の基準として固定する。
let bodyBoxSent = false;
/** 計測した生の余白（反転前）。`side` が決まるたび実効値に組み替えて配る。 */
let rawInsets: { left: number; top: number; right: number; bottom: number } | null = null;
let bodySide: 'left' | 'right' = 'right';
const stageEl = document.getElementById('stage') as HTMLDivElement;

/** `side` と計測値から、見た目3つ（パネルの寄せ・吹き出しの伸びる向き・反転）を
 *  まとめて反映する。左に居るときは立ち絵を反転するので、身体の左右の余白も
 *  入れ替わる——CSS変数に入れるのは入れ替えたあとの値。 */
function applySide(): void {
  stageEl.classList.toggle('side-left', bodySide === 'left');
  stageEl.classList.toggle('side-right', bodySide === 'right');
  stage.mirrored = bodySide === 'left';
  if (!rawInsets) return;
  const left = bodySide === 'left' ? rawInsets.right : rawInsets.left;
  const right = bodySide === 'left' ? rawInsets.left : rawInsets.right;
  stageEl.style.setProperty('--body-left', `${left}px`);
  stageEl.style.setProperty('--body-right', `${right}px`);
  positionTail();
}

/** しっぽを彼女の頭の真上に置く。吹き出しの箱は画面の内側へ寄るので、中央
 *  固定のままだと指す先が身体から外れる。吹き出しより外は指せないので、両端は
 *  角丸に食われない位置で止める。 */
function positionTail(): void {
  if (!rawInsets) return;
  const left = bodySide === 'left' ? rawInsets.right : rawInsets.left;
  const right = bodySide === 'left' ? rawInsets.left : rawInsets.right;
  const headX = left + (window.innerWidth - left - right) / 2;
  const r = bubble.getBoundingClientRect();
  if (r.width === 0) return;
  const x = Math.min(Math.max(headX - r.left, 16), r.width - 16);
  bubble.style.setProperty('--tail-x', `${x}px`);
}

function reportBodyBoxOnce(): void {
  if (bodyBoxSent || !stage.loaded) return;
  const box = stage.contentInsets();
  if (!box) return;
  // canvas は #canvas-wrap の中（上に吹き出し領域ぶんの隙間がある）なので、
  // canvas 基準の余白を窓の内側基準に積み直す。main が知りたいのは窓との差。
  const rect = canvas.getBoundingClientRect();
  const insets = {
    left: rect.left + box.left,
    top: rect.top + box.top,
    right: window.innerWidth - rect.right + box.right,
    bottom: window.innerHeight - rect.bottom + box.bottom,
  };
  bodyBoxSent = true;
  rawInsets = insets;
  applySide();
  window.uiChan.reportBodyBox(insets);
}

// ---- Cue-transition crossfade (tween) ----
// Because a look is discrete sprite swaps (a mouth あ→ん can't be interpolated),
// we tween at the raster level: freeze the pre-change frame onto an overlay
// canvas stacked over the main one, repaint the new look underneath, then fade
// the frozen old frame out. Any cue pair dissolves smoothly; blink/lip-sync
// (which repaint the main canvas) show through the fading overlay fine.
// Duration comes from config.ambient.cueFadeMs (0 = hard cut).
const overlay = document.createElement('canvas');
// 反転（#stage.side-left）を本体キャンバスと一緒に受けるための id。付け忘れると
// クロスフェードの一瞬だけ、凍らせた**反転前**のフレームが素で見える＝左を向く。
overlay.id = 'cue-overlay';
overlay.style.cssText =
  'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';
const overlayCtx = overlay.getContext('2d');
canvas.parentElement?.insertBefore(overlay, canvas.nextSibling);
let fadeToken = 0;
function crossfade(): void {
  const fadeMs = ambientConfig?.cueFadeMs ?? 170;
  if (!overlayCtx || fadeMs <= 0 || canvas.width === 0 || canvas.height === 0) return;
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  overlayCtx.drawImage(canvas, 0, 0); // snapshot the current (old) look
  overlay.style.transition = 'none';
  overlay.style.opacity = '1';
  const token = ++fadeToken;
  window.requestAnimationFrame(() => {
    if (token !== fadeToken) return;
    overlay.style.transition = `opacity ${fadeMs}ms ease-out`;
    overlay.style.opacity = '0';
  });
}

let blinkEnabled = false;
let blinkTimer: number | null = null;
let blinking = false;
// Blink timing, populated from config in init(); undefined until then falls
// back to the same constants this file used before they became configurable.
let ambientConfig: AmbientConfig | null = null;

function randomDelayMs(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ---- timer bookkeeping ----
// Every timer in this file follows the same "hold an id, clear-then-null it"
// shape; these two helpers replace the repeated `if (x!==null) clear(x); x=null`
// stanza with a single assignment at each call site.
function clearTimeoutSafe(id: number | null): null {
  if (id !== null) window.clearTimeout(id);
  return null;
}
function clearIntervalSafe(id: number | null): null {
  if (id !== null) window.clearInterval(id);
  return null;
}

function scheduleBlink(): void {
  blinkTimer = clearTimeoutSafe(blinkTimer);
  blinkTimer = window.setTimeout(
    () => {
      blinkTimer = null;
      if (blinkEnabled && stage.loaded && !blinking && stage.walkPath(EYE_CLOSE_PATH)) {
        blinking = true;
        const saved = stage.snapshotVisibility();
        stage.selectPath(EYE_CLOSE_PATH);
        draw();
        window.setTimeout(() => {
          stage.restoreVisibility(saved);
          blinking = false;
          draw();
          scheduleBlink();
        }, ambientConfig?.blinkDurationMs ?? 130);
      } else {
        scheduleBlink();
      }
    },
    randomDelayMs(
      ambientConfig?.blinkMinIntervalMs ?? 3500,
      ambientConfig?.blinkMaxIntervalMs ?? 7000,
    ),
  );
}

// ---- fidget + manual window drag ----
// With -webkit-app-region:drag gone, JS owns all pointer input over her body:
//  - click without dragging → a "poke" interaction (the fidget)
//  - press + drag on her     → reposition the window (main follows the cursor)
// Alpha hit-testing means only her actual pixels count, not transparent margins
// or the bubble. Poke is the trigger (not hover): hover-firing made a poke right
// after feel dead, because the reaction's cooldown had already been spent.
const HIT_ALPHA = 24;
const DRAG_THRESHOLD = 6;
let downScreen: { x: number; y: number } | null = null;
let dragging = false;

function onCharacter(e: MouseEvent): boolean {
  return stage.loaded && stage.alphaAt(e.clientX, e.clientY) >= HIT_ALPHA;
}

// ---- click-through ----
// 窓は 420x680 の矩形で、ういちゃんが実際に描かれているのはその一部でしかない。
// 何もしないとその矩形が、後ろのエディタやデスクトップに向けたクリックを全部
// 飲む——透明なのに触れない板が机の上に置いてある状態で、これは邪魔でしかない。
// なので既定はクリック透過（main.ts の setIgnoreMouseEvents(true,{forward:true})）
// にして、カーソルの下が「押せるもの」のときだけ窓を実体化させる。
//
// 押せるものは 2 つだけ：**彼女の実ピクセル**（つつく／掴んで動かす）と
// **パネル**。吹き出しは意図的に含めない——見えてはいても押す物ではないので、
// 透明な余白と同じく後ろに素通ししたほうが、机の上の邪魔にならない。
let clickThrough = true; // createWindow() が設定する初期値と一致させること
function setClickThrough(on: boolean): void {
  if (on === clickThrough) return;
  clickThrough = on;
  window.uiChan.setClickThrough(on);
}

/** パネルは畳んでいるとき pointer-events:none なので、elementFromPoint は
 *  「いま実際に押せるパネル」だけを返す。判定をCSSと二重に持たなくて済む。 */
function overPanel(x: number, y: number): boolean {
  return document.elementFromPoint(x, y)?.closest('#panel') != null;
}

function updateClickThrough(e: MouseEvent): void {
  // ドラッグ中は実体のまま。カーソルは彼女の外へ簡単に出るし、そこで透過に
  // 戻すと mouseup を取り逃してドラッグが終わらなくなる。
  if (downScreen) return;
  setClickThrough(!(onCharacter(e) || overPanel(e.clientX, e.clientY)));
}

function startPointerHandling(): void {
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !onCharacter(e)) return;
    downScreen = { x: e.screenX, y: e.screenY };
    dragging = false;
    window.uiChan.dragStart();
  });
  window.addEventListener('mousemove', (e) => {
    updateClickThrough(e);
    if (!downScreen) return; // only track movement while pressing (drag vs click)
    if (
      Math.abs(e.screenX - downScreen.x) > DRAG_THRESHOLD ||
      Math.abs(e.screenY - downScreen.y) > DRAG_THRESHOLD
    ) {
      dragging = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!downScreen) return;
    window.uiChan.dragEnd();
    if (!dragging && onCharacter(e)) window.uiChan.interaction('poke');
    downScreen = null;
    dragging = false;
    updateClickThrough(e); // 掴んだまま余白へ抜けた場合、ここで穴に戻す
  });
  // 窓の外へ出たら必ず穴に戻す。端をすばやく横切ると最後の mousemove が
  // 彼女の上のままになることがあり、実体のまま取り残されてしまう。
  document.addEventListener('mouseleave', () => {
    if (!downScreen) setClickThrough(true);
  });
}

// ---- lip sync ----

let lipConfig: LipSyncConfig | null = null;
let lipTimer: number | null = null;
let lipFrames: string[] = [];
let lipIndex = 0;
let lipCurrentMouth: string | null = null;

const VOWEL_ROWS: Record<string, string> = {
  a: 'あかがさざただなはばぱまやらわぁゃ',
  i: 'いきぎしじちぢにひびぴみりゐぃ',
  u: 'うくぐすずつづぬふぶぷむゆるゔぅゅ',
  e: 'えけげせぜてでねへべぺめれゑぇ',
  o: 'おこごそぞとどのほぼぽもよろをぉょ',
};

function vowelOf(c: string): string | null {
  for (const [v, row] of Object.entries(VOWEL_ROWS)) {
    if (row.includes(c)) return v;
  }
  return null;
}

function toLipFrames(s: string): string[] {
  const frames: string[] = [];
  let altOpen = true;
  for (const ch of s) {
    let c = ch;
    const code = c.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) c = String.fromCodePoint(code - 0x60); // katakana -> hiragana
    if ('ゃゅょぁぃぅぇぉ'.includes(c)) {
      const v = vowelOf(c);
      if (frames.length > 0 && v) frames[frames.length - 1] = v; // merge small kana into previous mora
      continue;
    }
    if (c === 'ー') {
      frames.push(frames.length > 0 ? frames[frames.length - 1] : 'n');
      continue;
    }
    if (c === 'っ' || c === 'ん') {
      frames.push('n');
      continue;
    }
    const v = vowelOf(c);
    if (v) {
      frames.push(v);
      continue;
    }
    if (/\s|[、。！？!?.,…・〜～「」『』()（）]/.test(c)) {
      frames.push('n');
      continue;
    }
    // kanji or other unreadable characters: alternate open/close
    frames.push(altOpen ? 'a' : 'n');
    altOpen = !altOpen;
  }
  return frames;
}

function setLipMouth(vowel: string): void {
  if (!lipConfig) return;
  const name = lipConfig.mouths[vowel] ?? lipConfig.mouths.n;
  if (!name || name === lipCurrentMouth) return;
  lipCurrentMouth = name;
  stage.findSelect(LIP_MOUTH_FOLDER, name);
  draw();
}

function stopLipSync(): void {
  lipTimer = clearIntervalSafe(lipTimer);
  lipFrames = [];
  lipIndex = 0;
  lipCurrentMouth = null;
}

function startLipSync(text: string, reading?: string | null): void {
  stopLipSync();
  if (!lipConfig || !stage.loaded) return;
  lipFrames = toLipFrames(reading && reading.trim().length > 0 ? reading : text);
  if (lipFrames.length === 0) return;
  const interval = 1000 / (lipConfig.charsPerSec ?? 9);
  lipTimer = window.setInterval(() => {
    if (lipIndex >= lipFrames.length) {
      setLipMouth('n');
      lipTimer = clearIntervalSafe(lipTimer);
      return;
    }
    setLipMouth(lipFrames[lipIndex++]);
  }, interval);
}

// ---- TTS audio playback with phoneme-timed lip sync ----

let audioEl: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let audioTimer: number | null = null;

function stopAudio(): void {
  audioTimer = clearIntervalSafe(audioTimer);
  if (audioEl) {
    audioEl.pause();
    audioEl = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
}

function startAudioLipSync(
  audio: TtsAudio,
  fallbackText: string,
  fallbackReading?: string | null,
): void {
  stopAudio();
  const bytes = Uint8Array.from(atob(audio.wavBase64), (c) => c.charCodeAt(0));
  audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  audioEl = new Audio(audioUrl);
  const el = audioEl;
  el.play().catch(() => {
    // audio blocked or broken: fall back to kana-driven lip sync
    stopAudio();
    startLipSync(fallbackText, fallbackReading);
  });
  audioTimer = window.setInterval(() => {
    if (!audioEl) return;
    if (audioEl.ended) {
      setLipMouth('n');
      audioTimer = clearIntervalSafe(audioTimer);
      return;
    }
    const ms = audioEl.currentTime * 1000;
    let v = 'n';
    for (const f of audio.timeline) {
      if (f.t <= ms) v = f.v;
      else break;
    }
    setLipMouth(v);
  }, lipConfig?.audioPollMs ?? 33);
}

/** Break the bubble after each sentence so a two-sentence line reads as two
 *  lines instead of one long run that wraps wherever the box happens to end.
 *
 *  Display only — this never touches what the TTS engine is given (that comes
 *  from the SpeechItem in the main process, not from the bubble), so the
 *  reading and lip sync are unaffected. Any whitespace the author put after the
 *  punctuation is absorbed into the break, and a sentence ender with nothing
 *  after it (the usual trailing 。) doesn't produce a blank last line. An
 *  explicit \n in the text survives too, thanks to `white-space: pre-wrap`. */
function bubbleText(text: string): string {
  // 先読みは「次の文が始まること」の確認。除外に句読点そのものを入れておかないと、
  // 文末の「マジ！？」で ([。！？!?]+) が「！？」を掴んだあと先読みが文字を要求して
  // 失敗し、バックトラックで「！」まで縮んだうえ「？」が除外に無いので条件を満たす
  // ——！と？のあいだで改行される。閉じ括弧と同じく、句読点の続きも文の始まりでは
  // ないので同列に置く。
  return text.replace(/([。！？!?]+)[ \u3000]*(?=[^。！？!?」』）)】])/g, '$1\n');
}

let hideTextTimer: number | null = null;
function setSpeech(text: string | null): void {
  hideTextTimer = clearTimeoutSafe(hideTextTimer);
  if (text !== null) {
    bubble.textContent = bubbleText(text);
    bubble.classList.add('visible');
    positionTail(); // 行ごとに幅が変わるので、そのたび指し直す
  } else {
    bubble.classList.remove('visible');
    hideTextTimer = window.setTimeout(() => {
      bubble.textContent = '';
    }, 250);
  }
}

// ---- Connections panel -------------------------------------------------
//
// "Which agent is she talking to right now?" — answered without putting a
// single label next to the mascot. The hard constraint here is the world: a
// permanent HUD around her would break it, so the panel is **collapsed to a
// small ribbon tab by default**, opens on click, and opens *itself* only for
// the one situation the user cannot infer — more than one client, or more than
// one session of the same client, being connected at once.
//
// It is also where the few operations that need a button live (mute, clear,
// restart, quit), so reaching them never means finding a terminal.

interface PanelAgent {
  id: number;
  name: string;
  connectedAt: string;
  client?: string;
  clientVersion?: string;
  cwd?: string;
  project?: string;
  pid?: number;
}

const panelEl = document.getElementById('panel') as HTMLDivElement;
const panelTab = document.getElementById('panel-tab') as HTMLButtonElement;
const panelList = document.getElementById('panel-list') as HTMLDivElement;
const panelCount = document.getElementById('panel-count') as HTMLSpanElement;

let panelOpen = false;
let panelPinned = false; // opened by the user — never auto-closes
let panelAutoCloseTimer: number | null = null;
let lastCrowdKey = '';
let muted = false;

/** One line per connection. Two of the same client in different directories are
 *  two sessions, so the project is what actually disambiguates them. */
function agentLabel(a: PanelAgent): { title: string; sub: string } {
  const client = a.client ?? a.name;
  const where = a.project ?? '';
  return { title: client, sub: where || (a.pid ? `pid ${a.pid}` : '') };
}

/** The one thing the user can't work out on their own: is more than one
 *  session live? Same client twice (different project or pid) counts. */
function crowdKey(agents: PanelAgent[]): string {
  return agents
    .map((a) => `${a.client ?? a.name}:${a.project ?? ''}:${a.id}`)
    .sort()
    .join('|');
}

function setPanelOpen(open: boolean, pinned = false): void {
  panelOpen = open;
  panelPinned = open && pinned;
  panelEl.classList.toggle('open', open);
  if (panelAutoCloseTimer !== null) {
    clearTimeout(panelAutoCloseTimer);
    panelAutoCloseTimer = null;
  }
  // An auto-opened panel folds itself away again: it announced the thing it
  // needed to announce, and the world goes back to just her.
  if (open && !pinned) {
    panelAutoCloseTimer = window.setTimeout(() => {
      if (!panelPinned) setPanelOpen(false);
    }, 6000);
  }
}

function renderConnections(agents: PanelAgent[], active: number | null): void {
  // The tab says the one thing worth saying. With a single session (or none)
  // there is nothing to report, so it is just a menu button — a hamburger, the
  // most ignorable shape there is. Two or more sessions is genuinely news the
  // user cannot infer, so then it becomes the count.
  const crowd = agents.length > 1;
  panelCount.textContent = crowd ? String(agents.length) : '';
  panelEl.classList.toggle('crowded', crowd);
  panelTab.title = crowd ? `${agents.length}セッション接続中` : 'メニュー';
  panelEl.classList.toggle('has-agents', agents.length > 0);

  panelList.replaceChildren();
  if (agents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    // 顔文字（絵文字は OS/フォント依存で字形が変わる）。ここも同じ理由で、
    // ハングルやカンナダ文字を使う泣き顔（ㅠ_ㅠ / ಥ_ಥ）は避けて、日本語フォントに
    // 必ずある全角記号と ω だけで組む。
    // 顔文字は語ではないので、途中で折り返すと崩れる。必ず1行で持たせる。
    const emptyText = document.createElement('span');
    emptyText.textContent = 'だれもいない…';
    const emptyFace = document.createElement('span');
    emptyFace.className = 'panel-face';
    emptyFace.textContent = '｡ﾟ(Ｔ^Ｔ)ﾟ｡ﾟ';
    empty.append(emptyText, emptyFace);
    panelList.append(empty);
  }
  for (const a of agents) {
    const { title, sub } = agentLabel(a);
    const row = document.createElement('div');
    row.className = 'panel-row';
    if (a.id === active) row.classList.add('active');
    const dot = document.createElement('span');
    dot.className = 'panel-dot';
    const text = document.createElement('span');
    text.className = 'panel-text';
    const t = document.createElement('b');
    t.textContent = title;
    text.append(t);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      text.append(s);
    }
    row.append(dot, text);
    // 押すとそのセッションのアプリが前面に出る。タブまでは選ばない——端末に
    // よってはタブという概念すら無いので、「動いているものが前に出る」で足りる。
    row.title = `クリックで前面に出す — ${a.cwd ?? a.name}`;
    row.addEventListener('click', async () => {
      const res = (await window.uiChan.panelAction('focus', a.id)) as { ok?: boolean };
      // 前面化は「窓が来たかどうか」でしか結果が分からず、彼女の側からは
      // 見えない。飛べなかったときだけ行を光らせて、無反応と区別する。
      if (!res?.ok) {
        row.classList.add('miss');
        window.setTimeout(() => row.classList.remove('miss'), 700);
      }
    });
    panelList.append(row);
  }

  // Auto-open only on a *change* into a crowded state, so it never re-opens
  // over and over for a situation the user has already seen and folded away.
  const key = crowdKey(agents);
  const crowded = agents.length > 1;
  if (crowded && key !== lastCrowdKey && !panelOpen) setPanelOpen(true);
  lastCrowdKey = crowded ? key : '';
}

/** The affinity control behind the gear. Reading it is a fetch (the panel is
 *  transient, so there's no state to keep in sync); writing is immediate — this
 *  is a debug/tuning affordance, not something to confirm. */
const affEl = document.getElementById('panel-affinity') as HTMLDivElement;
const affRange = document.getElementById('aff-range') as HTMLInputElement;
const affValue = document.getElementById('aff-value') as HTMLElement;
const affBand = document.getElementById('aff-band') as HTMLElement;
let affGrabbed = false; // つまみを指で掴んでいる間は外からの更新を当てない

function showAffinity(a: { value: number; band: string } | null): void {
  if (!a) return;
  // 掴んでいる最中の押し付けは無視する。追従は「開いたまま置いてある表示が
  // 嘘をつかない」ためのもので、いま指で動かしているつまみを横から引き戻す
  // ためのものではない。離せば change が飛び、結局この値に落ち着く。
  if (affGrabbed) {
    affBand.textContent = a.band;
    return;
  }
  affRange.value = String(Math.round(a.value));
  affValue.textContent = String(Math.round(a.value));
  affBand.textContent = a.band;
}

async function refreshAffinity(): Promise<void> {
  showAffinity(
    (await window.uiChan.panelAction('affinity:get')) as { value: number; band: string },
  );
}

function wirePanel(): void {
  const gear = document.getElementById('panel-gear') as HTMLButtonElement;
  gear.addEventListener('click', async (e) => {
    e.stopPropagation();
    const open = affEl.hidden;
    affEl.hidden = !open;
    gear.classList.toggle('on', open);
    if (open) await refreshAffinity();
  });
  affRange.addEventListener('pointerdown', () => {
    affGrabbed = true;
  });
  affRange.addEventListener('pointerup', () => {
    affGrabbed = false;
  });
  affRange.addEventListener('pointercancel', () => {
    affGrabbed = false;
  });
  affRange.addEventListener('input', () => {
    affValue.textContent = affRange.value;
  });
  // 'change' (not 'input') so dragging doesn't fire an IPC call per pixel.
  affRange.addEventListener('change', async () => {
    showAffinity(
      (await window.uiChan.panelAction('affinity', Number(affRange.value))) as {
        value: number;
        band: string;
      },
    );
  });

  panelTab.addEventListener('click', (e) => {
    e.stopPropagation();
    setPanelOpen(!panelOpen, true);
  });
  panelEl.addEventListener('mouseenter', () => {
    if (panelAutoCloseTimer !== null) {
      clearTimeout(panelAutoCloseTimer);
      panelAutoCloseTimer = null;
    }
  });
  panelEl.addEventListener('mouseleave', () => {
    if (panelOpen && !panelPinned) setPanelOpen(false);
  });

  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kind = btn.dataset.action === 'mute' && muted ? 'unmute' : btn.dataset.action;
      const res = (await window.uiChan.panelAction(kind as string)) as { muted?: boolean };
      if (typeof res?.muted === 'boolean') {
        muted = res.muted;
        // Icon-only, so the state has to live in the icon: `.on` swaps the
        // sound wave for a slash and tints the button.
        btn.classList.toggle('on', muted);
        btn.title = muted ? '声をもどす' : '声だけ止める';
      }
    });
  }
}

async function init(): Promise<void> {
  wirePanel();
  const initData = await window.uiChan.getInit();

  window.uiChan.onCommand((cmd) => {
    if (cmd.type === 'apply') {
      if (!stage.loaded) return;
      crossfade(); // freeze the current look, then dissolve to the new one
      blinkEnabled = cmd.blink;
      stage.applyDirectives(cmd.directives);
      reportWarnings();
      lipCurrentMouth = null; // let the next lip tick re-assert its mouth
      draw();
      reportBodyBoxOnce();
    } else if (cmd.type === 'side') {
      bodySide = cmd.side;
      panelEl.classList.toggle('left', cmd.side === 'left');
      applySide();
    } else if (cmd.type === 'backdrop') {
      // Named presets keep the common cases short; anything else is passed to
      // CSS as-is, so a caller can hand over a gradient or an image.
      const PRESETS: Record<string, string> = {
        white: '#ffffff',
        light: 'linear-gradient(160deg, #f7f4f8 0%, #e9e6f2 100%)',
        dark: 'linear-gradient(160deg, #262435 0%, #1a1926 100%)',
        desk: 'linear-gradient(180deg, #2b2a3d 0%, #3a3550 55%, #4e5bb5 100%)',
      };
      document.body.style.background = cmd.style
        ? (PRESETS[cmd.style] ?? cmd.style)
        : 'transparent';
    } else if (cmd.type === 'update') {
      const btn = document.getElementById('panel-update') as HTMLButtonElement;
      btn.hidden = !cmd.available;
      if (cmd.available) {
        btn.title = cmd.blocked
          ? `更新があります（${cmd.behind}件）— ただし${cmd.blocked}`
          : `更新があります（${cmd.behind}件）。押すと取得して入れ替えます`;
      }
      // Sessions are news; a release is news too — surface it once, the same
      // way, instead of waiting for the user to happen to open the panel.
      if (cmd.available && !panelOpen) setPanelOpen(true);
    } else if (cmd.type === 'affinity') {
      showAffinity(cmd);
    } else if (cmd.type === 'connections') {
      renderConnections(cmd.agents, cmd.active);
    } else if (cmd.type === 'speech') {
      setSpeech(cmd.text);
      if (cmd.text !== null) {
        if (cmd.audio) {
          stopLipSync();
          startAudioLipSync(cmd.audio, cmd.text, cmd.reading);
        } else {
          startLipSync(cmd.text, cmd.reading);
        }
      } else {
        stopAudio();
        stopLipSync();
      }
    }
  });

  if (!initData.psdAvailable) {
    placeholder.style.display = 'block';
    const dirEl = document.getElementById('assets-dir');
    if (dirEl) dirEl.textContent = `${initData.config.assetsDir}/`;
    window.uiChan.ready();
    return;
  }

  const buffer = await window.uiChan.readPsd();
  if (!buffer) {
    placeholder.style.display = 'block';
    window.uiChan.ready();
    return;
  }
  stage.loadPsd(buffer);
  lipConfig = initData.config.lipSync ?? null;
  ambientConfig = initData.config.ambient ?? null;
  draw();
  scheduleBlink();
  startPointerHandling();
  window.addEventListener('resize', draw);
  window.uiChan.ready();
}

init().catch((e) => {
  placeholder.style.display = 'block';
  placeholder.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'ui-chan: 読み込みエラー';
  const p = document.createElement('p');
  p.textContent = String(e);
  placeholder.append(h1, p);
  window.uiChan.ready();
});
