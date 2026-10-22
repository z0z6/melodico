// Silnik po stronie wątku UI: AudioContext, komunikacja z AudioWorkletem,
// nagrywanie z mikrofonu, dekodowanie plików. Odpowiednik AudioEngine.kt (część „sterująca”).

import { buildPads, BASE_BPM, finishSample } from './synth.js';
import { FxChain } from './fx.js';

export const MAX_SECONDS = 10; // kafelek REC (s)
export const MAX_MEMBERS = 8; // ile dźwięków można zmiksować w jednym pojemniku
export const BAKE_MAX_SECONDS = 12; // maks. długość zmiksowanego klocka
export const PARAM_LIMITS = { vol: [0, 2], tempo: [0.5, 2], tone: [-1, 1] };
const DEFAULT_PARAMS = Object.freeze({ vol: 1, tempo: 1, tone: 0 });

/** Poziom wyjścia głównego: suwak 0..1, 0.8 = brak zmiany (0 dB), 1.0 ≈ +3,9 dB. */
export function masterGainFor(v) {
  const x = Math.max(0, Math.min(1, v)) / 0.8;
  return x * x;
}
export const MIX_BITRATE = 128000; // b/s — Opus 128 kb/s ≈ 1 MB/min, jakość zbliżona do oryginału

/** Formaty zapisu miksu wg stosunku jakości do rozmiaru (pierwszy obsługiwany wygrywa). */
const MIX_FORMATS = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm', label: 'Opus' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg', label: 'Opus' },
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a', label: 'AAC' }, // Safari
  { mime: 'audio/mp4', ext: 'm4a', label: 'AAC' },
];

export function pickMixFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIX_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) || null;
}
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
    /** Kopia próbek (potrzebna do zapisu w banku; worklet ma własną). */
    this.data = null;
  }
}

/** Pojemnik (klocek): miks kilku dźwięków wyrenderowany do nowej próbki. */
class Block extends Slot {
  constructor(index) {
    super(index);
    this.padId = Engine.BLOCK_ID_BASE + index;
    /** @type {number[]} identyfikatory kafelków, z których powstaje miks */
    this.members = [];
  }
}

export class Engine extends Emitter {
  static SLOT_ID_BASE = 100;
  static BLOCK_ID_BASE = 200;

