import * as fs from 'node:fs';
import * as path from 'node:path';

/** First `.psd` (alphabetical) in the assets dir, or null if none / missing.
 *  Shared by the mascot app (main.ts) and the Cue editor (editor-main.ts) so
 *  both discover the mascot PSD the same way. */
export function findPsd(assetsDirAbs: string): string | null {
  if (!fs.existsSync(assetsDirAbs)) return null;
  const psd = fs
    .readdirSync(assetsDirAbs)
    .filter((f) => f.toLowerCase().endsWith('.psd'))
    .sort();
  return psd.length > 0 ? path.join(assetsDirAbs, psd[0]) : null;
}
