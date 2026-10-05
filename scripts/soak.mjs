// Bounded real-socket practice-room soak. Does not target external servers.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = Number(process.env.CLIENTS || 60),
  duration = Number(process.env.DURATION_SECONDS || 120),
  port = Number(process.env.SOAK_PORT || 3105);
const server = fork(new URL('../server.js', import.meta.url), [], {
  env: { ...process.env, PORT: String(port) },
  silent: true,
});
server.stderr.on('data', (d) => process.stderr.write(d));
const clients = [];
let ticks = 0,
  snapshots = 0,
  maxRoom = 0,
  delays = [],
  bytes = 0,
  errors = 0,
  health = [];
try {
  await once(server.stdout, 'data');
  for (let i = 0; i < count; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.seq = 0;
    ws.player = i;
    clients.push(ws);
    ws.on('error', () => errors++);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'snapshot') {
        snapshots++;
        bytes += raw.length;
        maxRoom = Math.max(maxRoom, m.players.length);
        delays.push(Date.now() - m.time);
      }
    });
    await once(ws, 'open');
  }
  const start = performance.now();
  const ticker = setInterval(() => {
    ticks++;
    for (const ws of clients)
      if (ws.readyState === 1)
        ws.send(
          JSON.stringify({
            type: 'state',
            state: {
              x: 0,
              z: -30 + Math.sin(ticks / 30),
              h: Math.PI,
              s: 0,
              v: 2,
              seq: ws.seq++,
              reset: 0,
            },
          }),
        );
  }, 50);
  const monitor = setInterval(async () => {
    try {
      health.push(
        await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(),
      );
    } catch {
      errors++;
    }
  }, 1000);
  await sleep(duration * 1000);
  clearInterval(ticker);
  clearInterval(monitor);
  health.push(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json());
  delays.sort((a, b) => a - b);
  const summary = {
    clients: count,
    durationSeconds: (performance.now() - start) / 1000,
    ticks,
    snapshots,
    bytes,
    maxRoom,
    errors,
    snapshotDeliveryMs: {
      p50: delays[Math.floor(delays.length * 0.5)],
      p95: delays[Math.floor(delays.length * 0.95)],
      p99: delays[Math.floor(delays.length * 0.99)],
      max: delays.at(-1),
    },
    firstHealth: health[0],
    lastHealth: health.at(-1),
    maxRSS: Math.max(...health.map((h) => h.rss)),
    maxBufferedBytes: Math.max(...health.map((h) => h.bufferedBytes)),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (errors || maxRoom > 16 || health.at(-1).clients !== count)
    process.exitCode = 1;
} finally {
  for (const ws of clients) ws.terminate();
  server.kill('SIGTERM');
}
