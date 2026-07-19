import { type Layer, type Psd, readPsd } from 'ag-psd';
import type {
  AmbientConfig,
  LayerDirectives,
  LipSyncConfig,
  RenderCommand,
  TtsAudio,
} from '../shared/types';

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
}

declare global {
  interface Window {
    uiChan: UiChanApi;
  }
}

interface LNode {
  name: string;
  layer: Layer;
  children: LNode[];
  parent: LNode | null;
  visible: boolean;
}

const EYE_CLOSE_PATH = '!目/*閉じ';
// The mouth folder used by lip sync's findSelect() lookups. Not configurable
// via a "slots" catalog anymore (that catalog was set_face-only and is gone);
// this is the one fixed PSD convention the renderer still needs to know.
const LIP_MOUTH_FOLDER = '!口';

let psd: Psd | null = null;
let root: LNode[] = [];
let blinkEnabled = false;
let blinkTimer: number | null = null;
let blinking = false;
const warnings = new Set<string>();
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

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const bubble = document.getElementById('bubble')!;
const placeholder = document.getElementById('placeholder')!;

function buildTree(children: Layer[] | undefined, parent: LNode | null): LNode[] {
  if (!children) return [];
  return children.map((layer) => {
    const node: LNode = {
      name: layer.name ?? '',
      layer,
      children: [],
      parent,
      visible: !layer.hidden,
    };
    node.children = buildTree(layer.children, node);
    return node;
  });
}

function findChild(nodes: LNode[], name: string): LNode | undefined {
  return nodes.find((n) => n.name === name);
}

function walkPath(path: string): LNode[] | null {
  const segments = path.split('/');
  let level = root;
  const chain: LNode[] = [];
  for (const seg of segments) {
    const node = findChild(level, seg);
    if (!node) return null;
    chain.push(node);
    level = node.children;
  }
  return chain;
}

function selectPath(path: string): void {
  const chain = walkPath(path);
  if (!chain) {
    warnings.add(`layer not found: ${path}`);
    return;
  }
  for (const node of chain) {
    node.visible = true;
    if (node.name.startsWith('*')) {
      const siblings = node.parent ? node.parent.children : root;
      for (const sib of siblings) {
        if (sib !== node && sib.name.startsWith('*')) sib.visible = false;
      }
    }
  }
}

function setVisible(path: string, visible: boolean): void {
  const chain = walkPath(path);
  if (!chain) {
    warnings.add(`layer not found: ${path}`);
    return;
  }
  if (visible) {
    for (const node of chain) node.visible = true;
  } else {
    chain[chain.length - 1].visible = false;
  }
}

function stripPrefix(name: string): string {
  return name.replace(/^[*!]/, '');
}

// Match only radio layers that are direct children of the folder. We do NOT
// descend into nested radio groups (e.g. *基本目セット): those inner axes are
// independent, so descending here would make the same name reachable from two
// folders and re-introduce ambiguity.
function findRadioByName(nodes: LNode[], name: string): LNode | null {
  for (const node of nodes) {
    if (node.name.startsWith('*') && stripPrefix(node.name) === name) return node;
  }
  return null;
}

function nodePath(node: LNode): string {
  const parts: string[] = [];
  for (let n: LNode | null = node; n; n = n.parent) parts.unshift(n.name);
  return parts.join('/');
}

// Kept for lip sync's mouth-radio lookup only (findSelect(folder, name) ->
// select the radio layer named `name` under `folder`). This used to also be
// reachable via LayerDirectives.find for set_face's slot-overwrite mechanism;
// that wire field is gone now that set_face is abolished, but the underlying
// name-based lookup is still exactly what lip sync needs.
function findSelect(folder: string, name: string): void {
  const chain = walkPath(folder);
  if (!chain) {
    warnings.add(`layer not found: ${folder}`);
    return;
  }
  const target = findRadioByName(chain[chain.length - 1].children, name);
  if (!target) {
    warnings.add(`no radio layer "${name}" under ${folder}`);
    return;
  }
  selectPath(nodePath(target));
}

