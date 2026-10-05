// APEX TV — entry point. Wires renderer + scene + track + car + cockpit +
// network + HUD into one game loop.
import * as THREE from 'three';
import { Track } from './track.js';
import { Car, createCarMesh, disposeCarMesh } from './car.js';
import { Network } from './network.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';

import { FixedStep } from './race.js';
import { SnapshotBuffer } from './snapshots.js';
import { bindInput } from './input.js';
import { cleanName } from './protocol.js';
const MAX_KMH = 331;

// ---------------------------------------------------------------------------
// Renderer + scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  72,
  innerWidth / innerHeight,
  0.1,
  6000,
);

const track = new Track();
scene.add(track.group);
if (location.hash === '#debug') {
  window.__scene = scene;
  window.__camera = camera;
}
const { sun } = track.addSky(scene, renderer);
track.addLights(scene, sun);

// ---------------------------------------------------------------------------
// Local car (physics) + its world mesh (visible in chase cam)
// ---------------------------------------------------------------------------
let localColor = '#e10600';
let car = new Car(track, Math.floor(Math.random() * 6));
const localMesh = createCarMesh(localColor);
scene.add(localMesh);

// ---------------------------------------------------------------------------
// Cockpit overlay — attached to the camera so it stays "in front of" the driver.
// Rough match to the reference: halo, steering wheel with a live display,
// side-mirror pods and a dark dashboard cowl.
// ---------------------------------------------------------------------------
const cockpit = new THREE.Group();
camera.add(cockpit);
scene.add(camera);

const matDark = new THREE.MeshStandardMaterial({
  color: 0x0b0c10,
  roughness: 0.5,
  metalness: 0.4,
});
const matCarbon = new THREE.MeshStandardMaterial({
  color: 0x16181f,
  roughness: 0.7,
  metalness: 0.2,
});

// Dashboard cowl across the bottom of view.
const cowl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.5), matCarbon);
cowl.position.set(0, -0.85, -1.15);
cowl.rotation.x = 0.35;
cockpit.add(cowl);

// Halo hoop overhead.
const halo = new THREE.Mesh(
  new THREE.TorusGeometry(0.7, 0.045, 8, 24, Math.PI),
  matDark,
);
halo.rotation.x = Math.PI / 2 + 0.15;
halo.position.set(0, 0.5, -1.0);
cockpit.add(halo);
// Thin central strut, like a real halo — kept slim so it doesn't block the view.
const haloStrut = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.022, 0.55),
  matDark,
);
haloStrut.position.set(0, 0.22, -1.3);
haloStrut.rotation.x = 0.2;
cockpit.add(haloStrut);

// Steering wheel (rotates with steering input). Built as a group.
const wheel = new THREE.Group();
wheel.position.set(0, -0.5, -0.85);
wheel.rotation.x = -0.55;
cockpit.add(wheel);
const rim = new THREE.Mesh(
  new THREE.TorusGeometry(0.24, 0.03, 10, 28),
  matDark,
);
wheel.add(rim);
// F1 wheels are squared-off top & bottom — add grips.
for (const s of [-1, 1]) {
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.22),
    matDark,
  );
  grip.rotation.z = Math.PI / 2;
  grip.position.set(s * 0.12, -0.12, 0.02);
  wheel.add(grip);
}
const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.02), matDark);
wheel.add(spoke);

// Live display on the wheel (gear + speed), drawn to a canvas texture.
const dashCanvas = document.createElement('canvas');
dashCanvas.width = 256;
dashCanvas.height = 128;
const dctx = dashCanvas.getContext('2d');
const dashTex = new THREE.CanvasTexture(dashCanvas);
const display = new THREE.Mesh(
  new THREE.PlaneGeometry(0.26, 0.13),
  new THREE.MeshBasicMaterial({ map: dashTex }),
);
display.position.set(0, 0.02, 0.03);
wheel.add(display);

