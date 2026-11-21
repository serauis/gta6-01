// audio.js — every sound in Palmira Heat is synthesized with WebAudio: no audio files, no
// network. A small bank of one-shot effects (shots, crashes, pickups, stings), two loops
// (engine and siren, driven by the game each frame) and a light bass-and-hats music groove
// for the title screen and free roam. Everything is guarded: until the player first clicks
// (the browser's autoplay rule) the bank stays silent.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.musicOn = false;
  }

  // Create the context on the first user gesture; safe to call again.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.ctx = new AudioCtor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  ready() {
    return !!this.ctx && !this.muted;
  }

  // A short tone with an envelope — the brick most effects are built from.
  blip(freqA, freqB, seconds, type = 'sine', volume = 0.2, when = 0) {
    if (!this.ready()) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t0 + seconds);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  // Filtered noise burst — gunshots, crashes, explosions, skids.
  noise(seconds, volume = 0.3, freqFrom = 3000, freqTo = 300, when = 0) {
    if (!this.ready()) return;
    const t0 = this.ctx.currentTime + when;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freqFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + seconds);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  shot() {
    this.noise(0.13, 0.5, 4200, 500);
    this.blip(210, 60, 0.09, 'square', 0.18);
  }

  dryFire() {
    this.blip(1200, 700, 0.04, 'square', 0.08);
  }

  hitFlesh() {
    this.noise(0.08, 0.25, 900, 200);
  }

  crash(strength = 0.5) {
    this.noise(0.22, 0.2 + strength * 0.4, 1600, 120);
    this.blip(90, 40, 0.18, 'triangle', 0.25);
  }

  explosion() {
    this.noise(0.7, 0.8, 2400, 60);
    this.blip(120, 24, 0.6, 'sine', 0.6);
  }

  door() {
    this.blip(140, 70, 0.09, 'triangle', 0.25);
    this.noise(0.05, 0.12, 800, 300, 0.02);
  }

  pickup() {
    this.blip(660, 660, 0.07, 'sine', 0.2);
    this.blip(990, 990, 0.1, 'sine', 0.2, 0.07);
  }

  cash() {
    this.blip(880, 880, 0.06, 'square', 0.1);
    this.blip(1174, 1174, 0.06, 'square', 0.1, 0.06);
    this.blip(1568, 1568, 0.12, 'square', 0.1, 0.12);
  }

  sting(good) {
    if (good) {
      this.blip(523, 523, 0.12, 'triangle', 0.22);
      this.blip(659, 659, 0.12, 'triangle', 0.22, 0.1);
      this.blip(784, 784, 0.22, 'triangle', 0.24, 0.2);
    } else {
      this.blip(220, 196, 0.2, 'triangle', 0.22);
      this.blip(165, 147, 0.32, 'triangle', 0.22, 0.16);
    }
  }

  uiClick() {
    this.blip(740, 620, 0.05, 'sine', 0.12);
  }

  // Continuous engine loop; rpm is 0..1. Call every frame while driving, stopEngine on exit.
  setEngine(rpm, driving) {
    if (!this.ctx) return;
    if (!driving) {
      if (this.engineNodes) {
        this.engineNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }
    if (!this.engineNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = this.ctx.createOscillator();
      sub.type = 'square';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      sub.start();
      this.engineNodes = { osc, sub, gain };
    }
    const t = this.ctx.currentTime;
    const freq = 55 + rpm * 165;
    this.engineNodes.osc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineNodes.sub.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.engineNodes.gain.gain.setTargetAtTime(this.muted ? 0 : 0.055 + rpm * 0.05, t, 0.09);
  }

  // Police siren loop; level is 0..1 by the nearest officer's distance.
  setSiren(level) {
    if (!this.ctx) return;
    if (level <= 0.01) {
      if (this.sirenNodes) this.sirenNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    if (!this.sirenNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 0.7;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.frequency.value = 820;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, gain };
    }
    this.sirenNodes.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.06, this.ctx.currentTime, 0.15);
  }

  // The music groove: a two-bar bass pattern with soft hats, scheduled from the game loop.
  setMusic(on) {
    this.musicOn = on;
    this.musicTimer = 0;
  }

  musicTick(dt) {
    if (!this.musicOn || !this.ready()) return;
    const STEP = 60 / 112 / 2; // 112 BPM eighth notes
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = STEP;
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 73.4, 0];
    const note = bass[this.musicStep % bass.length];
    if (note) this.blip(note, note, 0.16, 'triangle', 0.16);
    if (this.musicStep % 2 === 0) this.noise(0.03, 0.035, 7000, 5000);
    if (this.musicStep % 16 === 0) {
      this.blip(220, 220, 0.5, 'sine', 0.045);
      this.blip(277, 277, 0.5, 'sine', 0.04, 0.02);
    }
    this.musicStep += 1;
  }
}
