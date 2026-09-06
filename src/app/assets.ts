import * as fs from 'node:fs';
import * as path from 'node:path';

/** First `.psd` (alphabetical) in the first assets dir that has one, or null.
 *  Shared by the mascot app (main.ts) and the Cue editor (editor-main.ts) so
 *  both discover the mascot PSD the same way. */
export function findPsd(assetsDirs: string | string[]): string | null {
  for (const dir of Array.isArray(assetsDirs) ? assetsDirs : [assetsDirs]) {
    if (!fs.existsSync(dir)) continue;
    const psd = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.psd'))
      .sort();
    if (psd.length > 0) return path.join(dir, psd[0]);
  }
  return null;
}
