// Game audio.
//   - Engine: a CC0 engine recording (see CREDITS.md) looped and pitch-shifted
//     by the car's speed via WebAudio playbackRate.
//   - Wind: procedural filtered noise that rises with speed (synthesised, no
//     asset needed) to fill out the racetrack ambience.
// Everything is created lazily on the first user gesture (autoplay policy).
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.engineSrc = null;
    this.engineGain = null;
    this.windGain = null;
    this.master = null;
    this._buffers = {};
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // --- Engine (looped sample) ---
    try {
      const buf = await this._load('audio/engine.ogg');
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      src.connect(g); g.connect(this.master);
      src.start();
      this.engineSrc = src;
      this.engineGain = g;
    } catch (e) {
      console.warn('Engine sample failed to load; continuing without it.', e);
    }

    // --- Wind (procedural pink-ish noise through a low-pass) ---
    const noise = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const wg = this.ctx.createGain();
    wg.gain.value = 0.0;
    noise.connect(filter); filter.connect(wg); wg.connect(this.master);
    noise.start();
    this.windGain = wg;
    this._windFilter = filter;

    this.ready = true;
  }

  async _load(url) {
    if (this._buffers[url]) return this._buffers[url];
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(arr);
    this._buffers[url] = buf;
    return buf;
  }

  _noiseSource() {
    const seconds = 2;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // simple low-passed noise
      data[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  // speed01: 0..1 fraction of top speed. throttle: bool.
  update(speed01, throttle) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    // Engine pitch: idle ~0.6x up to ~2.2x playback rate.
    if (this.engineSrc) {
      const rate = 0.6 + speed01 * 1.6 + (throttle ? 0.15 : 0);
      this.engineSrc.playbackRate.setTargetAtTime(rate, t, 0.08);
      const vol = 0.18 + speed01 * 0.5 + (throttle ? 0.08 : 0);
      this.engineGain.gain.setTargetAtTime(Math.min(0.8, vol), t, 0.08);
    }
    // Wind rises with speed.
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(speed01 * 0.25, t, 0.15);
      this._windFilter.frequency.setTargetAtTime(400 + speed01 * 1800, t, 0.15);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
}
