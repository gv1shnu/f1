import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import {
  TICK_MS,
  MAX_PAYLOAD,
  MAX_BUFFERED,
  ROOM_CAPACITY,
  isRecord,
  cleanName,
  validState,
  wireState,
} from './public/js/protocol.js';
import { Circuit, TRACK_HALF_WIDTH } from './public/js/circuit.js';
import { LapTracker } from './public/js/race.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.png': 'image/png',
};
const COLORS = [
  '#e10600',
  '#00d2be',
  '#0090ff',
  '#ff8700',
  '#dc0000',
  '#006f62',
  '#ffffff',
  '#2b4562',
];

// Exporting a factory lets tests use ephemeral ports and always dispose their servers.
export function createGameServer({
  publicDir = path.join(root, 'dist'),
  roomCapacity = ROOM_CAPACITY,
  tickMs = TICK_MS,
  heartbeatMs = 15000,
  maxBuffered = MAX_BUFFERED,
  maxSlowTicks = 100,
  maxClients = 256,
  maxMessagesPerSecond = 40,
} = {}) {
  if (!Number.isInteger(roomCapacity) || roomCapacity < 1 || roomCapacity > 32)
    throw new Error('Room capacity must be 1–32');
  const rooms = new Map(),
    circuit = new Circuit();
  let nextId = 1,
    nextRoom = 1,
    tick = 0;
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const metrics = {
    snapshots: 0,
    bytes: 0,
    invalid: 0,
    rateLimited: 0,
    droppedSnapshots: 0,
  };
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      );
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (pathname === '/healthz') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          ok: true,
          clients: wss.clients.size,
          rooms: rooms.size,
          ...metrics,
          rss: process.memoryUsage().rss,
          cpuMicros: process.cpuUsage(),
          eventLoopP95Ms: lag.percentile(95) / 1e6,
          bufferedBytes: [...wss.clients].reduce(
            (n, w) => n + w.bufferedAmount,
            0,
          ),
        }),
      );
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const file = path.resolve(
      publicDir,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (!file.startsWith(path.resolve(publicDir) + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const hashed = path.basename(file).match(/-[A-Z0-9]{8}\./);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': hashed
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws' || wss.clients.size >= maxClients) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit('connection', ws, req),
    );
  });
  function send(ws, payload) {
    if (ws.readyState !== 1) return;
    ws.send(payload, (err) => {
      if (err) ws.terminate();
    });
    metrics.bytes += Buffer.byteLength(payload);
  }
  const peer = (p) => ({
    id: p.id,
    color: p.color,
    name: p.name,
    state: p.state,
  });
  wss.on('connection', (ws) => {
    let room = [...rooms.values()].find((r) => r.players.size < roomCapacity);
    if (!room) {
      room = { id: nextRoom++, players: new Map(), sockets: new Set() };
      rooms.set(room.id, room);
    }
    const id = nextId++,
      player = {
        id,
        color: COLORS[(id - 1) % COLORS.length],
        name: `Driver${id}`,
        state: null,
        sequence: -1,
        received: 0,
        race: null,
        index: null,
      };
    room.players.set(id, player);
    room.sockets.add(ws);
    ws.player = player;
    ws.room = room;
    ws.alive = true;
    ws.slowTicks = 0;
    let tokens = maxMessagesPerSecond * 2,
      tokenTime = performance.now();
    send(
      ws,
      JSON.stringify({
        type: 'welcome',
        id,
        color: player.color,
        room: room.id,
        capacity: roomCapacity,
      }),
    );
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      const now = performance.now();
      tokens = Math.min(
        maxMessagesPerSecond * 2,
        tokens + ((now - tokenTime) * maxMessagesPerSecond) / 1000,
      );
      tokenTime = now;
      if (tokens < 1) {
        metrics.rateLimited++;
        ws.close(1008, 'Message rate exceeded');
        return;
      }
      tokens--;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        metrics.invalid++;
        return;
      }
      if (binary || !isRecord(msg)) {
        metrics.invalid++;
        return;
      }
      if (msg.type === 'name') {
        const name = cleanName(msg.name);
        if (name !== null) player.name = name;
        else metrics.invalid++;
        return;
      }
      if (
        msg.type !== 'state' ||
        !validState(msg.state) ||
        msg.state.seq <= player.sequence
      ) {
        metrics.invalid++;
        return;
      }
      const state = wireState(msg.state),
        near = circuit.nearest(state, player.index),
        previous = player.state;
      const elapsed = player.received ? (now - player.received) / 1000 : 0;
      const jump =
        previous &&
        Math.hypot(state.x - previous.x, state.z - previous.z) >
          92 * elapsed + 5;
      if (!player.race)
        player.race = new LapTracker(circuit.samples, near.index);
      if (jump || elapsed > 0.5 || previous?.reset !== state.reset)
        player.race.resetAt(near.index);
      const forward = previous
        ? (state.x - previous.x) * near.tangent.x +
            (state.z - previous.z) * near.tangent.z >
          0
        : false;
      player.race.update(
        near.index,
        Math.min(elapsed, 0.25),
        near.distance <= TRACK_HALF_WIDTH,
        forward,
      );
      player.state = {
        ...state,
        lap: player.race.lap,
        progress: player.race.progress,
      };
      player.sequence = state.seq;
      player.received = now;
      player.index = near.index;
    });
    ws.on('close', () => {
      room.sockets.delete(ws);
      room.players.delete(id);
      if (!room.players.size) rooms.delete(room.id);
    });
  });
  const snapshots = setInterval(() => {
    tick++;
    const now = Date.now();
    for (const room of rooms.values()) {
      const payload = JSON.stringify({
        type: 'snapshot',
        tick,
        time: now,
        players: [...room.players.values()].map(peer),
      });
      for (const ws of room.sockets) {
        if (ws.readyState !== 1) continue;
        if (ws.bufferedAmount > maxBuffered) {
          metrics.droppedSnapshots++;
          if (++ws.slowTicks >= maxSlowTicks) ws.terminate();
          continue;
        }
        ws.slowTicks = 0;
        send(ws, payload);
        metrics.snapshots++;
      }
    }
  }, tickMs);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, heartbeatMs);
  return {
    server,
    wss,
    metrics,
    rooms,
    async close() {
      clearInterval(snapshots);
      clearInterval(heartbeat);
      lag.disable();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const game = createGameServer({
    roomCapacity: Number(process.env.ROOM_CAPACITY || ROOM_CAPACITY),
  });
  game.server.listen(process.env.PORT || 3000, () =>
    console.log(
      `APEX TV listening on http://localhost:${game.server.address().port}`,
    ),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => game.close().then(() => process.exit(0)));
}
