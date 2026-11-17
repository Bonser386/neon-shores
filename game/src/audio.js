// Neon Shores — every sound synthesized live with WebAudio.
// No audio files, no network: engine hum, siren, gunshots, punches, pickups
// and jingles are all oscillators and filtered noise. Everything is guarded:
// if there is no AudioContext (or it cannot start), every method is a no-op.
//
// INTERFACE (what main.js / police.js / missions.js wire against):
//   new AudioSys()
//   audio.unlock()            // call from a user gesture (start click)
//   audio.setMuted(m)
//   audio.engine(speedKmh, driving)  // call every frame; hum follows speed
//   audio.siren(on)           // two-tone loop while police pursue
//   audio.gunshot() / audio.punch() / audio.pickup() / audio.click()
//   audio.missionComplete() / audio.busted() / audio.wasted()

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.noiseBuf = null;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        // shared noise buffer for gunshots
        const len = this.ctx.sampleRate * 0.25;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        // engine: sawtooth hum, quiet until driving
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 50;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineOsc.start();
        // siren: sine with an LFO sweeping its pitch, quiet until pursued
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenOsc.type = 'sine';
        this.sirenOsc.frequency.value = 750;
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.8;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 220;
        lfo.connect(lfoGain);
        lfoGain.connect(this.sirenOsc.frequency);
        this.sirenGain = this.ctx.createGain();
        this.sirenGain.gain.value = 0;
        this.sirenOsc.connect(this.sirenGain);
        this.sirenGain.connect(this.master);
        this.sirenOsc.start();
        lfo.start();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  engine(speedKmh, driving) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const target = driving && !this.muted ? Math.min(0.06, 0.015 + speedKmh * 0.0006) : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + speedKmh * 1.4, t, 0.1);
  }

  siren(on) {
    if (!this.ctx || !this.sirenGain) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on && !this.muted ? 0.035 : 0, t, 0.2);
  }

  blip(freq, dur, type = 'sine', vol = 0.12, when = 0) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* audio is best-effort */ }
  }

  gunshot() {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + 0.15);
      this.blip(160, 0.08, 'square', 0.08);
    } catch (e) { /* best-effort */ }
  }

  punch() {
    this.blip(90, 0.09, 'sine', 0.2);
  }

  pickup() {
    this.blip(880, 0.08, 'sine', 0.12);
    this.blip(1318, 0.12, 'sine', 0.12, 0.08);
  }

  click() {
    this.blip(1200, 0.04, 'square', 0.06);
  }

  missionComplete() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.blip(f, 0.16, 'sine', 0.14, i * 0.11));
  }

  busted() {
    this.blip(392, 0.2, 'triangle', 0.14);
    this.blip(311, 0.3, 'triangle', 0.14, 0.18);
  }

  wasted() {
    this.blip(220, 0.25, 'triangle', 0.14);
    this.blip(165, 0.4, 'triangle', 0.14, 0.22);
  }
}
