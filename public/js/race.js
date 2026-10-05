// Ordered quarter-lap gates plus distance/direction checks. Times use simulation time.
export class LapTracker {
  constructor(samples, index, finish = 3) {
    this.samples = samples;
    this.finish = finish;
    this.lap = 1;
    this.bestLap = null;
    this.lastLap = null;
    this.previous = this.phase(index);
    this.invalidate();
  }
  phase(index) {
    return ((index - this.finish + this.samples) % this.samples) / this.samples;
  }
  invalidate() {
    this.active = false;
    this.valid = false;
    this.elapsed = 0;
    this.gates = 0;
    this.travel = 0;
    this.progress = 0;
  }
  resetAt(index) {
    this.previous = this.phase(index);
    this.invalidate();
  }
  update(index, dt, onTrack = true, forward = true) {
    const phase = this.phase(index),
      prev = this.previous;
    this.previous = phase;
    let delta = phase - prev;
    if (delta < -0.5) delta += 1;
    if (delta > 0.5) delta -= 1;
    if (this.active) this.elapsed += dt * 1000;
    if (!onTrack || Math.abs(delta) > 0.08 || delta < -0.002)
      this.valid = false;
    const crossing =
      prev > 0.9 &&
      phase < 0.1 &&
      delta > 0 &&
      delta <= 0.08 &&
      forward &&
      onTrack;
    let completed = null;
    if (crossing) {
      if (
        this.active &&
        this.valid &&
        this.gates === 3 &&
        this.travel + delta >= 0.95
      ) {
        completed = this.elapsed;
        this.lastLap = completed;
        this.bestLap = Math.min(this.bestLap ?? Infinity, completed);
        this.lap++;
      }
      this.active = true;
      this.valid = true;
      this.elapsed = 0;
      this.travel = phase;
      this.gates = 0;
    } else if (this.active && this.valid && delta > 0 && forward) {
      this.travel += delta;
      const nextGate = (this.gates + 1) / 4;
      if (this.gates < 3 && prev < nextGate && phase >= nextGate) this.gates++;
    }
    this.progress = this.active ? phase : 0;
    return completed;
  }
}
export class FixedStep {
  constructor(step = 1 / 60, maxSteps = 15) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.accumulator = 0;
  }
  reset() {
    this.accumulator = 0;
  }
  advance(elapsed, update) {
    const budget = this.step * this.maxSteps;
    const dropped = elapsed > budget;
    this.accumulator += Math.min(Math.max(0, elapsed), budget);
    let steps = 0;
    while (this.accumulator + 1e-9 >= this.step && steps < this.maxSteps) {
      update(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    return { steps, dropped };
  }
}
