// Phát bản MIDI: lập lịch trước vài trăm mili giây, phát qua trình duyệt hoặc qua cổng MIDI out của đàn.
import { makeClock, songEnd, kindFor } from './songmidi.js';

export class Player {
  // opts: { synth, hub, getOutput: () => 'browser'|'midi', getMix: () => ({mute:Set, solo:Set|null, vol:Map}), onEnd }
  constructor(opts) {
    this.o = opts;
    this.playing = false;
    this.timer = 0;
  }

  get active() { return this.playing; }

  start(song, fromTick = 0, { loop = false } = {}) {
    this.stop();
    this.song = song;
    this.clock = makeClock(song);
    this.endTick = songEnd(song);
    this.loop = loop;
    this.useMidi = this.o.getOutput() === 'midi' && this.o.hub.activeOutput;
    this.build();
    this.setFrom(fromTick);
    this.playing = true;
    this.timer = setInterval(() => this.pump(), 30);
    this.pump();
  }

  build() {
    const { song, clock } = this;
    const ev = [];
    song.parts.forEach((p, pi) => {
      for (const n of p.notes) {
        const on = clock.tickToMs(n.t);
        const off = clock.tickToMs(n.t + n.d);
        ev.push({ ms: on, off: false, pi, n: n.n, v: n.v, dur: off - on });
        if (this.useMidi) ev.push({ ms: off, off: true, pi, n: n.n, v: 0 });
      }
      if (this.useMidi) for (const c of p.ctl) ev.push({ ms: clock.tickToMs(c[0]), raw: true, pi, c });
    });
    ev.sort((a, b) => a.ms - b.ms || (b.off ? 1 : 0) - (a.off ? 1 : 0));
    this.ev = ev;
  }

  setFrom(tick) {
    this.baseMs = this.clock.tickToMs(tick);
    this.t0 = performance.now() + 80;
    this.ptr = 0;
    while (this.ptr < this.ev.length && this.ev[this.ptr].ms < this.baseMs - 1e-6) this.ptr++;
    this.sentProgram = false;
    this.lastEnd = this.clock.tickToMs(this.endTick);
  }

  tick() {
    if (!this.playing) return 0;
    return this.clock.msToTick(this.baseMs + Math.max(0, performance.now() - this.t0));
  }

  pump() {
    if (!this.playing) return;
    const now = performance.now();
    const horizon = now + 160 - this.t0 + this.baseMs;
    const mix = this.o.getMix();
    const { synth, hub } = this.o;
    if (this.useMidi && !this.sentProgram) {
      this.sentProgram = true;
      this.song.parts.forEach((p) => {
        const ch = p.channel & 15;
        if (p.channel !== 9) hub.send([0xc0 | ch, p.program & 127], this.t0);
        if (p.vol != null) hub.send([0xb0 | ch, 7, p.vol], this.t0);
        if (p.pan != null) hub.send([0xb0 | ch, 10, p.pan], this.t0);
      });
    }
    while (this.ptr < this.ev.length && this.ev[this.ptr].ms <= horizon) {
      const e = this.ev[this.ptr++];
      const p = this.song.parts[e.pi];
      const ts = this.t0 + (e.ms - this.baseMs);
      const audible = !mix.mute.has(p.id) && (!mix.solo || mix.solo.has(p.id));
      if (this.useMidi) {
        const ch = p.channel & 15;
        if (e.raw) {
          const [, type, d1, d2] = e.c;
          if (type !== 0xc0) hub.send(type === 0xd0 ? [type | ch, d1] : [type | ch, d1, d2], ts);
        } else if (e.off) hub.send([0x80 | ch, e.n, 0], ts);
        else if (audible) hub.send([0x90 | ch, e.n, e.v], ts);
      } else if (!e.off && !e.raw && audible) {
        const gain = mix.vol.get(p.id) ?? 1;
        if (p.channel === 9) synth.drum(e.n, e.v, ts, gain);
        else synth.playNote(kindFor(p.program, p.channel), e.n, e.v, ts, e.dur, gain);
      }
    }
    if (this.ptr >= this.ev.length && horizon >= this.lastEnd + 400) {
      if (this.loop) { this.start(this.song, 0, { loop: true }); return; }
      const cb = this.o.onEnd;
      this.stop();
      cb && cb();
    }
  }

  stop() {
    const was = this.playing;
    clearInterval(this.timer);
    this.playing = false;
    if (was) {
      this.o.synth.killSong();
      if (this.useMidi) {
        for (const p of this.song.parts) this.o.hub.send([0xb0 | (p.channel & 15), 123, 0]);
      }
    }
  }
}