function drawDash() {
  dctx.fillStyle = '#05070a';
  dctx.fillRect(0, 0, 256, 128);
  dctx.fillStyle = '#00e0a4';
  dctx.font = 'bold 64px monospace';
  dctx.textBaseline = 'middle';
  dctx.fillText(car.gear, 16, 64);
  dctx.textAlign = 'right';
  dctx.fillStyle = '#ffffff';
  dctx.font = 'bold 48px monospace';
  dctx.fillText(String(car.kmh), 240, 50);
  dctx.font = '18px monospace';
  dctx.fillStyle = '#8a94a0';
  dctx.fillText('KM/H', 240, 92);
  dctx.textAlign = 'left';
  // rev bar
  const ratio = Math.min(1, car.kmh / MAX_KMH);
  for (let i = 0; i < 12; i++) {
    dctx.fillStyle =
      i / 12 < ratio ? (i < 8 ? '#21d07a' : '#e10600') : '#20242c';
    dctx.fillRect(90 + i * 12, 100, 9, 18);
  }
  dashTex.needsUpdate = true;
}

// Side mirror pods (small, like the reference shot).
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.35),
    matDark,
  );
  arm.position.set(s * 0.62, -0.28, -1.2);
  arm.rotation.z = s * 0.5;
  cockpit.add(arm);
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.05), matDark);
  pod.position.set(s * 0.78, -0.16, -1.25);
  cockpit.add(pod);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x223,
      roughness: 0.1,
      metalness: 0.9,
    }),
  );
  glass.position.set(s * 0.78, -0.16, -1.223);
  cockpit.add(glass);
}

// ---------------------------------------------------------------------------
// Camera modes
// ---------------------------------------------------------------------------
const CAM = ['cockpit', 'hood', 'chase'];
let camMode = 0;

function updateCamera() {
  const s = Math.sin(car.heading),
    c = Math.cos(car.heading);

  const mode = CAM[camMode];

  if (mode === 'cockpit') {
    camera.position.set(car.pos.x - s * 0.1, 1.05, car.pos.z - c * 0.1);
    camera.lookAt(car.pos.x + s * 20, 1.0, car.pos.z + c * 20);
    cockpit.visible = true;
    localMesh.visible = false;
  } else if (mode === 'hood') {
    camera.position.set(car.pos.x + s * 1.8, 0.85, car.pos.z + c * 1.8);
    camera.lookAt(car.pos.x + s * 30, 0.7, car.pos.z + c * 30);
    cockpit.visible = false;
    localMesh.visible = true;
  } else {
    // chase
    camera.position.set(car.pos.x - s * 8, 3.4, car.pos.z - c * 8);
    camera.lookAt(car.pos.x + s * 6, 1.2, car.pos.z + c * 6);
    cockpit.visible = false;
    localMesh.visible = true;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  handbrake: false,
};
// ---------------------------------------------------------------------------
// Network + remote cars
// ---------------------------------------------------------------------------
const net = new Network();
const hud = new HUD();
const audio = new GameAudio();
const MAX_SPEED_MS = 92; // keep in sync with car.js MAX_SPEED for audio scaling
const remotes = new Map(); // id -> { mesh, label, target:{x,z,h,s}, name, color, kmh, lap }

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(5,7,11,0.7)';
  roundRect(ctx, 4, 12, 248, 40, 8);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(14, 24, 16, 16);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).slice(0, 14), 40, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false }),
  );
  spr.scale.set(4, 1, 1);
  spr.position.y = 2.4;
  spr.userData = { canvas, color };
  return spr;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function addRemote(id, color, name, state) {
  if (remotes.has(id)) return;
  const mesh = createCarMesh(color);
  const label = makeLabel(name || `P${id}`, color);
  mesh.add(label);
  scene.add(mesh);
  const r = {
    mesh,
    label,
    name: name || `P${id}`,
    color,
    kmh: 0,
    lap: 1,
    buffer: new SnapshotBuffer(),
    progress: state?.progress || 0,
  };
  if (state) {
    mesh.position.set(state.x, 0, state.z);
    mesh.rotation.y = state.h;
    r.kmh = state.v || 0;
    r.lap = state.lap || 1;
  }
  mesh.visible = !!state;
  remotes.set(id, r);
}