  constructor() {
    super();
    /** @type {{id:number,label:string,loop:boolean,color:string}[]} */
    this.pads = [];
    this.slots = Array.from({ length: 4 }, (_, i) => new Slot(i));
    this.blocks = Array.from({ length: 4 }, (_, i) => new Block(i));
    /** Kopie próbek presetów (do renderowania pojemników); worklet ma własne. */
    this.padData = new Map();
    /** Parametry per kafelek: głośność, tempo, barwa. Brak wpisu = ustawienia domyślne. */
    this.padParams = new Map();
    this.master = null;
    this.masterV = 0.8;
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
    this.fx = null;
    this.sr = 44100;
    this.started = false;

    this._mix = null; // aktywny zapis miksu do pliku
    this._recDest = null;
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
      this.fx = new FxChain(this.ctx);
      this.master = this.ctx.createGain();
      this.master.gain.value = masterGainFor(this.masterV);
      this.node.connect(this.fx.input);
      this.fx.output.connect(this.master);
      this.master.connect(this.ctx.destination);

      const pads = buildPads(this.sr);
      for (const p of pads) {
        this.pads.push({ id: p.id, label: p.label, loop: p.loop, color: p.color });
        this.padData.set(p.id, p.data.slice());
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
      this.fx = null;
      this.master = null;
      this.ctx = null;
      this.pads = [];
      this.padData = new Map();
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
    if (this.fx) this.fx.setBpm(ratio * BASE_BPM); // delay podąża za tempem
  }

  setPitch(ratio) {
    this._send({ t: 'pitch', v: ratio });
  }

  /** Główny suwak głośności (0..1; 0.8 = bez zmiany). Wpływa też na nagrywany miks. */
  setMaster(v) {
    this.masterV = Math.max(0, Math.min(1, v));
    if (this.master) {
      const g = this.master.gain;
      const t = this.ctx.currentTime;
      if (g.setTargetAtTime) g.setTargetAtTime(masterGainFor(this.masterV), t, 0.02);
      else g.value = masterGainFor(this.masterV);
    }
  }

  // ---------- parametry per kafelek (preset, REC lub pojemnik) ----------

  getParams(id) {
    return this.padParams.get(id) || DEFAULT_PARAMS;
  }

  /** key: 'vol' | 'tempo' | 'tone'. Działa na żywo, także na grającej pętli. */
  setParam(id, key, value) {
    const [lo, hi] = PARAM_LIMITS[key];
    const cur = { ...this.getParams(id), [key]: Math.max(lo, Math.min(hi, value)) };
    this._storeParams(id, cur);
    this.emit('params');
  }

  resetParams(id) {
    this._storeParams(id, DEFAULT_PARAMS);
    this.emit('params');
  }

  /** Ustawia komplet parametrów (np. z banku). */
  _storeParams(id, p) {
    const isDefault = p.vol === 1 && p.tempo === 1 && p.tone === 0;
    if (isDefault) this.padParams.delete(id);
    else this.padParams.set(id, { vol: p.vol, tempo: p.tempo, tone: p.tone });
    this._send({ t: 'pparam', id, vol: p.vol, tempo: p.tempo, tone: p.tone });
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
    slot.data = null;
    if (slot.members) slot.members = [];
    slot.status = 'empty';
    this.emit('slots');
  }

  // ---------- pojemniki: miks kilku dźwięków do jednego klocka ----------

  /** Dane próbki kafelka o danym id (preset, REC lub pojemnik) albo null. */
  getPadData(id) {
    if (this.padData.has(id)) return this.padData.get(id);
    const sl = this.slots.find((x) => x.padId === id) || this.blocks.find((x) => x.padId === id);
    return sl && sl.status === 'ready' ? sl.data : null;
  }

  isLoopPad(id) {
    const sl = this.slots.find((x) => x.padId === id) || this.blocks.find((x) => x.padId === id);
    return sl ? sl.loop : this.loopModes.has(id);
  }

  /** Dodaje/usuwa kafelek z listy składników pojemnika. */
  toggleMember(block, id) {
    if (id === block.padId) return;
    const i = block.members.indexOf(id);
    if (i >= 0) block.members.splice(i, 1);
    else if (block.members.length >= MAX_MEMBERS) {
      this.emit('toast', `Pojemnik mieści maks. ${MAX_MEMBERS} dźwięków`);
      return;
    } else block.members.push(id);
    this.emit('slots');
  }

  /**
   * Miksuje składniki pojemnika (z ich ustawieniami VOL / TEMPO / TONE i trybem one-shot/pętla)
   * w nowy klocek. Renderowanie offline tym samym procesorem, który gra na żywo.
   */
  async bakeBlock(block) {
    if (block.status === 'loading' || block.status === 'recording') return;
    const items = block.members
      .filter((id) => id !== block.padId && this.getPadData(id))
      .map((id) => ({ id, data: this.getPadData(id), pr: this.getParams(id), loop: this.isLoopPad(id) }));
    if (!items.length) {
      this.emit('toast', 'Najpierw dodaj dźwięki do pojemnika (przycisk +)');
      return;
    }
    const OCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OCtx) {
      this.emit('toast', 'Ta przeglądarka nie obsługuje renderowania offline');
      return;
    }

    this._stopVoices(block.padId);
    const prevStatus = block.status;
    block.status = 'loading';
    this.emit('slots');
    try {
      let frames = 0;
      for (const it of items) frames = Math.max(frames, Math.round(it.data.length / it.pr.tempo));
      frames = Math.max(this.sr * MIN_SAMPLE_SECONDS, Math.min(frames, Math.floor(this.sr * BAKE_MAX_SECONDS)));

      const octx = new OCtx(1, frames, this.sr);
      await octx.audioWorklet.addModule(new URL('js/worklet.js', document.baseURI).href);
      const node = new AudioWorkletNode(octx, 'sampler', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          pads: items.map((it) => ({ id: it.id, data: it.data.slice() })),
          params: items.map((it) => ({ id: it.id, vol: it.pr.vol, tempo: it.pr.tempo, tone: it.pr.tone })),
          start: items.map((it) => ({ id: it.id, loop: it.loop })),
        },
      });
      node.connect(octx.destination);
      const rendered = await octx.startRendering();
      const out = new Float32Array(rendered.getChannelData(0));
      finishSample(out, this.sr);

