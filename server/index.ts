// WebSocket + static file server. Every connection joins one arena: the first two race, the rest spectate.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { TICK_RATE } from '../shared/constants.ts';
import type { ClientMsg } from '../shared/protocol.ts';
import { Game, type Conn } from './game.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DIST = resolve(import.meta.dirname, '../dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const file = resolve(join(DIST, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(DIST + sep)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found. For dev, open the Vite URL (npm run dev); for prod, npm run build first.');
  }
});

const game = new Game();
const wss = new WebSocketServer({ server: http, path: '/ws' });
let nextId = 1;

const clampInt = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

wss.on('connection', (ws) => {
  const id = nextId++;
  const conn: Conn = {
    id, name: `Racer ${id}`,
    send: (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); },
  };
  game.join(conn);
  conn.send({ t: 'welcome', id, name: conn.name });
  console.log(`+ ${conn.name} (${game.order.length} connected)`);

  ws.on('message', (raw) => {
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'input') {
      const seq = clampInt(m.seq, 1, Number.MAX_SAFE_INTEGER);
      const th = clampInt(m.th, -1, 1), st = clampInt(m.st, -1, 1), hb = clampInt(m.hb, 0, 1);
      if (seq === null || th === null || st === null || hb === null) return;
      game.onInput(id, { t: 'input', seq, th, st, hb });
    } else if (m.t === 'ping' && typeof m.c === 'number') {
      conn.send({ t: 'pong', c: m.c });
    }
  });
  ws.on('close', () => {
    game.leave(id);
    console.log(`- ${conn.name} (${game.order.length} connected)`);
  });
});

// Fixed-rate loop. setTimeout is coarse on Windows, so accumulate real time and run whole ticks.
const TICK_MS = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
(function loop() {
  const now = performance.now();
  acc += now - last;
  last = now;
  let n = 0;
  while (acc >= TICK_MS && n < 10) { game.step(); acc -= TICK_MS; n++; }
  if (n === 10) acc = 0; // fell badly behind; don't spiral
  setTimeout(loop, 2);
})();

http.listen(PORT, () => console.log(`Ghost Racer server on http://localhost:${PORT} (ws path /ws)`));
