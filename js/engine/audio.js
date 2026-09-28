// WebAudio 합성 사운드 (에셋 없이 모든 효과음/배경음 생성)
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicEnabled = true;
    this.last = {};
    this.gateStreak = 0;
    this.gateStreakT = 0;
    this.musicMode = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.enabled ? 1 : 0;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicEnabled ? 0.33 : 0;
    this.music.connect(this.master);
    // 공용 잡음 버퍼
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // 짧은 리버브 (임펄스 응답 합성)
    const irLen = ctx.sampleRate * 1.2;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain).connect(this.master);
    if (ctx.state === 'suspended') ctx.resume();
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.sfx) this.sfx.gain.value = v ? 1 : 0;
  }
  setMusic(v) {
    this.musicEnabled = v;
    if (this.music) this.music.gain.setTargetAtTime(v ? 0.33 : 0, this.ctx.currentTime, 0.1);
  }

  _ok(name, minGap) {
    if (!this.ctx || !this.enabled) return false;
    const t = this.ctx.currentTime;
    if (this.last[name] && t - this.last[name] < minGap) return false;
    this.last[name] = t;
    return true;
  }

  // 기본 빌딩 블록
  _env(g, t, a, peak, dcy, end = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(end, t + a + dcy);
  }
  _osc(type, f0, f1, t, dur, vol, { a = 0.004, dest = this.sfx, rev = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, a, vol, dur);
    o.connect(g).connect(dest);
    if (rev) {
      const rg = ctx.createGain();
      rg.gain.value = rev;
      g.connect(rg).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }
  _noise(t, dur, vol, { type = 'bandpass', f = 1000, f1 = null, q = 1, a = 0.002, dest = this.sfx, rev = 0, rate = 1 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, a, vol, dur);
    s.connect(flt).connect(g).connect(dest);
    if (rev) {
      const rg = ctx.createGain();
      rg.gain.value = rev;
      g.connect(rg).connect(this.reverb);
    }
    s.start(t, Math.random() * 0.5);
    s.stop(t + a + dur + 0.05);
  }

  // ---------- 효과음 ----------
  shoot(tier = 1) {
    if (!this._ok('shoot', 0.07)) return;
    const t = this.ctx.currentTime;
    const p = 0.9 + Math.random() * 0.2;
    this._noise(t, 0.09, 0.16, { type: 'bandpass', f: 2600 * p, f1: 900, q: 1.5 });
    this._osc('triangle', 520 * p, 180, t, 0.07, 0.07);
    if (tier >= 3) this._noise(t, 0.12, 0.08, { type: 'lowpass', f: 1400, f1: 300 });
  }
  hit() {
    if (!this._ok('hit', 0.045)) return;
    const t = this.ctx.currentTime;
    const p = 0.85 + Math.random() * 0.3;
    this._osc('sine', 190 * p, 60, t, 0.09, 0.22);
    this._noise(t, 0.05, 0.16, { type: 'highpass', f: 2200 * p, q: 0.7 });
  }
  thud() {
    if (!this._ok('thud', 0.06)) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 120, 45, t, 0.14, 0.32);
    this._noise(t, 0.06, 0.18, { type: 'lowpass', f: 1600, f1: 400 });
  }
  pop() {
    if (!this._ok('pop', 0.035)) return;
    const t = this.ctx.currentTime;
    const p = 0.8 + Math.random() * 0.5;
    this._osc('square', 880 * p, 240 * p, t, 0.05, 0.06);
    this._noise(t, 0.04, 0.08, { type: 'bandpass', f: 3000 * p, q: 2 });
  }
  lose() {
    if (!this._ok('lose', 0.05)) return;
    const t = this.ctx.currentTime;
    this._osc('sawtooth', 300, 90, t, 0.1, 0.06);
    this._noise(t, 0.06, 0.08, { type: 'bandpass', f: 900, q: 1 });
  }
  gate(good = true) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (!good) {
      this._osc('sawtooth', 220, 110, t, 0.35, 0.12, { rev: 0.3 });
      this._osc('square', 165, 82, t, 0.35, 0.06);
      return;
    }
    if (t - this.gateStreakT > 1.2) this.gateStreak = 0;
    this.gateStreakT = t;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const n = scale[Math.min(this.gateStreak++, scale.length - 1)];
    const f = 523.25 * Math.pow(2, n / 12);
    this._osc('triangle', f, f, t, 0.25, 0.16, { rev: 0.5 });
    this._osc('sine', f * 2, f * 2, t + 0.03, 0.2, 0.07, { rev: 0.5 });
    this._noise(t, 0.12, 0.05, { type: 'highpass', f: 6000 });
  }
  woodBreak() {
    if (!this._ok('wood', 0.08)) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this._noise(t + i * 0.025, 0.08, 0.35, { type: 'bandpass', f: 900 + Math.random() * 1200, q: 3 });
    this._osc('sine', 140, 40, t, 0.25, 0.5);
    this._noise(t, 0.4, 0.2, { type: 'lowpass', f: 2000, f1: 200, rev: 0.4 });
  }
  stoneBreak() {
    if (!this._ok('stone', 0.1)) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 90, 25, t, 0.7, 0.7);
    this._noise(t, 1.1, 0.45, { type: 'lowpass', f: 1400, f1: 120, rev: 0.6 });
    for (let i = 0; i < 7; i++) this._noise(t + 0.05 + Math.random() * 0.4, 0.06, 0.25, { type: 'bandpass', f: 600 + Math.random() * 1600, q: 4 });
  }
  crack() {
    if (!this._ok('crack', 0.09)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.07, 0.22, { type: 'bandpass', f: 1400 + Math.random() * 800, q: 4 });
    this._osc('sine', 150, 70, t, 0.08, 0.15);
  }
  reward() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((n, i) => {
      const f = 659.25 * Math.pow(2, n / 12);
      this._osc('triangle', f, f, t + i * 0.06, 0.3, 0.13, { rev: 0.6 });
    });
  }
  coin() {
    if (!this._ok('coin', 0.05)) return;
    const t = this.ctx.currentTime;
    this._osc('square', 1318, 1318, t, 0.06, 0.05);
    this._osc('square', 1760, 1760, t + 0.06, 0.12, 0.05, { rev: 0.3 });
  }
  roar() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(140, t + 0.3);
    o.frequency.linearRampToValueAtTime(60, t + 1.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 25;
    lfo.connect(lg).connect(o.frequency);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 900;
    const g = ctx.createGain();
    this._env(g, t, 0.08, 0.35, 1.4);
    o.connect(flt).connect(g).connect(this.sfx);
    const rg = ctx.createGain();
    rg.gain.value = 0.5;
    g.connect(rg).connect(this.reverb);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.6);
    lfo.stop(t + 1.6);
    this._noise(t, 1.2, 0.18, { type: 'bandpass', f: 500, q: 1, rev: 0.4 });
  }
  warn() {
    if (!this._ok('warn', 0.3)) return;
    const t = this.ctx.currentTime;
    this._osc('square', 880, 880, t, 0.1, 0.06);
    this._osc('square', 660, 660, t + 0.13, 0.1, 0.06);
  }
  slam() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 110, 22, t, 0.9, 0.9);
    this._noise(t, 0.8, 0.5, { type: 'lowpass', f: 1800, f1: 90, rev: 0.7 });
    this._noise(t, 0.12, 0.35, { type: 'highpass', f: 1500 });
  }
  boom() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 80, 20, t, 1.4, 0.9);
    this._noise(t, 1.6, 0.55, { type: 'lowpass', f: 2500, f1: 60, rev: 0.8 });
  }
  whoosh() {
    if (!this._ok('whoosh', 0.2)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.35, 0.2, { type: 'bandpass', f: 400, f1: 2400, q: 1.2, a: 0.12 });
  }
  upgrade() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [0, 7, 12, 19, 24].forEach((n, i) => {
      const f = 392 * Math.pow(2, n / 12);
      this._osc('sawtooth', f, f, t + i * 0.07, 0.25, 0.06, { rev: 0.5 });
      this._osc('triangle', f, f, t + i * 0.07, 0.3, 0.1);
    });
  }
  click() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._osc('triangle', 700, 900, t, 0.05, 0.12);
  }
  victory() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const notes = [[0, 0], [4, 0.14], [7, 0.28], [12, 0.42], [7, 0.62], [12, 0.76]];
    notes.forEach(([n, dt]) => {
      const f = 523.25 * Math.pow(2, n / 12);
      this._osc('square', f, f, t + dt, 0.28, 0.07, { rev: 0.5 });
      this._osc('triangle', f / 2, f / 2, t + dt, 0.3, 0.12);
    });
    const f = 523.25 * 2;
    this._osc('triangle', f, f, t + 0.95, 1.2, 0.14, { rev: 0.8 });
  }
  defeat() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [0, -3, -6, -12].forEach((n, i) => {
      const f = 392 * Math.pow(2, n / 12);
      this._osc('triangle', f, f, t + i * 0.22, 0.4, 0.13, { rev: 0.6 });
    });
  }

  // ---------- 배경음 (간단한 시퀀서) ----------
  startMusic(mode = 'run') {
    if (!this.ctx) return;
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    if (!this.musicTimer) this.musicTimer = setInterval(() => this._schedule(), 50);
  }
  stopMusic() {
    this.musicMode = null;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
  _schedule() {
    if (!this.ctx || !this.musicMode) return;
    const boss = this.musicMode === 'boss';
    const menu = this.musicMode === 'menu';
    const bpm = boss ? 150 : menu ? 100 : 128;
    const s16 = 60 / bpm / 4;
    const prog = boss ? [57, 53, 55, 52] : [48, 43, 45, 41]; // 루트 (MIDI)
    const minor = boss ? [0, 3, 7, 12] : null;
    while (this.nextT < this.ctx.currentTime + 0.2) {
      const st = this.step;
      const t = this.nextT;
      const bar = Math.floor(st / 16) % 4;
      const root = prog[bar];
      const beat = st % 16;
      const d = this.music;
      const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
      if (!menu) {
        if (beat % 4 === 0) this._osc('sine', 150, 40, t, 0.18, 0.5, { dest: d });
        if (beat === 4 || beat === 12) this._noise(t, 0.12, 0.25, { type: 'bandpass', f: 1800, q: 0.8, dest: d });
        if (beat % 2 === 1) this._noise(t, 0.03, 0.06, { type: 'highpass', f: 7000, dest: d });
        if (boss && beat % 4 === 2) this._osc('sine', 120, 50, t, 0.1, 0.25, { dest: d });
      } else if (beat % 8 === 0) {
        this._osc('sine', 110, 40, t, 0.25, 0.25, { dest: d });
      }
      // 베이스
      if (beat % 2 === 0) {
        const bn = root - 12 + (beat % 8 === 6 ? 7 : 0);
        this._osc('triangle', mf(bn), mf(bn), t, s16 * 1.6, 0.22, { dest: d });
      }
      // 아르페지오
      const chord = minor || (bar === 2 ? [0, 3, 7, 12] : [0, 4, 7, 12]);
      if (beat % 2 === 0 || boss) {
        const n = root + 12 + chord[(st >> (boss ? 0 : 1)) % 4];
        this._osc('square', mf(n), mf(n), t, s16 * 0.9, menu ? 0.03 : 0.035, { dest: d, rev: 0.3 });
      }
      this.nextT += s16;
      this.step++;
    }
  }
}

export const audio = new Audio();
