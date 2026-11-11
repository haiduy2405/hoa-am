// Bọc Web MIDI: tự tìm đàn Yamaha, lọc tin nhắn rác, phát sự kiện gọn.

const YAMAHA = /yamaha|psr|s975|digital keyboard/i;

export class MidiHub {
  constructor() {
    this.access = null;
    this.inputs = [];
    this.outputs = [];
    this.inputId = 'all';
    this.outputId = 'auto';
    this.status = 'idle'; // idle | ready | unsupported | denied
    this.h = {};
  }

  on(type, fn) {
    (this.h[type] ||= []).push(fn);
    return this;
  }

  emit(type, data) {
    (this.h[type] || []).forEach((fn) => fn(data));
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      this.emit('devices');
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      this.status = 'denied';
      this.emit('devices');
      return false;
    }
    this.status = 'ready';
    this.access.onstatechange = () => this.refresh();
    this.refresh();
    return true;
  }

  refresh() {
    if (!this.access) return;
    this.inputs = [...this.access.inputs.values()].filter((p) => p.state !== 'disconnected');
    this.outputs = [...this.access.outputs.values()].filter((p) => p.state !== 'disconnected');
    this.wire();
    this.emit('devices');
  }

  wire() {
    for (const p of this.inputs) {
      const use = this.inputId === 'all' || this.inputId === p.id;
      p.onmidimessage = use ? (e) => this.handle(p, e) : null;
    }
  }

  setInput(id) {
    this.inputId = id;
    this.wire();
    this.emit('devices');
  }

  setOutput(id) {
    this.outputId = id;
    this.emit('devices');
  }

  get yamahaIn() {
    return this.inputs.find((p) => YAMAHA.test(p.name || '')) || null;
  }

  get activeInput() {
    if (this.inputId !== 'all') return this.inputs.find((p) => p.id === this.inputId) || null;
    return this.yamahaIn || this.inputs[0] || null;
  }

  get activeOutput() {
    if (this.outputId !== 'auto') return this.outputs.find((p) => p.id === this.outputId) || null;
    return this.outputs.find((p) => YAMAHA.test(p.name || '')) || this.outputs[0] || null;
  }

  handle(port, e) {
    const [st, d1, d2] = e.data;
    if (st >= 0xf0) return; // clock, active sensing, sysex... bỏ qua
    const type = st & 0xf0;
    const ch = (st & 0x0f) + 1;
    if (type === 0x90 && d2 > 0) this.emit('note', { on: true, note: d1, vel: d2, ch });
    else if (type === 0x80 || type === 0x90) this.emit('note', { on: false, note: d1, vel: 0, ch });
    else if (type === 0xb0) {
      if (d1 === 64) this.emit('pedal', { down: d2 >= 64, ch });
      else if (d1 === 123 || d1 === 120) this.emit('panic', { ch });
    }
  }

  send(bytes, ts) {
    const out = this.activeOutput;
    if (!out) return false;
    try {
      out.send(bytes, ts);
    } catch (e) {
      return false;
    }
    return true;
  }

  noteOn(n, v = 90, ch = 1, ts) {
    return this.send([0x90 | (ch - 1), n, v], ts);
  }

  noteOff(n, ch = 1, ts) {
    return this.send([0x80 | (ch - 1), n, 0], ts);
  }

  allOff(ch = 1) {
    this.send([0xb0 | (ch - 1), 123, 0]);
  }
}
