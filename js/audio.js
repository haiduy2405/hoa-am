// Synth nhẹ bằng WebAudio để nghe thử hợp âm khi không phát qua đàn.

export class Synth {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.volume = 0.7;
    this.wave = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const imag = new Float32Array([0, 1, 0.42, 0.2, 0.1, 0.05, 0.03]);
      this.wave = this.ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v * 0.5;
  }

  at(ts) {
    return this.ctx.currentTime + Math.max(0, ((ts ?? performance.now()) - performance.now()) / 1000);
  }

  noteOn(note, vel = 90, ts) {
    if (!this.ensure()) return;
    this.noteOff(note, ts, true);
    const t = this.at(ts);
    const f = 440 * Math.pow(2, (note - 69) / 12);
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(9000, 1400 + f * 3);
    const g = this.ctx.createGain();
    const peak = 0.12 + (vel / 127) * 0.28;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(peak * 0.32, t + 0.7);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    this.voices.set(note, { o, g });
  }

  noteOff(note, ts, immediate = false) {
    const v = this.voices.get(note);
    if (!v || !this.ctx) return;
    const t = this.at(ts);
    const rel = immediate ? 0.03 : 0.28;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0.0001, t, rel / 3);
    v.o.stop(t + rel * 2.2);
    this.voices.delete(note);
  }

  panic() {
    for (const n of [...this.voices.keys()]) this.noteOff(n, undefined, true);
  }

  click(accent, ts) {
    if (!this.ensure()) return;
    const t = this.at(ts);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = accent ? 1560 : 1040;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.26, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.07);
  }

  // ---- Phát bản MIDI nhiều nhạc cụ (lập lịch trước, có độ dài nốt) ----
  bus() {
    if (!this._bus) {
      this._bus = this.ctx.createGain();
      this._bus.connect(this.master);
    }
    return this._bus;
  }

  // Tắt ngay mọi nốt đã lập lịch của bản MIDI (kể cả nốt chưa tới giờ phát).
  killSong() {
    const b = this._bus;
    if (!b) return;
    this._bus = null;
    b.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
    setTimeout(() => b.disconnect(), 250);
  }

  noiseBuf() {
    if (!this._noise) {
      const n = this.ctx.sampleRate;
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noise = b;
    }
    return this._noise;
  }

  // kind: pluck | sustain | bass | lead. ts: mốc performance.now(). durMs: độ dài nốt.
  playNote(kind, note, vel, ts, durMs, gain = 1) {
    if (!this.ensure()) return;
    const t = this.at(ts);
    const dur = Math.max(0.04, durMs / 1000);
    const f = 440 * Math.pow(2, (note - 69) / 12);
    const o = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    lp.type = 'lowpass';
    const v = (0.05 + (vel / 127) * 0.2) * gain;
    let atk = 0.006, rel = 0.12, decayTo = 0.3, decayT = 0.6;
    if (kind === 'bass') { o.type = 'triangle'; lp.frequency.value = 700 + f * 2; atk = 0.01; rel = 0.08; decayTo = 0.6; decayT = 0.5; }
    else if (kind === 'lead') { o.type = 'sawtooth'; lp.frequency.value = Math.min(6000, 1600 + f * 2); atk = 0.015; rel = 0.1; decayTo = 0.7; decayT = 1; }
    else if (kind === 'sustain') { o.type = 'sawtooth'; lp.frequency.value = Math.min(3200, 700 + f); atk = 0.07; rel = 0.25; decayTo = 0.85; decayT = 1.2; }
    else { o.setPeriodicWave(this.wave); lp.frequency.value = Math.min(9000, 1400 + f * 3); decayTo = 0.18; decayT = 0.9; }
    o.frequency.value = f;
    const hold = Math.max(atk + 0.01, dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + atk);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * decayTo), t + Math.min(hold, atk + decayT));
    g.gain.setValueAtTime(Math.max(0.0002, v * decayTo), t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + rel);
    o.connect(lp).connect(g).connect(this.bus());
    o.start(t);
    o.stop(t + hold + rel + 0.05);
  }

  drum(note, vel, ts, gain = 1) {
    if (!this.ensure()) return;
    const t = this.at(ts);
    const v = (0.12 + (vel / 127) * 0.4) * gain;
    const kick = note === 35 || note === 36;
    const hat = [42, 44, 46, 51, 53, 59, 49, 57, 52, 55].includes(note);
    const g = this.ctx.createGain();
    g.connect(this.bus());
    if (kick || [41, 43, 45, 47, 48, 50].includes(note)) {
      const o = this.ctx.createOscillator();
      const base = kick ? 120 : 90 + (note - 41) * 14;
      o.frequency.setValueAtTime(base * 1.8, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.4, t + 0.14);
      g.gain.setValueAtTime(v * 1.6, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kick ? 0.28 : 0.35));
      o.connect(g);
      o.start(t);
      o.stop(t + 0.4);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf();
    const f = this.ctx.createBiquadFilter();
    f.type = hat ? 'highpass' : 'bandpass';
    f.frequency.value = hat ? 7000 : 1900;
    const open = [46, 49, 51, 52, 55, 57, 59].includes(note);
    const len = hat ? (open ? 0.32 : 0.05) : 0.17;
    g.gain.setValueAtTime(v * (hat ? 0.6 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }
}
