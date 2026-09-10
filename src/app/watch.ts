import * as fs from 'node:fs';

/** Watch directories and call `onChange` once per burst of edits — an editor
 *  saves in several writes, and a reload per write would re-parse everything
 *  three times for one save. `recursive` is for trees whose layout carries
 *  meaning (sequences/ keeps its pools in subdirectories). */
export function watchDirs(
  dirs: string[],
  onChange: () => void,
  opts: { recursive?: boolean } = {},
): void {
  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 300);
  };
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.watch(dir, { recursive: opts.recursive ?? false }, fire);
  }
}
