import * as THREE from 'three';
export const TRACK_HALF_WIDTH = 8.5;
export class Circuit {
  constructor() {
    const points = [
      [0, 0],
      [0, -120],
      [12, -175],
      [55, -200],
      [110, -195],
      [150, -160],
      [158, -110],
      [130, -70],
      [95, -55],
      [70, -20],
      [80, 30],
      [130, 55],
      [175, 55],
      [200, 15],
      [195, -35],
      [220, -70],
      [265, -70],
      [285, -25],
      [270, 30],
      [225, 75],
      [165, 110],
      [95, 120],
      [30, 115],
      [-15, 90],
      [-20, 55],
      [-5, 25],
    ];
    this.curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'catmullrom',
      0.5,
    );
    this.length = this.curve.getLength();
    this.samples = 1500;
    this.centerline = this.curve.getSpacedPoints(this.samples);
    this.tangents = Array.from({ length: this.samples + 1 }, (_, i) =>
      this.curve.getTangentAt(i / this.samples),
    );
  }
  nearest(pos, hintIndex = null) {
    let best = Infinity,
      index = 0;
    const scan = (from, to) => {
      for (let i = from; i <= to; i++) {
        const n = ((i % this.samples) + this.samples) % this.samples,
          p = this.centerline[n];
        const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
        if (d < best) {
          best = d;
          index = n;
        }
      }
    };
    if (hintIndex !== null) {
      scan(hintIndex - 60, hintIndex + 60);
      if (best > 400) scan(0, this.samples - 1);
    } else scan(0, this.samples - 1);
    const point = this.centerline[index],
      tangent = this.tangents[index];
    const offset =
      (pos.x - point.x) * -tangent.z + (pos.z - point.z) * tangent.x;
    return { index, point, tangent, offset, distance: Math.sqrt(best) };
  }
  startPose(slot = 0) {
    const u = (((3 / this.samples - (6 + slot * 7) / this.length) % 1) + 1) % 1;
    const p = this.curve.getPointAt(u),
      t = this.curve.getTangentAt(u),
      lateral = slot % 2 === 0 ? -3 : 3;
    const position = new THREE.Vector3(
      p.x - t.z * lateral,
      0,
      p.z + t.x * lateral,
    );
    return {
      position,
      heading: Math.atan2(t.x, t.z),
      index: this.nearest(position).index,
    };
  }
}
