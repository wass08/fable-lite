import { Howl, Howler } from 'howler';
import { asset } from './assets.js';

// round-robin over recorded variations, with light pitch/volume jitter so
// repeated plays never sound identical
class Bank {
  constructor(urls, { volume = 1, rateJitter = 0.08, volJitter = 0.18, loop = false } = {}) {
    this.howls = urls.map((src) => new Howl({ src: [asset(src)], volume, loop, preload: true }));
    this.volume = volume;
    this.rateJitter = rateJitter;
    this.volJitter = volJitter;
    this.index = Math.floor(Math.random() * urls.length);
  }

  play({ rate = 1, volume = 1 } = {}) {
    const howl = this.howls[this.index];
    this.index = (this.index + 1) % this.howls.length;
    const id = howl.play();
    howl.rate(rate * (1 + (Math.random() * 2 - 1) * this.rateJitter), id);
    howl.volume(this.volume * volume * (1 - Math.random() * this.volJitter), id);
    return { howl, id };
  }

  stop(handle) {
    handle?.howl.stop(handle.id);
  }
}

export class SFX {
  constructor() {
    this.ctx = null;
    Howler.volume(0.9);

    this.banks = {
      kickHit: new Bank(['/sfx/kick-hit-1.mp3', '/sfx/kick-hit-2.mp3'], { volume: 0.9 }),
      chickenHit: new Bank(['/sfx/chicken-hit-1.mp3', '/sfx/chicken-hit-2.mp3'], { volume: 0.8, rateJitter: 0.12 }),
      chickenAmbience: new Bank(['/sfx/chicken-ambience-1.mp3', '/sfx/chicken-ambience-2.mp3'], { volume: 0.25, rateJitter: 0.1 }),
      fireFlying: new Bank(['/sfx/spell-fire-flying-1.mp3'], { volume: 0.5, loop: true }),
      fireExplosion: new Bank(['/sfx/spell-fire-explosion-1.mp3'], { volume: 0.85, rateJitter: 0.1 }),
      lightningExplosion: new Bank(['/sfx/spell-lightning-explosion-1.mp3', '/sfx/spell-lightning-explosion-2.mp3'], { volume: 0.9 }),
      rockExplosion: new Bank(['/sfx/spell-rock-explosion-1.mp3'], { volume: 0.9, rateJitter: 0.12 }),
      kamikaze: new Bank(['/sfx/chicken-enter-kamikaze-mode.mp3'], { volume: 0.9, rateJitter: 0.06 }),
      tauntKill: new Bank([1, 2, 3, 4, 5, 6, 7].map((i) => `/sfx/mage-taunt-kill-${i}.mp3`), { volume: 0.9, rateJitter: 0.03, volJitter: 0.05 }),
      mageDie: new Bank(['/sfx/mage-die-1.mp3'], { volume: 1, rateJitter: 0 }),
    };

    this.music = new Howl({ src: [asset('/music/main-theme.mp3')], loop: true, volume: 0 });
    this.musicTarget = 0.35;
    this.lastTaunt = 0;
  }

  // --- music: situation-driven ---

  startMusic() {
    if (!this.music.playing()) this.music.play();
    this.music.fade(this.music.volume(), this.musicTarget, 1200);
  }

  duckMusic() {
    if (this.music.playing()) this.music.fade(this.music.volume(), 0.06, 600);
  }

  resumeMusic() {
    if (this.music.playing()) this.music.fade(this.music.volume(), this.musicTarget, 1500);
  }

  // combat = angry chickens nearby: push the theme a little harder
  setCombat(combat) {
    if (this._combat === combat) return;
    this._combat = combat;
    this.musicTarget = combat ? 0.5 : 0.35;
    if (this.music.playing()) {
      this.music.fade(this.music.volume(), this.musicTarget, 900);
      this.music.rate(combat ? 1.06 : 1.0);
    }
  }

  // --- recorded banks ---

  kickHit() { this.banks.kickHit.play(); }
  chickenHit() { this.banks.chickenHit.play(); }
  explosion() { this.banks.fireExplosion.play(); }
  lightning() { this.banks.lightningExplosion.play(); }
  earth() { this.banks.rockExplosion.play(); }
  mageDie() { this.banks.mageDie.play(); }
  ambience() { this.banks.chickenAmbience.play(); }
  kamikaze() { this.banks.kamikaze.play(); }

  tauntKill() {
    // the wizard savors a kill, but doesn't babble
    const now = performance.now();
    if (now - this.lastTaunt < 2500) return;
    this.lastTaunt = now;
    this.banks.tauntKill.play();
  }

  // looping projectile whoosh — returns a handle, stop it on impact
  fireballLoop() { return this.banks.fireFlying.play(); }
  stopLoop(handle) { this.banks.fireFlying.stop(handle); }

  fireball() { /* cast sound covered by the flying loop */ }

  // --- tiny synth leftovers (no recorded equivalents) ---

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  noise({ duration = 0.5, gain = 0.4, filterType = 'lowpass', from = 800, to = 200, q = 1 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  tone({ type = 'sine', from = 440, to = 220, duration = 0.2, gain = 0.25, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  kick() {
    // the swing itself; connect plays kickHit on top
    this.noise({ duration: 0.18, gain: 0.2, filterType: 'bandpass', from: 300, to: 1200, q: 1.5 });
  }

  squawk() {
    this.tone({ type: 'square', from: 900, to: 500, duration: 0.09, gain: 0.1 });
    this.tone({ type: 'square', from: 1300, to: 600, duration: 0.16, gain: 0.12, delay: 0.1 });
  }

  bounce() {
    this.tone({ type: 'triangle', from: 300, to: 120, duration: 0.08, gain: 0.15 });
  }

  peck() {
    this.tone({ type: 'square', from: 750, to: 250, duration: 0.05, gain: 0.2 });
    this.noise({ duration: 0.05, gain: 0.25, filterType: 'highpass', from: 2500, to: 4000 });
  }

  roll() {
    this.noise({ duration: 0.3, gain: 0.18, filterType: 'bandpass', from: 250, to: 900, q: 1.2 });
  }

  // potion pickups: little rising arpeggios, no recordings needed
  pickupMana() {
    this.tone({ type: 'sine', from: 520, to: 880, duration: 0.12, gain: 0.18 });
    this.tone({ type: 'sine', from: 780, to: 1320, duration: 0.16, gain: 0.16, delay: 0.07 });
  }

  pickupHealth() {
    this.tone({ type: 'triangle', from: 420, to: 640, duration: 0.14, gain: 0.2 });
    this.tone({ type: 'triangle', from: 640, to: 960, duration: 0.2, gain: 0.18, delay: 0.09 });
  }
}
