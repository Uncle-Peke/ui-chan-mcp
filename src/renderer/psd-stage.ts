import { type Layer, type Psd, readPsd } from 'ag-psd';
import type { LayerDirectives } from '../shared/types';

// A single PSD layer node in the parsed tree. Mirrors PSDTool's !folder / *radio
// / normal-layer convention: `visible` is the live toggle state we composite.
export interface LNode {
  name: string;
  layer: Layer;
  children: LNode[];
  parent: LNode | null;
  visible: boolean;
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

/**
 * The reusable PSD compositing core: parse a PSD, hold the layer tree, apply
 * LayerDirectives (select/show/hide), and paint the visible layers onto a
 * canvas. Extracted from renderer.ts so both the mascot renderer and the Cue
 * editor share exactly one implementation of the PSDTool layer semantics.
 *
 * DOM-agnostic beyond the canvas it's handed: it does NOT know about blink,
 * lip-sync, the speech bubble, or IPC — those stay in renderer.ts. Warnings for
 * unknown layer paths accumulate in a set the caller drains and reports.
 */
export class PsdStage {
  psd: Psd | null = null;
  root: LNode[] = [];
  private readonly warnings = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  // Lazily obtained so the tree/diff half of PsdStage is usable off-DOM (e.g.
  // node-side verification): only draw() ever touches the 2d context.
  private _ctx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private get ctx(): CanvasRenderingContext2D {
    if (!this._ctx) {
      const ctx = this.canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      this._ctx = ctx;
    }
    return this._ctx;
  }

  get loaded(): boolean {
    return this.psd !== null;
  }

  loadPsd(bytes: Uint8Array | ArrayBuffer): void {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.psd = readPsd(arr, { skipThumbnail: true });
    this.root = this.buildTree(this.psd.children, null);
  }

  /** Current accumulated warnings (unknown layer paths). Never auto-cleared,
   *  matching the original renderer behavior where the full set is re-reported. */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  private buildTree(children: Layer[] | undefined, parent: LNode | null): LNode[] {
    if (!children) return [];
    return children.map((layer) => {
      const node: LNode = {
        name: layer.name ?? '',
        layer,
        children: [],
        parent,
        visible: !layer.hidden,
      };
      node.children = this.buildTree(layer.children, node);
      return node;
    });
  }

  private findChild(nodes: LNode[], name: string): LNode | undefined {
    return nodes.find((n) => n.name === name);
  }

  walkPath(path: string): LNode[] | null {
    const segments = path.split('/');
    let level = this.root;
    const chain: LNode[] = [];
    for (const seg of segments) {
      const node = this.findChild(level, seg);
      if (!node) return null;
      chain.push(node);
      level = node.children;
    }
    return chain;
  }

  selectPath(path: string): void {
    const chain = this.walkPath(path);
    if (!chain) {
      this.warnings.add(`layer not found: ${path}`);
      return;
    }
    for (const node of chain) {
      node.visible = true;
      if (node.name.startsWith('*')) {
        const siblings = node.parent ? node.parent.children : this.root;
        for (const sib of siblings) {
          if (sib !== node && sib.name.startsWith('*')) sib.visible = false;
        }
      }
      this.applyHideDependency(node);
    }
  }

  // A PSDTool-style layer-name directive: a radio named "…(【folder】は非表示)"
  // (e.g. *腕組み(奥の腕は非表示)) means selecting it must also hide that other
  // folder — the crossed-arms artwork already draws both arms, so 奥の腕 has to
  // go. Encoded only in the name, so we honor it here in the shared core: the
  // mascot's hand-authored cues already select both, and doing it here makes the
  // editor's preview + saved diff match them without the author remembering.
  private applyHideDependency(node: LNode): void {
    const m = node.name.match(/[（(]([^（()）]+)は非表示[）)]/);
    if (!m) return;
    const folder = this.findNodeByName(`!${m[1]}`);
    if (!folder) return;
    // Prefer the folder's own "(非表示)" radio (show-nothing option); otherwise
    // just hide the folder node itself.
    const off = folder.children.find((c) => c.name === '*(非表示)');
    if (off) this.selectPath(this.nodePath(off));
    else folder.visible = false;
  }

