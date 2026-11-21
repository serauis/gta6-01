// hud.js — the DOM half of the interface, matched to index.html: money and the mission
// panel, wanted stars and the clock, health and vehicle bars, the weapon readout, the
// context prompt, subtitles, small toasts for everyday events and the big gold banner
// for story beats — plus the full-screen overlays. Values are cached so the DOM is only
// touched when something actually changes.

const $ = (id) => document.getElementById(id);

const SCREEN_IDS = { title: 'titleScreen', pause: 'pauseScreen', over: 'overScreen', end: 'endScreen' };

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      money: $('money'), stars: $('stars'), clock: $('clock'),
      missionName: $('missionName'), missionText: $('missionText'),
      healthBar: $('healthBar'), carLabel: $('carLabel'), carBarWrap: $('carBarWrap'), carBar: $('carBar'),
      weapon: $('weapon'), speedo: $('speedo'),
      prompt: $('prompt'), subtitle: $('subtitle'),
      toast: $('toast'), banner: $('banner'), bannerTitle: $('bannerTitle'), bannerText: $('bannerText'),
    };
    this.cache = new Map();
    this.toastTimer = null;
    this.bannerTimer = null;
  }

  set(key, value, apply) {
    if (this.cache.get(key) !== value) {
      this.cache.set(key, value);
      apply(value);
    }
  }

  // Small pill at the top: fares, packages, pickups, warnings.
  notify(title, sub = '') {
    this.el.toast.textContent = sub ? `${title} — ${sub}` : title;
    this.el.toast.style.display = 'block';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.el.toast.style.display = 'none'; }, 3400);
  }

  // The big gold announcement: job started, job done, job failed, story beats.
  banner(title, sub = '') {
    this.el.bannerTitle.textContent = title;
    this.el.bannerText.textContent = sub;
    this.el.banner.style.display = 'block';
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.el.banner.style.display = 'none'; }, 3800);
  }

  showScreen(name) {
    for (const [key, id] of Object.entries(SCREEN_IDS)) {
      $(id).classList.toggle('on', key === name);
    }
    this.el.hud.classList.toggle('on', name !== 'title');
  }

  update(game) {
    const player = game.player;
    this.set('money', game.money, (v) => { this.el.money.textContent = `$${v.toLocaleString('en-US')}`; });
    this.set('stars', game.stars, (v) => {
      let html = '';
      for (let i = 0; i < 5; i++) html += i < v ? '★' : '<span class="off">★</span>';
      this.el.stars.innerHTML = html;
    });
    const dayMinutes = Math.floor(game.dayT * 24 * 60);
    const hh = String(Math.floor(dayMinutes / 60)).padStart(2, '0');
    const mm = String(dayMinutes % 60).padStart(2, '0');
    this.set('clock', `${hh}:${mm}`, (v) => { this.el.clock.textContent = v; });

    const missions = game.missions;
    this.set('mtitle', missions.title, (v) => { this.el.missionName.textContent = v; });
    const objective = missions.currentObjective(game);
    let text = missions.text;
    if (objective) {
      const d = Math.round(Math.hypot(objective.x - player.x, objective.y - player.y) / 10);
      text = `${text} · ${d} m`;
    }
    if (missions.timer !== null && missions.stage === 'active') {
      text = `${text} · ⏱ ${Math.max(0, Math.ceil(missions.timer))}s`;
    }
    this.set('mtext', text, (v) => { this.el.missionText.textContent = v; });

    this.set('hp', Math.round(player.hp), (v) => { this.el.healthBar.style.width = `${Math.max(0, v)}%`; });
    if (player.car) {
      const car = player.car;
      const name = car.livery === 'police' ? 'Cruiser' : car.type === 'sport' ? 'Comet' : car.type === 'truck' ? 'Hauler' : car.livery === 'taxi' ? 'Taxi' : 'Sedan';
      this.set('veh', `${car.type}:${Math.round(car.health)}`, () => {
        this.el.carLabel.style.display = 'block';
        this.el.carLabel.textContent = name;
        this.el.carBarWrap.style.display = 'block';
        this.el.carBar.style.width = `${Math.max(0, Math.round((car.health / car.spec.health) * 100))}%`;
      });
      const kmh = Math.round(Math.hypot(car.vx, car.vy) * 0.36);
      this.set('speed', kmh, (v) => { this.el.speedo.textContent = `${v} km/h`; });
    } else {
      this.set('veh', 'foot', () => {
        this.el.carLabel.style.display = 'none';
        this.el.carBarWrap.style.display = 'none';
      });
      this.set('speed', -1, () => { this.el.speedo.textContent = ''; });
    }

    this.set('weapon', game.weapon.have ? game.weapon.ammo : -1, (v) => {
      this.el.weapon.innerHTML = v < 0 ? '' : `PISTOL <small>${v} rounds</small>`;
    });

    // The prompt line: an active bust overrides the context hint.
    let prompt = game.promptText || '';
    if (game.bustMeter > 0.03) prompt = '⚠ THE POLICE HAVE YOU — BREAK AWAY!';
    this.set('prompt', prompt, (v) => {
      this.el.prompt.style.display = v === '' ? 'none' : 'block';
      this.el.prompt.textContent = v;
    });

    // Subtitles carry the channel action (the bank grab) and urgent warnings.
    let subtitle = '';
    if (game.channel) subtitle = game.channel.label;
    else if (game.bustMeter > 0.4) subtitle = '<b>BUSTED</b> if you stay put — run or drive!';
    this.set('subtitle', subtitle, (v) => {
      this.el.subtitle.style.display = v === '' ? 'none' : 'block';
      this.el.subtitle.innerHTML = v;
    });
  }
}