let selfState = null;
net
  .on('ready', (id, color) => {
    localColor = color;
    localMesh.userData.bodyMaterial.color.set(color);
    selfState = null;
    car.startSession();
    net.setName(playerName);
  })
  .on('status', (status) => {
    document.getElementById('connection').textContent = status;
    document.getElementById('connection').dataset.online = String(
      net.connected,
    );
  })
  .on('disconnect', () => {
    selfState = null;
    car.invalidateLap();
    hud.flash('CONNECTION LOST — RECONNECTING', 2500);
  })
  .on('selfState', (state) => {
    selfState = state;
  })
  .on('peerJoin', (id, color, name, state) => addRemote(id, color, name, state))
  .on('peerState', (id, state, time, tick, received) => {
    const r = remotes.get(id);
    if (!r) return;
    r.buffer.push(state, time, tick, received);
    r.mesh.visible = true;
    r.kmh = state.v;
    r.lap = state.lap;
    r.progress = state.progress;
  })
  .on('peerName', (id, name) => {
    const r = remotes.get(id);
    if (r) {
      r.name = name;
      refreshLabel(r);
    }
  })
  .on('peerLeave', (id) => {
    const r = remotes.get(id);
    if (!r) return;
    r.label.material.map.dispose();
    r.label.material.dispose();
    r.mesh.remove(r.label);
    disposeCarMesh(r.mesh);
    remotes.delete(id);
  });
