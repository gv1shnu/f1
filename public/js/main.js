// APEX TV — entry point. Wires renderer + scene + track + car + cockpit +
// network + HUD into one game loop.
import * as THREE from 'three';
import { Track } from './track.js?v=2';
import { Car, createCarMesh } from './car.js?v=2';
import { Network } from './network.js?v=2';
import { HUD } from './hud.js?v=2';
import { GameAudio } from './audio.js?v=2';

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
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 6000);

const track = new Track();
scene.add(track.group);
if (location.hash === '#debug') { window.__scene = scene; window.__camera = camera; }
const { sun } = track.addSky(scene, renderer);
track.addLights(scene, sun);

// ---------------------------------------------------------------------------
// Local car (physics) + its world mesh (visible in chase cam)
// ---------------------------------------------------------------------------
const localColor = '#e10600';
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

const matDark = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5, metalness: 0.4 });
const matCarbon = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.7, metalness: 0.2 });

// Dashboard cowl across the bottom of view.
const cowl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.5), matCarbon);
cowl.position.set(0, -0.85, -1.15);
cowl.rotation.x = 0.35;
cockpit.add(cowl);

// Halo hoop overhead.
const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.045, 8, 24, Math.PI), matDark);
halo.rotation.x = Math.PI / 2 + 0.15;
halo.position.set(0, 0.5, -1.0);
cockpit.add(halo);
// Thin central strut, like a real halo — kept slim so it doesn't block the view.
const haloStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.55), matDark);
haloStrut.position.set(0, 0.22, -1.3);
haloStrut.rotation.x = 0.2;
cockpit.add(haloStrut);

// Steering wheel (rotates with steering input). Built as a group.
const wheel = new THREE.Group();
wheel.position.set(0, -0.5, -0.85);
wheel.rotation.x = -0.55;
cockpit.add(wheel);
const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 10, 28), matDark);
wheel.add(rim);
// F1 wheels are squared-off top & bottom — add grips.
for (const s of [-1, 1]) {
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22), matDark);
  grip.rotation.z = Math.PI / 2;
  grip.position.set(s * 0.12, -0.12, 0.02);
  wheel.add(grip);
}
const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.02), matDark);
wheel.add(spoke);

// Live display on the wheel (gear + speed), drawn to a canvas texture.
const dashCanvas = document.createElement('canvas');
dashCanvas.width = 256; dashCanvas.height = 128;
const dctx = dashCanvas.getContext('2d');
const dashTex = new THREE.CanvasTexture(dashCanvas);
const display = new THREE.Mesh(
  new THREE.PlaneGeometry(0.26, 0.13),
  new THREE.MeshBasicMaterial({ map: dashTex })
);
display.position.set(0, 0.02, 0.03);
wheel.add(display);

function drawDash() {
  dctx.fillStyle = '#05070a'; dctx.fillRect(0, 0, 256, 128);
  dctx.fillStyle = '#00e0a4';
  dctx.font = 'bold 64px monospace'; dctx.textBaseline = 'middle';
  dctx.fillText(car.gear, 16, 64);
  dctx.textAlign = 'right';
  dctx.fillStyle = '#ffffff';
  dctx.font = 'bold 48px monospace';
  dctx.fillText(String(car.kmh), 240, 50);
  dctx.font = '18px monospace'; dctx.fillStyle = '#8a94a0';
  dctx.fillText('KM/H', 240, 92);
  dctx.textAlign = 'left';
  // rev bar
  const ratio = Math.min(1, car.kmh / MAX_KMH);
  for (let i = 0; i < 12; i++) {
    dctx.fillStyle = i / 12 < ratio ? (i < 8 ? '#21d07a' : '#e10600') : '#20242c';
    dctx.fillRect(90 + i * 12, 100, 9, 18);
  }
  dashTex.needsUpdate = true;
}

// Side mirror pods (small, like the reference shot).
for (const s of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35), matDark);
  arm.position.set(s * 0.62, -0.28, -1.2);
  arm.rotation.z = s * 0.5;
  cockpit.add(arm);
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.05), matDark);
  pod.position.set(s * 0.78, -0.16, -1.25);
  cockpit.add(pod);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x223, roughness: 0.1, metalness: 0.9 })
  );
  glass.position.set(s * 0.78, -0.16, -1.223);
  cockpit.add(glass);
}

// ---------------------------------------------------------------------------
// Camera modes
// ---------------------------------------------------------------------------
const CAM = ['cockpit', 'chase', 'hood'];
let camMode = 0;

