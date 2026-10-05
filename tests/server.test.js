import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(t, opts = {}) {
  const game = createGameServer({
    ...opts,
    publicDir: new URL('../dist', import.meta.url).pathname,
  });
  game.server.listen(0, '127.0.0.1');
  await once(game.server, 'listening');
  t.after(() => game.close());
  return { ...game, url: `http://127.0.0.1:${game.server.address().port}` };
}
async function client(game) {
  const ws = new WebSocket(game.url.replace('http', 'ws') + '/ws');
  ws.messages = [];
  ws.on('message', (r) => ws.messages.push(JSON.parse(r)));
  ws.on('error', () => {});
  await once(ws, 'open');
  await wait(() => ws.messages.find((m) => m.type === 'welcome'));
  return ws;
}
async function wait(fn) {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('Timed out');
}
const state = { x: 0, z: 0, h: 0, s: 0, v: 0, seq: 1, reset: 0 };
test('malformed URL returns 400 without crashing; assets boot locally', async (t) => {
  const g = await setup(t);
  const status = await new Promise((resolve, reject) =>
    http
      .get(g.url + '/%ZZ', (r) => {
        r.resume();
        resolve(r.statusCode);
      })
      .on('error', reject),
  );
  assert.equal(status, 400);
  const html = await (await fetch(g.url)).text();
  assert.match(html, /assets\/main-[A-Z0-9]{8}\.js/);
  assert.doesNotMatch(html, /cdn.jsdelivr/);
  const js = html.match(/assets\/main-[A-Z0-9]{8}\.js/)[0];
  assert.match(
    (await fetch(g.url + '/' + js)).headers.get('cache-control'),
    /immutable/,
  );
  assert.equal((await fetch(g.url + '/healthz')).status, 200);
});
test('invalid state cannot kill server or reach peers; laps and names are sanitized', async (t) => {
  const g = await setup(t),
    a = await client(g),
    b = await client(g);
  for (const msg of [
    'null',
    '{',
    '[]',
    JSON.stringify({ type: 'state', state: { ...state, h: 1e20 } }),
  ])
    a.send(msg);
  a.send(
    JSON.stringify({ type: 'state', state: { ...state, lap: 999, name: 123 } }),
  );
  const snapshot = await wait(() =>
    b.messages.find(
      (m) => m.type === 'snapshot' && m.players.some((p) => p.state),
    ),
  );
  assert.equal(snapshot.players.find((p) => p.state).state.lap, 1);
  assert.ok(snapshot.players.every((p) => typeof p.name === 'string'));
  assert.ok(g.metrics.invalid >= 4);
  assert.equal((await fetch(g.url + '/healthz')).status, 200);
});
test('rooms isolate players, capacity is bounded, departures clear empty rooms', async (t) => {
  const g = await setup(t, { roomCapacity: 2 }),
    a = await client(g),
    b = await client(g),
    c = await client(g);
  assert.equal(a.messages[0].room, b.messages[0].room);
  assert.notEqual(a.messages[0].room, c.messages[0].room);
  const s = await wait(() => c.messages.find((m) => m.type === 'snapshot'));
  assert.equal(s.players.length, 1);
  b.close();
  await wait(() => g.wss.clients.size === 2);
  await wait(() => a.messages.at(-1)?.players?.length === 1);
  c.close();
  await wait(() => g.rooms.size === 1);
});
test('oversized frames and flooding disconnect only offending clients', async (t) => {
  const g = await setup(t, { maxMessagesPerSecond: 5 }),
    a = await client(g),
    b = await client(g);
  a.send('x'.repeat(4096));
  await once(a, 'close');
  for (let i = 0; i < 20; i++) b.send('{}');
  await once(b, 'close');
  assert.ok(g.metrics.rateLimited);
  assert.equal((await fetch(g.url + '/healthz')).status, 200);
});
test('heartbeat terminates silent sockets', async (t) => {
  const g = await setup(t, { heartbeatMs: 30 });
  const a = new WebSocket(g.url.replace('http', 'ws') + '/ws', {
    autoPong: false,
  });
  a.on('error', () => {});
  await once(a, 'open');
  await once(a, 'close');
  await wait(() => g.wss.clients.size === 0);
  assert.equal(g.wss.clients.size, 0);
});
test('slow consumers drop stale snapshots then disconnect', async (t) => {
  const g = await setup(t, { maxBuffered: -1, maxSlowTicks: 2, tickMs: 10 }),
    a = await client(g);
  await once(a, 'close');
  assert.ok(g.metrics.droppedSnapshots >= 2);
});
