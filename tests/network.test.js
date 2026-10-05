import test from 'node:test';
import assert from 'node:assert/strict';
import { Network } from '../public/js/network.js';
class Socket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.sent = [];
    Socket.instances.push(this);
  }
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
test('client reconnect clears stale peers, resends name and resets sequence', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const previous = { ws: globalThis.WebSocket, location: globalThis.location };
  globalThis.WebSocket = Socket;
  globalThis.location = { protocol: 'http:', host: 'localhost' };
  t.after(() => {
    globalThis.WebSocket = previous.ws;
    globalThis.location = previous.location;
  });
  const net = new Network(),
    events = [];
  net.on('status', (s) => events.push(s));
  net.setName('wasd racer');
  net.connect();
  const first = net.ws;
  first.receive({ type: 'welcome', id: 1, color: '#e10600', room: 1 });
  assert.equal(net.connected, true);
  assert.equal(first.sent[0].name, 'wasd racer');
  first.receive({
    type: 'snapshot',
    tick: 10,
    time: 100,
    players: [{ id: 2, color: '#ffffff', name: 'Peer', state: null }],
  });
  assert.equal(net.peers.size, 1);
  first.close();
  assert.equal(net.connected, false);
  assert.equal(net.peers.size, 0);
  t.mock.timers.tick(601);
  assert.notEqual(net.ws, first);
  net.ws.receive({ type: 'welcome', id: 3, color: '#00d2be', room: 2 });
  assert.equal(net.id, 3);
  assert.equal(net.ws.sent[0].name, 'wasd racer');
  assert.equal(net._tick, -1);
  let calls = 0;
  const state = () => {
    calls++;
    return { x: 0, z: 0, h: 0, s: 0, v: 0, reset: 0 };
  };
  net.sendState(state, 100);
  net.sendState(state, 101);
  assert.equal(calls, 1);
  net.ws.bufferedAmount = 1e6;
  net.sendState(state, 200);
  assert.equal(calls, 1);
  net.stop();
  t.mock.timers.tick(20000);
  assert.equal(net.connected, false);
  assert.ok(events.some((e) => e.includes('Offline')));
});
