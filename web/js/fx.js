// Efekty master: filtr (LP/HP na jednym pokrętle) z rezonansem, delay zsynchronizowany z tempem
// oraz pogłos (konwolucja z generowaną odpowiedzią impulsową). Natywne węzły Web Audio.
//
//   input → HP → LP ─┬─────────────────────────────→ output   (dry)
//                    ├→ delaySend → delay ⇄ feedback → output
//                    └→ reverbSend → convolver ───────→ output

import { BASE_BPM } from './synth.js';

/** Podziały opóźnienia (w ćwierćnutach). */
export const DELAY_DIVS = [
  { label: '1/16', beats: 0.25 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/4', beats: 1 },
];

const SMOOTH = 0.03; // s, wygładzanie parametrów (bez „trzasków”)

export class FxChain {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = BASE_BPM;
    this.divIndex = 1;
    this.filterV = 0; // -1..1 (− = low-pass, + = high-pass)
    this.res = 0.25; // 0..1

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // filtr
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 20;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.input.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.output); // dry

    // delay
    this.delay = ctx.createDelay(2);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.35;
    this.fbTone = ctx.createBiquadFilter(); // ciemniejsze powtórki
    this.fbTone.type = 'lowpass';
    this.fbTone.frequency.value = 3800;
    this.lp.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.output);
    this.delay.connect(this.fbTone);
    this.fbTone.connect(this.feedback);
    this.feedback.connect(this.delay);

    // reverb
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.2, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.lp.connect(this.reverbSend);
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.output);

    this._applyFilter();
    this._applyDelayTime();
  }

  _set(param, v) {
    const t = this.ctx.currentTime;
    if (param.setTargetAtTime) param.setTargetAtTime(v, t, SMOOTH);
    else param.value = v;
  }

  /** v: -1..1; poniżej 0 filtr dolnoprzepustowy, powyżej 0 górnoprzepustowy. */
  setFilter(v) {
    this.filterV = Math.max(-1, Math.min(1, v));
    this._applyFilter();
  }

  /** r: 0..1 */
  setRes(r) {
    this.res = Math.max(0, Math.min(1, r));
    this._applyFilter();
  }

  _applyFilter() {
    const v = this.filterV;
    const q = this.res * 12; // dla LP/HP parametr Q jest w dB: 0..12 dB rezonansu
    const lpF = v < 0 ? 20000 * Math.pow(0.01, -v) : 20000; // 20 kHz → 200 Hz
    const hpF = v > 0 ? 20 * Math.pow(300, v) : 20; //        20 Hz → 6 kHz
    this._set(this.lp.frequency, lpF);
    this._set(this.hp.frequency, hpF);
    this._set(this.lp.Q, v < 0 ? q : 0);
    this._set(this.hp.Q, v > 0 ? q : 0);
  }

  setBpm(bpm) {
    this.bpm = bpm;
    this._applyDelayTime();
  }

  setDelayDiv(i) {
    this.divIndex = Math.max(0, Math.min(DELAY_DIVS.length - 1, Math.round(i)));
    this._applyDelayTime();
  }

  _applyDelayTime() {
    const sec = (DELAY_DIVS[this.divIndex].beats * 60) / this.bpm;
    this._set(this.delay.delayTime, Math.min(2, Math.max(0.001, sec)));
  }

  /** f: 0..0.9 */
  setDelayFeedback(f) {
    this._set(this.feedback.gain, Math.max(0, Math.min(0.9, f)));
  }

  /** m: 0..1 */
  setDelayMix(m) {
    this._set(this.delaySend.gain, Math.max(0, Math.min(1, m)) * 0.8);
  }

  /** m: 0..1 */
  setReverbMix(m) {
    this._set(this.reverbSend.gain, Math.max(0, Math.min(1, m)) * 1.2);
  }
}

/** Stereofoniczna odpowiedź impulsowa: szum z wykładniczym zanikiem. */
function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = 1 - i / len;
      lp += 0.5 * ((Math.random() * 2 - 1) - lp); // trochę ciemniejszy ogon
      d[i] = lp * Math.pow(x, decay);
    }
  }
  return buf;
}
