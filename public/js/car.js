// Car: arcade physics for the local player + a reusable F1 car mesh factory
// used for both the (hidden) local car and remote players.
import * as THREE from 'three';
import { TRACK_HALF_WIDTH } from './circuit.js';

import { LapTracker } from './race.js';
import { normalizeAngle } from './protocol.js';

// --- Tuning (arcade, not a sim) --------------------------------------------
const MAX_SPEED = 92; // m/s on track (~330 km/h)
const ACCEL = 34; // m/s^2 throttle
const BRAKE = 60; // m/s^2
const REVERSE_MAX = 14;
const ENGINE_DRAG = 6; // coasting deceleration
const OFFTRACK_DRAG = 14; // extra drag on the grass (must be < ACCEL so you can drive back on)
const OFFTRACK_MAX = 30; // speed cap off track
const STEER_RATE = 2.2; // rad/s at low speed
const GRIP_FADE = 0.55; // how much steering fades with speed

export class Car {
  constructor(track, startSlot = 0) {
    this.track = track;
    const start = track.startPose(startSlot);
    this.pos = start.position.clone();
    this.heading = start.heading; // radians, 0 = +Z
    this.speed = 0; // m/s (signed)
    this.steer = 0; // -1..1 visual wheel angle
    this.trackIndex = start.index;

    this.race = new LapTracker(track.samples, start.index);
    this.resetSequence = 0;
  }
  get lap() {
    return this.race.lap;
  }
  get lapTime() {
    return this.race.elapsed;
  }
  get bestLap() {
    return this.race.bestLap;
  }
  get lastLap() {
    return this.race.lastLap;
  }
  get progress() {
    return this.race.progress;
  }
  startSession() {
    this.race = new LapTracker(this.track.samples, this.trackIndex);
    this._newLap = null;
    this.resetSequence++;
  }
  invalidateLap() {
    this.race.resetAt(this.trackIndex);
    this._newLap = null;
    this.resetSequence++;
  }

  get gear() {
    if (this.speed < -0.5) return 'R';
    const kmh = this.speed * 3.6;
    if (kmh < 1) return 'N';
    return String(Math.min(8, 1 + Math.floor(kmh / 42)));
  }

  get kmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }

  update(dt, input) {
    // --- Longitudinal ---
    if (input.throttle) {
      this.speed += ACCEL * dt;
    } else if (input.brake) {
      if (this.speed > 0.2) this.speed -= BRAKE * dt;
      else this.speed -= ACCEL * 0.5 * dt; // into reverse
    } else {
      // coast
      const drag = ENGINE_DRAG * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - drag);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + drag);
    }

    // --- Off-track penalty ---
    const near = this.track.nearest(this.pos, this.trackIndex);
    this.trackIndex = near.index;
    const offTrack = Math.abs(near.offset) > TRACK_HALF_WIDTH;
    if (offTrack) {
      this.speed =
        Math.sign(this.speed) *
        Math.max(0, Math.abs(this.speed) - OFFTRACK_DRAG * dt);
      if (this.speed > OFFTRACK_MAX) this.speed = OFFTRACK_MAX;
      if (this.speed < -OFFTRACK_MAX) this.speed = -OFFTRACK_MAX;
    }

    // Handbrake scrubs speed.
    if (input.handbrake) this.speed *= 1 - 2.5 * dt;

    // Clamp
    this.speed = Math.max(-REVERSE_MAX, Math.min(MAX_SPEED, this.speed));

    // --- Steering (fades at speed, needs motion) ---
    const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const speedFactor = 1 / (1 + Math.abs(this.speed) * GRIP_FADE * 0.05);
    const dirSign = this.speed >= 0 ? 1 : -1;
    const turn =
      this.steer *
      STEER_RATE *
      speedFactor *
      dirSign *
      Math.min(1, Math.abs(this.speed) / 3);
    this.heading = normalizeAngle(this.heading + turn * dt);

    // --- Integrate position ---
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;

    // Safety net: if the car wanders a long way off the circuit, bring it back
    // automatically so it can never get beached out on the grass. Closer than
    // that you can always just drive back on (grass only slows you down).
    if (near.distance > 45) {
      this.respawn();
      return { offTrack: false, respawned: true };
    }

    // --- Lap counting: crossing the start line (near index 3) forward ---
    const after = this.track.nearest(this.pos, this.trackIndex);
    this.trackIndex = after.index;
    const forward =
      this.speed *
        (Math.sin(this.heading) * after.tangent.x +
          Math.cos(this.heading) * after.tangent.z) >
      0;
    const lap = this.race.update(
      after.index,
      dt,
      after.distance <= TRACK_HALF_WIDTH,
      forward,
    );
    if (lap !== null) this._newLap = lap;

    return { offTrack };
  }

  consumeNewLap() {
    const t = this._newLap;
    this._newLap = null;
    return t;
  }

  // Snap back onto the racing line at the nearest point, facing forward.
  // A reliable "get unstuck" for when the car ends up beached on the grass.
  respawn() {
    const near = this.track.nearest(this.pos, this.trackIndex);
    this.pos.x = near.point.x;
    this.pos.z = near.point.z;
    this.heading = Math.atan2(near.tangent.x, near.tangent.z);
    this.speed = 0;
    this.steer = 0;
    this.trackIndex = near.index;
    this.invalidateLap();
  }

  // Serialisable state for the network.
  netState() {
    return {
      x: +this.pos.x.toFixed(2),
      z: +this.pos.z.toFixed(2),
      h: this.heading,
      s: +this.steer.toFixed(2),
      v: this.kmh,
      reset: this.resetSequence,
    };
  }
}

