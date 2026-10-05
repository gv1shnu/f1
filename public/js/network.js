import {
  TICK_MS,
  MAX_BUFFERED,
  isRecord,
  cleanName,
  validState,
  validPeer,
} from './protocol.js';
export class Network {
  constructor() {
    this.ws = null;
    this.id = null;
    this.color = null;
    this.peers = new Map();
    this.handlers = {};
    this.connected = false;
    this.name = 'Driver';
    this._lastSend = -Infinity;
    this._seq = 0;
    this._tick = -1;
    this._attempt = 0;
    this._stopped = true;
    this._timer = null;
    this._watchdog = null;
    this._lastReceive = 0;
  }
  on(event, fn) {
    this.handlers[event] = fn;
    return this;
  }
  _emit(event, ...args) {
    this.handlers[event]?.(...args);
  }
  _clearPeers() {
    for (const id of this.peers.keys()) this._emit('peerLeave', id);
    this.peers.clear();
  }
  connect() {
    if (this.ws && this.ws.readyState < 2) return;
    this._stopped = false;
    clearTimeout(this._timer);
    this._emit('status', this._attempt ? 'Reconnecting…' : 'Connecting…');
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    );
    this.ws = ws;
    this._lastReceive = performance.now();
    clearInterval(this._watchdog);
    this._watchdog = setInterval(() => {
      if (performance.now() - this._lastReceive > 10000) ws.close();
    }, 2000);
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isRecord(msg)) return;
      if (msg.type === 'welcome') {
        if (
          !Number.isSafeInteger(msg.id) ||
          msg.id < 1 ||
          !/^#[0-9a-f]{6}$/i.test(msg.color) ||
          !Number.isSafeInteger(msg.room)
        )
          return;
        this._clearPeers();
        this.id = msg.id;
        this.color = msg.color;
        this.room = msg.room;
        this._seq = 0;
        this._tick = -1;
        this._lastSend = -Infinity;
        this.connected = true;
        this._lastReceive = performance.now();
        this.setName(this.name);
        this._emit('status', `Online · room ${msg.room}`);
        this._emit('ready', msg.id, msg.color);
      } else if (msg.type === 'snapshot') {
        if (
          !this.connected ||
          !Number.isSafeInteger(msg.tick) ||
          msg.tick <= this._tick ||
          !Number.isFinite(msg.time) ||
          !Array.isArray(msg.players) ||
          msg.players.length > 32 ||
          !msg.players.every(validPeer)
        )
          return;
        if (new Set(msg.players.map((p) => p.id)).size !== msg.players.length)
          return;
        this._tick = msg.tick;
        this._lastReceive = performance.now();
        this._attempt = 0;
        const seen = new Set();
        for (const p of msg.players) {
          if (p.id === this.id) {
            this._emit('selfState', p.state);
            continue;
          }
          seen.add(p.id);
          const old = this.peers.get(p.id);
          if (!old) this._emit('peerJoin', p.id, p.color, p.name, p.state);
          else if (old.name !== p.name) this._emit('peerName', p.id, p.name);
          this.peers.set(p.id, p);
          if (p.state)
            this._emit(
              'peerState',
              p.id,
              p.state,
              msg.time,
              msg.tick,
              this._lastReceive,
            );
        }
        for (const id of this.peers.keys())
          if (!seen.has(id)) {
            this.peers.delete(id);
            this._emit('peerLeave', id);
          }
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this._watchdog);
      this.connected = false;
      this._clearPeers();
      this._emit('disconnect');
      if (this._stopped) return;
      this._emit('status', 'Offline · reconnecting…');
      const delay =
        Math.min(10000, 500 * 2 ** Math.min(this._attempt++, 5)) *
        (0.8 + Math.random() * 0.4);
      this._timer = setTimeout(() => this.connect(), delay);
    };
  }
  stop() {
    this._stopped = true;
    clearTimeout(this._timer);
    clearInterval(this._watchdog);
    this.ws?.close();
    this.connected = false;
    this._clearPeers();
  }
  setName(value) {
    this.name = cleanName(value) || 'Driver';
    if (this.connected && this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ type: 'name', name: this.name }));
  }
  sendState(makeState, now) {
    if (
      !this.connected ||
      this.ws?.readyState !== 1 ||
      now - this._lastSend < TICK_MS ||
      this.ws.bufferedAmount > MAX_BUFFERED
    )
      return false;
    const state = { ...makeState(), seq: this._seq++ };
    if (!validState(state)) return false;
    this._lastSend = now;
    this.ws.send(JSON.stringify({ type: 'state', state }));
    return true;
  }
}
