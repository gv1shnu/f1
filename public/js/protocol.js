// Shared wire contract: reject invalid values before simulation or rendering.
export const TICK_MS = 50;
export const MAX_PAYLOAD = 2048;
export const MAX_BUFFERED = 128 * 1024;
export const ROOM_CAPACITY = 16; // Conservative configurable practice-room limit, not a capacity claim.
export const isRecord = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const normalizeAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function cleanName(value) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 16) || 'Driver'
    : null;
}
const number = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validState(s) {
  return (
    isRecord(s) &&
    number(s.x, -2000, 2000) &&
    number(s.z, -2000, 2000) &&
    number(s.h, -Math.PI - 0.001, Math.PI + 0.001) &&
    number(s.s, -1, 1) &&
    number(s.v, 0, 332) &&
    Number.isSafeInteger(s.seq) &&
    s.seq >= 0 &&
    Number.isSafeInteger(s.reset) &&
    s.reset >= 0
  );
}
export function wireState(s) {
  return {
    x: s.x,
    z: s.z,
    h: normalizeAngle(s.h),
    s: s.s,
    v: s.v,
    seq: s.seq,
    reset: s.reset,
  };
}
export function validPeer(p) {
  return (
    isRecord(p) &&
    Number.isSafeInteger(p.id) &&
    p.id > 0 &&
    typeof p.color === 'string' &&
    /^#[0-9a-f]{6}$/i.test(p.color) &&
    typeof p.name === 'string' &&
    p.name.length <= 16 &&
    (p.state === null ||
      (validState(p.state) &&
        Number.isSafeInteger(p.state.lap) &&
        p.state.lap >= 1 &&
        number(p.state.progress, 0, 1)))
  );
}
