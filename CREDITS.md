# Credits & Asset Attribution

APEX TV is built entirely from free / open-source software and procedurally
generated assets. No proprietary game assets are used. The reference screenshot
(F1-style cockpit at sunset) was used **only as visual inspiration** — nothing
from it is redistributed.

## Libraries

| Asset | Author | License | Use |
|-------|--------|---------|-----|
| [three.js](https://threejs.org) `0.160.0` | Ricardo Cabello (mrdoob) & contributors | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE) | 3D rendering |
| [three.js `Sky`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js) addon | three.js contributors (Preetham/Hosek-Wilkie sky model) | MIT | Procedural sunset sky |
| [ws](https://github.com/websockets/ws) `^8.18` | Einar Otto Stangvik & contributors | [MIT](https://github.com/websockets/ws/blob/master/LICENSE) | WebSocket server |

three.js is loaded at runtime from the [jsDelivr](https://www.jsdelivr.com) CDN.

## Audio assets

| Asset | Source | License | Use |
|-------|--------|---------|-----|
| Engine recordings (`public/audio/engine.ogg` — "Ferrari Enzo", `engine_hi.ogg` — "Audi v10") | ["Car Engine Sounds" collection, Internet Archive](https://archive.org/details/car-engines) | [CC0 1.0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/) | Looped, pitch-shifted engine sound |
| Wind / speed ambience | Procedurally synthesised with the Web Audio API (`public/js/audio.js`) | MIT (this project) | Rises with car speed |

The engine samples are looped and their `playbackRate` is driven by the car's
speed, so no per-RPM sample set is required. Drop-in replacement: swap the files
in `public/audio/` (keep the names) to use your own CC0 engine loops.

## Procedurally generated in-repo (no external files)

Everything below is generated in code at load time — see the noted source file:

- **Circuit / track ribbon, kerbs, start-finish line** — Catmull-Rom spline mesh (`public/js/track.js`)
- **F1 car models** — built from three.js primitives (`public/js/car.js`, `createCarMesh`)
- **Cockpit** (halo, steering wheel + live display, mirror pods, dash cowl) — primitives (`public/js/main.js`)
- **Daylight sky, fog & lighting** — three.js `Sky` shader + directional/hemisphere lights (`public/js/track.js`)
- **Grandstands, trees, ground** — primitives (`public/js/track.js`)
- **Kerb / checkerboard / wheel-display textures** — drawn to `<canvas>` at runtime

## Fonts

System UI fonts only (`system-ui`, `monospace`) — no bundled font files.

## Not affiliated

APEX TV is a fan/educational project. It is **not** affiliated with, endorsed
by, or connected to Formula 1, the FIA, F1 TV, or any team. "F1", "Formula 1"
and related marks belong to their respective owners. The in-game brand is the
fictional "APEX TV".
