// APEX TV — multiplayer F1 game server.
// Serves the static client and relays player state over WebSockets.
//
// Networking model (kept intentionally simple for a first cut):
//   - Each connected browser is a "player" with a server-assigned id + color.
//   - Clients send their own {pos, rot, steer, speed, lap, name} at ~20 Hz.
//   - The server stamps the id and broadcasts every update to all *other*
//     clients. There is no server-side physics/authority yet — good enough
//     for casual racing, and the obvious next step is server reconciliation.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// --- Static file server -----------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside /public.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Dev server: never cache, so edits show up on reload.
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
});

// --- Multiplayer relay -------------------------------------------------------
const wss = new WebSocketServer({ server });

// Team-flavoured palette for player cars.
const COLORS = [
  '#e10600', // race red
  '#00d2be', // teal
  '#0090ff', // blue
  '#ff8700', // orange
  '#dc0000', // scarlet
  '#006f62', // dark teal
  '#ffffff', // white
  '#2b4562', // navy
  '#b6babd', // silver
  '#00352f', // deep green
];

const players = new Map(); // id -> { color, name, last }
let nextId = 1;
let nextColor = 0;

function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client._pid !== exceptId) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const color = COLORS[nextColor++ % COLORS.length];
  ws._pid = id;
  players.set(id, { color, name: `P${id}`, last: null });

  // Tell the newcomer who they are + who's already here.
  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    color,
    players: [...players.entries()]
      .filter(([pid]) => pid !== id)
      .map(([pid, p]) => ({ id: pid, color: p.color, name: p.name, state: p.last })),
  }));

  // Announce the newcomer to everyone else.
  broadcast({ type: 'join', id, color, name: `P${id}` }, id);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'state') {
      const p = players.get(id);
      if (!p) return;
      p.last = msg.state;
      broadcast({ type: 'state', id, state: msg.state }, id);
    } else if (msg.type === 'name') {
      const p = players.get(id);
      if (!p) return;
      p.name = String(msg.name || `P${id}`).slice(0, 16);
      broadcast({ type: 'name', id, name: p.name }, id);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id }, id);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🏎  APEX TV running at  http://localhost:${PORT}\n`);
});