      block.loop = items.some((it) => it.loop);
      this._completeSlot(block, out, `MIX ${block.index + 1}`);
    } catch (e) {
      console.error(e);
      block.status = prevStatus === 'ready' ? 'ready' : 'empty';
      this.emit('toast', 'Nie udało się zmiksować pojemnika');
    }
    this.emit('slots');
  }

  /** Ustawia zestaw kafelków w trybie pętli (np. po wczytaniu banku). Zatrzymuje wszystko. */
  setLoopModes(ids) {
    this._send({ t: 'stopAll' });
    this.activeLoops = new Set();
    this.loopModes = new Set(ids);
    this.emit('loops');
  }

  /** Wstawia gotowe próbki do slotu (lub czyści, gdy data === null). */
  restoreSlot(slot, data, name, loop) {
    if (slot.status === 'recording' || slot.status === 'loading') return;
    if (!data) {
      this.clearSlot(slot);
      return;
    }
    this._stopVoices(slot.padId);
    slot.loop = !!loop;
    this._completeSlot(slot, data.slice(), name);
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

  // ================= zapis miksu do pliku =================

  get mixRecording() {
    return !!this._mix;
  }

  /** Sekundy od startu zapisu miksu. */
  mixElapsed() {
    return this._mix ? (performance.now() - this._mix.t0) / 1000 : 0;
  }

  /** Zapisuje to, co słychać (kafelki + deck + efekty). Zwraca false, jeśli się nie da. */
  startMixRecording() {
    if (this._mix) return true;
    const fmt = pickMixFormat();
    if (!fmt || !this.fx || !this.ctx.createMediaStreamDestination) {
      this.emit('toast', 'Ta przeglądarka nie obsługuje zapisu do pliku');
      return false;
    }
    try {
      if (!this._recDest) {
        this._recDest = this.ctx.createMediaStreamDestination();
        this.master.connect(this._recDest); // nagranie uwzględnia główny suwak
      }
      const mr = new MediaRecorder(this._recDest.stream, {
        mimeType: fmt.mime,
        audioBitsPerSecond: MIX_BITRATE,
      });
      const chunks = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      this._mix = { mr, chunks, fmt, t0: performance.now() };
      mr.start(1000); // porcje co sekundę, żeby nic nie przepadło
    } catch (e) {
      console.error(e);
      this._mix = null;
      this.emit('toast', 'Nie udało się rozpocząć zapisu');
      return false;
    }
    this.emit('mixrec');
    return true;
  }

  /** Kończy zapis. Zwraca { blob, ext, seconds, label } albo null. */
  stopMixRecording() {
    return new Promise((resolve) => {
      const m = this._mix;
      if (!m) {
        resolve(null);
        return;
      }
      this._mix = null;
      const seconds = (performance.now() - m.t0) / 1000;
      m.mr.onstop = () => {
        const blob = new Blob(m.chunks, { type: m.fmt.mime.split(';')[0] });
        this.emit('mixrec');
        resolve(blob.size > 0 ? { blob, ext: m.fmt.ext, label: m.fmt.label, seconds } : null);
      };
      try {
        m.mr.stop();
      } catch (e) {
        this.emit('mixrec');
        resolve(null);
      }
    });
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
    slot.data = data; // kopia do zapisu w banku
    const copy = data.slice();
    this._send({ t: 'pad', id: slot.padId, data: copy }, [copy.buffer]);
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
