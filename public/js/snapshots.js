import { normalizeAngle } from './protocol.js';
export class SnapshotBuffer {
  constructor(delay = 100) {
    this.delay = delay;
    this.items = [];
    this.offset = Infinity;
    this.sequence = -1;
  }
  push(state, serverTime, sequence, received) {
    if (sequence <= this.sequence || !Number.isFinite(serverTime)) return false;
    this.sequence = sequence;
    this.offset = Math.min(this.offset, received - serverTime);
    if (this.items.at(-1)?.state.reset !== state.reset) this.items = [];
    this.items.push({ state, time: serverTime });
    if (this.items.length > 20) this.items.shift();
    return true;
  }
  sample(now) {
    if (!this.items.length) return null;
    const time = now - this.offset - this.delay;
    while (this.items.length > 2 && this.items[1].time <= time)
      this.items.shift();
    const a = this.items[0],
      b = this.items[1];
    if (!b || time <= a.time) return a.state;
    const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    return {
      ...b.state,
      x: a.state.x + (b.state.x - a.state.x) * t,
      z: a.state.z + (b.state.z - a.state.z) * t,
      h: normalizeAngle(a.state.h + normalizeAngle(b.state.h - a.state.h) * t),
      s: a.state.s + (b.state.s - a.state.s) * t,
    };
  }
}
