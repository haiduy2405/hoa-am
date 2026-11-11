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
}
