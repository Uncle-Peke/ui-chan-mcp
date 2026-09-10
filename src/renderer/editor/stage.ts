import type { Cue, EditorStyles, LayerDirectives, LipSyncConfig, Look } from '../../shared/types';
import { type LNode, PsdStage } from '../psd-stage';
import { $ } from './bridge';

// The one preview canvas and layer tree, shared by every tab. A tab doesn't own
// a stage of its own: it puts its look on this one, and reads the edited tree
// back as a diff against `default`.
export const stage = new PsdStage($('canvas') as HTMLCanvasElement);

/** Loaded once at startup (editor.ts). The default look, captured once as the
 *  diff baseline: every saved look is the delta between the live tree and this
 *  baseline (mirrors composeDirectives). */
export const shared: {
  defaultCue: Cue;
  baseline: Map<LNode, boolean>;
  styles: EditorStyles | null;
  lipConfig: LipSyncConfig | null;
  /** config の tts.intonation（演技パネルの「自動」の計算に使う）。 */
  intonationFallback: number;
} = { defaultCue: {}, baseline: new Map(), styles: null, lipConfig: null, intonationFallback: 1.1 };

let treeEdited: (() => void) | null = null;
/** The active tab's hook for "the user changed a layer" (e.g. to mark its form
 *  dirty). One listener: only the active tab edits the tree. */
export function onTreeEdit(fn: (() => void) | null): void {
  treeEdited = fn;
}

export function buildTree(): void {
  const container = $('tree');
  container.replaceChildren();
  container.append(renderNodes(stage.root, ''));
}

/** Re-sync every tree input's checked state from the live node visibility,
 *  without tearing down the DOM (keeps folders' open/closed state). Needed
 *  because a select can cascade into other groups via a layer-name hide
 *  dependency (e.g. 腕組み → 奥の腕/*(非表示)). */
function syncTreeInputs(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('#tree input[data-path]')) {
    const chain = stage.walkPath(input.dataset.path ?? '');
    if (chain) input.checked = chain[chain.length - 1].visible;
  }
}

function edited(): void {
  stage.draw();
  syncTreeInputs();
  treeEdited?.();
}

function renderNodes(nodes: LNode[], groupName: string): HTMLElement {
  const ul = document.createElement('div');
  ul.className = 'tree-group';
  for (const node of nodes) {
    ul.append(renderNode(node, groupName));
  }
  return ul;
}

function renderNode(node: LNode, groupName: string): HTMLElement {
  const path = stage.nodePath(node);
  const row = document.createElement('div');
  row.className = 'tree-node';

  if (node.name.startsWith('!')) {
    // Required folder: structural, collapsible, not directly toggled.
    const det = document.createElement('details');
    det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = node.name;
    det.append(sum);
    if (node.children.length) det.append(renderNodes(node.children, path));
    row.append(det);
    return row;
  }

  const label = document.createElement('label');
  const input = document.createElement('input');
  input.dataset.path = path;
  input.checked = node.visible;
  if (node.name.startsWith('*')) {
    input.type = 'radio';
    input.name = `radio:${groupName}`;
    input.addEventListener('change', () => {
      stage.selectPath(path);
      edited();
    });
  } else {
    input.type = 'checkbox';
    input.addEventListener('change', () => {
      stage.setVisible(path, input.checked);
      edited();
    });
  }
  label.append(input, document.createTextNode(` ${node.name}`));
  row.append(label);
  // A radio option (or normal layer) can itself contain sub-layers/nested radios.
  if (node.children.length) row.append(renderNodes(node.children, path));
  return row;
}

/** Restore the tree to the default look, then overlay a look's directives. */
export function applyLook(look: Look): void {
  stage.restoreVisibility(shared.baseline);
  stage.applyDirectives(look);
  stage.draw();
  buildTree();
}

/** The live tree minus `default` — what a Cue or a step saves as its look. */
export function currentDirectives(): LayerDirectives {
  return stage.diffFrom(shared.baseline);
}
