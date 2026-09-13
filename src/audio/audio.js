// Every sound effect is synthesised at runtime with the Web Audio API -- no
// sample files. The only streamed audio is the ambient score.

const A4 = 440;
const NOTE = (semitonesFromA4) => A4 * Math.pow(2, semitonesFromA4 / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.convolver = null;
    this.musicEl = null;
    this.musicSource = null;
    this.settings = { master: 0.8, sfx: 0.85, music: 0.45, muted: false };
    this.noiseBuffer = null;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(this.master);

    // A long, bright reverb tail -- the sound of a very large empty sky.
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(3.2, 2.4);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.34;
    this.convolver.connect(wet);
    wet.connect(this.master);

    this.noiseBuffer = this.makeNoise(2.0);
    this.ready = true;
    this.applySettings(this.settings);
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.3);
      }
    }
    return buf;
  }

  makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music, t, 0.05);
  }

  // -- primitives ---------------------------------------------------------
  tone(freq, { type = 'sine', t0 = 0, dur = 0.4, gain = 0.2, attack = 0.01,
    detune = 0, glideTo = null, reverb = 0.5, pan = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + t0;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), start + dur);
    osc.detune.value = detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;

    osc.connect(g);
    if (p) { g.connect(p); p.connect(this.sfxBus); } else { g.connect(this.sfxBus); }
    if (reverb > 0 && this.convolver) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = reverb;
      g.connect(sendGain);
      sendGain.connect(this.convolver);
    }
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  noise({ t0 = 0, dur = 0.4, gain = 0.2, filter = 'bandpass', freq = 1200,
    q = 1, sweepTo = null, reverb = 0.4 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + t0;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const biq = ctx.createBiquadFilter();
    biq.type = filter;
    biq.frequency.setValueAtTime(freq, start);
    if (sweepTo) biq.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + dur);
    biq.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(biq);
    biq.connect(g);
    g.connect(this.sfxBus);
    if (reverb > 0 && this.convolver) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = reverb;
      g.connect(sendGain);
      sendGain.connect(this.convolver);
    }
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  chord(semis, opts = {}) {
    semis.forEach((s, i) => {
      this.tone(NOTE(s), { ...opts, t0: (opts.t0 || 0) + i * (opts.spread || 0) });
    });
  }

  // -- the voices of the game ---------------------------------------------
  play(name) {
    if (!this.ready) return;
    switch (name) {
      case 'place':
        this.tone(NOTE(7), { type: 'triangle', dur: 0.5, gain: 0.16, reverb: 0.6 });
        this.tone(NOTE(19), { type: 'sine', dur: 0.7, gain: 0.09, t0: 0.03, reverb: 0.7 });
        this.noise({ dur: 0.22, gain: 0.05, filter: 'highpass', freq: 2600, reverb: 0.3 });
        break;
      case 'hover':
        this.tone(NOTE(24), { type: 'sine', dur: 0.08, gain: 0.035, reverb: 0.15 });
        break;
      case 'click':
        this.tone(NOTE(16), { type: 'triangle', dur: 0.12, gain: 0.07, reverb: 0.2 });
        break;
      case 'select':
        this.tone(NOTE(12), { type: 'sine', dur: 0.22, gain: 0.09, glideTo: NOTE(19), reverb: 0.4 });
        break;
      case 'rotate':
        this.tone(NOTE(14), { type: 'square', dur: 0.09, gain: 0.035, reverb: 0.15 });
        break;
      case 'discard':
        this.noise({ dur: 0.5, gain: 0.1, filter: 'bandpass', freq: 1800, sweepTo: 300, q: 0.7, reverb: 0.5 });
        break;
      case 'draw':
        this.noise({ dur: 0.18, gain: 0.06, filter: 'highpass', freq: 1800, reverb: 0.2 });
        break;
      case 'turn':
        this.chord([12, 16, 19], { type: 'sine', dur: 0.9, gain: 0.08, spread: 0.06, reverb: 0.8 });
        break;
      case 'bless':
        this.chord([12, 16, 19, 24], { type: 'sine', dur: 1.1, gain: 0.09, spread: 0.07, reverb: 0.85 });
        this.noise({ dur: 0.8, gain: 0.03, filter: 'highpass', freq: 4000, reverb: 0.6 });
        break;
      case 'curse':
        this.tone(NOTE(-24), { type: 'sawtooth', dur: 0.9, gain: 0.12, glideTo: NOTE(-31), reverb: 0.5 });
        this.tone(NOTE(-17), { type: 'square', dur: 0.7, gain: 0.05, detune: 28, reverb: 0.4 });
        this.noise({ dur: 0.7, gain: 0.07, filter: 'lowpass', freq: 900, sweepTo: 160, reverb: 0.5 });
        break;
      case 'smite':
        this.noise({ dur: 0.1, gain: 0.32, filter: 'highpass', freq: 3000, reverb: 0.3 });
        this.noise({ t0: 0.02, dur: 1.5, gain: 0.22, filter: 'lowpass', freq: 1400, sweepTo: 90, reverb: 0.9 });
        this.tone(NOTE(-29), { type: 'sawtooth', dur: 1.2, gain: 0.1, glideTo: NOTE(-38), reverb: 0.7 });
        break;
      case 'reveal':
        this.chord([19, 23, 26, 31], { type: 'sine', dur: 1.4, gain: 0.055, spread: 0.09, reverb: 0.9 });
        break;
      case 'gateStone':
        this.tone(NOTE(-22), { type: 'sine', dur: 0.9, gain: 0.18, reverb: 0.7 });
        this.noise({ dur: 0.6, gain: 0.14, filter: 'lowpass', freq: 700, sweepTo: 120, reverb: 0.6 });
        break;
      case 'gateGold':
      case 'victory':
        [0, 4, 7, 12, 16, 19].forEach((s, i) => {
          this.tone(NOTE(s), { type: 'triangle', dur: 2.2, gain: 0.1, t0: i * 0.09, reverb: 0.95 });
        });
        this.noise({ t0: 0.1, dur: 1.6, gain: 0.04, filter: 'highpass', freq: 5000, reverb: 0.8 });
        break;
      case 'defeat':
        [0, -3, -8, -12].forEach((s, i) => {
          this.tone(NOTE(s), { type: 'sawtooth', dur: 1.6, gain: 0.09, t0: i * 0.16, reverb: 0.8 });
        });
        break;
      case 'error':
        this.tone(NOTE(-5), { type: 'square', dur: 0.16, gain: 0.07, glideTo: NOTE(-12), reverb: 0.2 });
        break;
      case 'join':
        this.tone(NOTE(12), { type: 'sine', dur: 0.35, gain: 0.09, glideTo: NOTE(19), reverb: 0.6 });
        break;
      case 'leave':
        this.tone(NOTE(19), { type: 'sine', dur: 0.35, gain: 0.08, glideTo: NOTE(7), reverb: 0.6 });
        break;
      case 'chat':
        this.tone(NOTE(21), { type: 'sine', dur: 0.14, gain: 0.05, reverb: 0.3 });
        break;
      case 'tick':
        this.tone(NOTE(28), { type: 'sine', dur: 0.06, gain: 0.05, reverb: 0.1 });
        break;
      default:
        break;
    }
  }

  // -- ambient score ------------------------------------------------------
  startMusic(url) {
    if (!this.ready) return;
    if (!this.musicEl) {
      const el = new Audio();
      el.src = url;
      el.loop = true;
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      this.musicEl = el;
      try {
        this.musicSource = this.ctx.createMediaElementSource(el);
        this.musicSource.connect(this.musicBus);
      } catch (err) {
        // Fall back to plain element volume if routing is unavailable.
        this.musicSource = null;
      }
    }
    if (!this.musicSource) this.musicEl.volume = this.settings.music * this.settings.master;
    const p = this.musicEl.play();
    if (p && p.catch) p.catch(() => {});
  }

  stopMusic() {
    if (this.musicEl) this.musicEl.pause();
  }
}

export const audio = new AudioEngine();
