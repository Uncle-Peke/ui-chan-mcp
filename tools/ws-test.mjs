// Quick manual test client for the ui-chan display app.
// Usage: node tools/ws-test.mjs <tool> '<json-args>'
import WebSocket from 'ws';

const port = process.env.UI_CHAN_PORT ?? 8123;
const tool = process.argv[2] ?? 'get_state';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
let id = 1;
const send = (msg) => ws.send(JSON.stringify({ id: id++, ...msg }));

ws.on('open', () => {
  send({ type: 'hello', agent: 'ws-test' });
  send({ type: 'tool', tool, args });
});
ws.on('message', (data) => {
  const res = JSON.parse(data.toString());
  if (res.id === 2) {
    console.log(JSON.stringify(res, null, 2));
    ws.close();
    process.exit(0);
  }
});
ws.on('error', (e) => {
  console.error('connection failed:', e.message);
  process.exit(1);
});
