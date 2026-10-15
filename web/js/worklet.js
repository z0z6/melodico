// Wątek audio — port AudioEngine.render() / mixLoop() / mixOneShot() / mixDeck().
//
// - One-shoty: odtwarzanie z interpolacją; tonacja zmienia prędkość (jak winyl).
// - Pętle: granularny time-stretch + pitch-shift (dwa nakładające się ziarna z oknem Hanna),
//   dzięki czemu TEMPO i TONACJA działają niezależnie. Przy 120 BPM i tonacji 0 wynik jest
//   identyczny z oryginałem. Pętle presetów są zsynchronizowane do wspólnego zegara.
// - Deck winylowy: długi track (16-bit mono) odtwarzany z płynną prędkością. Dotknięcie płyty
//   przejmuje kontrolę nad pozycją (scratch), puszczenie przywraca obroty silnika z bezwładnością.
//
// Ten plik NIE jest modułem ES (działa w AudioWorkletGlobalScope), bez importów.

const GRAIN = 2048;
const HOP = GRAIN / 2;
const FADE_IN = 128;
const FADE_OUT = 256; // próbek; wygaszanie rozłożone na kilka bloków
const MAX_VOICES = 32;
const GAIN = 0.8;
const DECK_GAIN = 0.85;
const MAX_SCRATCH_RATE = 8.0;
const SCRATCH_SMOOTH_FRAMES = 768; // w oryginale: 256 próbek bloku * 3
const STATUS_INTERVAL_S = 0.016;

const HANN = new Float32Array(GRAIN);
for (let i = 0; i < GRAIN; i++) HANN[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / GRAIN));

function softClip(x) {
  const a = Math.abs(x);
  return a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
}

class Voice {
  constructor(padId, data, loop, gain, syncMaster) {
    this.padId = padId;
    this.data = data;
    this.loop = loop;
    this.gain = gain;
    this.syncMaster = syncMaster;
    // one-shot
    this.pos = 0;
    // pętla (granularnie)
    this.contentPos = 0;
    this.gPos = new Float64Array(2);
    this.gAge = new Int32Array(2);
    this.started = false;
    this.fadeIn = 0;
    this.stopping = false;
    this.fadeLeft = FADE_OUT;
    this.done = false;
  }
}

class SamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.barFrames = Math.round(this.sr * 2); // 1 takt przy 120 BPM
    this.masterWrap = this.barFrames * 8;
    this.framesPerRev = this.sr * 1.8; // 33 1/3 obr./min

    this.pads = new Map(); // padId -> Float32Array
    this.voices = [];
    this.masterPos = 0;
    this.tempo = 1.0;
    this.pitch = 1.0;

    // deck
    this.dData = null; // Int16Array
    this.dPlay = false;
    this.dTouching = false;
    this.dTarget = 0;
    this.dPitch = 1.0;
    this.dVol = 0.8;
    this.dLoop = false;
    this.dSeek = -1;
    this.dPos = 0;
    this.dRate = 0;

    this.peak = 0;
    this.sinceStatus = 0;
    this.scratch = new Float32Array(128);

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  // ---------------- komendy z wątku UI ----------------

  onMessage(m) {
    switch (m.t) {
      case 'pad':
        if (m.data) this.pads.set(m.id, m.data);
        else this.pads.delete(m.id);
        break;
      case 'start': {
        const data = this.pads.get(m.id);
        if (!data) break;
        if (this.voices.length >= MAX_VOICES) {
          if (!m.loop) break;
          // pętla ma pierwszeństwo — zwalniamy najstarszy one-shot
          const idx = this.voices.findIndex((v) => !v.loop);
          if (idx < 0) break;
          this.voices.splice(idx, 1);
        }
        this.voices.push(new Voice(m.id, data, !!m.loop, GAIN, !!m.syncMaster));
        break;
      }
      case 'stop':
        for (const v of this.voices) if (v.padId === m.id) v.stopping = true;
        break;
      case 'stopAll':
        for (const v of this.voices) v.stopping = true;
        this.dPlay = false;
        break;
      case 'tempo':
        this.tempo = Math.min(4, Math.max(0.25, m.v));
        break;
      case 'pitch':
        this.pitch = Math.min(4, Math.max(0.25, m.v));
        break;

      case 'deckLoad':
        this.dPlay = false;
        this.dTouching = false;
        this.dData = m.data;
        this.dPos = 0;
        this.dRate = 0;
        this.dSeek = -1;
        this.postStatus(true);
        break;
      case 'deckStop':
        this.dPlay = false;
        break;
      case 'deckToggle':
        if (!this.dData) break;
        if (!this.dPlay && this.dPos >= this.dData.length - 2) this.dSeek = 0;
        this.dPlay = !this.dPlay;
        break;
      case 'deckCue':
        if (!this.dData) break;
        this.dPlay = false;
        this.dSeek = 0;
        break;
      case 'deckLoop':
        this.dLoop = !!m.v;
        break;
      case 'deckPitch':
        this.dPitch = 1.0 + m.percent / 100.0;
        break;
      case 'deckVol':
        this.dVol = Math.min(1, Math.max(0, m.v));
        break;
      case 'deckTouch':
        if (m.down) {
          this.dTarget = this.dPos;
          this.dTouching = !!this.dData;
        } else {
          this.dTouching = false;
        }
        break;
      case 'deckScratch':
        if (!this.dTouching || !this.dData) break;
        this.dTarget = Math.min(
          Math.max(0, this.dData.length - 1),
          Math.max(0, this.dTarget + m.rev * this.framesPerRev)
        );
        break;
    }
  }

  postStatus(force) {
    this.port.postMessage({
      t: 'status',
      level: this.peak,
      pos: this.dPos,
      len: this.dData ? this.dData.length : 0,
      playing: this.dPlay,
    });
    this.peak = 0;
    this.sinceStatus = 0;
  }

  // ---------------- render ----------------

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    if (this.scratch.length < frames) this.scratch = new Float32Array(frames);
    const buf = this.scratch;
    buf.fill(0, 0, frames);

    const tempo = this.tempo;
    const pitch = this.pitch;

    let anyDone = false;
    for (const v of this.voices) {
      if (v.done) continue;
      if (v.loop) this.mixLoop(v, buf, frames, tempo, pitch);
      else this.mixOneShot(v, buf, frames, pitch);
      if (v.done) anyDone = true;
    }
    if (anyDone) this.voices = this.voices.filter((v) => !v.done);

    this.mixDeck(buf, frames);

    let peak = this.peak;
    for (let i = 0; i < frames; i++) {
      const y = softClip(buf[i]);
      buf[i] = y;
      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
    }
    this.peak = peak;
    this.masterPos = (this.masterPos + tempo * frames) % this.masterWrap;

    for (let c = 0; c < out.length; c++) out[c].set(buf.subarray(0, frames));

    this.sinceStatus += frames;
    if (this.sinceStatus >= this.sr * STATUS_INTERVAL_S) this.postStatus(false);
    return true;
  }

  mixOneShot(v, buf, frames, pitch) {
    const data = v.data;
    const n = data.length;
    let p = v.pos;
    for (let i = 0; i < frames; i++) {
      const i0 = p | 0;
      if (i0 >= n - 1) {
        v.done = true;
        break;
      }
      const f = p - i0;
      let s = (data[i0] * (1 - f) + data[i0 + 1] * f) * v.gain;
      if (v.stopping) {
        s *= v.fadeLeft / FADE_OUT;
        if (--v.fadeLeft < 0) {
          v.done = true;
          break;
        }
      }
      buf[i] += s;
      p += pitch;
    }
    v.pos = p;
  }

  mixLoop(v, buf, frames, tempo, pitch) {
    const data = v.data;
    const n = data.length;
    const nd = n;

    if (!v.started) {
      v.contentPos = v.syncMaster ? this.masterPos % nd : 0;
      // grain 0 jest w szczycie okna, grain 1 dopiero startuje: suma okien = 1
      v.gPos[0] = v.contentPos;
      v.gAge[0] = HOP;
      v.gPos[1] = v.contentPos;
      v.gAge[1] = 0;
      v.fadeIn = FADE_IN;
      v.started = true;
    }

    const gPos = v.gPos;
    const gAge = v.gAge;
    for (let i = 0; i < frames; i++) {
      let acc = 0;
      for (let g = 0; g < 2; g++) {
        let p = gPos[g];
        const i0 = p | 0;
        const i1 = i0 + 1 >= n ? 0 : i0 + 1;
        const f = p - i0;
        acc += (data[i0] * (1 - f) + data[i1] * f) * HANN[gAge[g]];

        p += pitch;
        if (p >= nd) p -= nd;
        gPos[g] = p;

        const age = gAge[g] + 1;
        if (age >= GRAIN) {
          // nowy grain startuje w miejscu, które zegar treści osiągnie w następnej próbce
          let np = v.contentPos + tempo;
          if (np >= nd) np -= nd;
          gPos[g] = np;
          gAge[g] = 0;
        } else {
          gAge[g] = age;
        }
      }
      v.contentPos += tempo;
      if (v.contentPos >= nd) v.contentPos -= nd;

      let s = acc * v.gain;
      if (v.fadeIn > 0) {
        s *= 1 - v.fadeIn / FADE_IN;
        v.fadeIn--;
      }
      if (v.stopping) {
        s *= v.fadeLeft / FADE_OUT;
        if (--v.fadeLeft < 0) {
          v.done = true;
          break;
        }
      }
      buf[i] += s;
    }
  }

  /** Deck: płynna prędkość odtwarzania + scratch sterowany pozycją palca. */
  mixDeck(buf, frames) {
    const data = this.dData;
    if (!data) return;
    const len = data.length;
    if (len < 2) return;

    if (this.dSeek >= 0) {
      this.dPos = Math.min(len - 1, Math.max(0, this.dSeek));
      this.dSeek = -1;
      this.dRate = 0;
    }

    const touching = this.dTouching;
    const playFlag = this.dPlay;
    const loop = this.dLoop;
    const vol = this.dVol;
    const startRate = this.dRate;

    let endRate;
    if (touching) {
      // płyta podąża za palcem; wygładzanie usuwa "schodki" ze zdarzeń dotyku
      endRate = (this.dTarget - this.dPos) / SCRATCH_SMOOTH_FRAMES;
      endRate = Math.min(MAX_SCRATCH_RATE, Math.max(-MAX_SCRATCH_RATE, endRate));
    } else {
      // silnik: rozpędza się szybko, hamuje wolniej (bezwładność talerza)
      const motor = playFlag ? this.dPitch : 0;
      const tau = playFlag ? 0.1 : 0.3;
      endRate = startRate + (motor - startRate) * (1 - Math.exp(-frames / (this.sr * tau)));
    }

    let pos = this.dPos;
    let ended = false;
    for (let i = 0; i < frames; i++) {
      const k = (i + 1) / frames;
      const rate = startRate + (endRate - startRate) * k;
      const i0 = pos | 0;
      if (i0 >= 0 && i0 < len - 1) {
        const f = pos - i0;
        const s = (data[i0] * (1 - f) + data[i0 + 1] * f) / 32768;
        // przy zatrzymanej płycie sygnał gaśnie (bez stałej składowej)
        const amp = Math.min(1, Math.abs(rate) * 6);
        buf[i] += s * vol * amp * DECK_GAIN;
      }
      pos += rate;
      if (pos >= len - 1) {
        if (loop && !touching) {
          pos -= len - 1;
        } else {
          pos = len - 1;
          if (!touching) {
            ended = true;
            break;
          }
        }
      } else if (pos < 0) {
        pos = 0;
      }
    }
    this.dPos = pos;
    this.dRate = ended ? 0 : endRate;
    if (ended) this.dPlay = false;
  }
}

registerProcessor('sampler', SamplerProcessor);

// ----------------------------------------------------------------------------
// Rejestrator mikrofonu: zbiera mono (kanał 0) i wysyła porcjami do wątku UI.
// ----------------------------------------------------------------------------
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.fill = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.t === 'stop') {
        this.flush();
        this.active = false;
        this.port.postMessage({ t: 'stopped' });
      }
    };
  }

  flush() {
    if (this.fill > 0) {
      const part = this.chunk.slice(0, this.fill);
      this.port.postMessage({ t: 'chunk', data: part }, [part.buffer]);
      this.fill = 0;
    }
  }

  process(inputs) {
    if (!this.active) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.chunk[this.fill++] = ch[i];
        if (this.fill === this.chunk.length) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('recorder', RecorderProcessor);
