// Phát bản MIDI qua cổng MIDI out của đàn: lập lịch trước vài trăm mili giây để nhịp luôn đều.
import { makeClock, songEnd } from './songmidi.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  // opts: { hub, getMix: () => ({mute:Set, solo:Set|null, vol:Map}), onEnd }
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
        ev.push({ ms: clock.tickToMs(n.t), off: false, pi, n: n.n, v: n.v });
        ev.push({ ms: clock.tickToMs(n.t + n.d), off: true, pi, n: n.n, v: 0 });
      }
      for (const c of p.ctl) ev.push({ ms: clock.tickToMs(c[0]), raw: true, pi, c });
    });
    ev.sort((a, b) => a.ms - b.ms || (b.off ? 1 : 0) - (a.off ? 1 : 0));
    this.ev = ev;
  }

  setFrom(tick) {
    this.baseMs = this.clock.tickToMs(tick);
    this.t0 = performance.now() + 80;
    this.ptr = 0;
    while (this.ptr < this.ev.length && this.ev[this.ptr].ms < this.baseMs - 1e-6) this.ptr++;
    this.sentSetup = false;
    this.lastEnd = this.clock.tickToMs(this.endTick);
  }

  tick() {
    if (!this.playing) return 0;
    return this.clock.msToTick(this.baseMs + Math.max(0, performance.now() - this.t0));
  }

  // Âm lượng từng phần: chỉnh bằng CC7 trên kênh của phần đó.
  volume(part, factor) {
    const base = part.vol ?? 100;
    this.o.hub.send([0xb0 | (part.channel & 15), 7, clamp(Math.round(base * factor), 0, 127)]);
  }

  setup(mix) {
    const { hub } = this.o;
    this.song.parts.forEach((p) => {
      const ch = p.channel & 15;
      if (p.channel !== 9) hub.send([0xc0 | ch, p.program & 127], this.t0);
      const f = mix.vol.get(p.id) ?? 1;
      if (p.vol != null || f !== 1) hub.send([0xb0 | ch, 7, clamp(Math.round((p.vol ?? 100) * f), 0, 127)], this.t0);
      if (p.pan != null) hub.send([0xb0 | ch, 10, p.pan], this.t0);
    });
  }

  pump() {
    if (!this.playing) return;
    const now = performance.now();
    const horizon = now + 160 - this.t0 + this.baseMs;
    const mix = this.o.getMix();
    const { hub } = this.o;
    if (!this.sentSetup) { this.sentSetup = true; this.setup(mix); }
    while (this.ptr < this.ev.length && this.ev[this.ptr].ms <= horizon) {
      const e = this.ev[this.ptr++];
      const p = this.song.parts[e.pi];
      const ts = this.t0 + (e.ms - this.baseMs);
      const ch = p.channel & 15;
      if (e.raw) {
        const [, type, d1, d2] = e.c;
        if (type !== 0xc0) hub.send(type === 0xd0 ? [type | ch, d1] : [type | ch, d1, d2], ts);
      } else if (e.off) {
        hub.send([0x80 | ch, e.n, 0], ts);
      } else if (!mix.mute.has(p.id) && (!mix.solo || mix.solo.has(p.id))) {
        hub.send([0x90 | ch, e.n, e.v], ts);
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
      for (const p of this.song.parts) {
        const ch = p.channel & 15;
        this.o.hub.send([0xb0 | ch, 123, 0]); // tắt hết nốt đang ngân
        this.o.hub.send([0xb0 | ch, 64, 0]); // nhả pedal
      }
    }
  }
}
