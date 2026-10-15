// Silnik po stronie wątku UI: AudioContext, komunikacja z AudioWorkletem,
// nagrywanie z mikrofonu, dekodowanie plików. Odpowiednik AudioEngine.kt (część „sterująca”).

import { buildPads, BASE_BPM, finishSample } from './synth.js';

export const MAX_SECONDS = 10; // kafelek REC (s)
export const DECK_MAX_SECONDS = 360; // deck (s)
const MIN_SAMPLE_SECONDS = 0.1;

/** @typedef {'empty'|'recording'|'loading'|'ready'} SlotStatus */

class Emitter {
  constructor() {
    this._l = new Set();
  }
  on(fn) {
    this._l.add(fn);
    return () => this._l.delete(fn);
  }
  emit(evt, payload) {
    for (const fn of this._l) fn(evt, payload);
  }
}

class Slot {
  constructor(index) {
    this.index = index;
    this.padId = Engine.SLOT_ID_BASE + index;
    /** @type {SlotStatus} */
    this.status = 'empty';
    this.loop = false;
    this.seconds = 0;
    this.name = '';
  }
}

export class Engine extends Emitter {
  static SLOT_ID_BASE = 100;

  constructor() {
    super();
    /** @type {{id:number,label:string,loop:boolean,color:string}[]} */
    this.pads = [];
    this.slots = Array.from({ length: 4 }, (_, i) => new Slot(i));
    this.activeLoops = new Set();
    this.loopModes = new Set();

    this.levelPeak = 0;

    this.deck = {
      status: /** @type {SlotStatus} */ ('empty'),
      name: '',
      pos: 0,
      len: 0,
      playing: false,
      loop: false,
    };

    this.ctx = null;
    this.node = null;
    this.sr = 44100;
    this.started = false;

    this._rec = null; // aktywne nagrywanie
    this._pendingStop = false; // „stop” wciśnięty zanim mikrofon był gotowy
    this._recCtx = null;
    this._starting = null;
  }

  get framesPerRev() {
    return this.sr * 1.8; // 33 1/3 obr./min
  }

  // ================= start / zatrzymanie =================

  /**
   * Musi być wywołane z gestu użytkownika (kliknięcie/dotknięcie) — wymóg autoplay przeglądarek.
   */
  start() {
    if (this._starting) return this._starting;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor || !window.AudioWorkletNode || !window.isSecureContext) {
      return Promise.reject(new Error('Ta przeglądarka nie obsługuje AudioWorklet.'));
    }
    // synchronicznie, w ramach gestu
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx.resume().catch(() => {});
    this.sr = this.ctx.sampleRate;

    // iOS: dźwięk ma grać mimo wyciszenia przełącznikiem
    this._audioSession('playback');

    const ctx = this.ctx;
    this._starting = (async () => {
      await this.ctx.audioWorklet.addModule(new URL('js/worklet.js', document.baseURI).href);
      this.node = new AudioWorkletNode(this.ctx, 'sampler', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.port.onmessage = (e) => this._onWorkletMessage(e.data);
      this.node.connect(this.ctx.destination);

      const pads = buildPads(this.sr);
      for (const p of pads) {
        this.pads.push({ id: p.id, label: p.label, loop: p.loop, color: p.color });
        this._send({ t: 'pad', id: p.id, data: p.data }, [p.data.buffer]);
        if (p.loop) this.loopModes.add(p.id);
      }

      // wznowienie po zawieszeniu (np. przerwanie przez system, powrót do karty)
      const resume = () => {
        if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      };
      for (const evt of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
        window.addEventListener(evt, resume, true);
      }

      this.started = true;
    })().catch((err) => {
      // sprzątanie, żeby kolejne dotknięcie mogło spróbować od nowa
      this._starting = null;
      this.node = null;
      this.ctx = null;
      this.pads = [];
      this.loopModes = new Set();
      ctx.close().catch(() => {});
      throw err;
    });
    return this._starting;
  }

  _send(msg, transfer) {
    if (this.node) this.node.port.postMessage(msg, transfer || []);
  }