  private findNodeByName(name: string): LNode | null {
    const walk = (nodes: LNode[]): LNode | null => {
      for (const n of nodes) {
        if (n.name === name) return n;
        const hit = walk(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this.root);
  }

  setVisible(path: string, visible: boolean): void {
    const chain = this.walkPath(path);
    if (!chain) {
      this.warnings.add(`layer not found: ${path}`);
      return;
    }
    if (visible) {
      for (const node of chain) node.visible = true;
    } else {
      chain[chain.length - 1].visible = false;
    }
  }

  private stripPrefix(name: string): string {
    return name.replace(/^[*!]/, '');
  }

  // Match only radio layers that are direct children of the folder. We do NOT
  // descend into nested radio groups (e.g. *基本目セット): those inner axes are
  // independent, so descending here would make the same name reachable from two
  // folders and re-introduce ambiguity.
  private findRadioByName(nodes: LNode[], name: string): LNode | null {
    for (const node of nodes) {
      if (node.name.startsWith('*') && this.stripPrefix(node.name) === name) return node;
    }
    return null;
  }

  nodePath(node: LNode): string {
    const parts: string[] = [];
    for (let n: LNode | null = node; n; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
  }

  // Select the radio layer named `name` under `folder`. Used by lip sync's
  // mouth-radio lookup (findSelect(folder, name)).
  findSelect(folder: string, name: string): void {
    const chain = this.walkPath(folder);
    if (!chain) {
      this.warnings.add(`layer not found: ${folder}`);
      return;
    }
    const target = this.findRadioByName(chain[chain.length - 1].children, name);
    if (!target) {
      this.warnings.add(`no radio layer "${name}" under ${folder}`);
      return;
    }
    this.selectPath(this.nodePath(target));
  }

  applyDirectives(d: LayerDirectives): void {
    for (const p of d.select ?? []) this.selectPath(p);
    for (const p of d.hide ?? []) this.setVisible(p, false);
    for (const p of d.show ?? []) this.setVisible(p, true);
  }

  /** The delta between the live tree and a baseline snapshot, expressed as
   *  select/show/hide — the inverse of applyDirectives. Per radio group only
   *  the winning option differing from the baseline is emitted; normal layers
   *  emit show/hide when their visibility differs. This is how the editor turns
   *  a toggled look into a minimal Cue diff over the default base. */
  diffFrom(baseline: Map<LNode, boolean>): LayerDirectives {
    const select: string[] = [];
    const show: string[] = [];
    const hide: string[] = [];
    const walk = (nodes: LNode[]): void => {
      const radios = nodes.filter((n) => n.name.startsWith('*'));
      if (radios.length) {
        const cur = radios.find((n) => n.visible);
        const base = radios.find((n) => baseline.get(n));
        if (cur && cur !== base) select.push(this.nodePath(cur));
      }
      for (const n of nodes) {
        if (n.name.startsWith('!') || n.name.startsWith('*')) {
          walk(n.children); // folder / nested-radio subtree
        } else {
          if (n.visible !== (baseline.get(n) ?? false)) {
            (n.visible ? show : hide).push(this.nodePath(n));
          }
          walk(n.children);
        }
      }
    };
    walk(this.root);
    return { select, show, hide };
  }

  private drawNodes(nodes: LNode[], alpha: number): void {
    for (const node of nodes) {
      if (!node.visible) continue;
      const layerAlpha = alpha * (node.layer.opacity ?? 1);
      if (node.children.length > 0) {
        this.drawNodes(node.children, layerAlpha);
        continue;
      }
      const image = node.layer.canvas;
      if (!image) continue;
      this.ctx.globalAlpha = layerAlpha;
      this.ctx.globalCompositeOperation =
        BLEND_MAP[node.layer.blendMode ?? 'normal'] ?? 'source-over';
      this.ctx.drawImage(image, node.layer.left ?? 0, node.layer.top ?? 0);
    }
  }

  draw(): void {
    if (!this.psd) return;
    const { canvas, ctx, psd } = this;
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
    this.drawNodes(this.root, 1);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Alpha (0–255) of the composited image at a client (viewport) point, for
   *  hit-testing "is the pointer actually over her body" vs the transparent
   *  margins. Maps client → canvas pixel coords via the element's box. */
  alphaAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return 0;
    }
    const px = Math.floor(((clientX - rect.left) / rect.width) * this.canvas.width);
    const py = Math.floor(((clientY - rect.top) / rect.height) * this.canvas.height);
    try {
      return this.ctx.getImageData(px, py, 1, 1).data[3];
    } catch {
      return 0;
    }
  }

  // ---- temporary-overlay visibility snapshot/restore (used by blink) ----
  // Snapshot the current visibility of every node, draw something temporary
  // (closed eyes) on top, then restore the snapshot.
  snapshotVisibility(): Map<LNode, boolean> {
    const map = new Map<LNode, boolean>();
    const walk = (list: LNode[]): void => {
      for (const node of list) {
        map.set(node, node.visible);
        walk(node.children);
      }
    };
    walk(this.root);
    return map;
  }

  restoreVisibility(saved: Map<LNode, boolean>): void {
    for (const [node, visible] of saved) node.visible = visible;
  }
}
