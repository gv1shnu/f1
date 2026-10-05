import { normalizeAngle } from '../../public/js/protocol.js';
// Deterministic keyboard-input driver; uses the unchanged arcade Car.update physics.
export function drive(car, dt, pace = 1, lane = 0) {
  const track = car.track;
  const near = track.nearest(car.pos, car.trackIndex);
  const look = 5 + Math.abs(car.speed) * 0.3;
  const ahead =
    (near.index + Math.round((look / track.length) * track.samples)) %
    track.samples;
  const point = track.centerline[ahead],
    tangent = track.tangents[ahead];
  const target = {
    x: point.x - tangent.z * lane,
    z: point.z + tangent.x * lane,
  };
  const angle = normalizeAngle(
    Math.atan2(target.x - car.pos.x, target.z - car.pos.z) - car.heading,
  );
  const t1 = track.tangents[near.index],
    t2 = track.tangents[(near.index + 30) % track.samples];
  const bend = Math.abs(
    normalizeAngle(Math.atan2(t2.x, t2.z) - Math.atan2(t1.x, t1.z)),
  );
  const desired = Math.max(12, Math.min(30, 26 - bend * 28)) * pace;
  return car.update(dt, {
    throttle: car.speed < desired,
    brake: car.speed > desired + 1,
    left: angle > 0.035,
    right: angle < -0.035,
    handbrake: false,
  });
}