  _onWorkletMessage(m) {
    if (m.t === 'status') {
      this.levelPeak = Math.max(this.levelPeak, m.level);
      const d = this.deck;
      const changed = d.playing !== m.playing || d.len !== m.len;
      d.pos = m.pos;
      d.len = m.len;
      d.playing = m.playing;
      if (changed) this.emit('deck');
    }
  }

  _audioSession(type) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = type;
    } catch (_) {
      /* ignoruj */
    }
  }

  /** Zwraca i zeruje szczyt poziomu (do miernika). */
  takePeak() {
    const p = this.levelPeak;
    this.levelPeak = 0;
    return p;
  }

  // ================= odtwarzanie kafelków =================

  setTempo(ratio) {
    this._send({ t: 'tempo', v: ratio });
  }

  setPitch(ratio) {
    this._send({ t: 'pitch', v: ratio });
  }

  /** Dotknięcie kafelka presetu: w trybie pętli włącza/wyłącza pętlę, inaczej odpala jednorazowo. */
  press(pad) {
    if (this.loopModes.has(pad.id)) this._toggleLoop(pad.id, true);
    else this._send({ t: 'start', id: pad.id, loop: false });
  }

  /** Podwójne kliknięcie: przełącza tryb kafelka. Przejście na pętlę od razu ją startuje. */
  toggleLoopMode(pad) {
    this._stopVoices(pad.id);
    const nowLoop = !this.loopModes.has(pad.id);
    if (nowLoop) this.loopModes.add(pad.id);
    else this.loopModes.delete(pad.id);
    if (nowLoop) this._toggleLoop(pad.id, true);
    this.emit('loops');
  }

  pressSlot(slot) {
    if (slot.status !== 'ready') return;
    if (slot.loop) this._toggleLoop(slot.padId, false);
    else this._send({ t: 'start', id: slot.padId, loop: false });
  }

  toggleSlotLoopMode(slot) {
    if (slot.status !== 'ready') return;
    this._stopVoices(slot.padId);
    slot.loop = !slot.loop;
    if (slot.loop) this._toggleLoop(slot.padId, false);
    this.emit('slots');
  }

  clearSlot(slot) {
    if (slot.status === 'recording' || slot.status === 'loading') return;
    this._stopVoices(slot.padId);
    this._send({ t: 'pad', id: slot.padId, data: null });
    slot.name = '';
    slot.loop = false;
    slot.seconds = 0;
    slot.status = 'empty';
    this.emit('slots');
  }

  stopAll() {
    this._send({ t: 'stopAll' });
    this.activeLoops = new Set();
    this.deck.playing = false;
    this.emit('loops');
    this.emit('deck');
  }

  _toggleLoop(padId, syncMaster) {
    if (this.activeLoops.has(padId)) {
      this._send({ t: 'stop', id: padId });
      this.activeLoops.delete(padId);
    } else {
      this._send({ t: 'start', id: padId, loop: true, syncMaster });
      this.activeLoops.add(padId);
    }
    this.emit('loops');
  }

  _stopVoices(padId) {
    this._send({ t: 'stop', id: padId });
    this.activeLoops.delete(padId);
    this.emit('loops');
  }

  // ================= deck winylowy =================

  /** Wczytuje track (max DECK_MAX_SECONDS s, mono) na deck. */
  async loadDeck(file) {
    if (this.deck.status === 'loading') return;
    const prev = this.deck.status;
    this._send({ t: 'deckStop' }); // jak w oryginale: wczytywanie zatrzymuje odtwarzanie
    this.deck.status = 'loading';
    this.deck.playing = false;
    this.emit('deck');
    try {
      const mono16 = await this._decodeToInt16(file, DECK_MAX_SECONDS);
      if (!mono16 || mono16.length < this.sr * MIN_SAMPLE_SECONDS) throw new Error('short');
      this.deck.len = mono16.length;
      this.deck.pos = 0;
      this.deck.name = baseName(file.name) || 'TRACK';
      this.deck.status = 'ready';
      this._send({ t: 'deckLoad', data: mono16 }, [mono16.buffer]);
    } catch (e) {
      this.emit('toast', 'Nie udało się wczytać tracka');
      this.deck.status = prev === 'ready' ? 'ready' : 'empty';
    }
    this.emit('deck');
  }

  deckTogglePlay() {
    if (this.deck.status !== 'ready') return;
    this._send({ t: 'deckToggle' });
  }

  /** CUE: zatrzymuje i wraca na początek tracka. */
  deckCue() {
    if (this.deck.status !== 'ready') return;
    this.deck.playing = false;
    this._send({ t: 'deckCue' });
    this.emit('deck');
  }

  deckToggleLoop() {
    this.deck.loop = !this.deck.loop;
    this._send({ t: 'deckLoop', v: this.deck.loop });
    this.emit('deck');
  }

  /** Fader pitch w procentach (np. -16..+16). */
  deckSetPitch(percent) {
    this._send({ t: 'deckPitch', percent });
  }

  deckSetVolume(v) {
    this._send({ t: 'deckVol', v });
  }

  /** Palec/kursor dotyka płyty (true) lub ją puszcza (false). */
  deckTouch(down) {
    this._send({ t: 'deckTouch', down });
  }

  /** Obrót płyty o `revolutions` obrotów (dodatnio = zgodnie z ruchem wskazówek zegara = do przodu). */
  deckScratch(revolutions) {
    this._send({ t: 'deckScratch', rev: revolutions });
  }

  // ================= pliki =================

  /** Wczytuje plik audio do slotu (obcina do MAX_SECONDS s). */
  async loadFile(slot, file) {
    if (slot.status === 'recording' || slot.status === 'loading') return;
    this._stopVoices(slot.padId);
    const prevStatus = slot.status;
    slot.status = 'loading';
    this.emit('slots');
    try {
      const mono = await this._decodeToFloat(file, MAX_SECONDS);
      const result = mono ? finishSample(mono, this.sr) : null;
      if (!result || result.length < this.sr * MIN_SAMPLE_SECONDS) throw new Error('short');
      this._completeSlot(slot, result, baseName(file.name) || 'PLIK');
    } catch (e) {
      this.emit('toast', 'Nie udało się wczytać pliku');
      slot.status = prevStatus === 'ready' ? 'ready' : 'empty';
    }
    this.emit('slots');
  }

  _completeSlot(slot, data, name) {
    slot.name = name;
    slot.seconds = data.length / this.sr;
    slot.status = 'ready';
    this._send({ t: 'pad', id: slot.padId, data }, [data.buffer]);
  }

  async _decodeBuffer(file) {
    const ab = await file.arrayBuffer();
    return await new Promise((resolve, reject) => {
      // wersja z callbackami działa też w starszym Safari
      const p = this.ctx.decodeAudioData(ab, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
  }

  /** Mono float, w częstotliwości kontekstu, obcięte do maxSeconds. */
  async _decodeToFloat(file, maxSeconds) {
    const buf = await this._decodeBuffer(file);
    const n = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate));
    const out = new Float32Array(n);
    const ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i] / ch;
    }
    return out;
  }

  /** Mono 16-bit (oszczędza pamięć na długich trackach). */
  async _decodeToInt16(file, maxSeconds) {
    const buf = await this._decodeBuffer(file);
    const n = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate));
    const ch = buf.numberOfChannels;
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += chans[c][i];
      s /= ch;
      out[i] = (s < -1 ? -1 : s > 1 ? 1 : s) * 32767;
    }
    return out;
  }

  // ================= nagrywanie =================

  /** Start nagrywania z mikrofonu do slotu (max MAX_SECONDS s). */
  async startRecording(slot) {
    if (slot.status === 'loading') return;
    if (this._rec) await this._finishRecording();
    this._pendingStop = false;
    this._stopVoices(slot.padId);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.emit('toast', 'Mikrofon wymaga bezpiecznego połączenia (HTTPS lub localhost)');
      return;
    }

    const prevStatus = slot.status;
    slot.status = 'recording';
    slot.seconds = 0;
    this.emit('slots');

    let stream;
    try {
      this._audioSession('play-and-record');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (e) {
      this._audioSession('playback');
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      this.emit('toast', denied ? 'Brak zgody na użycie mikrofonu' : 'Nie można uruchomić mikrofonu');
      slot.status = prevStatus === 'ready' ? 'ready' : 'empty';
      this.emit('slots');
      return;
    }

    try {
      // Osobny kontekst: strumień mikrofonu bywa w innej częstotliwości niż wyjście, a niektóre
      // przeglądarki (Firefox) nie pozwalają łączyć węzłów między różnymi częstotliwościami.
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!this._recCtx) {
        this._recCtx = new Ctor({ latencyHint: 'interactive' });
        await this._recCtx.audioWorklet.addModule(new URL('js/worklet.js', document.baseURI).href);
      }
      const rctx = this._recCtx;
      await rctx.resume();

      const src = rctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(rctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 0 });
      src.connect(node);

      const rec = {
        slot,
        stream,
        src,
        node,
        rate: rctx.sampleRate,
        chunks: [],
        count: 0,
        max: Math.floor(rctx.sampleRate * MAX_SECONDS),
        prevStatus,
        stopped: null,
        stopRequested: false,
      };
      this._rec = rec;
      if (this._pendingStop) {
        this._pendingStop = false;
        queueMicrotask(() => this.stopRecording());
      }

      rec.stopped = new Promise((resolve) => {
        node.port.onmessage = (e) => {
          const m = e.data;
          if (m.t === 'chunk') {
            if (rec.count >= rec.max) return;
            let data = m.data;
            if (rec.count + data.length > rec.max) data = data.subarray(0, rec.max - rec.count);
            rec.chunks.push(data);
            rec.count += data.length;
            slot.seconds = rec.count / rec.rate;
            this.emit('slots');
            if (rec.count >= rec.max && !rec.stopRequested) this.stopRecording();
          } else if (m.t === 'stopped') {
            resolve();
          }
        };
      });
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      this._audioSession('playback');
      this._rec = null;
      this.emit('toast', 'Nie można uruchomić mikrofonu');
      slot.status = prevStatus === 'ready' ? 'ready' : 'empty';
      this.emit('slots');
    }
  }

  /** Kończy nagrywanie (wynik trafi do slotu asynchronicznie). */
  stopRecording() {
    const rec = this._rec;
    if (!rec) {
      this._pendingStop = true;
      return;
    }
    if (rec.stopRequested) return;
    this._finishRecording();
  }

  async _finishRecording() {
    const rec = this._rec;
    if (!rec) return;
    if (!rec.stopRequested) {
      rec.stopRequested = true;
      rec.node.port.postMessage({ t: 'stop' });
    }
    await Promise.race([rec.stopped, new Promise((r) => setTimeout(r, 500))]);
    if (this._rec !== rec) return; // już obsłużone
    this._rec = null;

    try {
      rec.src.disconnect();
    } catch (_) {
      /* ignoruj */
    }
    rec.stream.getTracks().forEach((t) => t.stop());
    this._audioSession('playback');
    if (this._recCtx) this._recCtx.suspend().catch(() => {});

    const slot = rec.slot;
    if (rec.count > 0) {
      let data = new Float32Array(rec.count);
      let o = 0;
      for (const c of rec.chunks) {
        data.set(c, o);
        o += c.length;
      }
      data = resampleLinear(data, rec.rate, this.sr);
      finishSample(data, this.sr);
      if (data.length >= this.sr * MIN_SAMPLE_SECONDS) {
        this._completeSlot(slot, data, `MIC ${(rec.count / rec.rate).toFixed(1)}s`);
        this.emit('slots');
        return;
      }
    }
    slot.status = rec.prevStatus === 'ready' ? 'ready' : 'empty';
    this.emit('slots');
  }
}

// ---------- narzędzia ----------

function baseName(name) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function resampleLinear(data, from, to) {
  if (from === to) return data;
  const outLen = Math.floor((data.length * to) / from);
  const out = new Float32Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio;
    const i0 = p | 0;
    const i1 = Math.min(i0 + 1, data.length - 1);
    const f = p - i0;
    out[i] = data[i0] * (1 - f) + data[i1] * f;
  }
  return out;
}

export { BASE_BPM };
