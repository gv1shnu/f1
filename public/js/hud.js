// HUD updates: speedo, gear, rev lights, timing, leaderboard, flash messages.
const $ = (id) => document.getElementById(id);
const setText = (el, value) => {
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
};

function fmt(ms) {
  if (ms == null) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

export class HUD {
  constructor() {
    this.el = {
      speed: $('speed'),
      gear: $('gear'),
      revLights: $('revLights'),
      lapCount: $('lapCount'),
      lapTime: $('lapTime'),
      bestTime: $('bestTime'),
      leaderboard: $('leaderboard'),
      online: $('onlineCount'),
      flash: $('flash'),
    };
    // Build rev lights (15 segments: green, red, blue like an F1 wheel).
    for (let i = 0; i < 15; i++) {
      const seg = document.createElement('i');
      seg.dataset.kind = i < 5 ? 'g' : i < 11 ? 'r' : 'b';
      this.el.revLights.appendChild(seg);
    }
    this._flashTimer = null;
  }

  update(car, maxSpeedKmh) {
    setText(this.el.speed, car.kmh);
    setText(this.el.gear, car.gear);
    setText(this.el.lapCount, car.lap);
    setText(
      this.el.lapTime,
      car.race.active
        ? car.race.valid
          ? fmt(car.lapTime)
          : 'INVALID LAP'
        : 'CROSS START LINE',
    );
    setText(this.el.bestTime, fmt(car.bestLap));

    // Rev lights track speed as a proxy for revs.
    const ratio = Math.min(1, car.kmh / maxSpeedKmh);
    const lit = Math.round(ratio * 15);
    const segs = this.el.revLights.children;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const value = i < lit ? `on-${s.dataset.kind}` : '';
      if (s.className !== value) s.className = value;
    }
  }

  updateLeaderboard(entries, myId) {
    // entries: [{ id, name, color, lap, kmh }]
    entries.sort(
      (a, b) => b.lap - a.lap || b.progress - a.progress || a.id - b.id,
    );
    setText(this.el.online, entries.length);
    const html = entries
      .map(
        (e, i) => `
      <div class="lb-row ${e.id === myId ? 'me' : ''}">
        <span class="lb-pos">${i + 1}</span>
        <span class="lb-dot" style="background:${e.color}"></span>
        <span class="lb-name">${escapeHtml(e.name)}</span>
        <span class="lb-lap">L${e.lap}</span>
      </div>`,
      )
      .join('');
    if (html !== this._board) {
      this.el.leaderboard.innerHTML = html;
      this._board = html;
    }
  }

  flash(text, ms = 1800) {
    this.el.flash.textContent = text;
    this.el.flash.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(
      () => this.el.flash.classList.remove('show'),
      ms,
    );
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}

export { fmt };