// --- F1 car mesh factory ----------------------------------------------------
// A stylised open-wheel car built from primitives (no external model needed).
function buildCarMesh(colorHex) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.4,
    metalness: 0.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x14161c,
    roughness: 0.6,
  });
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x0c0d10,
    roughness: 0.9,
  });

  // Monocoque / nose
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.45, 4.4),
    bodyMat,
  );
  chassis.position.y = 0.45;
  chassis.castShadow = true;
  g.add(chassis);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 12), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.42, 2.6);
  g.add(nose);

  // Cockpit + halo
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    darkMat,
  );
  cockpit.position.set(0, 0.66, 0.1);
  g.add(cockpit);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.05, 8, 20, Math.PI),
    darkMat,
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, 0.95, 0.2);
  g.add(halo);

  // Front + rear wings
  const fWing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.7), darkMat);
  fWing.position.set(0, 0.28, 3.1);
  g.add(fWing);
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.12), bodyMat);
  rWing.position.set(0, 1.0, -2.2);
  g.add(rWing);
  const rWingTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.06, 0.5),
    darkMat,
  );
  rWingTop.position.set(0, 1.24, -2.2);
  g.add(rWingTop);

  // Sidepods
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.8), bodyMat);
    pod.position.set(s * 0.75, 0.42, -0.3);
    g.add(pod);
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.5, 18);
  const wheels = [];
  const positions = [
    [-0.95, 0.44, 1.7],
    [0.95, 0.44, 1.7],
    [-1.0, 0.44, -1.6],
    [1.0, 0.44, -1.6],
  ];
  for (const [x, y, z] of positions) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, y, z);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }
  g.userData.frontWheels = [wheels[0], wheels[1]];

  return g;
}

let carTemplate;
export function createCarMesh(colorHex) {
  if (!carTemplate) {
    carTemplate = buildCarMesh('#e10600');
    carTemplate.userData = {};
  }
  const mesh = carTemplate.clone(true);
  const body = carTemplate.children[0].material.clone();
  body.color.set(colorHex);
  mesh.traverse((object) => {
    if (object.material === carTemplate.children[0].material)
      object.material = body;
  });
  mesh.userData = {
    bodyMaterial: body,
    frontWheels: mesh.children.slice(-4, -2),
  };
  return mesh;
}
export function disposeCarMesh(mesh) {
  // Geometry and dark/tyre materials belong to the app-lifetime template.
  mesh.userData.bodyMaterial.dispose();
  mesh.removeFromParent();
}
