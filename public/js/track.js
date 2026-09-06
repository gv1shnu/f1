// Circuit + environment builder.
// Builds a closed-loop F1-style track from a Catmull-Rom spline, generates the
// road ribbon, kerbs, grass, grandstands and a sunset sky to match the
// cockpit-at-dusk reference shot.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const TRACK_HALF_WIDTH = 8.5;   // metres either side of centreline
const KERB_WIDTH = 1.4;

// Control points for a flowing circuit (x, z on the ground plane, y=0).
// Loosely evokes a modern GP layout: long straight, hairpin, esses, sweepers.
const CONTROL_POINTS = [
  [0, 0], [0, -120], [12, -175], [55, -200], [110, -195], [150, -160],
  [158, -110], [130, -70], [95, -55], [70, -20], [80, 30], [130, 55],
  [175, 55], [200, 15], [195, -35], [220, -70], [265, -70], [285, -25],
  [270, 30], [225, 75], [165, 110], [95, 120], [30, 115], [-15, 80],
  [-25, 30], [-12, -10],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export class Track {
  constructor() {
    this.curve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    // Precompute a dense polyline of the centreline for fast nearest-point
    // lookups (used for keeping cars on track + lap progress).
    this.samples = 1500;
    this.centerline = this.curve.getSpacedPoints(this.samples); // samples+1 pts
    this.tangents = [];
    for (let i = 0; i <= this.samples; i++) {
      this.tangents.push(this.curve.getTangentAt(i / this.samples));
    }

    this.group = new THREE.Group();
    this._buildRoad();
    this._buildKerbs();
    this._buildScenery();
  }

  // ---- Geometry ------------------------------------------------------------
  _ribbon(halfWidth, y, uRepeat) {
    // Build a flat ribbon following the centreline at a given half-width.
    const n = this.samples;
    const positions = [];
    const uvs = [];
    const indices = [];
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3();

    for (let i = 0; i <= n; i++) {
      const p = this.centerline[i];
      const t = this.tangents[i];
      side.crossVectors(t, up).normalize().multiplyScalar(halfWidth);
      positions.push(p.x - side.x, y, p.z - side.z);
      positions.push(p.x + side.x, y, p.z + side.z);
      const v = (i / n) * uRepeat;
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _buildRoad() {
    const geo = this._ribbon(TRACK_HALF_WIDTH, 0.02, this.length / 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1c22, roughness: 0.95, metalness: 0.0,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.group.add(road);

    // Centre + edge lane lines (thin bright ribbons).
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xdfe4ea });
    const lEdge = new THREE.Mesh(this._edgeStripe(TRACK_HALF_WIDTH - 0.25, 1), lineMat);
    const rEdge = new THREE.Mesh(this._edgeStripe(-(TRACK_HALF_WIDTH - 0.25), 1), lineMat);
    lEdge.position.y = rEdge.position.y = 0.035;
    this.group.add(lEdge, rEdge);

    // Start/finish line — checkerboard band near sample 0.
    this._buildStartLine();
  }

  _edgeStripe(offset, width) {
    const n = this.samples;
    const positions = [], indices = [];
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const p = this.centerline[i], t = this.tangents[i];
      side.crossVectors(t, up).normalize();
      const o1 = offset - width / 2, o2 = offset + width / 2;
      positions.push(p.x + side.x * o1, 0, p.z + side.z * o1);
      positions.push(p.x + side.x * o2, 0, p.z + side.z * o2);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _buildKerbs() {
    // Red/white kerbs just outside the racing surface.
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d21b1b'; ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, 32, 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.length / 6, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });

    for (const dir of [1, -1]) {
      const geo = this._sideRibbon(dir * (TRACK_HALF_WIDTH + KERB_WIDTH / 2), KERB_WIDTH, 0.05);
      const kerb = new THREE.Mesh(geo, mat.clone());
      kerb.material.map = tex;
      this.group.add(kerb);
    }
  }

  _sideRibbon(offset, width, y) {
    const n = this.samples;
    const positions = [], uvs = [], indices = [];
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const p = this.centerline[i], t = this.tangents[i];
      side.crossVectors(t, up).normalize();
      const o1 = offset - width / 2, o2 = offset + width / 2;
      positions.push(p.x + side.x * o1, y, p.z + side.z * o1);
      positions.push(p.x + side.x * o2, y, p.z + side.z * o2);
      const u = (i / n) * (this.length / 6);
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _buildStartLine() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const s = 8;
    for (let y = 0; y < 64; y += s) {
      for (let x = 0; x < 64; x += s) {
        ctx.fillStyle = ((x / s + y / s) % 2 === 0) ? '#f5f5f5' : '#12141a';
        ctx.fillRect(x, y, s, s);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    const p = this.centerline[3], t = this.tangents[3];
    const geo = new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2, 3);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(t.x, t.z);
    mesh.position.set(p.x, 0.04, p.z);
    this.group.add(mesh);
  }

  _buildScenery() {
    // Ground plane (grass).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x4f8a3f, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Grandstands + trackside boards spaced along the loop.
    // Placed well outside the track, and only where the spot is clear of every
    // other part of the (looping) circuit — otherwise a stand on the inside of
    // a hairpin can land on the opposite straight.
    const standMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.6 });
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
    const STAND_DIST = TRACK_HALF_WIDTH + 26;   // metres from centreline
    const STAND_HALF_LEN = 13;                  // half of the 26-long footprint
    for (let i = 0; i < this.samples; i += 110) {
      const p = this.centerline[i], t = this.tangents[i];
      side.crossVectors(t, up).normalize();
      const dir = (i % 220 === 0) ? 1 : -1;
      const sx = p.x + side.x * STAND_DIST * dir;
      const sz = p.z + side.z * STAND_DIST * dir;

      // Reject if any point on the footprint is too close to the track.
      const clearance = this._distToTrack(sx, sz);
      if (clearance < STAND_HALF_LEN + TRACK_HALF_WIDTH + 6) continue;

      const stand = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 5), standMat);
      base.position.y = 3.5; base.castShadow = true;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 6.5), roofMat);
      roof.position.y = 7.6;
      stand.add(base, roof);
      stand.position.set(sx, 0, sz);
      stand.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
      this.group.add(stand);
    }

    // Distant tree ring for depth.
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x1f3d24, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 1 });
    for (let a = 0; a < Math.PI * 2; a += 0.14) {
      const r = 360 + Math.random() * 120;
      const cx = 120 + Math.cos(a) * r;
      const cz = -30 + Math.sin(a) * r;
      const h = 6 + Math.random() * 6;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, h * 0.4), trunkMat);
      trunk.position.set(cx, h * 0.2, cz);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(2.5 + Math.random() * 1.5, h, 7), treeMat);
      crown.position.set(cx, h * 0.6, cz);
      this.group.add(trunk, crown);
    }
  }

  // ---- Sunset sky + lighting ----------------------------------------------
  addSky(scene, renderer) {
    const sky = new Sky();
    sky.scale.setScalar(45000);
    scene.add(sky);
    const u = sky.material.uniforms;
    // Clear bright daytime sky.
    u.turbidity.value = 4;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;

    // High sun for full daylight.
    const sun = new THREE.Vector3();
    const elevation = 42;    // degrees above horizon
    const azimuth = 150;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sun);

    scene.fog = new THREE.FogExp2(0xcfe0ef, 0.0009);
    return { sky, sun };
  }

  addLights(scene, sun) {
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5f7a45, 0.9);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff4e2, 3.0);
    dir.position.copy(sun).multiplyScalar(300);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const d = 120;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    dir.shadow.camera.far = 800;
    dir.shadow.bias = -0.0005;
    scene.add(dir);
    this.sunLight = dir;

    const amb = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(amb);
  }

  // ---- Queries used by physics / racing logic ------------------------------

  // Returns { offset, index, tangent } — signed lateral offset from centreline
  // (positive = right of travel direction), nearest sample index, and tangent.
  nearest(pos, hintIndex = null) {
    let best = Infinity, bi = 0;
    // Search near the hint first for speed; fall back to full scan.
    const scan = (from, to) => {
      for (let i = from; i <= to; i++) {
        const idx = ((i % (this.samples + 1)) + (this.samples + 1)) % (this.samples + 1);
        const p = this.centerline[idx];
        const dx = p.x - pos.x, dz = p.z - pos.z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = idx; }
      }
    };
    if (hintIndex != null) {
      scan(hintIndex - 60, hintIndex + 60);
      if (best > 400) { best = Infinity; scan(0, this.samples); }
    } else {
      scan(0, this.samples);
    }
    const t = this.tangents[bi];
    const p = this.centerline[bi];
    const side = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
    const offset = (pos.x - p.x) * side.x + (pos.z - p.z) * side.z;
    return { offset, index: bi, tangent: t, point: p };
  }

  // Nearest distance (metres) from an arbitrary point to the centreline.
  _distToTrack(x, z) {
    let best = Infinity;
    for (let i = 0; i <= this.samples; i += 3) {
      const p = this.centerline[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Grid start pose: a little behind the start/finish line, offset per slot.
  startPose(slot = 0) {
    const idx = 3;
    const p = this.centerline[idx];
    const t = this.tangents[idx];
    const side = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
    const back = t.clone().multiplyScalar(-(6 + slot * 7));
    const lateral = side.clone().multiplyScalar((slot % 2 === 0 ? -1 : 1) * 3);
    return {
      position: new THREE.Vector3(p.x + back.x + lateral.x, 0, p.z + back.z + lateral.z),
      heading: Math.atan2(t.x, t.z),
      index: idx,
    };
  }
}
