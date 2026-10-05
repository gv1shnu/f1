import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, TRACK_HALF_WIDTH } from '../public/js/circuit.js';
import { Car, createCarMesh, disposeCarMesh } from '../public/js/car.js';
import { LapTracker, FixedStep } from '../public/js/race.js';
import { SnapshotBuffer } from '../public/js/snapshots.js';
import { validState, cleanName } from '../public/js/protocol.js';
import { bindInput } from '../public/js/input.js';
import { Vector3 } from 'three';
const circuit = new Circuit();
test('all 32 supported grid slots are on track and use actual sample indices', () => {
  for (let i = 0; i < 32; i++) {
    const p = circuit.startPose(i),
      n = circuit.nearest(p.position, p.index);
    assert.ok(n.distance < TRACK_HALF_WIDTH, `slot ${i}: ${n.distance}`);
    assert.ok(Math.abs(n.offset) < 3.1);
  }
});
test('partial loop and wrong direction cannot count; a full ordered circuit does', () => {
  const race = new LapTracker(1500, 1490);
  for (const index of [3, 30, 20, 10, 2, 3]) race.update(index, 0.1);
  assert.equal(race.lap, 1);
  const full = new LapTracker(1500, 1490);
  full.update(3, 0.1);
  for (let i = 13; i < 1500; i += 10) full.update(i, 0.1);
  full.update(3, 0.1);
  assert.equal(full.lap, 2);
  assert.ok(full.bestLap > 14000);
});
test('offtrack, respawn, teleport and reverse invalidate a timed lap', () => {
  for (const kind of ['offtrack', 'respawn', 'jump', 'reverse']) {
    const race = new LapTracker(1500, 1490);
    race.update(3, 0.1);
    for (let i = 13; i < 1500; i += 10) {
      if (i === 503) {
        if (kind === 'respawn') race.resetAt(i);
        if (kind === 'jump') race.update(1000, 0.1);
        if (kind === 'reverse') race.update(400, 0.1);
      }
      race.update(i, 0.1, !(kind === 'offtrack' && i === 503));
    }
    race.update(3, 0.1);
    assert.equal(race.lap, 1, kind);
  }
});
test('timing waits for start crossing and resets when invalidated', () => {
  const race = new LapTracker(1500, 1480);
  race.update(1480, 99);
  assert.equal(race.elapsed, 0);
  race.update(3, 0.01);
  race.update(4, 0.5);
  assert.equal(race.elapsed, 500);
  race.invalidate();
  assert.equal(race.elapsed, 0);
});
test('physics agrees at 10/30/60/120 frame rates with fixed steps', () => {
  const track = {
    samples: 1500,
    startPose: () => ({ position: new Vector3(), heading: 0, index: 100 }),
    nearest: (p) => ({
      offset: 0,
      distance: 0,
      index: 100,
      point: p,
      tangent: new Vector3(0, 0, 1),
    }),
  };
  let expected;
  for (const hz of [10, 30, 60, 120]) {
    const car = new Car(track),
      step = new FixedStep();
    for (let i = 0; i < hz; i++)
      step.advance(1 / hz, (dt) => car.update(dt, { throttle: true }));
    assert.ok(Math.abs(car.speed - 34) < 1e-8);
    expected ??= car.pos.z;
    assert.ok(Math.abs(car.pos.z - expected) < 1e-8);
  }
  const step = new FixedStep();
  let calls = 0;
  assert.equal(step.advance(3, () => calls++).dropped, true);
  assert.equal(calls, 15);
});
test('reverse speed is visible and respawn invalidates timing', () => {
  const c = new Car(circuit);
  c.speed = -10;
  assert.equal(c.kmh, 36);
  assert.equal(c.gear, 'R');
  c.respawn();
  assert.equal(c.speed, 0);
  assert.equal(c.race.active, false);
});
test('protocol rejects null, huge headings, numeric fields encoded as strings', () => {
  const state = { x: 0, z: 0, h: 0, s: 0, v: 0, seq: 1, reset: 0 };
  assert.ok(validState(state));
  for (const s of [
    null,
    [],
    { ...state, h: 1e20 },
    { ...state, x: NaN },
    { ...state, v: '1' },
    { ...state, seq: -1 },
  ])
    assert.equal(validState(s), false);
  assert.equal(cleanName(' wasd racer '), 'wasd racer');
  assert.equal(cleanName(123), null);
});
test('snapshot interpolation rejects stale packets and takes shortest heading arc', () => {
  const b = new SnapshotBuffer(100);
  b.push({ x: 0, z: 0, h: 3.1, s: 0, reset: 0 }, 1000, 1, 100);
  b.push({ x: 10, z: 0, h: -3.1, s: 1, reset: 0 }, 1100, 2, 200);
  assert.equal(b.push({ x: 999 }, 1200, 1, 300), false);
  assert.equal(b.sample(250).x, 5);
  assert.ok(Math.abs(b.sample(250).h) > 3);
  assert.equal(b.sample(5000).x, 10);
  b.push({ x: 100, z: 0, h: 0, s: 0, reset: 1 }, 1300, 3, 400);
  assert.equal(b.sample(400).x, 100);
});
test('car geometry is shared and only unique paint is disposed', () => {
  const a = createCarMesh('#ffffff'),
    b = createCarMesh('#00ff00');
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  assert.notEqual(a.userData.bodyMaterial, b.userData.bodyMaterial);
  let disposed = 0;
  a.userData.bodyMaterial.addEventListener('dispose', () => disposed++);
  disposeCarMesh(a);
  assert.equal(disposed, 1);
  assert.equal(b.userData.frontWheels[0], b.children.at(-4));
  disposeCarMesh(b);
});
test('input respects text fields, repeat, duplicate bindings and focus loss', () => {
  const target = new EventTarget(),
    old = globalThis.document;
  globalThis.document = new EventTarget();
  const input = { throttle: false, left: false },
    action = { camera: 0 };
  bindInput(target, {
    active: () => true,
    input,
    camera: () => action.camera++,
    respawn() {},
    mute() {},
  });
  function key(type, code, props = {}) {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, 'code', { value: code });
    for (const [k, v] of Object.entries(props))
      Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
    return e;
  }
  assert.equal(
    key('keydown', 'KeyW', { target: { tagName: 'INPUT' } }).defaultPrevented,
    false,
  );
  assert.equal(input.throttle, false);
  key('keydown', 'KeyW');
  key('keydown', 'ArrowUp');
  key('keyup', 'KeyW');
  assert.equal(input.throttle, true);
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.throttle, false);
  key('keydown', 'KeyC', { repeat: true });
  assert.equal(action.camera, 0);
  key('keydown', 'KeyC');
  assert.equal(action.camera, 1);
  globalThis.document = old;
});
test('jittered and reordered snapshots remain finite and bounded', () => {
  const b = new SnapshotBuffer();
  const arrivals = [
    { seq: 1, t: 1000, arrival: 120 },
    { seq: 3, t: 1100, arrival: 220 },
    { seq: 2, t: 1050, arrival: 240 },
    { seq: 5, t: 1200, arrival: 310 },
    { seq: 4, t: 1150, arrival: 390 },
  ];
  for (const p of arrivals) {
    b.push(
      { x: p.seq, z: 0, h: p.seq % 2 ? 3.13 : -3.13, s: 0, reset: 0 },
      p.t,
      p.seq,
      p.arrival,
    );
    const s = b.sample(p.arrival);
    assert.ok(Number.isFinite(s.h));
    assert.ok(s.x >= 1 && s.x <= 5);
  }
  assert.equal(b.sample(10000).x, 5);
  assert.equal(b.sequence, 5);
});
