import { Car } from '../../public/js/car.js';
import { Network } from '../../public/js/network.js';
import { drive } from './driver.js';
export function createSession({ car, net, track, renderer, audio }) {
  const entries = [
    {
      name: 'Rival 01',
      car: new Car(track, 0),
      net: new Network(),
      pace: 1,
      lane: -3,
    },
    {
      name: 'Rival 02',
      car: new Car(track, 1),
      net: new Network(),
      pace: 0.996,
      lane: 3,
    },
    { name: 'POV Driver', car, net, pace: 1.02, lane: 0 },
  ];
  for (const e of entries.slice(0, 2))
    e.net.on('ready', () => {
      e.car.startSession();
      e.net.setName(e.name);
    });
  let started = false,
    recording = false,
    phase = 'waiting',
    elapsed = 0,
    countdown = 3,
    finishHold = 0,
    finished = 0;
  const chunks = [],
    sampleFrames = [];
  const output = document.createElement('canvas');
  output.width = 1280;
  output.height = 720;
  output.style =
    'position:fixed;inset:0;width:100%;height:100%;z-index:70;pointer-events:none';
  output.id = 'raceRecording';
  const ctx = output.getContext('2d');
  const status = document.createElement('output');
  status.id = 'recordingStatus';
  status.style =
    'position:fixed;bottom:4px;left:4px;z-index:80;font:11px monospace;color:#aaa';
  status.textContent = 'Recording simulation ready';
  document.body.append(status);
  let recorder, previousFrame;
  function beginRecording() {
    document.body.append(output);
    recording = true;
    phase = 'countdown';
    const stream = output.captureStream(30);
    if (audio.ctx && audio.master) {
      const destination = audio.ctx.createMediaStreamDestination();
      audio.master.connect(destination);
      for (const t of destination.stream.getAudioTracks()) stream.addTrack(t);
    }
    const mime = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((s) => MediaRecorder.isTypeSupported(s));
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6000000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      status.textContent = 'Saving video…';
      try {
        const blob = new Blob(chunks, { type: mime });
        const result = await fetch('/capture', {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: blob,
        });
        if (!result.ok) throw new Error(`save ${result.status}`);
        const summary = {
          pov: 'POV Driver',
          camera: 'cockpit',
          clients: 3,
          width: 1280,
          height: 720,
          requestedFps: 30,
          seconds: elapsed + 3 + finishHold,
          drivers: entries.map((e) => ({
            name: e.name,
            lap: e.car.lap,
            bestLapMs: e.car.bestLap,
            finishSeconds: e.finish,
            offTrackFrames: e.off || 0,
          })),
          bytes: blob.size,
          frameSamples: sampleFrames,
        };
        await fetch('/capture-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summary),
        });
        status.textContent = 'RECORDING SAVED — all 3 drivers finished';
        phase = 'saved';
        for (const e of entries) e.net.stop();
      } catch (e) {
        status.textContent = `RECORDING FAILED: ${e.message}`;
      }
      for (const t of stream.getTracks()) t.stop();
    };
    recorder.start(1000);
    status.textContent = 'RECORDING · 3 clients · countdown';
  }
  function update(dt) {
    if (!started) {
      started = true;
      for (const e of entries.slice(0, 2)) {
        e.net.setName(e.name);
        e.net.connect();
      }
    }
    if (phase === 'waiting') {
      if (
        entries.every((e) => e.net.connected) &&
        net.peers.size === 2 &&
        audio.ready
      )
        beginRecording();
      return { offTrack: false };
    }
    if (phase === 'countdown') {
      countdown -= dt;
      if (countdown <= 0) phase = 'racing';
      return { offTrack: false };
    }
    if (phase !== 'racing') return { offTrack: false };
    elapsed += dt;
    let localDrive = { offTrack: false };
    for (const e of entries) {
      if (e.finish !== undefined) continue;
      const d = drive(e.car, dt, e.pace, e.lane);
      if (d.offTrack) e.off = (e.off || 0) + 1;
      if (e === entries[2]) localDrive = d;
      if (e.car.lap >= 2) {
        e.finish = elapsed;
        e.place = ++finished;
        e.car.speed = 0;
      }
    }
    if (entries.every((e) => e.finish !== undefined)) {
      phase = 'finished';
      status.textContent = 'FINISHED · saving after results';
    }
    if (elapsed > 150) {
      status.textContent = 'SIMULATION TIMEOUT';
      recorder.stop();
      phase = 'failed';
    }
    return localDrive;
  }
  function text(s, x, y, size = 20, color = '#fff', align = 'left') {
    ctx.font = `600 ${size}px system-ui`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  }
  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(7,12,20,.80)';
    ctx.fillRect(x, y, w, h);
  }
  function frame(now) {
    for (const e of entries.slice(0, 2))
      e.net.sendState(() => e.car.netState(), now);
    if (!recording || phase === 'saved') return;
    const dt = previousFrame ? (now - previousFrame) / 1000 : 0;
    previousFrame = now;
    ctx.drawImage(renderer.domElement, 0, 0, 1280, 720);
    panel(0, 0, 1280, 57);
    text('APEX TV', 24, 37, 27);
    text('3-DRIVER RACE · 1 LAP', 640, 35, 19, '#dce5ef', 'center');
    text('POV DRIVER', 1255, 34, 18, '#8eeac6', 'right');
    const sorted = entries
      .slice()
      .sort((a, b) =>
        a.place && b.place
          ? a.place - b.place
          : a.place
            ? -1
            : b.place
              ? 1
              : b.car.lap + b.car.progress - (a.car.lap + a.car.progress),
      );
    panel(995, 78, 260, 152);
    sorted.forEach((e, i) => {
      text(
        `${i + 1}  ${e.name}`,
        1010,
        111 + i * 43,
        19,
        e === entries[2] ? '#8eeac6' : '#fff',
      );
      text(
        e.finish !== undefined ? 'FIN' : `${Math.min(e.car.lap, 1)}/1`,
        1240,
        111 + i * 43,
        16,
        '#9eacbd',
        'right',
      );
    });
    panel(24, 78, 235, 120);
    text('LAP  1 / 1', 40, 110, 20);
    text(
      `TIME  ${(car.bestLap ?? car.lapTime) / 1000 > 0 ? ((car.bestLap ?? car.lapTime) / 1000).toFixed(3) : '0.000'} s`,
      40,
      149,
      20,
    );
    text(
      `POSITION  ${sorted.indexOf(entries[2]) + 1} / 3`,
      40,
      181,
      16,
      '#9eacbd',
    );
    panel(520, 618, 240, 80);
    text(car.gear, 542, 675, 42, '#8eeac6');
    text(`${car.kmh}`, 703, 675, 46, '#fff', 'right');
    text('KM/H', 745, 675, 12, '#9eacbd', 'right');
    if (phase === 'countdown') {
      panel(440, 250, 400, 160);
      text('STARTING GRID', 640, 295, 22, '#fff', 'center');
      text(
        String(Math.max(1, Math.ceil(countdown))),
        640,
        380,
        78,
        '#ff4b43',
        'center',
      );
    }
    if (phase === 'racing' && elapsed < 1.4)
      text('GO', 640, 330, 80, '#78ffbd', 'center');
    if (entries[2].finish !== undefined) {
      panel(320, 225, 640, 190);
      text('CHEQUERED FLAG', 640, 274, 35, '#fff', 'center');
      text(
        `POV DRIVER · P${entries[2].place}`,
        640,
        326,
        28,
        '#8eeac6',
        'center',
      );
      text(
        `${(car.bestLap / 1000).toFixed(3)} s · VALID LAP`,
        640,
        369,
        23,
        '#dbe4ed',
        'center',
      );
    }
    if (phase === 'finished') {
      finishHold += dt;
      if (finishHold >= 6) {
        phase = 'saving';
        recorder.stop();
      }
    }
    if (
      Math.floor(elapsed) % 5 === 0 &&
      sampleFrames.at(-1)?.second !== Math.floor(elapsed)
    )
      sampleFrames.push({
        second: Math.floor(elapsed),
        clients: entries.filter((e) => e.net.connected).length,
        lap: car.lap,
        progress: car.progress,
      });
    if (phase === 'racing')
      status.textContent = `RECORDING · 3 clients · ${elapsed.toFixed(1)}s · ${finished}/3 finished`;
  }
  return { update, frame };
}
