// Thin WebSocket client wrapper around the relay server.
// Emits callbacks for lifecycle + peer updates; buffers outgoing state so we
// send at a fixed rate rather than every frame.
export class Network {
  constructor() {
    this.ws = null;
    this.id = null;
    this.color = null;
    this.peers = new Map(); // id -> { color, name, state }
    this.handlers = {};
    this._lastSend = 0;
    this._sendInterval = 50; // ms (~20 Hz)
    this.connected = false;
  }

  on(event, fn) { this.handlers[event] = fn; return this; }
  _emit(event, ...args) { this.handlers[event]?.(...args); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);

    this.ws.onopen = () => { this.connected = true; };
    this.ws.onclose = () => { this.connected = false; this._emit('disconnect'); };
    this.ws.onerror = () => { this.connected = false; };

    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          this.id = msg.id; this.color = msg.color;
          for (const p of msg.players) {
            this.peers.set(p.id, { color: p.color, name: p.name, state: p.state });
            this._emit('peerJoin', p.id, p.color, p.name, p.state);
          }
          this._emit('ready', msg.id, msg.color);
          break;
        case 'join':
          this.peers.set(msg.id, { color: msg.color, name: msg.name, state: null });
          this._emit('peerJoin', msg.id, msg.color, msg.name, null);
          break;
        case 'state': {
          const p = this.peers.get(msg.id);
          if (p) { p.state = msg.state; if (msg.state?.name) p.name = msg.state.name; }
          this._emit('peerState', msg.id, msg.state);
          break;
        }
        case 'name': {
          const p = this.peers.get(msg.id);
          if (p) p.name = msg.name;
          this._emit('peerName', msg.id, msg.name);
          break;
        }
        case 'leave':
          this.peers.delete(msg.id);
          this._emit('peerLeave', msg.id);
          break;
      }
    };
  }

  _open() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  setName(name) {
    if (this._open()) this.ws.send(JSON.stringify({ type: 'name', name }));
  }

  sendState(state, now) {
    if (!this._open()) return;
    if (now - this._lastSend < this._sendInterval) return;
    this._lastSend = now;
    this.ws.send(JSON.stringify({ type: 'state', state }));
  }
}