function refreshLabel(r) {
  const canvas = r.label.userData.canvas,
    ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(5,7,11,0.7)';
  roundRect(ctx, 4, 12, 248, 40, 8);
  ctx.fill();
  ctx.fillStyle = r.color;
  ctx.fillRect(14, 24, 16, 16);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillText(r.name.slice(0, 14), 40, 34);
  r.label.material.map.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
let playerName = 'Driver';
let running = false;
let last = performance.now();
const fpsEl = document.getElementById('fps');
const offtrackEl = document.getElementById('offtrack');
let __fpsAccum = 0,
  __fpsFrames = 0;

const stepper = new FixedStep();
let lastHUD = 0,
  lastBoard = 0,
  dashKey = '';
let frameIntervals = [];
const diagnostics = document.getElementById('diagnostics');
diagnostics.hidden = location.hash !== '#debug';
const clearInput = bindInput(window, {
  input,
  active: () => running && !document.hidden,
  camera: () => {
    camMode = (camMode + 1) % CAM.length;
    hud.flash(CAM[camMode].toUpperCase(), 700);
  },
  respawn: () => {
    car.respawn();
    hud.flash('↺ BACK ON TRACK', 1000);
  },
  mute: () => hud.flash(audio.toggleMute() ? '🔇 MUTED' : '🔊 SOUND ON', 900),
});
document.addEventListener('visibilitychange', () => {
  clearInput();
  stepper.reset();
  last = performance.now();
  if (running) car.invalidateLap();
  if (audio.ctx) {
    if (document.hidden) audio.ctx.suspend();
    else audio.ctx.resume();
  }
});
addEventListener('pagehide', () => net.stop());
addEventListener('pageshow', (event) => {
  if (event.persisted && running) net.connect();
});
function loop(now) {
  requestAnimationFrame(loop);
  const elapsed = Math.max(0, (now - last) / 1000);
  last = now;
  if (!running || document.hidden) return;
  try {
    if (elapsed > stepper.step * stepper.maxSteps) car.invalidateLap();
    stepper.advance(elapsed, (dt) => {
      const drive = car.update(dt, input);
      offtrackEl.hidden = !drive.offTrack;
      if (drive.respawned) hud.flash('↺ BACK ON TRACK', 1000);
    });
    wheel.rotation.z = -car.steer * 1.6;
    localMesh.userData.frontWheels.forEach(
      (w) => (w.rotation.y = car.steer * 0.5),
    );
    localMesh.position.set(car.pos.x, 0, car.pos.z);
    localMesh.rotation.y = car.heading;
    updateCamera();
    const key = `${car.gear}:${car.kmh}`;
    if (cockpit.visible && key !== dashKey) {
      drawDash();
      dashKey = key;
    }
    for (const r of remotes.values()) {
      const state = r.buffer.sample(now);
      if (!state) continue;
      r.mesh.position.set(state.x, 0, state.z);
      r.mesh.rotation.y = state.h;
      r.mesh.userData.frontWheels.forEach(
        (w) => (w.rotation.y = state.s * 0.5),
      );
    }
    audio.update(
      Math.min(1, Math.abs(car.speed) / MAX_SPEED_MS),
      input.throttle,
    );
    __fpsAccum += elapsed;
    __fpsFrames++;
    if (!diagnostics.hidden) frameIntervals.push(elapsed * 1000);
    if (__fpsAccum >= 1) {
      fpsEl.textContent = `${Math.round(__fpsFrames / __fpsAccum)} FPS`;
      if (!diagnostics.hidden) {
        const sorted = frameIntervals.slice().sort((a, b) => a - b);
        diagnostics.textContent = JSON.stringify({
          mode: CAM[camMode],
          frameMeanMs: (__fpsAccum * 1000) / __fpsFrames,
          frameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
          calls: renderer.info.render.calls,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          remotes: remotes.size,
          x: car.pos.x,
          z: car.pos.z,
          connected: net.connected,
          audioReady: audio.ready,
        });
      }
      __fpsAccum = 0;
      __fpsFrames = 0;
      frameIntervals = [];
    }
    if (now - lastHUD >= 50) {
      hud.update(car, MAX_KMH);
      lastHUD = now;
    }
    if (car.consumeNewLap() != null)
      hud.flash(
        car.lastLap === car.bestLap ? '⚡ FASTEST LAP' : 'LAP COMPLETE',
      );
    if (now - lastBoard >= 100) {
      const board = [
        {
          id: net.id || 0,
          name: playerName,
          color: localColor,
          lap: selfState?.lap || car.lap,
          progress: selfState?.progress ?? car.progress,
        },
      ];
      for (const [id, r] of remotes)
        board.push({
          id,
          name: r.name,
          color: r.color,
          lap: r.lap,
          progress: r.progress,
        });
      hud.updateLeaderboard(board, net.id || 0);
      lastBoard = now;
    }
    net.sendState(() => car.netState(), now);
    renderer.render(scene, camera);
  } catch (err) {
    console.error(err);
    running = false;
    clearInput();
    net.stop();
    document.getElementById('fatal').hidden = false;
  }
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// Start screen wiring
// ---------------------------------------------------------------------------
const startEl = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const loadState = document.getElementById('loadState');
loadState.textContent = 'Circuit ready. Enter to join a practice room.';
startBtn.disabled = false;

nameInput.value = `Driver${Math.floor(Math.random() * 900 + 100)}`;

startBtn.addEventListener('click', () => {
  if (running) return;
  playerName = cleanName(nameInput.value) || 'Driver';
  car.startSession();
  stepper.reset();
  document.activeElement?.blur();
  net.setName(playerName); // no-ops until the socket is open; 'ready' handler resends
  audio.init().catch((err) => console.warn('Audio unavailable', err)); // needs a user gesture to start (autoplay policy)
  startEl.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  running = true;
  net.connect();
  last = performance.now();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBtn.click();
});

// Menu clients do not occupy a room.

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
