// A tiny dependency-free prompt kit: arrow-key select / multi-select on a TTY,
// falling back to plain numbered input when stdin is not interactive (CI, a
// pipe, an agent running `ui-chan setup < /dev/null`). No dependency is worth
// adding to a package whose whole job is to install cleanly.
import * as readline from 'node:readline/promises';

const isTTY = () => process.stdin.isTTY && process.stdout.isTTY;

export function say(msg = '') {
  process.stdout.write(`${msg}\n`);
}

export async function ask(question, fallback = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(question, def = true) {
  const a = (await ask(`${question} ${def ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

export async function askHidden(question) {
  if (!isTTY()) return ask(question);
  return new Promise((resolve) => {
    process.stdout.write(`${question} `);
    const chars = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (buf) => {
      const s = buf.toString('utf-8');
      if (s === '\r' || s === '\n' || s === '\x04') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (s === '\x03') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (s === '\x7f') {
        chars.pop();
      } else {
        chars.push(s);
      }
    };
    process.stdin.on('data', onData);
  });
}

/**
 * items: [{ value, label, hint?, checked?, disabled? }]
 * Returns the selected values (an array; single-select returns one element).
 */
export async function select(title, items, { multi = false } = {}) {
  if (!isTTY()) return selectFallback(title, items, multi);

  let cursor = items.findIndex((i) => !i.disabled);
  if (cursor < 0) cursor = 0;
  const checked = new Set(items.filter((i) => i.checked).map((i) => i.value));

  const render = (first) => {
    if (!first) process.stdout.write(`\x1b[${items.length + 2}A`);
    process.stdout.write(`\x1b[0J`);
    say(title);
    for (const [i, item] of items.entries()) {
      const point = i === cursor ? '❯' : ' ';
      const box = multi ? (checked.has(item.value) ? '[x] ' : '[ ] ') : '';
      const dim = item.disabled ? '\x1b[2m' : '';
      const on = i === cursor ? '\x1b[36m' : '';
      say(
        `${point} ${dim}${on}${box}${item.label}\x1b[0m${item.hint ? `  \x1b[2m${item.hint}\x1b[0m` : ''}`,
      );
    }
    say(
      `\x1b[2m${multi ? '↑↓ 移動 / Space 選択 / Enter 決定' : '↑↓ 移動 / Enter 決定'} / q 中止\x1b[0m`,
    );
  };

  return new Promise((resolve) => {
    render(true);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (value) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      resolve(value);
    };
    const onData = (buf) => {
      const s = buf.toString('utf-8');
      if (s === '\x03' || s === 'q') {
        finish(null);
        return;
      }
      if (s === '\x1b[A' || s === 'k') {
        do {
          cursor = (cursor - 1 + items.length) % items.length;
        } while (items[cursor].disabled);
      } else if (s === '\x1b[B' || s === 'j') {
        do {
          cursor = (cursor + 1) % items.length;
        } while (items[cursor].disabled);
      } else if (multi && s === ' ') {
        const v = items[cursor].value;
        checked.has(v) ? checked.delete(v) : checked.add(v);
      } else if (s === '\r' || s === '\n') {
        finish(multi ? [...checked] : [items[cursor].value]);
        return;
      }
      render(false);
    };
    process.stdin.on('data', onData);
  });
}

async function selectFallback(title, items, multi) {
  say(title);
  for (const [i, item] of items.entries()) say(`  ${i + 1}) ${item.label}`);
  const a = await ask(multi ? '番号をカンマ区切りで:' : '番号:');
  if (!a) return null;
  const picked = a
    .split(',')
    .map((n) => items[Number(n.trim()) - 1])
    .filter((x) => x && !x.disabled)
    .map((x) => x.value);
  return multi ? picked : picked.slice(0, 1);
}