function applyDirectives(d: LayerDirectives): void {
  for (const p of d.select ?? []) selectPath(p);
  for (const p of d.hide ?? []) setVisible(p, false);
  for (const p of d.show ?? []) setVisible(p, true);
  window.uiChan.reportWarnings([...warnings]);
}

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'linear dodge': 'lighter',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

function drawNodes(nodes: LNode[], alpha: number): void {
  for (const node of nodes) {
    if (!node.visible) continue;
    const layerAlpha = alpha * (node.layer.opacity ?? 1);
    if (node.children.length > 0) {
      drawNodes(node.children, layerAlpha);
      continue;
    }
    const image = node.layer.canvas;
    if (!image) continue;
    ctx.globalAlpha = layerAlpha;
    ctx.globalCompositeOperation = BLEND_MAP[node.layer.blendMode ?? 'normal'] ?? 'source-over';
    ctx.drawImage(image, node.layer.left ?? 0, node.layer.top ?? 0);
  }
}

function draw(): void {
  if (!psd) return;
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement!;
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((cw * dpr) / psd.width, (ch * dpr) / psd.height);
  const offsetX = (cw * dpr - psd.width * scale) / 2;
  const offsetY = ch * dpr - psd.height * scale;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawNodes(root, 1);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---- temporary-overlay visibility snapshot/restore ----
// Blink follows this shape: snapshot the current visibility of every node,
// draw something temporary (closed eyes) on top, then restore the snapshot.
// (Ambient idle motion used to be a second, renderer-local user of this same
// pattern — it's since been folded into the IdlingCue mechanism in state.ts,
// which recomposes from Cues instead of snapshotting/restoring visibility.)
function snapshotVisibility(nodes: LNode[]): Map<LNode, boolean> {
  const map = new Map<LNode, boolean>();
  const walk = (list: LNode[]): void => {
    for (const node of list) {
      map.set(node, node.visible);
      walk(node.children);
    }
  };
  walk(nodes);
  return map;
}

function restoreVisibility(saved: Map<LNode, boolean>): void {
  for (const [node, visible] of saved) node.visible = visible;
}

function scheduleBlink(): void {
  blinkTimer = clearTimeoutSafe(blinkTimer);
  blinkTimer = window.setTimeout(
    () => {
      blinkTimer = null;
      if (blinkEnabled && psd && !blinking && walkPath(EYE_CLOSE_PATH)) {
        blinking = true;
        const saved = snapshotVisibility(root);
        selectPath(EYE_CLOSE_PATH);
        draw();
        window.setTimeout(() => {
          restoreVisibility(saved);
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
  findSelect(LIP_MOUTH_FOLDER, name);
  draw();
}

function stopLipSync(): void {
  lipTimer = clearIntervalSafe(lipTimer);
  lipFrames = [];
  lipIndex = 0;
  lipCurrentMouth = null;
}

function startLipSync(text: string, reading: string | null | undefined): void {
  stopLipSync();
  if (!lipConfig || !psd) return;
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
  fallbackReading: string | null | undefined,
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

let hideTextTimer: number | null = null;
function setSpeech(text: string | null): void {
  hideTextTimer = clearTimeoutSafe(hideTextTimer);
  if (text !== null) {
    bubble.textContent = text;
    bubble.classList.add('visible');
  } else {
    bubble.classList.remove('visible');
    hideTextTimer = window.setTimeout(() => {
      bubble.textContent = '';
    }, 250);
  }
}

async function init(): Promise<void> {
  const initData = await window.uiChan.getInit();

  window.uiChan.onCommand((cmd) => {
    if (cmd.type === 'apply') {
      if (!psd) return;
      blinkEnabled = cmd.blink;
      applyDirectives(cmd.directives);
      lipCurrentMouth = null; // let the next lip tick re-assert its mouth
      draw();
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
  psd = readPsd(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), {
    skipThumbnail: true,
  });
  root = buildTree(psd.children, null);
  lipConfig = initData.config.lipSync ?? null;
  ambientConfig = initData.config.ambient ?? null;
  draw();
  scheduleBlink();
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
