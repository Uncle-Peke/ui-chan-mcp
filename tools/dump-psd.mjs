import { readFileSync } from 'node:fs';
import { readPsd } from 'ag-psd';

const buf = readFileSync(process.argv[2]);
const psd = readPsd(buf, {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
});
console.log(`canvas: ${psd.width}x${psd.height}`);
function walk(children, depth) {
  if (!children) return;
  for (const c of children) {
    const kind = c.children ? '[G]' : '   ';
    console.log(`${'  '.repeat(depth)}${kind} ${c.name} ${c.hidden ? '(hidden)' : '(visible)'}`);
    walk(c.children, depth + 1);
  }
}
walk(psd.children, 0);
