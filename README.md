# 🏎️ APEX TV — Web Multiplayer F1

A browser-based, real-time multiplayer open-wheel racing game with a
daylight **cockpit view**, inspired by an F1-broadcast screenshot. Built with
[three.js](https://threejs.org) for rendering and a tiny Node
[`ws`](https://github.com/websockets/ws) server for multiplayer. All assets are
free/open-source or procedurally generated — see [CREDITS.md](CREDITS.md).

![status](https://img.shields.io/badge/status-playable%20prototype-e10600)

## Features

- **Daylight cockpit view** — halo, steering wheel with a live gear/speed
  display, mirror pods and a dashboard cowl, under a procedural daytime sky.
- **Real-time multiplayer** — every browser that connects is another car on
  track, with name labels and a live leaderboard. State relayed over WebSockets.
- **Full GP-style circuit** — a flowing closed-loop track (spline-generated)
  with kerbs, a checkered start/finish line, grandstands and grass run-off.
- **Arcade physics** — throttle/brake/reverse, speed-sensitive steering,
  off-track grip loss, a handbrake, lap timing and fastest-lap detection.
- **Engine + wind audio** — CC0 engine recording pitch-shifted by speed, plus a
  procedural wind layer (mute with **M**). See [CREDITS.md](CREDITS.md).
- **F1 TV-style HUD** — FPS counter, speedo, gear, rev-light strip, lap timing,
  leaderboard.
- **3 camera modes** — cockpit / hood / chase (press **C**).

## Run it

```bash
npm install
npm start
```

Then open <http://localhost:3000>. To race against others, open a second tab
or window (or another device on the same network → `http://<your-ip>:3000`) and
you'll see each other on track.

## Controls

| Key | Action |
|-----|--------|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `C` | Cycle camera (cockpit → hood → chase) |
| `M` | Mute / unmute audio |

## Project layout

```
server.js            Static file server + WebSocket relay (authoritative-lite)
public/
  index.html         Shell, HUD markup, importmap for three.js
  css/style.css      HUD + start-screen styling
  js/main.js         Bootstraps renderer, cockpit, camera, loop, networking
  js/track.js        Circuit spline, road/kerbs/scenery, sunset sky + lights
  js/car.js          Car physics + reusable F1 car mesh factory
  js/network.js      WebSocket client wrapper
  js/hud.js          Speedo / timing / leaderboard / FPS updates
  js/audio.js        Engine (CC0 sample) + procedural wind, WebAudio
  audio/             CC0 engine recordings (see CREDITS.md)
```

## How multiplayer works

The server is a light relay: each client runs its own physics and sends
`{x, z, heading, steer, speed, lap, name}` at ~20 Hz; the server stamps a
player id and broadcasts to everyone else, who interpolate the remote cars.
There's no server-side authority yet — the natural next step is server
reconciliation + collision.

## Roadmap ideas

- Server-authoritative positions + car-to-car collisions
- Countdown grid start & race sessions (not just free practice)
- Sector times, DRS zones, tyre/fuel model
- Gamepad support, mobile touch controls
- A real GLTF car/track from a CC0 source (credited)

## License

Code: MIT. See [CREDITS.md](CREDITS.md) for third-party attributions. Not
affiliated with Formula 1 / FIA / F1 TV.