function updateCamera() {
  const s = Math.sin(car.heading), c = Math.cos(car.heading);
  const forward = new THREE.Vector3(s, 0, c);
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
  } else { // chase
    camera.position.set(car.pos.x - s * 8, 3.4, car.pos.z - c * 8);
    camera.lookAt(car.pos.x + s * 6, 1.2, car.pos.z + c * 6);
    cockpit.visible = false;
    localMesh.visible = true;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { throttle: false, brake: false, left: false, right: false, handbrake: false };
const keymap = {
  KeyW: 'throttle', ArrowUp: 'throttle',
  KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
};
addEventListener('keydown', (e) => {
  if (keymap[e.code]) { input[keymap[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyC') camMode = (camMode + 1) % CAM.length;
  if (e.code === 'KeyM') {
    const m = audio.toggleMute();
    hud.flash(m ? '🔇 MUTED' : '🔊 SOUND ON', 900);
  }
});
addEventListener('keyup', (e) => {
  if (keymap[e.code]) { input[keymap[e.code]] = false; e.preventDefault(); }
});

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
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(5,7,11,0.7)';
  roundRect(ctx, 4, 12, 248, 40, 8); ctx.fill();
  ctx.fillStyle = color; ctx.fillRect(14, 24, 16, 16);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui'; ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 14), 40, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(4, 1, 1);
  spr.position.y = 2.4;
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
  const r = { mesh, label, name: name || `P${id}`, color, kmh: 0, lap: 1,
              target: state ? { x: state.x, z: state.z, h: state.h, s: state.s } : null };
  if (state) { mesh.position.set(state.x, 0, state.z); mesh.rotation.y = state.h; r.kmh = state.v || 0; r.lap = state.lap || 1; }
  remotes.set(id, r);
}

net.on('ready', (id) => { net.setName(playerName); })
   .on('peerJoin', (id, color, name, state) => addRemote(id, color, name, state))
   .on('peerState', (id, state) => {
      const r = remotes.get(id); if (!r || !state) return;
      r.target = { x: state.x, z: state.z, h: state.h, s: state.s };
      r.kmh = state.v || 0; r.lap = state.lap || 1;
      if (state.name && state.name !== r.name) { r.name = state.name; refreshLabel(r); }
   })
   .on('peerName', (id, name) => { const r = remotes.get(id); if (r) { r.name = name; refreshLabel(r); } })
   .on('peerLeave', (id) => {
      const r = remotes.get(id); if (!r) return;
      scene.remove(r.mesh); remotes.delete(id);
   });

function refreshLabel(r) {
  r.mesh.remove(r.label);
  r.label = makeLabel(r.name, r.color);
  r.mesh.add(r.label);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
let playerName = 'Driver';
let running = false;
let last = performance.now();
const fpsEl = document.getElementById('fps');
let __fpsAccum = 0, __fpsFrames = 0;

let __frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  __frames++;
  if (location.hash === '#debug') window.__dbg = { frames: __frames, running, camMode };
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running) return;
  try {
  car.update(dt, input);

  // Steering wheel visual.
  wheel.rotation.z = -car.steer * 1.6;
  localMesh.userData.frontWheels?.forEach((w) => { w.rotation.y = car.steer * 0.5; });

  // Local car mesh follows physics (for chase/hood cams).
  localMesh.position.set(car.pos.x, 0, car.pos.z);
  localMesh.rotation.y = car.heading;

  updateCamera();
  drawDash();

  // Interpolate remote cars toward their last known state.
  for (const r of remotes.values()) {
    if (!r.target) continue;
    const m = r.mesh;
    m.position.x += (r.target.x - m.position.x) * Math.min(1, dt * 10);
    m.position.z += (r.target.z - m.position.z) * Math.min(1, dt * 10);
    // Shortest-arc heading lerp.
    let dh = r.target.h - m.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    m.rotation.y += dh * Math.min(1, dt * 10);
    r.mesh.userData.frontWheels?.forEach((w) => { w.rotation.y = (r.target.s || 0) * 0.5; });
  }

  // Audio: pitch/volume track speed.
  audio.update(Math.min(1, Math.abs(car.speed) / MAX_SPEED_MS), input.throttle);

  // FPS (rolling average).
  __fpsAccum += dt; __fpsFrames++;
  if (__fpsAccum >= 0.5) {
    const fps = Math.round(__fpsFrames / __fpsAccum);
    fpsEl.textContent = `${fps} FPS`;
    __fpsAccum = 0; __fpsFrames = 0;
  }

  // HUD
  hud.update(car, MAX_KMH);
  const newLap = car.consumeNewLap();
  if (newLap != null) {
    hud.flash(car.lastLap === car.bestLap ? '⚡ FASTEST LAP' : 'LAP COMPLETE');
  }
  const board = [{ id: net.id, name: playerName, color: localColor, lap: car.lap, kmh: car.kmh }];
  for (const [id, r] of remotes) board.push({ id, name: r.name, color: r.color, lap: r.lap, kmh: r.kmh });
  hud.updateLeaderboard(board, net.id);

  // Broadcast our state (rate-limited inside Network).
  net.sendState(car.netState(playerName), now);
  } catch (err) {
    window.__loopErr = (err && err.stack) || String(err);
    running = false; // stop spamming
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// Start screen wiring
// ---------------------------------------------------------------------------
const startEl = document.getElementById('start');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const loadState = document.getElementById('loadState');
loadState.textContent = 'Circuit ready. Connecting…';

nameInput.value = `Driver${Math.floor(Math.random() * 900 + 100)}`;

startBtn.addEventListener('click', () => {
  playerName = (nameInput.value || 'Driver').trim().slice(0, 16);
  net.setName(playerName); // no-ops until the socket is open; 'ready' handler resends
  audio.init();            // needs a user gesture to start (autoplay policy)
  startEl.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  running = true;
  last = performance.now();
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });

// Connect early so peers show up the moment we enter.
net.connect();

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
